import http from 'http';
import { logger } from './logger.js';
import { queueManager, initDocument } from './queueManager.js';

const DEFAULT_PORT = process.env.BOT_ADMIN_PORT || 3001;
const ADMIN_TOKEN = process.env.BOT_ADMIN_TOKEN || '';
const MAX_GROUPS = 20;

function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => {
            try {
                const obj = data ? JSON.parse(data) : {};
                resolve(obj);
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

function randomSuffix(len = 6) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
}

export function startAdminApi(client) {
    const port = Number(process.env.BOT_ADMIN_PORT || DEFAULT_PORT);

    const server = http.createServer(async (req, res) => {
        try {
            if (req.method === 'POST' && req.url === '/admin/create-groups') {
                const token = req.headers['x-bot-token'] || '';
                if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Unauthorized' }));
                    return;
                }

                const body = await parseJsonBody(req);
                const nro = body.nro_telefono || body.nroTelefono || body.nro || null;
                const cantidad = Number(body.cantidad_grupos || body.cantidad || 0);

                if (!nro || !/^[0-9]+$/.test(String(nro))) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid nro_telefono' }));
                    return;
                }

                if (!cantidad || cantidad <= 0 || cantidad > MAX_GROUPS) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: `cantidad_grupos must be 1..${MAX_GROUPS}` }));
                    return;
                }

                // build user JID (expects international format without plus)
                const userJid = `${String(nro)}@c.us`;

                const queued = [];

                // Create a batch/document id to track progress and summary notification
                const batchId = `admin_create_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
                initDocument(batchId, cantidad);

                for (let i = 0; i < cantidad; i++) {
                    const name = `AutoGrupo_${randomSuffix(6)}`;
                    const job = {
                        type: 'create_group',
                        groupName: name,
                        userId: userJid,
                        documentId: batchId,
                        materiaNombre: name
                    };
                    queueManager.addJob(job);
                    queued.push({ groupName: name });
                }

                logger.info('Admin create-groups queued', { user: userJid, count: queued.length });

                res.writeHead(202, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ queued: queued.length, groups: queued }));
                return;
            }

            // not found
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        } catch (error) {
            logger.error('Admin API error', { error: error.message });
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    });

    server.listen(port, () => {
        logger.info('Admin API server started', { port });
        console.log(`🔐 Admin API listening on http://localhost:${port}`);
    });

    return server;
}

export default startAdminApi;
