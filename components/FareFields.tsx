import React from 'react';
import {
    FARE_CHECKED_BAG_REASON, FareForm, FareTrip, fareBaggage, fareBaggageLabel, fareCheckedOptionsText, fareDateKey, fareIncludesChecked,
    fareIsException, fareLabel, fareRecommendation, fareShort, normalizeFare,
} from '../utils/fare';

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
    /** Lo que marcó el viajero en la solicitud (#A95): true, false o null si no se preguntó. */
    checkedBaggage?: boolean | null;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const shortDay = (value: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fareDateKey(value));
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
export const FareFields: React.FC<FareFieldsProps> = ({ trip, airline, returnAirline, value, onChange, showErrors, title, checkedBaggage }) => {
    const rec = fareRecommendation(trip);
    const check = normalizeFare(value.option, value.justification, rec.option, airline, returnAirline);
    const option = Number(value.option) || 0;
    const airlines = [airline, returnAirline].filter(Boolean);
    const exception = option > 0 && fareIsException(option, rec.option, airlines);
    const optionText = (n: number) => {
        const name = fareLabel(n, airline, returnAirline);
        return 'TIPO ' + n + (name ? ' · ' + name : '') + ' — ' + fareBaggageLabel(n, airline, returnAirline) + (n === rec.option ? ' (recomendada)' : '');
    };
    // Maleta de bodega pedida y una tarifa que no la incluye (en alguna de las aerolíneas).
    const lacksChecked = checkedBaggage === true && option > 0 && (airlines.length ? airlines : ['']).some(a => !fareIncludesChecked(a, option));
    const pick = (opt: string) => {
        const n = Number(opt) || 0;
        const next = { ...value, option: opt };
        // Si el viajero pidió bodega y se elige otra tarifa que la incluye, se propone el motivo (editable).
        if (checkedBaggage === true && n > 0 && !value.justification.trim() && fareIsException(n, rec.option, airlines)
            && (airlines.length ? airlines : ['']).every(a => fareIncludesChecked(a, n))) {
            next.justification = FARE_CHECKED_BAG_REASON;
        }
        onChange(next);
    };
    return (
        <div className="p-3 border border-teal-200 bg-teal-50 rounded" data-fare-fields>
            <div className="text-xs font-bold text-teal-900 uppercase mb-1">{title}</div>
            <p className="text-xs text-teal-900 mb-2" data-fare-recommended>
                El manual recomienda <strong>{fareShort(rec.option, airline, returnAirline)}</strong>: {fareTripText(trip)}.
            </p>
            {checkedBaggage === true && (
                <p className="text-xs text-teal-900 mb-2" data-fare-checked-bag>
                    🧳 <strong>El viajero pidió maleta de bodega.</strong> Tarifas que la incluyen: {fareCheckedOptionsText()}.
                </p>
            )}
            {checkedBaggage === false && (
                <p className="text-xs text-teal-900 mb-2" data-fare-checked-bag>El viajero no pidió maleta de bodega.</p>
            )}
            <select
                data-fare-option
                className="w-full border border-gray-300 rounded p-2 text-sm bg-white text-gray-900"
                value={value.option}
                onChange={(e) => pick(e.target.value)}
            >
                <option value="">Seleccione…</option>
                {[1, 2, 3].map(n => <option key={n} value={String(n)}>{optionText(n)}</option>)}
            </select>
            {lacksChecked && (
                <p className="text-xs text-amber-800 mt-2" data-fare-lacks-checked>
                    ⚠️ Esta tarifa no incluye maleta de bodega según el manual, y el viajero la pidió.
                </p>
            )}
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
export const FareRecommendationNote: React.FC<{ trip: FareTrip; checkedBaggage?: boolean | null }> = ({ trip, checkedBaggage }) => {
    const rec = fareRecommendation(trip);
    const names = ['Avianca', 'LATAM', 'Clic', 'Satena'].map(a => a + ' ' + fareLabel(rec.option, a)).join(' · ');
    return (
        <p className="text-xs text-teal-900 bg-teal-50 border border-teal-200 rounded p-2 leading-relaxed" data-fare-note>
            <strong>Tarifa a cotizar según el manual (COM-P-02): TIPO {rec.option}</strong> — {fareTripText(trip)}.{' '}
            {names}; otras aerolíneas: {fareBaggage('', rec.option)}.
            {checkedBaggage === true && (
                <span className="block mt-1">🧳 <strong>El viajero pidió maleta de bodega.</strong> Tarifas que la incluyen: {fareCheckedOptionsText()}.</span>
            )}
        </p>
    );
};
