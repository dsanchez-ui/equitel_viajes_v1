import React, { useEffect, useRef, useState } from 'react';

// Botón «Ayuda» del encabezado y su panel de manuales (#A130).
//
// Los manuales NO viajan dentro del JavaScript de la app: son archivos aparte
// en `/manuales/`, con nombre fijo, que publica `npm run build:guia` y verifica
// `tools/check-manuales.cjs`. Meterlos en el bundle rompería la regla de un solo
// archivo (#A96) y le añadiría peso a cada visita.
//
// El panel muestra solo lo que le corresponde al rol. Eso es comodidad, no
// control de acceso: cualquiera que tenga el enlace puede abrir un archivo de
// `/manuales/`. Por eso ahí solo se publica material que puede ver cualquier
// persona de la organización; la guía técnica se queda en el repo.

export type HelpRole = 'REQUESTER' | 'APPROVER' | 'ADMIN';

interface Manual {
  nombre: string;
  desc: string;
  /** Archivo en /manuales/ sin extensión; `html` indica si además hay versión web. */
  archivo: string;
  html: boolean;
  roles: HelpRole[];
  destacado?: boolean;
}

/** Orden en que se muestran. `check-manuales.cjs` compara esta lista con lo publicado. */
export const MANUALES: Manual[] = [
  {
    nombre: 'Cómo se pide y se compra un viaje',
    desc: 'Dos hojas: quién interviene, el camino completo y qué pasa en cada caso.',
    archivo: 'procedimiento', html: true, roles: ['REQUESTER', 'APPROVER', 'ADMIN'], destacado: true,
  },
  {
    nombre: 'Guía del usuario',
    desc: 'Cómo pedir un viaje, describir la selección, cambiarlo y anularlo.',
    archivo: 'guia-usuario', html: true, roles: ['REQUESTER', 'APPROVER', 'ADMIN'],
  },
  {
    nombre: 'La tarifa del tiquete',
    desc: 'Qué tarifa corresponde según las noches del viaje y qué equipaje incluye.',
    archivo: 'tarifas', html: false, roles: ['REQUESTER', 'APPROVER', 'ADMIN'],
  },
  {
    nombre: 'Guía del aprobador',
    desc: 'Qué mirar antes de aprobar y cómo se decide desde el correo o la app.',
    archivo: 'aprobadores', html: false, roles: ['APPROVER', 'ADMIN'],
  },
  {
    nombre: 'Guía del área de compras',
    desc: 'Cotizar, confirmar costos, registrar la reserva, cambios, usuarios y métricas.',
    archivo: 'area-compras', html: true, roles: ['ADMIN'],
  },
  {
    nombre: 'Guía del Google Sheets',
    desc: 'Qué se puede tocar a mano en la hoja, qué no, y los menús de administración.',
    archivo: 'hoja-calculo', html: true, roles: ['ADMIN'],
  },
];

export const manualesPara = (rol: HelpRole): Manual[] =>
  MANUALES.filter((m) => m.roles.indexOf(rol) !== -1);

interface HelpMenuProps {
  rol: HelpRole;
}

export const HelpMenu: React.FC<HelpMenuProps> = ({ rol }) => {
  const [abierto, setAbierto] = useState(false);
  const cajaRef = useRef<HTMLDivElement>(null);
  const lista = manualesPara(rol);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent | TouchEvent) => {
      if (cajaRef.current && !cajaRef.current.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('touchstart', fuera);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('touchstart', fuera);
      document.removeEventListener('keydown', tecla);
    };
  }, [abierto]);

  return (
    <div className="relative" ref={cajaRef}>
      <button
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-haspopup="true"
        title="Manuales y guías del portal"
        className={`inline-flex items-center px-3 py-1.5 border shadow-sm text-xs font-medium rounded focus:outline-none transition-colors ${
          abierto
            ? 'border-brand-red text-white bg-brand-red hover:bg-red-700'
            : 'border-gray-600 text-gray-300 bg-gray-900 hover:bg-gray-800 hover:text-white'
        }`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.5C10.5 5.2 8.6 4.5 6.5 4.5H4v13h2.5c2.1 0 4 .7 5.5 2 1.5-1.3 3.4-2 5.5-2H20v-13h-2.5c-2.1 0-4 .7-5.5 2zm0 0v13" />
        </svg>
        <span className="hidden sm:inline">AYUDA</span>
      </button>

      {abierto && (
        <div
          role="menu"
          aria-label="Manuales del portal"
          className="absolute right-0 top-full mt-2 z-50 w-[22rem] max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto bg-white border border-gray-300 rounded-md shadow-xl"
        >
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-md">
            <p className="text-sm font-bold text-gray-900">Manuales del portal</p>
            <p className="text-xs text-gray-500 mt-0.5">Se abren en otra pestaña. Siempre es la versión vigente.</p>
          </div>

          <ul className="divide-y divide-gray-100">
            {lista.map((m) => (
              <li key={m.archivo} className={`px-4 py-3 ${m.destacado ? 'bg-red-50/60' : ''}`}>
                <p className="text-sm font-semibold text-gray-900 leading-snug">
                  {m.nombre}
                  {m.destacado && (
                    <span className="ml-2 align-middle inline-block rounded bg-brand-red px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      Empieza aquí
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-600 mt-0.5 leading-snug">{m.desc}</p>
                <div className="mt-2 flex items-center gap-2">
                  {m.html && (
                    <a
                      href={`/manuales/${m.archivo}.html`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-800 hover:bg-gray-100"
                    >
                      Abrir
                    </a>
                  )}
                  <a
                    href={`/manuales/${m.archivo}.pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-800 hover:bg-gray-100"
                  >
                    PDF
                  </a>
                </div>
              </li>
            ))}
          </ul>

          <div className="px-4 py-2.5 border-t border-gray-200 bg-gray-50 rounded-b-md">
            <p className="text-[11px] text-gray-500 leading-snug">
              ¿Algo no está claro o falta en los manuales? Escriba a{' '}
              <span className="font-medium text-gray-700">compras.equitel@equitel.com.co</span>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
