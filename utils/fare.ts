/**
 * Tarifa de los tiquetes según el manual COM-P-02 v07 (#A95, reunión del 8-oct-2026).
 *
 * ⚠️ ESTE ARCHIVO TIENE UN GEMELO EN EL BACKEND.
 * La misma lógica vive en `server/Code.gs` (`FARE_TABLE`, `_fareOptionForNights_`,
 * `_fareNights_`, `_fareName_`, `_fareLabel_`, `_fareIsException_`, `_normalizeFare_`).
 * `tools/check-fare-rules.cjs` compara ambos lados dentro de `npm run verify`.
 *
 * El manual (página 2) asigna la tarifa por las noches del viaje:
 *   - TIPO 1 (Opción 1): viajes de 0 a 1 noche.
 *   - TIPO 2 (Opción 2): de 2 a 5 noches.
 *   - TIPO 3 (Opción 3): 6 noches o más. El manual dice «más de 6»; los 6 noches,
 *     que no caen en ningún rango, se tratan como TIPO 3 (Yurani: «la tres es de 6 días»).
 * Noches = fecha de regreso − fecha de ida. Sin regreso, las noches de hotel (o 0).
 *
 * Cada aerolínea le da su nombre a cada opción. En Avianca las opciones 2 y 3 son la
 * misma tarifa (Classic): comprar una u otra no es una excepción. Con una aerolínea que
 * no está en el manual (Wingo, JetSMART…) solo cuenta el número.
 *
 * Se guarda en la columna de siempre, `TIPO DE COMPRA DE TKT` ('TIPO 1', 'TIPO 2' o
 * 'TIPO 3'). Si la tarifa no es la recomendada, se pide una justificación.
 */

import { purchaseKey } from './purchase';

export const FARE_TABLE: Record<string, string[]> = {
  'LATAM': ['Basic', 'Light', 'Full'],
  'Avianca': ['Basic', 'Classic', 'Classic'],
  'Clic': ['VeLigera', 'VeEcono', 'VePreferencial'],
  'Satena': ['Z0Basic', 'Z0Econo', 'Z0Flexi'],
};
export const FARE_JUSTIFICATION_MIN = 10;
export const FARE_JUSTIFICATION_MAX = 500;

/** TIPO de la tarifa para las noches del viaje. */
export function fareOptionForNights(nights: unknown): number {
  const n = Number(nights);
  if (!isFinite(n) || n <= 1) return 1;
  if (n <= 5) return 2;
  return 3;
}

/** Noches del viaje: regreso − ida ('AAAA-MM-DD'); sin regreso, las noches de hotel. */
export function fareNights(departureKey: unknown, returnKey: unknown, hotelNights: unknown): number {
  const re = /^(\d{4})-(\d{2})-(\d{2})$/;
  const d = re.exec(String(departureKey || '').slice(0, 10));
  const r = re.exec(String(returnKey || '').slice(0, 10));
  if (d && r) {
    const days = Math.round((Date.UTC(+r[1], +r[2] - 1, +r[3]) - Date.UTC(+d[1], +d[2] - 1, +d[3])) / 86400000);
    return days > 0 ? days : 0;
  }
  const h = Math.round(Number(hotelNights));
  return isFinite(h) && h > 0 ? h : 0;
}

/** Nombre de la tarifa en esa aerolínea ('Classic'), o '' si la aerolínea no está en el manual. */
export function fareName(airline: unknown, option: number): string {
  const key = purchaseKey(airline);
  for (const a of Object.keys(FARE_TABLE)) {
    if (purchaseKey(a) === key) return FARE_TABLE[a][option - 1] || '';
  }
  return '';
}

/** «Classic», «Light (ida) y Classic (regreso)» o '' (aerolíneas fuera del manual). */
export function fareLabel(option: number, airline: unknown, returnAirline?: unknown): string {
  const ida = fareName(airline, option);
  const back = returnAirline ? fareName(returnAirline, option) : '';
  if (back && back !== ida) return (ida || 'TIPO ' + option) + ' (ida) y ' + back + ' (regreso)';
  return ida;
}

/**
 * ¿La tarifa elegida es distinta de la recomendada? En cada aerolínea del manual se
 * compara el nombre (Avianca 2 = 3 = Classic); fuera del manual, el número.
 */
export function fareIsException(option: number, recommended: number, airlines: unknown[]): boolean {
  if (option === recommended) return false;
  const known = airlines.filter((a) => fareName(a, 1));
  if (!known.length) return true;
  return known.some((a) => fareName(a, option) !== fareName(a, recommended));
}

export interface FareCheck {
  ok: boolean;
  /** 1, 2 o 3 (0 si no es válida). */
  option: number;
  recommended: number;
  /** Nombre en la aerolínea, para leer la hoja ('' fuera del manual). */
  name: string;
  exception: boolean;
  /** Solo si es una excepción; '' si no. */
  justification: string;
  error?: string;
}

