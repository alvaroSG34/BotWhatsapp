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
    // Pattern 1: digits followed by name (all caps), before career keywords
    const pattern = /\d{8,9}\s+([A-ZÑÁÉÍÓÚ\s]{10,})(?:\s+(?:CARRERA|INGENIERIA|INGENIERÍA|ING\.|LICENCIATURA))/i;
    const match = text.match(pattern);
    
    if (match) {
        const name = match[1].trim();
        logger.debug('Student name found with pattern', { name });
        return name;
    }

    // Pattern 2: Name in table row AFTER registration (Markdown table format)
    // Example: | 248112233 |\n| Vargas Cruz Camila 5192837-SCZ |
    const tableNamePattern = /\|\s*\d{8,9}\s*\|[\s\n]*\|\s*([A-ZÑÁÉÍÓÚa-zñáéíóú\s]+?)\s+\d{5,}-[A-Z]{2,4}\s*\|/;
    const tableMatch = text.match(tableNamePattern);
    if (tableMatch) {
        const name = tableMatch[1].trim();
        logger.debug('Student name found in table format', { name });
        return name;
    }

    // Pattern 3: Name with CI in same line (mixed case)
    // Example: "Vargas Cruz Camila 5192837-SCZ"
    const nameWithCiPattern = /([A-ZÑÁÉÍÓÚa-zñáéíóú]{3,}(?:\s+[A-ZÑÁÉÍÓÚa-zñáéíóú]{3,}){1,4})\s+\d{5,}-[A-Z]{2,4}/;
    const nameWithCi = text.match(nameWithCiPattern);
    if (nameWithCi) {
        const name = nameWithCi[1].trim();
        // Skip if it looks like a header or period name
        if (!name.match(/PERIODO|NORMAL|MODALIDAD|LOCALIDAD|ORIGEN|INGENIERIA|INFORMATICA/i)) {
            logger.debug('Student name found with CI pattern', { name });
            return name;
        }
    }

    // Fallback: look for line after registration number
    const lines = text.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
        if (/\d{8,9}/.test(lines[i])) {
            const nextLine = lines[i + 1].trim();
            // Check if next line looks like a name (uppercase or mixed case letters)
            if (/^[A-ZÑÁÉÍÓÚa-zñáéíóú\s]{10,}$/.test(nextLine) && 
                !nextLine.match(/PERIODO|NORMAL|MODALIDAD|LOCALIDAD|ORIGEN/i)) {
                logger.debug('Student name found on next line', { name: nextLine });
                return nextLine;
            }
        }
    }

    // Last resort: look for line with "SONCO GUZMAN" pattern (two or more capitalized words)
    const namePattern = /\b([A-ZÑÁÉÍÓÚ]{3,}\s+[A-ZÑÁÉÍÓÚ]{3,}(?:\s+[A-ZÑÁÉÍÓÚ]{3,})?)\b/;
    const nameMatch = text.match(namePattern);
    if (nameMatch && !nameMatch[1].match(/PERIODO|NORMAL|MODALIDAD|LOCALIDAD|ORIGEN/i)) {
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
        textPreview: text.substring(0, 500),
        fullText: text // Log complete text for debugging missing subjects
    });
    
    // Normalize text: fix common OCR errors (but preserve newlines for table parsing)
    // IMPORTANT: Be careful not to break valid siglas like ECO449
    const normalized = text
        // Only replace O->0 when O is surrounded by digits (not in letter sequences)
        .replace(/(?<=\d)[Oo](?=\d)/g, '0')  // 2O5 -> 205 (O between digits)
        .replace(/[Il](?=\d)/g, '1');        // I/l -> 1 before digits
        // NOTE: Removed SA->5A conversion - SA is the correct group code, not 5A

    // Pattern 1: Table with pipes (Markdown-style table from OCR.space)
    // Example: | INF412 | SA | SISTEMAS DE INFORMACION II | PRESENCIAL | 7 | Ma 07:00-09:15 |
    // SIGLA: exactly 3 letters + 3 digits (INF513, RSD421)
    // GRUPO: letter + (letter or digit), never digit+digit (Z1, SA, SB)
    const tablePattern = /\|\s*([A-Z]{3}\d{3})\s*\|\s*([A-Z][A-Z0-9])\s*\|\s*([A-ZÑÁÉÍÓÚÜ\s.0-9&]{5,}?)\s*\|/gi;
    
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
        
        logger.info('Subject extracted (table)', { 
            sigla: sigla.trim().toUpperCase(), 
            grupo: grupo.trim().toUpperCase(), 
            materia: materiaClean,
            matchedPattern: 'table-pipe'
        });
    }
    
    // Pattern 2: Plain text format (fallback for Tesseract)
    // Examples: INF412 5A SISTEMAS OPERATIVOS, ECO449 5A PREPARAC Y EVALUAC
    // Support any prefix (INF, ECO, MAT, etc.)
    if (subjects.length === 0) {
        // Only normalize spaces for plain text parsing
        const textForPlain = normalized.replace(/\s+/g, ' ');
        // SIGLA: 3 letters + 3 digits, GRUPO: letter + (letter or digit)
        const pattern = /\b([A-Z]{3}\d{3})\s+([A-Z][A-Z0-9])\s+([A-ZÑÁÉÍÓÚÜ\s.&]{5,})(?=\s+(?:PRESENCIAL|VIRTUAL|HIBRIDA|\d+|Ma|Lu|Mi|Ju|Vi|Sa|Do)|\s*$)/gi;
        
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
            
            logger.info('Subject extracted (plain)', { 
                sigla: sigla.trim().toUpperCase(), 
                grupo: grupo.trim().toUpperCase(), 
                materia: materiaClean,
                matchedPattern: 'plain-text'
            });
        }
    }
    
    // Pattern 3: Even more relaxed pattern for OCR errors
    // Catches subjects that might have been missed due to spacing/formatting
    if (subjects.length === 0) {
        logger.warn('No subjects found with standard patterns, trying relaxed pattern');
        // Match: 3-4 letters, 3-4 digits, optional spaces, 1-2 chars for group
        // SIGLA: 3 letters + 3 digits (with optional space), GRUPO: letter + (letter or digit)
        const relaxedPattern = /\b([A-Z]{3})\s*(\d{3})\s+([A-Z][A-Z0-9])\b/gi;
        
        while ((match = relaxedPattern.exec(normalized)) !== null) {
            const [fullMatch, prefix, number, grupo] = match;
            const sigla = `${prefix}${number}`;
            
            // Try to find materia name in the next 50 chars
            const afterMatch = normalized.substring(match.index + fullMatch.length, match.index + fullMatch.length + 80);
            const materiaMatch = afterMatch.match(/\s+([A-ZÑÁÉÍÓÚÜ\s.&]{10,}?)(?=\s+(?:PRESENCIAL|VIRTUAL|Ma|Lu|Mi|Ju|Vi|\||$))/);
            const materia = materiaMatch ? materiaMatch[1].trim() : 'MATERIA DESCONOCIDA';
            
            subjects.push({
                sigla: sigla.toUpperCase(),
                grupo: grupo.toUpperCase(),
                materia: materia.replace(/\s+/g, ' '),
                modalidad: null,
                nivel: null,
                horario: null
            });
            
            logger.info('Subject extracted (relaxed)', { 
                sigla: sigla.toUpperCase(), 
                grupo: grupo.toUpperCase(), 
                materia,
                matchedPattern: 'relaxed'
            });
        }
    }

    // Log all unique SIGLA patterns found in the text for debugging
    const allSiglaMatches = normalized.match(/\b([A-Z]{3,4}\d{3,4})\b/gi);
    if (allSiglaMatches) {
        const uniqueSiglas = [...new Set(allSiglaMatches.map(s => s.toUpperCase()))];
        logger.info('All SIGLA codes found in OCR text', { 
            siglas: uniqueSiglas,
            extractedCount: subjects.length,
            missingSiglas: uniqueSiglas.filter(s => !subjects.some(sub => sub.sigla === s))
        });
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
