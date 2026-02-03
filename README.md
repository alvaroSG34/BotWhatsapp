# Bot de Inscripción Automática con OCR

Bot de WhatsApp que automatiza la inscripción de estudiantes a grupos mediante el procesamiento OCR de boletas de inscripción. El sistema extrae automáticamente datos del estudiante (número de registro, nombre, materias y grupos) de documentos PDF o imágenes, valida la información con el usuario, y agrega automáticamente a los grupos de WhatsApp configurados.

## 🌟 Características

- ✅ **Procesamiento OCR automático** de boletas de inscripción (PDF e imágenes)
- ✅ **Extracción inteligente** de número de registro, nombre del estudiante, y materias con grupos
- ✅ **Validación de registro consistente** - Evita fraude detectando boletas de otras personas
- ✅ **Detección de nuevas materias** - Solo procesa materias nuevas, salta duplicados
- ✅ **Sistema de colas** - Maneja 50+ usuarios simultáneos sin rate limits
- ✅ **Validación con el usuario** antes de procesar la inscripción
- ✅ **Límite de 8 materias por estudiante** (acumulativo permanente)
- ✅ **Protocolo anti-baneo** con delays aleatorios y simulación de escritura
- ✅ **Base de datos PostgreSQL** para almacenamiento persistente y detección de duplicados
- ✅ **Logging estructurado** con Winston para auditoría completa
- ✅ **Mapeo flexible** SIGLA+GRUPO → Grupos de WhatsApp
- ✅ **Expiración automática** de documentos pendientes (10 minutos)
- ✅ **Descubrimiento automático** de grupos con script dedicado

## 📋 Requisitos Previos

