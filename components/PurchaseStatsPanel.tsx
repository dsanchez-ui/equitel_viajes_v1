import React, { useEffect, useState } from 'react';
import { PurchaseStats, PurchaseStatsFilters } from '../types';
import { gasService } from '../services/gasService';
import { formatCop } from '../utils/money';

/**
 * Pestaña «Compras y costos» del panel de Métricas (#A80). Solo administradores:
 * el backend rechaza `getPurchaseStats` para cualquier otro rol y devuelve solo
 * agregados (sin nombres, cédulas ni correos). Mismas reglas que el reporte en
 * Excel del 29-sep-2026, para que la próxima vez no haya que armarlo a mano.
 */

type Preset = 'all' | 'last30' | 'last90' | 'year' | 'custom';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

const isoLocal = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const presetToRange = (preset: Preset): PurchaseStatsFilters => {
  const today = new Date();
  if (preset === 'last30' || preset === 'last90') {
    const from = new Date(today);
    from.setDate(from.getDate() - (preset === 'last30' ? 29 : 89));
    return { dateFrom: isoLocal(from), dateTo: isoLocal(today) };
  }
  if (preset === 'year') return { dateFrom: `${today.getFullYear()}-01-01`, dateTo: isoLocal(today) };
  return {};
};

const fmtDay = (key: string): string => {
  const [y, m, d] = key.split('-');
  return `${Number(d)}-${MESES[Number(m) - 1]}-${y}`;
};
const fmtMonth = (key: string): string => `${MESES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const num = (n: number | null | undefined, dec = 0): string =>
  n === null || n === undefined ? '—' : n.toLocaleString('es-CO', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const money = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : '$' + formatCop(n));
const pct = (n: number | null | undefined, dec = 0): string => (n === null || n === undefined ? '—' : num(n * 100, dec) + ' %');
const millions = (n: number): string => '$' + num(n / 1e6, n / 1e6 < 100 ? 1 : 0) + ' millones';
const diffVs = (a: number | null, b: number | null): string => {
  if (a === null || b === null || b === 0) return '—';
  const d = (a / b - 1) * 100;
  return (d > 0 ? '+' : '') + num(d, 1) + ' %';
};

// ----- CSV (separador «;» y coma decimal para Excel en español) -----
const csvCell = (v: string | number | null | undefined): string => {
  let s = v === null || v === undefined ? '' : typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : v;
  // Anti inyección de fórmulas: texto que empiece por = + @ tab, o por - sin un número detrás.
  if (typeof v !== 'number' && /^(?:[=+@\t]|-(?!\d))/.test(s)) s = "'" + s;
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const csvPct = (n: number | null): string => (n === null ? '' : num(n * 100, 1) + '%');

function buildCsv(d: PurchaseStats): string {
  const t = d.totals;
  const L: (string | number | null)[][] = [
    ['Compras de tiquetes y hospedaje - Equitel Viajes'],
    [`Periodo: ${fmtDay(d.period.from)} a ${fmtDay(d.period.to)} (${d.period.days} días, ${d.period.businessDays} hábiles)`],
    ['Solo solicitudes compradas (reservadas o procesadas). Costos confirmados en pesos.'],
    [],
    ['Indicador', 'Valor'],
    ['Solicitudes compradas', t.requests], ['Con vuelo', t.flightRequests], ['Solo hospedaje', t.hotelOnlyRequests],
    ['Tiquetes comprados', t.tickets], ['Tiquetes nacionales', t.ticketsNational], ['Tiquetes internacionales', t.ticketsInternational],
    ['Tiquetes por día hábil', t.ticketsPerBusinessDay], ['Tiquetes por mes', t.ticketsPerMonth],
    ['Noches-habitación', t.roomNights], ['Solicitudes con hotel pagado', t.hotelRequests],
    ['Gasto total', t.spend], ['Gasto en tiquetes', t.spendTickets], ['Gasto en hotel', t.spendHotel], ['Gasto anual proyectado', t.annualProjection],
    ['Costo promedio por tiquete nacional', t.avgTicketNational], ['Mediana por tiquete nacional', t.medianTicketNational],
    ['Costo promedio por tiquete internacional', t.avgTicketInternational],
    ['Costo por noche (estadías de 1 a 6 noches)', t.avgNightShort], ['Costo por noche (estadías de 7 noches o más)', t.avgNightLong],
    ['Costo promedio por solicitud', t.avgPerRequest], ['Pasajeros promedio por viaje', t.avgPassengers],
    ['Viajes de ida y regreso', csvPct(t.pctRoundTrip)], ['Viajes internacionales', csvPct(t.pctInternational)],
    ['Anticipación promedio de la compra (días)', t.avgPurchaseLeadDays], ['Tiquetes comprados con 7 días o menos', csvPct(t.pctTicketsLate)],
    ['Solicitudes que incumplen la política de anticipación', csvPct(t.pctPolicyViolation)],
    ['Días promedio entre solicitud y compra', t.avgDaysRequestToPurchase], ['Facturado frente a confirmado', csvPct(t.invoicedVsConfirmed)],
    ['Cargos Aviatur y/o IVA sobre el valor de aerolínea u hotel (factura 1)', csvPct(t.invoice1ChargesPct)],
    [],
    ['Anticipación de la compra (tiquetes nacionales)', 'Solicitudes', 'Tiquetes', 'Costo promedio por tiquete', 'Diferencia vs. 8 días o más'],
    ...d.late.buckets.map((b) => [b.label, b.requests, b.tickets, b.avgTicket, b.avgTicket === null || !d.late.avgEarly ? '' : csvPct(b.avgTicket / d.late.avgEarly - 1)]),
    ['Sobrecosto por comprar con 7 días o menos', '', '', d.late.overcost],
    ['Ahorro anual si se planea la mitad con 8 días o más', '', '', d.late.annualSavingsIfHalfPlanned],
    [],
    ['Mes', 'Solicitudes', 'Tiquetes', 'Noches-habitación', 'Gasto tiquetes', 'Gasto hotel', 'Costo por tiquete', 'Costo por noche (1 a 6 noches)', '% tiquetes con 7 días o menos'],
    ...d.byMonth.map((m) => [fmtMonth(m.month) + (m.partial ? ' (parcial)' : ''), m.requests, m.tickets, m.roomNights, m.spendTickets, m.spendHotel, m.avgTicket, m.avgNightShort, csvPct(m.pctLate)]),
    [],
    ['Ruta', 'Alcance', 'Solicitudes', 'Tiquetes', '% de los tiquetes', 'Costo por tiquete', 'Con 0 a 7 días', 'Con 8 días o más'],
    ...d.topRoutes.map((r) => [r.route, r.international ? 'Internacional' : 'Nacional', r.requests, r.tickets, csvPct(r.share), r.avgTicket, r.avgLate, r.avgEarly]),
    [],
    ['Ciudad', 'Solicitudes con hotel', 'Noches-habitación', 'Costo por noche (todas)', 'Costo por noche (1 a 6 noches)', 'Estadía promedio (noches)'],
    ...d.topCities.map((c) => [c.city, c.requests, c.roomNights, c.avgNight, c.avgNightShort, c.avgStay]),
  ];
  return '﻿' + L.map((row) => row.map(csvCell).join(';')).join('\r\n');
}

// ----- componente -----

export const PurchaseStatsPanel: React.FC = () => {
  const [preset, setPreset] = useState<Preset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PurchaseStats | null>(null);

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: PurchaseStatsFilters = preset === 'custom'
        ? { ...(customFrom ? { dateFrom: customFrom } : {}), ...(customTo ? { dateTo: customTo } : {}) }
        : presetToRange(preset);
      setData(await gasService.getPurchaseStats(filters));
    } catch (e: any) {
      const msg = e?.message || String(e);
      // Frontend nuevo con el backend anterior: el servidor aún no conoce la acción.
      setError(/Acción desconocida/i.test(msg)
        ? 'Esta sección estará disponible cuando se publique la nueva versión del servidor (Apps Script).'
        : msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloadCsv = () => {
    if (!data || data.empty) return;
    const blob = new Blob([buildCsv(data)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compras_tiquetes_hospedaje_${data.period.from}_a_${data.period.to}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  const t = data && !data.empty ? data.totals : null;
  const maxBucket = data && !data.empty ? Math.max(1, ...data.late.buckets.map((b) => b.avgTicket || 0)) : 1;
  const maxMonth = data && !data.empty ? Math.max(1, ...data.byMonth.map((m) => m.tickets)) : 1;

  return (
    <div data-purchase-stats>
      {/* Filtros */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Fecha de compra</label>
            <div className="flex gap-1 flex-wrap">
              {([
                { v: 'all', l: 'Todo' },
                { v: 'last30', l: 'Últimos 30 días' },
                { v: 'last90', l: 'Últimos 90 días' },
                { v: 'year', l: 'Este año' },
                { v: 'custom', l: 'Personalizado' },
              ] as { v: Preset; l: string }[]).map((p) => (
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
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Hasta</label>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs" />
              </div>
            </>
          )}
          <button onClick={fetchStats} disabled={loading} className="px-4 py-1.5 bg-brand-red text-white text-xs font-bold rounded hover:bg-red-700 disabled:opacity-50">
            {loading ? 'Cargando...' : 'Aplicar'}
          </button>
          <button
            onClick={downloadCsv}
            disabled={loading || !t}
            className="ml-auto px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-bold rounded hover:bg-gray-100 disabled:opacity-50"
            title="Descarga todas las tablas en un CSV que abre en Excel"
          >
            📥 Descargar CSV
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-center py-8 text-gray-500 text-sm">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-brand-red mb-2"></div>
          <div>Calculando estadísticas...</div>
        </div>
      )}

      {error && !loading && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded text-sm mb-4 flex items-center justify-between gap-3" data-purchase-error>
          <span><strong>No se pudieron cargar las estadísticas:</strong> {error}</span>
          <button onClick={fetchStats} className="px-3 py-1 bg-white border border-red-300 rounded text-xs font-bold hover:bg-red-100">Reintentar</button>
        </div>
      )}

      {!loading && data && data.empty && (
        <div className="text-center py-8 text-gray-400 text-sm">Aún no hay solicitudes compradas.</div>
      )}

      {!loading && data && t && (
        <>
          <p className="text-xs text-gray-500 mb-3" data-purchase-period>
            Del <strong className="text-gray-700">{fmtDay(data.period.from)}</strong> al <strong className="text-gray-700">{fmtDay(data.period.to)}</strong>
            {' · '}{num(data.period.days)} días · {num(data.period.businessDays)} días hábiles · {num(t.requests)} solicitudes compradas
            ({num(t.flightRequests)} con vuelo, {num(t.hotelOnlyRequests)} solo hospedaje)
          </p>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4" data-purchase-cards>
            <Card label="Tiquetes comprados" value={num(t.tickets)} sub={`${num(t.ticketsNational)} nacionales · ${num(t.ticketsInternational)} internacionales`} accent="blue" />
            <Card label="Tiquetes por día hábil" value={num(t.ticketsPerBusinessDay, 1)} sub={`${num(t.ticketsPerMonth, 0)} al mes`} accent="blue" />
            <Card label="Tiquete nacional" value={money(t.avgTicketNational)} sub={`Mediana ${money(t.medianTicketNational)}`} accent="gray" />
            <Card label="Tiquete internacional" value={money(t.avgTicketInternational)} sub={`${num(t.ticketsInternational)} tiquetes`} accent="gray" />
            <Card label="Noche de hotel (1 a 6 noches)" value={money(t.avgNightShort)} sub={`${num(t.longStays)} estadías de 7+ noches: ${money(t.avgNightLong)}`} accent="green" />
            <Card label="Gasto del periodo" value={money(t.spend)} sub={`Tiquetes ${pct(t.spend ? t.spendTickets / t.spend : null)} · hotel ${pct(t.spend ? t.spendHotel / t.spend : null)}`} accent="gray" />
            <Card label="Proyección anual" value={millions(t.annualProjection)} sub={`Cada 1 % de descuento ≈ ${millions(t.annualProjection * 0.01)}`} accent="purple" />
            <Card label="Compras con 7 días o menos" value={pct(t.pctTicketsLate)} sub={`${pct(t.pctPolicyViolation)} de las solicitudes incumple la política`} accent="red" />
          </div>

          {/* Comprar tarde */}
          <Section title="¿Cuánto cuesta comprar tarde? (tiquetes nacionales)">
            <table className="min-w-full text-xs" data-purchase-late>
              <thead className="bg-gray-100">
                <tr>
                  <Th left>Anticipación de la compra</Th><Th>Solicitudes</Th><Th>Tiquetes</Th><Th>Costo promedio por tiquete</Th><Th>vs. 8 días o más</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.late.buckets.map((b, i) => (
                  <tr key={b.label}>
                    <td className="px-2 py-1.5 text-gray-700 font-medium">{b.label}</td>
                    <Td>{num(b.requests)}</Td>
                    <Td>{num(b.tickets)}</Td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-2 rounded bg-orange-300" style={{ width: `${Math.round(((b.avgTicket || 0) / maxBucket) * 90)}px` }} />
                        <span className="text-gray-800 font-medium w-20 text-right">{money(b.avgTicket)}</span>
                      </div>
                    </td>
                    <td className={`px-2 py-1.5 text-right font-medium ${i < 2 ? 'text-red-700' : 'text-gray-500'}`}>{diffVs(b.avgTicket, data.late.avgEarly)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-3 py-2 text-xs text-gray-600 bg-orange-50 border-t border-orange-100">
              {data.late.overcost > 0 ? (
                <>
                  Comprar con 7 días o menos costó <strong>{money(data.late.overcost)}</strong> más en este periodo que haberlo hecho con 8 días o más.
                  Si la mitad de esas compras se planeara con tiempo, el ahorro sería de unos <strong>{millions(data.late.annualSavingsIfHalfPlanned)}</strong> al año.
                </>
              ) : (
                <>En este periodo comprar con 7 días o menos no salió más caro que con 8 días o más.</>
              )}
              {' '}El equipo de viajes compra en promedio {num(t.avgDaysRequestToPurchase, 1)} días después de la solicitud (mediana {num(t.medianDaysRequestToPurchase)}):
              la anticipación se pierde antes de solicitar el viaje.
            </div>
          </Section>

          {/* Por mes */}
          <Section title="Por mes">
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs" data-purchase-months>
                <thead className="bg-gray-100">
                  <tr>
                    <Th left>Mes</Th><Th>Solicitudes</Th><Th left>Tiquetes</Th><Th>Por día hábil</Th><Th>Noches-hab.</Th><Th>Gasto tiquetes</Th>
                    <Th>Gasto hotel</Th><Th>Costo por tiquete</Th><Th>Noche (1 a 6)</Th><Th>Con ≤7 días</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.byMonth.map((m) => (
                    <tr key={m.month}>
                      <td className="px-2 py-1.5 text-gray-700 font-medium whitespace-nowrap">
                        {fmtMonth(m.month)}{m.partial && <span className="ml-1 text-[9px] text-gray-400">(parcial)</span>}
                      </td>
                      <Td>{num(m.requests)}</Td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 rounded bg-blue-400" style={{ width: `${Math.round((m.tickets / maxMonth) * 80)}px` }} />
                          <span className="text-gray-800 font-medium">{num(m.tickets)}</span>
                        </div>
                      </td>
                      <Td>{num(m.businessDays ? m.tickets / m.businessDays : null, 1)}</Td>
                      <Td>{num(m.roomNights)}</Td>
                      <Td>{money(m.spendTickets)}</Td>
                      <Td>{money(m.spendHotel)}</Td>
                      <Td>{money(m.avgTicket)}</Td>
                      <Td>{money(m.avgNightShort)}</Td>
                      <Td>{pct(m.pctLate)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <div className="grid grid-cols-1 gap-0">
            <Section title={`Rutas principales (${Math.min(10, data.routeCount)} de ${num(data.routeCount)})`}>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs" data-purchase-routes>
                  <thead className="bg-gray-100">
                    <tr><Th left>Ruta</Th><Th>Tiquetes</Th><Th>%</Th><Th>Costo por tiquete</Th><Th>Con 0 a 7 días</Th><Th>Con 8+ días</Th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.topRoutes.map((r) => (
                      <tr key={r.route}>
                        <td className="px-2 py-1.5 text-gray-700 font-medium whitespace-nowrap">
                          {r.route}{r.international && <span className="ml-1 text-[9px] text-blue-600">intl.</span>}
                        </td>
                        <Td>{num(r.tickets)}</Td>
                        <Td>{pct(r.share)}</Td>
                        <Td>{money(r.avgTicket)}</Td>
                        <Td>{money(r.avgLate)}</Td>
                        <Td>{money(r.avgEarly)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title={`Hospedaje por ciudad (${Math.min(10, data.cityCount)} de ${num(data.cityCount)})`}>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs" data-purchase-cities>
                  <thead className="bg-gray-100">
                    <tr><Th left>Ciudad</Th><Th>Solicitudes</Th><Th>Noches-hab.</Th><Th>Noche (1 a 6)</Th><Th>Noche (todas)</Th><Th>Estadía prom.</Th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.topCities.map((c) => (
                      <tr key={c.city}>
                        <td className="px-2 py-1.5 text-gray-700 font-medium whitespace-nowrap">{c.city}</td>
                        <Td>{num(c.requests)}</Td>
                        <Td>{num(c.roomNights)}</Td>
                        <Td>{money(c.avgNightShort)}</Td>
                        <Td>{money(c.avgNight)}</Td>
                        <Td>{num(c.avgStay, 1)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>

          {/* Cómo se viaja */}
          <Section title="Cómo se viaja">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 p-3" data-purchase-habits>
              <Stat label="Pasajeros por viaje" value={num(t.avgPassengers, 2)} sub={`${pct(t.pctSinglePassenger)} viaja solo`} />
              <Stat label="Ida y regreso" value={pct(t.pctRoundTrip)} sub={`Internacionales: ${pct(t.pctInternational, 1)}`} />
              <Stat label="Anticipación de la compra" value={`${num(t.avgPurchaseLeadDays, 1)} días`} sub={`Desde la solicitud: ${num(t.avgRequestLeadDays, 1)} días`} />
              <Stat label="Compras en fin de semana" value={pct(t.pctWeekend)} sub={`Día con más compras: ${DIAS[(data.byWeekday.reduce((a, b) => (b.tickets > a.tickets ? b : a)).day) - 1]}`} />
              <Stat label="Estadía promedio" value={`${num(t.avgStayNights, 1)} noches`} sub={`${num(t.hotelRequests)} solicitudes con hotel`} />
              <Stat label="Costo por solicitud" value={money(t.avgPerRequest)} sub={`${money(t.spendPerMonth)} al mes`} />
              <Stat label="Facturado vs. confirmado" value={t.invoicedVsConfirmed === null ? '—' : (t.invoicedVsConfirmed > 0 ? '+' : '') + num(t.invoicedVsConfirmed * 100, 1) + ' %'} sub="Solicitudes que ya tienen factura" />
              <Stat label="Cargos Aviatur y/o IVA" value={pct(t.invoice1ChargesPct)} sub="Sobre aerolínea u hotel (factura 1)" />
              <Stat label="Noches-habitación" value={num(t.roomNights)} sub={`${num(t.roomNightsPerMonth, 0)} al mes`} />
              <Stat label="Solicitudes por mes" value={num(t.requestsPerMonth, 1)} sub={`${num(t.ticketsPerMonth, 1)} tiquetes al mes`} />
            </div>
          </Section>

          <p className="text-[10px] text-gray-400 leading-relaxed mt-2" data-purchase-notes>
            Solo cuentan las solicitudes reservadas o procesadas. Tiquetes = pasajeros × trayectos (ida y regreso = 2 por persona); cada tramo de un
            multidestino es una solicitud. Noches-habitación = noches × pasajeros, solo con hotel pagado. La fecha de cada compra es la fecha de compra del
            tiquete ({num(data.dataNotes.withoutPurchaseDate)} sin ella usan la de la solicitud). Los costos menores a $10.000 no entran en los promedios
            ({num(data.dataNotes.symbolicCosts)} en el periodo). Los cargos de la factura 1 mezclan IVA, tasas y la tarifa de servicio de la agencia.
            Días hábiles: lunes a viernes sin festivos de Colombia.
          </p>
        </>
      )}
    </div>
  );
};

// ----- subcomponentes -----

const cardAccent: Record<'gray' | 'red' | 'green' | 'purple' | 'blue', string> = {
  gray: 'border-gray-200 bg-gray-50',
  red: 'border-red-200 bg-red-50',
  green: 'border-green-200 bg-green-50',
  purple: 'border-purple-200 bg-purple-50',
  blue: 'border-blue-200 bg-blue-50',
};

const Card: React.FC<{ label: string; value: string; sub?: string; accent: keyof typeof cardAccent }> = ({ label, value, sub, accent }) => (
  <div className={`rounded-lg border p-2 ${cardAccent[accent]}`}>
    <div className="text-[10px] font-bold uppercase text-gray-500 mb-0.5">{label}</div>
    <div className="text-base font-bold text-gray-900">{value}</div>
    {sub && <div className="text-[9px] text-gray-500 mt-0.5">{sub}</div>}
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-4">
    <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
      <h4 className="text-xs font-bold text-gray-700 uppercase">{title}</h4>
    </div>
    {children}
  </div>
);

const Th: React.FC<{ children: React.ReactNode; left?: boolean }> = ({ children, left }) => (
  <th className={`px-2 py-2 font-medium text-gray-500 whitespace-nowrap ${left ? 'text-left' : 'text-right'}`}>{children}</th>
);

const Td: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <td className="px-2 py-1.5 text-right text-gray-700 whitespace-nowrap">{children}</td>
);

const Stat: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div>
    <div className="text-[10px] font-bold uppercase text-gray-500">{label}</div>
    <div className="text-sm font-bold text-gray-900">{value}</div>
    {sub && <div className="text-[9px] text-gray-400">{sub}</div>}
  </div>
);
