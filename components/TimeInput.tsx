import React, { useEffect, useRef, useState } from 'react';

// Campo de hora que siempre se lee y se escribe en formato 24 horas (Yurani, 27-oct-2026).
// El <input type="time"> del navegador muestra el formato del idioma del computador: con
// a. m./p. m. es facilísimo equivocarse. Caso real: en la SOL de don Simón se escribió
// «6:22» queriendo decir las 18:22, no se puso p. m., y el vuelo se cotizó a las 6 de la
// mañana. Aquí la hora se ve y se escribe HH:MM de 00:00 a 23:59 (los dos puntos se ponen
// solos), debajo se repite en palabras para que un error salte a la vista, y el botón del
// reloj abre una lista de horas cada 15 minutos, también en 24 h. El valor que entra y sale
// es 'HH:MM', igual que antes, así que nada más cambia.
//
// La lista es propia y NO el reloj del navegador (a diferencia del calendario de DateInput):
// el selector nativo de hora solo lo abren las versiones recientes de Chrome y, cuando abre,
// con el navegador en inglés muestra justamente las 12 horas con a. m./p. m. que este campo
// viene a evitar.

/** 'HH:MM' de 24 horas, o '' si no es una hora válida. */
export const toHhmm = (text: string | undefined | null): string => {
  const m = /^\s*([01]?\d|2[0-3]):([0-5]\d)\s*$/.exec(String(text || ''));
  return m ? `${String(Number(m[1])).padStart(2, '0')}:${m[2]}` : '';
};

/** '18:22' → '6:22 de la tarde'. '' si no es una hora. */
export const horaEnPalabras = (hhmm: string | undefined | null): string => {
  const v = toHhmm(hhmm);
  if (!v) return '';
  const h = Number(v.slice(0, 2));
  const franja = h < 6 ? 'de la madrugada' : h < 12 ? 'de la mañana' : h < 13 ? 'del mediodía' : h < 19 ? 'de la tarde' : 'de la noche';
  return `${h % 12 || 12}:${v.slice(3)} ${franja}`;
};

/** Lo que se escribe, con los dos puntos puestos: '1822' → '18:22'. */
const withColon = (raw: string): string => {
  const d = raw.replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
};

/** Horas de la lista: cada 15 minutos, de 00:00 a 23:45. Para el minuto exacto se escribe. */
const PASO_MINUTOS = 15;
const HORAS: string[] = [];
for (let m = 0; m < 24 * 60; m += PASO_MINUTOS) {
  HORAS.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
}

interface TimeInputProps {
  /** 'HH:MM' de 24 horas, o ''. */
  value: string;
  onChange: (hhmm: string) => void;
  required?: boolean;
  disabled?: boolean;
  name?: string;
  id?: string;
  /** Clases del campo visible (las mismas que tenía el campo de hora). */
  className?: string;
  wrapperClassName?: string;
  /** Atributos data-* para pruebas. */
  dataAttrs?: Record<string, string>;
  ariaLabel?: string;
  /** Repetir la hora en palabras debajo del campo. Por defecto sí. */
  enPalabras?: boolean;
}

