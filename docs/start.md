# Prompt: Desarrollo de Bot de Inscripciones WhatsApp con Baileys

Actúa como un Desarrollador Senior de Node.js experto en automatización de WhatsApp y la librería `@whiskeysockets/baileys`.

Quiero desarrollar un bot que automatice la inscripción de alumnos a grupos de WhatsApp basándose en una foto de su boleta de inscripción. El bot debe manejar permisos de administrador, OCR básico y gestión de errores de privacidad.

## 1. Stack Tecnológico
* **Lenguaje:** Node.js (JavaScript/TypeScript).
* **Core Library:** `@whiskeysockets/baileys`.
* **OCR:** `tesseract.js` (para procesar la imagen localmente por ahora).
* **Utilidades:** `pino` (logging), `qrcode-terminal` (auth).

## 2. Objetivo del Proyecto
El bot debe recibir una imagen (boleta), leer las materias, y añadir al usuario a los grupos correspondientes.
**CRÍTICO:** Debido a las políticas de privacidad de WhatsApp, no se puede añadir a un usuario si este no tiene al bot en sus contactos. Por ello, debemos implementar un flujo de "Handshake" (Apretón de manos).

## 3. Flujo de Usuario (Lógica de Negocio)

### Paso 1: Recepción y Análisis
1.  El usuario envía una imagen.
2.  El bot descarga la imagen y usa OCR para extraer el texto.
3.  El bot busca palabras clave en el texto (ej: "Matemáticas", "Física") y las cruza con un objeto de configuración (`MATERIAS_MAPPING`) para identificar los IDs de los grupos (`JID`).
4.  El bot guarda temporalmente en memoria: "El usuario X tiene pendientes los grupos Y y Z".

### Paso 2: El Handshake (Barrera de Privacidad)
5.  El bot responde al usuario:
    > "He detectado las materias: [Lista]. Para poder añadirte, por favor **AGREGA este número a tus contactos** y responde con la palabra **'LISTO'**".

### Paso 3: Ejecución
6.  El usuario escribe "Listo".
7.  El bot verifica si ese usuario tiene grupos pendientes en memoria.
8.  El bot intenta ejecutar `groupParticipantsUpdate(jid, [user], "add")`.

### Paso 4: Manejo de Errores (Fallback)
9.  Si la adición falla (error 403 Forbidden) porque el usuario mintió y no guardó el contacto:
    * El bot debe capturar el error.
    * El bot debe intentar extraer el `inviteCode` si la API lo devuelve en el error, o simplemente enviar el enlace de invitación público del grupo como último recurso.

## 4. Estructura de Datos (Mock)

Necesito que incluyas un objeto de configuración simulado para mapear materias a grupos. El código debe ser fácil de editar para poner los JIDs reales después.

```javascript
const MATERIAS_CONFIG = {
    "MATEMATICAS": "123456789@g.us", // ID de ejemplo
    "FISICA": "987654321@g.us",
    "PROGRAMACION": "1122334455@g.us"
};