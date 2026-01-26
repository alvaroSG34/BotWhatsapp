import { getGroupJID } from './database.js';
import { logger } from './logger.js';

/**
 * Map subjects to WhatsApp groups
 * Adds groupJid and canAdd fields to each subject
 * @param {Array<object>} subjects 
 * @returns {Promise<Array<object>>}
 */
export async function mapSubjectsToGroups(subjects) {
    const mappedSubjects = [];
    
    for (const subject of subjects) {
        const groupJid = await getGroupJID(subject.sigla, subject.grupo);
        
        mappedSubjects.push({
            ...subject,
            groupJid,
            canAdd: !!groupJid
        });
        
        logger.debug('Subject mapped', {
            sigla: subject.sigla,
            grupo: subject.grupo,
            canAdd: !!groupJid
        });
    }
    
    logger.info('Subjects mapping completed', {
        total: subjects.length,
        mapped: mappedSubjects.filter(s => s.canAdd).length,
        unmapped: mappedSubjects.filter(s => !s.canAdd).length
    });
    
    return mappedSubjects;
}

/**
 * Helper to seed initial group mappings
 * Use this to populate the database with initial SIGLA+GRUPO -> JID mappings
 * @param {Array<object>} mappings - Array of { sigla, grupo, materiaName, jid }
 * @returns {Promise<void>}
 */
export async function seedGroupMappings(mappings) {
    const pool = (await import('./database.js')).default;
    
    const query = `
        INSERT INTO subject_group_mapping (sigla, grupo, materia_name, whatsapp_group_jid)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (sigla, grupo) DO UPDATE SET
            whatsapp_group_jid = EXCLUDED.whatsapp_group_jid,
            materia_name = EXCLUDED.materia_name,
            updated_at = CURRENT_TIMESTAMP
    `;
    
    try {
        for (const mapping of mappings) {
            await pool.query(query, [
                mapping.sigla,
                mapping.grupo,
                mapping.materiaName,
                mapping.jid
            ]);
            
            logger.info('Mapping seeded', {
                sigla: mapping.sigla,
                grupo: mapping.grupo,
                jid: mapping.jid
            });
        }
        
        logger.info('All mappings seeded successfully', { count: mappings.length });
    } catch (error) {
        logger.error('Error seeding mappings', { error: error.message });
        throw error;
    }
}

export default {
    mapSubjectsToGroups,
    seedGroupMappings
};
