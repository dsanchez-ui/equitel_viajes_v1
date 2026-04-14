# Guía del Administrador — Equitel Viajes

> **Para quién es esta guía:** la persona que opera el Portal de Viajes día a día — cotizar opciones, confirmar costos, registrar reservas, resolver cambios, y gestionar la base de usuarios. También sirve para el administrador técnico del sistema.
>
> **Lo que NO cubre:** detalles internos del código (eso está en el repo). Esta guía es operativa.

---

## 1. Vista general

### ¿Qué es el sistema?

Una plataforma web donde los empleados piden viajes y hospedajes corporativos, sus jefes aprueban, y el área de viajes gestiona la compra. Todo el estado vive en un Google Sheets, la lógica en un proyecto Apps Script, y el frontend en React desplegado en Cloud Run.

### Los tres tipos de usuario

| Tipo | Qué hace | Dónde ingresa |
|---|---|---|
| **Solicitante** | Crea solicitudes de viaje/hospedaje, selecciona opciones, sube soportes post-viaje. | Botón rojo **INGRESAR** con su correo corporativo + PIN. |
| **Aprobador** | Recibe correo de aprobación, click en APROBAR o DENEGAR. NO necesita iniciar sesión en la app. | Botones en el correo. |
| **Analista / Admin** | Cotiza opciones, confirma costos, registra reservas, gestiona usuarios, consulta métricas. | Botón negro **ADMINISTRADOR** → PIN admin de 8 dígitos. |

---

## 2. Arquitectura a alto nivel

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

## 3. Las hojas del spreadsheet

| Hoja | Propósito | ¿Se puede reorganizar? |
|---|---|---|
| **Nueva Base Solicitudes** | Tabla principal con TODAS las solicitudes (una fila por solicitud). 75 columnas canónicas. | ✅ Sí, con el workflow de reorganización (ver §6). El código lee las columnas por nombre, no por posición. |
| **USUARIOS** | Directorio de usuarios: cédula, correo, empresa, aprobadores, hash de PIN. | ⚠️ No reorganizar. Las posiciones de columnas están hardcoded en el sidebar. |
| **CDS vs UDEN** | Catálogo de centros de costo → unidad de negocio. | ⚠️ No reorganizar. |
| **CIUDADES DEL MUNDO** | Ciudades con país y flag de internacional. | ⚠️ No reorganizar. |
| **MISC** | Sedes y tarjetas de crédito (catálogos). | ⚠️ No reorganizar. |
| **REGLAS_COAPROBADOR** | Reglas de co-aprobadores (ej. internacional requiere CDS). | ⚠️ No reorganizar. |
| **INTEGRANTES_OLD** | Antigua hoja de usuarios (legacy, antes de Plan 2). | ✅ Ignorar o borrar tras 1-2 meses de uso normal del nuevo modo. |

### Columnas importantes en "Nueva Base Solicitudes"

No es necesario memorizar las 75, pero estas son las más relevantes día a día:

| Columna | Qué guarda |
|---|---|
| `ID RESPUESTA` | Identificador único (`SOL-000123`). |
| `STATUS` | Estado actual (ver §4). |
| `CORREO ENCUESTADO` | Quién solicita. |
| `OPCIONES (JSON)` | Array de URLs de imágenes que subió el analista. |
| `SELECCION_TEXTO` | Descripción libre que escribió el usuario de su selección. |
| `COSTO_FINAL_TIQUETES`, `COSTO_FINAL_HOTEL`, `COSTO COTIZADO PARA VIAJE` | Costos confirmados por el analista (formato pesos colombianos). |
| `No RESERVA` | PNR / número de confirmación. |
| `SOPORTES (JSON)` | Array de archivos (factura reserva, etc.) con sus URLs de Drive. |
| `APROBADO POR ÁREA? (AUTOMÁTICO)`, `APROBADO CDS`, `APROBADO CEO` | Log de quién aprobó y cuándo. |
| `EVENTOS_JSON` | Timestamps de cada evento del ciclo (para métricas). |
| `OBSERVACIONES` | Texto libre. Puede tener marcadores internos como `[CONSULTA_USUARIO_PENDIENTE]`. |

---

## 4. Ciclo de vida de una solicitud (estados)

```
  CREAR
    ↓
  PENDIENTE_APROBACION       ← aprobadores pueden aprobar/denegar por correo
    ↓ (aprobado)
  PENDIENTE_OPCIONES          ← analista debe subir opciones de vuelo/hotel
    ↓ (opciones subidas)
  PENDIENTE_SELECCION         ← usuario debe describir su selección
    ↓ (usuario escribe)
  PENDIENTE_CONFIRMACION_COSTO ← analista debe confirmar costos finales
    ↓ (costos confirmados)
  PENDIENTE_APROBACION         ← nueva aprobación si >$1.2M o internacional
    ↓
  APROBADO                    ← todas las aprobaciones completas
    ↓ (analista registra reserva)
  RESERVADO                   ← PNR + archivos de confirmación subidos
    ↓ (post-viaje, soportes subidos)
  PROCESADO                   ← estado final
```

