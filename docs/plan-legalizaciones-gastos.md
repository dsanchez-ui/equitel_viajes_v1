# Plan de desarrollo: Módulo de Legalizaciones de Gastos (V2)

> **Estado:** APROBADO en reunión 2026-06-01. Pendiente de desarrollo.
>
> **V2 reemplaza al V1.** V1 contemplaba carga de soportes *anidada* a solicitudes de viaje existentes; V2 lo amplía a un **módulo independiente** de legalizaciones que puede o no estar vinculado a un viaje, con OCR, gate de pendientes, export CSV a Labroides y dashboard de KPIs. El V1 queda como caso particular del V2 (sub-feature) y se preserva en el Apéndice D como histórico.
>
> **Origen:**
> - Reunión 2026-05-28 (Juan Camilo Pineda + David Sánchez) — alcance inicial V1.
> - Reunión 2026-06-01 (Yesid Roncancio, Juan Sebastian Cañón, Juan Camilo Pineda, Santiago Gómez, David Sánchez) — re-alineación a V2.

---

## 1. Contexto y problema

### Síntomas reportados
- El personal técnico recibe **anticipos/viáticos** pero no legaliza los gastos a tiempo. Llegan a acumular hasta **3 viajes/viáticos sin reportar**, lo que bloquea el cierre contable mensual (testimonio Juan Camilo, Yesid).
- El aplicativo actual de legalizaciones de la empresa es **Labroides Web** (también llamado "Abroides Web"), construido hace ~1 año por Alejo del equipo IT. Conecta a Labroides para contabilidad.
- Labroides Web tiene problemas conocidos (testimonio Juan Sebastian Cañón):
  - Es tedioso para los técnicos → "les da pereza y no lo hacen".
  - Frecuentes fallas → un técnico se demoró **2 meses** legalizando.
  - **Los líderes/aprobadores NO pueden extraer reportes dinámicos** con alertas para hacer seguimiento.
  - Falta visibilidad agregada por equipo / coordinador / técnico.

### Aclaración crítica del 2026-06-01 (Juan Sebastian Cañón)
> "**Todos los viáticos NO son de viajes.**" Ejemplo: un técnico puede pedir viáticos para Mosquera (trabajo nocturno) sin que haya un tiquete o transporte involucrado.

Esto **invalida** la suposición del V1 (carga atada a una solicitud `RESERVADO/PROCESADO` existente) como única vía: muchos viáticos no tienen viaje. Se requiere un módulo de legalizaciones que pueda existir **sin** una solicitud de viaje vinculada.

### Decisión arquitectónica (David Sánchez, validada por el grupo)
Quitel Viajes pasa a ser el **REPOSITORIO DE INTAKE Y MONITOREO** de legalizaciones, **NO** el sistema autoritativo. Labroides sigue siendo el sistema contable.

- **Etapa 1 (este plan, ~1 mes):** Quitel Viajes recibe las legalizaciones (upload + OCR + tracking + alertas + KPI dashboard) y exporta un **CSV** que el técnico sube manualmente a Labroides.
- **Etapa 2 (post-reunión con Julio, dev de Labroides):** integración directa Quitel ↔ Labroides vía API. Elimina el paso del CSV manual.

---

## 2. Visión y arquitectura del módulo

### Concepto
Cada **Legalización** es una entidad propia con:
- Owner: el técnico (o cualquier usuario) que la cargó.
- Vínculo obligatorio a una **OT (Orden de Trabajo)**.
- Vínculo **opcional** a una solicitud de viaje existente (cuando el viático SÍ vino de un viaje gestionado por Quitel).
- Una o más **fotografías/PDF** del soporte (factura, recibo, screenshot de Uber, etc.).
- Datos extraídos por **OCR**: fecha de factura, monto. El usuario puede editarlos.
- Descripción/concepto libre del usuario.
- Estado en el ciclo de vida (PENDIENTE_CARGUE → CARGADA → EXPORTADA_CSV → PROCESADA_LABROIDES → opcionalmente RECHAZADA).
- Timestamp de creación, OCR, export, etc. (para métricas y alertas).

### Flujo del técnico
1. Ingresa al portal → sección **"Mis Legalizaciones"** (nueva).
2. Pulsa **"Nueva legalización"**. Sube 1 o más fotos/PDF.
3. **OCR** procesa cada imagen → propone fecha, monto, proveedor.
4. Usuario verifica/corrige → ingresa OT obligatoria, descripción, opcionalmente vincula a solicitud de viaje (lista de viajes propios o donde es pasajero).
5. Guarda → estado **PENDIENTE_CARGUE**. Empieza el timer.
6. Cuando el técnico decide cerrar un batch: selecciona N pendientes → **"Generar CSV para Labroides"** → descarga el archivo → marca esas legalizaciones como **EXPORTADA_CSV**. Las sube manualmente a Labroides.

### Flujo del aprobador / líder
- Accede al **Dashboard de Legalizaciones** (panel nuevo o sección del dashboard de costos existente).
- Ve agregados por equipo:
  - # legalizaciones pendientes por técnico
  - Días máx. pendientes (cuál es el más atrasado)
  - Alertas vencidas (más de X días)
  - Histograma mensual de legalizaciones cargadas vs exportadas
- Filtros: por aprobador (auto-detectado del directorio), por sede, por centro de costo.
- **No aprueba** legalizaciones (la aprobación contable ocurre en Labroides). Solo monitorea.

### Flujo del admin/compras (Wendy)
- Ve el dashboard global con TODAS las legalizaciones.
- Puede consultar el detalle de cada una y descargar sus archivos.
- Genera reportes globales (todos los equipos, todas las fechas).

