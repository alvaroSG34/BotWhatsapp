import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { COMANDOS, DELAYS, MENSAJES } from './config.js';
import { logger } from './logger.js';
import { handleDocumentUpload, handleConfirmation, handleTokenMessage } from './enrollmentHandler.js';
import { randomDelay, enviarMensajeHumano, delayFromRange } from './antibanHelpers.js';
import { startExpirationCleaner } from './cleanupTasks.js';
import { normalizeForComparison } from './parser.js';
import { startPanelIntegration, stopPanelIntegration } from './panelIntegration.js';
import { startJobWorker, startNotificationWorker, stopWorkers } from './queueWorker.js';
import { queueManager, addNotification } from './queueManager.js';
import startAdminApi from './adminApi.js';

/**
 * Timestamp de inicio del bot (para ignorar mensajes históricos)
 * Se establece cuando el cliente está listo
 */
let botStartTimestamp = null;

/**
 * Margen de tolerancia en segundos para mensajes recibidos durante el inicio
 * Permite procesar mensajes enviados hasta 30 segundos antes de que el bot esté listo
 */
const MESSAGE_TOLERANCE_SECONDS = 30;

/**
 * Normaliza texto para comparación (backward compatibility)
 */
const normalizar = (texto) => normalizeForComparison(texto);

/**
 * Intenta agregar usuario a un grupo con whatsapp-web.js
 * Usa delays aleatorios y manejo de errores mejorado
 */
const agregarAGrupo = async (client, grupoJid, usuarioNumero, materiaNombre) => {
    try {
        logger.info('Attempting to add user to group', {
            userId: usuarioNumero,
            groupJid: grupoJid,
            groupName: materiaNombre
        });
        
        // Obtener el chat del grupo
        const grupoChat = await client.getChatById(grupoJid);
        
        // whatsapp-web.js: usar addParticipants (con S al final)
        const resultado = await grupoChat.addParticipants([usuarioNumero]);
        
        logger.debug('addParticipants result', { resultado });
        
        // Verificar si realmente fue agregado
        if (resultado && resultado[usuarioNumero]) {
            const status = resultado[usuarioNumero];
            logger.info('User addition status', {
                userId: usuarioNumero,
                statusCode: status.code,
                statusMessage: status.message
            });
            
            // Códigos de éxito: 200, 201, 202
            if (status.code === 200 || status.code === 201 || status.code === 202) {
                logger.info('User added successfully to group', {
                    userId: usuarioNumero,
                    groupName: materiaNombre
                });
                return { exito: true, materia: materiaNombre };
            } else {
                logger.warn('WhatsApp rejected addition', {
                    statusCode: status.code,
                    statusMessage: status.message
                });
                throw new Error(`WhatsApp rechazó: ${status.code} - ${status.message || 'Sin mensaje'}`);
            }
        } else {
            logger.warn('No confirmation received from WhatsApp');
            throw new Error('Sin respuesta de WhatsApp');
        }
        
    } catch (error) {
        logger.error('Error adding user to group', {
            error: error.message,
            userId: usuarioNumero,
            groupName: materiaNombre
        });
        
        // Detectar el código de error para mensajes personalizados
        const errorCode = error.message.match(/código: (\d+)/)?.[1];
        let mensajePersonalizado = `⚠️ No pude agregarte automáticamente a *${materiaNombre}*.`;
        
        if (errorCode === '408' || error.message.includes('recently left')) {
            mensajePersonalizado = `⚠️ *No puedo agregarte a ${materiaNombre}*\n\n` +
                `WhatsApp no permite que te agregue porque saliste del grupo recientemente. ` +
                `Por políticas de WhatsApp, debes esperar unas horas antes de volver a intentarlo.`;
        } else if (errorCode === '403') {
            mensajePersonalizado = `⚠️ *No puedo agregarte a ${materiaNombre}*\n\n` +
                `Parece que no me tienes guardado en tus contactos. ` +
                `Asegúrate de agregarme y vuelve a intentar.`;
        } else if (errorCode === '409') {
            mensajePersonalizado = `ℹ️ Ya estás en el grupo *${materiaNombre}*.`;
        } else {
            mensajePersonalizado = `⚠️ *No pude agregarte a ${materiaNombre}*\n\n` +
                `Ocurrió un error al intentar agregarte. Por favor, intenta nuevamente más tarde.`;
        }
        
        // Enviar mensaje explicativo sin enlace usando helper humano
        try {
            const userChat = await client.getChatById(usuarioNumero);
            await enviarMensajeHumano(userChat, mensajePersonalizado);
            
            logger.info('Error message sent to user', {
                userId: usuarioNumero,
                groupName: materiaNombre
            });
            return { exito: false, materia: materiaNombre };
        } catch (msgError) {
            logger.error('Failed to send error message', {
                error: msgError.message,
                userId: usuarioNumero
            });
            return { exito: false, materia: materiaNombre };
        }
    }
};

