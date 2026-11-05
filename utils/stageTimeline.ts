// Línea de tiempo de una solicitud (#A121; Yurani y David, 5-nov-2026): cuándo pasó por cada
// etapa, cuánto tomó en horas reales (de calendario: incluye noches y fines de semana, no
// horas laborales) y a quién le tocaba, para saber quién se demoró. Los datos los arma el
// servidor (`_stageInfo_` en server/Code.gs); aquí solo se ordenan y se cuentan.
// tools/check-stage-timeline.cjs la prueba dentro de `npm run verify`.

import { StageApproval, StageInfo } from '../types';

export type StepState = 'hecho' | 'actual' | 'pendiente' | 'cerrado' | 'omitido';
export type Responsible = 'Solicitante' | 'Área de compras' | 'Aprobadores' | 'CFO';

export interface TimelineApproval extends StageApproval {
  /** Minutos reales desde que se le pidió el voto hasta que votó (o hasta ahora, si falta). */
  minutes: number | null;
}

export interface TimelineStep {
  key: string;
  /** Lo que se logra en este paso («Opciones cargadas»). */
  label: string;
  /** Lo que está pasando mientras es la etapa actual. */
  doing: string;
  responsible: Responsible;
  /** Quién actuó o a quién le toca ('' = el área o el rol). */
  who: string;
  state: StepState;
  /** Cuándo se llegó a este paso (ISO); '' si no pasó o no quedó la hora. */
  at: string;
  /** Lo que tomó esta etapa, en minutos reales desde el paso anterior (o hasta ahora, si es la actual). */
  minutes: number | null;
  /** Desde cuándo corre (ISO): el paso anterior. */
  since: string;
  note: string;
  approvals?: TimelineApproval[];
}

export interface Timeline {
  steps: TimelineStep[];
  /** La etapa en curso; null si terminó, se denegó o se anuló. */
  current: TimelineStep | null;
  end: StageInfo['end'];
  /** Reservada o cerrada: el proceso terminó. */
  done: boolean;
  /** De la solicitud a la compra (o a hoy, o a la denegación o anulación). */
  totalMinutes: number | null;
  /** Cuánto tuvo la solicitud cada responsable, de mayor a menor. */
  byResponsible: { responsible: Responsible; minutes: number }[];
  /** La etapa que más tardó ('' si no hay tiempos). */
  longestKey: string;
  /** Cuándo se cerró (PROCESADO) y quién; '' si no quedó (#A123). */
  closed: string;
  closedBy: string;
}

/** Desde este día se guarda cuándo se acepta un cambio (#A121). */
export const CHANGE_STUDIED_SINCE = '2026-11-05';

/** Estado → la etapa que está en curso. */
const CURRENT_STEP: Record<string, string> = {
  PENDIENTE_APROBACION_POLITICA: 'politica',
  PENDIENTE_ANALISIS_CAMBIO: 'cambio',
  PENDIENTE_OPCIONES: 'opciones',
  PENDIENTE_SELECCION: 'seleccion',
  PENDIENTE_CONFIRMACION_COSTO: 'costos',
  PENDIENTE_APROBACION: 'aprobacion',
  APROBADO: 'compra'
};
const DONE_STATUSES = ['RESERVADO', 'PROCESADO'];

/** Minutos reales entre dos instantes ISO; null si falta alguno; 0 si el segundo es anterior. */
export const minutesBetween = (fromIso: string, toIso: string): number | null => {
  if (!fromIso || !toIso) return null;
  const a = Date.parse(fromIso), b = Date.parse(toIso);
  if (isNaN(a) || isNaN(b)) return null;
  return b <= a ? 0 : Math.round((b - a) / 60000);
};

/** '45 min', '3 h 20 min', '14 h', '1 d 6 h', '2 d'. */
export const fmtDuration = (m: number | null | undefined): string => {
  if (m === null || m === undefined || isNaN(m)) return '—';
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60), mins = m % 60;
  if (hours < 24) return mins ? `${hours} h ${mins} min` : `${hours} h`;
  const days = Math.floor(hours / 24), rest = hours % 24;
  return rest ? `${days} d ${rest} h` : `${days} d`;
};

/** Fecha y hora de Colombia (UTC−5, sin horario de verano), día/mes/año y 24 h (#A105, #A112). */
export const fmtStamp = (iso: string): { day: string; time: string; short: string } | null => {
  const t = Date.parse(iso || '');
  if (!iso || isNaN(t)) return null;
  const d = new Date(t - 5 * 3600000);
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  const time = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  return { day, time, short: `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${time}` };
};

export const fmtStampText = (iso: string): string => {
  const s = fmtStamp(iso);
  return s ? `${s.day} ${s.time}` : '';
};

