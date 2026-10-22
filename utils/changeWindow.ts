// Plazo para pedir un cambio de viaje (#A103, «Cambiar mi viaje») y si el tiquete ya está comprado (#A109).
// ⚠️ GEMELO de `_changeDeadline_`, `_tripChangeWindow_` y `_tripChangeIsBought_` en server/Code.gs:
// tools/check-trip-change.cjs compara los dos lados dentro de `npm run verify`.
//
// Regla (David, 15-oct; aprobada por Yurani, 19-oct): se puede pedir el cambio hasta
// las 5:00 p. m. del día hábil anterior al vuelo; si ese día es sábado, hasta las
// 12:00 m. Domingos y festivos de Colombia no cuentan. Antes del límite se puede
// pedir a cualquier hora. Con el viaje en curso (la ida ya voló) solo se cambia el
// regreso. El área de compras registra cambios a nombre del viajero sin plazo.
// Todas las cuentas van en hora de Bogotá (UTC−5, sin horario de verano).

const DAY_MS = 86400000;
const BOGOTA_OFFSET_MS = 5 * 3600000;

/** Días desde 1970-01-01 de 'AAAA-MM-DD'. */
export const dayNumber = (key: string): number => {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};

export const keyFromDayNumber = (n: number): string => {
  const d = new Date(n * DAY_MS);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
};

const holidayCache: Record<number, Record<number, true>> = {};

/** Festivos de Colombia de un año (Ley 51 de 1983), como números de día. Igual que `_psHolidaysCO_`. */
export const holidaysCO = (year: number): Record<number, true> => {
  if (holidayCache[year]) return holidayCache[year];
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easterMonth = Math.floor((h + l - 7 * m + 114) / 31), easterDay = ((h + l - 7 * m + 114) % 31) + 1;
  const day = (month: number, dd: number) => Math.round(Date.UTC(year, month - 1, dd) / DAY_MS);
  const monday = (n: number) => { const w = new Date(n * DAY_MS).getUTCDay(); return w === 1 ? n : n + ((8 - w) % 7); };
  const easter = day(easterMonth, easterDay);
  const list = [
    day(1, 1), day(5, 1), day(7, 20), day(8, 7), day(12, 8), day(12, 25),
    monday(day(1, 6)), monday(day(3, 19)), monday(day(6, 29)), monday(day(8, 15)),
    monday(day(10, 12)), monday(day(11, 1)), monday(day(11, 11)),
    easter - 3, easter - 2,
    monday(easter + 39), monday(easter + 60), monday(easter + 68)
  ];
  const set: Record<number, true> = {};
  list.forEach(n => { set[n] = true; });
  holidayCache[year] = set;
  return set;
};

export interface ChangeDeadline {
  /** Día del límite, 'AAAA-MM-DD'. */
  dayKey: string;
  /** 17 (5:00 p. m.) o 12 (sábado, 12:00 m.). */
  hour: number;
  /** Instante del límite (ms). */
  ms: number;
}

/** 17:00 del día hábil anterior a la fecha ('AAAA-MM-DD'); si es sábado, 12:00. null si la fecha no es válida. */
export const changeDeadline = (flightKey: string): ChangeDeadline | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(flightKey || ''))) return null;
  let n = dayNumber(flightKey) - 1;
  for (let guard = 0; guard < 20; guard++) {
    const d = new Date(n * DAY_MS);
    if (d.getUTCDay() !== 0 && !holidaysCO(d.getUTCFullYear())[n]) break;
    n--;
  }
  const hour = new Date(n * DAY_MS).getUTCDay() === 6 ? 12 : 17;
  return { dayKey: keyFromDayNumber(n), hour, ms: n * DAY_MS + (hour + 5) * 3600000 };
};

/** 'AAAA-MM-DD' en Bogotá de un instante. */
export const bogotaKeyFromMs = (ms: number): string => keyFromDayNumber(Math.floor((ms - BOGOTA_OFFSET_MS) / DAY_MS));

export type ChangeMode = 'full' | 'return';

export interface ChangeWindow {
  open: boolean;
  /** 'full' = ida y regreso; 'return' = solo el regreso (la ida ya voló); null = el viaje terminó o es hoy. */
  mode: ChangeMode | null;
  /** Fecha del vuelo que define el plazo. */
  target: string;
  /** '' (abierto), 'deadline' (venció el plazo) o 'ended' (el viaje terminó). */
  reason: '' | 'deadline' | 'ended';
  deadlineKey: string;
  deadlineHour: number;
  deadlineMs: number;
}