/** Acepta 2, '2', 'TIPO 2', 'Opción 2'. */
function fareOptionValue(v: unknown): number {
  const m = /^(?:tipo|opci[oó]n)?\s*([123])$/i.exec(String(v == null ? '' : v).trim());
  return m ? Number(m[1]) : 0;
}

export function normalizeFare(option: unknown, justification: unknown, recommended: unknown, airline: unknown, returnAirline?: unknown): FareCheck {
  const rec = fareOptionValue(recommended) || 1;
  const opt = fareOptionValue(option);
  if (!opt) return { ok: false, option: 0, recommended: rec, name: '', exception: false, justification: '', error: 'Seleccione la tarifa (TIPO 1, 2 o 3).' };
  const name = fareLabel(opt, airline, returnAirline);
  const exception = fareIsException(opt, rec, [airline, returnAirline].filter(Boolean));
  if (!exception) return { ok: true, option: opt, recommended: rec, name, exception: false, justification: '' };
  const j = String(justification == null ? '' : justification).replace(/\s+/g, ' ').trim();
  if (j.length < FARE_JUSTIFICATION_MIN) {
    const recName = fareLabel(rec, airline, returnAirline);
    return { ok: false, option: opt, recommended: rec, name, exception: true, justification: '',
      error: 'La tarifa elegida no es la que recomienda el manual (TIPO ' + rec + (recName ? ' · ' + recName : '') + '). Escriba por qué (mínimo ' + FARE_JUSTIFICATION_MIN + ' caracteres).' };
  }
  if (j.length > FARE_JUSTIFICATION_MAX) {
    return { ok: false, option: opt, recommended: rec, name, exception: true, justification: '',
      error: 'La justificación de la tarifa es demasiado larga (máximo ' + FARE_JUSTIFICATION_MAX + ' caracteres).' };
  }
  return { ok: true, option: opt, recommended: rec, name, exception: true, justification: j };
}

// ---------------------------------------------------------------------------
// Solo pantalla (sin gemelo en el backend)
// ---------------------------------------------------------------------------

/** Equipaje de cada opción, como lo describe el manual (página 2). */
const FARE_BAGGAGE: Record<string, string[]> = {
  'LATAM': ['artículo pequeño', 'artículo pequeño y equipaje de mano 10 kg', 'equipaje de mano 10 kg y bodega 23 kg'],
  'Avianca': ['artículo pequeño', 'equipaje de mano 10 kg y bodega 23 kg', 'equipaje de mano 10 kg y bodega 23 kg'],
  'Clic': ['equipaje de mano 5 kg y bodega 10 kg', 'equipaje de mano 5 kg y bodega 15 kg', 'equipaje de mano 10 kg y bodega 20 kg'],
  'Satena': ['equipaje de mano 5 kg', 'equipaje de mano 5 kg', 'equipaje de mano 5 kg'],
};
const FARE_BAGGAGE_GENERIC = ['solo artículo pequeño', 'con equipaje de mano', 'con equipaje de mano y bodega'];

export function fareBaggage(airline: unknown, option: number): string {
  const key = purchaseKey(airline);
  for (const a of Object.keys(FARE_BAGGAGE)) {
    if (purchaseKey(a) === key) return FARE_BAGGAGE[a][option - 1] || '';
  }
  return FARE_BAGGAGE_GENERIC[option - 1] || '';
}

/** Lo que sabe la pantalla de una solicitud para recomendar la tarifa. */
export interface FareTrip {
  departureDate?: string;
  returnDate?: string;
  nights?: number;
}

/** Fecha de la app ('AAAA-MM-DD…', 'DD-MM-AAAA' o 'DD/MM/AAAA') → 'AAAA-MM-DD'. */
export function fareDateKey(v: unknown): string {
  const s = String(v || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(s);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return '';
}

export function fareRecommendation(trip: FareTrip): { nights: number; option: number; byDates: boolean } {
  const dep = fareDateKey(trip.departureDate), ret = fareDateKey(trip.returnDate);
  const nights = fareNights(dep, ret, trip.nights);
  return { nights, option: fareOptionForNights(nights), byDates: !!(dep && ret) };
}

/** «TIPO 2 · Classic» o «TIPO 2». */
export function fareShort(option: number, airline?: unknown, returnAirline?: unknown): string {
  const n = fareLabel(option, airline, returnAirline);
  return 'TIPO ' + option + (n ? ' · ' + n : '');
}

/** Lo que se edita en «Confirmar costos» y en «Registrar reserva». */
export interface FareForm {
  option: string;
  justification: string;
}

/** Precarga: lo ya registrado; si no hay, la recomendada. */
export function fareFormFrom(req: { fareType?: string; fareJustification?: string }, recommended: number): FareForm {
  return { option: req.fareType || String(recommended), justification: req.fareJustification || '' };
}
