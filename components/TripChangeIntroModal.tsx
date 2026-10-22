import React, { useState } from 'react';
import { TripChangeConfig } from '../types';
import { TripChangeContactsInline } from './TripChangeContacts';

interface TripChangeIntroModalProps {
  config: TripChangeConfig;
  /** Deja la constancia en el servidor. Si falla, lanza el error: la ventana lo muestra y deja reintentar. */
  onAcknowledge: () => Promise<void>;
  /** Seguir sin constancia (solo después de una falla): la explicación vuelve a salir la próxima vez. */
  onContinueWithoutSaving: () => void;
  onCancel: () => void;
}

/**
 * #A103: explicación de «Cambiar mi viaje» (pedido de David, 20-oct). Sale al tocar el botón de
 * cambio la primera vez; al tocar «Entendido» queda la constancia en CONSTANCIA AVISOS (como el
 * aviso de #A100) y no vuelve a salir, entre desde donde entre. Corta, para leer en un minuto.
 */
export const TripChangeIntroModal: React.FC<TripChangeIntroModalProps> = ({ config, onAcknowledge, onContinueWithoutSaving, onCancel }) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const accept = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try { await onAcknowledge(); }
    catch (err) { setError(err instanceof Error && err.message ? err.message : 'Error de conexión.'); }
    finally { setSaving(false); }
  };

  const point = (icon: string, title: string, text: React.ReactNode) => (
    <li className="flex gap-3">
      <span className="text-2xl leading-none shrink-0" aria-hidden="true">{icon}</span>
      <div>
        <p className="font-bold text-gray-900">{title}</p>
        <p className="text-gray-700">{text}</p>
      </div>
    </li>
  );

  return (
    <div className="fixed inset-0 z-[8500] flex items-center justify-center p-3 sm:p-4 bg-black/60" role="dialog" aria-modal="true" aria-labelledby="trip-change-intro-title" data-trip-change-intro>
      <div className="bg-white rounded-lg shadow-2xl max-w-xl w-full max-h-[92vh] flex flex-col">
        <div className="bg-amber-50 border-b border-amber-200 rounded-t-lg px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="trip-change-intro-title" className="text-lg font-bold text-amber-950 flex items-center gap-2"><span aria-hidden="true">😕</span> Así se cambia un viaje ahora</h2>
            <p className="text-xs text-amber-900 mt-0.5">Lo nuevo, en un minuto. Solo se lo mostramos esta vez.</p>
          </div>
          <button type="button" onClick={onCancel} disabled={saving} className="text-gray-500 hover:text-gray-800 text-2xl leading-none" aria-label="Cerrar">×</button>
        </div>

        <ul className="px-5 py-4 overflow-y-auto space-y-4 text-sm leading-relaxed">
          {point('📱', 'Se pide aquí, ya no por correo, teléfono ni WhatsApp',
            <>Elija el viaje, marque qué cambia (fechas, horas, destino o maleta de bodega) y escriba el motivo. Así queda registrado y su jefe lo aprueba. Si escribe o llama, el área de compras le pedirá que lo haga por aquí.</>)}
          {point('⏰', 'Hasta las 5:00 p. m. del día hábil anterior al vuelo',
            <>Si ese día es sábado, hasta las 12:00 m.; domingos y festivos no cuentan. Si el viaje ya empezó, solo se cambia el regreso. Solo si ya pasó el plazo y es urgente, <TripChangeContactsInline config={config} />.</>)}
          {point('💰', 'Si el tiquete ya está comprado, el cambio tiene costo',
            <>La penalidad y la diferencia de tarifa. Lo aprueba su jefe, que ve cuánto costó el viaje y cuánto suma el cambio. Agregar la maleta después también cuesta: si cree que la va a necesitar, márquela al pedir el viaje.</>)}
          {point('✈️', 'Su tiquete actual sigue siendo el válido',
            <>Hasta que le llegue el nuevo por correo.</>)}
        </ul>

        {error && (
          <div className="mx-5 mb-2 bg-red-50 border border-red-200 text-red-800 rounded-md p-3 text-sm" role="alert" data-trip-change-intro-error>
            No se pudo guardar que lo leyó ({error}). Puede reintentar o seguir; si sigue, se lo mostramos otra vez la próxima vez.
          </div>
        )}

        <div className="border-t px-5 py-3 flex flex-wrap justify-end gap-2 bg-gray-50 rounded-b-lg">
          {error ? (
            <>
              <button type="button" onClick={onContinueWithoutSaving} className="px-4 py-2 rounded border border-gray-300 text-gray-700 text-xs font-bold uppercase tracking-wide bg-white">Seguir sin guardar</button>
              <button type="button" onClick={accept} disabled={saving} className="bg-brand-red text-white px-4 py-2 rounded text-xs font-bold uppercase tracking-wide hover:bg-red-700 disabled:opacity-60">
                {saving ? 'Guardando…' : 'Reintentar'}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onCancel} disabled={saving} className="px-4 py-2 rounded border border-gray-300 text-gray-700 text-xs font-bold uppercase tracking-wide bg-white">Ahora no</button>
              <button type="button" onClick={accept} disabled={saving} data-trip-change-intro-ok className="bg-brand-red text-white px-4 py-2 rounded text-xs font-bold uppercase tracking-wide hover:bg-red-700 disabled:opacity-60">
                {saving ? 'Guardando…' : 'Entendido, continuar'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
