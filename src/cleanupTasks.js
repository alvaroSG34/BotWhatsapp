import { expireOldDocuments } from './database.js';
import { logger } from './logger.js';

/**
 * Start automatic cleanup task for expired pending documents
 * Runs every 2 minutes
 */
export function startExpirationCleaner() {
    logger.info('Starting expiration cleaner task');
    
    // Run immediately on startup
    cleanupExpiredDocuments();
    
    // Then run every 2 minutes
    setInterval(cleanupExpiredDocuments, 2 * 60 * 1000);
}

/**
 * Clean up expired documents
 */
async function cleanupExpiredDocuments() {
    try {
        const expiredCount = await expireOldDocuments(10); // 10 minutes timeout
        
        if (expiredCount > 0) {
            logger.info('Cleanup task completed', { expiredCount });
        }
    } catch (error) {
        logger.error('Error in cleanup task', { error: error.message });
    }
}

export default {
    startExpirationCleaner
};
