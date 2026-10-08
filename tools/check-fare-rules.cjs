#!/usr/bin/env node
/**
 * Verifica las reglas de tarifa del manual COM-P-02 (#A95) y que los DOS lados coincidan:
 *
 *   - `server/Code.gs`  → FARE_TABLE, _fareOptionForNights_, _fareNights_, _fareName_,
 *                         _fareLabel_, _fareIsException_, _normalizeFare_
 *   - `utils/fare.ts`   → FARE_TABLE, fareOptionForNights, fareNights, fareName,
 *                         fareLabel, fareIsException, normalizeFare
 *
 * Reglas: TIPO 1 de 0 a 1 noche, TIPO 2 de 2 a 5, TIPO 3 de 6 o más; noches = regreso −
 * ida, sin regreso las de hotel. En Avianca TIPO 2 y 3 son la misma (Classic): no es
 * excepción. Fuera del manual cuenta el número. Una excepción pide justificación de
 * 10 a 500 caracteres.
 *
 * También guarda en una hoja en memoria: confirmar costos y registrar reserva.
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

function loadBackend(gs) {
  const code = ['FARE_TABLE', 'FARE_JUSTIFICATION_MIN', 'FARE_JUSTIFICATION_MAX'].map((n) => extract(gs, n, 'var'))
    .concat(['_purchaseKey_', '_fareOptionForNights_', '_fareNights_', '_fareName_', '_fareLabel_', '_fareIsException_', '_fareOptionValue_', '_normalizeFare_']
      .map((n) => extract(gs, n))).join('\n');
  const ctx = {};
  vm.createContext(ctx);
  new vm.Script(code, { filename: 'Code.gs (extracto tarifa)' }).runInContext(ctx);
  const call = (fn, args) => { ctx.__a = args; return vm.runInContext(fn + '.apply(null, __a)', ctx); };
  return {
    table: vm.runInContext('FARE_TABLE', ctx),
    forNights: (n) => call('_fareOptionForNights_', [n]),
    nights: (d, r, h) => call('_fareNights_', [d, r, h]),
    name: (a, o) => call('_fareName_', [a, o]),
    label: (o, a, r) => call('_fareLabel_', [o, a, r]),
    exception: (o, rec, al) => call('_fareIsException_', [o, rec, al]),
    normalize: (o, j, rec, a, r) => call('_normalizeFare_', [o, j, rec, a, r]),
  };
}

function loadFrontend() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
  const out = esbuild.buildSync({ entryPoints: [path.join(ROOT, 'utils', 'fare.ts')], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'error' });
  const mod = { exports: {} };
  new vm.Script(out.outputFiles[0].text, { filename: 'fare.ts' }).runInNewContext({ module: mod, exports: mod.exports, require });
  const e = mod.exports;
  if (typeof e.normalizeFare !== 'function') throw new Error('utils/fare.ts no exporta normalizeFare()');
  return {
    table: e.FARE_TABLE, forNights: e.fareOptionForNights, nights: e.fareNights, name: e.fareName, label: e.fareLabel,
    exception: e.fareIsException, normalize: e.normalizeFare, recommendation: e.fareRecommendation, dateKey: e.fareDateKey,
    formFrom: e.fareFormFrom, short: e.fareShort, includesChecked: e.fareIncludesChecked, checkedText: e.fareCheckedOptionsText,
    baggageLabel: e.fareBaggageLabel,
  };
}

// ------------------------------------------------------------------ casos
const NIGHTS = [[0, 1], [1, 1], [2, 2], [5, 2], [6, 3], [7, 3], [30, 3], [-1, 1], ['3', 2], [null, 1], ['x', 1], [1.5, 2]];
// [ida, regreso, noches de hotel, noches esperadas]
const TRIP = [
  ['2026-10-20', '2026-10-20', 0, 0], ['2026-10-20', '2026-10-21', 0, 1], ['2026-10-20', '2026-10-23', 0, 3],
  ['2026-10-28', '2026-11-03', 0, 6], ['2026-12-30', '2027-01-02', 0, 3], ['2026-10-20', '', 4, 4], ['2026-10-20', '', 0, 0],
  ['2026-10-20', '', '', 0], ['2026-10-23', '2026-10-20', 0, 0], ['', '', 2, 2], ['2026-10-20T00:00:00', '2026-10-25', 0, 5],
];
// [aerolínea, opción, nombre]
const NAMES = [
  ['Avianca', 1, 'Basic'], ['Avianca', 2, 'Classic'], ['Avianca', 3, 'Classic'], ['LATAM', 1, 'Basic'], ['latam', 2, 'Light'],
  ['LATAM', 3, 'Full'], ['Clic', 1, 'VeLigera'], ['Clic', 3, 'VePreferencial'], ['Satena', 2, 'Z0Econo'], ['Wingo', 2, ''], ['', 1, ''],
];
// [opción, recomendada, aerolíneas, ¿excepción?]
const EXC = [
  [2, 2, ['Avianca'], false], [3, 2, ['Avianca'], false], [2, 3, ['Avianca'], false], [1, 2, ['Avianca'], true],
  [3, 2, ['LATAM'], true], [2, 2, ['Wingo'], false], [3, 2, ['Wingo'], true], [3, 2, [], true],
  [3, 2, ['Avianca', 'LATAM'], true], [3, 2, ['Avianca', 'Wingo'], false], [2, 1, ['Satena'], true],
];
const J = 'El viajero lleva equipo de medición en bodega';
// [opción, justificación, recomendada, aerolínea, regreso, ok, opción guardada, nombre, excepción, justificación guardada]
const NORM = [
  ['2', '', 2, 'Avianca', '', true, 2, 'Classic', false, ''],
  ['TIPO 3', 'algo que no se guarda', 2, 'Avianca', '', true, 3, 'Classic', false, ''],
  ['tipo 1', '', '1', 'LATAM', '', true, 1, 'Basic', false, ''],
  [2, '', 2, 'LATAM', 'Avianca', true, 2, 'Light (ida) y Classic (regreso)', false, ''],
  [3, '  ' + J + '  ', 2, 'LATAM', '', true, 3, 'Full', true, J],
  [3, 'corto', 2, 'LATAM', '', false],
  [3, '', 2, 'LATAM', '', false],
  [1, 'x'.repeat(501), 2, 'Avianca', '', false],
  [1, 'x'.repeat(500), 2, 'Avianca', '', true, 1, 'Basic', true, 'x'.repeat(500)],
  [3, J, 2, 'Wingo', '', true, 3, '', true, J],
  ['Opción 2', '', 'TIPO 2', 'JetSMART', '', true, 2, '', false, ''],
  ['4', '', 2, 'Avianca', '', false],
  ['', '', 2, 'Avianca', '', false],
  [null, '', 2, 'Avianca', '', false],
  [2, '', '', 'Avianca', '', false],
  [1, '', 2, 'Avianca', 'Avianca', false],
];

// ------------------------------------------------------------------ guardado en la hoja
function memorySheet(name, rows) {
  const t = rows.map((r) => r.slice());
  return {
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
}

function checkWrites(gs, failures) {
  const HEAD = ['ID RESPUESTA', 'STATUS', 'MODO_SOLICITUD', 'FECHA IDA', 'FECHA VUELTA', '# NOCHES (AUTOMÁTICO)', 'COSTO_FINAL_TIQUETES',
    'COSTO_FINAL_HOTEL', 'COSTO COTIZADO PARA VIAJE', 'TIPO DE COMPRA DE TKT', 'AEROLINEA', 'CANAL DE COMPRA', 'EVENTOS_JSON', 'CORREO ENCUESTADO'];
  const row = (id, mode, ida, ret, nights, tipo) => [id, 'PENDIENTE_CONFIRMACION_COSTO', mode, ida, ret, nights, '', '', '', tipo || '', '', '', '{}', 'viajero@ejemplo.test'];
  const base = memorySheet('Nueva Base Solicitudes', [HEAD,
    row('SOL-1', 'VIAJE', '20-10-2026', '23-10-2026', 0), row('SOL-2', 'VIAJE', '2026-10-20', '2026-10-21', 0, 'TIPO 2'),
    row('SOL-3', 'SOLO_HOSPEDAJE', '2026-10-20', '2026-10-27', 7), row('SOL-4', 'VIAJE', new Date(2026, 9, 20), '', 8)]);
  const ss = { getSheetByName: (n) => (n === 'Nueva Base Solicitudes' ? base : null), getId: () => 'HOJA-ID' };
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} }, Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, getProperties: () => ({}), setProperty() {}, deleteProperty() {}, getKeys: () => [] }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true }) },
    Session: { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => '' }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} },
    Utilities: { formatDate: (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') },
  };
  const stub = () => new Proxy(function () { return stub(); }, { get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : stub()) });
  for (const g of ['DriveApp', 'HtmlService', 'ContentService', 'UrlFetchApp', 'DocumentApp', 'MailApp', 'GmailApp', 'ScriptApp']) ctx[g] = stub();
  vm.createContext(ctx);
  new vm.Script(gs, { filename: 'Code.gs' }).runInContext(ctx);
  ctx.isUserAnalyst = () => true;

  let count = 0;
  const eq = (name, got, want) => { count++; if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`guardado · ${name}: ${JSON.stringify(got)}, se esperaba ${JSON.stringify(want)}`); };
  const cell = (id, h) => { const i = base.data[0].indexOf(h); return i < 0 ? '(sin columna)' : base.data.find((r) => r[0] === id)[i] ?? ''; };
  const fare = (id) => ['TIPO DE COMPRA DE TKT', 'TARIFA RECOMENDADA', 'TARIFA NOMBRE', 'TARIFA JUSTIFICACION'].map((h) => cell(id, h));
  const confirm = (id, extra) => {
    ctx._clearReqHeadersCache_();
    const a = ctx._authorizeStatusUpdate_('analista@ejemplo.test', { id, status: 'PENDIENTE_APROBACION',
      payload: Object.assign({ finalCostTickets: 800000, finalCostHotel: 0, totalCost: 800000 }, extra) });
    ctx._clearReqHeadersCache_();
    ctx.updateRequestStatus(a.id, a.status, a.payload);
    ctx._clearReqHeadersCache_();
    return a;
  };
  const set = (...args) => { ctx._clearReqHeadersCache_(); const r = ctx.setPurchaseInfo(...args); ctx._clearReqHeadersCache_(); return r; };
  const throws = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };

  confirm('SOL-1', { purchaseAirline: 'Avianca', purchaseChannel: 'Aviatur' });
  eq('app anterior (sin tarifa): no toca la tarifa', fare('SOL-1'), ['', '(sin columna)', '(sin columna)', '(sin columna)']);
  confirm('SOL-1', { purchaseAirline: 'Avianca', purchaseChannel: 'Aviatur', fareOption: '3' });
  eq('3 noches con Avianca: TIPO 3 = Classic, sin excepción', fare('SOL-1'), ['TIPO 3', 'TIPO 2', 'Classic', '']);
  eq('una tarifa inferior sin justificación: error y nada escrito', /no es la que recomienda/.test(throws(() => confirm('SOL-1', { purchaseAirline: 'Avianca', purchaseChannel: 'Aviatur', fareOption: '1' }))), true);
  eq('sigue la de antes', fare('SOL-1')[0], 'TIPO 3');
  confirm('SOL-1', { purchaseAirline: 'LATAM', purchaseChannel: 'Directo', fareOption: 1, fareJustification: J });
  eq('excepción justificada con LATAM', fare('SOL-1'), ['TIPO 1', 'TIPO 2', 'Basic', J]);
  eq('un cliente no puede mandar la tarifa hecha', confirm('SOL-1', { purchaseAirline: 'LATAM', purchaseChannel: 'Directo',
    fare: { ok: true, option: 3, recommended: 3, name: '=HACK()', justification: '' } }).payload.fare, undefined);
  eq('y no la escribe', fare('SOL-1')[2], 'Basic');

  eq('reserva: 1 noche sin aerolínea, TIPO 2 sin justificación: error', /no es la que recomienda/.test(throws(() => set('SOL-2', undefined, undefined, undefined, undefined, undefined, '2'))), true);
  eq('reserva: solo la tarifa, justificada', set('SOL-2', undefined, undefined, undefined, undefined, undefined, '2', J),
    { fareType: '2', fareRecommended: '1', fareName: '', fareJustification: J });
  set('SOL-2', 'Avianca', 'Aviatur', undefined, undefined, undefined, '1');
  eq('reserva con aerolínea y tarifa juntas', [cell('SOL-2', 'AEROLINEA'), fare('SOL-2')], ['Avianca', ['TIPO 1', 'TIPO 1', 'Basic', '']]);
  const antes = JSON.stringify(base.data);
  eq('reserva: tarifa inválida no escribe la compra', /Seleccione la tarifa/.test(throws(() => set('SOL-2', 'LATAM', 'Directo', undefined, undefined, undefined, '5'))), true);
  eq('nada a medias', JSON.stringify(base.data) === antes, true);
  set('SOL-3', '', 'Directo', undefined, 'Hotel Ibis', 'Directo', '2');
  eq('solo hospedaje: no lleva tarifa', fare('SOL-3')[0], '');
  set('SOL-4', 'Avianca', 'Aviatur', undefined, undefined, undefined, '3');
  eq('solo ida con 8 noches de hotel: TIPO 3', fare('SOL-4'), ['TIPO 3', 'TIPO 3', 'Classic', '']);

  const mapped = ctx.mapRowToRequest(base.data.find((r) => r[0] === 'SOL-1'));
  eq('la solicitud que recibe la app trae la tarifa', [mapped.fareType, mapped.fareRecommended, mapped.fareName, mapped.fareJustification], ['1', '2', 'Basic', J]);
  const legacy = ctx.mapRowToRequest(['SOL-9', 'RESERVADO', 'VIAJE', '', '', '', '', '', '', 'TIIPO 2']);
  eq('un valor histórico mal escrito no se toma como tarifa', legacy.fareType, '');
  eq('la acción pasa la tarifa', gs.includes('payload.fareOption, payload.fareJustification); break;'), true);
  // Maleta de bodega del formulario de solicitud (#A95).
  eq('maleta de bodega: lo que escribe la solicitud (solo vuelos y si el formulario la pregunta)',
    [{ checkedBaggage: true }, { checkedBaggage: false }, {}, { requestMode: 'HOTEL_ONLY', checkedBaggage: true }, { checkedBaggage: 'true' }].map((d) => ctx._checkedBaggageValue_(d)),
    ['SI', 'NO', null, null, null]);
  eq('maleta de bodega: lo que lee la app', ['SI', 'Sí', 'NO', '', 'x'].map((v) => ctx._checkedBaggageFromCell_(v)), [true, true, false, null, null]);
  eq('sin la columna, la app recibe null (no se preguntó)', legacy.checkedBaggage, null);
  eq('createNewRequest la guarda solo si el formulario la pregunta', /if \(_checkedBag !== null\) set\(CHECKED_BAG_HEADER, _checkedBag\)/.test(gs), true);
  return count;
}

function main() {
  let back, front, gs;
  try {
    gs = fs.readFileSync(path.join(ROOT, 'server', 'Code.gs'), 'utf8');
    back = loadBackend(gs); front = loadFrontend();
  } catch (e) {
    console.error('✗ No se pudieron cargar las reglas de tarifa:\n  ' + e.message);
    process.exit(1);
  }
  const failures = [];
  const same = (tag, b, f) => { if (JSON.stringify(b) !== JSON.stringify(f)) failures.push(`${tag}: frontend y backend no coinciden (${JSON.stringify(b)} / ${JSON.stringify(f)})`); };
  same('tabla del manual', back.table, front.table);
  NIGHTS.forEach(([n, want]) => { const b = back.forNights(n); same('noches ' + n, b, front.forNights(n)); if (b !== want) failures.push(`noches ${n}: TIPO ${b}, se esperaba ${want}`); });
  TRIP.forEach(([d, r, h, want]) => { const b = back.nights(d, r, h); same('viaje ' + [d, r, h], b, front.nights(d, r, h)); if (b !== want) failures.push(`viaje ${[d, r, h]}: ${b} noches, se esperaban ${want}`); });
  NAMES.forEach(([a, o, want]) => { const b = back.name(a, o); same('nombre ' + a + o, b, front.name(a, o)); if (b !== want) failures.push(`${a} TIPO ${o}: ${b}, se esperaba ${want}`); });
  EXC.forEach(([o, rec, al, want]) => { const b = back.exception(o, rec, al); same('excepción ' + [o, rec, al], b, front.exception(o, rec, al)); if (b !== want) failures.push(`excepción ${JSON.stringify([o, rec, al])}: ${b}`); });
  NORM.forEach(([o, j, rec, a, r, ok, opt, name, exc, just]) => {
    const b = back.normalize(o, j, rec, a, r), f = front.normalize(o, j, rec, a, r);
    const tag = 'tarifa ' + JSON.stringify([o, String(j).slice(0, 20), rec, a, r]);
    same(tag, b, f);
    if (b.ok !== ok) failures.push(`${tag}: ${b.ok ? 'acepta' : 'rechaza'} y se esperaba lo contrario (${b.error || ''})`);
    else if (ok && (b.option !== opt || b.name !== name || b.exception !== exc || b.justification !== just)) failures.push(`${tag}: guarda ${JSON.stringify([b.option, b.name, b.exception, b.justification])}`);
    else if (!ok && !b.error) failures.push(`${tag}: rechaza sin mensaje`);
  });
  // Solo pantalla
  const rec = (t) => JSON.stringify(front.recommendation(t));
  if (rec({ departureDate: '2026-10-20', returnDate: '2026-10-23' }) !== JSON.stringify({ nights: 3, option: 2, byDates: true })) failures.push('fareRecommendation ida/regreso: ' + rec({ departureDate: '2026-10-20', returnDate: '2026-10-23' }));
  if (rec({ departureDate: '20-10-2026', nights: 7 }) !== JSON.stringify({ nights: 7, option: 3, byDates: false })) failures.push('fareRecommendation solo ida: ' + rec({ departureDate: '20-10-2026', nights: 7 }));
  if (front.short(2, 'Avianca') !== 'TIPO 2 · Classic' || front.short(2, 'Wingo') !== 'TIPO 2') failures.push('fareShort: ' + front.short(2, 'Avianca'));
  if (JSON.stringify(front.formFrom({}, 2)) !== JSON.stringify({ option: '2', justification: '' })) failures.push('fareFormFrom sin registro');
  if (JSON.stringify(front.formFrom({ fareType: '1', fareJustification: J }, 2)) !== JSON.stringify({ option: '1', justification: J })) failures.push('fareFormFrom con registro');
  // Maleta de bodega según el manual: Avianca desde Classic, LATAM solo Full, Clic siempre, Satena nunca.
  const bag = [['Avianca', 1], ['Avianca', 2], ['LATAM', 2], ['LATAM', 3], ['Clic', 1], ['Satena', 3], ['Wingo', 2], ['Wingo', 3]].map(([a, o]) => front.includesChecked(a, o));
  if (JSON.stringify(bag) !== JSON.stringify([false, true, false, true, true, false, false, true])) failures.push('fareIncludesChecked: ' + JSON.stringify(bag));
  if (front.checkedText() !== 'LATAM Full · Avianca Classic · Clic VeLigera; Satena no la incluye') failures.push('fareCheckedOptionsText: ' + front.checkedText());
  if (front.baggageLabel(2, 'LATAM', 'Avianca') !== 'artículo pequeño y equipaje de mano 10 kg (ida); equipaje de mano 10 kg y bodega 23 kg (regreso)') failures.push('fareBaggageLabel: ' + front.baggageLabel(2, 'LATAM', 'Avianca'));

  let writes = 0;
  try { writes = checkWrites(gs, failures); } catch (e) { failures.push('guardado: ' + (e && e.stack || e)); }

  if (failures.length) {
    console.error(`\n✗ Tarifa del manual: ${failures.length} problema(s).\n`);
    failures.forEach((x) => console.error('  · ' + x));
    process.exit(1);
  }
  const total = NIGHTS.length + TRIP.length + NAMES.length + EXC.length + NORM.length;
  console.log(`Tarifa del manual (COM-P-02): ${total} casos OK; frontend y backend coinciden. Guardado en la hoja: ${writes} verificaciones OK.`);
}

main();
