import React, { useEffect, useMemo, useState } from 'react';
import { RequestMetrics } from '../types';
import { gasService } from '../services/gasService';
import { DateInput } from './DateInput';
import { StageTimeline } from './StageTimeline';
import { fmtStamp } from '../utils/stageTimeline';
import { DATE_PRESETS, DatePreset, presetToRange } from '../utils/datePresets';
import { ApprovalDecision, ApprovalLogRow, ApprovalResult, RESULT_LABEL, buildApprovalLog, deciderSummary, rowHasDecider } from '../utils/approvalLog';

/**
 * Métricas → Aprobaciones (#A125; Yurani y David, 6-nov-2026: «¿dónde puedo ver lo que Alejandro niega?»).
 * Cada solicitud que pasó por aprobación, con el resultado, quién aprobó, quién denegó y el motivo, y
 * cuántas aprobó y denegó cada persona. Tocar una fila abre los tiempos de cada etapa (la misma línea de
 * tiempo del detalle). Incluye las denegadas y anuladas: aquí no se excluye nada. Las que todavía esperan la
 * excepción del CFO no están: el área de compras las ve en «En espera de preaprobación» (#A100).
 */
type ResultFilter = 'all' | ApprovalResult;

const RESULT_STYLE: Record<ApprovalResult, string> = {
  aprobada: 'bg-green-100 text-green-800',
  denegada: 'bg-red-100 text-red-800',
  esperando: 'bg-amber-100 text-amber-800',
  tramite: 'bg-blue-50 text-blue-800',
  anulada: 'bg-gray-200 text-gray-600'
};

const RESULT_HINT: Record<ApprovalResult, string> = {
  aprobada: 'Tiene todas sus aprobaciones',
  denegada: 'La denegó un aprobador, el CFO (excepción a la política) o el área de compras (un cambio)',
  esperando: 'Ya se pidió el voto y alguien todavía no decide',
  tramite: 'Se aprobó la excepción a la política; el viaje aún no llega a la aprobación',
  anulada: 'Se anuló después de alguna decisión'
};

/** Personas que se ven de entrada en «Quién decidió» (las de más decisiones); el resto, con «Ver todas». */
const PEOPLE_SHOWN = 8;

const stamp = (iso: string) => (iso ? fmtStamp(iso)?.short || '' : '');

const Decision: React.FC<{ d: ApprovalDecision }> = ({ d }) => {
  const icon = d.kind === 'approved' ? '✅' : d.kind === 'skipped' ? '⏭️' : d.kind === 'expired' ? '⌛' : '❌';
  const who = d.kind === 'expired' ? 'Venció sin respuesta' : d.who || 'Sin nombre registrado';
  return (
    <div className="leading-tight mb-1 last:mb-0">
      <span aria-hidden="true">{icon} </span><span className="font-semibold text-gray-800">{who}</span>
      <span className="block text-[10px] text-gray-500">{d.what}{d.at ? ` · ${stamp(d.at)}` : ''}</span>
    </div>
  );
};

