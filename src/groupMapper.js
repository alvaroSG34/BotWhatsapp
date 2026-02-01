import { getOrCreateGrupoMateria } from './database.js';
import { logger } from './logger.js';

/**
 * Map subjects to WhatsApp groups (creates grupo_materia entries if needed)
 * Adds grupoMateriaId, groupJid and canAdd fields to each subject
 * @param {Array<object>} subjects 
 * @returns {Promise<Array<object>>}
 */
export async function mapSubjectsToGroups(subjects) {
    const mappedSubjects = [];
    
    for (const subject of subjects) {
        // Try to get or create grupo_materia entry
        const grupoMateria = await getOrCreateGrupoMateria(
            subject.sigla, 
            subject.grupo,
            subject.materia,
            null // Don't auto-create if not exists (will return null)
        );
        
        mappedSubjects.push({
            ...subject,
            grupoMateriaId: grupoMateria?.id || null,
            groupJid: grupoMateria?.jid_grupo_whatsapp || null,
            canAdd: !!grupoMateria
        });
        
        logger.debug('Subject mapped', {
            sigla: subject.sigla,
            grupo: subject.grupo,
            grupoMateriaId: grupoMateria?.id,
            canAdd: !!grupoMateria
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
 * Helper to seed initial group mappings into new schema
 * Creates entries in materias, grupos, and grupo_materia tables
 * @param {Array<object>} mappings - Array of { sigla, grupo, materiaName, jid }
 * @returns {Promise<void>}
 */
export async function seedGroupMappings(mappings) {
    const { getOrCreateGrupoMateria } = await import('./database.js');
    
    try {
        for (const mapping of mappings) {
            await getOrCreateGrupoMateria(
                mapping.sigla,
                mapping.grupo,
                mapping.materiaName,
                mapping.jid // Provide JID to auto-create
            );
            
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