### Gates duros del sistema
- **Si un usuario tiene >3 legalizaciones en estado PENDIENTE_CARGUE**, el sistema bloquea:
  - Crear nueva legalización (mensaje claro: "Tienes 3 legalizaciones pendientes. Cárgalas a Labroides antes de crear nuevas.").
  - Crear nueva solicitud de viaje (`createNewRequest` rechaza con el mismo mensaje).
- El gate se libera cuando alguna pendiente pasa a estado EXPORTADA_CSV o se cancela.

### Alertas automáticas
- Trigger por tiempo (cada N horas en horario laboral, similar a los recordatorios de aprobación existentes).
- Para cada legalización en PENDIENTE_CARGUE, calcula días desde la **fecha de factura** (extraída por OCR).
- Umbrales:
  - Día 7 → recordatorio amarillo al técnico.
  - Día 15 → recordatorio rojo al técnico + CC aprobador.
  - Día 30 → escalamiento a superadmin/admin.
- Idempotente por umbral (no re-envía el mismo nivel).

---

## 3. Decisiones cerradas en la reunión 2026-06-01

1. **Legalizaciones independientes de viajes**. OT obligatoria. Vínculo a viaje opcional.
2. **OCR para extracción de fecha + monto** desde la imagen. (Tecnología → ver §5 TBD.)
3. **Gate de 3 pendientes**: bloquea nuevas legalizaciones **y** nuevas solicitudes de viaje.
4. **Export CSV** como entregable de Etapa 1. El técnico genera, descarga y sube manualmente a Labroides. (Formato exacto del CSV → ver §5 TBD, requiere reunión con Julio.)
5. **Alertas automáticas** con timer desde fecha de factura.
6. **Dashboard de KPIs para aprobadores** con métricas por técnico/equipo.
7. **Etapa 1 entregable en ~1 mes**. Etapa 2 (integración Labroides) post-reunión Julio.
8. **Quitel NO maneja flujo de aprobación de legalizaciones**: la aprobación contable es de Labroides. Quitel es intake + monitoreo.

---

## 4. Fuera de alcance de Etapa 1 (Etapa 2 o externo)

- **Integración directa con Labroides** (vía API o webhook): Etapa 2. Pendiente reunión con Julio para definir contrato.
- **Aprobación contable de legalizaciones**: NUNCA va a Quitel; vive en Labroides.
- **Reemplazo de Labroides**: el sistema sigue siendo autoritativo; Quitel es complemento.
- **Pagos / conciliación bancaria**: fuera del scope total del aplicativo.
- **Carga masiva de legalizaciones históricas**: si se requiere, abordar como migración aparte.

---

## 5. Decisiones pendientes (TBD)

Estas decisiones NO bloquean el inicio del diseño, pero se deben cerrar antes de empezar la implementación. El campo "Default propuesto" es lo que asumo si nadie objeta; el campo "Confirmar con" indica con quién validar.

| # | Tema | Pregunta | Default propuesto | Confirmar con |
|---|---|---|---|---|
| TBD-1 | **Tecnología OCR** | ¿Gemini Vision (ya hay `GEMINI_API_KEY`) vs Google Cloud Vision API vs Document AI? | **Gemini Vision** — más simple, ya disponible, sin nuevo billing. Costo ~$0 para los volúmenes esperados. | David |
| TBD-2 | **Quién puede usar el módulo** | ¿Cualquier usuario registrado, o solo un rol `TÉCNICO` específico? | **Cualquier usuario registrado**. La transcripción habla de "técnicos" porque son el público mayoritario, pero cualquier persona con viáticos debería poder usarlo. | David |
| TBD-3 | **Vínculo opcional a viaje** | ¿La legalización puede asociarse a viajes donde el usuario es solicitante O pasajero (V1 logic), o solo a viajes que el usuario creó? | **Solicitante O pasajero** — reutiliza la lógica de visibilidad del V1. | David |
| TBD-4 | **Estructura en Drive** | ¿Cómo organizar las carpetas? Opciones: (a) por técnico → por mes (`LEGALIZACIONES/<email>/2026-06/`), (b) por mes → por técnico, (c) flat con prefijos. | **(a) por técnico → por mes** — facilita auditoría por persona, la más solicitada por aprobadores. | David, Wendy |
| TBD-5 | **Formato del CSV** | Columnas exactas, separador, encoding, formato de fecha y monto. | **TBD bloqueante** — requiere reunión con Julio/dev Labroides para conocer formato que Labroides acepta para importación masiva. | Julio (Labroides) |
| TBD-6 | **Umbrales de alertas** | ¿Días para alerta amarilla / roja / escalamiento? | **7 / 15 / 30** desde fecha de factura. | David, Yesid |
| TBD-7 | **Gate 3-pendientes — alcance** | ¿El bloqueo aplica a TODO usuario o solo a técnicos? ¿Se acepta override por superadmin? | **Aplica a todo usuario**. Superadmin puede override desde el panel. | David |
| TBD-8 | **Confianza del OCR** | Si OCR no detecta fecha/monto, ¿qué hacer? | **Permitir guardar sin esos campos** (el técnico los digita manualmente). Marcar la legalización con flag `ocrFailed:true`. | David |
| TBD-9 | **Validación de OT** | ¿Se cruza la OT contra una lista maestra? ¿Se valida formato? | **Solo validación de formato** (`/^OT[-\s]?\d+/i`, igual que `_esOTValida_`). Sin maestro de OTs por ahora. | David |
| TBD-10 | **Identidad para alertas** | ¿A quién se notifica si la legalización vincula a un viaje donde el solicitante NO es el dueño de la legalización? | **Solo al dueño de la legalización + su aprobador.** El solicitante del viaje no recibe (no es su gasto). | David |

