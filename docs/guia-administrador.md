# Guía técnica del administrador — Equitel Viajes

> **Para quién es:** quien mantiene el sistema (hoy, David Sánchez). Arquitectura, hojas de
> cálculo, activadores, propiedades del script, funciones del editor, respaldo y despliegue.
>
> **No se publica en la plataforma** y no se le comparte a quien solo opera los viajes: la
> operación del día a día está en la [guía del área de compras](./guia-area-compras.md), que
> sí se publica en `/manuales/`.

---

## 1. Arquitectura a alto nivel

```
 ┌───────────────┐          ┌──────────────────┐         ┌─────────────────┐
 │  Solicitante  │ ──POST──>│  Apps Script     │ ──rw──> │  Google Sheets  │
 │  (navegador)  │          │  (Web App)       │         │  (base de datos)│
 └───────────────┘          │                  │         └─────────────────┘
                            │                  │         ┌─────────────────┐
 ┌───────────────┐          │                  │ ──rw──> │  Google Drive   │
 │   Aprobador   │ ──GET───>│                  │         │ (imgs + PDFs)   │
 │   (email)     │          │                  │         └─────────────────┘
 └───────────────┘          │                  │         ┌─────────────────┐
                            │                  │ ──send─>│  Gmail          │
 ┌───────────────┐          │                  │         └─────────────────┘
 │   Analista    │ ──POST──>│                  │
 │  (navegador)  │          └──────────────────┘
 └───────────────┘
```

### Los archivos clave en Google Drive

- **Sistema Tiquetes Equitel V2** (Google Sheets) — la base de datos completa. Todas las hojas viven aquí.
- **Carpeta raíz de archivos** (`ROOT_DRIVE_FOLDER_ID` en Script Properties) — Drive folder donde se crea una subcarpeta por solicitud (PNRs, facturas, reportes PDF).
- **Carpeta de respaldos** (`BACKUP_FOLDER_ID` opcional) — donde se guardan los respaldos completos del sheet.
- **Proyecto Apps Script** ligado al sheet — código backend.

---
## 2. Las hojas del spreadsheet

| Hoja | Propósito | ¿Se puede reorganizar? |
|---|---|---|
| **Nueva Base Solicitudes** | Tabla principal con TODAS las solicitudes (una fila por solicitud). 75 columnas canónicas. | ✅ Sí, con el workflow de reorganización (ver §6). El código lee las columnas por nombre, no por posición. |
| **USUARIOS** | Directorio de usuarios: cédula, correo, empresa, aprobadores, hash de PIN. | ⚠️ No reorganizar. Las posiciones de columnas están hardcoded en el sidebar. |
| **CDS vs UDEN** | Catálogo de centros de costo → unidad de negocio. | ⚠️ No reorganizar. |
| **CIUDADES DEL MUNDO** | Ciudades con país y flag de internacional. | ⚠️ No reorganizar. |
| **MISC** | Sedes y tarjetas de crédito (catálogos). | ⚠️ No reorganizar. |
| **REGLAS_COAPROBADOR** | Reglas de co-aprobadores (ej. internacional requiere CDS). | ⚠️ No reorganizar. |
| **INTEGRANTES_OLD** | Antigua hoja de usuarios (legacy, antes de Plan 2). | ✅ Ignorar o borrar tras 1-2 meses de uso normal del nuevo modo. |

> **Detalle operativo del spreadsheet** (qué tocar a mano, qué no, cómo usar los sidebars paso a paso): ver la [Guía del Google Sheets](./guia-hoja-calculo.md). Esta guía del administrador cubre el portal completo; aquélla se enfoca en la hoja de cálculo como base de datos y su operación diaria.

### Columnas importantes en "Nueva Base Solicitudes"

No es necesario memorizar las 75, pero estas son las más relevantes día a día:

