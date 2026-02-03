/**
 * Límite máximo de materias por estudiante (acumulativo permanente)
 */
export const MAX_SUBJECTS_PER_USER = 8;

/**
 * Comandos que el bot reconoce
 */
export const COMANDOS = {
    MENU: ["menu", "ayuda", "help", "start"],
    CONFIRMAR: ["listo", "confirmar", "si", "sí", "ok", "ready"]
};

/**
 * Delays con rangos aleatorios para comportamiento humano (en milisegundos)
 * Formato: [minMs, maxMs]
 */
export const DELAYS = {
    RESPUESTA_INICIAL: [1000, 2500],    // 1-2.5 segundos antes de responder
    ENTRE_MENSAJES: [2500, 8000],       // 2.5-8 segundos entre mensajes
    ENTRE_ADICIONES: [7000, 14000],     // 7-14 segundos entre agregar a grupos
    DESPUES_ERROR: [5000, 8000]         // 5-8 segundos después de un error
};

/**
 * Configuración del sistema de colas
 */
export const QUEUE_CHECK_INTERVAL = 500;           // 500ms entre checks de cola
export const SHUTDOWN_TIMEOUT = 600000;            // 10 minutos para graceful shutdown
export const LOG_EVERY_N_JOBS = 10;                // Logger cada N trabajos procesados
export const MAX_RETRIES = 2;                      // Reintentos máximos por trabajo
export const WORKER_RESTART_DELAYS = [5000, 10000, 20000, 40000, 60000]; // Backoff exponencial
export const DOCUMENT_FAIL_THRESHOLD = 3;          // Materias fallidas para marcar documento fallido
export const NOTIFICATION_DELAYS = [2000, 5000];   // 2-5 segundos entre notificaciones

/**
 * Mensajes del bot
 */
export const MENSAJES = {
    BIENVENIDA: `🤖 *Bot de Inscripción Automática*

¡Hola! Soy tu asistente para inscribirte a grupos de WhatsApp.

📸 *¿Cómo funciona?*
1. Envíame una foto o PDF de tu *boleta de inscripción*
2. Yo la leeré automáticamente y extraeré tus datos
3. Confirma los datos que detecté
4. Te agregaré automáticamente a tus grupos

💡 *Importante:*
• Máximo ${MAX_SUBJECTS_PER_USER} materias por estudiante
• La foto debe ser clara y legible
• Debe incluir tu número de registro y tabla de materias

Envía tu boleta para comenzar! 📄`,

    NO_GRUPOS: `❌ No se encontraron materias válidas en tu mensaje.

Envía tu boleta de inscripción (foto o PDF) para que pueda procesarla automáticamente.`
};
