# Bug Report — Equitel Viajes

**Auditado:** 2026-04-13 · **Re-auditoría profunda:** 2026-04-18 · **Re-verificación:** 2026-04-20 · **Fix #A15/A19/A27:** 2026-04-20 · **Quick wins menores:** 2026-04-20

---

## ESTADO ACTUAL AL 2026-04-20

Verificación línea por línea contra el código actual (post commits de HMAC, rol SUPERADMIN, Fase A/B/C de columnas, íconos ⭐ 👥, fecha creación visible).

### Resumen numérico

| Categoría | Total original | Corregidos | Pendientes |
|---|---|---|---|
| 🔴 Bloqueantes | 5 | **5** ✅ | 0 |
| 🟠 Importantes | 21 | **20** ✅ | 1 (por decisión de negocio) |
| 🟡 Menores | 10 | **4** ✅ | 6 (descartados por bajo ROI) |

**Estado global: sin bloqueantes. Solo #A18 pendiente por decisión del usuario. Menores cubiertos o descartados.**

---

## 🔴 BLOQUEANTES — TODOS CORREGIDOS

- [x] **#A1 — Formula injection en Sheets** · `safeSheetValue_` prefija `'` cuando input empieza por `= + - @`
- [x] **#A2 — sendEmailRich CC→TO fallback** · Aborta si TO vacío, no promueve CC
- [x] **#A3 — fetchRequests polling race** · Guard `mounted` + comparación antes de setState
- [x] **#A4 — policyViolation timezone** · Usa `parseDate` de dateUtils
- [x] **#A5 — Approval links sin firma HMAC** ← **FIX APLICADO (commit reciente)**
      Implementado `_verifyApprovalLinkSig_` con HMAC-SHA256 + secret en ScriptProperty.
      Links nuevos firmados con `t` + `sig`. Cutover **per-request** (`APPROVAL_LINK_HMAC_CUTOVER_AT`):
      links legacy se aceptan solo si la solicitud entró a su etapa ANTES del cutover — evita
      invalidar correos en vuelo. Aplicado en processApprovalFromEmail, processStudyDecision,
      processUserConsultResponse.

---

## 🟠 IMPORTANTES — CORREGIDOS (17/21)

- [x] **#A6** — MIME reject estricto en validateFileUpload_
- [x] **#A7** — anularSolicitud valida estado previo (no permite terminal)
- [x] **#A8** — closeRequest solo desde RESERVADO o APROBADO
- [x] **#A9** — OptionUploadModal límite 10MB frontend
- [x] **#A10** — ConfirmationDialog click-outside = onCancel/no-op
- [x] **#A11** — Enter en input VARIOS no envía form
- [x] **#A12 — PIN admin rate-limit per-email** ← FIX APLICADO
      `_adminPinLockKey_(email)` con hashEmail por admin. Lockout no afecta a otros.
- [x] **#A13 — requestUserPin rate-limit regeneración** ← FIX APLICADO
      `_isRegenRateLimited_` + `_recordPinRegen_` · máx 3/hora, ventana rolling.
- [x] **#A14 — createRequest rate-limit** ← FIX APLICADO
      `_isCreateRequestRateLimited_` · máx 10/día por solicitante. Solo cuenta tras éxito.
- [x] **#A16 — Reminders sin cooldown** ← FIX APLICADO (aproximación distinta)
      No se hizo cooldown por correo, se implementó **escalación automática a superadmins**
      después de 30h laborales (~3 días hábiles) sin respuesta. Marca `remindersEscalatedAt`
      en EVENTOS_JSON → detiene recordatorios a aprobadores morosos.
- [x] **#A17 — deleteDriveFile ownership** ← FIX APLICADO
      Valida que el archivo viva bajo ROOT_DRIVE_FOLDER_ID (directo o en subcarpeta).
      Rechaza con log si está fuera.
- [x] **#A20 — viewAsRequester no rechequea SUPERADMIN** ← FIX APLICADO
      `_isAdminLike = role === ANALYST || role === SUPERADMIN` en App.tsx:457.
- [x] **#A22 — uploadOptionImage MIME frontend** ← FIX APLICADO
      OptionUploadModal.tsx:90 `if (file.type && !file.type.startsWith('image/'))` rechaza.
- [x] **#A23 — requestModification valida estado padre** ← FIX APLICADO
      Guard `_forbiddenParents = ['ANULADO','DENEGADO','PROCESADO']` lanza antes de crear hija.
- [x] **#A24 — Timezone unificado** ← FIX APLICADO
      processApprovalFromEmail: `Utilities.formatDate(now, 'America/Bogota', "d/M/yyyy H:mm")`
      (igual que skipSelectionStage).
