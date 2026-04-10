import React, { useEffect, useState } from 'react';
import { MetricsResponse, MetricsFilters, RequestMetrics } from '../types';
import { gasService } from '../services/gasService';

interface MetricsPanelProps {
  onClose: () => void;
}

type DatePreset = 'today' | 'last7' | 'last30' | 'custom' | 'all';

const formatMinutes = (m: number | null | undefined): string => {
  if (m === null || m === undefined) return '—';
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
};

const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '—';
  }
};

const presetToRange = (preset: DatePreset): { dateFrom?: string; dateTo?: string } => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (preset === 'all') return {};
  if (preset === 'today') {
    return { dateFrom: today.toISOString().split('T')[0], dateTo: today.toISOString().split('T')[0] };
  }
  if (preset === 'last7') {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return { dateFrom: from.toISOString().split('T')[0], dateTo: today.toISOString().split('T')[0] };
  }
  if (preset === 'last30') {
    const from = new Date(today);
    from.setDate(from.getDate() - 29);
    return { dateFrom: from.toISOString().split('T')[0], dateTo: today.toISOString().split('T')[0] };
  }
  return {};
};

export const MetricsPanel: React.FC<MetricsPanelProps> = ({ onClose }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [preset, setPreset] = useState<DatePreset>('last30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [requestIdFilter, setRequestIdFilter] = useState('');

  const fetchMetrics = async () => {
    setLoading(true);
    setError(null);
    try {
      let filters: MetricsFilters = {};
      if (preset === 'custom') {
        if (customFrom) filters.dateFrom = customFrom;
        if (customTo) filters.dateTo = customTo;
      } else {
        filters = { ...filters, ...presetToRange(preset) };
      }
      if (requestIdFilter.trim()) filters.requestId = requestIdFilter.trim();
      const response = await gasService.getMetrics(filters);
      setData(response);
    } catch (e: any) {
      setError(e?.message || String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  // Cargar al montar
  useEffect(() => {
    fetchMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="metrics-modal-title" role="dialog" aria-modal="true">
      <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose}></div>
        <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>

        <div className="relative inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-6xl sm:w-full sm:p-6">
          <div className="absolute top-0 right-0 pt-4 pr-4 z-10">
            <button onClick={onClose} className="bg-white rounded-md text-gray-400 hover:text-gray-500 text-2xl font-bold leading-none px-2 focus:outline-none">&times;</button>
          </div>

          <h3 className="text-lg font-bold text-gray-900 mb-1 border-b pb-2 flex items-center gap-2">
            <span>📊</span> Métricas de tiempos
          </h3>
          <p className="text-xs text-gray-500 mb-4">
            Diagnóstico de cuánto tiempo toma cada etapa del flujo. Las solicitudes anteriores al despliegue de métricas no tienen datos de eventos y aparecerán como "—".
          </p>

          {/* Filtros */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Rango de fecha</label>
                <div className="flex gap-1 flex-wrap">
                  {([
                    { v: 'today', l: 'Hoy' },
                    { v: 'last7', l: 'Últimos 7 días' },
                    { v: 'last30', l: 'Últimos 30 días' },
                    { v: 'all', l: 'Todo' },
                    { v: 'custom', l: 'Personalizado' },
                  ] as { v: DatePreset; l: string }[]).map(p => (
                    <button
                      key={p.v}
                      onClick={() => setPreset(p.v)}
                      className={`px-2 py-1 rounded text-[11px] font-medium border ${preset === p.v ? 'bg-brand-red text-white border-brand-red' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'}`}
                    >
                      {p.l}
                    </button>
                  ))}
                </div>
              </div>

              {preset === 'custom' && (
                <>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Desde</label>
                    <input
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Hasta</label>
                    <input
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded text-xs"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">ID de solicitud</label>
                <input
                  type="text"
                  value={requestIdFilter}
                  onChange={(e) => setRequestIdFilter(e.target.value)}
                  placeholder="Ej: SOL-000023"
                  className="px-2 py-1 border border-gray-300 rounded text-xs w-40"
                />
              </div>

              <button
                onClick={fetchMetrics}
                disabled={loading}
                className="px-4 py-1.5 bg-brand-red text-white text-xs font-bold rounded hover:bg-red-700 disabled:opacity-50"
              >
                {loading ? 'Cargando...' : 'Aplicar filtros'}
              </button>
            </div>
          </div>

          {/* Estado de carga / error */}
          {loading && (
            <div className="text-center py-8 text-gray-500 text-sm">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-brand-red mb-2"></div>
              <div>Cargando métricas...</div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded text-sm mb-4">
              <strong>Error:</strong> {error}
            </div>
          )}

          {/* Datos */}
          {!loading && data && (
            <>
              {/* Cards de agregados */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
                <AggregateCard label="Total solicitudes" value={String(data.aggregates.count)} sub={`${data.aggregates.countWithCompleteData} con datos`} accent="gray" />
                <AggregateCard label="⏱️ Tiempo cotización" value={formatMinutes(data.aggregates.avgTimeToOptionsMinutes)} sub="Crear → opciones" accent="red" />
                <AggregateCard label="⏱️ Tiempo selección" value={formatMinutes(data.aggregates.avgTimeToSelectionMinutes)} sub="Opciones → selección" accent="yellow" />
                <AggregateCard label="⏱️ Confirmar costo" value={formatMinutes(data.aggregates.avgTimeToCostConfirmMinutes)} sub="Selección → costo" accent="purple" />
                <AggregateCard label="⏱️ Aprobación total" value={formatMinutes(data.aggregates.avgTimeToFullApprovalMinutes)} sub="Costo → aprobado" accent="green" />
                <AggregateCard label="⏱️ Compra tiquetes" value={formatMinutes(data.aggregates.avgTimeToReservationMinutes)} sub="Aprobado → reserva" accent="blue" />
              </div>

              <div className="text-xs text-gray-500 mb-4 italic">
                Ciclo total promedio (creación → reserva): <strong className="text-gray-700">{formatMinutes(data.aggregates.avgTotalCycleMinutes)}</strong>
              </div>

              {/* Tabla de métricas por solicitud */}
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-4">
                <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                  <h4 className="text-xs font-bold text-gray-700 uppercase">Detalle por solicitud ({data.perRequest.length})</h4>
                </div>
                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-left font-medium text-gray-500">ID</th>
                        <th className="px-2 py-2 text-left font-medium text-gray-500">Solicitante</th>
                        <th className="px-2 py-2 text-left font-medium text-gray-500">Destino</th>
                        <th className="px-2 py-2 text-right font-medium text-gray-500" title="Tiempo de Wendy en cargar opciones">Cotizar</th>
                        <th className="px-2 py-2 text-right font-medium text-gray-500" title="Tiempo del usuario en describir su selección">Seleccionar</th>
                        <th className="px-2 py-2 text-right font-medium text-gray-500" title="Tiempo de Wendy en confirmar costos">Confirmar</th>
                        <th className="px-2 py-2 text-right font-medium text-gray-500" title="Tiempo total de aprobación">Aprobar</th>
                        <th className="px-2 py-2 text-right font-medium text-gray-500" title="Tiempo de Wendy en comprar tiquetes">Comprar</th>
                        <th className="px-2 py-2 text-right font-medium text-gray-500" title="Tiempo del ciclo completo">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.perRequest.length === 0 && (
                        <tr>
                          <td colSpan={9} className="text-center py-8 text-gray-400">Sin solicitudes en este filtro</td>
                        </tr>
                      )}
                      {data.perRequest.map(r => (
                        <RequestMetricsRow key={r.requestId} r={r} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Performance por aprobador */}
              {data.aggregates.approverPerformance.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                    <h4 className="text-xs font-bold text-gray-700 uppercase">Performance por aprobador</h4>
                  </div>
                  <div className="overflow-x-auto max-h-[200px] overflow-y-auto">
                    <table className="min-w-full text-xs">
                      <thead className="bg-gray-100 sticky top-0">
                        <tr>
                          <th className="px-2 py-2 text-left font-medium text-gray-500">Aprobador</th>
                          <th className="px-2 py-2 text-left font-medium text-gray-500">Rol</th>
                          <th className="px-2 py-2 text-right font-medium text-gray-500"># Aprobaciones</th>
                          <th className="px-2 py-2 text-right font-medium text-gray-500">Tiempo promedio</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {data.aggregates.approverPerformance.map(a => (
                          <tr key={a.email}>
                            <td className="px-2 py-2 text-gray-700">{a.email}</td>
                            <td className="px-2 py-2 text-gray-500">{a.role}</td>
                            <td className="px-2 py-2 text-right text-gray-700 font-medium">{a.count}</td>
                            <td className="px-2 py-2 text-right text-gray-700 font-medium">{formatMinutes(a.avgTimeMinutes)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ----- subcomponents -----

interface AggregateCardProps {
  label: string;
  value: string;
  sub?: string;
  accent: 'gray' | 'red' | 'yellow' | 'purple' | 'green' | 'blue';
}

const accentClasses: Record<AggregateCardProps['accent'], string> = {
  gray: 'border-gray-200 bg-gray-50',
  red: 'border-red-200 bg-red-50',
  yellow: 'border-yellow-200 bg-yellow-50',
  purple: 'border-purple-200 bg-purple-50',
  green: 'border-green-200 bg-green-50',
  blue: 'border-blue-200 bg-blue-50',
};

const AggregateCard: React.FC<AggregateCardProps> = ({ label, value, sub, accent }) => (
  <div className={`rounded-lg border p-2 ${accentClasses[accent]}`}>
    <div className="text-[10px] font-bold uppercase text-gray-500 mb-0.5">{label}</div>
    <div className="text-base font-bold text-gray-900">{value}</div>
    {sub && <div className="text-[9px] text-gray-400 mt-0.5">{sub}</div>}
  </div>
);

const RequestMetricsRow: React.FC<{ r: RequestMetrics }> = ({ r }) => {
  const noEvents = !r.hasEvents;
  return (
    <tr className={noEvents ? 'bg-gray-50' : ''}>
      <td className="px-2 py-2 font-medium text-gray-900 whitespace-nowrap">
        {r.requestId}
        {noEvents && <span className="ml-1 text-[9px] text-gray-400" title="Solicitud anterior al despliegue de métricas">(sin datos)</span>}
      </td>
      <td className="px-2 py-2 text-gray-600 truncate max-w-[140px]" title={r.requesterEmail}>{r.requesterEmail}</td>
      <td className="px-2 py-2 text-gray-600 whitespace-nowrap">{r.destination}</td>
      <td className="px-2 py-2 text-right text-gray-700 whitespace-nowrap">{formatMinutes(r.timeToOptionsMinutes)}</td>
      <td className="px-2 py-2 text-right text-gray-700 whitespace-nowrap">{formatMinutes(r.timeToSelectionMinutes)}</td>
      <td className="px-2 py-2 text-right text-gray-700 whitespace-nowrap">{formatMinutes(r.timeToCostConfirmMinutes)}</td>
      <td className="px-2 py-2 text-right text-gray-700 whitespace-nowrap">{formatMinutes(r.timeToFullApprovalMinutes)}</td>
      <td className="px-2 py-2 text-right text-gray-700 whitespace-nowrap">{formatMinutes(r.timeToReservationMinutes)}</td>
      <td className="px-2 py-2 text-right text-gray-900 font-bold whitespace-nowrap">{formatMinutes(r.totalCycleMinutes)}</td>
    </tr>
  );
};
