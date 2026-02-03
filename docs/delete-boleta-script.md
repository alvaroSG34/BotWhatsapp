# Script de Eliminación de Boletas

## Archivo Creado
**`delete-student-boleta.js`** - Script interactivo para eliminar boletas de estudiantes

## Uso

### Comando Básico
```bash
npm run delete-boleta <numero_registro>
```

o directamente:
```bash
node delete-student-boleta.js <numero_registro>
```

### Ejemplo
```bash
npm run delete-boleta 222009752
```

## Funcionalidades

### 1. Búsqueda de Estudiante
- Busca por número de registro
- Muestra información completa:
  - ID, nombre, registro, WhatsApp
  - Total de materias registradas
  - Número de boletas

### 2. Listado de Boletas
Para cada boleta muestra:
- ID de la boleta
- Estado (pendiente/procesando/completado)
- Número de materias
- Fecha de subida
- Hash del documento (primeros 20 caracteres)

### 3. Detalle de Materias
Para cada boleta lista:
- SIGLA (ej: INF412)
- Grupo (ej: SA)
- Nombre de la materia
- Estado de agregado (pendiente/agregado/fallido)

### 4. Opciones de Eliminación

#### Opción 1: Eliminar TODAS las boletas
- Elimina todas las boletas del estudiante
- Mantiene el registro del estudiante
- Resetea el contador de `total_materias_registradas` a 0
- Útil para: Limpiar historial manteniendo el estudiante

#### Opción 2: Eliminar TODO
- Elimina el registro del estudiante completo
- Elimina automáticamente todas sus boletas (CASCADE)
- Elimina automáticamente todas las líneas de boleta_grupo (CASCADE)
- Útil para: Como si el estudiante nunca hubiera usado el bot

#### Opción 3: Eliminar boleta específica
- Permite seleccionar una boleta por ID
- Elimina solo esa boleta
- Actualiza el contador restando las materias exitosamente agregadas
- Útil para: Eliminar un documento duplicado o erróneo

#### Opción 0: Cancelar
- Sale sin hacer cambios

## Confirmaciones de Seguridad

El script pide confirmación antes de cada eliminación:
- "¿Continuar? (si/no):"
- Solo acepta "si" o "sí"
- Cualquier otra respuesta cancela la operación

## Actualizaciones Automáticas

### Al eliminar todas las boletas (Opción 1):
```sql
UPDATE estudiantes SET total_materias_registradas = 0
```

### Al eliminar boleta específica (Opción 3):
```sql
UPDATE estudiantes 
SET total_materias_registradas = GREATEST(0, total_materias_registradas - <count>)
```

Donde `<count>` es el número de materias en estado `agregado` de esa boleta.

## Ejemplo de Salida

```
🔍 Buscando estudiante con registro: 222009752

📋 ESTUDIANTE ENCONTRADO:
   ID: 1
   Nombre: HUANCA CHOQUE DAVID
   Registro: 222009752
   WhatsApp: 59178167027@c.us
   Materias registradas: 3

📄 BOLETAS ENCONTRADAS (2):

   [1] ID: 2
       Estado: procesando
       Materias: 3
       Fecha subida: 3/2/2026, 6:34:17 p. m.
       Hash: 36e2ed318e4e43573247...

   [2] ID: 1
       Estado: completado
       Materias: 3
       Fecha subida: 2/2/2026, 1:54:08 p. m.
       Hash: 5a40e4fcf2a7d8d7cfaf...

   📚 Materias de boleta ID 2:
       • INF412 - Grupo SA (fallido)
         Sistema de Información 2
       • INF413 - Grupo SA (fallido)
         Redes 2
       • INF423 - Grupo SC (fallido)
         Sistemas Operativos 2

   📚 Materias de boleta ID 1:
       • INF412 - Grupo SA (agregado)
         Sistema de Información 2
       • INF413 - Grupo SA (agregado)
         Redes 2
       • INF423 - Grupo SC (agregado)
         Sistemas Operativos 2

⚠️  OPCIONES DE ELIMINACIÓN:

   [1] Eliminar TODAS las boletas (mantener estudiante)
   [2] Eliminar TODO (estudiante + boletas)
   [3] Eliminar boleta específica por ID
   [0] Cancelar

Selecciona una opción: _
```

