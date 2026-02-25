
import React from 'react';

interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel?: () => void;
  type?: 'ALERT' | 'CONFIRM' | 'SUCCESS';
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({ 
  isOpen, 
  title, 
  message, 
  onConfirm, 
  onCancel, 
  type = 'CONFIRM' 
}) => {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
      <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        
        {/* Background overlay */}
        <div 
            className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" 
            onClick={type === 'CONFIRM' ? onCancel : onConfirm}
        ></div>

        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

        <div className="relative inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-sm sm:w-full sm:p-6">
          <div>
            <div className={`mx-auto flex items-center justify-center h-12 w-12 rounded-full ${type === 'SUCCESS' ? 'bg-green-100' : type === 'ALERT' ? 'bg-red-100' : 'bg-blue-50'}`}>
               {type === 'SUCCESS' && <span className="text-2xl">✅</span>}
               {type === 'ALERT' && <span className="text-2xl">⚠️</span>}
               {type === 'CONFIRM' && <span className="text-2xl">❓</span>}
            </div>
            <div className="mt-3 text-center sm:mt-5">
              <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">{title}</h3>
              <div className="mt-2">
                <p className="text-sm text-gray-500 whitespace-pre-line">{message}</p>
              </div>
            </div>
          </div>
          <div className="mt-5 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-3 sm:grid-flow-row-dense">
            {type === 'CONFIRM' ? (
                <>
                    <button 
                        type="button" 
                        onClick={onConfirm} 
                        className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-brand-red text-base font-medium text-white hover:bg-red-700 focus:outline-none sm:col-start-2 sm:text-sm"
                    >
                        Confirmar
                    </button>
                    <button 
                        type="button" 
                        onClick={onCancel} 
                        className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none sm:mt-0 sm:col-start-1 sm:text-sm"
                    >
                        Cancelar
                    </button>
                </>
            ) : (
                <button 
                    type="button" 
                    onClick={onConfirm} 
                    className={`col-span-2 w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 text-base font-medium text-white focus:outline-none sm:text-sm ${type === 'SUCCESS' ? 'bg-green-600 hover:bg-green-700' : 'bg-brand-red hover:bg-red-700'}`}
                >
                    Aceptar
                </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
