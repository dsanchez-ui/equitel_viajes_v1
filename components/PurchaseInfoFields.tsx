import React, { useState } from 'react';
import { PURCHASE_AIRLINES, PURCHASE_CHANNELS, PurchaseForm, checkPurchaseForm, purchaseChannelLabel, purchaseKey } from '../utils/purchase';

const OTHER = '__OTRA__';

interface PurchaseInfoFieldsProps {
    isHotelOnly: boolean;
    /**
     * El viaje tiene regreso y el servidor ya guarda la aerolínea del regreso
     * (#A85). Si es false no se ofrece la casilla «El regreso es con otra aerolínea».
     */
    canSplit: boolean;
    value: PurchaseForm;
    onChange: (next: PurchaseForm) => void;
    /** Mostrar el error de validación (después de intentar guardar). */
    showErrors: boolean;
    title: string;
    hint?: string;
}

interface AirlineSelectProps {
    label: string;
    value: string;
    onChange: (airline: string) => void;
    /** Atributo data-* para ubicar el campo: 'purchase-airline' o 'purchase-return-airline'. */
    name: string;
}

/** Lista de aerolíneas con "Otra…" para escribir una que no esté. */
const AirlineSelect: React.FC<AirlineSelectProps> = ({ label, value, onChange, name }) => {
    const known = PURCHASE_AIRLINES.some(a => purchaseKey(a) === purchaseKey(value));
    // "Otra" queda activa si la aerolínea guardada no está en la lista.
    const [otherMode, setOtherMode] = useState<boolean>(!!value.trim() && !known);
    const selectValue = otherMode ? OTHER : (known ? PURCHASE_AIRLINES.find(a => purchaseKey(a) === purchaseKey(value)) || '' : '');
    return (
        <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">{label}</label>
            <select
                {...{ ['data-' + name]: true }}
                className="w-full border border-gray-300 rounded p-2 text-sm bg-white text-gray-900"
                value={selectValue}
                onChange={(e) => {
                    if (e.target.value === OTHER) {
                        setOtherMode(true);
                        onChange('');
                    } else {
                        setOtherMode(false);
                        onChange(e.target.value);
                    }
                }}
            >
                <option value="">Seleccione…</option>
                {PURCHASE_AIRLINES.map(a => <option key={a} value={a}>{a}</option>)}
                <option value={OTHER}>Otra…</option>
            </select>
            {otherMode && (
                <input
                    type="text"
                    {...{ ['data-' + name + '-other']: true }}
                    maxLength={40}
                    placeholder="Nombre de la aerolínea"
                    className="mt-1 w-full border border-gray-300 rounded p-2 text-sm bg-white text-gray-900"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                />
            )}
        </div>
    );
};

/**
 * Aerolínea y canal de compra (#A82). Lo usan "Confirmar costos" (compra prevista)
 * y "Registrar reserva" (compra real). Solo hospedaje no pide aerolínea. En viajes
 * con regreso se puede indicar otra aerolínea para el regreso (#A85, pedido de
 * Laura: p. ej. LATAM de ida y Avianca de regreso).
 */
export const PurchaseInfoFields: React.FC<PurchaseInfoFieldsProps> = ({ isHotelOnly, canSplit, value, onChange, showErrors, title, hint }) => {
    const check = checkPurchaseForm(value, isHotelOnly, canSplit);
    const split = !isHotelOnly && canSplit && value.splitReturn;

    return (
        <div className="p-3 border border-sky-200 bg-sky-50 rounded" data-purchase-fields>
            <div className="text-xs font-bold text-sky-900 uppercase mb-2">{title}</div>
            <div className={`grid gap-3 ${isHotelOnly ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
                {!isHotelOnly && (
                    <div>
                        <AirlineSelect
                            name="purchase-airline"
                            label={split ? 'Aerolínea de ida *' : 'Aerolínea *'}
                            value={value.airline}
                            onChange={(airline) => onChange({ ...value, airline })}
                        />
                        {canSplit && (
                            <label className="flex items-center gap-2 mt-2 text-xs text-gray-700 cursor-pointer">
                                <input
                                    type="checkbox"
                                    data-purchase-split-return
                                    checked={value.splitReturn}
                                    onChange={(e) => onChange({ ...value, splitReturn: e.target.checked, returnAirline: e.target.checked ? value.returnAirline : '' })}
                                />
                                El regreso es con otra aerolínea
                            </label>
                        )}
                    </div>
                )}
                {split && (
                    <AirlineSelect
                        name="purchase-return-airline"
                        label="Aerolínea del regreso *"
                        value={value.returnAirline}
                        onChange={(returnAirline) => onChange({ ...value, returnAirline })}
                    />
                )}
                <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Canal de compra *</label>
                    <select
                        data-purchase-channel
                        className="w-full border border-gray-300 rounded p-2 text-sm bg-white text-gray-900"
                        value={PURCHASE_CHANNELS.find(c => purchaseKey(c) === purchaseKey(value.channel)) || ''}
                        onChange={(e) => onChange({ ...value, channel: e.target.value })}
                    >
                        <option value="">Seleccione…</option>
                        {PURCHASE_CHANNELS.map(c => <option key={c} value={c}>{purchaseChannelLabel(c, isHotelOnly)}</option>)}
                    </select>
                </div>
            </div>
            {showErrors && !check.ok && <p className="text-xs text-red-600 mt-2" data-purchase-error>{check.error}</p>}
            {hint && <p className="text-[11px] text-sky-800 mt-2">{hint}</p>}
        </div>
    );
};