---

## 6. Modelo de datos

### Nuevo sheet: `LEGALIZACIONES`

| Columna | Tipo | Notas |
|---|---|---|
| `ID LEGALIZACIÓN` | string | Formato `LEG-000001` (secuencial, helper `_computeNextLegalizationIdNum_`). |
| `FECHA CREACIÓN` | Date | Timestamp de creación en Sheets. |
| `CORREO USUARIO` | string | Dueño de la legalización (lower+trim). |
| `CÉDULA USUARIO` | string | Resuelto del directorio USUARIOS para trazabilidad. |
| `CORREO APROBADOR` | string | Resuelto del directorio (auto). Para alertas y dashboard. |
| `# ORDEN TRABAJO` | string | OT obligatoria. Validar formato `^OT[-\s]?\d+`. |
| `ID SOLICITUD VIAJE VINCULADA` | string | Opcional. Si está, debe ser una solicitud del usuario (solicitante o pasajero). |
| `FECHA FACTURA (OCR)` | Date \| string | Extraída por OCR; editable. ISO o `DD/MM/YYYY`. |
| `VALOR FACTURA (OCR)` | number | Extraído por OCR; editable. COP. |
| `PROVEEDOR (OCR)` | string | Extraído por OCR (best-effort); editable. |
| `TEXTO OCR CRUDO` | string | Para debugging y auditoría. Truncado a 2000 chars. |
| `DESCRIPCIÓN/CONCEPTO` | string | Manual, máx 500 chars. |
| `STATUS` | string enum | `PENDIENTE_CARGUE` (default), `EXPORTADA_CSV`, `PROCESADA_LABROIDES`, `RECHAZADA`. |
| `FECHA EXPORTADA_CSV` | Date | Cuándo se generó el CSV que la incluyó. |
| `ID BATCH CSV` | string | Para agrupar varias legalizaciones del mismo export. |
| `FOTOS (JSON)` | string | Array de `{ id, name, url, mimeType, date }` (mismo patrón que `SOPORTES (JSON)`). |
| `OCR_FAILED` | string | `"SI"` si OCR no logró extraer datos clave. |
| `OBSERVACIONES` | string | Notas del sistema o del usuario (anulaciones, correcciones). |
| `EVENTOS_JSON` | string | Timestamps de eventos (`created`, `ocrCompleted`, `exported`, etc.) para métricas. |

### Cambios en el sheet existente `Nueva Base Solicitudes`
Ninguno obligatorio. La verificación del gate de 3 pendientes lee `LEGALIZACIONES` directo.

### Carpetas en Drive
```
ROOT_DRIVE_FOLDER_ID/
  └── LEGALIZACIONES/                          (NUEVA carpeta global, creada lazy)
        └── <correo_usuario>/                   (subcarpeta por técnico)
              └── 2026-06/                       (subcarpeta por mes-año)
                    ├── LEG-000123_<n>.jpg
                    └── LEG-000123_<n>.pdf
```

(Decisión TBD-4: por-técnico → por-mes. Cambiar si Wendy prefiere otro layout.)

### Subcarpeta legacy V1 (compatibilidad)
Para legalizaciones vinculadas a una solicitud de viaje, **también** se mantiene el shortcut V1: una copia de los archivos puede vivir en la subcarpeta `Legalizaciones/` dentro de la carpeta de la solicitud (ver Apéndice D). Decisión: NO duplicar — los archivos solo viven en la carpeta canónica de `LEGALIZACIONES/<usuario>/...`, y la solicitud de viaje guarda referencias (IDs/URLs) en su `SOPORTES (JSON)` con `isLegalization:true` para el badge admin y deep-link desde RequestDetail. Esto evita inconsistencias por duplicación.

---

## 7. Cambios — Backend (`server/Code.gs`)

### Constantes y setup
- `SHEET_NAME_LEGALIZACIONES = 'LEGALIZACIONES'` y `HEADERS_LEGALIZACIONES = [...]`.
- `setupDatabase()` extendido: crear sheet con headers si no existe (mismo patrón que `Nueva Base Solicitudes` y `USUARIOS`).
- Constante `LEGALIZATIONS_FOLDER_NAME = 'LEGALIZACIONES'` (carpeta raíz en Drive).
- Constante `MAX_PENDING_LEGALIZATIONS = 3` (gate).

### Helpers nuevos
- `_legalizationIdToRow_(id)` — cache de `LEG-000xxx → rowNumber` análogo a `_REQUEST_ROW_CACHE`.
- `_computeNextLegalizationIdNum_()` — `LEG-000xxx` secuencial.
- `_getOrCreateLegalizationFolder_(userEmail, factureDate)` — crea path `ROOT/LEGALIZACIONES/<userEmail>/<YYYY-MM>/` lazy con `_driveRetry_`.
- `_runOCR_(base64File, mimeType)` — wrapper sobre Gemini Vision (TBD-1). Prompt diseñado para extraer JSON con `{ fecha, monto, proveedor, confianza }`. Maneja fallos → retorna `{ ocrFailed: true }`.
- `_countPendingLegalizations_(userEmail)` — cuenta status PENDIENTE_CARGUE del usuario. Usa la columna `STATUS`.
- `_resolveApproverForUser_(userEmail)` — del directorio USUARIOS, columna `Correos Aprobadores (auto)`. Reusa `getIntegrantesData()` (cache existente).
- `_userOwnsLegalization_(legId, userEmail)` — para autorización en updates/delete.

