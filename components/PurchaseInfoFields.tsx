import React, { useState } from 'react';
import { PURCHASE_AIRLINES, PURCHASE_CHANNELS, normalizePurchaseInfo, purchaseChannelLabel, purchaseKey } from '../utils/purchase';

const OTHER = '__OTRA__';

interface PurchaseInfoFieldsProps {
    isHotelOnly: boolean;
    airline: string;
    channel: string;
    onChange: (next: { airline: string; channel: string }) => void;
    /** Mostrar el error de validación (después de intentar guardar). */
    showErrors: boolean;
    title: string;
    hint?: string;
}

/**
 * Aerolínea y canal de compra (#A82). Lo usan "Confirmar costos" (canal previsto)
 * y "Registrar reserva" (canal real). Solo hospedaje no pide aerolínea.
 */
export const PurchaseInfoFields: React.FC<PurchaseInfoFieldsProps> = ({ isHotelOnly, airline, channel, onChange, showErrors, title, hint }) => {
    const known = PURCHASE_AIRLINES.some(a => purchaseKey(a) === purchaseKey(airline));
    // "Otra" queda activa si la aerolínea guardada no está en la lista.
    const [otherMode, setOtherMode] = useState<boolean>(!!airline.trim() && !known);
    const check = normalizePurchaseInfo(airline, channel, isHotelOnly);
    const selectValue = otherMode ? OTHER : (known ? PURCHASE_AIRLINES.find(a => purchaseKey(a) === purchaseKey(airline)) || '' : '');

    return (
        <div className="p-3 border border-sky-200 bg-sky-50 rounded" data-purchase-fields>
            <div className="text-xs font-bold text-sky-900 uppercase mb-2">{title}</div>
            <div className={`grid gap-3 ${isHotelOnly ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
                {!isHotelOnly && (
                    <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Aerolínea *</label>
                        <select
                            data-purchase-airline
                            className="w-full border border-gray-300 rounded p-2 text-sm bg-white text-gray-900"
                            value={selectValue}
                            onChange={(e) => {
                                if (e.target.value === OTHER) {
                                    setOtherMode(true);
                                    onChange({ airline: '', channel });
                                } else {
                                    setOtherMode(false);
                                    onChange({ airline: e.target.value, channel });
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
                                data-purchase-airline-other
                                maxLength={40}
                                placeholder="Nombre de la aerolínea"
                                className="mt-1 w-full border border-gray-300 rounded p-2 text-sm bg-white text-gray-900"
                                value={airline}
                                onChange={(e) => onChange({ airline: e.target.value, channel })}
                            />
                        )}
                    </div>
                )}
                <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Canal de compra *</label>
                    <select
                        data-purchase-channel
                        className="w-full border border-gray-300 rounded p-2 text-sm bg-white text-gray-900"
                        value={PURCHASE_CHANNELS.find(c => purchaseKey(c) === purchaseKey(channel)) || ''}
                        onChange={(e) => onChange({ airline, channel: e.target.value })}
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