- [x] **#A25 — ConfirmationDialog ESC key** ← FIX APLICADO
      Handler `window.addEventListener('keydown', ...)` que cierra con ESC siguiendo la misma
      semántica que click-outside (#A10).
- [x] **#A26 — AdminDashboard sin paginación** ← FIX APLICADO
      PAGE_SIZE=50 + controles Anterior/Siguiente. UserDashboard también paginado.

---

## 🟠 IMPORTANTES — CORREGIDOS RECIENTEMENTE (2026-04-20)

- [x] **#A15 — Session TTL cleanup automático** ← FIX APLICADO
      `cleanupExpiredSessions()` ahora delega a `cleanupExpiredPropsWeekly()` que limpia:
      - `SESSION_*` expiradas
      - `*_PIN_LOCKOUT_*` vencidos
      - `PIN_REGEN_*` con ventana expirada
      - `CREATE_REQ_*` con ventana expirada
      - Properties JSON corruptas
      NO toca `*_PIN_FAILS_*` activos (no resetear rate-limit mid-attack) ni config base.
      El trigger existente en producción (cleanupExpiredSessions diario a 1-2 AM) ahora
      limpia todo el scope sin necesidad de re-configurar el trigger. Se incluye también
      `setupWeeklyCleanupTrigger()` / `deleteWeeklyCleanupTrigger()` para casos donde
      se prefiera instalación semanal dedicada.

- [x] **#A19 — Token localStorage validación estricta** ← FIX APLICADO
      `readStoredSession` ahora valida shape exacta contra el formato del backend:
      - `email` regex RFC-like
      - `token` regex `/^[a-f0-9]{64}$/` (dos UUIDs concatenados sin guiones)
      - `expiresAt` typeof number finito y futuro
      - `role` enum cerrado `['REQUESTER','ANALYST','SUPERADMIN']`
      Cualquier falla → clearStoredSession() + re-login con PIN (sin afectar rate-limit).
      PIN system 100% intacto. Cero riesgo de lockout.

- [x] **#A27 — creditCard validación de longitud** ← FIX APLICADO
      `registerReservation` y `amendReservation` ahora validan `creditCard.length > 100`.
      `amendReservation` además valida `newPnr.length > 100` (faltaba).

## 🟠 IMPORTANTES — PENDIENTE (1, por decisión de negocio)

- [ ] **#A18 — Archivos de reserva ANYONE_WITH_LINK**
      PNR, imágenes de confirmación quedan accesibles con el link. Considerar
      DOMAIN_WITH_LINK (solo equitel.com.co).
      **IMPACTO**: Bajo — el link solo se envía al solicitante/admin por correo. Para leak
      se necesita reenvío accidental del link.
      **DECISIÓN DEL USUARIO** (2026-04-20): NO cambiar. Mantener ANYONE_WITH_LINK.
      Se requiere para que proveedores externos/pasajeros externos accedan al PNR.

---

## 🟡 MENORES — CORREGIDOS RECIENTEMENTE (4 — commit 22295fa)

- [x] **#A21** — RequestForm preserva name+email manual al cambiar cédula de pasajeros 2-5
- [x] **#A28** — `enhanceTextWithGemini` límite 5000 chars antes de invocar Gemini
- [x] **#A31** — `diagnosticarAprobacion` enmascara correos en logs (PII safe)
- [x] **#A34** — `removePassenger` pide confirmación si la fila tiene datos
- [x] **#A36** — Ya estaba aplicado (`min="1"` en input de noches, línea 946)

## 🟡 MENORES — DESCARTADOS POR BAJO ROI (6, todos aceptables)

- [ ] **#A29** GEMINI_API_KEY.includes('test') check frágil — la key real no contiene "test", escenario improbable
- [ ] **#A30** Hardcoded URL defaults — el proyecto no es un fork, defaults funcionales
- [ ] **#A32** renderMessagePage patrón HTML mixto — refactor amplio por beneficio mínimo
- [ ] **#A33** Upload state cleanup al cerrar modal mid-request — solo warning React, no user-visible
- [ ] **#A35** manualNights preferencia perdida al cambiar tripType — UX menor, <1% de casos
- [ ] **#A37** getViewerUrl/getDriveImageUrl sin encodeURIComponent — **no-op en práctica** (Drive IDs ya son URL-safe: letras, dígitos, `-`, `_`)

---

## 🆕 MEJORAS AGREGADAS DESDE LA AUDITORÍA (no estaban en el report)

- **Fase A/B/C columnas**: backup visible + validarColumnasActivas + bloqueo primer pasajero no registrado
- **Íconos ⭐ 👥**: detección de prioritario (por pasajero) y proxy (por cédula contra directorio)
- **Fecha de creación visible**: admin/user dashboard + RequestDetail con parser tolerante DD/MM/YYYY
- **Saltar aprobación (superadmin)**: pasa PENDIENTE_APROBACION → APROBADO con justificación
- **Saltar selección**: Wendy/superadmin puede avanzar cuando compra se gestionó fuera
- **Skip notificación reserva**: checkbox en ReservationModal con doble confirmación
- **DEFENSA CEO/CDS**: si status=APROBADO pero columna ejecutiva vacía, forzar APPROVED en mapper
- **Cache email→cédula por-ejecución**: minimiza reads del sheet cuando mapRowToRequest corre N veces

---

## ✅ CONFIRMADO CORRECTO (sin cambios)

- sessionExemptActions / adminOnlyActions / superAdminOnlyActions segmentación correcta
- setScriptProperty / listScriptProperties / diagnosticarAprobacion NO expuestos vía dispatch
- validateUserSession_ valida email-token binding
- _requireAnalyst_ en todas usuarios_/nbs_/mobileAdmin_
- cancelOwnRequest verifica ownership
- LockService cubre writeActions
- No dangerouslySetInnerHTML en todo el frontend
- React escapa en renders; escapeHtml_ en templates de correo
- checkIsAnalyst distingue error de red vs "no es admin"
- SUPERADMIN ⊇ ANALYST · revocación en caliente · fail-closed sin SUPER_ADMIN_EMAILS
- skipSelectionStage y skipApprovalStage triple validación (dispatch + backend + status + justificación)

---

---

# 🔍 AUDITORÍA FINAL EXHAUSTIVA — 2026-04-20

3 auditores especializados (backend, frontend, integración) en paralelo. Hallazgos filtrados
contra el código actual, descartando falsos positivos. Solo reporto lo que validé manualmente
contra el código.

## 🔴 Nuevos bloqueantes detectados (2)

### **#A38 — requestModification sin validación de ownership**
**Ubicación:** [server/Code.gs:1519](server/Code.gs#L1519) `requestModification()`

**El bug:** Un usuario autenticado puede llamar `requestModification(originalRequestId, ...)` con
el ID de **cualquier solicitud** — no valida que el `originalRequestId` pertenezca al usuario
que llama. Solo verifica que el ID exista y que el estado no sea terminal.

**Escalamiento de privilegios real:** Usuario A (autenticado válidamente) puede:
1. Adivinar o enumerar IDs (son secuenciales: SOL-000001, SOL-000002...)
2. Llamar `requestModification('SOL-000050', {datos falsos})` sobre solicitud de Usuario B
3. Crea una hija PENDIENTE_ANALISIS_CAMBIO que el analista verá y gestionará, pensando que
   Usuario B solicitó el cambio.

**Impacto:** Alta. Un usuario interno malicioso puede forzar modificaciones falsas a viajes
ajenos. Observación escrita en padre menciona el ID hija — confuso para el analista.

**FIX sugerido:** ~5 líneas agregar validación:
```javascript
const requesterOnParent = String(sheet.getRange(rowNumber, H("CORREO ENCUESTADO") + 1).getValue()).toLowerCase().trim();
if (requesterOnParent !== String(currentUserEmail).toLowerCase().trim()) {
  throw new Error("No puede modificar una solicitud que no le pertenece.");
}
```
Requiere pasar `currentUserEmail` desde dispatch (hoy no se pasa).

### **#A39 — Payload JSON sin límite de tamaño en doPost**
**Ubicación:** [server/Code.gs:398](server/Code.gs#L398) `doPost()`

**El bug:** `JSON.parse(e.postData.contents)` sin validar length. GAS permite hasta ~50MB.
Un atacante autenticado puede enviar JSONs gigantes (millones de passengers duplicados, archivos
base64 de 50MB).

**Impacto:** DoS por consumo de cuota de Apps Script (6h/día en Workspace), timeout de request,
bloqueo temporal del backend para otros usuarios.

**FIX sugerido:** 3 líneas al inicio de doPost:
```javascript
if (e.postData.contents.length > 10 * 1024 * 1024) {  // 10 MB
  return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Payload demasiado grande.' }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## 🟠 Importantes nuevos (5)

### **#A40 — Modales cerrables durante upload mid-transaction**
**Ubicación:** OptionUploadModal.tsx, ReservationModal.tsx, SupportUploadModal.tsx

Click-outside u onClose durante upload secuencial deja archivos huérfanos en Drive sin
referencia en SOPORTES/OPCIONES JSON. **FIX:** `if (loading || uploading) return;` en onClose.

### **#A41 — Double-click en botones críticos (skip approval, skip selection, aprobar)**
**Ubicación:** RequestDetail.tsx modal de confirmación, CostConfirmationModal

Entre click y `setLoading(true)` hay un frame donde doble click genera 2 llamadas. Backend
maneja idempotencia parcialmente (por status check) pero puede duplicar entries en OBSERVACIONES.
**FIX:** `useRef` con flag procesado antes de setLoading.

### **#A42 — Missing event recording en flujos de cancelación/enmienda**
**Ubicación:** cancelOwnRequest, anularSolicitud, amendReservation en Code.gs

Ninguno llama `_recordEvent_`. Métricas de ciclo incompletas — el dashboard no sabe cuántas
solicitudes fueron canceladas, cuándo ni por quién. **FIX:** 1 línea por función con
`_recordEvent_(id, 'cancelled', {actor})`.

### **#A43 — anularSolicitud permite anular padre con hija PENDIENTE_ANALISIS_CAMBIO activa**
**Ubicación:** [server/Code.gs:5913](server/Code.gs#L5913) y cancelOwnRequest

La hija queda huérfana apuntando a padre ANULADO. `processChangeDecision` seguiría funcionando
pero `relatedRequestId` es inválido.

**FIX:** ~10 líneas — antes de anular, chequear si existe hija no-terminal y rechazar.

### **#A44 — approverPerformance división por cero en métricas**
**Ubicación:** [server/Code.gs:~8672](server/Code.gs) `_aggregateMetrics_`

`Math.round(a.total / a.count)` sin guard. Si `a.count === 0` retorna Infinity → dashboard
muestra "Infinity" como promedio. **FIX:** 1 línea `a.count > 0 ? ... : null`.

## 🟡 Menores nuevos (4)

- **#A45** — `_recordEvent_` approvals persiste emails (PII) en EVENTOS_JSON. Logs internos OK pero export a reportes sin mask.
- **#A46** — USER_CONSULT_MARKER sin cleanup automático tras 30 días de inactividad. Padre queda con recordatorios pausados indefinidamente si usuario nunca responde.
- **#A47** — `skipNotification=true` en carga de opciones no genera evento propio (solo nota en OBSERVACIONES). Métricas no distinguen entre opciones normales vs aceleradas.
- **#A48** — PinEntryModal permite paste del PIN. Bajo riesgo (solo si clipboard está comprometido por malware), es defense-in-depth.

## Falsos positivos descartados

Los auditores reportaron varios items que verifiqué manualmente y **no son bugs**:

- ❌ "getAllRequests leak" — dispatch YA filtra por `isUserAnalyst`, usuarios normales obtienen solo sus propias.
- ❌ "Race condition en ID creation" — `isWriteAction` incluye createRequest, lock se toma en dispatch ANTES de createNewRequest.
- ❌ "HTML injection en renderMessagePage" — todos los callers pasan texto pre-escapado o ID/status; validé cada uno.
- ❌ "validateUserEmail_ case mismatch" — hace `.toLowerCase().trim()` en ambos lados.
- ❌ "Stored XSS en OBSERVACIONES" — React escapa en render, escapeHtml_ en correos.
- ❌ "Session TTL mismatch" — frontend lee `expiresAt` del token, backend valida expiración.
- ❌ "requestMode init en modificaciones" — payload lo incluye correctamente.
- ❌ "Infinite change loop" — teórico, el status PENDING_CHANGE_APPROVAL bloquea nueva modificación sobre hija activa.

## ✅ HALLAZGOS DE LA AUDITORÍA FINAL — TODOS CORREGIDOS (2026-04-20)

- [x] **#A38** — ownership en requestModification (commit de cierre)
- [x] **#A39** — límite 30MB en payload doPost
- [x] **#A44** — guard `count > 0` en approverPerformance
- [x] **#A43** — `_parentHasActiveChild_` bloquea anular padre con hija activa
- [x] **#A42** — `_recordEvent_` en cancelOwnRequest, anularSolicitud, amendReservation
- [x] **#A40** — `handleClose` guard en OptionUploadModal, ReservationModal, SupportUploadModal durante loading/uploading
- [x] **#A41** — useRef double-click guard en RequestDetail (skip) y CostConfirmationModal (executeSubmission)

---

## 🏁 ESTADO FINAL

| Categoría | Total | Corregidos | Cerrados por decisión | Descartados |
|---|---|---|---|---|
| 🔴 Bloqueantes | 7 | 7 | 0 | 0 |
| 🟠 Importantes | 26 | 25 | 1 (#A18) | 0 |
| 🟡 Menores | 14 | 4 | 0 | 10 |

**La app queda lista para versión casi-final.** Sin bloqueantes ni críticos pendientes.
Los 🟡 restantes son cosméticos o defense-in-depth que no justifican esfuerzo.

---

# 🔥 BUG CRÍTICO EN PRODUCCIÓN — 2026-04-24

## **#A49 — Silencio criminal en fetches de bootstrap (resuelto)**

### Síntoma reportado
Dos usuarios (Alejandra Bejarano, Andrés Camilo Rocha) vieron el banner rojo **"⚠️ Cédula no encontrada en el directorio"** aunque sus cédulas **sí estaban** correctamente registradas en la hoja USUARIOS. Sin forma de distinguir el error real de un problema de carga.

### Causa raíz
`gasService.getIntegrantesData()` devolvía `response.data || []` silenciosamente. Cualquier fallo transient (cold start de GAS, hipo de red, token stale, excepción en runtime) se convertía en un array vacío → `integrantes.some(...)` siempre false → el form marcaba **cualquier cédula** como "no encontrada". Este patrón estaba replicado en 6 endpoints más (`getCostCenterData`, `getCitiesList`, `getCoApproverRules`, `getExecutiveEmails`, `getCreditCards`, `getSites`) — cualquiera de ellos podía dejar la UI rota e invisible.

Además, el flag `USE_USUARIOS_SHEET` (Script Property con default `'false'`) seguía controlando qué hoja leer, pese a que la hoja `INTEGRANTES` fue **eliminada de producción el 2026-04-24**. Un flipe accidental del flag rompería login, PIN y directorio para todos.

### Fix aplicado (commit pendiente de envío)

**Frontend (`services/gasService.ts`):**
- Nuevo helper `_bootstrapFetch<T>(action, humanName, payload, expectArray)` con reintento 800 ms + throw.
- Aplicado a los 7 endpoints bootstrap críticos. Los endpoints de polling (`getMyRequests`, `getAllRequests`, `getCurrentUser`) NO se tocaron — su silencio está bien porque se auto-recuperan.

**Frontend (`App.tsx`, `RequestForm.tsx`, `ModificationForm.tsx`, `ReservationModal.tsx`):**
- Callers capturan el throw y muestran alert legible: _"No se pudo cargar X. Recargue la página con Ctrl+Shift+R…"_
- En `RequestForm` además: si `integrantes.length === 0`, el banner del pasajero muestra mensaje ámbar distintivo ("No se pudo cargar el directorio") en lugar del rojo ("Cédula no encontrada").

**Backend (`server/Code.gs`):**
- Constante `USE_USUARIOS_SHEET` hardcodeada a `true`. Ninguna configuración accidental del Script Property puede romper el runtime.
- `getIntegrantesData` lanza error explícito si USUARIOS viene vacío (en vez de retornar `[]` silencioso).

**Types (`types.ts`):**
- `ApiResponse<T>` extendido con `code?: string` para el check de `SESSION_EXPIRED`.

### Verificado
- `npx tsc --noEmit` limpio.
- `npm run build` OK (395.62 kB → 109.61 kB gzip).
- Todos los callers grepeados y actualizados.
- Review de seguridad: cero vulnerabilidades introducidas.

---

# 🧹 LIMPIEZA DE CÓDIGO PENDIENTE (no crítico, posterior)

## **#A50 — Eliminar cableado legacy de INTEGRANTES**

Tras el hardcode de `USE_USUARIOS_SHEET = true`, los siguientes elementos quedan como dead code o funciones conservadas por compatibilidad. Eliminarlas en una limpieza futura:

**server/Code.gs:**
- Función `_getIntegrantesDataFromIntegrantes_()` — nunca se llama desde ningún flujo runtime.
- Constante `SHEET_NAME_INTEGRANTES` — solo usada por la función dead code anterior y por paths que ya no se ejecutan (ramas `!USE_USUARIOS_SHEET` en `validateUserEmail_`, `_getActiveUserSheet_`, `_getRequesterCedulaMap_`).
- Ramas `else` de los branches del flag en: `validateUserEmail_` (línea ~608), `_getActiveUserSheet_` (~1099), `setUserPinHash_` (~1115), `_getRequesterCedulaMap_` (~4702, 4717).
- Función `toggleUsuariosMode()` (línea ~9181) — conservada por compatibilidad con triggers pero sin efecto real.
- Menú "Modo activo" en `onOpen` — mismo caso.
- Item de menú "Crear hoja USUARIOS" y "Migrar desde INTEGRANTES" (líneas ~6440-6460) — migración ya completa.

**server/Code.gs — constante del flag:**
- `const USE_USUARIOS_SHEET = true;` — eventualmente reemplazar todos los usos por directamente `SHEET_NAME_USUARIOS` y eliminar la constante.

**Script Properties:**
- `USE_USUARIOS_SHEET` — se puede borrar del entorno; no afecta. Documentar en guía admin.

**Riesgo**: muy bajo (dead code). Se recomienda hacerlo en un solo commit separado con validación manual en localhost antes de deploy.

## **#A51 — TTL fallback inconsistente en App.tsx**

En `App.tsx` líneas 319 y 398, el fallback de `expiresAt` cuando el backend no lo retorna es `Date.now() + 30 * 24 * 60 * 60 * 1000` (30 días). El TTL real del backend es **7 días** (`SESSION_TTL_MS`). Pre-existente, no relacionado con el bug de #A49.

**Impacto**: mínimo. El backend siempre retorna `expiresAt`, el fallback casi nunca se usa. Pero si llegara a usarse, el frontend pensaría que la sesión dura más de lo real → validateSession fallaría inesperadamente antes del expires estimado.

**Fix**: cambiar a `7 * 24 * 60 * 60 * 1000` en ambas líneas. 30 segundos de cambio.

## **#A52 — Endpoints de polling siguen silenciando errores**

`getMyRequests`, `getAllRequests`, `getCurrentUser` siguen con `response.data || []`. Intencional: son polling, se auto-recuperan con el siguiente ciclo. Pero si el usuario queda muchos minutos con la app abierta y GAS está caído persistentemente, la UI muestra lista vacía sin explicación.

**Fix sugerido**: al detectar N fallos consecutivos de polling, mostrar un banner informativo sutil (distinto del banner de conectividad, que ya existe para transport errors). Bajo ROI — el banner de conectividad probablemente ya se dispara en esos casos.

---

# 🐛 BUG DE PRODUCCIÓN — 2026-05-27

## **#A53 — Botón APROBAR no abre en Chrome móvil Android (multi-cuenta Google)**

### Síntoma reportado

Un aprobador (rol `BUDGET_OVERRUN`) reporta que al tocar el botón **APROBAR** en el correo de aprobación desde su Android, Google muestra:

> **No se pudo abrir el archivo en este momento.**
> Verifica la dirección e inténtalo de nuevo.

Pestaña del navegador: "No se encontró la página — script.google.com".

El correo se renderiza bien (ve costos, ruta, banners, botones). El error ocurre solo al cargar la página de Apps Script tras tocar el botón. **En escritorio el mismo link funciona perfecto.** El aprobador confirma que estaba logueado en su Gmail al momento del intento.

### Diagnóstico

Se descartaron en orden:

1. ❌ **Acceso restringido al dominio** — el deployment estaba ya en "Cualquier usuario" (no era el problema).
2. ❌ **Firma HMAC inválida o expirada** — la firma se valida server-side, y la falla ocurría ANTES de que el server-side se ejecutara (Google rechazaba a nivel de routing).
3. ❌ **Sesión Google ausente** — el aprobador estaba logueado en Gmail. El problema no es estar logueado.
4. ✅ **Bug conocido de Chrome móvil Android con múltiples cuentas Google logueadas.**

### Causa raíz

Cuando un usuario tiene **varias cuentas Google logueadas en el teléfono** (típicamente personal + corporativa), Chrome móvil hace un redirect interno con `/u/N/` para identificar cuál cuenta usar al abrir script.google.com. Los **privacy features modernos de Chrome móvil bloquean una cookie crítica** durante ese redirect → Apps Script no puede cargar la página → error genérico "No se pudo abrir el archivo".

Bug del lado de Google/Chrome, no del lado de este proyecto. Documentado en:

- [Webapp (google script) in Android Chrome — Sorry, unable to open the file](https://support.google.com/sites/thread/81141635/)
- [Persistent error from Apps Script Web App — Google Drive Community](https://support.google.com/drive/thread/360136902/)
- [Issue Tracker — Multi-account App Script web app fails](https://issuetracker.google.com/issues/165350842)

### Fix aplicado

Cambiar la **Script Property `WEB_APP_URL`** del formato corto al formato Workspace-scoped (con el dominio explícito en la URL).

**Antes:**
```
https://script.google.com/macros/s/AKfycby<...>/exec
```

**Después:**
```
https://script.google.com/a/macros/equitel.com.co/s/AKfycby<...>/exec
```

Solo se inserta `a/macros/equitel.com.co/` entre `script.google.com/` y `s/AKfyc...`. **Es el mismo deployment** — Google lo enruta idéntico, solo que sin el redirect `/u/N/` que rompe Chrome móvil.

**Dónde:** Apps Script editor → ⚙️ Configuración del proyecto → Propiedades del script → editar o crear `WEB_APP_URL` con el valor nuevo. **No requiere cambio de código** (el default en `Code.gs:15` queda como fallback) y **no requiere redeploy**.

### Verificado

| Paso | Test | Resultado |
|---|---|---|
| 1 | URL transformada en desktop normal | ✅ "Decisión Previa Detectada" igual que con URL corta — confirma mismo deployment |
| 2 | URL transformada en desktop **incógnito** (sin sesión Google alguna) | ✅ Sirve la página igual — confirma que funciona sin ninguna sesión (`deployment="Anyone"`) |
| 3 | URL transformada en móvil con multi-cuenta | Por confirmar con aprobador en su próximo recordatorio automático (cada 2h en horario laboral) |

### Por qué es seguro

- Es el **MISMO deployment** (mismo ID `AKfycby...`), solo cambia el namespace de la URL.
- Desktop sigue funcionando igual (Google maneja ambos formatos transparente).
- Los links viejos ya emitidos en correos anteriores **siguen siendo válidos**.
- **Cero cambio de código** → cero riesgo de regresión.
- **Rollback en 30 segundos**: eliminar la Script Property → el default hardcoded en `Code.gs:15` (formato corto) vuelve a aplicar.

### Para verificación futura

Si vuelve a aparecer el síntoma "No se pudo abrir el archivo" en otro dispositivo móvil:

1. **No es un bug nuestro** — es del lado de Google.
2. Verificar que la Script Property `WEB_APP_URL` siga con el formato `/a/macros/equitel.com.co/`. Si alguien la cambió o borró, restaurarla.
3. Si el usuario reporta el problema con un dispositivo o navegador exótico (no Chrome Android), reproducir primero y confirmar que es el mismo síntoma exacto antes de asumir causa raíz.
4. Workaround manual para el usuario: pegar el link en una pestaña de Chrome desktop, o usar el portal de viajes para ver/actuar sobre solicitudes desde ahí.

### Referencias en el código

- [`server/Code.gs:15`](server/Code.gs#L15) — definición de `WEB_APP_URL` (lee Script Property, fallback a URL corta hardcoded).
- Funciones que generan links con `WEB_APP_URL`: `sendApprovalRequestEmail`, `sendReminderEmail`, `sendUserConsultEmail_`, `sendRequestEmailWithHtml`, `renderConfirmationPage`, `renderDenialReasonPage`.

---

# 🛠️ FIX EN PRODUCCIÓN — 2026-06-23 (commit `ef9958f`)

## **#A54 — Solicitudes con OT válida pedían aprobación de sobrecosto (Alejandro Gómez)**

### Síntoma reportado
Yurani (Dirección de Cadena de Suministro) reporta que solicitudes del área de Energía con una **Orden de Trabajo (OT) válida** vinculada estaban pidiendo la aprobación adicional de **Alejandro Gómez de Greiff** (rol `BUDGET_OVERRUN`) y mostrando el banner "💰 PRESUPUESTO DE UNIDAD EXCEDIDO" al usuario. Caso concreto: **SOL-000246** (Cumandes · ENERGIA PROYECTOS · OT `OT-CUBTA-110256` · internacional BOG→UIO).

### Causa raíz
Una solicitud con OT válida carga su costo a la orden de trabajo, **no al presupuesto de la unidad** — y el cálculo de ejecutado ([`_calcularEjecutadoPeriodo_`](server/Code.gs)) ya **excluía** las OTs válidas vía `_esOTValida_`. Pero al confirmar costos, `updateRequestStatus` marcaba `REQUIERE APROB PPTO = "SI"` con base en `_chk.exceedsBudget`, que es `executedPeriod + costoDeEstaSolicitud > presupuesto`. Si el área ya estaba excedida **por otras solicitudes**, la solicitud con OT igual quedaba marcada — aunque su costo no afecte el presupuesto.

### Fix aplicado
Helper canónico **`_requiresBudgetOverrun_(flag, workOrder)`** (junto a `_esOTValida_`): solo `true` si el flag es `SI` **y** la OT no es válida.
- **Lectura (compute-on-read, corrige también lo ya marcado sin reescribir el sheet):** `mapRowToRequest`, `processApprovalFromEmail` (verificación de completitud) y `sendPendingApprovalReminders` (planificación de recordatorios).
- **Escritura:** `updateRequestStatus` no marca `SI` para OT y **limpia** un `SI` previo (normaliza el sheet).
- **Frontend:** sin cambios — el banner y la fila de estado dependen de `requiresBudgetOverrunApproval`, ya corregido en la lectura.

**Efecto:** OT válida → nunca requiere ni muestra aprobación de presupuesto. Sin OT → comportamiento idéntico. El mecanismo de envío de correos no se tocó; solo se excluye al aprobador de presupuesto para OTs.

**Mitigación del caso existente:** al desplegar, la solicitud OT deja de requerir presupuesto automáticamente (compute-on-read). Para SOL-000246 (internacional, sin aprobaciones aún) avanza sola cuando CEO/CDS/Área aprueben, sin Alejandro.

## **#A55 — Aprobador "congelado": no se reevaluaba al cambiar en USUARIOS**

### Síntoma
El aprobador se resuelve una sola vez al crear la solicitud (primer pasajero → hoja USUARIOS) y se congela en las columnas `(AUTOMÁTICO)`. Si luego cambia el aprobador del usuario en USUARIOS (cambio organizacional), las solicitudes ya creadas y aún no aprobadas seguían apuntando al aprobador viejo, sin forma de actualizarlas salvo gestión manual.

### Fix aplicado
- **`_resolveApproverForFirstPassenger_`**: fuente única de "quién aprueba" (área + co-aprobadores internacionales), extraída de `createNewRequest` y reutilizada por ambos flujos.
- **`reevaluarAprobadoresPendientes()`** (manual, Sheet-side): recorre solicitudes en `PENDIENTE_OPCIONES / SELECCION / CONFIRMACION_COSTO / APROBACION`; reasigna el aprobador de área si cambió en USUARIOS; anota en `OBSERVACIONES`; para las `PENDIENTE_APROBACION` reenvía el correo **solo al nuevo aprobador**. No toca solicitudes aprobadas/terminales ni las que ya tienen voto de área (trazabilidad). Bajo `LockService`.
- **Exposición:** ítem en el menú "Equitel Viajes" del Sheet + botón "Reevaluar solicitudes pendientes" en el tab "Reemplazar" del sidebar. **No** se expone al endpoint web público (cero superficie de ataque nueva).

## **#A56 — Hardening: links de aprobación huérfanos tras reasignación**

### Causa
En `processApprovalFromEmail` (rama NORMAL/área), si el `actor` del link no coincidía con el aprobador esperado, el voto se **atribuía** al aprobador esperado en vez de rechazarse. Tras una reasignación (#A55), el aprobador **viejo** podía aprobar con su link viejo y quedar registrado como el **nuevo**.

### Fix aplicado (puramente aditivo)
Antes de la lógica original (intacta), se **rechaza** el link cuando el `actor` no está entre los aprobadores vigentes de la columna (maneja co-aprobadores; links legacy sin `actor` no se rechazan). Devuelve la página "Enlace ya no válido". Las aprobaciones legítimas quedan byte-idénticas; el rechazo está inerte hasta que exista una reasignación.

### Verificado
- `npx tsc --noEmit` limpio · sintaxis de `Code.gs` válida (`node --check`).
- Archivos: [`server/Code.gs`](server/Code.gs), [`server/AdminSidebar.html`](server/AdminSidebar.html). Sin cambios de frontend.
- Despliegue: subir Code.gs + AdminSidebar.html al editor de Apps Script (menú/sidebar activos al guardar) y **crear nueva versión** del web app (mismo deployment, conserva `WEB_APP_URL`) para que el fix de OT y la lógica de aprobación apliquen a los correos.
- Rollback: Gestionar implementaciones → versión anterior (~30 s, sin pérdida de datos).

### Nota de tooling (no relacionado con el fix)
`npm run build` fallaba en macOS por el binario nativo `@rollup/rollup-darwin-arm64` ausente en `node_modules` (el último `npm install` se hizo en Windows; `node_modules` no se versiona). El `package-lock.json` ya lista la dependencia opcional — basta `npm install` en el equipo Mac para instalar el binario. No requiere cambios versionados.

---

## **#A57 — Feature: reserva parcial "guardar sin enviar" + alerta de facturas al cerrar**

Origen: reunión con Yurani (2026-07-02), verificado contra la transcripción.

### A) Reserva parcial ("guardar sin enviar")
**Necesidad:** cuando una solicitud pide tiquete + hotel, Wendy compra el tiquete antes de tener la reserva del hotel. Antes, la única acción en APROBADO era "Registrar Reserva", que subía archivos, pasaba a RESERVADO y **enviaba el correo de una vez**. Yurani pidió poder cargar el tiquete, dejarlo en Drive **sin notificar**, y al llegar el hotel enviar **el paquete completo**.

**Decisión de diseño:** NO se creó un estado nuevo. Se reutilizó el patrón que ya existía en RESERVADO→PROCESADO (cargar archivos sin avanzar + finalizar), aplicado a APROBADO→RESERVADO. Una solicitud **APROBADO con archivos de reserva guardados = reserva parcial en curso** (sigue visible en panel/recordatorios porque APROBADO ya está en el bucket "por reservar").

**Backend ([`server/Code.gs`](server/Code.gs)):**
- **`_uploadReservationFilesToFolder_`** — helper (upload-only, tag `isReservation:true`), compartido por draft y finalize.
- **`saveReservationDraft(requestId, reservationNumber, files, creditCard, purchaseDate)`** — guard: estado DEBE ser APROBADO; sube archivos como reserva; guarda PNR/tarjeta/fecha si vienen; **no cambia estado, no envía correo**; nota `[RESERVA PARCIAL]` en OBSERVACIONES. Admin-only + `LockService` (en `dispatch`).
- **`registerReservation`** (finalize): permite `files` vacío si ya hay reservas parciales guardadas; construye el correo desde **todos** los archivos `isReservation` (drafts + nuevos); renombra las entradas "Reserva parcial" al PNR final; guarda contra `uploadedFiles` vacío.

**Frontend:**
- [`ReservationModal.tsx`](components/ReservationModal.tsx): `isEditMode = status===RESERVED` (antes por `reservationNumber`, que fallaba si un draft guardaba PNR). En APROBADO: **"Guardar sin enviar"** + **"Confirmar reserva y enviar"**; muestra los archivos ya guardados.
- [`AdminDashboard.tsx`](components/AdminDashboard.tsx): badge "Reserva parcial · falta completar" y botón "Completar Reserva" cuando APROBADO tiene archivos de reserva.
- [`RequestDetail.tsx`](components/RequestDetail.tsx): bloque de reserva parcial **solo admin** (el solicitante no ve la reserva hasta que esté completa).
- [`gasService.ts`](services/gasService.ts): `saveReservationDraft`.

### B) Alerta de facturas faltantes (con override) + concientización de carga manual
**Necesidad (David/Yurani, 00:11:24):** Wendy sube facturas a mano a Drive y **no quedan registradas en el app**; y a veces declara N totales de factura pero sube menos archivos. Se pidió **alertar** al marcar "Procesada" — **con override** (dos facturas pueden venir en un PDF).

**Backend:** **`closeRequestWithChecks(requestId, actorEmail, options)`** (extraído del case inline de `closeRequest`): cuenta facturas con valor declarado (`_csComputeRowExecuted_` breakdown) vs archivos de soporte no-reserva; si declaró > cargó y no viene `ackInvoiceMismatch`, retorna `{needsInvoiceAck}` **sin cerrar**; con el ack cierra y deja nota `[CIERRE]` en OBSERVACIONES. El chequeo es **opt-in** (`options.invoiceCheck===true`) para que un frontend viejo cierre como siempre (compatibilidad de despliegue). Envuelto en try/catch: un error interno nunca bloquea el cierre.

**Frontend:** [`SupportUploadModal.tsx`](components/SupportUploadModal.tsx) y [`AdminDashboard.tsx`](components/AdminDashboard.tsx) manejan `needsInvoiceAck` con diálogo de override; aviso permanente "los archivos subidos a mano a Drive no se registran"; `gasService.closeRequest(options?)` retorna la data.

### Auditoría (revisión adversarial)
Sin defectos altos ni regresiones a los flujos existentes. Corregido: correo mostraba "Reserva parcial" (ahora renombra al PNR); texto de la alerta más honesto (conteo de facturas vs archivos). Hardening de despliegue: chequeo de facturas **opt-in** → **cualquier orden de despliegue es seguro** (backend nuevo + frontend viejo cierra normalmente; frontend nuevo + backend viejo cierra sin chequeo y el botón de draft simplemente no está disponible hasta desplegar backend). Limitación conocida (intencional): la alerta es un recordatorio con override, no un control duro.

### Verificado
`node --check` (Code.gs) · `npx tsc --noEmit` · `npm run build` — todo limpio.

### Despliegue
- **Frontend:** push a `main` → redeploy automático a Cloud Run.
- **Backend:** subir [`server/Code.gs`](server/Code.gs) al editor de Apps Script y **crear nueva versión** del web app (conserva `WEB_APP_URL`). Sin migración de hoja ni columnas nuevas.
- Rollback: versión anterior del web app (~30 s) / revert del commit.

---

## **#A58 — Feature: comentario opcional del aprobador al aprobar (solicitud de Yurani)**
**Fecha:** 2026-07-27 · **Reportado por:** Yurani (chat sáb 19:32) · **Estado:** Implementado, pendiente de despliegue

**Necesidad:** Yurani aprobó un tiquete pero necesitaba dejar una salvedad ("solo comprar tiquete, el hotel no era necesario — se aloja en el apartamento") y no había dónde. Se pidió un campo de comentario **opcional** (nunca obligatorio) al aprobar, guardado por aprobador, visible para el área de viajes y el solicitante. La instrucción del aprobador **prima** sobre la selección del usuario.

### Diseño
- **Captura:** al hacer clic en APROBAR desde el correo, la página de confirmación ahora incluye un textarea opcional (`renderApprovalCommentPage`, espejo de la página de motivo de denegación). Mismo flujo de 2 pasos: un solo clic con el campo vacío aprueba idéntico a antes. Los recordatorios reutilizan los mismos links → obtienen la página nueva automáticamente.
- **Almacenamiento:** nueva columna **`COMENTARIOS APROBADORES (JSON)`** en "Nueva Base Solicitudes": `[{role, email, comment, at}]`, máx. 1 por rol (first-wins, igual que los votos). Se guarda dentro del `LockService` global, tras el guard `alreadyDecided`, en `processApprovalFromEmail` (`_appendApproverComment_`, todo en try/catch — jamás rompe una aprobación).
- **Visualización:** (1) correo "SOLICITUD APROBADA" — bloque ámbar prominente con rol + correo + comentario (`decisionNotification`); llega al usuario con CC al admin y pasajeros; (2) `ReservationModal` — banner ámbar antes de comprar (la fila lite ya trae el campo); (3) `RequestDetail` — comentario bajo la fila del rol en "Estado de Aprobaciones" (+ fallback para roles sin fila visible, ej. BUDGET_OVERRUN exento por OT); (4) `AdminDashboard` — pill "💬 Comentario aprobador" con tooltip en filas APROBADO.
- **Comentario tardío:** si un segundo ejecutivo aprueba con comentario cuando la solicitud YA avanzó (ej. ya RESERVADO), se envía aviso `[COMENTARIO TARDÍO DE APROBADOR]` al admin (hallazgo de auditoría — antes quedaba guardado en silencio).

### Hardening incluido (hallazgos de auditoría, corregidos)
- **`_safeDecode_` en motivo de denegación:** el `decodeURIComponent` legacy doble-decodificaba y un motivo con `%` literal (ej. "excede el 10%") lanzaba URIError **después** de registrar el voto pero **antes** de pasar a DENEGADO → solicitud varada con link muerto. Ahora nunca lanza.
- **`_jsUrlParam_`:** `encodeURIComponent` no escapa `'` — valores interpolados en strings JS de las páginas HtmlService (aprobación **y** denegación) ahora reemplazan `'`→`%27` (cierra vector de inyección, comportamiento idéntico para valores legítimos).
- **Migración robusta:** `agregarColumnaComentariosAprobadores()` (idempotente, UI-free + wrapper de menú) auto-repara headers con espacios no-canónicos e inserta columna si el grid está recortado. **NO usar `setupDatabase()`** (recrearía INTEGRANTES, eliminada en producción).

### Seguridad
El comentario viaja sin firmar (mismo modelo que el `reason` de denegación: el link HMAC es la credencial); `escapeHtml_` en correos y escape nativo de React en la app; el JSON en celda empieza con `[` → sin formula injection; cap 500 chars (página) / 1000 (servidor).

### Deploy-safety (cualquier orden es seguro)
Guard `H() === -1`: backend nuevo sin columna → aprueba idéntico a hoy (comentario descartado con warning). Backend viejo ignora la columna extra. Frontend con optional chaining → seguro con backend viejo.

### Verificado
`node --check` (Code.gs) · `npx tsc --noEmit` · `npm run build` — limpio. Auditoría adversarial: 0 críticos/altos; 1 medio + 2 bajos corregidos (arriba).

### Despliegue
1. Push a `main` → Cloud Run (frontend).
2. Apps Script: pegar `Code.gs` y **Guardar** (el web app sigue en la versión vieja).
3. Ejecutar **`agregarColumnaComentariosAprobadores()`** una vez (editor o menú "Equitel Viajes → Agregar columna Comentarios Aprobadores").
4. Crear **nueva versión** del web app (mismo `WEB_APP_URL`).
5. No correr "Reorganizar Base Principal" entre los pasos 2-4.

---

## **#A59 — Feature: Viaje Multidestino (caso Simón García / solicitud de Yurani)**
**Fecha:** 2026-07-30 · **Reportado por:** Yurani (correo 28-jul, fwd de Simón García) · **Estado:** Implementado, pendiente de despliegue

**Necesidad:** Simón García necesitaba un itinerario de 3 tramos (Medellín→Panamá 11/08 + hotel, Panamá→Miami 13/08, Miami→Medellín 16/08) y lo pidió por correo porque la app no tenía opción multidestino — exactamente el bypass que queremos eliminar.

### Diseño (frontend-only, CERO cambios a Code.gs)
- Toggle **"🧭 Viaje multidestino"** en el formulario (solo creación de vuelos; oculto en modificación y solo-hospedaje). Permite hasta **5 tramos** (cap bajo el rate limit de 10 creaciones/día). Cada tramo: origen (pre-llenado = destino del anterior, **editable**), destino, fecha, hora y hotel propio con **sugerencia automática de noches** (días hasta el siguiente tramo).
- Al enviar se crean **N solicitudes estándar en secuencia** (`createRequest` existente, IDs consecutivos bajo lock del backend), cada una con nota single-line en observaciones: `[MULTIDESTINO] Tramo i/N · Itinerario: MEDELLIN→PANAMA (11/08) | ...`. La nota es **texto inerte** para el backend (validado: solo `USER_CONSULT_MARKER` se parsea) y viaja sola a correos/detalle/hoja.
- Cada tramo vive su **ciclo 100% normal** por separado: opciones, selección, aprobación, costos, PNR, facturas, modificación, anulación.
- **Internacional por tramo** (`legIntl`): el estado global pasa a "algún tramo internacional" (activa pasaportes/co-aprobadores/gating para todo el itinerario); cada payload lleva su valor propio. **Política por tramo** (`legPolicyViolations`): banner lista los tramos que violan; cada solicitud persiste su propio flag. Miami→Medellín queda internacional correctamente (origen O destino ≠ Colombia).
- **Fallo parcial**: snapshot congelado de {payload, email} por tramo (`pendingSubmissionRef`), progreso "Creando tramo i/N…", bookkeeping de IDs creados; al fallar → form bloqueado (fieldset) con "Reintentar tramos pendientes" (solo crea faltantes, numeración inmutable) y "Descartar tramos pendientes". Aviso explícito cuando el error es timeout/red ("el tramo PUDO haberse creado — verifique antes de reintentar").
- Validaciones por tramo insertadas en la secuencia existente: ciudades contra lista, fechas presentes y cronológicas, hotel (nombre + 1-100 noches), y **clamp pre-envío de observaciones** (nota + texto ≤ 2000, evita fallo a mitad de loop).
- Refactors conservadores (comportamiento idéntico): matemática de política → `computePolicyViolation` puro; resolución de CC/aprobador → `resolveSharedSubmitFields`; `getVariousCCFormatted` izado. Camino single-leg verificado **byte-idéntico** contra HEAD por el auditor.
- `RequestDetail`: +`whitespace-pre-line` en observaciones (los saltos de línea de todas las notas ahora se ven).

### Auditoría (adversarial, corregida)
- **HIGH**: ventana de doble-click durante el `await import` del generador de correos → dos loops concurrentes → duplicados. Fix: `setLoading(true)` síncrono antes del primer await (misma garantía del camino single-leg).
- **HIGH**: fallo en el tramo 1 (0 creados) dejaba el form editable con el snapshot armado → un reenvío replayaba data vieja saltándose validaciones. Fix: con 0 creados se descarta el snapshot (el próximo envío revalida y reconstruye); el toggle también limpia snapshot/error; banner diferenciado "No se pudieron crear" vs "Creación parcial".
- **LOW**: ID falsy del backend (respuesta vacía) rompía el skip del reintento → duplicado. Fix: ID falsy = error con aviso "pudo haberse creado".
- Verificado limpio: regresión single-leg/modificación/hotel-only, máquina de estados del toggle, pills bloqueados, fieldset (cubre botones de pasaporte; acciones fuera), pureza de updaters (StrictMode-safe), snapshot genuinamente congelado, regex de maybeCreated contra los mensajes reales de gasService, numeración consistente de tramos, EmailGenerator por tramo.

### Verificado
`npx tsc --noEmit` · `npm run build` — limpios. `git diff --stat`: **solo** `RequestForm.tsx` y `RequestDetail.tsx` (Code.gs intacto).

### Despliegue
**Solo frontend**: push a `main` → Cloud Run. **Sin pasos de Apps Script** (no hay versión nueva del web app, ni migración, ni columna). Rollback = revert del commit.

---

## **#A60 — CRÍTICO: "Editar Opciones" abría con galería vacía y podía borrar las opciones existentes al guardar**
**Fecha:** 2026-08-06 · **Reportado por:** David (galería en 0 con opciones ya cargadas, SOL-000420 y otras) · **Estado:** Corregido y desplegado (`4694a02`)

**Síntoma:** en solicitudes PENDIENTE_SELECCIÓN, el botón "Editar Opciones" de la fila del panel admin abría el modal con "GALERÍA DE OPCIONES (0)", aunque el detalle y el correo sí mostraban las opciones. Imposible corregir/eliminar opciones.

**Causa raíz:** NO fue un cambio reciente ni Google/Drive — las imágenes estaban intactas. La optimización "lite" (Etapa 1.2) hace que las filas del dashboard viajen sin `analystOptions` (el detalle hidrata el objeto completo vía `getRequestById` antes de abrirse), pero el botón de fila pasaba la fila lite **directo** a `OptionUploadModal`. Riesgo mayor: `executeSubmission` reescribe OPCIONES (JSON) con `confirmados-sobrevivientes + nuevos`; con confirmados=[] (lite), **guardar habría borrado las opciones existentes** de la solicitud.

### Fix (2 capas, frontend-only)
1. **AdminDashboard**: "Editar/Cargar Opciones" ahora hidrata la solicitud completa antes de abrir el modal (mismo patrón del detalle). Botón muestra "Cargando…", se deshabilita durante la carga, y si el fetch falla el modal NO se abre (alerta explícita, sin datos parciales).
2. **OptionUploadModal**: candado anti-sobrescritura estructural — si `status === PENDIENTE_SELECCIÓN` y la galería de confirmadas está vacía (estado imposible con datos completos), el guardado se bloquea con alerta, sin importar desde dónde se abrió el modal. Protege también contra futuros puntos de entrada con datos lite.

### Auditoría del resto de la superficie lite (pedida por David)
`mapRowToRequest(lite)` omite **únicamente** `analystOptions` — `selectedOption`, `supportData`, `approverComments`, pasajeros y todos los escalares se parsean idéntico (verificado en Code.gs). Consumidores revisados uno a uno: tabla admin y filtros (no usan opciones) ✓ · UserDashboard ✓ · RequestDetail (hidratado; si falla NO abre) ✓ · ReservationModal (lee approverComments, incluido en lite; escribe solo reserva) ✓ · CostConfirmationModal (escribe solo costos) ✓ · SupportUploadModal (lee supportData incluido en lite; sube archivo-por-archivo y el backend agrega server-side, sin round-trip de array) ✓ · CancellationModal admin/user ✓ · MetricsPanel (datos propios vía getMetrics) ✓. **OptionUploadModal era el único lector de `analystOptions` fuera del detalle → superficie cerrada.**

### Verificado
`npx tsc --noEmit` · `npm run build` — limpios. Cero cambios a Code.gs (no interfiere con la transición de administradora en curso).

## **#A61 — Letras de opciones duplicadas (SOL-000419: "B, C, C") y galería en desorden**
**Fecha:** 2026-08-06 · **Reportado por:** Wendy (chat: "las opciones me salen en desorden de alfabeto... me dicen la opción C pero hay dos") · **Estado:** Corregido

**Evidencia:** OPCIONES (JSON) de SOL-000419 contenía 3 archivos Drive distintos con ids `B`, `C`, `C` (dos "Opcion_C"). El solicitante "seleccionó la C" habiendo dos C distintas (JetSmart $557.939 vs Avianca $854.960).

**Causa raíz (pre-existente, NO relacionada con los cambios recientes):** `getNextLetter` asignaba la siguiente letra por CONTEO (`65 + cantidad de opciones`), no por letras usadas. Subir A, B, C → eliminar A → agregar una nueva: conteo = 2 → la nueva se llama "C" otra vez. Reproducible desde siempre, incluso quitando/re-agregando imágenes pendientes en la primera carga.

### Fix (frontend-only, 3 capas)
1. **Asignación**: siguiente letra = `MAX(letras usadas) + 1` por tipo, incluyendo pendientes y marcadas-para-borrar → letras monotónicas por solicitud; pueden quedar huecos (B, C, D sin A) pero jamás duplicados.
2. **Compuerta de guardado**: antes de confirmar, se valida que el set final (sobrevivientes + nuevas) no tenga letras repetidas por tipo — bloquea con alerta explicativa incluso con datos legacy ya duplicados o estados anómalos.
3. **Display**: galerías de RequestDetail y OptionUploadModal ordenadas alfabéticamente por letra (el array guarda orden de subida).

**Reparación de SOL-000419 (operativa):** con "Editar Opciones" (ya funcional por #A60), eliminar una de las dos C y re-subirla → entra como "D" (B, C, D). Confirmar con el solicitante por aerolínea/precio cuál "C" quiso antes de comprar.

**Límite conocido:** dos analistas editando la MISMA solicitud simultáneamente en dos navegadores podrían asignar la misma letra (el guardado es last-write-wins por diseño); escenario sin ocurrencia real con una sola analista operando. La compuerta de la capa 2 protege cada sesión contra su propio estado.

### Verificado
`npx tsc --noEmit` · `npm run build` — limpios. Cero cambios a Code.gs.

## **#A62 — Retirada de la integración con IA (botón "Mejorar con IA")**
**Fecha:** 2026-08-19 · **Estado:** Retirada · **Decisión:** David

**Diagnóstico:** al ejecutar `diagnosticarGemini()` desde el editor, los tres modelos fallaron con `Specified permissions are not sufficient to call UrlFetchApp.fetch. Required permissions: script.external_request`. Es decir: el proyecto NO tiene concedido el scope de llamadas HTTP salientes.

**Implicación:** el botón "Mejorar con IA" llevaba tiempo devolviendo el borrador **sin cambios y en silencio** (el `catch { return userDraft; }` original se tragaba la excepción de permisos). La retirada de Gemini 2.5 nunca llegó a ser la causa operativa — el problema era anterior y de permisos. Nadie lo reportó nunca en todo ese tiempo.

**Decisión:** retirar la función en vez de habilitarla. Recuperarla exigía modificar los scopes OAuth de un sistema en producción recién estabilizado (riesgo real para los triggers de recordatorios/backup, que corren con la autorización del dueño) a cambio de un botón opcional en un flujo secundario y sin uso demostrado.

**Alcance de la limpieza:**
- `server/Code.gs`: `enhanceTextWithGemini`, `case 'enhanceChangeText'` del dispatch, constantes `GEMINI_API_KEY`/`GEMINI_MODEL` y sus filas en `verPropiedadesDelScript`. **Tras esto no queda ni un solo uso de `UrlFetchApp` en el backend** — el sistema ya no necesita salida a internet.
- Frontend: botón + handler + estado en `RequestForm.tsx` y en el (muerto) `ModificationForm.tsx`; método `gasService.enhanceTextWithGemini`; paso 4 del `correo-introductorio.html`.
- Docs: `CLAUDE.md` (sección de retiro con el porqué y la ruta si algún día se reactiva), `README.md`.

**Verificado:** `npx tsc --noEmit` · `npm run build` · sintaxis de `Code.gs` — limpios. Diff contra la versión desplegada (`c05aa89`): **solo eliminaciones, todas de Gemini, cero líneas agregadas**; transición de administradora (ADMIN_EMAIL, whitelists, `MAIL_FROM_ALIAS`, `_sendMail_`, panel de transición) intacta línea por línea.

**Propiedad huérfana (opcional):** `GEMINI_API_KEY` sigue en Script Properties sin uso. Se puede borrar con `deleteScriptProperty('GEMINI_API_KEY')`.

## **#A63 — Dos solicitudes de cambio sobre la misma solicitud (SOL-000470 / SOL-000471)**
**Fecha:** 2026-08-24 · **Reportado por:** Laura (chat) vía David · **Estado:** Corregido

**Síntoma reportado:** de SOL-000464 salieron dos solicitudes de cambio (470 y 471); al anular una, apareció además SOL-000472 colgando de 471.

**Qué pasó realmente (evidencia de la hoja, no hipótesis):**
- `SOL-000470` (15:12:50) — TEXTO_CAMBIO: *"hay mejor opción el 31"*
- `SOL-000471` (15:14:49) — TEXTO_CAMBIO: *"hay mejor opción el 31 de agosto en avianca 5:15am categoria flex. el regreso en opción D categoria flex"*

**Los textos son distintos**: el segundo es el primero ampliado. No hubo duplicación automática — el usuario envió el formulario, quiso detallar más su justificación y lo volvió a enviar 2 minutos después. `SOL-000472` (15:34) es un tercer cambio legítimo del mismo usuario ("me quedo mal la hora de ida, es a las 5 am") sobre la que ya era la solicitud viva. Ambas las anuló él mismo ("la veo duplicada" / "ya quedo en la 471").

**Causa raíz (defecto de diseño, no regresión):** `requestModification` solo bloqueaba padres en estado terminal (ANULADO/DENEGADO/PROCESADO). **Nada impedía crear una segunda solicitud de cambio mientras la primera seguía viva.** `_parentHasActiveChild_` existía pero solo se usaba para bloquear la ANULACIÓN del padre, nunca la creación.

**Descartado explícitamente:** no tiene relación con el botón de IA (retirado el 19-ago, cinco días antes, y solo eliminaba un botón) ni con multidestino. El primer caso histórico es del **18 de abril de 2026**.

**Alcance histórico (barrido de las 474 solicitudes):** ocurrió **5 veces en 4 meses** — SOL-000053, 082, 174, 419 y 464. Todas cerradas salvo la de 464 (que ya quedó consistente: solo SOL-000471 viva). Cadenas hija-de-hija: 2 en total (SOL-000009→010 y 471→472).

### Fix (dos capas)
1. **Backend — guard duro** (`requestModification`): nuevo helper `_findActiveChildOfParent_` que devuelve la primera hija en estado NO terminal. Si existe, se rechaza el cambio con un mensaje que nombra el ID y el estado de la solicitud de cambio ya en curso y explica qué hacer. Corre bajo `LockService` (`requestModification` es acción de escritura), así que también cubre el doble-click real: el segundo envío ve la fila del primero.
   - Deliberadamente **más amplio** que `_parentHasActiveChild_` (#A43), que solo mira `PENDIENTE_ANALISIS_CAMBIO` porque responde otra pregunta ("¿puedo anular el padre?"). Ambos helpers conviven documentados.
2. **Frontend — confirmación explícita**: `gasService.requestModification` ahora devuelve el ID de la solicitud creada y `RequestForm` muestra *"Solicitud de cambio creada: SOL-XXXXXX"* con la instrucción de no enviar otra. Antes el formulario se cerraba en silencio y el usuario no tenía señal de que hubiera funcionado.

**No bloquea flujos legítimos:** si el cambio anterior fue DENEGADO o ANULADO, se puede pedir uno nuevo; si fue APROBADO, el padre queda ANULADO (ya bloqueado antes) y la hija —ahora la solicitud viva— sí admite cambios.

**Orden de despliegue seguro en ambos sentidos:** frontend nuevo + backend viejo → comportamiento actual con confirmación; backend nuevo + frontend viejo → el guard lanza y el `alert('Error: ...')` existente muestra el mensaje.

**Verificado:** `npx tsc --noEmit` · `npm run build` · sintaxis `Code.gs` — limpios. Diff en `Code.gs`: **51 líneas agregadas, 0 eliminadas**.

## **#A64 — El banner de presupuesto y la regla de aprobación medían ventanas distintas**
**Fecha:** 2026-08-31 · **Detectado durante:** análisis del caso SOL-000453 (JC Pineda / N. Tobón) · **Estado:** Corregido

**Problema:** la barra del formulario (`getMonthlyBudgetUsage`) calculaba sobre el **mes en curso**, mientras la regla que realmente marca `REQUIERE APROB PPTO` (`_calcularEjecutadoPeriodo_`) calculaba sobre el **periodo configurado** (`budgetPeriodMonths`, hoy **3** = trimestre). Dos medidas distintas, y el banner afirmaba categóricamente *"Esta solicitud requerirá la aprobación adicional de X"*.

Podían discrepar en ambas direcciones. La peligrosa: **mes holgado dentro de un trimestre agotado** → el usuario veía todo en verde y la aprobación le caía después. Agravante: el % del banner incluye la reserva del 10% (deterrente deliberado), así que el aviso de aprobación se derivaba de un número inflado.

**Caso real que lo expuso:** POTENCIA (GDM – P&M) marcaba **119,2% (agosto)** en el banner mientras el trimestre jul–sep iba en **99,9%** — margen real de $44.734.

### Cambio (decisión de David: "que no sea posible exceder el presupuesto en ningún mes")
1. **Regla (`_calcularEjecutadoPeriodo_`)**: ahora exige aprobación si se excede **el periodo configurado O el mes en curso** — la más estricta de las dos ventanas. Con `budgetPeriodMonths = 1` ambas coinciden y el comportamiento se reduce al de siempre. Devuelve `exceedsPeriod` / `exceedsMonth` y las cifras de ambas ventanas.
2. **Nota de auditoría** en OBSERVACIONES: dice **cuál** ventana se excedió, con presupuesto, ejecutado previo y proyectado de cada una.
3. **Banner (`getMonthlyBudgetUsage`)**: evalúa las dos ventanas en una sola pasada, muestra y **nombra la que realmente limita** (p. ej. *"Presupuesto julio–septiembre 2026"*), y expone `willRequireApproval` calculado **sin la reserva**, con el mismo criterio del backend.
4. **Frontend (`BudgetUsageBar`)**: el aviso de aprobación se rige por `willRequireApproval`; la barra y su color siguen usando el % con reserva (la presión visual se mantiene). Fallback a la lógica anterior si el backend es viejo.

**Impacto medido sobre datos reales (15 unidades con presupuesto 2026):** cambian **3** — ADM DESARROLLO HUMANO (142,7% mes / 47,6% trimestre), ENERGIA PROYECTOS (151,1% / 85,7%) y POTENCIA (109,2% / 99,9%, que iba a disparar igual en la siguiente solicitud). Las otras 12 no cambian. Es exactamente el agujero que se quería cerrar: unidades que reventaban su mes amparadas en la holgura del trimestre.

**Reversible sin código:** subir `budgetPeriodMonths` no relaja el mes; para volver al criterio anterior habría que revertir este commit. Bajarlo a 1 hace que ambas ventanas coincidan.

**Verificado:** `npx tsc --noEmit` · `npm run build` · sintaxis `Code.gs` — limpios. La réplica del cálculo reproduce el 119,2% del banner al decimal contra la hoja real.

## **#A65 — El panel de analista se encogía a 1280px y cortaba la tabla y los filtros**
**Fecha:** 2026-09-05 · **Reportado por:** David · **Estado:** Corregido

**Síntoma:** en el panel de analista la lista se extendía más allá de su recuadro y se cortaba. La tabla tenía barra de scroll horizontal, pero al estar al final de las 50 filas de la página había que bajar hasta el fondo para alcanzarla. Todo esto con espacio en blanco de sobra a los lados. Confuso para quien está aprendiendo el sistema.

**Causa raíz:** `Layout` fijaba `max-w-7xl` (1280px) para TODAS las vistas. Medido con Chrome headless sobre el panel real: la tabla quedaba clavada en **1216px sin importar el monitor** (1440, 1600 o 1920 daban lo mismo). Además la fila de filtros de estado tenía su propio `overflow-x-auto`, así que los estados de la derecha (DENEGADO, PROCESADO, ANULADO) quedaban ocultos tras una segunda barra.

### Fix (frontend-only, 3 archivos)
1. **`Layout`**: nueva prop `wide` que cambia el contenedor a `max-w-[1800px]` en header, main y footer a la vez (quedan alineados). Sin la prop, el ancho es idéntico al de siempre.
2. **`App.tsx`**: `wide` se activa solo con `isEffectiveAdmin && view === 'LIST'`. El formulario y el dashboard de usuario conservan la columna angosta, que se lee mejor.
3. **`AdminDashboard`**: los filtros pasan de `overflow-x-auto` a `flex-wrap` — bajan de línea en vez de esconderse tras una barra.

### Verificado (medición, no impresión)
Render del panel real en Chrome headless con datos de peor caso tomados de la hoja (las ciudades más largas: "BARRA DE PARISMINA, COSTA RICA" / "PUNTA CANA, DOMINICAN REPUBLIC", el centro de costos más largo, y los estados que generan 3 botones de acción):

| Viewport | Ancho de tabla antes | Ancho después | Contenedores con scroll-H |
|---|---|---|---|
| 1920 | 1216 | **1736** | 1 → **0** |
| 1600 | 1216 | **1521** | 1 → **0** |
| 1440 | 1216 | **1361** | 1 → **0** |
| 1280 | 1201 | 1201 | 0 → 0 |

La columna "después" refleja los dos cambios juntos. Atribución precisa: el ensanchamiento por sí solo llevaba los contenedores con scroll de 1 a 0 en 1920 y 1600, pero **a 1440 seguía en 1** — ahí el que sobra es el `flex-wrap` de los filtros. Los dos cambios se necesitan para llegar a cero en todos los anchos.

Comparación visual antes/después: la ruta pasa de 2 líneas a 1, los botones de acción de 2 filas a 1, y las filas quedan más compactas.

### Despliegue
**Solo frontend**: push a `main` → Cloud Run. Sin pasos de Apps Script. Rollback = revert del commit.

---

## **#A66 — El campo de Orden de Trabajo aceptaba cualquier cosa (SOL-000512: "CUBEL 482")**
**Fecha:** 2026-09-05 · **Reportado por:** David · **Estado:** Corregido

**Síntoma:** al crear una solicitud se podía escribir cualquier texto en la OT. En producción había `CUBEL 482` (SOL-000512), `16034` (SOL-000511), `123573` (SOL-000513, SOL-000492), y también `NA`, `PRUEBA!!`, `Visita Barranquilla`.

**Por qué no era cosmético:** una OT bien formada **exime a la solicitud de cargar al presupuesto de la unidad** y de pedir la aprobación del responsable de presupuesto (`_esOTValida_` / `_requiresBudgetOverrun_`). `_esOTValida_` exige empezar por "OT" y tener un dígito, así que `CUBEL 482` **no** la reconocía. El daño va en la dirección contraria a la que uno teme: no es que la basura evadiera el control, es que **OT reales mal escritas perdían la exención**, cargando el viaje al presupuesto de la unidad y disparando una aprobación que no correspondía.

**Contribuyó la propia ayuda del formulario**, que ponía como ejemplo `OT-1234` — sin código de empresa ni ciudad, es decir un formato que no existe.

**Alcance medido** sobre las 699 solicitudes de la hoja (2026-09-05): 149 tenían OT escrita; **67 no eran reconocibles** por el backend. De ellas, 3 eran OT reales que solo estaban mal escritas (`CUBEL 482`, `ETMED 31701`, `CUYUM 11301`).

### Formato canónico
`OT-<EE><CCC>-<NÚMERO>` — ej. `OT-CUBTA-110256`. `EE` = 2 letras de empresa (CU=Cumandes, ET=Equitel, IG=Ingenergía, LI=LAP); `CCC` = 3 letras de ciudad (BTA, MED, BQL, PEI, YUM, URA, BEL, PSO, RSO…).

Se valida la **estructura, no una lista cerrada de códigos** (decisión de David): no existe hoja maestra de OT contra la cual verificar, y una ciudad o empresa nueva debe poder operar sin esperar un despliegue.

### Fix (frontend + backend)
1. **`utils/workOrder.ts`** (nuevo): `normalizeWorkOrder` + `validateWorkOrder`. **La OT sigue siendo opcional** — vacío es válido. Normaliza las variantes reales de la hoja (`OTCUURA-207`, `OT-CUMED 46437`, `OT CUBTA 15560`, `OT-CUMED55980`, `CUBEL 482`) a la forma canónica. El número se conserva tal cual, sin quitar ceros a la izquierda: es un identificador, no una cantidad.
2. **`RequestForm`**: normaliza al salir del campo, muestra el error en línea bajo el input, y bloquea el envío (también en el camino multidestino, que comparte una sola OT). El valor normalizado se inyecta en ambos payloads — no se puede confiar en `setFormData` dentro del mismo handler.
3. **`Code.gs`**: gemelo `_normalizeWorkOrder_` / `_validateAndNormalizeWorkOrder_`, invocado desde `validateRequestInput_`, cuyos **únicos dos llamadores** son `createNewRequest` y `requestModification`. No toca las 699 solicitudes existentes ni los flujos de aprobación, reserva o costos. El backend guarda siempre la forma canónica, aunque el cliente sea viejo.
4. **Ayuda del formulario corregida**: el ejemplo pasa de `OT-1234` a `OT-CUBTA-110256`, y dice explícitamente que si no hay OT se deje vacío.

**Mensajes diferenciados:** `NA`/`N/A` recibe "es opcional, deje el campo vacío" (36 de los 67 casos malos son de este tipo); un valor puramente numérico recibe "es solo el consecutivo, falta el prefijo y el código"; el resto recibe el formato esperado con la sugerencia de usar observaciones para notas.

**Deliberadamente NO se rescatan** valores con texto extra (`INDUSUR-PUNTO NET.. OT-CUBTA-110256`, `OT-CUMED-55738 Medellín`): esa información es del usuario y va en observaciones, no en un campo que el backend interpreta.

### Riesgo de deriva entre los gemelos
El validador está escrito dos veces porque Apps Script y Vite/TS no comparten código. Para que no se separen en silencio se agregó **`tools/check-workorder-parity.cjs`**, que extrae las funciones de `Code.gs`, compila las de TypeScript y verifica que coincidan sobre 55 casos (los reales de la hoja + bordes). Corre dentro de `npm run verify`. Se validó que **detecta** una divergencia inyectada (cambiar 10→12 dígitos en un solo lado hace fallar el chequeo).

### Consecuencia conocida
`_esOTValida_` (la lectura del histórico) se dejó intacta a propósito, para no reinterpretar las 699 solicitudes ya guardadas. Esto implica que **8 solicitudes vivas** con OT mal formada quedarían bloqueadas si alguien intenta modificarlas, hasta corregir el campo: SOL-000381, 000400, 000413, 000434, 000492, 000505, 000511 y 000513. El mensaje de error dice exactamente qué hacer. También quedan fuera del formato los ~11 casos históricos tipo `OT-122912` / `OT 15606` (con prefijo pero sin código de ciudad), que sí pasaban antes.

### Verificado
`npm run verify` — typecheck, sintaxis de los 5 archivos del backend, paridad de validadores y build, todo limpio. El validador se corrió contra **las 149 OT reales** de producción: 57 aceptadas tal cual, 19 corregidas automáticamente, 73 rechazadas con el mensaje correspondiente.

### Despliegue
1. Push a `main` → Cloud Run (frontend).
2. Apps Script: pegar `Code.gs`, **Guardar** y **crear versión nueva** del web app.
3. Sin migración de hoja ni columnas nuevas.

**Orden seguro en ambos sentidos:** frontend nuevo + backend viejo → el formulario bloquea y el backend acepta lo que llegue (comportamiento actual). Backend nuevo + frontend viejo → el backend lanza y el `alert` existente muestra el mensaje.

## **#A67 — Vulnerabilidades de dependencias y limpieza de código muerto**
**Fecha:** 2026-09-05 · **Solicitado por:** David · **Estado:** Corregido

### Vulnerabilidades (5 → 0)
`npm audit` reportaba **4 high + 1 moderate**, todas en la cadena del servidor estático: `serve` → `serve-handler` → `minimatch` (ReDoS) / `brace-expansion`, más `ajv`.

`npm audit fix` las resolvió **sin cambiar un solo rango de `package.json`** — todo se resolvió en el lockfile. Se movieron 34 paquetes, todos herramientas de build (Babel, browserslist, postcss, `vite` 6.4.1→6.4.3) más los arreglos de seguridad (`minimatch` 3.1.2→3.1.5, `brace-expansion` 1.1.12→1.1.18, `serve` 14.2.5→14.2.6, `serve-handler` 6.1.6→6.1.7, `ajv` 8.12→8.18).

**`react` y `react-dom` NO se movieron** (siguen en 19.2.4): el runtime que se le sirve al usuario es idéntico.

**Hallazgo adicional — el arreglo del lockfile no cubría el contenedor.** El `Dockerfile` instala el servidor con `npm install -g serve@14`, un rango **flotante** que ignora `package-lock.json`. Cada build traía lo que hubiera en npm ese día, incluidas versiones sin auditar. Se ancló a `serve@14.2.6`, la misma versión que resuelve el lockfile. Hoy el comportamiento es idéntico (el rango ya resolvía ahí); la diferencia es que ahora el build es reproducible y auditable.

> Nota para el futuro: al subir `serve`, subirlo en **los dos** sitios — `package.json` y `Dockerfile`.

### Código muerto
Se eliminó **`components/ModificationForm.tsx`** (620 líneas). Ya estaba señalado como muerto en #A62. Verificado antes de borrar:
- Ninguna referencia en todo el repo salvo su propia definición.
- **0 apariciones en el bundle construido** — nunca entró al grafo de módulos, así que su borrado no puede alterar el runtime.
- Lo único propio que importaba (`BudgetUsageBar`) lo sigue usando `RequestForm`, así que no quedaron huérfanos.
- Tras el borrado, el build sigue transformando los mismos 53 módulos.

Se revisaron también los otros candidatos que arrojó el barrido: `utils/EmailGenerator.ts` (**vivo** — se carga con `import()` dinámico desde `RequestForm`, tiene chunk propio en `dist/`) y `vite.config.ts` (**vivo** — lo consume Vite). Ninguno se tocó.

### Verificado
`npm run verify` limpio y `npm audit` en **0 vulnerabilidades**.

### Despliegue
**Solo frontend**: push a `main` → Cloud Run. El cambio del `Dockerfile` solo aplica si el trigger de Cloud Build está configurado con Dockerfile en vez de buildpacks; en ambos caminos la versión de `serve` queda en 14.2.6. Sin pasos de Apps Script.

## **#A68 — Fecha de nacimiento en la creación y edición de usuarios**
**Fecha:** 2026-09-10 · **Solicitado en:** reunión Tiquetes/Aviatur (Diego Caballero, Yurani Prieto, Laura Molina, David) · **Estado:** Desplegado en producción (2026-09-10, `72b825e`)

**Necesidad:** las aerolíneas y agencias de viaje exigen la fecha de nacimiento para emitir tiquetes, y `USUARIOS` no la tenía. En la reunión se acordó que sea **obligatoria al crear usuarios nuevos**. Plan completo: [docs/plan-reunion-2026-09-10.md](docs/plan-reunion-2026-09-10.md), sección A.

### Diseño
- **Columna `Fecha Nacimiento` al final de `USUARIOS`**, agregada por la migración idempotente `agregarColumnaFechaNacimiento()` (menú *Equitel Viajes → 6. Agregar columnas Fecha de Nacimiento*, que desde #A70 crea también la columna de la hoja de solicitudes). **Por qué al final:** a diferencia de la hoja principal, `USUARIOS` se lee y escribe **por posición** (PIN en la col 10, aprobadores en 7–9, `_writeUsuarioRow_` escribe 1–9 fijas); una columna en medio desplazaría el PIN y rompería el inicio de sesión. La fecha se lee y escribe **siempre por nombre de encabezado**.
- **Formato:** texto `AAAA-MM-DD` en celda con formato `@`. Una fecha "real" de Sheets vuelve como `Date` con zona horaria y puede correrse un día. Se acepta también `DD/MM/AAAA`.
- **Reglas (confirmadas por David):** obligatoria al crear, opcional al editar; fecha de calendario válida, no posterior a hoy, edad entre 15 y 100 años. El backend es la autoridad (`_validateBirthdate_`); los formularios validan presencia y muestran el mensaje del backend.
- **`usuarios_create`** valida la fecha y confirma que exista la columna **antes** de escribir la fila. Si fallara después, quedaría un usuario a medias y el reintento diría "ya existe".
- **`usuarios_update`:** clave ausente = no se toca la fecha; vacía = se borra; con valor = se valida.
- **Sidebar:** campo en crear y editar. Al editar, la fecha **solo se envía si se tocó el campo**. Así, una fecha escrita a mano en un formato que el selector no puede mostrar no se borra al guardar otros cambios, y se avisa "valor guardado no reconocido". Un usuario sin fecha se muestra como "Pendiente".
- **Panel móvil:** campo obligatorio en "Crear usuario nuevo".
- **Privacidad:** nunca se incluye en `getIntegrantesData` / `bootstrap` (ese directorio llega al navegador de cada usuario). `mobileAdmin_getBootstrap` la quita del listado: el panel móvil solo crea usuarios.
- `sincronizarConMaestroRH` no cambia: sigue creando fichas sin fecha.

### Verificado
- `npm run verify` limpio. Incluye el nuevo **`check:birthdate`**: 30 casos de reglas (años bisiestos, 31/04, fechas futuras, límites exactos de 15 y 100 años, formatos).
- **Simulación del `Code.gs` completo** sobre una hoja `USUARIOS` en memoria, 19 escenarios:
  - migración: con grilla recortada, idempotente, repara encabezados con espacios raros, y deja las columnas 1–12 intactas
  - crear: sin columna, sin fecha o con edad inválida **no escribe nada**; creación válida
  - editar: sin la clave conserva fecha, PIN y pasaporte; con fecha, vacía o inválida se comporta como se espera
  - otros caminos: la sincronización con RH, el listado sin hash de PIN, una celda convertida en `Date` que vuelve como `AAAA-MM-DD`, el panel móvil sin fechas ajenas y el directorio público sin fecha
  - **La simulación detectó 3 de 3 errores inyectados a propósito** (clave ausente tratada como vacía, escritura por posición sobre el PIN, fechas ajenas en el móvil).
- **Sidebar en Chrome headless** con servidor simulado, 14 pasos (crear sin/con fecha, editar sin tocar, valor no reconocido, completar pendiente, borrar a propósito, nuevo tras editar). Los errores de consola de anomalías y duplicados aparecen **idénticos con el sidebar original de git**: son un efecto de la simulación, no una regresión.
- **Panel móvil en Chrome headless**, 9 pasos (máximo de fecha al iniciar, bloqueo sin fecha, error de edad del backend visible y formulario conservado, envío correcto, limpieza, caché local sin fechas).
- Diff de `Code.gs`: 243 líneas agregadas; las 6 "eliminadas" son líneas existentes ampliadas (un campo o una coma más), sin lógica removida.

### Despliegue
1. Apps Script: pegar `Code.gs`, `AdminSidebar.html` y `AdminMobile.html` → **Guardar**.
2. En la hoja: *Equitel Viajes → 6. Agregar columnas Fecha de Nacimiento*.
3. Crear **versión nueva** del web app (lo necesita el panel móvil).

Se despliega junto con #A70 (mismo `Code.gs`); ver el orden recomendado allí. No requiere push. **Entre los pasos 1 y 2**, crear un usuario responde "Falta la columna Fecha Nacimiento…" sin escribir nada; editar funciona siempre. Un sidebar abierto antes del paso 1 debe cerrarse y volver a abrirse.

**Rollback:** versión anterior del web app y pegar los archivos anteriores. La columna puede quedarse: el código anterior no la lee.

**Nota:** `USUARIOS` tiene una tabla de Sheets (`USERS`, A1:L). La columna nueva puede quedar fuera del formato de esa tabla; el código no depende de eso. Opcional: extender la tabla desde la interfaz de Sheets.

**Posición en producción (2026-09-10):** la migración ubicó la columna en la **O**, no en la M, porque la celda **N233** tenía un valor suelto (`ADMIN`). La migración se ubica a propósito después de la última columna con datos, para no rotular datos ajenos como fecha de nacimiento. Todo el código la localiza por **nombre de encabezado**, así que funciona en la O o movida a cualquier posición desde la M (verificado: 15 escenarios con la columna en O y movida a M, incluida la consulta del formulario, el guardado desde solicitudes, la migración repetida y un encabezado con espacios de más; la prueba detecta un código que asuma posición fija). Si se mueve, arrastrar la **columna completa** y no ubicarla entre A y L.

## **#A69 — Recordatorio de unidad de negocio y centro de costos en el formulario de solicitud**
**Fecha:** 2026-09-10 · **Solicitado en:** reunión Tiquetes/Aviatur · **Estado:** Desplegado en producción (2026-09-10, `72b825e`)

**Necesidad:** los solicitantes registraban mal la unidad de negocio o el centro de costos, y algunos pedían cambiar de aprobador por viajar a cargo de otra unidad. En la reunión se acordó un recordatorio en el formulario y **mantener fijos los aprobadores**.

**Cambio:** aviso ámbar sobre los campos *Unidad de Negocio* / *Centro de Costos* en `RequestForm`: *"⚠️ Verifique la unidad de negocio y el centro de costos. El costo del viaje se cargará exactamente a los que seleccione aquí. El aprobador no cambia por esta elección: es el que tiene asignado en el sistema el primer pasajero."* Solo texto: sin cambios de lógica ni de validación. Aparece también en modificaciones y en solo hospedaje, que usan los mismos campos.

**Verificado:** `npm run typecheck` · `npm run build` — limpios.

**Despliegue:** solo frontend, push a `main` → Cloud Run. Rollback = revert del commit.

## **#A70 — Fecha de nacimiento obligatoria en el formulario de solicitudes de vuelo**
**Fecha:** 2026-09-10 · **Solicitado por:** David · **Estado:** Desplegado en producción (2026-09-10, `72b825e`)

**Necesidad:** ir completando la fecha de nacimiento sin esperar la base de integrantes que se pidió a Karen: pedirla al crear una solicitud a los pasajeros que aún no la tengan, explicando para qué se usa. Plan: [docs/plan-reunion-2026-09-10.md](docs/plan-reunion-2026-09-10.md), sección A2.

### Decisiones (David)
- **Obligatoria** en solicitudes de vuelo (crear, modificar y multidestino) para todo pasajero sin fecha. Solo hospedaje no la pide.
- **Registrado sin fecha** → se guarda una vez en `USUARIOS`. **Externo** → se guarda solo en la solicitud; como no tiene perfil, se le pide en cada solicitud.

### Diseño
- **Consulta `getBirthdateStatus`** (máx. 5 cédulas, requiere sesión): devuelve solo `{cedula, registered, hasBirthdate}`, **nunca la fecha**. Un texto que no es fecha válida cuenta como "sin fecha".
- **Formulario (`RequestForm`):** campo por pasajero con la explicación según el caso ("la exigen las aerolíneas y agencias de viaje…", "se guarda una sola vez en su perfil" / "se guarda solo en esta solicitud"); error de edad en línea; al enviar bloquea y nombra a los pasajeros sin fecha. **Si la consulta falla, no bloquea:** pide la fecha a todos.
- **Payload `passengerBirthdates: {cédula: 'AAAA-MM-DD'}`** solo con los faltantes. **La clave presente activa la regla en el backend:** un formulario anterior abierto en otra pestaña crea solicitudes igual que antes.
- **Backend (`createNewRequest`):**
  - `_planPassengerBirthdates_` valida **antes** de escribir y rechaza nombrando al pasajero.
  - Externos → `FECHAS NACIMIENTO PASAJEROS (JSON)`, en la misma escritura de la fila.
  - Registrados → `_fillUsuariosBirthdates_` **después** de guardar la solicitud, dentro de `try/catch`: un fallo nunca afecta la solicitud.
  - **Nunca se sobrescribe una fecha válida**, con dos capas: la validación omite a quien ya la tiene y el guardado lo vuelve a comprobar.
  - `requestModification` hereda el campo por el spread del payload hija; multidestino es idempotente.
- **Columna nueva** `FECHAS NACIMIENTO PASAJEROS (JSON)` en `HEADERS_REQUESTS` (sobrevive a "Reorganizar Base Principal"), con migración `agregarColumnaFechasNacimientoSolicitudes()`. El menú *6. Agregar columnas Fecha de Nacimiento* crea las dos columnas (esta y la de `USUARIOS` de #A68).
- **Validador gemelo** `utils/birthdate.ts`, comparado con el backend en `check:birthdate`.
- **Privacidad:** la fecha nunca vuelve al navegador ni viaja en los correos. La de los externos queda visible en la hoja para el área de viajes.

### Verificado
- `npm run verify` limpio. `check:birthdate` compara frontend y backend en 30 casos (aceptación, valor normalizado y mensaje) y **detectó 3 de 3 divergencias inyectadas**.
- **Simulación del `Code.gs` completo** con ambas hojas en memoria, **20 escenarios**:
  - consulta: no devuelve fechas y respeta el límite de 5
  - formulario anterior: sin cambios
  - registrado sin fecha: rechazo sin escribir, edad inválida, guardado único como texto
  - registrado con fecha: no se exige y nunca se sobrescribe
  - externo: rechazo, guardado en la solicitud, y la fecha basura de un registrado se reemplaza
  - solo hospedaje, y columnas sin migrar (la solicitud se crea igual, con aviso en el log)
  - migración idempotente, solicitud de cambio (hereda la fecha y rechaza si falta), multidestino y la capa de guardado aislada
  - **Detectó 5 de 5 errores inyectados**, incluida cada capa de protección por separado.
  - Durante la verificación aparecieron 4 fallos que resultaron **falsos**: la simulación reutilizaba el mismo arreglo de encabezados y un escenario le quitaba la columna. Se depuró hasta confirmar que el backend era correcto (ningún caché de `Code.gs` retiene hojas ni columnas), se corrigió la simulación y se agregaron escenarios para la capa de guardado, que la primera capa ocultaba.
- **Formulario en Chrome headless** con servidor simulado, 13 pasos:
  - campos para registrado sin fecha y externo, cada uno con su texto
  - enviar sin fechas bloquea nombrando a ambos; la edad inválida se marca en línea y al enviar
  - el payload lleva solo los faltantes; un registrado con fecha no ve campo y envía el mapa vacío
  - con la consulta caída pide la fecha a todos, y con fecha la solicitud se crea
- Regresión de #A68: los 19 escenarios de `USUARIOS` siguen pasando con el `Code.gs` final.

### Despliegue (orden recomendado)
1. **Apps Script primero:** pegar `Code.gs` (junto con `AdminSidebar.html` y `AdminMobile.html` de #A68) → Guardar → menú *6. Agregar columnas Fecha de Nacimiento* → **versión nueva** del web app. El formulario anterior no envía la clave: nada cambia para los usuarios.
2. **Después el push** a `main` (frontend de #A69 y #A70).

El orden inverso también es seguro (nunca bloquea), pero mientras tanto la consulta nueva no existe, el formulario la trata como caída y pide la fecha a todos, y el backend viejo la descarta.

**Rollback:** versión anterior del web app + revert del commit. Las columnas nuevas pueden quedarse.

## **#A71 — Fecha de nacimiento visible por pasajero en el detalle de la solicitud (solo administradores)**
**Fecha:** 2026-09-10 · **Solicitado por:** David (mejora C2 del plan) · **Estado:** Desplegado en producción (2026-09-10, `72b825e`)

**Necesidad:** que el área de viajes vea la fecha de nacimiento de cada pasajero en el detalle de la solicitud, junto al nombre y la cédula, para registrarla en la aerolínea o agencia sin abrir la hoja.

### Decisión de visibilidad
**Solo administradores** (analista y superadmin). En una solicitud cualquiera puede escribir cédulas de otras personas; si el solicitante también viera las fechas, bastaría crear una solicitud para averiguar la fecha de nacimiento de un compañero. Para el solicitante, el detalle queda exactamente igual que antes.

### Diseño
- **Endpoint `getPassengerBirthdates(requestId)`**, incluido en `adminOnlyActions` de `dispatch`:
  - Los pasajeros se leen **de la fila de la solicitud**, no de cédulas enviadas por el navegador.
  - Fuente: primero `USUARIOS`; si no está, la columna `FECHAS NACIMIENTO PASAJEROS (JSON)` de la solicitud (externos, #A70); si no, "falta".
  - Tolera un JSON dañado (aviso en el log) y la columna sin migrar.
- **`_lookupUsuariosBirthdates_`** ahora también conserva la fecha, pero **solo para uso interno**: `getBirthdateStatus` (formulario de solicitudes) sigue devolviendo únicamente booleanos.
- **Detalle (`RequestDetail`):** bajo "CC" de cada pasajero se muestra:
  - `🎂 Nac.: DD-MM-AAAA (N años)`
  - `· registrada en esta solicitud` cuando es de un externo
  - `⚠️ Sin fecha de nacimiento` cuando falta
  - mientras carga, "Fecha de nacimiento…"; si la consulta falla, un aviso discreto sin afectar el resto del detalle

  La fecha se formatea **reordenando el texto**, sin crear un `Date`: una fecha `AAAA-MM-DD` interpretada en UTC se ve un día antes en Colombia.

### Verificado
- `npm run verify` limpio.
- **Simulación del `Code.gs` completo**, 11 escenarios:
  - fuentes: registrados desde `USUARIOS` (incluida la fecha recogida en el formulario), externos desde la solicitud, y solicitud antigua sin fechas
  - orden de los pasajeros sin duplicados, y prioridad de `USUARIOS` si el externo se registra luego con fecha (si se registra sin fecha, se sigue mostrando la de la solicitud)
  - robustez: JSON dañado, ID inexistente y hoja sin migrar
  - **acceso por `dispatch` real:** un solicitante recibe "requiere permisos de administrador" sin ninguna fecha, y la analista sí las recibe
  - la consulta del formulario sigue sin exponer fechas
  - **Detectó 3 de 3 errores inyectados:** control de administrador quitado, prioridad invertida y fecha filtrada en la consulta del formulario.
- **Detalle en Chrome headless con zona horaria `America/Bogota`**, 8 pasos:
  - administrador: estado de carga, una sola consulta por ID, "20-01-1985 (41 años)" sin desfase, "Sin fecha de nacimiento" y externo "registrada en esta solicitud"
  - administrador con la consulta caída: el detalle se ve igual con aviso discreto
  - solicitante: no se consulta nada y la tarjeta queda igual que antes
- Regresiones con el `Code.gs` final: #A68 (19 escenarios), #A70 (20) y posición de la columna (15), todas en verde.

### Despliegue
Se despliega junto con #A68 y #A70.
1. **Apps Script primero:** pegar `Code.gs` → Guardar → versión nueva del web app. No requiere migración adicional.
2. **Después el push** a `main`.

Con el orden inverso, entre el push y la versión nueva la consulta no existe: los administradores ven "No se pudo cargar la fecha de nacimiento" y el detalle sigue funcionando. Con backend nuevo y frontend viejo no cambia nada visible.

**Rollback:** versión anterior del web app + revert del commit.

## **#A72 — Carga masiva de fechas de nacimiento desde la lista de RR. HH.**
**Fecha:** 2026-09-10 · **Solicitado por:** David · **Estado:** Desplegado en producción (2026-09-10, `4747c4b`)

**Necesidad:** Karen (RR. HH.) envió la lista de integrantes de septiembre 2026: 842 personas con su fecha de nacimiento, en una hoja de Google Sheets con la misma estructura del maestro de RR. HH. (`cc`, `nombre`, `fecha de nacimiento`, `correo corporativo`…). Hay que cargar la fecha **por cédula** a los usuarios ya registrados. **No se crean usuarios**: la lista no trae aprobador, y los nuevos se siguen creando por el sidebar o el panel móvil (decisión de David).

### Diseño
- **Menú** *Equitel Viajes → 7. Cargar fechas de nacimiento (lista RR. HH.)*. Pide el **enlace al ejecutarse**: el ID de una hoja con datos personales **no queda en el código ni en el repositorio**. El menú exige ser analista (`_requireAnalyst_`), y corre con la cuenta de quien lo ejecuta, que debe tener acceso a la lista.
- **Lectura tolerante:** busca en cualquier pestaña, en las primeras 5 filas, los encabezados de cédula (`cc`, `cédula`, `documento`…) y de fecha de nacimiento.
  - Las fechas tipo `Date` se formatean con la **zona horaria de la hoja de origen**: con otra zona, una fecha a medianoche se corre un día.
  - Mismas reglas del sistema (fecha real, edad 15–100).
  - Una cédula repetida en la lista con fechas distintas se excluye y se reporta.
- **Cruce con `USUARIOS`** (columna de fecha localizada por nombre):
  - Llena celdas **vacías o con texto que no es fecha**.
  - **Nunca sobrescribe una fecha válida distinta:** la reporta como conflicto.
  - Usuarios que no están en la lista o que tienen fecha inválida en ella: se reportan.
- **Flujo seguro:**
  1. Vista previa con resumen y confirmación, sin escribir nada.
  2. Al confirmar, recalcula **dentro de `LockService`** (las filas pudieron cambiar) y escribe en **bloques de filas contiguas** con formato texto.
  3. Deja la pestaña **"Reporte fechas nacimiento"** con una fila por usuario: Cargada / Conflicto / Fecha inválida o repetida / No está en la lista / Ya la tenía. Se reescribe en cada carga.
- **Núcleo sin interfaz** `cargarFechasNacimientoDesdeHoja(enlace, aplicar)`, usable también desde el editor.
- Es **idempotente**: una segunda corrida no cambia nada.

### Resultado esperado con la lista real
Análisis independiente en Python y simulación del backend coinciden: de **763 usuarios registrados**, **636** reciben su fecha, **4** tienen en la lista una fecha fuera de 15–100 años, y **123** no aparecen en la lista. **202** integrantes de la lista no están registrados y no se crean.

### Verificado
- `npm run verify` limpio.
- **Simulación del `Code.gs` completo con los datos reales** (lista de 842 filas y `USUARIOS` de 763, con la columna en la O y el `ADMIN` suelto en N233, igual que producción), 20 escenarios:
  - vista previa y carga con los mismos 636/4/123, sin escribir nada en la vista previa
  - 636 fechas escritas en bloques como texto `AAAA-MM-DD`, cada una igual a la de la lista para esa cédula
  - columnas A–N intactas en las 763 filas; reporte de 763 filas; segunda corrida idempotente
  - conflicto no sobrescrito; texto no fecha reemplazado; cédula repetida excluida
  - hoja de origen en otra zona horaria (Tokio) sin desfase de un día
  - errores claros: enlace inválido, hoja sin acceso, lista sin columna de fecha, `USUARIOS` sin migrar
  - menú: cancelar, responder No, confirmar Sí, y bloqueo a quien no es analista
  - **Detectó 4 de 4 errores inyectados** (sobrescribir conflictos, formatear con la zona equivocada, quitar el control de analista, no detectar repetidos).
  - Un escenario falló al principio por un error **de la simulación**: comparaba cédulas sin normalizar y a veces nunca creaba el duplicado. Se corrigió y la mutación correspondiente confirma que ahora sí prueba algo.
- Regresiones con el `Code.gs` final: #A68 (19), #A70 (20), #A71 (11) y posición de columna (15).

### Despliegue y uso
1. Pegar `Code.gs` en Apps Script → Guardar. La carga corre desde la hoja, no desde el web app.
2. Recargar la hoja para ver el menú **7**.
3. Ejecutarlo, pegar el enlace de la lista, revisar el resumen y confirmar.
4. Revisar la pestaña "Reporte fechas nacimiento".

**Rollback:** los valores escritos son solo fechas en celdas que estaban vacías o sin fecha válida; el reporte lista exactamente qué filas se cargaron.

### Resultado en producción (2026-09-10)
Ejecutada por David desde el menú 7: **636 fechas cargadas, 4 inválidas en la lista y 123 usuarios que no aparecen**, exactamente lo esperado. El reporte exportado confirmó 763 filas, fechas `AAAA-MM-DD`, cédulas como texto, años 1962–2008 y ningún valor previo reemplazado.

**Seguimiento (sin código):** las 4 fechas inválidas (fecha de nacimiento igual a la de ingreso, o del 2018) deben corregirse con RR. HH.; de los 123 sin fecha, 6 son externos y 2 son usuarios de prueba (`PRUEBA1`, `PRUEBA2`); los otros 115 no están en la lista de integrantes de septiembre y conviene revisar si siguen en la empresa.

## **#A73 — El formulario no mostraba nada mientras verificaba la fecha de nacimiento, ni cuando ya estaba registrada**
**Fecha:** 2026-09-10 · **Reportado por:** David · **Estado:** Desplegado en producción (2026-09-10, `e9f6f89`)

**Síntoma:** en el formulario de solicitudes (#A70), bajo cada pasajero solo aparecía algo cuando **faltaba** la fecha de nacimiento. Mientras se consultaba, y cuando la persona ya la tenía registrada, quedaba un espacio en blanco: no se sabía si el sistema estaba cargando, había fallado o ya estaba todo bien.

**Cambio (solo frontend, `RequestForm`):** mismo estilo que el bloque de pasaportes.
- Mientras consulta: línea gris con "Verificando fecha de nacimiento de {nombre}…".
- Si ya la tiene: línea verde "✓ Fecha de nacimiento registrada — no es necesario ingresarla". **No muestra la fecha**: el backend nunca la envía al formulario.
- Si falta, o si la consulta falla: el campo, igual que antes.
- Solo hospedaje: nada, porque no aplica.

**Verificado:** `npm run verify`. Formulario en Chrome headless con servidor simulado, 11 pasos:
- el aviso de carga aparece y nombra al pasajero; al terminar da paso al campo o al "✓"
- el "✓" no muestra la fecha
- al agregar otro pasajero, el primero conserva su "✓" sin volver a "Verificando…"
- el externo sigue mostrando su texto de siempre
- el envío completo sigue mandando solo las fechas faltantes
- solo hospedaje no consulta nada
- con la consulta caída pide la fecha, sin quedarse en "Verificando…"

**Despliegue:** solo frontend, push a `main`. Sin cambios en Apps Script.

## **#A74 — El detalle tardaba en mostrar la fecha de nacimiento; celular del pasajero para el área de viajes**
**Fecha:** 2026-09-10 · **Reportado por:** David (celular: pedido de Laura, área de viajes) · **Estado:** Implementado, pendiente de push y despliegue

**Síntomas:**
- Al abrir el detalle de una solicitud, la fecha de nacimiento de cada pasajero (#A71) aparecía unos segundos después que el resto.
- Laura necesita el celular del pasajero para contactarlo (llamada o WhatsApp) si surge algo con la solicitud, y la app no lo tenía. La lista de RR. HH. sí lo trae.

**Causa raíz de la lentitud:** el detalle hacía **dos viajes seguidos** a Apps Script: `getRequestById` para abrirlo y, ya abierto, `getPassengerBirthdates`. Cada viaje cuesta del orden de uno a dos segundos; leer la fecha en sí es lo de menos. Guardar la fecha de todos los pasajeros en la columna JSON de la solicitud (lo primero que se evaluó) no quitaba ese segundo viaje, y además copiaba datos personales a cada solicitud, que quedarían desactualizados al corregir una fecha o cambiar un celular en `USUARIOS`.

**Cambio:**
- **Backend:** `getRequestById` agrega `passengerAdminInfo` (fecha, origen de la fecha y celular de cada pasajero) **solo si quien consulta es administrador**; lo decide `dispatch`. Si esa lectura falla, la solicitud se devuelve igual, sin el campo. `getPassengerBirthdates` queda como respaldo (también trae el celular). La fuente sigue siendo `USUARIOS`, más la columna de externos para las fechas.
- **Frontend (`RequestDetail`):** si la solicitud trae `passengerAdminInfo`, se muestra al abrir, sin otra llamada. Si no lo trae (backend anterior, o falló esa lectura), consulta aparte como antes. Junto a la fecha: "📱 300 123 4567 · WhatsApp" (enlaces `tel:` y `wa.me`), o "Sin celular registrado". La lista de pasajeros del administrador es un poco más alta para la línea extra; la del solicitante no cambia.
- **Columna `Celular`** al final de `USUARIOS`, leída por nombre, como texto de 10 dígitos. La crea sola la primera carga (también `agregarColumnaCelular()` desde el editor).
- **Menú 8. Cargar celulares (lista RR. HH.):** mismas reglas que #A72: solo usuarios ya registrados, nunca sobrescribe un celular válido distinto (lo reporta), vista previa y confirmación, detalle en la pestaña "Reporte celulares", y el enlace se pide al ejecutar. Usa "Cel corporativo"; si no es válido, "Cel personal". Válido = 10 dígitos que empiezan por 3; acepta `+57`, espacios y el número tal como lo guarda Sheets. `#N/A`, fijos y números de 9 u 11 dígitos quedan en el reporte.

**Seguridad:** fecha y celular siguen sin llegar al navegador del solicitante. No van en `mapRowToRequest` (filas lite y correos), ni en `getIntegrantesData` / `bootstrap`, ni en `getBirthdateStatus`.

**Verificado:**
- `npm run verify`.
- Simulación del `Code.gs` completo con hojas en memoria, 31 escenarios, usando la lista real de RR. HH. y `USUARIOS` con la disposición de producción:
  - vista previa: 633 celulares por cargar (312 corporativos, 321 personales), 7 sin celular válido, 123 no están en la lista; no escribe ni crea la columna
  - carga: columna P, 633 celulares como texto y en bloques; columnas A–O intactas (PIN, pasaporte, fechas, el `ADMIN` de N233); cada celular igual al de la lista; segunda corrida idempotente; la carga de fechas (menú 7) sigue dando lo mismo
  - protecciones: conflicto sin sobrescribir, mismo celular con otro formato, texto que no es celular, preferencia por el corporativo, corporativo inválido → personal, cédula repetida con celulares distintos, lista sin columnas de celular, enlace inválido, cancelación en el menú
  - acceso: el administrador recibe fecha y celular dentro de `getRequestById`; el solicitante dueño no recibe el campo ni los datos; otro usuario sigue sin ver la solicitud; filas lite sin datos; respaldo solo para administradores; un fallo de lectura no impide abrir el detalle
- 6 defectos introducidos a propósito (entregar datos al solicitante, preferir el personal, sobrescribir conflictos, no quitar el 57, sin respaldo ante fallo, crear la columna en la vista previa): todos detectados.
- Regresión: las simulaciones de #A68, #A70, #A71 y #A72 pasan con el `Code.gs` nuevo.
- Detalle en Chrome headless (zona America/Bogota) con servidor simulado, 15 pasos:
  - backend nuevo: fecha y celular desde el primer render, **cero llamadas adicionales**; enlaces `wa.me/57…` (pestaña nueva, `noopener`) y `tel:+57…` correctos; externo con "Sin celular registrado"; un re-render no vuelve a consultar
  - backend anterior: consulta una vez, muestra las fechas como antes y no inventa "Sin celular"
  - respaldo del backend nuevo con celular, y consulta caída con aviso discreto
  - solicitante: sin consultas, tarjeta y alto iguales que hoy; aunque el objeto trajera los datos, no se muestran

**Despliegue:** backend y frontend, en cualquier orden:
- Frontend nuevo + backend viejo: la solicitud no trae el campo; el detalle consulta aparte como hoy y no muestra celular.
- Backend nuevo + frontend viejo: el campo extra se ignora y el detalle consulta aparte como hoy.

Pasos en Apps Script: pegar `Code.gs` → Guardar → **nueva versión** del web app → recargar la hoja → **Equitel Viajes → 8. Cargar celulares (lista RR. HH.)** con el enlace de la lista.

## **#A75 — Celular opcional en el formulario de solicitudes y al crear o editar usuarios**
**Fecha:** 2026-09-10 · **Reportado por:** David · **Estado:** Implementado, pendiente de push y despliegue

**Pedido:** además de cargarlo desde la lista de RR. HH. (#A74), pedir el celular en el formulario de solicitudes y en los formularios de usuarios (sidebar y panel móvil), **sin que sea obligatorio**: no es vital.

**Cambio:**
- **Regla, en gemelos** (`utils/phone.ts` ↔ `Code.gs`; `tools/check-phone-rules.cjs` los compara en `npm run verify`): vacío es válido; si se escribe, debe ser un celular de 10 dígitos que empiece por 3. Acepta espacios, guiones y `+57`, y se guarda sin espacios. Mismo criterio que la OT (#A66): opcional, pero bien escrito.
- **Formulario de solicitudes**, en vuelos **y en solo hospedaje** (sirve para avisar cambios o novedades, vuele o no; decisión de David): a cada pasajero sin celular registrado se le ofrece "📱 Celular de … (opcional)". En solo hospedaje la fecha de nacimiento sigue sin pedirse.
  - Registrado: se guarda una vez en `USUARIOS`; nunca reemplaza un celular válido.
  - Externo: se guarda solo en la solicitud, en la columna nueva `CELULARES PASAJEROS (JSON)`, que el sistema crea sola la primera vez.
  - Un número incompleto o que no es celular bloquea el envío con un aviso que nombra al pasajero. Vacío no bloquea. El error en el campo aparece cuando ya hay 10 dígitos, para no marcarlo mientras se escribe.
  - El campo aparece solo si el backend informa `hasPhone`. Con el backend anterior, o si la consulta falla, no aparece (no se sabría si ya lo tiene ni se guardaría).
  - En solo hospedaje la consulta de estado ahora también se hace (antes no), pero **no hace esperar**: si tarda o falla, la solicitud se envía igual, sin el campo. En vuelos la espera es la misma que ya existía por la fecha (#A70).
- **Consulta del formulario** (`getBirthdateStatus`): agrega `hasPhone` (booleano); sigue sin devolver datos.
- **Sidebar:** "Celular (opcional)" al crear y al editar. Al editar solo se envía si se tocó el campo (vacío = quitarlo); un valor guardado mal escrito se muestra con un aviso para corregirlo.
- **Panel móvil:** "Celular (opcional)" al crear, con teclado de teléfono. En ambos formularios valida el backend y su mensaje aparece en pantalla.
- **Backend de usuarios:** `usuarios_create` y `usuarios_update` validan y guardan por nombre de columna; si `Celular` no existe, la crean al final **antes** de escribir la fila. `usuarios_listAll` lo devuelve para el sidebar; `mobileAdmin_getBootstrap` lo quita, igual que la fecha.
- **Detalle (admin):** el celular de un externo sale de su solicitud.
- **Menú 8** deja lista también la columna `CELULARES PASAJEROS (JSON)` en `Nueva Base Solicitudes` (idempotente). Así, tras el despliegue, ninguna solicitud tiene que crear columnas; si igual faltara, `createNewRequest` la crea sin bloquear la solicitud.

**Verificado:**
- `npm run verify`, que ahora incluye `check:phone` (27 casos; frontend y backend coinciden en aceptación, valor y mensaje).
- Simulación del `Code.gs` completo con hojas en memoria, 31 escenarios:
  - usuarios: crear con y sin celular; inválido rechazado sin crear la fila; columna creada al final sin tocar A–M; al editar, clave ausente no toca, vacío lo quita, inválido no cambia nada de la fila; editar la fecha no toca el celular
  - listados: el sidebar lo recibe tal cual; el panel móvil no recibe celulares ni fechas
  - consulta del formulario: `hasPhone` solo booleano
  - solicitudes: registrado sin celular → `USUARIOS`; registrado con celular → no se reemplaza; externo → solo en la solicitud y visible en el detalle del administrador; el solicitante no recibe celulares; inválido rechazado antes de escribir; vacío o cédula que no es pasajero se ignoran; formulario anterior igual; varios tramos; columna de la solicitud creada sola solo cuando hace falta; un fallo al completar `USUARIOS` no afecta la solicitud
  - solo hospedaje: guarda los celulares (registrado y externo) sin pedir ni guardar fechas; rechaza uno inválido antes de escribir; sin celulares queda igual que antes
- 9 defectos introducidos a propósito, todos detectados. La mutación de "ignorar solo hospedaje" al principio no se aplicaba por un error de formato del propio test; se notó porque no hacía fallar nada, se corrigió y se agregó un control que falla si una mutación no cambia el código. Un escenario falló la primera vez por un error del propio test (comparaba como texto un celular guardado como número en la hoja de prueba); se diagnosticó y se corrigió el test, no el código.
- Regresión: las simulaciones de #A68–#A74 pasan. La de #A74 suma 2 escenarios (el menú 8 crea la columna de solicitudes y no la duplica) y su mutación. Las dos que verificaban las claves exactas de `getBirthdateStatus` se actualizaron para incluir `hasPhone`.
- Chrome headless:
  - formulario, 20 pasos:
    - vuelos: sin parpadeo mientras consulta; campo opcional para registrado sin celular y para externo; nada para quien ya lo tiene; error solo ante un número completo inválido; envío bloqueado con aviso y luego enviado con los celulares normalizados; sin celular se crea igual; backend anterior y consulta caída no lo ofrecen
    - solo hospedaje: ofrece el celular sin pedir fecha; nada para quien ya lo tiene; externo opcional; envío bloqueado con un número incompleto y luego creado con los celulares y sin fechas; sin celular se crea igual; con la consulta **caída** o **todavía en curso** la solicitud se crea sin esperar
  - regresión del formulario: se volvió a correr el arnés de #A73 (11 pasos). Los estados de la fecha no cambiaron; solo se ajustó su expectativa de que solo hospedaje no consultaba
  - sidebar, 13 pasos: crear con y sin celular; editar sin tocar (no se envía), valor mal escrito (aviso, no se borra), completar y borrar a propósito; formulario limpio al volver a crear. Los dos errores de página del arnés (`usuarios_findDuplicates`, `usuarios_getAnomalias`) son del stub y aparecen igual con el sidebar original de git
  - panel móvil, 6 pasos: envía lo digitado, muestra el error del servidor conservando los datos, crea sin celular, limpia el formulario y no guarda celulares en su caché

**Despliegue:** junto con #A74, en cualquier orden:
- Frontend nuevo + backend viejo: el formulario no ofrece el celular (no llega `hasPhone`). En solo hospedaje hace la consulta de estado (que ya existe en producción desde #A70) y sigue igual.
- Backend nuevo + frontend viejo: el formulario sigue igual que hoy.

Pasos en Apps Script: pegar `Code.gs`, `AdminSidebar.html` y `AdminMobile.html` → Guardar → **nueva versión** del web app (el panel móvil se sirve desde ahí) → recargar la hoja → menú 8 con el enlace de la lista (crea también la columna de celulares de externos en `Nueva Base Solicitudes`).

## **#A76 — Dashboard de costos: cada líder ve solo su unidad de negocio**
**Fecha:** 2026-09-14 · **Reportado por:** Yurani (vía David) · **Estado:** Implementado, pendiente de push y despliegue

**Pedido:** que ciertos líderes entren al dashboard de costos viendo **solo** su unidad de negocio (p. ej. Simón García: Potencia, GDM y P&M), sin ver valores de las demás, y que quien no tenga un permiso asignado no pueda entrar.

**Cómo estaba:**
- Entraban analistas, superadmins y **cualquier aprobador** (regla del 2026-05-11), y todos veían todas las unidades.
- La página recibía los datos de todas las unidades y filtraba en el navegador: el filtro de unidad era solo visual.
- Simón, por ser su propio aprobador, ya veía todo.

**Cambio:**
- **Tabla de accesos en MISC:** encabezados `DASHBOARD COSTOS · CORREO` y `DASHBOARD COSTOS · UNIDAD DE NEGOCIO` en la fila 2, buscados por nombre. Una fila por persona y unidad; `TODAS` da acceso a todas.
- **Reglas:**
  - Analistas y superadmins ven todo.
  - Los de la tabla ven solo sus unidades.
  - Nadie más entra: los aprobadores que no estén en la tabla pierden el acceso.
  - Si la tabla no existe o no se puede leer, solo entran los administradores.
- **Filtro en el servidor**, dentro de `_csBuildData_` y **antes** de cualquier suma o conteo. A un líder no le llegan montos, nombres de unidades, IDs de solicitudes, contadores de exclusión ni estadísticas del caché de otras unidades, y pedir otra unidad en los filtros devuelve vacío.
- `getCostsDashboardConfig` queda solo para analistas y superadmins. El reporte de variación sigue igual (solo administradores).
- **Página:**
  - la pantalla de ingreso explica la regla nueva
  - el mensaje de "sin acceso" dice cómo pedirlo
  - al líder se le muestra "Acceso limitado a …" y el filtro de unidad dice "Todas las asignadas"
- **Menú 9. Accesos al dashboard de costos:**
  - crea la tabla al final de MISC, con una lista desplegable de las unidades conocidas más `TODAS`, que se refresca en cada corrida
  - muestra quién ve qué
  - avisa de correos no registrados en USUARIOS, unidades que no coinciden, filas repetidas o incompletas, y administradores que no necesitan fila
- Se retiraron `_csGetApproverEmails_` y `_csIsApprover_`, que quedaron sin uso.

**Verificado:**
- `npm run verify`.
- Simulación del `Code.gs` completo con la copia de la base (542 solicitudes, 764 usuarios), comparada con la versión anterior del código, 25 escenarios:
  - **administradores:** resultado idéntico al de antes (2026: 311 solicitudes y 17 unidades; también 2025 y con filtros de meses y empresa)
  - **Simón con POTENCIA:**
    - recibe solo su unidad, igual a la que ve el analista (114 solicitudes), con totales y meses calculados solo con ella
    - los contadores de exclusión cuadran exactamente con sus solicitudes
    - en su respuesta no aparece ninguna otra unidad ni IDs de solicitudes ajenas
    - pedir otra unidad devuelve vacío
  - **variantes:** dos unidades con el correo en mayúsculas y la unidad en minúsculas; `TODAS`; unidad escrita con espacio duro
  - **sin acceso:**
    - un aprobador fuera de la tabla, que antes veía todo
    - fila sin unidad, correo inválido, un usuario cualquiera
    - tabla inexistente (falla cerrado)
    - la tabla se encuentra aunque se mueva de columna o los encabezados se escriban distinto
  - **otros:**
    - configuración y reporte de variación
    - el camino real de la página (`costsDashboard_getData` → `dispatch`)
    - sedes y tarjetas de MISC idénticas con o sin la tabla nueva
  - **menú 9:**
    - crea la tabla en H–I sin tocar A–F, con la lista desplegable
    - es idempotente y da un error claro si queda un solo encabezado
    - la revisión da sus 7 tipos de aviso y la pantalla resume quién ve qué
- 7 defectos introducidos a propósito, todos detectados.
- Página en Chrome headless con los datos que devuelve el backend simulado, 13 pasos:
  - **líder:**
    - la pantalla de ingreso explica la regla nueva
    - entra y ve "Acceso limitado a POTENCIA (GDM - P&M)"; el filtro de unidad solo ofrece la suya
    - ningún nombre de otras unidades en el dashboard, ni visible ni oculto
    - sin reporte de variación, sin configuración y sin estadísticas del caché
  - **sin acceso:** vuelve al ingreso con el mensaje nuevo
  - **analista:** sin aviso de acceso limitado y con sus 17 unidades
  - una verificación falló la primera vez por un error del propio test, que buscaba los nombres en todo el texto de la página, incluido su propio script; se diagnosticó y se corrigió el test, no el código

**Despliegue:** solo Apps Script (`Code.gs` y `CostsDashboard.html`); la app React no cambia. Orden para no dejar a nadie sin acceso entre medio:
1. Pegar ambos archivos y guardar. El menú de la hoja usa el código guardado; el dashboard sigue con la versión publicada.
2. Recargar la hoja → menú 9 (crea la tabla) → llenarla con la lista de Yurani → menú 9 otra vez para revisar.
3. Recién entonces, nueva versión del web app: desde ese momento aplica la regla nueva.

**Nota:** la documentación en `docs/guia-hoja-calculo.md` quedó actualizada; los `.html` y `.pdf` de las guías no se regeneraron (`npm run build:guia`).

## **#A77 — Saltar la aprobación: solo Yurani y David; nadie puede aprobar por la API**
**Fecha:** 2026-09-14 · **Reportado por:** Yurani (vía David) · **Estado:** Implementado, pendiente de push y despliegue

**Pedido:**
- Que saltar la etapa de aprobación lo tenga solo Yurani.
- David conserva el permiso como administrador del sistema (no lo usa, pero debe poder) y necesita comprobar que nadie más lo tiene.
- Bajar a Diego (`directorcompras`) de superadmin a administrador normal, como Laura.

**Cómo estaba:**
- Saltar la aprobación lo podía hacer **cualquier superadmin** (`SUPER_ADMIN_EMAILS`, una propiedad del script): agregar a alguien como superadmin le daba ese poder.
- La casilla del modal de costos manda una bandera para **no enviar el correo a los aprobadores**, y el backend la aceptaba de cualquier usuario.
- **Hueco de la API:**
  - `updateRequest` guardaba el estado que le enviaran, sin validar quién llamaba: cualquier usuario con sesión, incluso un solicitante, podía poner una solicitud en APROBADO (o RESERVADO, ANULADO…) llamándola directamente.
  - `createRequest` guardaba el estado que mandara el cliente: se podía crear una solicitud ya aprobada.
  - La app no ofrecía esas opciones, pero la API las aceptaba.

**Cambio:**
- **Regla fija en el código** (`SKIP_APPROVAL_ALLOWED`): pueden saltar la aprobación Yurani Prieto y David Sánchez, y además deben ser administradores.
  - No depende del rol superadmin: dar superadmin a otra persona no le da el permiso.
  - Cambiar la lista exige modificar `Code.gs`, así que queda en git.
- **Dónde se aplica:**
  - en `dispatch` para `skipApprovalStage`, y otra vez dentro de la función (defensa en profundidad)
  - en la bandera de "no avisar a aprobadores": a cualquier otro se le ignora y los correos salen normalmente
  - en `bootstrap` (`canSkipApproval`): la app muestra el botón del detalle y la casilla del modal de costos solo a quien tiene el permiso; con un backend anterior, sigue la regla vieja (superadmin)
- **`updateRequest` solo acepta los cambios que usa la app:**
  - administrador: `PENDIENTE_SELECCION`, `PENDIENTE_CONFIRMACION_COSTO` y `PENDIENTE_APROBACION`
  - solicitante: `PENDIENTE_CONFIRMACION_COSTO` con su selección, solo sobre su solicitud y solo si está en `PENDIENTE_SELECCION`; cualquier otro dato que mande (opciones, costos) se ignora
  - `APROBADO`, `DENEGADO`, `RESERVADO`, `PROCESADO` y `ANULADO` nunca entran por esa vía; tienen su propio flujo
- **`createRequest`:** toda solicitud nueva nace en `PENDIENTE_OPCIONES`. Las solicitudes de cambio siguen por `requestModification`.
- **Menú 10. Ver administradores y quién salta aprobación** (solo lectura): quién puede saltar la aprobación y la lista de superadmins y analistas, con nombre.
- **Diego:** script temporal que no queda en el código. Lo agrega a `ANALYST_EMAILS` y **después** lo quita de `SUPER_ADMIN_EMAILS` (nunca queda sin acceso), y deja en el registro quién puede saltar la aprobación. **Ejecutado por David el 2026-09-14**: el menú 10 confirma superadmins David y Yurani, analistas apcompras, Laura y Diego, y que solo Yurani y David pueden saltar la aprobación.

**Alcance de la garantía:** la app y su API. Quien tenga acceso de edición a la hoja o al proyecto de Apps Script puede cambiar celdas o código directamente; eso queda por fuera del sistema y en el historial de versiones de Google.

**Verificado:**
- `npm run verify`.
- Simulación del `Code.gs` completo, 29 escenarios:
  - **quién puede:**
    - con Yurani, Diego y David como superadmins: solo Yurani y David
    - David solo como analista: puede; David sin rol de administrador: no
    - un superadmin nuevo no puede
  - **saltar por la API:**
    - Diego (superadmin), Laura y un solicitante son rechazados, sin cambios en la solicitud
    - la función directa también rechaza a Diego
    - Yurani y David sí pueden, con trazabilidad
  - **ninguno de los cinco** (solicitante dueño, Laura, Diego, Yurani, David) puede poner `APROBADO` con `updateRequest`, ni `DENEGADO`, `RESERVADO`, `PROCESADO`, `ANULADO` o un estado vacío
  - **flujos normales intactos:**
    - publicar opciones y enviar la selección del solicitante siguen igual
    - si el solicitante manda opciones o costos, se ignoran
    - no puede reenviar la selección fuera de etapa ni sobre una solicitud ajena, ni confirmar costos o publicar opciones
    - confirmar costos envía el correo a los aprobadores
  - **bandera de no avisar:** Laura la manda y se ignora (el correo sale); con Yurani funciona como antes
  - **crear:** con `status: APROBADO` nace en `PENDIENTE_OPCIONES`; una creación normal sigue igual
  - **`bootstrap`:** `canSkipApproval` solo para Yurani y David
  - **menú 10:** con y sin David como administrador
  - **script de Diego:** resultado exacto; repetido no duplica ni cambia a nadie más; Diego, ya analista, sigue sin poder saltar; con la propiedad dañada no cambia nada
- 10 defectos introducidos a propósito, todos detectados. Un escenario falló la primera vez por un error del propio test (esperaba tres espacios en el registro y hay dos); se diagnosticó y se corrigió el test.
- Chrome headless, 4 pasos: con permiso aparecen el botón del detalle y la casilla del modal de costos; sin permiso no aparecen y el resto se ve igual.
- **Regresión con #A76 y #A77 aplicados:** las simulaciones de #A68–#A75 pasan con los mismos conteos que al crearlas: usuarios 19, posición de columna 15, A2 20, C2 11, carga masiva 20, #A74 33 y #A75 31. Se habían borrado de la carpeta temporal entre sesiones y se reconstruyeron desde el historial, reaplicando solo los bloques que escriben en esa carpeta y abortando si alguno mencionaba archivos del repo.

**Despliegue:**
1. Apps Script: pegar `Code.gs` y guardar → nueva versión del web app.
   - Con el frontend actual, un superadmin sigue viendo el botón, pero el backend rechaza a quien no sea Yurani o David, con un mensaje claro.
   - Los flujos normales no cambian.
2. Ejecutar el script temporal de Diego y borrarlo; comprobar con el menú 10.
3. Push a `main` (frontend). Si el frontend llega primero, el botón y la casilla se muestran a los superadmins (regla vieja) hasta que el backend nuevo esté publicado.
