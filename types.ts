
export enum UserRole {
  REQUESTER = 'REQUESTER',
  ANALYST = 'ANALYST',
  APPROVER = 'APPROVER',
  SUPERADMIN = 'SUPERADMIN'
}

export enum RequestStatus {
  PENDING_OPTIONS = 'PENDIENTE_OPCIONES',
  PENDING_SELECTION = 'PENDIENTE_SELECCION',
  PENDING_CONFIRMACION_COSTO = 'PENDIENTE_CONFIRMACION_COSTO',
  PENDING_APPROVAL = 'PENDIENTE_APROBACION',
  PENDING_CHANGE_APPROVAL = 'PENDIENTE_ANALISIS_CAMBIO',
  APPROVED = 'APROBADO',
  RESERVED = 'RESERVADO', // New Status: Tiquetes Comprados (Internal)
  REJECTED = 'DENEGADO',
  PROCESSED = 'PROCESADO',
  CANCELLED = 'ANULADO'
}

export interface Passenger {
  name: string;
  idNumber: string;
  email?: string;
}

export interface Integrant {
  idNumber: string;
  name: string;
  email: string;
  approverName: string;
  approverEmail: string;
}

export interface FlightDetails {
  airline: string;
  flightTime: string;
  flightNumber?: string;
  notes: string;
}

// Updated Option interface for Image-based workflow
export interface Option {
  id: string;
  type: 'FLIGHT' | 'HOTEL';
  url: string;
  driveId: string;
  name: string;
  direction?: 'IDA' | 'VUELTA';
  localPreview?: string;
}

export interface SupportFile {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  date: string;
  isReservation?: boolean;
  isCorrection?: boolean;
  // DEPRECATED — solo presente en datos legacy (versión donde el pasaporte se
  // copiaba a la carpeta de la solicitud). El diseño actual mantiene el
  // pasaporte SOLO en su carpeta canónica `Pasaportes Integrantes/{cedula}/`.
  // Los campos quedan como opcionales para compatibilidad con SOPORTES JSON
  // que pudiera tener entradas previas.
  isPassport?: boolean;
  cedula?: string;
  nombre?: string;
}

export interface SupportData {
  folderId: string;
  folderUrl: string;
  files: SupportFile[];
}

// Estado del pasaporte de una persona consultado por cédula.
// source: 'USUARIOS' → el pasaporte está registrado en la fila de USUARIOS
//         'DRIVE'    → existe en Pasaportes Integrantes pero no está reflejado en USUARIOS (ej. externo)
//         'NONE'     → no se encontró pasaporte cargado
export interface PassportStatus {
  cedula: string;
  hasPassport: boolean;
  uploadedAt: string | null;
  fileUrl: string | null;
  fileId: string | null;
  source: 'USUARIOS' | 'DRIVE' | 'NONE';
}

// Estado de la fecha de nacimiento de un pasajero, consultado por cédula.
// El backend NUNCA devuelve la fecha: solo si la persona está registrada en
// USUARIOS y si ya la tiene (formulario de solicitudes, reunión 2026-09-10).
export interface BirthdateStatus {
  cedula: string;
  registered: boolean;
  hasBirthdate: boolean;
  hasPhone?: boolean; // #A75: si ya tiene celular válido; ausente con un backend anterior
}

// Fecha de nacimiento y celular de un pasajero para el detalle de la solicitud.
// SOLO los reciben los administradores (el backend lo exige). source: 'USUARIOS'
// = del perfil; 'SOLICITUD' = de un externo, guardada en la solicitud; 'NONE' = falta.
export interface PassengerAdminInfo {
  cedula: string;
  birthdate: string; // 'AAAA-MM-DD' o '' si falta
  source: 'USUARIOS' | 'SOLICITUD' | 'NONE';
  phone?: string; // celular de 10 dígitos o '' si no hay (#A74); ausente con un backend anterior
}

export interface TravelRequest {
  requestId: string;
  timestamp: string;
  requesterEmail: string;

  // Linked Request Fields
  relatedRequestId?: string;
  requestType?: 'ORIGINAL' | 'MODIFICACION';

  // Company Info
  company: string;
  businessUnit: string;
  site: string;
  costCenter: string;
  costCenterName?: string;
  variousCostCenters?: string;
  workOrder?: string;

  // Trip Info
  isInternational: boolean;
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  departureTimePreference: string;
  returnTimePreference?: string;

