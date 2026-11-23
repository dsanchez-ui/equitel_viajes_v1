#!/usr/bin/env node
/**
 * Verifica el desglose del presupuesto del dashboard de costos (#A131, pedido de Yurani del 19-nov: «cuánto se ha
 * pagado en viajes reales por unidad, cuáles son cargados a OT y cuáles CC»), con una hoja SINTÉTICA en memoria:
 *
 *   1. Servidor (_csBuildData_):
 *      - lo cargado a una OT (número válido: empieza por OT y tiene un dígito) se suma APARTE en su unidad, por mes,
 *        con sus viajes y el número de la OT; nunca entra en lo que se compara con el presupuesto;
 *      - una unidad con viajes solo a OT también aparece; «OT pendiente» (sin número) no es OT;
 *      - los filtros de unidad y de «comprado sin factura» valen también para lo de OT.
 *   2. Navegador (CostsDashboard.html):
 *      - la vista anual, la del periodo y la del mes traen lo de OT y sus totales;
 *      - la barra del presupuesto: el %, lo que se pasó, cada parte con su % (que suman el total), lo que no suma
 *        (OT y unidades sin presupuesto) y los filtros, para que una captura se explique sola;
 *      - cada unidad frente a su presupuesto, de la que más se pasó a la que menos;
 *      - la tabla por unidad: columnas de OT, total de los viajes y fila de total.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function makeSheet(name, rows) {
  const t = rows.map((r) => r.slice());
  return {
    getName: () => name, getLastRow: () => t.length, getLastColumn: () => t.reduce((m, r) => Math.max(m, r.length), 0),
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((t[r - 1 + i] || [])[c - 1 + j] ?? ''))),
        getValue: () => (t[r - 1] || [])[c - 1] ?? '',
      };
    },
  };
}

const H = ['ID RESPUESTA', 'STATUS', 'EMPRESA', 'UNIDAD DE NEGOCIO', 'FECHA DE COMPRA DE TIQUETE', 'TOTAL FACTURA', 'COSTO_FINAL_TIQUETES',
  'COSTO_FINAL_HOTEL', '# ORDEN TRABAJO', 'CORREO ENCUESTADO', 'NOMBRE PERSONA 1', 'CÉDULA PERSONA 1'];
const R = (o) => H.map((k) => (k in o ? o[k] : ''));
const REQUESTS = [H,
  // POTENCIA (Cumandes): dos contra el presupuesto, dos a OT y una con «OT pendiente» (no es OT: suma).
  R({ 'ID RESPUESTA': 'SOL-1', STATUS: 'PROCESADO', EMPRESA: 'Cumandes', 'UNIDAD DE NEGOCIO': 'POTENCIA', 'FECHA DE COMPRA DE TIQUETE': '2026-09-10', 'TOTAL FACTURA': 1000000, 'CORREO ENCUESTADO': 'a@p.co' }),
  R({ 'ID RESPUESTA': 'SOL-2', STATUS: 'RESERVADO', EMPRESA: 'Cumandes', 'UNIDAD DE NEGOCIO': 'POTENCIA', 'FECHA DE COMPRA DE TIQUETE': '2026-09-20', COSTO_FINAL_TIQUETES: 500000, 'CORREO ENCUESTADO': 'a@p.co' }),
  R({ 'ID RESPUESTA': 'SOL-3', STATUS: 'PROCESADO', EMPRESA: 'Cumandes', 'UNIDAD DE NEGOCIO': 'POTENCIA', 'FECHA DE COMPRA DE TIQUETE': '2026-09-15', 'TOTAL FACTURA': 700000, '# ORDEN TRABAJO': 'OT-CUBTA-110256', 'CORREO ENCUESTADO': 'b@p.co' }),
  R({ 'ID RESPUESTA': 'SOL-4', STATUS: 'RESERVADO', EMPRESA: 'Cumandes', 'UNIDAD DE NEGOCIO': 'POTENCIA', 'FECHA DE COMPRA DE TIQUETE': '2026-10-05', COSTO_FINAL_TIQUETES: 300000, '# ORDEN TRABAJO': 'ot 4471', 'CORREO ENCUESTADO': 'b@p.co' }),
  R({ 'ID RESPUESTA': 'SOL-7', STATUS: 'PROCESADO', EMPRESA: 'Cumandes', 'UNIDAD DE NEGOCIO': 'POTENCIA', 'FECHA DE COMPRA DE TIQUETE': '2026-10-01', 'TOTAL FACTURA': 150000, '# ORDEN TRABAJO': 'OT pendiente', 'CORREO ENCUESTADO': 'a@p.co' }),
  R({ 'ID RESPUESTA': 'SOL-8', STATUS: 'ANULADO', EMPRESA: 'Cumandes', 'UNIDAD DE NEGOCIO': 'POTENCIA', 'FECHA DE COMPRA DE TIQUETE': '2026-10-01', 'TOTAL FACTURA': 999999, '# ORDEN TRABAJO': 'OT-1' }),
  // ENERGIA: solo un viaje, cargado a OT.
  R({ 'ID RESPUESTA': 'SOL-5', STATUS: 'PROCESADO', EMPRESA: 'Cumandes', 'UNIDAD DE NEGOCIO': 'ENERGIA', 'FECHA DE COMPRA DE TIQUETE': '2026-10-08', 'TOTAL FACTURA': 400000, '# ORDEN TRABAJO': 'OT-1234', 'CORREO ENCUESTADO': 'c@p.co' }),
  // ADM GENERAL: sin presupuesto.
  R({ 'ID RESPUESTA': 'SOL-6', STATUS: 'PROCESADO', EMPRESA: 'Cumandes', 'UNIDAD DE NEGOCIO': 'ADM GENERAL', 'FECHA DE COMPRA DE TIQUETE': '2026-09-12', 'TOTAL FACTURA': 200000, 'CORREO ENCUESTADO': 'd@p.co' }),
];
const month = (v) => Array(12).fill(v);
const PPTOS = [['ID', 'Empresa', 'Unidad de Negocio', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 'Total', 'Año vigencia'],
  ['2026POTENCIA', 'CUMMINS', 'POTENCIA'].concat(month(200000), ['', 2026]),
  ['2026ENERGIA', 'CUMMINS', 'ENERGIA'].concat(month(100000), ['', 2026])];

/** Utilities.formatDate en hora de Bogotá, para los formatos que usa el dashboard. */
function bogotaFormat(d, tz, f) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return f.replace(/yyyy|MM|dd|HH|mm|M|d/g, (t) => ({ yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour === '24' ? '00' : p.hour, mm: p.minute, M: String(+p.month), d: String(+p.day) })[t]);
}

