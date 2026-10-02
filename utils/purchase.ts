/**
 * Aerolínea y canal de compra del tiquete (#A82).
 *
 * ⚠️ ESTE ARCHIVO TIENE UN GEMELO EN EL BACKEND.
 * La misma lógica vive en `server/Code.gs` (`_normalizePurchaseInfo_`,
 * `PURCHASE_CHANNELS`, `PURCHASE_AIRLINES`). Si cambias las reglas o los mensajes
 * aquí, cámbialos allá: `tools/check-purchase-info-rules.cjs` compara ambos lados
 * dentro de `npm run verify` y falla si se separan.
 *
 * El área de viajes registra con qué aerolínea y por qué canal se compra:
 * Aviatur, directo (con la aerolínea o el hotel) u otra agencia. Solo hospedaje
 * no lleva aerolínea.
 */

export const PURCHASE_CHANNELS = ['Aviatur', 'Directo', 'Otra agencia'];
export const PURCHASE_AIRLINES = ['Avianca', 'LATAM', 'Wingo', 'JetSMART', 'Satena', 'Clic', 'Copa Airlines', 'American Airlines',
  'United Airlines', 'Delta', 'Iberia', 'Aeroméxico', 'Arajet', 'Air Europa', 'Varias aerolíneas'];
export const PURCHASE_AIRLINE_MAX = 40;

export interface PurchaseInfoCheck {
  ok: boolean;
  airline: string;
  channel: string;
  /** Mensaje para el usuario cuando `ok` es false. */
  error?: string;
}

/** Clave de comparación: sin tildes, minúsculas y espacios simples. */
export function purchaseKey(s: unknown): string {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

export function normalizePurchaseInfo(airline: unknown, channel: unknown, isHotelOnly: boolean): PurchaseInfoCheck {
  const chKey = purchaseKey(channel);
  if (!chKey) return { ok: false, airline: '', channel: '', error: 'Indique el canal de compra.' };
  let ch = '';
  for (const c of PURCHASE_CHANNELS) if (purchaseKey(c) === chKey) ch = c;
  if (!ch) return { ok: false, airline: '', channel: '', error: 'Canal de compra no válido. Opciones: Aviatur, Directo u Otra agencia.' };
  if (isHotelOnly) return { ok: true, airline: '', channel: ch };
  let a = String(airline == null ? '' : airline).replace(/\s+/g, ' ').trim();
  if (!a) return { ok: false, airline: '', channel: ch, error: 'Indique la aerolínea.' };
  if (a.length > PURCHASE_AIRLINE_MAX) {
    return { ok: false, airline: '', channel: ch, error: 'El nombre de la aerolínea es demasiado largo (máximo ' + PURCHASE_AIRLINE_MAX + ' caracteres).' };
  }
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9 .&'\/-]*$/.test(a)) {
    return { ok: false, airline: '', channel: ch, error: 'La aerolínea solo puede tener letras, números, espacios y los signos . & \' / -' };
  }
  const key = purchaseKey(a);
  for (const known of PURCHASE_AIRLINES) {
    if (purchaseKey(known) === key) { a = known; break; }
  }
  return { ok: true, airline: a, channel: ch };
}

/** Texto del canal para mostrar (el valor guardado es 'Directo'). */
export function purchaseChannelLabel(channel: string, isHotelOnly: boolean): string {
  if (channel === 'Directo') return isHotelOnly ? 'Directo con el hotel' : 'Directo con la aerolínea';
  return channel;
}
