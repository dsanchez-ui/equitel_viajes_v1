/**
 * Aerolínea y canal de compra del tiquete (#A82), con aerolínea de regreso
 * distinta (#A85).
 *
 * ⚠️ ESTE ARCHIVO TIENE UN GEMELO EN EL BACKEND.
 * La misma lógica vive en `server/Code.gs` (`_normalizePurchaseInfo_`,
 * `_purchaseAirlineName_`, `_normalizeHotelPurchase_`, `PURCHASE_CHANNELS`, `PURCHASE_AIRLINES`). Si cambias
 * las reglas o los mensajes aquí, cámbialos allá:
 * `tools/check-purchase-info-rules.cjs` compara ambos lados dentro de
 * `npm run verify` y falla si se separan.
 *
 * El área de viajes registra con qué aerolínea y por qué canal se compra:
 * Aviatur, directo (con la aerolínea o el hotel) u otra agencia. Solo hospedaje
 * no lleva aerolínea. Si el regreso se compra con otra aerolínea (p. ej. LATAM
 * de ida y Avianca de regreso), `airline` es la de ida y `returnAirline` la del
 * regreso; vacío = la misma de ida.
 */

export const PURCHASE_CHANNELS = ['Aviatur', 'Directo', 'Otra agencia'];
export const PURCHASE_AIRLINES = ['Avianca', 'LATAM', 'Wingo', 'JetSMART', 'Satena', 'Clic', 'Copa Airlines', 'American Airlines',
  'United Airlines', 'Delta', 'Iberia', 'Aeroméxico', 'Arajet', 'Air Europa', 'Varias aerolíneas'];
export const PURCHASE_AIRLINE_MAX = 40;

export interface PurchaseInfoCheck {
  ok: boolean;
  airline: string;
  channel: string;
  /** Aerolínea del regreso si es distinta de la de ida (#A85); '' si es la misma. */
  returnAirline: string;
  /** Mensaje para el usuario cuando `ok` es false. */
  error?: string;
}

/** Clave de comparación: sin tildes, minúsculas y espacios simples. */
export function purchaseKey(s: unknown): string {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Valida un nombre de aerolínea (ya sin espacios sobrantes) y lo deja con su escritura oficial. */
function purchaseAirlineName(a: string, which: string): { ok: boolean; name: string; error?: string } {
  if (a.length > PURCHASE_AIRLINE_MAX) {
    return { ok: false, name: '', error: 'El nombre de la aerolínea' + which + ' es demasiado largo (máximo ' + PURCHASE_AIRLINE_MAX + ' caracteres).' };
  }
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9 .&'\/-]*$/.test(a)) {
    return { ok: false, name: '', error: 'La aerolínea' + which + ' solo puede tener letras, números, espacios y los signos . & \' / -' };
  }
  const key = purchaseKey(a);
  for (const known of PURCHASE_AIRLINES) {
    if (purchaseKey(known) === key) return { ok: true, name: known };
  }
  return { ok: true, name: a };
}

export function normalizePurchaseInfo(airline: unknown, channel: unknown, isHotelOnly: boolean, returnAirline?: unknown): PurchaseInfoCheck {
  const chKey = purchaseKey(channel);
  if (!chKey) return { ok: false, airline: '', channel: '', returnAirline: '', error: 'Indique el canal de compra.' };
  let ch = '';
  for (const c of PURCHASE_CHANNELS) if (purchaseKey(c) === chKey) ch = c;
  if (!ch) return { ok: false, airline: '', channel: '', returnAirline: '', error: 'Canal de compra no válido. Opciones: Aviatur, Directo u Otra agencia.' };
  if (isHotelOnly) return { ok: true, airline: '', channel: ch, returnAirline: '' };
  const a = String(airline == null ? '' : airline).replace(/\s+/g, ' ').trim();
  if (!a) return { ok: false, airline: '', channel: ch, returnAirline: '', error: 'Indique la aerolínea.' };
  const out = purchaseAirlineName(a, '');
  if (!out.ok) return { ok: false, airline: '', channel: ch, returnAirline: '', error: out.error };
  // #A85: regreso con otra aerolínea. Vacía o igual a la de ida = la misma.
  const r = String(returnAirline == null ? '' : returnAirline).replace(/\s+/g, ' ').trim();
  if (!r) return { ok: true, airline: out.name, channel: ch, returnAirline: '' };
  const back = purchaseAirlineName(r, ' del regreso');
  if (!back.ok) return { ok: false, airline: '', channel: ch, returnAirline: '', error: back.error };
  return { ok: true, airline: out.name, channel: ch, returnAirline: purchaseKey(back.name) === purchaseKey(out.name) ? '' : back.name };
}

/** Texto del canal para mostrar (el valor guardado es 'Directo'). */
export function purchaseChannelLabel(channel: string, isHotelOnly: boolean): string {
  if (channel === 'Directo') return isHotelOnly ? 'Directo con el hotel' : 'Directo con la aerolínea';
  return channel;
}

/** Texto de la aerolínea para mostrar: «LATAM» o «LATAM (ida) y Avianca (regreso)» (#A85). */
export function purchaseAirlineLabel(airline: string, returnAirline?: string): string {
  if (!airline) return '';
  return returnAirline ? airline + ' (ida) y ' + returnAirline + ' (regreso)' : airline;
}

// ---------------------------------------------------------------------------
// Hotel reservado y su canal de compra (#A94, pedido de Laura, 2026-10-08).
// Gemelo de `_normalizeHotelPurchase_` en Code.gs. El nombre se guarda como el
// del formulario de solicitudes: en mayúsculas y sin tildes. HOTEL_NOT_BOOKED
// marca que al final no se reservó hotel (no aplica a solo hospedaje).
// ---------------------------------------------------------------------------

