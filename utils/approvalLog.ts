import { RequestMetrics, StageInfo } from '../types';

/**
 * #A125 (Yurani y David, 6-nov-2026): cada solicitud que pasó por aprobación, con el resultado,
 * quién aprobó, quién denegó y el motivo. Sale de la misma línea de tiempo de Métricas (#A121):
 * no hay otra regla de «quién votó». Pedido: «ver lo que Alejandro niega», solicitud por solicitud.
 */
export type ApprovalResult = 'aprobada' | 'denegada' | 'esperando' | 'tramite' | 'anulada';

export interface ApprovalDecision {
  kind: 'approved' | 'denied' | 'skipped' | 'expired';
  /** Nombre de quien decidió ('' si nadie: venció sin respuesta). */
  who: string;
  /** Qué decidió: «Aprobador de Área», «Excepción a la política de anticipación», «Cambio no aceptado»… */
  what: string;
  at: string;
  comment?: string;
}

export interface ApprovalLogRow {
  id: string;
  requester: string;
  destination: string;
  status: string;
  created: string;
  result: ApprovalResult;
  approved: ApprovalDecision[];
  denied: ApprovalDecision[];
  /** A quién le falta votar: «NOMBRE · Gerencia General». */
  waiting: string[];
  /** Anulada: quién la anuló. */
  cancelledBy: string;
  /** El motivo de la denegación o la anulación ('' si no se escribió). */
  reason: string;
  /** Cuándo se decidió (o se anuló); '' si sigue en trámite. */
  decidedAt: string;
  stages: StageInfo;
  metrics: RequestMetrics;
}

export const RESULT_LABEL: Record<ApprovalResult, string> = {
  aprobada: 'Aprobada',
  denegada: 'Denegada',
  esperando: 'Esperando votos',
  tramite: 'En trámite',
  anulada: 'Anulada'
};

const POLICY_WHAT = 'Excepción a la política de anticipación';
const APPROVED_STATUSES = ['APROBADO', 'RESERVADO', 'PROCESADO'];

const latest = (list: ApprovalDecision[]) => list.map((d) => d.at).filter(Boolean).sort().pop() || '';

/** Una fila por solicitud con alguna decisión de aprobación (o votos pendientes); null si no pasó por aprobación. */
export const approvalLogRow = (m: RequestMetrics): ApprovalLogRow | null => {
  const s = m.stages;
  if (!s) return null;
  const approved: ApprovalDecision[] = [];
  const denied: ApprovalDecision[] = [];
  const waiting: string[] = [];

  if (s.policy) {
    const p = s.policy;
    if (p.decision === 'approved') approved.push({ kind: 'approved', who: p.who, what: POLICY_WHAT, at: p.at, comment: p.comment });
    else if (p.decision === 'denied') denied.push({ kind: 'denied', who: p.who, what: POLICY_WHAT, at: p.at });
    else if (p.decision === 'expired') denied.push({ kind: 'expired', who: '', what: POLICY_WHAT, at: p.at });
  }
  const skippedBy = new Set<string>();
  (s.approvals || []).forEach((a) => {
    if (a.state === 'approved') approved.push({ kind: 'approved', who: a.who, what: a.label, at: a.at, comment: a.comment });
    else if (a.state === 'denied') denied.push({ kind: 'denied', who: a.who, what: a.label, at: a.at });
    else if (a.state === 'expired') denied.push({ kind: 'expired', who: '', what: a.label, at: a.at });
    else if (a.state === 'skipped' && !skippedBy.has(a.who)) {
      skippedBy.add(a.who);
      approved.push({ kind: 'skipped', who: a.who, what: 'Saltó la etapa de aprobación', at: a.at || s.approved });
    } else if (a.state === 'pending') waiting.push(a.who ? `${a.who} · ${a.label}` : a.label);
  });

  const status = String(m.status || '').trim();
  const end = s.end;
  if (end && end.kind === 'DENEGADO' && !denied.length) {
    // Cambio que el área de compras no aceptó, o una denegación sin voto registrado.
    denied.push({ kind: 'denied', who: end.who, what: end.step === 'cambio' ? 'Cambio no aceptado' : 'Denegada', at: end.at });
  }
  if (!approved.length && !denied.length && !waiting.length) return null;

  const result: ApprovalResult = status === 'DENEGADO' ? 'denegada'
    : status === 'ANULADO' ? 'anulada'
    : APPROVED_STATUSES.includes(status) ? 'aprobada'
    : status === 'PENDIENTE_APROBACION' && waiting.length ? 'esperando'
    : 'tramite';

  return {
    id: m.requestId,
    requester: s.requester || m.requesterEmail,
    destination: m.destination,
    status,
    created: s.created || m.created || '',
    result,
    approved,
    denied,
    waiting: result === 'esperando' ? waiting : [],
    cancelledBy: result === 'anulada' && end ? end.who : '',
    reason: end && end.reason ? end.reason : '',
    decidedAt: end ? (end.at || latest(denied)) : result === 'aprobada' ? (s.approved || latest(approved)) : '',
    stages: s,
    metrics: m
  };
};

/** Las filas, de la decisión más reciente a la más vieja (las que siguen en trámite, por fecha de solicitud). */
export const buildApprovalLog = (list: RequestMetrics[]): ApprovalLogRow[] =>
  list.map(approvalLogRow).filter((r): r is ApprovalLogRow => !!r)
    .sort((a, b) => (b.decidedAt || b.created).localeCompare(a.decidedAt || a.created) || b.id.localeCompare(a.id));

export interface DeciderSummary { who: string; approved: number; denied: number; }

/** Cuántas aprobó y cuántas denegó cada persona (una vez por solicitud), de más a menos decisiones. */
export const deciderSummary = (rows: ApprovalLogRow[]): DeciderSummary[] => {
  const map = new Map<string, DeciderSummary>();
  const add = (who: string, key: 'approved' | 'denied') => {
    if (!who) return;
    const e = map.get(who) || { who, approved: 0, denied: 0 };
    e[key]++;
    map.set(who, e);
  };
  rows.forEach((r) => {
    new Set(r.approved.map((d) => d.who)).forEach((w) => add(w, 'approved'));
    new Set(r.denied.map((d) => d.who)).forEach((w) => add(w, 'denied'));
  });
  return Array.from(map.values()).sort((a, b) => (b.approved + b.denied) - (a.approved + a.denied) || a.who.localeCompare(b.who));
};

/** ¿Esta persona aprobó o denegó algo en la solicitud? */
export const rowHasDecider = (r: ApprovalLogRow, who: string): boolean =>
  r.approved.some((d) => d.who === who) || r.denied.some((d) => d.who === who);
