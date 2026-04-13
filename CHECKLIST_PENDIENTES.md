# Checklist de Pendientes — Equitel Viajes
**Fecha:** 2026-04-13  |  **Post-deploy:** commit 64ebc6b

---

## PARA HACER AHORA (horario laboral, seguro)

- [x] **A1 — Desplegable "Persona que tramita"** (MISC)
      Quién: David  |  Impacta: Solo Wendy

- [x] **A3 — Columna "Tipo de Compra" en amarillo**
      Quién: David  |  Impacta: Solo Wendy (visual)

- [x] **B5 — Copiar Code.gs al clon** (última versión sin duplicados)
      Quién: David

- [x] **B6 — Copiar Code.gs a producción** (sin funciones duplicadas)
      Quién: David

- [x] **A6 — Métricas solo horario laboral**
      Quién: Claude  |  Listo en código, pendiente deploy
      _workingMinutesBetween_ cuenta solo L-V 7-17 y Sab 8-12

- [x] **A2 — Fecha de compra de tiquete** (selector en ReservationModal)
      Quién: Claude  |  Listo en código, pendiente deploy
      Campo date con default hoy, guarda en FECHA DE COMPRA DE TIQUETE

- [x] **A5 — Corrección de documentos de reserva**
      Quién: Claude  |  Listo en código, pendiente deploy
      Checkbox + nota en SupportUploadModal (solo RESERVADO), envía correo al usuario


## PARA DEPLOY ESTA NOCHE

  Estos 3 items (A6, A2, A5) están en el código local listos.
  Pasos: copiar Code.gs a producción + push frontend a main.

- [ ] **A4 — Reorganizar columnas de la hoja principal**
      Quién: Claude + David  |  Impacta: Wendy + toda la app si sale mal
      Requiere remapeo dinámico por headers. Sesión dedicada, hoja quieta.


## PLAN 2 — Migración a hoja USUARIOS

- [x] **P2-A1 — Crear hoja USUARIOS** (crearHojaUsuarios)
      Ya existe en el clon. En producción se crea cuando David lo decida.

- [x] **P2-A2 — Migrar datos de INTEGRANTES** (migrarIntegrantesAUsuarios)
      Hecho en clon. Incluye mapeo empresa CU/ET/IG/LI → nombres completos.
      Re-migrar después de copiar Code.gs nuevo (tiene _mapEmpresaCode_).

- [x] **P2-A3 — Sincronizar con Maestro RH** (sincronizarConMaestroRH)
      Función lista. Crea stubs para empleados de RH que no están en USUARIOS.

- [x] **P2-A4 — Sidebar de gestión** (AdminSidebar.html)
      Funcional: crear, editar, eliminar, buscar usuarios, reemplazo masivo
      de aprobadores, vista de anomalías, reset de PIN.

- [x] **P2-A5 — onOpen desgateado** — menú siempre visible
      Ya no requiere USE_USUARIOS_SHEET ni isSetupAdmin para mostrar menú.

- [x] **P2-A6 — abrirSidebarUsuarios desgateado**
      Solo requiere que exista la hoja USUARIOS, no el switch de backend.

- [ ] **P2-B1 — Validar datos migrados en el clon**
      David: abrir sidebar en clon, verificar que empresas aparecen bien
      (Cumandes en lugar de CU, etc.), aprobadores resueltos, PINs intactos.

- [ ] **P2-B2 — Activar switch en producción** (USE_USUARIOS_SHEET = 'true')
      Cuando P2-B1 esté OK. Script Properties → true → el backend lee USUARIOS.
      Rollback inmediato: cambiar a 'false'.

- [ ] **P2-B3 — Renombrar INTEGRANTES a INTEGRANTES_LEGACY**
      Después de confirmar que todo funciona con USUARIOS activo en prod.


## PARA ESTA SEMANA

- [ ] **A7 — Guía de Administrador**
      Quién: David/Claude  |  Impacta: Futuro reemplazo de Wendy
      Documento explicando columnas, flujos, qué no tocar

- [ ] **D1 — Remapeo dinámico de columnas** (leer headers fila 1)
      Prerequisito de A4. Permite reordenar/agregar columnas sin romper app.

- [ ] **D3 — Recordatorio de consulta al usuario** (trigger cada 2h)
      Función de re-envío para cuando el usuario no responde CONTINUAR/ANULAR.
      David crea trigger en GAS cuando la función esté lista.


## YA EN PRODUCCION

- [x] C1 — Pausa de recordatorios cuando existe cambio activo
- [x] C2 — Sección "Cambios Pendientes" en recordatorio admin
- [x] C3 — Endpoint processChangeDecision + ChangeRequestModal
- [x] C4 — Botón "Revisar Cambio" en dashboard
- [x] C5 — Correo de consulta al usuario (CONTINUAR/ANULAR)
- [x] C6 — Mejora de wording en emails de cambio
- [x] C7 — Disable "Solicitar Cambio" en REJECTED/PENDING_CHANGE_APPROVAL
- [x] B1 — Fix onOpen gate (menú siempre visible)
- [x] B2 — Fix abrirSidebarUsuarios (no requiere switch)
- [x] B3 — Mapeo empresa CU/ET/IG/LI en migración
- [x] D4 — Triggers de recordatorios (approval + selection + admin) cada 2h
