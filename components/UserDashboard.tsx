import React from 'react';
import { TravelRequest } from '../types';
import { getDaysDiff, formatToDDMMYYYY } from '../utils/dateUtils';

interface UserDashboardProps {
  requests: TravelRequest[];
  isLoading: boolean;
  isSyncing: boolean;
  onNewRequest: () => void;
  onViewRequest: (req: TravelRequest) => void;
}

export const UserDashboard: React.FC<UserDashboardProps> = ({ 
  requests, 
  isLoading, 
  isSyncing, 
  onNewRequest, 
  onViewRequest 
}) => {
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
             {requests.map(req => {
               const anticipationDays = getDaysDiff(req.timestamp, req.departureDate);
               const remainingDays = getDaysDiff(new Date(), req.departureDate);
               const totalCost = Number(req.totalCost) || 0;
               const isHighCost = totalCost > 1200000;
               
               const isAbandoned = remainingDays < 0 && !['RESERVADO', 'PROCESADO', 'PENDIENTE_ANALISIS_CAMBIO'].includes(req.status);
               
               return (
               <div key={req.requestId} className={`bg-white p-6 rounded shadow-sm hover:shadow-md transition border-t-4 border-brand-red relative group ${isAbandoned ? 'opacity-60 grayscale' : ''}`}>
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
                    <span className="text-xs font-bold text-gray-400 uppercase">{req.passengers.length} Pasajero(s)</span>
                    <button onClick={() => onViewRequest(req)} className="text-brand-red text-xs font-bold uppercase tracking-wide hover:underline focus:outline-none">Ver Detalle</button>
                 </div>
               </div>
             )})}
           </div>
           
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
    </div>
  );
};