/**
 * Maneja mensajes entrantes con whatsapp-web.js
 */
const manejarMensaje = async (client, message) => {
    try {
        const chat = await message.getChat();
        
        // Ignorar mensajes de grupos y mensajes propios
        if (chat.isGroup || message.fromMe) return;
        
        const remitente = message.from; // ID del usuario
        
        // FILTRO DE MENSAJES HISTÓRICOS: Ignorar mensajes anteriores al inicio del bot
        // Esto evita procesar mensajes sincronizados cuando el bot se conecta en un nuevo servidor
        if (botStartTimestamp) {
            const messageTimestamp = message.timestamp * 1000; // WhatsApp usa segundos, convertir a ms
            const toleranceMs = MESSAGE_TOLERANCE_SECONDS * 1000;
            const cutoffTimestamp = botStartTimestamp - toleranceMs;
            
            if (messageTimestamp < cutoffTimestamp) {
                logger.debug('Ignoring historical message', {
                    from: remitente,
                    messageTime: new Date(messageTimestamp).toISOString(),
                    botStartTime: new Date(botStartTimestamp).toISOString(),
                    ageSeconds: Math.round((botStartTimestamp - messageTimestamp) / 1000)
                });
                return;
            }
        }
        
        logger.info('Message received', {
            from: remitente,
            hasMedia: message.hasMedia,
            type: message.type
        });
        
        // Random initial delay (anti-ban protocol)
        await randomDelay(DELAYS.RESPUESTA_INICIAL[0], DELAYS.RESPUESTA_INICIAL[1]);
        
        // PRIORITY 1: Handle document uploads (PDF or images)
        if (message.hasMedia) {
            try {
                const media = await message.downloadMedia();
                
                // Check if it's a document or image
                if (media.mimetype.startsWith('image/') || media.mimetype === 'application/pdf') {
                    logger.info('Document detected, processing', {
                        from: remitente,
                        mimeType: media.mimetype
                    });
                    
                    await handleDocumentUpload(client, message, media);
                    return;
                }
            } catch (error) {
                logger.error('Error downloading media', {
                    error: error.message,
                    from: remitente
                });
            }
        }
        
        // PRIORITY 2: Handle text messages
        const texto = message.body;
        if (!texto) return;
        
        const textoNormalizado = normalizar(texto);
        
        logger.info('Text message received', {
            from: remitente,
            text: texto
        });
        
        // Detect CODE token messages (QR scans typically send: "CODE: {token}")
        const tokenMatch = texto.match(/CODE[:\s]*([A-Za-z0-9\-_]{16,})/i) || texto.match(/\b([0-9a-fA-F]{8}-[0-9a-fA-F\-]{20,})\b/);
        if (tokenMatch) {
            const token = tokenMatch[1];
            logger.info('Token message detected', { from: remitente, tokenPreview: token.slice(0,8) });
            await handleTokenMessage(token, client, message);
            return;
        }

        // Check if user has pending confirmation
        // Handle "LISTO" / "CONFIRMAR" for document confirmation
        if (COMANDOS.CONFIRMAR.some(cmd => textoNormalizado === cmd)) {
            logger.info('Confirmation command received', { from: remitente });
            await handleConfirmation(client, message, remitente, agregarAGrupo);
            return;
        }
        
        // Comando: MENU/AYUDA
        if (COMANDOS.MENU.some(cmd => textoNormalizado.includes(cmd))) {
            logger.info('Menu command received', { from: remitente });
            await enviarMensajeHumano(chat, MENSAJES.BIENVENIDA);
            return;
        }
        
        // Default: Show instructions
        logger.info('Unrecognized message, sending instructions', { from: remitente });
        await enviarMensajeHumano(
            chat,
            `📸 *Bienvenido al Bot de Inscripción*\n\n` +
            `Por favor entra a la plataforma y escanea el código QR de tu boleta para que la procese.\n\n`
        );
        
    } catch (error) {
        logger.error('Error handling message', {
            error: error.message,
            stack: error.stack
        });
        await delayFromRange(DELAYS.DESPUES_ERROR);
    }
};

/**
 * Inicia el bot de WhatsApp con whatsapp-web.js
 */
