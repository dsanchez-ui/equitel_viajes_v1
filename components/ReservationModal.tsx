
import React, { useState, useRef } from 'react';
import { TravelRequest } from '../types';
import { gasService } from '../services/gasService';
import { ConfirmationDialog } from './ConfirmationDialog';

interface ReservationModalProps {
  request: TravelRequest;
  onClose: () => void;
  onSuccess: () => void;
}

export const ReservationModal = ({ request, onClose, onSuccess }: ReservationModalProps) => {
  const [loading, setLoading] = useState(false);
  const [reservationNumber, setReservationNumber] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'ALERT' | 'CONFIRM' | 'SUCCESS';
    onConfirm: () => void;
    onCancel?: () => void;
  }>({ isOpen: false, title: '', message: '', type: 'ALERT', onConfirm: () => {} });

  const closeDialog = () => setDialog({ ...dialog, isOpen: false });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
          setFile(e.target.files[0]);
      }
  };

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!reservationNumber.trim()) {
          setDialog({
              isOpen: true,
              title: 'Campo Requerido',
              message: 'Debe ingresar el número de reserva (PNR).',
              type: 'ALERT',
              onConfirm: closeDialog
          });
          return;
      }
      if (!file) {
          setDialog({
              isOpen: true,
              title: 'Archivo Requerido',
              message: 'Debe cargar el archivo de confirmación de la reserva.',
              type: 'ALERT',
              onConfirm: closeDialog
          });
          return;
      }

      setDialog({
          isOpen: true,
          title: 'Confirmar Reserva',
          message: `Se registrará la reserva ${reservationNumber} y se notificará al usuario.\n\n¿Desea continuar?`,
          type: 'CONFIRM',
          onConfirm: executeSubmission,
          onCancel: closeDialog
      });
  };

  const executeSubmission = async () => {
      closeDialog();
      setLoading(true);
      
      const reader = new FileReader();
      reader.onload = async () => {
          const base64String = (reader.result as string).split(',')[1];
          try {
              await gasService.registerReservation(
                  request.requestId,
                  reservationNumber,
                  base64String,
                  file!.name
              );
              
              setDialog({
                  isOpen: true,
                  title: 'Reserva Registrada',
                  message: 'La reserva ha sido guardada y el usuario notificado.',
                  type: 'SUCCESS',
                  onConfirm: () => {
                      closeDialog();
                      onSuccess();
                  }
              });
          } catch (err) {
              setDialog({
                  isOpen: true,
                  title: 'Error',
                  message: 'Error al registrar reserva: ' + err,
                  type: 'ALERT',
                  onConfirm: closeDialog
              });
          } finally {
              setLoading(false);
          }
      };
      reader.readAsDataURL(file!);
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
      
      <div className="fixed inset-0 z-[60] overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
        <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose}></div>
          <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>

          <div className="relative inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
            <div className="absolute top-0 right-0 pt-4 pr-4 z-10">
              <button onClick={onClose} className="bg-white rounded-md text-gray-400 hover:text-gray-500 text-2xl font-bold leading-none px-2 focus:outline-none">✕</button>
            </div>

            <h3 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2">
                Registrar Compra / Reserva - <span className="text-brand-red">{request.requestId}</span>
            </h3>

            <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">Número de Reserva (PNR)</label>
                    <input 
                        type="text" 
                        value={reservationNumber}
                        onChange={(e) => setReservationNumber(e.target.value)}
                        className="w-full border border-gray-300 rounded p-2 text-gray-900 bg-white uppercase focus:ring-brand-red focus:border-brand-red"
                        placeholder="Ej: BZQYX"
                        disabled={loading}
                    />
                </div>

                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">Archivo de Confirmación</label>
                    <div 
                        onClick={() => fileInputRef.current?.click()}
                        className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:bg-gray-50 transition"
                    >
                        {file ? (
                            <div className="text-green-600 font-bold flex flex-col items-center">
                                <span className="text-2xl">📄</span>
                                <span className="text-sm">{file.name}</span>
                                <button 
                                    type="button" 
                                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                                    className="text-xs text-red-500 mt-2 underline"
                                >
                                    Quitar archivo
                                </button>
                            </div>
                        ) : (
                            <div className="text-gray-500">
                                <span className="text-2xl block mb-1">📎</span>
                                <span className="text-sm font-medium">Clic para cargar PDF o Imagen</span>
                            </div>
                        )}
                        <input 
                            type="file" 
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            className="hidden" 
                            accept=".pdf,image/*"
                        />
                    </div>
                </div>

                <div className="mt-6 flex justify-end gap-3 border-t pt-4">
                    <button type="button" onClick={onClose} className="px-4 py-2 border rounded text-gray-700 bg-white hover:bg-gray-50">Cancelar</button>
                    <button type="submit" disabled={loading} className="px-4 py-2 bg-brand-red text-white rounded font-bold hover:bg-red-700 disabled:opacity-50">
                        {loading ? 'Procesando...' : 'Confirmar Compra'}
                    </button>
                </div>
            </form>

          </div>
        </div>
      </div>
    </>
  );
};
