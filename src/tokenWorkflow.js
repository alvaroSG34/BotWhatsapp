import pool from './database.js';
import { logger } from './logger.js';

/**
 * Reserve a DTIC token and create local boleta + boleta_grupo rows in a single transaction.
 * Returns { success: boolean, reason?: string, documentId?: number, insertedSubjects?: number }
 */
export async function reserveTokenAndCreateBoleta(token, remoteBoleta, whatsappId, messageId = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Attempt to reserve the token atomically
    const reserveSql = `
      INSERT INTO dtic_tokens_usados (token, remote_boleta_id, id_whatsapp)
      VALUES ($1, $2, $3)
      ON CONFLICT (token) DO NOTHING
      RETURNING token
    `;
    const reserveRes = await client.query(reserveSql, [token, remoteBoleta?.id || null, whatsappId]);
    if (reserveRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, reason: 'token_already_used' };
    }

    // Upsert student (by id_whatsapp)
    const registro = remoteBoleta?.estudiante?.registro || remoteBoleta?.Nro_registro || remoteBoleta?.numero_registro || null;
    const nombre = remoteBoleta?.estudiante?.nombre || remoteBoleta?.Nombre || remoteBoleta?.nombre || 'ESTUDIANTE';

    const upsertStudentSql = `
      INSERT INTO estudiantes (numero_registro, nombre_estudiante, id_whatsapp)
      VALUES ($1, $2, $3)
      ON CONFLICT (id_whatsapp) DO UPDATE SET
        numero_registro = EXCLUDED.numero_registro,
        nombre_estudiante = EXCLUDED.nombre_estudiante,
        actualizado_en = CURRENT_TIMESTAMP
      RETURNING id
    `;
    const studentRes = await client.query(upsertStudentSql, [registro, nombre, whatsappId]);
    const studentId = studentRes.rows[0].id;

    // Get or create active semester
    let semesterId = null;
    const semSel = await client.query(`SELECT id FROM semestres WHERE activo = TRUE ORDER BY creado_en DESC LIMIT 1`);
    if (semSel.rowCount > 0) {
      semesterId = semSel.rows[0].id;
    } else {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const semNum = month <= 6 ? '1' : '2';
      const codigo = `${year}-${semNum}`;
      const insertSem = await client.query(`INSERT INTO semestres (codigo, nombre, activo) VALUES ($1,$2,TRUE) ON CONFLICT (codigo) DO UPDATE SET activo = TRUE RETURNING id`, [codigo, `Semestre ${semNum} - ${year}`]);
      semesterId = insertSem.rows[0].id;
    }

    // Insert boleta_inscripciones using token as documento_hash for trace
    const insertBoletaSql = `
      INSERT INTO boletas_inscripciones (id_estudiante, id_semestre, documento_hash, texto_raw, datos_parseados, estado, id_mensaje_whatsapp)
      VALUES ($1, $2, $3, $4, $5, 'pendiente', $6)
      RETURNING id
    `;
    const textoRaw = JSON.stringify(remoteBoleta);
    const datosParseados = JSON.stringify(remoteBoleta);
    const boletaRes = await client.query(insertBoletaSql, [studentId, semesterId, token, textoRaw, datosParseados, messageId]);
    const boletaId = boletaRes.rows[0].id;

    // Insert boleta_grupo for mapped subjects if grupo_materia exists
    const materiasArr = remoteBoleta?.Materias || remoteBoleta?.materias || [];
    let insertedSubjects = 0;

    for (const raw of materiasArr) {
      const text = typeof raw === 'string' ? raw : (raw.sigla && raw.grupo ? `${raw.sigla}-${raw.grupo}` : String(raw));
      const parts = text.split('-');
      const sigla = (parts[0] || '').trim();
      const grupo = (parts[1] || '').trim();
      if (!sigla || !grupo) continue;

      // Find grupo_materia id
      const findGmSql = `
        SELECT gm.id
        FROM grupo_materia gm
        JOIN materias m ON gm.id_materia = m.id
        JOIN grupos g ON gm.id_grupo = g.id
        WHERE m.codigo_materia = $1
          AND g.codigo_grupo = $2
          AND gm.id_semestre = $3
          AND gm.activo = TRUE
        LIMIT 1
      `;
      const gmRes = await client.query(findGmSql, [sigla, grupo, semesterId]);
      if (gmRes.rowCount === 0) continue; // skip unmapped
      const grupoMateriaId = gmRes.rows[0].id;

      const insertBgSql = `
        INSERT INTO boleta_grupo (id_boleta, id_grupo_materia, estado_agregado)
        VALUES ($1, $2, 'pendiente')
      `;
      await client.query(insertBgSql, [boletaId, grupoMateriaId]);
      insertedSubjects++;
    }

    // Update dtic_tokens_usados to link local boleta id
    await client.query(`UPDATE dtic_tokens_usados SET boleta_local_id = $1 WHERE token = $2`, [boletaId, token]);

    await client.query('COMMIT');
    logger.info('Token reserved and boleta created transactionally', { token, boletaId, insertedSubjects, whatsappId });

    return { success: true, documentId: boletaId, insertedSubjects };

  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (e) { logger.warn('Rollback failed', { error: e.message }); }
    logger.error('Error in reserveTokenAndCreateBoleta', { error: error.message, token });
    return { success: false, reason: error.message };
  } finally {
    client.release();
  }
}

export default { reserveTokenAndCreateBoleta };
