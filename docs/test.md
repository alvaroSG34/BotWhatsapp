# PROMPT: Simulación de Estrés Asíncrono y Concurrencia (WhatsApp Bot)

Actúa como un Ingeniero de Software de Pruebas (SDET) experto en Node.js y asincronía.

**Objetivo:**
Quiero crear un script de prueba (`test_stress.js`) que simule una "Avalancha de Tráfico" hacia la lógica de mi bot de WhatsApp. El objetivo es probar si la gestión de memoria y las promesas aguantan cuando **20 usuarios interactúan EXACTAMENTE al mismo tiempo**.

## 1. El Escenario a Simular
Tengo un bot con el siguiente flujo de estado:
1.  **Estado 1:** Usuario envía FOTO -> Bot procesa (tarda 500ms simulados) -> Bot guarda en Memoria -> Bot responde.
2.  **Estado 2:** Usuario responde "LISTO" -> Bot lee Memoria -> Bot llama a API (tarda 1s simulado) -> Bot elimina de Memoria.

## 2. Requerimientos del Script
Quiero que escribas un script **autocontenido** (standalone) que haga lo siguiente:

### A. Mocking de Infraestructura
* Crea un `MockSocket` que simule ser la librería `Baileys`. Sus métodos (`sendMessage`, `groupParticipantsUpdate`) deben ser asíncronos y tener un `setTimeout` aleatorio para simular latencia de red real.
* Crea una `MockMemory` (Map) compartida.

### B. La Lógica "Dummy"
* Implementa una función `handleMessage(msg, socket, memory)` que simule la lógica del bot descrita arriba.
* **Importante:** Asegúrate de usar `await` en los lugares correctos para que la prueba de estrés tenga sentido.

### C. La Prueba de Estrés (The Avalanche)
Esta es la parte crítica. No quiero un bucle `for` secuencial.
1.  Genera 20 JIDs de usuarios falsos.
2.  Usa `Promise.all()` para disparar el **Evento de Imagen** de los 20 usuarios simultáneamente.
3.  Loguea en consola el tiempo de inicio y fin de cada uno para ver si se procesan en paralelo.
4.  Inmediatamente después, usa `Promise.all()` para disparar el **Evento "LISTO"** de los 20 usuarios.

## 3. Lo que busco detectar (Race Conditions)
El script debe tener logs detallados que me permitan ver:
* Si la memoria se sobrescribe incorrectamente.
* Si el bot intenta procesar el "LISTO" antes de que la "FOTO" haya terminado de guardarse (Race Condition).
* Cómo se comporta el sistema bajo carga paralela.

## 4. Output Esperado
Entrégame un solo archivo `.js` ejecutable con Node que corra esta simulación y muestre un reporte final en consola:
* Usuarios procesados correctamente: X/20.
* Errores de concurrencia: Y.
* Tiempo total de ejecución.