| Columna | Qué guarda |
|---|---|
| `ID RESPUESTA` | Identificador único (`SOL-000123`). |
| `STATUS` | Estado actual (ver el ciclo de vida en la guía del área de compras). |
| `CORREO ENCUESTADO` | Quién solicita. |
| `OPCIONES (JSON)` | Array de URLs de imágenes que subió el analista. |
| `SELECCION_TEXTO` | Descripción libre que escribió el usuario de su selección. |
| `COSTO_FINAL_TIQUETES`, `COSTO_FINAL_HOTEL`, `COSTO COTIZADO PARA VIAJE` | Costos confirmados por el analista (formato pesos colombianos). |
| `No RESERVA` | PNR / número de confirmación. |
| `SOPORTES (JSON)` | Array de archivos (factura reserva, etc.) con sus URLs de Drive. |
| `APROBADO POR ÁREA? (AUTOMÁTICO)`, `APROBADO CDS`, `APROBADO CEO` | Log de quién aprobó y cuándo. Si una etapa se saltó, queda marcada como `Sí (ETAPA SALTADA por correo@…)`. |
| `EVENTOS_JSON` | Timestamps de cada evento del ciclo (creación, opciones, selección, costos, aprobaciones, reserva, cancelaciones, enmiendas). Usado por métricas y por el semáforo del detalle de cada solicitud (#A121). Desde el 5-nov también guarda cuándo se aceptó o rechazó un cambio (`changeStudied`, `changeRejected`), la reserva guardada por partes (`reservationDraftSaved`), el cierre (`closed`), la original anulada por su cambio (`cancelledByChange`) y **quién hizo cada paso** (`…By`: `{ email, at }`), #A123. |
| `OBSERVACIONES` | Texto libre. Puede tener marcadores internos como `[CONSULTA_USUARIO_PENDIENTE]`, `[ETAPA SALTADA por …]`, `[RESERVA]: Registrada sin notificación al usuario` o `[OTRA UNIDAD]: …` (#A133). |
| `UNIDAD DE NEGOCIO`, `UNIDAD DEL VIAJERO`, `APROBADOR OTRA UNIDAD`, `APROBADO OTRA UNIDAD` | #A133: la unidad que paga (la dueña del centro de costos, la decide el servidor con «CDS vs UDEN»), la del primer pasajero (columna `Unidad de negocio` de USUARIOS, o la que eligió si no tiene), a quién se le pidió el voto por la unidad del centro de costos (tabla `RESPONSABLE UNIDAD` de MISC, sin el propio viajero ni quien pide) y su decisión. Rol `OTHER_UNIT` en los enlaces firmados, «Mis aprobaciones» y la línea de tiempo; un voto de la misma persona en otro rol lo cubre (`_ouEffective_`). |

---
## 3. Sidebars (paneles laterales)

Hay dos sidebars, ambos en el menú **Equitel Viajes** dentro del Google Sheet:
### 3.1 Reorganizar Base Principal (sidebar de REORG)

**Cuándo usarlo:** una vez cada pocos meses (o nunca). Cambiar el orden de columnas de la hoja principal, agregar columnas extras personales, o limpiar el layout.

Ver guía completa en [guia-reorganizar-base.md](./guia-reorganizar-base.md). La operación diaria del spreadsheet (qué columnas son editables, cómo moverse entre las hojas, reglas de oro) está en la [Guía del Google Sheets](./guia-hoja-calculo.md).
## 4. Módulo Admin Móvil: URL y acceso

### URL del módulo

La misma URL del Web App con el parámetro `?action=admin` al final:

```
https://script.google.com/a/macros/equitel.com.co/s/AKfycb.../exec?action=admin
```

Siempre con `/a/macros/equitel.com.co/`: sin el dominio, un celular con varias cuentas de Google muestra
*"No se pudo abrir el archivo"* (#A53, #A91). Lo mismo para el dashboard de costos (`?view=costs-dashboard`), que la app ya
abre así desde el botón *Costos por Unidad*.

Recomendación: agregarlo a la pantalla de inicio del celular (iOS Safari → compartir → "Añadir a pantalla de inicio"; Chrome Android → menú → "Añadir a pantalla de inicio") para acceso de un toque, como si fuera una app nativa.

### Cómo funciona por dentro (#A135, 25-nov-2026)

- **Es el sidebar «Gestión de Usuarios» en modo móvil.** `doGet` (`?action=admin`) → `_adminMobilePage_()` lee `AdminSidebar.html` y le pone `data-mode="mobile"` en `<body>`. `AdminMobile.html` ya no existe (solo creaba usuarios). Si `AdminSidebar.html` es una versión anterior (sin la marca `data-mobile-ready`), la página muestra un aviso en vez del sidebar sin inicio de sesión: pegar `Code.gs` y `AdminSidebar.html` juntos.
- **Inicio de sesión:** `verifyAdminPin(pin, email)` → token en `localStorage.equitel_mobile_admin_session` (la misma llave del panel anterior).
- **Una sola puerta:** en modo móvil, `gsRun()` del sidebar manda cada llamada a `mobileAdmin_run(email, token, fn, args)`, que valida la sesión (`_requireMobileAdminAuth_`) y solo ejecuta las funciones de `_adminMobileApi_` (las mismas que usa el sidebar; `tools/check-user-admin.cjs` compara las listas del navegador y del servidor con las llamadas del sidebar). En el sidebar de la hoja, `gsRun()` es `google.script.run`.
- **Datos personales:** en el móvil `usuarios_listAll` llega sin `fechaNacimiento` ni `celular`; el formulario los pide al abrir a una persona (`usuarios_getUserDetail` en `_adminMobileApi_`, que llama a la privada `_usuariosGetUserDetail_`: no se puede pedir por fuera de `mobileAdmin_run`).
- **Responsables de cada unidad** (pestaña «Unidades»): `usuarios_getResponsables` / `usuarios_setResponsables` en el sidebar (quien cambia = `Session.getActiveUser()`, **sin** respaldo en `getEffectiveUser`, que en el web app es el dueño del script) y en el móvil el correo de la sesión. Cambiar: solo `OU_RESPONSABLES_EDIT_ALLOWED` (Yurani, David) y además administrador. Reescribe solo las dos columnas de la tabla en MISC y deja constancia en la hoja oculta `CAMBIOS RESPONSABLES`. Sugerencias: `_ouApprovalStats_` (votos `Sí_correo` de `APROBADO POR ÁREA? (AUTOMÁTICO)` de los últimos `OU_SUGGEST_DAYS` = 180 días, sin cambios de viaje ni viajes cargados desde otra unidad).
- **Unidad de cada persona:** `usuarios_create` / `usuarios_update` aceptan `unidadNegocio` (clave presente = se toca; vacía = sin unidad; siempre la etiqueta de «CDS vs UDEN», `_usuarioUnitFromPayload_`), y `usuarios_bulkUpdate` la acción `unidadNegocio`.
- Las funciones `mobileAdmin_getBootstrap` y `mobileAdmin_createUser` se quedan para una pestaña abierta con el panel anterior.
## 5. Triggers programados (4 triggers cada 2h)

Estos se ejecutan automáticamente en horario laboral. Ya están configurados.

| Función | Qué hace |
|---|---|
| `sendPendingApprovalReminders` | Recordatorio a los aprobadores a los que se les pidió el voto y todavía hace falta (en un viaje internacional basta Gerencia General o Cadena de Suministro). El primero, después de 2 horas laborales (#A118). Respeta pausa si hay cambio activo. Cap 100 correos/run. |
| `sendPendingSelectionReminders` | Recordatorio al usuario que no ha descrito su selección. Mismo asunto = mismo hilo en Gmail. |
| `processAdminReminders` | Resumen diario/periódico al admin de pendientes (cotizar, confirmar costos, reservar, cambios). |
| `sendPendingConsultReminders` | Recordatorio al usuario sobre consultas pendientes (continuar/anular tras denegación de cambio). |
| `procesarAprobacionesPolitica` | (#A100) Suelta las que esperan y tienen OT (#A136), deniega las solicitudes fuera de plazo vencidas y le manda al CFO el resumen de las que esperan su aprobación, solo en horario laboral (`isWorkingHour`). El primer día hábil de cada mes envía además el informe mensual de cumplimiento (#A101). Se crea **a mano** en Activadores (Según tiempo, cada 2 horas), con la misma cuenta de los demás activadores. El **menú 13** muestra los pasos. |

### 5.1 Órdenes de trabajo y el CFO (#A136, #A137) — **no va en las guías publicadas**

**Esto no se escribe en ninguna guía que abra un viajero.** Está aquí porque esta guía es la única que no se publica en `public/manuales/` (ver #A130).

**La regla (28-nov-2026, pedido de Yurani por Alejandro Gómez):** una solicitud nueva **con OT válida no espera** la aprobación de la excepción por anticipación. El viaje lo paga el cliente, no el presupuesto de la unidad — la misma razón por la que una OT ya exime del voto del responsable de presupuesto (`_esOTValida_`, acuerdo con Yurani del 21-may). Yurani: *«todos los que tengan OT (que es lo que los clientes van a pagar), que los deje avanzar sin problema, sin aprobado»*.

**Lo que NO cambia, a propósito** (David, 28-nov: *«no quiero que la gente sienta que poniendo órdenes de trabajo pueden pedir los viajes cuando quieran, porque creamos espacio para fraude»*):

- La solicitud queda **marcada fuera de política** (`VIOLACION POLITICA = SI`) y **cuenta igual en el informe mensual** de cumplimiento (#A101).
- El formulario **sigue pidiendo la justificación** obligatoria y la guarda en `JUSTIFICACION ANTICIPACION`.
- El aviso ámbar del formulario **se ve igual**; lo único distinto es que dice *«puede necesitar la aprobación de…»* en vez de *«necesita»*. En las guías publicadas y en la infografía la anticipación quedó redactada igual de hedgeada: *«puede quedar en espera»*. **Nunca escribir allí que la OT exime.**
- La OT tiene que estar **bien escrita** (compuerta estricta de #A66, `OT-<EE><CCC>-<NÚMERO>`): un texto que empiece por «OT» no exime y además no deja crear la solicitud.
- El voto del CFO por **tarifa superior** (#A95/#A100) y por un **cambio pedido después del plazo** (#A129) no cambian: ahí sí se le pide, y por eso el «puede» del aviso es cierto.

**Dónde está:** `POLICY_WORK_ORDER_EXEMPT` y `_policyWorkOrderExempt_` en `Code.gs`. Para apagar la regla, ponerlo en `false` y pegar `Code.gs`: el formulario se entera solo (lo recibe en `policyApproval.workOrderExempt`) y vuelve a decir *«necesita»*.

**Las que ya estaban esperando:** `_policyReleaseExempt_` corre en cada pasada del activador, **antes** de denegar las vencidas, y suelta a `PENDIENTE_OPCIONES` las que esperan y tienen OT (si el viaje ya pasó, no: esa vence como siempre). La columna `APROBACION CFO ANTICIPACION` **queda vacía a propósito** — «vacía = no necesitó aprobación»; escribir algo allí la haría contar como una decisión que nadie tomó en el informe mensual, el semáforo y «Mis aprobaciones». La constancia va en `EVENTOS_JSON`: `policyOtExempt`, `policyApproved` y `policyDecision: {decision: 'exempt'}`. En el semáforo esa etapa se llama **«No requirió la excepción»**, sin nombre de aprobador.

**Cómo ver cuántas esperan y si la regla está encendida:** menú **14**.

#### Y lo mismo para todo lo demás que aprobaba el CFO (#A137, 28-nov)

David, el mismo día: *«cuando tiene OT una solicitud, no debe pedir que Alejandro apruebe nada. Porque si hay sobrecostos, se le van a cargar a la OT y eso lo paga el cliente. Y si hay cambios fuera de plazo, también va a tener sobrecostos y eso también lo aprueba el cliente»*. Con OT válida, **ninguno** de los tres motivos le pide el voto:

| Motivo | Antes | Ahora con OT |
|---|---|---|
| Presupuesto de la unidad excedido | exento desde #A66 | exento |
| Tarifa superior a la del manual (#A95) | votaba el CFO | **no vota** |
| Cambio pedido después del plazo (#A129) | votaba el CFO | **no vota** |

Una sola compuerta: `_requiresCfoVote_` devuelve `false` si `_policyWorkOrderExempt_(workOrder)`. En `mapRowToRequest` se apagan además `requiresFareApproval`, `lateChangeNeedsCfo` y **`policyApproverName`** (que queda vacío): de ahí cuelgan todos los avisos de la app — el de la tarifa en *Confirmar costos* y *Registrar reserva* (`FareFields`), el «lo aprueba también…» del cambio (`TripChangeInfo`, `TripChangeModal`) y el correo de aprobación. Si alguna pantalla nueva necesita nombrar al CFO, que se gatee con `policyApproverName`, no con la configuración.

Es **compute-on-read**, igual que el presupuesto: `REQUIERE APROB TARIFA` y `fueraDePlazo` se siguen escribiendo porque miden lo que pasó y alimentan el informe mensual (#A101). Lo único que la OT quita es el voto.

Dos efectos que hay que recordar:

- `_assertFareChangeAllowed_` (no subir la tarifa por encima de la aprobada antes de comprar) **no aplica con OT**: nadie aprobó una tarifa, así que bloquear dejaría al área de compras esperando algo que no va a llegar.
- La nota de `[TARIFA]` en OBSERVACIONES, que lee el viajero, **no dice «Requiere la aprobación de …»** cuando hay OT: solo deja constancia de que la tarifa es superior a la del manual.

**Las que quedaron atascadas.** El motor de aprobación solo recalcula cuando alguien vota, así que una solicitud con OT que ya tenía el voto del jefe y esperaba únicamente al CFO se habría quedado quieta para siempre. `_policyUnblockWorkOrders_` corre en cada pasada del activador, dentro del mismo candado, y reevalúa esas filas con `reevaluarAprobacionPendiente` (la misma cuenta del motor). **Si falta cualquier otro voto, no hace nada.** Es idempotente y queda como red: después del despliegue no debería encontrar nada.

**La OT le quita el sombrero de CFO, no el de jefe.** Si Alejandro es el aprobador de área de quien viaja, se le sigue pidiendo su voto como cualquier jefe (rol `NORMAL`), tenga OT o no: lo que la OT apaga es el rol `BUDGET_OVERRUN`. Probado en `check-policy-approval.cjs`.

**Dónde queda el control, entonces:** en el informe mensual (la tarifa superior y el pedido fuera de plazo siguen contando), en el dashboard de costos (el viaje aparece en «Cargado a OT» **con el número de la OT**) y en el aprobador de área, que sigue votando siempre. **Lo que se perdió:** en un cambio después del plazo, el voto del CFO era la protección cuando el aprobador de área es la misma persona que pide (caso Mateo, #A129). Con OT ya no hay segundo par de ojos. Si eso llega a importar, la vuelta corta es volver a pedir el voto solo cuando quien pide es su propio aprobador.

**Trigger de mantenimiento (ya configurado):**
- `cleanupExpiredSessions` (diario, 1–2 AM) — limpia sesiones `SESSION_*` expiradas, lockouts de PIN vencidos, counters de rate-limit fuera de ventana (regen PIN, crear solicitud) y Script Properties JSON corruptas. Se apoya en `cleanupExpiredPropsWeekly`, que hace el trabajo real. Previene acumulación y mantiene las Script Properties bajo el límite de 500 KB.

---

## 6. Script Properties (configuración)

Son variables de configuración en el proyecto Apps Script. **NO editar desde la GUI** (se bloquea cuando hay >50 propiedades, caso de este proyecto). Usar funciones helper.

| Propiedad | Valor | ¿Cómo editar? |
|---|---|---|
| `ANALYST_EMAILS` | JSON array: `["compras.equitel@equitel.com.co","dsanchez@equitel.com.co"]` | Ejecutar `actualizarAnalystEmails()` después de editar el array en código. |
| `SUPER_ADMIN_EMAILS` | JSON array de correos superadmin. Actualmente David + Yurani. | `setScriptProperty('SUPER_ADMIN_EMAILS', '[...]')` desde el editor. |
| `ADMIN_PIN_HASH` | SHA-256 del PIN admin compartido. Solo se usa si un admin NO tiene fila propia en USUARIOS (cuentas de área compartidas). Deprecado tras la transición 2026-08: todos los admins activos usan su PIN personal. | `updateAdminPin(nuevoPin)` desde el editor. Primera vez: `configurarPinInicial()` tras poner `INITIAL_ADMIN_PIN`. |
| `APPROVAL_LINK_SECRET` | Secreto HMAC para firmar los links de aprobación de correos. Se genera automáticamente la primera vez. | NO tocar manualmente. Si lo borras, todos los links firmados dejan de funcionar. |
| `APPROVAL_LINK_HMAC_CUTOVER_AT` | ISO timestamp opcional. Tras esa fecha, los links **sin firma** de solicitudes que entraron a su etapa DESPUÉS del cutover se rechazan (defensa contra links manipulados). Links de solicitudes pendientes al momento del deploy siguen funcionando. | `setScriptProperty('APPROVAL_LINK_HMAC_CUTOVER_AT', '2026-04-19T00:01:00-05:00')`. Recomendado: setear 10-14 días después del deploy. |
| `USE_USUARIOS_SHEET` | **DEPRECADO** desde 2026-04-24. Ignorado por el runtime — la app siempre lee de USUARIOS. Se puede borrar. | — |
| `MAIL_FROM_ALIAS` | Alias de Gmail desde el que salen todos los correos del sistema (ej. `compras.equitel@equitel.com.co`). Requiere que ese alias esté configurado como "Send As" en la cuenta que desplegó el web app. Si no se setea, los correos salen desde la cuenta desplegadora (comportamiento legacy). | `setScriptProperty('MAIL_FROM_ALIAS', 'compras.equitel@equitel.com.co')`. Verificar luego con `verificarAliasCorreo()`. |
| `MAIL_FROM_NAME` | Nombre visible del remitente (ej. "Sistema Viajes Equitel"). Ignorado si `MAIL_FROM_ALIAS` no está activo. | `setScriptProperty('MAIL_FROM_NAME', 'Sistema Viajes Equitel')`. |
| `MAIL_TECH_SUPPORT_EMAIL` | Correo que aparece en el footer de todos los correos como contacto técnico del aplicativo (ej. `dsanchez@equitel.com.co`). Si no se setea, el footer no se inyecta. | `setScriptProperty('MAIL_TECH_SUPPORT_EMAIL', 'dsanchez@equitel.com.co')`. |
| `WEB_APP_URL` | URL del deploy Apps Script. | Default hardcoded. Si cambia el deploy, actualizar via editor → propiedades. |
| `PLATFORM_URL` | URL del frontend Cloud Run. | Default hardcoded. |
| `ROOT_DRIVE_FOLDER_ID` | Carpeta raíz de archivos. | Default hardcoded. |
| `BACKUP_FOLDER_ID` | Carpeta de respaldos (opcional). | Desde el sidebar de reorganización → sección Respaldo → pegar URL/ID. |
| `REPORT_TEMPLATE_ID` | ID del Google Doc template de reportes. | Generado automáticamente por `createReportTemplate()` (ejecutar una vez). |
| `CEO_EMAIL`, `DIRECTOR_EMAIL`, `ADMIN_EMAIL` | Correos ejecutivos. | Default hardcoded. |

**Diagnóstico de propiedades:** ejecuta `verPropiedadesDelScript()` desde el editor para ver el estado de todas.

### Remitente de los correos (alias "Send As")

Por defecto, todos los correos del sistema salen desde la cuenta que desplegó el web app. Si la cuenta desplegadora es distinta del área operativa (caso típico: David despliega desde `dsanchez@`, pero los correos deberían salir desde `compras.equitel@` para que los usuarios respondan al área de compras), se configura un alias `Send As`.

**Setup (una sola vez, ~5 minutos):**

1. En el Gmail de la cuenta que desplegó el web app → **Configuración → Cuentas e importación → Enviar correo como → Añadir otra dirección de correo**.
2. Escribe la dirección del alias (ej. `compras.equitel@equitel.com.co`), un nombre visible (ej. `Sistema Viajes Equitel`), deja marcado "Tratarlo como un alias" y continúa.
3. Google envía un código de verificación a la bandeja del alias. Abre esa bandeja, copia el código, pégalo.
4. En el editor GAS ejecuta **una sola vez**:
   ```javascript
   setScriptProperty('MAIL_FROM_ALIAS', 'compras.equitel@equitel.com.co');
   setScriptProperty('MAIL_FROM_NAME', 'Sistema Viajes Equitel');
   setScriptProperty('MAIL_TECH_SUPPORT_EMAIL', 'dsanchez@equitel.com.co');
   ```
5. Ejecuta `verificarAliasCorreo()` — loguea si el alias está bien configurado antes de confiar. Si dice **ALIAS VÁLIDO** todo listo; si no, sigue los pasos que sugiere el log.
6. Opcional: ejecuta `enviarCorreoDePruebaAlias()` para recibir un correo real y verificar que el remitente aparece como esperas.

**Qué ve el usuario:** `De: Sistema Viajes Equitel <compras.equitel@equitel.com.co>`. Cuando responde, la respuesta llega a la bandeja de compras.equitel.

**Footer de soporte técnico:** se inyecta automáticamente en todos los correos con el valor de `MAIL_TECH_SUPPORT_EMAIL`. El frontend NO lo incluye para evitar duplicación — el backend es la fuente única de verdad.

**Rollback:** si necesitas volver al comportamiento anterior (correos desde la cuenta desplegadora), ejecuta `deleteScriptProperty('MAIL_FROM_ALIAS')`. Toma efecto en el siguiente request, sin redeploy.

**Fail-safe:** si el alias queda mal configurado o Gmail bloquea el envío, el wrapper `_sendMail_` cae automáticamente a `MailApp.sendEmail` (comportamiento legacy). Los correos siempre salen — nunca se pierde nada. El fallback queda logueado en Ejecuciones.

### Detalles de autenticación (PIN admin + PIN personal)

- Si un admin **tiene fila propia en USUARIOS** (caso David, Yurani, Laura), puede ingresar con el botón negro **ADMINISTRADOR** usando o bien el PIN admin compartido, o bien **su PIN personal** (el mismo que usa para ingresar como usuario). Esto evita el "cruce" cuando Chrome autocompleta el PIN personal en el formulario de admin.
- Si un admin **NO tiene fila en USUARIOS** (cuentas de área compartidas, como fue `apcompras@` hasta la transición 2026-08), solo puede ingresar con el PIN admin compartido.
- El rate-limit por intentos fallidos es **por email**: fallar 5 veces con un correo bloquea solo ese correo por 15 min, no al resto de admins.

### Rate-limits y protecciones anti-abuso

| Límite | Ventana | Acción |
|---|---|---|
| PIN admin fallido | 5 intentos / 15 min | Bloqueo del correo específico (no afecta a otros admins). |
| PIN usuario fallido | 5 intentos / 15 min | Bloqueo del correo específico. |
| Regenerar PIN usuario ("olvidé mi PIN") | 3 regeneraciones / hora | Nueva solicitud rechazada. |
| Crear solicitudes | 10 solicitudes / día por solicitante | Excedido → error claro al usuario. Solo cuenta tras una creación exitosa. |
| Payload `doPost` | 30 MB | Rechazado con error "Payload demasiado grande" antes de parsear. Previene abuso / DoS por payloads gigantes. |

**Protecciones adicionales:**
- **Firma HMAC en links de aprobación**: cada botón de aprobar/denegar en los correos lleva un `t` (timestamp) y `sig` (HMAC-SHA256 con `APPROVAL_LINK_SECRET`). Links manipulados son rechazados. Con **cutover per-request** (`APPROVAL_LINK_HMAC_CUTOVER_AT`): los correos ya enviados antes del cutover siguen funcionando; los posteriores obligatoriamente deben venir firmados.
- **Validación de shape del token en localStorage**: si alguien manipula manualmente el token guardado (email, role, expiresAt), el frontend lo detecta por regex y fuerza relogin sin consumir rate-limit.
- **Ownership en modificaciones**: un usuario normal no puede crear una solicitud-hija apuntando al ID de otro usuario. Solo analistas y superadmins pueden hacerlo (para gestionar a nombre de alguien).
- **Anular con hija activa**: si la solicitud tiene una hija en `PENDIENTE_ANALISIS_CAMBIO` o en curso, no se puede anular al padre hasta resolver la hija. Evita huérfanos en la base.

---

## 7. Funciones admin útiles (ejecutar desde el editor Apps Script)

| Función | Cuándo usarla |
|---|---|
| `verPropiedadesDelScript()` | Ver qué Script Properties están configuradas. |
| `actualizarAnalystEmails()` | Actualizar el whitelist de analistas. |
| `diagnosticarAuth()` | Debuggear "Acción no autorizada" — muestra qué correo detecta el script. |
| `verificarMigracionUsuarios()` | Pre-flight check antes de activar modo USUARIOS. Lista usuarios faltantes, PINs perdidos. |
| `toggleUsuariosMode()` | Cambiar entre modo INTEGRANTES y USUARIOS. Rollback = ejecutar de nuevo. |
| `cleanupExpiredSessions()` | Limpiar sesiones expiradas de Script Properties. |
| `crearHojaUsuarios()` | Crear la hoja USUARIOS vacía (primera vez). |
| `migrarIntegrantesAUsuarios()` | Poblar USUARIOS desde INTEGRANTES + Maestro RH. |
| `sincronizarConMaestroRH()` | Agregar a USUARIOS los empleados nuevos del Maestro RH. |
| `recargarResolucionesUsuarios()` | Re-resolver col H/I de USUARIOS tras edición manual de col G. |
| `createReportTemplate()` | Regenerar el template del PDF de reporte (raro). |
| `setScriptProperty(key, value)` | Editar cualquier Script Property desde el editor (workaround a la GUI bloqueada >50 properties). |
| `deleteScriptProperty(key)` | Borrar una Script Property. |
| `listScriptProperties()` | Listar todas con valores enmascarados. |
| `diagnosticarAprobacion(requestId)` | Loguea el estado real de las columnas de aprobación de una solicitud. Útil cuando hay inconsistencia entre status global y fila. |
| `verificarAliasCorreo()` | Diagnóstico del alias "Send As" para correos. Valida que `MAIL_FROM_ALIAS` esté registrado en Gmail antes de confiar en él. Ejecutar después de configurar las 3 Script Properties de correo. |
| `enviarCorreoDePruebaAlias()` | Envía un correo real al `MAIL_TECH_SUPPORT_EMAIL` usando el wrapper. Úsalo tras `verificarAliasCorreo()` para confirmar visualmente el remitente. |

---
## 8. Problemas técnicos

### Métricas muestran "sin datos" para solicitudes viejas

Antes del deploy de métricas (Plan 4), las solicitudes no tenían `EVENTOS_JSON`. Quedan como "sin datos" para siempre. Filtra "Excluir sin datos" (default) para ocultarlas.

### Se duplicó un usuario en USUARIOS

Ve al sidebar → tab **Duplicados** → escanear. Compara las filas lado-a-lado (incluye estado del PIN) y elimina las que sobren. El sistema te advierte si borras una fila con PIN.

### Quiero revertir el switch a USUARIOS

Ejecuta `toggleUsuariosMode()` desde el editor → vuelve a modo INTEGRANTES. **Importante:** si renombraste INTEGRANTES a INTEGRANTES_OLD, debes renombrarla de vuelta para que el modo legacy funcione.

### El sidebar de Reorganizar no abre ("Acción no autorizada")

Tu correo no está en `ANALYST_EMAILS`. Actualiza el array en `actualizarAnalystEmails()` y ejecuta.

### Un trigger falló / no corrió

Revisa `Triggers` en el editor GAS. Si un trigger se eliminó manualmente, debes recrearlo (click en +, seleccionar la función, fuente=Time-driven, intervalo 2 h).
## 9. Backup y recuperación

**Antes de cualquier cambio estructural** (reorganizar, migrar USUARIOS, etc.):

1. Menú **Equitel Viajes → Reorganizar Base Principal (Sidebar)**
2. Sección "🛡️ Respaldo completo del archivo" (arriba de todo)
3. Si es primera vez: pega la URL/ID de tu carpeta privada de Drive → **Guardar carpeta**
4. **📋 Crear respaldo ahora** → ~30-60s → copia completa en tu Drive

Recuperación: si algo sale MUY mal, abres la copia respaldada, la descargas como .xlsx, o la copias encima del sheet activo (requiere re-vincular Apps Script).

---

## 10. Despliegue y mantenimiento

- **Código en:** github.com/dsanchez-ui/equitel_viajes_v1
- **Deploy frontend:** Cloud Run `sistematiquetesequitel-302740316698.us-west1.run.app`
- **Deploy backend:** Apps Script Web App, URL en `WEB_APP_URL`
- **Modelo de deploy:**
  - Frontend: push a `main` → Cloud Build auto-despliega.
  - Backend: copiar `server/Code.gs`, `server/AdminSidebar.html`, `server/ReorgSidebar.html` al editor GAS manualmente → redesplegar Web App.

---

---
## 11. Referencias cruzadas

- [Guía del Google Sheets](./guia-hoja-calculo.md) — operación del spreadsheet: qué es editable a mano, cómo usar los sidebars paso a paso, reglas de oro para no romper la base.
- [Guía de reorganización de columnas](./guia-reorganizar-base.md) — workflow de 6 pasos para reordenar columnas de "Nueva Base Solicitudes" sin romper el portal.
- [README del repo](./README.md) — arquitectura general y stack.

---

*Última actualización: 2026-11-28*
