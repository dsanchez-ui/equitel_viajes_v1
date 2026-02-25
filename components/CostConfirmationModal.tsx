
import React, { useState } from 'react';
import { TravelRequest, RequestStatus } from '../types';
import { gasService } from '../services/gasService';
import { ConfirmationDialog } from './ConfirmationDialog';

interface CostConfirmationModalProps {
  request: TravelRequest;
  onClose: () => void;
  onSuccess: () => void;
}

export const CostConfirmationModal: React.FC<CostConfirmationModalProps> = ({ request, onClose, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [costTickets, setCostTickets] = useState<number>(0);
  const [costHotel, setCostHotel] = useState<number>(0);

  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'ALERT' | 'CONFIRM' | 'SUCCESS';
    onConfirm: () => void;
    onCancel?: () => void;
  }>({ isOpen: false, title: '', message: '', type: 'ALERT', onConfirm: () => {} });

  const closeDialog = () => setDialog({ ...dialog, isOpen: false });

  const handleSubmit = async () => {
      if (costTickets <= 0) {
          setDialog({
            isOpen: true,
            title: 'Validación',
            message: "El costo de los tiquetes es obligatorio.",
            type: 'ALERT',
            onConfirm: closeDialog
          });
          return;
      }

      const total = costTickets + costHotel;
      let message = `Se registrarán los siguientes costos:\n\nTiquetes: $${costTickets.toLocaleString()}\nHotel: $${costHotel.toLocaleString()}\nTotal: $${total.toLocaleString()}\n\n`;
      
      // Check for High Cost Threshold (1.2M) for National Trips
      // Note: If it's already international, the backend handles it, but we can still warn if we want.
      // The requirement says: "si el valor supera 1 millón 200 debe solicitarse aprobación al CEO y a la dirección de cadena de suministro... se le debe informar"
      
      if (!request.isInternational && total > 1200000) {
          message += "⚠️ ALERTA DE COSTO: El valor supera $1,200,000. Se solicitará aprobación adicional a Gerencia General, Gerencia de Cadena de Suministro y Aprobador de Área.\n\n";
      }
      
      message += "Se enviará la solicitud para aprobación.";
      
      setDialog({
          isOpen: true,
          title: 'Confirmar Costos',
          message: message,
          type: 'CONFIRM',
          onConfirm: executeSubmission,
          onCancel: closeDialog
      });
  };

  const executeSubmission = async () => {
      closeDialog();
      setLoading(true);
      try {
          await gasService.updateRequestStatus(request.requestId, RequestStatus.PENDING_APPROVAL, {
              finalCostTickets: costTickets,
              finalCostHotel: costHotel,
              totalCost: costTickets + costHotel
          });
          
          setDialog({
              isOpen: true,
              title: 'Exito',
              message: "Costos confirmados. Solicitud enviada a aprobación.",
              type: 'SUCCESS',
              onConfirm: () => {
                  closeDialog();
                  onSuccess();
              }
          });
      } catch (e) {
          setDialog({
            isOpen: true,
            title: 'Error',
            message: "Error: " + e,
            type: 'ALERT',
            onConfirm: closeDialog
          });
      } finally {
          setLoading(false);
      }
  };

  return (
    <>
      <ConfirmationDialog 
        isOpen={dialog.isOpen} 
        title={dialog.title} 
        message={dialog.message} 
        onConfirm={dialog.onConfirm} 
        onCancel={dialog.onCancel} 
        type={dialog.type}
      />
      <div className="fixed inset-0 z-[70] overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
        <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose}></div>
          <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>

          <div className="relative inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
             <div className="absolute top-0 right-0 pt-4 pr-4 z-10">
              <button onClick={onClose} className="bg-white rounded-md text-gray-400 hover:text-gray-500 text-2xl font-bold leading-none px-2 focus:outline-none">✕</button>
            </div>

            <h3 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2">
                Confirmar Costos - <span className="text-brand-red">{request.requestId}</span>
            </h3>

            <div className="bg-purple-50 p-4 rounded mb-4 border border-purple-100">
                <span className="block text-xs font-bold text-purple-800 uppercase mb-1">Selección del Usuario:</span>
                <p className="text-sm text-gray-800 italic">"{request.selectionDetails}"</p>
            </div>

            <div className="space-y-4">
                 <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1">Costo Final Tiquetes *</label>
                      <input 
                          type="number" 
                          className="w-full border border-gray-300 rounded p-2 text-gray-900 font-bold bg-white focus:ring-purple-500 focus:border-purple-500"
                          value={costTickets}
                          onChange={(e) => setCostTickets(Number(e.target.value))}
                      />
                  </div>
                  <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1">Costo Final Hotel</label>
                      <input 
                          type="number" 
                          className="w-full border border-gray-300 rounded p-2 text-gray-900 font-bold bg-white focus:ring-purple-500 focus:border-purple-500"
                          value={costHotel}
                          onChange={(e) => setCostHotel(Number(e.target.value))}
                      />
                  </div>
                  
                  <div className="flex justify-between items-center bg-gray-100 p-3 rounded mt-2">
                      <span className="font-bold text-gray-700">Total a Aprobar:</span>
                      <span className="text-xl font-bold text-brand-red">$ {(costTickets + costHotel).toLocaleString()}</span>
                  </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
                <button onClick={onClose} className="px-4 py-2 border rounded text-gray-700 bg-white hover:bg-gray-50">Cancelar</button>
                <button onClick={handleSubmit} disabled={loading} className="px-4 py-2 bg-purple-700 text-white rounded font-bold hover:bg-purple-800 disabled:opacity-50">
                    {loading ? 'Procesando...' : 'Confirmar y Enviar'}
                </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
