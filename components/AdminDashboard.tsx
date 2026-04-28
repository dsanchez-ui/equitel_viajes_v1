
import React, { useMemo, useState } from 'react';
import { TravelRequest, RequestStatus, Integrant } from '../types';
import { OptionUploadModal } from './OptionUploadModal';
import { SupportUploadModal } from './SupportUploadModal';
import { ReservationModal } from './ReservationModal';
import { CostConfirmationModal } from './CostConfirmationModal';
import { ConfirmationDialog } from './ConfirmationDialog';
import { PinEntryModal } from './PinEntryModal';
import { CancellationModal } from './CancellationModal';
import { MetricsPanel } from './MetricsPanel';
import { ChangeRequestModal } from './ChangeRequestModal';
import { gasService } from '../services/gasService';
import { getDaysDiff, formatToDDMMYYYY, formatShortDateTime } from '../utils/dateUtils';

interface AdminDashboardProps {
  requests: TravelRequest[];
  integrantes: Integrant[];
  onRefresh: () => void;
  isLoading: boolean;
  onViewRequest: (req: TravelRequest) => void;
  isSuperAdmin?: boolean;
}

/**
 * Una solicitud es PRIORITARIA cuando QUIEN VIAJA (primer pasajero u otro pasajero)
 * es su propio aprobador: CEO, Director CDS, o cualquier persona cuyo aprobador
 * asignado coincide con su propio correo. Se determina por pasajeros, NO por
 * solicitante — si Mauricio (CEO) crea una solicitud para Juan, la solicitud no
 * es prioritaria porque Juan no es autoaprobador.
 */
const isRequestPriority = (req: TravelRequest, integrantes: Integrant[]): boolean => {
  // Caso A: el solicitante aparece entre los aprobadores asignados al request.
  // approverEmail se deriva del primer pasajero en el form — si coincide con el
  // solicitante, es porque el solicitante ES el primer pasajero y su aprobador.
  const requesterLower = (req.requesterEmail || '').toLowerCase().trim();
  if (requesterLower && !req.isProxyRequest) {
    const approverEmails = (req.approverEmail || '')
      .toLowerCase()
      .split(',')
      .map(e => e.trim())
      .filter(Boolean);
    if (approverEmails.includes(requesterLower)) return true;
  }

  // Caso B: algún pasajero es su propio aprobador según el directorio.
  if (integrantes && integrantes.length > 0 && req.passengers && req.passengers.length > 0) {
    for (const p of req.passengers) {
      const matches = integrantes.filter(i =>
        (p.idNumber && i.idNumber === p.idNumber) ||
        (p.email && i.email && i.email.toLowerCase() === p.email.toLowerCase())
      );
      for (const m of matches) {
        if (m.approverEmail && m.email && m.email.toLowerCase() === m.approverEmail.toLowerCase()) {
          return true;
        }
      }
    }
  }

  return false;
};

const PAGE_SIZE = 50;

