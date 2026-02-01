-- Esquema de Base de Datos - Bot de Inscripción
-- PostgreSQL 14+

-- Eliminar objetos existentes si existen
DROP TABLE IF EXISTS materias_inscripcion CASCADE;
DROP TABLE IF EXISTS boletas_inscripcion CASCADE;
DROP TABLE IF EXISTS estudiantes CASCADE;
DROP TABLE IF EXISTS mapeo_grupos_materias CASCADE;
DROP TYPE IF EXISTS estado_documento CASCADE;

-- Crear tipo enum para estado de documento
CREATE TYPE estado_documento AS ENUM (
    'pendiente',
    'confirmado',
    'procesando',
    'completado',
    'fallido',
    'expirado'
);

-- Tabla de estudiantes
CREATE TABLE estudiantes (
    id SERIAL PRIMARY KEY,
    numero_registro VARCHAR(20) NOT NULL UNIQUE,
    nombre_estudiante VARCHAR(255) NOT NULL,
    id_whatsapp VARCHAR(50) NOT NULL UNIQUE,
    total_materias_inscritas INTEGER DEFAULT 0 CHECK (total_materias_inscritas >= 0),
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Documentos de inscripción (boletas)
CREATE TABLE boletas_inscripcion (
    id SERIAL PRIMARY KEY,
    id_estudiante INTEGER NOT NULL REFERENCES estudiantes(id) ON DELETE CASCADE,
    numero_registro VARCHAR(20) NOT NULL,
    hash_documento VARCHAR(64) NOT NULL UNIQUE,
    texto_raw TEXT,
    datos_parseados JSONB,
    estado estado_documento DEFAULT 'pendiente',
    id_mensaje_whatsapp VARCHAR(100),
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmado_en TIMESTAMP,
    procesado_en TIMESTAMP
);

-- Materias de inscripción (materias de la boleta)
CREATE TABLE materias_inscripcion (
    id SERIAL PRIMARY KEY,
    id_documento INTEGER NOT NULL REFERENCES boletas_inscripcion(id) ON DELETE CASCADE,
    sigla VARCHAR(20) NOT NULL,
    grupo VARCHAR(10) NOT NULL,
    materia VARCHAR(255) NOT NULL,
    
    modalidad VARCHAR(50),
    nivel VARCHAR(50),
    horario TEXT,
    jid_grupo VARCHAR(100),
    agregado_a_grupo BOOLEAN DEFAULT FALSE,
    agregado_en TIMESTAMP,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Mapeo de grupos de materias (SIGLA+GRUPO -> grupo de WhatsApp)
CREATE TABLE mapeo_grupos_materias (
    id SERIAL PRIMARY KEY,
    sigla VARCHAR(20) NOT NULL,
    grupo VARCHAR(10) NOT NULL,
    nombre_materia VARCHAR(255),
    jid_grupo_whatsapp VARCHAR(100) NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sigla, grupo)
);

-- Índices para rendimiento
CREATE INDEX idx_estudiantes_reg ON estudiantes(numero_registro);
CREATE INDEX idx_estudiantes_wa ON estudiantes(id_whatsapp);
CREATE INDEX idx_docs_hash ON boletas_inscripcion(hash_documento);
CREATE INDEX idx_docs_estado ON boletas_inscripcion(estado);
CREATE INDEX idx_docs_estudiante ON boletas_inscripcion(id_estudiante);
CREATE INDEX idx_materias_doc ON materias_inscripcion(id_documento);
CREATE INDEX idx_materias_grupo ON materias_inscripcion(jid_grupo);
CREATE INDEX idx_mapeo_sigla_grupo ON mapeo_grupos_materias(sigla, grupo);
CREATE INDEX idx_mapeo_activo ON mapeo_grupos_materias(activo);

-- Función para actualizar timestamp de actualizado_en
CREATE OR REPLACE FUNCTION actualizar_columna_actualizado_en()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para auto-actualizar actualizado_en en tabla estudiantes
CREATE TRIGGER actualizar_estudiantes_actualizado_en BEFORE UPDATE ON estudiantes
    FOR EACH ROW EXECUTE FUNCTION actualizar_columna_actualizado_en();

-- Trigger para auto-actualizar actualizado_en en tabla mapeo_grupos_materias
CREATE TRIGGER actualizar_mapeo_actualizado_en BEFORE UPDATE ON mapeo_grupos_materias
    FOR EACH ROW EXECUTE FUNCTION actualizar_columna_actualizado_en();

-- Insertar datos de ejemplo (opcional - para pruebas)
-- Puedes agregar mapeos iniciales de grupos de materias aquí
-- INSERT INTO mapeo_grupos_materias (sigla, grupo, nombre_materia, jid_grupo_whatsapp) VALUES
-- ('INF412', '5A', 'SISTEMAS DE INFORMACION II', '120363422425868357@g.us'),
-- ('INF413', '5A', 'SISTEMAS OPERATIVOS II', '120363404899422950@g.us');

COMMENT ON TABLE estudiantes IS 'Almacena información de estudiantes con contador total de materias inscritas';
COMMENT ON TABLE boletas_inscripcion IS 'Almacena documentos de inscripción procesados (boletas) con datos de OCR';
COMMENT ON TABLE materias_inscripcion IS 'Almacena materias individuales de cada documento de inscripción';
COMMENT ON TABLE mapeo_grupos_materias IS 'Mapea combinaciones SIGLA+GRUPO a JIDs de grupos de WhatsApp';
COMMENT ON COLUMN estudiantes.total_materias_inscritas IS 'Contador acumulativo de materias agregadas exitosamente (máximo 8)';
COMMENT ON COLUMN boletas_inscripcion.hash_documento IS 'Hash SHA256 para detección de duplicados';
COMMENT ON COLUMN boletas_inscripcion.datos_parseados IS 'JSON con datos parseados del OCR para referencia';
