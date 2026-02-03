/**
 * Validation Helpers
 * Functions to validate student data and detect changes in enrollment documents
 */

import { logger } from './logger.js';
import pool from './database.js';

/**
 * Check if student's registration number matches their existing record
 * @param {string} whatsappId - Student WhatsApp ID
 * @param {string} newRegistrationNumber - Registration number from new boleta
 * @returns {Promise<{isValid: boolean, existingRegistration: string|null}>}
 */
export async function validateRegistrationNumberConsistency(whatsappId, newRegistrationNumber) {
    const query = `
        SELECT numero_registro 
        FROM estudiantes 
        WHERE id_whatsapp = $1
    `;
    
    try {
        const result = await pool.query(query, [whatsappId]);
        
        if (result.rows.length === 0) {
            // No existing record - first time student
            return { isValid: true, existingRegistration: null };
        }
        
        const existingRegistration = result.rows[0].numero_registro;
        
        // Check if registration numbers match
        const isValid = existingRegistration === newRegistrationNumber;
        
        if (!isValid) {
            logger.warn('Registration number mismatch detected', {
                whatsappId,
                existingRegistration,
                newRegistrationNumber
            });
        }
        
        return { isValid, existingRegistration };
        
    } catch (error) {
        logger.error('Error validating registration number consistency', {
            error: error.message,
            whatsappId
        });
        throw error;
    }
}

/**
 * Get all successfully added subjects for a student
 * @param {string} whatsappId - Student WhatsApp ID
 * @returns {Promise<Array<{sigla: string, grupo: string}>>}
 */
export async function getStudentAddedSubjects(whatsappId) {
    const query = `
        SELECT DISTINCT 
            m.codigo_materia as sigla,
            g.codigo_grupo as grupo
        FROM boleta_grupo bg
        JOIN boletas_inscripciones bi ON bg.id_boleta = bi.id
        JOIN estudiantes e ON bi.id_estudiante = e.id
        JOIN grupo_materia gm ON bg.id_grupo_materia = gm.id
        JOIN materias m ON gm.id_materia = m.id
        JOIN grupos g ON gm.id_grupo = g.id
        WHERE e.id_whatsapp = $1 
          AND bg.estado_agregado = 'agregado'
        ORDER BY m.codigo_materia, g.codigo_grupo
    `;
    
    try {
        const result = await pool.query(query, [whatsappId]);
        return result.rows;
    } catch (error) {
        logger.error('Error getting student added subjects', {
            error: error.message,
            whatsappId
        });
        throw error;
    }
}

/**
 * Compare new subjects with already added subjects to find truly new ones
 * @param {Array<{sigla: string, grupo: string}>} newSubjects - Subjects from new boleta
 * @param {Array<{sigla: string, grupo: string}>} addedSubjects - Already added subjects
 * @returns {{newSubjects: Array, duplicateSubjects: Array}}
 */
export function compareSubjects(newSubjects, addedSubjects) {
    const addedSet = new Set(
        addedSubjects.map(s => `${s.sigla}-${s.grupo}`)
    );
    
    const newOnes = [];
    const duplicates = [];
    
    for (const subject of newSubjects) {
        const key = `${subject.sigla}-${subject.grupo}`;
        if (addedSet.has(key)) {
            duplicates.push(subject);
        } else {
            newOnes.push(subject);
        }
    }
    
    logger.debug('Subject comparison results', {
        totalInBoleta: newSubjects.length,
        alreadyAdded: duplicates.length,
        trulyNew: newOnes.length
    });
    
    return {
        newSubjects: newOnes,
        duplicateSubjects: duplicates
    };
}

export default {
    validateRegistrationNumberConsistency,
    getStudentAddedSubjects,
    compareSubjects
};
