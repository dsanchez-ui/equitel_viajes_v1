# Guía del Administrador — Equitel Viajes

> **Para quién es esta guía:** la persona que opera el Portal de Viajes día a día — cotizar opciones, confirmar costos, registrar reservas, resolver cambios, y gestionar la base de usuarios. También sirve para el administrador técnico del sistema.
>
> **Lo que NO cubre:** detalles internos del código (eso está en el repo). Esta guía es operativa.

---

## 1. Vista general

### ¿Qué es el sistema?

Una plataforma web donde los empleados piden viajes y hospedajes corporativos, sus jefes aprueban, y el área de viajes gestiona la compra. Todo el estado vive en un Google Sheets, la lógica en un proyecto Apps Script, y el frontend en React desplegado en Cloud Run.

### Los cuatro roles de usuario

| Rol | Qué hace | Dónde ingresa |
|---|---|---|
| **Solicitante** | Crea solicitudes de viaje/hospedaje, selecciona opciones, sube soportes post-viaje. | Botón rojo **INGRESAR** con su correo corporativo + PIN personal. |
| **Aprobador** | Recibe correo de aprobación, click en APROBAR o DENEGAR. NO necesita iniciar sesión en la app. | Botones firmados HMAC en el correo. |
| **Analista / Admin (ANALYST)** | Cotiza opciones, confirma costos, registra reservas, gestiona usuarios, consulta métricas. Puede saltar la etapa de selección cuando el viaje se gestionó fuera del sistema. | Botón negro **ADMINISTRADOR** con PIN admin compartido, o botón rojo **INGRESAR** con su PIN personal si tiene fila en USUARIOS. |
| **Superadmin (SUPERADMIN)** | Todo lo del analista **más**: saltar la etapa de aprobación, recibir escalamientos cuando los aprobadores no responden, alternar entre vista admin y vista usuario con el botón **VER USUARIO / VER ADMIN**. | Igual que analista. El rol se asigna en `SUPER_ADMIN_EMAILS` (Script Property). |

> **Jerarquía:** SUPERADMIN hereda todo lo de ANALYST; ANALYST hereda todo lo de SOLICITANTE. Quien está en `SUPER_ADMIN_EMAILS` NO necesita estar también en `ANALYST_EMAILS` — la herencia es automática.

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

### 5.8 Saltar la etapa de SELECCIÓN (cualquier analista)

Cuando los tiquetes ya se compraron por fuera del sistema y no tiene sentido pedirle al usuario que "seleccione una opción":

1. Carga las opciones desde el modal **"Subir imágenes de opciones"** — desmarca el checkbox **"Enviar correo al usuario"** si no quieres notificarlo. Las opciones quedan guardadas solo para trazabilidad.
2. La solicitud avanza directamente a `PENDIENTE_CONFIRMACION_COSTO`, lista para que confirmes los costos.
3. Alternativamente, si ya está en `PENDIENTE_SELECCION`: abre el detalle → botón indigo **"SALTAR SELECCIÓN"** → escribe justificación (≥10 caracteres) → confirma.

Queda registrado en OBSERVACIONES con tu correo, timestamp y justificación. No se envía correo al solicitante.

### 5.9 Saltar la etapa de APROBACIÓN (solo SUPERADMIN)

Cuando un ejecutivo ya autorizó verbalmente, por WhatsApp o correo fuera del sistema, y quieres registrar la solicitud como APROBADA sin mandar correos a los aprobadores:

1. Fila con status `PENDIENTE_APROBACION` → abre el detalle.
2. Aparece un banner ámbar **"⏩ Saltar etapa de aprobación (SUPERADMIN)"** con un botón **"SALTAR APROBACIÓN"**.
3. Click → justificación (≥10 caracteres) → confirma.
4. La solicitud pasa directamente a `APROBADO`. Las columnas `APROBADO POR ÁREA?`, `APROBADO CDS` y `APROBADO CEO` se marcan con `Sí (ETAPA SALTADA por tu.correo)`. El usuario sí recibe el correo "Solicitud Aprobada"; los aprobadores no reciben nada.

**Alternativa equivalente durante confirmación de costos:** en el modal **"Confirmar costos"** aparece un checkbox "Saltar etapa de aprobación" con el mismo efecto, útil cuando sabes desde antes que no quieres pasar por aprobadores.

### 5.10 Omitir correo al registrar reserva

