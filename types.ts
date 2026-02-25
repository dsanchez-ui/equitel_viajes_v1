
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
}

export interface SupportFile {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  date: string;
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
}

export interface CostCenterMaster {
  code: string;
  name: string;
  businessUnit: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