**Estados terminales** (no pueden volver):
- `DENEGADO` — algún aprobador dijo no
- `ANULADO` — cancelada manualmente por admin o usuario
- `PROCESADO` — ciclo completo

**Estado especial de cambios:**
- `PENDIENTE_ANALISIS_CAMBIO` — una solicitud "hija" que reemplaza a otra. El admin decide pasarla a estudio (entra al flujo normal) o denegarla (y decidir qué hacer con la original).

---

## 5. Workflows del analista (día a día)

### 5.1 Cotizar opciones (PENDIENTE_OPCIONES → PENDIENTE_SELECCION)

1. Panel admin → fila con status `PENDIENTE_OPCIONES`
2. Abre el detalle → **"Subir imágenes de opciones"**
3. Para vuelos: sube una imagen por opción (A, B, C…). Si hay ida y vuelta, indica dirección IDA o VUELTA. Para hoteles: sube una imagen por opción.
4. Al guardar, el sistema envía automáticamente un correo al solicitante con las imágenes.

### 5.2 Revisar selección y confirmar costos (PENDIENTE_CONFIRMACION_COSTO → PENDIENTE_APROBACION)

1. Fila con status `PENDIENTE_CONFIRMACION_COSTO`
2. Abre el detalle → verás el texto libre que escribió el usuario ("Opción A, categoría Económica…")
3. **"Confirmar costos"** → ingresa `finalCostTickets` y `finalCostHotel` (si aplica)
4. Al guardar, si el total ≤ $1.2M y no es internacional → pasa a `APROBADO` directo. Si no → pasa a `PENDIENTE_APROBACION` y se envía correo a CEO + CDS + aprobador de área.

### 5.3 Registrar reserva (APROBADO → RESERVADO)

1. Fila con status `APROBADO`
2. Abre el detalle → **"Registrar reserva"**
3. Ingresa:
   - **No. reserva / PNR** (texto libre, 3-10 caracteres usualmente)
   - **Tarjeta de crédito** usada (del dropdown)
   - **Fecha de compra** (hoy por default)
   - **Archivos de confirmación** (PDF de la aerolínea / hotel — puedes subir varios)
4. Al guardar:
   - La carpeta en Drive se renombra a `SOL-000123 - PNR12345 - TC 1234 - MAY 26`
   - Se envía correo al usuario con el PNR y los archivos adjuntos

### 5.4 Corregir una reserva ya registrada (RESERVADO → RESERVADO)

Si algo salió mal (PNR equivocado, archivo erróneo, cambió la tarjeta):

1. Fila con status `RESERVADO`
2. Abre el detalle → **"Corregir reserva"**
3. Puedes:
   - Editar PNR / tarjeta / fecha
   - Eliminar archivos existentes
   - Subir archivos nuevos
   - Agregar nota de corrección (explicación libre)
4. El usuario recibe un correo "Corrección de reserva" con los nuevos datos.

### 5.5 Cerrar la solicitud (RESERVADO → PROCESADO)

Cuando los soportes post-viaje están listos:

1. Fila con status `RESERVADO`
2. **"Finalizar solicitud"** → se genera automáticamente el reporte PDF de soporte
3. Estado final: `PROCESADO`

### 5.6 Gestionar solicitudes de cambio

Cuando un usuario pide modificar una solicitud ya en curso, se crea una solicitud "hija" con status `PENDIENTE_ANALISIS_CAMBIO`. El correo que te llega tiene botones directos **PASAR A ESTUDIO** y **RECHAZAR CAMBIO**. Pero también puedes gestionarlo desde el panel:

1. Fila con status `PENDIENTE_ANALISIS_CAMBIO`
2. Abre el detalle → **"Revisar cambio"**
3. Opciones:
   - **Pasar a estudio** → la hija entra al flujo normal como cualquier solicitud (empieza en `PENDIENTE_OPCIONES`). La solicitud original se anula automáticamente cuando la hija se apruebe.
   - **Denegar cambio** → requiere motivo. Luego decides qué hacer con la original:
     - **Mantener activa** (default): la original sigue su curso.
     - **Anular**: la original también se cancela.
     - **Consultar al usuario**: envía un correo al solicitante con botones CONTINUAR / ANULAR para que él decida. Mientras responde, los recordatorios de la original quedan pausados.

### 5.7 Anular una solicitud

1. Fila con cualquier status activo
2. Detalle → **"Anular"**
3. Requiere motivo → queda en el campo `OBSERVACIONES` + correo al usuario

---

## 6. Sidebars (paneles laterales)

