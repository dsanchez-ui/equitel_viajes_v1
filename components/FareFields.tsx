import React from 'react';
import { FareForm, FareTrip, fareBaggage, fareIsException, fareLabel, fareRecommendation, fareShort, normalizeFare } from '../utils/fare';

interface FareFieldsProps {
    trip: FareTrip;
    /** Aerolínea elegida en el bloque de compra (la de ida) y la del regreso si es otra. */
    airline: string;
    returnAirline?: string;
    value: FareForm;
    onChange: (next: FareForm) => void;
    /** Mostrar el error de validación (después de intentar guardar). */
    showErrors: boolean;
    title: string;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const shortDay = (key: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key || '');
    return m ? Number(m[3]) + '-' + MONTHS[Number(m[2]) - 1] : '';
};

/** «viaje de 3 noches (20-oct → 23-oct)» o «solo ida, 4 noches de hotel». */
export function fareTripText(trip: FareTrip): string {
    const rec = fareRecommendation(trip);
    const nights = rec.nights === 1 ? '1 noche' : rec.nights + ' noches';
    if (rec.byDates) return 'viaje de ' + nights + ' (' + shortDay(String(trip.departureDate)) + ' → ' + shortDay(String(trip.returnDate)) + ')';
    return rec.nights ? 'solo ida, ' + nights + ' de hotel' : 'solo ida, sin noches';
}

/**
 * Tarifa del tiquete según el manual COM-P-02 (#A95). Muestra la recomendada por las
 * noches del viaje, deja elegir otra y, si lo es, pide por qué.
 */
export const FareFields: React.FC<FareFieldsProps> = ({ trip, airline, returnAirline, value, onChange, showErrors, title }) => {
    const rec = fareRecommendation(trip);
    const check = normalizeFare(value.option, value.justification, rec.option, airline, returnAirline);
    const option = Number(value.option) || 0;
    const exception = option > 0 && fareIsException(option, rec.option, [airline, returnAirline].filter(Boolean));
    const optionText = (n: number) => {
        const name = fareLabel(n, airline, returnAirline);
        return 'TIPO ' + n + (name ? ' · ' + name : '') + ' — ' + fareBaggage(airline, n) + (n === rec.option ? ' (recomendada)' : '');
    };
    return (
        <div className="p-3 border border-teal-200 bg-teal-50 rounded" data-fare-fields>
            <div className="text-xs font-bold text-teal-900 uppercase mb-1">{title}</div>
            <p className="text-xs text-teal-900 mb-2" data-fare-recommended>
                El manual recomienda <strong>{fareShort(rec.option, airline, returnAirline)}</strong>: {fareTripText(trip)}.
            </p>
            <select
                data-fare-option
                className="w-full border border-gray-300 rounded p-2 text-sm bg-white text-gray-900"
                value={value.option}
                onChange={(e) => onChange({ ...value, option: e.target.value })}
            >
                <option value="">Seleccione…</option>
                {[1, 2, 3].map(n => <option key={n} value={String(n)}>{optionText(n)}</option>)}
            </select>
            {exception && (
                <div className="mt-2">
                    <label className="block text-xs font-bold text-amber-900 mb-1">¿Por qué otra tarifa? *</label>
                    <textarea
                        data-fare-justification
                        rows={2}
                        maxLength={500}
                        placeholder="Ej: el viajero lleva equipo en bodega / el aprobador pidió tarifa con maleta…"
                        className="w-full border border-amber-300 rounded p-2 text-sm bg-white text-gray-900"
                        value={value.justification}
                        onChange={(e) => onChange({ ...value, justification: e.target.value })}
                    />
                </div>
            )}
            {showErrors && !check.ok && <p className="text-xs text-red-600 mt-2" data-fare-error>{check.error}</p>}
        </div>
    );
};

/**
 * Aviso al cargar opciones (#A95): qué tarifa cotizar según el manual, con su nombre
 * en las aerolíneas del manual.
 */
export const FareRecommendationNote: React.FC<{ trip: FareTrip }> = ({ trip }) => {
    const rec = fareRecommendation(trip);
    const names = ['Avianca', 'LATAM', 'Clic', 'Satena'].map(a => a + ' ' + fareLabel(rec.option, a)).join(' · ');
    return (
        <p className="text-xs text-teal-900 bg-teal-50 border border-teal-200 rounded p-2 leading-relaxed" data-fare-note>
            <strong>Tarifa a cotizar según el manual (COM-P-02): TIPO {rec.option}</strong> — {fareTripText(trip)}.{' '}
            {names}; otras aerolíneas: {fareBaggage('', rec.option)}.
        </p>
    );
};
