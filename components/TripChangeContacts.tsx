import React from 'react';
import { TripChangeConfig, TripChangeContact } from '../types';
import { formatPhone } from '../utils/phone';

/**
 * #A106 (Yurani y David, 22-oct): a quién llamar cuando ya no se puede pedir el cambio por la
 * plataforma (pasó el plazo) y es urgente. La lista viene del servidor (tabla de MISC, menú 16;
 * el celular, de USUARIOS) en el orden en que se llama. Sin lista (servidor anterior o tabla
 * vacía), el correo del área de viajes, como antes.
 */
const roleText = (c: TripChangeContact) => (c.role ? c.role.charAt(0).toLowerCase() + c.role.slice(1) : '');

const Reach: React.FC<{ c: TripChangeContact }> = ({ c }) => (
  c.phone
    ? <a href={`tel:+57${c.phone}`} className="font-semibold underline whitespace-nowrap">{formatPhone(c.phone)}</a>
    : <span className="font-semibold select-all">{c.email}</span>
);

const contactsOf = (config: TripChangeConfig) => (config.contacts || []).filter(c => c && c.name);

/** En una frase: «llame a Laura Molina (área de viajes), 313 325 1690; si no responde, a Diego Caballero (…), …». */
export const TripChangeContactsInline: React.FC<{ config: TripChangeConfig }> = ({ config }) => {
  const list = contactsOf(config);
  if (!list.length) return <>escríbale al área de viajes: <strong className="select-all">{config.contact}</strong></>;
  return (
    <span data-trip-contacts>
      llame a{' '}
      {list.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && '; si no responde, a '}
          <strong>{c.name}</strong>{c.role ? ` (${roleText(c)})` : ''}, <Reach c={c} />
        </React.Fragment>
      ))}
    </span>
  );
};

/** En un recuadro, uno por renglón. `title` dice cuándo llamar. */
export const TripChangeContactsBox: React.FC<{ config: TripChangeConfig; title: string }> = ({ config, title }) => {
  const list = contactsOf(config);
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700" data-trip-contacts-box>
      <p className="font-bold text-gray-900">{title}</p>
      {list.length ? (
        <ol className="mt-1.5 space-y-1">
          {list.map((c, i) => (
            <li key={i} className="flex flex-wrap gap-x-2">
              <span className="text-gray-500">{i === 0 ? 'Llame a' : 'Si no responde:'}</span>
              <span><strong className="text-gray-900">{c.name}</strong>{c.role ? ` · ${c.role}` : ''} · <Reach c={c} /></span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-1">Escríbale al área de viajes: <span className="font-semibold select-all">{config.contact}</span>.</p>
      )}
    </div>
  );
};
