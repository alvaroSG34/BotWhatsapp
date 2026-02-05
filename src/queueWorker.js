import { 
    DELAYS, 
    QUEUE_CHECK_INTERVAL, 
    LOG_EVERY_N_JOBS, 
    MAX_RETRIES,
    WORKER_RESTART_DELAYS,
    SHUTDOWN_TIMEOUT,
    NOTIFICATION_DELAYS
} from './config.js';
import { queueManager, getNextJob, getNextNotification, trackJobCompletion } from './queueManager.js';
import { enviarMensajeHumano } from './antibanHelpers.js';
import { logger } from './logger.js';
import pool from './database.js';
import { delayFromRange } from './antibanHelpers.js';

let isJobWorkerRunning = false;
let isNotificationWorkerRunning = false;
let jobsProcessed = 0;
let notificationsProcessed = 0;
let restartCount = 0;
let lastSuccessTime = Date.now();

/**
 * Worker loop para procesar trabajos de agregar a grupos
 * @param {object} client - WhatsApp client
 * @param {function} agregarAGrupo - Función para agregar usuarios a grupos
 */
async function jobWorkerLoop(client, agregarAGrupo) {
    logger.info('Job worker started');
    
    while (isJobWorkerRunning) {
        try {
            const job = getNextJob();
            
            if (!job) {
                await new Promise(resolve => setTimeout(resolve, QUEUE_CHECK_INTERVAL));
                continue;
            }

            queueManager.markJobProcessing();
            
            const { userId, groupJid, subjectId, documentId, materiaNombre, type, groupName } = job;

            // Handle admin-created group job: create group and add the user
            if (type === 'create_group') {
                logger.info('Processing create_group job', { groupName, userId, documentId });

                let result = { exito: false, materia: groupName };

                try {
                    // Create group with the given user as initial participant
                    const created = await client.createGroup(groupName, [userId]);
                    logger.info('Group created', { groupName, created });
                    result.exito = true;
                } catch (err) {
                    logger.error('Failed create_group job', { error: err.message, groupName, userId });
                    result.exito = false;
                }

                // Track completion in the document/batch so a single summary is sent later
                try {
                    trackJobCompletion(documentId, {
                        success: result.exito,
                        message: result.materia,
                        materiaNombre: groupName,
                        userId
                    });
                } catch (trackErr) {
                    logger.error('Failed to track create_group completion', { error: trackErr.message, documentId });
                }

                // Respect anti-ban delay after creating/adding
                await delayFromRange(DELAYS.ENTRE_ADICIONES);
                queueManager.markJobCompleted();
                continue;
            }
            
            logger.debug('Processing job', { 
                documentId, 
                subjectId, 
                materiaNombre 
            });

            let result;
            let attempts = 0;
            let success = false;

            while (attempts <= MAX_RETRIES && !success) {
                try {
                    result = await agregarAGrupo(client, groupJid, userId, materiaNombre);
                    success = result.exito;
                    
                    if (!success && attempts < MAX_RETRIES) {
                        logger.warn('Job failed, retrying', { 
                            documentId, 
                            subjectId, 
                            attempt: attempts + 1,
                            error: result.message
                        });
                        await delayFromRange(DELAYS.DESPUES_ERROR);
                    }
                } catch (error) {
                    logger.error('Job execution error', { 
                        documentId, 
                        subjectId, 
                        error: error.message 
                    });
                    result = { exito: false, materia: materiaNombre };
                }
                
                attempts++;
            }

            // Actualizar estado en base de datos si el job está relacionado a un subjectId
            if (subjectId) {
                try {
                    const estado = result.exito ? 'agregado' : 'fallido';
                    const query = `
                        UPDATE boleta_grupo 
                        SET estado_agregado = $1, 
                            intentos = $2, 
                            error_ultimo = $3,
                            agregado_en = $4
                        WHERE id = $5
                    `;
                    
                    await pool.query(query, [
                        estado,
                        attempts,
                        result.exito ? null : result.materia,
                        result.exito ? new Date() : null,
                        subjectId
                    ]);
                } catch (dbError) {
                    logger.error('Failed to update job status in DB', { 
                        subjectId, 
                        error: dbError.message 
                    });
                }
            }

            // Rastrear completado
            trackJobCompletion(documentId, {
                success: result.exito,
                message: result.materia,
                materiaNombre,
                userId
            });

            jobsProcessed++;
            
            if (jobsProcessed % LOG_EVERY_N_JOBS === 0) {
                logger.info('Job worker progress', { 
                    jobsProcessed, 
                    queueSize: queueManager.getQueueSize() 
                });
            }

            // Delay entre trabajos
            if (result.success) {
                await delayFromRange(DELAYS.ENTRE_ADICIONES);
            }

            queueManager.markJobCompleted();
            lastSuccessTime = Date.now();

        } catch (error) {
            logger.error('Job worker loop error', { error: error.message, stack: error.stack });
            queueManager.markJobCompleted();
            await new Promise(resolve => setTimeout(resolve, QUEUE_CHECK_INTERVAL));
        }
    }
    
    logger.info('Job worker stopped');
}