  // Passengers
  passengers: Passenger[];

  // Hotel
  requiresHotel: boolean;
  hotelName?: string;
  nights?: number;

  // System/Process Fields
  status: RequestStatus;
  policyViolation: boolean;
  approverName?: string;
  approverEmail?: string;

  // New workflow fields
  analystOptions?: Option[];
  selectionDetails?: string; // User written selection
  finalCostTickets?: number; // Entered by Admin
  finalCostHotel?: number; // Entered by Admin
  totalCost?: number; // Sum

  // Reservation Info (New)
  reservationNumber?: string;
  reservationUrl?: string;

  comments?: string;
  creditCard?: string;

  // International Workflow Specifics
  approvalStatusCDS?: string;
  approvalStatusCEO?: string;
  approvalStatusArea?: string; // New field for traceability

  // Supports (Post-Approval)
  supportData?: SupportData;

  // Modification Workflow
  changeReason?: string;
  hasChangeFlag?: boolean;

  // Metadata for email banners
  parentWasReserved?: boolean;
  parentTimestamp?: string;
  daysInAdvance?: number;

  // Request mode: 'FLIGHT' (default, viaje normal) or 'HOTEL_ONLY' (solo hospedaje)
  requestMode?: 'FLIGHT' | 'HOTEL_ONLY';

  // Aerolínea y canal de compra (#A82): 'Aviatur' | 'Directo' | 'Otra agencia'.
  // Vacíos si aún no se registraron (o con un backend anterior).
  purchaseAirline?: string;
  purchaseChannel?: string;
  // Aerolínea del regreso si es distinta de la de ida (#A85). undefined = el
  // servidor aún no la maneja (la app no ofrece la opción).
  purchaseReturnAirline?: string;
  // Hotel reservado y su canal de compra (#A94): 'Aviatur' | 'Directo' |
  // 'Otra agencia' | 'No se reservó'. undefined = el servidor aún no los maneja.
  purchaseHotelName?: string;
  purchaseHotelChannel?: string;
  // Tarifa del tiquete según el manual COM-P-02 (#A95): '1' | '2' | '3' o '' si no
  // está registrada. undefined = el servidor aún no la maneja (la app no la pide).
  fareType?: string;
  fareRecommended?: string;
  fareName?: string;
  fareJustification?: string;

  // EFFECTIVE approval status (computed by backend, mirrors the dedup rules
  // applied in sendApprovalRequestEmail / processApprovalFromEmail).
  // Possible values: 'APPROVED' | 'DENIED' | 'PENDING' | 'NA'.
  // *Reason fields are filled when the role is NA, explaining why.
  effectiveApprovalArea?: 'APPROVED' | 'DENIED' | 'PENDING' | 'NA';
  effectiveApprovalAreaReason?: string;
  effectiveApprovalCeo?: 'APPROVED' | 'DENIED' | 'PENDING' | 'NA';
  effectiveApprovalCeoReason?: string;
  effectiveApprovalCds?: 'APPROVED' | 'DENIED' | 'PENDING' | 'NA';
  effectiveApprovalCdsReason?: string;
  requesterIsCeo?: boolean;
  requesterIsCds?: boolean;
  ceoIsAreaApprover?: boolean;
  cdsIsAreaApprover?: boolean;
  requiresExecutiveApproval?: boolean;
  requiresCeoApproval?: boolean;
  requiresCdsApproval?: boolean;
  // BUDGET_OVERRUN (2026-05-21): aprobación adicional cuando la solicitud
  // causa que el presupuesto del periodo de la unidad se exceda. Configurable
  // desde el dashboard de costos (deshabilitado por default).
  requiresBudgetOverrunApproval?: boolean;
  effectiveApprovalBudgetOverrun?: 'APPROVED' | 'DENIED' | 'PENDING' | 'NA';
  effectiveApprovalBudgetOverrunReason?: string;
  approvalStatusBudgetOverrun?: string;
  budgetApproverEmail?: string;
  budgetApproverName?: string;
  budgetApproverIsAreaApprover?: boolean;
  // True cuando el solicitante no es ninguno de los pasajeros (detección por cédula
  // contra directorio + fallback por correo). Se usa para mostrar el ícono 👥 en
  // dashboards. No afecta el flujo de aprobación.
  isProxyRequest?: boolean;

