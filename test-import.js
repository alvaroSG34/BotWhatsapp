// Test imports
console.log('Testing imports...');

try {
    console.log('1. Importing OCR module...');
    const ocr = await import('./src/ocr.js');
    console.log('✅ OCR module loaded');
} catch (error) {
    console.error('❌ OCR module error:', error.message);
    console.error(error.stack);
}

try {
    console.log('2. Importing index module...');
    const index = await import('./src/index.js');
    console.log('✅ Index module loaded');
} catch (error) {
    console.error('❌ Index module error:', error.message);
    console.error(error.stack);
}
