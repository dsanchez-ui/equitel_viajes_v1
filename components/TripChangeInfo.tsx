import React from 'react';
import { TravelRequest, TripChangeInfo } from '../types';
import { fmtDayLong } from '../utils/changeWindow';
import { formatCop } from '../utils/money';

const fmtTime = (t: string): string => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(t || ''));
  if (!m) return t ? String(t) : 'Sin hora';
  const h = Number(m[1]);
  return h === 12 ? `12:${m[2]} m.` : `${h % 12 || 12}:${m[2]} ${h < 12 ? 'a. m.' : 'p. m.'}`;
};

/** Filas «Qué / Antes / Ahora» de un cambio (#A103). Mismas palabras que `_tripChangeRows_` en Code.gs. */
export const tripChangeRows = (info: TripChangeInfo | null | undefined): [string, string, string][] => {
  const c = info?.campos || {};
  const day = (k: string) => (k ? fmtDayLong(k) : 'Sin fecha');
  const out: [string, string, string][] = [];
  if (c.departureDate) out.push(['Fecha de ida', day(c.departureDate.antes), day(c.departureDate.ahora)]);
  if (c.returnDate) out.push(['Fecha de regreso', day(c.returnDate.antes), day(c.returnDate.ahora)]);
  if (c.departureTimePreference) out.push(['Hora del vuelo de ida', fmtTime(c.departureTimePreference.antes), fmtTime(c.departureTimePreference.ahora)]);
  if (c.returnTimePreference) out.push(['Hora del vuelo de regreso', fmtTime(c.returnTimePreference.antes), fmtTime(c.returnTimePreference.ahora)]);
  if (c.destination) out.push(['Destino', c.destination.antes || '—', c.destination.ahora]);
  if (c.checkedBaggage) out.push(['Maleta de bodega', c.checkedBaggage.antes ? 'Sí' : 'No', c.checkedBaggage.ahora ? 'Sí' : 'No']);
  return out;
};

/**
 * #A103: en un cambio de un tiquete comprado, la compra de la original sirve de punto de partida
 * (aerolínea, canal, PNR y tarjeta): el área de compras solo corrige lo que cambió.
 */
export const withParentPurchase = (r: TravelRequest): TravelRequest => {
  const c = r.tripChange && r.tripChange.comprado ? r.tripChange.compra : undefined;
  if (!c) return r;
  return {
    ...r,
    purchaseAirline: r.purchaseAirline || c.aerolinea,
    purchaseReturnAirline: r.purchaseReturnAirline !== undefined ? (r.purchaseReturnAirline || c.aerolineaRegreso) : r.purchaseReturnAirline,
    purchaseChannel: r.purchaseChannel || c.canal,
    reservationNumber: r.reservationNumber || c.pnr,
    creditCard: r.creditCard || c.tarjeta
  };
};

/** ¿Se agregó la maleta de bodega a un tiquete ya comprado? */
export const tripChangeBagLater = (info: TripChangeInfo | null | undefined): boolean =>
  !!(info && info.comprado && info.campos?.checkedBaggage?.ahora === true);

