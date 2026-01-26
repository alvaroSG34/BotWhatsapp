import pg from 'pg';
import dotenv from 'dotenv';
import { logger } from './logger.js';

dotenv.config();

const { Pool } = pg;

// Create PostgreSQL connection pool
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: {
        rejectUnauthorized: false // Required for Neon and other cloud PostgreSQL providers
    },
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 20000, // 20 seconds for cloud databases
});

// Handle pool errors
pool.on('error', (err) => {
    logger.error('Unexpected error on idle PostgreSQL client', { error: err.message });
    process.exit(-1); // Fail-fast on database errors
});

// Test connection on startup
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        logger.error('Failed to connect to PostgreSQL', { error: err.message });
        process.exit(-1);
    } else {
        logger.info('PostgreSQL connected successfully', { timestamp: res.rows[0].now });
    }
});

/**
 * Upsert student (insert or update)
 * @param {string} registrationNumber 
 * @param {string} studentName 
 * @param {string} whatsappId 
 * @returns {Promise<number>} Student ID
 */
export async function upsertStudent(registrationNumber, studentName, whatsappId) {
    const query = `
        INSERT INTO students (registration_number, student_name, whatsapp_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (whatsapp_id) 
        DO UPDATE SET
            registration_number = EXCLUDED.registration_number,
            student_name = EXCLUDED.student_name,
            updated_at = CURRENT_TIMESTAMP
        RETURNING id, total_subjects_enrolled
    `;
    
    try {
        const result = await pool.query(query, [registrationNumber, studentName, whatsappId]);
        logger.info('Student upserted', { 
            studentId: result.rows[0].id, 
            registrationNumber, 
            whatsappId 
        });
        return result.rows[0];
    } catch (error) {
        logger.error('Error upserting student', { 
            error: error.message, 
            registrationNumber, 
            whatsappId 
        });
        throw error;
    }
}

/**
 * Find document by hash (for duplicate detection)
 * @param {string} documentHash 
 * @returns {Promise<object|null>}
 */
export async function findDocumentByHash(documentHash) {
    const query = `
        SELECT id, status, created_at, registration_number
        FROM enrollment_documents 
        WHERE document_hash = $1
    `;
    
    try {
        const result = await pool.query(query, [documentHash]);
        return result.rows[0] || null;
    } catch (error) {
        logger.error('Error finding document by hash', { error: error.message, documentHash });
        throw error;
    }
}

/**
 * Insert new enrollment document
 * @param {number} studentId 
 * @param {string} registrationNumber 
 * @param {string} documentHash 
 * @param {string} rawText 
 * @param {object} parsedData 
 * @param {string} whatsappMessageId 
 * @returns {Promise<number>} Document ID
 */
export async function insertDocument(studentId, registrationNumber, documentHash, rawText, parsedData, whatsappMessageId) {
    const query = `
        INSERT INTO enrollment_documents 
            (student_id, registration_number, document_hash, raw_text, parsed_data, status, whatsapp_message_id)
        VALUES ($1, $2, $3, $4, $5, 'pending', $6)
        RETURNING id
    `;
    
    try {
        const result = await pool.query(query, [
            studentId, 
            registrationNumber, 
            documentHash, 
            rawText, 
            JSON.stringify(parsedData),
            whatsappMessageId
        ]);
        
        logger.info('Document inserted', { 
            documentId: result.rows[0].id, 
            studentId, 
            registrationNumber 
        });
        return result.rows[0].id;
    } catch (error) {
        logger.error('Error inserting document', { 
            error: error.message, 
            studentId, 
            registrationNumber 
        });
        throw error;
    }
}

/**
 * Update document status
 * @param {number} documentId 
 * @param {string} newStatus 
 */
export async function updateDocumentStatus(documentId, newStatus) {
    const query = `
        UPDATE enrollment_documents 
        SET status = $1,
            confirmed_at = CASE WHEN $2 = 'confirmed' THEN CURRENT_TIMESTAMP ELSE confirmed_at END,
            processed_at = CASE WHEN $3 = 'completed' THEN CURRENT_TIMESTAMP ELSE processed_at END
        WHERE id = $4
    `;
    
    try {
        await pool.query(query, [newStatus, newStatus, newStatus, documentId]);
        logger.info('Document status updated', { documentId, newStatus });
    } catch (error) {
        logger.error('Error updating document status', { 
            error: error.message, 
            documentId, 
            newStatus 
        });
        throw error;
    }
}

/**
 * Insert enrollment subject
 * @param {number} documentId 
 * @param {object} subject 
 * @param {string} groupJid 
 */
export async function insertSubject(documentId, subject, groupJid) {
    const query = `
        INSERT INTO enrollment_subjects 
            (document_id, sigla, grupo, materia, modalidad, nivel, horario, group_jid)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
    `;
    
    try {
        const result = await pool.query(query, [
            documentId,
            subject.sigla,
            subject.grupo,
            subject.materia,
            subject.modalidad,
            subject.nivel,
            subject.horario,
            groupJid
        ]);
        
        return result.rows[0].id;
    } catch (error) {
        logger.error('Error inserting subject', { 
            error: error.message, 
            documentId, 
            sigla: subject.sigla 
        });
        throw error;
    }
}

