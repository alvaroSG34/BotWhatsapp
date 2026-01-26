Descripción del flujo (WhatsApp + extracción desde boleta PDF/imagen)
Objetivo

Automatizar la atención por WhatsApp para que, cuando un estudiante envíe su boleta de inscripción (PDF o foto) a un número de WhatsApp, el sistema:

Reciba el archivo

Extraiga automáticamente los datos de la boleta:

Nombre completo

Número de registro

Materias inscritas

Grupos inscritos

Responda al estudiante en el mismo chat con un mensaje formateado confirmando su inscripción.

Flujo paso a paso (lo que debe hacer el bot)
1) Recepción del mensaje

El estudiante escribe al WhatsApp del bot y manda su boleta en PDF o foto.

El bot detecta que llegó un archivo y responde:

“✅ Recibí tu boleta. Dame unos segundos para verificar tus datos.”

2) Validación del archivo

Si el archivo no es legible o viene incompleto, el bot responde:

“⚠️ No pude leer tu boleta. Envíala nuevamente en PDF o una foto clara (sin recortes y con buena luz).”

3) Extracción de datos

El bot debe leer la boleta y extraer:

Nombre completo

Nro. de registro

Lista de materias

Grupo de cada materia (o paralelo)

Nota: si la boleta viene en PDF con texto seleccionable, se extrae directo.
Si viene como foto o PDF escaneado, se hace lectura tipo OCR.

4) Confirmación y respuesta automática

Una vez extraído, el bot responde con un mensaje final:

Plantilla de respuesta (exacta)

Hola, {NOMBRE} 👋
Tu número de registro es: {NRO_REGISTRO}
Tus materias y grupos inscritos son:
{LISTA_MATERIAS_CON_GRUPO}
✅ Inscripción verificada.

Ejemplo de lista:

Redes 1 — Grupo 02

Programación 2 — Grupo 01

Matemática Discreta — Grupo 03

5) Manejo de errores (casos comunes)

Falta el número de registro:
“⚠️ Pude leer tu nombre, pero no encontré tu número de registro. Envíame una foto más clara o el PDF original.”

Detecta materias pero sin grupos:
“⚠️ Encontré tus materias, pero no se distinguen los grupos. Envíame la boleta con mejor resolución.”

Boleta repetida:
“✅ Ya tengo registrada esta boleta. Si inscribiste materias nuevas, envíame la boleta actualizada.”