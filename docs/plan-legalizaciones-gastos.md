# Plan de desarrollo: Carga de legalizaciones de gastos (solicitantes y pasajeros)

> **Estado:** APROBADO, pendiente de desarrollo. Documento autocontenido para implementar en otro momento / desde otro equipo. No requiere la conversación original.
>
> **Origen:** reunión 2026-05-28 (Juan Camilo Pineda + David Sánchez). Transcripción original: "Legalizaciones técnicos energia" (Notas de Gemini).

---

## 1. Contexto y problema

El personal técnico (y viajeros en general) recibe anticipos de viaje pero **no legaliza los gastos**, acumulando hasta 3 viajes sin reportar, lo que impide contabilizarlos a tiempo. Hoy el proceso es manual y disperso.

**Objetivo:** integrar la carga de evidencias (fotos/PDF de facturas y soportes de pago) directamente en el portal de viajes, para que **solicitantes y pasajeros** suban sus soportes tras el viaje. Los archivos quedan en una **subcarpeta "Legalizaciones"** dentro de la carpeta de Drive de cada solicitud (la misma estructura que ya usa el área de compras / Wendy), y el admin puede ver qué solicitudes tienen legalizaciones cargadas y entrar a la carpeta para gestionarlas en sistemas externos.

**Resultado esperado:** un botón pequeño y fácil de usar en dashboard/detalle; cualquier persona vinculada a la solicitud (solicitante o pasajero) sube fotos/PDF; archivos organizados en subcarpeta; visibilidad para el admin.

## 2. Decisiones tomadas (cerradas con David)

1. **Recordatorios automáticos**: NO en este alcance → **Fase 2**.
2. **Vista del pasajero**: **limitada**. Un pasajero que no creó la solicitud ve datos del viaje (ruta, fechas, hotel) + botón de legalizar, pero NO ve costos, aprobaciones, ni acciones de solicitante (anular/modificar). **La restricción se aplica server-side**, no solo ocultando en UI.
3. **Ventana de carga**: solo en estados **RESERVADO y PROCESADO** (mismo criterio que el botón actual "Cargar Facturas").

## 3. Fuera de alcance (explícito)

- **Recordatorios automáticos** por correo/trigger: Fase 2.
- **Macro de Excel** para generar la plantilla del equipo administrativo (mencionada en la reunión): es una herramienta separada de Excel, **NO** parte de este aplicativo.
- Gestión/aprobación de legalizaciones dentro del app: compras solo VE que se cargaron y entra a Drive; la gestión ocurre en sistemas externos.

## 4. Enfoque general

Reutilizar al máximo la infraestructura existente de subida de archivos y carpetas de Drive (ver Apéndice A). El cambio tiene 3 piezas:

1. **Subir legalizaciones** a una subcarpeta dentro de la carpeta de la solicitud, marcadas con flag `isLegalization: true`.
2. **Dar visibilidad a los pasajeros** de las solicitudes donde figuran (hoy solo las ve el solicitante), con vista limitada server-side.
3. **Mostrar al admin** qué solicitudes tienen legalizaciones + acceso a la subcarpeta.

---

## 5. Cambios — Backend (`server/Code.gs`)

### B1. Helper de ownership `_userCanAccessRequest_(row|mappedReq, email)`
Retorna la relación del usuario con la solicitud:
- `'ANALYST'` si `isUserAnalyst(email)`,
- `'REQUESTER'` si `requesterEmail === email`,
- `'PASSENGER'` si el email ∈ `CORREOS PASAJEROS (JSON)` **o** su cédula (resuelta vía `_getRequesterCedulaMap_()`) ∈ `{CÉDULA PERSONA 1..5}`,
- `null` si no tiene relación (sin acceso).

Espeja la lógica cédula-primaria / email-fallback que ya usa la detección `isProxyRequest` (ver Apéndice B, Code.gs:5979-5998).

