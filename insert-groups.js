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

const groups = [
    {
        sigla: 'INF428',
        grupo: 'SB',
        materia: 'Sistemas Expertos',
        jid: '120363406888344086@g.us'
    },
    {
        sigla: 'INF423',
        grupo: 'SC',
        materia: 'Redes 2',
        jid: '120363422526785283@g.us'
    }
];

async function insertGroups() {
    console.log('🔄 Insertando grupos en la base de datos...\n');
    
    for (const group of groups) {
        try {
            const query = `
                INSERT INTO subject_group_mapping (sigla, grupo, materia_name, whatsapp_group_jid)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (sigla, grupo) DO NOTHING
                RETURNING *;
            `;
            
            const result = await pool.query(query, [
                group.sigla,
                group.grupo,
                group.materia,
                group.jid
            ]);
            
            if (result.rowCount > 0) {
                console.log(`✅ ${group.sigla}-${group.grupo} insertado correctamente`);
            } else {
                console.log(`⚠️  ${group.sigla}-${group.grupo} ya existe en la DB`);
            }
        } catch (error) {
            console.error(`❌ Error insertando ${group.sigla}-${group.grupo}:`, error.message);
        }
    }
    
    console.log('\n🔍 Verificando grupos insertados...\n');
    
    const verifyQuery = `
        SELECT sigla, grupo, materia_name, whatsapp_group_jid 
        FROM subject_group_mapping 
        ORDER BY sigla, grupo;
    `;
    
    const result = await pool.query(verifyQuery);
    
    console.log(`📊 Total de grupos mapeados: ${result.rowCount}\n`);
    
    result.rows.forEach((row, index) => {
        console.log(`${index + 1}. ${row.sigla}-${row.grupo}: ${row.materia_name}`);
        console.log(`   JID: ${row.whatsapp_group_jid}\n`);
    });
    
    await pool.end();
    console.log('✅ Proceso completado!');
}

insertGroups().catch(error => {
    console.error('❌ Error fatal:', error.message);
    process.exit(1);
});
