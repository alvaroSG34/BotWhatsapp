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
    max: 50, // Maximum number of clients in the pool
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
 * Get or create active semester (defaults to current)
 * @returns {Promise<number>} Semester ID
 */
export async function getActiveSemester() {
    const query = `
        SELECT id FROM semestres 
        WHERE activo = TRUE 
        ORDER BY creado_en DESC 
        LIMIT 1
    `;
    
    try {
        const result = await pool.query(query);
        if (result.rows.length > 0) {
            return result.rows[0].id;
        }
        
        // Create default semester if none exists
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;
        const semesterNum = currentMonth <= 6 ? '1' : '2';
        const codigo = `${currentYear}-${semesterNum}`;
        
        const insertQuery = `
            INSERT INTO semestres (codigo, nombre, activo)
            VALUES ($1, $2, TRUE)
            ON CONFLICT (codigo) DO UPDATE SET activo = TRUE
            RETURNING id
        `;
        
        const insertResult = await pool.query(insertQuery, [
            codigo,
            `Semestre ${semesterNum} - ${currentYear}`
        ]);
        
        logger.info('Active semester created', { codigo, id: insertResult.rows[0].id });
        return insertResult.rows[0].id;
    } catch (error) {
        logger.error('Error getting active semester', { error: error.message });
        throw error;
    }
}

/**
 * Upsert student (insert or update)
 * @param {string} registrationNumber 
 * @param {string} studentName 
 * @param {string} whatsappId 
 * @returns {Promise<object>} Student data with ID and counter
 */