/** Arma los pasos de la solicitud con su estado, sus horas y quién la tenía. */
export const buildTimeline = (s: StageInfo, status: string, nowMs: number): Timeline => {
  const hotel = !!s.hotelOnly;
  const nowIso = new Date(nowMs).toISOString();
  const steps: TimelineStep[] = [];
  const push = (key: string, label: string, doing: string, responsible: Responsible, who: string, at: string, note = '') =>
    steps.push({ key, label, doing, responsible, who: who || '', state: 'pendiente', at: at || '', minutes: null, since: '', note });

  const asked = (s.approvals || []).filter((a) => a.state !== 'not_needed');
  const approverNames = Array.from(new Set(asked.map((a) => a.who).filter(Boolean))).join(', ');

  push('creada', 'Solicitud creada', '', 'Solicitante', s.requester, s.created);
  if (s.policy) {
    push('politica', s.policy.decision === 'approved' ? 'Excepción aprobada' : 'Excepción a la política',
      'Espera que aprueben la excepción a la política de anticipación', 'CFO', s.policy.who,
      s.policy.decision === 'approved' ? s.policy.at : '');
  }
  if (s.isChange) push('cambio', 'Cambio aceptado', 'El área de compras revisa el cambio', 'Área de compras', s.changeStudiedBy || '', s.changeStudied);
  push('opciones', 'Opciones cargadas', hotel ? 'El área de compras busca y carga las opciones de hospedaje' : 'El área de compras busca y carga las opciones',
    'Área de compras', s.optionsBy || '', s.options);
  push('seleccion', 'Opción elegida', 'El solicitante elige una de las opciones', 'Solicitante', s.requester, s.selection,
    s.selectionSkippedBy ? `Etapa saltada por ${s.selectionSkippedBy}`
      : s.selectionTrace ? 'Solo trazabilidad: se compró por fuera'
      : s.selectionBy ? `La registró ${s.selectionBy}` : '');
  push('costos', 'Costos confirmados', 'El área de compras confirma los costos', 'Área de compras', s.costsBy, s.costs);
  push('aprobacion', 'Aprobada', 'Los aprobadores revisan la solicitud', 'Aprobadores', approverNames, s.approved,
    s.approvalSkippedBy ? `Etapa saltada por ${s.approvalSkippedBy}` : '');
  push('compra', hotel ? 'Hospedaje reservado' : 'Tiquetes comprados', hotel ? 'El área de compras reserva el hospedaje' : 'El área de compras compra los tiquetes',
    'Área de compras', s.purchaseBy || '', s.purchase);

  const idx = (k: string) => steps.findIndex((x) => x.key === k);
  const lastReached = () => { let i = 0; steps.forEach((x, n) => { if (x.at) i = n; }); return i; };
  const done = DONE_STATUSES.includes(String(status || '').trim());

  if (done) {
    steps.forEach((x) => { x.state = 'hecho'; });
  } else if (s.end) {
    let stop = s.end.step ? idx(s.end.step) : -1;
    if (stop < 1) stop = Math.min(lastReached() + 1, steps.length - 1);
    steps.forEach((x, i) => { x.state = i < stop ? 'hecho' : i === stop ? 'cerrado' : 'omitido'; });
    steps[stop].at = s.end.at || '';
  } else {
    let cur = idx(CURRENT_STEP[String(status || '').trim()] || '');
    if (cur < 1) cur = Math.min(lastReached() + 1, steps.length - 1);
    steps.forEach((x, i) => { x.state = i < cur ? 'hecho' : i === cur ? 'actual' : 'pendiente'; });
  }

  // Lo que no quedó guardado, dicho en palabras (#A123).
  const change = steps[idx('cambio')];
  if (change && change.state === 'hecho' && !change.at && String(s.created || '').slice(0, 10) < CHANGE_STUDIED_SINCE) {
    change.note = 'Antes del 5-nov no se guardaba esta hora';
  }
  const buy = steps[idx('compra')];
  const draft = s.draftSaved ? fmtStamp(s.draftSaved) : null;
  if (buy && draft && buy.state !== 'hecho') {
    buy.note = `Reserva guardada por partes el ${draft.short}${s.draftBy ? ` (${s.draftBy})` : ''}`;
  }

  // Lo que tomó cada etapa: desde el paso anterior (las etapas van una tras otra).
  for (let i = 1; i < steps.length; i++) {
    const x = steps[i];
    let prev = steps[i - 1].at;
    // Cambios de antes del 5-nov: no quedó cuándo se aceptó; la cotización se mide desde la
    // solicitud, como en Métricas.
    if (!prev && steps[i - 1].key === 'cambio' && steps[i - 1].state === 'hecho') {
      prev = steps[i - 2].at;
      if (x.state !== 'pendiente') x.note = x.note || 'Incluye la revisión del cambio';
    }
    if (x.state === 'hecho') x.minutes = minutesBetween(prev, x.at);
    else if (x.state === 'actual') { x.since = prev; x.minutes = minutesBetween(prev, nowIso); }
    else if (x.state === 'cerrado') { x.since = prev; x.minutes = minutesBetween(prev, x.at); }
  }

  // Cada voto: desde que se le pidió.
  const approval = steps[idx('aprobacion')];
  if (approval && approval.state !== 'pendiente' && approval.state !== 'omitido' && asked.length) {
    approval.approvals = asked.map((a) => ({
      ...a,
      minutes: a.state === 'approved' || a.state === 'denied' ? minutesBetween(s.approvalAskedAt, a.at)
        : a.state === 'pending' ? minutesBetween(s.approvalAskedAt, nowIso) : null
    }));
  }

  const totals: Record<string, number> = {};
  let longestKey = '', longest = -1;
  steps.forEach((x) => {
    if (x.minutes === null || x.state === 'pendiente' || x.state === 'omitido') return;
    totals[x.responsible] = (totals[x.responsible] || 0) + x.minutes;
    if (x.minutes > longest) { longest = x.minutes; longestKey = x.key; }
  });
  const byResponsible = (Object.keys(totals) as Responsible[])
    .map((responsible) => ({ responsible, minutes: totals[responsible] }))
    .sort((a, b) => b.minutes - a.minutes);

  const endAt = done ? s.purchase : s.end ? s.end.at : nowIso;
  return {
    steps,
    current: steps.find((x) => x.state === 'actual') || null,
    end: s.end,
    done,
    totalMinutes: minutesBetween(s.created, endAt),
    byResponsible,
    longestKey: longest > 0 ? longestKey : '',
    closed: s.closed || '',
    closedBy: s.closedBy || ''
  };
};
