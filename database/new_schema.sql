-- ==========================================================
-- Esquema de Base de Datos - Bot de Inscripción (Refactor)
-- PostgreSQL 14+
-- Soporta semestres + estados de agregado + auditoría
-- Incluye tablas del panel administrativo con RBAC
-- ==========================================================

-- -----------------------------
-- Eliminar objetos existentes
-- -----------------------------
DROP TABLE IF EXISTS admin_commands CASCADE;
DROP TABLE IF EXISTS sesiones_auditoria CASCADE;
DROP TABLE IF EXISTS sesiones CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;
DROP TABLE IF EXISTS bot_heartbeat CASCADE;
DROP TABLE IF EXISTS boleta_grupo CASCADE;
DROP TABLE IF EXISTS boletas_inscripciones CASCADE;
DROP TABLE IF EXISTS grupo_materia CASCADE;
DROP TABLE IF EXISTS grupos CASCADE;
DROP TABLE IF EXISTS materias CASCADE;
DROP TABLE IF EXISTS semestres CASCADE;
DROP TABLE IF EXISTS estudiantes CASCADE;

DROP TYPE IF EXISTS rol_usuario CASCADE;
DROP TYPE IF EXISTS estado_comando CASCADE;
DROP TYPE IF EXISTS tipo_comando CASCADE;
DROP TYPE IF EXISTS estado_documento CASCADE;
DROP TYPE IF EXISTS estado_agregado CASCADE;

-- -----------------------------
-- Tipos ENUM
-- -----------------------------
-- Panel administrativo
CREATE TYPE rol_usuario AS ENUM ('admin', 'operator', 'auditor');
CREATE TYPE tipo_comando AS ENUM ('retry_enrollment', 'refresh_groups', 'restart_bot');
CREATE TYPE estado_comando AS ENUM ('pendiente', 'procesando', 'completado', 'fallido');

-- Bot de inscripción
CREATE TYPE estado_documento AS ENUM (
    'pendiente',     -- recién subido
    'confirmado',    -- validado por el usuario (si aplica)
    'procesando',    -- OCR/parse en curso
    'completado',    -- OCR/parse listo
    'fallido',       -- error de OCR/parse
    'expirado'       -- vencido/rechazado por tiempo
);

CREATE TYPE estado_agregado AS ENUM (
    'pendiente',     -- aún no se intentó / esperando acción
    'agregado',      -- agregado al grupo WhatsApp
    'fallido'        -- se intentó y falló (guardar error)
);

