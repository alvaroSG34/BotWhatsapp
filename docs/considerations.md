# PROTOCOLO DE CONDUCTA ANTI-BANEO PARA AUTOMATIZACIÓN DE WHATSAPP

## 1. Principio Fundamental: Comportamiento Humano
El sistema no debe comportarse como una máquina eficiente, sino simular las imperfecciones y tiempos de un operador humano. La velocidad es el principal delator de un bot.

## 2. Reglas de Interacción (El "Handshake")
Para evitar reportes de spam y violaciones de privacidad al gestionar grupos, se debe seguir estrictamente este flujo:

* **Regla de "No Invasión":** Nunca intentar añadir a un usuario a un grupo sin una confirmación explícita previa en el chat actual.
* **Protocolo de Contacto Guardado:** Antes de ejecutar la acción de añadir al grupo, el sistema debe solicitar al usuario que **guarde el número del bot en su agenda**.
* **Doble Confirmación:** La acción de añadir al grupo solo debe dispararse cuando el usuario confirma (mediante una palabra clave como "Listo") que ya ha realizado el paso anterior.

## 3. Reglas de Tiempos y Latencia (Jitter)
* **Prohibición de Inmediatez:** El sistema nunca debe responder en menos de 2 segundos a un mensaje entrante.
* **Aleatoriedad Obligatoria:** Los tiempos de espera entre la recepción del mensaje y la respuesta nunca deben ser fijos. Deben variar aleatoriamente dentro de un rango realista (ej. entre 5 y 15 segundos).
* **Simulación de Presencia:** Antes de enviar cualquier texto o archivo, el sistema debe emitir el estado de "Escribiendo..." durante un tiempo proporcional a la longitud del mensaje que va a enviar.

## 4. Reglas de Iniciativa y Volumen
* **Reactividad Estricta:** El bot nunca debe iniciar una conversación con un número que no le haya escrito primero en las últimas 24 horas. (No enviar mensajes en frío).
* **Procesamiento en Serie:** Si hay múltiples solicitudes pendientes, deben procesarse una por una con pausas entre ellas. Nunca procesar lotes masivos simultáneamente.
* **Límites Diarios:** Mantener un volumen de operaciones de "añadir a grupo" prudente y distribuido a lo largo del día, evitando picos de actividad inusuales.