Hay dos sidebars, ambos en el menú **Equitel Viajes** dentro del Google Sheet:

### 6.1 Gestionar Usuarios (sidebar de USUARIOS)

**Cuándo usarlo:** agregar usuarios nuevos, cambiar aprobadores, detectar problemas.

**Tabs:**

| Tab | Para qué |
|---|---|
| **Usuarios** | CRUD básico. Buscar, crear, editar, eliminar, borrar PIN. |
| **Anomalías** | Diagnóstico: correos no corporativos, usuarios sin aprobador, aprobadores huérfanos (cédula no existe en USUARIOS). |
| **Reemplazar** | Si un aprobador sale de la empresa: reemplazar su cédula por la de otro en TODOS los usuarios que lo tienen como aprobador. Vista previa antes de aplicar. |
| **Ed. Masiva** | Cambios masivos: asignar/agregar aprobador, cambiar empresa/sede/CC a un grupo filtrado de usuarios. |
| **Duplicados** | Detecta filas con cédula, correo, o nombre repetido. Compara cada grupo lado-a-lado (datos + estado del PIN) y elimina las que sobran. |

### 6.2 Reorganizar Base Principal (sidebar de REORG)

**Cuándo usarlo:** una vez cada pocos meses (o nunca). Cambiar el orden de columnas de la hoja principal, agregar columnas extras personales, o limpiar el layout.

Ver guía completa en [guia-reorganizar-base.md](./guia-reorganizar-base.md).

---

## 7. Métricas

Panel accesible desde el dashboard admin → botón **Métricas**.

**Qué muestra:**
- Tiempos promedio por etapa (en minutos hábiles):
  - Cotización (creación → opciones cargadas)
  - Selección (opciones → usuario describe)
  - Confirmación costos (selección → costos finales)
  - Aprobación completa (costos → todas las aprobaciones)
  - Reserva (aprobación → PNR registrado)
  - Ciclo total (creación → reserva)
- Performance del analista en 3 etapas que le corresponden (cotización, confirmación costos, compra).
- Performance de cada aprobador (cuánto tarda en aprobar).
- Badges de cruce de día (ej. `+1d` si la etapa cruzó a día siguiente hábil).

**Filtros:**
- Rango de fechas (últimos 30d, 90d, todo, personalizado)
- ID específico
- Excluir: Anuladas, Denegadas, Sin datos (pre-deploy)

**Notas:**
- Usa un cache JSON en Drive (`metricas_cache.json`) — recalcula solo las solicitudes cuyos eventos cambiaron desde la última carga.
- Solicitudes creadas antes del deploy de métricas no tienen `EVENTOS_JSON` y aparecen como "sin datos".
- Horario hábil: L-V 07:00–17:00, Sáb 08:00–12:00. Fuera de horario se excluye.

---

## 8. Triggers programados (4 triggers cada 2h)

Estos se ejecutan automáticamente en horario laboral. Ya están configurados.

| Función | Qué hace |
|---|---|
| `sendPendingApprovalReminders` | Recordatorio a aprobadores que no han aprobado. Respeta pausa si hay cambio activo. Cap 100 correos/run. |
| `sendPendingSelectionReminders` | Recordatorio al usuario que no ha descrito su selección. Mismo asunto = mismo hilo en Gmail. |
| `processAdminReminders` | Resumen diario/periódico al admin de pendientes (cotizar, confirmar costos, reservar, cambios). |
| `sendPendingConsultReminders` | Recordatorio al usuario sobre consultas pendientes (continuar/anular tras denegación de cambio). |

**Trigger opcional (recomendado):**
- `cleanupExpiredSessions` (mensual) — borra sesiones `SESSION_*` expiradas de Script Properties. Previene acumulación.

---

## 9. Script Properties (configuración)

Son variables de configuración en el proyecto Apps Script. **NO editar desde la GUI** (se bloquea cuando hay >50 propiedades, caso de este proyecto). Usar funciones helper.

| Propiedad | Valor | ¿Cómo editar? |
|---|---|---|
| `ANALYST_EMAILS` | JSON array: `["apcompras@equitel.com.co","dsanchez@equitel.com.co"]` | Ejecutar `actualizarAnalystEmails()` después de editar el array en código. |
| `ADMIN_PIN_HASH` | SHA-256 del PIN admin. | `updateAdminPin(nuevoPin)` desde el editor. Primera vez: `configurarPinInicial()` tras poner `INITIAL_ADMIN_PIN`. |
| `USE_USUARIOS_SHEET` | `'true'` (activa modo USUARIOS) / `'false'` | Ejecutar `toggleUsuariosMode()` — cambia entre los dos modos. Rollback = ejecutar de nuevo. |
| `WEB_APP_URL` | URL del deploy Apps Script. | Default hardcoded. Si cambia el deploy, actualizar via editor → propiedades. |
| `PLATFORM_URL` | URL del frontend Cloud Run. | Default hardcoded. |
| `ROOT_DRIVE_FOLDER_ID` | Carpeta raíz de archivos. | Default hardcoded. |
| `BACKUP_FOLDER_ID` | Carpeta de respaldos (opcional). | Desde el sidebar de reorganización → sección Respaldo → pegar URL/ID. |
| `REPORT_TEMPLATE_ID` | ID del Google Doc template de reportes. | Generado automáticamente por `createReportTemplate()` (ejecutar una vez). |
| `CEO_EMAIL`, `DIRECTOR_EMAIL`, `ADMIN_EMAIL` | Correos ejecutivos. | Default hardcoded. |

