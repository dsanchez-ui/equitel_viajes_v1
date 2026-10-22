# Revisión de seguridad — 22 de octubre de 2026

**Resumen.** El riesgo real en producción estaba en dos lugares:

- **Node 20 en la imagen de Cloud Run.** Ya no tiene soporte ni recibe la corrección de seguridad del 20-oct, que trae 10 CVE.
- **El servidor de archivos `serve`.** Traía una versión de `compression` con una denegación de servicio.

Las dos cosas quedaron corregidas en el repositorio y probadas, y `npm audit` pasó de 6 avisos a 0. Además, el dashboard de costos verifica Chart.js con una huella de integridad (SRI).

**Desplegado el 22-oct:** la construcción de Cloud Build usó `node:24.22.1-alpine`, terminó con 0 vulnerabilidades y quedó como la revisión `00218` (commit `51ae8de`). Producción responde comprimido y la app carga. Node 24.22.1 también quedó instalado en el PC Linux. Lo demás no aplica a este proyecto (Next.js, PHP, PostgreSQL, librerías de correo) o depende de David: el Node y el Python de los equipos. Se confirmó con `gcloud` que Cloud Build construye producción con este Dockerfile.

## 1. Inventario

| Componente | Versión | Dónde corre |
|---|---|---|
| App web | React 19.2.4, Vite 6.4.3 → **6.4.4**, TypeScript 5.8.3, Tailwind 4.2.2. Compila a archivos estáticos (un solo JavaScript, #A96) | Cloud Run. Un push a `main` dispara Cloud Build |
| Servidor de la app | `serve` 14.2.6 dentro de un contenedor Node (`Dockerfile`) | Cloud Run |
| Node.js | Dockerfile: `node:20-alpine` sin versión fija → **`node:24.22.1-alpine` fija en las dos etapas**. PC Linux: 20.20.2 | Imagen de Cloud Run y equipos de desarrollo |
| npm y lockfile | npm 10.8.2 en el PC; npm 11.19.1 con Node 24. `package-lock.json` v3, 236 paquetes, todos de `registry.npmjs.org` y con su hash de integridad | — |
| Backend | Google Apps Script (V8), en dos proyectos: el principal (`Code.gs` y páginas HTML) y el del rastreo de precios (`Rastreo.gs`) | Google |
| Base de datos | Google Sheets. No hay PostgreSQL ni otra base de datos | Google |
| Correo | Lo envía Apps Script con Gmail. La app web no envía correos: no tiene SMTP ni librería de correo | Google |
| Python | Solo `tools/entorno-prueba/exportar_base.py` (openpyxl 3.1.5), una herramienta local. El PC tiene Python 3.14.4 | PC |
| PHP | No hay | — |
| Código externo en el navegador | Chart.js 4.4.1 desde jsDelivr, en el dashboard de costos | Navegador |

## 2. Resultado por componente

| Componente | Versión antes → después | Avisos | ¿Afectaba? | Estado |
|---|---|---|---|---|
| **Node.js en producción** (imagen) | 20 (sin fijar) → **24.22.1** | CVE-2026-111497 (Brotli, ejecución de código), CVE-2026-105482, CVE-2026-105483, CVE-2026-106069 y otros 6 del [aviso del 20/21-oct](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) | **Sí.** Node 20 no tiene soporte desde abril de 2026 y no recibe la corrección | **Corregido** en el repo; falta desplegar |
| Node.js en el PC de desarrollo | 20.20.2 | Los mismos | Sí, solo en desarrollo | **Pendiente:** lo instala David (§5) |
| **compression** (producción, dentro de `serve`) | 1.8.1 → **1.8.2** | [GHSA-vc2v-76pw-4v95](https://github.com/advisories/GHSA-vc2v-76pw-4v95) (alta, denegación de servicio) | **Sí.** Es el servidor que atiende a los usuarios | **Corregido** con `overrides`. Además, `serve` ahora se instala desde el lockfile (antes era global y no lo usaba) |
| brace-expansion (producción, dentro de `serve`) | 1.1.18 → **1.1.21** | [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) (altas, denegación de servicio) | Poco: solo actúa con la configuración propia de `serve` | **Corregido** |
| fast-uri (producción, dentro de `serve`) | 3.1.7 → **3.1.8** | [GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj) (moderada) | Poco: validación de la configuración de `serve` | **Corregido.** No se usó la 3.1.9, publicada hace 3 días |
| vite (desarrollo) | 6.4.3 → **6.4.4** | [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) (alta); [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv), [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw), [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) (moderadas); [GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw) (baja) | Solo el servidor de desarrollo en el PC; no se publica | **Corregido.** No se usó la 6.4.5, publicada hace 1 día |
| source-map-js (desarrollo) | 1.2.1 → **1.2.2** | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) (alta, denegación de servicio) | Solo al compilar | **Corregido** |
| Chart.js (dashboard de costos) | 4.4.1 sin verificar → 4.4.1 **con SRI** | Ninguno en [OSV](https://osv.dev). El riesgo es que el CDN sirva un archivo alterado | Endurecimiento | **Corregido.** Falta pegar `CostsDashboard.html` |
| Scripts de instalación (npm 11) | — | — | Solo esbuild tiene uno y lo necesita para compilar | **Aprobado solo esbuild 0.25.12** (`"allowScripts"`) |
| Next.js | No se usa | CVE-2026-96889, GHSA-673q-mjm6-r5xr, GHSA-p3m5-59mp-jv5r (según la lista recibida) | No | No aplica |
| React con Server Components | 19.2.4, sin `react-server-dom-*` | Avisos de Server Components | No: la app solo corre en el navegador | No aplica. La 19.2.9 salió hace 8 días y no hace falta |
| Librería de envío de correo | No está en el árbol de dependencias | 8 avisos hasta la 10.0.9 (según la lista recibida) | No | No aplica |
| sharp, braces, micromatch, fast-glob, eslint-config-next | No están | — | No | No aplica |
| Paquetes comprometidos de 2026 (Shai-Hulud y variantes, MALFEX, node-ipc) | Ninguno en el lockfile; los 236 paquetes vienen del registro oficial con integridad | — | No | Revisado |
| PHP | No hay | CVE-2026-109618, CVE-2026-109619 (según la lista recibida) | No | No aplica |
| PostgreSQL | No hay (Google Sheets) | CVE-2026-6473 (según la lista recibida) | No | No aplica |
| Python del PC | 3.14.4 | CVE-2026-15308 (HTMLParser). Además, [3.14.9](https://www.python.org/downloads/release/python-3149/) (21-oct) actualiza los certificados por el caso eMudhra | Solo el PC. El script del proyecto no usa HTMLParser | **Pendiente:** actualizar el sistema (David) |
| openpyxl | 3.1.5 | Ninguno en OSV | — | Sin cambios |
| markdown-it (generador de PDF de `docs/`) | Se instala al vuelo, sin versión fija | GHSA-gfr2-rv44-r23c, GHSA-vfgh-jcmw-g37q (corregidos en 14.3.3, publicada el 16-oct) | Bajo: solo procesa documentos propios en el PC | **Pendiente:** fijar 14.3.3 cuando cumpla dos semanas (30-oct) |
| Apps Script principal | — | No tiene versiones que parchear. 0 llamadas a internet (`UrlFetchApp`), sin librerías de terceros en el código | — | Revisado. Su manifiesto no está en el repo: **David revisa los permisos** (§5) |
| Apps Script del rastreo | — | Permisos: `spreadsheets`, `script.external_request` y `script.scriptapp`. La llave de SerpApi está en las propiedades del proyecto | Son los que necesita | Revisado |
| Llaves y secretos | — | Ninguna llave escrita en archivos del repositorio. `.serpapi-key` e `.ignav-key` están en `.gitignore` y no se versionan | — | Revisado |

Los avisos marcados «según la lista recibida» no se verificaron contra la fuente oficial, porque esos componentes no están en el proyecto. Todo lo demás se verificó contra el aviso oficial, `npm audit`, el lockfile u OSV.

**Lo más nuevo que la lista original** (buscado el 22-oct):
- Python 3.14.9 y 3.13.17, del 21-oct.
- vite 6.4.5 (21-oct) y fast-uri 3.1.9 (19-oct): no hacen falta, porque las versiones usadas ya corrigen los avisos.
- Los avisos de markdown-it.
- Node no tiene nada después del 21-oct.

**Una precisión sobre el aviso de Node:** según el aviso oficial, CVE-2026-105483 afecta solo a las líneas 24 y 26. Las versiones 24.22.1 y 22.23.4 tienen fecha del 20-oct en el índice de nodejs.org.

## 3. Qué cambió

- **`Dockerfile`:**
  - `node:24.22.1-alpine` en las dos etapas;
  - en la imagen final, `serve` se instala con `npm ci --omit=dev --ignore-scripts` desde el lockfile, para que use las versiones corregidas, y se arranca con `./node_modules/.bin/serve`.
- **`package.json`:**
  - `vite` `^6.4.4`;
  - `overrides`: compression 1.8.2, brace-expansion 1.x → 1.1.21, fast-uri 3.1.8 y source-map-js 1.2.2;
  - `allowScripts`: solo esbuild 0.25.12.
- **`package-lock.json`:** solo entra un paquete nuevo, `destroy` 1.2.0, que es la dependencia de compression 1.8.2. Cambian 5 versiones y no sale ninguno; todo viene de `registry.npmjs.org`.
- **`server/CostsDashboard.html`:** Chart.js `dist/chart.umd.js` con `integrity="sha384-…"` y `crossorigin="anonymous"`.
  - Es el mismo archivo del paquete de npm, cuya huella coincide con la publicada, y jsDelivr lo sirve igual.
  - Antes se usaba `chart.umd.min.js`, que genera jsDelivr y cuya huella podría cambiar.
- **`MIGRACION.md`:** Node 24 y npm 11 para equipos nuevos.

## 4. Cómo se probó (sin tocar producción ni escribirle a nadie)

- **`npm audit`:** de 6 avisos a 0 en todo el árbol, y de 4 a 0 solo en producción.
- **Node 24.22.1:**
  - descargado de nodejs.org;
  - el archivo coincide con el SHA256 de `SHASUMS256.txt`;
  - la firma de `SHASUMS256.txt.asc` es válida («Good signature»), con una llave activa de [nodejs/release-keys](https://github.com/nodejs/release-keys).
- **`npm run verify` con Node 24:** en verde (tipos, sintaxis del backend, todas las pruebas del proyecto, compilación y un solo archivo JavaScript). Con el Node 20 / npm 10 actual también se instala y compila: los equipos no se rompen mientras se actualizan.
- **Las dos etapas del Dockerfile**, reproducidas en carpetas limpias con Node 24, porque este PC no tiene Docker:
  - `npm ci` limpio, con el script de esbuild aprobado, compila la app;
  - la etapa final instala solo producción, `serve` responde 200, las rutas internas llevan a la app y la respuesta sale comprimida con `compression` 1.8.2.
- **Las imágenes `node:24.22.1-alpine` y `node:22.23.4-alpine`** existen en Docker Hub (actualizadas el 22-oct).
- **La app completa con Node 24** (entorno local con el `Code.gs` real y una copia de la base):
  - viajero: panel, solicitud nueva, detalle y «Cambiar mi viaje»;
  - Laura: panel, detalle, Métricas y «Compras y costos»;
  - dashboard de costos: entra, carga Chart.js verificado con SRI y dibuja las gráficas;
  - panel móvil.

  Hubo 0 errores de JavaScript, y ningún correo salió: el entorno los guarda en una bandeja local.

## 5. Pendiente: qué falta, por qué y quién lo decide

1. **Desplegar.** Lo autoriza David.
   - El push lleva este cambio junto con #A106 y #A107.
   - Cloud Build construirá por primera vez con Node 24. Si la construcción falla, Cloud Run sigue con la versión anterior y no hay caída.
   - Después del push hay que confirmar que producción sirve la versión nueva.
2. ~~Confirmar que Cloud Build usa el Dockerfile.~~ **Resuelto el 22-oct con `gcloud`** (solo lectura):
   - El activador `rmgpgab-sistematiquetesequitel-us-west1-dsanchez-ui-equitel-rxk` (proyecto `gen-lang-client-0192295875`) corre `docker build .` con este Dockerfile, sube la imagen y actualiza el servicio `sistematiquetesequitel` (us-west1). No usa buildpacks.
   - La última construcción (21-oct, commit `8869b09`, la que está sirviendo) usó `FROM node:20-alpine` y `npm install -g serve@14.2.6`: **producción tiene hoy Node 20 y compression 1.8.1**. El próximo push lo corrige.
3. **Node 24.22.1 en el PC Linux y en el Mac** (David). Se instala desde nodejs.org o con el gestor que use cada equipo. Este informe no cambió el Node del sistema: las pruebas usaron una copia aparte.
4. **Python del PC a 3.14.9** con las actualizaciones del sistema operativo (David). El proyecto no lo usa en producción.
5. **Permisos del proyecto principal de Apps Script** (David). En el editor: *Configuración del proyecto* → *Mostrar el archivo de manifiesto «appsscript.json»*. Confirmar que no tenga `script.external_request` (#A62) ni librerías que nadie reconozca.
6. **markdown-it 14.3.3 fija como dependencia de desarrollo** desde el 30-oct, cuando cumpla dos semanas publicada. Lo hace Claude en una próxima sesión.

## 6. Fuentes

- Índice de versiones de Node: <https://nodejs.org/dist/index.json>. Aviso de octubre de 2026: <https://nodejs.org/en/blog/vulnerability/october-2026-security-releases>.
- Avisos de npm: los enlaces de la tabla (GitHub Advisory Database), tal como los reporta `npm audit`.
- Versiones de Python: <https://www.python.org/api/v2/downloads/release/> y <https://www.python.org/downloads/release/python-3149/>.
- Consultas de vulnerabilidades: <https://api.osv.dev/v1/query>.
- Imágenes de Docker: `hub.docker.com/v2/namespaces/library/repositories/node/tags/<etiqueta>`.
