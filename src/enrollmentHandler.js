import { performOCR } from './ocr.js';
import { parseEnrollmentDocument, calculateDocumentHash } from './parser.js';
import { 
    upsertStudent, 
    findDocumentByHash, 
    insertDocument, 
    updateDocumentStatus,
    insertSubject,
    getPendingDocument,
    getSubjectsForDocument,
    markSubjectAdded,
    markSubjectFailed,
    getStudentSubjectCount,
    isTokenUsed,
    markTokenUsed
} from './database.js';
import { mapSubjectsToGroups } from './groupMapper.js';
import { randomDelay, enviarMensajeHumano, delayFromRange } from './antibanHelpers.js';
import { logger } from './logger.js';
import { MAX_SUBJECTS_PER_USER, DELAYS } from './config.js';
import { addJob, initDocument } from './queueManager.js';
import { 
    validateRegistrationNumberConsistency,
    getStudentAddedSubjects,
    compareSubjects
} from './validationHelpers.js';
import { fetchBoletaFromDTIC } from './dticClient.js';

/**
 * Handle document upload (boleta)
 * @param {object} client - WhatsApp client
 * @param {object} message - WhatsApp message object
 * @param {object} media - Downloaded media object
 */
export async function handleDocumentUpload(client, message, media) {
    const chat = await message.getChat();
    const remitente = message.from;
    let parsed = null; // Declare outside try for access in catch
    
    try {
        logger.info('Document upload received', { 
            from: remitente, 
            mimeType: media.mimetype 
        });
        
        // Initial delay (anti-ban protocol)
        await randomDelay(DELAYS.RESPUESTA_INICIAL[0], DELAYS.RESPUESTA_INICIAL[1]);
        
        // Step 1: Calculate hash for duplicate detection (same file)
        const buffer = Buffer.from(media.data, 'base64');
        const docHash = calculateDocumentHash(buffer);
        
        const duplicate = await findDocumentByHash(docHash);
        if (duplicate) {
            await enviarMensajeHumano(
                chat,
                `⚠️ *Documento duplicado*\n\n` +
                `Ya procesaste este archivo el ${new Date(duplicate.creado_en).toLocaleDateString()}.\n` +
                `Estado: ${duplicate.estado}`
            );
            return;
        }
        
        // Step 1b: Check for pending documents from this student (different photo of same boleta)
        const pendingDoc = await getPendingDocument(remitente);
        if (pendingDoc) {
            const timeSinceUpload = (Date.now() - new Date(pendingDoc.creado_en).getTime()) / 60000; // minutes
            await enviarMensajeHumano(
                chat,
                `⚠️ *Ya tienes un documento en proceso*\n\n` +
                `Subiste una boleta hace ${Math.round(timeSinceUpload)} minutos.\n` +
                `Estado: ${pendingDoc.estado}\n\n` +
                `${pendingDoc.estado === 'pendiente' ? 'Por favor confirma con *LISTO* para continuar.' : 'Espera a que termine de procesarse.'}`
            );
            return;
        }
        
        // Step 2: Perform OCR
        await enviarMensajeHumano(chat, '🔍 Procesando tu documento...');
        
        const ocrText = await performOCR(buffer, media.mimetype);
        
        // Step 3: Parse data
        parsed = parseEnrollmentDocument(ocrText);
        
        if (!parsed.isValid) {
            await enviarMensajeHumano(
                chat,
                `❌ *No pude leer tu documento correctamente*\n\n` +
                `Asegúrate de que:\n` +
                `✓ La foto sea clara y legible\n` +
                `✓ Incluya tu número de registro (9 dígitos)\n` +
                `✓ Muestre la tabla de materias con códigos y grupos\n\n` +
                `Intenta enviar otra foto o PDF.`
            );
            return;
        }
        
        // Step 3b: Validate registration number consistency
        const registrationCheck = await validateRegistrationNumberConsistency(remitente, parsed.registrationNumber);
        
        if (!registrationCheck.isValid && registrationCheck.existingRegistration) {
            await enviarMensajeHumano(
                chat,
                `⚠️ *Número de registro no coincide*\n\n` +
                `Esta cuenta de WhatsApp está vinculada al registro: *${registrationCheck.existingRegistration}*\n\n` +
                `La boleta que enviaste tiene el registro: *${parsed.registrationNumber}*\n\n` +
                `❌ No puedes inscribir materias de otra persona.\n\n` +
                `Si cambiaste de número de registro, contacta al administrador.`
            );
            logger.warn('Registration number mismatch - enrollment blocked', {
                whatsappId: remitente,
                existingRegistration: registrationCheck.existingRegistration,
                attemptedRegistration: parsed.registrationNumber
            });
            return;
        }
        
        // Step 4: Validate subject limit
        const currentCount = await getStudentSubjectCount(remitente);
        
        // Get already added subjects early for validation
        const addedSubjects = await getStudentAddedSubjects(remitente);
        const comparison = compareSubjects(parsed.subjects, addedSubjects);
        const newSubjectsCount = comparison.newSubjects.length;
        const totalAfterAdd = currentCount + newSubjectsCount;
        
        if (totalAfterAdd > MAX_SUBJECTS_PER_USER) {
            const remainingSlots = MAX_SUBJECTS_PER_USER - currentCount;
            
            await enviarMensajeHumano(
                chat,
                `⚠️ *Límite de materias excedido*\n\n` +
                `Ya tienes *${currentCount} materias* inscritas.\n` +
                `Solo puedes agregar *${remainingSlots} materias más* (máximo ${MAX_SUBJECTS_PER_USER} total).\n\n` +
                `Tu boleta tiene *${newSubjectsCount} materias*.\n\n` +
                `Por favor envía una nueva boleta con solo las materias que deseas inscribir.`
            );
            return;
        }
        
        // Step 5: Map subjects to groups
        const mappedSubjects = await mapSubjectsToGroups(parsed.subjects);
        const unmappedCount = mappedSubjects.filter(s => !s.canAdd).length;
        
        // Step 5b: Re-filter with mapped subjects (some may not have groups)
        const mappedComparison = compareSubjects(
            mappedSubjects.filter(s => s.canAdd),
            addedSubjects
        );
        
        // Si todas las materias ya están agregadas
        if (mappedComparison.newSubjects.length === 0 && mappedComparison.duplicateSubjects.length > 0) {
            let duplicateMsg = `ℹ️ *Boleta ya procesada*\n\n` +
                `Ya estás inscrito en todas las materias de esta boleta:\n\n`;
            
            for (const s of mappedComparison.duplicateSubjects) {
                duplicateMsg += `✅ ${s.sigla} - Grupo ${s.grupo}\n`;
            }
            
            duplicateMsg += `\n💡 Si tienes nuevas materias, envía tu boleta actualizada.`;
            
            await enviarMensajeHumano(chat, duplicateMsg);
            
            logger.info('All subjects already added - skipping', {
                whatsappId: remitente,
                duplicateCount: mappedComparison.duplicateSubjects.length
            });
            return;
        }
        
        // Actualizar mappedSubjects para solo incluir las nuevas
        const finalSubjects = mappedSubjects.map(s => {
            const isDuplicate = mappedComparison.duplicateSubjects.some(
                d => d.sigla === s.sigla && d.grupo === s.grupo
            );
            return {
                ...s,
                isAlreadyAdded: isDuplicate
            };
        });
        
        // Step 6: Save to database
        const student = await upsertStudent(
            parsed.registrationNumber,
            parsed.studentName,
            remitente
        );
        
        const documentId = await insertDocument(
            student.id,
            docHash,
            ocrText,
            parsed,
            message.id._serialized
        );
        
        // Insert subjects (create boleta_grupo entries - only new ones)
        for (const subject of finalSubjects) {
            if (subject.grupoMateriaId && !subject.isAlreadyAdded) {
                await insertSubject(documentId, subject.grupoMateriaId);
            }
        }
        
        // Step 7: Show confirmation message
        const newCount = mappedComparison.newSubjects.length;
        const duplicateCount = mappedComparison.duplicateSubjects.length;
        
        let confirmMsg = 
            `✅ *Documento procesado*\n\n` +
            `*Estudiante:* ${parsed.studentName}\n` +
            `*Registro:* ${parsed.registrationNumber}\n` +
            `*Materias actuales:* ${currentCount}/${MAX_SUBJECTS_PER_USER}\n`;
        
        if (newCount > 0) {
            confirmMsg += `*Nuevas materias:* ${newCount}\n`;
        }
        
        if (duplicateCount > 0) {
            confirmMsg += `*Ya inscritas:* ${duplicateCount}\n`;
        }
        
        confirmMsg += `\n*Materias detectadas:*\n`;
        
        for (const s of finalSubjects) {
            let icon;
            if (s.isAlreadyAdded) {
                icon = '✓'; // Ya agregada (no se procesará)
            } else if (s.canAdd) {
                icon = '✅'; // Nueva (se procesará)
            } else {
                icon = '⚠️'; // Sin grupo configurado
            }
            confirmMsg += `${icon} ${s.sigla} - Grupo ${s.grupo}\n    _${s.materia}_\n`;
        }
        
        if (unmappedCount > 0) {
            confirmMsg += 
                `\n⚠️ *${unmappedCount} materia(s) no tienen grupo de WhatsApp configurado.*\n`;
        }
        
        if (duplicateCount > 0) {
            confirmMsg += 
                `\nℹ️ Las materias marcadas con ✓ ya fueron procesadas anteriormente.\n`;
        }
        
        const validSubjectsCount = newCount;
        if (validSubjectsCount > 0) {
            confirmMsg += 
                `\n💬 Responde *"LISTO"* para confirmar e inscribirte automáticamente a ${validSubjectsCount} grupo(s) nuevo(s).`;
        } else {
            confirmMsg += 
                `\n❌ No hay materias nuevas para procesar.`;
        }
        
        await enviarMensajeHumano(chat, confirmMsg);
        
        logger.info('Document processed successfully', {
            documentId,
            registrationNumber: parsed.registrationNumber,
            subjectsCount: newSubjectsCount,
            mappedCount: validSubjectsCount
        });
        
    } catch (error) {
        logger.error('Error processing document', { 
            error: error.message,
            from: remitente 
        });
        
        // Check if it's a duplicate registration number error
        if (error.message && error.message.includes('estudiantes_numero_registro_key')) {
            const registrationNumber = parsed?.registrationNumber || 'desconocido';
            await enviarMensajeHumano(
                chat,
                `⚠️ *Número de registro ya existe*\n\n` +
                `El número de registro *${registrationNumber}* ya está asociado a otro número de WhatsApp.\n\n` +
                `Si este es tu número de registro y cambiaste de número de WhatsApp, contacta al administrador para actualizar tus datos.`
            );
            return;
        }
        
        await enviarMensajeHumano(
            chat,
            `❌ Ocurrió un error al procesar tu documento.\n\n` +
            `Por favor, intenta nuevamente más tarde.`
        );
    }
}

