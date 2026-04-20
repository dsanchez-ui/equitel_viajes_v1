export const parseDate = (dateStr: string | undefined): Date => {
  if (!dateStr) return new Date();
  
  // if YYYY-MM-DD
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
    // Add T00:00:00 to avoid timezone issues parsing as UTC
    return new Date(dateStr.split('T')[0] + 'T00:00:00');
  }
  
  // if DD-MM-YYYY
  if (dateStr.match(/^\d{2}-\d{2}-\d{4}/)) {
    const parts = dateStr.split(' ')[0].split('-');
    return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  }

  // if dd/mm/yyyy
  if (dateStr.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)) {
    const parts = dateStr.split(' ')[0].split('/');
    return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  }
  
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
};

export const formatToDDMMYYYY = (dateStr: string | undefined): string => {
  if (!dateStr) return '';
  if (dateStr.match(/^\d{2}-\d{2}-\d{4}$/)) return dateStr;
  
  const date = parseDate(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}-${m}-${y}`;
};

export const formatToYYYYMMDD = (dateStr: string | undefined): string => {
  if (!dateStr) return '';
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return dateStr;
  
  const date = parseDate(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${y}-${m}-${d}`;
};

const MONTHS_ABBR_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Parser tolerante para el valor de FECHA SOLICITUD.
 * Acepta:
 *  - ISO ("2026-04-20T09:30:00Z" o "2026-04-20T09:30:00-05:00")
 *  - JS Date.toString() ("Mon Apr 20 2026 09:30:00 GMT-0500 ...")
 *  - Sheets español: "DD/MM/YYYY HH:MM[:SS]" o "D/M/YYYY H:MM"
 *  - Sheets guión: "DD-MM-YYYY HH:MM[:SS]"
 *  - YYYY-MM-DD simple
 */
const parseTimestamp = (val: string): Date | null => {
  if (!val) return null;
  const s = val.trim();

  // DD/MM/YYYY [HH:MM[:SS]] o DD-MM-YYYY [HH:MM[:SS]] (con día/mes/hora opcionalmente sin padding)
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const y = Number(m[3]);
    const hh = m[4] !== undefined ? Number(m[4]) : 0;
    const mm = m[5] !== undefined ? Number(m[5]) : 0;
    const ss = m[6] !== undefined ? Number(m[6]) : 0;
    const parsed = new Date(y, mo, d, hh, mm, ss);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  // Fallback: ISO, JS default toString, o cualquier cosa que Date reconozca nativamente
  const native = new Date(s);
  return isNaN(native.getTime()) ? null : native;
};

/**
 * Formato corto "20/abr 09:30" para listados densos (admin/user dashboard).
 * Timezone: usa el local del navegador (Bogotá para el uso real).
 * Si no parsea, retorna '' silencioso.
 */
export const formatShortDateTime = (raw: string | undefined | null): string => {
  if (!raw) return '';
  const d = parseTimestamp(String(raw));
  if (!d) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTHS_ABBR_ES[d.getMonth()];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month} ${hh}:${mm}`;
};

/**
 * Formato largo "20 abr 2026, 09:30" para encabezado de detalle.
 */
export const formatLongDateTime = (raw: string | undefined | null): string => {
  if (!raw) return '';
  const d = parseTimestamp(String(raw));
  if (!d) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTHS_ABBR_ES[d.getMonth()];
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hh}:${mm}`;
};

export const getDaysDiff = (start: string | Date, end: string | Date): number => {
  const d1 = typeof start === 'string' ? parseDate(start) : start;
  const d2 = typeof end === 'string' ? parseDate(end) : end;
  
  // Clone dates to avoid mutating the originals
  const date1 = new Date(d1.getTime());
  const date2 = new Date(d2.getTime());
  
  date1.setHours(0,0,0,0);
  date2.setHours(0,0,0,0);
  
  return Math.ceil((date2.getTime() - date1.getTime()) / (1000 * 3600 * 24));
};