export const ApprovalsLogPanel: React.FC = () => {
  const [preset, setPreset] = useState<DatePreset>('last30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ApprovalLogRow[] | null>(null);
  const [noStages, setNoStages] = useState(false);
  const [result, setResult] = useState<ResultFilter>('all');
  const [person, setPerson] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string>('');
  const [allPeople, setAllPeople] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const range = preset === 'custom'
        ? { ...(customFrom ? { dateFrom: customFrom } : {}), ...(customTo ? { dateTo: customTo } : {}) }
        : presetToRange(preset);
      // Sin excluir nada: aquí interesan justamente las denegadas y las anuladas.
      const res = await gasService.getMetrics({ ...range, hideNoEvents: false });
      const list: RequestMetrics[] = res.perRequest || [];
      setNoStages(list.length > 0 && list.every((m) => !m.stages));
      setRows(buildApprovalLog(list));
    } catch (e: any) {
      setError(e?.message || String(e));
      setRows(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const counts = useMemo(() => {
    const c: Record<ApprovalResult, number> = { aprobada: 0, denegada: 0, esperando: 0, tramite: 0, anulada: 0 };
    (rows || []).forEach((r) => { c[r.result]++; });
    return c;
  }, [rows]);
  const deciders = useMemo(() => deciderSummary(rows || []), [rows]);
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (rows || []).filter((r) =>
      (result === 'all' || r.result === result) &&
      (!person || rowHasDecider(r, person)) &&
      (!term || `${r.id} ${r.requester} ${r.destination}`.toLowerCase().includes(term)));
  }, [rows, result, person, search]);

  return (
    <div data-approvals-log>
      {/* Filtros */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Solicitudes pedidas</label>
            <div className="flex gap-1 flex-wrap">
              {DATE_PRESETS.map((p) => (
                <button key={p.v} onClick={() => setPreset(p.v)}
                  className={`px-2 py-1 rounded text-[11px] font-medium border ${preset === p.v ? 'bg-brand-red text-white border-brand-red' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'}`}>
                  {p.l}
                </button>
              ))}
            </div>
          </div>
          {preset === 'custom' && (
            <>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Desde</label>
                <DateInput value={customFrom} onChange={setCustomFrom} wrapperClassName="w-36" className="w-full px-2 py-1 border border-gray-300 rounded text-xs" ariaLabel="Desde" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Hasta</label>
                <DateInput value={customTo} onChange={setCustomTo} wrapperClassName="w-36" className="w-full px-2 py-1 border border-gray-300 rounded text-xs" ariaLabel="Hasta" />
              </div>
            </>
          )}
          <button onClick={load} disabled={loading} className="px-4 py-1.5 bg-brand-red text-white text-xs font-bold rounded hover:bg-red-700 disabled:opacity-50">
            {loading ? 'Cargando...' : 'Aplicar'}
          </button>
          <div className="ml-auto">
            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Buscar</label>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ID, solicitante o destino"
              className="px-2 py-1 border border-gray-300 rounded text-xs w-48" aria-label="Buscar solicitud" />
          </div>
        </div>
      </div>

      {loading && (
        <div className="text-center py-8 text-gray-500 text-sm">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-brand-red mb-2"></div>
          <div>Cargando aprobaciones...</div>
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded text-sm mb-3"><strong>Error:</strong> {error}</div>}
      {!loading && noStages && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded text-xs mb-3">
          El servidor todavía no envía las etapas de cada solicitud: hace falta la versión nueva de Apps Script.
        </div>
      )}

      {!loading && rows && (
        <>
          {/* Resultado: tocar una tarjeta filtra la lista */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
            {(['aprobada', 'denegada', 'esperando', 'tramite', 'anulada'] as ApprovalResult[]).map((k) => (
              <button key={k} onClick={() => setResult(result === k ? 'all' : k)} title={RESULT_HINT[k]} aria-pressed={result === k}
                data-approvals-result={k}
                className={`rounded-lg border p-2 text-left ${result === k ? 'border-brand-red ring-1 ring-brand-red bg-white' : 'border-gray-200 bg-gray-50 hover:bg-white'}`}>
                <div className="text-[10px] font-bold uppercase text-gray-500">{RESULT_LABEL[k]}</div>
                <div className="text-lg font-bold text-gray-900">{counts[k]}</div>
              </button>
            ))}
          </div>

          {/* Quién decidió */}
          {deciders.length > 0 && (
            <div className="mb-3">
              <div className="text-[10px] font-bold uppercase text-gray-500 mb-1">Quién decidió · toque una persona para ver solo sus decisiones</div>
              <div className="flex flex-wrap gap-1.5">
                {deciders.filter((d, i) => allPeople || i < PEOPLE_SHOWN || d.who === person).map((d) => (
                  <button key={d.who} onClick={() => setPerson(person === d.who ? '' : d.who)} aria-pressed={person === d.who}
                    data-approvals-person={d.who}
                    className={`px-2 py-1 rounded-full border text-[11px] ${person === d.who ? 'bg-brand-red text-white border-brand-red' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'}`}>
                    <span className="font-semibold">{d.who}</span>
                    <span className={person === d.who ? 'text-white/90' : 'text-gray-500'}> · {d.approved} aprobó · {d.denied} denegó</span>
                  </button>
                ))}
                {deciders.length > PEOPLE_SHOWN && (
                  <button onClick={() => setAllPeople(!allPeople)} className="px-2 py-1 text-[11px] text-brand-red font-semibold hover:underline">
                    {allPeople ? 'Ver menos' : `Ver todas (${deciders.length})`}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-3 py-2 border-b border-gray-200 flex flex-wrap items-center gap-2">
              <h4 className="text-xs font-bold text-gray-700 uppercase">Solicitud por solicitud ({visible.length})</h4>
              {(result !== 'all' || person || search) && (
                <button onClick={() => { setResult('all'); setPerson(''); setSearch(''); }} className="text-[11px] text-brand-red font-semibold hover:underline">
                  Quitar filtros
                </button>
              )}
            </div>
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-100 sticky top-0 z-10">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium text-gray-500">Solicitud</th>
                    <th className="px-2 py-2 text-left font-medium text-gray-500">Resultado</th>
                    <th className="px-2 py-2 text-left font-medium text-gray-500">Aprobó</th>
                    <th className="px-2 py-2 text-left font-medium text-gray-500">Denegó o falta</th>
                    <th className="px-2 py-2 text-left font-medium text-gray-500">Motivo o comentario</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visible.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-8 text-gray-400">Ninguna solicitud con estos filtros.</td></tr>
                  )}
                  {visible.map((r) => {
                    const isOpen = open === r.id;
                    const comments = r.approved.filter((d) => d.comment);
                    return (
                      <React.Fragment key={r.id}>
                        <tr className={`cursor-pointer align-top hover:bg-red-50/40 ${isOpen ? 'bg-red-50/60' : ''}`}
                          onClick={() => setOpen(isOpen ? '' : r.id)} aria-expanded={isOpen}
                          title={isOpen ? 'Ocultar los tiempos' : 'Ver los tiempos de cada etapa'} data-approvals-row={r.id}>
                          <td className="px-2 py-2 whitespace-nowrap">
                            <span className="inline-block w-3 text-gray-400" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                            <span className="font-semibold text-gray-900">{r.id}</span>
                            <span className="block pl-3 text-gray-600 max-w-[190px] truncate" title={r.requester}>{r.requester}</span>
                            <span className="block pl-3 text-[10px] text-gray-500 max-w-[190px] truncate" title={r.destination}>
                              {r.destination}{r.created ? ` · pedida ${stamp(r.created)}` : ''}
                            </span>
                          </td>
                          <td className="px-2 py-2">
                            <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${RESULT_STYLE[r.result]}`} title={RESULT_HINT[r.result]}>
                              {RESULT_LABEL[r.result]}
                            </span>
                            {r.decidedAt && <span className="block text-[10px] text-gray-500 mt-0.5">{stamp(r.decidedAt)}</span>}
                            {r.cancelledBy && <span className="block text-[10px] text-gray-500 mt-0.5">por {r.cancelledBy}</span>}
                          </td>
                          <td className="px-2 py-2 min-w-[150px]">
                            {r.approved.length ? r.approved.map((d, i) => <Decision key={i} d={d} />) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-2 py-2 min-w-[150px]">
                            {r.denied.map((d, i) => <Decision key={i} d={d} />)}
                            {r.waiting.map((w) => (
                              <div key={w} className="leading-tight mb-1 text-amber-800"><span aria-hidden="true">⏳ </span>Falta: <span className="font-semibold">{w}</span></div>
                            ))}
                            {!r.denied.length && !r.waiting.length && <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-2 py-2 max-w-[260px]">
                            {r.reason && <div className="text-red-900 italic">«{r.reason}»</div>}
                            {comments.map((d, i) => (
                              <div key={i} className="text-gray-600 italic mt-0.5"><span className="not-italic font-semibold">{d.who}:</span> «{d.comment}»</div>
                            ))}
                            {!r.reason && !comments.length && <span className="text-gray-300">—</span>}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-white">
                            <td colSpan={5} className="px-3 py-3 border-b-2 border-red-100">
                              <StageTimeline stages={r.stages} status={r.status} embedded />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11px] text-gray-500 mt-2">
            Las que todavía esperan que se apruebe la excepción a la política no salen aquí: están en «En espera de preaprobación» del panel principal.
            Cuenta la fecha en que se pidió cada solicitud.
          </p>
        </>
      )}
    </div>
  );
};
