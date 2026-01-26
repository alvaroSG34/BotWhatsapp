/**
 * Test de Estrés - Simulación de Avalancha de Tráfico
 * Simula 20 usuarios interactuando simultáneamente con el bot
 */

// ============================================
// 1. MOCK DE SOCKET (Simula Baileys)
// ============================================
class MockSocket {
    constructor() {
        this.messagesSent = 0;
        this.updatesSent = 0;
    }

    async sendMessage(jid, content) {
        // Simular latencia de red aleatoria (50-300ms)
        const latency = Math.floor(Math.random() * 250) + 50;
        await this.delay(latency);
        
        this.messagesSent++;
        console.log(`  📤 [SOCKET] Mensaje enviado a ${jid} (latencia: ${latency}ms)`);
        return { key: { id: `msg_${Date.now()}` } };
    }

    async groupParticipantsUpdate(groupId, participants, action) {
        // Simular latencia de red aleatoria (50-200ms)
        const latency = Math.floor(Math.random() * 150) + 50;
        await this.delay(latency);
        
        this.updatesSent++;
        console.log(`  📤 [SOCKET] Update de grupo enviado (latencia: ${latency}ms)`);
        return { status: 200 };
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getStats() {
        return {
            messagesSent: this.messagesSent,
            updatesSent: this.updatesSent
        };
    }
}

// ============================================
// 2. MOCK DE MEMORIA (Map compartida)
// ============================================
class MockMemory {
    constructor() {
        this.storage = new Map();
        this.operations = 0;
    }

    set(key, value) {
        this.operations++;
        this.storage.set(key, value);
        console.log(`  💾 [MEMORY] SET: ${key} = ${JSON.stringify(value)}`);
    }

    get(key) {
        this.operations++;
        const value = this.storage.get(key);
        console.log(`  💾 [MEMORY] GET: ${key} = ${value ? JSON.stringify(value) : 'undefined'}`);
        return value;
    }

    has(key) {
        return this.storage.has(key);
    }

    delete(key) {
        this.operations++;
        const result = this.storage.delete(key);
        console.log(`  💾 [MEMORY] DELETE: ${key} = ${result}`);
        return result;
    }

