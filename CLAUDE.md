# Equitel Viajes — Guía de Proyecto para Claude

> Este archivo viaja con el repo y Claude Code lo lee automáticamente en cualquier
> máquina. Es la memoria portable del proyecto. Para el detalle histórico de cada
> bug y decisión, ver [BUG_REPORT.md](BUG_REPORT.md) (#A1–#A88) — es el diario real
> del proyecto y la fuente de verdad sobre por qué las cosas son como son.
>
> Para instalar el proyecto en una máquina nueva, ver [MIGRACION.md](MIGRACION.md).

## Qué es

Plataforma web de gestión de viajes corporativos de la Organización Equitel
(Colombia). Los empleados solicitan viajes, sus jefes aprueban por correo, y el
equipo de viajes (analista) gestiona opciones de vuelo/hotel, costos y reservas.
**Está en producción y en uso diario real.** Cualquier cambio afecta a gente que
está viajando.

**Stack:** React 19 + TypeScript + Tailwind 4 + Vite 6 en el frontend; Google Apps
Script como backend (web app pública); Google Sheets como base de datos; Drive para
archivos; Gmail para notificaciones.

## Reglas de trabajo (importantes)

1. **No hacer `git push` sin informar antes** qué se cambió y con evidencia de que
   el flujo operativo queda intacto. **Un push a `main` despliega el frontend a
   producción** (ver Mapa de despliegue).
2. **Verificar siempre antes de proponer un push:** `npm run verify` (typecheck +
   sintaxis del backend + paridad del validador de OT + reglas de fecha de
   nacimiento, de celular, de costos y de aerolínea/canal + estadísticas de compra +
   facturas por cerrar y por revisar + rastreo de precios + build). Debe salir en verde.
3. **Revisión de bugs y seguridad al final** de cada cambio, no al principio.
4. Al cerrar un cambio relevante, **agregar su entrada `#Axx` a `BUG_REPORT.md`**
   siguiendo el formato existente (síntoma, causa raíz, fix, verificado, despliegue).
5. Los commits van **en inglés** con prefijo conventional (`fix:`, `feat:`, `chore:`).
   Todo el UI y la documentación van **en español**.

## Cómo se corre en local

```bash
npm install          # regenerar SIEMPRE por máquina — ver MIGRACION.md
npm run dev          # servidor de desarrollo, puerto 3000
npm run verify       # typecheck + sintaxis backend + OT + fecha nac. + celular + costos + compras + aerolínea/canal + facturas por cerrar + rastreo de precios + build  ← antes de cualquier push
npm run build        # build de producción a dist/
npm run build:guia   # regenera los PDF de docs/ (requiere Chrome instalado)
```

**Cuidado con el backend al que apuntas.** `VITE_API_BASE_URL` decide contra qué
deployment de Apps Script corre la app:

| Archivo | Apunta a | Gana en `npm run dev` |
|---|---|---|
| `.env.local` | deployment de **PRUEBA** | **Sí** (Vite prioriza `.local`) |
| `.env` | deployment de **PRODUCCIÓN** | No, si existe `.env.local` |
| default en `constants.ts` | producción | Solo si no hay ninguna env var |

Si necesitas pegarle a producción desde local, renombra `.env.local`. Si no estás
seguro de contra qué estás corriendo, revísalo antes de probar cualquier escritura.

## Mapa de despliegue (crítico)

| Qué | Cómo se despliega | ¿Automático? |
|---|---|---|
| **Frontend** | `git push` a `main` → Cloud Build → Cloud Run | **SÍ — el push despliega** |
| **Backend (`server/Code.gs`)** | Pegar el archivo en el editor de Apps Script → Guardar → **crear versión nueva** del web app | No, 100% manual |
| **Sidebars (`server/*.html`)** | Igual que Code.gs, pegar en el editor | No, manual |
| **Migraciones de hoja** | Ejecutar la función de migración a mano desde el editor o el menú | No, manual |

El trigger de Cloud Build está configurado del lado de GCP (no hay GitHub Actions
en el repo). **Crear la versión nueva del web app conserva el `WEB_APP_URL`** — no
cambia la URL, así que el frontend no necesita reconfigurarse.

**Orden seguro de despliegue:** los cambios se diseñan para ser compatibles en
ambos sentidos (frontend nuevo + backend viejo, y viceversa). Cuando un cambio
toca los dos lados, documentar explícitamente el orden y qué pasa en cada
combinación — así se ha hecho en #A58, #A63 y #A64.

**Rollback:** frontend = revert del commit; backend = seleccionar la versión
anterior del web app (~30 s).

## Flujo de negocio (ciclo de vida de una solicitud)

1. El **solicitante** entra con su correo + PIN → crea la solicitud.
2. **Validación automática de política**: 8 días de anticipación para nacional,
   30 para internacional. Si no cumple, se marca `policyViolation` (no bloquea).
3. El **aprobador de área** (jefe directo, según la hoja `USUARIOS`) aprueba o
   rechaza desde un link firmado en el correo. Puede dejar un **comentario
   opcional**, que prima sobre la selección del usuario (#A58).
4. **Escalamiento automático** — se pide aprobación adicional cuando aplica:
   - Viaje internacional o costo alto → CEO y/o Dirección de Cadena de Suministro.
   - La solicitud haría exceder el presupuesto de la unidad → aprobador de
     presupuesto (#A64).
5. El **analista** sube imágenes de las opciones de vuelo/hotel.
6. El **solicitante** revisa las imágenes y describe **por escrito** cuál eligió.
7. El **analista** confirma los costos finales (tiquetes + hotel).
8. El **analista** registra la reserva (PNR, documento de confirmación).
9. **Post-viaje:** se suben los soportes (facturas, recibos).
10. Estado final: **PROCESADO**.

### Estados (`RequestStatus`)

`PENDIENTE_APROBACION` → `PENDIENTE_OPCIONES` → `PENDIENTE_SELECCION` →
`PENDIENTE_CONFIRMACION_COSTO` → `APROBADO` → `RESERVADO` → `PROCESADO`

Terminales alternos: `DENEGADO`, `ANULADO`. Especial: `PENDIENTE_ANALISIS_CAMBIO`
(hay una solicitud de modificación en curso).

### Roles (`UserRole`)

`REQUESTER` · `ANALYST` (equipo de viajes / admin) · `APPROVER` · `SUPERADMIN`
(puede saltar etapas y revertir a selección).

## Decisiones de negocio vigentes (no se deducen del código)

- **Las opciones de vuelo/hotel son imágenes, no datos estructurados.** Es una
  decisión de seguridad deliberada: obliga al solicitante a describir su selección
  por escrito y evita aprobar un viaje con un solo clic. No "mejorar" esto.
- **Archivos de reserva en `ANYONE_WITH_LINK`** (#A18). Decisión explícita de David
  (2026-04-20): se necesita para que proveedores y pasajeros externos accedan al
  PNR. No cambiar a `DOMAIN_WITH_LINK`.
- **No se puede exceder el presupuesto en ningún mes** (#A64, decisión de David).
  La regla de aprobación usa **la ventana más estricta** entre el periodo
  configurado (`budgetPeriodMonths`, hoy 3 = trimestre) y el mes en curso.
- **Máximo 5 pasajeros** por solicitud; **máximo 5 tramos** en multidestino;
  **máximo 10 creaciones/día** por solicitante (rate limit).
- El backend **no valida nombres de empresa** — se guardan como texto libre.
  Empresas del grupo: **Cumandes** (antes "Cummins", renombrada abril 2026),
  **Equitel**, **Ingenergía**, **LAP**. Las solicitudes históricas siguen diciendo
  "Cummins" y así se quedan.
- Solo una **solicitud de cambio viva** por solicitud (#A63).
- **Orden de Trabajo con formato `OT-<EE><CCC>-<NÚMERO>`** (ej. `OT-CUBTA-110256`),
  validado por estructura y no por lista cerrada de códigos, solo en solicitudes
  nuevas. El campo sigue siendo opcional (#A66).
- **Fecha de nacimiento:** obligatoria al crear un usuario, opcional al editar,
  edad válida entre 15 y 100 años (#A68, confirmado por David el 2026-09-10).
  En solicitudes de **vuelo** es obligatoria para todo pasajero que no la tenga
  (#A70): si está registrado se guarda **una vez** en `USUARIOS` (nunca se
  sobrescribe una fecha válida); si es externo se guarda **solo en la solicitud**.
  Solo hospedaje no la pide. Si la consulta falla, el formulario pide la fecha a
  todos en vez de bloquear.
- **La fecha de nacimiento y el celular por pasajero en el detalle de la solicitud
  solo los ven los administradores** (#A71, #A74). El solicitante no: en una
  solicitud se pueden escribir cédulas ajenas. Llegan dentro de `getRequestById`
  únicamente cuando consulta un administrador (sin segunda llamada). Hacia el
  navegador del solicitante nunca sale una fecha ni un celular.
- **Celular del pasajero** (#A74, #A75): el de un registrado vive solo en `USUARIOS`
  (no se copia a las solicitudes, para que una corrección se vea de inmediato); el de
  un externo, solo en su solicitud. Se carga desde la lista de RR. HH. con el menú
  *8. Cargar celulares* (el **corporativo** si hay uno válido, si no el **personal**;
  solo registrados, no sobrescribe, enlace pedido al ejecutar). Además es un campo
  **opcional** (decisión de David) en el formulario de solicitudes (vuelos y solo
  hospedaje, a quien no lo tenga: sirve para avisar cambios o novedades), en el
  sidebar y en el panel móvil: vacío está bien, pero si se escribe debe ser un
  celular válido (10 dígitos que empiezan por 3). Nunca bloquea por estar vacío ni
  hace esperar en solo hospedaje.
- **Saltar la etapa de aprobación: solo Yurani Prieto y David Sánchez** (#A77, pedido de
  Yurani, 2026-09-14). Es una lista fija en el código (`SKIP_APPROVAL_ALLOWED`) y además
  deben ser administradores. **No depende del rol superadmin**: dar superadmin a alguien
  más no le da este poder. Diego (`directorcompras`) quedó como analista. El menú
  *10. Ver administradores y permisos especiales* lo muestra.
- **La API no acepta estados arbitrarios** (#A77): `updateRequest` solo permite los
  cambios que usa la app (analista: opciones, selección por trazabilidad, confirmar
  costos; solicitante: su selección, en su solicitud y en `PENDIENTE_SELECCION`), y
  `createRequest` siempre crea en `PENDIENTE_OPCIONES`. `APROBADO`, `DENEGADO`,
  `RESERVADO`, `PROCESADO` y `ANULADO` solo llegan por su propio flujo. Nunca confiar en
  el estado que manda el cliente.
- **Dashboard de costos por unidad de negocio** (#A76, pedido de Yurani, 2026-09-14):
  analistas y superadmins ven todas las unidades; cada líder ve **solo** las unidades
  que tiene asignadas en la tabla de accesos de MISC (`TODAS` = todas); **nadie más
  entra**, ni siquiera los aprobadores (reemplaza la regla del 2026-05-11). El filtro
  se aplica en el servidor antes de sumar o contar, nunca en el navegador. Si la
  tabla falta o no se puede leer, solo entran los administradores. Se administra con
  el menú *9. Accesos al dashboard de costos*.
- **Variación cotizado vs facturado: solo Yurani Prieto, Diego Caballero y David Sánchez**
  (#A78, pedido de Yurani, 2026-09-14). Lista fija en el código (`COSTS_VARIANCE_ALLOWED`)
  y además deben ser administradores; no depende del rol ni de la tabla de MISC (`TODAS`
  no la da). Laura y apcompras dejaron de verla. El menú *10* lo muestra.
- **Top 10 de viajeros por costo** en las vistas anual, periodo y mensual del dashboard
  (#A78): el costo de cada viaje se reparte **en partes iguales entre sus pasajeros**
  (decisión de David). Los pasajeros llegan al navegador como ids opacos por respuesta
  (`v1`, `v2`…) con su nombre, **nunca con la cédula**, y se leen después del filtro por
  unidad: un líder solo recibe nombres de quienes viajaron en sus unidades.
- **Costos confirmados en pesos reales** (#A79, decisión de David, 2026-09-14): el modal
  "Confirmar costos" acepta pesos con o sin puntos de miles; 0 es válido (p. ej. un
  apartamento corporativo) y cualquier otro valor debe ser de al menos $10.000
  (`COST_MIN_PESOS`). El backend rechaza decimales y valores imposibles en `updateRequest`
  y recalcula el cotizado como tiquetes + hotel. **Nunca volver a un
  `<input type="number">` para dinero**: con él, `889.518` se guardaba como 889,518 pesos.
- **Estadísticas de compra de tiquetes y hospedaje** (#A80, pedido de David para comparar
  agencias, 2026-09-29): pestaña *Compras y costos* del panel de Métricas, **solo
  administradores** (`getPurchaseStats` en `adminOnlyActions`), solo agregados (sin nombres,
  cédulas ni correos). Reglas, iguales a las del reporte en Excel del 29-sep:
  - solo RESERVADO y PROCESADO
  - tiquetes = pasajeros × 2 con regreso (× 1 sin él)
  - noches-habitación = noches × pasajeros
  - costos menores a $10.000 fuera de los promedios
  - fecha = fecha de compra (o de la solicitud)
  - anticipación = ida − compra
  - festivos de Colombia calculados para cualquier año

  El costo por noche se muestra **separado para estadías de 1 a 6 noches y de 7 o más**:
  las largas tienen tarifas mucho menores y un promedio único engaña al comparar
  cotizaciones.
- **Aerolínea y canal de compra** (#A82, David, 2026-10-02): columnas `AEROLINEA` y
  `CANAL DE COMPRA` (*Aviatur*, *Directo* u *Otra agencia*). Se piden en *Confirmar costos*
  (previsto, en el mismo `updateRequest`) y en *Registrar reserva* (real, con la acción
  `setPurchaseInfo` antes de registrar). Solo hospedaje no lleva aerolínea. Regla gemela en
  `utils/purchase.ts`.
  - **Regreso con otra aerolínea** (#A85, pedido de Laura, 2026-10-06): casilla *"El regreso es
    con otra aerolínea"* en ambos modales, solo en viajes con regreso. `AEROLINEA` es la de ida;
    `AEROLINEA REGRESO` solo se llena si es distinta (vacía = la misma). Solo se toca si la clave
    viene en el payload (`purchaseReturnAirline` / `returnAirline`), así una app anterior no la
    borra; la app solo ofrece la casilla si el servidor manda `purchaseReturnAirline`.
- **Facturas listas para cerrar y por revisar** (#A83, acordado con Laura el 2026-10-01, reglas
  de David del 2026-10-02). **Ninguna solicitud se cierra sola** (David: *"es más seguro"*): el
  panel del analista las muestra y el área de viajes las cierra con el cierre manual de siempre.
  No volver a un disparador que cierre.
  - **Listas para cerrar:** `RESERVADO`, **solo con el viaje terminado** (PROCESADO ya no se
    puede modificar), lo facturado **igual o mayor** que lo cotizado y **al menos un PDF de
    factura subido por cada factura escrita** (con PROCESADO ya no se pueden subir soportes
    desde la app). Facturar de más es normal; menos de $1.000 de diferencia es redondeo.
  - **Por revisar:** si falta algo, desde el día 7 después del viaje, con el motivo (faltan
    facturas o faltan PDF); el analista puede omitir el aviso (columna `AVISO FACTURAS
    OMITIDO`). Si después se completa, pasa a listas para cerrar.
  - Revisar no escribe en la hoja ni envía correos. `cierreAutomaticoPorFacturas` solo borra el
    disparador de la primera versión, si alguien lo activó.
- **Rastreo de precios de tiquetes** (#A84, estudio de ~2 semanas pedido por Alejandro Gómez;
  diseño de David del 2026-10-07): compara lo cotizado con el precio del mercado en Google
  Flights. **Es un proyecto de Apps Script aparte** (`tools/comparador-precios/apps-script/`):
  la plataforma no sale a internet (#A62) y no debe hacerlo para esto.
  - Busca cada solicitud de vuelo con ida futura **al cotizar** (`PENDIENTE_APROBACION`, costos
    confirmados desde el inicio del estudio) y **al comprar** (`APROBADO`, o `RESERVADO` hace
    menos de 6 h). Una vez por momento, cada 15 minutos. Referencia: el más barato saliendo ±2 h
    de la hora pedida (sin hora, el del día), para todos los pasajeros.
  - **Solo lee** la hoja de solicitudes y **solo escribe** sus dos pestañas ocultas. La clave
    de SerpApi vive en las propiedades de ese proyecto, nunca en la hoja ni en el repo.
  - Lo ven en el dashboard de costos las mismas personas que la variación
    (`COSTS_VARIANCE_ALLOWED`); **Laura no lo ve**, ni en la app ni en el dashboard (decisión de
    David). `getPriceTracking` en `Code.gs` solo lee.
  - **La sección habla en lenguaje simple** (#A85, David: "costo mercado no es muy claro"): se
    dice *"Más barato en Google"*, nunca "mercado"; arriba va una frase que responde la pregunta y
    un *"¿Cómo se lee?"*; las diferencias van en palabras (*"$431.444 más caro"*).
  - **Cada tramo se busca por separado** (#A86, David, 2026-10-07): la ida con su hora pedida y
    el regreso con la suya; el viaje = suma de los tramos. Internacional de ida y vuelta: también
    el tiquete redondo, y manda el menor. Nunca volver a una sola búsqueda de ida y vuelta: Google
    da un precio junto (ida + el regreso más barato que combina) que no se encuentra igual en la
    página de la aerolínea. Tocar un viaje abre su detalle (`getPriceTrackingDetail`, mismas
    personas): lo que registró el área de viajes y quién (`costConfirmedBy` en `EVENTOS_JSON`,
    desde #A86), las horas pedidas y todos los vuelos de cada tramo.
  - **Para comprar y para medir** (#A87, reunión del 7-oct con Juan Camilo): cada tramo trae el
    enlace a la misma búsqueda en Google Flights (`search_metadata.google_flights_url`, solo
    direcciones de Google Flights y nunca con la clave) para ir a comprar. Junto al cotizado va lo
    **facturado** (lo ya comprado, mismas reglas que la variación); la factura no separa tiquetes y
    hotel, así que con hotel no se compara con Google.
  - **Solo vuelos directos** (#A88, David, 2026-10-07): a los viajeros no se les compran vuelos
    con escala. Si un tramo tiene directos, solo esos cuentan (a la hora, del día y misma
    aerolínea); los de escala se listan al final en gris. Si ese día no hay directos, cuentan
    los de escala. El enlace y lo facturado están **solo en el dashboard de costos**, nunca en la
    app de Laura.
- **Carga masiva de fechas desde la lista de RR. HH.** (#A72, menú *7. Cargar fechas
  de nacimiento*): solo usuarios **ya registrados** (no crea usuarios), nunca
  sobrescribe una fecha válida distinta (la reporta como conflicto), y el enlace de
  la lista se pide al ejecutar: su ID **no se guarda en el código** porque la hoja
  trae datos personales.
- **Exposición de funciones vía `google.script.run` desde las páginas públicas del
  web app: descartada por decisión de David (2026-09-10).** Constancia técnica y
  verificación en [docs/plan-reunion-2026-09-10.md](docs/plan-reunion-2026-09-10.md),
  sección P0. No volver a plantearla salvo que David lo pida.

## Incidentes pasados — lecciones que no hay que revertir

Detalle completo en `BUG_REPORT.md`. Lo que importa no volver a romper:

- **#A49 — Silencio en los fetches de bootstrap.** Los errores se tragaban y la app
  mostraba arrays vacíos como si fueran datos válidos. **Nunca silenciar un error de
  fetch**: hay que reintentar y avisar al usuario.
- **#A60 — La optimización "lite" casi borra datos.** Las filas de dashboard viajan
  sin `analystOptions`; pasar una fila lite a un modal que reescribe ese campo habría
  **borrado las opciones existentes**. Antes de abrir un modal que escriba, **hidratar
  la solicitud completa** con `getRequestById`.
- **#A61 — Letras de opciones duplicadas.** La siguiente letra se asigna por
  `MAX(letras usadas) + 1`, **nunca por conteo**.
- **#A53 — El botón APROBAR no abría en Chrome móvil Android** con varias cuentas
  de Google. Cuidado al tocar los links de aprobación.
- **#A5 — Links de aprobación firmados con HMAC**, con cutover per-request para no
  invalidar correos en vuelo. No romper esa compatibilidad.
- **#A62 — La integración con IA (Gemini) fue retirada.** Ver abajo.
- **`setupDatabase()` NO se debe ejecutar**: recrearía la hoja `INTEGRANTES`, que
  fue eliminada en producción. Usar las funciones de migración específicas.

## Base de datos (Google Sheets)

| Hoja | Contenido |
|---|---|
| **Nueva Base Solicitudes** | Tabla principal de solicitudes. Columnas leídas por nombre en runtime, así que el orden puede cambiar. `FECHAS NACIMIENTO PASAJEROS (JSON)` guarda `{cédula: AAAA-MM-DD}` de los pasajeros externos (#A70). `CELULARES PASAJEROS (JSON)` guarda `{cédula: celular}` de externos (#A75); la crea el menú 8 (o el sistema, la primera vez que la necesita). `AEROLINEA`, `CANAL DE COMPRA` (#A82), `AVISO FACTURAS OMITIDO` (#A83) y `AEROLINEA REGRESO` (#A85, solo si el regreso es con otra aerolínea) van al final; las crea el menú *12. Columnas de compra y resumen de facturas* (o el sistema, la primera vez que las necesita). |
| **USUARIOS** | Directorio de empleados y su aprobador. **Única fuente de verdad** desde 2026-04-24. ⚠️ A diferencia de la hoja principal, se lee y escribe **por posición** (PIN en la col 10, aprobadores 7–9): columnas nuevas **solo al final**. La columna `Fecha Nacimiento` (#A68) va después de las existentes y se accede **por nombre**: en producción quedó en la O (un valor suelto en N233 corrió la migración) y puede moverse a cualquier posición desde la M sin tocar código. La columna `Celular` (#A74, texto de 10 dígitos) sigue la misma regla: al final y por nombre. Ninguna de las dos viaja al directorio que recibe cada usuario. |
| ~~INTEGRANTES~~ | **Eliminada en producción (2026-04-24).** El cableado legacy sigue en el código (#A50, limpieza pendiente). |
| **MAESTROS** | Centros de costo. |
| **CDS vs UDEN** | Relación centro de costo ↔ unidad de negocio. |
| **CIUDADES DEL MUNDO** | Ciudad/país para el autocompletado. |
| **MISC** | Tarjetas de crédito (A:B), sedes (D) y la tabla de accesos al dashboard de costos (#A76). Los encabezados están en la fila 2 y los datos empiezan en la fila 3. Los encabezados de la tabla de accesos (`DASHBOARD COSTOS · CORREO` / `· UNIDAD DE NEGOCIO`) los crea el menú 9 en la **fila 1** (celdas normales, sin tablas de Google ni listas desplegables) y se buscan por nombre en las filas 1 a 3, así que pueden moverse de columna. |
| **REGLAS_COAPROBADOR** | Reglas de co-aprobación. |
| **COMPARATIVO PRECIOS** / **COMPARATIVO ESTADO** | Ocultas. Las escribe el proyecto aparte del rastreo de precios (#A84): una fila por búsqueda y el estado del rastreo. Las lee el dashboard de costos. No editarlas. |
| **PPTOS UNIDADES** | Presupuestos por unidad de negocio (dashboard de costos). |

## Script Properties (Apps Script)

**Secretos / seguridad:** `ADMIN_PIN_HASH`, `APPROVAL_LINK_SECRET`,
`APPROVAL_LINK_HMAC_CUTOVER_AT`, `ANALYST_EMAILS`, `SUPER_ADMIN_EMAILS`,
`INITIAL_ADMIN_PIN`.

**URLs y Drive:** `WEB_APP_URL`, `PLATFORM_URL`, `ROOT_DRIVE_FOLDER_ID`,
`BACKUP_FOLDER_ID`, `REPORT_TEMPLATE_ID`, `EMAIL_LOGO_URL`.

**Correo:** `ADMIN_EMAIL`, `CEO_EMAIL`, `DIRECTOR_EMAIL`, `MAIL_FROM_ALIAS`,
`MAIL_FROM_NAME`, `MAIL_TECH_SUPPORT_EMAIL`, `CORPORATE_DOMAINS`.

**Otros:** `HR_MAESTRO_ID`, `HR_MAESTRO_SHEET`, `COSTS_DASHBOARD_CONFIG_KEY`.

Todo se lee con `getConfig_(clave, default)`, así que hay defaults en el código.
Con más de 50 propiedades la GUI de Apps Script se bloquea: usar las funciones
helper del propio `Code.gs` (`verPropiedadesDelScript`, etc.).

`GEMINI_API_KEY` puede seguir ahí, huérfana. Se puede borrar.

## Triggers de Apps Script

| Trigger | Qué hace | Instalación |
|---|---|---|
| `backupDiarioAutomatico` | Copia el spreadsheet a una carpeta externa | `setupBackupDiarioTrigger()` |
| `cleanupExpiredPropsWeekly` | Limpia sesiones, lockouts y contadores de rate limit vencidos | `setupWeeklyCleanupTrigger()` |
| `sendPendingApprovalReminders` / `sendPendingSelectionReminders` / `sendPendingConsultReminders` | Recordatorios; escalan a superadmins tras ~30 h laborales (#A16) | Configurados a mano en la UI |
| `warmupPing` | Cada 10 min, mantiene tibio el isolate de GAS | Configurado a mano |

`rastrearPrecios` (#A84, cada 15 min) **no está en este proyecto**: vive en el proyecto aparte
del rastreo de precios, con su propia autorización. Se instala y se quita desde ese proyecto
(`activarRastreo` / `desactivarRastreo`).

**Los triggers corren con la autorización del dueño del script.** Por eso no se
tocan los scopes OAuth a la ligera — ver la sección de IA.

## Estructura de archivos

```
App.tsx                    Componente raíz: routing, sesión, polling (30 s)
types.ts                   Interfaces y enums (fuente de verdad del contrato)
constants.ts               API URL, colores, empresas, APP_VERSION
components/
  AdminDashboard.tsx       Vista analista (tabla + paginación de 50)
  UserDashboard.tsx        Vista solicitante
  RequestForm.tsx          Crear/modificar solicitud (incluye multidestino)
  RequestDetail.tsx        Modal de detalle + acciones
  OptionUploadModal.tsx    Subir imágenes de vuelo/hotel
  CostConfirmationModal.tsx  Confirmar costos finales, con el detalle completo (#A81) y la compra prevista (#A82)
  RequestInfoSections.tsx  Secciones de solo lectura del detalle (las usan el detalle y Confirmar costos, #A81)
  PurchaseInfoFields.tsx   Aerolínea y canal de compra (Confirmar costos y Registrar reserva, #A82)
  InvoiceReviewPanel.tsx   Barra "Listas para cerrar" y "Facturas por revisar" del panel del analista (#A83)
  ReservationModal.tsx     Registrar reserva (+ guardado parcial, #A57)
  SupportUploadModal.tsx   Soportes post-aprobación
  PassportUploadModal.tsx  Pasaportes (viajes internacionales)
  ChangeRequestModal.tsx   Decisión sobre solicitudes de cambio
  MetricsPanel.tsx         Panel de métricas (admin): tiempos del flujo y compras y costos
  PurchaseStatsPanel.tsx   Pestaña «Compras y costos»: tiquetes, noches, costos, CSV (#A80)
  BudgetUsageBar.tsx       Barra de presupuesto en el formulario
  PinEntryModal.tsx        Login por PIN
  CancellationModal.tsx    Anulaciones
  CityCombobox.tsx         Autocompletado de ciudades (custom, reemplazó datalist)
  Layout.tsx, ConfirmationDialog.tsx
services/gasService.ts     Cliente HTTP hacia GAS (timeout 30 s + AbortController)
utils/dateUtils.ts         Parseo/formato de fechas (zona America/Bogota)
utils/EmailGenerator.ts    Generación de correos HTML (carga diferida)
utils/workOrder.ts         Validación de OT (gemelo de Code.gs, #A66)
utils/birthdate.ts         Validación de fecha de nacimiento (gemelo de Code.gs, #A70)
utils/phone.ts             Validación de celular opcional (gemelo de Code.gs, #A75)
utils/money.ts             Costos en pesos: formato y mínimo (gemelo de Code.gs, #A79)
utils/purchase.ts          Aerolínea y canal de compra (gemelo de Code.gs, #A82)
server/
  Code.gs                  Backend completo (~14.400 líneas)
  AdminSidebar.html        Sidebar de administración del Sheets
  AdminMobile.html         Panel móvil (público, protegido por sesión)
  CostsDashboard.html      Dashboard de costos por unidad (incluye el comparador de precios, #A84)
  ReorgSidebar.html        Workflow de reorganización de columnas
tools/check-gas-syntax.cjs Verifica sintaxis de Code.gs y del JS de los HTML
tools/check-workorder-parity.cjs  Frontend y backend validan la OT igual (#A66)
tools/check-birthdate-rules.cjs   Reglas de fecha de nacimiento; frontend y backend coinciden (#A68/#A70)
tools/check-phone-rules.cjs       Reglas de celular; frontend y backend coinciden (#A75)
tools/check-cost-rules.cjs        Reglas de costos en pesos; frontend y backend coinciden (#A79)
tools/check-purchase-stats.cjs    Estadísticas de compra con una hoja sintética, festivos y permiso (#A80)
tools/check-purchase-info-rules.cjs  Aerolínea y canal; frontend y backend coinciden (#A82)
tools/check-invoice-review.cjs       Facturas listas para cerrar y por revisar con una hoja sintética; nada se cierra solo (#A83)
tools/check-price-tracking.cjs       Rastreo de precios: el proyecto aparte y Code.gs juntos sobre una hoja simulada (#A84)
tools/comparador-precios/  Comparador de precios (Google Flights vía SerpApi): prueba local y núcleo (comparador.cjs)
tools/comparador-precios/apps-script/  Proyecto de Apps Script APARTE del rastreo de precios (#A84): Rastreo.gs, manifiesto y guía
scripts/build-guia.cjs     Genera los PDF de docs/ (resuelve Chrome por plataforma)
docs/                      Guías de administrador, hoja de cálculo y planes
```

## Arquitectura y patrones que hay que respetar

- **Sin tests automatizados.** La verificación es `npm run verify` + prueba manual
  contra el deployment de prueba. Por eso los cambios se auditan a conciencia y se
  documentan en `BUG_REPORT.md`.
- **Lectura de columnas por nombre en runtime** (`HEADERS_REQUESTS` es la schema
  canónica). Agregar una columna es seguro; el código tolera cualquier orden.
- **Toda escritura corre bajo `LockService`** (30 s) para evitar carreras.
- **Endpoints "lite"** (`getAllRequestsLite`, `getMyRequestsLite`) omiten
  `analystOptions` para aligerar el dashboard. Ver #A60 antes de usarlos.
- **Caches per-execution** (headers, cédulas, alias de Gmail, fila por requestId)
  se resetean en cada `doGet`/`doPost` — no convertirlos en caches per-isolate.
- **Sanitización:** `escapeHtml_` en correos, `safeSheetValue_` contra formula
  injection en Sheets, y el escape nativo de React en la app.
- **Rate limits:** PIN admin 5 intentos/15 min por correo; regeneración de PIN
  3/hora; creación de solicitudes 10/día.
- **Validadores gemelos.** Las reglas que se aplican en el formulario y en el
  backend (OT, fecha de nacimiento, celular, costos, aerolínea/canal) viven en `utils/*.ts` **y** en `Code.gs`,
  porque no se puede compartir código. `npm run verify` compara ambos lados:
  cambiar uno sin el otro lo hace fallar.
- **Campos nuevos en payloads de creación: la clave presente activa la regla.**
  Así un formulario viejo abierto en otra pestaña sigue funcionando igual que
  antes (patrón de `passengerBirthdates`, #A70).

## Integración de IA — RETIRADA (agosto 2026)

Existió un botón opcional "Mejorar con IA" (Gemini) que reescribía la justificación
de una solicitud de modificación. **Se retiró por completo** (#A62).

**Por qué:** el proyecto de Apps Script no tiene concedido el scope
`script.external_request`, así que `UrlFetchApp` no podía hacer llamadas salientes.
El botón devolvía el texto sin cambios **en silencio** (el `catch` se tragaba la
excepción) y nadie lo reportó nunca. Habilitarlo exigía modificar los scopes OAuth
de un sistema en producción —con riesgo para los triggers de recordatorios y
backup, que corren con la autorización del dueño— para recuperar una función
opcional y sin uso. No compensaba.

**Tras la limpieza no queda ni un solo uso de `UrlFetchApp` en el backend: el
sistema no necesita salida a internet.** El rastreo de precios (#A84) sí la necesita, y por
eso vive en un proyecto aparte con sus propios permisos.

**Si algún día se quiere IA de nuevo** (p. ej. el OCR de facturas del plan de
legalizaciones): habilitar `script.external_request` en `appsscript.json`,
**re-autorizar desde el editor de inmediato** (para no dejar los triggers sin
autorización) y verificar antes de crear una versión nueva del web app.

## Trabajo pendiente conocido

- **Módulo de legalizaciones de gastos** — plan V2 aprobado en reunión del
  2026-06-01, pendiente de desarrollo. Spec completa y autocontenida en
  [docs/plan-legalizaciones-gastos.md](docs/plan-legalizaciones-gastos.md).
- **Optimizaciones** — plan por etapas en [OPTIMIZACIONES.md](OPTIMIZACIONES.md).
  Etapa 1 completada; el resto documentado con riesgo y beneficio.
- **#A50** — limpiar el cableado legacy de `INTEGRANTES`.
- **Plan de la reunión del 2026-09-10** —
  [docs/plan-reunion-2026-09-10.md](docs/plan-reunion-2026-09-10.md). **Desplegado
  en producción** (#A68–#A73): fecha de nacimiento en usuarios, formulario y
  detalle; recordatorio; carga masiva (ejecutada: 636 fechas). Mejoras C1 y C3
  descartadas por David.
- **#A74 y #A75** (detalle sin segunda llamada; celular del pasajero desde la lista
  de RR. HH. y como campo opcional en los formularios): en `main` (`c3c0b8d`) y
  Apps Script desplegado (el menú 8 ya se usó). Pendiente sin código: completar con
  RR. HH. los 7 celulares inválidos o faltantes de la lista (p. ej. uno de 9 dígitos).
- **#A76** (dashboard de costos por unidad) y **#A77** (saltar aprobación solo Yurani y
  David; la API ya no acepta estados arbitrarios): en `main` (`edd641b`; ajuste del menú 9
  en `85ed424`). En Apps Script ya se pegó `Code.gs` y el menú 9 creó los encabezados en
  MISC (H1:I1, con Simón en la fila 2). #A77: Diego ya quedó como analista (script
  temporal ejecutado y verificado con el menú 10 el 2026-09-14: superadmins David y
  Yurani; saltan aprobación solo ellos dos).
- **#A78** (top 10 de viajeros por costo en cada vista del dashboard; variación cotizado
  vs facturado solo Yurani, Diego y David) y **#A79** (costos en pesos reales; el menú 11
  corrige los 11 costos guardados con decimales): en `main` (#A78 en `b52778d`).
  Pendiente en Apps Script, todo junto con #A76/#A77: pegar `Code.gs` y
  `CostsDashboard.html` y guardar → llenar la tabla de MISC con la lista de Yurani
  (revisar con el menú 9) → correr el **menú 11** → **después** crear la versión nueva del
  web app. El export del 29-sep ya muestra el menú 11 aplicado: ningún costo con decimales
  y existe la pestaña «Reporte corrección costos». El 2026-09-29 David publicó una versión
  nueva del web app con el `Code.gs` de `main` (incluye #A76–#A80).
- **#A80** (estadísticas de compra en Métricas → *Compras y costos*; reporte en Excel del
  29-sep entregado aparte): **desplegado** el 2026-09-29. Frontend en `main` (`9adfddf`) y
  versión nueva del web app publicada.
- **Reuniones del 24-sep al 1-oct-2026** — [docs/plan-reuniones-2026-09-24-al-10-01.md](docs/plan-reuniones-2026-09-24-al-10-01.md)
  (borrador). Estado de viajes (2026-10-02):
  - **V1 (#A81), V3 (#A82) y V4 (#A83) implementados**; frontend en `main`. Pendiente en Apps
    Script: pegar `Code.gs`, correr el **menú 12** (crea las columnas; no cierra nada) y crear
    la versión nueva del web app. Con la base del 29-sep: 15 listas para cerrar y 85 por
    revisar. V4 quedó **sin cierre automático** por decisión de David (2-oct).
  - **V2:** comparador de precios. Prueba hecha el 6-oct (documento de demostración para
    Alejandro). **#A84** (rastreo de 2 semanas, oculto para Laura): **desplegado y activo** el
    7-oct (estudio del 7 al 21-oct; el dashboard ya muestra las primeras búsquedas). Plan en
    [docs/plan-comparador-precios.md](docs/plan-comparador-precios.md).
  - **#A85** (regreso con otra aerolínea, pedido de Laura; comparador en lenguaje simple),
    **#A86** (comparador por tramos con detalle por viaje), **#A87** (enlace para comprar y lo
    facturado junto al cotizado) y **#A88** (solo vuelos directos): frontend en `main` (`0cc66b5`, #A85–#A86); pendiente pegar `Code.gs` y
    `CostsDashboard.html` + versión nueva del web app, pegar `Rastreo.gs` en el proyecto aparte
    (`Nucleo` no cambia) y push del frontend.
  - **V5:** lectura de facturas PDF con IA, **solo como plan** (decisión de David del 2-oct):
    [docs/plan-lectura-facturas.md](docs/plan-lectura-facturas.md). Proyecto de Apps Script
    aparte que escribe en la hoja; no toca los permisos del de producción (#A62).
- **Costos para revisar a mano (#A79, el menú 11 no los toca):** SOL-000310 y 378
  (apartamento corporativo, $1 que debería ser 0), SOL-000379 (tiquetes en $1 con
  facturas), SOL-000035 ($1 en tiquetes de solo hospedaje); SOL-000002 y 109 están
  anuladas. Hoy no afectan el dashboard.
- **Seguimiento sin código de la carga de fechas (#A72):** corregir con RR. HH. las
  4 fechas inválidas; revisar los 115 usuarios que no aparecen en la lista de
  integrantes (¿siguen en la empresa?); borrar los usuarios de prueba `PRUEBA1` y
  `PRUEBA2` y el valor suelto `ADMIN` en `USUARIOS!N233`.
