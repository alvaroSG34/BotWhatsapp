import Tesseract from 'tesseract.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import sharp from 'sharp';
import OpenAI from 'openai';
import { logger } from './logger.js';

// Initialize OpenAI client only if API key is available
let openai = null;
if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here') {
    openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    });
    logger.info('OpenAI client initialized');
} else {
    logger.info('OpenAI API key not configured, will use OCR.space or Tesseract');
}

/**
 * Use OCR.space API for text extraction
 * @param {Buffer} buffer - Image buffer
 * @param {string} mimeType - Image MIME type
 * @returns {Promise<Object>} Structured data with numero_registro, nombre, materias
 */
async function performOCRSpace(buffer, mimeType) {
    try {
        logger.info('Using OCR.space API for OCR');
        
        if (!process.env.OCR_SPACE_API_KEY) {
            throw new Error('OCR_SPACE_API_KEY not configured');
        }
        
        // Convert buffer to base64
        const base64Image = buffer.toString('base64');
        const dataUrl = `data:${mimeType};base64,${base64Image}`;
        
        // Call OCR.space API
        const response = await fetch('https://api.ocr.space/parse/image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': process.env.OCR_SPACE_API_KEY
            },
            body: JSON.stringify({
                base64Image: dataUrl,
                language: 'spa',
                isOverlayRequired: false,
                detectOrientation: true,
                scale: true,
                OCREngine: 2 // Engine 2 better for structured documents/tables
            })
        });
        
        const data = await response.json();
        
        if (data.IsErroredOnProcessing) {
            throw new Error(data.ErrorMessage?.[0] || 'OCR.space processing error');
        }
        
        const extractedText = data.ParsedResults?.[0]?.ParsedText;
        
        if (!extractedText) {
            throw new Error('No text extracted from OCR.space');
        }
        
        logger.info('OCR.space extraction successful', {
            textLength: extractedText.length,
            exitCode: data.ParsedResults?.[0]?.FileParseExitCode
        });
        
        // Return raw text for parser to handle
        return extractedText;
        
    } catch (error) {
        logger.error('OCR.space error', { error: error.message });
        throw error;
    }
}

/**
 * Preprocess image for better OCR accuracy
 * @param {Buffer} imageBuffer 
 * @returns {Promise<Buffer>}
 */
export async function preprocessImage(imageBuffer) {
    try {
        return await sharp(imageBuffer)
            .rotate() // Auto-rotate based on EXIF
            .greyscale() // Convert to grayscale
            .normalize() // Enhance contrast
            .sharpen({ sigma: 1 }) // Sharpen text
            .toBuffer();
    } catch (error) {
        logger.error('Error preprocessing image', { error: error.message });
        // Return original if preprocessing fails
        return imageBuffer;
    }
}

/**
 * Use OpenAI GPT-4 Vision to extract structured data from boleta image
 * @param {Buffer} buffer - Image buffer
 * @param {string} mimeType - Image MIME type
 * @returns {Promise<Object>} Structured data with numero_registro, nombre, materias
 */
async function performOpenAIVision(buffer, mimeType) {
    try {
        logger.info('Using OpenAI Vision API for OCR');
        
        // Convert buffer to base64
        const base64Image = buffer.toString('base64');
        const dataUrl = `data:${mimeType};base64,${base64Image}`;
        
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: `Analiza la imagen de una boleta de inscripción.

Devuelve ÚNICAMENTE un JSON válido.
NO uses markdown.
NO uses \`\`\`json.
NO incluyas explicaciones.

Regla para numero_registro:
- Solo es válido si contiene EXACTAMENTE 9 dígitos (0-9).
- Si detectas algo que no cumple, devuelve null.
- No uses números de horarios, aulas, códigos u otros identificadores.

Formato exacto:

{
  "numero_registro": "string de 9 dígitos o null",
  "nombre": "NOMBRE COMPLETO EN MAYÚSCULAS",
  "materias": [
    {
      "sigla": "INF412",
      "grupo": "5A",
      "nombre": "SISTEMAS OPERATIVOS"
    }
  ]
}

Extrae TODAS las materias de la tabla. Cada materia debe tener sigla (ej: INF412), grupo (ej: 5A) y nombre completo.`
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: dataUrl
                            }
                        }
                    ]
                }
            ],
            max_tokens: 1000
        });
        
        const content = response.choices[0].message.content.trim();
        logger.info('OpenAI Vision response received', { length: content.length });
        
        // Parse JSON response
        const data = JSON.parse(content);
        
        // Validate structure
        if (!data.materias || !Array.isArray(data.materias)) {
            throw new Error('Invalid response structure from OpenAI');
        }
        
        logger.info('OpenAI Vision parsing successful', {
            hasRegistration: !!data.numero_registro,
            hasName: !!data.nombre,
            subjectCount: data.materias.length
        });
        
        return data;
        
    } catch (error) {
        logger.error('OpenAI Vision error', { error: error.message });
        throw error;
    }
}

