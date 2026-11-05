import React, { useEffect, useRef, useState } from 'react';
import { StageInfo } from '../types';
import { buildTimeline, fmtDuration, fmtStamp, fmtStampText, TimelineStep } from '../utils/stageTimeline';

/**
 * Semáforo de la solicitud (#A121; Yurani y David, 5-nov-2026): cada etapa con la fecha y la
 * hora en que pasó, lo que tomó en horas reales y a quién le tocaba, y quién tuvo la solicitud
 * más tiempo. Lo ven el solicitante y los administradores (detalle) y Métricas (cada fila).
 */
interface StageTimelineProps {
  stages: StageInfo;
  status: string;
  /** Sin el recuadro de afuera (dentro de la tabla de Métricas). */
  embedded?: boolean;
}

const APPROVAL_STATE: Record<string, string> = {
  approved: '✅ Aprobó',
  covered: '✅ Aprobada con su otro voto',
  denied: '❌ Denegó',
  skipped: '⏭️ Etapa saltada por',
  expired: '⌛ Venció sin respuesta',
  pending: '⏳ Falta su voto',
  waiting: '🕓 Aún no se le pide',
  other: 'Registrada'
};

const Mark: React.FC<{ step: TimelineStep; n: number }> = ({ step, n }) => {
  const cls = {
    hecho: 'border-green-600 bg-green-600 text-white',
    actual: 'border-brand-red bg-brand-red text-white',
    cerrado: 'border-red-700 bg-red-700 text-white',
    pendiente: 'border-gray-300 bg-white text-gray-400',
    omitido: 'border-dashed border-gray-300 bg-white text-gray-400'
  }[step.state];
  return (
    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold ${cls}`} aria-hidden="true">
      {step.state === 'hecho' ? '✓' : step.state === 'cerrado' ? '✕' : step.state === 'omitido' ? '–' : n}
    </div>
  );
};

export const StageTimeline: React.FC<StageTimelineProps> = ({ stages, status, embedded }) => {
  // «Lleva X» se actualiza solo mientras el detalle está abierto.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(t);
  }, []);

  const tl = buildTimeline(stages, status, nowMs);
  // En pantallas angostas las etapas se deslizan de lado: abrir mostrando la actual (o donde se cerró).
  const rail = useRef<HTMLDivElement>(null);
  const focusKey = (tl.steps.find((x) => x.state === 'actual' || x.state === 'cerrado') || { key: '' }).key;
  useEffect(() => {
    const box = rail.current;
    const el = box && focusKey ? box.querySelector<HTMLElement>(`[data-stage="${focusKey}"]`) : null;
    if (box && el && box.scrollWidth > box.clientWidth) box.scrollLeft = Math.max(0, el.offsetLeft - (box.clientWidth - el.clientWidth) / 2);
  }, [focusKey]);
  const cur = tl.current;
  const ended = tl.end;
  const total = tl.byResponsible.reduce((a, b) => a + b.minutes, 0);

  return (
    <section className={embedded ? '' : 'border border-gray-200 rounded-lg bg-white p-4'} data-stage-timeline aria-label="Tiempos de la solicitud">
      {/* Etapa actual, o cómo terminó */}
      {ended ? (
        <div className="text-red-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700">{ended.kind === 'DENEGADO' ? 'Denegada' : 'Anulada'}</p>
          <p className="text-sm">
            {ended.who ? <>{ended.kind === 'DENEGADO' ? 'La denegó' : 'La anuló'}: <strong>{ended.who}</strong></> : (ended.kind === 'DENEGADO' ? 'Se denegó' : 'Se anuló')}
            {ended.at && <> · {fmtStampText(ended.at)}</>}
            {tl.totalMinutes !== null && <> · {fmtDuration(tl.totalMinutes)} después de pedirla</>}
          </p>
        </div>
      ) : tl.done ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-green-700">Proceso completo</p>
          <p className="text-sm text-gray-800">
            De la solicitud a la {stages.hotelOnly ? 'reserva' : 'compra'}: <strong>{tl.totalMinutes !== null ? fmtDuration(tl.totalMinutes) : 'sin hora registrada'}</strong>
            {tl.closed && <span className="text-gray-600"> · cerrada el {fmtStampText(tl.closed)}{tl.closedBy ? ` por ${tl.closedBy}` : ''}</span>}
          </p>
        </div>
      ) : cur ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Etapa actual</p>
          <p className="text-base font-bold text-gray-900">{cur.doing}</p>
          <p className="text-sm text-gray-700 mt-0.5">
            Le toca a: <strong>{cur.who || cur.responsible}</strong>
            {cur.who && cur.responsible !== 'Solicitante' && <span className="text-gray-500"> ({cur.responsible === 'Aprobadores' ? 'aprobación' : cur.responsible === 'CFO' ? 'excepción a la política' : cur.responsible.toLowerCase()})</span>}
            {cur.since && <> · desde el {fmtStampText(cur.since)}</>}
            {cur.minutes !== null && <> · <span className="font-semibold text-brand-red">lleva {fmtDuration(cur.minutes)}</span></>}
          </p>
        </div>
      ) : null}

      {/* El semáforo: una marca por etapa */}
      <div ref={rail} className="relative mt-4 overflow-x-auto pb-1">
        <ol className="flex w-full min-w-max items-start">
          {tl.steps.map((st, i) => {
            const stamp = fmtStamp(st.at);
            const longest = st.key === tl.longestKey && tl.steps.length > 2;
            return (
              <li key={st.key} className={`flex items-start ${i < tl.steps.length - 1 ? 'flex-1' : ''}`} data-stage={st.key} data-stage-state={st.state}>
                <div className="flex w-[86px] shrink-0 flex-col items-center gap-0.5 text-center">
                  <Mark step={st} n={i + 1} />
                  <span className={`mt-0.5 text-[11px] leading-tight ${st.state === 'actual' || st.state === 'cerrado' ? 'font-bold text-gray-900' : st.state === 'hecho' ? 'text-gray-800' : 'text-gray-400'}`}>
                    {st.state === 'cerrado' ? (ended?.kind === 'DENEGADO' ? 'Denegada' : 'Anulada') : st.label}
                  </span>
                  <span className="text-[10px] text-gray-400 leading-tight">{st.responsible}</span>
                  {/* #A123: quién lo hizo (el área de compras o el CFO); el solicitante y los aprobadores ya se ven arriba y abajo. */}
                  {(st.state === 'hecho' || st.state === 'cerrado') && st.who && ['cambio', 'opciones', 'costos', 'compra', 'politica'].includes(st.key) && (
                    <span className="text-[10px] text-gray-600 leading-tight break-words" data-stage-who>{st.who}</span>
                  )}
                  {stamp && st.state !== 'pendiente' && (
                    <span className="text-[10px] text-gray-600 leading-tight">{stamp.day}<br />{stamp.time}</span>
                  )}
                  {st.state === 'hecho' && !st.at && i > 0 && <span className="text-[10px] italic text-gray-400">sin hora registrada</span>}
                  {(st.state === 'hecho' || st.state === 'cerrado') && st.minutes !== null && (
                    <span
                      className={`text-[10px] leading-tight ${longest ? 'font-bold text-red-700' : 'font-medium text-gray-700'}`}
                      title={longest ? 'La etapa que más tardó (horas reales desde el paso anterior)' : 'Tiempo desde el paso anterior (horas reales)'}
                    >
                      tardó {fmtDuration(st.minutes)}
                    </span>
                  )}
                  {st.state === 'actual' && st.minutes !== null && (
                    <span className="text-[10px] font-bold text-brand-red leading-tight" title="Tiempo en esta etapa (horas reales)">lleva {fmtDuration(st.minutes)}</span>
                  )}
                  {st.note && <span className="text-[10px] italic text-indigo-700 leading-tight">{st.note}</span>}
                </div>
                {i < tl.steps.length - 1 && (
                  <div className={`mx-0.5 mt-3.5 h-0.5 min-w-[6px] flex-1 ${st.state === 'hecho' ? 'bg-green-600/70' : 'bg-gray-200'}`} aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Cada voto, con lo que tardó desde que se le pidió */}
      {(() => {
        const ap = tl.steps.find((x) => x.key === 'aprobacion');
        if (!ap || !ap.approvals || !ap.approvals.length) return null;
        return (
          <div className="mt-3 border-t border-gray-100 pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Aprobaciones</p>
            <ul className="space-y-0.5 text-xs text-gray-700">
              {ap.approvals.map((a) => (
                <li key={a.role} className="flex flex-wrap gap-x-2">
                  <span className="font-semibold">{a.label}:</span>
                  <span>{APPROVAL_STATE[a.state] || a.state}</span>
                  {a.who && <span>{a.who}</span>}
                  {a.at && <span className="text-gray-500">· {fmtStampText(a.at)}</span>}
                  {a.minutes !== null && (a.state === 'pending'
                    ? <span className="font-semibold text-brand-red">· lleva {fmtDuration(a.minutes)}</span>
                    : <span className="text-gray-600">· tardó {fmtDuration(a.minutes)} desde que se le pidió</span>)}
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      {/* Quién tuvo la solicitud más tiempo */}
      {tl.byResponsible.length > 0 && total > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-700">
          <span className="font-semibold uppercase tracking-wide text-[11px] text-gray-500 mr-2">Quién la tuvo más tiempo</span>
          {tl.byResponsible.map((r, i) => (
            <span key={r.responsible} className={`inline-block mr-3 ${i === 0 ? 'font-bold text-gray-900' : ''}`}>
              {r.responsible}: {fmtDuration(r.minutes)} ({Math.round((100 * r.minutes) / total)} %)
            </span>
          ))}
        </div>
      )}
      <p className="mt-2 text-[10px] text-gray-400">Horas reales, de calendario (incluyen noches y fines de semana), en hora de Colombia.</p>
    </section>
  );
};