export async function upsertStudent(registrationNumber, studentName, whatsappId) {
    const query = `
        INSERT INTO estudiantes (numero_registro, nombre_estudiante, id_whatsapp)
        VALUES ($1, $2, $3)
        ON CONFLICT (id_whatsapp) 
        DO UPDATE SET
            numero_registro = EXCLUDED.numero_registro,
            nombre_estudiante = EXCLUDED.nombre_estudiante,
            actualizado_en = CURRENT_TIMESTAMP
        RETURNING id, total_materias_registradas
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
        SELECT id, estado, fecha_subida as creado_en
        FROM boletas_inscripciones 
        WHERE documento_hash = $1
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
 * @param {string} documentHash 
 * @param {string} rawText 
 * @param {object} parsedData 
 * @param {string} whatsappMessageId 
 * @returns {Promise<number>} Document ID
 */
export async function insertDocument(studentId, documentHash, rawText, parsedData, whatsappMessageId) {
    const semesterId = await getActiveSemester();
    
    const query = `
        INSERT INTO boletas_inscripciones 
            (id_estudiante, id_semestre, documento_hash, texto_raw, datos_parseados, estado, id_mensaje_whatsapp)
        VALUES ($1, $2, $3, $4, $5, 'pendiente', $6)
        RETURNING id
    `;
    
    try {
        const result = await pool.query(query, [
            studentId,
            semesterId,
            documentHash, 
            rawText, 
            JSON.stringify(parsedData),
            whatsappMessageId
        ]);
        
        logger.info('Document inserted', { 
            documentId: result.rows[0].id, 
            studentId,
            semesterId
        });
        return result.rows[0].id;
    } catch (error) {
        logger.error('Error inserting document', { 
            error: error.message, 
            studentId 
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
        UPDATE boletas_inscripciones 
        SET estado = $1,
            confirmado_en = CASE WHEN $2 = 'confirmado' THEN CURRENT_TIMESTAMP ELSE confirmado_en END,
            procesado_en = CASE WHEN $3 = 'completado' THEN CURRENT_TIMESTAMP ELSE procesado_en END
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
 * Get or create materia by codigo
 * @param {string} codigoMateria 
 * @param {string} nombreMateria 
 * @returns {Promise<number>} Materia ID
 */
async function getOrCreateMateria(codigoMateria, nombreMateria) {
    const query = `
        INSERT INTO materias (codigo_materia, nombre)
        VALUES ($1, $2)
        ON CONFLICT (codigo_materia) DO UPDATE SET nombre = EXCLUDED.nombre
        RETURNING id
    `;
    
    const result = await pool.query(query, [codigoMateria, nombreMateria]);
    return result.rows[0].id;
}

/**
 * Get or create grupo by codigo
 * @param {string} codigoGrupo 
 * @returns {Promise<number>} Grupo ID
 */
async function getOrCreateGrupo(codigoGrupo) {
    const query = `
        INSERT INTO grupos (codigo_grupo)
        VALUES ($1)
        ON CONFLICT (codigo_grupo) DO NOTHING
        RETURNING id
    `;
    
    let result = await pool.query(query, [codigoGrupo]);
    
    if (result.rows.length === 0) {
        // Already exists, fetch it
        result = await pool.query(`SELECT id FROM grupos WHERE codigo_grupo = $1`, [codigoGrupo]);
    }
    
    return result.rows[0].id;
}

/**
 * Insert enrollment subject (creates boleta_grupo entry)
 * @param {number} documentId 
 * @param {number} grupoMateriaId - ID from grupo_materia table
 * @returns {Promise<number>} Boleta_grupo ID
 */
export async function insertSubject(documentId, grupoMateriaId) {
    const query = `
        INSERT INTO boleta_grupo 
            (id_boleta, id_grupo_materia, estado_agregado)
        VALUES ($1, $2, 'pendiente')
        RETURNING id
    `;
    
    try {
        const result = await pool.query(query, [documentId, grupoMateriaId]);
        return result.rows[0].id;
    } catch (error) {
        logger.error('Error inserting subject', { 
            error: error.message, 
            documentId,
            grupoMateriaId
        });
        throw error;
    }
}

/**
 * Get or create grupo_materia and return its info
 * @param {string} sigla 
 * @param {string} grupo 
 * @param {string} nombreMateria 
 * @param {string} jidGrupo - WhatsApp group JID (optional for creation)
 * @returns {Promise<object|null>} {id, jid_grupo_whatsapp} or null if not found
 */
export async function getOrCreateGrupoMateria(sigla, grupo, nombreMateria, jidGrupo = null) {
    const semesterId = await getActiveSemester();
    
    try {
        // First try to find existing
        const findQuery = `
            SELECT gm.id, gm.jid_grupo_whatsapp
            FROM grupo_materia gm
            JOIN materias m ON gm.id_materia = m.id
            JOIN grupos g ON gm.id_grupo = g.id
            WHERE m.codigo_materia = $1 
              AND g.codigo_grupo = $2
              AND gm.id_semestre = $3
              AND gm.activo = TRUE
        `;
        
        let result = await pool.query(findQuery, [sigla, grupo, semesterId]);
        
        if (result.rows.length > 0) {
            return result.rows[0];
        }
        
        // Not found and no JID provided = can't create
        if (!jidGrupo) {
            return null;
        }
        
        // Create materia, grupo, and grupo_materia
        const materiaId = await getOrCreateMateria(sigla, nombreMateria);
        const grupoId = await getOrCreateGrupo(grupo);
        
        const insertQuery = `
            INSERT INTO grupo_materia 
                (id_semestre, id_materia, id_grupo, jid_grupo_whatsapp, activo)
            VALUES ($1, $2, $3, $4, TRUE)
            ON CONFLICT (id_semestre, id_materia, id_grupo) 
            DO UPDATE SET jid_grupo_whatsapp = EXCLUDED.jid_grupo_whatsapp
            RETURNING id, jid_grupo_whatsapp
        `;
        
        result = await pool.query(insertQuery, [semesterId, materiaId, grupoId, jidGrupo]);
        
        logger.info('Grupo_materia created', { sigla, grupo, jidGrupo });
        return result.rows[0];
        
    } catch (error) {
        logger.error('Error getting/creating grupo_materia', { error: error.message, sigla, grupo });
        throw error;
    }
}

/**
 * Get WhatsApp group JID for SIGLA+GRUPO (compatibility wrapper)
 * @param {string} sigla 
 * @param {string} grupo 
 * @returns {Promise<string|null>}
 */
export async function getGroupJID(sigla, grupo) {
    try {
        const grupoMateria = await getOrCreateGrupoMateria(sigla, grupo, sigla);
        return grupoMateria?.jid_grupo_whatsapp || null;
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
        SELECT ed.id, ed.datos_parseados, ed.estado, ed.fecha_subida as creado_en
        FROM boletas_inscripciones ed
        JOIN estudiantes s ON ed.id_estudiante = s.id
        WHERE s.id_whatsapp = $1 AND ed.estado IN ('pendiente', 'procesando')
        ORDER BY ed.fecha_subida DESC
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
 * @returns {Promise<Array>} Array with subject info including JID and codes
 */
export async function getSubjectsForDocument(documentId) {
    const query = `
        SELECT 
            bg.id,
            bg.estado_agregado,
            bg.agregado_en,
            bg.intentos,
            bg.error_ultimo,
            gm.jid_grupo_whatsapp as jid_grupo,
            m.codigo_materia as sigla,
            m.nombre as materia,
            g.codigo_grupo as grupo
        FROM boleta_grupo bg
        JOIN grupo_materia gm ON bg.id_grupo_materia = gm.id
        JOIN materias m ON gm.id_materia = m.id
        JOIN grupos g ON gm.id_grupo = g.id
        WHERE bg.id_boleta = $1
        ORDER BY bg.id
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
 * Mark subject as added to group (updates estado_agregado)
 * @param {number} boletaGrupoId - ID from boleta_grupo table
 */
export async function markSubjectAdded(boletaGrupoId) {
    const query = `
        UPDATE boleta_grupo 
        SET estado_agregado = 'agregado',
            agregado_en = CURRENT_TIMESTAMP,
            intentos = intentos + 1
        WHERE id = $1
    `;
    
    try {
        await pool.query(query, [boletaGrupoId]);
        logger.info('Subject marked as added', { boletaGrupoId });
    } catch (error) {
        logger.error('Error marking subject as added', { error: error.message, boletaGrupoId });
        throw error;
    }
}

/**
 * Mark subject addition as failed
 * @param {number} boletaGrupoId 
 * @param {string} errorMessage 
 */
export async function markSubjectFailed(boletaGrupoId, errorMessage) {
    const query = `
        UPDATE boleta_grupo 
        SET estado_agregado = 'fallido',
            intentos = intentos + 1,
            error_ultimo = $2
        WHERE id = $1
    `;
    
    try {
        await pool.query(query, [boletaGrupoId, errorMessage]);
        logger.warn('Subject marked as failed', { boletaGrupoId, errorMessage });
    } catch (error) {
        logger.error('Error marking subject as failed', { error: error.message, boletaGrupoId });
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
        SELECT total_materias_registradas 
        FROM estudiantes 
        WHERE id_whatsapp = $1
    `;
    
    try {
        const result = await pool.query(query, [whatsappId]);
        return result.rows[0]?.total_materias_registradas || 0;
    } catch (error) {
        logger.error('Error getting student subject count', { error: error.message, whatsappId });
        throw error;
    }
}

/**
 * NOTE: incrementStudentSubjectCount is NO LONGER NEEDED
 * The trigger actualizar_total_materias_estudiante() handles this automatically
 * when boleta_grupo.estado_agregado changes to 'agregado'
 */

/**
 * Expire old pending documents (called by cleanup task)
 * @param {number} timeoutMinutes 
 * @returns {Promise<number>} Number of expired documents
 */
export async function expireOldDocuments(timeoutMinutes = 10) {
    const query = `
        UPDATE boletas_inscripciones 
        SET estado = 'expirado'
        WHERE estado = 'pendiente' 
        AND fecha_subida < NOW() - INTERVAL '${timeoutMinutes} minutes'
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
