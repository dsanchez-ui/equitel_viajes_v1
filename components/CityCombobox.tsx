
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { CityMaster } from '../types';

interface CityComboboxProps {
  name: string;
  value: string;
  cities: CityMaster[];
  isLoading: boolean;
  onChange: (name: string, value: string) => void;
}

export const CityCombobox: React.FC<CityComboboxProps> = ({ name, value, cities, isLoading, onChange }) => {
  const [inputValue, setInputValue] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const sanitize = (v: string) =>
    v.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9\s,]/g, "");

  const filtered = useMemo(() => {
    if (!inputValue.trim()) return cities.slice(0, 80);
    const terms = sanitize(inputValue).split(/[\s,]+/).filter(Boolean);
    return cities.filter(c => {
      const label = `${c.city}, ${c.country}`;
      return terms.every(t => label.includes(t));
    }).slice(0, 80);
  }, [inputValue, cities]);

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [filtered]);

  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const el = listRef.current.children[highlightedIndex] as HTMLElement;
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        // Revert to last valid value if typed text doesn't match
        if (inputValue !== value) setInputValue(value);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [inputValue, value]);

  const selectCity = (city: CityMaster) => {
    const full = `${city.city}, ${city.country}`;
    setInputValue(full);
    onChange(name, full);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => Math.min(prev + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && filtered[highlightedIndex]) {
          selectCity(filtered[highlightedIndex]);
        } else if (filtered.length === 1) {
          selectCity(filtered[0]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setInputValue(value);
        break;
      case 'Tab':
        if (highlightedIndex >= 0 && filtered[highlightedIndex]) {
          selectCity(filtered[highlightedIndex]);
        } else if (filtered.length === 1) {
          selectCity(filtered[0]);
        } else {
          setIsOpen(false);
          if (inputValue !== value) setInputValue(value);
        }
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        autoComplete="off"
        placeholder={isLoading ? "Cargando ciudades..." : "Escriba y seleccione ciudad..."}
        className="mt-1 block w-full bg-white rounded-md border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm border p-2 uppercase text-gray-900"
        value={inputValue}
        disabled={isLoading}
        onChange={(e) => {
          const sanitized = sanitize(e.target.value);
          setInputValue(sanitized);
          setIsOpen(true);
          // Clear selected value when user types (forces re-selection)
          if (sanitized !== value) onChange(name, '');
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {value && (
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
          onClick={() => { setInputValue(''); onChange(name, ''); setIsOpen(true); }}
          tabIndex={-1}
        >
          ×
        </button>
      )}
      {isOpen && filtered.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-gray-300 rounded-md shadow-lg"
        >
          {filtered.map((c, i) => (
            <li
              key={`${c.city}-${c.country}`}
              className={`px-3 py-2 text-sm cursor-pointer ${
                i === highlightedIndex ? 'bg-red-50 text-brand-red font-semibold' : 'text-gray-800 hover:bg-gray-100'
              }`}
              onMouseDown={(e) => { e.preventDefault(); selectCity(c); }}
              onMouseEnter={() => setHighlightedIndex(i)}
            >
              <span className="font-medium">{c.city}</span>
              <span className="text-gray-400 ml-1">, {c.country}</span>
            </li>
          ))}
        </ul>
      )}
      {isOpen && !isLoading && filtered.length === 0 && inputValue.trim() && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg px-3 py-3 text-sm text-gray-500">
          No se encontraron ciudades para "{inputValue}"
        </div>
      )}
    </div>
  );
};
