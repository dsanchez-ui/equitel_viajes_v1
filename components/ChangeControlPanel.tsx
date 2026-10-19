import React, { useEffect, useMemo, useState } from 'react';
import { ChangeControl, ChangeControlItem } from '../types';
import { gasService } from '../services/gasService';
import { formatCop } from '../utils/money';

/**
 * Pestaña «Cambios» del panel de Métricas (#A103, pedido de Yurani): cada cambio de viaje con
 * lo que costó el viaje original y lo que sumó el cambio, para ver dónde se paga de más (por
 * ejemplo, la maleta pedida después de comprar). Solo administradores (`getChangeControl`).
 */

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmtMonth = (key: string): string => (key ? `${MESES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}` : '—');
const money = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : '$' + formatCop(n));
const TIPOS = ['Fecha', 'Hora', 'Destino', 'Equipaje'];
const STATUS_LABEL: Record<string, string> = {
  PENDIENTE_ANALISIS_CAMBIO: 'Por revisar',
  PENDIENTE_OPCIONES: 'Cotizando',
  PENDIENTE_SELECCION: 'Eligiendo opción',
  PENDIENTE_CONFIRMACION_COSTO: 'Confirmando costo',
  PENDIENTE_APROBACION: 'En aprobación',
  APROBADO: 'Aprobado',
  RESERVADO: 'Comprado',
  PROCESADO: 'Cerrado',
  DENEGADO: 'Denegado',
  ANULADO: 'Anulado'
};
const counts = (x: ChangeControlItem) => x.comprado && x.changeCost !== null && !['ANULADO', 'DENEGADO'].includes(x.status);

