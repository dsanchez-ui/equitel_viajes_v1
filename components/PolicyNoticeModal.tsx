import React, { useEffect, useRef, useState } from 'react';
import { PolicyNotice } from '../types';

interface PolicyNoticeModalProps {
    notice: PolicyNotice;
    /** Deja la constancia en el servidor. Si falla, lanza el error: la ventana lo muestra y deja reintentar. */
    onAcknowledge: () => Promise<void>;
    /** Cerrar sin constancia, solo después de una falla. El aviso vuelve a salir en el próximo ingreso. */
    onSkip: () => void;
}

/**
 * #A100: aviso de cómo funcionan ahora las solicitudes (desde el 15-oct-2026).
 * Lo ve cada solicitante al entrar hasta que toca «Entendido», sin fecha de fin;
 * el servidor guarda la constancia (fecha y correo) en la hoja CONSTANCIA AVISOS.
 * No se cierra con Escape ni haciendo clic afuera: hay que leerlo y tocar «Entendido».
 * Si la constancia no se guarda, se dice (#A49: nunca en silencio) y se puede reintentar.
 */
export const PolicyNoticeModal: React.FC<PolicyNoticeModalProps> = ({ notice, onAcknowledge, onSkip }) => {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    // «Entendido» se habilita al llegar al final del texto (o de una vez si cabe sin desplazarse).
    const [readToEnd, setReadToEnd] = useState(false);
    const bodyRef = useRef<HTMLDivElement>(null);
    const approver = notice.approverName || 'la Vicepresidencia Financiera';

    const checkEnd = () => {
        const el = bodyRef.current;
        if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setReadToEnd(true);
    };
    useEffect(() => {
        checkEnd();
        window.addEventListener('resize', checkEnd);
        return () => window.removeEventListener('resize', checkEnd);
    }, []);

    const handleClick = async () => {
        if (saving) return;
        setSaving(true);
        setError('');
        try { await onAcknowledge(); }
        catch (err) { setError(err instanceof Error && err.message ? err.message : 'Error de conexión.'); }
        finally { setSaving(false); }
    };

    return (
        <div className="fixed inset-0 z-[9000] flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true" aria-labelledby="policy-notice-title">
            <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
                <div className="bg-brand-red text-white rounded-t-lg px-6 py-4">
                    <h2 id="policy-notice-title" className="text-lg sm:text-xl font-bold">Así funcionan ahora las solicitudes de viaje</h2>
                    <p className="text-xs sm:text-sm opacity-90 mt-1">Política de viajes de la organización (manual COM-P-02). Léalo antes de pedir su próximo viaje.</p>
                </div>

                <div ref={bodyRef} onScroll={checkEnd} tabIndex={0} aria-label="Reglas nuevas de las solicitudes" className="px-6 py-5 overflow-y-auto text-sm text-gray-800 leading-relaxed space-y-4 focus:outline-none">
                    <section>
                        <h3 className="font-bold text-gray-900">1. Pida su viaje con anticipación</h3>
                        <p>
                            Viajes <strong>nacionales: mínimo {notice.minDaysNational} días antes</strong>.
                            Viajes <strong>internacionales: mínimo {notice.minDaysInternational} días antes</strong>.
                            Aplica también a las solicitudes de solo hospedaje.
                        </p>
                    </section>

                    <section className="bg-amber-50 border border-amber-200 rounded-md p-3">
                        <h3 className="font-bold text-amber-900">2. Si la pide con menos tiempo, queda en espera</h3>
                        <ul className="list-disc pl-5 mt-1 space-y-1 text-amber-950">
                            <li>La solicitud se crea, pero <strong>debe aprobarla {approver}</strong> antes de que el área de compras la gestione.</li>
                            <li>En el formulario tendrá que escribir <strong>por qué no se pudo pedir antes</strong>. Eso es lo que lee {approver} para decidir.</li>
                            <li>Mientras espera, el área de compras <strong>no cotiza ni compra</strong>. Las aprobaciones se revisan en <strong>horario laboral</strong>: lo que se pida un fin de semana se revisa el siguiente día hábil.</li>
                            <li>En un viaje <strong>multidestino</strong>, si un tramo no cumple, <strong>todo el viaje espera</strong> y se aprueba o se rechaza de una vez.</li>
                            <li>Si no se aprueba en <strong>{notice.expiryDays} días</strong> o antes de la fecha del viaje, queda <strong>denegada</strong>.</li>
                            <li>Le llega un correo cuando se apruebe o se rechace. Si es urgente, comuníquese directamente con {approver}.</li>
                        </ul>
                    </section>

                    <section>
                        <h3 className="font-bold text-gray-900">3. La tarifa del tiquete la fija el manual</h3>
                        <ul className="list-disc pl-5 mt-1 space-y-1">
                            <li>Viajes de <strong>0 a 1 noche: la tarifa más económica</strong> (Basic, solo un artículo pequeño, sin maleta).</li>
                            <li>De 2 a 5 noches, la tarifa con maleta de mano; de 6 noches o más, la que indica el manual.</li>
                            <li>Una tarifa superior a la del manual también <strong>necesita la aprobación de {approver}</strong> antes de comprarse.</li>
                            <li>La maleta de bodega solo procede cuando se viaja con herramienta. Márquelo en el formulario.</li>
                        </ul>
                    </section>

                    <section>
                        <h3 className="font-bold text-gray-900">4. Si pide el viaje de otra persona</h3>
                        <p>Quien programa el viaje responde por el plazo, igual que si fuera propio.</p>
                    </section>

                    <section>
                        <h3 className="font-bold text-gray-900">5. El cumplimiento se mide</h3>
                        <p>Cada mes se revisa el cumplimiento de la política por persona y por unidad de negocio.</p>
                    </section>
                </div>

                {error && (
                    <div role="alert" className="mx-6 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" data-notice-error>
                        No se pudo guardar la constancia de lectura ({error}). Toque «Entendido» otra vez.{' '}
                        <button type="button" onClick={onSkip} className="underline font-bold">Continuar sin guardar</button>
                        {' '}(el aviso le volverá a salir la próxima vez que entre).
                    </div>
                )}
                <div className="border-t px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
                    <p className="text-xs text-gray-500">
                        {readToEnd ? 'Al tocar «Entendido» queda registrado que leyó este aviso.' : 'Baje hasta el final del aviso para continuar.'}
                    </p>
                    <button
                        type="button"
                        onClick={handleClick}
                        disabled={saving || !readToEnd}
                        className="inline-flex justify-center rounded-md bg-brand-red px-6 py-2.5 text-sm font-bold text-white shadow hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-500 disabled:opacity-60"
                    >
                        {saving ? 'Guardando…' : 'Entendido'}
                    </button>
                </div>
            </div>
        </div>
    );
};
