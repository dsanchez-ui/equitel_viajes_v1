import React, { useEffect, useState } from 'react';
import { ApprovalStep, MyApprovalItem, MyApprovalsResponse } from '../types';
import { gasService } from '../services/gasService';
import { formatCop } from '../utils/money';

/** 'AAAA-MM-DD' → 'DD/MM/AAAA' (#A105). */
const dmy = (v: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (v || '');
};
const city = (s: string) => String(s || '').split(',')[0].trim();
const pesos = (n: number) => `$${formatCop(n || 0)}`;

const STEP_TEXT: Record<string, { icon: string; text: string; tone: string }> = {
  approved: { icon: '✅', text: 'Aprobó', tone: 'text-green-700' },
  covered: { icon: '✅', text: 'Aprobada con su otro voto', tone: 'text-green-700' },
  denied: { icon: '❌', text: 'Denegó', tone: 'text-red-700' },
  skipped: { icon: '⏭️', text: 'Etapa saltada por', tone: 'text-amber-700' },
  expired: { icon: '⌛', text: 'Venció sin respuesta', tone: 'text-gray-600' },
  pending: { icon: '⏳', text: 'Falta el voto de', tone: 'text-amber-700' },
  waiting: { icon: '🕓', text: 'Aún no se le pide a', tone: 'text-gray-500' },
  not_needed: { icon: '—', text: 'No hizo falta', tone: 'text-gray-500' },
  other: { icon: '•', text: 'Registrada', tone: 'text-gray-600' },
};

const Trail: React.FC<{ steps: ApprovalStep[] }> = ({ steps }) => {
  if (!steps.length) return null;
  return (
    <ul className="space-y-1">
      {steps.map((s, i) => {
        const t = STEP_TEXT[s.state] || STEP_TEXT.other;
        return (
          <li key={i} className="text-xs leading-snug">
            <span className="font-semibold text-gray-700">{s.label}:</span>{' '}
            <span className={t.tone}>{t.icon} {t.text}</span>
            {s.who && <> <span className="text-gray-800">{s.who}</span></>}
            {s.at && <span className="text-gray-500"> · {s.at}</span>}
          </li>
        );
      })}
    </ul>
  );
};

const Trip: React.FC<{ it: MyApprovalItem }> = ({ it }) => (
  <p className="text-sm text-gray-900">
    {it.hotelOnly ? <>🏨 Hospedaje en <strong>{city(it.destination)}</strong></> : <><strong>{city(it.origin)}</strong> → <strong>{city(it.destination)}</strong></>}
    {it.international && <span className="ml-1 text-[10px] font-bold text-blue-700 align-middle">INTERNACIONAL</span>}
    <span className="text-gray-600"> · {dmy(it.depDate)}{it.depTime ? ` ${it.depTime}` : ''}{it.retDate ? ` al ${dmy(it.retDate)}${it.retTime ? ` ${it.retTime}` : ''}` : ''}</span>
  </p>
);

interface CardProps {
  it: MyApprovalItem;
  onDecided: (msg: { ok: boolean; title: string; message: string }) => void;
}

