import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { logger } from './logger.js';
import { getOrCreateGrupoMateria, getActiveSemester } from './database.js';

/**
 * Discover WhatsApp groups and automatically seed them into grupo_materia
 * Run this script to automatically detect groups and create database entries
 * 
 * Usage: npm run discover-groups
 */

async function discoverGroups() {
    logger.info('Starting group discovery script');
    
    const client = new Client({
        authStrategy: new LocalAuth({
            dataPath: './auth_info' // Misma sesión que index.js
        }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        },
        webVersionCache: {
            type: 'none'
        }
    });

    client.on('qr', (qr) => {
        console.log('\n🔐 Escanea este código QR con WhatsApp:\n');
        qrcode.generate(qr, { small: true });
    });

    client.on('authenticated', () => {
        logger.info('WhatsApp authenticated for group discovery');
        console.log('\n✅ Autenticado!\n');
    });

    client.on('ready', async () => {
        logger.info('WhatsApp client ready, discovering groups');
        console.log('\n🔍 Escaneando grupos de WhatsApp...\n');
        console.log('⏳ Esperando 5 segundos para sincronizar grupos nuevos...\n');
        
        // Wait for WhatsApp to sync all groups (especially newly created ones)
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        try {
            const chats = await client.getChats();
            const grupos = chats.filter(chat => chat.isGroup);
            
            console.log(`\n📋 GRUPOS ENCONTRADOS (${grupos.length}):\n`);
            console.log('='.repeat(80));
            
            const insertedGroups = [];
            const failedGroups = [];
            let foundCount = 0;
            
            // Get active semester
            const semestreId = await getActiveSemester();
            logger.info('Using active semester', { semestreId });
            
            for (const grupo of grupos) {
                const name = grupo.name;
                const jid = grupo.id._serialized;
                
                // Try to extract SIGLA + GRUPO from group name
                // Patterns: "INF412 5A", "INF412-5A", "INF412 - 5A", "SISTEMAS OPERATIVOS II - 5A"
                const patterns = [
                    /([A-Z]{3,4}\d{3,4})[.\s-]*(\d[A-Z])/i,  // INF412 5A or INF412-5A
                    /(\d[A-Z])\s*-\s*([A-Z]{3,4}\d{3,4})/i,  // 5A - INF412
                ];
                
                let sigla = null;
                let grupoCode = null;
                
                for (const pattern of patterns) {
                    const match = name.match(pattern);
                    if (match) {
                        sigla = match[1].toUpperCase();
                        grupoCode = match[2].toUpperCase();
                        break;
                    }
                }
                
                if (sigla && grupoCode) {
                    foundCount++;
                    console.log(`\n✅ Grupo ${foundCount}: ${name}`);
                    console.log(`   📌 SIGLA: ${sigla}`);
                    console.log(`   📌 GRUPO: ${grupoCode}`);
                    console.log(`   📌 JID: ${jid}`);
                    
                    try {
                        // Insert into database using getOrCreateGrupoMateria
                        const grupoMateria = await getOrCreateGrupoMateria(
                            sigla,
                            grupoCode,
                            name,
                            jid // Provide JID to auto-create
                        );
                        
                        console.log(`   ✅ Guardado en base de datos (ID: ${grupoMateria.id})`);
                        insertedGroups.push({ sigla, grupoCode, name, jid });
                        
                    } catch (error) {
                        console.log(`   ❌ Error al guardar: ${error.message}`);
                        failedGroups.push({ sigla, grupoCode, name, jid, error: error.message });
                    }
                    
                } else {
                    console.log(`\n⚠️  Grupo: ${name}`);
                    console.log(`   ❌ No se pudo detectar SIGLA/GRUPO automáticamente`);
                    console.log(`   📌 JID: ${jid}`);
                    console.log(`   💡 Mapeo manual requerido`);
                    failedGroups.push({ name, jid, error: 'No pattern match' });
                }
            }
            
            console.log('\n' + '='.repeat(80));
            console.log(`\n📊 RESUMEN:`);
            console.log(`   Total de grupos: ${grupos.length}`);
            console.log(`   Auto-detectados: ${foundCount}`);
            console.log(`   Guardados exitosamente: ${insertedGroups.length}`);
            console.log(`   Requieren mapeo manual: ${failedGroups.length}`);
            
            if (failedGroups.length > 0) {
                console.log(`\n\n⚠️  GRUPOS QUE REQUIEREN MAPEO MANUAL:\n`);
                console.log('='.repeat(80));
                failedGroups.forEach((g, i) => {
                    console.log(`\n${i + 1}. ${g.name || 'N/A'}`);
                    console.log(`   JID: ${g.jid}`);
                    if (g.sigla && g.grupoCode) {
                        console.log(`   SIGLA: ${g.sigla}, GRUPO: ${g.grupoCode}`);
                    }
                    console.log(`   Error: ${g.error}`);
                });
                console.log('\n' + '='.repeat(80));
            }
            
            console.log('\n✅ Descubrimiento completado!\n');
            
        } catch (error) {
            logger.error('Error discovering groups', { error: error.message });
            console.error('\n❌ Error:', error.message);
        } finally {
            await client.destroy();
            process.exit(0);
        }
    });

    client.on('auth_failure', () => {
        logger.error('WhatsApp authentication failed in discovery');
        console.error('\n❌ Error de autenticación. Intenta nuevamente.');
        process.exit(1);
    });

    await client.initialize();
}

// Run the discovery
discoverGroups().catch((error) => {
    logger.error('Fatal error in group discovery', { error: error.message });
    console.error('\n❌ Error fatal:', error.message);
    process.exit(1);
});