### B2. Sanitizador `_sanitizeRequestForPassenger_(reqObj)`
Dado un objeto de `mapRowToRequest`, devuelve copia con campos sensibles vaciados:
`finalCostTickets`, `finalCostHotel`, `totalCost`, `approvalStatusArea/CDS/CEO/BudgetOverrun`, todos los `effectiveApproval*`, `budgetApproverEmail/Name`, `creditCard`, `selectionDetails`, `analystOptions`.
Conserva: ruta, fechas, `passengers`, hotel, `status`, `supportData` (para ver/subir legalizaciones), `requestMode`, `requestId`, `timestamp`. Agrega `viewerRelation: 'PASSENGER'`.

### B3. Extender `getMyRequestsLite(email)` (Code.gs:4163) y `getRequestsByEmail(email)` (Code.gs:4067)
Además de filas con `CORREO ENCUESTADO === email`, incluir filas donde el usuario es pasajero (B1).
- Solicitante → objeto normal con `viewerRelation:'REQUESTER'`.
- Pasajero → pasar por B2 (`viewerRelation:'PASSENGER'`).
- Dedup por ID se mantiene; si es solicitante Y pasajero, gana REQUESTER (vista completa).
- Costo: solo +1 parse de `CORREOS PASAJEROS (JSON)` por fila ya leída → overhead despreciable.

### B4. Extender dispatch `getRequestById` (Code.gs:662-675)
Hoy permite acceso solo si `requesterEmail === currentUserEmail` o analyst. Cambiar a usar B1: si la relación es `PASSENGER` → aplicar B2 antes de retornar; si no hay relación → `null` (igual que hoy).

### B5. Nuevo endpoint `uploadLegalization(requestId, fileData, fileName, mimeType, note, currentUserEmail)`
Patrón de `uploadSupportFile` (Code.gs:5267) con diferencias:
- **Validación de ownership** (B1): si no es requester/passenger/analyst → `throw`.
- **Validación de estado**: status debe ser `RESERVADO` o `PROCESADO`, sino `throw`.
- **Subcarpeta**: helper nuevo `_getOrCreateLegalizationSubfolder_(requestId, rowNumber, sheet, supportData)`:
  - obtiene la carpeta raíz con `getOrCreateRequestFolder_`;
  - si `supportData.legalizationFolderId` no existe, crea `folder.createFolder('Legalizaciones')` (vía `_driveRetry_`) y guarda `legalizationFolderId` + `legalizationFolderUrl` en el JSON;
  - retorna la subcarpeta.
- Sube el archivo a esa subcarpeta y aplica `setSharing(ANYONE_WITH_LINK, VIEW)`.
- Agrega entrada a `supportData.files`: `{ id, name, url, mimeType, date, isLegalization: true, uploadedBy: currentUserEmail, note: note || '' }`.
- Reusa `validateFileUpload_` (ya acepta PDF + imágenes, 10MB).
- Llama `_recordEvent_(requestId, 'legalizationUploaded', { email })` para métricas / Fase 2.
- Retorna el `supportData` actualizado (igual que `uploadSupportFile`).

### B6. Registrar en dispatch (Code.gs:558 y ~688)
- Agregar `'uploadLegalization'` al array `isWriteAction`.
- **NO** agregarlo a `adminOnlyActions` (cualquier sesión válida puede usarlo; el control de acceso fino lo hace B1 dentro de la función).
- Agregar el case:
  ```js
  case 'uploadLegalization':
    result = uploadLegalization(payload.requestId, payload.fileData, payload.fileName, payload.mimeType, payload.note, currentUserEmail);
    break;
  ```

---

## 6. Cambios — Frontend

### F1. `types.ts`
- `SupportFile`: agregar `isLegalization?: boolean; uploadedBy?: string; note?: string;`
- `SupportData`: agregar `legalizationFolderId?: string; legalizationFolderUrl?: string;`
- `TravelRequest`: agregar `viewerRelation?: 'REQUESTER' | 'PASSENGER' | 'ANALYST';`

