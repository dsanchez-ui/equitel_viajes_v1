# Equitel Viajes — Guía de Proyecto para Claude

> Este archivo viaja con el repo y Claude Code lo lee automáticamente en cualquier
> máquina. Es la memoria portable del proyecto. Para el detalle histórico de cada
> bug y decisión, ver [BUG_REPORT.md](BUG_REPORT.md) (#A1–#A100) — es el diario real
> del proyecto y la fuente de verdad sobre por qué las cosas son como son.
>
> Para instalar el proyecto en una máquina nueva, ver [MIGRACION.md](MIGRACION.md).
>
> **Si esta sesión corre en macOS:** antes de cualquier tarea, haz lo que diga [MIGRACION.md §0](MIGRACION.md) mientras no
> diga «Hecho» (Node 24 y el recordatorio de seguridad para todos los proyectos del Mac, pendiente desde el 22-oct-2026).

## Qué es

Plataforma web de gestión de viajes corporativos de la Organización Equitel
(Colombia). Los empleados solicitan viajes, sus jefes aprueban por correo, y el
equipo de compras (analista) gestiona opciones de vuelo/hotel, costos y reservas.
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
   nacimiento, de celular, de costos, de aerolínea/canal y de tarifa + estadísticas de compra +
   facturas por cerrar y por revisar + aprobación del CFO por la política + informe mensual +
   rastreo de precios + velocidad y análisis de ahorro + cambios de viaje + enlaces con dominio + build + un solo archivo JavaScript). Debe salir en verde.
   Para probar la app tal cual quedará, antes del push: `npm run prueba:local -- --base "<exportación .xlsx>"`
   (entorno local con el `Code.gs` real y una copia en memoria; ningún correo sale; ver `tools/entorno-prueba/README.md`).
3. **Revisión de bugs y seguridad al final** de cada cambio, no al principio.
4. Al cerrar un cambio relevante, **agregar su entrada `#Axx` a `BUG_REPORT.md`**
   siguiendo el formato existente (síntoma, causa raíz, fix, verificado, despliegue).
5. Los commits van **en inglés** con prefijo conventional (`fix:`, `feat:`, `chore:`).
   Todo el UI y la documentación van **en español**. **Las respuestas a David, también en
   español.** Los commits van a nombre de David (el `git config` del repo es el correcto).