/**
 * Handle user confirmation ("LISTO")
 * @param {object} client - WhatsApp client
 * @param {object} message - WhatsApp message object
 * @param {string} remitente - User WhatsApp ID
 * @param {function} agregarAGrupo - Function to add user to group (from index.js)
 */
export async function handleConfirmation(client, message, remitente, agregarAGrupo) {
    const chat = await message.getChat();
    
    try {
        logger.info('Confirmation received', { from: remitente });
        
        // Initial delay
        await randomDelay(DELAYS.RESPUESTA_INICIAL[0], DELAYS.RESPUESTA_INICIAL[1]);
        
        const pendingDoc = await getPendingDocument(remitente);
        
        if (!pendingDoc) {
            await enviarMensajeHumano(
                chat, 
                `ℹ️ No tienes inscripciones pendientes.\n\n` +
                `Envía tu boleta de inscripción para comenzar.`
            );
            return;
        }
        
        // Check expiration (10 minutes)
        const createdAt = new Date(pendingDoc.creado_en);
        const now = new Date();
        const minutesElapsed = (now - createdAt) / (1000 * 60);
        
        if (minutesElapsed > 10) {
            await updateDocumentStatus(pendingDoc.id, 'expirado');
            await enviarMensajeHumano(
                chat,
                `⏱️ *Tiempo expirado*\n\n` +
                `Tu solicitud expiró (más de 10 minutos).\n` +
                `Por favor envía tu boleta nuevamente.`
            );
            return;
        }
        
        // Update status
        await updateDocumentStatus(pendingDoc.id, 'confirmado');
        await updateDocumentStatus(pendingDoc.id, 'procesando');
        
        // Get subjects to add
        const subjects = await getSubjectsForDocument(pendingDoc.id);
        const toAdd = subjects.filter(s => s.jid_grupo && s.estado_agregado === 'pendiente');
        
        if (toAdd.length === 0) {
            await updateDocumentStatus(pendingDoc.id, 'fallido');
            await enviarMensajeHumano(
                chat,
                `❌ No hay materias pendientes para agregar.`
            );
            return;
        }

        // Inicializar progreso del documento en queue manager
        initDocument(pendingDoc.id, toAdd.length);

        // Agregar trabajos a la cola (no esperar procesamiento)
        for (const subject of toAdd) {
            addJob({
                userId: remitente,
                groupJid: subject.jid_grupo,
                subjectId: subject.id,
                documentId: pendingDoc.id,
                materiaNombre: `${subject.sigla} - Grupo ${subject.grupo}`
            });
        }

        // No enviar mensaje inmediato - el usuario recibirá la notificación cuando termine
        // (El sistema de colas enviará "Proceso completado" o "Procesando..." según corresponda)
        
        logger.info('Enrollment confirmation completed, jobs queued', {
            documentId: pendingDoc.id,
            userId: remitente,
            jobsQueued: toAdd.length
        });
        
    } catch (error) {
        logger.error('Error confirming enrollment', { 
            error: error.message,
            from: remitente 
        });
        
        await enviarMensajeHumano(
            chat,
            `❌ Ocurrió un error al procesar tu confirmación.\n\n` +
            `Intenta nuevamente escribiendo "LISTO".`
        );
    }
}

