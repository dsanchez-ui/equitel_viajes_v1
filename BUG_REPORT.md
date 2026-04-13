# Bug Report — Equitel Viajes
**Auditado:** 2026-04-13  |  **Build:** post-64ebc6b (local, pre-commit)

---

## BUGS ENCONTRADOS Y CORREGIDOS (esta sesion)

- [x] **#1 CRITICAL — App.tsx:425 — `userRole` no existe (NEW)**
      `isAdmin={userRole === 'ANALYST'}` referenciaba variable inexistente.
      isAdmin siempre era false -> boton Reporte nunca aparecia en RequestDetail.
      FIX: cambiado a `role === UserRole.ANALYST`

- [x] **#2 LOW — Stale closure en closeDialog (OLD, 6 archivos)**
      `setDialog({ ...dialog, isOpen: false })` captura `dialog` del render inicial.
      En la practica no rompe nada (isOpen:false oculta el modal), pero es
      tecnicamente incorrecto y puede causar bugs si se encadenan dialogs.
      FIX: cambiado a `setDialog(prev => ({ ...prev, isOpen: false }))` en:
        AdminDashboard, CostConfirmationModal, OptionUploadModal,
        RequestDetail, ReservationModal, SupportUploadModal

- [x] **#3 MEDIUM — SupportUploadModal: delete-before-upload (OLD)**
      Si se borraban archivos y luego fallaba la subida de nuevos, los
      archivos borrados ya no se podian recuperar. Orden riesgoso.
      FIX: ahora sube primero, borra despues.


## BUGS ENCONTRADOS — TODOS CORREGIDOS

- [x] **#4 HIGH — App.tsx:414 — AdminDashboard sin guard de `view` (OLD)**
      Cuando un analista hacia click en "Solicitar Cambio" desde RequestDetail,
      `view` cambiaba a 'NEW' pero AdminDashboard seguia renderizandose.
      Resultado: RequestForm y AdminDashboard se mostraban simultaneamente.
      FIX: agregado `&& view === 'LIST'` a la condicion de render.

- [x] **#5 MEDIUM — Code.gs:276 — payload.data fallback en createRequest (OLD)**
      El payload completo (incluyendo sessionToken, userEmail) pasaba como
      argumento a createNewRequest cuando no habia wrapper `data`.
      FIX: se filtran sessionToken, userEmail y action antes de pasar.


## BUGS PREVIAMENTE RESUELTOS (sesiones anteriores)

- [x] Check-out N/A para hotel-only (payload borraba returnDate)
- [x] validateRequestInput_ rechazaba hotel-only (origin requerido)
- [x] CostConfirmationModal bloqueaba hotel-only (costTickets requerido)
- [x] 16 labels incorrectos en emails para hotel-only
- [x] Funciones duplicadas getStandardSubject/sendEmailRich
- [x] onOpen gate bloqueaba sidebar en clon (Session.getActiveUser vacio)
- [x] Empresa: codigo CU/ET/IG/LI no se traducia a nombre completo en migracion


## AREAS SIN BUGS DETECTADOS

- Flujo de aprobacion (processApprovalFromEmail) — logica compleja pero correcta
- Dedup de correos CEO/CDS — verificada manualmente, funciona
- Metricas (_workingMinutesBetween_) — logica nueva, sin bugs obvios
- Session management (token-based) — robusto
- PIN hashing + rate limiting — correcto
- Change request flow (processChangeDecision) — bien protegido con guards
- User consultation flow (processUserConsultResponse) — idempotente
- Reservation amendment (amendReservation) — nuevo, auditado ok
- escapeHtml_ aplicado en todos los puntos de inyeccion HTML
