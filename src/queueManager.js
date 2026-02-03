import { EventEmitter } from 'events';
import { logger } from './logger.js';
import { DOCUMENT_FAIL_THRESHOLD } from './config.js';

/**
 * Queue Manager - Sistema dual de colas FIFO
 * Cola principal: trabajos de agregar a grupos
 * Cola secundaria: notificaciones WhatsApp
 */
class QueueManager extends EventEmitter {
    constructor() {
        super();
        this.jobQueue = [];
        this.notificationQueue = [];
        this.documentProgress = new Map();
        this.totalCompleted = 0;
        this.totalFailed = 0;
        this.jobsProcessing = 0;
    }

    /**
     * Agregar trabajo a cola de grupos
     * @param {object} job - {userId, groupJid, subjectId, documentId, materiaNombre}
     */
    addJob(job) {
        this.jobQueue.push(job);
        logger.debug('Job added to queue', { 
            documentId: job.documentId, 
            queueSize: this.jobQueue.length 
        });
    }

    /**
     * Agregar notificación a cola
     * @param {object} notification - {userId, message, chat}
     */
    addNotification(notification) {
        this.notificationQueue.push(notification);
        logger.debug('Notification added to queue', { 
            userId: notification.userId, 
            queueSize: this.notificationQueue.length 
        });
    }

    /**
     * Obtener siguiente trabajo (FIFO)
     * @returns {object|null}
     */
    getNextJob() {
        return this.jobQueue.shift() || null;
    }

    /**
     * Obtener siguiente notificación (FIFO)
     * @returns {object|null}
     */
    getNextNotification() {
        return this.notificationQueue.shift() || null;
    }

    /**
     * Inicializar progreso de documento
     * @param {number} documentId
     * @param {number} total - Total de materias
     */
    initDocument(documentId, total) {
        this.documentProgress.set(documentId, {
            total,
            completed: 0,
            results: [],
            failedCount: 0
        });
        logger.info('Document initialized in queue', { documentId, total });
    }

    /**
     * Registrar completado de trabajo y verificar si documento completo
     * @param {number} documentId
     * @param {object} result - {success, message, materiaNombre}
     */
    trackJobCompletion(documentId, result) {
        const progress = this.documentProgress.get(documentId);
        
        if (!progress) {
            logger.warn('Document progress not found', { documentId });
            return;
        }

        progress.completed++;
        progress.results.push(result);

        if (!result.success) {
            progress.failedCount++;
        }

        logger.debug('Job completed tracked', { 
            documentId, 
            completed: progress.completed, 
            total: progress.total,
            failedCount: progress.failedCount
        });

        // Verificar si documento completado o fallido por threshold
        if (progress.completed === progress.total) {
            if (progress.failedCount >= DOCUMENT_FAIL_THRESHOLD) {
                // Documento fallido por demasiados errores
                this.totalFailed++;
                this.emit('document:failed', {
                    documentId,
                    results: progress.results,
                    userId: result.userId
                });
                logger.warn('Document marked as failed', { 
                    documentId, 
                    failedCount: progress.failedCount 
                });
            } else {
                // Documento completado exitosamente
                this.totalCompleted++;
                this.emit('document:ready-to-notify', {
                    documentId,
                    results: progress.results,
                    userId: result.userId
                });
                logger.info('Document completed successfully', { 
                    documentId, 
                    successCount: progress.total - progress.failedCount 
                });
            }

            this.documentProgress.delete(documentId);
        }
    }

    /**
     * Obtener estadísticas de las colas
     * @returns {object}
     */
    getQueueStats() {
        return {
            jobsPending: this.jobQueue.length,
            jobsProcessing: this.jobsProcessing,
            notificationsPending: this.notificationQueue.length,
            totalCompleted: this.totalCompleted,
            totalFailed: this.totalFailed
        };
    }

    /**
     * Obtener tamaño de cola de trabajos
     * @returns {number}
     */
    getQueueSize() {
        return this.jobQueue.length;
    }

    /**
     * Marcar trabajo como en proceso
     */
    markJobProcessing() {
        this.jobsProcessing = 1;
    }

    /**
     * Marcar trabajo como completado
     */
    markJobCompleted() {
        this.jobsProcessing = 0;
    }
}

// Singleton instance
const queueManager = new QueueManager();

export { queueManager };
export const { 
    addJob, 
    addNotification, 
    getNextJob, 
    getNextNotification, 
    initDocument, 
    trackJobCompletion,
    getQueueStats,
    getQueueSize
} = {
    addJob: (job) => queueManager.addJob(job),
    addNotification: (notification) => queueManager.addNotification(notification),
    getNextJob: () => queueManager.getNextJob(),
    getNextNotification: () => queueManager.getNextNotification(),
    initDocument: (documentId, total) => queueManager.initDocument(documentId, total),
    trackJobCompletion: (documentId, result) => queueManager.trackJobCompletion(documentId, result),
    getQueueStats: () => queueManager.getQueueStats(),
    getQueueSize: () => queueManager.getQueueSize()
};