export const TimeInput: React.FC<TimeInputProps> = ({
  value, onChange, required, disabled, name, id, className, wrapperClassName, dataAttrs, ariaLabel, enPalabras = true,
}) => {
  const [text, setText] = useState(toHhmm(value));
  const [abierta, setAbierta] = useState(false);
  const [haciaArriba, setHaciaArriba] = useState(false);
  const textRef = useRef<HTMLInputElement>(null);
  const cajaRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  // El valor cambia desde afuera (la lista, otro campo, una solicitud cargada): se muestra.
  useEffect(() => {
    if (toHhmm(text) !== (value || '')) setText(toHhmm(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.setCustomValidity(text && !toHhmm(text)
      ? 'Escriba la hora en formato de 24 horas, por ejemplo 18:30 para las 6:30 de la tarde.'
      : '');
  }, [text]);

  // La lista se cierra al tocar por fuera o con Escape, como cualquier menú.
  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: MouseEvent | TouchEvent) => {
      if (cajaRef.current && !cajaRef.current.contains(e.target as Node)) setAbierta(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setAbierta(false); textRef.current?.focus(); }
    };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('touchstart', fuera);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('touchstart', fuera);
      document.removeEventListener('keydown', tecla);
    };
  }, [abierta]);

  // Al abrir, la lista arranca en la hora que ya está escrita (o cerca de ella).
  useEffect(() => {
    if (!abierta || !listaRef.current) return;
    const marcada = listaRef.current.querySelector('[data-hora-actual="si"]') as HTMLElement | null;
    if (marcada) marcada.scrollIntoView({ block: 'center' });
    else listaRef.current.scrollTop = 0;
  }, [abierta]);

  const typed = (raw: string) => {
    const next = withColon(raw);
    setText(next);
    const hhmm = toHhmm(next);
    if (hhmm) onChange(hhmm);
    else if (!next) onChange('');
  };

  const elegir = (hhmm: string) => {
    setText(hhmm);
    onChange(hhmm);
    setAbierta(false);
    textRef.current?.focus();
  };

  const abrirLista = () => {
    if (disabled) return;
    if (abierta) { setAbierta(false); return; }
    // Si el campo está en la mitad de abajo de la pantalla, la lista se abre hacia arriba
    // para que no quede cortada (los formularios van dentro de paneles con scroll).
    const caja = cajaRef.current?.getBoundingClientRect();
    setHaciaArriba(!!caja && caja.bottom > window.innerHeight * 0.55);
    setAbierta(true);
  };

  // La hora escrita, redondeada hacia abajo al cuarto de hora, para marcar dónde arranca la lista.
  const actual = toHhmm(text);
  const marcada = actual
    ? `${actual.slice(0, 2)}:${String(Math.floor(Number(actual.slice(3)) / PASO_MINUTOS) * PASO_MINUTOS).padStart(2, '0')}`
    : '';
  const palabras = enPalabras ? horaEnPalabras(text) : '';

  return (
    <div className={wrapperClassName || ''}>
      <div className="relative" ref={cajaRef}>
        <input
          ref={textRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="HH:MM (24 h)"
          maxLength={5}
          id={id}
          name={name}
          aria-label={ariaLabel}
          required={required}
          disabled={disabled}
          value={text}
          onChange={(e) => typed(e.target.value)}
          className={`${className || ''} pr-10`}
          {...(dataAttrs || {})}
        />
        <button
          type="button"
          onClick={abrirLista}
          disabled={disabled}
          aria-label="Elegir la hora de una lista"
          title="Elegir la hora de una lista"
          aria-expanded={abierta}
          className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />
          </svg>
        </button>
        {abierta && (
          <div
            ref={listaRef}
            role="listbox"
            aria-label="Horas en formato de 24 horas"
            className={`absolute right-0 z-30 w-56 max-h-60 overflow-y-auto bg-white border border-gray-300 rounded-md shadow-lg ${haciaArriba ? 'bottom-full mb-1' : 'top-full mt-1'}`}
          >
            {HORAS.map((h) => {
              const esActual = h === marcada;
              return (
                <button
                  key={h}
                  type="button"
                  role="option"
                  aria-selected={esActual}
                  data-hora-actual={esActual ? 'si' : undefined}
                  onClick={() => elegir(h)}
                  className={`w-full flex items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-100 ${esActual ? 'bg-red-50 font-semibold text-brand-red' : 'text-gray-900'}`}
                >
                  <span className="font-mono tabular-nums">{h}</span>
                  <span className="text-xs text-gray-500">{horaEnPalabras(h)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {palabras && <p className="text-xs text-gray-500 mt-1" data-hora-en-palabras>Son las {palabras}.</p>}
    </div>
  );
};
