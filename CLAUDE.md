# Equitel Viajes v2 - Guía de Proyecto para Claude

## Descripción General

Plataforma web de gestión de viajes corporativos para la Organización Equitel (Colombia). Permite a empleados solicitar viajes, a gerentes aprobarlos, y a analistas (equipo de viajes) gestionar opciones de vuelo/hotel, costos y reservas.

## Stack Tecnológico

- **Frontend:** React 19 + TypeScript + Tailwind CSS 4 + Vite 6
- **Backend:** Google Apps Script (GAS) desplegado como web app pública
- **Base de datos:** Google Sheets (hoja "Nueva Base Solicitudes")
- **Almacenamiento:** Google Drive (imágenes de opciones, soportes)
- **Email:** Gmail (notificaciones automáticas con HTML)
- **IA opcional:** Google Gemini (mejora de textos de modificación) — modelo `gemini-3.1-flash-lite`

## Estructura de Archivos Clave

```
/
├── App.tsx                     # Componente principal, routing, estado global
├── index.tsx                   # Entry point React DOM
├── types.ts                    # Interfaces y enums TypeScript
├── constants.ts                # Configuración, empresas, sedes, colores
├── components/
│   ├── Layout.tsx              # Header/footer wrapper
│   ├── AdminDashboard.tsx      # Vista analista (tabla de solicitudes)
│   ├── UserDashboard.tsx       # Vista solicitante (mis solicitudes)
│   ├── RequestForm.tsx         # Formulario crear/modificar solicitudes
│   ├── RequestDetail.tsx       # Modal detalle de solicitud (acciones)
│   ├── ModificationForm.tsx    # Formulario de modificación
│   ├── OptionUploadModal.tsx   # Subir imágenes vuelos/hotel
│   ├── ReservationModal.tsx    # Registrar reserva
│   ├── SupportUploadModal.tsx  # Subir soportes post-aprobación
│   ├── CostConfirmationModal.tsx # Confirmar costos finales
│   ├── PinEntryModal.tsx       # Ingreso PIN admin (8 dígitos)
│   ├── CancellationModal.tsx   # Anular solicitudes
│   ├── ConfirmationDialog.tsx  # Diálogo genérico de confirmación
│   └── CityCombobox.tsx        # Selector autocompletado de ciudades
├── services/
│   └── gasService.ts           # Cliente API hacia GAS
├── utils/
│   ├── dateUtils.ts            # Parseo y formato de fechas
│   └── EmailGenerator.ts      # Generador de emails HTML
├── server/
│   └── Code.gs                 # Backend completo en GAS (~3000 líneas)
├── correo-introductorio.html   # Template email introductorio
└── .env                        # VITE_API_BASE_URL (no se commitea)
```

## Comandos

- `npm run dev` — Servidor de desarrollo (puerto 3000)
- `npm run build` — Build de producción (output en `dist/`)
- `npm run preview` — Preview del build
- El backend (Code.gs) se despliega manualmente desde Google Apps Script Editor

## Flujo de Negocio (Ciclo de Vida de una Solicitud)

1. **Solicitante** ingresa con email → crea solicitud de viaje
2. **Validación automática** de política (8 días anticipación nacional, 30 internacional)
3. **Aprobador** (jefe directo, mapeado en hoja INTEGRANTES) aprueba/rechaza vía email
4. **Escalamiento automático**: viajes internacionales o >1.2M COP requieren aprobación adicional de CEO/CDS
5. **Analista** sube imágenes de opciones de vuelo/hotel
6. **Solicitante** revisa imágenes y describe su selección por escrito
7. **Analista** confirma costos finales (tiquetes + hotel)
8. **Analista** registra reserva (número, documento confirmación)
9. **Post-viaje**: se suben soportes (facturas, recibos)
10. **Estado final**: PROCESADO

### Estados posibles (RequestStatus):
- `PENDIENTE_APROBACION` → Esperando aprobación del jefe
- `PENDIENTE_OPCIONES` → Aprobado, esperando opciones del analista
- `PENDIENTE_SELECCION` → Opciones subidas, esperando selección del usuario
- `PENDIENTE_CONFIRMACION_COSTO` → Selección hecha, pendiente confirmar costo
- `APROBADO` → Costo confirmado, listo para reservar
- `RESERVADO` → Reserva registrada
- `PROCESADO` → Ciclo completado
- `DENEGADO` → Solicitud rechazada
- `ANULADO` → Solicitud cancelada
- `PENDIENTE_ANALISIS_CAMBIO` → Modificación solicitada, pendiente revisión