6. **Sugerir y que una persona confirme.** Cuando algo cambiaría estados en producción
   (cerrar, aprobar, anular), David prefiere que el sistema lo muestre en una bandeja o aviso y
   que el área de compras lo confirme con el flujo de siempre (#A83: *"es más seguro"*). Si de
   verdad conviene automatizar, preguntar antes de construirlo.

## Cómo se corre en local

```bash
npm install          # regenerar SIEMPRE por máquina — ver MIGRACION.md
npm run dev          # servidor de desarrollo, puerto 3000
npm run verify       # typecheck + sintaxis backend + OT + fecha nac. + celular + costos + compras + aerolínea/canal + tarifa + facturas por cerrar + aprobación del CFO + informe mensual + rastreo de precios + caché y análisis de ahorro + cambios de viaje + build + un solo .js  ← antes de cualquier push
npm run prueba:local -- --base "/ruta/exportación.xlsx"   # entorno de prueba local: app de producción + Code.gs real sobre una copia; correos a una bandeja local
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

El activador de Cloud Build (`rmgpgab-sistematiquetesequitel-us-west1-dsanchez-ui-equitel-rxk`, proyecto `gen-lang-client-0192295875`)
construye con el **`Dockerfile`** (`docker build .` → push → `gcloud run services update sistematiquetesequitel`, us-west1); verificado
con `gcloud` el 22-oct (solo lectura, pasar `--project`: no hay proyecto por defecto). El trigger de Cloud Build está configurado del lado de GCP (no hay GitHub Actions
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

`REQUESTER` · `ANALYST` (equipo de compras / admin) · `APPROVER` · `SUPERADMIN`
(puede saltar etapas y revertir a selección).

## Decisiones de negocio vigentes (no se deducen del código)

- **No existe un «área de viajes»** (#A107, David, 22-oct): Laura es del **área de compras**. En pantallas, correos, dashboard,
  sidebar, panel móvil y guías se dice «área de compras» (o el nombre de la persona), nunca «área de viajes» ni «equipo de viajes».
  «Gestión de Viajes» / «Sistema Viajes Equitel» es el nombre de la plataforma y se queda. Las entradas viejas de BUG_REPORT
  conservan el nombre de su momento.

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
- **Dashboard de costos completo, solo para ver** (#A113, David, 28-oct): quien no es administrador y David decide
  (hoy solo Juan Camilo Pineda, `jcpineda@`; Alejandro Gómez, `agdg@`, quizá después) ve el dashboard igual que un
  administrador: todas las unidades, variación, cambios, comparador y proyección. **Solo mira**: no excluye viajes del
  ahorro ni ve ni cambia la configuración, y en la plataforma sigue siendo solicitante. **Se da en la tabla de accesos de MISC
  con `COMPLETO`** en vez de la unidad (`COSTS_ACCESS_FULL`; David no quiere una lista fija en el código); `TODAS` sigue dando solo
  las unidades. Las lecturas usan `_canReadCostsVariance_` y excluir sigue con `_canViewCostsVariance_` (lista fija). Entra con su
  correo y su PIN del portal, por el enlace del dashboard.
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
- **Fechas siempre día/mes/año** (#A105, David, 21-oct): nadie ve ni escribe una fecha en otro orden. En la app,
  todo campo de fecha es `DateInput` (`DD/MM/AAAA` con barras automáticas y el calendario del navegador detrás de
  un botón; entra y sale `AAAA-MM-DD`). **Nunca un `<input type="date">` a la vista**: con Chrome en inglés sale
  mes/día/año. En el panel móvil y el sidebar, `attachDmyDateField`. `toLocaleString` / `toLocaleDateString` siempre con
  `'es-CO'`. En la hoja las fechas ya son fechas de verdad: no se cambia cómo se guardan. **El calendario se abre con el
  clic de la persona sobre el campo nativo invisible que va encima del botón** (#A114): en el sidebar de Sheets y en el web
  app la página corre en un iframe de otro dominio y ahí `showPicker()` falla (`SecurityError`); nunca volver a un campo
  nativo con `pointer-events: none` que dependa de él (`npm run verify` lo revisa).
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
  - **Hotel reservado y su canal** (#A94, pedido de Laura, 2026-10-08): bloque *Hotel* en *Registrar reserva*,
    solo con hospedaje. Columnas `HOTEL RESERVADO` (mayúsculas sin tildes; `NOMBRE HOTEL` sigue siendo el que pidió
    el viajero) y `CANAL DE COMPRA HOTEL` (*Aviatur*, *Directo*, *Otra agencia* o *No se reservó*). Obligatorio al
    confirmar la reserva, con la casilla *No se reservó hotel* (no en solo hospedaje, donde el bloque reemplaza al de
    compra y su canal es también `CANAL DE COMPRA`). Gemelo `normalizeHotelPurchase` ↔ `_normalizeHotelPurchase_`.
    Solo se toca si viene `hotelChannel`; la app solo muestra el bloque si el servidor manda `purchaseHotelChannel`.
  - **Valor pagado** (#A102, David, 14-oct: **opcional**): bloque *Valor pagado* en *Registrar reserva* (tiquetes; hotel si
    hubo), columnas `VALOR COMPRA TIQUETES` y `VALOR COMPRA HOTEL` (pesos, reglas de #A79; vacío = no se registró). **No es**
    `VALOR PAGADO A AEROLINEA Y/O HOTEL`, que es la factura 1. Mientras llega la factura, el dashboard lo usa en vez de lo
    cotizado. Solo administradores. Gemelo `normalizePaidValue` ↔ `_normalizePaidValue_`; la clave presente activa la regla.
  - **Corregir una reserva no cambia la fecha de compra** (#A102): el modal arranca con la guardada (`purchaseDate`). Si solo
    cambió la compra (aerolínea, canal, tarifa, hotel o valor pagado), se guarda sin `amendReservation` y sin correo al
    viajero. Antes la corrección escribía el día de hoy: 16 reservas cambiaron de fecha (4 de mes), sin corregir en la hoja.
- **Tarifa del tiquete según el manual COM-P-02** (#A95, reunión del 8-oct, aprobado por David): la
  tarifa sale de las noches del viaje: **TIPO 1** de 0 a 1 noche, **TIPO 2** de 2 a 5, **TIPO 3** de 6 o más
  (el manual dice «más de 6»; los 6 son TIPO 3). Cada aerolínea le da su nombre (Avianca: Basic, Classic,
  Classic; LATAM: Basic, Light, Full). La plataforma **recomienda y Laura decide**: se avisa al cargar
  opciones, y en *Confirmar costos* y *Registrar reserva* viene preseleccionada; otra tarifa exige una
  justificación (10 a 500 caracteres). Es excepción si cambia el nombre (Avianca 2 = 3 no lo es). Se guarda
  en `TIPO DE COMPRA DE TKT` (la columna de siempre) más `TARIFA RECOMENDADA` (la calcula el servidor),
  `TARIFA NOMBRE` y `TARIFA JUSTIFICACION`. Gemelo `utils/fare.ts` ↔ `_normalizeFare_`; la app solo muestra
  el bloque si el servidor manda `fareRecommended`, y el servidor descarta cualquier `fare` que mande un
  cliente. El detalle muestra la tarifa y su equipaje **también al viajero** (le dice qué equipaje lleva); la
  recomendada y el motivo, solo a los administradores, y el servidor no se los envía al solicitante
  (`_hideFareInternals_`). **Maleta de bodega** (David, 8-oct): casilla en el formulario,
  solo vuelos, columna `MALETA DE BODEGA` (`SI`/`NO`, vacía = no se preguntó; la clave `checkedBaggage` presente
  activa la regla). No cambia la recomendación: si Laura elige una tarifa con bodega por eso, el motivo se propone
  solo; si elige una sin bodega, se le avisa. Las reglas del manual y lo que la plataforma no cubre: [docs/manual-com-p-02.md](docs/manual-com-p-02.md).
- **Facturas listas para cerrar y por revisar** (#A83, acordado con Laura el 2026-10-01, reglas
  de David del 2026-10-02). **Ninguna solicitud se cierra sola** (David: *"es más seguro"*): el
  panel del analista las muestra y el área de compras las cierra con el cierre manual de siempre.
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
    personas): lo que registró el área de compras y quién (`costConfirmedBy` en `EVENTOS_JSON`,
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
  - **Misma tarifa, «peras con peras»** (#A95, reunión del 8-oct, Yurani): el rastreo busca con el
    equipaje de la tarifa registrada (TIPO 1 sin maleta; TIPO 2 y 3 con una maleta de mano por pasajero,
    `bags`) y repite una vez si la tarifa cambia. El dashboard compara por defecto **solo** los viajes
    buscados con el equipaje de su tarifa (`summary.sameFare`); *Todas las búsquedas* queda como
    referencia. Google no trae las tres tarifas por separado ni deja pedir bodega: en LATAM TIPO 2 y en
    TIPO 3 su precio queda por debajo. Nunca volver a comparar contra la más barata sin decirlo.
  - **Tarifa por noches, qué tan comparable y dos precios por vuelo** (#A97, idea de David, 9-oct; **solo el
    dashboard y el rastreo**, la app de Laura no cambia sin autorización de Yurani). Sin tarifa registrada se usa la
    que corresponde por noches (`fare.basis` = `recomendada`). Cada viaje dice si la comparación es **exacta** (TIPO 1;
    TIPO 2 con maleta en Avianca, JetSMART o Wingo; TIPO 3 solo Avianca), **aproximada** (LATAM; Clic, porque Google trae
    VeLigera; TIPO 3 fuera de Avianca; bodega pedida fuera de Avianca, #A98) o **no comparable** (otro equipaje):
    `_ptQuality_`, probada el 9-oct con dos búsquedas reales. El selector
    *Comparar* y la proyección tienen «solo comparaciones exactas»; la proyección, «solo TIPO 1». Google da **un solo
    precio por vuelo** (comprobado: ningún vuelo repetido en 59 + 63 + 161 resultados); por eso el rastreo busca también
    el otro equipaje al comprar (`DOS_NIVELES`, por defecto `compra`) y el detalle muestra los dos precios (Avianca: Basic
    → Classic; LATAM: Google no la distingue).
  - **Los dos precios, solo del mismo momento; cada viaje, en palabras** (#A98, David, 9-oct). Los dos precios de un vuelo
    se comparan solo si las búsquedas tienen **3 horas o menos** de diferencia (el rastreo repite la del otro equipaje si es
    más vieja, `RP_PAR_MS`; el detalle empareja la más cercana en el tiempo). Nunca sacar conclusiones de la maleta con
    búsquedas de momentos distintos: el precio cambia entre una y otra. El detalle de cada viaje abre con
    **«Qué dice esta comparación»**: misma aerolínea, de dónde sale la diferencia, aeropuerto (Olaya Herrera), bodega,
    anticipación y qué tan comparable es.
  - **Seguimiento continuo y con el historial de Google** (#A115; Juan Camilo y David, 28-oct: se sigue pagando SerpApi, plan de
    1.000 búsquedas al mes, para comparar mes a mes). Ya no hay fecha de fin: `activarRastreo` quita una que ya pasó y no pone otra
    (`FIN_ESTUDIO` opcional). Cada tramo guarda `hist` (el precio más barato de esa búsqueda, día por día, ~60 días; `price_history`)
    y el dashboard calcula `priceRise` (lo más barato el día de la solicitud frente al de la compra). Es lo más barato de Google, no el
    vuelo comprado: se presenta como «cuánto se movió el mercado mientras se gestionaba». El rastreo lee solo las columnas que necesita
    y el dashboard solo los tramos de las búsquedas que usa (`_ptHydrate_`): la pestaña crece unas 300 búsquedas al mes.
- **Dashboard de costos: la velocidad es el pilar** (#A89, David, 2026-10-08: *"si no es rápido,
  nadie lo va a utilizar"*). Todas las secciones se piden **en paralelo** y sus respuestas se guardan
  en **`CacheService`** (`_dashCached_`), con una llave que lleva el alcance del usuario y una versión
  de datos. `dispatch` la cambia en cada escritura, y la entrada vence a los 10 min; *⟳ Actualizar
  datos* recalcula. **Nunca guardar nada en Script Properties** (decisión de David). Toda visual
  nueva sale de un payload en caché, lee la hoja una sola vez y no encadena llamadas; los controles
  interactivos calculan en el navegador. Ver [docs/plan-analitica-ahorro.md](docs/plan-analitica-ahorro.md) §3.
- **Dashboard de costos por pestañas** (#A117, David, 28-oct: *«está demasiado largo»*): Año · Periodo · Mes · Mes a mes · Cotizado vs
  facturado · Cambios de viaje · Comparador de precios · Proyección de ahorro, al final de la tarjeta de filtros. Se ve una sección a la
  vez. **Los datos se siguen pidiendo todos en paralelo** (#A89): lo que ahorra es el dibujo, porque solo se dibuja la pestaña que se ve
  (`tabsRefresh` marca las demás y se dibujan al abrirlas). Las restringidas aparecen solo cuando el servidor entrega su dato
  (`setTabAvailable`), y nunca a quien no las ve. Una sección nueva = una entrada en `TABS` y `TAB_RENDER`: no dibujar directamente al
  llegar los datos. En celular, la tarjeta de filtros no queda pegada arriba.
- **«Mes a mes»** (#A116, pedido de Juan Camilo, 28-oct: *«este mes con el mes pasado, con el mes antepasado y cuánto fue el promedio»*):
  pestaña con lo comprado, el costo por tiquete (también en TIPO 1), la tarifa del manual, la anticipación, la comparación con Google y el
  movimiento del precio en Google, por mes de compra y con el promedio. Mismo permiso que el comparador. Sale de los payloads que ya
  llegan (sin llamadas nuevas) y respeta empresa y unidad. **Mismas reglas que el informe mensual (#A101)**: «superior» = tarifa comprada
  mayor que la del manual por noches; «a tiempo» = 8 días (30 internacional) entre la compra y el vuelo, sin modificaciones ni
  trazabilidad (columnas `tarifaComprada`, `pagadoTiquetes` y `aTiempo` del análisis). Frente a Google = la cifra por defecto del
  comparador (#A104: ya comprados, exactas, sin excluidos). Promedio: conteos y pesos ÷ meses; % y por tiquete sobre el total de su base.
- **Proyección de ahorro** (#A90, pedido de Juan Camilo, 2026-10-08): sección del dashboard de costos
  con volumen de viajes, ahorro observado del comparador (partido en *comprando la misma aerolínea*
  y *cambiando de vuelo o aerolínea*) y proyección por mes con método elegible y un rango (de solo
  la misma aerolínea a todo el ahorro). Mismo permiso que el comparador. Es un
  **plan vivo**: [docs/plan-analitica-ahorro.md](docs/plan-analitica-ahorro.md), donde se anotan los
  pedidos e ideas nuevas (§9) y la bitácora (§11).
- **Todo el dashboard de costos en lenguaje simple** (#A92, David, 2026-10-08): cada cifra se nombra
  con la pregunta que responde (*Precio más barato en Google*, *Diferencia por tiquete*, *% de ahorro
  sobre lo cotizado*, *¿De dónde sale la diferencia?*, *Disponible*). En pantalla nunca nombres
  internos (*canal*, *vuelo*, *prudente*, *probable*, *embudo*) ni de columnas de la hoja
  (`TOTAL FACTURA 2`, `RESERVADO`). **No llenarlo de recuadros de texto:** una línea bajo el título
  y un *¿Cómo se calcula?* cerrado y corto.
- **Toda estimación del dashboard se puede sustentar y repetir a mano** (#A93, David, 2026-10-08: *"una cifra
  que no es verificable"* no sirve). Cada sección con cifras derivadas tiene arriba un *¿Cómo se calcula?*
  de una o dos frases por concepto: cómo se hizo y por qué ese método. Si se agrega una estimación nueva,
  va con su explicación. La proyección muestra la cuenta de cada mes en pesos (cursor y CSV, columna *Cuenta*),
  y su tabla solo cuenta lo que se proyecta.
- **Cifras que se pueden presentar** (#A99, revisión de David del 13-oct: la proyección de $187,9 M al año salía de
  6 comparaciones aproximadas):
  - **Proyección:** sin **15 comparaciones exactas** (`SA_MIN_EXACT`) no se muestra cifra al año, solo el ejercicio
    por mes con un aviso. Arranca en lo más prudente (% típico sobre lo cotizado, solo exactas, solo TIPO 1, 50 %) y
    el tope por viaje es la **mediana** del % observado, nunca el máximo.
  - **La vista anual de 2026 cuenta desde abril** (`DASH_FIRST_MONTH`): antes no existía la plataforma y su
    presupuesto bajaba el % usado. La tarjeta *Usado a la fecha* compara con el presupuesto hasta el mes en curso.
  - **«Revisar la carga»:** una factura de más del doble o de menos de la mitad de lo cotizado (`varNeedsReview`)
    se lista aparte y no entra en totales, promedios ni gráficas. La cifra principal de la variación es la
    **diferencia típica** (mediana).
  - **Todo % va sobre lo cotizado** (o lo facturado si ya se compró): *«en Google, 27 % menos que lo cotizado»*.
  - Nombres en pantalla: *Facturado*, *Comprado sin factura*, *Por encima del presupuesto*, *Valor cotizado*,
    *% sobre lo cotizado*. Nunca *ejecutado* ni *sobre-ejecutado*.
- **Toda desviación de la política la aprueba el CFO antes de la compra** (#A100, Yurani y Alejandro Gómez, 13-oct; diseño de
  David, 14-oct). Quién aprueba = el responsable del presupuesto excedido (`budgetApproverEmail` / `budgetApproverName` del
  dashboard de costos; cambiarlo allí lo cambia para todo). Interruptor: `policyApprovalEnabled: false` en esa configuración.
  - **Anticipación** (8 días nacional, 30 internacional; vuelos **y** solo hospedaje): la solicitud nueva de un solicitante
    queda en `PENDIENTE_APROBACION_POLITICA` con su justificación (obligatoria en el formulario). **El área de compras no la ve**
    (filtro en el servidor), no hay métricas, recordatorios ni dashboard hasta que se apruebe. El servidor recalcula la
    anticipación: nunca confiar en el `policyViolation` del navegador. Lo que crea un **administrador** (trazabilidad de un viaje
    ya comprado) no queda en espera, solo se marca. No aplica a solicitudes de cambio.
  - El área de compras las ve **solo** en el botón «En espera de preaprobación» de su panel (solo lectura, `getPolicyHeldRequests`),
    nunca en la lista principal. **Multidestino:** si cualquier tramo no cumple, espera todo el viaje (`GRUPO MULTIDESTINO`) y una
    decisión cubre todos los tramos.
  - El CFO recibe **un resumen cada 2 h solo en horario laboral** (`isWorkingHour`, como los demás resúmenes: nada los fines de
    semana por la tarde ni los domingos; disparador `procesarAprobacionesPolitica`, creado a mano) con una
    fila por solicitud y Aprobar / Rechazar firmados (`policy_decision`). Aprobada → `PENDIENTE_OPCIONES` (los tiempos cuentan desde
    `policyApproved`); rechazada o **vencida a los 7 días o al pasar la fecha del viaje** → `DENEGADO` con «No se aprobó la excepción
    por incumplimiento de la política de anticipación». Nunca se borra. Decisión en `APROBACION CFO ANTICIPACION`.
  - **Tarifa superior a la del manual**: `REQUIERE APROB TARIFA` al confirmar costos y el voto del CFO en la aprobación (mismo rol
    `BUDGET_OVERRUN` y columna `APROBADO PRESUPUESTO` que el presupuesto: un voto cubre los dos; `_requiresCfoVote_`). Antes de comprar
    no se sube la tarifa por encima de la aprobada (solo Yurani y David).
  - **Aviso a los solicitantes, sin fecha de fin** (David, 15-oct): la ventana sale al entrar hasta que cada persona toca «Entendido»;
    constancia en la hoja `CONSTANCIA AVISOS`. Si la constancia no se guarda, la ventana lo dice y deja reintentar (o seguir, y vuelve
    a salir en el próximo ingreso). Nunca volver a ponerle fecha de fin: nadie debe poder decir que no fue informado.
- **Informe mensual de cumplimiento de la política** (#A101; Alejandro, 13-oct: *«se publicará cada mes»*; decisiones de David
  del 14-oct). Sale solo el **primer día hábil del mes** (festivos de Colombia; el de octubre, el martes 3-nov), en horario laboral,
  con la pasada de `procesarAprobacionesPolitica` (sin activador aparte), para quien aprueba (`budgetApproverEmail`) con copia a
  Yurani y David (`MR_CC`). Una sola vez por mes: constancia en la hoja oculta `INFORMES ENVIADOS`.
  - Mismas reglas del informe del 13-oct (verificado con la base: 375 viajes, 54 % fuera, 33 % comprado a tiempo, misma tendencia).
    Cada viaje cuenta en el **mes de la solicitud**; la tendencia se recalcula cada mes. **La tarifa cuenta en el mes de la compra**
    (David, 14-oct: cada compra sale una vez, también la registrada después de comprar). Sale solo de lo registrado, nunca del texto
    del viajero.
  - Cuadros de honor y de deshonor y «quién pide»: **últimos 3 meses**, 4 viajes o más (honor ≤ 20 % fuera; deshonor ≥ 60 %).
  - Correo + PDF + CSV del mes, sin cédulas. **Menú 15:** prueba que solo le llega a quien la corre (sin copia ni constancia).
- **«Cambiar mi viaje»: cambios de viaje simplificados** (#A103; pedido de Yurani, reglas de David del 15-oct, prototipo aprobado
  por Yurani el 19-oct). Botón grande 😕 en el panel del viajero; formulario corto (fechas, horas, destino, equipaje) y motivo.
  - **Plazo:** hasta las **5:00 p. m. del día hábil anterior al vuelo** (sábado 12:00 m.; domingos y festivos no cuentan); la fecha
    nueva también debe dar tiempo; con el viaje en curso, **solo el regreso**. El área de compras registra a nombre del viajero **sin
    plazo**. Gemelo `utils/changeWindow.ts` ↔ `_changeDeadline_` / `_tripChangeWindow_`.
  - El navegador manda solo lo que cambia (`requestTripChange`); el servidor arma la hija con `requestModification`. La hija lleva
    `CAMBIO PEDIDO (JSON)`, que **solo escribe el servidor** (nunca confiar en un `tripChange` del cliente).
  - **Tiquete comprado:** la hija lleva **solo el costo del cambio** (penalidad en `PENALIDAD CAMBIO` + diferencia de tarifa + hotel); la
    original **no se anula**: queda «Cambiada» (`REEMPLAZADA POR`) y su costo sigue contando. Cadena de Suministro se mide con el viaje
    con el cambio. **Sin comprar:** se cotiza de nuevo y la original se anula al aprobar, como antes. Hijas sin JSON: reglas de antes.
  - **Todo cambio pasa por el aprobador**, aunque cueste $0. Control en *Métricas → Cambios*, en la sección *Cambios de viaje* del
    dashboard de costos (líder = sus unidades) y en el informe mensual.
  - **La primera vez que el viajero toca el botón**, una explicación corta; «Entendido» deja constancia en `CONSTANCIA AVISOS`
    (aviso `cambios-de-viaje-2026-10`, mismo `ackPolicyNotice` de #A100) y no vuelve a salir en ningún equipo (David, 20-oct).
  - **Primero la plataforma** (#A106; Yurani y David, 22-oct): cada viajero pide su cambio en la app, «ya no por correo, teléfono ni
    WhatsApp». Si le escriben o llaman a Laura dentro del plazo, ella le pide que lo haga por la plataforma (la ventana se lo recuerda);
    lo registra a su nombre solo si ya pasó el plazo y es urgente. **Los teléfonos salen solo cuando ya no se puede pedir el cambio**, en
    orden: la tabla `CONTACTO CAMBIOS` de MISC (correo, nombre y cargo; **menú 16**) y el celular de la columna `Celular` de USUARIOS.
    Hoy: Laura Molina (área de compras) y, si no responde, Diego Caballero (director de compras). Si alguien cambia de rol, se cambia la
    fila; sin tabla, el correo del área de compras.
  - **Reserva por partes = tiquete comprado** (#A109, David, 22-oct, caso SOL-000659): una solicitud en APROBADO con un archivo de
    reserva guardado («Guardar sin enviar») ya tiene el tiquete comprado (gemelo `isTripBought` ↔ `_tripChangeIsBought_`). Su cambio se
    pide como de tiquete comprado y **no se puede aceptar hasta que el área de compras confirme lo que se compró** (botón en «Revisar
    Cambio», sin correo al viajero; «No se reservó hotel» si el hotel no se alcanzó a reservar). Al aceptarlo, el JSON del cambio se pone
    al día. **Nunca se anula una original con lo comprado** (cambios de «Cambiar mi viaje»; los del formulario completo siguen las reglas de
    antes). En el dashboard, «No se reservó hotel» = $0 de hotel mientras llega la factura.
  - **Cambiar dónde se hospeda** (#A111, Laura, 27-oct, caso SOL-000668): `hotelName` es un campo cambiable más, en **solo hospedaje y
    en vuelo + hotel** (también con el viaje en curso: es cuando más se necesita). Agregar hospedaje donde no lo había sigue siendo una
    solicitud nueva. En solo hospedaje, **nada habla de vuelos**: ni los botones, ni los avisos, ni el correo al aprobador («El hospedaje
    ya está reservado… penalidad del hotel», con el hotel y su canal, nunca el PNR ni «diferencia de tarifa»).
- **Las horas, siempre en 24 h** (#A112, Yurani, 27-oct: «hora militar y ya»): un viajero escribió «6.22» por las 18:22, sin «pm», y se
  cotizó un vuelo a las 6 a. m. Todo campo de hora es `TimeInput` (`HH:MM` de 24 h, con la hora **en palabras** debajo y un botón que abre
  una **lista propia de horas**, cada 15 minutos, también en 24 h; entra y sale `HH:MM`). **Nunca un `<input type="time">`**, ni siquiera
  escondido detrás del botón como el calendario de `DateInput`: el selector nativo de hora solo lo abren las versiones recientes de Chrome
  y, cuando abre, con el navegador en inglés muestra las 12 horas con a. m./p. m. que este campo viene a evitar. Es la regla gemela de
  #A105 para las fechas. Los plazos en prosa («hasta las 5:00 p. m.») se quedan como están.
- **Comparador de precios: la cifra que se presenta** (#A104, auditoría del 19-oct). Por defecto el dashboard compara **solo viajes ya
  comprados** (RESERVADO o PROCESADO, con la búsqueda al comprar) y **solo comparaciones exactas**, contra **lo pagado** (#A102) o, si
  no se registró, lo cotizado; al lado, lo mismo **con la misma aerolínea**. Lo no comprado va aparte, nunca en el total; lo denegado o
  anulado no se compara; lo no comprado se compara con los costos **vigentes** del área de compras. «Exacta» exige además vuelo a
  ±2 h de la hora pedida y directo; **Rionegro y Olaya Herrera son el mismo destino** (David, 20-oct). La diferencia siempre es neta
  (nunca sumar solo los viajes a favor). Con la base del 19-oct: 5 viajes comprados, $1.009.757 (28,7 %); con la misma aerolínea,
  $89.384 (3,2 %). Todos los rastreados contra lo cotizado, tarifa con tarifa: TIPO 1 $1,35 M (30,5 %); TIPO 2 con maleta frente a
  Avianca/JetSMART/Wingo, Google $358 mil más caro; nacionales en total $275 mil (2 %). Google se busca con el mismo número de
  pasajeros y su precio es el total del grupo, como lo cotizado.
- **Excluir a mano un viaje del ahorro** (#A110, David, 22-oct: el viaje a Miami de Francisco Amézquita, SOL-000658, es atípico). En el
  detalle de cada viaje del comparador, «Excluir del ahorro» con motivo obligatorio; solo `COSTS_VARIANCE_ALLOWED`. Columna
  `EXCLUIDA DEL AHORRO` (motivo · quién · fecha) + nota en OBSERVACIONES. El viaje sigue en la lista, marcado, pero no suma en ningún
  total del comparador ni en la proyección; el titular dice cuál es y cuánto daría con él. **Nunca esconder un viaje sin decirlo.**
  Cifras del cierre del estudio (base del 22-oct): 8 viajes comprados exactos $2.792.291; sin Miami 7 y $1.215.647; con la misma
  aerolínea, a la par (Google $34.501 más caro en 5). Con la tarifa del manual, 20 viajes $5.485.521: Miami $1,58 M, volar otra
  aerolínea $1,94 M, misma aerolínea $0,82 M (casi todo aproximado, LATAM) y sin dato $1,16 M. Lo cotizado por Aviatur ya trae sus
  cargos (208 vuelos sin hotel: facturado = cotizado en la mediana).
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

- **#A96 — Nada de cargas bajo demanda en la app (`import()`, `React.lazy`).** Cada push a `main`
  reemplaza todos los archivos del servidor, y los archivos aparte cambian de nombre. Quien tenía la app
  abierta desde antes pedía el archivo viejo y no podía crear solicitudes («Failed to fetch dynamically
  imported module», 8-oct-2026). La app es **un solo archivo JavaScript**: `tools/check-single-bundle.cjs`
  lo verifica en `npm run verify`. `public/assets/` guarda copias de archivos de versiones anteriores para
  las pestañas abiertas; se pueden borrar unos días después.
- **#A108 — Dependencias y Node (revisión de seguridad del 22-oct, [docs/SEGURIDAD_22OCT.md](docs/SEGURIDAD_22OCT.md)).**
  - La imagen usa **`node:24.22.1-alpine` fija en las dos etapas**; al subirla, cambiar las dos.
  - En la imagen final **`serve` se instala desde el lockfile** (`npm ci --omit=dev`), nunca con `npm install -g`: la instalación global
    no usa los `overrides` de package.json, que corrigen lo que `serve` 14.2.6 trae fijo (compression 1.8.1).
  - No quitar los `overrides` sin correr `npm audit --omit=dev`.
  - `allowScripts` (npm 11) aprueba **solo esbuild**.
  - El dashboard carga Chart.js con **SRI** desde `dist/chart.umd.js`, nunca `.min.js`, que lo genera jsDelivr y su hash cambia.
  - No instalar versiones publicadas hace menos de dos semanas sin necesidad.
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
  de Google. Cuidado al tocar los links de aprobación. **Todo enlace a una página del web
  app que abre una persona va con el dominio** (`script.google.com/a/macros/equitel.com.co/…`):
  en el servidor, `WEB_APP_URL`; en la app, `webAppPageUrl()` (#A91, botón *Costos por
  Unidad*). `API_BASE_URL` queda corto solo para las llamadas del API.
- **#A5 — Links de aprobación firmados con HMAC**, con cutover per-request para no
  invalidar correos en vuelo. No romper esa compatibilidad.
- **#A62 — La integración con IA (Gemini) fue retirada.** Ver abajo.
- **`setupDatabase()` NO se debe ejecutar**: recrearía la hoja `INTEGRANTES`, que
  fue eliminada en producción. Usar las funciones de migración específicas.

## Base de datos (Google Sheets)

| Hoja | Contenido |
|---|---|
| **Nueva Base Solicitudes** | Tabla principal de solicitudes. Columnas leídas por nombre en runtime, así que el orden puede cambiar. `FECHAS NACIMIENTO PASAJEROS (JSON)` guarda `{cédula: AAAA-MM-DD}` de los pasajeros externos (#A70). `CELULARES PASAJEROS (JSON)` guarda `{cédula: celular}` de externos (#A75); la crea el menú 8 (o el sistema, la primera vez que la necesita). `AEROLINEA`, `CANAL DE COMPRA` (#A82), `AVISO FACTURAS OMITIDO` (#A83), `AEROLINEA REGRESO` (#A85, solo si el regreso es con otra aerolínea), `HOTEL RESERVADO` y `CANAL DE COMPRA HOTEL` (#A94), y `TARIFA RECOMENDADA`, `TARIFA NOMBRE`, `TARIFA JUSTIFICACION` y `MALETA DE BODEGA` (#A95; la tarifa comprada sigue en `TIPO DE COMPRA DE TKT`), `VALOR COMPRA TIQUETES` y `VALOR COMPRA HOTEL` (#A102, lo pagado al comprar; no son la factura 1), `JUSTIFICACION ANTICIPACION`, `APROBACION CFO ANTICIPACION`, `REQUIERE APROB TARIFA` y `GRUPO MULTIDESTINO` (#A100), y `CAMBIO PEDIDO (JSON)`, `PENALIDAD CAMBIO` y `REEMPLAZADA POR` (#A103) van al final; las crea el menú *12. Columnas de compra y resumen de facturas* (o el sistema, la primera vez que las necesita). |
| **USUARIOS** | Directorio de empleados y su aprobador. **Única fuente de verdad** desde 2026-04-24. ⚠️ A diferencia de la hoja principal, se lee y escribe **por posición** (PIN en la col 10, aprobadores 7–9): columnas nuevas **solo al final**. La columna `Fecha Nacimiento` (#A68) va después de las existentes y se accede **por nombre**: en producción quedó en la O (un valor suelto en N233 corrió la migración) y puede moverse a cualquier posición desde la M sin tocar código. La columna `Celular` (#A74, texto de 10 dígitos) sigue la misma regla: al final y por nombre. Ninguna de las dos viaja al directorio que recibe cada usuario. |
| ~~INTEGRANTES~~ | **Eliminada en producción (2026-04-24).** El cableado legacy sigue en el código (#A50, limpieza pendiente). |
| **MAESTROS** | Centros de costo. |
| **CDS vs UDEN** | Relación centro de costo ↔ unidad de negocio. |
| **CIUDADES DEL MUNDO** | Ciudad/país para el autocompletado. |
| **MISC** | Tarjetas de crédito (A:B), sedes (D), la tabla de accesos al dashboard de costos (#A76) y la de a quién llamar después del plazo de un cambio (`CONTACTO CAMBIOS · CORREO / NOMBRE / CARGO`, #A106; la crea el menú 16, encabezados buscados por nombre en las filas 1 a 3). Los encabezados están en la fila 2 y los datos empiezan en la fila 3. Los encabezados de la tabla de accesos (`DASHBOARD COSTOS · CORREO` / `· UNIDAD DE NEGOCIO`) los crea el menú 9 en la **fila 1** (celdas normales, sin tablas de Google ni listas desplegables) y se buscan por nombre en las filas 1 a 3, así que pueden moverse de columna. |
| **REGLAS_COAPROBADOR** | Reglas de co-aprobación. |
| **COMPARATIVO PRECIOS** / **COMPARATIVO ESTADO** | Ocultas. Las escribe el proyecto aparte del rastreo de precios (#A84): una fila por búsqueda y el estado del rastreo. Desde #A95 cada búsqueda guarda `TARIFA` y `MALETA DE MANO`. Las lee el dashboard de costos. No editarlas. |
| **PPTOS UNIDADES** | Presupuestos por unidad de negocio (dashboard de costos). |
| **INFORMES ENVIADOS** | Oculta. La crea el sistema (#A101): una fila (fecha, informe, mes, para, copia) por cada informe mensual de la política enviado. Evita enviarlo dos veces. No editar. |
| **CONSTANCIA AVISOS** | La crea la app (#A100): una fila (fecha, correo, aviso) por cada solicitante que tocó «Entendido» en la ventana de las reglas nuevas. Es la evidencia de que lo leyó. No editar. |

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
| `procesarAprobacionesPolitica` | Cada 2 h: deniega las solicitudes fuera de plazo vencidas y, en horario laboral, manda al CFO el resumen de las que esperan (#A100); el primer día hábil del mes, también el informe mensual (#A101) | A mano en Activadores, cada 2 h, con la cuenta de los demás activadores (el menú 13 da los pasos: el manifiesto no tiene `script.scriptapp` y no se le agrega) |

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
  PurchaseInfoFields.tsx   Aerolínea y canal de compra (Confirmar costos y Registrar reserva, #A82) y hotel reservado (#A94)
  FareFields.tsx           Tarifa del manual COM-P-02: recomendada, excepción y aviso al cargar opciones (#A95); aviso del voto del CFO (#A100)
  PolicyNoticeModal.tsx    Ventana con las reglas nuevas de las solicitudes y «Entendido» con constancia (#A100)
  PolicyHeldPanel.tsx      Botón «En espera de preaprobación» del panel del analista: solo lectura (#A100)
  TripChangeModal.tsx      «Cambiar mi viaje»: elegir el viaje, qué cambia, resumen y motivo (#A103)
  TripChangeInfo.tsx       Antes / ahora, recuadro del cambio con su costo y aviso «Cambiada» (#A103)
  TripChangeContacts.tsx   A quién llamar después del plazo, en una frase o en un recuadro (#A106)
  ChangeControlPanel.tsx   Métricas → Cambios: costo de los cambios, penalidad y por unidad (#A103)
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
  DateInput.tsx            Campo de fecha DD/MM/AAAA con calendario; reemplaza a <input type="date"> (#A105)
  TimeInput.tsx            Campo de hora HH:MM de 24 h, con la hora en palabras y lista propia de horas; reemplaza a <input type="time"> (#A112)
  Layout.tsx, ConfirmationDialog.tsx
services/gasService.ts     Cliente HTTP hacia GAS (timeout 30 s + AbortController)
utils/dateUtils.ts         Parseo/formato de fechas (zona America/Bogota)
utils/EmailGenerator.ts    Generación de correos HTML (import normal, nunca bajo demanda: #A96)
utils/workOrder.ts         Validación de OT (gemelo de Code.gs, #A66)
utils/birthdate.ts         Validación de fecha de nacimiento (gemelo de Code.gs, #A70)
utils/phone.ts             Validación de celular opcional (gemelo de Code.gs, #A75)
utils/money.ts             Costos en pesos: formato, mínimo y valor pagado (gemelo de Code.gs, #A79, #A102)
utils/purchase.ts          Aerolínea, canal de compra y hotel reservado (gemelo de Code.gs, #A82, #A94)
utils/fare.ts              Tarifa del tiquete por noches y su justificación (gemelo de Code.gs, #A95)
utils/changeWindow.ts      Plazo para pedir un cambio de viaje (gemelo de Code.gs, #A103)
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
tools/check-purchase-info-rules.cjs  Aerolínea, canal y hotel; frontend y backend coinciden (#A82, #A94)
tools/check-invoice-review.cjs       Facturas listas para cerrar y por revisar con una hoja sintética; nada se cierra solo (#A83)
tools/check-price-tracking.cjs       Rastreo de precios: el proyecto aparte y Code.gs juntos sobre una hoja simulada (#A84)
tools/check-savings-analysis.cjs     Caché del dashboard (alcance, invalidación, trozos, fallas) y cuentas de la proyección de ahorro (#A89, #A90)
tools/check-webapp-links.cjs         Enlaces a páginas del web app con el dominio de Equitel (#A91)
tools/check-fare-rules.cjs           Tarifa del manual; frontend y backend coinciden y guardado en la hoja (#A95)
tools/check-single-bundle.cjs        La app es un solo archivo JavaScript, sin cargas bajo demanda (#A96)
tools/check-policy-approval.cjs      Aprobación del CFO por la política: espera, resumen, decisiones, vencimiento, tarifa y aviso (#A100)
tools/check-monthly-report.cjs       Informe mensual de la política: primer día hábil, cifras, cuadros, CSV, envío una sola vez y prueba (#A101)
tools/check-trip-change.cjs          Cambios de viaje: plazo igual en los dos lados, cambio con y sin compra, costo, aprobación, «Cambiada» (#A103)
tools/entorno-prueba/      Entorno de prueba local: build de producción + Code.gs real sobre una copia de la base; correos a una bandeja local (#A103)
tools/comparador-precios/  Comparador de precios (Google Flights vía SerpApi): prueba local y núcleo (comparador.cjs);
                           ignav.cjs + README-ignav.md: prueba de Ignav del 9-oct (descartada: no da las tarifas ni el equipaje bien)
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
  backend (OT, fecha de nacimiento, celular, costos, aerolínea/canal, tarifa) viven en `utils/*.ts` **y** en `Code.gs`,
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

### Para retomar (estado al 2026-10-28)

- **En el Mac, antes de nada: [MIGRACION.md §0](MIGRACION.md)** (Node 24, revisión del equipo y el recordatorio para todos sus
  proyectos). En el PC Linux ya está hecho.
- **Pendiente de desplegar (28-oct, noche): #A115, #A116 y #A117** (rastreo continuo con el historial de Google, «Mes a mes» y el
  dashboard por pestañas). Sin push de frontend: pegar **`Code.gs`** y **`CostsDashboard.html`** → versión nueva del web app; en el
  proyecto aparte del rastreo, pegar **`Rastreo.gs`** (archivo **Rastreo**; `Nucleo` no cambia) y ejecutar **`activarRastreo`** una vez
  (quita la fecha de fin del 21-oct y reinstala el disparador). Con el plan gratis de SerpApi (250 al mes) el rastreo continuo gasta
  ~280: se detiene solo en la reserva hasta que David suba al plan de 1.000. Las filas del historial en «Mes a mes» se llenan con las
  búsquedas desde ese momento.
- **#A111–#A114: desplegados el 28-oct.** David pegó `Code.gs`, `CostsDashboard.html`, `AdminSidebar.html` y `AdminMobile.html` (versión
  nueva); el frontend de #A111/#A112 salió el 27-oct y el de #A114 (calendario) es la revisión `00224` de Cloud Run. Si en MISC aún no está
  la fila `jcpineda@equitel.com.co | COMPLETO`, agregarla y revisarla con el menú 9. Numeración: #A111/#A112 los usó otra sesión el 27-oct;
  los del PC Linux quedaron como #A113 (Juan Camilo, `COMPLETO`) y #A114 (calendario).
- **Reunión del 28-oct con Juan Camilo:** seguir el ahorro de los tiquetes **mes a mes** (hecho: #A115, #A116); David extiende SerpApi al
  plan de 1.000 búsquedas al mes cuando se acaben las actuales; el top 3 de tareas automatizadas de Comex para el 1-dic (otro proyecto).
- **Todo está desplegado hasta #A114 (28-oct).** El 21-oct salieron #A102–#A105 (David pegó `Code.gs`, `CostsDashboard.html`,
  `AdminSidebar.html`, `AdminMobile.html` y `Rastreo.gs`, corrió el menú 12 y publicó la versión nueva); el 22-oct, #A106–#A110.
- **Fechas de compra cambiadas por correcciones (#A102):** SOL-000100, 107, 202, 230, 249, 270, 435, 465, 494, 495, 516,
  526, 527, 545, 552 y 635. Si se quieren corregir, que el área de compras confirme cada fecha y la corrija a mano.
- **Fechas que vienen (sin código):**
  - **21-oct:** terminó el estudio de precios (#A84). Desde #A115 el rastreo sigue sin fecha de fin. Pendiente: revisar la
    proyección con Yurani antes de mostrársela a Alejandro: sin 15 comparaciones exactas no da cifra al año (#A99).
  - **Martes 3-nov:** primer informe mensual automático (octubre) para Alejandro, con copia a Yurani y David.
    Revisar que llegó y que `INFORMES ENVIADOS` tiene su fila. Octubre trae poca tarifa (se registra desde el
    8-oct); desde noviembre sale completa.
- **Estudio de precios:** activo del 7 al 21-oct-2026 (124 consultas en 2 semanas); desde #A115, seguimiento continuo (~280
  consultas al mes: plan de 1.000 cuando David lo suba).
- **Decisiones abiertas:** mostrarle el comparador a Laura: **en pausa**, no se ha decidido si se le muestra
  (David, 14-oct). Siguiente paso posible del valor pagado: compararlo con Google en el comparador sin esperar la factura.
- **Fuera del repositorio:** el documento de demostración para Alejandro
  (`Comparador de precios de tiquetes - demostracion 2026-10-06.docx`) quedó en Descargas del
  PC Linux, y los resultados crudos de la prueba del 6-oct en `resultados-comparador/` (no se
  versiona). Ver [MIGRACION.md](MIGRACION.md).
- **Git por SSH, sin tokens** (David, 8-oct): el PC Linux ya sube por SSH (cuenta `dsanchez-ui`); el token
  viejo de la URL quedó fuera del remoto y ya no es válido. En el Mac, revisar con `ssh -T git@github.com`
  (MIGRACION.md, sección 6).

- **Análisis de ahorro y velocidad del dashboard** (#A89, #A90, 8-oct), **lenguaje simple en todo
  el dashboard** (#A92) y **metodología de cada estimación** (#A93): implementados; pendiente pegar `Code.gs` y `CostsDashboard.html` y crear la
  versión nueva del web app. Lo que sigue está en
  [docs/plan-analitica-ahorro.md](docs/plan-analitica-ahorro.md) §9.
- **#A89–#A96 desplegados el 8-oct-2026 (noche):** David pegó `Code.gs`, `CostsDashboard.html` (versión nueva del
  web app) y `Rastreo.gs` en el proyecto aparte; frontend publicado (`bab13c9`). Incluye hotel reservado (#A94),
  tarifa del manual con maleta de bodega y comparador «peras con peras» (#A95) y el arreglo de «Failed to fetch
  dynamically imported module» (#A96, publicado antes, `7000a25`). La vista *misma tarifa* del comparador arranca
  vacía: se llena con los viajes que Laura confirme desde ahora. Infografía de una hoja: `infografia-tarifas.pdf`.
  Pendientes sin código: avisarle a Laura del campo de tarifa; revisar las cifras de ahorro con Yurani antes de
  mostrarlas a Alejandro; pedir a Aviatur el precio de las tres tarifas en cada cotización. La copia
  `public/assets/EmailGenerator-CHBQuqHQ.js` (#A96) se borró el 14-oct. Internacionales: se queda CEO o CDS.
- **#A99, #A100 y #A101 desplegados el 14-oct-2026** (cifras del dashboard que se pueden presentar, aprobación del CFO
  por la política e informe mensual). El activador `procesarAprobacionesPolitica` también envía el informe mensual: no
  hay otro. Si alguna vez se borra, no salen ni el resumen del CFO ni el informe (menú 14 para revisar).
- **#A106 (primero la plataforma; teléfonos de Laura y Diego después del plazo), #A107 («área de compras» en vez de «área de viajes») y
  #A108 (revisión de seguridad: Node 24 en la imagen, `serve` corregido, SRI de Chart.js): DESPLEGADOS el 22-oct.** David cambió el
  celular de Diego, pegó los cuatro archivos, corrió el menú 16 y publicó la versión nueva; el frontend `51ae8de` se construyó con
  `node:24.22.1-alpine` (0 vulnerabilidades) y es la revisión `00218` de Cloud Run. El PC Linux ya tiene Node 24.22.1 (`~/.local`).
  Queda: Node 24 en el Mac ([MIGRACION.md §0](MIGRACION.md)); en el PC, 26 paquetes del sistema sin actualizar (`sudo apt update &&
  sudo apt upgrade`; Python ya trae los parches de octubre en `3.14.4-1ubuntu0.2`); revisar el manifiesto de Apps Script
  ([docs/SEGURIDAD_22OCT.md](docs/SEGURIDAD_22OCT.md) §5, punto 5); el 30-oct fijar markdown-it 14.3.3 (lo hace Claude).
- **#A109 (reserva por partes = tiquete comprado en los cambios; «No se reservó hotel» = $0 en el dashboard) y #A110 («Excluir del
  ahorro» en el comparador y la respuesta en una frase): DESPLEGADOS el 22-oct.** David pegó `Code.gs` y `CostsDashboard.html` y publicó
  la versión nueva; el frontend `0d71592` es la revisión `00220` de Cloud Run. **SOL-000659** (compra guardada por partes) y su cambio
  **SOL-000667**: David asume que Laura ya lo resolvió a mano; si no, ahora basta «Confirmar lo que se compró» en «Revisar Cambio».
  Pendientes de David:
  - Excluir del ahorro el viaje a Miami (SOL-000658) en el dashboard de costos, con su motivo: queda en 7 viajes y $1.215.647.
  - Reunión del 22-oct (Yurani, David): el ahorro de comprar directo no paga una persona con el salario mínimo ($2,7 M al mes con
    prestaciones). El artefacto de costos (https://claude.ai/artifact/AoWDaTnRmtwBH83yX56zQ7, privado) lo comparte David después de
    reunirse con Alejandro el 23-oct. Siguen: excepciones del manual por cargo (con Alejandro; falta el cargo, que está en la lista de
    RR. HH.), los informes gerenciales de Aviatur (los consigue Yurani), el valor exacto del cargo de Aviatur (por escrito), si la empresa
    tiene la exoneración de aportes (contabilidad), el caso de Sandra Omaña (SOL-000665) y la cifra del comparador con Yurani.
- **#A103 «Cambiar mi viaje», #A104 y #A105: desplegados el 21-oct.** Ya se probó en producción (lo probó otra persona, David, 22-oct) y
  Laura ya tiene la guía «Cómo gestionar un cambio de viaje».
- **Manuales dentro de la app** (David, 14-oct): **solo plan**, en
  [docs/plan-manuales-en-app.md](docs/plan-manuales-en-app.md) — hoy David los pasa uno por uno (`docs/guia-*.pdf`).
- **Informe por unidad para cada jefe** (posible segunda etapa de #A101): la presentación de Alejandro dice que «su jefe
  directo recibe el ranking mensual de su unidad». Nadie lo ha pedido todavía; preguntar antes de construirlo.
- **Módulo de legalizaciones de gastos** — plan V2 aprobado en reunión del
  2026-06-01, pendiente de desarrollo. Spec completa y autocontenida en
  [docs/plan-legalizaciones-gastos.md](docs/plan-legalizaciones-gastos.md).
- **Optimizaciones** — plan por etapas en [OPTIMIZACIONES.md](OPTIMIZACIONES.md).
  Etapa 1 completada; el resto documentado con riesgo y beneficio.
- **#A50** — la hoja `INTEGRANTES` se eliminó en abril; en `Code.gs` solo quedan ramas que ya no se
  ejecutan (`USE_USUARIOS_SHEET`). Limpiarlas es opcional y sin urgencia.
- **Plan de la reunión del 2026-09-10** —
  [docs/plan-reunion-2026-09-10.md](docs/plan-reunion-2026-09-10.md). **Desplegado
  en producción** (#A68–#A73): fecha de nacimiento en usuarios, formulario y
  detalle; recordatorio; carga masiva (ejecutada: 636 fechas). Mejoras C1 y C3
  descartadas por David.
- **#A74 y #A75** (detalle sin segunda llamada; celular del pasajero desde la lista
  de RR. HH. y como campo opcional en los formularios): en `main` (`c3c0b8d`) y
  Apps Script desplegado (el menú 8 ya se usó). Los 7 celulares inválidos o faltantes de la
  lista de RR. HH. no se persiguen (David, 14-oct): el formulario los ofrece a quien no tiene uno válido.
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
- **Costos de #A79 que el menú 11 no tocaba** (SOL-000310, 378, 379 y 035): corregidos a mano por
  David (14-oct).
- **Carga de fechas (#A72):** las 4 fechas inválidas de la lista de RR. HH. no se persiguen (David,
  14-oct): esas personas no tienen fecha válida y el formulario de vuelos se la pide, porque un texto
  que no es fecha cuenta como vacío. `PRUEBA1` y `PRUEBA2` se quedan a propósito para seguir probando.