En el modal **"Registrar reserva"** hay un checkbox **"Enviar correo al usuario"** marcado por default. Si el PNR ya se entregó al usuario por otro medio, desmárcalo. Aparece una confirmación doble para evitar errores. Queda nota en OBSERVACIONES.

### 5.11 Alternar vista admin ↔ usuario

Si eres analista o superadmin Y tienes solicitudes propias pendientes (p.ej. tú creaste una), puedes alternar entre el panel de analista y el panel de solicitante usando el botón **VER USUARIO / VER ADMIN** en el header. El sistema revalida tus permisos en cada switch.

---

## 5.bis. Capacidades exclusivas de SUPERADMIN

Los **superadmins** (configurados en `SUPER_ADMIN_EMAILS` — actualmente David y Yurani) tienen capacidades adicionales que un analista normal (Wendy) no tiene:

| Capacidad | Disponible desde |
|---|---|
| **Saltar etapa de aprobación** | Detalle de solicitud en `PENDIENTE_APROBACION`, o checkbox en confirmar costos. |
| **Botón VER USUARIO / VER ADMIN** | Header del panel de analista — alternar vistas. |
| **Recibir escalamientos** | Correos automáticos cuando una solicitud lleva 30h laborales sin aprobación (≈3 días hábiles). |
| **Ejecutar helpers de Script Properties** | `setScriptProperty`, `deleteScriptProperty`, `listScriptProperties` desde el editor GAS. |
| **Ejecutar skip de aprobación vía backend** | `skipApprovalStage(requestId, justification)` — solo vía frontend; el endpoint está protegido y valida superadmin en cada request. |

**Configurar o quitar un superadmin:**
```javascript
// Desde el editor GAS → función temporal → ejecutar UNA vez:
setScriptProperty('SUPER_ADMIN_EMAILS', '["dsanchez@equitel.com.co","yprieto@equitel.com.co"]');
```
El cambio aplica **inmediatamente** (no requiere redeploy). Si quitas a alguien, su capacidad superadmin desaparece al siguiente request sin invalidar su sesión.

**Escalamiento automático a superadmins:** tras 30 horas laborales efectivas (L-V 7-17, Sáb 8-12) desde que una solicitud entra a `PENDIENTE_APROBACION` sin que los aprobadores respondan, el sistema envía UN correo único a todos los superadmins pidiéndoles intervenir. El correo sugiere 3 acciones: contactar al aprobador, saltar la aprobación (si el viaje ya fue autorizado por fuera) o anular. Después de ese correo, los recordatorios automáticos a los aprobadores se detienen para no saturar.

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

### 6.3 Validaciones en los formularios

Tanto el sidebar como el módulo móvil (§7) aplican validaciones "en vivo" mientras el admin escribe:

| Campo | Restricción |
|---|---|
| Cédula | Solo dígitos. Cualquier letra/símbolo se filtra al escribir. Teclado numérico en móvil. |
| Nombre completo | Auto-UPPERCASE mientras se escribe. Se preservan tildes y Ñ (ej: `CÓRDOBA`, `ZUÑIGA`). |
| Correo | Auto-lowercase. Espacios removidos. Validación de formato `algo@algo.algo` antes de enviar. |
| Centro de costo | Solo dígitos. Teclado numérico en móvil. |

Las validaciones se ejecutan también en el `Guardar`, por si el admin pega un valor con copy-paste que saltó los filtros. Si algo no cumple, no se envía al backend y se muestra el error.

**Sobre caracteres especiales (tildes, Ñ, Ü):** son **100% seguros** en el sistema. Los nombres se usan en correos, PDFs de reporte, nombres de archivos Drive y comparaciones — en todos los casos el código maneja UTF-8 correctamente. Escribir `BRICEÑO` o `BRICENO` es indiferente para el backend, pero el primero respeta la ortografía real del nombre.

---

## 7. Módulo Admin Móvil

**Para qué sirve:** crear usuarios nuevos rápidamente desde el celular sin tener que abrir el Sheet en el escritorio.

**Caso de uso típico:** llega RRHH con un empleado nuevo que necesita acceso al portal YA. Desde el celular el admin ingresa cédula, nombre, correo, empresa, sede y aprobador — un minuto y listo.

### Quién puede usarlo