function loadServer() {
  const sheets = { 'Nueva Base Solicitudes': makeSheet('Nueva Base Solicitudes', REQUESTS), 'PPTOS UNIDADES': makeSheet('PPTOS UNIDADES', PPTOS) };
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} }, Logger: { log() {} },
    Utilities: { formatDate: bogotaFormat },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, getProperties: () => ({}), setProperty() {}, deleteProperty() {}, getKeys: () => [] }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, getAll: () => ({}), putAll() {}, remove() {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true }) },
    Session: { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => '' }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets[n] || null }), flush() {} },
  };
  const stub = () => new Proxy(function () { return stub(); }, { get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : stub()) });
  for (const g of ['DriveApp', 'HtmlService', 'ContentService', 'UrlFetchApp', 'DocumentApp', 'MailApp', 'GmailApp', 'ScriptApp']) ctx[g] = stub();
  vm.createContext(ctx);
  new vm.Script(fs.readFileSync(path.join(ROOT, 'server', 'Code.gs'), 'utf8'), { filename: 'Code.gs' }).runInContext(ctx);
  ctx._csLoadCache_ = () => ({ version: 2, entries: {} });
  ctx._csSaveCache_ = () => {};
  return ctx;
}

function loadBrowser() {
  const html = fs.readFileSync(path.join(ROOT, 'server', 'CostsDashboard.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, value: '', checked: true, style: {}, innerHTML: '', textContent: '', addEventListener() {} });
  const ctx = {
    console, Date, Math, JSON, Number, String, Array, Object, isNaN, setTimeout, clearTimeout,
    document: { addEventListener() {}, getElementById: el, querySelectorAll: () => [], querySelector: () => null, createElement: () => el('x' + Math.random()), body: { appendChild() {} } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, window: { addEventListener() {} },
  };
  vm.createContext(ctx);
  scripts.forEach((code) => new vm.Script(code, { filename: 'CostsDashboard.html' }).runInContext(ctx));
  return { ctx, els };
}

const failures = [];
const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: da ${JSON.stringify(got)}, se esperaba ${JSON.stringify(want)}`); };
const ok = (name, cond) => { if (!cond) failures.push(name); };
const sum = (a, f, t) => a.slice(f - 1, t).reduce((x, y) => x + y, 0);

function main() {
  // ---------------------------------------------------------------- 1. Servidor
  const srv = loadServer();
  const d = srv._csBuildData_({ year: 2026 }, null);
  const unit = (data, u) => data.rows.find((b) => b.unit === u);
  const pot = unit(d, 'POTENCIA'), ene = unit(d, 'ENERGIA'), adm = unit(d, 'ADM GENERAL');
  eq('POTENCIA: contra el presupuesto, solo lo que no es OT (con «OT pendiente», que no es OT)',
    [pot.totalExecutedReal, pot.totalExecutedEstimated, pot.requestCount, pot.requests.map((r) => r.requestId).sort()], [1150000, 500000, 3, ['SOL-1', 'SOL-2', 'SOL-7']]);
  eq('POTENCIA: lo de OT aparte, por mes (facturado y sin factura)', [pot.monthlyOtReal[8], pot.monthlyOtEstimated[9], sum(pot.monthlyOtReal, 1, 12) + sum(pot.monthlyOtEstimated, 1, 12)], [700000, 300000, 1000000]);
  eq('POTENCIA: los viajes de OT con su número', pot.otRequests.map((r) => [r.requestId, r.workOrder, r.executed, r.isEstimated]).sort(),
    [['SOL-3', 'OT-CUBTA-110256', 700000, false], ['SOL-4', 'ot 4471', 300000, true]]);
  eq('ENERGIA: aparece aunque solo tenga viajes a OT, con su presupuesto', [!!ene, ene && ene.requestCount, ene && ene.otRequestCount, ene && ene.hasBudget, ene && ene.monthlyOtReal[9]], [true, 0, 1, true, 400000]);
  eq('sin presupuesto: igual que antes', [adm.hasBudget, adm.totalExecutedReal, adm.otRequestCount], [false, 200000, 0]);
  eq('totales: lo de OT no suma; la anulada no cuenta', [d.totals.executedTotal, d.meta.requestsExcluded.byOT], [1850000, 3]);
  const dU = srv._csBuildData_({ year: 2026, businessUnits: ['POTENCIA'] }, null);
  eq('filtro de unidad: también para lo de OT', dU.rows.map((b) => b.unit), ['POTENCIA']);
  const dE = srv._csBuildData_({ year: 2026, includeEstimated: false }, null);
  eq('sin lo comprado sin factura: tampoco el de OT', [unit(dE, 'POTENCIA').otRequestCount, sum(unit(dE, 'POTENCIA').monthlyOtEstimated, 1, 12)], [1, 0]);
  const dL = srv._csBuildData_({ year: 2026 }, ['energia']);
  eq('un líder solo recibe lo de OT de sus unidades', dL.rows.map((b) => [b.unit, b.otRequestCount]), [['ENERGIA', 1]]);

  // ---------------------------------------------------------------- 2. Navegador
  const { ctx: b, els } = loadBrowser();
  b.fullYearData = JSON.parse(JSON.stringify(d));
  b.fullYearData.meta.computedAt = '2026-11-23T23:30:00.000Z';
  const f = b.applyClientFilters(JSON.parse(JSON.stringify(d)));
  b.filteredData = f;
  eq('anual: lo de OT y sus totales (desde abril)', [f.otSupported, f.ot.total, f.ot.count, f.totalsBudgeted.executedTotal], [true, 1400000, 3, 1650000]);
  eq('anual: por unidad', f.rows.map((r) => [r.unit, r.otTotal, r.otCount]).sort(), [['ADM GENERAL', 0, 0], ['ENERGIA', 400000, 1], ['POTENCIA', 1000000, 2]]);
  const m9 = b.computeMonthlyData(f, 9), m10 = b.computeMonthlyData(f, 10);
  eq('mes: lo de OT del mes', [m9.ot.total, m9.ot.count, m10.ot.total, m10.ot.count, m10.otSupported], [700000, 1, 700000, 2, true]);
  const p = b.computePeriodData(f, { fromMonth: 9, toMonth: 10, label: 'sep–oct', periodMonths: 2 });
  eq('periodo: lo de OT del periodo', [p.ot.total, p.ot.count, p.rows.find((r) => r.unit === 'ENERGIA').otTotal], [1400000, 3, 400000]);
  const viejo = JSON.parse(JSON.stringify(d));
  viejo.rows.forEach((r) => { delete r.monthlyOtReal; delete r.monthlyOtEstimated; delete r.otRequests; delete r.otRequestCount; });
  eq('con un servidor anterior: no se muestra lo de OT', b.applyClientFilters(viejo).otSupported, false);

  // La barra del presupuesto (abril a diciembre: POTENCIA 1.800.000 + ENERGIA 900.000 = 2.700.000).
  els.f_unit.value = '';
  b.renderBudgetMeter('mA', f, 'abril a diciembre de 2026');
  const txt = els.mA.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  ok('barra: el % y lo disponible (' + txt.slice(0, 120) + ')', /61\.1%/.test(txt) && /Queda disponible \$1\.050\.000/.test(txt));
  ok('barra: cada parte con su % (42,6 + 18,5 = 61,1)', /Facturado \$1\.150\.000 42\.6%/.test(txt) && /Comprado sin factura .*\$500\.000 18\.5%/.test(txt) && /Gasto contra el presupuesto \$1\.650\.000 61\.1%/.test(txt));
  ok('barra: lo que no suma (OT y sin presupuesto) y los filtros', /No suman aquí: cargado a una orden de trabajo \(OT\), que se paga con la OT: \$1\.400\.000 \(3 viajes\)/.test(txt) &&
    /1 unidad sin presupuesto: \$200\.000/.test(txt) && /abril a diciembre de 2026 · Empresa: todas · Unidad: todas · Datos del/.test(txt));
  // Se pasó: solo POTENCIA, con más gasto.
  const over = JSON.parse(JSON.stringify(f));
  over.totalsBudgeted = { executedReal: 2000000, executedEstimated: 445000, budget: 1800000, executedTotal: 2445000 };
  over.ot = { total: 1000000, count: 2 }; over.unbudgeted = { executedTotal: 0, unitCount: 0 };
  b.renderBudgetMeter('mB', over, 'abril a diciembre de 2026');
  const t2 = els.mB.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  ok('barra: se pasó, con cuánto y la parte rayada (' + t2.slice(0, 160) + ')', /135\.8%/.test(t2) && /Se pasó del presupuesto en \$645\.000 \(35\.8% más de lo presupuestado\)/.test(t2) &&
    /Facturado \$2\.000\.000 111\.1%/.test(t2) && /\$445\.000 24\.7%/.test(t2) && /Por encima del presupuesto \$645\.000 35\.8%/.test(t2) && /class="bm-over"/.test(els.mB.innerHTML));
  ok('barra: el presupuesto con su monto sobre la línea', /Presupuesto \$1\.800\.000 \(100 %\)/.test(t2));
  // Cada unidad frente a su presupuesto.
  const fu = JSON.parse(JSON.stringify(f));
  fu.rows.find((r) => r.unit === 'ENERGIA').totalExecutedReal = 1350000; // 150 %: la que más se pasó
  b.renderUnitMeters('uA', fu);
  const t3 = els.uA.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  ok('unidades: de la que más se pasó a la que menos, con lo de OT y las sin presupuesto (' + t3.slice(0, 200) + ')',
    t3.indexOf('ENERGIA') < t3.indexOf('POTENCIA') && /150\.0% · \$1\.350\.000 de \$900\.000 ⚠ se pasó \$450\.000 · \+ \$400\.000 en OT \(no suma\)/.test(t3) &&
    /91\.7% · \$1\.650\.000 de \$1\.800\.000 disponible \$150\.000 · \+ \$1\.000\.000 en OT/.test(t3) && /Sin presupuesto en estos meses \(no entran en el %\): ADM GENERAL \$200\.000/.test(t3));

  if (failures.length) {
    console.error('✗ Desglose del presupuesto (#A131): ' + failures.length + ' falla(s):');
    failures.forEach((x) => console.error('  - ' + x));
    process.exit(1);
  }
  console.log('Desglose del presupuesto (#A131): lo cargado a OT aparte por unidad y mes (sin tocar lo que se compara), filtros, vistas anual, periodo y mes, la barra con la línea del 100 % y cada unidad frente a su presupuesto. OK');
}

main();
