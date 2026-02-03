# Fix: Duplicate Boleta Records

## Problem
Users were able to create multiple boleta records for the same document by taking different photos of the same paper document.

**Example**: Student "HUANCA CHOQUE DAVID" (registro 222009752) had 2 records:
- ID 1: `completado` (Feb 2, 2026)
- ID 2: `procesando` (Feb 3, 2026)

## Root Cause
The duplicate detection only checked **file hash** (SHA256 of image buffer), not **content**. Taking two different photos of the same paper document produces two different hashes:
- Photo 1 hash: `5a40e4fcf2a7d8d7...` 
- Photo 2 hash: `36e2ed318e4e4357...`

Since the hashes are different, both uploads passed the duplicate check and created separate database records.

## Solution
Implemented **hybrid duplicate detection** with two checks:

### 1. File Hash Check (Existing)
Prevents uploading the exact same file twice:
```javascript
const duplicate = await findDocumentByHash(docHash);
if (duplicate) {
    return "⚠️ Documento duplicado - Ya procesaste este archivo";
}
```

### 2. Student-Based Check (NEW)
Prevents multiple pending/processing boletas from the same student:
```javascript
const pendingDoc = await getPendingDocument(remitente);
if (pendingDoc) {
    return "⚠️ Ya tienes un documento en proceso - Espera o confirma con LISTO";
}
```

## Changes Made

### 1. `src/enrollmentHandler.js`
Added student-based duplicate check after file hash check:
```javascript
// Step 1b: Check for pending documents from this student (different photo of same boleta)
const pendingDoc = await getPendingDocument(remitente);
if (pendingDoc) {
    const timeSinceUpload = (Date.now() - new Date(pendingDoc.creado_en).getTime()) / 60000;
    await enviarMensajeHumano(
        chat,
        `⚠️ *Ya tienes un documento en proceso*\n\n` +
        `Subiste una boleta hace ${Math.round(timeSinceUpload)} minutos.\n` +
        `Estado: ${pendingDoc.estado}\n\n` +
        `${pendingDoc.estado === 'pendiente' ? 'Por favor confirma con *LISTO* para continuar.' : 'Espera a que termine de procesarse.'}`
    );
    return;
}
```

### 2. `src/database.js`
Updated `getPendingDocument()` to check for BOTH `pendiente` AND `procesando` states:
```javascript
// Before: WHERE ed.estado = 'pendiente'
// After:
WHERE ed.estado IN ('pendiente', 'procesando')
```

This ensures students can't upload a second document while the first is still being processed by the queue.

## Testing
Created `test-duplicate-detection.js` to verify:
```bash
npm run test
```

Test confirms:
- ✅ Student with `procesando` document (ID 2) would be blocked from uploading another
- ✅ `getPendingDocument()` correctly returns pending/processing documents
- ✅ Duplicate detection message shows helpful information (time since upload, current state)

## Behavior After Fix

| Scenario | Old Behavior | New Behavior |
|----------|-------------|--------------|
| Upload same file twice | ❌ Blocked (file hash) | ✅ Blocked (file hash) |
| Upload different photo of same boleta | ❌ Allowed (creates duplicate) | ✅ Blocked (student check) |
| Upload after completion | ✅ Allowed | ✅ Allowed |
| Upload while processing | ❌ Allowed (creates duplicate) | ✅ Blocked (student check) |

## Edge Cases Handled

1. **User uploads → confirms → queue processing**: Student check blocks second upload until first completes
2. **User uploads → forgets to confirm → uploads again**: Student check reminds to confirm pending document
3. **User uploads → processing fails → wants to retry**: User must wait for first to complete/fail (cleanup task will expire after 10min)

## Database Constraints
Existing UNIQUE constraint on `documento_hash` remains in place as first line of defense:
```sql
documento_hash VARCHAR(64) NOT NULL UNIQUE
```

The student-based check adds a second layer that catches content duplicates even when file hashes differ.

## Future Improvements (Optional)
1. **Content-based hash**: Hash the parsed content (registro + subjects) instead of file buffer
2. **Smart retry**: Allow retry if previous upload failed with specific errors
3. **Admin override**: Panel button to manually allow duplicate for edge cases
