import React, { useEffect, useState } from 'react';
import { PolicyHeldResponse } from '../types';
import { gasService } from '../services/gasService';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmtDay = (key: string) => {
    const [y, m, d] = String(key || '').split('-');
    return y && m && d ? `${Number(d)}-${MESES[Number(m) - 1]}-${y}` : (key || '—');
};
const city = (s: string) => String(s || '').split(',')[0].trim();
const days = (n: number | null) => (n === null || n === undefined ? '—' : `${n} ${n === 1 ? 'día' : 'días'}`);

/**
 * #A100: botón «En espera de preaprobación» del panel del área de compras. Las
 * solicitudes que no cumplen la política de anticipación esperan la aprobación del
 * CFO: NO están en la lista principal y aquí solo se pueden ver (no se gestionan).
 * Cuando el CFO las aprueba, llegan a la lista principal como nuevas.
 */
export const PolicyHeldPanel: React.FC = () => {
    const [data, setData] = useState<PolicyHeldResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [unsupported, setUnsupported] = useState(false);
    const [open, setOpen] = useState(false);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            setData(await gasService.getPolicyHeldRequests());
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // Frontend nuevo con el servidor anterior: la sección aún no existe.
            if (/Acción desconocida/i.test(msg)) setUnsupported(true);
            else setError(msg);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (unsupported || (data && !data.enabled && data.items.length === 0)) return null;
    const items = data?.items || [];
    const approver = data?.approverName || 'el CFO';

    return (
        <div className="border border-amber-300 rounded-md bg-white">
            <button
                type="button"
                onClick={() => { const next = !open; setOpen(next); if (next) load(); }}
                aria-expanded={open}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm font-bold text-amber-900 hover:bg-amber-50 rounded-md"
            >
                <span>⏳ En espera de preaprobación ({data ? items.length : '…'})</span>
                <span className="text-xs font-normal text-amber-800">{open ? 'Ocultar' : 'Ver'} · no cumplen la política de anticipación</span>
            </button>

            {open && (
                <div className="px-3 pb-3 space-y-3">
                    <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded p-2 text-xs leading-relaxed">
                        <strong>Estas solicitudes NO cumplen la política de anticipación</strong> (8 días nacional, 30 internacional).
                        Esperan la aprobación de <strong>{approver}</strong> y <strong>no se gestionan</strong>: no hay que cotizar ni comprar.
                        Si las aprueba, llegan a la lista principal como solicitudes nuevas; si no, quedan denegadas
                        (también si nadie las aprueba en {data?.expiryDays || 7} días o antes de la fecha del viaje). Solo lectura.
                    </div>
                    {error && <p className="text-xs text-red-600">No se pudo cargar: {error}</p>}
                    {loading && !data && <p className="text-xs text-gray-500">Cargando…</p>}
                    {data && items.length === 0 && <p className="text-xs text-gray-500">No hay solicitudes en espera.</p>}
                    {items.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-xs">
                                <thead>
                                    <tr className="text-left text-gray-500 border-b">
                                        <th className="py-1 pr-3 font-semibold">Solicitud</th>
                                        <th className="py-1 pr-3 font-semibold">Viaje</th>
                                        <th className="py-1 pr-3 font-semibold">Viaja</th>
                                        <th className="py-1 pr-3 font-semibold">La pidió</th>
                                        <th className="py-1 pr-3 font-semibold">Anticipación</th>
                                        <th className="py-1 pr-3 font-semibold">Por qué no se pidió antes</th>
                                        <th className="py-1 font-semibold">Vence</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map(it => (
                                        <tr key={it.id} className="border-b last:border-0 align-top">
                                            <td className="py-1.5 pr-3 font-mono whitespace-nowrap">{it.ids.join(', ')}</td>
                                            <td className="py-1.5 pr-3">
                                                {it.legs.length > 1 ? (
                                                    <>
                                                        <span className="font-semibold">Multidestino ({it.legs.length} tramos)</span>
                                                        {it.legs.map(l => (
                                                            <div key={l.id} className="text-gray-600">{city(l.origin)} → {city(l.destination)} · {fmtDay(l.depKey)}</div>
                                                        ))}
                                                    </>
                                                ) : it.hotelOnly ? (
                                                    <>🏨 {city(it.destination)} · {fmtDay(it.depKey)}{it.retKey ? ` → ${fmtDay(it.retKey)}` : ''}</>
                                                ) : (
                                                    <>{city(it.origin)} → {city(it.destination)} · {fmtDay(it.depKey)}{it.retKey ? ` → ${fmtDay(it.retKey)}` : ''}</>
                                                )}
                                                {it.international && <span className="ml-1 text-[10px] font-bold text-blue-700">INTL</span>}
                                            </td>
                                            <td className="py-1.5 pr-3">{it.travelers.join(', ') || '—'}</td>
                                            <td className="py-1.5 pr-3">{it.requesterName || it.requesterEmail}<div className="text-gray-500">{fmtDay(it.createdKey)}</div></td>
                                            <td className="py-1.5 pr-3 whitespace-nowrap text-red-700 font-semibold">{days(it.leadDays)} <span className="font-normal text-gray-500">(pide {it.minDays})</span></td>
                                            <td className="py-1.5 pr-3 italic text-gray-700 max-w-xs">{it.justification || <span className="not-italic text-gray-400">No la escribió</span>}</td>
                                            <td className="py-1.5 whitespace-nowrap">{fmtDay(it.expiryKey)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <button type="button" onClick={load} disabled={loading} className="text-xs text-amber-800 underline disabled:opacity-50">
                        {loading ? 'Actualizando…' : 'Actualizar'}
                    </button>
                </div>
            )}
        </div>
    );
};