### Endpoints nuevos (dispatch)
Todos añadidos a `isWriteAction` cuando aplique; ninguno en `adminOnlyActions` para lectura/carga propia; los reportes globales sí en `adminOnlyActions`.

| Endpoint | Auth | Descripción |
|---|---|---|
| `createLegalization` | usuario | Valida gate 3-pendientes, crea fila en `LEGALIZACIONES`, sube archivos a `_getOrCreateLegalizationFolder_`, opcionalmente corre OCR sincrónico en el primer archivo, retorna el objeto creado. |
| `runOcrOnLegalization` | usuario (owner) | Re-corre OCR sobre un archivo específico si el usuario lo solicita. Útil si OCR inicial falló. |
| `updateLegalization` | usuario (owner) | Edita campos manualmente editables: fecha, monto, descripción, OT, vínculo a viaje. Solo en estado `PENDIENTE_CARGUE`. |
| `addLegalizationFiles` | usuario (owner) | Agrega archivos adicionales a una legalización ya creada. |
| `deleteLegalizationFile` | usuario (owner) | Marca un archivo como borrado (trashed). Solo en estado PENDIENTE_CARGUE. |
| `cancelLegalization` | usuario (owner) o admin | Marca status `RECHAZADA` con motivo. Libera el slot del gate. |
| `getMyLegalizations` | usuario | Lista todas las legalizaciones donde `CORREO USUARIO === currentUserEmail`. |
| `getLegalizationById` | usuario (owner) o admin/aprobador | Detalle de una. Aprobador puede leer si es aprobador del owner. |
| `generateLegalizationsCsv` | usuario (owner) | Recibe array de IDs; valida ownership y status `PENDIENTE_CARGUE`; genera CSV con formato TBD-5; marca esas legalizaciones como `EXPORTADA_CSV` con `ID BATCH CSV` único; retorna el contenido del CSV (string) para descarga del frontend. |
| `getLegalizationsDashboard` | admin o aprobador | Agregados por usuario/equipo con filtros (sede, aprobador, fecha). Patrón similar a `getCostsDashboard`. |

### Cambios a endpoints existentes
- **`createNewRequest`** (Code.gs:~4526): al inicio, validar `_countPendingLegalizations_(requesterEmail) <= MAX_PENDING_LEGALIZATIONS`. Si excede, lanzar error con mensaje claro. (Excepción: rol SUPERADMIN puede override.)
- **`getRequestById` y `getMyRequestsLite`**: extender `passengers` para incluir las legalizaciones vinculadas a ese viaje (lookup en `LEGALIZACIONES` por `ID SOLICITUD VIAJE VINCULADA`). El campo nuevo `linkedLegalizations: { count, files: [...] }` aparece en el objeto del viaje. Esto le da al admin/aprobador del viaje visibilidad sin abrir el módulo separado.
- **`mapRowToRequest`**: agregar `linkedLegalizations` derivado.

### OCR — diseño del wrapper `_runOCR_`
```
INPUT: base64 del archivo + mimeType
PROCESO:
  - Llamar a Gemini API con prompt:
    "Eres un extractor de datos de facturas/recibos. Devuelve SOLO un JSON con
     { fecha: 'DD/MM/YYYY' o null, monto: number en COP o null,
       proveedor: string o null, confianza: 0..1 }.
     Si la imagen no es una factura/recibo, fecha y monto serán null."
  - Parsear JSON. Si falla, retornar { ocrFailed: true, raw: <texto> }.
  - Si confianza < 0.5 → marcar ocrFailed=true pero devolver los valores como sugerencia.
SALIDA: { fecha, monto, proveedor, confianza, raw, ocrFailed }
```
Timeout 10s. Errores de red → fail-soft (devuelve `ocrFailed:true`, no rompe la creación).

### Cron / triggers nuevos
- `sendLegalizationReminders()` — recorre `LEGALIZACIONES` en `PENDIENTE_CARGUE`, calcula días desde fecha factura, dispara emails según umbrales (7/15/30). Marca en `EVENTOS_JSON` qué umbrales ya disparó (idempotente).
  - Reusa `isWorkingHour()`, `_sendMail_()`, `MAX_REMINDER_EMAILS_PER_RUN`.
  - Trigger sugerido: cada 4 horas en horario laboral.
- (Reusa el patrón de `sendPendingApprovalReminders()` ya existente.)

### Generación del CSV (estructura propuesta, TBD-5)
Hasta que se cierre con Julio, asumir columnas mínimas:
```
ID_LEGALIZACION;FECHA_FACTURA;VALOR;PROVEEDOR;OT;CONCEPTO;TECNICO_CEDULA;TECNICO_CORREO
LEG-000123;28/05/2026;145000;Uber;OT-12345;Transporte aeropuerto;1023456789;jpineda@equitel.com.co
...
```
Separador `;` (estándar Excel-LATAM), encoding UTF-8 con BOM. Cambiar al cerrar TBD-5.

---

## 8. Cambios — Frontend

### `types.ts`
Nuevas interfaces:
```ts
interface Legalization {
  id: string;                     // LEG-000xxx
  createdAt: string;
  userEmail: string;
  userCedula: string;
  approverEmail: string;
  workOrder: string;
  relatedRequestId?: string;
  invoiceDate?: string;           // editable
  amount?: number;                // editable
  vendor?: string;                // editable
  rawOcrText?: string;
  description?: string;
  status: 'PENDIENTE_CARGUE' | 'EXPORTADA_CSV' | 'PROCESADA_LABROIDES' | 'RECHAZADA';
  exportedAt?: string;
  batchId?: string;
  files: SupportFile[];
  ocrFailed?: boolean;
  observations?: string;
}
interface LegalizationsDashboardRow {
  userEmail: string;
  userName: string;
  approverEmail: string;
  pendingCount: number;
  maxPendingDays: number;
  totalThisMonth: number;
  totalExported: number;
  alerts: { yellow: number; red: number; escalated: number };
}
```