-- -----------------------------
-- Tabla: estudiantes
-- -----------------------------
CREATE TABLE estudiantes (
    id SERIAL PRIMARY KEY,
    numero_registro VARCHAR(20) NOT NULL UNIQUE,
    nombre_estudiante VARCHAR(255) NOT NULL,
    id_whatsapp VARCHAR(50) NOT NULL UNIQUE,
    total_materias_registradas INTEGER NOT NULL DEFAULT 0 CHECK (total_materias_registradas >= 0),
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------
-- Tabla: semestres
-- Ej: "2026-1", "2026-2" o "2025-II"
-- -----------------------------
CREATE TABLE semestres (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) NOT NULL UNIQUE,       -- ej: 2026-1
    nombre VARCHAR(100),                      -- ej: "Semestre 1 - 2026"
    fecha_inicio DATE,
    fecha_fin DATE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------
-- Tabla: materias (catálogo)
-- INF120, etc.
-- -----------------------------
CREATE TABLE materias (
    id SERIAL PRIMARY KEY,
    codigo_materia VARCHAR(20) NOT NULL UNIQUE,  -- ej: INF120
    nombre VARCHAR(255) NOT NULL,
    nivel VARCHAR(50),
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------
-- Tabla: grupos (catálogo)
-- SA, SB, SC, 5A, etc.
-- -----------------------------
CREATE TABLE grupos (
    id SERIAL PRIMARY KEY,
    codigo_grupo VARCHAR(10) NOT NULL UNIQUE,  -- ej: SA
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------
-- Tabla: grupo_materia (oferta por semestre)
-- Define: (semestre + materia + grupo) con su JID/horario/modalidad
-- -----------------------------
CREATE TABLE grupo_materia (
    id SERIAL PRIMARY KEY,
    id_semestre INTEGER NOT NULL REFERENCES semestres(id) ON DELETE RESTRICT,
    id_materia INTEGER NOT NULL REFERENCES materias(id) ON DELETE RESTRICT,
    id_grupo INTEGER NOT NULL REFERENCES grupos(id) ON DELETE RESTRICT,

    jid_grupo_whatsapp VARCHAR(100) NOT NULL,
    modalidad VARCHAR(50),
    horario TEXT,

    activo BOOLEAN NOT NULL DEFAULT TRUE,
    version INTEGER NOT NULL DEFAULT 0,  -- Optimistic locking
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Evita duplicar la misma oferta en un semestre
    UNIQUE (id_semestre, id_materia, id_grupo),

    -- Un JID debería mapear a una sola oferta activa del semestre (opcional pero recomendado)
    UNIQUE (id_semestre, jid_grupo_whatsapp)
);

-- -----------------------------
-- Tabla: boletas_inscripciones (documentos)
-- Muchas boletas por estudiante y por semestre
-- -----------------------------
CREATE TABLE boletas_inscripciones (
    id SERIAL PRIMARY KEY,
    id_estudiante INTEGER NOT NULL REFERENCES estudiantes(id) ON DELETE CASCADE,
    id_semestre INTEGER NOT NULL REFERENCES semestres(id) ON DELETE RESTRICT,

    documento_hash VARCHAR(64) NOT NULL UNIQUE, -- SHA256 para duplicados
    texto_raw TEXT,
    datos_parseados JSONB,

    estado estado_documento NOT NULL DEFAULT 'pendiente',

    id_mensaje_whatsapp VARCHAR(100), -- trazabilidad del mensaje original
    fecha_subida TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confirmado_en TIMESTAMP,
    procesado_en TIMESTAMP
);

-- -----------------------------
-- Tabla: boleta_grupo (líneas de boleta)
-- Puente: boleta -> oferta (grupo_materia)
-- Estado de agregado + reintentos + error
-- -----------------------------
CREATE TABLE boleta_grupo (
    id SERIAL PRIMARY KEY,
    id_boleta INTEGER NOT NULL REFERENCES boletas_inscripciones(id) ON DELETE CASCADE,
    id_grupo_materia INTEGER NOT NULL REFERENCES grupo_materia(id) ON DELETE RESTRICT,

    estado_agregado estado_agregado NOT NULL DEFAULT 'pendiente',
    agregado_en TIMESTAMP,                 -- cuándo quedó agregado
    intentos INTEGER NOT NULL DEFAULT 0 CHECK (intentos >= 0),
    error_ultimo TEXT,                     -- último error si falló

    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Evita duplicar la misma materia-grupo en la misma boleta
    UNIQUE (id_boleta, id_grupo_materia)
);

-- ==========================================================
-- PANEL ADMINISTRATIVO - Tablas de gestión
-- ==========================================================

-- -----------------------------
-- Tabla: usuarios (panel administrativo)
-- -----------------------------
CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    role rol_usuario NOT NULL DEFAULT 'operator',
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    version INTEGER NOT NULL DEFAULT 0,  -- Optimistic locking
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------
-- Tabla: sesiones (refresh tokens)
-- -----------------------------
CREATE TABLE sesiones (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(255) NOT NULL,
    ip_address VARCHAR(50),
    user_agent TEXT,
    expira_en TIMESTAMP NOT NULL,
    revocado BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sesiones_usuario ON sesiones(usuario_id);
CREATE INDEX idx_sesiones_expira ON sesiones(expira_en) WHERE revocado = FALSE;

-- -----------------------------
-- Tabla: sesiones_auditoria (log de acciones)
-- -----------------------------
CREATE TABLE sesiones_auditoria (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    accion VARCHAR(100) NOT NULL,
    tabla_afectada VARCHAR(100),
    registro_id INTEGER,
    cambios_antes JSONB,
    cambios_despues JSONB,
    ip_address VARCHAR(50),
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sesiones_auditoria_usuario_fecha ON sesiones_auditoria(usuario_id, creado_en DESC);
CREATE INDEX idx_sesiones_auditoria_tabla_fecha ON sesiones_auditoria(tabla_afectada, creado_en DESC);

-- -----------------------------
-- Tabla: admin_commands (comandos para el bot)
-- -----------------------------
CREATE TABLE admin_commands (
    id SERIAL PRIMARY KEY,
    comando tipo_comando NOT NULL,
    parametros JSONB,
    estado estado_comando NOT NULL DEFAULT 'pendiente',
    resultado JSONB,
    bloqueado_por INTEGER,      -- PID del proceso
    bloqueado_en TIMESTAMP,
    creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ejecutado_en TIMESTAMP
);

CREATE INDEX idx_admin_commands_estado_creado ON admin_commands(estado, creado_en);

-- -----------------------------
-- Tabla: bot_heartbeat (estado del bot)
-- Single-row table para tracking del bot
-- -----------------------------
CREATE TABLE bot_heartbeat (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- Solo una fila
    ultima_conexion TIMESTAMP,
    estado_whatsapp VARCHAR(100),
    version_bot VARCHAR(20),
    pid INTEGER,
    hostname VARCHAR(255),
    grupos_cache JSONB,  -- Cache de grupos de WhatsApp disponibles
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================================
-- Índices (rendimiento)
-- ==========================================================

-- Estudiantes: los UNIQUE ya crean índices (numero_registro, id_whatsapp)

-- Boletas: buscar por estudiante/semestre y por estado
CREATE INDEX idx_boletas_estudiante ON boletas_inscripciones(id_estudiante);
CREATE INDEX idx_boletas_semestre ON boletas_inscripciones(id_semestre);
CREATE INDEX idx_boletas_estado ON boletas_inscripciones(estado);

-- Grupo_materia: resolver rápido oferta por semestre + materia + grupo
-- (ya existe por UNIQUE (id_semestre, id_materia, id_grupo), pero este es equivalente;
-- en PostgreSQL el UNIQUE crea el índice, así que NO es necesario duplicarlo)
-- CREATE INDEX idx_grupo_materia_lookup ON grupo_materia(id_semestre, id_materia, id_grupo);

-- Por activos (mejor como índice parcial)
CREATE INDEX idx_grupo_materia_activo ON grupo_materia(id_semestre) WHERE activo = TRUE;

-- Boleta_grupo: traer líneas por boleta y pendientes/fallidas para jobs de agregado
CREATE INDEX idx_boleta_grupo_boleta ON boleta_grupo(id_boleta);
CREATE INDEX idx_boleta_grupo_estado_boleta ON boleta_grupo(estado_agregado, id_boleta);

-- Opcional: si consultas por oferta
CREATE INDEX idx_boleta_grupo_oferta ON boleta_grupo(id_grupo_materia);

-- ==========================================================
-- Triggers: actualizado_en automático
-- ==========================================================

CREATE OR REPLACE FUNCTION set_actualizado_en()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_estudiantes_actualizado
BEFORE UPDATE ON estudiantes
FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

CREATE TRIGGER trg_semestres_actualizado
BEFORE UPDATE ON semestres
FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

CREATE TRIGGER trg_materias_actualizado
BEFORE UPDATE ON materias
FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

CREATE TRIGGER trg_grupos_actualizado
BEFORE UPDATE ON grupos
FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

CREATE TRIGGER trg_grupo_materia_actualizado
BEFORE UPDATE ON grupo_materia
FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

CREATE TRIGGER trg_usuarios_actualizado
BEFORE UPDATE ON usuarios
FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

-- ==========================================================
-- Trigger: contador total_materias_registradas en estudiantes
-- Regla: suma +1 cuando una línea pasa a estado 'agregado'
-- y resta -1 si se revierte de 'agregado' a otro estado (por corrección)
-- ==========================================================

CREATE OR REPLACE FUNCTION actualizar_total_materias_estudiante()
RETURNS TRIGGER AS $$
DECLARE
    v_id_estudiante INTEGER;
BEGIN
    -- Obtener estudiante desde la boleta asociada
    SELECT b.id_estudiante
      INTO v_id_estudiante
      FROM boletas_inscripciones b
     WHERE b.id = COALESCE(NEW.id_boleta, OLD.id_boleta);

    IF v_id_estudiante IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- INSERT: si entra ya como agregado
    IF TG_OP = 'INSERT' THEN
        IF NEW.estado_agregado = 'agregado' THEN
            UPDATE estudiantes
               SET total_materias_registradas = total_materias_registradas + 1
             WHERE id = v_id_estudiante;
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE: detectar transición hacia/desde agregado
    IF TG_OP = 'UPDATE' THEN
        IF OLD.estado_agregado IS DISTINCT FROM NEW.estado_agregado THEN
            IF OLD.estado_agregado <> 'agregado' AND NEW.estado_agregado = 'agregado' THEN
                UPDATE estudiantes
                   SET total_materias_registradas = total_materias_registradas + 1
                 WHERE id = v_id_estudiante;
            ELSIF OLD.estado_agregado = 'agregado' AND NEW.estado_agregado <> 'agregado' THEN
                UPDATE estudiantes
                   SET total_materias_registradas = GREATEST(total_materias_registradas - 1, 0)
                 WHERE id = v_id_estudiante;
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    -- DELETE: si se borra una línea agregada, restar
    IF TG_OP = 'DELETE' THEN
        IF OLD.estado_agregado = 'agregado' THEN
            UPDATE estudiantes
               SET total_materias_registradas = GREATEST(total_materias_registradas - 1, 0)
             WHERE id = v_id_estudiante;
        END IF;
        RETURN OLD;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_boleta_grupo_contador_insert
AFTER INSERT ON boleta_grupo
FOR EACH ROW EXECUTE FUNCTION actualizar_total_materias_estudiante();

CREATE TRIGGER trg_boleta_grupo_contador_update
AFTER UPDATE OF estado_agregado ON boleta_grupo
FOR EACH ROW EXECUTE FUNCTION actualizar_total_materias_estudiante();

CREATE TRIGGER trg_boleta_grupo_contador_delete
AFTER DELETE ON boleta_grupo
FOR EACH ROW EXECUTE FUNCTION actualizar_total_materias_estudiante();

-- ==========================================================
-- Comentarios
-- ==========================================================

COMMENT ON TABLE estudiantes IS 'Estudiantes con contador cacheado de materias agregadas exitosamente';
COMMENT ON TABLE semestres IS 'Catálogo de semestres (ej: 2026-1). Se usa para versionar ofertas y boletas';
COMMENT ON TABLE materias IS 'Catálogo de materias (codigo)';
COMMENT ON TABLE grupos IS 'Catálogo de grupos/secciones (SA, SB, etc.)';
COMMENT ON TABLE grupo_materia IS 'Oferta por semestre: combina materia + grupo con JID WhatsApp, horario y modalidad';
COMMENT ON TABLE boletas_inscripciones IS 'Documentos/boletas subidas por estudiante, con datos OCR y estado';
COMMENT ON TABLE boleta_grupo IS 'Líneas de boleta: boleta -> oferta, con estado de agregado, intentos y error';

COMMENT ON COLUMN boletas_inscripciones.documento_hash IS 'Hash SHA256 para detectar duplicados';
COMMENT ON COLUMN boletas_inscripciones.datos_parseados IS 'JSON con datos parseados del OCR';
COMMENT ON COLUMN boleta_grupo.error_ultimo IS 'Último error al intentar agregar al grupo de WhatsApp';

COMMENT ON TABLE usuarios IS 'Usuarios del panel administrativo con roles RBAC';
COMMENT ON TABLE sesiones IS 'Sesiones activas con refresh tokens hasheados';
COMMENT ON TABLE sesiones_auditoria IS 'Log de auditoría de todas las acciones administrativas (retención 60 días)';
COMMENT ON TABLE admin_commands IS 'Cola de comandos para que el bot ejecute (retry, refresh, restart)';
COMMENT ON TABLE bot_heartbeat IS 'Estado y heartbeat del bot (tabla de una sola fila)';

-- ==========================================================
-- Limpieza automática con pg_cron (requiere extensión)
-- ==========================================================

-- Habilitar extensión pg_cron si no está habilitada
-- Nota: Requiere permisos de superusuario
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Limpieza diaria de sesiones expiradas/revocadas (operacional)
-- SELECT cron.schedule('cleanup-sesiones', '0 2 * * *', $$
--     DELETE FROM sesiones WHERE expira_en < NOW() OR revocado = TRUE
-- $$);

-- Limpieza mensual de auditoría antigua (retención 60 días)
-- SELECT cron.schedule('cleanup-auditoria', '0 3 1 * *', $$
--     DELETE FROM sesiones_auditoria WHERE creado_en < NOW() - INTERVAL '60 days'
-- $$);

-- ==========================================================
-- Fin del esquema
-- ==========================================================