/**
 * Worker loop para procesar notificaciones WhatsApp
 * @param {object} client - WhatsApp client
 */
async function notificationWorkerLoop(client) {
    logger.info('Notification worker started');
    
    while (isNotificationWorkerRunning) {
        try {
            const notification = getNextNotification();
            
            if (!notification) {
                await new Promise(resolve => setTimeout(resolve, QUEUE_CHECK_INTERVAL));
                continue;
            }

            const { userId, message, chat } = notification;
            
            logger.debug('Processing notification', { userId });

            try {
                await chat.sendMessage(message);
                notificationsProcessed++;
                
                if (notificationsProcessed % LOG_EVERY_N_JOBS === 0) {
                    logger.info('Notification worker progress', { 
                        notificationsProcessed, 
                        queueSize: queueManager.notificationQueue.length 
                    });
                }
            } catch (error) {
                logger.warn('Failed to send notification, discarding silently', { 
                    userId, 
                    error: error.message 
                });
            }

            // Delay entre notificaciones
            await delayFromRange(NOTIFICATION_DELAYS);

        } catch (error) {
            logger.error('Notification worker loop error', { error: error.message });
            await new Promise(resolve => setTimeout(resolve, QUEUE_CHECK_INTERVAL));
        }
    }
    
    logger.info('Notification worker stopped');
}

/**
 * Reiniciar worker con backoff exponencial
 * @param {string} type - 'job' o 'notification'
 * @param {object} client
 * @param {function} agregarAGrupo
 */
async function restartWithBackoff(type, client, agregarAGrupo) {
    const delayMs = WORKER_RESTART_DELAYS[Math.min(restartCount, WORKER_RESTART_DELAYS.length - 1)];
    
    logger.warn(`${type} worker crashed, restarting in ${delayMs}ms`, { 
        restartCount, 
        delay: delayMs 
    });
    
    restartCount++;
    
    await new Promise(resolve => setTimeout(resolve, delayMs));
    
    if (type === 'job') {
        startJobWorker(client, agregarAGrupo).catch(err => 
            logger.error('Job worker restart failed', { error: err.message })
        );
    } else {
        startNotificationWorker(client).catch(err => 
            logger.error('Notification worker restart failed', { error: err.message })
        );
    }
}

/**
 * Iniciar worker de trabajos
 * @param {object} client
 * @param {function} agregarAGrupo
 */
export async function startJobWorker(client, agregarAGrupo) {
    if (isJobWorkerRunning) {
        logger.warn('Job worker already running');
        return;
    }
    
    isJobWorkerRunning = true;
    
    try {
        await jobWorkerLoop(client, agregarAGrupo);
    } catch (error) {
        logger.error('Job worker crashed', { error: error.message, stack: error.stack });
        isJobWorkerRunning = false;
        await restartWithBackoff('job', client, agregarAGrupo);
    }
}

/**
 * Iniciar worker de notificaciones
 * @param {object} client
 */
export async function startNotificationWorker(client) {
    if (isNotificationWorkerRunning) {
        logger.warn('Notification worker already running');
        return;
    }
    
    isNotificationWorkerRunning = true;
    
    try {
        await notificationWorkerLoop(client);
    } catch (error) {
        logger.error('Notification worker crashed', { error: error.message, stack: error.stack });
        isNotificationWorkerRunning = false;
        await restartWithBackoff('notification', client, null);
    }
}

/**
 * Detener ambos workers con timeout
 * @returns {Promise}
 */
export async function stopWorkers() {
    logger.info('Stopping workers...');
    
    isJobWorkerRunning = false;
    isNotificationWorkerRunning = false;
    
    const waitForQueuesEmpty = async () => {
        while (queueManager.jobQueue.length > 0 || queueManager.notificationQueue.length > 0) {
            logger.info('Waiting for queues to empty', { 
                jobsRemaining: queueManager.jobQueue.length,
                notificationsRemaining: queueManager.notificationQueue.length
            });
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    };
    
    const timeoutPromise = new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Shutdown timeout exceeded')), SHUTDOWN_TIMEOUT);
    });
    
    try {
        await Promise.race([waitForQueuesEmpty(), timeoutPromise]);
        logger.info('Workers stopped successfully, queues empty');
    } catch (error) {
        logger.warn('Shutdown timeout, forcing stop', { 
            jobsRemaining: queueManager.jobQueue.length,
            notificationsRemaining: queueManager.notificationQueue.length
        });
    }
    
    // Resetear contadores de restart tras 1 minuto de éxito
    if (Date.now() - lastSuccessTime > 60000) {
        restartCount = 0;
        logger.debug('Restart counter reset after 1 minute of success');
    }
}
