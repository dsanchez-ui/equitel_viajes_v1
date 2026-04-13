
export enum UserRole {
  REQUESTER = 'REQUESTER',
  ANALYST = 'ANALYST',
  APPROVER = 'APPROVER'
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
}

export interface SupportData {
  folderId: string;
  folderUrl: string;
  files: SupportFile[];
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
}

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
