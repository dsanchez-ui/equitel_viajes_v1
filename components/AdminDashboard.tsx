
import React, { useState } from 'react';
import { TravelRequest, RequestStatus } from '../types';
import { OptionUploadModal } from './OptionUploadModal';
import { SupportUploadModal } from './SupportUploadModal';
import { ReservationModal } from './ReservationModal';
import { CostConfirmationModal } from './CostConfirmationModal';
import { ConfirmationDialog } from './ConfirmationDialog';
import { PinEntryModal } from './PinEntryModal';
import { gasService } from '../services/gasService';
import { getDaysDiff, formatToDDMMYYYY } from '../utils/dateUtils';

interface AdminDashboardProps {
  requests: TravelRequest[];
  onRefresh: () => void;
  isLoading: boolean;
  onViewRequest: (req: TravelRequest) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ requests, onRefresh, isLoading, onViewRequest }) => {
  const [filter, setFilter] = useState<string>('ALL');
  const [selectedRequestForOptions, setSelectedRequestForOptions] = useState<TravelRequest | null>(null);
  const [selectedRequestForSupports, setSelectedRequestForSupports] = useState<TravelRequest | null>(null);
  const [selectedRequestForReservation, setSelectedRequestForReservation] = useState<TravelRequest | null>(null);
  const [selectedRequestForCosts, setSelectedRequestForCosts] = useState<TravelRequest | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [showPinChangeModal, setShowPinChangeModal] = useState(false);

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

  const closeDialog = () => setDialog({ ...dialog, isOpen: false });

  const filteredRequests = requests.filter(r => {
    if (filter === 'ALL') return true;
    return r.status === filter;
  });

  const getStatusBadge = (status: RequestStatus) => {
    switch (status) {
      case RequestStatus.PENDING_OPTIONS: return 'bg-yellow-100 text-yellow-800';
      case RequestStatus.PENDING_SELECTION: return 'bg-blue-100 text-blue-800';
      case RequestStatus.PENDING_CONFIRMACION_COSTO: return 'bg-purple-100 text-purple-800';
      case RequestStatus.PENDING_APPROVAL: return 'bg-purple-100 text-purple-800';
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

      {/* Filters */}
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
                    <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">ID</th>
                    <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Solicitante</th>
                    <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Ruta</th>
                    <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Fechas</th>
                    <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500 pr-2">Estado</th>
                    <th className="relative py-3 pl-1 pr-4 sm:pr-6 text-right">
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
                      {filteredRequests.map((req) => {
                        const totalCost = Number(req.totalCost) || 0;
                        const isHighCost = totalCost > 1200000;
                        const anticipationDays = getDaysDiff(req.timestamp, req.departureDate);
                        const remainingDays = getDaysDiff(new Date(), req.departureDate);
                        const isAbandoned = remainingDays < 0 && !['RESERVADO', 'PROCESADO', 'PENDIENTE_ANALISIS_CAMBIO'].includes(req.status);

                        return (
                          <tr key={req.requestId} className={isAbandoned ? 'opacity-60 grayscale bg-gray-50' : ''}>
                            <td className="whitespace-nowrap px-3 py-4 text-sm font-bold text-gray-900">
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
                            <td className="px-3 py-4 text-sm text-gray-500">
                              <div className="font-medium text-gray-700">{req.requesterEmail}</div>
                              <div className="text-xs text-gray-400">{req.company} / {req.site} - {req.costCenter}</div>
                              {req.workOrder && <div className="text-xs text-gray-500 mt-1">OT: {req.workOrder}</div>}
                            </td>
                            <td className="px-3 py-4 text-sm text-gray-900">
                              <div className="flex items-center gap-1 font-medium">
                                <span>{req.origin}</span>
                                <span className="text-gray-400 mx-1">➝</span>
                                <span>{req.destination}</span>
                              </div>
                              <div className="text-xs text-gray-500">{req.passengers.length} Pasajero(s)</div>
                            </td>
                            <td className="px-3 py-4 text-sm text-gray-500">
                              <strong>{formatToDDMMYYYY(req.departureDate)}</strong><br />
                              {req.returnDate ? formatToDDMMYYYY(req.returnDate) : <span className="italic text-gray-400">Solo Ida</span>}
                              <div className="mt-1 text-[10px] text-gray-400">
                                {remainingDays < 0 ? <span className="italic">Sol. Antigua</span> : `Faltan: ${remainingDays}d`}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-right pr-2">
                              <span className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${getStatusBadge(req.status)}`}>
                                {req.status}
                              </span>
                            </td>
                            <td className="relative whitespace-nowrap py-4 pl-1 pr-4 text-right text-sm font-medium sm:pr-6">
                              <div className="flex justify-end gap-1 items-center">
                                {/* VIEW DETAIL BUTTON */}
                                <button
                                  onClick={() => onViewRequest(req)}
                                  className="text-gray-500 hover:text-gray-700 text-xs font-bold border border-gray-300 rounded px-2 py-1 bg-gray-50 hover:bg-gray-100"
                                  title="Ver Detalle Completo"
                                >
                                  VER
                                </button>

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
    </div>
  );
};
