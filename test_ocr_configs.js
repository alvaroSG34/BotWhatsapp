/**
 * Test de Configuraciones de OCR
 * Prueba diferentes parámetros de preprocesamiento para encontrar la mejor configuración
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import { parseEnrollmentDocument } from './src/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Diferentes configuraciones de preprocesamiento
 */
const PREPROCESS_CONFIGS = {
    // Configuración original
    original: async (buffer) => {
        return await sharp(buffer)
            .rotate()
            .greyscale()
            .normalize()
            .sharpen({ sigma: 1 })
            .toBuffer();
    },
    
    // Configuración mejorada (actual)
    enhanced: async (buffer) => {
        const metadata = await sharp(buffer).metadata();
        const minWidth = 1200;
        const shouldResize = metadata.width < minWidth;
        
        let pipeline = sharp(buffer).rotate();
        
        if (shouldResize) {
            const scale = minWidth / metadata.width;
            pipeline = pipeline.resize({
                width: Math.floor(metadata.width * scale),
                height: Math.floor(metadata.height * scale),
                kernel: sharp.kernel.lanczos3
            });
        }
        
        return await pipeline
            .greyscale()
            .normalize()
            .linear(1.2, -(128 * 1.2) + 128)
            .sharpen({ sigma: 1.5 })
            .toBuffer();
    },
    
    // Configuración agresiva (máximo contraste)
    aggressive: async (buffer) => {
        const metadata = await sharp(buffer).metadata();
        const minWidth = 1500;
        const shouldResize = metadata.width < minWidth;
        
        let pipeline = sharp(buffer).rotate();
        
        if (shouldResize) {
            const scale = minWidth / metadata.width;
            pipeline = pipeline.resize({
                width: Math.floor(metadata.width * scale),
                height: Math.floor(metadata.height * scale),
                kernel: sharp.kernel.lanczos3
            });
        }
        
        return await pipeline
            .greyscale()
            .normalize()
            .linear(1.5, -(128 * 1.5) + 128) // Contraste más agresivo
            .sharpen({ sigma: 2.0 }) // Más sharpening
            .threshold(128) // Binarización
            .toBuffer();
    },
    
    // Configuración suave (para imágenes con ruido)
    soft: async (buffer) => {
        const metadata = await sharp(buffer).metadata();
        const minWidth = 1200;
        const shouldResize = metadata.width < minWidth;
        
        let pipeline = sharp(buffer).rotate();
        
        if (shouldResize) {
            const scale = minWidth / metadata.width;
            pipeline = pipeline.resize({
                width: Math.floor(metadata.width * scale),
                height: Math.floor(metadata.height * scale),
                kernel: sharp.kernel.lanczos3
            });
        }
        
        return await pipeline
            .greyscale()
            .blur(0.5) // Blur suave para reducir ruido
            .normalize()
            .sharpen({ sigma: 1.0 })
            .toBuffer();
    },
    
    // Sin preprocesamiento (solo conversión a escala de grises)
    minimal: async (buffer) => {
        return await sharp(buffer)
            .greyscale()
            .toBuffer();
    }
};

/**
 * Ejecuta OCR con una configuración específica
 */
async function runOCRWithConfig(buffer, configName, configFn) {
    console.log(`\n📊 Probando configuración: ${configName.toUpperCase()}`);
    console.log('─'.repeat(60));
    
    try {
        const startTime = Date.now();
        
        // Preprocesar imagen
        const preprocessed = await configFn(buffer);
        const preprocessTime = Date.now() - startTime;
        
        console.log(`✅ Preprocesamiento: ${preprocessTime}ms`);
        
        // Ejecutar Tesseract
        const ocrStartTime = Date.now();
        const result = await Tesseract.recognize(preprocessed, 'spa');
        const ocrTime = Date.now() - ocrStartTime;
        
        console.log(`✅ OCR completado: ${ocrTime}ms`);
        console.log(`   Confianza: ${result.data.confidence.toFixed(2)}%`);
        console.log(`   Texto extraído: ${result.data.text.length} caracteres`);
        
        // Parsear resultado
        const parsed = parseEnrollmentDocument(result.data.text);
        
        console.log(`\n📋 Resultados del Parser:`);
        console.log(`   Válido: ${parsed.isValid ? '✅ SÍ' : '❌ NO'}`);
        console.log(`   Registro: ${parsed.registrationNumber || '❌ No encontrado'}`);
        console.log(`   Nombre: ${parsed.studentName || '❌ No encontrado'}`);
        console.log(`   Materias: ${parsed.subjects.length}`);
        
        // Guardar imagen preprocesada
        const outputDir = path.join(__dirname, 'debug_output', 'config_tests');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        const outputPath = path.join(outputDir, `${configName}_preprocessed.jpg`);
        fs.writeFileSync(outputPath, preprocessed);
        
        const textPath = path.join(outputDir, `${configName}_text.txt`);
        fs.writeFileSync(textPath, result.data.text);
        
        console.log(`\n💾 Archivos guardados:`);
        console.log(`   Imagen: ${outputPath}`);
        console.log(`   Texto: ${textPath}`);
        
        return {
            config: configName,
            confidence: result.data.confidence,
            textLength: result.data.text.length,
            isValid: parsed.isValid,
            hasRegistration: !!parsed.registrationNumber,
            hasName: !!parsed.studentName,
            subjectCount: parsed.subjects.length,
            totalTime: preprocessTime + ocrTime,
            preprocessTime,
            ocrTime
        };
        
    } catch (error) {
        console.error(`❌ Error con configuración ${configName}:`, error.message);
        return {
            config: configName,
            error: error.message,
            confidence: 0,
            isValid: false
        };
    }
}

