import crypto from 'crypto';
import { logger } from './logger.js';

/**
 * Normalize text for comparison (remove accents, lowercase)
 * @param {string} text 
 * @returns {string}
 */
export function normalizeForComparison(text) {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove accents
        .replace(/[^a-z0-9]/g, ""); // Keep only alphanumeric
}

/**
 * Extract registration number from OCR text
 * Format: 8-9 digits (e.g., 222009969)
 * @param {string} text 
 * @returns {string|null}
 */
export function extractRegistrationNumber(text) {
    // Handle common OCR errors
    const cleanedText = text
        .replace(/[Oo](?=\d)/g, '0') // O -> 0 before digits
        .replace(/[Il](?=\d)/g, '1'); // I/l -> 1 before digits
    
    // Debug: Log text preview for debugging
    logger.debug('Searching for registration number', {
        textPreview: cleanedText.substring(0, 300).replace(/\n/g, ' ')
    });
    
    // Multiple patterns to try
    const patterns = [
        /\b(\d{9})\b/, // Standalone 9-digit number
        /\b(222\d{6})\b/, // Specific pattern from sample (222009969)
        /\b(\d{8})\b/, // Fallback: 8-digit number
        /(?:REGISTRO|MATRICULA|MATRÍCULA|REG\.?|MAT\.?)[:\s]*(\d{8,9})/i, // With label
    ];

    for (const pattern of patterns) {
        const match = cleanedText.match(pattern);
        if (match) {
            logger.debug('Registration number found', { 
                pattern: pattern.toString(), 
                number: match[1] 
            });
            return match[1];
        }
    }

    logger.warn('Registration number not found in text');
    return null;
}

/**
 * Extract student name from OCR text
 * Assumes format: [NUMBER] [NAME] [CAREER]
 * @param {string} text 
 * @returns {string|null}
 */
export function extractStudentName(text) {
    // Look for pattern: digits followed by name (all caps), before career keywords
    const pattern = /\d{8,9}\s+([A-ZÑÁÉÍÓÚ\s]{10,})(?:\s+(?:CARRERA|INGENIERIA|INGENIERÍA|ING\.|LICENCIATURA))/i;
    const match = text.match(pattern);
    
    if (match) {
        const name = match[1].trim();
        logger.debug('Student name found with pattern', { name });
        return name;
    }

    // Fallback: look for line after registration number
    const lines = text.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
        if (/\d{8,9}/.test(lines[i])) {
            const nextLine = lines[i + 1].trim();
            // Check if next line looks like a name (mostly uppercase letters)
            if (/^[A-ZÑÁÉÍÓÚ\s]{10,}$/.test(nextLine)) {
                logger.debug('Student name found on next line', { name: nextLine });
                return nextLine;
            }
        }
    }

    // Last resort: look for line with "SONCO GUZMAN" pattern (two or more capitalized words)
    const namePattern = /\b([A-ZÑÁÉÍÓÚ]{3,}\s+[A-ZÑÁÉÍÓÚ]{3,}(?:\s+[A-ZÑÁÉÍÓÚ]{3,})?)\b/;
    const nameMatch = text.match(namePattern);
    if (nameMatch) {
        logger.debug('Student name found with name pattern', { name: nameMatch[1] });
        return nameMatch[1];
    }

    logger.warn('Student name not found in text');
    return null;
}

/**
 * Parse table rows with SIGLA GRUPO MATERIA pattern
 * Example: "INF412 5A SISTEMAS DE INFORMACION II"
 * @param {string} text 
 * @returns {Array<object>}
 */
