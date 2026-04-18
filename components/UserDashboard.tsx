import React, { useState, useMemo, useEffect } from 'react';
import { TravelRequest } from '../types';
import { gasService } from '../services/gasService';
import { CancellationModal } from './CancellationModal';
import { ConfirmationDialog } from './ConfirmationDialog';
import { getDaysDiff, formatToDDMMYYYY } from '../utils/dateUtils';

interface UserDashboardProps {
  requests: TravelRequest[];
  isLoading: boolean;
  isSyncing: boolean;
  onNewRequest: () => void;
  onViewRequest: (req: TravelRequest) => void;
  onRefresh?: () => void;
}

const TERMINAL_STATUSES = ['ANULADO', 'PROCESADO', 'DENEGADO'];
const PAGE_SIZE = 50;

export const UserDashboard: React.FC<UserDashboardProps> = ({
  requests,
  isLoading,
  isSyncing,
  onNewRequest,
  onViewRequest,
  onRefresh
}) => {
  const [cancelRequest, setCancelRequest] = useState<TravelRequest | null>(null);
  const [dialog, setDialog] = useState<{ isOpen: boolean; title: string; message: string; type: 'ALERT' | 'SUCCESS'; onConfirm: () => void }>({ isOpen: false, title: '', message: '', type: 'ALERT', onConfirm: () => {} });
  const [page, setPage] = useState<number>(1);

  // Orden descendente por timestamp para que las recientes salgan primero.
  const sortedRequests = useMemo(() => {
    const out = [...requests];
    out.sort((a, b) => {
      const ta = new Date(a.timestamp || 0).getTime() || 0;
      const tb = new Date(b.timestamp || 0).getTime() || 0;
      return tb - ta;
    });
    return out;
  }, [requests]);

  const totalPages = Math.max(1, Math.ceil(sortedRequests.length / PAGE_SIZE));
  useEffect(() => { if (page > totalPages) setPage(1); }, [totalPages, page]);
  const pagedRequests = useMemo(
    () => sortedRequests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [sortedRequests, page]
  );

  const handleUserCancel = async (reason: string) => {
    if (!cancelRequest) return;
    try {
      await gasService.cancelOwnRequest(cancelRequest.requestId, reason);
      setCancelRequest(null);
      setDialog({
        isOpen: true,
        title: 'Solicitud Anulada',
        message: `Su solicitud ${cancelRequest.requestId} ha sido anulada. El área de viajes ha sido notificada.`,
        type: 'SUCCESS',
        onConfirm: () => { setDialog(prev => ({ ...prev, isOpen: false })); if (onRefresh) onRefresh(); }
      });
    } catch (e) {
      alert('Error: ' + e);
    }
  };
  return (
    <div className="space-y-6">
       <div className="flex justify-between items-center border-b pb-4 border-gray-200">
         <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-gray-900 uppercase tracking-tight">Mis Solicitudes</h1>
            {isSyncing && <span className="text-xs text-brand-red animate-pulse font-medium">● Sincronizando...</span>}
         </div>
         <button onClick={onNewRequest} className="bg-brand-red text-white px-5 py-2 rounded shadow hover:bg-red-700 transition font-bold uppercase text-xs tracking-wide">+ Nueva Solicitud</button>
       </div>
       
       {isLoading ? (
         <div className="flex justify-center items-center h-64 bg-white rounded-lg border border-gray-200">
            <div className="text-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-brand-red mx-auto mb-3"></div>
                <p className="text-gray-400 text-sm font-medium">Cargando sus solicitudes...</p>
            </div>
         </div>
       ) : (
         <>
           <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
             {pagedRequests.map(req => {
               const anticipationDays = getDaysDiff(req.timestamp, req.departureDate);
               const remainingDays = getDaysDiff(new Date(), req.departureDate);
               const totalCost = Number(req.totalCost) || 0;
               const isHighCost = totalCost > 1200000;

               const isAbandoned = remainingDays < 0 && !['RESERVADO', 'PROCESADO', 'PENDIENTE_ANALISIS_CAMBIO'].includes(req.status);
               const isTerminal = TERMINAL_STATUSES.includes(req.status);

               return (
               <div key={req.requestId} className={`bg-white p-6 rounded shadow-sm hover:shadow-md transition border-t-4 border-brand-red relative group ${isTerminal ? 'opacity-60' : (isAbandoned ? 'opacity-60 grayscale' : '')}`}>
                 <div className="flex justify-between items-start mb-2">
                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{req.requestId}</span>
                        <div className="flex gap-1">
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
                    </div>
                    <span className={`text-xs font-bold px-2 py-1 rounded ${
                        req.status === 'APROBADO' ? 'bg-green-100 text-green-700' : 
                        req.status === 'DENEGADO' ? 'bg-red-100 text-red-700' : 
                        req.status === 'ANULADO' ? 'bg-gray-200 text-gray-500 line-through' :
                        'bg-gray-100 text-gray-600'
                    }`}>{req.status}</span>
                 </div>
                 <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2 mt-2">
                    <span>{req.origin}</span><span className="text-brand-red text-xl">➝</span><span>{req.destination}</span>
                 </h3>
                 <p className="text-sm text-gray-500 mt-1">Salida: <span className="font-medium text-gray-700">{formatToDDMMYYYY(req.departureDate)}</span></p>
                 {req.workOrder && <p className="text-sm text-gray-500 mt-1">OT: <span className="font-medium text-gray-700">{req.workOrder}</span></p>}
                 
                 <div className="mt-2 flex gap-2 text-[10px] font-medium text-gray-500 bg-gray-50 p-1.5 rounded border border-gray-100">
                    <span>Antelación: <strong className="text-gray-700">{anticipationDays}d</strong></span>
                    <span>|</span>
                    {remainingDays < 0 ? (
                        <span className="text-gray-400 italic">Sol. Antigua</span>
                    ) : (
                        <span>Faltan: <strong className="text-gray-700">{remainingDays}d</strong></span>
                    )}
                 </div>

                 {req.relatedRequestId && <p className="text-xs text-blue-500 mt-2">Vinculada a {req.relatedRequestId}</p>}

                 <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-gray-400 uppercase">{req.passengers.length} Pasajero(s)</span>
                      {!TERMINAL_STATUSES.includes(req.status) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setCancelRequest(req); }}
                          className="text-[10px] text-gray-400 hover:text-red-600 transition-colors underline"
                          title="Anular esta solicitud"
                        >
                          Anular
                        </button>
                      )}
                    </div>
                    <button onClick={() => onViewRequest(req)} className="text-brand-red text-xs font-bold uppercase tracking-wide hover:underline focus:outline-none">Ver Detalle</button>
                 </div>
               </div>
             )})}
           </div>

           {sortedRequests.length > PAGE_SIZE && (
             <div className="flex items-center justify-between px-3 py-3 border-t border-gray-200 bg-white rounded text-sm">
               <span className="text-gray-600">
                 {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, sortedRequests.length)} de {sortedRequests.length}
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

           {requests.length === 0 && (
             <div className="col-span-full text-center py-16 bg-white rounded border border-gray-200 flex flex-col items-center justify-center">
               <div className="bg-gray-100 rounded-full p-4 mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
               </div>
               <h3 className="text-lg font-bold text-gray-900 mb-1">No tienes solicitudes activas</h3>
               <button onClick={onNewRequest} className="bg-brand-red text-white px-5 py-2.5 rounded font-bold shadow hover:bg-red-700 transition uppercase text-xs tracking-wide mt-4">Crear Solicitud</button>
             </div>
           )}
         </>
       )}

       {cancelRequest && (
         <CancellationModal
           isOpen={!!cancelRequest}
           requestId={cancelRequest.requestId}
           onClose={() => setCancelRequest(null)}
           onSubmit={handleUserCancel}
         />
       )}

       <ConfirmationDialog
         isOpen={dialog.isOpen}
         title={dialog.title}
         message={dialog.message}
         type={dialog.type}
         onConfirm={dialog.onConfirm}
       />
    </div>
  );
};