  // COMENTARIOS DE APROBADORES (2026-07-27): comentario opcional que cada
  // aprobador puede dejar al aprobar desde el correo (máx. uno por rol).
  // La instrucción del aprobador prima sobre la selección del usuario.
  // Presente también en el payload lite (el ReservationModal lo necesita).
  approverComments?: ApproverComment[];

  // FECHA DE NACIMIENTO (2026-09-10): solo en el payload de creación de vuelos.
  // { cédula: 'AAAA-MM-DD' } con los pasajeros a los que les faltaba. Su sola
  // presencia le indica al backend que el formulario ya pide la fecha. No se
  // devuelve en las lecturas de solicitudes.
  passengerBirthdates?: Record<string, string>;

  // CELULAR (#A75): solo en el payload de creación. { cédula: '3001234567' } con
  // los celulares OPCIONALES que se escribieron en el formulario.
  passengerPhones?: Record<string, string>;

  // SOLO ADMINISTRADORES (#A74): fecha de nacimiento y celular por pasajero.
  // Llega dentro de getRequestById cuando quien consulta es administrador; no
  // viene para el solicitante, en las filas lite ni con un backend anterior.
  passengerAdminInfo?: PassengerAdminInfo[];
}

// Comentario opcional dejado por un aprobador al aprobar (ver Code.gs
// _appendApproverComment_). role: 'NORMAL' | 'CEO' | 'CDS' | 'BUDGET_OVERRUN'.
export interface ApproverComment {
  role: string;
  email: string;
  comment: string;
  at?: string;
}

// Etiquetas legibles por rol de aprobación — mantener consistentes con
// _approverRoleLabel_ del backend (correos).
export const APPROVER_ROLE_LABELS: Record<string, string> = {
  NORMAL: 'Aprobador de Área',
  CEO: 'Gerencia General',
  CDS: 'Dirección Cadena de Suministro',
  BUDGET_OVERRUN: 'Aprobador de Presupuesto',
};

export interface CostCenterMaster {
  code: string;
  name: string;
  businessUnit: string;
}

