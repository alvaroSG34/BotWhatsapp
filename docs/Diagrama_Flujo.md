┌──────────────┐
│   Usuario    │
│  WhatsApp    │
└──────┬───────┘
       │ 1. Envía Imagen/PDF
       │    (via WhatsApp Web)
       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    whatsapp-web.js                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Puppeteer (controla Chrome headless)                    │   │
│  │  - Mantiene sesión autenticada                           │   │
│  │  - Intercepta WebSocket de WhatsApp Web                  │   │
│  │  - Serializa auth en auth_info/                          │   │
│  └──────────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────────┘
                            │ 2. Evento 'message'
                            │    { from, hasMedia, body }
                            ▼
              ┌─────────────────────────────┐
              │   src/index.js              │
              │   (Event Handler)           │
              └─────────────┬───────────────┘
                            │ 3. msg.downloadMedia()
                            │    Retorna: Buffer + mimetype
                            ▼
              ┌─────────────────────────────┐
              │  src/enrollmentHandler.js   │
              │  handleDocumentUpload()     │
              └─────────────┬───────────────┘
                            │ 4. Validaciones
                            │    - ¿< 8 materias?
                            │    - ¿Sin doc pendiente?
                            ▼
              ┌─────────────────────────────┐
              │      src/ocr.js             │
              │   performOCR(buffer)        │
              └─────┬─────────┬─────────┬───┘
                    │         │         │
         ┌──────────┘         │         └─────────────┐
         │ Fallback #1        │ #2                #3  │
         ▼                    ▼                       ▼
┌─────────────────┐  ┌─────────────────┐   ┌──────────────────┐
│  OpenAI Vision  │  │  OCR.space API  │   │  Tesseract.js    │
│  (Cloud)        │  │  (Cloud)        │   │  (Local/WASM)    │
└────────┬────────┘  └────────┬────────┘   └────────┬─────────┘
         │ HTTPS POST         │ HTTPS POST          │ In-Memory
         │ base64 image       │ multipart/form      │ Processing
         │                    │                     │
         └────────────────────┴─────────────────────┘
                            │ Retorna: texto extraído
                            ▼
              ┌─────────────────────────────┐
              │      src/parser.js          │
              │  parseEnrollmentDocument()  │
              └─────────────┬───────────────┘
                            │ Extrae con regex:
                            │ - Registro: /\d{8,9}/
                            │ - Nombre: /[A-Z ]+/
                            │ - Materias: /([A-Z]{3}\d{3})\s+([A-Z0-9]+)/
                            ▼
              ┌─────────────────────────────┐
              │     src/database.js         │
              │  saveEnrollmentDocument()   │
              └─────────────┬───────────────┘
                            │ 5. INSERT transacción
                            ▼
              ┌─────────────────────────────────────────────────┐
              │           PostgreSQL Database                   │
              │  ┌───────────────────────────────────────────┐  │
              │  │  students                                 │  │
              │  │  - whatsapp_id (PK)                       │  │
              │  │  - registration_number                    │  │
              │  │  - total_subjects_enrolled (max 8)        │  │
              │  └───────────────────────────────────────────┘  │
              │  ┌───────────────────────────────────────────┐  │
              │  │  enrollment_documents                     │  │
              │  │  - id (PK)                                │  │
              │  │  - status: pending → confirmed → completed│  │
              │  │  - created_at (expira en 10 min)          │  │
              │  └───────────────────────────────────────────┘  │
              │  ┌───────────────────────────────────────────┐  │
              │  │  enrollment_subjects                      │  │
              │  │  - document_id (FK)                       │  │
              │  │  - sigla, grupo, materia                  │  │
              │  │  - status: pending → added/failed         │  │
              │  └───────────────────────────────────────────┘  │
              │  ┌───────────────────────────────────────────┐  │
              │  │  subject_group_mapping                    │  │
              │  │  - sigla + grupo → whatsapp_jid           │  │
              │  │  (Poblado con npm run discover-groups)    │  │
              │  └───────────────────────────────────────────┘  │
              └─────────────────────────────────────────────────┘
                            │ 6. Retorna document_id
                            ▼
              ┌─────────────────────────────┐
              │  src/antibanHelpers.js      │
              │  enviarMensajeHumano()      │
              └─────────────┬───────────────┘
                            │ 7. Mensaje de confirmación
                            │    con delays y typing
                            ▼
              ┌─────────────────────────────┐
              │    whatsapp-web.js          │
              │    chat.sendStateTyping()   │
              │    chat.sendMessage()       │
              └─────────────┬───────────────┘
                            │ 8. Envía a WhatsApp
                            ▼
                     ┌──────────────┐
                     │   Usuario    │
                     │  (Confirma)  │
                     └──────┬───────┘
                            │ 9. "confirmar" / "listo" / "si"
                            ▼
              ┌─────────────────────────────┐
              │   src/enrollmentHandler.js  │
              │   handleConfirmation()      │
              └─────────────┬───────────────┘
                            │ 10. UPDATE status = 'confirmed'
                            ▼
              ┌─────────────────────────────┐
              │   src/groupMapper.js        │
              │   findGroupForSubject()     │
              └─────────────┬───────────────┘
                            │ 11. SELECT whatsapp_jid
                            │     FROM subject_group_mapping
                            ▼
              ┌─────────────────────────────┐
              │   src/index.js              │
              │   agregarAGrupo()           │
              └─────────────┬───────────────┘
                            │ 12. Por cada grupo:
                            │     - Delay 8-20s
                            │     - group.addParticipants()
                            │     - Delay 8-20s
                            │     - Manejo errores 403/408/409
                            ▼
              ┌─────────────────────────────┐
              │    whatsapp-web.js          │
              │    WebSocket → WhatsApp API │
              └─────────────┬───────────────┘
                            │ 13. Agregar usuario real
                            ▼
                     ┌──────────────┐
                     │ Grupo de     │
                     │ WhatsApp     │
                     │ (Materia)    │
                     └──────────────┘