export function extractSubjects(text) {
    const subjects = [];
    
    // Log original text for debugging
    logger.info('Extracting subjects from text', {
        textLength: text.length,
        textPreview: text.substring(0, 300)
    });
    
    // Normalize text: fix common OCR errors (but preserve newlines for table parsing)
    const normalized = text
        .replace(/[Oo](?=\d)/g, '0')  // O -> 0 before digits
        .replace(/[Il](?=\d)/g, '1'); // I/l -> 1 before digits

    // Pattern 1: Table with pipes (Markdown-style table from OCR.space)
    // Example: | INF412 | SA | SISTEMAS DE INFORMACION II | PRESENCIAL | 7 | Ma 07:00-09:15 |
    const tablePattern = /\|\s*([A-Z]{3,4}\d{3,4})\s*\|\s*(\d?[A-Z]{1,2})\s*\|\s*([A-ZÑÁÉÍÓÚÜ\s.0-9]{5,}?)\s*\|/gi;
    
    let match;
    while ((match = tablePattern.exec(normalized)) !== null) {
        const [fullMatch, sigla, grupo, materia] = match;
        
        // Clean up materia (remove trailing spaces)
        const materiaClean = materia.trim().replace(/\s+/g, ' ');
        
        subjects.push({
            sigla: sigla.trim().toUpperCase(),
            grupo: grupo.trim().toUpperCase(),
            materia: materiaClean,
            modalidad: null,
            nivel: null,
            horario: null
        });
        
        logger.info('Subject extracted (table)', { sigla, grupo, materia: materiaClean });
    }
    
    // Pattern 2: Plain text format (fallback for Tesseract)
    // Examples: INF412 5A SISTEMAS OPERATIVOS, INF412 SA SISTEMAS OPERATIVOS
    if (subjects.length === 0) {
        // Only normalize spaces for plain text parsing
        const textForPlain = normalized.replace(/\s+/g, ' ');
        const pattern = /\b([A-Z]{3,4}\d{3,4})\s+(\d?[A-Z]{1,2})\s+([A-ZÑÁÉÍÓÚÜ\s.]{5,})(?=\s+(?:PRESENCIAL|VIRTUAL|HIBRIDA|\d+|Ma|Lu|Mi|Ju|Vi|Sa|Do)|\s*$)/gi;
        
        while ((match = pattern.exec(textForPlain)) !== null) {
            const [fullMatch, sigla, grupo, materia] = match;
            
            // Clean up materia (remove trailing spaces and common OCR artifacts)
            const materiaClean = materia.trim().replace(/\s+/g, ' ');
            
            // Extract additional fields if present in context
            const context = normalized.substring(match.index, match.index + 200);
            const modalidad = context.match(/\b(PRESENCIAL|VIRTUAL|HIBRIDA)\b/i)?.[1] || null;
            const nivel = context.match(/\b(\d+)\b/)?.[1] || null;
            
            // Try to extract schedule (HH:MM format)
            const horarioMatch = context.match(/(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})/);
            const horario = horarioMatch ? horarioMatch[1] : null;

            subjects.push({
                sigla: sigla.trim().toUpperCase(),
                grupo: grupo.trim().toUpperCase(),
                materia: materiaClean,
                modalidad,
                nivel,
                horario
            });
            
            logger.debug('Subject extracted (plain)', { sigla, grupo, materia: materiaClean });
        }
    }

    logger.info('Subjects extraction completed', { count: subjects.length });
    return subjects;
}

/**
 * Parse enrollment document
 * Handles both structured JSON (from OpenAI) and raw OCR text (from Tesseract)
 * @param {string} ocrText - Either JSON string or plain text
 * @returns {object} { registrationNumber, studentName, subjects[], isValid }
 */
export function parseEnrollmentDocument(ocrText) {
    logger.info('Parsing enrollment document');
    
    // Try to parse as JSON first (OpenAI Vision response)
    try {
        const jsonData = JSON.parse(ocrText);
        
        // Check if it's OpenAI Vision format
        if (jsonData.numero_registro !== undefined && jsonData.materias) {
            logger.info('Detected OpenAI Vision JSON format');
            
            // Map OpenAI format to our internal format
            const subjects = jsonData.materias.map(materia => ({
                sigla: materia.sigla,
                grupo: materia.grupo,
                materia: materia.nombre || materia.materia,
                modalidad: null,
                nivel: null,
                horario: null
            }));
            
            const parsed = {
                registrationNumber: jsonData.numero_registro,
                studentName: jsonData.nombre,
                subjects,
                isValid: !!(jsonData.numero_registro && jsonData.nombre && subjects.length > 0)
            };
            
            logger.info('OpenAI Vision parsing completed', {
                registrationNumber: parsed.registrationNumber,
                studentName: parsed.studentName,
                subjectCount: subjects.length,
                isValid: parsed.isValid
            });
            
            return parsed;
        }
    } catch (e) {
        // Not JSON or invalid JSON, continue with regex parsing
        logger.debug('Not JSON format, using regex parsing');
    }
    
    // Fallback to traditional regex parsing (Tesseract)
    const registrationNumber = extractRegistrationNumber(ocrText);
    const studentName = extractStudentName(ocrText);
    const subjects = extractSubjects(ocrText);

    const parsed = {
        registrationNumber,
        studentName,
        subjects,
        isValid: !!(registrationNumber && studentName && subjects.length > 0)
    };

    logger.info('Document parsing completed', {
        registrationNumber,
        studentName,
        subjectCount: subjects.length,
        isValid: parsed.isValid
    });

    return parsed;
}

/**
 * Calculate document hash for duplicate detection
 * @param {Buffer} buffer 
 * @returns {string} SHA256 hash
 */
export function calculateDocumentHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

export default {
    normalizeForComparison,
    extractRegistrationNumber,
    extractStudentName,
    extractSubjects,
    parseEnrollmentDocument,
    calculateDocumentHash
};
