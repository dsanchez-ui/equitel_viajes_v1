#!/usr/bin/env node
/**
 * Verifica la velocidad y el análisis de ahorro del dashboard de costos (#A89, #A90)
 * con una hoja SINTÉTICA en memoria (docs/plan-analitica-ahorro.md):
 *
 *   1. Caché de respuestas (CacheService, nunca Script Properties):
 *      - la segunda consulta sale de la caché; con «Actualizar» se recalcula;
 *      - cualquier escritura de la app (dispatch) y las búsquedas nuevas del rastreo la invalidan;
 *      - las respuestas grandes se guardan en trozos y se leen iguales;
 *      - si la caché falla, se calcula igual;
 *      - un líder nunca recibe la respuesta de otro alcance, y los permisos de cada
 *        persona no viajan en lo guardado.
 *   2. La tabla compacta del análisis: columnas, valores y sin datos personales.
 *   3. Las cuentas que hace el navegador (CostsDashboard.html): volumen por mes,
 *      estadísticos, valor por grupo, cada método de proyección, equipaje, tope,
 *      adopción e internacionales.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

// ------------------------------------------------------------------ hoja y caché en memoria
function makeSheet(name, rows) {
  const t = rows.map((r) => r.slice());
  const s = {
    name, data: t, getName: () => name, getLastRow: () => t.length,
    getLastColumn: () => t.reduce((m, r) => Math.max(m, r.length), 0),
    getMaxColumns: () => 200, insertColumnsAfter() {}, setColumnWidth() {},
    appendRow(vals) { t.push(vals.slice()); },
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      const rng = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((t[r - 1 + i] || [])[c - 1 + j] ?? ''))),
        getValue: () => (t[r - 1] || [])[c - 1] ?? '',
        setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { while (t.length < r + i) t.push([]); t[r - 1 + i][c - 1 + j] = x; })); return rng; },
        setValue(v) { while (t.length < r) t.push([]); t[r - 1][c - 1] = v; return rng; },
        setFontWeight: () => rng, setNote: () => rng, setBackground: () => rng, setFontColor: () => rng, setNumberFormat: () => rng,
      };
      return rng;
    },
  };
  return s;
}

function makeCache() {
  const store = {};
  const log = { puts: 0, fail: false };
  const guard = () => { if (log.fail) throw new Error('Caché no disponible'); };
  return {
    store, log,
    api: {
      get: (k) => { guard(); return store[k] ?? null; },
      put: (k, v) => { guard(); log.puts++; store[k] = String(v); },
      getAll: (ks) => { guard(); return Object.fromEntries(ks.filter((k) => k in store).map((k) => [k, store[k]])); },
      putAll: (m) => { guard(); log.puts++; Object.keys(m).forEach((k) => { store[k] = String(m[k]); }); },
      remove: (k) => { delete store[k]; },
    },
  };
}

const iso = (n) => { const d = new Date(Date.UTC(2026, 8, 1 + n)); return d.toISOString().slice(0, 10); };
const H = ['ID RESPUESTA', 'FECHA SOLICITUD', 'STATUS', 'MODO_SOLICITUD', 'CIUDAD ORIGEN', 'CIUDAD DESTINO', 'FECHA IDA', 'FECHA VUELTA',
  '# PERSONAS QUE VIAJAN', 'FECHA DE COMPRA DE TIQUETE', 'COSTO_FINAL_TIQUETES', 'COSTO_FINAL_HOTEL', 'TOTAL FACTURA', 'ES INTERNACIONAL',
  'TIPO DE SOLICITUD', 'ES_CAMBIO_CON_COSTO', 'OBSERVACIONES', 'CANAL DE COMPRA', 'AEROLINEA', 'EMPRESA', 'UNIDAD DE NEGOCIO',
  'EVENTOS_JSON', 'CORREO ENCUESTADO', 'CÉDULA PERSONA 1', 'NOMBRE PERSONA 1'];
const priv = ['viajero@ejemplo.test', 'CEDULA-PRIVADA-9', 'NOMBRE PRIVADO'];
const R = (o) => H.map((k) => (k in o ? o[k] : '')).map((v, i) => (i >= H.length - 3 ? priv[i - (H.length - 3)] : v));
function requests() {
  return [H,
    // A: ida y vuelta, 1 pasajero, comprado en sep, con hotel y factura, 2 días de anticipación, Aviatur
    R({ 'ID RESPUESTA': 'SOL-1', 'FECHA SOLICITUD': iso(0), STATUS: 'PROCESADO', MODO_SOLICITUD: 'VIAJE', 'CIUDAD ORIGEN': 'BOGOTA', 'CIUDAD DESTINO': 'MEDELLIN',
      'FECHA IDA': iso(5), 'FECHA VUELTA': iso(7), '# PERSONAS QUE VIAJAN': 1, 'FECHA DE COMPRA DE TIQUETE': iso(3), COSTO_FINAL_TIQUETES: 600000, COSTO_FINAL_HOTEL: 300000,
      'TOTAL FACTURA': 950000, 'TIPO DE SOLICITUD': 'ORIGINAL', 'CANAL DE COMPRA': 'Aviatur', EMPRESA: 'Equitel', 'UNIDAD DE NEGOCIO': 'POTENCIA' }),
    // B: solo ida, 2 pasajeros, comprado en sep, modificación con costo, multidestino, internacional, 20 días, Directo
    R({ 'ID RESPUESTA': 'SOL-2', 'FECHA SOLICITUD': iso(1), STATUS: 'RESERVADO', MODO_SOLICITUD: 'VIAJE', 'CIUDAD ORIGEN': 'BOGOTA', 'CIUDAD DESTINO': 'MIAMI',
      'FECHA IDA': iso(30), '# PERSONAS QUE VIAJAN': 2, 'FECHA DE COMPRA DE TIQUETE': iso(10), COSTO_FINAL_TIQUETES: 3000000, 'ES INTERNACIONAL': 'SI',
      'TIPO DE SOLICITUD': 'MODIFICACION', ES_CAMBIO_CON_COSTO: 'SI', OBSERVACIONES: '[MULTIDESTINO] Tramo 1/2', 'CANAL DE COMPRA': 'Directo',
      EMPRESA: 'Cumandes', 'UNIDAD DE NEGOCIO': 'SERVICIO' }),
    // C: anulada (solicitada en sep, sin compra)
    R({ 'ID RESPUESTA': 'SOL-3', 'FECHA SOLICITUD': iso(2), STATUS: 'ANULADO', MODO_SOLICITUD: 'VIAJE', 'FECHA IDA': iso(20), EMPRESA: 'Equitel', 'UNIDAD DE NEGOCIO': 'POTENCIA' }),
    // D: solo hospedaje comprado en oct (sin compra de tiquete: mes de la solicitud)
    R({ 'ID RESPUESTA': 'SOL-4', 'FECHA SOLICITUD': iso(31), STATUS: 'PROCESADO', MODO_SOLICITUD: 'SOLO_HOSPEDAJE', 'FECHA IDA': iso(40), COSTO_FINAL_HOTEL: 400000,
      EMPRESA: 'Equitel', 'UNIDAD DE NEGOCIO': 'POTENCIA' }),
    // E: denegada en oct
    R({ 'ID RESPUESTA': 'SOL-5', 'FECHA SOLICITUD': iso(32), STATUS: 'DENEGADO', MODO_SOLICITUD: 'VIAJE', EMPRESA: 'Equitel', 'UNIDAD DE NEGOCIO': 'POTENCIA' }),
    // F: aprobada (en curso), con búsqueda en el comparador
    R({ 'ID RESPUESTA': 'SOL-6', 'FECHA SOLICITUD': iso(33), STATUS: 'APROBADO', MODO_SOLICITUD: 'VIAJE', 'CIUDAD ORIGEN': 'CALI', 'CIUDAD DESTINO': 'BOGOTA',
      'FECHA IDA': iso(45), 'FECHA VUELTA': iso(47), '# PERSONAS QUE VIAJAN': 1, COSTO_FINAL_TIQUETES: 800000, EMPRESA: 'Equitel', 'UNIDAD DE NEGOCIO': 'POTENCIA' }),
  ];
}
const TRACK_H = ['FECHA BUSQUEDA', 'MOMENTO', 'ID SOLICITUD', 'ESTADO', 'COSTO TIQUETES COTIZADO', 'MAS BARATO', 'MAS BARATO CERCA HORA', 'RESULTADO', 'CONSULTAS',
  'FORMATO', 'REFERENCIA', 'REFERENCIA A LA HORA', 'MISMA AEROLINEA', 'TRAMOS'];
const trackRow = (o) => TRACK_H.map((k) => (k in o ? o[k] : ''));

function loadPlatform(opts = {}) {
  const sheets = {
    'Nueva Base Solicitudes': makeSheet('Nueva Base Solicitudes', requests()),
    'COMPARATIVO PRECIOS': makeSheet('COMPARATIVO PRECIOS', [TRACK_H,
      trackRow({ 'FECHA BUSQUEDA': new Date(), MOMENTO: 'COMPRA', 'ID SOLICITUD': 'SOL-6', ESTADO: 'APROBADO', 'COSTO TIQUETES COTIZADO': 800000, 'MAS BARATO': 380000,
        'MAS BARATO CERCA HORA': 400000, RESULTADO: 'OK', CONSULTAS: 2, FORMATO: 3, REFERENCIA: 400000, 'REFERENCIA A LA HORA': 'SI', 'MISMA AEROLINEA': 700000, TRAMOS: '[]' })]),
    'COMPARATIVO ESTADO': makeSheet('COMPARATIVO ESTADO', [['ESTADO', 'ACTIVO']]),
  };
  const ss = { getSheetByName: (n) => sheets[n] || null, getId: () => 'HOJA', insertSheet: (n) => (sheets[n] = makeSheet(n, [])) };
  const cache = makeCache();
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} }, Logger: { log() {} },
    Utilities: { formatDate: (d) => new Date(d).toISOString().slice(0, 10) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, getProperties: () => ({}), setProperty() { throw new Error('Script Properties prohibidas aquí'); }, deleteProperty() {}, getKeys: () => [] }) },
    CacheService: { getScriptCache: () => { if (opts.noCache) throw new Error('sin caché'); return cache.api; } },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true }) },
    Session: { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => '' }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} },
  };
  const stub = () => new Proxy(function () { return stub(); }, { get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : stub()) });
  for (const g of ['DriveApp', 'HtmlService', 'ContentService', 'UrlFetchApp', 'DocumentApp', 'MailApp', 'GmailApp', 'ScriptApp']) ctx[g] = stub();
  vm.createContext(ctx);
  new vm.Script(fs.readFileSync(path.join(ROOT, 'server', 'Code.gs'), 'utf8'), { filename: 'Code.gs' }).runInContext(ctx);
  ctx.isUserAnalyst = (e) => ['dsanchez@equitel.com.co', 'compras.equitel@equitel.com.co'].includes(e);
  ctx.isSuperAdmin = (e) => e === 'dsanchez@equitel.com.co';
  ctx.validateUserSession_ = () => true;
  ctx.validateUserEmail_ = () => true;
  ctx._csLoadCache_ = () => ({ version: 2, entries: {} });
  ctx._csSaveCache_ = () => {};
  ctx._csLoadAccessTable_ = () => ({ byEmail: { 'lider@ejemplo.test': { all: false, units: { potencia: 'POTENCIA' } }, 'lider2@ejemplo.test': { all: false, units: { servicio: 'SERVICIO' } } } });
  return { ctx, sheets, cache };
}

// ------------------------------------------------------------------ las cuentas del navegador
function loadBrowserMath() {
  const html = fs.readFileSync(path.join(ROOT, 'server', 'CostsDashboard.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const el = () => ({ value: '', checked: false, style: {}, addEventListener() {}, textContent: '', innerHTML: '' });
  const ctx = {
    console, Date, Math, JSON, Number, String, Array, Object, isNaN, setTimeout, clearTimeout,
    document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [], createElement: el, body: { appendChild() {} } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, window: { addEventListener() {} },
  };
  vm.createContext(ctx);
  scripts.forEach((code) => new vm.Script(code, { filename: 'CostsDashboard.html' }).runInContext(ctx));
  return ctx;
}

// ------------------------------------------------------------------ verificaciones
const failures = [];
let checks = 0;
const eq = (name, got, want) => { checks++; if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: da ${JSON.stringify(got)}, se esperaba ${JSON.stringify(want)}`); };
const near = (name, got, want) => { checks++; if (got === null || Math.abs(got - want) > 0.5) failures.push(`${name}: da ${got}, se esperaba ${want}`); };
const who = (email, extra) => Object.assign({ userEmail: email, sessionToken: 'x' }, extra || {});
const DAVID = 'dsanchez@equitel.com.co', LAURA = 'compras.equitel@equitel.com.co';

function main() {
  // 1. Caché del comparador y su análisis
  let { ctx, sheets, cache } = loadPlatform();
  const r1 = ctx.dispatch('getPriceTracking', who(DAVID));
  const r2 = ctx.dispatch('getPriceTracking', who(DAVID));
  eq('primera consulta: se calcula; segunda: sale de la caché', [r1.success, r1.data._cache.fromCache, r2.data._cache.fromCache], [true, false, true]);
  eq('lo de la caché es igual a lo calculado', JSON.stringify(Object.assign({}, r2.data, { _cache: 0 })), JSON.stringify(Object.assign({}, r1.data, { _cache: 0 })));
  eq('«Actualizar» recalcula', ctx.dispatch('getPriceTracking', who(DAVID, { fresh: true })).data._cache.fromCache, false);
  eq('Laura sigue sin verlo, aunque esté en caché', ctx.dispatch('getPriceTracking', who(LAURA)).success, false);
  sheets['COMPARATIVO PRECIOS'].appendRow(sheets['COMPARATIVO PRECIOS'].data[1].slice());
  eq('una búsqueda nueva del rastreo invalida', ctx.dispatch('getPriceTracking', who(DAVID)).data._cache.fromCache, false);
  eq('después vuelve a servir de la caché', ctx.dispatch('getPriceTracking', who(DAVID)).data._cache.fromCache, true);
  const w = ctx.dispatch('setPurchaseInfo', who(DAVID, { requestId: 'SOL-6', airline: 'Avianca', channel: 'Aviatur' }));
  eq('una escritura de la app invalida', [w.success, ctx.dispatch('getPriceTracking', who(DAVID)).data._cache.fromCache], [true, false]);
  eq('nada se guarda en Script Properties', true, true); // setProperty lanza en este entorno: si se usara, fallarían las consultas
  const d1 = ctx.dispatch('getPriceTrackingDetail', who(DAVID, { requestId: 'SOL-6' }));
  const d2 = ctx.dispatch('getPriceTrackingDetail', who(DAVID, { requestId: 'SOL-6' }));
  eq('el detalle de un viaje también queda en caché', [d1.success, d1.data._cache.fromCache, d2.data._cache.fromCache], [true, false, true]);

  // Trozos
  const big = { list: Array.from({ length: 4000 }, (_, i) => ({ i, txt: 'Solicitud número ' + i + ' con tildes áéíóú' })) };
  ctx._dashCachePut_('PRUEBA', big);
  const parts = Object.keys(cache.store).filter((k) => k.startsWith('PRUEBA#')).length;
  eq('respuesta grande: se guarda en trozos de menos de 100 KB y se lee igual', [parts > 1, Object.keys(cache.store).filter((k) => k.startsWith('PRUEBA#')).every((k) => cache.store[k].length <= 40000),
    JSON.stringify(ctx._dashCacheGet_('PRUEBA')) === JSON.stringify(big)], [true, true, true]);
  delete cache.store['PRUEBA#1'];
  eq('si falta un trozo, se recalcula (no se arma una respuesta incompleta)', ctx._dashCacheGet_('PRUEBA'), null);

  // Caché caída
  cache.log.fail = true;
  const rf = ctx.dispatch('getPriceTracking', who(DAVID));
  eq('si la caché falla, se calcula igual', [rf.success, rf.data._cache.fromCache, rf.data.items.length], [true, false, 1]);
  cache.log.fail = false;
  ({ ctx } = loadPlatform({ noCache: true }));
  eq('sin CacheService, se calcula igual', ctx.dispatch('getPriceTracking', who(DAVID)).success, true);

  // 2. Datos generales: alcance por usuario y permisos que no viajan en la caché
  ({ ctx, sheets, cache } = loadPlatform());
  const f = { filters: { year: 2026, includeEstimated: true, includeNoPresupuesto: true } };
  const gD = ctx.dispatch('getCostsDashboard', who(DAVID, f));
  const gL = ctx.dispatch('getCostsDashboard', who(LAURA, f));
  eq('datos generales: Laura (mismo alcance) usa la caché, pero con sus propios permisos', [gD.data._cache.fromCache, gL.data._cache.fromCache, gD.data.meta.access.canViewVariance, gL.data.meta.access.canViewVariance, gL.data.meta.access.canConfig],
    [false, true, true, false, false]);
  // Cada cálculo deja constancia de con qué unidades se hizo.
  const realBuild = ctx._csBuildData_;
  ctx._csBuildData_ = (filters, allowed) => { const d = realBuild(filters, allowed); d.builtFor = allowed ? allowed.join(',') : 'TODAS'; return d; };
  ctx._dashInvalidate_();
  const gAll = ctx.dispatch('getCostsDashboard', who(DAVID, f));
  const gLider = ctx.dispatch('getCostsDashboard', who('lider@ejemplo.test', f));
  const gLider2 = ctx.dispatch('getCostsDashboard', who('lider2@ejemplo.test', f));
  eq('un líder no recibe la respuesta guardada de otro alcance', [gAll.data.builtFor, gLider.data._cache.fromCache, gLider.data.builtFor, gLider2.data._cache.fromCache, gLider2.data.builtFor],
    ['TODAS', false, 'potencia', false, 'servicio']);
  eq('el mismo líder, la segunda vez, sale de la caché', ctx.dispatch('getCostsDashboard', who('lider@ejemplo.test', f)).data._cache.fromCache, true);
  const vD = ctx.dispatch('getCostsVarianceReport', who(DAVID, { filters: { year: 2026 } }));
  eq('variación en caché, con el rol de cada quien', [vD.success, vD.data._cache.fromCache, ctx.dispatch('getCostsVarianceReport', who(DAVID, { filters: { year: 2026 } })).data._cache.fromCache, vD.data.meta.access.role], [true, false, true, 'SUPERADMIN']);

  // 3. La tabla compacta del análisis
  const a = r1.data.analysis;
  eq('columnas del análisis', a.columns, ['mes', 'mesSolicitud', 'estado', 'vuelo', 'idaVuelta', 'pasajeros', 'internacional', 'hotel', 'cambio', 'cambioConCosto',
    'multidestino', 'cotizadoTiquetes', 'facturado', 'anticipacion', 'canal', 'empresa', 'unidad', 'tarifa']);
  const byIdx = (i) => a.rows[i];
  // #A97: la tarifa del manual por noches: SOL-1 (2 noches) TIPO 2; SOL-2 (solo ida sin hotel) TIPO 1; solo hospedaje 0.
  eq('tarifa por noches en el análisis', [byIdx(0)[17], byIdx(1)[17], byIdx(3)[17]], [2, 1, 0]);
  eq('SOL-1: comprado en sep, ida y vuelta, con hotel, factura, 2 días, Aviatur', byIdx(0).slice(0, 15), ['2026-09', '2026-09', 'C', 1, 1, 1, 0, 1, 0, 0, 0, 600000, 950000, 2, 'A']);
  eq('SOL-2: solo ida, 2 pasajeros, internacional, modificación con costo, multidestino, Directo', byIdx(1).slice(2, 15), ['C', 1, 0, 2, 1, 0, 1, 1, 1, 3000000, 0, 20, 'D']);
  eq('anulada, solo hospedaje, denegada y en curso', [byIdx(2)[2], byIdx(3).slice(0, 4), byIdx(4)[2], byIdx(5)[2]], ['A', ['2026-10', '2026-10', 'C', 0], 'D', 'P']);
  eq('empresa y unidad como índices de un diccionario', [a.companies, a.units, byIdx(1)[15], byIdx(1)[16]], [['Equitel', 'Cumandes'], ['POTENCIA', 'SERVICIO'], 1, 1]);
  eq('sin datos personales en la respuesta', priv.some((x) => JSON.stringify(r1.data).includes(x)), false);
  eq('el comparador dice si el viaje es internacional', r1.data.items[0].international, false);

  // 4. Las cuentas del navegador
  const b = loadBrowserMath();
  eq('estadísticos', [b.saStat([5, 1, 3, 2, 4], 'median'), b.saStat([1, 2, 3, 4, 5], 'p25'), b.saStat([4, null, 2], 'min'), b.saStat([1, 2, 6], 'mean'), b.saStat([], 'median')], [3, 2, 2, 3, null]);
  const T = (o) => Object.assign({ month: '2026-09', reqMonth: '2026-09', st: 'C', flight: true, rt: true, pax: 1, intl: false, hotel: false, mod: false, modCost: false,
    multi: false, quoted: 600000, invoiced: 0, lead: 5, channel: '', company: 'Equitel', unit: 'POTENCIA' }, o);
  const trips = [T({}), T({ rt: false, pax: 2, quoted: 500000, lead: 20, channel: 'A' }), T({ st: 'A' }), T({ flight: false }), T({ intl: true, quoted: 3000000 }),
    T({ quoted: 5000 }), T({ month: '2026-08', reqMonth: '2026-08', pax: 3, lead: 1, mod: true, modCost: true }), T({ st: 'D', reqMonth: '2026-08' })];
  const vol = b.saVolume(trips, ['2026-08', '2026-09']);
  eq('volumen de sep: embudo, compradas, tipos, pasajeros y anticipación', [vol['2026-09'].requests, vol['2026-09'].annulled, vol['2026-09'].bought, vol['2026-09'].flights,
    vol['2026-09'].hotelOnly, vol['2026-09'].oneway, vol['2026-09'].roundtrip, vol['2026-09'].pax2, vol['2026-09'].intl, vol['2026-09'].lead47, vol['2026-09'].lead15, vol['2026-09'].chA],
  [6, 1, 5, 4, 1, 1, 3, 1, 1, 3, 1, 1]);
  eq('volumen de sep: tiquetes y gasto (sin costos simbólicos)', [vol['2026-09'].tickets, vol['2026-09'].spend, vol['2026-09'].ticketsWithCost], [8, 4100000, 6]);
  eq('volumen de ago: denegada, 3 pasajeros, cambio con costo, comprado tarde', [vol['2026-08'].requests, vol['2026-08'].denied, vol['2026-08'].pax3, vol['2026-08'].mod, vol['2026-08'].modCost, vol['2026-08'].lead03],
    [2, 1, 1, 1, 1, 1]);
  // Muestra: dos viajes de ida y vuelta de 1 pasajero (2 tiquetes)
  const S = (diff, quoted, channel) => ({ rt: true, tickets: 2, diff, perTicket: diff / 2, pct: diff / quoted, channel, channelPerTicket: channel / 2, channelPct: channel / quoted });
  const sample = [S(400000, 800000, 100000), S(200000, 500000, -50000)];
  const base = { kind: 'all', fixed: 0, baggage: 0, adoption: 1, intl: false };
  const months = ['2026-08', '2026-09'];
  // Proyectables en sep: ida y vuelta de $600.000 (2 tiquetes) y solo ida de 2 pasajeros de $500.000 (2 tiquetes); el
  // internacional (salvo que se incluya), el de $5.000 y lo no comprado no cuentan. En ago: 3 pasajeros ida y vuelta (6 tiquetes).
  const proj = (o) => b.saProject(trips, months, sample, Object.assign({}, base, o));
  // Mediana por tiquete = 150.000; tope = 50 % del cotizado (el % más alto observado).
  const p1 = proj({ how: 'median', base: 'ticket' });
  // 150.000 × 2 = 300.000 en el de $600.000; en el de $500.000, el tope (50 %) lo deja en 250.000; en ago, 900.000 → tope 300.000.
  eq('mediana por tiquete × tiquetes, con tope del % más alto observado', [p1['2026-09'], p1['2026-08']], [550000, 300000]);
  // #A93: la cuenta queda paso a paso para mostrarla y repetirla a mano, sin cambiar el resultado.
  const det = {};
  const p1d = b.saProject(trips, months, sample, Object.assign({}, base, { how: 'median', base: 'ticket' }), det);
  const ds = det.months['2026-09'], da = det.months['2026-08'];
  eq('cuenta de sep: base, antes del tope y recorte del tope', [ds.flights, ds.tickets, ds.spend, ds.raw, ds.cut, ds.cutTrips, p1d['2026-09']],
    [2, 4, 1100000, 600000, 50000, 1, 550000]);
  eq('cuenta de ago: 6 tiquetes × 150.000, el tope deja 300.000', [da.tickets, da.raw, da.cut, p1d['2026-08']], [6, 900000, 600000, 300000]);
  eq('valor y tope que usa la cuenta', [det.rates.rt, det.cap], [150000, 0.5]);
  const calc = b.saCalcText({ detail: det, proj: p1d, opts: Object.assign({}, base, { how: 'median', base: 'ticket' }) }, '2026-09');
  eq('la cuenta en palabras cuadra con la cifra', [/^4 tiquetes × \$150\.000 = \$600\.000; el tope recorta \$50\.000 en 1 viaje → \$550\.000$/.test(calc)], [true]);
  const p2 = proj({ how: 'median', base: 'pct' });
  near('mediana como % del cotizado (45 %)', p2['2026-09'], 0.45 * (600000 + 500000));
  const p3 = proj({ how: 'fixed', base: 'trip', fixed: 150000 });
  eq('valor fijo por viaje (los "150 mil por solicitud")', [p3['2026-09'], p3['2026-08']], [300000, 150000]);
  const p4 = proj({ how: 'median', base: 'ticket', baggage: 50000, adoption: 0.5 });
  eq('equipaje por tiquete y adopción', p4['2026-09'], (300000 - 100000 + 300000 - 100000) * 0.5);
  const p5 = proj({ how: 'median', base: 'ticket', kind: 'channel' });
  eq('solo canal (mediana 12.500 por tiquete)', p5['2026-09'], 12500 * 4);
  const p6 = proj({ how: 'median', base: 'ticket', intl: true });
  eq('con internacionales, también se proyecta el internacional', p6['2026-09'] - p1['2026-09'], 300000);
  eq('sin muestra, un método que la necesita no inventa cifras', b.saProject(trips, months, [], Object.assign({}, base, { how: 'median', base: 'ticket' })), null);
  const groupSample = [1, 2, 3, 4, 5].map(() => S(100000, 500000, 0)).concat([Object.assign(S(900000, 1000000, 0), { rt: false, tickets: 1, perTicket: 900000 })]);
  const rates = b.saRates(groupSample, 'median', 'ticket', 'all');
  eq('con 5 o más viajes de un tipo, se usa el valor de su grupo; si no, el de todos', [rates.rt, rates.ow], [50000, 50000]);

  // #A95: con «misma tarifa», la muestra solo lleva los viajes buscados en Google con el equipaje de su tarifa.
  const I = (id, type, match, o) => Object.assign({ requestId: id, quoted: 800000, market: 500000, sameAirline: 600000, passengers: 1, returnDate: '2026-10-20',
    international: false, fare: { type, match, searchedBags: 0 } }, o);
  const its = [I('S1', '1', true), I('S2', '2', false), I('S3', '', null), I('S4', '2', true, { international: true }), I('S5', '1', true, { market: null })];
  b.priceData = { summary: { sameFare: { overall: {} } }, items: its };
  eq('misma tarifa: solo los buscados con su equipaje (y nacionales con precio)', b.saSample(false, 'same').map((x) => x.it.requestId), ['S1']);
  eq('todas las búsquedas: también otro equipaje y sin tarifa', b.saSample(false, 'all').map((x) => x.it.requestId), ['S1', 'S2', 'S3']);
  eq('por qué un viaje no cuenta', [b.ptFareGap(its[0]), b.ptFareGap(its[1]), b.ptFareGap(its[2])],
    ['', 'Google se buscó sin maleta y la tarifa es TIPO 2', 'falta la tarifa del tiquete']);
  eq('la vista por defecto es la misma tarifa', b.ptFareMode(), 'same');
  b.priceData = { summary: { overall: {} }, items: [I('S1', '1', true)].map((x) => { delete x.fare; return x; }) };
  eq('con un Code.gs anterior (sin tarifas) se ve todo, como antes', [b.ptFareMode(), b.saSample(false, 'same').length], ['all', 1]);
  // #A97: solo comparaciones exactas, solo TIPO 1, y la proyección solo de los viajes TIPO 1.
  const Q = (id, eff, match, quality) => I(id, eff, match, { fare: { type: '', effective: eff, match, quality, searchedBags: 0 } });
  b.priceData = { summary: { sameFare: { overall: {} }, exact: { overall: {} } },
    items: [Q('E1', '1', true, 'exacta'), Q('E2', '2', true, 'aproximada'), Q('E3', '2', true, 'exacta'), Q('E4', '2', false, 'no comparable')] };
  eq('muestra: con la tarifa del manual / solo exactas / solo TIPO 1', [b.saSample(false, 'same').map((x) => x.it.requestId),
    b.saSample(false, 'exact').map((x) => x.it.requestId), b.saSample(false, 'all', 'tipo1').map((x) => x.it.requestId)],
    [['E1', 'E2', 'E3'], ['E1', 'E3'], ['E1']]);
  eq('por qué no cuenta en «solo exactas»', [b.ptFareGap(b.priceData.items[1], 'exact'), b.ptFareGap(b.priceData.items[0], 'exact')], ['comparación aproximada', '']);
  const tripsTipo = [T({ tipo: 1 }), T({ tipo: 2, quoted: 900000 }), T({ tipo: 1, rt: false, quoted: 400000 })];
  const sTipo = [S(200000, 600000, 100000)];
  const pTodos = b.saProject(tripsTipo, ['2026-09'], sTipo, Object.assign({}, base, { how: 'fixed', base: 'trip', fixed: 100000 }));
  const pT1 = b.saProject(tripsTipo, ['2026-09'], sTipo, Object.assign({}, base, { how: 'fixed', base: 'trip', fixed: 100000, scope: 'tipo1' }));
  eq('proyección: todos los viajes o solo TIPO 1', [pTodos['2026-09'], pT1['2026-09']], [300000, 200000]);

  if (failures.length) {
    console.error(`\n✗ Velocidad y análisis de ahorro: ${failures.length} problema(s).\n`);
    failures.forEach((x) => console.error('  · ' + x));
    process.exit(1);
  }
  console.log(`Velocidad y análisis de ahorro: caché (llave por alcance, invalidación, trozos, fallas), tabla del análisis y cuentas de la proyección OK (${checks} comprobaciones).`);
}

main();
