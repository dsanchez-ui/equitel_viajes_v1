import React, { useEffect, useRef, useState } from 'react';
import { gasService } from '../services/gasService';

interface Props {
  empresa: string;
  unidad: string;
}

interface UsageData {
  hasBudget: boolean;
  monthLabel?: string;
  unit?: string;
  company?: string;
  budgetMonth?: number;
  executedMonth?: number;
  reserveBase?: number;
  percent?: number;
  percentClamped?: number;
  isOverBudget?: boolean;
  reason?: string;
  error?: string;
}

// Cache por sesión con TTL: evita reconsultar la misma unidad mientras el
// usuario edita, pero expira en 5 min para que no muestre cifras stale si el
// solicitante hace varias solicitudes seguidas — cada nueva reserva DEBE
// reflejarse en el % en un tiempo razonable. 5 min es balance entre evitar
// recomputo y mantener la presión psicológica del % al día.
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000;
interface CachedEntry { data: UsageData; ts: number; }
const sessionCache: Map<string, CachedEntry> = new Map();

const cacheKey = (empresa: string, unidad: string) =>
  `${(empresa || '').trim().toLowerCase()}|${(unidad || '').trim().toLowerCase()}`;

/**
 * Invalida el cache de consumo presupuestal. Llamar después de crear o
 * modificar una solicitud para que la próxima vez que se abra el formulario
 * (o se cambie la unidad) se recompute el % consumido con la nueva ejecución
 * incluida — sino el usuario podría ver un % stale hasta por 5 minutos.
 */
export function invalidateBudgetCache() {
  sessionCache.clear();
}

function fmtMoney(n?: number): string {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return '$' + Number(n).toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

function colorTier(percent: number): { bar: string; text: string; bg: string; border: string } {
  if (percent >= 100) {
    return { bar: 'bg-red-600', text: 'text-red-800', bg: 'bg-red-50', border: 'border-red-300' };
  }
  if (percent >= 80) {
    return { bar: 'bg-orange-500', text: 'text-orange-800', bg: 'bg-orange-50', border: 'border-orange-300' };
  }
  if (percent >= 60) {
    return { bar: 'bg-yellow-500', text: 'text-yellow-800', bg: 'bg-yellow-50', border: 'border-yellow-300' };
  }
  return { bar: 'bg-green-600', text: 'text-green-800', bg: 'bg-green-50', border: 'border-green-300' };
}

/**
 * Barra de consumo MENSUAL del presupuesto de la unidad seleccionada.
 *
 * Informativa: no bloquea el envío del formulario. Su propósito es generar
 * sensación de urgencia y desincentivar solicitudes innecesarias cuando el
 * presupuesto se está agotando. El % mostrado incluye un 10% de "reserva"
 * sumado al ejecutado real → aun sin movimiento, la unidad ve 10% consumido.
 *
 * No depende del feature flag `budgetOverrunCheckEnabled` — funciona siempre
 * que la unidad tenga presupuesto definido en PPTOS UNIDADES.
 */
export const BudgetUsageBar: React.FC<Props> = ({ empresa, unidad }) => {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const abortKeyRef = useRef<string>('');

  useEffect(() => {
    // Esperamos a tener AMBOS (empresa + unidad). Unidades con el mismo nombre
    // en distintas empresas (poco común pero posible) producirían lecturas
    // mezcladas si solo tenemos la unidad. Si la empresa no está, ocultamos.
    if (!unidad || !empresa) {
      setData(null);
      setLoading(false);
      return;
    }
    const key = cacheKey(empresa, unidad);
    const cached = sessionCache.get(key);
    if (cached && Date.now() - cached.ts < SESSION_CACHE_TTL_MS) {
      setData(cached.data);
      setLoading(false);
      return;
    }
    // Marca esta llamada como la "activa". Si la unidad cambia antes de que
    // resuelva, ignoramos la respuesta para evitar race conditions.
    abortKeyRef.current = key;
    setLoading(true);
    gasService.getMonthlyBudgetUsage(empresa, unidad)
      .then(res => {
        if (abortKeyRef.current !== key) return; // unidad cambió mientras esperábamos
        sessionCache.set(key, { data: res, ts: Date.now() });
        setData(res);
      })
      .catch(() => {
        if (abortKeyRef.current !== key) return;
        setData({ hasBudget: false, error: 'No se pudo cargar el consumo presupuestal.' });
      })
      .finally(() => {
        if (abortKeyRef.current === key) setLoading(false);
      });
  }, [empresa, unidad]);

  if (!unidad || !empresa) return null;

  if (loading) {
    return (
      <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded text-sm text-gray-500 flex items-center gap-2">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-red"></div>
        Consultando presupuesto de la unidad...
      </div>
    );
  }

  if (!data) return null;

  if (!data.hasBudget) {
    return (
      <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded text-xs text-gray-600">
        <span className="font-medium">Presupuesto:</span> no hay presupuesto configurado para
        {' '}<strong>{unidad}</strong>{data.monthLabel ? ` en ${data.monthLabel}` : ''}.
      </div>
    );
  }

  const pct = typeof data.percent === 'number' ? data.percent : 0;
  const pctBar = Math.min(100, Math.max(0, typeof data.percentClamped === 'number' ? data.percentClamped : pct));
  const tier = colorTier(pct);
  const isOver = data.isOverBudget || pct >= 100;

  let message: string;
  if (isOver) {
    message = `Esta unidad ya excedió su presupuesto de ${data.monthLabel}. Cualquier solicitud nueva agrava el sobregiro y puede requerir aprobación adicional. Por favor, valide si es estrictamente necesaria antes de continuar.`;
  } else if (pct >= 80) {
    message = `Esta unidad ya consumió ${pct.toFixed(1)}% de su presupuesto de ${data.monthLabel}. Antes de continuar, considere si esta solicitud es estrictamente necesaria — cada gasto adicional acerca a la unidad al sobregiro.`;
  } else if (pct >= 60) {
    message = `Esta unidad ha consumido ${pct.toFixed(1)}% de su presupuesto de ${data.monthLabel}. Por favor, considere si esta solicitud es estrictamente necesaria.`;
  } else {
    message = `Esta unidad ha consumido ${pct.toFixed(1)}% de su presupuesto de ${data.monthLabel}. Use el presupuesto con responsabilidad — cada gasto innecesario lo agota más rápido.`;
  }

  return (
    <div className={`mt-2 p-3 border rounded ${tier.bg} ${tier.border}`}>
      <div className="flex justify-between items-center mb-1.5">
        <span className={`text-xs font-bold uppercase tracking-wide ${tier.text}`}>
          Presupuesto {data.monthLabel}
        </span>
        <span className={`text-xs font-bold ${tier.text}`}>
          {pct.toFixed(1)}%{isOver ? ' (excedido)' : ''}
        </span>
      </div>
      <div className="w-full h-3 bg-white rounded overflow-hidden border border-gray-300">
        <div
          className={`h-full ${tier.bar} transition-all duration-500`}
          style={{ width: `${pctBar}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-gray-600 mt-1">
        <span>Ejecutado: {fmtMoney(data.executedMonth)}</span>
        <span>Presupuesto: {fmtMoney(data.budgetMonth)}</span>
      </div>
      <p className={`text-xs mt-2 ${tier.text} leading-snug`}>
        {message}
      </p>
      <p className="text-[10px] text-gray-500 mt-1 italic">
        Nota: el % incluye una reserva del 10% sobre el presupuesto del mes.
      </p>
    </div>
  );
};