/**
 * Process a boleta received from DTIC: persist student, document and subjects, and send confirmation message
 * @param {object} remoteBoleta - object returned by DTIC
 * @param {string} remitente - whatsapp id
 * @param {string} token - code token
 * @param {object} message - original WhatsApp message
 */
export async function processRemoteBoleta(remoteBoleta, remitente, token, message) {
    const chat = await message.getChat();

    try {
        // Normalize remote boleta fields (support a few shapes)
        const estudiante = remoteBoleta.estudiante || (
            remoteBoleta.Estudiante || {
                registro: remoteBoleta.Nro_registro || remoteBoleta.numero_registro,
                nombre: remoteBoleta.Nombre || remoteBoleta.nombre
            }
        );

        const registro = estudiante?.registro || estudiante?.numero_registro || remoteBoleta.Nro_registro || null;
        const nombre = estudiante?.nombre || estudiante?.Nombre || remoteBoleta.Nombre || 'ESTUDIANTE';

        // Upsert student
        const student = await upsertStudent(registro, nombre, remitente);

        // Create document record. Use token as documento_hash for traceability
        const documentId = await insertDocument(
            student.id,
            token,
            JSON.stringify(remoteBoleta),
            remoteBoleta,
            message.id?._serialized || message.id
        );

        // Prepare subjects list
        let materias = remoteBoleta.Materias || remoteBoleta.materias || remoteBoleta.materias || [];
        // If materias are objects, normalize to strings
        materias = materias.map(m => {
            if (typeof m === 'string') return m;
            if (m.sigla && m.grupo) return `${m.sigla}-${m.grupo}`;
            if (m.codigo_materia && m.codigo_grupo) return `${m.codigo_materia}-${m.codigo_grupo}`;
            return String(m);
        });

        const subjectObjs = materias.map(item => {
            const parts = item.split('-');
            return { sigla: (parts[0]||'').trim(), grupo: (parts[1]||'').trim(), materia: null };
        });

        // Map to grupo_materia entries
        const mapped = await mapSubjectsToGroups(subjectObjs);

        // Insert boleta_grupo for each mapped subject
        let inserted = 0;
        for (const s of mapped) {
            if (s.grupoMateriaId) {
                await insertSubject(documentId, s.grupoMateriaId);
                inserted++;
            }
        }

        // Send confirmation message to user (keep confirmation flow)
        let confirmMsg = `*Boleta obtenida correctamente*\n\n` +
            `*Estudiante:* ${nombre}\n` +
            `*Registro:* ${registro}\n` +
            `*Materias detectadas:* ${inserted}\n\n` +
            `Por favor agrega este número a tus contactos para que pueda agregarte automáticamente a los grupos.\n\n` +
            `💬 Responde *"LISTO"* para confirmar e inscribirte automáticamente.`;

        await enviarMensajeHumano(chat, confirmMsg);

        logger.info('processRemoteBoleta completed', { documentId, registro, inserted });

        return { documentId };

    } catch (error) {
        logger.error('Error processing remote boleta', { error: error.message, remitente, token });
        await enviarMensajeHumano(await message.getChat(), `❌ Error procesando la boleta. Intenta nuevamente más tarde.`);
        throw error;
    }
}

