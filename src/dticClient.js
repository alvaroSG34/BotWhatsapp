import { logger } from './logger.js';

const DTIC_URL = process.env.DTIC_URL || 'http://localhost:5000';
const DEFAULT_TIMEOUT_MS = 10_000;

export async function fetchBoletaFromDTIC(token) {
  try {
    const url = `${DTIC_URL}/boletas/${encodeURIComponent(token)}`;
    logger.info('Fetching boleta from DTIC', { url, tokenLength: token?.length });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.status === 404) {
      logger.info('DTIC returned 404 for token', { token });
      return null;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DTIC error ${res.status}: ${text}`);
    }

    const data = await res.json();

    logger.info('DTIC returned boleta', { token, student: data.estudiante?.registro || data.Nro_registro || null });
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.error('DTIC request timed out', { token });
      throw new Error('DTIC request timed out');
    }
    logger.error('Error fetching boleta from DTIC', { error: error.message, token });
    throw error;
  }
}

export default { fetchBoletaFromDTIC };
