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
