import React, { useEffect, useState } from 'react';
import { InvoiceReview, InvoiceReviewItem, TravelRequest } from '../types';
import { gasService } from '../services/gasService';
import { formatCop } from '../utils/money';

interface InvoiceReviewPanelProps {
    requests: TravelRequest[];
    onViewRequest: (req: TravelRequest) => void;
    /** Cierre manual de siempre; `detail` se agrega al mensaje de confirmación. */
    onFinalize: (req: TravelRequest, detail?: string) => void;
    onOpenSupports: (req: TravelRequest) => void;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmtDay = (key: string) => {
    const [y, m, d] = key.split('-');
    return y && m && d ? `${Number(d)}-${MESES[Number(m) - 1]}-${y}` : key;
};
const city = (s: string) => String(s || '').split(',')[0].trim();
const facturas = (n: number) => `${n} factura${n === 1 ? '' : 's'}`;

/**
 * Facturas de las solicitudes RESERVADO con el viaje terminado (#A83):
 * - "Listas para cerrar": las facturas suman lo cotizado (o más) y cada una tiene
 *   su PDF. No se cierran solas: el área de viajes las revisa y las cierra con el
 *   cierre manual de siempre.
 * - "Facturas por revisar": terminaron hace `graceDays` días o más y les faltan
 *   facturas o PDF. Se pueden completar, cerrar igual u omitir el aviso.
 */
export const InvoiceReviewPanel: React.FC<InvoiceReviewPanelProps> = ({ requests, onViewRequest, onFinalize, onOpenSupports }) => {
    const [data, setData] = useState<InvoiceReview | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [unsupported, setUnsupported] = useState(false);
    const [open, setOpen] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            setData(await gasService.getInvoiceReview());
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

    // Si una solicitud de la lista se cierra o cambia de estado (polling del panel),
    // sale de la lista sin volver a consultar el servidor.
    const statusById: Record<string, string> = {};
    requests.forEach(r => { statusById[r.requestId] = r.status; });
    const stillReserved = (it: InvoiceReviewItem) => !statusById[it.requestId] || statusById[it.requestId] === 'RESERVADO';
    const alerts = (data?.alerts || []).filter(stillReserved);
    const ready = (data?.pendingClose || []).filter(stillReserved);
    const findReq = (id: string) => requests.find(r => r.requestId === id);

    const dismiss = async (it: InvoiceReviewItem) => {
        if (!window.confirm(`¿Omitir el aviso de ${it.requestId}?\n\nFacturado $${formatCop(it.invoiced)} de $${formatCop(it.quoted)} cotizado. Deja de aparecer aquí; si después se completan las facturas y sus PDF, pasa a «Listas para cerrar».`)) return;
        setBusyId(it.requestId);
        try {
            await gasService.dismissInvoiceAlert(it.requestId);
            setData(prev => prev ? { ...prev, alerts: prev.alerts.filter(a => a.requestId !== it.requestId), dismissedCount: prev.dismissedCount + 1 } : prev);
        } catch (e) {
            alert('No se pudo omitir el aviso: ' + (e instanceof Error ? e.message : String(e)));
        } finally {
            setBusyId(null);
        }
    };

    if (unsupported) return null;
    if (error) {
        return (
            <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded text-sm flex items-center justify-between gap-3" data-invoice-review-error>
                <span><strong>No se pudieron cargar las facturas por cerrar y por revisar:</strong> {error}</span>
                <button onClick={load} className="px-3 py-1 bg-white border border-red-300 rounded text-xs font-bold hover:bg-red-100">Reintentar</button>
            </div>
        );
    }
    if (!data || (alerts.length === 0 && ready.length === 0)) return null;

    // Celdas comunes de las dos tablas.
    const baseCells = (it: InvoiceReviewItem, req: TravelRequest | undefined) => (
        <>
            <td className="px-2 py-1.5 font-bold whitespace-nowrap">
                {req ? (
                    <button onClick={() => onViewRequest(req)} className="text-brand-red hover:underline">{it.requestId}</button>
                ) : it.requestId}
            </td>
            <td className="px-2 py-1.5 text-gray-600 truncate max-w-[180px]" title={it.requesterEmail}>{it.requesterEmail}</td>
            <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">
                {it.hotelOnly ? `🏨 ${city(it.destination)}` : `${city(it.origin)} → ${city(it.destination)}`}
            </td>
            <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">
                {fmtDay(it.tripEnd)} <span className="text-gray-400">· hace {it.daysSinceEnd} días</span>
            </td>
            <td className="px-2 py-1.5 text-right whitespace-nowrap">${formatCop(it.quoted)}</td>
        </>
    );
    const headCells = (
        <>
            <th className="px-2 py-2 text-left">Solicitud</th>
            <th className="px-2 py-2 text-left">Solicitante</th>
            <th className="px-2 py-2 text-left">Ruta</th>
            <th className="px-2 py-2 text-left">Viaje hasta</th>
            <th className="px-2 py-2 text-right">Cotizado</th>
            <th className="px-2 py-2 text-right">Facturado</th>
        </>
    );

    return (
        <div className="bg-amber-50 border border-amber-300 rounded-lg shadow-sm" data-invoice-review>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
                data-invoice-review-toggle
            >
                <span className="text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
                    <strong className={ready.length > 0 ? 'text-green-800' : 'text-gray-500'} data-invoice-ready-count>
                        ✅ Listas para cerrar: {ready.length}
                    </strong>
                    <strong className={alerts.length > 0 ? 'text-amber-900' : 'text-gray-500'}>
                        🧾 Facturas por revisar: {alerts.length}
                    </strong>
                </span>
                <span className="text-xs font-bold text-amber-900 whitespace-nowrap">{open ? 'Ocultar ▲' : 'Ver ▼'}</span>
            </button>
            {open && (
                <div className="px-4 pb-4 space-y-4">
                    {ready.length > 0 && (
                        <div data-invoice-ready>
                            <p className="text-xs text-green-900 mb-1">
                                <strong>✅ Listas para cerrar.</strong> El viaje terminó, las facturas suman lo cotizado (o más) y cada factura tiene su PDF. No se cierran solas: revíselas y ciérrelas.
                            </p>
                            <div className="overflow-x-auto bg-white border border-green-200 rounded">
                                <table className="min-w-full text-xs" data-invoice-ready-table>
                                    <thead className="bg-green-50 text-green-900">
                                        <tr>
                                            {headCells}
                                            <th className="px-2 py-2 text-right">PDF</th>
                                            <th className="px-2 py-2"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-green-100">
                                        {ready.map(it => {
                                            const req = findReq(it.requestId);
                                            const count = it.invoiceCount ?? 0;
                                            const pdfs = it.uploadedPdfs ?? 0;
                                            return (
                                                <tr key={it.requestId} data-invoice-ready-row={it.requestId}>
                                                    {baseCells(it, req)}
                                                    <td className="px-2 py-1.5 text-right whitespace-nowrap font-bold text-green-800">${formatCop(it.invoiced)}</td>
                                                    <td className="px-2 py-1.5 text-right whitespace-nowrap text-gray-700">{count > 0 ? `${pdfs} de ${count}` : '—'}</td>
                                                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                                                        {req && (
                                                            <button
                                                                onClick={() => onFinalize(req, `Facturado $${formatCop(it.invoiced)} de $${formatCop(it.quoted)} cotizado; ${pdfs} PDF de ${facturas(count)}.`)}
                                                                disabled={busyId !== null}
                                                                data-invoice-close={it.requestId}
                                                                className="px-2 py-1 rounded border border-green-600 bg-green-600 text-white font-bold hover:bg-green-700 disabled:opacity-50"
                                                            >
                                                                Cerrar
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                    {alerts.length > 0 && (
                        <div data-invoice-alerts>
                            <p className="text-xs text-amber-900 mb-1">
                                <strong>🧾 Facturas por revisar.</strong> Viajes terminados hace {data.graceDays} días o más con facturas que no suman lo cotizado o sin sus PDF.
                            </p>
                            <div className="overflow-x-auto bg-white border border-amber-200 rounded">
                                <table className="min-w-full text-xs" data-invoice-review-table>
                                    <thead className="bg-amber-100 text-amber-900">
                                        <tr>
                                            {headCells}
                                            <th className="px-2 py-2 text-right">Falta</th>
                                            <th className="px-2 py-2"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-amber-100">
                                        {alerts.map(it => {
                                            const req = findReq(it.requestId);
                                            return (
                                                <tr key={it.requestId} data-invoice-row={it.requestId}>
                                                    {baseCells(it, req)}
                                                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                                                        {it.invoiced > 0 ? `$${formatCop(it.invoiced)}` : <span className="text-red-700 font-bold">Sin facturas</span>}
                                                    </td>
                                                    <td className="px-2 py-1.5 text-right whitespace-nowrap font-bold text-red-700" data-invoice-missing={it.requestId}>
                                                        {it.reason === 'FALTAN_PDF'
                                                            ? `Faltan PDF (${it.uploadedPdfs ?? 0} de ${it.invoiceCount ?? 0})`
                                                            : `$${formatCop(it.missing)}`}
                                                    </td>
                                                    <td className="px-2 py-1.5 text-right whitespace-nowrap space-x-1">
                                                        {req && (
                                                            <button
                                                                onClick={() => onOpenSupports(req)}
                                                                disabled={busyId !== null}
                                                                data-invoice-supports={it.requestId}
                                                                className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 font-bold hover:bg-gray-50 disabled:opacity-50"
                                                                title="Subir los PDF de las facturas"
                                                            >
                                                                Subir PDF
                                                            </button>
                                                        )}
                                                        {req && (
                                                            <button
                                                                onClick={() => onFinalize(req)}
                                                                disabled={busyId !== null}
                                                                className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 font-bold hover:bg-gray-50 disabled:opacity-50"
                                                                title="Cerrar la solicitud aunque falten facturas"
                                                            >
                                                                Cerrar
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => dismiss(it)}
                                                            disabled={busyId !== null}
                                                            data-invoice-dismiss={it.requestId}
                                                            className="px-2 py-1 rounded border border-amber-300 bg-amber-100 text-amber-900 font-bold hover:bg-amber-200 disabled:opacity-50"
                                                        >
                                                            {busyId === it.requestId ? '…' : 'Omitir aviso'}
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                    <div className="flex items-center justify-between text-[11px] text-amber-800">
                        <span>
                            Para completar una: registre las facturas en la hoja y suba sus PDF; al actualizar pasa a «Listas para cerrar». Avisos omitidos: {data.dismissedCount}.
                        </span>
                        <button onClick={load} disabled={loading} className="font-bold hover:underline disabled:opacity-50">
                            {loading ? 'Actualizando…' : '↻ Actualizar'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
