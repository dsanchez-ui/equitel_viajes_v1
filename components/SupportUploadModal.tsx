
import React, { useState, useRef, useEffect } from 'react';
import { TravelRequest, SupportFile } from '../types';
import { gasService } from '../services/gasService';
import { ConfirmationDialog } from './ConfirmationDialog';

interface SupportUploadModalProps {
  request: TravelRequest;
  onClose: () => void;
  onSuccess: () => void;
}

export const SupportUploadModal: React.FC<SupportUploadModalProps> = ({ request, onClose, onSuccess }) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const [loading, setLoading] = useState(false);
  const isProcessed = request.status === 'PROCESADO';

  // Existing files from Drive (non-reservation files = facturas/soportes)
  const existingFiles: SupportFile[] = (request.supportData?.files || []).filter(f => !f.isReservation);
  const [filesToDelete, setFilesToDelete] = useState<Set<string>>(new Set());

  // New files staged locally (not uploaded yet)
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const folderUrl = request.supportData?.folderUrl || null;

  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'ALERT' | 'CONFIRM' | 'SUCCESS';
    onConfirm: () => void;
    onCancel?: () => void;
  }>({ isOpen: false, title: '', message: '', type: 'ALERT', onConfirm: () => {} });

  const closeDialog = () => setDialog(prev => ({ ...prev, isOpen: false }));

  // Check if there are unsaved changes
  const hasChanges = pendingFiles.length > 0 || filesToDelete.size > 0;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const incoming: File[] = Array.from(e.target.files);

    // Validate size
    for (const f of incoming) {
      if (f.size > 10 * 1024 * 1024) {
        setDialog({
          isOpen: true,
          title: 'Archivo Muy Grande',
          message: `"${f.name}" excede el límite de 10 MB.`,
          type: 'ALERT',
          onConfirm: closeDialog
        });
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
    }

    setPendingFiles(prev => {
      const merged = [...prev];
      incoming.forEach(nf => {
        if (!merged.some(f => f.name === nf.name && f.size === nf.size)) merged.push(nf);
      });
      return merged;
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePendingFile = (idx: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const toggleDeleteExisting = (fileId: string) => {
    setFilesToDelete(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  const readFileAsBase64 = (f: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = () => reject(new Error('No se pudo leer ' + f.name));
    reader.readAsDataURL(f);
  });

  const handleSaveChanges = () => {
    const deleteCount = filesToDelete.size;
    const uploadCount = pendingFiles.length;

    let msg = '';
    if (uploadCount > 0) msg += `Se subirán ${uploadCount} archivo(s) a Drive.\n`;
    if (deleteCount > 0) msg += `Se eliminarán ${deleteCount} archivo(s) de Drive.\n`;
    msg += '\n¿Desea continuar?';

    setDialog({
      isOpen: true,
      title: 'Confirmar Cambios',
      message: msg,
      type: 'CONFIRM',
      onConfirm: executeSaveChanges,
      onCancel: closeDialog
    });
  };

  const executeSaveChanges = async () => {
    closeDialog();
    setLoading(true);

    try {
      // 1. Upload pending files FIRST (safer: if upload fails, nothing was deleted)
      for (const f of pendingFiles) {
        const base64 = await readFileAsBase64(f);
        await gasService.uploadSupportFile(request.requestId, base64, f.name, f.type);
      }

      // 2. Delete marked files AFTER successful uploads
      for (const fileId of filesToDelete) {
        await gasService.deleteOptionFile(fileId);
      }

      setDialog({
        isOpen: true,
        title: 'Cambios Guardados',
        message: `${pendingFiles.length > 0 ? pendingFiles.length + ' archivo(s) subido(s). ' : ''}${filesToDelete.size > 0 ? filesToDelete.size + ' archivo(s) eliminado(s).' : ''}`,
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
        message: 'Error guardando cambios: ' + err,
        type: 'ALERT',
        onConfirm: closeDialog
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFinalizeClick = () => {
    if (hasChanges) {
      setDialog({
        isOpen: true,
        title: 'Cambios sin guardar',
        message: 'Tiene archivos pendientes de subir o eliminar. Guarde los cambios primero antes de finalizar.',
        type: 'ALERT',
        onConfirm: closeDialog
      });
      return;
    }

    const totalFiles = existingFiles.length + (request.supportData?.files || []).filter(f => f.isReservation).length;
    if (totalFiles === 0) {
      setDialog({
        isOpen: true,
        title: 'Faltan Soportes',
        message: 'Debe cargar al menos un soporte antes de cerrar la solicitud.',
        type: 'ALERT',
        onConfirm: closeDialog
      });
      return;
    }

    setDialog({
      isOpen: true,
      title: 'Finalizar Solicitud',
      message: '¿Está seguro de cerrar esta solicitud?\n\nUna vez cerrada, no se podrán agregar más archivos y el proceso se dará por terminado.',
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
        onConfirm: () => { closeDialog(); onSuccess(); onClose(); }
      });
    } catch (err) {
      setDialog({
        isOpen: true,
        title: 'Error',
        message: 'Error cerrando solicitud: ' + err,
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

      <div className="fixed inset-0 z-[70] overflow-y-auto" role="dialog" aria-modal="true">
        <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose}></div>
          <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>

          <div className="relative inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
            <div className="absolute top-0 right-0 pt-4 pr-4 z-10">
              <button onClick={onClose} className="bg-white rounded-md text-gray-400 hover:text-gray-500 text-2xl font-bold leading-none px-2 focus:outline-none">✕</button>
            </div>

            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 mb-4">
              <span className="text-2xl">📂</span>
            </div>
            <div className="text-center">
              <h3 className="text-lg leading-6 font-medium text-gray-900">
                Soportes de Compra - {request.requestId}
              </h3>
              <p className="mt-2 text-sm text-gray-500">
                {isProcessed
                  ? 'Esta solicitud ya ha sido procesada. Puede visualizar los archivos.'
                  : 'Cargue facturas y soportes. Los archivos se suben al confirmar, no al seleccionar.'}
              </p>
            </div>

            {/* Existing files in Drive */}
            <div className="mt-6 bg-gray-50 p-4 rounded-lg border border-gray-200">
              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Archivos en Drive</h4>
              {existingFiles.length === 0 ? (
                <p className="text-sm text-gray-400 italic text-center py-2">No hay facturas/soportes cargados aún.</p>
              ) : (
                <ul className="space-y-2">
                  {existingFiles.map((file) => {
                    const markedForDelete = filesToDelete.has(file.id);
                    return (
                      <li key={file.id} className={`flex items-center justify-between text-sm p-2 rounded border ${markedForDelete ? 'bg-red-50 border-red-300 line-through opacity-60' : 'bg-white border-gray-200'}`}>
                        <div className="flex items-center gap-2 truncate">
                          <span className="text-lg">{markedForDelete ? '🗑️' : '📄'}</span>
                          <a href={file.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate max-w-[200px]" title={file.name}>
                            {file.name}
                          </a>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs text-gray-400">{new Date(file.date).toLocaleDateString()}</span>
                          {!isProcessed && (
                            <button
                              type="button"
                              onClick={() => toggleDeleteExisting(file.id)}
                              disabled={loading}
                              className={`text-xs underline ${markedForDelete ? 'text-green-600 hover:text-green-800' : 'text-red-500 hover:text-red-700'}`}
                            >
                              {markedForDelete ? 'Restaurar' : 'Eliminar'}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {folderUrl && (
                <div className="mt-4 text-center">
                  <a href={folderUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-red font-bold hover:underline">
                    Abrir Carpeta en Google Drive
                  </a>
                </div>
              )}
            </div>

            {/* Pending new files (staged, not uploaded yet) */}
            {!isProcessed && (
              <div className="mt-5">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Agregar Archivos {pendingFiles.length > 0 && <span className="text-gray-500">({pendingFiles.length} pendiente{pendingFiles.length > 1 ? 's' : ''})</span>}
                </label>

                {pendingFiles.length > 0 && (
                  <div className="mb-3 space-y-2">
                    {pendingFiles.map((f, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-green-50 border border-green-200 rounded p-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-green-700">📄</span>
                          <span className="text-sm text-gray-800 truncate" title={f.name}>{f.name}</span>
                          <span className="text-xs text-gray-400 flex-shrink-0">({(f.size / 1024).toFixed(0)} KB)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removePendingFile(idx)}
                          disabled={loading}
                          className="text-xs text-red-500 hover:text-red-700 underline ml-2 flex-shrink-0"
                        >
                          Quitar
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div
                  onClick={() => !loading && fileInputRef.current?.click()}
                  className={`border-2 border-dashed border-gray-300 rounded-lg p-4 text-center transition ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}
                >
                  <svg className="w-8 h-8 text-gray-400 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                  <p className="text-sm text-gray-400">Seleccione archivos (no se suben hasta confirmar)</p>
                  <input
                    type="file"
                    className="hidden"
                    onChange={handleFileSelect}
                    disabled={loading}
                    ref={fileInputRef}
                    multiple
                    accept=".pdf,image/*,.xlsx,.xls"
                  />
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="mt-5 space-y-3">
              {!isProcessed && hasChanges && (
                <button
                  type="button"
                  onClick={handleSaveChanges}
                  disabled={loading}
                  className="w-full inline-flex justify-center rounded-md shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 disabled:opacity-50 sm:text-sm"
                >
                  {loading ? 'Procesando...' : `Guardar Cambios (${pendingFiles.length} nuevo${pendingFiles.length !== 1 ? 's' : ''}${filesToDelete.size > 0 ? ', ' + filesToDelete.size + ' a eliminar' : ''})`}
                </button>
              )}

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 sm:text-sm"
                >
                  Cerrar
                </button>
                {!isProcessed && (
                  <button
                    type="button"
                    onClick={handleFinalizeClick}
                    disabled={loading || hasChanges}
                    className="w-full inline-flex justify-center rounded-md shadow-sm px-4 py-2 bg-green-600 text-base font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:bg-gray-400 sm:text-sm"
                    title={hasChanges ? 'Guarde los cambios primero' : 'Cerrar la solicitud permanentemente'}
                  >
                    {loading ? '...' : 'Finalizar Solicitud'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