### `services/gasService.ts`
Agregar wrappers para cada endpoint del backend (mismo patrón que `uploadSupportFile`):
- `createLegalization`, `runOcrOnLegalization`, `updateLegalization`, `addLegalizationFiles`, `deleteLegalizationFile`, `cancelLegalization`, `getMyLegalizations`, `getLegalizationById`, `generateLegalizationsCsv`, `getLegalizationsDashboard`.

### Componentes nuevos
- **`components/LegalizationsList.tsx`** — vista principal del usuario. Muestra cards/lista de sus legalizaciones, agrupadas por estado. CTAs: "Nueva legalización", "Generar CSV (N seleccionadas)". Filtros: estado, mes, OT.
- **`components/LegalizationUploadModal.tsx`** — modal de creación. Stages:
  1. Subir archivos (drag-drop, multiple).
  2. Spinner OCR ("analizando soporte...").
  3. Formulario pre-llenado con datos OCR (editables); OT + descripción.
  4. Vincular a viaje (autocomplete con sus viajes propios + de pasajero).
  5. Guardar.
- **`components/LegalizationDetail.tsx`** — detalle: lista de fotos (previews), datos OCR vs editados, historial de eventos. Permite agregar más fotos, cancelar (con motivo).
- **`components/LegalizationsDashboard.tsx`** — para aprobadores/admin. Tabla por usuario con KPIs (pendientes, días, alertas). Reusa filtros y patrón del `CostsDashboard.html` o nuevo modal/sección.
- **`components/CsvExportModal.tsx`** — selección de legalizaciones pendientes a incluir + preview del CSV + botón "Descargar y marcar como exportadas".

### Cambios a componentes existentes
- **`App.tsx`**: nueva ruta/sección "Legalizaciones" en el menú principal del usuario. Para admins/aprobadores: link "Dashboard de Legalizaciones".
- **`RequestForm.tsx`**: al cargar, verificar `getMyLegalizations` y mostrar warning si tiene >3 pendientes; bloquear submit si excede.
- **`RequestDetail.tsx`** (V1 subset): si la solicitud tiene `linkedLegalizations` (cualquier estado), mostrar badge con count + deep-link al detalle de cada una.
- **`AdminDashboard.tsx`**: badge por solicitud cuando tiene legalizaciones vinculadas (count).

---

## 9. Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| **OCR no detecta fecha/monto correctamente** | Alta (varían facturas, manuscritos, fotos malas) | TBD-8: permitir guardar con campos vacíos + edición manual. Marcar `ocrFailed:true`. Trackear tasa de éxito en métricas para iterar prompt. |
| **CSV formato no aceptado por Labroides** | Media | TBD-5 bloqueante: reunión con Julio antes de hardcodear formato. Versionar el CSV con header de versión. |
| **Etapa 2 (integración Labroides) se vuelve dependencia bloqueante** | Media | Etapa 1 está diseñada para vivir sin Etapa 2 (CSV manual es viable indefinidamente). |
| **Gate de 3 pendientes molesta a usuarios legítimos** | Media | Superadmin puede override + mensaje claro explicando cómo desbloquearse (subir/cancelar pendientes). |
| **Alertas spam si OCR detecta fecha vieja por error** | Baja | Usar `min(fechaCreacion, fechaFactura)` como base del timer, no solo OCR. Si OCR detecta fecha futura/anterior a un año → ignorar y usar fecha de creación. |
| **Gemini Vision exceda cuota** | Baja | Cap diario por usuario (ej. 20 OCRs/día). Logging de uso. Si pasa el cap, permitir guardar sin OCR. |
| **Sheet `LEGALIZACIONES` crece sin límite** | Baja-media | Trigger semanal de archivado: legalizaciones `PROCESADA_LABROIDES` con >6 meses pasan a sheet histórico `LEGALIZACIONES_HISTORICAS`. (Etapa 2.) |
| **Doble carga del CSV a Labroides** | Media | Marcar `EXPORTADA_CSV` antes de generar el CSV. Pero permitir re-descargar el mismo batch desde un endpoint `redownloadCsvBatch`. |
| **Drive Path con caracteres especiales en email** | Baja | Sanitizar email para nombres de carpeta (reemplazar `@`, `.`). Ej: `jpineda_at_equitel_com_co`. |

---

## 10. Verificación end-to-end (Etapa 1)

Probar siempre en **entorno clonado** (sheet + GAS + `.env.local`):

