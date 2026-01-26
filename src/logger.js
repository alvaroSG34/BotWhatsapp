import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define log format
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

// Console format with colors
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...metadata }) => {
        let msg = `${timestamp} [${level}]: ${message}`;
        
        // Add metadata if present
        if (Object.keys(metadata).length > 0) {
            msg += ` ${JSON.stringify(metadata)}`;
        }
        
        return msg;
    })
);

// Create logger instance
export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [
        // File transport for all logs
        new winston.transports.File({
            filename: path.join(__dirname, '../logs/bot.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        // File transport for errors only
        new winston.transports.File({
            filename: path.join(__dirname, '../logs/error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        // Console transport with colors
        new winston.transports.Console({
            format: consoleFormat
        })
    ],
    // Handle exceptions and rejections
    exceptionHandlers: [
        new winston.transports.File({ 
            filename: path.join(__dirname, '../logs/exceptions.log') 
        })
    ],
    rejectionHandlers: [
        new winston.transports.File({ 
            filename: path.join(__dirname, '../logs/rejections.log') 
        })
    ]
});

// Create logs directory if it doesn't exist
import fs from 'fs';
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

export default logger;