const csvCell = (v: string | number | null | undefined): string => {
  let s = v === null || v === undefined ? '' : String(v);
  if (typeof v !== 'number' && /^(?:[=+@\t]|-(?!\d))/.test(s)) s = "'" + s;
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export const ChangeControlPanel: React.FC = () => {
  const [data, setData] = useState<ChangeControl | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState('Todos');
  const [tipo, setTipo] = useState('Todos');

  const load = async () => {
    setLoading(true);
    setError('');
    try { setData(await gasService.getChangeControl()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const months = useMemo(() => Array.from(new Set((data?.items || []).map(x => x.month).filter(Boolean))).sort().reverse(), [data]);
  const rows = (data?.items || []).filter(x => (month === 'Todos' || x.month === month) && (tipo === 'Todos' || x.tipos.includes(tipo)));
  const bought = rows.filter(counts);
  const sum = (list: ChangeControlItem[], f: (x: ChangeControlItem) => number) => list.reduce((a, x) => a + (f(x) || 0), 0);
  const cost = sum(bought, x => x.changeCost || 0);
  const orig = sum(bought, x => x.original);
  const penalty = sum(bought, x => (typeof x.penalty === 'number' ? x.penalty : 0));
  const bag = rows.filter(x => x.bagLater);
  const bagCost = sum(bag.filter(counts), x => x.changeCost || 0);
  const units: Record<string, number> = {};
  bought.forEach(x => { const u = x.unit || '(sin unidad)'; units[u] = (units[u] || 0) + (x.changeCost || 0); });
  const unitKeys = Object.keys(units).sort((a, b) => units[b] - units[a]);
  const unitMax = Math.max(1, ...unitKeys.map(k => units[k]));

  const downloadCsv = () => {
    const head = ['Cambio', 'Viaje original', 'Estado', 'Tiquete ya comprado', 'Qué cambió', 'Mes', 'Unidad', 'Empresa', 'Solicitante', 'Lo registró',
      'Costo del viaje original', 'Origen del costo original', 'Costo del cambio', 'Penalidad y cargos', 'El cambio suma (%)', 'Facturado del cambio', 'Maleta pedida después de comprar', 'Motivo'];
    const lines = [head].concat(rows.map(x => [
      x.id, x.parentId, STATUS_LABEL[x.status] || x.status, x.comprado ? 'SI' : 'NO', x.tipos.join(', '), x.month, x.unit, x.company,
      x.requesterName || x.requesterEmail, x.registeredBy === 'administrador' ? 'Área de viajes' : 'Viajero',
      String(x.original), x.originalSource, x.changeCost === null ? '' : String(x.changeCost), typeof x.penalty === 'number' ? String(x.penalty) : '',
      x.comprado && x.changeCost !== null && x.original > 0 ? String(Math.round((100 * x.changeCost) / x.original)) : '',
      x.invoiced === null ? '' : String(x.invoiced), x.bagLater ? 'SI' : 'NO', x.reason
    ].map(String)));
    const csv = '﻿' + lines.map(l => l.map(csvCell).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `cambios-de-viaje-${month === 'Todos' ? 'todos' : month}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (loading) return <div className="py-10 text-center text-sm text-gray-500 animate-pulse">Cargando los cambios…</div>;
  if (error) return (
    <div className="bg-red-50 border border-red-200 text-red-800 rounded p-3 text-sm flex items-center justify-between gap-3">
      <span>No se pudo cargar el control de cambios: {error}</span>
      <button type="button" onClick={load} className="px-2 py-1 bg-white border border-red-300 rounded text-xs font-bold">Reintentar</button>
    </div>
  );
  if (!data) return null;

  return (
    <div className="space-y-4 text-sm" data-change-control>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-bold text-gray-600">Mes
          <select className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm bg-white text-gray-900" value={month} onChange={e => setMonth(e.target.value)}>
            <option value="Todos">Todos</option>
            {months.map(m => <option key={m} value={m}>{fmtMonth(m)}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Qué cambió">
          {['Todos', ...TIPOS].map(t => (
            <button key={t} type="button" aria-pressed={tipo === t} onClick={() => setTipo(t)}
              className={`px-3 py-1 rounded-full text-xs border ${tipo === t ? 'bg-gray-900 text-white border-gray-900 font-bold' : 'bg-white text-gray-700 border-gray-300'}`}>{t}</button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={load} className="px-3 py-1 text-xs font-bold border border-gray-300 rounded bg-white">⟳ Actualizar</button>
          <button type="button" onClick={downloadCsv} disabled={!rows.length} className="px-3 py-1 text-xs font-bold border border-gray-300 rounded bg-white disabled:opacity-50">Descargar CSV</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-gray-200 border border-gray-200 rounded-lg overflow-hidden">
        <div className="bg-white p-3"><div className="text-2xl font-bold tabular-nums">{rows.length}</div><div className="text-xs text-gray-500">cambios pedidos</div></div>
        <div className="bg-white p-3"><div className="text-2xl font-bold tabular-nums">{rows.filter(x => x.comprado).length}</div><div className="text-xs text-gray-500">con el tiquete ya comprado</div></div>
        <div className="bg-white p-3"><div className="text-2xl font-bold tabular-nums text-brand-red">{money(cost)}</div><div className="text-xs text-gray-500">costo de esos cambios{orig > 0 ? ` (${Math.round((100 * cost) / orig)} % sobre sus viajes)` : ''}</div></div>
        <div className="bg-white p-3"><div className="text-2xl font-bold tabular-nums text-brand-red">{money(penalty)}</div><div className="text-xs text-gray-500">de eso, penalidades y cargos: lo que se pierde</div></div>
        <div className="bg-white p-3"><div className="text-2xl font-bold tabular-nums">{bag.length}</div><div className="text-xs text-gray-500">para agregar la maleta después de comprar{bagCost ? `, por ${money(bagCost)}` : ''}</div></div>
      </div>

      <details className="text-xs text-gray-600">
        <summary className="cursor-pointer font-semibold">¿Cómo se calcula?</summary>
        <p className="mt-1">«Costo del cambio» es lo que confirmó el área de viajes para el cambio de un tiquete ya comprado: penalidad y cargos, más la diferencia de tarifa, más el hotel. Solo cuentan los cambios con costo confirmado que no se denegaron ni se anularon. «Suma» es ese costo sobre lo que costó el viaje original (lo pagado si se registró; si no, lo cotizado). Los cambios de un tiquete sin comprar no tienen penalidad: se cotizan como un viaje nuevo.</p>
      </details>

      {data.legacy > 0 && (
        <p className="text-xs text-gray-500">Además hay {data.legacy} {data.legacy === 1 ? 'cambio pedido' : 'cambios pedidos'} con el formulario anterior, sin el detalle de qué cambió ni de su costo aparte.</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
        <div className="lg:col-span-3 overflow-x-auto">
          <table className="w-full text-xs border-collapse min-w-[48rem]">
            <thead>
              <tr className="text-left uppercase text-[10px] text-gray-500 border-b-2 border-gray-300">
                <th className="py-1.5 pr-2">Cambio</th><th className="py-1.5 pr-2">Qué cambió</th><th className="py-1.5 pr-2 text-right">Viaje original</th>
                <th className="py-1.5 pr-2 text-right">Costo del cambio</th><th className="py-1.5 pr-2 text-right">Penalidad</th><th className="py-1.5 pr-2 text-right">Suma</th>
                <th className="py-1.5 pr-2">Unidad</th><th className="py-1.5">Pidió</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} className="py-4 text-center text-gray-400">No hay cambios {tipo !== 'Todos' || month !== 'Todos' ? 'con este filtro' : 'pedidos con «Cambiar mi viaje» todavía'}.</td></tr>}
              {rows.map(x => (
                <tr key={x.id} className="border-b border-gray-100 align-top">
                  <td className="py-1.5 pr-2">
                    <span className="font-mono font-bold">{x.id}</span>
                    <span className="block text-gray-500">de {x.parentId} · {x.comprado ? 'comprado' : 'sin comprar'}</span>
                    <span className="block text-gray-400">{STATUS_LABEL[x.status] || x.status} · {fmtMonth(x.month)}</span>
                  </td>
                  <td className="py-1.5 pr-2">
                    <div className="flex flex-wrap gap-1">{x.tipos.map(t => <span key={t} className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-bold">{t}</span>)}</div>
                    {x.bagLater && <span className="block text-orange-700 mt-0.5">Maleta después de comprar</span>}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums whitespace-nowrap">{money(x.original)}</td>
                  <td className={`py-1.5 pr-2 text-right tabular-nums whitespace-nowrap ${x.comprado && x.changeCost ? 'text-brand-red font-bold' : ''}`}>
                    {x.comprado ? (x.changeCost === null ? 'Por cotizar' : money(x.changeCost)) : (x.changeCost === null ? 'Cotizando' : `Viaje nuevo ${money(x.changeCost)}`)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums whitespace-nowrap">{typeof x.penalty === 'number' ? money(x.penalty) : '—'}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{x.comprado && x.changeCost !== null && x.original > 0 ? Math.round((100 * x.changeCost) / x.original) + ' %' : '—'}</td>
                  <td className="py-1.5 pr-2">{x.unit || '—'}</td>
                  <td className="py-1.5">{x.requesterName || x.requesterEmail}<span className="block text-gray-400">{x.registeredBy === 'administrador' ? 'Lo registró el área de viajes' : 'Lo pidió en la plataforma'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
          <div className="font-bold text-gray-800">Costo de los cambios por unidad</div>
          <p className="text-[11px] text-gray-500">Solo tiquetes ya comprados.</p>
          {unitKeys.length === 0 && <p className="text-xs text-gray-400">Sin cambios con costo.</p>}
          {unitKeys.map(k => (
            <div key={k} className="text-xs">
              <div className="flex justify-between gap-2"><span className="truncate">{k}</span><strong className="tabular-nums">{money(units[k])}</strong></div>
              <div className="h-2 bg-gray-200 rounded mt-0.5"><div className="h-2 rounded bg-brand-red" style={{ width: `${(100 * units[k]) / unitMax}%` }} /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
