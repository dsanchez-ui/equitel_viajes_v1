import React, { useState, useMemo, useEffect } from 'react';
import { TravelRequest, RequestStatus } from '../types';
import { gasService } from '../services/gasService';
import { CancellationModal } from './CancellationModal';
import { ConfirmationDialog } from './ConfirmationDialog';
import { getDaysDiff, formatToDDMMYYYY, formatShortDateTime } from '../utils/dateUtils';

interface UserDashboardProps {
  requests: TravelRequest[];
  isLoading: boolean;
  isSyncing: boolean;
  onNewRequest: () => void;
  onViewRequest: (req: TravelRequest) => void;
  onRefresh?: () => void;
  /** #A103: abre «Cambiar mi viaje». Sin él (servidor anterior) no se muestra el botón grande. */
  onChangeTrip?: () => void;
}

const TERMINAL_STATUSES = ['ANULADO', 'PROCESADO', 'DENEGADO'];
const PAGE_SIZE = 50;
const CHANGE_NEWS_KEY = 'equitel_aviso_cambios_v1';

export const UserDashboard: React.FC<UserDashboardProps> = ({
  requests,
  isLoading,
  isSyncing,
  onNewRequest,
  onViewRequest,
  onRefresh,
  onChangeTrip
}) => {
  const [cancelRequest, setCancelRequest] = useState<TravelRequest | null>(null);
  const [dialog, setDialog] = useState<{ isOpen: boolean; title: string; message: string; type: 'ALERT' | 'SUCCESS'; onConfirm: () => void }>({ isOpen: false, title: '', message: '', type: 'ALERT', onConfirm: () => {} });
  const [page, setPage] = useState<number>(1);
  // #A103: aviso del sistema nuevo de cambios, hasta que la persona lo cierre (en este navegador).
  const [showChangeNews, setShowChangeNews] = useState<boolean>(() => {
    try { return localStorage.getItem(CHANGE_NEWS_KEY) !== '1'; } catch { return true; }
  });
  const closeChangeNews = () => {
    setShowChangeNews(false);
    try { localStorage.setItem(CHANGE_NEWS_KEY, '1'); } catch { /* sin almacenamiento: vuelve a salir */ }
  };

  // Orden descendente por timestamp para que las recientes salgan primero.
  // Si timestamp está vacío o inválido (sheet editado manualmente), cae al ID
  // numérico como criterio — IDs son monotónicos secuenciales. Evita el caso
  // de solicitudes con timestamp ausente cayendo al fondo (epoch 1970).
  const sortedRequests = useMemo(() => {
    const out = [...requests];
    out.sort((a, b) => {
      const ta = new Date(a.timestamp || 0).getTime();
      const tb = new Date(b.timestamp || 0).getTime();
      const validA = !isNaN(ta) && ta > 0;
      const validB = !isNaN(tb) && tb > 0;
      if (validA && validB) return tb - ta;
      const idNumA = parseInt((String(a.requestId || '').match(/\d+/) || ['0'])[0], 10);
      const idNumB = parseInt((String(b.requestId || '').match(/\d+/) || ['0'])[0], 10);
      return idNumB - idNumA;
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

       {/* #A103: aviso del sistema nuevo de cambios */}
       {onChangeTrip && showChangeNews && (
         <div role="status" className="bg-blue-50 border border-blue-200 text-blue-950 rounded-md p-4 text-sm leading-relaxed flex gap-3 items-start" data-change-news>
           <span className="text-lg" aria-hidden="true">📣</span>
           <div className="flex-1 space-y-1">
             <p className="font-bold">Nuevo: los cambios de viaje se piden aquí, ya no por correo</p>
             <p>
               Con el botón <strong>«¿Necesita cambiar su viaje?»</strong> cambia la fecha, la hora, el destino o el equipaje en un minuto.
               Se puede pedir <strong>hasta las 5:00 p. m. del día hábil anterior al vuelo</strong> (si ese día es sábado, hasta las 12:00 m.).
               Si el tiquete ya está comprado, el cambio tiene costo y lo aprueba su jefe.
             </p>
           </div>
           <button type="button" onClick={closeChangeNews} className="text-blue-800 hover:text-blue-950 text-xs font-bold underline shrink-0">Entendido</button>
         </div>
       )}

       {onChangeTrip && (
         <button
           type="button"
           onClick={onChangeTrip}
           data-change-trip-button
           className="w-full flex flex-wrap sm:flex-nowrap items-center gap-4 text-left rounded-xl border-2 border-amber-600 bg-amber-50 px-5 py-4 hover:shadow-md transition"
         >
           <span className="text-4xl leading-none" aria-hidden="true">😕</span>
           <span className="flex-1 min-w-0">
             <span className="block text-lg font-bold text-gray-900">¿Necesita cambiar su viaje?</span>
             <span className="block text-sm text-gray-600">Fecha, hora, destino o equipaje. Toma un minuto.</span>
           </span>
           <span className="bg-brand-red text-white px-4 py-2 rounded font-bold uppercase text-xs tracking-wide shrink-0">Pedir un cambio</span>
         </button>
       )}
       
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
                        {req.timestamp && (
                          <span className="text-[10px] text-gray-400" title="Fecha y hora de creación">
                            Creada: {formatShortDateTime(req.timestamp)}
                          </span>
                        )}
                        <div className="flex gap-1 flex-wrap">
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
                            {req.isProxyRequest && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-800" title="Solicitud a nombre de otro — creada por alguien que no es pasajero">
                                    👥 A NOMBRE DE OTRO
                                </span>
                            )}
                        </div>
                    </div>
                    <span className={`text-xs font-bold px-2 py-1 rounded ${
                        req.status === 'APROBADO' ? 'bg-green-100 text-green-700' : 
                        req.status === 'DENEGADO' ? 'bg-red-100 text-red-700' : 
                        req.status === 'ANULADO' ? 'bg-gray-200 text-gray-500 line-through' :
                        req.status === RequestStatus.PENDING_POLICY_APPROVAL ? 'bg-amber-100 text-amber-800' :
                        'bg-gray-100 text-gray-600'
                    }`}>{req.status === RequestStatus.PENDING_POLICY_APPROVAL ? 'EN ESPERA DE APROBACIÓN' : req.status}</span>
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

                 {req.relatedRequestId && <p className="text-xs text-blue-500 mt-2">{req.tripChange ? 'Cambio de' : 'Vinculada a'} {req.relatedRequestId}</p>}
                 {req.replacedBy && <p className="text-xs font-semibold text-gray-700 bg-gray-100 rounded px-2 py-1 mt-2" data-replaced-chip>🔄 Cambiada por {req.replacedBy}: el viaje vigente es esa.</p>}

                 {req.status === RequestStatus.PENDING_POLICY_APPROVAL && (
                   <p className="mt-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded p-2 leading-snug">
                     Se pidió con menos anticipación de la que pide la política. El área de viajes la gestiona cuando la apruebe
                     {' '}<strong>{req.policyApproverName || 'el CFO'}</strong>. Le avisaremos por correo.
                   </p>
                 )}

                 <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-gray-400 uppercase">{req.passengers.length} Pasajero(s)</span>
                      {!TERMINAL_STATUSES.includes(req.status) && !req.replacedBy && (
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