/**
 * Handle incoming token message: validate, reserve token atomically, fetch DTIC and persist boleta
 * @param {string} token
 * @param {object} client
 * @param {object} message
 */
export async function handleTokenMessage(token, client, message) {
    const chat = await message.getChat();
    const remitente = message.from;

    try {
        await enviarMensajeHumano(chat, '🔗 Validando tu código, un momento...');

        // Quick local check
        const used = await isTokenUsed(token);
        if (used) {
            await enviarMensajeHumano(chat, '⚠️ Este código ya fue utilizado anteriormente. Si crees que es un error, contacta con soporte.');
            return;
        }

        // Fetch from DTIC
        const remoteBoleta = await fetchBoletaFromDTIC(token);
        if (!remoteBoleta) {
            await enviarMensajeHumano(chat, '❌ Código no válido o no encontrado en DTIC.');
            return;
        }

        // Try to atomically reserve the token
        const reserved = await markTokenUsed(token, remoteBoleta.id || null, remitente);
        if (!reserved) {
            await enviarMensajeHumano(chat, '⚠️ Este código ya fue utilizado anteriormente.');
            return;
        }

        // Persist boleta and create subjects, then ask for confirmation
        await processRemoteBoleta(remoteBoleta, remitente, token, message);

    } catch (error) {
        logger.error('handleTokenMessage error', { error: error.message, token });
        await enviarMensajeHumano(chat, '❌ Ocurrió un error validando el código. Intenta nuevamente.');
    }
}

export default {
    handleDocumentUpload,
    handleConfirmation,
    handleTokenMessage,
    processRemoteBoleta
};
