
import React, { useState, useEffect, useRef } from 'react';
import { TravelRequest, RequestStatus } from '../types';
import { gasService } from '../services/gasService';
import { ConfirmationDialog } from './ConfirmationDialog';
import { validateCostAmount, formatCop } from '../utils/money';
import { normalizePurchaseInfo, purchaseChannelLabel } from '../utils/purchase';
import { PurchaseInfoFields } from './PurchaseInfoFields';
import {
  BirthdatesLoadState, RequestTripCorporateInfo, RequestPassengersHotelInfo, RequestComments, RequestOptionsGallery,
} from './RequestInfoSections';

interface CostConfirmationModalProps {
  request: TravelRequest;
  onClose: () => void;
  onSuccess: () => void;
  canSkipApproval?: boolean;
}

export const CostConfirmationModal: React.FC<CostConfirmationModalProps> = ({ request, onClose, onSuccess, canSkipApproval }) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const [loading, setLoading] = useState(false);
  // #A41: guard síncrono contra double-click en confirm del dialog →
  // executeSubmission. Si el dialog se cierra rápido y el usuario clickea
  // dos veces, podrían dispararse 2 updateRequestStatus en paralelo.
  const submittingRef = useRef(false);
  // #R4.b: saltar la etapa de aprobación (viaje ya autorizado fuera del sistema). Solo quien
  // el backend autoriza (#A77: Yurani y David); el backend lo revalida.
  const [skipApproval, setSkipApproval] = useState<boolean>(false);
  const [skipJustification, setSkipJustification] = useState<string>('');
  // #A79: los costos se escriben como texto en pesos, con o sin puntos de miles.
  // Con el campo numérico, "889.518" se guardaba como 889,518 pesos.
  const [ticketsText, setTicketsText] = useState<string>('');
  const [hotelText, setHotelText] = useState<string>('');

  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'ALERT' | 'CONFIRM' | 'SUCCESS';
    onConfirm: () => void;
    onCancel?: () => void;
  }>({ isOpen: false, title: '', message: '', type: 'ALERT', onConfirm: () => {} });

  const closeDialog = () => setDialog(prev => ({ ...prev, isOpen: false }));

  const isHotelOnly = request.requestMode === 'HOTEL_ONLY';

  // #A81: el modal muestra todo el detalle de la solicitud. Las filas del panel
  // no traen las opciones (#A60), así que se pide la solicitud completa; mientras
  // llega se muestra lo que ya trae la fila.
  const [full, setFull] = useState<TravelRequest>(request);
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [detailError, setDetailError] = useState<string>('');
  const loadDetail = async () => {
    setDetailState('loading');
    try {
      const r = await gasService.getRequestById(request.requestId);
      if (!r) throw new Error('No se encontró la solicitud.');
      setFull(r);
      setDetailState('ready');
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : String(e));
      setDetailState('error');
    }
  };
  useEffect(() => {
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.requestId]);
  const _validOptions = (full.analystOptions || []).filter((o): o is NonNullable<typeof o> => !!o && typeof o === 'object');
  const _byLetter = (a: { id?: string }, b: { id?: string }) => String(a.id || '').localeCompare(String(b.id || ''));
  const flightOptions = _validOptions.filter(o => o.type === 'FLIGHT').sort(_byLetter);
  const hotelOptions = _validOptions.filter(o => o.type === 'HOTEL').sort(_byLetter);
  const passengerInfoState: BirthdatesLoadState = Array.isArray(full.passengerAdminInfo) ? 'ready' : (detailState === 'loading' ? 'loading' : 'error');
  const passengerInfoByCedula: Record<string, NonNullable<TravelRequest['passengerAdminInfo']>[number]> = {};
  (full.passengerAdminInfo || []).forEach(r => { passengerInfoByCedula[r.cedula] = r; });

  // #A82: aerolínea y canal de compra previstos.
  const [purchase, setPurchase] = useState<{ airline: string; channel: string }>({
    airline: request.purchaseAirline || '',
    channel: request.purchaseChannel || '',
  });
  const [triedSubmit, setTriedSubmit] = useState(false);
  const purchaseCheck = normalizePurchaseInfo(purchase.airline, purchase.channel, isHotelOnly);

  // Vuelos: tiquetes obligatorio y hotel opcional. Solo hospedaje: hotel obligatorio.
  const ticketsCheck = validateCostAmount(ticketsText, 'de los tiquetes', !isHotelOnly);
  const hotelCheck = validateCostAmount(hotelText, 'del hotel', isHotelOnly);
  const costTickets = !isHotelOnly && ticketsCheck.ok ? (ticketsCheck.value || 0) : 0;
  const costHotel = hotelCheck.ok ? (hotelCheck.value || 0) : 0;
  const total = costTickets + costHotel;

  const handleSubmit = async () => {
      setTriedSubmit(true);
      const problems: string[] = [];
      if (!isHotelOnly && !ticketsCheck.ok && ticketsCheck.error) problems.push(ticketsCheck.error);
      if (!hotelCheck.ok && hotelCheck.error) problems.push(hotelCheck.error);
      if (!purchaseCheck.ok && purchaseCheck.error) problems.push(purchaseCheck.error);
      if (problems.length > 0) {
          setDialog({ isOpen: true, title: 'Validación', message: problems.join('\n\n'), type: 'ALERT', onConfirm: closeDialog });
          return;
      }

      let message = isHotelOnly
          ? `Se registrará el costo del hospedaje:\n\nHotel: $${formatCop(costHotel)}\nTotal: $${formatCop(total)}\n\n`
          : `Se registrarán los siguientes costos:\n\nTiquetes: $${formatCop(costTickets)}\nHotel: $${formatCop(costHotel)}\nTotal: $${formatCop(total)}\n\n`;
      if (total === 0) {
          message += "⚠️ Se registrará SIN COSTO (por ejemplo, un apartamento corporativo).\n\n";
      }
      message += `Compra: ${purchaseCheck.airline ? purchaseCheck.airline + ' · ' : ''}${purchaseChannelLabel(purchaseCheck.channel, isHotelOnly)}\n\n`;

      // Saltar aprobación requiere el permiso (#A77) y una justificación válida.
      if (skipApproval) {
          if (!canSkipApproval) {
              setDialog({ isOpen: true, title: 'Validación', message: 'No tienes permiso para saltar la etapa de aprobación.', type: 'ALERT', onConfirm: closeDialog });
              return;
          }
          if (skipJustification.trim().length < 10) {
              setDialog({ isOpen: true, title: 'Validación', message: 'La justificación para saltar la aprobación debe tener al menos 10 caracteres.', type: 'ALERT', onConfirm: closeDialog });
              return;
          }
          message += `⏭️ SE SALTARÁ LA ETAPA DE APROBACIÓN.\nLa solicitud pasará directamente a APROBADO.\n\nJustificación: "${skipJustification.trim()}"\n\n`;
      } else if (!request.isInternational && total > 1200000) {
          message += "⚠️ ALERTA DE COSTO: El valor supera $1.200.000. Se solicitará aprobación adicional a Dirección de Cadena de Suministro y Aprobador de Área.\n\n";
      }

      message += skipApproval
        ? "Se registrará la decisión sin enviar correos de aprobación."
        : "Se enviará la solicitud para aprobación.";

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
      if (submittingRef.current) return; // #A41: evita double-trigger
      submittingRef.current = true;
      closeDialog();
      setLoading(true);
      try {
          await gasService.updateRequestStatus(request.requestId, RequestStatus.PENDING_APPROVAL, {
              finalCostTickets: costTickets,
              finalCostHotel: costHotel,
              totalCost: total,
              // #A82: un backend anterior ignora estas claves (no falla).
              purchaseAirline: purchaseCheck.airline,
              purchaseChannel: purchaseCheck.channel,
              // Si vamos a saltar aprobación inmediatamente, le decimos al
              // backend que NO envíe correo a los aprobadores en este paso
              // intermedio — nunca van a actuar sobre la solicitud.
              skipApprovalNotification: skipApproval
          });

          if (skipApproval) {
              // Salto inmediatamente después de confirmar costos: backend
              // pasará de PENDIENTE_APROBACION → APROBADO sin enviar correos
              // de aprobación NI correo de "Solicitud Aprobada" al solicitante.
              // El registro queda en OBSERVACIONES y EVENTOS_JSON.
              await gasService.skipApprovalStage(request.requestId, skipJustification.trim());
          }

          setDialog({
              isOpen: true,
              title: 'Exito',
              message: skipApproval
                ? "Costos confirmados y etapa de aprobación saltada. Solicitud APROBADA."
                : "Costos confirmados. Solicitud enviada a aprobación.",
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
          submittingRef.current = false;
      }
  };

  /** Campo de costo: acepta 889518 o 889.518 y al salir lo deja con puntos de miles. */
  const renderCostInput = (kind: 'tickets' | 'hotel', label: string, text: string, setText: (v: string) => void, check: ReturnType<typeof validateCostAmount>) => (
      <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">{label}</label>
          <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              data-cost={kind}
              placeholder="Ej: 889.518"
              className={`w-full border rounded p-2 text-gray-900 font-bold bg-white focus:ring-purple-500 focus:border-purple-500 ${text.trim() && !check.ok ? 'border-red-400' : 'border-gray-300'}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => { if (text.trim() && check.ok && check.value !== null) setText(formatCop(check.value)); }}
          />
          {text.trim() !== '' && (check.ok
              ? <p className="text-xs text-gray-500 mt-1" data-cost-preview={kind}>Se registrará: $ {formatCop(check.value || 0)}</p>
              : <p className="text-xs text-red-600 mt-1" data-cost-error={kind}>{check.error}</p>
          )}
      </div>
  );

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

          <div className="relative inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-6xl sm:w-full sm:p-6">
             <div className="absolute top-0 right-0 pt-4 pr-4 z-10">
              <button onClick={onClose} className="bg-white rounded-md text-gray-400 hover:text-gray-500 text-2xl font-bold leading-none px-2 focus:outline-none">✕</button>
            </div>

            <h3 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2">
                Confirmar Costos - <span className="text-brand-red">{request.requestId}</span>
            </h3>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* #A81: detalle de la solicitud (solo lectura) */}
            <div className="lg:col-span-3 space-y-4 lg:max-h-[75vh] lg:overflow-y-auto lg:pr-2" data-cost-detail>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-bold text-gray-500 uppercase tracking-wider">Detalle de la solicitud</span>
                    {full.isInternational && <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold">🌍 Internacional</span>}
                    {full.policyViolation && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-bold">⚠️ Fuera de política de anticipación</span>}
                    {detailState === 'loading' && <span className="text-gray-400 animate-pulse" data-cost-detail-loading>Cargando opciones…</span>}
                </div>
                {detailState === 'error' && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded text-xs flex items-center justify-between gap-3" data-cost-detail-error>
                        <span>No se pudo cargar el detalle completo (opciones y datos de los pasajeros): {detailError}</span>
                        <button type="button" onClick={loadDetail} className="px-2 py-1 bg-white border border-red-300 rounded font-bold hover:bg-red-100">Reintentar</button>
                    </div>
                )}
                <RequestTripCorporateInfo request={full} />
                <RequestPassengersHotelInfo request={full} isAdmin={true}
                    passengerInfoState={passengerInfoState} passengerInfoByCedula={passengerInfoByCedula} />
                <RequestComments request={full} />
                <RequestOptionsGallery flightOptions={flightOptions} hotelOptions={hotelOptions} />
                {detailState === 'ready' && _validOptions.length === 0 && (
                    <p className="text-xs text-gray-400 italic">Esta solicitud no tiene imágenes de opciones.</p>
                )}
            </div>

            <div className="lg:col-span-2">
            <div className="bg-purple-50 p-4 rounded mb-4 border border-purple-100">
                <span className="block text-xs font-bold text-purple-800 uppercase mb-1">Selección del Usuario:</span>
                <p className="text-sm text-gray-800 italic">"{request.selectionDetails}"</p>
            </div>

            <div className="space-y-4">
                  <p className="text-xs text-gray-500">Valores en pesos, con o sin puntos de miles (889.518 o 889518). Si no tiene costo, escriba 0.</p>
                  {/* Tiquetes — solo para solicitudes de vuelo (no hotel-only) */}
                  {!isHotelOnly && renderCostInput('tickets', 'Costo Final Tiquetes *', ticketsText, setTicketsText, ticketsCheck)}
                  {renderCostInput('hotel', isHotelOnly ? 'Costo Final Hotel *' : 'Costo Final Hotel', hotelText, setHotelText, hotelCheck)}

                  <div className="flex justify-between items-center bg-gray-100 p-3 rounded mt-2">
                      <span className="font-bold text-gray-700">Total a Aprobar:</span>
                      <span className="text-xl font-bold text-brand-red" data-cost-total>$ {formatCop(total)}</span>
                  </div>

                  <PurchaseInfoFields
                      isHotelOnly={isHotelOnly}
                      airline={purchase.airline}
                      channel={purchase.channel}
                      onChange={setPurchase}
                      showErrors={triedSubmit}
                      title="Compra prevista"
                      hint="Si al comprar el canal cambia (por ejemplo, se compra directo porque Aviatur no ajustó el precio), se corrige al registrar la reserva."
                  />

                  {canSkipApproval && (
                    <div className="mt-3 p-3 border border-amber-200 bg-amber-50 rounded">
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={skipApproval}
                          onChange={(e) => setSkipApproval(e.target.checked)}
                          className="mt-1"
                        />
                        <div>
                          <span className="font-bold text-amber-900">Saltar etapa de aprobación</span>
                          <p className="text-xs text-amber-800 mt-0.5">
                            Solo para casos ya autorizados fuera del sistema. La solicitud pasará
                            directamente a <strong>APROBADO</strong> sin enviar correos a aprobadores.
                          </p>
                        </div>
                      </label>
                      {skipApproval && (
                        <div className="mt-2">
                          <label className="block text-xs font-bold text-amber-900 mb-1 uppercase">Justificación (obligatoria, mín. 10 caracteres)</label>
                          <textarea
                            value={skipJustification}
                            onChange={(e) => setSkipJustification(e.target.value)}
                            placeholder="Ej: Ejecutivo autorizó verbalmente por urgencia operativa, los tiquetes se compraron por fuera y se registran solo para trazabilidad..."
                            rows={2}
                            className="w-full border border-amber-300 rounded p-2 text-sm bg-white"
                          />
                        </div>
                      )}
                    </div>
                  )}
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
        </div>
      </div>
    </>
  );
};
