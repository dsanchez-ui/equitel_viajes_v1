/**
 * Celular de contacto de un pasajero (#A74, #A75).
 *
 * ⚠️ ESTE ARCHIVO TIENE UN GEMELO EN EL BACKEND.
 * La misma lógica vive en `server/Code.gs` (`_normalizePhone_`,
 * `_validateOptionalPhone_`). Si cambias las reglas o los mensajes aquí,
 * cámbialos allá: `tools/check-phone-rules.cjs` compara ambos lados dentro de
 * `npm run verify` y falla si se separan.
 *
 * Reglas (David, 2026-09-10): el celular es OPCIONAL; si se escribe, debe ser un
 * celular colombiano de 10 dígitos que empiece por 3. Se guarda sin espacios
 * ('3001234567'). Lo usa el área de viajes para contactar al pasajero.
 */

export interface PhoneCheck {
  ok: boolean;
  /** '3001234567' si es válido, '' si se dejó vacío; lo digitado si no es válido. */
  value: string;
  /** Mensaje para el usuario cuando `ok` es false. */
  error?: string;
}

/**
 * Celular a 10 dígitos, o '' si no lo es. Tolera espacios, guiones, '+57' / '57'
 * al inicio y el número tal como lo devuelve Sheets (3001234567 o '3001234567.0').
 */
export function normalizePhone(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  let s: string;
  if (typeof raw === 'number') {
    if (!isFinite(raw) || raw !== Math.floor(raw)) return '';
    s = raw.toFixed(0);
  } else {
    s = String(raw).trim().replace(/^(\d+)\.0+$/, '$1');
  }
  let d = s.replace(/\D+/g, '');
  if (d.length === 12 && d.indexOf('57') === 0) d = d.substring(2);
  return /^3\d{9}$/.test(d) ? d : '';
}

/** Vacío es válido (el campo es opcional). Con valor, debe ser un celular. */
export function validateOptionalPhone(raw: string | number | null | undefined): PhoneCheck {
  const original = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!original) return { ok: true, value: '' };
  const phone = normalizePhone(typeof raw === 'number' ? raw : original);
  if (!phone) {
    return {
      ok: false,
      value: original,
      error: '"' + original + '" no es un celular válido. Escriba los 10 dígitos, por ejemplo 300 123 4567.',
    };
  }
  return { ok: true, value: phone };
}

/** '3001234567' → '300 123 4567' (solo para mostrar). */
export function formatPhone(phone: string): string {
  return `${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6)}`;
}