const iniciarBot = async () => {
    logger.info('Starting WhatsApp bot');
    console.log('🚀 Iniciando bot de WhatsApp con OCR...\n');
    
    // Crear cliente con autenticación local
    const client = new Client({
        authStrategy: new LocalAuth({
            dataPath: process.env.BOT_USER_DATA_DIR || './auth_info'
        }),
        webVersionCache: {
            type: 'none'
        },
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        }
    });
    
    // Event: QR Code
    client.on('qr', (qr) => {
        console.log('📱 Escanea este código QR con WhatsApp:\n');
        qrcode.generate(qr, { small: true });
        console.log('\n⏳ Esperando escaneo del código QR...');
        console.log('💡 WhatsApp → Menú (⋮) → Dispositivos vinculados → Vincular dispositivo\n');
    });
    
    // Event: Estado de carga
    client.on('loading_screen', (percent, message) => {
        console.log(`🔄 Cargando: ${percent}% - ${message}`);
    });
    
    // Event: Autenticación exitosa
    client.on('authenticated', () => {
        logger.info('WhatsApp authenticated successfully');
        console.log('✅ Autenticación exitosa! Esperando que el cliente esté listo...');
    });
    
    // Event: Cliente listo
    client.on('ready', async () => {
        // Establecer timestamp de inicio ANTES de cualquier otra cosa
        // Esto es crítico para filtrar mensajes históricos sincronizados
        botStartTimestamp = Date.now();
        logger.info('WhatsApp client ready', { 
            botStartTimestamp: new Date(botStartTimestamp).toISOString(),
            toleranceSeconds: MESSAGE_TOLERANCE_SECONDS
        });
        console.log('\n✅ Bot listo para recibir documentos!\n');
        console.log('📸 Los usuarios deben enviar su boleta de inscripción (foto o PDF).\n');
        console.log(`⏱️  Ignorando mensajes anteriores a: ${new Date(botStartTimestamp - MESSAGE_TOLERANCE_SECONDS * 1000).toLocaleTimeString()}\n`);
        
        // Start cleanup task for expired documents
        startExpirationCleaner();
        logger.info('Expiration cleaner started');
        
        // Iniciar integración con panel de administración
        await startPanelIntegration(client);
        logger.info('Panel integration started');

        // Iniciar workers de cola
        startJobWorker(client, agregarAGrupo).catch(err => {
            logger.error('Job worker fatal error', { error: err.message });
        });
        
        startNotificationWorker(client).catch(err => {
            logger.error('Notification worker fatal error', { error: err.message });
        });

            // Iniciar API administrativa para crear grupos
            try {
                startAdminApi(client);
                logger.info('Admin API started');
            } catch (apiErr) {
                logger.error('Failed to start Admin API', { error: apiErr.message });
            }
        
        logger.info('Queue workers started');
        console.log('🔄 Sistema de colas iniciado\n');

        // Listener para documentos completados
        queueManager.on('document:ready-to-notify', async ({ documentId, results, userId }) => {
            try {
                const chat = await client.getChatById(userId);

                const successes = results.filter(r => r.success);
                const failures = results.filter(r => !r.success);

                // Build a human-friendly summary message
                let message = `✅ Inscripción procesada\n\n`;
                message += `Materias intentadas: ${results.length}\n`;
                message += `✅ Agregadas: ${successes.length}\n`;
                message += `❌ Falladas: ${failures.length}\n\n`;

                if (successes.length > 0) {
                    message += `Materias añadidas:\n` + successes.map(s => `- ${s.materiaNombre}`).join('\n') + '\n\n';
                }

                if (failures.length > 0) {
                    message += `No se pudieron agregar:\n` + failures.map(f => `- ${f.materiaNombre} — ${f.message || 'Error desconocido'}`).join('\n') + '\n\n';
                    message += `Si necesitas ayuda, responde "AYUDA" o contacta al administrador.`;
                }

                addNotification({ userId, message, chat });

                logger.info('Document completion notification queued', {
                    documentId,
                    userId,
                    successCount: successes.length,
                    failedCount: failures.length
                });
            } catch (error) {
                logger.warn('Failed to get chat for notification', {
                    userId,
                    documentId,
                    error: error.message
                });
            }
        });

        // Listener para documentos fallidos
        queueManager.on('document:failed', async ({ documentId, results, userId }) => {
            try {
                const chat = await client.getChatById(userId);
                const successes = results.filter(r => r.success);
                const failures = results.filter(r => !r.success);

                let message = `❌ Inscripción incompleta\n\n`;
                message += `Se intentaron ${results.length} materia(s).\n`;
                message += `✅ Agregadas: ${successes.length}\n`;
                message += `❌ Falladas: ${failures.length}\n\n`;

                if (successes.length > 0) {
                    message += `Materias añadidas:\n` + successes.map(s => `- ${s.materiaNombre}`).join('\n') + '\n\n';
                }

                if (failures.length > 0) {
                    message += `No se pudieron agregar:\n` + failures.map(f => `- ${f.materiaNombre} — ${f.message || 'Error desconocido'}`).join('\n') + '\n\n';
                    message += `Por favor intenta de nuevo más tarde o contacta al administrador si el problema persiste.`;
                }

                addNotification({ userId, message, chat });

                logger.warn('Document failed notification queued', { documentId, userId, failedCount: failures.length });
            } catch (error) {
                logger.warn('Failed to get chat for failure notification', {
                    userId,
                    documentId,
                    error: error.message
                });
            }
        });
        
        // Parchear sendSeen para evitar el bug de markedUnread
        try {
            await client.pupPage.evaluate(() => {
                window.WWebJS = window.WWebJS || {};
                window.WWebJS.sendSeen = async () => { 
                    // No hacer nada - desactivado para evitar bugs
                    return true; 
                };
            });
            console.log('🔧 sendSeen desactivado para evitar errores\n');
        } catch (e) {
            logger.warn('Could not patch sendSeen', { error: e.message });
            console.log('⚠️ No se pudo parchear sendSeen, continuando...\n');
        }
        
        // Obtener y mostrar todos los grupos
        try {
            console.log('🔍 Obteniendo lista de grupos...\n');
            const chats = await client.getChats();
            const grupos = chats.filter(chat => chat.isGroup);
            
            if (grupos.length === 0) {
                logger.warn('No groups found');
                console.log('⚠️ No se encontraron grupos. Asegúrate de que el bot esté en al menos un grupo.\n');
            } else {
                logger.info('Groups found', { count: grupos.length });
                console.log(`📋 GRUPOS DISPONIBLES (${grupos.length}):\n`);
                console.log('═'.repeat(80));
                
                for (let i = 0; i < grupos.length; i++) {
                    const grupo = grupos[i];
                    console.log(`${i + 1}. ${grupo.name}`);
                    console.log(`   JID: ${grupo.id._serialized}`);
                    console.log(`   Participantes: ${grupo.participants.length}`);
                    console.log('─'.repeat(80));
                }
                
                console.log('\n✅ El bot está listo para agregar usuarios a estos grupos.');
                console.log('💡 Configura los mapeos SIGLA+GRUPO en la base de datos.\n');
                console.log('🔍 Ejecuta "npm run discover-groups" para ayuda con el mapeo.\n');
            }
        } catch (error) {
            logger.error('Error fetching groups', { error: error.message });
            console.error('❌ Error obteniendo grupos:', error.message);
        }
        
        console.log('🎯 ¡Todo listo! Los usuarios pueden enviar su boleta de inscripción.\n');
        
        // Iniciar integración con panel de administración
        await startPanelIntegration(client);
    });
    
    // Event: Mensaje recibido
    client.on('message', async (message) => {
        await manejarMensaje(client, message);
    });
    
    // Event: Desconexión
    client.on('disconnected', async (reason) => {
        logger.error('WhatsApp client disconnected', { reason });
        console.log('❌ Cliente desconectado:', reason);
        
        // Detener workers antes de reiniciar
        await stopWorkers().catch(err => {
            logger.error('Error stopping workers', { error: err.message });
        });
        
        // Detener integración con panel
        await stopPanelIntegration(client);
        
        console.log('🔄 Reiniciando...\n');
        iniciarBot();
    });
    
    // Event: Error de autenticación
    client.on('auth_failure', (msg) => {
        logger.error('WhatsApp authentication failed', { message: msg });
        console.error('❌ Error de autenticación:', msg);
        console.log('💡 Elimina la carpeta auth_info y vuelve a intentar.\n');
    });
    
    // Event: Cambio de estado
    client.on('change_state', (state) => {
        logger.debug('WhatsApp state changed', { state });
    });
    
    // Inicializar cliente
    console.log('⚙️ Inicializando cliente...\n');
    await client.initialize();
};

// Graceful shutdown handler
process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully...');
    console.log('\n🛑 Deteniendo bot...\n');
    
    try {
        await stopWorkers();
        logger.info('Workers stopped, destroying client...');
        console.log('✅ Workers detenidos\n');
        process.exit(0);
    } catch (error) {
        logger.error('Shutdown timeout exceeded', { error: error.message });
        console.error('❌ Timeout al detener workers\n');
        process.exit(1);
    }
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (error) => {
    logger.error('Unhandled rejection', { error: error.message, stack: error.stack });
    console.error('❌ Promesa rechazada:', error);
});

// Iniciar el bot
iniciarBot().catch((error) => {
    logger.error('Fatal error starting bot', { error: error.message, stack: error.stack });
    console.error('❌ Error fatal al iniciar:', error);
    process.exit(1);
});
