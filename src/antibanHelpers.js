import { logger } from './logger.js';

/**
 * Generate random delay between min and max milliseconds
 * @param {number} minMs 
 * @param {number} maxMs 
 * @returns {Promise<void>}
 */
export function randomDelay(minMs, maxMs) {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    logger.debug('Random delay', { delayMs: delay });
    return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Simulate typing indicator based on message length
 * ~50 characters = 2-3 seconds of "typing"
 * @param {object} chat - WhatsApp chat object
 * @param {string} message - Message to be sent
 * @returns {Promise<void>}
 */
export async function simulateTyping(chat, message) {
    try {
        const messageLength = message.length;
        
        // Calculate typing duration: ~40ms per character, min 2s, max 8s
        const baseDuration = Math.floor(messageLength * 40);
        const typingDuration = Math.max(2000, Math.min(8000, baseDuration));
        
        // Add some randomness (±20%)
        const randomFactor = 0.8 + Math.random() * 0.4; // 0.8 to 1.2
        const finalDuration = Math.floor(typingDuration * randomFactor);
        
        logger.debug('Simulating typing', { 
            messageLength, 
            typingDurationMs: finalDuration 
        });
        
        // Send typing indicator
        await chat.sendStateTyping();
        
        // Wait for the calculated duration
        await new Promise(resolve => setTimeout(resolve, finalDuration));
        
    } catch (error) {
        logger.error('Error simulating typing', { error: error.message });
        // Continue even if typing simulation fails
    }
}

/**
 * Send message with human-like behavior
 * - Initial random delay (2-5 seconds)
 * - Typing simulation based on length
 * - Send message
 * @param {object} chat - WhatsApp chat object
 * @param {string} texto - Message text
 * @param {object} options - Additional options for sendMessage
 * @returns {Promise<object>} Message object
 */
export async function enviarMensajeHumano(chat, texto, options = {}) {
    try {
        // Initial delay before responding (2-5 seconds)
        await randomDelay(2000, 5000);
        
        // Simulate typing
        await simulateTyping(chat, texto);
        
        // Send the message
        const message = await chat.sendMessage(texto, options);
        
        logger.info('Human-like message sent', { 
            chatId: chat.id._serialized,
            messageLength: texto.length
        });
        
        return message;
        
    } catch (error) {
        logger.error('Error sending human-like message', { 
            error: error.message,
            chatId: chat.id._serialized 
        });
        throw error;
    }
}

/**
 * Helper to get delay range from config
 * @param {Array<number>} range - [minMs, maxMs]
 * @returns {Promise<void>}
 */
export function delayFromRange(range) {
    if (Array.isArray(range) && range.length === 2) {
        return randomDelay(range[0], range[1]);
    }
    // Fallback to fixed delay if not a range
    return new Promise(resolve => setTimeout(resolve, range));
}

export default {
    randomDelay,
    simulateTyping,
    enviarMensajeHumano,
    delayFromRange
};