export const TripChangeRowsTable: React.FC<{ rows: [string, string, string][] }> = ({ rows }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm border-collapse" data-trip-change-rows>
      <thead>
        <tr className="text-left text-[11px] uppercase text-gray-500">
          <th className="py-1 pr-2 border-b-2">Qué</th><th className="py-1 pr-2 border-b-2">Antes</th><th className="py-1 border-b-2">Ahora</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r[0]}>
            <td className="py-1.5 pr-2 border-b">{r[0]}</td>
            <td className="py-1.5 pr-2 border-b text-gray-500">{r[1]}</td>
            <td className="py-1.5 border-b font-bold bg-amber-50">{r[2]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/**
 * Recuadro del cambio en el detalle de una solicitud de cambio (#A103): qué cambia, el motivo y,
 * para los administradores con el tiquete comprado, lo que costó el viaje al lado del costo del cambio.
 */
export const TripChangeBox: React.FC<{ request: TravelRequest; isAdmin?: boolean }> = ({ request, isAdmin }) => {
  const info = request.tripChange;
  if (!info) return null;
  const rows = tripChangeRows(info);
  const change = Number(request.totalCost) || 0;
  const confirmed = ['PENDIENTE_APROBACION', 'APROBADO', 'RESERVADO', 'PROCESADO'].includes(request.status);
  const orig = Number(info.costoOriginal) || 0;
  return (
    <div className="bg-amber-50 border border-amber-200 border-l-4 border-l-amber-500 rounded-md px-4 py-3 text-sm space-y-2" data-trip-change-box>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-amber-950">🔄 Cambio de {info.padre}</strong>
        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${info.comprado ? 'bg-amber-200 text-amber-900' : 'bg-blue-100 text-blue-800'}`}>
          {info.comprado ? 'Tiquete ya comprado' : 'Aún sin comprar'}
        </span>
        {info.rol === 'administrador' && <span className="text-[10px] text-gray-600">Lo registró el área de compras ({info.registradoPor})</span>}
      </div>
      <p className="text-xs text-amber-900">
        {info.comprado
          ? 'Este cambio lleva solo su costo (penalidad, diferencia de tarifa y hotel). El viaje original ya se aprobó y se pagó: no se anula y su costo sigue contando.'
          : 'El viaje original aún no se había comprado: este cambio se cotiza como el viaje completo y la original se anula al aprobarse.'}
        {isAdmin && info.parcial && !info.compraConfirmada && ' La reserva de la original se guardó por partes: el área de compras la confirma antes de cotizar el cambio.'}
      </p>
      {rows.length > 0 && <TripChangeRowsTable rows={rows} />}
      {request.changeReason && <p className="text-xs text-gray-700"><strong>Motivo:</strong> <em>"{request.changeReason}"</em></p>}
      {tripChangeBagLater(info) && (
        <p className="text-xs bg-orange-50 border border-orange-200 text-orange-900 rounded px-2 py-1">La maleta se pidió después de comprar el tiquete: pedida desde el principio no habría penalidad.</p>
      )}
      {isAdmin && info.comprado && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-amber-200 rounded overflow-hidden text-xs" data-trip-change-costs>
          <div className="bg-white px-2 py-1.5"><span className="block text-gray-500">Viaje original ({info.costoOriginalFuente === 'pagado' ? 'pagado' : 'cotizado'})</span><strong className="tabular-nums">${formatCop(orig)}</strong></div>
          <div className="bg-white px-2 py-1.5"><span className="block text-gray-500">Este cambio</span><strong className="tabular-nums text-red-700">{confirmed ? '$' + formatCop(change) : 'Por cotizar'}</strong></div>
          <div className="bg-white px-2 py-1.5"><span className="block text-gray-500">De eso, penalidad</span><strong className="tabular-nums">{typeof request.changePenalty === 'number' ? '$' + formatCop(request.changePenalty) : '—'}</strong></div>
          <div className="bg-white px-2 py-1.5"><span className="block text-gray-500">El cambio suma</span><strong className="tabular-nums">{confirmed && orig > 0 ? Math.round((100 * change) / orig) + ' %' : '—'}</strong></div>
        </div>
      )}
    </div>
  );
};

/** Aviso en la solicitud original que se cambió (#A103). */
export const ReplacedBanner: React.FC<{ request: TravelRequest }> = ({ request }) => {
  if (!request.replacedBy) return null;
  return (
    <div className="bg-gray-100 border border-gray-300 text-gray-800 px-4 py-3 rounded-md text-sm" data-replaced-banner>
      <strong>🔄 Cambiada por {request.replacedBy}.</strong> El viaje vigente es esa solicitud. Esta no se anula: su tiquete se pagó y su costo sigue contando.
    </div>
  );
};