const AdminDashboardImpl: React.FC<AdminDashboardProps> = ({ requests, integrantes, onRefresh, isLoading, onViewRequest, isSuperAdmin }) => {
  const [filter, setFilter] = useState<string>('ALL');
  const [showOnlyPriority, setShowOnlyPriority] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);

  // Pre-compute priority flag por requestId para evitar O(N*M) en cada render
  const priorityMap = useMemo(() => {
    const m = new Map<string, boolean>();
    requests.forEach(r => m.set(r.requestId, isRequestPriority(r, integrantes)));
    return m;
  }, [requests, integrantes]);

  const priorityCount = useMemo(() => {
    let count = 0;
    priorityMap.forEach(v => { if (v) count++; });
    return count;
  }, [priorityMap]);
  const [selectedRequestForOptions, setSelectedRequestForOptions] = useState<TravelRequest | null>(null);
  const [selectedRequestForSupports, setSelectedRequestForSupports] = useState<TravelRequest | null>(null);
  const [selectedRequestForReservation, setSelectedRequestForReservation] = useState<TravelRequest | null>(null);
  const [selectedRequestForCosts, setSelectedRequestForCosts] = useState<TravelRequest | null>(null);
  const [selectedRequestForCancellation, setSelectedRequestForCancellation] = useState<TravelRequest | null>(null);
  const [selectedRequestForChange, setSelectedRequestForChange] = useState<TravelRequest | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [showPinChangeModal, setShowPinChangeModal] = useState(false);
  const [showMetricsPanel, setShowMetricsPanel] = useState(false);

  // Dialog State
  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'ALERT' | 'CONFIRM' | 'SUCCESS';
    onConfirm: () => void;
    onCancel?: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'ALERT',
    onConfirm: () => { },
  });

  const closeDialog = () => setDialog(prev => ({ ...prev, isOpen: false }));

  // Orden descendente por timestamp (más recientes primero) para que la página 1
  // siempre muestre lo reciente sin importar el orden del backend.
  const filteredRequests = useMemo(() => {
    const out = requests.filter(r => {
      if (showOnlyPriority && !priorityMap.get(r.requestId)) return false;
      if (filter === 'ALL') return true;
      return r.status === filter;
    });
    out.sort((a, b) => {
      const ta = new Date(a.timestamp || 0).getTime() || 0;
      const tb = new Date(b.timestamp || 0).getTime() || 0;
      return tb - ta;
    });
    return out;
  }, [requests, priorityMap, showOnlyPriority, filter]);

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE));
  // Si el filtro reduce el total y la página actual queda fuera de rango, resetear.
  React.useEffect(() => { if (page > totalPages) setPage(1); }, [totalPages, page]);
  const pagedRequests = useMemo(
    () => filteredRequests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredRequests, page]
  );

  // Estados terminales se muestran en gris (ANULADO/DENEGADO/PROCESADO).
  const TERMINAL_STATUSES: string[] = ['ANULADO', 'DENEGADO', 'PROCESADO'];

  const getStatusBadge = (status: RequestStatus) => {
    switch (status) {
      case RequestStatus.PENDING_OPTIONS: return 'bg-yellow-100 text-yellow-800';
      case RequestStatus.PENDING_SELECTION: return 'bg-blue-100 text-blue-800';
      case RequestStatus.PENDING_CONFIRMACION_COSTO: return 'bg-purple-100 text-purple-800';
      case RequestStatus.PENDING_APPROVAL: return 'bg-purple-100 text-purple-800';
      case RequestStatus.PENDING_CHANGE_APPROVAL: return 'bg-amber-100 text-amber-800';
      case RequestStatus.APPROVED: return 'bg-green-100 text-green-800';
      case RequestStatus.RESERVED: return 'bg-indigo-100 text-indigo-800';
      case RequestStatus.REJECTED: return 'bg-red-100 text-red-800';
      case RequestStatus.PROCESSED: return 'bg-gray-800 text-white';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const confirmFinalize = (req: TravelRequest) => {
    setDialog({
      isOpen: true,
      title: 'Finalizar Solicitud',
      message: `¿Está seguro de cerrar la solicitud ${req.requestId}?\n\nEsto indicará que el proceso ha concluido (facturas cargadas).`,
      type: 'CONFIRM',
      onConfirm: () => executeFinalize(req),
      onCancel: closeDialog
    });
  };

  const executeFinalize = async (req: TravelRequest) => {
    closeDialog();
    setProcessingId(req.requestId);
    try {
      await gasService.closeRequest(req.requestId);

      setDialog({
        isOpen: true,
        title: 'Proceso Completado',
        message: `La solicitud ${req.requestId} ha sido finalizada correctamente.`,
        type: 'SUCCESS',
        onConfirm: () => {
          closeDialog();
          onRefresh();
        }
      });
    } catch (e) {
      setDialog({
        isOpen: true,
        title: 'Error',
        message: "Error finalizando solicitud: " + e,
        type: 'ALERT',
        onConfirm: closeDialog
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handlePinChangeSubmit = async (newPin: string) => {
    try {
      await gasService.updateAdminPin(newPin);
      setShowPinChangeModal(false);
      setDialog({
        isOpen: true,
        title: 'Seguridad Actualizada',
        message: 'El PIN de administrador ha sido actualizado correctamente.',
        type: 'SUCCESS',
        onConfirm: closeDialog
      });
      return true;
    } catch (e) {
      alert("Error actualizando PIN: " + e);
      return false;
    }
  };

  const handleCancelRequest = async (reason: string) => {
    if (!selectedRequestForCancellation) return;

    setProcessingId(selectedRequestForCancellation.requestId);
    try {
      await gasService.cancelRequest(selectedRequestForCancellation.requestId, reason);
      setSelectedRequestForCancellation(null);
      onRefresh();

      setDialog({
        isOpen: true,
        title: 'Solicitud Anulada',
        message: `La solicitud ${selectedRequestForCancellation.requestId} ha sido anulada exitosamente.`,
        type: 'SUCCESS',
        onConfirm: closeDialog
      });
    } catch (e) {
      alert("Error anulando solicitud: " + e);
    } finally {
      setProcessingId(null);
    }
  };

  const handleGenerateReport = async (req: TravelRequest) => {
    setProcessingId(req.requestId);
    try {
      const pdfUrl = await gasService.generateReport(req.requestId);
      setDialog({
        isOpen: true,
        title: 'Reporte Generado',
        message: `El reporte PDF de ${req.requestId} ha sido guardado en la carpeta de Drive.`,
        type: 'SUCCESS',
        onConfirm: () => {
          closeDialog();
          if (pdfUrl) window.open(pdfUrl, '_blank');
        }
      });
    } catch (e) {
      setDialog({
        isOpen: true,
        title: 'Error',
        message: 'Error generando reporte: ' + e,
        type: 'ALERT',
        onConfirm: closeDialog
      });
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <ConfirmationDialog
        isOpen={dialog.isOpen}
        title={dialog.title}
        message={dialog.message}
        type={dialog.type}
        onConfirm={dialog.onConfirm}
        onCancel={dialog.onCancel}
      />

      {showPinChangeModal && (
        <PinEntryModal
          isOpen={showPinChangeModal}
          title="Cambiar PIN de Acceso"
          onClose={() => setShowPinChangeModal(false)}
          onSubmit={handlePinChangeSubmit}
          onChangeMode={true}
        />
      )}

      <div className="sm:flex sm:items-center justify-between">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-gray-900">Panel de Analista</h1>
          <p className="mt-2 text-sm text-gray-700">Gestione cotizaciones, opciones y procesos de aprobación.</p>
        </div>
        <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none flex gap-2">
          <button
            onClick={() => setShowMetricsPanel(true)}
            disabled={isLoading}
            className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50 gap-2"
            title="Ver métricas de tiempos por etapa"
          >
            <span>📊</span>
            Métricas
          </button>
          <button
            onClick={() => setShowPinChangeModal(true)}
            disabled={isLoading}
            className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50 gap-2"
          >
            <span>🔒</span>
            Cambiar PIN
          </button>
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {isLoading ? 'Cargando...' : 'Actualizar'}
          </button>
        </div>
      </div>

      {/* Toggle persistente: ver solo prioritarias (autoaprobadores) */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => setShowOnlyPriority(prev => !prev)}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold border transition ${showOnlyPriority
            ? 'bg-amber-400 text-amber-900 border-amber-500 shadow-sm'
            : 'bg-white text-gray-600 border-gray-300 hover:bg-amber-50 hover:border-amber-300'
            }`}
          title="Mostrar solo solicitudes de autoaprobadores (CEO, CDS, dirección, etc.)"
        >
          <span>⭐</span>
          {showOnlyPriority ? `Mostrando solo prioritarias (${priorityCount})` : `Ver solo prioritarias (${priorityCount})`}
        </button>
        {showOnlyPriority && (
          <span className="text-xs text-gray-500 italic">Combinable con los filtros de estado abajo</span>
        )}
      </div>

      {/* Filters — PENDIENTE_CONFIRMACION_COSTO removido del filtro visual */}
      {/* (el estado sigue existiendo en el flujo, solo no aparece como pill) */}
      <div className="flex gap-2 pb-4 overflow-x-auto">
        {['ALL', ...Object.values(RequestStatus)].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${filter === s ? 'bg-brand-red text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
              }`}
          >
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <div className="flex flex-col">
        <div className="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg bg-white">
              <table className="min-w-full divide-y divide-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">ID</th>
                    <th className="px-2 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Solicitante</th>
                    <th className="px-2 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Ruta</th>
                    <th className="px-1 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Fechas</th>
                    <th className="px-1 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Estado</th>
                    <th className="relative py-3 pl-1 pr-2 text-right">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {isLoading ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-16 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-red mx-auto mb-3"></div>
                          <p className="text-gray-400 text-sm">Cargando solicitudes...</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <>
                      {pagedRequests.map((req) => {
                        const totalCost = Number(req.totalCost) || 0;
                        const isHighCost = totalCost > 1200000;
                        const anticipationDays = getDaysDiff(req.timestamp, req.departureDate);
                        const remainingDays = getDaysDiff(new Date(), req.departureDate);
                        const isAbandoned = remainingDays < 0 && !['RESERVADO', 'PROCESADO', 'PENDIENTE_ANALISIS_CAMBIO'].includes(req.status);
                        const isPriority = priorityMap.get(req.requestId) || false;
                        const isTerminal = TERMINAL_STATUSES.includes(req.status);

                        return (
                          <tr key={req.requestId} className={isTerminal ? 'opacity-50 bg-gray-50' : (isAbandoned ? 'opacity-60 grayscale bg-gray-50' : (isPriority ? 'bg-amber-50' : ''))}>
                            <td className="whitespace-nowrap px-3 py-4 text-sm font-bold text-gray-900">
                              {isPriority && (
                                <span
                                  className="inline-block mr-1 text-amber-500 text-base align-middle"
                                  title="Prioritaria — Pasajero es autoaprobador (CEO/CDS/Dirección o usuario que se aprueba a sí mismo)"
                                >⭐</span>
                              )}
                              {req.isProxyRequest && (
                                <span
                                  className="inline-block mr-1 text-base align-middle"
                                  title="Solicitud a nombre de otro — quien creó la solicitud no es uno de los pasajeros"
                                >👥</span>
                              )}
                              {req.requestId}
                              {req.relatedRequestId && (
                                <div className="text-xs font-normal text-blue-600 mt-1">
                                  Vinculada a {req.relatedRequestId}
                                </div>
                              )}
                              <div className="flex gap-1 mt-1">
                                {isAbandoned && !['ANULADO', 'DENEGADO'].includes(req.status) && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-200 text-gray-800" title="Fecha de vuelo pasada sin reserva">
                                    ABANDONADA
                                  </span>
                                )}
                                {req.requestMode === 'HOTEL_ONLY' && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-100 text-teal-800" title="Solo Hospedaje">
                                    🏨 HOTEL
                                  </span>
                                )}
                                {req.isInternational && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800" title="Viaje Internacional">
                                    INTL
                                  </span>
                                )}
                                {isHighCost && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-800" title="Costo Excede Tope (> 1.2M)">
                                    $$$
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-3 text-sm text-gray-500">
                              <div className="font-medium text-gray-700">{req.requesterEmail}</div>
                              {req.timestamp && (
                                <div className="text-[11px] text-gray-400 mt-0.5" title="Fecha y hora de creación de la solicitud">
                                  Creada: {formatShortDateTime(req.timestamp)}
                                </div>
                              )}
                              <div className="text-xs text-gray-400">{req.company} / {req.site} - {req.costCenter}</div>
                              {req.workOrder && <div className="text-xs text-gray-500 mt-1">OT: {req.workOrder}</div>}
                            </td>
                            <td className="px-2 py-3 text-sm text-gray-900">
                              <div className="flex items-center gap-1 font-medium">
                                <span>{req.origin}</span>
                                <span className="text-gray-400 mx-1">➝</span>
                                <span>{req.destination}</span>
                              </div>
                              <div className="text-xs text-gray-500">{req.passengers.length} Pasajero(s)</div>
                            </td>
                            <td className="whitespace-nowrap px-1 py-3 text-sm text-gray-500">
                              <strong>{formatToDDMMYYYY(req.departureDate)}</strong><br />
                              {req.returnDate ? formatToDDMMYYYY(req.returnDate) : <span className="italic text-gray-400">Solo Ida</span>}
                              <div className="mt-1 text-[10px] text-gray-400">
                                {remainingDays < 0 ? <span className="italic">Sol. Antigua</span> : `Faltan: ${remainingDays}d`}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-1 py-3 text-right">
                              <span className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${getStatusBadge(req.status)}`}>
                                {req.status}
                              </span>
                            </td>
                            <td className="relative whitespace-nowrap py-3 pl-1 pr-2 text-right text-sm font-medium">
                              <div className="flex justify-end gap-1 items-center flex-wrap">
                                {/* VIEW DETAIL BUTTON */}
                                <button
                                  onClick={() => onViewRequest(req)}
                                  className="text-gray-500 hover:text-gray-700 text-xs font-bold border border-gray-300 rounded px-2 py-1 bg-gray-50 hover:bg-gray-100"
                                  title="Ver Detalle Completo"
                                >
                                  VER
                                </button>

                                {/* CANCEL BUTTON (Trash icon) */}
                                {!['PROCESADO', 'ANULADO', 'DENEGADO'].includes(req.status) && (
                                  <button
                                    onClick={() => setSelectedRequestForCancellation(req)}
                                    className="text-gray-400 hover:text-red-600 transition-colors p-1"
                                    title="Anular Solicitud"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                )}

                                {/* CHANGE REQUEST REVIEW (study / deny) */}
                                {req.status === RequestStatus.PENDING_CHANGE_APPROVAL && (
                                  <button
                                    onClick={() => setSelectedRequestForChange(req)}
                                    className="text-amber-800 hover:text-amber-900 bg-amber-100 px-3 py-1 rounded border border-amber-300 text-xs font-bold flex items-center gap-1"
                                    title="Revisar y pasar a estudio o denegar este cambio"
                                  >
                                    🔄 Revisar Cambio
                                  </button>
                                )}

                                {/* OPTION UPLOAD & CORRECTION */}
                                {(req.status === RequestStatus.PENDING_OPTIONS || req.status === RequestStatus.PENDING_SELECTION) && (
                                  <button
                                    onClick={() => setSelectedRequestForOptions(req)}
                                    className="text-brand-red hover:text-red-900 bg-red-50 px-3 py-1 rounded border border-red-100 text-xs font-medium"
                                  >
                                    {req.status === RequestStatus.PENDING_SELECTION ? 'Editar Opciones' : 'Cargar Opciones'}
                                  </button>
                                )}

                                {/* COST CONFIRMATION (New Step) */}
                                {req.status === RequestStatus.PENDING_CONFIRMACION_COSTO && (
                                  <button
                                    onClick={() => setSelectedRequestForCosts(req)}
                                    className="text-purple-700 hover:text-purple-900 bg-purple-50 px-3 py-1 rounded border border-purple-100 text-xs font-bold"
                                  >
                                    Confirmar Costos
                                  </button>
                                )}

                                {/* REGISTER RESERVATION */}
                                {req.status === RequestStatus.APPROVED && (
                                  <button
                                    onClick={() => setSelectedRequestForReservation(req)}
                                    className="text-yellow-700 hover:text-yellow-900 bg-yellow-50 px-3 py-1 rounded border border-yellow-200 text-xs font-bold"
                                  >
                                    Registrar Reserva
                                  </button>
                                )}

                                {/* SUPPORTS LOGIC (Now for RESERVED and PROCESSED) */}
                                {(req.status === RequestStatus.RESERVED || req.status === RequestStatus.PROCESSED) && (
                                  <>
                                    {/* Upload/View Button */}
                                    <button
                                      onClick={() => setSelectedRequestForSupports(req)}
                                      className={`text-xs font-bold px-2 py-1 rounded border ${req.status === RequestStatus.RESERVED ? 'text-blue-600 border-blue-200 bg-blue-50 hover:bg-blue-100' : 'text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                                    >
                                      {req.status === RequestStatus.RESERVED ? (req.supportData?.files?.length ? 'Cargar Facturas (+)' : 'Cargar Facturas') : 'Ver Soportes'}
                                    </button>

                                    {/* Amend Reservation (only RESERVED) */}
                                    {req.status === RequestStatus.RESERVED && (
                                      <button
                                        onClick={() => setSelectedRequestForReservation(req)}
                                        className="text-xs font-bold px-2 py-1 rounded border text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100"
                                        title="Corregir PNR, tarjeta, archivos de reserva"
                                      >
                                        Corregir Reserva
                                      </button>
                                    )}

                                    {/* Export Report Button — moved to VER detail for cleaner row */}

                                    {/* Finalize Button (Only if Reserved and has at least one file) */}
                                    {req.status === RequestStatus.RESERVED && req.supportData && req.supportData.files.length > 0 && (
                                      <button
                                        onClick={() => confirmFinalize(req)}
                                        disabled={processingId === req.requestId}
                                        className="text-xs font-bold px-2 py-1 rounded border text-green-700 border-green-200 bg-green-50 hover:bg-green-100 disabled:opacity-50"
                                      >
                                        {processingId === req.requestId ? '...' : 'Finalizar'}
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredRequests.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-500">
                            No se encontraron solicitudes.
                          </td>
                        </tr>
                      )}
                    </>
                  )}
                </tbody>
              </table>
            </div>
            {filteredRequests.length > PAGE_SIZE && (
              <div className="flex items-center justify-between px-3 py-3 border-t border-gray-200 bg-gray-50 text-sm">
                <span className="text-gray-600">
                  {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, filteredRequests.length)} de {filteredRequests.length}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-3 py-1 border border-gray-300 rounded bg-white text-gray-700 disabled:opacity-40"
                  >Anterior</button>
                  <span className="text-gray-700">Pág. {page} / {totalPages}</span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="px-3 py-1 border border-gray-300 rounded bg-white text-gray-700 disabled:opacity-40"
                  >Siguiente</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedRequestForOptions && (
        <OptionUploadModal
          request={selectedRequestForOptions}
          onClose={() => setSelectedRequestForOptions(null)}
          onSuccess={() => {
            setSelectedRequestForOptions(null);
            onRefresh();
          }}
        />
      )}

      {selectedRequestForReservation && (
        <ReservationModal
          request={selectedRequestForReservation}
          onClose={() => setSelectedRequestForReservation(null)}
          onSuccess={() => {
            setSelectedRequestForReservation(null);
            onRefresh();
          }}
        />
      )}

      {selectedRequestForCosts && (
        <CostConfirmationModal
          request={selectedRequestForCosts}
          onClose={() => setSelectedRequestForCosts(null)}
          onSuccess={() => {
            setSelectedRequestForCosts(null);
            onRefresh();
          }}
          isSuperAdmin={isSuperAdmin}
        />
      )}

      {selectedRequestForSupports && (
        <SupportUploadModal
          request={selectedRequestForSupports}
          onClose={() => setSelectedRequestForSupports(null)}
          onSuccess={() => {
            setSelectedRequestForSupports(null);
            onRefresh();
          }}
        />
      )}

      {selectedRequestForCancellation && (
        <CancellationModal
          isOpen={!!selectedRequestForCancellation}
          requestId={selectedRequestForCancellation.requestId}
          onClose={() => setSelectedRequestForCancellation(null)}
          onSubmit={handleCancelRequest}
        />
      )}

      {showMetricsPanel && (
        <MetricsPanel onClose={() => setShowMetricsPanel(false)} />
      )}

      {selectedRequestForChange && (
        <ChangeRequestModal
          request={selectedRequestForChange}
          onClose={() => setSelectedRequestForChange(null)}
          onSuccess={() => {
            setSelectedRequestForChange(null);
            onRefresh();
          }}
        />
      )}
    </div>
  );
};

// Memoización (Etapa 1.5): si los props (requests/integrantes/handlers) no
// cambian en referencia, evita re-render del dashboard cuando el padre
// re-renderiza por estado no relacionado (ej: abrir un modal).
export const AdminDashboard = React.memo(AdminDashboardImpl);
