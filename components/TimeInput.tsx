import React, { useEffect, useRef, useState } from 'react';

// Campo de hora que siempre se lee y se escribe en formato 24 horas (Yurani, 27-oct-2026).
// El <input type="time"> del navegador muestra el formato del idioma del computador: con
// a. m./p. m. es facilísimo equivocarse. Caso real: en la SOL de don Simón se escribió
// «6:22» queriendo decir las 18:22, no se puso p. m., y el vuelo se cotizó a las 6 de la
// mañana. Aquí la hora se ve y se escribe HH:MM de 00:00 a 23:59 (los dos puntos se ponen
// solos), debajo se repite en palabras para que un error salte a la vista, y el reloj del
// navegador sigue disponible con el botón. El valor que entra y sale es 'HH:MM', igual que
// antes, así que nada más cambia.

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
  const textRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  // El valor cambia desde afuera (el reloj, otro campo, una solicitud cargada): se muestra.
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

  const typed = (raw: string) => {
    const next = withColon(raw);
    setText(next);
    const hhmm = toHhmm(next);
    if (hhmm) onChange(hhmm);
    else if (!next) onChange('');
  };

  const openClock = () => {
    const el = pickerRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!el || disabled) return;
    try { if (el.showPicker) { el.showPicker(); return; } } catch { /* sin showPicker: el campo transparente recibe el clic */ }
    el.focus();
  };

  const palabras = enPalabras ? horaEnPalabras(text) : '';

  return (
    <div className={wrapperClassName || ''}>
      <div className="relative">
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
          onClick={openClock}
          disabled={disabled}
          aria-label="Abrir el reloj"
          title="Abrir el reloj"
          className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />
          </svg>
        </button>
        {/* El reloj del navegador. Invisible: solo se usa para elegir; lo que se ve es HH:MM. */}
        <input
          ref={pickerRef}
          type="time"
          tabIndex={-1}
          aria-hidden="true"
          value={toHhmm(value) || ''}
          disabled={disabled}
          onChange={(e) => { setText(toHhmm(e.target.value)); onChange(toHhmm(e.target.value)); }}
          style={{ colorScheme: 'light' }}
          className="absolute right-1 bottom-0 w-8 h-1 opacity-0 pointer-events-none"
        />
      </div>
      {palabras && <p className="text-xs text-gray-500 mt-1" data-hora-en-palabras>Son las {palabras}.</p>}
    </div>
  );
};