export interface CityMaster {
  city: string;
  country: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

// =====================================================================
// MÉTRICAS — admin-only dashboard
// =====================================================================

export interface MetricsFilters {
  requestId?: string;
  dateFrom?: string; // ISO date
  dateTo?: string;
  excludeStatuses?: string[];
  hideNoEvents?: boolean;
}

export interface ApprovalMetric {
  role: string; // 'NORMAL' | 'CEO' | 'CDS'
  email: string;
  timeMinutes: number | null;
}

export interface RequestMetrics {
  requestId: string;
  requesterEmail: string;
  destination: string;
  company: string;
  status: string;
  created: string | null;
  timeToOptionsMinutes: number | null;
  timeToSelectionMinutes: number | null;
  timeToCostConfirmMinutes: number | null;
  timeToFullApprovalMinutes: number | null;
  timeToReservationMinutes: number | null;
  totalCycleMinutes: number | null;
  approvals: ApprovalMetric[];
  hasEvents: boolean;
  crossDays?: {
    toOptions: number | null;
    toSelection: number | null;
    toCostConfirm: number | null;
    toFullApproval: number | null;
    toReservation: number | null;
    totalCycle: number | null;
  };
}

export interface ApproverPerformance {
  email: string;
  role: string;
  count: number;
  avgTimeMinutes: number;
}

export interface MetricsAggregates {
  count: number;
  countWithCompleteData: number;
  avgTimeToOptionsMinutes: number | null;
  avgTimeToSelectionMinutes: number | null;
  avgTimeToCostConfirmMinutes: number | null;
  avgTimeToFullApprovalMinutes: number | null;
  avgTimeToReservationMinutes: number | null;
  avgTotalCycleMinutes: number | null;
  approverPerformance: ApproverPerformance[];
}

export interface AnalystStagePerformance {
  stage: string;
  label: string;
  count: number;
  avgMinutes: number | null;
  minMinutes: number | null;
  maxMinutes: number | null;
}

export interface MetricsResponse {
  perRequest: RequestMetrics[];
  aggregates: MetricsAggregates;
  analystPerformance: AnalystStagePerformance[];
}

// ===== Estadísticas de compra de tiquetes y hospedaje (#A80) =====
// Solo agregados: el backend no envía nombres, cédulas ni correos.

export interface PurchaseStatsFilters {
  dateFrom?: string; // 'AAAA-MM-DD' (fecha de compra; sin fecha = toda la historia)
  dateTo?: string;
}

export interface PurchaseStatsBucket {
  label: string;
  requests: number;
  tickets: number;
  ticketsWithCost: number;
  avgTicket: number | null;
}

export interface PurchaseStatsMonth {
  month: string; // 'AAAA-MM'
  partial: boolean;
  requests: number;
  tickets: number;
  roomNights: number;
  spendTickets: number;
  spendHotel: number;
  avgTicket: number | null;
  avgNightShort: number | null;
  businessDays: number;
  pctLate: number | null;
}

export interface PurchaseStatsRoute {
  route: string;
  international: boolean;
  requests: number;
  tickets: number;
  share: number | null;
  avgTicket: number | null;
  avgLate: number | null;
  avgEarly: number | null;
}

export interface PurchaseStatsCity {
  city: string;
  requests: number;
  roomNights: number;
  avgNight: number | null;
  avgNightShort: number | null;
  avgStay: number | null;
}

export interface PurchaseStatsTotals {
  requests: number;
  flightRequests: number;
  hotelOnlyRequests: number;
  tickets: number;
  ticketsNational: number;
  ticketsInternational: number;
  ticketsPerBusinessDay: number | null;
  ticketsPerMonth: number;
  requestsPerMonth: number;
  roomNights: number;
  hotelRequests: number;
  roomNightsPerMonth: number;
  spend: number;
  spendTickets: number;
  spendHotel: number;
  spendPerMonth: number;
  annualProjection: number;
  avgPerRequest: number | null;
  avgTicket: number | null;
  avgTicketNational: number | null;
  avgTicketInternational: number | null;
  medianTicketNational: number | null;
  avgNight: number | null;
  avgNightShort: number | null;
  avgNightLong: number | null;
  shortStayShare: number | null;
  longStays: number;
  avgStayNights: number | null;
  avgPassengers: number | null;
  pctSinglePassenger: number | null;
  pctRoundTrip: number | null;
  pctInternational: number | null;
  avgPurchaseLeadDays: number | null;
  avgRequestLeadDays: number | null;
  avgDaysRequestToPurchase: number | null;
  medianDaysRequestToPurchase: number | null;
  pctTicketsLate: number | null;
  pctPolicyViolation: number | null;
  pctWeekend: number | null;
  invoicedVsConfirmed: number | null;
  invoice1Requests: number;
  invoice1ChargesPct: number | null;
}

export interface PurchaseStats {
  empty?: boolean;
  period: { from: string; to: string; days: number; businessDays: number; months: number; firstDataDate: string; lastDataDate: string };
  totals: PurchaseStatsTotals;
  late: {
    buckets: PurchaseStatsBucket[];
    noLead: { requests: number; tickets: number };
    avgLate: number | null;
    avgEarly: number | null;
    ticketsLate: number;
    ticketsEarly: number;
    overcost: number;
    annualSavingsIfHalfPlanned: number;
  };
  byMonth: PurchaseStatsMonth[];
  topRoutes: PurchaseStatsRoute[];
  routeCount: number;
  topCities: PurchaseStatsCity[];
  cityCount: number;
  byWeekday: { day: number; requests: number; tickets: number }[];
  dataNotes: { symbolicCosts: number; withoutPurchaseDate: number; purchaseAfterDeparture: number };
}

// ===== Facturas listas para cerrar y por revisar (#A83) =====

export interface InvoiceReviewItem {
  requestId: string;
  requesterEmail: string;
  origin: string;
  destination: string;
  hotelOnly: boolean;
  tripEnd: string; // 'AAAA-MM-DD'
  daysSinceEnd: number | null;
  quoted: number;
  invoiced: number;
  missing: number;
  /** 'FALTAN_FACTURAS' (no suman lo cotizado) o 'FALTAN_PDF' (suman, pero hay menos PDF subidos que facturas). */
  reason?: 'FALTAN_FACTURAS' | 'FALTAN_PDF' | '';
  invoiceCount?: number;
  uploadedPdfs?: number;
}

export interface InvoiceReview {
  /** Viaje terminado hace graceDays o más y facturado menor que lo cotizado (sin aviso omitido). */
  alerts: InvoiceReviewItem[];
  /** Listas para cerrar: viaje terminado, facturas que suman lo cotizado y sus PDF. El área de viajes las cierra; no se cierran solas. */
  pendingClose: InvoiceReviewItem[];
  dismissedCount: number;
  waitingCount: number;
  graceDays: number;
}