export const HOTEL_NOT_BOOKED = 'No se reservó';
export const HOTEL_NAME_MAX = 120;

export interface HotelPurchaseCheck {
  ok: boolean;
  hotelName: string;
  hotelChannel: string;
  error?: string;
}

export function normalizeHotelPurchase(hotelName: unknown, hotelChannel: unknown, isHotelOnly: boolean): HotelPurchaseCheck {
  const chKey = purchaseKey(hotelChannel);
  if (chKey && chKey === purchaseKey(HOTEL_NOT_BOOKED)) {
    if (isHotelOnly) return { ok: false, hotelName: '', hotelChannel: '', error: 'En una solicitud de solo hospedaje indique el hotel reservado y su canal de compra.' };
    return { ok: true, hotelName: '', hotelChannel: HOTEL_NOT_BOOKED };
  }
  const n = String(hotelName == null ? '' : hotelName).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
  if (!n) return { ok: false, hotelName: '', hotelChannel: '', error: 'Indique el nombre del hotel.' };
  if (n.length > HOTEL_NAME_MAX) {
    return { ok: false, hotelName: '', hotelChannel: '', error: 'El nombre del hotel es demasiado largo (máximo ' + HOTEL_NAME_MAX + ' caracteres).' };
  }
  if (!/^[A-Z0-9][A-Z0-9 .,&'\/()#-]*$/.test(n)) {
    return { ok: false, hotelName: '', hotelChannel: '', error: 'El nombre del hotel solo puede tener letras, números, espacios y los signos . , & \' / ( ) # -' };
  }
  if (!chKey) return { ok: false, hotelName: n, hotelChannel: '', error: 'Indique el canal de compra del hotel.' };
  let ch = '';
  for (const c of PURCHASE_CHANNELS) if (purchaseKey(c) === chKey) ch = c;
  if (!ch) return { ok: false, hotelName: n, hotelChannel: '', error: 'Canal de compra del hotel no válido. Opciones: Aviatur, Directo u Otra agencia.' };
  return { ok: true, hotelName: n, hotelChannel: ch };
}

/** Texto del hotel para mostrar: «HOTEL DANN · Directo con el hotel» o «No se reservó hotel». */
export function hotelPurchaseLabel(hotelName: string, hotelChannel: string): string {
  if (purchaseKey(hotelChannel) === purchaseKey(HOTEL_NOT_BOOKED)) return 'No se reservó hotel';
  return [hotelName, hotelChannel ? purchaseChannelLabel(hotelChannel, true) : ''].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------------
// Formulario (solo pantalla, sin gemelo en el backend)
// ---------------------------------------------------------------------------

/** Lo que se edita en el bloque «Hotel» de «Registrar reserva» (#A94). */
export interface HotelForm {
  name: string;
  channel: string;
  /** Casilla «No se reservó hotel» (no aplica a solo hospedaje). */
  notBooked: boolean;
}

/**
 * Precarga: lo ya guardado; si no hay, el hotel que pidió el viajero y, en solo
 * hospedaje, el canal previsto al confirmar costos (ese canal es el del hotel).
 */
export function hotelFormFrom(
  req: { purchaseHotelName?: string; purchaseHotelChannel?: string; hotelName?: string; purchaseChannel?: string },
  isHotelOnly: boolean
): HotelForm {
  const saved = req.purchaseHotelChannel || '';
  if (saved && purchaseKey(saved) === purchaseKey(HOTEL_NOT_BOOKED)) return { name: req.hotelName || '', channel: '', notBooked: true };
  return {
    name: req.purchaseHotelName || req.hotelName || '',
    channel: saved || (isHotelOnly ? req.purchaseChannel || '' : ''),
    notBooked: false,
  };
}

export function checkHotelForm(form: HotelForm, isHotelOnly: boolean): HotelPurchaseCheck {
  return normalizeHotelPurchase(form.name, !isHotelOnly && form.notBooked ? HOTEL_NOT_BOOKED : form.channel, isHotelOnly);
}

/** Lo que se edita en «Compra prevista» y en «Registrar reserva». */
export interface PurchaseForm {
  airline: string;
  channel: string;
  /** Casilla «El regreso es con otra aerolínea» (#A85). */
  splitReturn: boolean;
  returnAirline: string;
}

export function purchaseFormFrom(req: { purchaseAirline?: string; purchaseChannel?: string; purchaseReturnAirline?: string }): PurchaseForm {
  const back = req.purchaseReturnAirline || '';
  return { airline: req.purchaseAirline || '', channel: req.purchaseChannel || '', splitReturn: !!back, returnAirline: back };
}

/**
 * Valida el formulario. `canSplit`: el viaje tiene regreso y el servidor ya guarda
 * la aerolínea del regreso. Con la casilla marcada, la aerolínea del regreso es
 * obligatoria.
 */
export function checkPurchaseForm(form: PurchaseForm, isHotelOnly: boolean, canSplit: boolean): PurchaseInfoCheck {
  const split = !isHotelOnly && canSplit && form.splitReturn;
  const r = normalizePurchaseInfo(form.airline, form.channel, isHotelOnly, split ? form.returnAirline : '');
  if (r.ok && split && !form.returnAirline.trim()) {
    return { ...r, ok: false, error: 'Indique la aerolínea del regreso, o desmarque «El regreso es con otra aerolínea».' };
  }
  return r;
}
