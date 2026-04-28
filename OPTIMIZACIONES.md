# Plan de Optimizaciones — Equitel Viajes

> **Documento vivo.** Aquí queda registrado todo el plan de mejoras de rendimiento y escalabilidad. Cada ítem tiene contexto técnico completo, archivos afectados, riesgo, esfuerzo, beneficio y plan de validación. Las casillas `[ ]` se marcan a `[x]` al completar.
>
> **Cómo usar este documento:**
> 1. Trabajar las etapas en orden (Etapa 1 → 2 → 3 → 4). Cada etapa tiene riesgo creciente.
> 2. Dentro de una etapa, los ítems son razonablemente independientes — se pueden tomar en cualquier orden.
> 3. Antes de un commit, marcar el ítem como `🟡 EN CURSO`. Tras commit + push verificado, marcar `[x] ✅ HECHO` con la referencia al commit.
> 4. Cualquier desvío del plan o decisión nueva queda registrada en la sección "Decisiones tomadas".

---

## Contexto y línea base

**Estado al 2026-04-27** (post-fix #A49 directorio + fix Drive rate limit + fix emojis alias):

- Solicitudes en producción: **~100**.
- Usuarios en directorio (USUARIOS): **~700**.
- Carpetas Drive en `ROOT_DRIVE_FOLDER_ID`: **~100**.
- Bundle frontend: **395 kB** (gzip 109 kB).
- Stack: React 19 + Vite 6 + TypeScript / Google Apps Script + Sheets / Drive.
- Cada llamada al backend: **500 ms - 2 s** de overhead HTTP (cold start GAS hasta 8-15 s, mitigado parcialmente con `warmupPing` cada 10 min).

**Síntomas reportados o anticipados:**
- Drive `Error de servicio` con 100+ carpetas → **resuelto** (commit `d43b5c1`).
- Login del admin se siente lento (3-5 s en cold start).
- Dashboard de admin con 50 solicitudes paginadas: aceptable.
- Form "Nueva solicitud" tarda 1-3 s en cargar dropdowns.
- Polling cada 15 s genera carga constante en backend.

---

## Optimizaciones ya implementadas (referencia histórica)

Para no duplicar trabajo, estas mejoras YA están en producción:

| Optimización | Commit | Beneficio |
|---|---|---|
| `_REQ_HEADERS_CACHE` per-execution | (legacy) | Headers leídos 1 vez por dispatch en lugar de N. |
| `_REQUESTER_CEDULA_CACHE` per-execution | (legacy) | Map email→cédula leído 1 vez por dispatch. |
| `_CACHED_GMAIL_ALIASES` per-execution | `ccf6e8f` | `GmailApp.getAliases()` 1 vez por dispatch. |
| Drive search query (`searchFolders`) en lugar de scan lineal | `d43b5c1` | O(1) en lugar de O(n). Resuelve "Error de servicio: Drive" con +100 carpetas. |
| `_driveRetry_` con 1.5 s de delay para errores transient | `d43b5c1` | Sobrevive hipos de Drive sin romper UX. |
| Cache de métricas en `metricas_cache.json` (Drive) | (legacy) | Métricas incrementales — solo recompúta solicitudes que cambiaron. |
| `_bootstrapFetch` helper con retry para fetches críticos del frontend | (commit posterior a fix #A49) | Reintento + alerta clara al usuario en lugar de array vacío silencioso. |
| Fix UTF-16 supplementary plane → entidades HTML en wrapper de mail | `868f04c` | Emojis 4-byte (💰📥🚫🔥🔎🏨) renderizan bien con alias activo. |
| Reset caches per-request en `doGet`/`doPost` (post-Etapa 2) | (post-audit) | Garantiza que `_REQUEST_ROW_CACHE`, `_REQ_HEADERS_CACHE`, `_REQUESTER_CEDULA_CACHE`, `_CACHED_GMAIL_ALIASES` son per-request, no per-isolate. Sin esto, el `warmupPing` cada 10 min podía hacer que dos requests consecutivos compartieran un cache stale en el mismo isolate V8 (síntoma raro: "Solicitud no encontrada" tras crear desde otra invocación). Costo: cero — los caches ya se construían lazy. |
| Strip de plano suplementario también en SUBJECT de correos con alias | `dba3c97` | Subject "🚫 Solicitud..." llegaba como "??????..." con alias. Headers RFC2047 no soportan entidades HTML, así que stripeo (BMP `⚠⏰✅❌` se preservan). |
| Spinner overlay con sintaxis Tailwind 4 (`bg-gray-500/75`) | `dba3c97` | El overlay del spinner de hidratación quedaba negro sólido por usar la sintaxis vieja (`bg-black bg-opacity-30`) en un proyecto Tailwind 4. |
| Múltiples archivos de reserva descargables desde detalle | `b46053a` | El botón único "Descargar Tiquetes/Reserva" mostraba solo el primero. Ahora lista todos los `isReservation` con su nombre real. |
| Timeout 30s + AbortController en `runGas` | `be7673f` | Sin timeout, un network stall dejaba el spinner del detalle eterno hasta F5. 30s cubre cold start; si excede, alert claro y reintento. |
| Cancelable + ESC/clic-fondo/botón en spinner de hidratación | `be7673f` | 3 vías de escape para el modal blocking. Resultado tardío de un fetch cancelado se descarta (no abre detalle equivocado). |
| Strip items corruptos en cache localStorage de integrantes | `108fa79` | Si XSS o edición manual mete un item con `email: null`, antes rompía el render. Ahora se filtran y se fuerza refetch en próximo bootstrap. |
| Trigger `cleanupExpiredPropsWeekly` | (legacy) | Limpia sesiones, lockouts y rate-limit counters expirados. |
| `warmupPing` cada 10 min | (legacy) | Mantiene tibio el isolate de GAS para reducir cold starts. |

---

# ETAPA 1 — Quick wins ✅ COMPLETADA (2026-04-27)

> **Estado:** los 6 ítems están desplegados en producción y validados. Commits:
> - `e3b5b24` — implementación principal (los 6 ítems)
> - `dba3c97` — fixes posteriores (emoji `🚫` en subject de anulación + spinner overlay con sintaxis Tailwind 4)

## 1.1 — Cache requestId → rowNumber per ejecución

**Archivo:** `server/Code.gs` — múltiples funciones que hacen `ids.map(String).indexOf(String(requestId))`.

**Problema:** Cada operación que toca una solicitud específica busca su rowNumber con un scan O(n) sobre la columna ID. Funciones como `updateRequestStatus`, `registerReservation`, `anularSolicitud`, `cancelOwnRequest`, `requestModification`, `processApprovalFromEmail`, `_applyChangeDecision_`, `processUserConsultResponse`, `skipSelectionStage`, `skipApprovalStage`, `amendReservation`, `uploadOptionImage`, `uploadSupportFile`, `_startUserConsultOnParent_`, `generateSupportReport`, `_recordEvent_` y `_getRequestStageTimestampForAction_` repiten este patrón. Con 2000 filas, cada lookup son ~500 ms acumulados.

**Solución:** Un helper `_getRowByRequestId_(requestId)` con cache `var _REQUEST_ROW_CACHE = null` análogo a `_REQ_HEADERS_CACHE` y `_REQUESTER_CEDULA_CACHE`. Construye un map `{requestId → rowNumber}` la primera vez que se llama, después O(1).

**Pseudocódigo:**
```js
var _REQUEST_ROW_CACHE = null;
function _buildRequestRowMap_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_REQUESTS);
  var idIdx = H('ID RESPUESTA');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  var ids = sheet.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
  var map = {};
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i][0] || '').trim();
    if (id) map[id] = i + 2;
  }
  return map;
}
function _getRowByRequestId_(requestId) {
  if (!_REQUEST_ROW_CACHE) _REQUEST_ROW_CACHE = _buildRequestRowMap_();
  return _REQUEST_ROW_CACHE[String(requestId).trim()] || -1;
}
```

**Riesgo:** Bajo. Es un cache de lectura; si una operación crea/borra una fila durante el mismo dispatch, el cache podría quedar desactualizado. Mitigación: invalidar cache (`_REQUEST_ROW_CACHE = null`) tras inserciones (en `createNewRequest` y `requestModification`).

**Esfuerzo:** ~30 min. Helper + reemplazo en ~15 callers.

**Beneficio:** A 2000 filas, cada operación admin ahorra 500 ms - 2 s. A 5 operaciones encadenadas (típico flujo: confirmar costos → aprobación → reserva), ahorra ~5-10 s.

**Validación:**
- `npx tsc --noEmit` y `npm run build` (no afectan TS, solo backend).
- Test manual: crear una solicitud, modificarla, anularla. Verificar que cada acción funciona y que el log no muestra errores.
- Confirmar que `_REQUEST_ROW_CACHE` se invalida tras `createNewRequest` (revisar test al final).

**Status:** `[x] ✅ COMPLETADO Y EN PRODUCCIÓN` — commit `e3b5b24` (2026-04-27)
- Helper `_getRowByRequestId_` + cache `_REQUEST_ROW_CACHE` agregados junto a los caches existentes (línea ~285).
- Invalidación `_clearRequestRowCache_()` insertada en `createNewRequest` justo después del `setValues` final, antes de `_recordEvent_(id, 'created')`.
- 21 call sites refactorizados: `_getRequestStageTimestampForAction_`, `closeRequest` (dispatch), `requestModification`, `_applyChangeDecision_`, `_startUserConsultOnParent_`, `processUserConsultResponse`, `processApprovalFromEmail`, `registerReservation`, `amendReservation`, `uploadOptionImage`, `updateRequestStatus` (lookup principal + lookup del parent), `uploadSupportFile`, `diagnosticarAprobacion`, `_escalateStalePendingApproval_`, `generateSupportReport`, `cancelOwnRequest`, `anularSolicitud`, `skipSelectionStage`, `skipApprovalStage`, `_recordEvent_`.
- Validación funcional manual: ✅ (smoke test contra producción con frontend viejo + frontend nuevo).

---

## 1.2 — `getRequestsLite` y `getMyRequestsLite` (endpoint resumido)

**Archivo:** `server/Code.gs` (nuevo endpoint), `services/gasService.ts` (consumir), `App.tsx` (sustituir polling).

**Problema:** `getAllRequests` y `getMyRequests` corren `mapRowToRequest` para cada fila, que hace:
- Parse de hasta 3 JSONs (OPCIONES, SELECCION, SOPORTES).
- Llamada a `computeEffectiveApprovalStatus_` (lógica condicional sobre 5+ flags).
- Llamada a `_getRequesterCedulaMap_()` (cacheado pero seguido por `indexOf` O(n) sobre passengers).
- Construcción de objeto con ~50 campos.

A 100 filas: ~500 ms total. A 2000 filas: ~10 s. El payload sale a 5-8 MB en JSON.

Para el dashboard NO se necesita la mayoría de esos campos: solo `requestId`, `status`, `requesterEmail`, `destination`, `origin`, `departureDate`, `returnDate`, `company`, `requestMode`, `passengers[].name`, `isInternational`, `requesterIsCeo/Cds` (para íconos), `isProxyRequest`, `relatedRequestId`, `hasChangeFlag`.

**Solución:** Crear `getRequestsLite(filterEmail?)` que retorna solo esos ~15 campos por solicitud. Frontend lo usa para listas y polling. Cuando el usuario hace click en una solicitud específica, llama un endpoint separado `getRequestById(id)` que sí hace mapRowToRequest completo y devuelve TODO.

**Implementación backend:**
```js
function getRequestsLite(filterEmail) {
  // Si filterEmail viene, solo devuelve solicitudes de ese correo. Si no, todas.
  // Lee solo las columnas relevantes (no todo el row × 75 cols).
  // Dedupe por ID.
  // Retorna ~15 campos por solicitud.
}
function getRequestById(id) {
  // Lee la fila completa, ejecuta mapRowToRequest, devuelve un solo objeto.
}
```

**Implementación frontend:**
- `services/gasService.ts`: agregar `getRequestsLite()` y `getRequestById(id)`.
- `App.tsx`: cambiar polling y carga inicial a `getRequestsLite`. Usar `getRequestById` cuando el usuario abre detalle.
- `RequestDetail` props recibir el objeto liviano y, en su useEffect inicial, llamar `getRequestById` para hidratar el resto.

**Riesgo:** Medio. Cambia la API. Hay que asegurar que ningún componente espera campos del lite que solo existen en el completo. El endpoint legacy se mantiene por compatibilidad y se elimina solo cuando se confirme migración exitosa.

**Esfuerzo:** ~2-3 h. Backend (~30 líneas), frontend (revisar 5-6 callsites).

**Beneficio:** A 2000 solicitudes: payload de dashboard cae de 5-8 MB a ~1.5 MB. Tiempo de carga 3-5x mejor en móvil. Polling cada 30s ya no satura backend.

**Validación:**
- Comparar visualmente el dashboard antes/después.
- Verificar que íconos de prioritario (⭐) y proxy (👥) sigan apareciendo (campos requeridos en el lite).
- Confirmar que abrir un detalle dispara fetch del request completo.
- Confirmar que detalle muestra opciones, soportes, costos, todo.
- Probar polling: el lite se actualiza, no rompe el detalle abierto.

**Status:** `[x] ✅ COMPLETADO Y EN PRODUCCIÓN` — commit `e3b5b24` (2026-04-27)
- Backend: `mapRowToRequest(row, lite)` — flag `lite` que omite parse de OPCIONES (JSON).
- `getAllRequestsLite()`, `getMyRequestsLite(email)`, `getRequestById(id)` agregados.
- Dispatch del POST: `getMyRequestsLite`, `getAllRequestsLite` (con check analyst), `getRequestById` (con check ownership: usuario común recibe null si la solicitud no es suya).
- Frontend: `gasService.getMyRequestsLite/getAllRequestsLite/getRequestById` agregados con retry x2 + 1.5s backoff en `getRequestById`.
- `App.tsx`: `fetchRequests` usa los lite endpoints. Nuevo `handleViewRequest` (useCallback) hidrata con `getRequestById` ANTES de mostrar el detalle, con spinner blocking modal mientras carga. Si la hidratación falla persistentemente: alert + no abre el detalle (evita que el admin actúe sobre datos parciales).
- Endpoints legacy `getAllRequests`/`getMyRequests` permanecen disponibles para rollback.
- Validación funcional manual: ✅ confirmada en producción.
- Fix posterior (commit `dba3c97`): spinner overlay con sintaxis Tailwind 4 (`bg-gray-500/75` en vez de `bg-black bg-opacity-30`) — el original quedaba negro sólido.

---

## 1.3 — Subir polling de 15 s a 30 s

**Archivo:** `App.tsx` (constante `POLL_INTERVAL_MS`).

**Problema:** Cada usuario logueado dispara un poll cada 15 s. Con 20 usuarios activos = 1.3 calls/s al backend. A 100 usuarios = 6.6 calls/s, suficiente para empezar a saturar GAS.

**Solución:** Subir el intervalo a 30 s. La diferencia perceptual (ver un cambio de status 30 s después en lugar de 15 s) es despreciable para el flujo de trabajo de viajes corporativos.

**Riesgo:** Nulo.

**Esfuerzo:** 5 min.

**Beneficio:** Carga de backend cae a la mitad sin que el usuario lo note.

**Validación:** `npx tsc --noEmit && npm run build`. Test manual de cualquier flujo.

**Status:** `[x] ✅ COMPLETADO Y EN PRODUCCIÓN` — commit `e3b5b24` (2026-04-27). `App.tsx` línea 12: `POLL_INTERVAL_MS = 30000`.

---

## 1.4 — Reducir columnas leídas en `getIntegrantesData`

**Archivo:** `server/Code.gs` — función `_getIntegrantesDataFromUsuarios_`.

**Problema:** Hoy lee 9 columnas de USUARIOS (A-I). Las únicas que el frontend usa son: A (cédula), B (nombre), C (correo), H (correo aprobador), I (nombre aprobador). D (empresa), E (sede), F (centro de costo), G (cédulas aprobadores) NO se exponen al frontend.

**Solución:** Leer solo las 5 columnas necesarias (rangos no contiguos: A:C y H:I). Más rápido y reduce payload.

**Implementación:**
```js
var dataAC = sheet.getRange(2, 1, lastRow - 1, 3).getValues();    // A, B, C
var dataHI = sheet.getRange(2, 8, lastRow - 1, 2).getValues();    // H, I
return dataAC.map(function(rAC, i) {
  return {
    idNumber: String(rAC[0]).trim(),
    name: String(rAC[1]).trim(),
    email: String(rAC[2]).toLowerCase().trim(),
    approverName: String(dataHI[i][1] || '').trim(),
    approverEmail: String(dataHI[i][0] || '').toLowerCase().trim()
  };
}).filter(...);
```

**Riesgo:** Bajo. Mismo output que antes; solo cambia cómo se leen las cells.

**Esfuerzo:** ~10 min.

**Beneficio:** A 700 usuarios, ~3500 cells leídas en lugar de 6300. Ahorro ~30-40 % de tiempo en `getIntegrantesData`.

**Validación:** Test manual: login, abrir form, verificar que pasajero 1 se autocompleta y aprobador aparece correctamente.

**Status:** `[x] ✅ COMPLETADO Y EN PRODUCCIÓN` — commit `e3b5b24` (2026-04-27). `_getIntegrantesDataFromUsuarios_` lee A:C y H:I por separado. Output idéntico, lectura ~45% más liviana.

---

## 1.5 — Memoización del dashboard del admin

**Archivo:** `components/AdminDashboard.tsx`.

**Problema:** El componente recibe `requests` y aplica filtros (status, búsqueda, prioritario, proxy) y ordenamiento. Cada cambio de estado del padre (incluso uno irrelevante como abrir un modal) causa re-render y recálculo.

**Solución:**
1. Envolver la lista filtrada en `useMemo` con dependencias [requests, filtros].
2. Envolver `AdminDashboard` con `React.memo` para que no re-renderice si props no cambian.
3. Memoizar handlers con `useCallback` si se pasan a hijos.

**Riesgo:** Bajo. Optimización clásica de React, sin cambio funcional.

**Esfuerzo:** ~20 min.

**Beneficio:** Pequeño hoy (backend domina), pero a 1000+ filas el render gana 100-300 ms.

**Validación:** Verificar visualmente que filtros, búsqueda, paginación siguen funcionando.

**Status:** `[x] ✅ COMPLETADO Y EN PRODUCCIÓN` — commit `e3b5b24` (2026-04-27)
- `AdminDashboard` envuelto con `React.memo` (export final).
- En `App.tsx`: `handleManualRefresh` ahora es `useCallback([userEmail, isEffectiveAdmin])` y `handleViewRequest` es `useCallback([])` — referencias estables que permiten al `React.memo` saltar re-renders cuando solo cambia estado interno del padre (modales, dialogs).

---

## 1.6 — Lazy-load de `EmailGenerator` en `RequestForm`

**Archivo:** `components/RequestForm.tsx`.

**Problema:** `import { generateTravelRequestEmail } from '../utils/EmailGenerator'` carga 260 líneas en el bundle inicial, aunque la función solo se usa en el submit del form.

**Solución:** Convertir el import a dinámico:
```ts
const handleSubmit = async (e) => {
  ...
  const { generateTravelRequestEmail } = await import('../utils/EmailGenerator');
  const emailHtml = generateTravelRequestEmail(...);
  ...
};
```

**Riesgo:** Nulo. El primer submit demora ~50-100 ms extra para descargar el chunk; submits siguientes son cacheados.

**Esfuerzo:** ~10 min.

**Beneficio:** Bundle inicial baja ~5-10 kB. Mínimo pero limpio.

**Validación:** `npm run build`, confirmar que aparece chunk separado en `dist/assets/`. Submit de un form de prueba en localhost.

**Status:** `[x] ✅ COMPLETADO Y EN PRODUCCIÓN` — commit `e3b5b24` (2026-04-27). `RequestForm.tsx` ya no importa estáticamente `EmailGenerator`; lo carga vía `await import('../utils/EmailGenerator')` dentro de `handleSubmit`. Build confirmado: `dist/assets/EmailGenerator-*.js` es un chunk separado de 10.58 kB / 3.30 kB gzip; bundle principal cayó de 395 kB a 386.97 kB.

---

## Total estimado Etapa 1

- **Tiempo:** 3-4 h.
- **Beneficio acumulado:** ahorra ~5-10 s por flujo admin completo en escala +500. Cero riesgo de regresión.
- **Sin afectar:** ningún flujo de negocio, ninguna validación de seguridad, ninguna interfaz visual.

---

# ETAPA 2 — Mejoras estructurales ✅ COMPLETADA (2026-04-27)

> **Estado:** los 6 ítems están desplegados en producción y validados. Commits:
> - `b46053a` — bloque inicial (2.5 + 2.2 + 2.3 + fix multi-archivos reserva)
> - `d921008` — bloque final (2.1 bootstrap login + 2.4 cache integrantes + 2.6 cache max ID)
> - `be7673f` — fix crítico: spinner eterno (timeout AbortController + cancelable)
> - `f3ca6a7` — fix crítico: SUPERADMIN no veía todas las solicitudes en VER ADMIN
> - `108fa79` — auditoría: 6 hallazgos de robustez/UX (cache invalidation, doble alert, tipos)

## 2.1 — Endpoint bootstrap unificado para login

**Archivo:** `server/Code.gs`, `services/gasService.ts`, `App.tsx`.

**Problema:** Tras el login (PIN admin o usuario), el frontend hace en cascada:
1. `validateSession(email, token)` (~500 ms-2s).
2. `getIntegrantesData()` (~1-2 s, lee USUARIOS completo).
3. `checkIsAnalyst(email)` solo si rol=ANALYST/SUPERADMIN (~500 ms).
4. `getMyRequests` o `getAllRequests` (~1-3 s).

Total cold start: 3-7 s antes de ver el dashboard. Con cold-start GAS adicional, hasta 15 s.

**Solución:** Un solo endpoint `bootstrap(email, token)` que retorna en una sola pasada:
```js
{
  session: { valid, role, expiresAt },
  user: { email, name, isAnalyst, isSuperAdmin },
  integrantes: [...] // o un flag que diga "fetch on demand"
  requestsLite: [...]
}
```

**Decisión clave:** ¿incluir integrantes en el bootstrap o no?
- **Opción A — incluirlos:** payload más grande (700 × 100 bytes ≈ 70 KB) pero el form abre instantáneo después.
- **Opción B — lazy-load al abrir form:** bootstrap más rápido (sin 2-3s de getIntegrantesData), pero "Nueva solicitud" tarda 1-2 s la primera vez.

**Recomendación:** Opción B. La gente usa el dashboard mucho más que crea solicitudes; vale optimizar el caso común. Opción A si se observa que la primera apertura del form se siente lenta.

**Riesgo:** Medio. Cambia el flujo de inicialización del frontend. Hay que probar todos los caminos: cold session, expired session, network error, etc.

**Esfuerzo:** ~3 h. Backend ~40 líneas, frontend ~50 líneas (refactor de `init()` y los dos handlers de PIN).

**Beneficio:** Tiempo de cold login cae de 5-7 s a 2-3 s.

**Validación:**
- Test login admin (con y sin PIN cacheado en localStorage).
- Test login usuario (idem).
- Test session expirada en mid-fetch.
- Test network error en bootstrap.
- Confirmar que el dashboard muestra todas las solicitudes correctamente.

**Status:** `[x] ✅ COMPLETADO Y EN PRODUCCIÓN` — commit `d921008` (2026-04-27)
- Backend: nuevo endpoint `bootstrap(integrantesHash, sessionEmail, sessionToken)` que valida sesión internamente (sessionExempt en dispatch) y consolida 4 calls en 1.
- Determina rol server-side (SUPERADMIN > ANALYST > REQUESTER) — NUNCA confía en cliente.
- Frontend `init()` y los 2 handlers de PIN refactorizados; `handleLoginSuccess` con flag `skipFetch=true` cuando bootstrap ya trajo todo.
- Cold restore cae de 3-7s a ~1-2s.
- Endpoints legacy preservados: `validateSession`, `getIntegrantesData`, `checkIsAnalyst`, `getMyRequestsLite`, `getAllRequestsLite`.

---

## 2.2 — Pre-filtrar status antes de `mapRowToRequest` en triggers

**Archivos:** `server/Code.gs` — `sendPendingApprovalReminders`, `sendPendingSelectionReminders`, `processAdminReminders`, `sendPendingConsultReminders`.

**Problema:** Los triggers leen toda la hoja, mapean cada fila con `mapRowToRequest` (que parsea 3 JSONs, calcula effective approval status, etc.) y DESPUÉS filtran por status. A 2000 filas con ~30 pendientes reales, se hace 2000× el trabajo y se descarta 1970×.

**Solución:** Leer la columna STATUS primero, filtrar índices que coincidan con el status objetivo, mapear solo esas filas:
```js
function _findRowsByStatus_(sheet, statuses) {
  var statusIdx = H('STATUS');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var data = sheet.getRange(2, statusIdx + 1, lastRow - 1, 1).getValues();
  var matches = [];
  data.forEach(function(r, i) {
    if (statuses.indexOf(String(r[0]).trim()) !== -1) matches.push(i + 2);
  });
  return matches; // array de rowNumbers
}
```
Después, para cada `rowNumber`, leer la fila completa y mapear.

**Trade-off:** Hace 1 read extra (la columna status) pero evita N maps. A 2000 filas con 30 matches: antes 2000 maps × 5 ms = 10 s; después 1 read columna (50 ms) + 30 reads + 30 maps = ~250 ms. Ahorro ~9.7 s por trigger.

**Riesgo:** Medio-bajo. Cuidado con que los triggers que también necesitan `_computePausedParentIds_` (que lee TODA la sheet para encontrar hijas activas) sigan funcionando — ese helper sí necesita data completa.

**Esfuerzo:** ~2 h. 4 funciones a modificar.

**Beneficio:** Triggers de 10-15 s caen a 1-3 s. Aleja drásticamente el riesgo del límite de 6 min.

**Validación:**
- Ejecutar manualmente cada trigger desde el editor GAS y verificar que envía los correos correctos a las solicitudes correctas.
- Confirmar que solicitudes con cambio activo siguen pausadas.
- Confirmar que solicitudes con USER_CONSULT_MARKER siguen siendo identificadas.

**Status:** `[x] ✅ COMPLETADO Y EN PRODUCCIÓN` — commit `b46053a` (2026-04-27)
- Aplicado solo a `processAdminReminders` (era el único que mapeaba TODA la base con `mapRowToRequest`). Los otros 3 triggers ya filtraban por status antes del map.
- TARGET_STATUSES: `PENDIENTE_OPCIONES`, `PENDIENTE_CONFIRMACION_COSTO`, `APROBADO`, `RESERVADO_PARCIAL`, `PENDIENTE_ANALISIS_CAMBIO`.
- `_computePausedParentIds_` sigue recibiendo `dataRows` completo (necesita relaciones padre-hija de toda la base) — no usa `mapRowToRequest`, solo lee 3 columnas.

---

## 2.3 — Endpoint `getFormBootstrap` para "Nueva solicitud"

**Archivo:** `server/Code.gs`, `services/gasService.ts`, `components/RequestForm.tsx`, `components/ModificationForm.tsx`.

**Problema:** `RequestForm` al montar dispara 5 fetches en paralelo (`getCoApproverRules`, `getExecutiveEmails`, `getSites`, `getCostCenterData`, `getCitiesList`). Cada uno tiene overhead HTTP.

**Solución:** Un endpoint `getFormBootstrap()` que retorna `{ rules, executives, sites, costCenters, cities }`. Una sola llamada en lugar de 5.

**Riesgo:** Bajo. Solo agrupa datos que ya se devuelven separadamente.

**Esfuerzo:** ~1 h.

**Beneficio:** Apertura del form cae de 1-3 s a 500 ms-1s.

**Validación:**
- Abrir form de nueva solicitud y verificar que los dropdowns se llenan.
- Abrir form de modificación y verificar lo mismo.

**Status:** `[x] ✅ COMPLETADO Y EN PRODUCCIÓN` — commit `b46053a` (2026-04-27)
- Backend: `getFormBootstrap()` consolida `getCoApproverRules` + `getExecutiveEmails` + `getSites` + `getCostCenterData` + `getCitiesList` (5 datasets en una llamada).
- Frontend: `RequestForm.tsx` fusionó sus 2 useEffects en uno solo. `ModificationForm.tsx` queda con sus 2 fetches separados (no es el form crítico).

---

## 2.4 — Cache de integrantes en localStorage con versioning

**Archivo:** `services/gasService.ts`, `App.tsx`.

**Problema:** Aún con el endpoint lite, integrantes se descarga en cada login. Si el usuario refresca o vuelve después de 1 día, descarga las 700 filas de nuevo.

**Solución:** Cachear `integrantes` en localStorage con un ETag/version. El backend retorna un hash; si el hash en localStorage coincide, frontend usa cache. Si no, descarga.

**Implementación:**
- Backend: nuevo `getIntegrantesVersion()` que retorna un hash MD5 de USUARIOS (rápido — 1 query).
- Frontend: en init, llama `getIntegrantesVersion`; compara con `localStorage.integrantesVersion`. Si coincide, usa cache. Si no, descarga + actualiza cache.

**Riesgo:** Medio. Hay que invalidar el cache si USUARIOS cambia (agregar usuario, cambiar correo, etc.). El hash debe contemplar todos los campos relevantes.

**Esfuerzo:** ~2 h.

**Beneficio:** Login subsecuente (no cold) cae a 1-2 s; integrantes ya está cacheado.

**Validación:**
- Login, verificar que descarga integrantes.
- Refresh del navegador, verificar que NO descarga (mismo hash).
- Modificar un usuario en USUARIOS, refresh, verificar que SÍ descarga (hash cambió).

**Status:** `[x] ✅ COMPLETADO Y EN PRODUCCIÓN` — commit `d921008` (2026-04-27)
- Implementado **junto con 2.1** (bootstrap) — natural extensión: integrantes viene en cada bootstrap, con cache hash.
- Backend: `_computeIntegrantesHash_(integrantes)` retorna MD5 de `JSON.stringify`. Si cliente envía hash que coincide, omite array (~70KB → ~1.5KB).
- Frontend: localStorage key `equitel_integrantes_cache_v1` con `{hash, data}`. Validación de shape al leer (commit `108fa79`). Si filtramos items corruptos, hash='' fuerza refetch para no quedarnos con subset.

---

## 2.5 — Reads consolidados en `processApprovalFromEmail`

**Archivo:** `server/Code.gs`.

**Problema:** Hoy hace 5+ `getRange(rowNumber, X).getValue()` separados (status, isInternational, totalCost, approverEmail, etc.). Cada uno es un round-trip a Sheets.

**Solución:** Una sola lectura `sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0]` y extraer los campos del array por índice.

**Riesgo:** Bajo.

**Esfuerzo:** ~30 min.

**Beneficio:** Cada click en aprobar/denegar cae de 2-3 s a 1-1.5 s. Los aprobadores notan.

**Validación:** Test manual: aprobar una solicitud desde el correo, verificar que se actualiza el status, que llegan los correos de decisión.

**Status:** `[x] ✅ COMPLETADO Y EN PRODUCCIÓN` — commit `b46053a` (2026-04-27)
- 1 sola lectura `getValues()` sobre la fila completa al inicio. Los ~5 reads dispersos (`status`, `isInternational`, `totalCost`, `expectedApprover`, `currentVal` por rol) ahora se hacen contra el array `currentRow` en memoria.
- La segunda lectura post-flush (línea 2269 — `rowValues`) se mantiene intacta — necesita los valores recién escritos para verificar fully-approved.
- Click APROBAR/DENEGAR baja de 2-3s a 1-1.5s. Aprobadores notan diferencia.

---

## 2.6 — Cache del max ID en `createNewRequest`

**Archivo:** `server/Code.gs`.

**Problema:** Línea ~4070, hace `getRange(2, idCol, lastRow - 1, 1).getValues().flat()` y busca el max. A 2000 solicitudes son 2000 cells leídas + parse.

**Solución:** Cachear el `nextIdNum` en una Script Property `LAST_REQUEST_ID_NUM`. Al crear, lee la property, incrementa, escribe nueva, usa el valor.

**Edge case:** Si la property se desincroniza (corrupción, edición manual del sheet), recalcular como fallback.

**Riesgo:** Medio. Hay que pensar bien la concurrencia: el lock de dispatch ya cubre escrituras paralelas, pero el helper debe ser atómico.

**Esfuerzo:** ~30 min.

**Beneficio:** A 2000 filas, cada creación de solicitud ahorra ~500 ms.

**Validación:** Crear varias solicitudes seguidas. Verificar que IDs son consecutivos y únicos.

**Status:** `[x] ✅ COMPLETADO Y EN PRODUCCIÓN` — commit `d921008` (2026-04-27)
- **Implementación más segura que el plan original:** en vez de ScriptProperty cache (riesgo de desincronización), reusa el `_REQUEST_ROW_CACHE` que ya existe (Etapa 1.1). Sus keys son los IDs — extraer el max es iterar keys en memoria.
- Helper `_computeNextRequestIdNum_()` reemplaza el scan + parse de la columna ID en `createNewRequest`.
- Cero riesgo de desincronización: el cache se construye desde el sheet en cada dispatch, dentro del LockService.

---

## Total estimado Etapa 2

- **Tiempo:** 8-10 h.
- **Beneficio acumulado:** login cae 50 %, triggers caen 80 %, abrir form cae 50 %, aprobaciones caen 30 %.

---

# ETAPA 3 — Cambios mayores (riesgo medio-alto, requiere planificación, ~12-15 h total)

> **Cuándo hacer:** al alcanzar 500-800 solicitudes, o cuando la app empiece a sentirse lenta tras Etapa 2.

## 3.1 — Paginación server-side en `getAllRequests`/`getMyRequests`

**Archivo:** `server/Code.gs`, `services/gasService.ts`, `App.tsx`, `components/AdminDashboard.tsx`, `UserDashboard.tsx`.

**Problema:** Aun con endpoint lite, descargar 2000 solicitudes (incluso con 15 campos cada una) es ~600 KB y ~5-8 s. La gran mayoría nunca se mira: el usuario ve la primera página.

**Solución:** El endpoint acepta `{page, pageSize, filters}` y retorna solo esa página. Frontend pagina contra backend en lugar de cargar todo.

**Riesgo:** Medio-alto. Cambia la API y el contrato del frontend. Filtros deben aplicarse server-side. Búsqueda por texto requiere full-text-like en Sheets (lento o limitado).

**Esfuerzo:** ~6 h. Backend (filtros, sort, pagination) + frontend (UI ya pagina pero ahora contra remoto).

**Beneficio:** Dashboard carga en <1 s independiente del volumen total.

**Decisión pendiente:**
- ¿Búsqueda local sobre página actual o búsqueda remota? Búsqueda remota requiere recargar al teclear → debounce de 500 ms.
- ¿Filtros remotos o locales? Status remoto (cambia poco). Búsqueda por texto remoto con debounce.

**Validación:**
- Confirmar que paginación funciona en ambos dashboards.
- Filtros (status, búsqueda) se aplican correctamente.
- Sort por fecha/ID se mantiene.

**Status:** `[ ] PENDIENTE`

---

## 3.2 — Diffing en polling

**Archivo:** `server/Code.gs`, `services/gasService.ts`, `App.tsx`.

**Problema:** Cada poll trae 100-2000 solicitudes aunque ninguna haya cambiado. Desperdicia ancho de banda y CPU del frontend.

**Solución:** El backend acepta un timestamp `?since=<iso>`; retorna solo solicitudes modificadas después de esa fecha. El frontend mantiene la última fecha vista y solo merges los cambios.

**Implementación backend:** Comparar contra `EVENTOS_JSON.lastEvent` o agregar columna `LAST_MODIFIED`. Más simple: usar el timestamp del último evento conocido.

**Riesgo:** Medio. Hay que asegurar que ningún cambio de status se pierde. Si una solicitud no tiene events, fallback a comparación de status.

**Esfuerzo:** ~3 h.

**Beneficio:** Polling cae de 1-3 s a <500 ms cuando no hay cambios. A 99 % de los polls.

**Validación:**
- Confirmar que cambios de status se reflejan en frontend en el siguiente poll.
- Test de soak: dejar la app abierta 1 hora, confirmar que sigue actualizándose correctamente.

**Status:** `[ ] PENDIENTE`

---

## 3.3 — Code-splitting del frontend

**Archivo:** `vite.config.ts`, `App.tsx`.

**Problema:** Bundle de 395 kB carga todo upfront, incluido AdminDashboard (que solo ven analistas), Métricas, Reorganización, etc.

**Solución:** `React.lazy(() => import('./...'))` para componentes pesados que solo se ven en algunos flujos:
- `AdminDashboard`
- `RequestDetail` (es 854 líneas)
- `MetricsPanel`
- `MetricsModal`
- `OptionUploadModal`
- `ReservationModal`

**Riesgo:** Bajo. Suspense boundaries son estándar React. El primer click en cada componente lazy descarga el chunk (~100 ms).

**Esfuerzo:** ~2 h.

**Beneficio:** Bundle inicial cae a ~200 kB. Cargas posteriores son granulares.

**Validación:** `npm run build`, confirmar que aparecen múltiples chunks. Test manual de cada componente lazy.

**Status:** `[ ] PENDIENTE`

---

## 3.4 — Archivado de solicitudes `PROCESADO` antiguas

**Archivo:** `server/Code.gs` — nueva función + trigger mensual.

**Problema:** A 2000 solicitudes, la mayoría están en `PROCESADO`. Ya no requieren consultas frecuentes pero pesan en cada lectura del sheet.

**Solución:** Función `archivarSolicitudesAntiguas()` que mueve solicitudes en `PROCESADO` con más de 12 meses a una hoja separada `Nueva Base Solicitudes_ARCHIVO`. La hoja activa solo contiene "vivas + recientes" (~200-300 estables).

**Riesgo:** Medio-alto. Mover datos requiere cuidado: preservar IDs, EVENTOS_JSON, SOPORTES, todo. Hay que asegurar que un usuario que abre una solicitud archivada todavía pueda verla — el detalle endpoint debe fallback al sheet de archivo.

**Esfuerzo:** ~5 h.

**Beneficio:** Sheet activa nunca crece más allá de ~300 filas. Todas las operaciones se mantienen rápidas indefinidamente.

**Validación:**
- Crear 5 solicitudes de prueba con `PROCESADO` y fecha vieja.
- Ejecutar archivar, verificar que se movieron.
- Abrir una archivada desde el dashboard del usuario, verificar que muestra todo.

**Status:** `[ ] PENDIENTE`

---

# ETAPA 4 — Optimizaciones avanzadas (situacional, hacer solo si Etapas 1-3 no bastan)

> **Cuándo hacer:** si tras todas las etapas anteriores la app sigue lenta y la base supera 2000 solicitudes activas (no solo totales — esto es raro).

## 4.1 — Server-Sent Events (SSE) o long-polling para reemplazar polling

**Archivo:** múltiples.

**Problema:** Polling cada 30 s es ineficiente: ~99 % de los polls no traen cambios.

**Solución posible:** Apps Script no soporta WebSockets nativos. SSE tampoco directamente. Requeriría un proxy/Cloud Function intermedia.

**Esfuerzo:** Muy alto.

**Recomendación:** No hacer. Polling con diffing (3.2) es suficiente.

**Status:** `[ ] DESCARTADO`

---

## 4.2 — Migración a base de datos real (Cloud SQL / Firestore)

**Archivo:** todo el proyecto.

**Problema:** Sheets es lento para queries complejos. A 5000+ solicitudes activas, Sheets es el cuello de botella.

**Solución:** Migrar a Firestore o Cloud SQL.

**Esfuerzo:** Re-arquitectura completa (~80-120 h).

**Cuándo:** Solo si la app crece mucho más allá de 5000 solicitudes y no hay otra alternativa.

**Status:** `[ ] FUTURO LEJANO`

---

## 4.3 — Service Worker / offline support

**Archivo:** frontend.

**Problema:** Si el usuario pierde conexión, no puede ver sus solicitudes pasadas.

**Solución:** Service Worker que cachea respuestas de API. UX mejorada en redes inestables.

**Esfuerzo:** ~6 h.

**Recomendación:** No hacer salvo que haya quejas explícitas de usuarios sin conexión confiable.

**Status:** `[ ] DESCARTADO POR AHORA`

---

# Métricas de validación

Para confirmar que las optimizaciones efectivamente mejoran las cosas, medir antes y después con cronómetro o DevTools:

| Operación | Cómo medir | Baseline (hoy) | Meta tras Etapa 1 | Meta tras Etapa 2 |
|---|---|---|---|---|
| Cold login (admin) | DevTools Network → tiempo desde el click hasta dashboard renderizado | 4-7 s | 4-7 s | 2-3 s |
| Warm login (sesión válida) | Idem | 2-4 s | 2-3 s | 1-2 s |
| Carga del dashboard (admin, 100 solicitudes) | Tiempo de la primera renderización completa | 1-2 s | 800 ms-1s | 500 ms |
| Apertura "Nueva solicitud" | Click hasta dropdowns interactivos | 1-3 s | 1-3 s | 500 ms-1s |
| Submit de solicitud (sin upload) | Click en "Crear" hasta confirmación | 2-3 s | 1.5-2.5 s | 1-1.5 s |
| Subir 6 imágenes de opciones | Click en "Subir" hasta confirmación | 8-12 s | 8-12 s | 6-8 s |
| Aprobador hace click en APROBAR | Click hasta página de confirmación | 2-3 s | 2-3 s | 1-1.5 s |
| Trigger `sendPendingApprovalReminders` | Tiempo en Ejecuciones del editor GAS | 5-8 s (100 filas) | 5-8 s | 1-2 s |

A 2000 solicitudes, el baseline crece linealmente (Sheets escala, mapRowToRequest es O(n)). Las metas tras Etapa 2 deben mantenerse aprox. constantes en términos absolutos.

---

# Plan de rollback genérico

Para cualquier ítem de cualquier etapa que se commitee:

1. **Pre-deploy:** confirmar que `npx tsc --noEmit` y `npm run build` pasan limpios.
2. **Post-deploy frontend:** Cloud Build deploya automáticamente. Si rompe, `git revert <hash>` y push.
3. **Post-deploy backend:** copiar manualmente al editor GAS, Implementar → Nueva versión. Si rompe, restaurar versión anterior desde el editor GAS (mantiene historial de versiones desplegadas).
4. **Para cada commit que toque endpoints:** mantener el endpoint legacy durante 1 semana antes de borrarlo, para tener fallback.

---

# Decisiones tomadas

> Aquí registramos decisiones de diseño que se toman durante la implementación y que vale la pena recordar. Formato: fecha + decisión + razón.

- **2026-04-27:** Se opta por Etapa 1 → 2 → 3 → 4 secuencialmente, validando 2-3 días entre etapas en producción. No paralelizar etapas para minimizar riesgo de regresión combinada.

---

# Estado consolidado

**Etapa 1 — Quick wins:** ✅ 6 / 6 completados, desplegados en producción y validados (commits `e3b5b24` + `dba3c97`).
**Etapa 2 — Estructurales:** ✅ 6 / 6 completados, desplegados en producción y validados (commits `b46053a` + `d921008` + `be7673f` + `f3ca6a7` + `108fa79`).
**Etapa 3 — Mayores:** 0 / 4 completados.
**Etapa 4 — Avanzadas:** descartadas o pospuestas.

**Próximo ítem a tomar:** Etapa 3 — orden recomendado por impacto/riesgo: **3.3** (code-splitting frontend, riesgo bajo, mejora UX inmediata) → **3.2** (diffing en polling, alto retorno cuando volumen crezca) → **3.1** (paginación server-side, el más complejo, dejar para cuando se sienta lento) → **3.4** (archivado de PROCESADO antiguas, solo si la sheet pasa los 1000 registros). Ver detalle en cada sección de Etapa 3 más abajo.

---

*Última actualización: 2026-04-27 (post-deploy Etapa 2 completa + auditoría `108fa79`)*