Únicamente personas cuyo correo esté en la whitelist `ANALYST_EMAILS` (Script Property). El módulo usa el mismo PIN admin de 8 dígitos que el portal normal. Otros usuarios ven la pantalla de login pero su PIN siempre falla.

### URL del módulo

La misma URL del Web App con el parámetro `?action=admin` al final:

```
https://script.google.com/macros/s/AKfycb.../exec?action=admin
```

Recomendación: agregarlo a la pantalla de inicio del celular (iOS Safari → compartir → "Añadir a pantalla de inicio"; Chrome Android → menú → "Añadir a pantalla de inicio") para acceso de un toque, como si fuera una app nativa.

### Qué hace

- **Login**: correo admin + PIN (mismo del portal). Rate-limit de 5 intentos por 15 min. Sesión dura 30 días en ese navegador.
- **Crear usuario**: formulario idéntico al del sidebar (cédula, nombre, correo, empresa, sede, CC, aprobadores) con las mismas validaciones y el mismo picker de aprobador.
- Al crear, el usuario aparece inmediatamente en la hoja USUARIOS y puede iniciar sesión en el portal.

### Qué NO hace (limitaciones por diseño)

El módulo está enfocado en **creación**, que es la operación urgente más común fuera de oficina. No incluye:
- Editar usuarios existentes (usar sidebar del Sheet)
- Eliminar usuarios (usar sidebar)
- Detectar anomalías/duplicados
- Reemplazar aprobador masivo
- Edición masiva
- Reorganizar la base principal
- Ver métricas

Si necesitas cualquiera de esas, abre el Sheet en tu computadora y usa el sidebar.

### Seguridad

- La URL es pública pero la página es inútil sin PIN.
- Cada operación del backend (`mobileAdmin_getBootstrap`, `mobileAdmin_createUser`) valida el token de sesión y confirma que el correo esté en `ANALYST_EMAILS` antes de ejecutarse. Sin auth válida, cualquier intento de API retorna error.
- Si el admin es removido de `ANALYST_EMAILS` mientras tiene sesión activa, la siguiente llamada falla automáticamente y lo manda al login.
- Sesión expira a los 30 días o si el admin cierra sesión manualmente.

### Impacto en la operación mientras se usa

**Ninguno para aprobadores ni solicitantes.** El módulo móvil escribe solo en la hoja USUARIOS, mientras que las solicitudes y aprobaciones viven en la hoja Nueva Base Solicitudes. Apps Script soporta ejecuciones concurrentes (hasta 30 por script). Un admin creando un usuario no bloquea:
- Aprobadores clickeando correos de aprobación
- Usuarios haciendo login y generando su PIN por primera vez
- Usuarios creando solicitudes nuevas
- Triggers programados de recordatorios

El único caso donde hay serialización es cuando **dos admins crean usuarios simultáneamente** (uno desde el sidebar y otro desde el móvil): el segundo espera máximo 2-3 segundos al primero. Esto es intencional para evitar que ambos escriban en la misma fila.

---

## 8. Métricas

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

## 9. Triggers programados (4 triggers cada 2h)

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

## 10. Script Properties (configuración)

Son variables de configuración en el proyecto Apps Script. **NO editar desde la GUI** (se bloquea cuando hay >50 propiedades, caso de este proyecto). Usar funciones helper.