1. **Creación básica**: usuario sube foto → OCR detecta fecha/monto → confirma → guarda. Aparece en su lista en estado PENDIENTE_CARGUE.
2. **OCR fallido**: subir imagen no factura → OCR retorna `ocrFailed:true` → usuario completa manualmente → guarda OK.
3. **Vínculo a viaje**: subir legalización vinculada a SOL-XXX RESERVADO del propio usuario → aparece en el detalle del viaje (linkedLegalizations).
4. **Gate 3 pendientes**: tener 3 PENDIENTE_CARGUE → intentar crear 4ª → bloqueado con mensaje. Intentar crear solicitud de viaje → bloqueado con mismo mensaje.
5. **Superadmin override**: superadmin crea legalización para usuario con >3 pendientes → permitido.
6. **Liberación del gate**: exportar 1 a CSV → contador baja a 2 → ahora permite crear nueva.
7. **Export CSV**: seleccionar 3 PENDIENTE_CARGUE → generar CSV → descargar → verificar formato → status pasa a EXPORTADA_CSV con `batchId` común.
8. **Alertas**: simular fecha de factura -8 días → trigger de alertas envía correo amarillo al técnico. -16 días → rojo + CC aprobador. -31 días → escalamiento.
9. **Dashboard aprobador**: con varios técnicos con pendientes → ver agregados correctos por equipo del aprobador.
10. **Ownership**: usuario A intenta editar/cancelar legalización de usuario B → rechazado.
11. **Cancelación**: cancelar legalización en PENDIENTE_CARGUE → status RECHAZADA → libera slot del gate. No se puede cancelar si ya está EXPORTADA_CSV (porque ya fue al Excel/Labroides).
12. **Archivos**: subir múltiples archivos (foto + PDF) → todos quedan en la carpeta Drive correcta. Tipos no permitidos → rechazados. >10MB → rechazado.
13. **CSV deduplicado**: re-exportar el mismo batch → endpoint dedicado de re-descarga (sin cambiar status).
14. **Performance**: con 1000 legalizaciones en el sheet, `getMyLegalizations` y `getLegalizationsDashboard` responden < 3s.
15. `npx tsc --noEmit` limpio + `npm run build` OK.

---

## 11. Fases de implementación (sub-fases dentro del mes)

### Sub-fase A — Setup + modelo de datos (días 1-3)
- Crear sheet `LEGALIZACIONES`, headers, formatos.
- Constantes, helpers `_legalizationIdToRow_`, `_getOrCreateLegalizationFolder_`.
- Wrapper `_runOCR_` con Gemini Vision (TBD-1).
- Smoke test: crear una legalización vía función desde el editor GAS.

### Sub-fase B — Backend endpoints (días 4-7)
- `createLegalization`, `getMyLegalizations`, `updateLegalization`, `cancelLegalization`, `addLegalizationFiles`, `runOcrOnLegalization`, `getLegalizationById`.
- Gate 3-pendientes en `createNewRequest`.
- Dispatch entries.

### Sub-fase C — Frontend usuario (días 8-14)
- `types.ts` + `gasService` wrappers.
- `LegalizationsList`, `LegalizationUploadModal` (incluye OCR preview), `LegalizationDetail`.
- Integrar en `App.tsx` (menú).
- Warning de gate en `RequestForm`.

### Sub-fase D — Export CSV (días 15-18)
- `generateLegalizationsCsv` backend + `CsvExportModal` frontend.
- Validar TBD-5 con Julio antes de cerrar formato.

### Sub-fase E — Dashboard aprobador (días 19-23)
- `getLegalizationsDashboard` backend.
- `LegalizationsDashboard` frontend (tabla + filtros).

### Sub-fase F — Alertas (días 24-26)
- `sendLegalizationReminders` cron.
- Instalar trigger.
- Pruebas con timestamps simulados.

### Sub-fase G — Smoke E2E + deploy (días 27-30)
- 15 puntos de §10 en clon.
- Deploy a producción (GAS nueva versión + Cloud Run).

---

# Apéndice A — Infraestructura existente a reutilizar (referencia de código)

> Las funciones/estructuras YA existentes en el código que el módulo de Legalizaciones debe reutilizar. Las líneas son aproximadas; verificar al implementar.

### A.1 `uploadSupportFile(requestId, fileData, fileName, mimeType, correctionNote)` — `server/Code.gs` ~5267
- `fileData` = string **base64** (se decodifica con `Utilities.base64Decode()`).
- Valida con `validateFileUpload_`, localiza carpeta con `getOrCreateRequestFolder_`, sube con `folder.createFile(blob)` (vía `_driveRetry_`), actualiza columna `SOPORTES (JSON)`.
- **Es el patrón base de los endpoints de subida de archivos** del módulo de Legalizaciones (`createLegalization`, `addLegalizationFiles`).

### A.2 Estructura del array de archivos (similar al `SOPORTES (JSON)`)
```js
{
  files: [
    {
      id: string,         // Drive file ID
      name: string,
      url: string,
      mimeType: string,
      date: string,       // ISO
      // Legalizaciones agregan: pageNumber?, ocrResult?, etc.
    }
  ]
}
```

### A.3 Carpetas en Drive
- `getOrCreateRequestFolder_(requestId, rowNumber, sheet)` ~Code.gs:4914 — patrón a imitar para `_getOrCreateLegalizationFolder_`.
- `_findRequestFolder_` (3 capas: cache → search ROOT → wide search con validación de descendencia) — patrón a imitar para localizar la carpeta `LEGALIZACIONES/<usuario>/<mes>`.
- `_driveRetry_(fn, label)` ~Code.gs:4756 — envolver TODAS las ops de Drive (reintenta 1 vez tras 1.5s ante errores transient).
- `ROOT_DRIVE_FOLDER_ID` definido ~Code.gs:52.

### A.4 `validateFileUpload_(fileData, fileName, mimeType)` ~Code.gs:4964
- Acepta PDF + imágenes + Excel, 10MB. Sanitiza nombre. **Sirve tal cual.**

### A.5 Subida múltiple — `registerReservation` ~Code.gs:2564
- Itera `files.map(...)` subiendo cada uno con `_driveRetry_`. Patrón para subir varios archivos por legalización.

### A.6 Cliente `services/gasService.ts`
- `runGas(action, payload)` (~74) inyecta `sessionToken` + `userEmail`; timeout 30s.
- `uploadSupportFile(requestId, ...)` (~382) → patrón para `createLegalization` y demás.
- `readFileAsBase64` y `accept=".pdf,image/*,.xlsx,.xls"` (en `SupportUploadModal.tsx`) → reusar para upload modal.