/**
 * Compara todas las configuraciones
 */
async function compareConfigurations(imagePath) {
    console.log('🔬 ========================================');
    console.log('🔬 TEST DE CONFIGURACIONES DE OCR');
    console.log('🔬 ========================================\n');
    
    const imageBuffer = fs.readFileSync(imagePath);
    const stats = fs.statSync(imagePath);
    
    console.log('📁 Archivo:', imagePath);
    console.log('📁 Tamaño:', (stats.size / 1024).toFixed(2), 'KB\n');
    
    const results = [];
    
    // Probar cada configuración
    for (const [configName, configFn] of Object.entries(PREPROCESS_CONFIGS)) {
        const result = await runOCRWithConfig(imageBuffer, configName, configFn);
        results.push(result);
        await new Promise(resolve => setTimeout(resolve, 500)); // Pequeño delay entre tests
    }
    
    // ============================================
    // REPORTE COMPARATIVO
    // ============================================
    console.log('\n\n🏆 ========================================');
    console.log('🏆 REPORTE COMPARATIVO');
    console.log('🏆 ========================================\n');
    
    // Tabla comparativa
    console.log('┌─────────────┬────────────┬─────────┬──────────┬─────────┬──────────┐');
    console.log('│ Config      │ Confianza  │ Válido  │ Registro │ Nombre  │ Materias │');
    console.log('├─────────────┼────────────┼─────────┼──────────┼─────────┼──────────┤');
    
    results.forEach(r => {
        const conf = `${r.confidence.toFixed(1)}%`.padEnd(10);
        const valid = r.isValid ? '  ✅ ' : '  ❌ ';
        const reg = r.hasRegistration ? '   ✅ ' : '   ❌ ';
        const name = r.hasName ? '  ✅ ' : '  ❌ ';
        const subs = `   ${r.subjectCount}`.padStart(6);
        
        console.log(`│ ${r.config.padEnd(11)} │ ${conf} │ ${valid} │ ${reg} │ ${name} │ ${subs}   │`);
    });
    
    console.log('└─────────────┴────────────┴─────────┴──────────┴─────────┴──────────┘\n');
    
    // Encontrar la mejor configuración
    const validResults = results.filter(r => r.isValid);
    
    if (validResults.length === 0) {
        console.log('❌ NINGUNA configuración logró parsear el documento correctamente.\n');
        console.log('💡 Esto indica que el problema es:');
        console.log('   1. La imagen tiene muy baja calidad');
        console.log('   2. El formato del documento es diferente al esperado');
        console.log('   3. Los patrones de regex necesitan ajustes\n');
        
        // Mostrar la mejor por confianza
        const bestByConfidence = results.reduce((best, curr) => 
            curr.confidence > best.confidence ? curr : best
        );
        
        console.log(`🥈 Mejor por confianza: ${bestByConfidence.config.toUpperCase()} (${bestByConfidence.confidence.toFixed(1)}%)`);
        console.log('   Revisa el texto extraído en debug_output/\n');
    } else {
        const best = validResults.reduce((best, curr) => {
            // Priorizar: más materias > tiene registro > confianza
            if (curr.subjectCount !== best.subjectCount) {
                return curr.subjectCount > best.subjectCount ? curr : best;
            }
            return curr.confidence > best.confidence ? curr : best;
        });
        
        console.log(`🏆 MEJOR CONFIGURACIÓN: ${best.config.toUpperCase()}\n`);
        console.log(`   ✅ Confianza: ${best.confidence.toFixed(1)}%`);
        console.log(`   ✅ Registro: ${best.hasRegistration ? 'Encontrado' : 'No encontrado'}`);
        console.log(`   ✅ Nombre: ${best.hasName ? 'Encontrado' : 'No encontrado'}`);
        console.log(`   ✅ Materias: ${best.subjectCount}`);
        console.log(`   ⏱️  Tiempo: ${best.totalTime}ms\n`);
        
        if (best.config !== 'enhanced') {
            console.log(`💡 RECOMENDACIÓN: Considera cambiar a la configuración "${best.config}"`);
            console.log(`   en preprocessImage() en src/ocr.js\n`);
        }
    }
    
    console.log('🔍 Archivos de análisis guardados en: debug_output/config_tests/\n');
}

// ============================================
// EJECUCIÓN
// ============================================
const args = process.argv.slice(2);

if (args.length === 0) {
    console.log('❌ Falta argumento\n');
    console.log('Uso: node test_ocr_configs.js <ruta_a_imagen>\n');
    console.log('Ejemplo:');
    console.log('  node test_ocr_configs.js debug_failed_ocr/failed_2026-01-25T22-24-01.jpg');
    console.log('  node test_ocr_configs.js test_images/boleta.jpg\n');
    process.exit(1);
}

const imagePath = path.resolve(args[0]);

if (!fs.existsSync(imagePath)) {
    console.error(`❌ Archivo no encontrado: ${imagePath}`);
    process.exit(1);
}

compareConfigurations(imagePath).catch(error => {
    console.error('\n💥 ERROR FATAL:', error);
    console.error(error.stack);
    process.exit(1);
});
