#!/usr/bin/env node
/**
 * Cambios de viaje simplificados, «Cambiar mi viaje» (#A103).
 *
 * Carga server/Code.gs en un contexto aislado con una hoja simulada y un reloj que
 * se puede mover, y comprueba:
 *   1. El plazo (5:00 p. m. del día hábil anterior; sábado 12:00 m.; domingos y
 *      festivos no cuentan) es el mismo en utils/changeWindow.ts y en Code.gs,
 *      día por día de 2026 a 2031, y la ventana (completa / solo el regreso).
 *   2. requestTripChange: dueño, motivo, que algo cambie, un cambio vivo, plazo
 *      (el administrador sin plazo), fecha nueva con tiempo, viaje en curso solo
 *      el regreso, destino de la lista, solo hospedaje, OT de antes copiada, hotel.
 *   3. El navegador no puede inyectar el JSON del cambio.
 *   4. Costo del cambio con penalidad, presupuesto (la original comprada sigue
 *      contando), tope de Cadena de Suministro con el viaje + el cambio y correo
 *      de aprobación con el costo del cambio.
 *   5. Al aprobar: la original comprada NO se anula; la no comprada y los cambios
 *      de antes sí (igual que siempre). Al registrar el tiquete: «Cambiada».
 *   6. Estadísticas, control de cambios, informe mensual y lo que ve el viajero.
 *
 * Uso: node tools/check-trip-change.cjs  (sale con código 1 si algo falla)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server', 'Code.gs'), 'utf8');
const clock = { now: Date.parse('2026-10-15T15:30:00Z') }; // jueves 15-oct-2026, 10:30 a. m. de Bogotá

function headersFromSource() {
  const m = /const HEADERS_REQUESTS = (\[[\s\S]*?\]);/.exec(SRC);
  if (!m) throw new Error('No se encontró HEADERS_REQUESTS en Code.gs');
  // eslint-disable-next-line no-new-func
  const list = new Function('return ' + m[1])();
  ['EVENTOS_JSON', 'COMENTARIOS APROBADORES (JSON)', 'APROBADO PRESUPUESTO', 'REQUIERE APROB PPTO', 'TARIFA RECOMENDADA',
    'TARIFA NOMBRE', 'TARIFA JUSTIFICACION', 'AEROLINEA', 'CANAL DE COMPRA', 'MALETA DE BODEGA', 'VALOR COMPRA TIQUETES', 'VALOR COMPRA HOTEL',
    'AEROLINEA REGRESO', 'HOTEL RESERVADO', 'CANAL DE COMPRA HOTEL'].forEach((h) => { if (!list.includes(h)) list.push(h); });
  return list;
}

function makeSheet(name, table) {
  return {
    getName: () => name, getLastRow: () => table.length, getLastColumn: () => (table[0] || []).length,
    getMaxColumns: () => (table[0] || []).length, getMaxRows: () => table.length,
    insertColumnsAfter() {}, setColumnWidth() {}, insertRowAfter() { table.push(new Array(table[0].length).fill('')); },
    appendRow(vals) { table.push(vals.slice()); },
    setFrozenRows() {}, hideSheet() {},
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      const grow = () => {
        while (table.length < r - 1 + nr) table.push(new Array((table[0] || []).length).fill(''));
        table.forEach((row) => { while (row.length < c - 1 + nc) row.push(''); });
      };
      const rng = {
        getValue: () => (table[r - 1] || [])[c - 1] ?? '',
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = table[r - 1 + i] || []; const o = row.slice(c - 1, c - 1 + nc); while (o.length < nc) o.push(''); out.push(o); } return out; },
        setValue: (v) => { grow(); table[r - 1][c - 1] = v; return rng; },
        setValues: (vals) => { grow(); vals.forEach((row, i) => row.forEach((v, j) => { table[r - 1 + i][c - 1 + j] = v; })); return rng; },
        setNote: () => rng, setFontWeight: () => rng, setBackground: () => rng, setFontColor: () => rng, setNumberFormat: () => rng,
      };
      return rng;
    },
  };
}

function load() {
  const H = headersFromSource();
  const req = [H.slice()];
  const users = [['Cedula', 'Nombre', 'Correo'], ['100', 'PEREZ ANA', 'ana@p.co'], ['200', 'ROJAS LUIS', 'luis@p.co'], ['300', 'LAURA ADMIN', 'admin@p.co']];
  const sheets = { 'Nueva Base Solicitudes': makeSheet('Nueva Base Solicitudes', req), USUARIOS: makeSheet('USUARIOS', users) };
  const props = {};
  const log = { mails: [], triggers: [], alerts: [], now: null };
  const pad = (n) => String(n).padStart(2, '0');
  const formatDate = (d, tz, f) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' })
      .formatToParts(d).map((x) => [x.type, x.value]));
    const hour = p.hour === '24' ? '00' : p.hour;
    const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
    return f.replace(/yyyy|MM|dd|HH|mm|M|d|H|u/g, (t) => ({ yyyy: p.year, MM: p.month, dd: p.day, HH: hour, mm: p.minute, M: String(+p.month), d: String(+p.day), H: String(+hour), u: String(wd) })[t]);
  };
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} }, Logger: { log() {} },
    Utilities: {
      formatDate, getUuid: () => crypto.randomUUID(), sleep() {},
      computeHmacSha256Signature: (value, key) => [...crypto.createHmac('sha256', key).update(value).digest()].map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { MD5: 'md5', SHA_256: 'sha256', SHA_1: 'sha1' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, value) => [...crypto.createHash(alg).update(String(value)).digest()].map((b) => (b > 127 ? b - 256 : b)),
      base64Encode: (v) => Buffer.from(Array.isArray(v) ? v.map((b) => b & 255) : String(v)).toString('base64'),
      base64Decode: (v) => [...Buffer.from(String(v), 'base64')],
      newBlob: (bytes, mime, name) => { const b = { getBytes: () => bytes, getContentType: () => mime, getName: () => name, setName: () => b, setContentType: () => b }; return b; },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), getProperties: () => ({ ...props }), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; }, getKeys: () => Object.keys(props) }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {}, getAll: () => ({}), putAll() {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true }) },
    Session: { getActiveUser: () => ({ getEmail: () => 'admin@p.co' }), getEffectiveUser: () => ({ getEmail: () => 'admin@p.co' }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => { const t = []; sheets[n] = makeSheet(n, t); sheets[n]._t = t; return sheets[n]; },
      }),
      flush() {},
      getUi: () => ({ alert: (...a) => { log.alerts.push(a.join(' | ')); return 'OK'; }, ButtonSet: { OK: 'OK', YES_NO: 'YES_NO' }, Button: { YES: 'YES' } }),
    },
    HtmlService: { createHtmlOutput: (h) => { const o = { html: h, setTitle: () => o, setXFrameOptionsMode: () => o, addMetaTag: () => o, getContent: () => h }; return o; }, XFrameOptionsMode: { DEFAULT: 'DEFAULT' } },
    ScriptApp: {
      getProjectTriggers: () => log.triggers.map((h) => ({ getHandlerFunction: () => h, _h: h })),
      deleteTrigger: (t) => log.triggers.splice(log.triggers.indexOf(t._h), 1),
      newTrigger: (h) => { const b = { timeBased: () => b, everyHours: (n) => { log.everyHours = n; return b; }, create: () => log.triggers.push(h) }; return b; },
    },
    MailApp: { sendEmail() { throw new Error('no debe enviar'); } }, GmailApp: { sendEmail() { throw new Error('no debe enviar'); }, getAliases: () => [] },
  };
  const stub = () => new Proxy(function () { return stub(); }, { get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : stub()) });
  for (const g of ['DriveApp', 'ContentService', 'UrlFetchApp', 'DocumentApp']) ctx[g] = stub();
  // Reloj que la prueba mueve (clock.now): el plazo del cambio depende de la hora.
  ctx.Date = class extends Date {
    constructor(...a) { super(...(a.length ? a : [clock.now])); }
    static now() { return clock.now; }
  };
  vm.createContext(ctx);
  new vm.Script(SRC, { filename: 'Code.gs' }).runInContext(ctx);
  if (typeof ctx.requestTripChange !== 'function') throw new Error('No se encontró requestTripChange() en server/Code.gs (#A103)');
  // Entorno controlado
  ctx._todayBogotaIso_ = () => ctx._bogotaKeyFromMs_(clock.now);
  ctx.getCitiesList = () => [{ city: 'MEDELLIN', country: 'COLOMBIA' }, { city: 'CALI', country: 'COLOMBIA' }, { city: 'BOGOTA', country: 'COLOMBIA' }, { city: 'PANAMA', country: 'PANAMA' }];
  ctx.isWorkingHour = () => true;
  ctx._isCreateRequestRateLimited_ = () => false; // la prueba crea más de 10 solicitudes del mismo solicitante
  ctx.isUserAnalyst = (e) => ['admin@p.co', 'yprieto@equitel.com.co', 'dsanchez@equitel.com.co'].includes(String(e || '').toLowerCase());
  ctx.isSuperAdmin = () => false;
  ctx.validateUserSession_ = () => true;
  ctx.validateUserEmail_ = () => true;
  ctx.getCostCenterData = () => [];
  ctx._resolveApproverForFirstPassenger_ = () => ({ email: 'jefe@p.co', name: 'JEFE' });
  ctx._assertPassportsForInternational_ = () => {};
  // Drive simulado: carpeta y archivos de la reserva sin salir a Google.
  ctx.getOrCreateRequestFolder_ = () => ({ getId: () => 'FOLDER1', getUrl: () => 'https://drive.google.com/drive/folders/FOLDER1', setName() {} });
  ctx._uploadReservationFilesToFolder_ = (folder, files) => files.map((f, i) => ({ id: 'FILE' + i, name: f.fileName, url: 'https://drive.google.com/file/d/FILE' + i, type: 'reservation', date: new ctx.Date().toISOString() }));
  ctx.sendEmailRich = (to, subject, html, cc) => { log.mails.push({ to, subject, html, cc: cc === undefined ? '(admin)' : cc }); };
  ctx._sendMail_ = (o) => { log.mails.push({ to: o.to, subject: o.subject, html: o.body || '', cc: '' }); };
  return { ctx, req, users, sheets, props, log, H };
}

function loadTs() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
  const out = esbuild.buildSync({ entryPoints: [path.join(ROOT, 'utils', 'changeWindow.ts')], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'error' });
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

function main() {
  let env, TS;
  try { env = load(); } catch (e) { console.error('✗ No se pudo cargar server/Code.gs para los cambios de viaje:\n  ' + e.stack); process.exit(1); }
  try { TS = loadTs(); } catch (e) { console.error('✗ No se pudo compilar utils/changeWindow.ts:\n  ' + e.stack); process.exit(1); }
  const { ctx, req, sheets, log } = env;
  const failures = [];
  const J = (v) => JSON.stringify(v);
  const eq = (name, got, want) => { if (J(got) !== J(want)) failures.push(`${name}: da ${J(got)}, se esperaba ${J(want)}`); };
  const ok = (name, cond) => { if (!cond) failures.push(name); };
  const col = (h) => req[0].indexOf(h);
  const rowOf = (id) => req.find((r) => r[col('ID RESPUESTA')] === id);
  const cell = (id, h) => { const r = rowOf(id); const i = col(h); return r && i >= 0 ? r[i] : undefined; };
  const setCell = (id, h, v) => { rowOf(id)[col(h)] = v; ctx._resetPerExecutionCaches_(); };
  const reset = () => ctx._resetPerExecutionCaches_();
  const at = (iso) => { clock.now = Date.parse(iso); }; // instante UTC (Bogotá = UTC−5)
  const ddmm = (key) => key.split('-').reverse().join('-');
  const base = (over) => Object.assign({
    company: 'Equitel', origin: 'BOGOTA, COLOMBIA', destination: 'MEDELLIN, COLOMBIA', departureDate: '25-10-2026', returnDate: '27-10-2026',
    passengers: [{ name: 'PEREZ ANA', idNumber: '100', email: 'ana@p.co' }], requesterEmail: 'ana@p.co', costCenter: 'CC1', businessUnit: 'ENERGIA PROYECTOS',
    site: 'BOGOTA', requestMode: 'FLIGHT', isInternational: false, policyViolation: false, comments: 'Visita técnica', requiresHotel: false,
  }, over || {});
  const create = (data, user) => { reset(); return ctx.dispatch('createRequest', { userEmail: user || 'ana@p.co', sessionToken: 't', data: Object.assign({}, data), emailHtml: '<p>{{REQUEST_ID}}{{ACTION_BUTTONS}}</p>' }); };
  const change = (id, changes, reason, user) => { reset(); return ctx.dispatch('requestTripChange', { userEmail: user || 'ana@p.co', sessionToken: 't', requestId: id, changes, changeReason: reason === undefined ? 'Se movió la reunión con el cliente.' : reason }); };
  const info = (id) => { const v = cell(id, 'CAMBIO PEDIDO (JSON)'); return v ? JSON.parse(v) : null; };
  const key = (v) => ctx._psDateKey_(v);
  // Viaje de prueba ya comprado (RESERVADO), con lo pagado y la compra registrada.
  const bought = (over, extra) => {
    at('2026-10-05T15:00:00Z'); // se pidió con anticipación
    const r = create(base(over));
    if (!r.success) throw new Error('no se pudo crear el viaje de prueba: ' + r.error);
    const id = r.data;
    const cells = Object.assign({ STATUS: 'RESERVADO', 'COSTO COTIZADO PARA VIAJE': 800000, 'COSTO_FINAL_TIQUETES': 800000, 'No RESERVA': 'ABC123', AEROLINEA: 'AVIANCA',
      'CANAL DE COMPRA': 'Aviatur', 'TIPO DE COMPRA DE TKT': 'TIPO 2', 'TARIFA NOMBRE': 'Classic', 'MALETA DE BODEGA': 'NO', 'TARJETA DE CREDITO CON LA QUE SE HIZO LA COMPRA': 'VISA 1234',
      'VALOR COMPRA TIQUETES': 760000, 'FECHA DE COMPRA DE TIQUETE': '06/10/2026' }, extra || {});
    Object.keys(cells).forEach((h) => { if (col(h) >= 0) setCell(id, h, cells[h]); });
    return id;
  };
  const NOW = '2026-10-15T15:30:00Z'; // jueves 15-oct-2026, 10:30 a. m. de Bogotá

  // ───────────── 1. Plazo: Code.gs y utils/changeWindow.ts dicen lo mismo ─────────────
  let diffs = 0;
  for (let n = TS.dayNumber('2026-01-01'); n <= TS.dayNumber('2031-12-31'); n++) {
    const k = TS.keyFromDayNumber(n);
    if (J(ctx._changeDeadline_(k)) !== J(TS.changeDeadline(k))) { if (diffs++ < 3) failures.push(`plazo distinto para ${k}: Code.gs ${J(ctx._changeDeadline_(k))} / app ${J(TS.changeDeadline(k))}`); }
  }
  for (let n = TS.dayNumber('2026-09-25'); n <= TS.dayNumber('2027-01-10'); n++) {
    const today = TS.keyFromDayNumber(n);
    for (const hm of ['T13:00:00Z', 'T17:00:00Z', 'T21:59:00Z', 'T22:00:00Z', 'T04:30:00Z']) {
      const now = Date.parse(today + hm);
      for (let a = -2; a <= 4; a++) {
        const dep = TS.keyFromDayNumber(n + a);
        for (const ret of ['', TS.keyFromDayNumber(n + a), TS.keyFromDayNumber(n + a + 2)]) {
          for (const adm of [false, true]) {
            const g = ctx._tripChangeWindow_(dep, ret, now, adm), t = TS.tripChangeWindow(dep, ret, now, adm);
            if (J(g) !== J(t) && diffs++ < 6) failures.push(`ventana distinta (${dep}/${ret}, ${today}${hm}, admin ${adm}): Code.gs ${J(g)} / app ${J(t)}`);
          }
        }
      }
    }
  }
  const dl = (k) => { const d = TS.changeDeadline(k); return [d.dayKey, d.hour]; };
  eq('plazo: vuelo viernes 16-oct → jueves 15, 5 p. m.', dl('2026-10-16'), ['2026-10-15', 17]);
  eq('plazo: vuelo lunes 19-oct → sábado 17, 12 m.', dl('2026-10-19'), ['2026-10-17', 12]);
  eq('plazo: vuelo martes 13-oct (lunes 12 festivo) → sábado 10, 12 m.', dl('2026-10-13'), ['2026-10-10', 12]);
  eq('plazo: vuelo martes 3-nov (lunes 2 festivo) → sábado 31-oct, 12 m.', dl('2026-11-03'), ['2026-10-31', 12]);
  eq('plazo: vuelo sábado 26-dic (25 festivo) → jueves 24, 5 p. m.', dl('2026-12-26'), ['2026-12-24', 17]);
  eq('plazo: vuelo lunes 11-ene-2027 (festivo de Reyes en lunes, domingo 10) → sábado 9, 12 m.', dl('2027-01-12'), ['2027-01-09', 12]);
  eq('plazo: 5 p. m. de Bogotá es 22:00 UTC', TS.changeDeadline('2026-10-16').ms, Date.parse('2026-10-15T22:00:00Z'));
  const w1 = TS.tripChangeWindow('2026-10-16', '2026-10-18', Date.parse(NOW));
  eq('ventana: jueves 10:30, vuelo viernes → abierta, hoy hasta las 5', [w1.open, w1.mode, TS.untilText(w1, Date.parse(NOW))], [true, 'full', 'hoy hasta las 5:00 p. m.']);
  const w2 = TS.tripChangeWindow('2026-10-16', '2026-10-18', Date.parse('2026-10-15T22:30:00Z'));
  eq('ventana: jueves 5:30 p. m., vuelo viernes → cerrada por plazo', [w2.open, w2.reason], [false, 'deadline']);
  const w3 = TS.tripChangeWindow('2026-10-14', '2026-10-19', Date.parse(NOW));
  eq('ventana: la ida ya voló → solo el regreso, hasta el sábado 12 m.', [w3.open, w3.mode, TS.untilText(w3, Date.parse(NOW))], [true, 'return', 'hasta el sábado 17 de octubre, 12:00 m.']);
  const w4 = TS.tripChangeWindow('2026-10-10', '2026-10-13', Date.parse(NOW));
  eq('ventana: viaje terminado', [w4.open, w4.reason], [false, 'ended']);
  const w5 = TS.tripChangeWindow('2026-10-15', '', Date.parse(NOW)), w5a = TS.tripChangeWindow('2026-10-15', '', Date.parse(NOW), true);
  eq('ventana: vuelo hoy → el viajero no, el área de viajes sí', [w5.open, w5.reason, w5a.open, w5a.mode], [false, 'deadline', true, 'full']);
  eq('fechas de la solicitud a AAAA-MM-DD', [TS.toDateKey('16-10-2026'), TS.toDateKey('2026-10-16T05:00:00.000Z'), TS.toDateKey('6/1/2027'), TS.toDateKey('x')], ['2026-10-16', '2026-10-16', '2027-01-06', '']);

  // ───────────── 2. Pedir un cambio (viaje sin comprar) ─────────────
  at('2026-10-05T15:00:00Z');
  let r = create(base());
  const P1 = r.data;
  ok('viaje de prueba creado', r.success && /^SOL-/.test(P1));
  setCell(P1, '# ORDEN TRABAJO', 'OT 4471'); // OT de antes de #A66 (no cumple el formato nuevo)
  at(NOW);
  r = change(P1, { departureDate: '2026-10-26' }, 'Por la reunión', 'luis@p.co');
  ok('otro usuario no puede pedir el cambio', !r.success && /Solo quien pidió el viaje/.test(r.error));
  r = change(P1, { departureDate: '2026-10-26' }, 'corto');
  ok('motivo de menos de 10 caracteres: error', !r.success && /mínimo 10/.test(r.error));
  r = change(P1, {});
  ok('sin cambios: error', !r.success && /No cambió nada/.test(r.error));
  r = change(P1, { departureDate: '2026-10-25', returnDate: '2026-10-27' });
  ok('mismas fechas: error (no cambió nada)', !r.success && /No cambió nada/.test(r.error));
  r = change(P1, { returnDate: '2026-10-20' });
  ok('regreso antes de la ida: error', !r.success && /antes de la ida/.test(r.error));
  r = change(P1, { destination: 'XYZ, COLOMBIA' });
  ok('destino fuera de la lista: error', !r.success && /no está en la lista/.test(r.error));
  ok('ningún error creó filas', req.length === 2);
  log.mails.length = 0;
  r = change(P1, { departureDate: '2026-10-26', returnDate: '2026-10-28', departureTimePreference: '06:00' });
  ok('cambio sin comprar: se crea', r.success && r.data && /^SOL-/.test(r.data.id) && r.data.comprado === false && r.data.parentId === P1);
  const C1 = r.data && r.data.id;
  eq('hija: tipo, estado, padre y sin marca de anticipación', [cell(C1, 'TIPO DE SOLICITUD'), cell(C1, 'STATUS'), cell(C1, 'ID SOLICITUD PADRE'), cell(C1, 'VIOLACION POLITICA')],
    ['MODIFICACION', 'PENDIENTE_ANALISIS_CAMBIO', P1, 'NO']);
  eq('hija: fechas nuevas y lo demás igual', [key(cell(C1, 'FECHA IDA')), key(cell(C1, 'FECHA VUELTA')), cell(C1, 'CIUDAD DESTINO'), cell(C1, 'CORREO ENCUESTADO')],
    ['2026-10-26', '2026-10-28', 'MEDELLIN, COLOMBIA', 'ana@p.co']);
  eq('hija: la OT de antes se copia tal cual', cell(C1, '# ORDEN TRABAJO'), 'OT 4471');
  eq('hija: el motivo queda como texto del cambio', cell(C1, 'TEXTO_CAMBIO'), 'Se movió la reunión con el cliente.');
  const i1 = info(C1);
  ok('hija: el sistema creó la columna del cambio', col('CAMBIO PEDIDO (JSON)') >= 0 && !!i1);
  eq('hija: JSON del cambio', i1 && [i1.v, i1.padre, i1.comprado, i1.modo, i1.tipos, i1.campos.departureDate, i1.campos.departureTimePreference, i1.rol, i1.compra],
    [1, P1, false, 'full', ['Fecha', 'Hora'], { antes: '2026-10-25', ahora: '2026-10-26' }, { antes: '', ahora: '06:00' }, 'viajero', undefined]);
  const m1 = log.mails.find((m) => /compras\.equitel/.test(m.to));
  ok('correo al área de viajes: CAMBIO DE VIAJE con el antes y el ahora y el motivo', m1 && /CAMBIO DE VIAJE/.test(m1.html) && /domingo 25 de octubre/.test(m1.html) &&
    /lunes 26 de octubre/.test(m1.html) && /Se movió la reunión con el cliente/.test(m1.html) && /aún no se había comprado/.test(m1.html) && !/\{\{REQUEST_ID\}\}/.test(m1.html));
  r = change(P1, { departureDate: '2026-10-27', returnDate: '2026-10-29' });
  ok('un solo cambio vivo por solicitud (#A63)', !r.success && new RegExp('cambio en curso: ' + C1).test(r.error));
  r = change(C1, { departureDate: '2026-10-27', returnDate: '2026-10-29' });
  ok('la hija sin revisar no se puede volver a cambiar', !r.success && /aún no revisa/.test(r.error));

  // ───────────── 3. Viaje ya comprado ─────────────
  const P2 = bought({ departureDate: '16-10-2026', returnDate: '20-10-2026'});
  at('2026-10-15T22:30:00Z'); // jueves 5:30 p. m.: venció el plazo del vuelo del viernes
  r = change(P2, { departureTimePreference: '15:00' });
  ok('después de las 5 p. m. del día hábil anterior: el viajero no puede (y se le dice a quién escribir)',
    !r.success && /venció el jueves 15 de octubre a las 5:00 p\. m\./.test(r.error) && /compras\.equitel@equitel\.com\.co/.test(r.error) && !/m\.\./.test(r.error));
  at(NOW);
  r = change(P2, { departureDate: '2026-10-15' });
  ok('fecha nueva sin tiempo (hoy): error', !r.success && /ya no da tiempo/.test(r.error));
  log.mails.length = 0;
  r = change(P2, { departureTimePreference: '15:00', checkedBaggage: true }, 'Necesito llevar el equipo de medición.');
  ok('cambio de tiquete comprado: se crea y avisa que estaba comprado', r.success && r.data.comprado === true);
  const C2 = r.data && r.data.id;
  const i2 = info(C2);
  eq('comprado: lo que costó el viaje (lo pagado) y la compra de la original', i2 && [i2.comprado, i2.costoOriginal, i2.costoOriginalFuente, i2.compra.pnr, i2.compra.aerolinea,
    i2.compra.canal, i2.compra.tarifa, i2.compra.maleta, i2.compra.tarjeta, i2.compra.pagadoTiquetes, i2.tipos],
    [true, 760000, 'pagado', 'ABC123', 'AVIANCA', 'Aviatur', '2', false, 'VISA 1234', 760000, ['Hora', 'Equipaje']]);
  eq('comprado: la hija pide la maleta', cell(C2, 'MALETA DE BODEGA'), 'SI');
  const m2 = log.mails.find((m) => /compras\.equitel/.test(m.to));
  ok('correo: tiquete comprado, reserva y aviso de la maleta pedida después', m2 && /El tiquete ya está comprado/.test(m2.html) && /ABC123/.test(m2.html) &&
    /maleta de bodega después de comprar/.test(m2.html));
  // El área de viajes registra el cambio a nombre del viajero después del plazo
  const P3 = bought({ departureDate: '16-10-2026', returnDate: '18-10-2026' }, { 'VALOR COMPRA TIQUETES': '' });
  at('2026-10-15T23:30:00Z');
  r = change(P3, { departureTimePreference: '18:00' }, 'El viajero llamó: sale más tarde.', 'admin@p.co');
  const C3 = r.success && r.data.id;
  ok('el área de viajes registra el cambio sin plazo', !!C3 && info(C3).rol === 'administrador' && info(C3).registradoPor === 'admin@p.co');
  eq('sin valor pagado, el original es lo cotizado', [info(C3).costoOriginal, info(C3).costoOriginalFuente], [800000, 'cotizado']);
  // Viaje en curso: solo el regreso
  const P4 = bought({ departureDate: '14-10-2026', returnDate: '19-10-2026' });
  at(NOW);
  r = change(P4, { departureDate: '2026-10-16' });
  ok('viaje en curso: no se puede cambiar la ida', !r.success && /solo se puede cambiar el regreso/.test(r.error));
  r = change(P4, { returnDate: '2026-10-21', returnTimePreference: '19:00' }, 'Se alargó la visita a la planta.');
  ok('viaje en curso: el regreso sí', r.success && info(r.data.id).modo === 'return' && key(cell(r.data.id, 'FECHA VUELTA')) === '2026-10-21' && key(cell(r.data.id, 'FECHA IDA')) === '2026-10-14');
  // Terminado y vuelo de hoy
  const P5 = bought({ departureDate: '10-10-2026', returnDate: '13-10-2026' });
  at(NOW);
  r = change(P5, { returnDate: '2026-10-14' });
  ok('viaje terminado: error', !r.success && /ya terminó/.test(r.error));
  const P6 = bought({ departureDate: '15-10-2026', returnDate: '' });
  at(NOW);
  r = change(P6, { departureTimePreference: '20:00' });
  ok('vuelo de hoy: el viajero no puede', !r.success && /venció/.test(r.error));
  r = change(P6, { departureTimePreference: '20:00' }, 'El viajero perdió el vuelo de la mañana.', 'admin@p.co');
  ok('vuelo de hoy: el área de viajes sí', r.success);
  r = change(P6, { returnDate: '2026-10-20' }, 'Quiere agregar el regreso al viaje.', 'admin@p.co');
  ok('solo ida: no se agrega un regreso con un cambio', !r.success && /(solo de ida|cambio en curso)/.test(r.error));
  // Destino internacional
  at('2026-10-05T15:00:00Z');
  const P7 = create(base({ departureDate: '20-11-2026', returnDate: '23-11-2026' })).data;
  at(NOW);
  r = change(P7, { destination: 'panama,  panama ' }, 'El cliente cambió la sede de la reunión.');
  const C7 = r.success && r.data.id;
  ok('destino de otro país: la hija es internacional', !!C7 && cell(C7, 'CIUDAD DESTINO') === 'PANAMA, PANAMA' && String(cell(C7, 'ES INTERNACIONAL')).toUpperCase() === 'SI');
  // Solo hospedaje: el hotel se ajusta y no hay horas ni maleta
  at('2026-10-05T15:00:00Z');
  const P8 = create(base({ requestMode: 'HOTEL_ONLY', origin: '', destination: 'CALI, COLOMBIA', departureDate: '20-11-2026', returnDate: '22-11-2026', requiresHotel: true, hotelName: 'Hotel X', nights: 2 })).data;
  at(NOW);
  r = change(P8, { departureTimePreference: '08:00' });
  ok('solo hospedaje: no hay horas de vuelo', !r.success && /solo hospedaje/.test(r.error));
  r = change(P8, { checkedBaggage: true });
  ok('solo hospedaje: no hay maleta', !r.success && /solo hospedaje/.test(r.error));
  r = change(P8, { returnDate: '2026-11-25' }, 'Se alargó la auditoría tres días.');
  ok('solo hospedaje: las noches se recalculan', r.success && Number(cell(r.data.id, '# NOCHES (AUTOMÁTICO)')) === 5 && String(cell(r.data.id, 'NOMBRE HOTEL')).toUpperCase() === 'HOTEL X');

  // ───────────── 4. El navegador no puede inyectar el cambio ─────────────
  at('2026-10-05T15:00:00Z');
  r = create(base({ departureDate: '20-11-2026', returnDate: '21-11-2026', tripChange: { v: 1, comprado: true, costoOriginal: 9e9 }, 'CAMBIO PEDIDO (JSON)': '{"v":1}' }));
  ok('crear con un tripChange inventado: no se guarda', r.success && !cell(r.data, 'CAMBIO PEDIDO (JSON)'));
  const P9 = bought({ departureDate: '20-11-2026', returnDate: '22-11-2026' });
  at(NOW);
  reset();
  r = ctx.dispatch('requestModification', { userEmail: 'ana@p.co', sessionToken: 't', requestId: P9, changeReason: 'Cambio por el formulario de antes.',
    modifiedRequest: Object.assign(base({ departureDate: '21-11-2026', returnDate: '23-11-2026' }), { tripChange: { v: 1, comprado: true } }), emailHtml: '<p>{{REQUEST_ID}}{{ACTION_BUTTONS}}</p>' });
  const L9 = r.success && r.data;
  ok('formulario de antes (requestModification): sigue funcionando y sin JSON del cambio', !!L9 && !cell(L9, 'CAMBIO PEDIDO (JSON)') && cell(L9, 'TIPO DE SOLICITUD') === 'MODIFICACION');

  // ───────────── 5. Costo del cambio, presupuesto, Cadena de Suministro y correo ─────────────
  const budgetCalls = [];
  ctx._calcularEjecutadoPeriodo_ = (emp, unit, cost, ex) => { budgetCalls.push(Array.from(ex || [])); return { exceedsBudget: false }; };
  const confirm = (id, payload, user) => { reset(); return ctx.dispatch('updateRequest', { userEmail: user || 'admin@p.co', sessionToken: 't', id, status: 'PENDIENTE_APROBACION', payload }); };
  setCell(C2, 'STATUS', 'PENDIENTE_CONFIRMACION_COSTO');
  r = confirm(C2, { finalCostTickets: 300000, finalCostHotel: 0, totalCost: 300000, changePenalty: 350000 });
  ok('penalidad mayor que el costo del cambio: error y nada se guarda', !r.success && /no puede ser mayor/.test(r.error) && cell(C2, 'STATUS') === 'PENDIENTE_CONFIRMACION_COSTO');
  r = confirm(C2, { finalCostTickets: 300000, finalCostHotel: 0, totalCost: 300000, changePenalty: 150000.5 });
  ok('penalidad con decimales: error (reglas de #A79)', !r.success && cell(C2, 'STATUS') === 'PENDIENTE_CONFIRMACION_COSTO');
  log.mails.length = 0; budgetCalls.length = 0;
  r = confirm(C2, { finalCostTickets: 350000, finalCostHotel: 0, totalCost: 350000, changePenalty: '150.000' });
  ok('confirmar el costo del cambio', r.success);
  eq('costo del cambio y penalidad en su columna', [cell(C2, 'STATUS'), cell(C2, 'COSTO COTIZADO PARA VIAJE'), cell(C2, 'PENALIDAD CAMBIO')], ['PENDIENTE_APROBACION', 350000, 150000]);
  eq('presupuesto: la original comprada sigue contando (no se excluye)', budgetCalls[0], [C2]);
  const apr = log.mails.find((m) => m.to === 'jefe@p.co');
  ok('correo al aprobador: APROBACIÓN DE CAMBIO con lo que costó el viaje y el costo del cambio', apr && /APROBACIÓN DE CAMBIO/.test(apr.html) && /COSTO DEL CAMBIO/.test(apr.html) &&
    /760\.000/.test(apr.html) && /350\.000/.test(apr.html) && /150\.000/.test(apr.html) && /1\.110\.000/.test(apr.html) && /maleta se pidió después/.test(apr.html));
  ok('correo al aprobador: sin el aviso de cambio con costo extra de antes', apr && !/CAMBIO CON COSTO EXTRA/.test(apr.html));
  // cambio sin comprar: excluye la original, como siempre
  setCell(C1, 'STATUS', 'PENDIENTE_CONFIRMACION_COSTO');
  budgetCalls.length = 0;
  r = confirm(C1, { finalCostTickets: 900000, finalCostHotel: 0, totalCost: 900000 });
  eq('presupuesto: un cambio sin comprar excluye la original (igual que antes)', [r.success, budgetCalls[0]], [true, [C1, P1]]);
  // cambio de antes (sin JSON): igual que antes
  setCell(L9, 'STATUS', 'PENDIENTE_CONFIRMACION_COSTO');
  budgetCalls.length = 0;
  r = confirm(L9, { finalCostTickets: 950000, finalCostHotel: 0, totalCost: 950000 });
  eq('presupuesto: un cambio de antes excluye la original (igual que antes)', [r.success, budgetCalls[0]], [true, [L9, P9]]);
  // Cadena de Suministro con el viaje + el cambio
  reset();
  let mp = ctx.mapRowToRequest(rowOf(C2));
  eq('Cadena de Suministro se mide con el viaje con el cambio', [mp.cdsCostBase, ctx._cdsCostBase_(500000, cell(C2, 'CAMBIO PEDIDO (JSON)')) > 1200000, ctx._cdsCostBase_(500000, '')], [1110000, true, 500000]);
  eq('detalle (administrador): penalidad y JSON del cambio', [mp.changePenalty, mp.tripChange && mp.tripChange.compra.pagadoTiquetes], [150000, 760000]);
  const hidden = ctx._hideFareInternals_(ctx.mapRowToRequest(rowOf(C2)));
  eq('detalle (viajero): sin penalidad, lo pagado ni la tarjeta', [hidden.changePenalty, hidden.tripChange.compra.pagadoTiquetes, hidden.tripChange.compra.tarjeta, hidden.tripChange.costoOriginal, hidden.tripChange.compra.pnr],
    ['', '', '', 0, 'ABC123']);

  // ───────────── 6. Aprobar: qué pasa con la original ─────────────
  const approve = (id) => {
    setCell(id, 'CORREO DE QUIEN APRUEBA (AUTOMÁTICO)', 'jefe@p.co');
    const sg = ctx._newApprovalLinkSig_('approve', id, 'approved', 'NORMAL', 'jefe@p.co');
    reset();
    return ctx.processApprovalFromEmail({ parameter: { id, decision: 'approved', role: 'NORMAL', actor: 'jefe@p.co', t: sg.t, sig: sg.sig, confirm: 'true' } });
  };
  approve(C2);
  eq('aprobar el cambio de un tiquete comprado: la original NO se anula', [cell(C2, 'STATUS'), cell(P2, 'STATUS')], ['APROBADO', 'RESERVADO']);
  ok('la original dice que se aprobó el cambio y que no se anula', /Se aprobó el cambio .* no se anula/.test(cell(P2, 'OBSERVACIONES')));
  approve(C1);
  eq('aprobar el cambio de un viaje sin comprar: la original se anula (igual que antes)', [cell(C1, 'STATUS'), cell(P1, 'STATUS')], ['APROBADO', 'ANULADO']);
  approve(L9);
  eq('aprobar un cambio de antes: la original se anula (igual que antes)', [cell(L9, 'STATUS'), cell(P9, 'STATUS')], ['APROBADO', 'ANULADO']);

  // ───────────── 7. Registrar el tiquete nuevo: la original queda «Cambiada» ─────────────
  reset();
  r = ctx.dispatch('registerReservation', { userEmail: 'admin@p.co', sessionToken: 't', requestId: C2, reservationNumber: 'XYZ789', creditCard: 'VISA 1234', purchaseDate: '2026-10-15',
    files: [{ fileData: 'data:application/pdf;base64,JVBERi0xLjQK', fileName: 'reserva.pdf' }] });
  ok('registrar la reserva del cambio: ' + (r.error || 'ok'), r.success);
  eq('registrar el tiquete del cambio: la original queda «Cambiada» y sigue RESERVADO', [cell(C2, 'STATUS'), cell(P2, 'REEMPLAZADA POR'), cell(P2, 'STATUS')], ['RESERVADO', C2, 'RESERVADO']);
  reset();
  ok('la original «Cambiada» llega con replacedBy', ctx.mapRowToRequest(rowOf(P2)).replacedBy === C2);
  r = change(P2, { departureTimePreference: '09:00' });
  ok('la original «Cambiada» no se vuelve a cambiar (se cambia la vigente)', !r.success && new RegExp('ya se cambió: el vigente es ' + C2).test(r.error));
  reset();
  r = ctx.dispatch('cancelOwnRequest', { userEmail: 'ana@p.co', sessionToken: 't', requestId: P2, reason: 'Ya no viajo.' });
  ok('la original «Cambiada» no se anula', !r.success && cell(P2, 'STATUS') === 'RESERVADO');
  // Cambio sobre la vigente: lo que costó el viaje suma el cambio anterior
  setCell(C2, 'VALOR COMPRA TIQUETES', 350000);
  at(NOW);
  r = change(C2, { departureTimePreference: '07:00' }, 'Lo pasaron al vuelo de la mañana.');
  ok('cambio sobre el cambio: el original es el viaje completo (760.000 + 350.000)', r.success && info(r.data.id).costoOriginal === 1110000 && info(r.data.id).padre === C2);

  // ───────────── 8. Estadísticas, control de cambios e informe ─────────────
  reset();
  eq('estadísticas de compra: el cambio comprado no cuenta como compra de tiquetes; la original sí',
    [ctx._psRecord_(rowOf(C2)).counted, ctx._psRecord_(rowOf(P2)).counted], [false, true]);
  reset();
  const ctrl = ctx.getChangeControl();
  const it2 = ctrl.items.find((x) => x.id === C2);
  eq('control de cambios: lo que costó el viaje, el cambio, la penalidad y la maleta', it2 && [it2.parentId, it2.comprado, it2.original, it2.originalSource, it2.changeCost, it2.penalty, it2.bagLater, it2.status, it2.parentStatus, it2.tipos],
    [P2, true, 760000, 'pagado', 350000, 150000, true, 'RESERVADO', 'RESERVADO', ['Hora', 'Equipaje']]);
  const it3 = ctrl.items.find((x) => x.id === C3);
  eq('control de cambios: sin costo confirmado → null; quién lo registró', it3 && [it3.changeCost, it3.registeredBy], [null, 'administrador']);
  eq('control de cambios: los cambios de antes se cuentan aparte', ctrl.legacy, 1);
  reset();
  r = ctx.dispatch('getChangeControl', { userEmail: 'ana@p.co', sessionToken: 't' });
  ok('control de cambios: solo administradores', !r.success);
  reset();
  const mr = ctx._mrChanges_('2026-10');
  eq('informe mensual: cambios del mes y su costo', [mr.n, mr.bought, mr.cost, mr.penalty, mr.bag, mr.top[0] && mr.top[0].id], [ctrl.items.length, ctrl.items.filter((x) => x.comprado).length, 350000, 150000, 1, C2]);
  // Dashboard de costos por unidad: un líder solo ve sus unidades (filtro en el servidor), sin correos.
  const unitKey = ctx._csNormalize_('ENERGIA PROYECTOS');
  ctx._csResolveAccess_ = (e) => (e === 'lider@p.co' ? { canView: true, allUnits: false, units: [unitKey], unitLabels: ['ENERGIA PROYECTOS'], email: e }
    : e === 'otro@p.co' ? { canView: true, allUnits: false, units: [ctx._csNormalize_('OTRA UNIDAD')], unitLabels: ['OTRA UNIDAD'], email: e }
    : e === 'admin@p.co' ? { canView: true, allUnits: true, units: [], unitLabels: [], email: e } : { canView: false, allUnits: false, units: [], unitLabels: [], email: e });
  const dash = (e) => { reset(); return ctx.dispatch('getTripChangesForDashboard', { userEmail: e, sessionToken: 't' }); };
  const dl1 = dash('lider@p.co'), dl2 = dash('otro@p.co'), dl3 = dash('admin@p.co'), dl4 = dash('nadie@p.co');
  eq('dashboard por unidad: el líder ve los de su unidad, otro líder ninguno, el área de viajes todos y con los de antes',
    [dl1.success && dl1.data.items.length === ctrl.items.length, dl2.success && dl2.data.items.length, dl3.success && dl3.data.legacy, dl1.data && dl1.data.legacy, dl4.success],
    [true, 0, 1, null, false]);
  ok('dashboard por unidad: sin correos', dl1.success && !/@/.test(JSON.stringify(dl1.data.items.map((x) => [x.requesterName, x.unit, x.id]))) && dl1.data.items.every((x) => x.requesterEmail === undefined));
  // Explicación de «Cambiar mi viaje» la primera vez (20-oct): constancia en CONSTANCIA AVISOS, como #A100.
  reset();
  eq('explicación: al viajero sí, al área de viajes no', [ctx._tripChangePublicInfo_('ana@p.co').showNotice, ctx._tripChangePublicInfo_('admin@p.co').showNotice,
    ctx._tripChangePublicInfo_('ana@p.co').noticeId], [true, false, 'cambios-de-viaje-2026-10']);
  reset();
  let ack = ctx.dispatch('ackPolicyNotice', { userEmail: 'ana@p.co', sessionToken: 't', noticeId: 'cambios-de-viaje-2026-10' });
  const avisos = sheets['CONSTANCIA AVISOS'] && sheets['CONSTANCIA AVISOS']._t;
  ok('explicación: «Entendido» deja la constancia', ack.success && ack.data === true && avisos && avisos.some((r) => r[1] === 'ana@p.co' && r[2] === 'cambios-de-viaje-2026-10'));
  reset();
  eq('explicación: ya no vuelve a salir (a otra persona sí)', [ctx._tripChangePublicInfo_('ana@p.co').showNotice, ctx._tripChangePublicInfo_('luis@p.co').showNotice], [false, true]);
  reset();
  ctx.dispatch('ackPolicyNotice', { userEmail: 'ana@p.co', sessionToken: 't', noticeId: 'cambios-de-viaje-2026-10' });
  eq('explicación: una sola constancia por persona', avisos.filter((r) => r[1] === 'ana@p.co' && r[2] === 'cambios-de-viaje-2026-10').length, 1);
  reset();
  ack = ctx.dispatch('ackPolicyNotice', { userEmail: 'luis@p.co', sessionToken: 't', noticeId: 'otro-aviso' });
  ok('explicación: un id desconocido no deja constancia', ack.success && ack.data === false && !avisos.some((r) => r[1] === 'luis@p.co'));
  eq('bootstrap: la app recibe la regla', [ctx._tripChangePublicInfo_().enabled, ctx._tripChangePublicInfo_().reasonMin, ctx._tripChangePublicInfo_().contact], [true, 10, 'compras.equitel@equitel.com.co']);

  // ───────────── A quién llamar después del plazo (#A106, 22-oct) ─────────────
  reset();
  eq('contactos: sin tabla en MISC, la lista llega vacía (la app muestra el correo)', ctx._tripChangePublicInfo_('ana@p.co').contacts, []);
  const misc = [['TARJETA', 'EMPRESA'], ['', ''], ['TC-1', 'EQUITEL']];
  sheets.MISC = makeSheet('MISC', misc);
  env.users[0].push('Celular');
  env.users.push(['400', 'MOLINA ORTIZ LAURA CRISTINA', 'compras.equitel@equitel.com.co', '3133251690'],
    ['500', 'CABALLERO VARGAS DIEGO FERNANDO', 'directorcompras@equitel.com.co', 3232958507]);
  let prep = ctx.prepararTablaContactosCambios();
  eq('contactos: el menú crea la tabla al lado (una columna libre) con Laura y Diego',
    [prep.created, prep.emailCol, misc[0].slice(3, 6), misc[1].slice(3, 6), misc[2].slice(3, 6), misc[2].slice(0, 2)],
    [true, 4, ['CONTACTO CAMBIOS · CORREO', 'CONTACTO CAMBIOS · NOMBRE', 'CONTACTO CAMBIOS · CARGO'],
      ['compras.equitel@equitel.com.co', 'Laura Molina', 'Área de viajes'], ['directorcompras@equitel.com.co', 'Diego Caballero', 'Director de compras'], ['TC-1', 'EQUITEL']]);
  prep = ctx.prepararTablaContactosCambios();
  ok('contactos: el menú no la vuelve a crear', !prep.created && misc[0].filter((h) => /CONTACTO/.test(h)).length === 3 && misc.length === 3);
  reset();
  eq('contactos: la app recibe a quién llamar, en orden, con el celular de USUARIOS', ctx._tripChangePublicInfo_('ana@p.co').contacts, [
    { name: 'Laura Molina', role: 'Área de viajes', phone: '3133251690', email: 'compras.equitel@equitel.com.co' },
    { name: 'Diego Caballero', role: 'Director de compras', phone: '3232958507', email: 'directorcompras@equitel.com.co' }]);
  at(NOW);
  const PC = bought({ departureDate: '16-10-2026', returnDate: '20-10-2026' });
  at('2026-10-15T22:30:00Z'); // jueves 5:30 p. m.: venció el plazo del vuelo del viernes
  r = change(PC, { departureTimePreference: '15:00' });
  ok('contactos: después del plazo, el error dice a quién llamar y en qué orden', !r.success &&
    /Si es urgente, llame a Laura Molina \(área de viajes\), 313 325 1690; si no responde, a Diego Caballero \(director de compras\), 323 295 8507\./.test(r.error));
  at(NOW);
  env.users.find((u) => u[2] === 'directorcompras@equitel.com.co')[3] = '';
  reset();
  const rev = ctx.revisarContactosCambios();
  ok('contactos: sin celular se muestra el correo, y el menú lo avisa',
    /si no responde, a Diego Caballero \(director de compras\), directorcompras@equitel\.com\.co$/.test(ctx._tripContactsText_(rev.contacts)) &&
    rev.warnings.some((w) => /Diego Caballero no tiene un celular válido/.test(w)));
  misc.push(['', '', '', 'a@p.co', 'Ana', 'Compras'], ['', '', '', 'b@p.co', 'Beto', 'Compras']);
  reset();
  eq('contactos: se muestran máximo 3, en el orden de la tabla', ctx._tripContacts_().map((c) => c.name), ['Laura Molina', 'Diego Caballero', 'Ana']);
  sheets.MISC = makeSheet('MISC', [['CONTACTO CAMBIOS · CORREO']]);
  let threw = '';
  try { ctx.prepararTablaContactosCambios(); } catch (e) { threw = e.message; }
  ok('contactos: con un encabezado suelto, el menú no adivina', /solo algunos encabezados/.test(threw));

  if (failures.length) {
    console.error('✗ Cambios de viaje (#A103): ' + failures.length + ' problema(s):');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('✓ Cambios de viaje (#A103, #A106): plazo igual en la app y en el servidor (2026–2031), cambio con y sin tiquete comprado, solo el regreso con el viaje en curso, el área de viajes sin plazo, costo y penalidad, presupuesto, Cadena de Suministro, la original comprada no se anula y queda «Cambiada», estadísticas, control, informe y a quién llamar después del plazo.');
}

main();
