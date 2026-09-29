#!/usr/bin/env node
/**
 * Verifica las estadísticas de compra de tiquetes y hospedaje (#A80): corre
 * `server/Code.gs` completo en un contexto aislado con una hoja SINTÉTICA (sin
 * datos reales) y compara `getPurchaseStats` con resultados calculados a mano.
 *
 * Reglas que protege (las mismas del reporte en Excel del 29-sep-2026):
 *   - solo cuentan RESERVADO y PROCESADO;
 *   - tiquetes = pasajeros × 2 con regreso (× 1 sin regreso); solo hospedaje = 0;
 *   - la ruta no depende del sentido (BOGOTA ↔ MEDELLIN);
 *   - costos menores a $10.000 no entran en los promedios;
 *   - hotel pagado con 0 noches → noches según las fechas; noches × pasajeros;
 *   - fecha de la compra = fecha de compra o, si falta, la de la solicitud;
 *   - anticipación = ida − compra; negativa = sin dato;
 *   - días hábiles sin festivos de Colombia (Ley Emiliani), cualquier año;
 *   - solo administradores (adminOnlyActions) y sin datos personales en la respuesta.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function deepStub(name) {
  const f = function () { return deepStub(name + '()'); };
  return new Proxy(f, { get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : deepStub(name + '.' + String(k))) });
}

const bogota = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
function formatDate(d, tz, fmt) {
  const p = Object.fromEntries(bogota.formatToParts(d).map((x) => [x.type, x.value]));
  const map = { yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour === '24' ? '00' : p.hour, mm: p.minute, ss: p.second, M: String(+p.month), d: String(+p.day), H: String(+p.hour % 24) };
  return fmt.replace(/yyyy|MM|dd|HH|mm|ss|M|d|H/g, (t) => map[t]);
}

// Hoja sintética. Fechas como 'AAAA-MM-DDTHH:MM' en hora de Bogotá; '' = vacío.
const HEADERS = ['ID RESPUESTA', 'STATUS', 'MODO_SOLICITUD', 'ES INTERNACIONAL', 'CIUDAD ORIGEN', 'CIUDAD DESTINO', 'FECHA SOLICITUD',
  'FECHA DE COMPRA DE TIQUETE', 'FECHA IDA', 'FECHA VUELTA', '# PERSONAS QUE VIAJAN', 'COSTO_FINAL_TIQUETES', 'COSTO_FINAL_HOTEL',
  '# NOCHES (AUTOMÁTICO)', 'DIAS DE ANTELACION TKT', 'VIOLACION POLITICA', 'TOTAL FACTURA', 'VALOR PAGADO A AEROLINEA Y/O HOTEL',
  'VALOR PAGADO A AVIATUR Y/O IVA', 'NOMBRE PERSONA 1', 'CÉDULA PERSONA 1', 'CORREO ENCUESTADO'];
const ROWS = [
  // ida y regreso, 1 pasajero, comprado con 2 días; hotel 2 noches
  ['SOL-1', 'PROCESADO', 'VIAJE', 'NO', 'BOGOTA, COLOMBIA', 'MEDELLIN, COLOMBIA', '2026-06-30T09:00', '2026-07-01', '2026-07-03', '2026-07-05', 1, 800000, 300000, 2, 3, 'SI', 1100000, 800000, 300000, 'PERSONA UNO PRUEBA', '90000001', 'uno@prueba.co'],
  // misma ruta al revés, solo ida, 2 pasajeros, comprado con 19 días
  ['SOL-2', 'RESERVADO', 'VIAJE', 'NO', 'MEDELLIN, COLOMBIA', 'BOGOTA, COLOMBIA', '2026-06-30T10:00', '2026-07-01', '2026-07-20', '', 2, 600000, 0, 0, 20, 'NO', '', '', '', 'PERSONA DOS PRUEBA', '90000002', 'dos@prueba.co'],
  // no compradas: no cuentan
  ['SOL-3', 'APROBADO', 'VIAJE', 'NO', 'BOGOTA, COLOMBIA', 'CALI, COLOMBIA', '2026-07-01T08:00', '', '2026-07-09', '2026-07-10', 3, 900000, 0, 0, 8, 'NO', '', '', '', 'PERSONA TRES PRUEBA', '90000003', 'tres@prueba.co'],
  ['SOL-4', 'ANULADO', 'VIAJE', 'NO', 'BOGOTA, COLOMBIA', 'CALI, COLOMBIA', '2026-07-01T08:00', '2026-07-02', '2026-07-09', '2026-07-10', 1, 500000, 0, 0, 8, 'NO', '', '', '', 'PERSONA CUATRO PRUEBA', '90000004', 'cuatro@prueba.co'],
  // solo hospedaje sin fecha de compra (usa la solicitud, de noche en Bogotá); estadía larga de 10 noches
  ['SOL-5', 'PROCESADO', 'SOLO_HOSPEDAJE', 'NO', '', 'CALI, COLOMBIA', '2026-07-06T22:30', '', '2026-07-06', '2026-07-16', 1, 0, 900000, 10, 0, 'SI', 900000, 756303, 143697, 'PERSONA CINCO PRUEBA', '90000005', 'cinco@prueba.co'],
  // costo simbólico de $1: cuenta los tiquetes, no entra en promedios
  ['SOL-6', 'PROCESADO', 'VIAJE', 'NO', 'CALI, COLOMBIA', 'PEREIRA, COLOMBIA', '2026-07-01T08:00', '2026-07-02', '2026-07-04', '2026-07-05', 1, 1, 0, 0, 3, 'SI', '', '', '', 'PERSONA SEIS PRUEBA', '90000006', 'seis@prueba.co'],
  // hotel pagado con 0 noches registradas: 2 noches según las fechas; comprado con 10 días
  ['SOL-7', 'PROCESADO', 'VIAJE', 'NO', 'CALI, COLOMBIA', 'PEREIRA, COLOMBIA', '2026-07-02T08:00', '2026-07-03', '2026-07-13', '2026-07-15', 1, 500000, 360000, 0, 11, 'NO', '', '', '', 'PERSONA SIETE PRUEBA', '90000007', 'siete@prueba.co'],
  // internacional, ida y regreso
  ['SOL-8', 'PROCESADO', 'VIAJE', 'SI', 'BOGOTA, COLOMBIA', 'Quito, Ecuador', '2026-07-06T08:00', '2026-07-07', '2026-08-20', '2026-08-25', 1, 2000000, 0, 0, 45, 'NO', '', '', '', 'PERSONA OCHO PRUEBA', '90000008', 'ocho@prueba.co'],
  // compra registrada después de la ida: sin dato de anticipación
  ['SOL-9', 'PROCESADO', 'VIAJE', 'NO', 'BOGOTA, COLOMBIA', 'CALI, COLOMBIA', '2026-07-07T08:00', '2026-07-10', '2026-07-08', '', 1, 350000, 0, 0, 1, 'SI', '', '', '', 'PERSONA NUEVE PRUEBA', '90000009', 'nueve@prueba.co'],
  // 2 pasajeros, solo ida, hotel de 7 noches (estadía larga): noches-habitación = 7 × 2
  ['SOL-10', 'PROCESADO', 'VIAJE', 'NO', 'BOGOTA, COLOMBIA', 'CARTAGENA, COLOMBIA', '2026-07-07T08:00', '2026-07-08', '2026-07-20', '', 2, 1200000, 1400000, 7, 13, 'NO', '', '', '', 'PERSONA DIEZ PRUEBA', '90000010', 'diez@prueba.co'],
  // fila sin ID: se ignora
  ['', 'PROCESADO', 'VIAJE', 'NO', 'BOGOTA, COLOMBIA', 'CALI, COLOMBIA', '2026-07-07T08:00', '2026-07-08', '2026-07-09', '', 1, 999999, 0, 0, 1, 'NO', '', '', '', '', '', ''],
];

function loadBackend() {
  const code = fs.readFileSync(path.join(ROOT, 'server', 'Code.gs'), 'utf8');
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Utilities: { formatDate },
    Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, getProperties: () => ({}), setProperty() {}, deleteProperty() {}, getKeys: () => [] }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {}, getAll: () => ({}), putAll() {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true }) },
    Session: { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => '' }) },
    __rows: JSON.stringify([HEADERS, ...ROWS]),
  };
  for (const g of ['DriveApp', 'GmailApp', 'MailApp', 'HtmlService', 'ScriptApp', 'ContentService', 'UrlFetchApp', 'CalendarApp']) ctx[g] = deepStub(g);
  vm.createContext(ctx);
  vm.runInContext(`
    var __table = JSON.parse(__rows).map(function (r, i) {
      return i === 0 ? r : r.map(function (v, j) {
        return (typeof v === 'string' && /^\\d{4}-\\d{2}-\\d{2}/.test(v) && /FECHA/.test(JSON.parse(__rows)[0][j]))
          ? new Date(v.length === 10 ? v + 'T00:00:00-05:00' : v + ':00-05:00') : v;
      });
    });
    var SpreadsheetApp = { getActiveSpreadsheet: function () { return { getSheetByName: function (n) {
      if (n !== 'Nueva Base Solicitudes') return null;
      return {
        getLastRow: function () { return __table.length; },
        getLastColumn: function () { return __table[0].length; },
        getRange: function (r, c, nr, nc) { return { getValues: function () {
          return __table.slice(r - 1, r - 1 + (nr || 1)).map(function (row) { return row.slice(c - 1, c - 1 + (nc || 1)); });
        } }; }
      };
    } }; } };
  `, ctx);
  new vm.Script(code, { filename: 'Code.gs' }).runInContext(ctx);
  if (typeof ctx.getPurchaseStats !== 'function') throw new Error('No se encontró getPurchaseStats() en server/Code.gs');
  return ctx;
}

function main() {
  let ctx;
  try {
    ctx = loadBackend();
  } catch (e) {
    console.error('✗ No se pudo cargar server/Code.gs para las estadísticas de compra:\n  ' + e.message);
    process.exit(1);
  }
  const failures = [];
  const eq = (name, got, want) => {
    const ok = typeof want === 'number' ? typeof got === 'number' && Math.abs(got - want) < 1e-6 : JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failures.push(`${name}: da ${JSON.stringify(got)}, se esperaba ${JSON.stringify(want)}`);
  };

  const s = ctx.getPurchaseStats({});
  const t = s.totals;
  eq('periodo', [s.period.from, s.period.to, s.period.days, s.period.businessDays], ['2026-07-01', '2026-07-10', 10, 8]);
  eq('solicitudes compradas (sin APROBADO, ANULADO ni fila sin ID)', [t.requests, t.flightRequests, t.hotelOnlyRequests], [8, 7, 1]);
  eq('tiquetes (ida y regreso × 2, 2 pasajeros solo ida = 2)', [t.tickets, t.ticketsNational, t.ticketsInternational], [13, 11, 2]);
  eq('costo por tiquete nacional (sin el costo de $1)', t.avgTicketNational, (800000 + 600000 + 500000 + 350000 + 1200000) / 9);
  eq('costo por tiquete internacional', t.avgTicketInternational, 1000000);
  eq('mediana por tiquete nacional', t.medianTicketNational, 350000);
  eq('noches-habitación (fechas si hay 0 noches con hotel pagado; noches × pasajeros)', [t.roomNights, t.hotelRequests], [28, 4]);
  eq('noche en estadías de 1 a 6 noches', t.avgNightShort, (300000 + 360000) / 4);
  eq('noche en estadías de 7 noches o más', [t.avgNightLong, t.longStays], [(900000 + 1400000) / 24, 2]);
  eq('gasto', [t.spend, t.spendTickets, t.spendHotel], [8410001, 5450001, 2960000]);
  eq('ida y regreso', t.pctRoundTrip, 4 / 7);
  eq('anticipación de la compra (sin la negativa)', t.avgPurchaseLeadDays, (2 + 19 + 2 + 10 + 44 + 12) / 6);
  eq('tiquetes con 7 días o menos', t.pctTicketsLate, 4 / 12);
  eq('solicitud → compra', [t.avgDaysRequestToPurchase, t.medianDaysRequestToPurchase], [(1 + 1 + 1 + 1 + 1 + 3 + 1) / 7, 1]);
  eq('incumplen la política', t.pctPolicyViolation, 4 / 8);
  eq('cargos de la factura 1', t.invoice1ChargesPct, (300000 + 143697) / (800000 + 756303));
  eq('facturado vs. confirmado', t.invoicedVsConfirmed, (1100000 + 900000) / (1100000 + 900000) - 1);
  eq('comprar tarde: rangos', s.late.buckets.map((b) => [b.tickets, b.ticketsWithCost, b.avgTicket]),
    [[4, 2, 400000], [0, 0, null], [4, 4, 425000], [2, 2, 300000], [0, 0, null]]);
  eq('comprar tarde: 8+ días y sobrecosto', [s.late.avgEarly, s.late.overcost, s.late.noLead.tickets], [2300000 / 6, (400000 - 2300000 / 6) * 2, 1]);
  eq('ruta sin importar el sentido', [s.topRoutes[0].route, s.topRoutes[0].tickets], ['BOGOTA ↔ MEDELLIN', 4]);
  eq('ruta internacional', s.topRoutes.find((r) => r.international).route, 'BOGOTA ↔ QUITO (ECUADOR)');
  eq('ciudades: empate en solicitudes → más noches primero', [s.topCities[0].city, s.topCities[0].roomNights, s.topCities[1].city], ['CARTAGENA', 14, 'CALI']);
  eq('solicitud de noche en Bogotá cae en su día', s.byWeekday[0], { day: 1, requests: 1, tickets: 0 });
  eq('notas de calidad', s.dataNotes, { symbolicCosts: 1, withoutPurchaseDate: 1, purchaseAfterDeparture: 1 });

  const jul = ctx.getPurchaseStats({ dateFrom: '2026-07-01', dateTo: '2026-07-31' });
  eq('julio: días hábiles (20-jul festivo)', jul.period.businessDays, 22);
  eq('julio: mes completo', [jul.byMonth.length, jul.byMonth[0].partial], [1, false]);
  let err = '';
  try { ctx.getPurchaseStats({ dateFrom: '2026-08-01', dateTo: '2026-07-01' }); } catch (e) { err = e.message; }
  eq('fechas invertidas', /posterior/.test(err), true);
  err = '';
  try { ctx.getPurchaseStats({ dateFrom: '1900-01-01', dateTo: '2026-07-31' }); } catch (e) { err = e.message; }
  eq('periodo de más de 10 años', /10 años/.test(err), true);
  eq('sin compras en el periodo', ctx.getPurchaseStats({ dateFrom: '2030-01-01', dateTo: '2030-01-02' }).totals.tickets, 0);

  const fest = (y) => Object.keys(ctx._psHolidaysCO_(y)).map((n) => ctx._psKeyFromDayNumber_(+n)).sort().join(' ');
  eq('festivos 2025', fest(2025), '2025-01-01 2025-01-06 2025-03-24 2025-04-17 2025-04-18 2025-05-01 2025-06-02 2025-06-23 2025-06-30 2025-07-20 2025-08-07 2025-08-18 2025-10-13 2025-11-03 2025-11-17 2025-12-08 2025-12-25');
  eq('festivos 2026', fest(2026), '2026-01-01 2026-01-12 2026-03-23 2026-04-02 2026-04-03 2026-05-01 2026-05-18 2026-06-08 2026-06-15 2026-06-29 2026-07-20 2026-08-07 2026-08-17 2026-10-12 2026-11-02 2026-11-16 2026-12-08 2026-12-25');
  eq('festivos 2027', fest(2027), '2027-01-01 2027-01-11 2027-03-22 2027-03-25 2027-03-26 2027-05-01 2027-05-10 2027-05-31 2027-06-07 2027-07-05 2027-07-20 2027-08-07 2027-08-16 2027-10-18 2027-11-01 2027-11-15 2027-12-08 2027-12-25');

  const out = JSON.stringify(s);
  const personal = ROWS.flatMap((r) => [r[19], r[20], r[21]]).filter(Boolean);
  eq('sin nombres, cédulas ni correos en la respuesta', personal.filter((v) => out.includes(v)), []);

  ctx.validateUserSession_ = () => true;
  ctx.validateUserEmail_ = () => true;
  ctx.isUserAnalyst = (e) => e === 'admin@prueba.co';
  const denied = ctx.dispatch('getPurchaseStats', { userEmail: 'otro@prueba.co', sessionToken: 'x', filters: {} });
  eq('solo administradores', denied.success === false && /administrador/.test(denied.error), true);
  const allowed = ctx.dispatch('getPurchaseStats', { userEmail: 'admin@prueba.co', sessionToken: 'x', filters: {} });
  eq('administrador recibe los datos', allowed.success === true && allowed.data.totals.tickets === 13, true);

  if (failures.length) {
    console.error(`\n✗ Estadísticas de compra: ${failures.length} caso(s) con problemas.\n`);
    failures.forEach((f) => console.error('  · ' + f));
    process.exit(1);
  }
  console.log('Estadísticas de compra: tiquetes, noches, costos, anticipación, festivos 2025-2027 y permisos OK.');
}

main();
