/**
 * Costos en pesos colombianos que confirma el área de viajes (#A79).
 *
 * ⚠️ ESTE ARCHIVO TIENE UN GEMELO EN EL BACKEND.
 * La misma lógica vive en `server/Code.gs` (`_formatCop_`, `_parseCopAmount_`,
 * `_validateCostAmount_`). Si cambias las reglas o los mensajes aquí, cámbialos
 * allá: `tools/check-cost-rules.cjs` compara ambos lados dentro de
 * `npm run verify` y falla si se separan.
 *
 * Por qué existe: el campo era numérico y "889.518" (con punto de miles) se
 * guardaba como 889,518 pesos. Reglas (David, 2026-09-14): el costo se escribe en
 * pesos, con o sin puntos de miles; los centavos se redondean; 0 es válido (por
 * ejemplo, un apartamento corporativo) y cualquier otro valor debe ser de al menos
 * $10.000: ningún viaje cuesta menos.
 */

export const COST_MIN_PESOS = 10000;

export interface CostParse {
  empty: boolean;
  /** Pesos enteros; null si lo escrito no es un valor en pesos. */
  value: number | null;
  /** Llegó un número con decimales (formulario anterior o API). */
  decimals?: boolean;
}

export interface CostCheck {
  ok: boolean;
  value: number | null;
  /** Mensaje para el usuario cuando `ok` es false. */
  error?: string;
}

/** 889518 → '889.518'. */
export function formatCop(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Lo escrito (o un número) a pesos enteros. Acepta 889518, 889.518, 889,518,
 * "$ 1.234.567,50" (los centavos se redondean). Un número con decimales no se
 * interpreta: es justo el error que se quiere evitar.
 */
export function parseCopAmount(raw: string | number | null | undefined): CostParse {
  if (raw === null || raw === undefined) return { empty: true, value: null };
  if (typeof raw === 'number') {
    if (!isFinite(raw) || raw < 0) return { empty: false, value: null };
    if (raw !== Math.floor(raw)) return { empty: false, value: null, decimals: true };
    return { empty: false, value: raw };
  }
  const s = String(raw).replace(/[\s$]/g, '');
  if (!s) return { empty: true, value: null };
  if (!/^[\d.,]+$/.test(s)) return { empty: false, value: null };
  const m = s.match(/^(.*\d)[.,](\d{1,2})$/);
  const intPart = m ? m[1] : s;
  const cents = m ? m[2] : '';
  if (!/^\d+$/.test(intPart) && !/^\d{1,3}(\.\d{3})+$/.test(intPart) && !/^\d{1,3}(,\d{3})+$/.test(intPart)) {
    return { empty: false, value: null };
  }
  const whole = Number(intPart.replace(/[.,]/g, ''));
  const value = cents ? Math.round(whole + Number(cents) / Math.pow(10, cents.length)) : whole;
  return { empty: false, value: value };
}

/**
 * `label` completa la frase "El costo …": 'de los tiquetes', 'del hotel', 'total'.
 * Vacío es error solo si el campo es obligatorio; 0 escrito siempre es válido.
 */
export function validateCostAmount(raw: string | number | null | undefined, label: string, required: boolean): CostCheck {
  const original = raw === null || raw === undefined ? '' : String(raw).trim();
  const p = parseCopAmount(raw);
  if (p.empty) {
    return required
      ? { ok: false, value: null, error: 'El costo ' + label + ' es obligatorio. Si no tiene costo (por ejemplo, un apartamento corporativo), escriba 0.' }
      : { ok: true, value: 0 };
  }
  if (p.decimals) {
    return { ok: false, value: null, error: 'El costo ' + label + ' llegó con decimales (' + original + '). Escriba el valor completo en pesos, por ejemplo 889.518; si vuelve a pasar, recargue la página.' };
  }
  if (p.value === null) {
    return { ok: false, value: null, error: 'El costo ' + label + ' ("' + original + '") no es un valor en pesos. Escríbalo sin centavos, por ejemplo 889.518 o 889518.' };
  }
  if (p.value > 0 && p.value < COST_MIN_PESOS) {
    return { ok: false, value: p.value, error: 'El costo ' + label + ' ($' + formatCop(p.value) + ') no es un valor real: revise que esté completo (mínimo $' + formatCop(COST_MIN_PESOS) + ') o escriba 0 si no tiene costo.' };
  }
  return { ok: true, value: p.value };
}