### F2. `services/gasService.ts`
Agregar `uploadLegalization(requestId, fileData, fileName, mimeType, note?)` copiando el patrón de `uploadSupportFile` (gasService.ts:382). `sessionToken` + `userEmail` se inyectan solos en `runGas`.

### F3. Nuevo `components/LegalizationUploadModal.tsx`
Modal **add-only** simplificado (vs `SupportUploadModal`, que tiene delete + finalize propios del admin). Reutiliza de `SupportUploadModal`: `readFileAsBase64`, `ConfirmationDialog`, validación de tamaño (10MB) y `accept=".pdf,image/*"`.
- Lista las legalizaciones ya cargadas (`supportData.files.filter(f => f.isLegalization)`) con link de descarga + link a la subcarpeta (`legalizationFolderUrl`).
- Permite stage + subir nuevos archivos vía `gasService.uploadLegalization`.
- Campo opcional de **nota corta** (concepto/monto) por lote — alimenta la Fase 2 (macro Excel).
- Sin borrar, sin finalizar. Disponible para solicitante y pasajeros.
- Guard `loading` contra doble-click / cierre a mitad de subida (igual que `SupportUploadModal`).

### F4. `components/UserDashboard.tsx`
- Recibir `userEmail` como prop (hoy no lo recibe) o usar `req.viewerRelation`.
- En cada card con `status ∈ {RESERVADO, PROCESADO}`: botón pequeño **"📋 Legalizar gastos"** que abre `LegalizationUploadModal`.
- Cards de pasajero (`viewerRelation === 'PASSENGER'`): badge "PASAJERO", **ocultar** "Anular", "Ver Detalle" abre el detalle ya sanitizado por backend. Gatear "Anular" a `viewerRelation === 'REQUESTER'` (o `req.requesterEmail === userEmail`).

### F5. `components/RequestDetail.tsx`
- Recibir `currentUserEmail` (App.tsx tiene `userEmail`, hoy no se pasa — agregar prop).
- Nueva sección **"Legalizaciones de gastos"** después de "Confirmación de Reserva" (~línea 662): lista archivos `isLegalization`, link a subcarpeta, botón "Legalizar gastos" (si RESERVADO/PROCESADO).
- Si `viewerRelation === 'PASSENGER'`: gatear (ocultar) secciones de costos/aprobaciones — el backend ya las vacía, pero se ocultan para no renderizar shells vacíos.

### F6. `components/AdminDashboard.tsx`
- Badge por solicitud cuando `supportData.files` tiene entradas `isLegalization` (ej. "📋 N legaliz."), junto a los badges existentes (~línea 584). El acceso a la subcarpeta queda disponible vía RequestDetail (F5).

### F7. `App.tsx`
- Pasar `userEmail` a `UserDashboard` (F4) y `RequestDetail` (F5). El flujo `getMyRequestsLite` / `bootstrap` ya traerá las solicitudes de pasajero sin cambios extra.

---

## 7. Estructura en Drive

```
ROOT_DRIVE_FOLDER_ID/
  └── SOL-000123 - <PNR> - <TC> - <MES>/        (carpeta de solicitud existente)
        ├── Reserva_<PNR>_SOL-000123.pdf          (existente)
        ├── <facturas de compras>                  (existente, isReservation/isCorrection)
        └── Legalizaciones/                        (NUEVA subcarpeta)
              ├── Legalizacion_SOL-000123_<n>.jpg
              └── ...
```

## 8. Riesgos + mitigaciones