- **Node.js** 18+ ([Descargar](https://nodejs.org/))
- **PostgreSQL** 14+ ([Descargar](https://www.postgresql.org/download/))
- **Cuenta de WhatsApp** (Business o personal)
- **Windows** (el proyecto está configurado para Windows)

## 🚀 Instalación

### 1. Clonar el repositorio

```bash
git clone <url-del-repositorio>
cd BotWhatsapp
```

### 2. Instalar dependencias

```bash
npm install
```

Las dependencias instaladas incluyen:
- `whatsapp-web.js` - Cliente de WhatsApp
- `tesseract.js` - Motor OCR para extracción de texto
- `pdf-parse` - Extracción de texto de PDFs
- `sharp` - Procesamiento de imágenes
- `pg` - Cliente PostgreSQL
- `winston` - Sistema de logging
- `dotenv` - Gestión de variables de entorno

### 3. Configurar PostgreSQL

#### Crear base de datos

Abre la terminal de PostgreSQL (psql) o pgAdmin y ejecuta:

```sql
CREATE DATABASE enrollment_db;
```

#### Ejecutar el esquema

```bash
psql -U postgres -d enrollment_db -f database/schema.sql
```

O en Windows con pgAdmin:
1. Abre pgAdmin
2. Conecta a tu servidor PostgreSQL
3. Crea una nueva base de datos llamada `enrollment_db`
4. Abre el Query Tool
5. Carga y ejecuta el archivo `database/schema.sql`

### 4. Configurar variables de entorno

Copia el archivo de ejemplo y edítalo con tus credenciales:

```bash
copy .env.example .env
```

Edita el archivo `.env`:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=enrollment_db
DB_USER=postgres
DB_PASSWORD=tu_contraseña_aqui
```

## ⚙️ Configuración Inicial

### 1. Descubrir grupos de WhatsApp

Ejecuta el script de descubrimiento para mapear tus grupos:

```bash
npm run discover-groups
```

Este script:
1. Escanea todos los grupos donde está el bot
2. Intenta detectar automáticamente el patrón SIGLA+GRUPO del nombre
3. Genera comandos SQL listos para copiar y pegar

**Salida de ejemplo:**

```
✅ Grupo 1: INF412 - 5A
   📌 SIGLA: INF412
   📌 GRUPO: 5A
   📌 JID: 120363422425868357@g.us

💾 COMANDOS SQL PARA COPIAR Y EJECUTAR:

INSERT INTO subject_group_mapping (sigla, grupo, materia_name, whatsapp_group_jid) 
VALUES ('INF412', '5A', 'SISTEMAS DE INFORMACION II', '120363422425868357@g.us') 
ON CONFLICT (sigla, grupo) DO NOTHING;
```

### 2. Poblar la tabla de mapeos

Copia los comandos SQL generados y ejécutálos en tu base de datos:

```bash
psql -U postgres -d enrollment_db
```

```sql
-- Pega aquí los INSERT generados por discover-groups
INSERT INTO subject_group_mapping (sigla, grupo, materia_name, whatsapp_group_jid) 
VALUES ('INF412', '5A', 'SISTEMAS DE INFORMACION II', '120363422425868357@g.us');
-- ... más INSERT según tus grupos
```

O manualmente para grupos no detectados:

```sql
INSERT INTO subject_group_mapping (sigla, grupo, materia_name, whatsapp_group_jid) 
VALUES ('MAT101', '1B', 'MATEMATICAS I', 'JID_DEL_GRUPO_AQUI');
```

## 🎯 Ejecución

### Iniciar el bot

```bash
npm start
```

### Primera vez

1. El bot generará un código QR en la consola
2. Abre WhatsApp en tu teléfono
3. Ve a **Menú (⋮) → Dispositivos vinculados → Vincular dispositivo**
4. Escanea el código QR
5. El bot se conectará y mostrará los grupos disponibles

### Logs

Los logs se guardan automáticamente en:
- `logs/bot.log` - Todos los logs
- `logs/error.log` - Solo errores
- `logs/exceptions.log` - Excepciones no capturadas

## 📖 Uso para Estudiantes

### 1. Enviar boleta de inscripción

El estudiante debe:
1. Abrir WhatsApp y buscar el número del bot
2. Enviar una foto clara o PDF de su **boleta de inscripción**

La boleta debe incluir:
- Número de registro (9 dígitos)
- Nombre completo del estudiante
- Tabla de materias con:
  - SIGLA (ej: INF412)
  - GRUPO (ej: 5A)
  - NOMBRE DE LA MATERIA

### 2. Revisar datos extraídos

El bot responderá con los datos detectados:

```
✅ Documento procesado

👤 Estudiante: SONCO GUZMAN ALVARO
🆔 Registro: 222009969
📊 Materias actuales: 0/8
📚 Nuevas materias: 5

📋 Materias detectadas:
✅ INF412 - Grupo 5A
    SISTEMAS DE INFORMACION II
✅ INF413 - Grupo 5A
    SISTEMAS OPERATIVOS II
⚠️ ECO449 - Grupo 5A
    PREPARACION Y EVALUACION DE PROYECTOS

💬 Responde "LISTO" para confirmar...
```

### 3. Confirmar inscripción

El estudiante responde:

```
LISTO
```

o también puede escribir: `confirmar`, `si`, `sí`, `ok`

### 4. Proceso automático

El bot:
1. Agrega al estudiante a cada grupo (con delays aleatorios)
2. Maneja errores (contactos, permisos, etc.)
3. Envía resumen final con éxitos y fallos

```
✅ Inscripción completada!

✓ Agregado exitosamente (2):
  • INF412 - Grupo 5A
  • INF413 - Grupo 5A

✗ No se pudo agregar (1):
  • ECO449 - Grupo 5A

📊 Total de materias inscritas: 2/8
```

## 🔒 Límites y Restricciones

### Límite de materias

- **Máximo 8 materias por estudiante** (acumulativo permanente)
- Si ya tiene 6 materias y envía boleta con 5 nuevas → rechazado
- El bot le indicará cuántas materias puede agregar

### Expiración de confirmaciones

- Los documentos en estado `pending` expiran después de **10 minutos**
- El estudiante debe reenviar la boleta si expira

### Materias sin mapeo

- Si una materia no tiene grupo configurado, se marca con ⚠️
- Solo se procesan materias con ✅ (grupo configurado)

## 🛠️ Scripts de Administración

### Eliminar boletas de un estudiante

Para eliminar boletas de un estudiante específico (por ejemplo, para testing o corrección de errores):

```bash
npm run delete-boleta <numero_registro>
# o
node delete-student-boleta.js <numero_registro>
```

**Ejemplo:**
```bash
npm run delete-boleta 222009752
```

El script mostrará:
1. Datos del estudiante
2. Lista de todas sus boletas con detalles
3. Materias de cada boleta
4. Opciones de eliminación:
   - `[1]` Eliminar TODAS las boletas (mantener estudiante)
   - `[2]` Eliminar TODO (estudiante + boletas) - como si nunca hubiera usado el bot
   - `[3]` Eliminar boleta específica por ID
   - `[0]` Cancelar

**Nota:** Las eliminaciones son permanentes. El script actualiza automáticamente el contador de `total_materias_registradas`.

### Descubrir grupos de WhatsApp

```bash
npm run discover-groups
```

Este script escanea todos los grupos de WhatsApp y genera comandos SQL para insertarlos en la base de datos.
- Las materias sin grupo NO cuentan para el límite de 8

## 🛡️ Protocolo Anti-Baneo

El bot implementa las siguientes medidas para evitar ser detectado como spam:

### Delays aleatorios

- **Respuesta inicial:** 2-5 segundos antes de responder
- **Entre mensajes:** 5-15 segundos entre mensajes
- **Entre adiciones:** 8-20 segundos entre agregar a grupos

### Simulación de escritura

- Estado "Escribiendo..." proporcional a la longitud del mensaje
- ~40ms por carácter, mínimo 2s, máximo 8s

### Procesamiento serial

- Un documento a la vez por usuario
- Un grupo a la vez al agregar
- No hay procesamiento en paralelo masivo

## 🔧 Administración

### Ver estudiantes inscritos

```sql
SELECT registration_number, student_name, total_subjects_enrolled 
FROM students 
ORDER BY total_subjects_enrolled DESC;
```

### Resetear contador de materias

```sql
UPDATE students 
SET total_subjects_enrolled = 0 
WHERE registration_number = '222009969';
```

### Ver documentos procesados

```sql
SELECT 
    ed.id,
    s.student_name,
    ed.status,
    ed.created_at,
    COUNT(es.id) as subjects_count
FROM enrollment_documents ed
JOIN students s ON ed.student_id = s.id
LEFT JOIN enrollment_subjects es ON es.document_id = ed.id
GROUP BY ed.id, s.student_name, ed.status, ed.created_at
ORDER BY ed.created_at DESC;
```

### Agregar nuevo mapeo de grupo

```sql
INSERT INTO subject_group_mapping (sigla, grupo, materia_name, whatsapp_group_jid) 
VALUES ('INF428', '5B', 'SISTEMAS EXPERTOS', 'JID_DEL_GRUPO');
```

### Desactivar mapeo (sin eliminarlo)

```sql
UPDATE subject_group_mapping 
SET active = FALSE 
WHERE sigla = 'INF412' AND grupo = '5A';
```

## 🐛 Troubleshooting

### Error: Cannot connect to PostgreSQL

**Problema:** El bot no puede conectarse a la base de datos

**Solución:**
1. Verifica que PostgreSQL esté corriendo: `pg_ctl status`
2. Revisa las credenciales en `.env`
3. Verifica que la base de datos exista: `psql -l`
4. Chequea que el puerto sea correcto (default 5432)

### Error: OCR no detecta datos

**Problema:** El bot dice "No pude leer tu documento correctamente"

**Causas comunes:**
- Foto borrosa o de baja calidad
- PDF escaneado con poca resolución
- Texto muy pequeño
- Boleta con formato no estándar

**Solución:**
- Pedir al usuario que envíe foto con mejor calidad
- Usar cámara con buena iluminación
- Si es PDF, asegurar que tenga al menos 300 DPI

### Error: Materias no se mapean

**Problema:** Todas las materias aparecen con ⚠️

**Solución:**
1. Ejecutar `npm run discover-groups` para ver los JIDs reales
2. Verificar que los mapeos estén en la base de datos:
   ```sql
   SELECT * FROM subject_group_mapping WHERE active = TRUE;
   ```
3. Verificar que SIGLA y GRUPO coincidan exactamente (case-sensitive)

### WhatsApp desconecta frecuentemente

**Problema:** El bot se desconecta de WhatsApp constantemente

**Solución:**
- No uses la misma cuenta de WhatsApp en múltiples dispositivos simultáneamente
- Asegúrate de que el teléfono tenga conexión estable a internet
- No cierres WhatsApp en el teléfono
- Elimina `auth_info/` y reautentifica si persiste

## 📚 Estructura del Proyecto

```
BotWhatsapp/
├── database/
│   └── schema.sql              # Esquema PostgreSQL
├── docs/
│   ├── change.md               # Especificación del flujo OCR
│   └── considerations.md       # Protocolo anti-baneo
├── logs/                       # Logs generados (auto-creado)
│   ├── bot.log
│   ├── error.log
│   └── exceptions.log
├── src/
│   ├── antibanHelpers.js       # Delays aleatorios y typing simulation
│   ├── cleanupTasks.js         # Tarea de expiración de documentos
│   ├── config.js               # Configuración del bot
│   ├── database.js             # Conexión y queries PostgreSQL
│   ├── discoverGroups.js       # Script de descubrimiento de grupos
│   ├── enrollmentHandler.js    # Handler principal de documentos
│   ├── groupMapper.js          # Mapeo SIGLA+GRUPO → JID
│   ├── index.js                # Punto de entrada del bot
│   ├── logger.js               # Configuración de Winston
│   ├── ocr.js                  # Procesamiento OCR
│   ├── panelIntegration.js     # ⭐ Integración con panel admin
│   └── parser.js               # Extracción de datos de OCR
├── .env                        # Variables de entorno (crear)
├── .env.example                # Template de variables
├── CONFIGURACION_PANEL.md      # ⭐ Guía de integración con panel
├── test-panel-integration.js   # Script de prueba de integración
├── package.json
└── README.md
```

## 🖥️ Integración con Panel de Administración

El bot incluye integración completa con un panel web de administración. Ver [CONFIGURACION_PANEL.md](CONFIGURACION_PANEL.md) para instrucciones detalladas.

### Características del panel:

- ✅ **Monitoreo en tiempo real** del estado del bot
- ✅ **Heartbeat automático** cada 60 segundos
- ✅ **Caché de grupos** de WhatsApp actualizada
- ✅ **Comandos remotos** (reintentar inscripción, actualizar grupos, reiniciar bot)
- ✅ **Visualización de inscripciones** y estudiantes
- ✅ **Logs centralizados**

### Configuración rápida:

1. Crear usuario bot en el panel:
   ```bash
   cd ../Panel_Bot
   node create-bot-user.js
   ```

2. Agregar variables al `.env` del bot:
   ```env
   PANEL_URL=http://localhost:4000/api
   PANEL_BOT_USER=bot-service
   PANEL_BOT_PASSWORD=BotWhatsapp2025
   ```

3. Probar la conexión:
   ```bash
   npm run test-panel
   ```

4. Iniciar el bot normalmente:
   ```bash
   npm start
   ```

Ver el estado del bot en el panel web: `http://localhost:3000/bot-monitor`

## ⚠️ Advertencias Importantes

1. **Términos de Servicio de WhatsApp:** El uso de automatización puede violar los términos de servicio de WhatsApp. Usa bajo tu propio riesgo.

2. **Rate Limiting:** WhatsApp puede limitar o banear cuentas que agregan muchos usuarios en poco tiempo. El bot implementa delays, pero no garantiza inmunidad.

3. **Privacidad:** El bot procesa y almacena información personal de estudiantes. Asegúrate de cumplir con leyes de protección de datos.

4. **Backup:** Realiza backups regulares de la base de datos PostgreSQL.

## 📞 Soporte

Para reportar problemas o solicitar features:
- Abre un Issue en GitHub
- Revisa la sección de Troubleshooting
- Consulta los logs en `logs/`

---

**Versión:** 2.0.0 - Sistema completo con OCR y PostgreSQL