/** Qué se puede cambiar de un viaje en este momento. `ignoreDeadline` = administrador, sin plazo. */
export const tripChangeWindow = (depKey: string, retKey: string, nowMs: number, ignoreDeadline = false): ChangeWindow => {
  const today = bogotaKeyFromMs(nowMs);
  const dep = String(depKey || ''), ret = String(retKey || '');
  let mode: ChangeMode | null = null;
  if (dep && (ignoreDeadline ? dep >= today : dep > today)) mode = 'full';
  else if (dep && ret && (ignoreDeadline ? ret >= today : ret > today)) mode = 'return';
  if (!mode) {
    const sameDay = dep === today || ret === today;
    const dlToday = sameDay ? changeDeadline(today) : null;
    return {
      open: false, mode: null, target: sameDay ? today : '', reason: sameDay ? 'deadline' : 'ended',
      deadlineKey: dlToday ? dlToday.dayKey : '', deadlineHour: dlToday ? dlToday.hour : 0, deadlineMs: dlToday ? dlToday.ms : 0
    };
  }
  const target = mode === 'full' ? dep : ret;
  const dl = changeDeadline(target)!;
  const open = ignoreDeadline || nowMs < dl.ms;
  return { open, mode, target, reason: open ? '' : 'deadline', deadlineKey: dl.dayKey, deadlineHour: dl.hour, deadlineMs: dl.ms };
};

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** 'miércoles 21 de octubre' desde 'AAAA-MM-DD'. */
export const fmtDayLong = (key: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return String(key || '');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return DAYS[d.getUTCDay()] + ' ' + (+m[3]) + ' de ' + MONTHS[+m[2] - 1];
};

export const fmtHourLabel = (hour: number): string => (hour === 12 ? '12:00 m.' : '5:00 p. m.');

/** 'hoy hasta las 5:00 p. m.' / 'mañana viernes 16 de octubre hasta las 5:00 p. m.' / 'hasta el miércoles 21 de octubre, 5:00 p. m.' */
export const untilText = (w: Pick<ChangeWindow, 'deadlineKey' | 'deadlineHour'>, nowMs: number): string => {
  const today = bogotaKeyFromMs(nowMs);
  const tomorrow = keyFromDayNumber(dayNumber(today) + 1);
  if (w.deadlineKey === today) return 'hoy hasta las ' + fmtHourLabel(w.deadlineHour);
  if (w.deadlineKey === tomorrow) return 'mañana ' + fmtDayLong(w.deadlineKey) + ' hasta las ' + fmtHourLabel(w.deadlineHour);
  return 'hasta el ' + fmtDayLong(w.deadlineKey) + ', ' + fmtHourLabel(w.deadlineHour);
};

/** Lo que miran las reglas de «comprado»: el estado y los archivos de la reserva. */
interface BoughtCheck { status?: string; supportData?: { files?: { isReservation?: boolean }[] } | null }

/**
 * ¿Tiene la reserva guardada por partes (#A109)? «Guardar sin enviar» deja la solicitud en APROBADO
 * con el PNR y los archivos de la reserva: lo que se compró ya se pagó. Igual que `_tripChangeHasSavedReservation_`.
 */
export const hasSavedReservation = (r: BoughtCheck | null | undefined): boolean =>
  !!r && String(r.status || '').trim() === 'APROBADO' && (r.supportData?.files || []).some((f) => !!f && !!f.isReservation);

/** ¿El tiquete ya está comprado? RESERVADO, o APROBADO con la reserva guardada por partes (#A109). Igual que `_tripChangeIsBought_`. */
export const isTripBought = (r: BoughtCheck | null | undefined): boolean =>
  !!r && (String(r.status || '').trim() === 'RESERVADO' || hasSavedReservation(r));

/** Fecha de una solicitud ('AAAA-MM-DD', 'DD-MM-AAAA' o 'DD/MM/AAAA') a 'AAAA-MM-DD'; '' si no se reconoce. */
export const toDateKey = (v: string | undefined | null): string => {
  const s = String(v || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
};
