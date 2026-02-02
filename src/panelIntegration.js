import { logger } from './logger.js';
import { enviarMensajeHumano } from './antibanHelpers.js';
import os from 'os';

/**
 * Panel Integration Module
 * Maneja comunicación bidireccional entre el bot y el panel de administración
 */

const PANEL_BASE_URL = process.env.PANEL_URL || 'http://localhost:3000/api';
const BOT_USERNAME = process.env.PANEL_BOT_USER || 'bot-service';
const BOT_PASSWORD = process.env.PANEL_BOT_PASSWORD || '';
const HEARTBEAT_INTERVAL = 60 * 1000; // 1 minuto
const POLL_COMMANDS_INTERVAL = 10 * 1000; // 10 segundos
const STALE_COMMANDS_INTERVAL = 5 * 60 * 1000; // 5 minutos

let authToken = null;
let heartbeatTimer = null;
let pollCommandsTimer = null;
let reclaimStaleTimer = null;

/**
 * Realiza login en el panel y obtiene token JWT
 */
async function loginToPanel() {
    try {
        logger.info('Attempting login to panel', { 
            url: `${PANEL_BASE_URL}/auth/login`,
            username: BOT_USERNAME 
        });

        const response = await fetch(`${PANEL_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                username: BOT_USERNAME,
                password: BOT_PASSWORD,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Login failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        authToken = data.accessToken;
        
        logger.info('Successfully logged in to panel', { 
            username: data.user?.username,
            role: data.user?.role 
        });
        
        return true;
    } catch (error) {
        logger.error('Failed to login to panel', { 
            error: error.message,
            url: PANEL_BASE_URL 
        });
        return false;
    }
}

/**
 * Envía heartbeat al panel con estado actual del bot
 */
async function sendHeartbeat(client, status = 'CONNECTED') {
    if (!authToken) {
        logger.warn('No auth token, skipping heartbeat');
        return;
    }

    try {
        // Obtener lista de grupos actualizados
        const chats = await client.getChats();
        const grupos = chats.filter(chat => chat.isGroup);
        
        // Crear cache de grupos en formato esperado por el panel
        const gruposCache = {};
        for (const grupo of grupos) {
            gruposCache[grupo.id._serialized] = {
                name: grupo.name,
                subject: grupo.name, // whatsapp-web.js no expone 'subject' directamente
            };
        }

        const heartbeatData = {
            pid: process.pid,
            hostname: os.hostname(),
            estado_whatsapp: status,
            version_bot: process.env.npm_package_version || '1.0.0',
            grupos_cache: gruposCache,
        };

        logger.debug('Sending heartbeat to panel', { 
            pid: heartbeatData.pid,
            hostname: heartbeatData.hostname,
            status,
            totalGroups: Object.keys(gruposCache).length 
        });

        const response = await fetch(`${PANEL_BASE_URL}/bot/heartbeat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(heartbeatData),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Heartbeat failed: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        logger.debug('Heartbeat sent successfully', { 
            groupsUpdated: Object.keys(gruposCache).length 
        });

    } catch (error) {
        logger.error('Failed to send heartbeat', { error: error.message });
        
        // Si el error es de autenticación, intentar re-login
        if (error.message.includes('401') || error.message.includes('403')) {
            logger.info('Attempting to re-authenticate');
            await loginToPanel();
        }
    }
}

/**
 * Consulta comandos pendientes del panel
 */
async function pollAdminCommands(client) {
    if (!authToken) {
        logger.debug('No auth token, skipping command polling');
        return;
    }

    try {
        const response = await fetch(
            `${PANEL_BASE_URL}/admin-commands?estado=pendiente&limit=10`,
            {
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                },
            }
        );

        if (!response.ok) {
            if (response.status === 401) {
                logger.info('Token expired, re-authenticating');
                await loginToPanel();
            }
            return;
        }

        const data = await response.json();
        const comandos = data.items || [];

        if (comandos.length > 0) {
            logger.info('Pending commands found', { count: comandos.length });
            
            for (const comando of comandos) {
                await executeAdminCommand(client, comando);
            }
        }

    } catch (error) {
        logger.error('Failed to poll admin commands', { error: error.message });
    }
}

/**
 * Ejecuta un comando administrativo
 */