    getStats() {
        return {
            operations: this.operations,
            currentSize: this.storage.size
        };
    }
}

// ============================================
// 3. LÓGICA DEL BOT (Dummy Implementation)
// ============================================
async function handleMessage(msg, socket, memory) {
    const userJid = msg.from;
    const messageText = msg.text || '';
    const hasImage = msg.hasImage || false;

    console.log(`\n🔵 [BOT] Procesando mensaje de ${userJid}`);

    // Estado 1: Usuario envía FOTO
    if (hasImage) {
        console.log(`  📸 [BOT] Detectada imagen de ${userJid}`);
        
        // Simular procesamiento de OCR/imagen (500ms)
        await delay(500);
        
        // Guardar en memoria
        memory.set(userJid, {
            state: 'waiting_confirmation',
            imageProcessedAt: Date.now(),
            data: 'extracted_data_from_image'
        });

        // Responder al usuario
        await socket.sendMessage(userJid, { 
            text: '✅ Imagen procesada correctamente. Responde "LISTO" para continuar.' 
        });

        console.log(`  ✅ [BOT] Estado 1 completado para ${userJid}`);
        return { success: true, state: 1 };
    }

    // Estado 2: Usuario responde "LISTO"
    if (messageText.toUpperCase() === 'LISTO') {
        console.log(`  📝 [BOT] Recibido "LISTO" de ${userJid}`);

        // Verificar si hay datos en memoria
        if (!memory.has(userJid)) {
            console.error(`  ❌ [ERROR] No hay datos en memoria para ${userJid} (RACE CONDITION DETECTADA)`);
            await socket.sendMessage(userJid, { 
                text: '❌ Error: No encontré tu imagen. Por favor, envíala nuevamente.' 
            });
            return { success: false, state: 2, error: 'NO_DATA_IN_MEMORY' };
        }

        const userData = memory.get(userJid);

        // Verificar que el estado sea correcto
        if (userData.state !== 'waiting_confirmation') {
            console.error(`  ❌ [ERROR] Estado incorrecto para ${userJid}: ${userData.state}`);
            return { success: false, state: 2, error: 'INVALID_STATE' };
        }

        // Simular llamada a API externa (1000ms)
        console.log(`  🌐 [BOT] Llamando a API para ${userJid}...`);
        await delay(1000);
        console.log(`  🌐 [BOT] API respondió para ${userJid}`);

        // Eliminar de memoria
        memory.delete(userJid);

        // Responder al usuario
        await socket.sendMessage(userJid, { 
            text: '🎉 ¡Proceso completado exitosamente!' 
        });

        console.log(`  ✅ [BOT] Estado 2 completado para ${userJid}`);
        return { success: true, state: 2 };
    }

    // Mensaje no reconocido
    console.log(`  ⚠️ [BOT] Mensaje no reconocido de ${userJid}`);
    return { success: false, state: 0, error: 'UNKNOWN_MESSAGE' };
}

// ============================================
// 4. UTILIDADES
// ============================================
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function generateUserJids(count) {
    return Array.from({ length: count }, (_, i) => `user${i + 1}@s.whatsapp.net`);
}

// ============================================
// 5. PRUEBA DE ESTRÉS (THE AVALANCHE)
// ============================================
async function runStressTest() {
    console.log('🚀 ========================================');
    console.log('🚀 INICIANDO PRUEBA DE ESTRÉS');
    console.log('🚀 Simulando 20 usuarios simultáneos');
    console.log('🚀 ========================================\n');

    const testStartTime = Date.now();
    
    // Inicializar infraestructura
    const socket = new MockSocket();
    const memory = new MockMemory();
    const userJids = generateUserJids(20);
    
    // Estadísticas
    const stats = {
        phase1Success: 0,
        phase1Failures: 0,
        phase2Success: 0,
        phase2Failures: 0,
        raceConditions: 0,
        errors: []
    };

    // ============================================
    // FASE 1: AVALANCHA DE IMÁGENES (20 usuarios simultáneos)
    // ============================================
    console.log('\n📸 ========================================');
    console.log('📸 FASE 1: AVALANCHA DE IMÁGENES');
    console.log('📸 ========================================\n');

    const phase1StartTime = Date.now();

    const phase1Promises = userJids.map(async (jid, index) => {
        const userStartTime = Date.now();
        console.log(`🚀 [USER ${index + 1}] Iniciando envío de imagen...`);

        try {
            const result = await handleMessage(
                { from: jid, hasImage: true },
                socket,
                memory
            );

            const userEndTime = Date.now();
            const userDuration = userEndTime - userStartTime;

            console.log(`⏱️ [USER ${index + 1}] Completado en ${userDuration}ms`);

            if (result.success) {
                stats.phase1Success++;
            } else {
                stats.phase1Failures++;
                stats.errors.push({ user: jid, phase: 1, error: result.error });
            }

            return { jid, success: result.success, duration: userDuration };
        } catch (error) {
            console.error(`❌ [USER ${index + 1}] Error: ${error.message}`);
            stats.phase1Failures++;
            stats.errors.push({ user: jid, phase: 1, error: error.message });
            return { jid, success: false, duration: 0 };
        }
    });

    const phase1Results = await Promise.all(phase1Promises);
    const phase1EndTime = Date.now();
    const phase1Duration = phase1EndTime - phase1StartTime;

    console.log('\n✅ FASE 1 COMPLETADA');
    console.log(`⏱️ Tiempo total: ${phase1Duration}ms`);
    console.log(`📊 Exitosos: ${stats.phase1Success}/20`);
    console.log(`📊 Fallidos: ${stats.phase1Failures}/20`);

    // Verificar estado de la memoria después de Fase 1
    console.log(`\n💾 Estado de memoria: ${memory.storage.size} usuarios almacenados`);
    if (memory.storage.size !== 20) {
        console.error(`❌ ¡ADVERTENCIA! Se esperaban 20 usuarios en memoria, pero hay ${memory.storage.size}`);
    }

    // ============================================
    // PEQUEÑO DELAY (opcional, para ver si afecta)
    // ============================================
    console.log('\n⏸️ Esperando 100ms antes de Fase 2...\n');
    await delay(100);

    // ============================================
    // FASE 2: AVALANCHA DE "LISTO" (20 usuarios simultáneos)
    // ============================================
    console.log('\n📝 ========================================');
    console.log('📝 FASE 2: AVALANCHA DE "LISTO"');
    console.log('📝 ========================================\n');

    const phase2StartTime = Date.now();

    const phase2Promises = userJids.map(async (jid, index) => {
        const userStartTime = Date.now();
        console.log(`🚀 [USER ${index + 1}] Enviando "LISTO"...`);

        try {
            const result = await handleMessage(
                { from: jid, text: 'LISTO' },
                socket,
                memory
            );

            const userEndTime = Date.now();
            const userDuration = userEndTime - userStartTime;

            console.log(`⏱️ [USER ${index + 1}] Completado en ${userDuration}ms`);

            if (result.success) {
                stats.phase2Success++;
            } else {
                stats.phase2Failures++;
                if (result.error === 'NO_DATA_IN_MEMORY') {
                    stats.raceConditions++;
                }
                stats.errors.push({ user: jid, phase: 2, error: result.error });
            }

            return { jid, success: result.success, duration: userDuration };
        } catch (error) {
            console.error(`❌ [USER ${index + 1}] Error: ${error.message}`);
            stats.phase2Failures++;
            stats.errors.push({ user: jid, phase: 2, error: error.message });
            return { jid, success: false, duration: 0 };
        }
    });

    const phase2Results = await Promise.all(phase2Promises);
    const phase2EndTime = Date.now();
    const phase2Duration = phase2EndTime - phase2StartTime;

    console.log('\n✅ FASE 2 COMPLETADA');
    console.log(`⏱️ Tiempo total: ${phase2Duration}ms`);
    console.log(`📊 Exitosos: ${stats.phase2Success}/20`);
    console.log(`📊 Fallidos: ${stats.phase2Failures}/20`);

    // Verificar estado de la memoria después de Fase 2
    console.log(`\n💾 Estado de memoria: ${memory.storage.size} usuarios almacenados`);
    if (memory.storage.size !== 0) {
        console.error(`❌ ¡ADVERTENCIA! Se esperaban 0 usuarios en memoria, pero hay ${memory.storage.size}`);
        console.error(`❌ Usuarios restantes en memoria:`, Array.from(memory.storage.keys()));
    }

    // ============================================
    // REPORTE FINAL
    // ============================================
    const testEndTime = Date.now();
    const totalDuration = testEndTime - testStartTime;

    console.log('\n🎯 ========================================');
    console.log('🎯 REPORTE FINAL');
    console.log('🎯 ========================================\n');

    console.log(`⏱️  TIEMPO TOTAL DE EJECUCIÓN: ${totalDuration}ms`);
    console.log(`⏱️  - Fase 1 (Imágenes): ${phase1Duration}ms`);
    console.log(`⏱️  - Fase 2 (LISTO): ${phase2Duration}ms\n`);

    console.log('📊 RESULTADOS POR FASE:');
    console.log(`   Fase 1: ${stats.phase1Success}/20 exitosos, ${stats.phase1Failures}/20 fallidos`);
    console.log(`   Fase 2: ${stats.phase2Success}/20 exitosos, ${stats.phase2Failures}/20 fallidos\n`);

    const totalSuccess = stats.phase1Success === 20 && stats.phase2Success === 20 ? 20 : stats.phase2Success;
    const totalFailures = stats.phase1Failures + stats.phase2Failures;

    console.log(`✅ USUARIOS PROCESADOS CORRECTAMENTE: ${totalSuccess}/20`);
    console.log(`❌ ERRORES TOTALES: ${totalFailures}`);
    console.log(`⚠️  RACE CONDITIONS DETECTADAS: ${stats.raceConditions}\n`);

    // Estadísticas de infraestructura
    const socketStats = socket.getStats();
    const memoryStats = memory.getStats();
    
    console.log('📈 ESTADÍSTICAS DE INFRAESTRUCTURA:');
    console.log(`   Socket - Mensajes enviados: ${socketStats.messagesSent}`);
    console.log(`   Socket - Updates enviados: ${socketStats.updatesSent}`);
    console.log(`   Memoria - Operaciones totales: ${memoryStats.operations}`);
    console.log(`   Memoria - Tamaño final: ${memoryStats.currentSize}\n`);

    // Detalles de errores
    if (stats.errors.length > 0) {
        console.log('❌ DETALLE DE ERRORES:');
        stats.errors.forEach((err, i) => {
            console.log(`   ${i + 1}. Usuario: ${err.user}, Fase: ${err.phase}, Error: ${err.error}`);
        });
        console.log('');
    }

    // Conclusión
    console.log('🎯 CONCLUSIÓN:');
    if (totalSuccess === 20 && stats.raceConditions === 0) {
        console.log('   ✅ ¡EXCELENTE! El sistema maneja correctamente la carga concurrente.');
    } else if (stats.raceConditions > 0) {
        console.log('   ⚠️  Se detectaron RACE CONDITIONS. El sistema necesita mejoras en sincronización.');
    } else {
        console.log('   ❌ El sistema falló bajo carga concurrente. Se requieren optimizaciones.');
    }

    console.log('\n🎯 ========================================\n');

    // Salir con código de error si hubo fallos
    if (totalFailures > 0 || stats.raceConditions > 0) {
        process.exit(1);
    }
}

// ============================================
// EJECUTAR PRUEBA
// ============================================
runStressTest().catch(error => {
    console.error('\n💥 ERROR FATAL:', error);
    console.error(error.stack);
    process.exit(1);
});
