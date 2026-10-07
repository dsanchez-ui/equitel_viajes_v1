#!/usr/bin/env node
/**
 * Verifica las reglas de aerolínea y canal de compra (#A82) y que los DOS lados
 * coincidan:
 *
 *   - `server/Code.gs`    → `_normalizePurchaseInfo_`, `_purchaseAirlineName_`, `_purchaseKey_`, `PURCHASE_CHANNELS`, `PURCHASE_AIRLINES`
 *   - `utils/purchase.ts` → `normalizePurchaseInfo`, `PURCHASE_CHANNELS`, `PURCHASE_AIRLINES`
 *
 * Reglas: el canal es Aviatur, Directo u Otra agencia (sin importar tildes ni
 * mayúsculas); la aerolínea es obligatoria salvo en solo hospedaje, máximo 40
 * caracteres, solo letras, números, espacios y . & ' / -; los nombres conocidos
 * se guardan con su escritura oficial (latam → LATAM).
 *
 * #A85: aerolínea del regreso opcional (4.º argumento). Mismas reglas de
 * escritura; vacía o igual a la de ida se guarda vacía; solo hospedaje la ignora.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function extract(source, name, kind) {
  const start = source.indexOf(kind === 'var' ? 'var ' + name + ' = ' : 'function ' + name + '(');
  if (start === -1) throw new Error(`No se encontró ${name} en server/Code.gs`);
  if (kind === 'var') return source.slice(start, source.indexOf(';', start) + 1);
  let depth = 0;
  for (let j = source.indexOf('{', start); j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(start, j + 1);
  }
  throw new Error(`No se pudo delimitar ${name}() en server/Code.gs`);
}

function loadBackend() {
  const gs = fs.readFileSync(path.join(ROOT, 'server', 'Code.gs'), 'utf8');
  const code = [extract(gs, 'PURCHASE_CHANNELS', 'var'), extract(gs, 'PURCHASE_AIRLINES', 'var'), extract(gs, 'PURCHASE_AIRLINE_MAX', 'var'),
    extract(gs, '_purchaseKey_'), extract(gs, '_purchaseAirlineName_'), extract(gs, '_normalizePurchaseInfo_')].join('\n');
  const ctx = {};
  vm.createContext(ctx);
  new vm.Script(code, { filename: 'Code.gs (extracto compra)' }).runInContext(ctx);
  return {
    channels: vm.runInContext('PURCHASE_CHANNELS', ctx), airlines: vm.runInContext('PURCHASE_AIRLINES', ctx),
    check: (a, c, h, r) => { ctx.__a = [a, c, h, r]; return vm.runInContext('_normalizePurchaseInfo_(__a[0], __a[1], __a[2], __a[3])', ctx); },
  };
}

function loadFrontend() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
  const src = fs.readFileSync(path.join(ROOT, 'utils', 'purchase.ts'), 'utf8');
  const out = esbuild.transformSync(src, { loader: 'ts', format: 'cjs' });
  const mod = { exports: {} };
  new vm.Script(out.code, { filename: 'purchase.ts' }).runInNewContext({ module: mod, exports: mod.exports, require });
  const e = mod.exports;
  if (typeof e.normalizePurchaseInfo !== 'function') throw new Error('utils/purchase.ts no exporta normalizePurchaseInfo()');
  return { channels: e.PURCHASE_CHANNELS, airlines: e.PURCHASE_AIRLINES, check: e.normalizePurchaseInfo,
    form: e.checkPurchaseForm, formFrom: e.purchaseFormFrom, label: e.purchaseAirlineLabel };
}

// [aerolínea, canal, soloHospedaje, ok esperado, aerolínea guardada, canal guardado]
const CASES = [
  ['LATAM', 'Aviatur', false, true, 'LATAM', 'Aviatur'],
  ['latam', 'aviatur', false, true, 'LATAM', 'Aviatur'],
  ['  avianca  ', 'DIRECTO', false, true, 'Avianca', 'Directo'],
  ['aeromexico', 'otra agencia', false, true, 'Aeroméxico', 'Otra agencia'],
  ['AEROMÉXICO', 'Otra  Agencia', false, true, 'Aeroméxico', 'Otra agencia'],
  ['jetsmart', 'Aviatur', false, true, 'JetSMART', 'Aviatur'],
  ['Turkish Airlines', 'Aviatur', false, true, 'Turkish Airlines', 'Aviatur'],
  ['Air France / KLM', 'Directo', false, true, 'Air France / KLM', 'Directo'],
  ["Viva Air Perú", 'Directo', false, true, 'Viva Air Perú', 'Directo'],
  ['varias aerolineas', 'Aviatur', false, true, 'Varias aerolíneas', 'Aviatur'],
  ['', 'Aviatur', true, true, '', 'Aviatur'],
  ['LATAM', 'Directo', true, true, '', 'Directo'],
  ['', 'Aviatur', false, false],
  ['   ', 'Aviatur', false, false],
  [null, 'Aviatur', false, false],
  ['LATAM', '', false, false],
  ['LATAM', undefined, false, false],
  ['', '', true, false],
  ['LATAM', 'Booking', false, false],
  ['LATAM', 'aviatur.com', false, false],
  ['=HYPERLINK("x")', 'Aviatur', false, false],
  ['+57 Air', 'Aviatur', false, false],
  ['-Avianca', 'Aviatur', false, false],
  ['Avianca<script>', 'Aviatur', false, false],
  ['A'.repeat(41), 'Aviatur', false, false],
  ['A'.repeat(40), 'Aviatur', false, true, 'A'.repeat(40), 'Aviatur'],
  ['Avianca × 2', 'Aviatur', false, false],
];

// #A85: [aerolínea, canal, soloHospedaje, regreso, ok esperado, aerolínea, canal, regreso guardados]
const RETURN_CASES = [
  ['LATAM', 'Aviatur', false, 'Avianca', true, 'LATAM', 'Aviatur', 'Avianca'],
  ['latam', 'aviatur', false, '  avianca ', true, 'LATAM', 'Aviatur', 'Avianca'],
  ['LATAM', 'Directo', false, 'Turkish Airlines', true, 'LATAM', 'Directo', 'Turkish Airlines'],
  ['Avianca', 'Aviatur', false, 'AVIANCA', true, 'Avianca', 'Aviatur', ''],
  ['Avianca', 'Aviatur', false, '', true, 'Avianca', 'Aviatur', ''],
  ['Avianca', 'Aviatur', false, '   ', true, 'Avianca', 'Aviatur', ''],
  ['Avianca', 'Aviatur', false, null, true, 'Avianca', 'Aviatur', ''],
  ['Avianca', 'Aviatur', false, undefined, true, 'Avianca', 'Aviatur', ''],
  ['', 'Aviatur', true, 'Avianca', true, '', 'Aviatur', ''],
  ['', 'Aviatur', false, 'Avianca', false],
  ['LATAM', '', false, 'Avianca', false],
  ['LATAM', 'Aviatur', false, '=HYPERLINK("x")', false],
  ['LATAM', 'Aviatur', false, '-Avianca', false],
  ['LATAM', 'Aviatur', false, 'A'.repeat(41), false],
  ['LATAM', 'Aviatur', false, 'A'.repeat(40), true, 'LATAM', 'Aviatur', 'A'.repeat(40)],
  ['=x', 'Aviatur', false, 'Avianca', false],
];

// ------------------------------------------------------------------ guardado en la hoja (#A85)
// Carga Code.gs completo con una hoja en memoria y recorre el camino real:
// _authorizeStatusUpdate_ → updateRequestStatus (confirmar costos) y setPurchaseInfo
// (registrar la reserva), incluida una pestaña con la app anterior.

function memorySheet(name, rows) {
  const t = rows.map((r) => r.slice());
  const s = {
    name, data: t, getName: () => name, getLastRow: () => t.length,
    getLastColumn: () => t.reduce((m, r) => Math.max(m, r.length), 0),
    getMaxColumns: () => 100, insertColumnsAfter() {}, setColumnWidth() {},
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      const rng = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((t[r - 1 + i] || [])[c - 1 + j] ?? ''))),
        getValue: () => (t[r - 1] || [])[c - 1] ?? '',
        setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { t[r - 1 + i][c - 1 + j] = x; })); return rng; },
        setValue(v) { while (t.length < r) t.push([]); t[r - 1][c - 1] = v; return rng; },
        setFontWeight: () => rng, setNote: () => rng, setBackground: () => rng, setFontColor: () => rng, setNumberFormat: () => rng,
      };
      return rng;
    },
  };
  return s;
}

function checkBackendWrites(failures) {
  const gs = fs.readFileSync(path.join(ROOT, 'server', 'Code.gs'), 'utf8');
  const HEAD = ['ID RESPUESTA', 'STATUS', 'MODO_SOLICITUD', 'FECHA IDA', 'FECHA VUELTA', 'COSTO_FINAL_TIQUETES', 'COSTO_FINAL_HOTEL',
    'COSTO COTIZADO PARA VIAJE', 'AEROLINEA', 'CANAL DE COMPRA', 'EVENTOS_JSON', 'CORREO ENCUESTADO'];
  const row = (id, mode, ret) => [id, 'PENDIENTE_CONFIRMACION_COSTO', mode, '2026-10-20', ret, '', '', '', '', '', '{}', 'viajero@ejemplo.test'];
  const base = memorySheet('Nueva Base Solicitudes', [HEAD,
    row('SOL-1', 'VIAJE', '2026-10-22'), row('SOL-2', 'VIAJE', ''), row('SOL-3', 'SOLO_HOSPEDAJE', '2026-10-22'), row('SOL-4', 'VIAJE', '2026-10-22'),
    row('SOL-5', 'VIAJE', '2026-10-22')]);
  const ss = { getSheetByName: (n) => (n === 'Nueva Base Solicitudes' ? base : null), getId: () => 'HOJA-ID' };
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} }, Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, getProperties: () => ({}), setProperty() {}, deleteProperty() {}, getKeys: () => [] }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true }) },
    Session: { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => '' }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} },
  };
  // Correo, Drive y demás quedan como objetos vacíos: aquí no se envía nada.
  const stub = () => new Proxy(function () { return stub(); }, { get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : stub()) });
  for (const g of ['DriveApp', 'HtmlService', 'ContentService', 'UrlFetchApp', 'DocumentApp', 'MailApp', 'GmailApp', 'ScriptApp', 'Utilities']) ctx[g] = stub();
  vm.createContext(ctx);
  new vm.Script(gs, { filename: 'Code.gs' }).runInContext(ctx);
  ctx.isUserAnalyst = () => true;
  ctx.validateUserSession_ = () => true;
  ctx.validateUserEmail_ = () => true;

  const cell = (id, h) => { const i = base.data[0].indexOf(h); return i < 0 ? '(sin columna)' : base.data.find((r) => r[0] === id)[i] ?? ''; };
  const trio = (id) => [cell(id, 'AEROLINEA'), cell(id, 'CANAL DE COMPRA'), cell(id, 'AEROLINEA REGRESO')];
  let count = 0;
  const eq = (name, got, want) => { count++; if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`guardado · ${name}: ${JSON.stringify(got)}, se esperaba ${JSON.stringify(want)}`); };
  const confirm = (id, extra) => {
    const a = ctx._authorizeStatusUpdate_('analista@ejemplo.test', { id, status: 'PENDIENTE_APROBACION',
      payload: Object.assign({ finalCostTickets: 800000, finalCostHotel: 0, totalCost: 800000 }, extra) });
    ctx._clearReqHeadersCache_();
    ctx.updateRequestStatus(a.id, a.status, a.payload);
    ctx._clearReqHeadersCache_();
  };
  const set = (...args) => { ctx._clearReqHeadersCache_(); const r = ctx.setPurchaseInfo(...args); ctx._clearReqHeadersCache_(); return r; };
  const throws = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };

  // App anterior primero: no manda la clave, no crea la columna.
  confirm('SOL-4', { purchaseAirline: 'Avianca', purchaseChannel: 'Aviatur' });
  eq('app anterior al confirmar costos: no crea la columna', trio('SOL-4'), ['Avianca', 'Aviatur', '(sin columna)']);

  confirm('SOL-1', { purchaseAirline: 'latam', purchaseChannel: 'aviatur', purchaseReturnAirline: 'avianca' });
  eq('confirmar costos con regreso en otra aerolínea', trio('SOL-1'), ['LATAM', 'Aviatur', 'Avianca']);
  eq('la columna nueva queda al final', base.data[0][base.data[0].length - 1], 'AEROLINEA REGRESO');

  confirm('SOL-1', { purchaseAirline: 'LATAM', purchaseChannel: 'Directo' });
  eq('app anterior al confirmar costos: no borra el regreso', trio('SOL-1'), ['LATAM', 'Directo', 'Avianca']);
  set('SOL-1', 'LATAM', 'Aviatur');
  eq('app anterior al registrar la reserva: no borra el regreso', trio('SOL-1'), ['LATAM', 'Aviatur', 'Avianca']);
  eq('setPurchaseInfo devuelve el regreso', set('SOL-1', 'Wingo', 'Directo', 'LATAM'), { airline: 'Wingo', channel: 'Directo', returnAirline: 'LATAM' });
  eq('registrar la reserva cambia ida y regreso', trio('SOL-1'), ['Wingo', 'Directo', 'LATAM']);
  set('SOL-1', 'Avianca', 'Aviatur', 'AVIANCA');
  eq('regreso igual a la ida se guarda vacío', trio('SOL-1'), ['Avianca', 'Aviatur', '']);
  set('SOL-1', 'LATAM', 'Aviatur', 'Avianca');
  set('SOL-1', 'LATAM', 'Aviatur', '');
  eq('regreso vacío desde la app nueva lo borra', trio('SOL-1'), ['LATAM', 'Aviatur', '']);

  set('SOL-2', 'LATAM', 'Aviatur', 'Avianca');
  eq('solo ida: no guarda aerolínea de regreso', trio('SOL-2'), ['LATAM', 'Aviatur', '']);
  confirm('SOL-3', { purchaseAirline: 'LATAM', purchaseChannel: 'Directo', purchaseReturnAirline: 'Avianca' });
  eq('solo hospedaje: ni aerolínea ni regreso', trio('SOL-3'), ['', 'Directo', '']);

  set('SOL-1', 'LATAM', 'Aviatur', 'Avianca');
  const antes = JSON.stringify(base.data);
  eq('regreso inválido al registrar: error claro', /del regreso/.test(throws(() => set('SOL-1', 'LATAM', 'Aviatur', '=HYPERLINK("x")'))), true);
  eq('regreso inválido al confirmar costos: error claro', /del regreso/.test(throws(() => confirm('SOL-1', { purchaseAirline: 'LATAM', purchaseChannel: 'Aviatur', purchaseReturnAirline: '-x' }))), true);
  eq('regreso solo, sin canal: se rechaza', /canal/.test(throws(() => confirm('SOL-1', { purchaseReturnAirline: 'Avianca' }))), true);
  eq('un error no escribe nada', JSON.stringify(base.data) === antes, true);

  const mapped = ctx.mapRowToRequest(base.data.find((r) => r[0] === 'SOL-1'));
  eq('la solicitud que recibe la app trae el regreso', [mapped.purchaseAirline, mapped.purchaseReturnAirline], ['LATAM', 'Avianca']);
  eq('la acción setPurchaseInfo pasa el regreso', gs.includes('setPurchaseInfo(payload.requestId, payload.airline, payload.channel, payload.returnAirline)'), true);

  // #A86: confirmar costos por la API deja quién lo hizo (lo muestra el comparador de precios).
  ctx._clearReqHeadersCache_();
  const res = ctx.dispatch('updateRequest', { userEmail: 'Analista@Ejemplo.test', sessionToken: 'x', id: 'SOL-5', status: 'PENDIENTE_APROBACION',
    payload: { finalCostTickets: 500000, finalCostHotel: 0, totalCost: 500000, purchaseAirline: 'Wingo', purchaseChannel: 'Directo', purchaseReturnAirline: '' } });
  ctx._clearReqHeadersCache_();
  const evs = JSON.parse(cell('SOL-5', 'EVENTOS_JSON') || '{}');
  eq('confirmar costos por la API: queda quién y cuándo', [res.success, evs.costConfirmedBy && evs.costConfirmedBy.email, !!(evs.costConfirmedBy && evs.costConfirmedBy.at), !!evs.costConfirmed],
    [true, 'analista@ejemplo.test', true, true]);
  const res2 = ctx.dispatch('updateRequest', { userEmail: 'otra@ejemplo.test', sessionToken: 'x', id: 'SOL-5', status: 'PENDIENTE_APROBACION',
    payload: { finalCostTickets: 600000, finalCostHotel: 0, totalCost: 600000, purchaseAirline: 'Wingo', purchaseChannel: 'Directo' } });
  ctx._clearReqHeadersCache_();
  eq('una segunda confirmación no cambia quién confirmó primero', [res2.success, JSON.parse(cell('SOL-5', 'EVENTOS_JSON')).costConfirmedBy.email], [true, 'analista@ejemplo.test']);
  return count;
}

function main() {
  let back, front;
  try { back = loadBackend(); front = loadFrontend(); } catch (e) {
    console.error('✗ No se pudieron cargar las reglas de aerolínea y canal:\n  ' + e.message);
    process.exit(1);
  }
  const failures = [];
  if (JSON.stringify(back.channels) !== JSON.stringify(front.channels)) failures.push('Los canales difieren entre backend y frontend.');
  if (JSON.stringify(back.airlines) !== JSON.stringify(front.airlines)) failures.push('La lista de aerolíneas difiere entre backend y frontend.');
  for (const [a, c, h, ok, airline, channel] of CASES) {
    const b = back.check(a, c, h), f = front.check(a, c, h);
    const tag = JSON.stringify([a, c, h]);
    for (const [side, r] of [['backend', b], ['frontend', f]]) {
      if (r.ok !== ok) failures.push(`${tag}: ${side} ${r.ok ? 'acepta' : 'rechaza'} y se esperaba lo contrario`);
      else if (ok && (r.airline !== airline || r.channel !== channel)) failures.push(`${tag}: ${side} guarda ${JSON.stringify([r.airline, r.channel])}`);
      else if (!ok && !r.error) failures.push(`${tag}: ${side} rechaza sin mensaje`);
    }
    if (JSON.stringify(b) !== JSON.stringify(f)) failures.push(`${tag}: frontend y backend no coinciden (${JSON.stringify(b)} / ${JSON.stringify(f)})`);
  }
  for (const [a, c, h, r, ok, airline, channel, ret] of RETURN_CASES) {
    const b = back.check(a, c, h, r), f = front.check(a, c, h, r);
    const tag = 'regreso ' + JSON.stringify([a, c, h, r]);
    // Si la ida y el canal son válidos, el error tiene que nombrar el regreso.
    const blameReturn = !ok && back.check(a, c, h).ok;
    for (const [side, x] of [['backend', b], ['frontend', f]]) {
      if (x.ok !== ok) failures.push(`${tag}: ${side} ${x.ok ? 'acepta' : 'rechaza'} y se esperaba lo contrario`);
      else if (ok && (x.airline !== airline || x.channel !== channel || x.returnAirline !== ret)) {
        failures.push(`${tag}: ${side} guarda ${JSON.stringify([x.airline, x.channel, x.returnAirline])}`);
      } else if (!ok && !x.error) failures.push(`${tag}: ${side} rechaza sin mensaje`);
      else if (blameReturn && !/del regreso/.test(x.error)) failures.push(`${tag}: ${side} no dice que el problema es la aerolínea del regreso (${x.error})`);
    }
    if (JSON.stringify(b) !== JSON.stringify(f)) failures.push(`${tag}: frontend y backend no coinciden (${JSON.stringify(b)} / ${JSON.stringify(f)})`);
  }
  let writeChecks = 0;
  try { writeChecks = checkBackendWrites(failures); } catch (e) { failures.push('guardado: ' + (e && e.stack || e)); }

  // Casilla «El regreso es con otra aerolínea» (solo pantalla, sin gemelo).
  const F = (o) => Object.assign({ airline: 'LATAM', channel: 'Aviatur', splitReturn: false, returnAirline: '' }, o);
  const formCases = [
    // [formulario, soloHospedaje, se puede separar, ok, regreso guardado]
    [F({ splitReturn: true, returnAirline: 'Avianca' }), false, true, true, 'Avianca'],
    [F({ splitReturn: true, returnAirline: '' }), false, true, false],
    [F({ splitReturn: true, returnAirline: '  ' }), false, true, false],
    [F({ splitReturn: true, returnAirline: 'latam' }), false, true, true, ''],
    [F({ splitReturn: false, returnAirline: 'Avianca' }), false, true, true, ''],
    [F({ splitReturn: true, returnAirline: 'Avianca' }), false, false, true, ''],
    [F({ splitReturn: true, returnAirline: '' }), false, false, true, ''],
    [F({ airline: '', splitReturn: true, returnAirline: 'Avianca' }), true, true, true, ''],
  ];
  formCases.forEach(([form, h, can, ok, ret], i) => {
    const r = front.form(form, h, can);
    if (r.ok !== ok) failures.push(`formulario #${i + 1}: ${r.ok ? 'acepta' : 'rechaza'} y se esperaba lo contrario (${r.error || ''})`);
    else if (ok && r.returnAirline !== ret) failures.push(`formulario #${i + 1}: regreso ${JSON.stringify(r.returnAirline)}`);
    else if (!ok && !/aerolínea del regreso/.test(r.error || '')) failures.push(`formulario #${i + 1}: mensaje inesperado ${r.error}`);
  });
  const ff = front.formFrom({ purchaseAirline: 'LATAM', purchaseChannel: 'Aviatur', purchaseReturnAirline: 'Avianca' });
  if (!ff.splitReturn || ff.returnAirline !== 'Avianca') failures.push('purchaseFormFrom no marca la casilla con un regreso guardado');
  if (front.formFrom({}).splitReturn) failures.push('purchaseFormFrom marca la casilla sin regreso guardado');
  if (front.label('LATAM', 'Avianca') !== 'LATAM (ida) y Avianca (regreso)' || front.label('LATAM', '') !== 'LATAM') {
    failures.push('purchaseAirlineLabel: ' + front.label('LATAM', 'Avianca'));
  }

  if (failures.length) {
    console.error(`\n✗ Aerolínea y canal: ${failures.length} problema(s).\n`);
    failures.forEach((x) => console.error('  · ' + x));
    process.exit(1);
  }
  console.log(`Aerolínea y canal: ${CASES.length + RETURN_CASES.length} casos OK (${RETURN_CASES.length} con aerolínea de regreso) y ${formCases.length} del formulario; frontend y backend coinciden. Guardado en la hoja: ${writeChecks} verificaciones OK.`);
}

main();
