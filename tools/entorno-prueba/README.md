# Entorno de prueba local

Para probar la app **tal cual se va a publicar** antes de hacer push, sin tocar producción.

- La app es el mismo build de producción (`vite build`), apuntando a un servidor de este PC.
- El backend es el `server/Code.gs` real, corriendo en Node sobre una **copia en memoria** de la base exportada.
- **Nada sale a Google:** la hoja vive en la memoria del proceso, los archivos van a un Drive simulado y **los correos no se envían**: quedan en una bandeja local (`/correos`), donde los botones de aprobar y rechazar funcionan contra la copia.
- Solo escucha en `127.0.0.1`: no se ve desde otros equipos.
- Al cerrarlo (Ctrl+C) se pierde todo: la próxima vez arranca otra vez desde la copia exportada.

## Cómo se corre

1. Exportar la hoja de producción a `.xlsx` (Archivo → Descargar → Microsoft Excel). **Trae datos personales:** se queda en este PC y nunca va al repositorio.
2. Correr:

   ```bash
   npm run prueba:local -- --base "/ruta/Sistema Tiquetes Equitel V2.xlsx"
   ```

3. Abrir <http://127.0.0.1:8787>: la página de inicio tiene los enlaces (la app, el dashboard de costos y la bandeja de correos), los usuarios de prueba y un recorrido sugerido.

Requisitos: `npm install` hecho y Python 3 con `openpyxl` (`pip install --user openpyxl`) para leer el `.xlsx`.

Opciones: `--pin 24682468` (el PIN de todos, 8 dígitos), `--puerto-api 8787`, `--puerto-app 3100`, `--sin-build` (usa el último build; más rápido si no cambió el frontend).

## Quién entra

| Quién | Correo | Cómo |
|---|---|---|
| Viajero de prueba (PRUEBA1) | `dssanchezr2002@gmail.com` | Correo y PIN |
| Su aprobador (PRUEBA2) | `petersimons988@gmail.com` | Aprueba desde el correo en la bandeja |
| Área de compras | `compras.equitel@equitel.com.co` | Botón ADMINISTRADOR |
| David | `dsanchez@equitel.com.co` | Botón ADMINISTRADOR; ve el comparador en el dashboard de costos |

El PIN de todos (usuarios y administrador) es `24682468`. Cualquier otro usuario de la copia también puede entrar con ese PIN.

Al arrancar se crean cinco viajes de PRUEBA1, con fechas relativas a hoy, para probar «Cambiar mi viaje» (#A103):

- comprado, sale en 10 días;
- comprado, sale mañana;
- en curso;
- aprobado sin comprar;
- solo hospedaje.

## Capturas de pantalla (para el agente)

Así se sacaron las capturas de #A103 a #A127, sin abrir una ventana:

1. Chrome sin pantalla, con el puerto de depuración: `google-chrome --headless=new --remote-debugging-port=9334
   --user-data-dir=<carpeta temporal> --window-size=1400,1000 about:blank` (en el Mac, el ejecutable es
   `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`).
2. Un script de Node (el `WebSocket` ya viene en Node 24) que se conecta por CDP, navega a <http://127.0.0.1:3100>,
   hace clic con `Runtime.evaluate` y guarda `Page.captureScreenshot`.
3. **Para entrar sin escribir el PIN:** `POST http://127.0.0.1:8787/exec` con
   `{"action":"verifyUserPin","payload":{"email":…,"pin":"24682468","userEmail":…}}` (administrador:
   `verifyAdminPin` con `{pin, email, userEmail}`). La respuesta trae `token`, `expiresAt` y `role`; se guardan en
   `localStorage.equitel_session` como `{email, token, expiresAt, role}` y se recarga la página.

Los scripts quedan en la carpeta temporal del agente, no en el repositorio. Para cerrar el entorno, matar el
proceso que escucha en el puerto 8787 (`ss -ltnp | grep :8787` en Linux, `lsof -i :8787` en el Mac). **Nunca matar
Chrome con `pkill -f` y un texto que también esté en el comando que lo ejecuta:** se mata la propia terminal.

## Qué no hace

- No corre los activadores (recordatorios, resumen del CFO, informe mensual, copia de seguridad).
- No abre otras hojas de Google (lista de RR. HH.) ni crea informes en Google Docs.
- Los archivos que ya están en producción se abren en Drive como siempre; los que se suban en la prueba quedan en el Drive simulado.