| Propiedad | Valor | ¿Cómo editar? |
|---|---|---|
| `ANALYST_EMAILS` | JSON array: `["apcompras@equitel.com.co","dsanchez@equitel.com.co"]` | Ejecutar `actualizarAnalystEmails()` después de editar el array en código. |
| `SUPER_ADMIN_EMAILS` | JSON array de correos superadmin. Actualmente David + Yurani. | `setScriptProperty('SUPER_ADMIN_EMAILS', '[...]')` desde el editor. |
| `ADMIN_PIN_HASH` | SHA-256 del PIN admin compartido. Solo se usa si un admin NO tiene fila propia en USUARIOS (ej. `apcompras@`). | `updateAdminPin(nuevoPin)` desde el editor. Primera vez: `configurarPinInicial()` tras poner `INITIAL_ADMIN_PIN`. |
| `APPROVAL_LINK_SECRET` | Secreto HMAC para firmar los links de aprobación de correos. Se genera automáticamente la primera vez. | NO tocar manualmente. Si lo borras, todos los links firmados dejan de funcionar. |
| `APPROVAL_LINK_HMAC_CUTOVER_AT` | ISO timestamp opcional. Tras esa fecha, los links **sin firma** de solicitudes que entraron a su etapa DESPUÉS del cutover se rechazan (defensa contra links manipulados). Links de solicitudes pendientes al momento del deploy siguen funcionando. | `setScriptProperty('APPROVAL_LINK_HMAC_CUTOVER_AT', '2026-04-19T00:01:00-05:00')`. Recomendado: setear 10-14 días después del deploy. |
| `USE_USUARIOS_SHEET` | `'true'` (activa modo USUARIOS) / `'false'` | Ejecutar `toggleUsuariosMode()` — cambia entre los dos modos. Rollback = ejecutar de nuevo. |
| `WEB_APP_URL` | URL del deploy Apps Script. | Default hardcoded. Si cambia el deploy, actualizar via editor → propiedades. |
| `PLATFORM_URL` | URL del frontend Cloud Run. | Default hardcoded. |
| `ROOT_DRIVE_FOLDER_ID` | Carpeta raíz de archivos. | Default hardcoded. |
| `BACKUP_FOLDER_ID` | Carpeta de respaldos (opcional). | Desde el sidebar de reorganización → sección Respaldo → pegar URL/ID. |
| `REPORT_TEMPLATE_ID` | ID del Google Doc template de reportes. | Generado automáticamente por `createReportTemplate()` (ejecutar una vez). |
| `CEO_EMAIL`, `DIRECTOR_EMAIL`, `ADMIN_EMAIL` | Correos ejecutivos. | Default hardcoded. |

**Diagnóstico de propiedades:** ejecuta `verPropiedadesDelScript()` desde el editor para ver el estado de todas.

### Detalles de autenticación (PIN admin + PIN personal)

- Si un admin **tiene fila propia en USUARIOS** (caso David, Yurani, Wendy), puede ingresar con el botón negro **ADMINISTRADOR** usando o bien el PIN admin compartido, o bien **su PIN personal** (el mismo que usa para ingresar como usuario). Esto evita el "cruce" cuando Chrome autocompleta el PIN personal en el formulario de admin.
- Si un admin **NO tiene fila en USUARIOS** (caso `apcompras@`), solo puede ingresar con el PIN admin compartido.
- El rate-limit por intentos fallidos es **por email**: fallar 5 veces con un correo bloquea solo ese correo por 15 min, no al resto de admins.

### Rate-limits y protecciones anti-abuso

| Límite | Ventana | Acción |
|---|---|---|
| PIN admin fallido | 5 intentos / 15 min | Bloqueo del correo específico. |
| PIN usuario fallido | 5 intentos / 15 min | Bloqueo del correo específico. |
| Regenerar PIN usuario ("olvidé mi PIN") | 3 regeneraciones / hora | Nueva solicitud rechazada. |
| Crear solicitudes | 10 solicitudes / día | Excedido → error claro al usuario. |

---

## 11. Funciones admin útiles (ejecutar desde el editor Apps Script)

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

---

## 12. Troubleshooting

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

## 13. Backup y recuperación

**Antes de cualquier cambio estructural** (reorganizar, migrar USUARIOS, etc.):

1. Menú **Equitel Viajes → Reorganizar Base Principal (Sidebar)**
2. Sección "🛡️ Respaldo completo del archivo" (arriba de todo)
3. Si es primera vez: pega la URL/ID de tu carpeta privada de Drive → **Guardar carpeta**
4. **📋 Crear respaldo ahora** → ~30-60s → copia completa en tu Drive

Recuperación: si algo sale MUY mal, abres la copia respaldada, la descargas como .xlsx, o la copias encima del sheet activo (requiere re-vincular Apps Script).

---

## 14. Contacto y mantenimiento

- **Código en:** github.com/dsanchez-ui/equitel_viajes_v1
- **Deploy frontend:** Cloud Run `sistematiquetesequitel-302740316698.us-west1.run.app`
- **Deploy backend:** Apps Script Web App, URL en `WEB_APP_URL`
- **Modelo de deploy:**
  - Frontend: push a `main` → Cloud Build auto-despliega.
  - Backend: copiar `server/Code.gs`, `server/AdminSidebar.html`, `server/ReorgSidebar.html` al editor GAS manualmente → redesplegar Web App.

---

*Última actualización: 2026-04-13*
