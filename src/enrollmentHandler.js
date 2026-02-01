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
    getStudentSubjectCount
} from './database.js';
import { mapSubjectsToGroups } from './groupMapper.js';
import { randomDelay, enviarMensajeHumano, delayFromRange } from './antibanHelpers.js';
import { logger } from './logger.js';
import { MAX_SUBJECTS_PER_USER, DELAYS } from './config.js';

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
        
        // Step 1: Calculate hash for duplicate detection
        const buffer = Buffer.from(media.data, 'base64');
        const docHash = calculateDocumentHash(buffer);
        
        const duplicate = await findDocumentByHash(docHash);
        if (duplicate) {
            await enviarMensajeHumano(
                chat,
                `⚠️ *Documento duplicado*\n\n` +
                `Ya procesaste este documento el ${new Date(duplicate.creado_en).toLocaleDateString()}.\n` +
                `Estado: ${duplicate.estado}`
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
        
        // Step 4: Validate subject limit
        const currentCount = await getStudentSubjectCount(remitente);
        const newSubjectsCount = parsed.subjects.length;
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
        
        // Insert subjects (create boleta_grupo entries)
        for (const subject of mappedSubjects) {
            if (subject.grupoMateriaId) {
                await insertSubject(documentId, subject.grupoMateriaId);
            }
        }
        
        // Step 7: Show confirmation message
        let confirmMsg = 
            `✅ *Documento procesado*\n\n` +
            `*Estudiante:* ${parsed.studentName}\n` +
            `*Registro:* ${parsed.registrationNumber}\n` +
            `*Materias actuales:* ${currentCount}/${MAX_SUBJECTS_PER_USER}\n` +
            `*Nuevas materias:* ${newSubjectsCount}\n\n` +
            `*Materias detectadas:*\n`;
        
        for (const s of mappedSubjects) {
            const icon = s.canAdd ? '✅' : '⚠️';
            confirmMsg += `${icon} ${s.sigla} - Grupo ${s.grupo}\n    _${s.materia}_\n`;
        }
        
        if (unmappedCount > 0) {
            confirmMsg += 
                `\n⚠️ *${unmappedCount} materia(s) no tienen grupo de WhatsApp configurado.*\n` +
                `Solo se procesarán las materias marcadas con ✅\n`;
        }
        
        const validSubjectsCount = mappedSubjects.filter(s => s.canAdd).length;
        if (validSubjectsCount > 0) {
            confirmMsg += 
                `\n💬 Responde *"LISTO"* para confirmar e inscribirte automáticamente a ${validSubjectsCount} grupo(s).`;
        } else {
            confirmMsg += 
                `\n❌ No hay materias con grupos configurados. Contacta al administrador.`;
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
        
        await enviarMensajeHumano(chat, `🔄 Procesando tu inscripción...\n\nEsto puede tomar unos minutos.`);
        
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
        
        const results = { success: [], failed: [] };
        
        // Add to groups one by one with delays
        for (const subject of toAdd) {
            // Random delay between additions (anti-ban)
            await delayFromRange(DELAYS.ENTRE_ADICIONES);
            
            const materiaNombre = `${subject.sigla} - Grupo ${subject.grupo}`;
            
            try {
                const result = await agregarAGrupo(
                    client,
                    subject.jid_grupo,
                    remitente,
                    materiaNombre
                );
                
                if (result.exito) {
                    await markSubjectAdded(subject.id);
                    results.success.push(subject);
                    
                    logger.info('Subject added successfully', {
                        subjectId: subject.id,
                        sigla: subject.sigla,
                        grupo: subject.grupo,
                        userId: remitente
                    });
                } else {
                    await markSubjectFailed(subject.id, result.mensaje || 'Error desconocido');
                    results.failed.push(subject);
                    
                    logger.warn('Subject addition failed', {
                        subjectId: subject.id,
                        sigla: subject.sigla,
                        grupo: subject.grupo,
                        userId: remitente,
                        error: result.mensaje
                    });
                }
            } catch (error) {
                await markSubjectFailed(subject.id, error.message);
                results.failed.push(subject);
                
                logger.error('Error adding subject', {
                    error: error.message,
                    subjectId: subject.id,
                    sigla: subject.sigla,
                    userId: remitente
                });
            }
        }
        
        // NOTE: No need to call incrementStudentSubjectCount()
        // The trigger actualizar_total_materias_estudiante() handles it automatically
        // when estado_agregado changes to 'agregado'
        
        // Update final status
        await updateDocumentStatus(pendingDoc.id, 'completado');
        
        // Send results
        let resultMsg = `*Inscripción completada!*\n\n`;
        
        if (results.success.length > 0) {
            resultMsg += `*✓ Agregado exitosamente (${results.success.length}):*\n`;
            for (const s of results.success) {
                resultMsg += `  • ${s.sigla} - Grupo ${s.grupo}\n`;
            }
        }
        
        if (results.failed.length > 0) {
            resultMsg += `\n*✗ No se pudo agregar (${results.failed.length}):*\n`;
            for (const s of results.failed) {
                resultMsg += `  • ${s.sigla} - Grupo ${s.grupo}\n`;
            }
            resultMsg += `\n_Intenta nuevamente más tarde si es necesario._`;
        }
        
        const newTotal = await getStudentSubjectCount(remitente);
        resultMsg += `\n\n📊 *Total de materias inscritas:* ${newTotal}/${MAX_SUBJECTS_PER_USER}`;
        
        await enviarMensajeHumano(chat, resultMsg);
        
        logger.info('Enrollment confirmation completed', {
            documentId: pendingDoc.id,
            userId: remitente,
            successCount: results.success.length,
            failedCount: results.failed.length
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

export default {
    handleDocumentUpload,
    handleConfirmation
};
