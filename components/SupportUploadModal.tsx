
import React, { useState, useRef } from 'react';
import { TravelRequest, SupportFile } from '../types';
import { gasService } from '../services/gasService';
import { ConfirmationDialog } from './ConfirmationDialog';

interface SupportUploadModalProps {
  request: TravelRequest;
  onClose: () => void;
  onSuccess: () => void;
}

export const SupportUploadModal: React.FC<SupportUploadModalProps> = ({ request, onClose, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<SupportFile[]>(request.supportData?.files || []);
  const [folderUrl, setFolderUrl] = useState<string | null>(request.supportData?.folderUrl || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    onConfirm: () => {},
  });

  const closeDialog = () => setDialog({ ...dialog, isOpen: false });

  const isProcessed = request.status === 'PROCESADO';

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    const file = e.target.files[0];
    
    // Check size (e.g. 10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      setDialog({
          isOpen: true,
          title: 'Archivo Muy Grande',
          message: "El archivo es demasiado grande (Máx 10MB).",
          type: 'ALERT',
          onConfirm: closeDialog
      });
      return;
    }

    setLoading(true);
    
    const reader = new FileReader();
    reader.onload = async () => {
       const base64String = (reader.result as string).split(',')[1];
       try {
         const newSupportData = await gasService.uploadSupportFile(
           request.requestId, 
           base64String, 
           file.name, 
           file.type
         );
         
         setFiles(newSupportData.files);
         setFolderUrl(newSupportData.folderUrl);
         
         // Optional: Visual feedback without blocking
         // console.log('File uploaded'); 
       } catch (err) {
         console.error(err);
         setDialog({
            isOpen: true,
            title: 'Error de Carga',
            message: 'Error subiendo archivo: ' + err,
            type: 'ALERT',
            onConfirm: closeDialog
         });
       } finally {
         setLoading(false);
         if(fileInputRef.current) fileInputRef.current.value = '';
       }
    };
    reader.readAsDataURL(file);
  };

  const handleFinalizeClick = () => {
     if (files.length === 0) {
       setDialog({
           isOpen: true,
           title: 'Faltan Soportes',
           message: "Debe cargar al menos un soporte antes de cerrar la solicitud.",
           type: 'ALERT',
           onConfirm: closeDialog
       });
       return;
     }

     setDialog({
         isOpen: true,
         title: 'Finalizar Solicitud',
         message: "¿Está seguro de cerrar esta solicitud?\n\nUna vez cerrada, no se podrán agregar más archivos y el proceso se dará por terminado.",
         type: 'CONFIRM',
         onConfirm: executeFinalize,
         onCancel: closeDialog
     });
  };

  const executeFinalize = async () => {
     closeDialog();
     setLoading(true);
     try {
       await gasService.closeRequest(request.requestId);
       
       setDialog({
           isOpen: true,
           title: 'Solicitud Cerrada',
           message: 'El proceso se ha completado exitosamente.',
           type: 'SUCCESS',
           onConfirm: () => {
               closeDialog();
               onSuccess(); 
               onClose();
           }
       });
     } catch (err) {
       setDialog({
           isOpen: true,
           title: 'Error',
           message: "Error cerrando solicitud: " + err,
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
        type={dialog.type}
        onConfirm={dialog.onConfirm}
        onCancel={dialog.onCancel}
      />

      <div className="fixed inset-0 z-[70] overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
        <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
          
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose}></div>
          <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>

          <div className="relative inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
            <div className="absolute top-0 right-0 pt-4 pr-4 z-10">
              <button onClick={onClose} className="bg-white rounded-md text-gray-400 hover:text-gray-500 text-2xl font-bold leading-none px-2 focus:outline-none">
                ✕
              </button>
            </div>

            <div>
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 mb-4">
                  <span className="text-2xl">📂</span>
              </div>
              <div className="text-center">
                  <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                    Soportes de Compra - {request.requestId}
                  </h3>
                  <p className="mt-2 text-sm text-gray-500">
                    {isProcessed 
                      ? "Esta solicitud ya ha sido procesada. Puede visualizar los archivos cargados."
                      : "Cargue los soportes de la compra (Facturas, Tiquetes, Reservas). Al finalizar, cierre la solicitud."
                    }
                  </p>
              </div>

              <div className="mt-6 bg-gray-50 p-4 rounded-lg border border-gray-200">
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Archivos en Drive</h4>
                  
                  {files.length === 0 ? (
                    <p className="text-sm text-gray-400 italic text-center py-2">No hay archivos cargados aún.</p>
                  ) : (
                    <ul className="space-y-2">
                      {files.map((file, idx) => (
                        <li key={idx} className="flex items-center justify-between text-sm bg-white p-2 rounded border border-gray-200">
                          <div className="flex items-center gap-2 truncate">
                            <span className="text-lg">📄</span>
                            <a href={file.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate max-w-[200px]" title={file.name}>
                              {file.name}
                            </a>
                          </div>
                          <span className="text-xs text-gray-400 whitespace-nowrap">{new Date(file.date).toLocaleDateString()}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  
                  {folderUrl && (
                    <div className="mt-4 text-center">
                      <a href={folderUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-red font-bold hover:underline">
                        Abrir Carpeta en Google Drive ↗
                      </a>
                    </div>
                  )}
              </div>

              {!isProcessed && (
                  <div className="mt-6">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Agregar Nuevo Archivo</label>
                      <div className="flex items-center justify-center w-full">
                          <label className={`flex flex-col w-full h-32 border-2 border-dashed hover:bg-gray-50 hover:border-gray-300 group ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                              <div className="flex flex-col items-center justify-center pt-7">
                                  {loading ? (
                                      <p className="text-sm text-gray-400">Subiendo...</p>
                                  ) : (
                                      <>
                                          <svg className="w-8 h-8 text-gray-400 group-hover:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                                          <p className="pt-1 text-sm tracking-wider text-gray-400 group-hover:text-gray-600">
                                              Seleccione un archivo
                                          </p>
                                      </>
                                  )}
                              </div>
                              <input type="file" className="opacity-0" onChange={handleFileUpload} disabled={loading} ref={fileInputRef} />
                          </label>
                      </div>
                  </div>
              )}
            </div>

            <div className="mt-5 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-3 sm:grid-flow-row-dense">
              {!isProcessed ? (
                  <>
                      <button 
                          type="button" 
                          onClick={handleFinalizeClick} 
                          disabled={loading || files.length === 0}
                          className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-green-600 text-base font-medium text-white hover:bg-green-700 focus:outline-none disabled:opacity-50 disabled:bg-gray-400 sm:col-start-2 sm:text-sm"
                      >
                          {loading ? 'Procesando...' : 'Finalizar Solicitud'}
                      </button>
                      <button 
                          type="button" 
                          onClick={onClose} 
                          className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none sm:mt-0 sm:col-start-1 sm:text-sm"
                      >
                          Cerrar
                      </button>
                  </>
              ) : (
                  <button 
                      type="button" 
                      onClick={onClose} 
                      className="col-span-2 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none sm:text-sm"
                  >
                      Cerrar
                  </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
