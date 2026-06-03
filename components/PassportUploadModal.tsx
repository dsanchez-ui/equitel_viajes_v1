import React, { useState, useEffect } from 'react';
import { PassportStatus } from '../types';
import { gasService } from '../services/gasService';

interface PassportUploadModalProps {
  cedula: string;
  nombre: string;
  isReplace: boolean;
  requestContext?: string;
  onClose: () => void;
  onSuccess: (status: PassportStatus) => void;
}

const MAX_FILE_MB = 10;
const ACCEPT_EXT = '.pdf,.png,.jpg,.jpeg,.webp,.heic';

const readFileAsBase64 = (f: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve((reader.result as string).split(',')[1]);
  reader.onerror = () => reject(new Error('No se pudo leer ' + f.name));
  reader.readAsDataURL(f);
});

export const PassportUploadModal: React.FC<PassportUploadModalProps> = ({
  cedula, nombre, isReplace, requestContext, onClose, onSuccess
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loading, onClose]);

  const handleClose = () => {
    if (loading) {
      if (!window.confirm('Hay una subida en curso. ¿Cerrar de todos modos?')) return;
    }
    onClose();
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg(null);
    const f = e.target.files?.[0] || null;
    if (!f) { setFile(null); return; }
    const mb = f.size / 1024 / 1024;
    if (mb > MAX_FILE_MB) {
      setErrorMsg(`El archivo pesa ${mb.toFixed(1)} MB. Máximo permitido: ${MAX_FILE_MB} MB.`);
      e.target.value = '';
      setFile(null);
      return;
    }
    setFile(f);
  };

  const handleUpload = async () => {
    if (!file) {
      setErrorMsg('Seleccione un archivo primero.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const fileData = await readFileAsBase64(file);
      const status = await gasService.uploadPassport({
        cedula,
        nombre,
        fileData,
        fileName: file.name,
        mimeType: file.type || 'application/pdf',
        requestContext
      });
      onSuccess(status);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Error subiendo pasaporte.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="passport-modal-title"
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded shadow-lg max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-3">
          <h2 id="passport-modal-title" className="text-base font-bold text-gray-900 uppercase">
            Cargar pasaporte
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-40"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded px-3 py-2 mb-3 text-sm">
          <div className="text-gray-500 text-xs uppercase tracking-wide">Pasajero</div>
          <div className="text-gray-900 font-medium">{nombre || '(sin nombre)'}</div>
          <div className="text-gray-500 text-xs mt-1">
            CC <span className="font-mono">{cedula || '—'}</span>
          </div>
        </div>

        <p className="text-xs text-gray-600 mb-3 leading-relaxed">
          Suba el PDF del pasaporte vigente. También acepta foto/escaneado en PNG, JPG, WEBP o HEIC.
          Tamaño máximo {MAX_FILE_MB} MB.
        </p>

        {isReplace && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2 mb-3 rounded">
            <strong>Reemplazo:</strong> esto reemplazará el pasaporte cargado anteriormente.
            El anterior se conserva archivado en Drive (no se pierde).
          </div>
        )}

        <div className="mb-3">
          <input
            type="file"
            accept={ACCEPT_EXT}
            onChange={handleFile}
            disabled={loading}
            className="block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-4 file:rounded file:border-0 file:text-xs file:font-bold file:bg-brand-red file:text-white hover:file:bg-red-700 disabled:opacity-50"
          />
          {file && (
            <p className="mt-2 text-xs text-gray-600">
              Seleccionado: <strong>{file.name}</strong> ({(file.size / 1024 / 1024).toFixed(2)} MB)
            </p>
          )}
        </div>

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 mb-3 rounded">
            {errorMsg}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="px-4 py-2 text-xs uppercase tracking-wide font-bold text-gray-600 hover:text-gray-900 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={loading || !file}
            className="bg-brand-red text-white px-5 py-2 rounded text-xs uppercase tracking-wide font-bold hover:bg-red-700 disabled:opacity-40"
          >
            {loading ? 'Subiendo…' : 'Cargar pasaporte'}
          </button>
        </div>
      </div>
    </div>
  );
};