| Riesgo | Mitigación |
|---|---|
| Pasajero ve info financiera | Sanitización **server-side** (B2) en lista y detalle, no solo UI. |
| Pasajero sin email en `CORREOS PASAJEROS` no ve su solicitud | Matching también por **cédula** (B1), que siempre se captura. |
| Subir a subcarpeta falla por hipo de Drive | `_driveRetry_` envuelve `createFolder`/`createFile`; si falla, `throw` + error legible en front. |
| Usuario intenta legalizar solicitud ajena | B1 valida ownership en el endpoint (`throw`). |
| Carga antes de que ocurra el viaje | Gate de estado RESERVADO/PROCESADO (B5) + botón solo visible en esos estados (F4/F5). |
| `getMyRequestsLite` más pesado | Solo +1 parse JSON por fila ya leída; impacto despreciable. |
| Doble click en subir | Reusar guard `loading` del patrón de `SupportUploadModal`. |

## 9. Verificación end-to-end

Probar en **entorno clonado** (sheet + GAS + `.env.local`), nunca en prod primero:

1. **Solicitante sube legalización** (RESERVADO): archivo en subcarpeta `Legalizaciones`, con `isLegalization:true`; visible en detalle y badge admin.
2. **Pasajero inicia sesión**: ve la solicitud donde figura (vista limitada), sube evidencia OK.
3. **Pasajero NO ve costos/aprobaciones**: inspeccionar respuesta de red de `getRequestById`/`getMyRequestsLite` — campos financieros vacíos.
4. **Acceso denegado**: usuario que no es requester ni pasajero llama `getRequestById`/`uploadLegalization` → `null`/`throw`.
5. **Gate de estado**: subir en estado ≠ RESERVADO/PROCESADO → bloqueado (botón oculto + `throw`).
6. **Matching por cédula**: pasajero cuyo email no está en `CORREOS PASAJEROS` pero sí su cédula → ve la solicitud.
7. **Admin**: ve badge de legalizaciones y entra a la subcarpeta desde el detalle.
8. **Tipos de archivo**: PDF e imagen aceptados; >10MB rechazado.
9. `npx tsc --noEmit` limpio + `npm run build` OK.
10. Deploy: pegar `Code.gs` en editor GAS + nueva versión de implementación; frontend build + deploy Cloud Run.

## 10. Fases de implementación

1. **Backend lectura/escritura** (B1-B6): helpers, extensión de queries + getRequestById, endpoint nuevo, dispatch.
2. **Frontend tipos + servicio + modal** (F1-F3).
3. **Frontend dashboards + detalle** (F4-F7).
4. **Smoke test** en clon con los 10 puntos de verificación.
5. **Deploy** backend (GAS nueva versión) + frontend (Cloud Run).

---

# Apéndice A — Infraestructura existente a reutilizar (referencia de código)

> Estas son las funciones/estructuras YA existentes en el código al momento de escribir el plan. Las líneas son aproximadas (verificar al implementar; el archivo cambia).

### A.1 `uploadSupportFile(requestId, fileData, fileName, mimeType, correctionNote)` — `server/Code.gs` ~5267
- `fileData` = string **base64** (se decodifica con `Utilities.base64Decode()`).
- Valida con `validateFileUpload_`, localiza carpeta con `getOrCreateRequestFolder_`, sube con `folder.createFile(blob)` (vía `_driveRetry_`), actualiza columna `SOPORTES (JSON)`.
- **Es el patrón base del nuevo `uploadLegalization`.**

### A.2 Estructura de `SOPORTES (JSON)` (columna del sheet)
```js
{
  folderId: string,      // ID carpeta raíz de la solicitud en Drive
  folderUrl: string,
  files: [
    {
      id: string,          // Drive file ID
      name: string,
      url: string,         // https://drive.google.com/file/d/{id}/view?usp=sharing
      mimeType: string,
      date: string,        // ISO
      isReservation?: boolean,   // archivos de reserva (registerReservation)
      isCorrection?: boolean     // archivos de corrección
      // NUEVO a agregar: isLegalization?: boolean, uploadedBy?: string, note?: string
    }
  ]
  // NUEVO a agregar: legalizationFolderId?: string, legalizationFolderUrl?: string
}
```

