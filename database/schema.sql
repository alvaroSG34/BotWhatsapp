-- Enrollment Bot Database Schema
-- PostgreSQL 14+

-- Drop existing objects if they exist
DROP TABLE IF EXISTS enrollment_subjects CASCADE;
DROP TABLE IF EXISTS enrollment_documents CASCADE;
DROP TABLE IF EXISTS students CASCADE;
DROP TABLE IF EXISTS subject_group_mapping CASCADE;
DROP TYPE IF EXISTS document_status CASCADE;

-- Create enum type for document status
CREATE TYPE document_status AS ENUM (
    'pending',
    'confirmed',
    'processing',
    'completed',
    'failed',
    'expired'
);

-- Students table
CREATE TABLE students (
    id SERIAL PRIMARY KEY,
    registration_number VARCHAR(20) NOT NULL UNIQUE,
    student_name VARCHAR(255) NOT NULL,
    whatsapp_id VARCHAR(50) NOT NULL UNIQUE,
    total_subjects_enrolled INTEGER DEFAULT 0 CHECK (total_subjects_enrolled >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Enrollment documents (boletas)
CREATE TABLE enrollment_documents (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    registration_number VARCHAR(20) NOT NULL,
    document_hash VARCHAR(64) NOT NULL UNIQUE,
    raw_text TEXT,
    parsed_data JSONB,
    status document_status DEFAULT 'pending',
    whatsapp_message_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP,
    processed_at TIMESTAMP
);

-- Enrollment subjects (materias from boleta)
CREATE TABLE enrollment_subjects (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES enrollment_documents(id) ON DELETE CASCADE,
    sigla VARCHAR(20) NOT NULL,
    grupo VARCHAR(10) NOT NULL,
    materia VARCHAR(255) NOT NULL,
    modalidad VARCHAR(50),
    nivel VARCHAR(50),
    horario TEXT,
    group_jid VARCHAR(100),
    added_to_group BOOLEAN DEFAULT FALSE,
    added_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Subject-Group mapping (SIGLA+GRUPO -> WhatsApp group)
CREATE TABLE subject_group_mapping (
    id SERIAL PRIMARY KEY,
    sigla VARCHAR(20) NOT NULL,
    grupo VARCHAR(10) NOT NULL,
    materia_name VARCHAR(255),
    whatsapp_group_jid VARCHAR(100) NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sigla, grupo)
);

-- Indexes for performance
CREATE INDEX idx_students_reg ON students(registration_number);
CREATE INDEX idx_students_wa ON students(whatsapp_id);
CREATE INDEX idx_docs_hash ON enrollment_documents(document_hash);
CREATE INDEX idx_docs_status ON enrollment_documents(status);
CREATE INDEX idx_docs_student ON enrollment_documents(student_id);
CREATE INDEX idx_subjects_doc ON enrollment_subjects(document_id);
CREATE INDEX idx_subjects_group ON enrollment_subjects(group_jid);
CREATE INDEX idx_mapping_sigla_grupo ON subject_group_mapping(sigla, grupo);
CREATE INDEX idx_mapping_active ON subject_group_mapping(active);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at on students table
CREATE TRIGGER update_students_updated_at BEFORE UPDATE ON students
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger to auto-update updated_at on subject_group_mapping table
CREATE TRIGGER update_mapping_updated_at BEFORE UPDATE ON subject_group_mapping
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert sample data (optional - for testing)
-- You can add initial subject-group mappings here
-- INSERT INTO subject_group_mapping (sigla, grupo, materia_name, whatsapp_group_jid) VALUES
-- ('INF412', '5A', 'SISTEMAS DE INFORMACION II', '120363422425868357@g.us'),
-- ('INF413', '5A', 'SISTEMAS OPERATIVOS II', '120363404899422950@g.us');

COMMENT ON TABLE students IS 'Stores student information with total enrolled subjects counter';
COMMENT ON TABLE enrollment_documents IS 'Stores processed enrollment documents (boletas) with OCR data';
COMMENT ON TABLE enrollment_subjects IS 'Stores individual subjects from each enrollment document';
COMMENT ON TABLE subject_group_mapping IS 'Maps SIGLA+GRUPO combinations to WhatsApp group JIDs';
COMMENT ON COLUMN students.total_subjects_enrolled IS 'Cumulative count of subjects successfully added (max 8)';
COMMENT ON COLUMN enrollment_documents.document_hash IS 'SHA256 hash for duplicate detection';
COMMENT ON COLUMN enrollment_documents.parsed_data IS 'JSON with parsed OCR data for reference';