/**
 * Get WhatsApp group JID for SIGLA+GRUPO
 * @param {string} sigla 
 * @param {string} grupo 
 * @returns {Promise<string|null>}
 */
export async function getGroupJID(sigla, grupo) {
    const query = `
        SELECT whatsapp_group_jid 
        FROM subject_group_mapping 
        WHERE sigla = $1 AND grupo = $2 AND active = TRUE
    `;
    
    try {
        const result = await pool.query(query, [sigla, grupo]);
        return result.rows[0]?.whatsapp_group_jid || null;
    } catch (error) {
        logger.error('Error getting group JID', { error: error.message, sigla, grupo });
        throw error;
    }
}

/**
 * Get pending document for user
 * @param {string} whatsappId 
 * @returns {Promise<object|null>}
 */
export async function getPendingDocument(whatsappId) {
    const query = `
        SELECT ed.id, ed.parsed_data, ed.status, ed.created_at
        FROM enrollment_documents ed
        JOIN students s ON ed.student_id = s.id
        WHERE s.whatsapp_id = $1 AND ed.status = 'pending'
        ORDER BY ed.created_at DESC
        LIMIT 1
    `;
    
    try {
        const result = await pool.query(query, [whatsappId]);
        return result.rows[0] || null;
    } catch (error) {
        logger.error('Error getting pending document', { error: error.message, whatsappId });
        throw error;
    }
}

/**
 * Get subjects for document
 * @param {number} documentId 
 * @returns {Promise<Array>}
 */
export async function getSubjectsForDocument(documentId) {
    const query = `
        SELECT * FROM enrollment_subjects 
        WHERE document_id = $1
        ORDER BY id
    `;
    
    try {
        const result = await pool.query(query, [documentId]);
        return result.rows;
    } catch (error) {
        logger.error('Error getting subjects for document', { error: error.message, documentId });
        throw error;
    }
}

/**
 * Mark subject as added to group
 * @param {number} subjectId 
 */
export async function markSubjectAdded(subjectId) {
    const query = `
        UPDATE enrollment_subjects 
        SET added_to_group = TRUE, added_at = CURRENT_TIMESTAMP
        WHERE id = $1
    `;
    
    try {
        await pool.query(query, [subjectId]);
        logger.info('Subject marked as added', { subjectId });
    } catch (error) {
        logger.error('Error marking subject as added', { error: error.message, subjectId });
        throw error;
    }
}

/**
 * Get student's total enrolled subjects count
 * @param {string} whatsappId 
 * @returns {Promise<number>}
 */
export async function getStudentSubjectCount(whatsappId) {
    const query = `
        SELECT total_subjects_enrolled 
        FROM students 
        WHERE whatsapp_id = $1
    `;
    
    try {
        const result = await pool.query(query, [whatsappId]);
        return result.rows[0]?.total_subjects_enrolled || 0;
    } catch (error) {
        logger.error('Error getting student subject count', { error: error.message, whatsappId });
        throw error;
    }
}

/**
 * Increment student's enrolled subjects count
 * @param {string} whatsappId 
 * @param {number} count 
 */
export async function incrementStudentSubjectCount(whatsappId, count) {
    const query = `
        UPDATE students 
        SET total_subjects_enrolled = total_subjects_enrolled + $1
        WHERE whatsapp_id = $2
        RETURNING total_subjects_enrolled
    `;
    
    try {
        const result = await pool.query(query, [count, whatsappId]);
        logger.info('Student subject count incremented', { 
            whatsappId, 
            increment: count, 
            newTotal: result.rows[0].total_subjects_enrolled 
        });
    } catch (error) {
        logger.error('Error incrementing subject count', { 
            error: error.message, 
            whatsappId, 
            count 
        });
        throw error;
    }
}

/**
 * Expire old pending documents (called by cleanup task)
 * @param {number} timeoutMinutes 
 * @returns {Promise<number>} Number of expired documents
 */
export async function expireOldDocuments(timeoutMinutes = 10) {
    const query = `
        UPDATE enrollment_documents 
        SET status = 'expired'
        WHERE status = 'pending' 
        AND created_at < NOW() - INTERVAL '${timeoutMinutes} minutes'
        RETURNING id
    `;
    
    try {
        const result = await pool.query(query);
        const expiredCount = result.rows.length;
        
        if (expiredCount > 0) {
            logger.info('Expired old pending documents', { 
                count: expiredCount, 
                timeoutMinutes 
            });
        }
        
        return expiredCount;
    } catch (error) {
        logger.error('Error expiring old documents', { error: error.message });
        throw error;
    }
}

export default pool;