/** Una solicitud pendiente: los datos para decidir, cómo va cada aprobación y aprobar o denegar ahí mismo. */
const PendingCard: React.FC<CardProps> = ({ it, onDecided }) => {
  const [confirming, setConfirming] = useState<'approved' | 'denied' | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const isPolicy = it.kind === 'policy';

  const decide = async () => {
    if (!confirming) return;
    setBusy(true);
    try {
      const res = await gasService.decideMyApproval(it.id, confirming, comment.trim());
      const ok = ['approved_full', 'approved_partial', 'denied', 'approved'].includes(res.kind);
      onDecided({ ok, title: `${it.id}: ${res.title}`, message: res.message });
    } catch (e) {
      onDecided({ ok: false, title: `${it.id}: no se pudo registrar la decisión`, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-bold text-gray-900">{it.id}</span>
          <span className="text-[11px] font-semibold bg-amber-100 text-amber-900 rounded px-2 py-0.5">
            {isPolicy ? 'Excepción a la política de anticipación' : `Usted aprueba como: ${it.roleText}`}
          </span>
        </div>
        {it.totalCost > 0 && <span className="text-sm font-bold text-gray-900">{pesos(it.totalCost)}</span>}
      </div>

      <div className="space-y-1">
        <Trip it={it} />
        <p className="text-xs text-gray-600">
          Viaja: <span className="text-gray-900">{it.travelers.join(', ') || '—'}</span>
          {' · '}La pidió: <span className="text-gray-900">{it.requesterName || it.requesterEmail}</span>
        </p>
        <p className="text-xs text-gray-600">{[it.company, it.unit, it.costCenter].filter(Boolean).join(' · ')}</p>
        {(it.ticketsCost > 0 || it.hotelCost > 0) && (
          <p className="text-xs text-gray-600">
            {it.ticketsCost > 0 && <>Tiquetes {pesos(it.ticketsCost)}</>}
            {it.ticketsCost > 0 && it.hotelCost > 0 && ' · '}
            {it.hotelCost > 0 && <>Hotel {pesos(it.hotelCost)}</>}
            {it.fare && <> · Tarifa {it.fare}</>}
          </p>
        )}
      </div>

      {it.why.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {it.why.map(w => <span key={w} className="text-[11px] bg-gray-100 text-gray-800 rounded px-2 py-0.5">{w}</span>)}
        </div>
      )}
      {it.budgetNote && <p className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded p-2">{it.budgetNote}</p>}
      {it.fareReason && <p className="text-xs text-gray-700"><strong>Por qué esa tarifa:</strong> <span className="italic">{it.fareReason}</span></p>}
      {it.policy && (
        <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded p-2 space-y-1">
          <p>
            Se pidió <strong>{it.policy.leadDays === null ? 'sin fecha clara' : `${it.policy.leadDays} ${it.policy.leadDays === 1 ? 'día' : 'días'}`}</strong> antes; la política pide {it.policy.minDays}.
            {it.policy.expiryKey && <> Si nadie la aprueba, vence el {dmy(it.policy.expiryKey)}.</>}
          </p>
          <p><strong>Por qué no se pidió antes:</strong> <span className="italic">{it.policy.justification || 'No la escribió'}</span></p>
        </div>
      )}
      {it.notes && <p className="text-xs text-gray-700 whitespace-pre-line"><strong>Motivo del viaje:</strong> {it.notes}</p>}
      {it.selection && <p className="text-xs text-gray-700 whitespace-pre-line"><strong>Lo que eligió el viajero:</strong> {it.selection}</p>}
      {it.options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {it.options.map(o => (
            <a key={o.id + o.url} href={o.url} target="_blank" rel="noopener noreferrer" className="block border border-gray-200 rounded overflow-hidden hover:border-gray-400" title={`Opción ${o.id}`}>
              <img src={o.url} alt={`Opción ${o.id}`} referrerPolicy="no-referrer" className="h-20 w-auto object-cover" />
              <span className="block text-[10px] text-center text-gray-600 py-0.5">Opción {o.id}{o.direction ? ` · ${o.direction}` : ''}</span>
            </a>
          ))}
        </div>
      )}

      <div className="border-t pt-2">
        <p className="text-[11px] font-bold text-gray-500 uppercase mb-1">Cómo va cada aprobación</p>
        <Trail steps={it.trail} />
      </div>

      {!confirming ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={() => setConfirming('approved')} className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 text-white text-sm font-bold">Aprobar</button>
          <button type="button" onClick={() => setConfirming('denied')} className="px-4 py-2 rounded bg-white border border-red-600 text-red-700 hover:bg-red-50 text-sm font-bold">Denegar</button>
        </div>
      ) : (
        <div className={`rounded border p-3 space-y-2 ${confirming === 'approved' ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}`}>
          <p className="text-sm font-bold text-gray-900">¿{confirming === 'approved' ? 'Aprobar' : 'Denegar'} {it.id}?</p>
          <label className="block text-xs font-semibold text-gray-700" htmlFor={`c-${it.id}`}>
            {confirming === 'approved'
              ? (isPolicy ? 'Comentario (opcional)' : 'Comentario para el área de compras (opcional)')
              : (isPolicy ? 'Comentario para el solicitante (opcional)' : 'Motivo de la denegación (opcional; le llega al solicitante)')}
          </label>
          <textarea
            id={`c-${it.id}`}
            value={comment}
            onChange={e => setComment(e.target.value)}
            maxLength={500}
            rows={2}
            className="w-full border border-gray-300 rounded p-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={decide}
              disabled={busy}
              className={`px-4 py-2 rounded text-white text-sm font-bold disabled:opacity-50 ${confirming === 'approved' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
            >
              {busy ? 'Registrando…' : confirming === 'approved' ? 'Sí, aprobar' : 'Sí, denegar'}
            </button>
            <button type="button" onClick={() => { setConfirming(null); setComment(''); }} disabled={busy} className="px-4 py-2 rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
};

/** Una solicitud del historial: qué decidió la persona, cómo terminó y cómo fue cada aprobación. */
const HistoryRow: React.FC<{ it: MyApprovalItem }> = ({ it }) => {
  const vote = it.myVote;
  return (
    <details className="bg-white border border-gray-200 rounded-lg p-3 group">
      <summary className="cursor-pointer list-none flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-sm font-bold text-gray-900">{it.id}</span>
        <span className="text-xs text-gray-700">{it.hotelOnly ? `🏨 ${city(it.destination)}` : `${city(it.origin)} → ${city(it.destination)}`} · {dmy(it.depDate)}</span>
        <span className="text-xs text-gray-600">{it.travelers.join(', ')}</span>
        <span className="ml-auto text-[11px] font-semibold rounded px-2 py-0.5 bg-gray-100 text-gray-800">{it.statusText}</span>
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-xs text-gray-700">
          {vote
            ? <>Usted <strong className={vote.decision === 'denied' ? 'text-red-700' : 'text-green-700'}>{vote.decision === 'denied' ? 'denegó' : 'aprobó'}</strong>{vote.at ? ` el ${vote.at}` : ''} como {vote.roleText}.</>
            : <>Usted no votó en esta solicitud{it.roleText ? ` (le correspondía como ${it.roleText})` : ''}.</>}
        </p>
        {it.outcome && <p className="text-xs text-gray-700 whitespace-pre-line">{it.outcome}</p>}
        <Trail steps={it.trail} />
        <p className="text-[11px] text-gray-500">
          La pidió {it.requesterName || it.requesterEmail}{it.totalCost > 0 ? ` · ${pesos(it.totalCost)}` : ''}{it.unit ? ` · ${it.unit}` : ''}
        </p>
      </div>
    </details>
  );
};

interface PanelProps {
  onBack: () => void;
  /** Cuántas tiene pendientes (el botón de arriba muestra el número). */
  onCountChange: (n: number | null) => void;
}

/**
 * #A119: «Mis aprobaciones». Lo que la persona tiene por aprobar (y aprobar o denegar ahí mismo, con
 * las mismas reglas que el enlace del correo) y su historial, con cómo va cada aprobación. Todo lo
 * decide el servidor: qué solicitudes ve y con qué rol vota.
 */
export const MyApprovalsPanel: React.FC<PanelProps> = ({ onBack, onCountChange }) => {
  const [data, setData] = useState<MyApprovalsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [notice, setNotice] = useState<{ ok: boolean; title: string; message: string } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await gasService.getMyApprovals();
      setData(d);
      onCountChange(d.pending.length);
    } catch (e) {
      // #A49: nunca mostrar una lista vacía como si fuera la respuesta; se dice y se deja reintentar.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = data?.pending || [];
  const history = data?.history || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Mis aprobaciones</h2>
          <p className="text-sm text-gray-600">Lo que tiene por aprobar y lo que ya decidió, con cómo va cada aprobación.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={load} disabled={loading} className="px-3 py-1.5 rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50">
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
          <button type="button" onClick={onBack} className="px-3 py-1.5 rounded bg-gray-900 text-white text-sm hover:bg-gray-800">Volver</button>
        </div>
      </div>

      {notice && (
        <div role="status" className={`rounded-md border p-3 text-sm flex gap-3 items-start ${notice.ok ? 'bg-green-50 border-green-300 text-green-900' : 'bg-amber-50 border-amber-300 text-amber-900'}`}>
          <div className="flex-1">
            <p className="font-bold">{notice.title}</p>
            <p className="whitespace-pre-line">{notice.message}</p>
          </div>
          <button type="button" onClick={() => setNotice(null)} className="text-xs font-bold underline">Cerrar</button>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 text-red-800 p-3 text-sm">
          No se pudieron cargar sus aprobaciones: {error}{' '}
          <button type="button" onClick={load} className="underline font-bold">Reintentar</button>
        </div>
      )}

      <div className="flex gap-1 border-b border-gray-200">
        {(['pending', 'history'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${tab === t ? 'border-brand-red text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
          >
            {t === 'pending' ? `Por aprobar${data ? ` (${pending.length})` : ''}` : `Historial${data ? ` (${data.historyTotal})` : ''}`}
          </button>
        ))}
      </div>

      {loading && !data && <p className="text-sm text-gray-500">Cargando…</p>}

      {data && tab === 'pending' && (
        pending.length === 0
          ? <p className="text-sm text-gray-600">No tiene solicitudes por aprobar.</p>
          : <div className="space-y-3">
              {pending.map(it => (
                <PendingCard
                  key={it.id}
                  it={it}
                  onDecided={(msg) => { setNotice(msg); window.scrollTo({ top: 0, behavior: 'smooth' }); load(); }}
                />
              ))}
            </div>
      )}

      {data && tab === 'history' && (
        history.length === 0
          ? <p className="text-sm text-gray-600">Todavía no hay solicitudes en su historial.</p>
          : <div className="space-y-2">
              {data.historyTotal > history.length && (
                <p className="text-xs text-gray-500">Se muestran las {history.length} más recientes de {data.historyTotal}.</p>
              )}
              {history.map(it => <HistoryRow key={it.id} it={it} />)}
            </div>
      )}
    </div>
  );
};
