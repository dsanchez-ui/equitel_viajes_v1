/**
 * Validación de la fecha de nacimiento de un pasajero.
 *
 * ⚠️ ESTE ARCHIVO TIENE UN GEMELO EN EL BACKEND.
 * La misma lógica vive en `server/Code.gs` (`_normalizeBirthdate_`,
 * `_ageOnDate_`, `_validateBirthdate_`). Si cambias las reglas o los mensajes
 * aquí, cámbialos allá: `tools/check-birthdate-rules.cjs` compara ambos lados
 * dentro de `npm run verify` y falla si se separan.
 *
 * Reglas (confirmadas por David, 2026-09-10): fecha de calendario válida, no
 * posterior a hoy, edad entre 15 y 100 años. Se guarda como 'AAAA-MM-DD'.
 * La exigen aerolíneas y agencias de viaje para emitir el tiquete.
 */

export const BIRTHDATE_MIN_AGE = 15;
export const BIRTHDATE_MAX_AGE = 100;

export interface BirthdateCheck {
  ok: boolean;
  /** 'AAAA-MM-DD' si es válida; lo digitado (o normalizado) si no. */
  value: string;
  /** Mensaje para el usuario cuando `ok` es false. */
  error?: string;
}

/**
 * Normaliza a 'AAAA-MM-DD'. Acepta 'AAAA-MM-DD' (lo que envía un
 * `<input type="date">`) y 'DD/MM/AAAA' con '/', '-' o '.'. Devuelve '' si no es
 * una fecha de calendario válida (p. ej. 31/04 o 29/02 de un año no bisiesto).
 */
export function normalizeBirthdate(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  if (!s) return '';
  let y: number, m: number, d: number;
  let mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mt) {
    y = Number(mt[1]); m = Number(mt[2]); d = Number(mt[3]);
  } else if ((mt = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/))) {
    d = Number(mt[1]); m = Number(mt[2]); y = Number(mt[3]);
  } else {
    return '';
  }
  if (y < 1900 || m < 1 || m > 12 || d < 1) return '';
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  if (d > daysInMonth) return '';
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
}

/** Edad cumplida en `todayIso` para alguien nacido en `birthIso` (ambas 'AAAA-MM-DD'). */
export function ageOnDate(birthIso: string, todayIso: string): number {
  const b = String(birthIso).split('-').map(Number);
  const t = String(todayIso).split('-').map(Number);
  let age = t[0] - b[0];
  if (t[1] < b[1] || (t[1] === b[1] && t[2] < b[2])) age--;
  return age;
}

/**
 * Valida contra las reglas de negocio. `todayIso` se inyecta ('AAAA-MM-DD')
 * para que la regla sea determinista y verificable.
 */
export function validateBirthdate(raw: string | null | undefined, todayIso: string): BirthdateCheck {
  const original = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!original) {
    return { ok: false, value: '', error: 'La fecha de nacimiento es obligatoria.' };
  }
  const iso = normalizeBirthdate(original);
  if (!iso) {
    return {
      ok: false,
      value: original,
      error: '"' + original + '" no es una fecha de nacimiento válida. Use el formato DD/MM/AAAA.',
    };
  }
  if (iso > todayIso) {
    return { ok: false, value: iso, error: 'La fecha de nacimiento no puede ser posterior a hoy.' };
  }
  const age = ageOnDate(iso, todayIso);
  if (age < BIRTHDATE_MIN_AGE || age > BIRTHDATE_MAX_AGE) {
    return {
      ok: false,
      value: iso,
      error: 'La fecha de nacimiento da una edad de ' + age + ' años; debe estar entre ' +
        BIRTHDATE_MIN_AGE + ' y ' + BIRTHDATE_MAX_AGE + '. Revise el año.',
    };
  }
  return { ok: true, value: iso };
}

/** Hoy en la zona del navegador como 'AAAA-MM-DD'. */
export function todayIsoLocal(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