## Casos de Uso

### Caso 1: Eliminar Duplicados
**Escenario:** Estudiante subió la misma boleta dos veces (diferentes fotos)

**Solución:**
1. Ejecutar script: `npm run delete-boleta 222009752`
2. Ver las 2 boletas listadas
3. Seleccionar opción `[3]` (eliminar específica)
4. Ingresar ID de la boleta duplicada (ej: `2`)
5. Confirmar con `si`

**Resultado:** Solo se elimina la boleta duplicada, se mantiene la original

### Caso 2: Resetear Estudiante para Testing
**Escenario:** Quieres probar el flujo completo con un estudiante de testing

**Solución:**
1. Ejecutar script: `npm run delete-boleta <registro_test>`
2. Seleccionar opción `[1]` (eliminar todas las boletas)
3. Confirmar con `si`

**Resultado:** Estudiante queda limpio pero registrado, puede volver a subir boletas

### Caso 3: Eliminar Estudiante Completo
**Escenario:** Estudiante pidió eliminar todos sus datos (GDPR/privacidad)

**Solución:**
1. Ejecutar script: `npm run delete-boleta <registro>`
2. Seleccionar opción `[2]` (eliminar TODO)
3. Confirmar con `si`

**Resultado:** Como si el estudiante nunca hubiera usado el bot

## Seguridad

### Operaciones Irreversibles
⚠️ **TODAS las eliminaciones son permanentes y no se pueden deshacer**

### Respaldos Recomendados
Antes de eliminar datos importantes:
```bash
# Respaldar tabla estudiantes
pg_dump -U postgres -d enrollment_db -t estudiantes > backup_estudiantes.sql

# Respaldar tabla boletas
pg_dump -U postgres -d enrollment_db -t boletas_inscripciones > backup_boletas.sql

# Respaldar completo
pg_dump -U postgres -d enrollment_db > backup_completo.sql
```

### Restaurar desde Respaldo
```bash
psql -U postgres -d enrollment_db < backup_completo.sql
```

## Manejo de Errores

### Error: No se encontró estudiante
```
❌ No se encontró estudiante con ese número de registro
```
**Causa:** El número de registro no existe en la base de datos
**Solución:** Verificar el número de registro

### Error: readline was closed
Este error ocurre cuando el input es cerrado antes de completar (ej: usando pipes)
Es esperado y no afecta la funcionalidad normal del script.

## Comandos SQL Equivalentes

### Eliminar todas las boletas (manualmente)
```sql
DELETE FROM boletas_inscripciones 
WHERE id_estudiante = (
    SELECT id FROM estudiantes WHERE numero_registro = '222009752'
);

UPDATE estudiantes 
SET total_materias_registradas = 0 
WHERE numero_registro = '222009752';
```

### Eliminar estudiante completo (manualmente)
```sql
DELETE FROM estudiantes WHERE numero_registro = '222009752';
-- Las boletas se eliminan automáticamente por CASCADE
```

### Eliminar boleta específica (manualmente)
```sql
-- Contar materias agregadas
SELECT COUNT(*) FROM boleta_grupo 
WHERE id_boleta = 2 AND estado_agregado = 'agregado';

-- Eliminar boleta
DELETE FROM boletas_inscripciones WHERE id = 2;

-- Actualizar contador (reemplazar 3 con el count anterior)
UPDATE estudiantes 
SET total_materias_registradas = GREATEST(0, total_materias_registradas - 3)
WHERE id = 1;
```

## Testing

Para ver un ejemplo sin hacer cambios:
```bash
node test-show-delete-example.js
```

Esto muestra estudiantes disponibles y las instrucciones de uso sin ejecutar ninguna eliminación.