### A.7 Recordatorios automáticos — `sendPendingApprovalReminders` ~Code.gs:6232
- Patrón completo a imitar para `sendLegalizationReminders`: `isWorkingHour()`, cap `MAX_REMINDER_EMAILS_PER_RUN`, idempotencia vía `EVENTOS_JSON`, escalamiento a superadmin tras N horas.

### A.8 Métricas / eventos — `_recordEvent_` ~Code.gs:?
- Reusar para registrar `legalizationCreated`, `legalizationOcrCompleted`, `legalizationExported`, etc. en `EVENTOS_JSON` del row.

### A.9 Dashboard pattern — `getCostsDashboard` ~Code.gs:11990+
- Patrón para construir `getLegalizationsDashboard`: agregación server-side por usuario/aprobador, cache en Drive (`costos_dashboard_cache.json` → análogo `legalizaciones_dashboard_cache.json`), invalidación por hash.

### A.10 Gemini API
- Constante `GEMINI_API_KEY` (Script Property) ya existe ~Code.gs:21.
- Función `enhanceTextWithGemini` ~Code.gs:1632 — patrón de llamada a Gemini API. Adaptar para Gemini Vision (endpoint distinto, payload con imagen).

---

# Apéndice B — Modelo de visibilidad y seguridad actual

### B.1 Filtrado por usuario
- `getMyRequestsLite(email)` ~Code.gs:4163 y `getRequestsByEmail(email)` ~Code.gs:4067 filtran por `CORREO ENCUESTADO`.
- **El V1 los extendió para incluir filas donde el usuario es pasajero.** El módulo V2 de legalizaciones es independiente, pero reutilizará el mismo principio en `getMyLegalizations` (solo legalizaciones del usuario).

### B.2 Pasajeros en la fila
- Escritura en `createNewRequest` ~Code.gs:4633: `CORREOS PASAJEROS (JSON)` = array de emails.
- Lectura en `mapRowToRequest` ~Code.gs:5839: `passengers[] = { name, idNumber, email }`.
- ⚠️ Email de pasajero **puede venir vacío** → matchear también por cédula vía `_getRequesterCedulaMap_` (Code.gs:5766).

### B.3 Carga del dashboard / bootstrap
- `bootstrap()` ~Code.gs:4245 calcula rol server-side y carga `getAllRequestsLite()` (admin) o `getMyRequestsLite(sessionEmail)` (usuario).
- **Nuevo:** el bootstrap debe también traer `getMyLegalizationsLite()` para que el frontend tenga la lista al login (mismo patrón).

### B.4 Ownership en endpoints
- Patrón actual: `getRequestById` valida `requesterEmail === currentUserEmail` o analyst (~Code.gs:662-675).
- Patrón a imitar para `getLegalizationById`, `updateLegalization`, etc.: `userEmail === currentUserEmail` o analyst o aprobador del owner.

### B.5 Detección de proxy (patrón a espejar)
- `isProxyRequest` ~Code.gs:5979-5998: cédula-primario / email-fallback.
- **Aplicable** a `_userCanReadLegalization_(legalization, currentEmail)`: si el usuario es aprobador del owner → puede leer (no escribir).

### B.6 Capas de seguridad del dispatch (~Code.gs:557-606)
- `isWriteAction` — agregar todas las acciones que mutan legalizaciones.
- `sessionExemptActions` — ninguna de las nuevas.
- `adminOnlyActions` — `getLegalizationsDashboard` para vista global; lecturas/cargas personales NO.
- `superAdminOnlyActions` — `overrideGateLegalizations` (si se implementa override individual).

---

# Apéndice C — Componentes frontend relevantes (referencia de código)

- **`components/SupportUploadModal.tsx`** — modal admin de soportes. **Base para `LegalizationUploadModal`** (versión con OCR + formulario de datos). Patrones reutilizables: `readFileAsBase64`, `ConfirmationDialog`, validación 10MB, `accept=".pdf,image/*"`.
- **`components/UserDashboard.tsx`** — grid de cards. **Base para `LegalizationsList`** (mismo layout de cards con paginación PAGE_SIZE=50).
- **`components/RequestDetail.tsx`** — modal de detalle. La sección de "Confirmación de Reserva" (~607-662) es buen modelo para la futura sección "Legalizaciones vinculadas" en el detalle del viaje.
- **`components/AdminDashboard.tsx`** — tabla con badges/íconos (~544-584). Patrón para los badges de legalizaciones vinculadas + el nuevo `LegalizationsDashboard`.
- **`types.ts`** — `SupportFile` (~54), `SupportData` (~64), `TravelRequest` (~70), `Passenger` (~22). Las nuevas interfaces de `Legalization` siguen los mismos patrones.
- **`services/gasService.ts`** — `runGas` (~74), `uploadSupportFile` (~382). Patrones para todos los wrappers nuevos.
- **`server/CostsDashboard.html`** — patrón completo de dashboard standalone (auth + filtros + agregaciones + export). Inspiración para el `LegalizationsDashboard.html` si se decide hacerlo standalone en vez de embed en React.

---

# Apéndice D — Plan V1 (carga acotada, ahora caso particular de V2)

> Plan original de la reunión 2026-05-28. Quedó como **subset** del V2: corresponde al caso en que la legalización SÍ tiene una solicitud de viaje vinculada (Sol → RESERVADO/PROCESADO). El V2 lo absorbe.

### V1 — Contexto (síntesis)
Técnicos no legalizan después del viaje → 3 viajes acumulados → contabilidad bloqueada. Solución: botón en RequestDetail para subir fotos/PDF directamente a la carpeta de Drive de la solicitud.

