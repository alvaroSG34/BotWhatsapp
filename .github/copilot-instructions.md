# AI Coding Instructions - WhatsApp Enrollment Bot

## Project Overview
WhatsApp bot that automates student enrollment to subject groups via OCR processing of enrollment documents (boletas). Built with `whatsapp-web.js`, Tesseract OCR, and PostgreSQL. Critical constraint: WhatsApp privacy policies require students to have the bot in contacts before being added to groups.

## Architecture & Data Flow

### Core Processing Pipeline
1. **Document Receipt** ([src/enrollmentHandler.js](src/enrollmentHandler.js)) → 2. **OCR** ([src/ocr.js](src/ocr.js)) → 3. **Parsing** ([src/parser.js](src/parser.js)) → 4. **Group Mapping** ([src/groupMapper.js](src/groupMapper.js)) → 5. **Confirmation** → 6. **Addition** ([src/index.js](src/index.js))

### Database Schema ([database/schema.sql](database/schema.sql))
- **estudiantes**: Persistent student records with `total_materias_inscritas` (max 8 per student)
- **boletas_inscripcion**: Document processing state machine (`pendiente` → `confirmado` → `procesando` → `completado`)
- **materias_inscripcion**: Individual subject enrollments linked to documents
- **mapeo_grupos_materias**: SIGLA+GRUPO → WhatsApp JID mapping (use `npm run discover-groups` to populate)

State transitions are critical: documents expire after 10 minutes if not confirmed (handled by [src/cleanupTasks.js](src/cleanupTasks.js)).

## Critical Patterns

### Anti-Ban Protocol ([src/antibanHelpers.js](src/antibanHelpers.js))
ALL user-facing messages MUST use `enviarMensajeHumano()` which implements:
- Random delays (2-5s before response)
- Typing simulation based on message length (~40ms/char)
- Random delays between group additions (8-20s via `DELAYS.ENTRE_ADICIONES`)

**Never** use `chat.sendMessage()` directly. Always `await delayFromRange(DELAYS.ENTRE_ADICIONES)` between group operations.

### OCR Strategy ([src/ocr.js](src/ocr.js))
Fallback chain: OpenAI Vision → OCR.space API → Tesseract.js (local). Each provider requires different preprocessing:
- **OpenAI**: Base64 buffer, best for structured documents
- **OCR.space**: Requires `filetype` param, best for photos
- **Tesseract**: Local fallback, slower but offline

Configuration via `process.env.OPENAI_API_KEY` and `OCR_SPACE_API_KEY`. If adding new OCR providers, follow the try-catch pattern in `performOCR()`.

### Parser Patterns ([src/parser.js](src/parser.js))
Extraction uses multiple regex patterns with fallbacks:
- **Registration number**: 8-9 digits with OCR error handling (`O→0`, `I/l→1`)
- **Student name**: Capital letters between registration number and career keywords
- **Subjects**: Table parsing with SIGLA (e.g., `INF412`) + GRUPO (e.g., `5A`) + optional materia name

When adding extraction logic, always provide 2-3 fallback patterns and log which pattern matched via `logger.debug()`.

### Error Handling in Group Addition
WhatsApp errors are contextual ([src/index.js](src/index.js) `agregarAGrupo()`):
- **403**: User doesn't have bot in contacts → send instructional message
- **408/recently_left**: WhatsApp cooldown period → explain wait time
- **409**: Already in group → acknowledge gracefully
- **No response**: Network/permission issues → generic fallback

Always send user-friendly error messages via `enviarMensajeHumano()` explaining *why* and *what to do*.

## Development Workflows

### Initial Setup
```bash
npm install
# Setup PostgreSQL database
psql -U postgres -c "CREATE DATABASE enrollment_db;"
psql -U postgres -d enrollment_db -f database/schema.sql
# Configure .env (see README.md)
# Discover and map WhatsApp groups:
npm run discover-groups
# Copy generated SQL INSERT commands into psql
```

### Running & Testing
- **Start bot**: `npm start` (scans QR code on first run)
- **Dev mode**: `npm run dev` (auto-restart on file changes)
- **Discover groups**: `npm run discover-groups` (generates SQL for group mappings)
- **Delete student**: `npm run delete-student` (removes all enrollments for testing)

### Logging ([src/logger.js](src/logger.js))
Winston structured logging to `logs/`:
- `bot.log`: All events
- `error.log`: Errors only
- `exceptions.log`: Unhandled exceptions

Use `logger.info/warn/error/debug` with context objects:
```javascript
logger.info('User added to group', { userId, groupJid, groupName });
```

## Configuration ([src/config.js](src/config.js))

### Key Constants
- `MAX_SUBJECTS_PER_USER`: Hard limit (8) enforced in `handleDocumentUpload()`
- `DELAYS`: All timing ranges for anti-ban behavior (never use fixed delays)
- `COMANDOS.CONFIRMAR`: Accepted confirmation keywords (`["listo", "confirmar", "si", "sí", "ok"]`)

When adding new commands/limits, update `config.js` first, then reference the constant everywhere.

## Common Modifications

### Adding New Subject Detection Patterns
1. Add pattern to `extractSubjects()` in [src/parser.js](src/parser.js)
2. Test with `test_ocr_configs.js` using real boleta samples
3. Log which pattern matched for debugging

### Changing Group Mapping Logic
Group mappings are in PostgreSQL `mapeo_grupos_materias` table. To modify:
1. Run `npm run discover-groups` to see current groups
2. Use `INSERT ... ON CONFLICT (sigla, grupo) DO NOTHING` for upserts
3. Or modify `groupMapper.js` for runtime mapping logic

### Adjusting Anti-Ban Timings
Edit `DELAYS` in [src/config.js](src/config.js). Current values based on manual testing:
- Too fast → WhatsApp rate limits (temporary ban)
- Too slow → Poor UX

Balance based on `logs/bot.log` patterns. Monitor for rate limit errors.

## Testing Scripts

- **test_ocr_configs.js**: Test OCR providers with sample images
- **test_stress.js**: Simulate multiple concurrent enrollments
- **test-import.js**: Test database operations

When adding features, create corresponding test scripts for manual validation.

## Windows-Specific Notes
- Auth session stored in `auth_info/` (don't commit)
- Use `psql -U postgres` directly or pgAdmin for database access
- npm scripts use `node` directly (not `NODE_ENV` prefixes)

## Key Files Reference
- **Entry**: [src/index.js](src/index.js) - Main bot event handlers
- **Enrollment**: [src/enrollmentHandler.js](src/enrollmentHandler.js) - Document processing workflow
- **OCR**: [src/ocr.js](src/ocr.js) - Multi-provider OCR fallback chain
- **Parser**: [src/parser.js](src/parser.js) - Text extraction with regex patterns
- **Database**: [src/database.js](src/database.js) - All PostgreSQL queries
- **Config**: [src/config.js](src/config.js) - Single source of truth for constants
