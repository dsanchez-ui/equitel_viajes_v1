
import React, { useState } from 'react';
import { TravelRequest } from '../types';
import { gasService } from '../services/gasService';
import { formatToDDMMYYYY } from '../utils/dateUtils';

interface ChangeRequestModalProps {
  request: TravelRequest;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'initial' | 'confirmDeny' | 'parentDecision' | 'processing' | 'error';

export const ChangeRequestModal: React.FC<ChangeRequestModalProps> = ({ request, onClose, onSuccess }) => {
  const [step, setStep] = useState<Step>('initial');
  const [reason, setReason] = useState('');
  const [parentAction, setParentAction] = useState<'keep' | 'anulate' | 'consult'>('keep');
  const [error, setError] = useState('');
  const isHotelOnly = request.requestMode === 'HOTEL_ONLY';

  const handleStudy = async () => {
    setStep('processing');
    try {
      await gasService.processChangeDecision(request.requestId, 'study');
      onSuccess();
    } catch (e: any) {
      setError(e?.message || String(e));
      setStep('error');
    }
  };

  const handleDeny = async () => {
    if (!reason.trim()) {
      setError('Debe indicar un motivo para denegar el cambio.');
      return;
    }
    setStep('processing');
    try {
      await gasService.processChangeDecision(request.requestId, 'deny', { reason: reason.trim(), parentAction });
      onSuccess();
    } catch (e: any) {
      setError(e?.message || String(e));
      setStep('error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-amber-50">
          <div>
            <h2 className="text-lg font-bold text-amber-900 flex items-center gap-2">
              <span>🔄</span> Revisar Solicitud de Cambio
            </h2>
            <p className="text-xs text-amber-800 mt-0.5">
              {request.requestId}
              {request.relatedRequestId && (
                <> · reemplazaría a <strong>{request.relatedRequestId}</strong></>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Resumen del cambio */}
          <div className="bg-gray-50 border border-gray-200 rounded-md p-4 text-sm">
            <div className="grid grid-cols-2 gap-y-2 gap-x-4">
              <div>
                <div className="text-xs uppercase text-gray-500 font-semibold">Solicitante</div>
                <div className="text-gray-900">{request.requesterEmail}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500 font-semibold">
                  {isHotelOnly ? 'Ciudad de hospedaje' : 'Ruta'}
                </div>
                <div className="text-gray-900">
                  {isHotelOnly ? (
                    <>🏨 {request.destination}</>
                  ) : (
                    <>{request.origin} → {request.destination}</>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500 font-semibold">
                  {isHotelOnly ? 'Check-in' : 'Fecha ida'}
                </div>
                <div className="text-gray-900">{formatToDDMMYYYY(request.departureDate)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500 font-semibold">
                  {isHotelOnly ? 'Check-out' : 'Fecha regreso'}
                </div>
                <div className="text-gray-900">
                  {request.returnDate ? formatToDDMMYYYY(request.returnDate) : <span className="italic text-gray-400">—</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Motivo del cambio */}
          {request.changeReason && (
            <div className="bg-amber-50 border-l-4 border-amber-400 p-3 rounded">
              <div className="text-xs uppercase font-bold text-amber-900 mb-1">Motivo del cambio (del usuario)</div>
              <div className="text-sm text-amber-900 italic">"{request.changeReason}"</div>
            </div>
          )}

          {/* Aviso de costo extra */}
          {request.parentWasReserved && (
            <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded text-sm">
              <strong>⚠️ Cambio con costo extra:</strong> la solicitud original ya estaba <strong>RESERVADA</strong>. Aceptar este cambio puede generar penalidades.
            </div>
          )}

          {/* Paso: inicial — elegir acción */}
          {step === 'initial' && (
            <div className="space-y-3 pt-2">
              <p className="text-sm text-gray-700">
                ¿Qué desea hacer con esta solicitud de cambio?
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={handleStudy}
                  className="px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-md font-bold text-sm flex flex-col items-center"
                >
                  <span className="text-base">✅ PASAR A ESTUDIO</span>
                  <span className="text-xs font-normal mt-1 opacity-90">Aceptar y comenzar a gestionar</span>
                </button>
                <button
                  onClick={() => { setError(''); setStep('confirmDeny'); }}
                  className="px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-md font-bold text-sm flex flex-col items-center"
                >
                  <span className="text-base">❌ DENEGAR CAMBIO</span>
                  <span className="text-xs font-normal mt-1 opacity-90">Rechazar e indicar motivo</span>
                </button>
              </div>
              <p className="text-xs text-gray-500 italic pt-2">
                Nota: mientras esta solicitud de cambio está pendiente, los recordatorios de la solicitud original quedan pausados automáticamente.
              </p>
            </div>
          )}

          {/* Paso: confirmar denegación con motivo */}
          {step === 'confirmDeny' && (
            <div className="space-y-3 pt-2 border-t border-gray-200">
              <h3 className="text-sm font-bold text-red-700">Confirmar denegación</h3>
              <p className="text-xs text-gray-600">
                El cambio será rechazado y el solicitante recibirá un correo con el motivo que usted indique.
              </p>
              <label className="block">
                <span className="text-xs font-bold text-gray-700 uppercase">Motivo de la denegación *</span>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  rows={3}
                  placeholder="Ej: No es viable; la solicitud original ya fue facturada; los tiempos no permiten gestionar el cambio..."
                  className="mt-1 block w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:ring-brand-red focus:border-brand-red"
                />
              </label>
              {error && <div className="text-xs text-red-600">{error}</div>}
              <div className="flex justify-between gap-2 pt-2">
                <button
                  onClick={() => { setError(''); setStep('initial'); }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
                >
                  ← Volver
                </button>
                <button
                  onClick={() => {
                    if (!reason.trim()) { setError('Debe indicar un motivo.'); return; }
                    setError('');
                    setStep('parentDecision');
                  }}
                  className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-md"
                >
                  Continuar →
                </button>
              </div>
            </div>
          )}

          {/* Paso: decisión sobre la solicitud original */}
          {step === 'parentDecision' && (
            <div className="space-y-3 pt-2 border-t border-gray-200">
              <h3 className="text-sm font-bold text-gray-900">
                ¿Qué hacer con la solicitud original {request.relatedRequestId ? <code className="text-xs bg-gray-100 px-1">{request.relatedRequestId}</code> : ''}?
              </h3>
              <p className="text-xs text-gray-600">
                Al denegar el cambio, la solicitud original todavía existe. Elija si mantenerla activa (continuará su proceso normal) o anularla también.
              </p>
              <div className="space-y-2">
                <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-md cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="parentAction"
                    value="keep"
                    checked={parentAction === 'keep'}
                    onChange={() => setParentAction('keep')}
                    className="mt-1"
                  />
                  <div>
                    <div className="text-sm font-semibold text-gray-900">Mantener activa la solicitud original</div>
                    <div className="text-xs text-gray-500">Los recordatorios y el flujo normal se reanudan. Use esta opción si el usuario aún necesita viajar según la solicitud inicial.</div>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-md cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="parentAction"
                    value="anulate"
                    checked={parentAction === 'anulate'}
                    onChange={() => setParentAction('anulate')}
                    className="mt-1"
                  />
                  <div>
                    <div className="text-sm font-semibold text-gray-900">Anular también la solicitud original</div>
                    <div className="text-xs text-gray-500">El usuario recibirá un correo de anulación. Use esta opción si ni el cambio ni la original son viables.</div>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-md cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="parentAction"
                    value="consult"
                    checked={parentAction === 'consult'}
                    onChange={() => setParentAction('consult')}
                    className="mt-1"
                  />
                  <div>
                    <div className="text-sm font-semibold text-gray-900">Consultar al usuario antes de decidir</div>
                    <div className="text-xs text-gray-500">Se le enviará un correo al solicitante con el motivo de la denegación y dos botones: <strong>Continuar</strong> o <strong>Anular</strong>. Mientras responde, la solicitud original queda pausada (sin recordatorios).</div>
                  </div>
                </label>
              </div>
              {error && <div className="text-xs text-red-600">{error}</div>}
              <div className="flex justify-between gap-2 pt-2">
                <button
                  onClick={() => { setError(''); setStep('confirmDeny'); }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
                >
                  ← Volver
                </button>
                <button
                  onClick={handleDeny}
                  className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-md"
                >
                  Confirmar denegación
                </button>
              </div>
            </div>
          )}

          {/* Estado: procesando */}
          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-red mb-3"></div>
              <div className="text-sm text-gray-600">Procesando...</div>
            </div>
          )}

          {/* Estado: error */}
          {step === 'error' && (
            <div className="space-y-3 pt-2 border-t border-gray-200">
              <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded text-sm">
                <strong>Error:</strong> {error}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
                >
                  Cerrar
                </button>
                <button
                  onClick={() => { setError(''); setStep('initial'); }}
                  className="px-4 py-2 text-sm font-medium text-white bg-gray-700 hover:bg-gray-800 rounded-md"
                >
                  Reintentar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
