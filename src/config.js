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
    RESPUESTA_INICIAL: [2000, 5000],    // 2-5 segundos antes de responder
    ENTRE_MENSAJES: [5000, 15000],      // 5-15 segundos entre mensajes
    ENTRE_ADICIONES: [8000, 20000],     // 8-20 segundos entre agregar a grupos
    DESPUES_ERROR: [10000, 15000]       // 10-15 segundos después de un error
};

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