### V1 — Decisiones cerradas con David
1. Recordatorios automáticos → Fase 2 (en V2 vuelven a estar IN scope).
2. Vista pasajero limitada server-side (V2 conserva esta decisión).
3. Ventana de carga: RESERVADO o PROCESADO (V2 amplía a "cualquier OT con o sin viaje").

### V1 — Cambios diseñados (resumen breve)

**Backend `server/Code.gs`:**
- B1. Helper `_userCanAccessRequest_` — relación REQUESTER / PASSENGER / ANALYST / null.
- B2. Sanitizador `_sanitizeRequestForPassenger_` — strip de costos/aprobaciones.
- B3. Extender `getMyRequestsLite` y `getRequestsByEmail` para incluir filas donde el usuario es pasajero.
- B4. Extender dispatch `getRequestById` para autorizar pasajero (con sanitización).
- B5. Endpoint `uploadLegalization` con subcarpeta "Legalizaciones" dentro de la carpeta de la solicitud, marca `isLegalization:true`.
- B6. Registrar en dispatch (NO en `adminOnlyActions`).

**Frontend:**
- F1. `types.ts`: `SupportFile.isLegalization`, `SupportData.legalizationFolderId/Url`, `TravelRequest.viewerRelation`.
- F2. `gasService.uploadLegalization`.
- F3. `LegalizationUploadModal` add-only (V2 lo reemplaza con uno mucho más rico: OCR + formulario).
- F4. `UserDashboard`: botón "Legalizar gastos" en cards RESERVADO/PROCESADO.
- F5. `RequestDetail`: sección "Legalizaciones de gastos".
- F6. `AdminDashboard`: badge de count.
- F7. `App.tsx`: pasar `userEmail` a UserDashboard y RequestDetail.

### Cómo el V2 absorbe el V1
- La extensión de visibilidad por pasajero (V1.B3+B4) **sigue siendo necesaria** en V2 para que un pasajero pueda vincular una legalización a un viaje en el que es pasajero (TBD-3).
- Las sanitizaciones (V1.B2) se conservan para la vista pasajero.
- El botón "Legalizar gastos" en RequestDetail (V1.F5) se vuelve **un atajo** que abre el modal V2 con el `relatedRequestId` pre-llenado.
- La subcarpeta "Legalizaciones" dentro de cada carpeta de viaje (V1) NO se usa: en V2 los archivos viven en `LEGALIZACIONES/<usuario>/<mes>/`. La solicitud de viaje guarda solo referencias (deep-link).

### Histórico de las decisiones
- 2026-05-28: V1 aprobado por David (con Juanca).
- 2026-06-01: Juan Sebastian Cañón clarifica que no todos los viáticos son de viajes → V1 quedaría limitado a la mitad del universo. Se rediseña a V2.
- V1 NO llegó a implementarse. Queda como histórico arquitectónico.

---

# Apéndice E — Resumen ejecutivo de la reunión 2026-06-01

**Asistentes:** Yesid Roncancio Fuerte (jefe), Juan Sebastian Cañón (líder aprobador), Juan Camilo Pineda Tinjaca, Santiago Gómez Rey, David Sánchez Rocha.

**Problema base:** Labroides Web (sistema actual de legalizaciones) es tedioso, falla, y no permite reportes dinámicos para los líderes.

**Quotes clave:**

> **Juan Sebastian Cañón** (sobre Labroides Web): *"Bastante tedioso, no se puede hacer tan rápido, el programa falla mucho, entonces los técnicos les da pereza y no lo hacen. Yo lo he hecho para legalizar y me he demorado dos meses para poder legalizar porque no es tan amigable."*

> **Juan Sebastian Cañón** (sobre el alcance): *"Todos los viáticos no son de viajes. Por ejemplo, yo puedo pedir viáticos para aquí Mosquera, pero es para trabajar en la noche. Entonces, no están ligados a un tiquete o a un transporte."*

> **Juan Camilo Pineda** (sobre la visión): *"Mica está al man que tiene un viaje y se le puede asociar todo a ese mismo viaje, como está el man que no tiene nada que ver, no es un viaje, pero que también entre por el mismo portal a subir las legalizaciones. (...) En otras palabras, la aplicación de Kitel Viajes sería como un almacenador, después hace la traducción al archivo que necesita la broides y eso queda cargado allá."*

> **Juan Camilo Pineda** (sobre el gate): *"Para tener el control de que el próximo viaje que vaya a hacer la persona no se lo deje hacer o la próxima legalización que quiera hacer no se la deje hacer si ya lleva más de tres legalizaciones y no ha subido un c***."*

> **David Sánchez** (cierre, definiendo el alcance Etapa 1): *"En la plataforma de viajes va a quedar el módulo de legalizaciones donde los técnicos cargan sus soportes. Si tienen un viaje vinculado, bacano. Si no lo tienen, pues también les permite cargarlo y poner la el número de la OT. Y con eso ya empiezan los timers y las alertas y les llega y ustedes podrían ver el dashboard que estamos hablando de las métricas y pues obviamente como todos los usuarios ya tienen vinculado su aprobador, entonces podríamos ahí saber por aprobadores digamos de cada usuario."*

**Próximos pasos definidos:**
1. David: desarrollar el módulo de legalizaciones en Quitel Viajes (este plan, ~1 mes).
2. David: coordinar reunión con Julio (dev Labroides) para análisis de fallas y definición de integración (Etapa 2).
3. Grupo: definir cronograma de Etapa 2 tras la reunión con Julio.

**Compromiso de plazo:** ~1 mes para Etapa 1 visible. David mencionó tener un periodo de descanso pero confirma factibilidad.