async function executeAdminCommand(client, comando) {
    const { id, tipo, parametros } = comando;
    
    logger.info('Executing admin command', { 
        commandId: id, 
        type: tipo,
        params: parametros 
    });

    try {
        // Marcar comando como "procesando"
        await updateCommandStatus(id, 'procesando');

        let resultado = null;
        let success = true;

        switch (tipo) {
            case 'retry_enrollment':
                resultado = await retryEnrollment(client, parametros);
                break;

            case 'refresh_groups':
                resultado = await refreshGroups(client);
                break;

            case 'restart_bot':
                resultado = await restartBot();
                break;

            default:
                throw new Error(`Unknown command type: ${tipo}`);
        }

        // Marcar como completado
        await updateCommandStatus(id, 'completado', resultado);
        logger.info('Admin command completed', { commandId: id, type: tipo });

    } catch (error) {
        logger.error('Failed to execute admin command', { 
            commandId: id,
            type: tipo,
            error: error.message 
        });

        // Marcar como fallido
        await updateCommandStatus(id, 'fallido', { 
            error: error.message,
            timestamp: new Date().toISOString() 
        });
    }
}

/**
 * Actualiza el estado de un comando en el panel
 */
async function updateCommandStatus(commandId, estado, resultado = null) {
    if (!authToken) return;

    try {
        const body = { estado };
        if (resultado !== null) {
            body.resultado = resultado;
        }

        const response = await fetch(
            `${PANEL_BASE_URL}/admin-commands/${commandId}`,
            {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to update command: ${response.status}`);
        }

        logger.debug('Command status updated', { commandId, estado });
    } catch (error) {
        logger.error('Failed to update command status', { 
            commandId, 
            error: error.message 
        });
    }
}

/**
 * Reintentar inscripción de un estudiante
 */
async function retryEnrollment(client, parametros) {
    const { registro, grupoJid, materiaNombre } = parametros;
    
    if (!registro || !grupoJid || !materiaNombre) {
        throw new Error('Missing required parameters: registro, grupoJid, materiaNombre');
    }

    logger.info('Retrying enrollment', { 
        registro, 
        grupoJid, 
        materiaNombre 
    });

    // Construir número de WhatsApp (formato internacional)
    const usuarioNumero = `591${registro}@c.us`;

    try {
        const grupoChat = await client.getChatById(grupoJid);
        const resultado = await grupoChat.addParticipants([usuarioNumero]);

        if (resultado && resultado[usuarioNumero]) {
            const status = resultado[usuarioNumero];
            
            if (status.code === 200 || status.code === 201 || status.code === 202) {
                logger.info('Retry enrollment successful', { 
                    registro, 
                    materiaNombre 
                });

                // Enviar confirmación al usuario
                const userChat = await client.getChatById(usuarioNumero);
                await enviarMensajeHumano(
                    userChat,
                    `✅ ¡Reinscripción exitosa!\n\nFuiste agregado a *${materiaNombre}*`
                );

                return {
                    success: true,
                    message: 'Usuario agregado exitosamente',
                    statusCode: status.code,
                };
            } else {
                throw new Error(`WhatsApp error: ${status.code} - ${status.message}`);
            }
        } else {
            throw new Error('No response from WhatsApp');
        }

    } catch (error) {
        logger.error('Retry enrollment failed', { 
            registro, 
            materiaNombre,
            error: error.message 
        });

        // Enviar mensaje de error al usuario
        try {
            const userChat = await client.getChatById(usuarioNumero);
            await enviarMensajeHumano(
                userChat,
                `⚠️ No pude agregarte a *${materiaNombre}*\n\n` +
                `Error: ${error.message}\n\n` +
                `Por favor, contacta al administrador.`
            );
        } catch (msgError) {
            logger.error('Failed to send error message to user', { error: msgError.message });
        }

        return {
            success: false,
            error: error.message,
        };
    }
}

/**
 * Actualizar cache de grupos en el panel
 */
async function refreshGroups(client) {
    logger.info('Refreshing groups cache');

    try {
        const chats = await client.getChats();
        const grupos = chats.filter(chat => chat.isGroup);

        const gruposInfo = grupos.map(grupo => ({
            jid: grupo.id._serialized,
            name: grupo.name,
            participants: grupo.participants.length,
        }));

        logger.info('Groups refreshed', { count: gruposInfo.length });

        // Enviar heartbeat actualizado inmediatamente
        await sendHeartbeat(client, 'CONNECTED');

        return {
            success: true,
            totalGroups: gruposInfo.length,
            groups: gruposInfo,
        };

    } catch (error) {
        logger.error('Failed to refresh groups', { error: error.message });
        return {
            success: false,
            error: error.message,
        };
    }
}

/**
 * Reiniciar el bot (exit gracefully, PM2/nodemon lo reiniciará)
 */
async function restartBot() {
    logger.warn('Bot restart requested via admin command');
    
    // Dar tiempo para que se actualice el estado del comando
    setTimeout(() => {
        logger.warn('Exiting process for restart');
        process.exit(0);
    }, 2000);

    return {
        success: true,
        message: 'Bot restarting...',
    };
}

/**
 * Reclama comandos estancados (estado 'procesando' por más de 5 minutos)
 * Se ejecuta al iniciar el bot para recuperar comandos que quedaron en procesando
 * debido a un crash anterior
 */
async function reclaimStaleCommands() {
    if (!authToken) return;

    try {
        const response = await fetch(
            `${PANEL_BASE_URL}/admin-commands/monitoring/stale`,
            {
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                },
            }
        );

        if (!response.ok) return;

        const staleCommands = await response.json();

        if (staleCommands.length > 0) {
            logger.warn('Found stale commands from previous crash', { 
                count: staleCommands.length 
            });

            // Marcar como fallidos con mensaje de recuperación
            for (const comando of staleCommands) {
                await updateCommandStatus(comando.id, 'fallido', {
                    error: 'Bot crashed during execution',
                    recovered: true,
                    timestamp: new Date().toISOString(),
                });
            }

            logger.info('Stale commands marked as failed', { 
                count: staleCommands.length 
            });
        }

    } catch (error) {
        logger.error('Failed to reclaim stale commands', { error: error.message });
    }
}

/**
 * Inicia integración con el panel
 */
export async function startPanelIntegration(client) {
    // Verificar si hay configuración del panel
    if (!BOT_PASSWORD || BOT_PASSWORD === '') {
        logger.warn('Panel integration disabled: PANEL_BOT_PASSWORD not configured');
        console.log('⚠️  Panel integration disabled (no PANEL_BOT_PASSWORD in .env)\n');
        return;
    }

    logger.info('Starting panel integration', { 
        panelUrl: PANEL_BASE_URL,
        username: BOT_USERNAME 
    });

    console.log('🔗 Iniciando integración con panel de administración...\n');

    // Login inicial
    const loginSuccess = await loginToPanel();
    if (!loginSuccess) {
        logger.error('Failed initial login to panel, integration disabled');
        console.log('❌ Error al conectar con el panel, integración deshabilitada\n');
        return;
    }

    console.log('✅ Conectado al panel de administración\n');

    // Reclamar comandos estancados de un crash anterior
    await reclaimStaleCommands();

    // Enviar heartbeat inicial
    await sendHeartbeat(client, 'CONNECTED');

    // Iniciar heartbeat periódico (cada minuto)
    heartbeatTimer = setInterval(async () => {
        await sendHeartbeat(client, 'CONNECTED');
    }, HEARTBEAT_INTERVAL);

    logger.info('Heartbeat timer started', { intervalMs: HEARTBEAT_INTERVAL });

    // Iniciar polling de comandos (cada 10 segundos)
    pollCommandsTimer = setInterval(async () => {
        await pollAdminCommands(client);
    }, POLL_COMMANDS_INTERVAL);

    logger.info('Command polling started', { intervalMs: POLL_COMMANDS_INTERVAL });

    // Reclamar comandos estancados periódicamente (cada 5 minutos)
    reclaimStaleTimer = setInterval(async () => {
        await reclaimStaleCommands();
    }, STALE_COMMANDS_INTERVAL);

    logger.info('Stale command reclaim timer started', { intervalMs: STALE_COMMANDS_INTERVAL });

    console.log(`💓 Heartbeat: cada ${HEARTBEAT_INTERVAL / 1000}s`);
    console.log(`📥 Polling comandos: cada ${POLL_COMMANDS_INTERVAL / 1000}s\n`);
}

/**
 * Detiene integración con el panel (cleanup al cerrar)
 */
export async function stopPanelIntegration(client) {
    logger.info('Stopping panel integration');

    // Limpiar timers
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
    if (pollCommandsTimer) {
        clearInterval(pollCommandsTimer);
        pollCommandsTimer = null;
    }
    if (reclaimStaleTimer) {
        clearInterval(reclaimStaleTimer);
        reclaimStaleTimer = null;
    }

    // Enviar heartbeat final con estado DISCONNECTED
    if (authToken && client) {
        await sendHeartbeat(client, 'DISCONNECTED');
    }

    logger.info('Panel integration stopped');
}