/**
 * Perform OCR on document (PDF or image)
 * Cascade: OCR.space → OpenAI Vision → Tesseract
 * @param {Buffer} buffer 
 * @param {string} mimeType 
 * @returns {Promise<string|Object>} Extracted text or structured data
 */
export async function performOCR(buffer, mimeType) {
    try {
        logger.info('Starting OCR processing', { mimeType });

        // For images, try OCR services in order of preference
        if (mimeType.startsWith('image/')) {
            
            // 1. Try OCR.space first (free tier, fast)
            if (process.env.OCR_SPACE_API_KEY) {
                try {
                    const ocrText = await performOCRSpace(buffer, mimeType);
                    logger.info('Using OCR.space result');
                    return ocrText;
                } catch (ocrSpaceError) {
                    logger.warn('OCR.space failed, trying OpenAI Vision', {
                        error: ocrSpaceError.message
                    });
                }
            }
            
            // 2. Try OpenAI Vision (more accurate for structured data)
            if (openai) {
                try {
                    const structuredData = await performOpenAIVision(buffer, mimeType);
                    logger.info('Using OpenAI Vision result');
                    // Return as JSON string for parser compatibility
                    return JSON.stringify(structuredData);
                } catch (visionError) {
                    logger.warn('OpenAI Vision failed, falling back to Tesseract', {
                        error: visionError.message
                    });
                }
            }
            
            // 3. Fallback to Tesseract (offline, always available)
            logger.info('Using Tesseract OCR as fallback');
            const preprocessed = await preprocessImage(buffer);
            const result = await Tesseract.recognize(
                preprocessed,
                'spa',
                {
                    logger: m => {
                        if (m.status === 'recognizing text') {
                            logger.debug('OCR progress', { progress: m.progress });
                        }
                    }
                }
            );
            
            logger.info('Tesseract OCR completed', { 
                confidence: result.data.confidence,
                textLength: result.data.text.length
            });
            
            return result.data.text;
        }

        if (mimeType === 'application/pdf') {
            // Try to extract text from PDF first
            logger.info('Extracting text from PDF');
            const pdfData = await pdfParse(buffer);
            
            // Check if we got meaningful text
            if (pdfData.text && pdfData.text.trim().length > 100) {
                logger.info('PDF text extraction successful', { 
                    length: pdfData.text.length 
                });
                return pdfData.text;
            }
            
            // If text is too short, it's likely a scanned PDF
            logger.warn('PDF text too short, treating as scanned document');
            
            // TODO: Convert PDF to image and apply OCR
            // For now, we'll just return the minimal text
            // In production, you'd want to use pdf2pic here
            return pdfData.text || '';
            
        } else if (mimeType.startsWith('image/')) {
            // Preprocess image for better OCR
            logger.info('Preprocessing image for OCR');
            const preprocessed = await preprocessImage(buffer);
            
            // Perform OCR with Tesseract
            logger.info('Running Tesseract OCR');
            const result = await Tesseract.recognize(
                preprocessed,
                'spa', // Spanish language
                {
                    logger: m => {
                        if (m.status === 'recognizing text') {
                            logger.debug('OCR progress', { progress: m.progress });
                        }
                    }
                }
            );
            
            logger.info('OCR completed successfully', { 
                confidence: result.data.confidence,
                textLength: result.data.text.length
            });
            
            return result.data.text;
        } else {
            throw new Error(`Unsupported MIME type: ${mimeType}`);
        }
    } catch (error) {
        logger.error('Error performing OCR', { 
            error: error.message,
            mimeType 
        });
        throw error;
    }
}

export default { performOCR, preprocessImage };