**Diagnóstico de propiedades:** ejecuta `verPropiedadesDelScript()` desde el editor para ver el estado de todas.

---

## 10. Funciones admin útiles (ejecutar desde el editor Apps Script)

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

---

## 11. Troubleshooting

### El usuario dice que no le llega el PIN

1. Verifica que el correo esté en USUARIOS (tab Usuarios del sidebar, o busca en la hoja).
2. Verifica que el correo tenga dominio corporativo (`@equitel.com.co`). Si no, el filtro de validación puede rechazarlo — revisa el tab "Anomalías".
3. El PIN se envía vía Gmail desde el correo del dueño del script. Si Gmail bloqueó al usuario, no llega.
4. Fuerza un nuevo PIN: en el login del usuario, que pulse "Reenviar PIN".

### El aprobador dice que no le llega el correo

1. Busca la solicitud en el sheet, campo `CORREO DE QUIEN APRUEBA (AUTOMÁTICO)` — confirma el correo.
2. Si viajan pasajeros corporativos, el aprobador del primer pasajero es quien aprueba. Si ese correo está mal, la solicitud no puede aprobarse.
3. Si es internacional o >$1.2M, también se envía a CEO y CDS — ver `CEO_EMAIL` / `DIRECTOR_EMAIL` en Script Properties.

### La sesión expira muy seguido

Las sesiones duran 30 días. Si expiran antes:
- Script Properties puede estar lleno (limit 500KB total). Ejecuta `cleanupExpiredSessions()`.
- El usuario cambió de navegador / dispositivo — normal.

### Métricas muestran "sin datos" para solicitudes viejas

Antes del deploy de métricas (Plan 4), las solicitudes no tenían `EVENTOS_JSON`. Quedan como "sin datos" para siempre. Filtra "Excluir sin datos" (default) para ocultarlas.

### Se duplicó un usuario en USUARIOS

Ve al sidebar → tab **Duplicados** → escanear. Compara las filas lado-a-lado (incluye estado del PIN) y elimina las que sobren. El sistema te advierte si borras una fila con PIN.

### Quiero revertir el switch a USUARIOS

Ejecuta `toggleUsuariosMode()` desde el editor → vuelve a modo INTEGRANTES. **Importante:** si renombraste INTEGRANTES a INTEGRANTES_OLD, debes renombrarla de vuelta para que el modo legacy funcione.

### El sidebar de Reorganizar no abre ("Acción no autorizada")

Tu correo no está en `ANALYST_EMAILS`. Actualiza el array en `actualizarAnalystEmails()` y ejecuta.

### Un trigger falló / no corrió

Revisa `Triggers` en el editor GAS. Si un trigger se eliminó manualmente, debes recrearlo (click en +, seleccionar la función, fuente=Time-driven, intervalo 2h).

---

## 12. Backup y recuperación

**Antes de cualquier cambio estructural** (reorganizar, migrar USUARIOS, etc.):

1. Menú **Equitel Viajes → Reorganizar Base Principal (Sidebar)**
2. Sección "🛡️ Respaldo completo del archivo" (arriba de todo)
3. Si es primera vez: pega la URL/ID de tu carpeta privada de Drive → **Guardar carpeta**
4. **📋 Crear respaldo ahora** → ~30-60s → copia completa en tu Drive

Recuperación: si algo sale MUY mal, abres la copia respaldada, la descargas como .xlsx, o la copias encima del sheet activo (requiere re-vincular Apps Script).

---

## 13. Contacto y mantenimiento

- **Código en:** github.com/dsanchez-ui/equitel_viajes_v1
- **Deploy frontend:** Cloud Run `sistematiquetesequitel-302740316698.us-west1.run.app`
- **Deploy backend:** Apps Script Web App, URL en `WEB_APP_URL`
- **Modelo de deploy:**
  - Frontend: push a `main` → Cloud Build auto-despliega.
  - Backend: copiar `server/Code.gs`, `server/AdminSidebar.html`, `server/ReorgSidebar.html` al editor GAS manualmente → redesplegar Web App.

---

*Última actualización: 2026-04-13*
