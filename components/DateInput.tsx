import React, { useEffect, useRef, useState } from 'react';

// Campo de fecha que siempre se lee y se escribe DD/MM/AAAA (David, 21-oct-2026).
// El <input type="date"> del navegador muestra el formato del idioma del computador:
// con el navegador en inglés sale MM/DD/AAAA, y en Colombia eso confunde. Aquí la
// fecha se ve y se escribe día/mes/año (las barras se ponen solas) y el calendario
// del navegador sigue disponible con el botón. El valor que entra y sale es
// 'AAAA-MM-DD', igual que antes, así que nada más cambia.

/** 'AAAA-MM-DD' → 'DD/MM/AAAA' ('' si no es una fecha). */
export const isoToDmy = (iso: string | undefined | null): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/** 'DD/MM/AAAA' (también con - o .) → 'AAAA-MM-DD'; '' si no es una fecha que exista. */
export const dmyToIso = (text: string | undefined | null): string => {
  const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s*$/.exec(String(text || ''));
  if (!m) return '';
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** Lo que se escribe, con las barras puestas: '04112026' → '04/11/2026'. */
const withSlashes = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length > 4) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return digits;
};

interface DateInputProps {
  /** 'AAAA-MM-DD' o ''. */
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  name?: string;
  id?: string;
  /** Clases del campo visible (las mismas que tenía el campo de fecha). */
  className?: string;
  /** Ancho del campo, si no ocupa toda la fila (p. ej. 'w-full sm:w-56'). */
  wrapperClassName?: string;
  /** Atributos data-* para pruebas (p. ej. {'data-change-field': 'dep'}). */
  dataAttrs?: Record<string, string>;
  ariaLabel?: string;
}

export const DateInput: React.FC<DateInputProps> = ({ value, onChange, min, max, required, disabled, name, id, className, wrapperClassName, dataAttrs, ariaLabel }) => {
  const [text, setText] = useState(isoToDmy(value));
  const textRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  // El valor cambia desde afuera (el calendario, otro campo, una solicitud cargada): se muestra.
  useEffect(() => {
    if (dmyToIso(text) !== (value || '')) setText(isoToDmy(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Validación del navegador: la misma que tenía el campo de fecha (formato, mínimo y máximo).
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const iso = dmyToIso(text);
    let msg = '';
    if (text && !iso) msg = 'Escriba la fecha como día/mes/año, por ejemplo 04/11/2026.';
    else if (iso && min && iso < min) msg = `La fecha no puede ser antes del ${isoToDmy(min)}.`;
    else if (iso && max && iso > max) msg = `La fecha no puede ser después del ${isoToDmy(max)}.`;
    el.setCustomValidity(msg);
  }, [text, min, max]);

  const typed = (raw: string) => {
    const next = withSlashes(raw);
    setText(next);
    const iso = dmyToIso(next);
    if (iso) onChange(iso);
    else if (!next) onChange('');
  };

  const openCalendar = () => {
    const el = pickerRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!el || disabled) return;
    try { if (el.showPicker) { el.showPicker(); return; } } catch { /* sin showPicker: el campo transparente recibe el clic */ }
    el.focus();
  };

  return (
    <div className={`relative ${wrapperClassName || ''}`}>
      <input
        ref={textRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/AAAA"
        maxLength={10}
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
        onClick={openCalendar}
        disabled={disabled}
        aria-label="Abrir el calendario"
        title="Abrir el calendario"
        className="absolute right-1 top-1/2 -translate-y-1/2 mt-0.5 p-1.5 rounded text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </button>
      {/* El calendario del navegador. Invisible: solo se usa para elegir; lo que se ve es DD/MM/AAAA. */}
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value || ''}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => { setText(isoToDmy(e.target.value)); onChange(e.target.value); }}
        style={{ colorScheme: 'light' }}
        className="absolute right-1 bottom-0 w-8 h-1 opacity-0 pointer-events-none"
      />
    </div>
  );
};
