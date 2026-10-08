import React, { useState } from 'react';
import { HOTEL_NAME_MAX, HotelForm, PURCHASE_AIRLINES, PURCHASE_CHANNELS, PurchaseForm, checkHotelForm, checkPurchaseForm, purchaseChannelLabel, purchaseKey } from '../utils/purchase';

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

interface HotelPurchaseFieldsProps {
    isHotelOnly: boolean;
    value: HotelForm;
    onChange: (next: HotelForm) => void;
    /** Mostrar el error de validación (después de intentar guardar). */
    showErrors: boolean;
    title: string;
    hint?: string;
}

/**
 * Hotel reservado y su canal de compra (#A94, pedido de Laura). Lo usa
 * "Registrar reserva" cuando la solicitud lleva hospedaje. En solo hospedaje
 * reemplaza al bloque de compra: su canal es el de la solicitud.
 */
export const HotelPurchaseFields: React.FC<HotelPurchaseFieldsProps> = ({ isHotelOnly, value, onChange, showErrors, title, hint }) => {
    const check = checkHotelForm(value, isHotelOnly);
    const notBooked = !isHotelOnly && value.notBooked;
    return (
        <div className="p-3 border border-indigo-200 bg-indigo-50 rounded" data-hotel-fields>
            <div className="text-xs font-bold text-indigo-900 uppercase mb-2">{title}</div>
            {!notBooked && (
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                    <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Hotel reservado *</label>
                        <input
                            type="text"
                            data-hotel-name
                            maxLength={HOTEL_NAME_MAX}
                            placeholder="Nombre del hotel"
                            className="w-full border border-gray-300 rounded p-2 text-sm bg-white text-gray-900 uppercase"
                            value={value.name}
                            onChange={(e) => onChange({ ...value, name: e.target.value.toUpperCase() })}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Canal de compra del hotel *</label>
                        <select
                            data-hotel-channel
                            className="w-full border border-gray-300 rounded p-2 text-sm bg-white text-gray-900"
                            value={PURCHASE_CHANNELS.find(c => purchaseKey(c) === purchaseKey(value.channel)) || ''}
                            onChange={(e) => onChange({ ...value, channel: e.target.value })}
                        >
                            <option value="">Seleccione…</option>
                            {PURCHASE_CHANNELS.map(c => <option key={c} value={c}>{purchaseChannelLabel(c, true)}</option>)}
                        </select>
                    </div>
                </div>
            )}
            {!isHotelOnly && (
                <label className="flex items-center gap-2 mt-2 text-xs text-gray-700 cursor-pointer">
                    <input
                        type="checkbox"
                        data-hotel-not-booked
                        checked={value.notBooked}
                        onChange={(e) => onChange({ ...value, notBooked: e.target.checked })}
                    />
                    No se reservó hotel (p. ej. lo quitó el aprobador o es un apartamento corporativo)
                </label>
            )}
            {showErrors && !check.ok && <p className="text-xs text-red-600 mt-2" data-hotel-error>{check.error}</p>}
            {hint && !notBooked && <p className="text-[11px] text-indigo-800 mt-2">{hint}</p>}
        </div>
    );
};
