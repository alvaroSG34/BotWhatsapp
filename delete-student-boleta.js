/**
 * Script to delete boleta(s) for a student by registration number
 * Allows deleting specific boletas or all student data
 * 
 * Usage:
 *   node delete-student-boleta.js <numero_registro>
 *   node delete-student-boleta.js 222009752
 */

import pool from './src/database.js';
import readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function deleteStudentBoletas() {
    try {
        const numeroRegistro = process.argv[2];
        
        if (!numeroRegistro) {
            console.log('\n❌ Error: Debes proporcionar un número de registro');
            console.log('Uso: node delete-student-boleta.js <numero_registro>');
            console.log('Ejemplo: node delete-student-boleta.js 222009752\n');
            process.exit(1);
        }
        
        console.log(`\n🔍 Buscando estudiante con registro: ${numeroRegistro}\n`);
        
        // Find student
        const studentQuery = await pool.query(`
            SELECT id, numero_registro, nombre_estudiante, id_whatsapp, total_materias_registradas
            FROM estudiantes
            WHERE numero_registro = $1
        `, [numeroRegistro]);
        
        if (studentQuery.rows.length === 0) {
            console.log('❌ No se encontró estudiante con ese número de registro\n');
            process.exit(0);
        }
        
        const student = studentQuery.rows[0];
        console.log('📋 ESTUDIANTE ENCONTRADO:');
        console.log(`   ID: ${student.id}`);
        console.log(`   Nombre: ${student.nombre_estudiante}`);
        console.log(`   Registro: ${student.numero_registro}`);
        console.log(`   WhatsApp: ${student.id_whatsapp}`);
        console.log(`   Materias registradas: ${student.total_materias_registradas || 0}`);
        console.log('');
        
        // Find all boletas
        const boletasQuery = await pool.query(`
            SELECT 
                bi.id,
                bi.documento_hash,
                bi.estado,
                bi.fecha_subida,
                bi.confirmado_en,
                bi.procesado_en,
                (SELECT COUNT(*) FROM boleta_grupo WHERE id_boleta = bi.id) as num_materias
            FROM boletas_inscripciones bi
            WHERE bi.id_estudiante = $1
            ORDER BY bi.fecha_subida DESC
        `, [student.id]);
        
        if (boletasQuery.rows.length === 0) {
            console.log('ℹ️  El estudiante no tiene boletas registradas\n');
            
            const deleteStudent = await question('¿Deseas eliminar el registro del estudiante de todas formas? (si/no): ');
            if (deleteStudent.toLowerCase() === 'si' || deleteStudent.toLowerCase() === 'sí') {
                await pool.query('DELETE FROM estudiantes WHERE id = $1', [student.id]);
                console.log('\n✅ Estudiante eliminado exitosamente\n');
            } else {
                console.log('\n❌ Operación cancelada\n');
            }
            
            rl.close();
            process.exit(0);
        }
        
        console.log(`📄 BOLETAS ENCONTRADAS (${boletasQuery.rows.length}):\n`);
        
        boletasQuery.rows.forEach((boleta, index) => {
            console.log(`   [${index + 1}] ID: ${boleta.id}`);
            console.log(`       Estado: ${boleta.estado}`);
            console.log(`       Materias: ${boleta.num_materias}`);
            console.log(`       Fecha subida: ${new Date(boleta.fecha_subida).toLocaleString()}`);
            console.log(`       Hash: ${boleta.documento_hash.substring(0, 20)}...`);
            console.log('');
        });
        
        // Show detailed info about each boleta's subjects
        for (const boleta of boletasQuery.rows) {
            const subjectsQuery = await pool.query(`
                SELECT 
                    bg.id,
                    bg.estado_agregado,
                    m.codigo_materia as sigla,
                    g.codigo_grupo as grupo,
                    m.nombre as materia
                FROM boleta_grupo bg
                JOIN grupo_materia gm ON bg.id_grupo_materia = gm.id
                JOIN materias m ON gm.id_materia = m.id
                JOIN grupos g ON gm.id_grupo = g.id
                WHERE bg.id_boleta = $1
                ORDER BY bg.id
            `, [boleta.id]);
            
            if (subjectsQuery.rows.length > 0) {
                console.log(`   📚 Materias de boleta ID ${boleta.id}:`);
                subjectsQuery.rows.forEach(subject => {
                    console.log(`       • ${subject.sigla} - Grupo ${subject.grupo} (${subject.estado_agregado})`);
                    console.log(`         ${subject.materia}`);
                });
                console.log('');
            }
        }
        
        // Ask what to delete
        console.log('\n⚠️  OPCIONES DE ELIMINACIÓN:\n');
        console.log('   [1] Eliminar TODAS las boletas (mantener estudiante)');
        console.log('   [2] Eliminar TODO (estudiante + boletas)');
        console.log('   [3] Eliminar boleta específica por ID');
        console.log('   [0] Cancelar\n');
        
        const option = await question('Selecciona una opción: ');
        
        switch (option) {
            case '1':
                // Delete all boletas (cascade deletes boleta_grupo)
                const confirmAll = await question(`\n⚠️  Esto eliminará ${boletasQuery.rows.length} boleta(s) del estudiante. ¿Continuar? (si/no): `);
                if (confirmAll.toLowerCase() === 'si' || confirmAll.toLowerCase() === 'sí') {
                    const result = await pool.query(
                        'DELETE FROM boletas_inscripciones WHERE id_estudiante = $1',
                        [student.id]
                    );
                    
                    // Reset counter
                    await pool.query(
                        'UPDATE estudiantes SET total_materias_registradas = 0 WHERE id = $1',
                        [student.id]
                    );
                    
                    console.log(`\n✅ Se eliminaron ${result.rowCount} boleta(s) exitosamente`);
                    console.log(`✅ Contador de materias reseteado a 0\n`);
                } else {
                    console.log('\n❌ Operación cancelada\n');
                }
                break;
                
            case '2':
                // Delete everything (cascade deletes boletas_inscripciones and boleta_grupo)
                const confirmStudent = await question(`\n⚠️  Esto eliminará el estudiante y TODAS sus boletas (${boletasQuery.rows.length}). ¿Continuar? (si/no): `);
                if (confirmStudent.toLowerCase() === 'si' || confirmStudent.toLowerCase() === 'sí') {
                    const result = await pool.query(
                        'DELETE FROM estudiantes WHERE id = $1',
                        [student.id]
                    );
                    
                    console.log(`\n✅ Estudiante eliminado exitosamente (incluyendo ${boletasQuery.rows.length} boleta(s))`);
                    console.log('✅ Como si nunca hubiera usado el bot\n');
                } else {
                    console.log('\n❌ Operación cancelada\n');
                }
                break;
                
            case '3':
                // Delete specific boleta
                const boletaId = await question('\nIngresa el ID de la boleta a eliminar: ');
                const boletaExists = boletasQuery.rows.find(b => b.id === parseInt(boletaId));
                
                if (!boletaExists) {
                    console.log('\n❌ ID de boleta inválido\n');
                    break;
                }
                
                const confirmSpecific = await question(`\n⚠️  ¿Eliminar boleta ID ${boletaId} con ${boletaExists.num_materias} materia(s)? (si/no): `);
                if (confirmSpecific.toLowerCase() === 'si' || confirmSpecific.toLowerCase() === 'sí') {
                    // Get count of subjects successfully added from this boleta
                    const addedSubjects = await pool.query(`
                        SELECT COUNT(*) as count
                        FROM boleta_grupo
                        WHERE id_boleta = $1 AND estado_agregado = 'agregado'
                    `, [boletaId]);
                    
                    const countToSubtract = parseInt(addedSubjects.rows[0].count);
                    
                    // Delete boleta
                    await pool.query('DELETE FROM boletas_inscripciones WHERE id = $1', [boletaId]);
                    
                    // Update counter
                    if (countToSubtract > 0) {
                        await pool.query(`
                            UPDATE estudiantes 
                            SET total_materias_registradas = GREATEST(0, total_materias_registradas - $1)
                            WHERE id = $2
                        `, [countToSubtract, student.id]);
                    }
                    
                    console.log(`\n✅ Boleta ID ${boletaId} eliminada exitosamente`);
                    if (countToSubtract > 0) {
                        console.log(`✅ Contador de materias reducido en ${countToSubtract}\n`);
                    } else {
                        console.log(`ℹ️  No había materias agregadas en esta boleta\n`);
                    }
                } else {
                    console.log('\n❌ Operación cancelada\n');
                }
                break;
                
            case '0':
                console.log('\n❌ Operación cancelada\n');
                break;
                
            default:
                console.log('\n❌ Opción inválida\n');
                break;
        }
        
        rl.close();
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error(error.stack);
        rl.close();
        process.exit(1);
    }
}

deleteStudentBoletas();
