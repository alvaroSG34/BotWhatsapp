import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: {
        rejectUnauthorized: false
    }
});

/**
 * Delete all enrollment data for a student by registration number
 * @param {string} registrationNumber 
 */
async function deleteStudentEnrollments(registrationNumber) {
    try {
        console.log(`\n🔍 Buscando estudiante con registro: ${registrationNumber}\n`);
        
        // Find student
        const studentQuery = `
            SELECT id, registration_number, student_name, whatsapp_id, total_subjects_enrolled
            FROM students
            WHERE registration_number = $1
        `;
        
        const studentResult = await pool.query(studentQuery, [registrationNumber]);
        
        if (studentResult.rows.length === 0) {
            console.log(`❌ No se encontró estudiante con registro: ${registrationNumber}`);
            await pool.end();
            return;
        }
        
        const student = studentResult.rows[0];
        console.log(`✅ Estudiante encontrado:`);
        console.log(`   Nombre: ${student.student_name}`);
        console.log(`   WhatsApp: ${student.whatsapp_id}`);
        console.log(`   Materias inscritas: ${student.total_subjects_enrolled}\n`);
        
        // Find documents
        const documentsQuery = `
            SELECT id, status, created_at
            FROM enrollment_documents
            WHERE student_id = $1
        `;
        
        const documentsResult = await pool.query(documentsQuery, [student.id]);
        console.log(`📄 Documentos encontrados: ${documentsResult.rows.length}\n`);
        
        if (documentsResult.rows.length === 0) {
            console.log(`⚠️  El estudiante no tiene documentos registrados.`);
            await pool.end();
            return;
        }
        
        // Show documents
        documentsResult.rows.forEach((doc, index) => {
            console.log(`   ${index + 1}. Documento ID ${doc.id} - Status: ${doc.status} - Creado: ${doc.created_at}`);
        });
        
        console.log(`\n⚠️  ¿CONFIRMAS LA ELIMINACIÓN?\n`);
        console.log(`Se eliminarán:`);
        console.log(`   - ${documentsResult.rows.length} documento(s)`);
        console.log(`   - Todas las materias asociadas`);
        console.log(`   - El contador de materias se reseteará\n`);
        
        // Wait for confirmation (in production, you'd add actual prompt)
        // For now, we'll execute directly
        
        console.log(`🗑️  Eliminando datos...\n`);
        
        // Delete enrollment_subjects (cascade will handle this, but explicit is better)
        const deleteSubjectsQuery = `
            DELETE FROM enrollment_subjects
            WHERE document_id IN (
                SELECT id FROM enrollment_documents WHERE student_id = $1
            )
        `;
        const subjectsResult = await pool.query(deleteSubjectsQuery, [student.id]);
        console.log(`✅ Materias eliminadas: ${subjectsResult.rowCount}`);
        
        // Delete enrollment_documents
        const deleteDocsQuery = `
            DELETE FROM enrollment_documents
            WHERE student_id = $1
        `;
        const docsResult = await pool.query(deleteDocsQuery, [student.id]);
        console.log(`✅ Documentos eliminados: ${docsResult.rowCount}`);
        
        // Reset student counter
        const resetCounterQuery = `
            UPDATE students
            SET total_subjects_enrolled = 0
            WHERE id = $1
        `;
        await pool.query(resetCounterQuery, [student.id]);
        console.log(`✅ Contador de materias reseteado a 0`);
        
        console.log(`\n🎉 ¡Proceso completado!`);
        console.log(`\n💡 El estudiante "${student.student_name}" puede subir una nueva boleta.`);
        
    } catch (error) {
        console.error(`\n❌ Error fatal:`, error.message);
        console.error(error.stack);
    } finally {
        await pool.end();
    }
}

// Get registration number from command line
const registrationNumber = process.argv[2];

if (!registrationNumber) {
    console.log(`\n❌ Error: Debes proporcionar un número de registro\n`);
    console.log(`Uso: node delete-student-enrollments.js <numero_registro>\n`);
    console.log(`Ejemplo: node delete-student-enrollments.js 222009969\n`);
    process.exit(1);
}

deleteStudentEnrollments(registrationNumber);