## Empresas del grupo

- **Cumandes** (antes "Cummins" — renombrada abril 2026)
- **Equitel**
- **Ingenergía**
- **LAP**

## Seguridad Implementada

- Login por email validado contra hoja INTEGRANTES
- Panel admin protegido con PIN de 8 dígitos (SHA-256 + salt, rate-limit 5 intentos/15 min)
- Sanitización HTML (prevención XSS) en emails
- Bloqueo de concurrencia en escrituras (LockService 30s)
- Roles: REQUESTER (solicitante), ANALYST (analista/admin)

## Google Sheets (Base de Datos)

Hojas principales:
- **Nueva Base Solicitudes** — Tabla principal de solicitudes
- **INTEGRANTES** — Directorio de empleados (email, aprobador asignado)
- **CIUDADES DEL MUNDO** — Mapeo ciudad/país para autocompletar
- **CDS vs UDEN** — Relaciones centros de costo

## Propiedades del Script GAS (Script Properties)

- `ANALYST_EMAILS` — JSON array de emails analistas
- `ADMIN_PIN_HASH` — PIN admin hasheado
- `WEB_APP_URL` — URL del endpoint GAS
- `PLATFORM_URL` — URL del frontend desplegado
- `ROOT_DRIVE_FOLDER_ID` — Carpeta raíz en Drive
- `GEMINI_API_KEY` — Clave API Gemini (opcional)
- `GEMINI_MODEL` — Modelo de IA (default `gemini-3.1-flash-lite`; cambiar sin desplegar)
- `REPORT_TEMPLATE_ID` — Template de reportes en Drive
- `CEO_EMAIL`, `DIRECTOR_EMAIL`, `ADMIN_EMAIL` — Emails de notificación

## Convenciones

- Todo el UI está en español
- Commits en inglés con prefijo conventional (fix:, feat:, etc.)
- El frontend se despliega en Cloud Run (build con Vite, serve con `serve -s dist`)
- No hay tests automatizados; validación manual
- Las opciones de vuelo/hotel son imágenes (PNG/JPG), no datos estructurados — decisión intencional de seguridad para evitar aprobación con un solo clic
- Las ciudades usan un componente CityCombobox custom (reemplazó datalist por problemas de compatibilidad)

## Notas Importantes

- El backend NO valida nombres de empresa — se guardan como texto libre en Sheets
- Las solicitudes existentes que decían "Cummins" siguen así en historial
- La API base URL viene de `.env` (VITE_API_BASE_URL) y debe apuntar al deploy actual de GAS
- El polling de actualizaciones en App.tsx es cada 15 segundos
- Máximo 5 pasajeros por solicitud
- Los vuelos pueden tener dirección IDA y VUELTA (opciones separadas)

## Modelo de IA (migración fuera de Gemini 2.5 — agosto 2026)

Única llamada a IA del sistema: `enhanceTextWithGemini` (Code.gs), botón "Mejorar
con IA" del formulario de modificación. Texto libre, sin `responseSchema`, no crítica.

- **Modelo elegido:** `gemini-3.1-flash-lite` — GA (no preview), y **más barato que
  el anterior** `gemini-2.5-flash`: $0.25/$1.50 vs $0.30/$2.50 por millón de tokens
  (in/out). Google lo describe como "frontier-class performance at a fraction of the cost".
- **Descartados:** `gemini-3.5-flash` ($1.50/$9.00 → 5× más caro), `gemini-3.7-flash`
  y `3.6-flash` ($0.75/$3.75, y el doble desde 2027), cualquier `preview`/`exp`
  (se retiran con ~2 semanas de aviso), y el Pro actual (solo existe en preview).
- **Motivo de la migración:** `gemini-2.5-flash` tiene retiro anunciado (oct-2026) y
  ya hubo reportes de 404 anticipados.
- **Cómo cambiar/revertir SIN desplegar:** `setScriptProperty('GEMINI_MODEL', '<id>')`
  desde el editor. Para volver al anterior: `'gemini-2.5-flash'`.
- **Cadena de respaldo:** si el ID configurado no existe, la app pasa sola al
  siguiente (`gemini-3.1-flash-lite` → `gemini-3.5-flash-lite` → `gemini-2.5-flash`).
  Solo se cambia de modelo ante errores de disponibilidad (404); cuota (429),
  credencial y red se propagan con mensaje claro al usuario.
- **Verificación:** `diagnosticarGemini()` (prueba cada modelo contra la API real y
  distingue 404 de 429) y `probarMejoraIA()` (prueba end-to-end), ambas desde el editor.