### A.3 Carpetas en Drive
- `getOrCreateRequestFolder_(requestId, rowNumber, sheet)` ~Code.gs:4914 — localiza (vía `_findRequestFolder_`, 3 capas: cache folderId en SOPORTES → search en ROOT → wide search validando descendencia) o crea la carpeta como hija directa de `ROOT_DRIVE_FOLDER_ID`.
- **No existe helper de subcarpetas**: para "Legalizaciones" usar `folder.createFolder('Legalizaciones')` directamente y guardar su id/url en el JSON (helper B5).
- `_driveRetry_(fn, label)` ~Code.gs:4756 — reintenta 1 vez tras 1.5s ante errores transient de Drive. Envolver todas las ops de Drive.
- `ROOT_DRIVE_FOLDER_ID` definido ~Code.gs:52.

### A.4 `validateFileUpload_(fileData, fileName, mimeType)` ~Code.gs:4964
- Acepta: `application/pdf`, `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `.xlsx`, `.xls`, y cualquier `image/*`.
- Límite: **10 MB** (`MAX_FILE_SIZE_BYTES`).
- Sanitiza el nombre (`[/\\:*?"<>|]` → `_`, trunca a 200). Retorna el nombre sanitizado.
- **Sirve tal cual para legalizaciones.**

### A.5 Subida múltiple (referencia) — `registerReservation` ~Code.gs:2564
- Itera `files.map(...)` subiendo cada uno con `_driveRetry_` y nombrándolos `Reserva_<PNR>_<idx>_<requestId>`. Útil como patrón si el modal sube varios.

### A.6 Cliente `services/gasService.ts`
- `runGas(action, payload)` (~línea 74) inyecta `sessionToken` + `userEmail` automáticamente; timeout 30s.
- `uploadSupportFile(requestId, fileData, fileName, mimeType)` (~línea 382): hace `runGas('uploadSupportFile', {...})`, lanza si `!response.success`, retorna `response.data` (= SupportData). **Copiar este patrón para `uploadLegalization`.**
- En `SupportUploadModal.tsx`: `readFileAsBase64` (~línea 100) usa `FileReader.readAsDataURL` y toma `.split(',')[1]`. `accept=".pdf,image/*,.xlsx,.xls"` (~línea 346). Validación tamaño 10MB (~línea 64).

---

# Apéndice B — Modelo de visibilidad y seguridad actual (referencia de código)

### B.1 Filtrado por usuario (hoy solo solicitante)
- `getMyRequestsLite(email)` ~Code.gs:4163 y `getRequestsByEmail(email)` ~Code.gs:4067: filtran filas comparando `CORREO ENCUESTADO` (lowercase/trim) contra el email. Dedup por `ID RESPUESTA` con `Map` (primera ocurrencia gana). Mapean con `mapRowToRequest(row, lite)` y `.reverse()`.
- **Punto exacto a extender** para incluir pasajeros (B3 del plan).

### B.2 Pasajeros en la fila
- Escritura en `createNewRequest` ~Code.gs:4633: `set("CORREOS PASAJEROS (JSON)", JSON.stringify(data.passengers.map(p => p.email).filter(e=>e)))` → **array de emails** (índices alineados con `CÉDULA/NOMBRE PERSONA 1..5`). Solo incluye emails no vacíos.
- Lectura en `mapRowToRequest` ~Code.gs:5839: parsea ese JSON y arma `passengers[] = { name, idNumber, email }` (email = `pEmails[i-1] || ''`).
- Interfaz `Passenger` en `types.ts` ~línea 22: `{ name: string; idNumber: string; email?: string }`.
- ⚠️ El email del pasajero **puede venir vacío** → por eso B1 matchea también por cédula.

### B.3 Carga del dashboard
- `bootstrap(integrantesHash, sessionEmail, sessionToken)` ~Code.gs:4245: valida sesión, calcula rol server-side, y carga `getAllRequestsLite()` (admin) o `getMyRequestsLite(sessionEmail)` (usuario). Rol NO se confía del cliente.
- Frontend: `App.tsx` llama `bootstrap` al login; `userEmail` está en estado (~App.tsx:121). `RequestDetail` recibe `isAdmin={isEffectiveAdmin}` (~App.tsx:976) pero **hoy no recibe `userEmail`** → agregarlo (F5/F7).
- Al abrir detalle, App hidrata con `getRequestById` (flujo `hydratingDetail`).

### B.4 Ownership en `getRequestById` (dispatch)
- `getRequestById(requestId)` ~Code.gs:4198 solo busca y mapea (sin check).
- El **check está en el dispatch** ~Code.gs:662-675: si NO es analyst y `requesterEmail !== currentUserEmail` → retorna `null`. **Punto exacto a extender** (B4 del plan).

### B.5 Detección de proxy (patrón a espejar para B1)
- `isProxyRequest` se calcula en `mapRowToRequest` ~Code.gs:5979-5998: usa `_getRequesterCedulaMap_()` (email→cédula desde hoja USUARIOS) para comparar la cédula del solicitante contra `passengers[].idNumber`; fallback por email. **Misma técnica cédula-primaria/email-fallback que debe usar B1.**
- `_getRequesterCedulaMap_()` ~Code.gs:5766: construye y cachea `{ email_lower → cedula }` leyendo la hoja USUARIOS (A=Cédula, B=Nombre, C=Correo).

### B.6 Capas de seguridad del dispatch (~Code.gs:557-606)
- `isWriteAction` (~558): lista de acciones que toman LockService. **Agregar `uploadLegalization`.**
- `sessionExemptActions` (~574): acciones sin sesión (login). `uploadLegalization` NO va aquí → requiere sesión.
- `adminOnlyActions` (~589): acciones solo-analyst. **`uploadLegalization` NO va aquí** (lo usan usuarios normales).
- `superAdminOnlyActions` (~602): no aplica.
- Patrón de ownership a imitar: `cancelOwnRequest` ~Code.gs:7152 valida `rowEmail === currentUserEmail` antes de actuar.

---

# Apéndice C — Componentes frontend relevantes (referencia de código)

- `components/SupportUploadModal.tsx` — modal admin de soportes (upload + delete + finalize). **Base para clonar** el nuevo `LegalizationUploadModal` (versión add-only). Props: `{ request, onClose, onSuccess }`. Filtra existentes con `request.supportData?.files`. Sube con `gasService.uploadSupportFile`. Guard `handleClose` contra cierre durante `loading`.
- `components/UserDashboard.tsx` — grid de cards (PAGE_SIZE 50). Botón "Anular" (~línea 165) y "Ver Detalle" (~línea 174). Badges en ~línea 113-133. **Aquí va el botón "Legalizar gastos".**
- `components/RequestDetail.tsx` — modal de detalle. Sección "Confirmación de Reserva" ~línea 607-662 (renderiza archivos descargables filtrando `f.isReservation`). **La sección de legalizaciones va después de ~línea 662.** Patrón de archivo descargable: `<a href={f.url} target="_blank" rel="noopener noreferrer">📄 {f.name}</a>`.
- `components/AdminDashboard.tsx` — tabla. Badges/íconos ~línea 544-584 (⭐ prioritaria, 👥 proxy, INTL, $$$). Botones por estado; "Cargar Facturas" aparece en RESERVADO/PROCESADO ~línea 682-716. **Aquí va el badge "📋 N legaliz."**
- `types.ts` — `SupportFile` ~línea 54, `SupportData` ~línea 64, `TravelRequest` ~línea 70, `Passenger` ~línea 22.
- `services/gasService.ts` — `uploadSupportFile` ~línea 382; `runGas` ~línea 74.
