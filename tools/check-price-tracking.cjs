#!/usr/bin/env node
/**
 * Verifica el rastreo de precios (#A84) de punta a punta con una hoja SINTÉTICA
 * en memoria y un SerpApi simulado (no gasta búsquedas ni usa datos reales):
 *
 *   1. El proyecto aparte (tools/comparador-precios/apps-script/Rastreo.gs con el
 *      núcleo comparador.cjs) decide bien qué buscar y cuándo:
 *        - COMPRA: APROBADO, o RESERVADO hace menos de 6 horas
 *        - COTIZACION: PENDIENTE_APROBACION con costos confirmados desde el inicio del estudio
 *        - nunca hospedaje, viajes ya salidos ni otros estados; una sola vez por momento
 *   2. Solo escribe en sus pestañas: la hoja de solicitudes queda idéntica y la
 *      clave nunca llega a la hoja.
 *   3. Respeta el cupo (reserva, tope diario, 401, 429) y reintenta lo transitorio.
 *   4. server/Code.gs lee esas pestañas para el dashboard: solo las personas de la
 *      variación (Laura no), sin escribir nada y con las cuentas correctas.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'comparador-precios');
const KEY = 'CLAVE-SECRETA-DE-PRUEBA-1234567890';
const EJEMPLO = JSON.parse(fs.readFileSync(path.join(TOOL, 'ejemplo-respuesta.json'), 'utf8'));
const VENDEDORES = JSON.parse(fs.readFileSync(path.join(TOOL, 'ejemplo-vendedores.json'), 'utf8'));

const bogota = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
function formatDate(d, tz, f) {
  const p = Object.fromEntries(bogota.formatToParts(d).map((x) => [x.type, x.value]));
  return f.replace(/yyyy|MM|dd|HH|mm/g, (t) => ({ yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour === '24' ? '00' : p.hour, mm: p.minute })[t]);
}
const today = formatDate(new Date(), '', 'yyyy-MM-dd');
const plus = (n) => { const [y, m, d] = today.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

// ------------------------------------------------------------------ hoja en memoria
function makeSheet(name, rows) {
  const t = rows.map((r) => r.slice());
  const s = {
    name, hidden: false, protectedWarning: false, data: t,
    getName: () => name,
    getLastRow: () => t.length,
    getLastColumn: () => t.reduce((m, r) => Math.max(m, r.length), 0),
    getMaxColumns: () => t.reduce((m, r) => Math.max(m, r.length), 0),
    appendRow(vals) { t.push(vals.map((v) => (typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v))); },
    setFrozenRows() {}, hideSheet() { s.hidden = true; },
    protect() { const pr = { setDescription: () => pr, setWarningOnly: (w) => { s.protectedWarning = w; return pr; } }; return pr; },
    clearContents() { t.length = 0; },
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      const rng = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((t[r - 1 + i] || [])[c - 1 + j] ?? ''))),
        getValue: () => (t[r - 1] || [])[c - 1] ?? '',
        setValues(vals) { vals.forEach((row, i) => { while (t.length < r + i) t.push([]); row.forEach((v, j) => { t[r - 1 + i][c - 1 + j] = v; }); }); return rng; },
        setValue(v) { while (t.length < r) t.push([]); t[r - 1][c - 1] = v; return rng; },
        setFontWeight: () => rng, setNote: () => rng, setBackground: () => rng, setFontColor: () => rng, setNumberFormat: () => rng,
      };
      return rng;
    },
  };
  return s;
}
function makeSpreadsheet(sheets) {
  const map = {};
  sheets.forEach((s) => { map[s.name] = s; });
  return {
    sheets: map,
    getName: () => 'Base de pruebas',
    getId: () => 'HOJA-ID',
    getSheetByName: (n) => map[n] || null,
    insertSheet: (n) => (map[n] = makeSheet(n, [])),
  };
}

// ------------------------------------------------------------------ solicitudes sintéticas
const H = ['ID RESPUESTA', 'STATUS', 'MODO_SOLICITUD', 'CIUDAD ORIGEN', 'CIUDAD DESTINO', 'FECHA IDA', 'FECHA VUELTA',
  '# PERSONAS QUE VIAJAN', 'HORA LLEGADA VUELO IDA', 'EVENTOS_JSON', 'COSTO_FINAL_TIQUETES', 'AEROLINEA', 'CANAL DE COMPRA',
  'EMPRESA', 'UNIDAD DE NEGOCIO', 'CORREO ENCUESTADO', 'CÉDULA PERSONA 1', 'NOMBRE PERSONA 1'];
const ev = (o) => JSON.stringify(o);
const hace = (h) => new Date(Date.now() - h * 3600000).toISOString();
const priv = ['pasajero@ejemplo.test', 'CEDULA-FICTICIA-1', 'NOMBRE PRIVADO'];
function solicitudes() {
  return [H,
    ['SOL-1', 'APROBADO', 'VIAJE', 'BOGOTA, COLOMBIA', 'MEDELLIN, COLOMBIA', plus(14), plus(16), 1, '07:00', ev({ costConfirmed: hace(30) }), 400000, 'LATAM', 'Aviatur', 'Equitel', 'POTENCIA', ...priv],
    ['SOL-2', 'PENDIENTE_APROBACION', 'VIAJE', 'BOGOTA', 'CALI', plus(10), plus(12), 2, '06:30', ev({ costConfirmed: hace(0.2) }), 800000, 'Avianca', 'Directo', 'Equitel', 'POTENCIA', ...priv],
    ['SOL-3', 'PENDIENTE_APROBACION', 'VIAJE', 'BOGOTA', 'CALI', plus(20), plus(22), 1, '06:30', ev({ costConfirmed: '2026-01-05T15:00:00Z' }), 500000, '', '', 'Equitel', 'POTENCIA', ...priv],
    ['SOL-4', 'APROBADO', 'SOLO_HOSPEDAJE', 'BOGOTA', 'CALI', plus(10), plus(12), 1, '', ev({}), 0, '', '', 'Equitel', 'POTENCIA', ...priv],
    ['SOL-5', 'APROBADO', 'VIAJE', 'BOGOTA', 'CALI', plus(-3), plus(-1), 1, '07:00', ev({}), 300000, '', '', 'Equitel', 'POTENCIA', ...priv],
    ['SOL-6', 'RESERVADO', 'VIAJE', 'CALI', 'BOGOTA', plus(9), '', 1, '10:40', ev({ reservationRegistered: hace(2) }), 432888, 'Wingo', 'Aviatur', 'Cumandes', 'SERVICIO', ...priv],
    ['SOL-7', 'RESERVADO', 'VIAJE', 'CALI', 'BOGOTA', plus(9), '', 1, '10:40', ev({ reservationRegistered: hace(48) }), 432888, '', '', 'Cumandes', 'SERVICIO', ...priv],
    ['SOL-8', 'APROBADO', 'VIAJE', 'BOGOTA', 'TUNJA', plus(15), '', 1, '07:00', ev({}), 200000, '', '', 'Equitel', 'POTENCIA', ...priv],
    ['SOL-9', 'APROBADO', 'VIAJE', 'BOGOTA', 'MEDELLIN', new Date(plus(18) + 'T00:00:00-05:00'), '', 1, new Date(1899, 11, 30, 7, 0), ev({}), 600000, 'Avianca', 'Aviatur', 'Equitel', 'POTENCIA', ...priv],
    ['SOL-10', 'PROCESADO', 'VIAJE', 'BOGOTA', 'CALI', plus(5), '', 1, '07:00', ev({}), 100000, '', '', 'Equitel', 'POTENCIA', ...priv],
    ['SOL-11', 'APROBADO', 'VIAJE', '', 'CALI', plus(5), '', 1, '07:00', ev({}), 100000, '', '', 'Equitel', 'POTENCIA', ...priv],
    ['SOL-12', 'APROBADO', 'VIAJE', 'MEDELLIN', 'CALI', plus(11), '', 1, '', ev({}), 350000, '', '', 'Equitel', 'POTENCIA', ...priv],
  ];
}

// ------------------------------------------------------------------ proyecto aparte (Rastreo.gs)
function loadTracker(opts = {}) {
  const base = makeSheet('Nueva Base Solicitudes', opts.rows || solicitudes());
  const ss = makeSpreadsheet([base]);
  const log = { search: [], account: 0, triggers: [], quedan: opts.quedan ?? 200, fallar: opts.fallar || {}, factor: 1, consola: [] };
  const props = Object.assign({ SERPAPI_KEY: KEY, SPREADSHEET_ID: 'HOJA-ID' }, opts.props || {});
  const resp = (code, obj) => ({ getResponseCode: () => code, getContentText: () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) });
  const ctx = {
    console: { log: (...a) => log.consola.push(a.join(' ')), warn: (...a) => log.consola.push(a.join(' ')), error: (...a) => log.consola.push(a.join(' ')) },
    Utilities: { formatDate },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    SpreadsheetApp: { openById: (id) => { if (id !== 'HOJA-ID') throw new Error('sin acceso'); return ss; } },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ScriptApp: {
      getProjectTriggers: () => log.triggers.map((h) => ({ getHandlerFunction: () => h, _h: h })),
      deleteTrigger: (t) => { log.triggers.splice(log.triggers.indexOf(t._h), 1); },
      newTrigger: (h) => { const b = { timeBased: () => b, everyMinutes: () => b, create: () => log.triggers.push(h) }; return b; },
    },
    UrlFetchApp: {
      fetch(url) {
        const u = new URL(url);
        const p = Object.fromEntries(u.searchParams);
        if (u.pathname === '/account.json') {
          log.account++;
          if (p.api_key !== KEY) return resp(401, { error: 'Invalid API key.' });
          return resp(200, { total_searches_left: log.quedan, plan_searches_left: log.quedan, api_key: KEY });
        }
        log.search.push(p);
        if (p.api_key !== KEY) return resp(401, { error: 'Invalid API key.' });
        const f = log.fallar[p.arrival_id];
        // Como UrlFetchApp: el mensaje de error trae la URL consultada, con la clave.
        if (f === 'red') { delete log.fallar[p.arrival_id]; throw new Error('Address unavailable: ' + url); }
        if (f === 'red-vendedores' && p.booking_token) throw new Error('Address unavailable: ' + url);
        if (f === 500) { delete log.fallar[p.arrival_id]; return resp(500, 'error'); }
        if (f === 429) return resp(429, { error: 'Your account has run out of searches.' });
        if (f === 'vacio') return resp(200, { error: "Google Flights hasn't returned any results for this query." });
        if (p.booking_token) return resp(200, VENDEDORES);
        const r = JSON.parse(JSON.stringify(EJEMPLO));
        r.search_metadata = { url_con_clave: 'https://serpapi.com/search?api_key=' + p.api_key };
        [].concat(r.best_flights, r.other_flights).forEach((o) => { if (typeof o.price === 'number') o.price = Math.round(o.price * log.factor); });
        [].concat(r.best_flights, r.other_flights).forEach((o, i) => {
          if (p.departure_token || p.type === '2') o.booking_token = 'BT' + i;
          else o.departure_token = 'DT' + i;
        });
        return resp(200, r);
      },
    },
  };
  vm.createContext(ctx);
  new vm.Script(fs.readFileSync(path.join(TOOL, 'comparador.cjs'), 'utf8'), { filename: 'Nucleo.gs' }).runInContext(ctx);
  new vm.Script(fs.readFileSync(path.join(TOOL, 'apps-script', 'Rastreo.gs'), 'utf8'), { filename: 'Rastreo.gs' }).runInContext(ctx);
  return { ctx, ss, base, log, props };
}

// ------------------------------------------------------------------ la plataforma (Code.gs)
function loadPlatform(ss) {
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} }, Logger: { log() {} }, Utilities: { formatDate },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, getProperties: () => ({}), setProperty() {}, deleteProperty() {}, getKeys: () => [] }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {}, hasLock: () => true }) },
    Session: { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => '' }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} },
  };
  const stub = () => new Proxy(function () { return stub(); }, { get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : stub()) });
  for (const g of ['DriveApp', 'HtmlService', 'ContentService', 'UrlFetchApp', 'DocumentApp', 'MailApp', 'GmailApp', 'ScriptApp']) ctx[g] = stub();
  vm.createContext(ctx);
  new vm.Script(fs.readFileSync(path.join(ROOT, 'server', 'Code.gs'), 'utf8'), { filename: 'Code.gs' }).runInContext(ctx);
  ctx.isUserAnalyst = (e) => ['dsanchez@equitel.com.co', 'compras.equitel@equitel.com.co'].includes(e);
  ctx.validateUserSession_ = () => true;
  ctx.validateUserEmail_ = () => true;
  return ctx;
}

// ------------------------------------------------------------------ verificaciones
const failures = [];
const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: da ${JSON.stringify(got)}, se esperaba ${JSON.stringify(want)}`); };
const rowsOf = (sheet) => { const [h, ...r] = sheet.data; return r.map((x) => Object.fromEntries(h.map((k, i) => [k, x[i]]))); };
const estadoOf = (ss) => Object.fromEntries(ss.sheets['COMPARATIVO ESTADO'].data.map((r) => [r[0], r[1]]));

function main() {
  // 1. Configuración y primera pasada
  let t = loadTracker();
  const before = JSON.stringify(t.base.data);
  const prueba = t.ctx.probarConfiguracion();
  eq('probarConfiguracion no busca', t.log.search.length, 0);
  eq('probarConfiguracion lista las 6 de hoy (sin estudio activo usa hoy como inicio)', (prueba.match(/SOL-\d+ (COMPRA|COTIZACION)/g) || []).sort(),
    ['SOL-1 COMPRA', 'SOL-12 COMPRA', 'SOL-2 COTIZACION', 'SOL-6 COMPRA', 'SOL-8 COMPRA', 'SOL-9 COMPRA']);
  t.ctx.activarRastreo();
  t.ctx.activarRastreo();
  eq('fechas del estudio: hoy y 14 días después', [t.props.INICIO_ESTUDIO, t.props.FIN_ESTUDIO], [today, plus(14)]);
  eq('un solo disparador cada 15 minutos', t.log.triggers, ['rastrearPrecios']);
  const hoja = t.ss.sheets['COMPARATIVO PRECIOS'];
  eq('pestañas ocultas y con aviso al editar', [hoja.hidden, hoja.protectedWarning, t.ss.sheets['COMPARATIVO ESTADO'].hidden], [true, true, true]);
  let filas = rowsOf(hoja);
  eq('busca lo que toca, COMPRA primero y la ida más próxima primero', filas.map((r) => r['ID SOLICITUD'] + ' ' + r['MOMENTO']),
    ['SOL-6 COMPRA', 'SOL-12 COMPRA', 'SOL-1 COMPRA', 'SOL-8 COMPRA', 'SOL-9 COMPRA', 'SOL-2 COTIZACION']);
  eq('consultas a SerpApi: una por búsqueda; sin aeropuerto no consulta', t.log.search.length, 5);
  eq('la hoja de solicitudes queda idéntica', JSON.stringify(t.base.data) === before, true);
  const todo = JSON.stringify(Object.values(t.ss.sheets).map((s) => s.data));
  eq('la clave nunca llega a la hoja', todo.includes(KEY), false);
  const s1 = filas.find((r) => r['ID SOLICITUD'] === 'SOL-1');
  eq('SOL-1: más barato, cerca de las 07:00 (±2 h) y misma aerolínea registrada', [s1['MAS BARATO'], s1['AEROLINEA MAS BARATA'], s1['MAS BARATO CERCA HORA'], s1['AEROLINEA CERCA HORA'], s1['SALIDA CERCA HORA'], s1['MISMA AEROLINEA CERCA HORA'], s1['MISMA AEROLINEA DIA']],
    [351700, 'JetSMART', 389200, 'Wingo', '05:40', 455900, 455900]);
  eq('SOL-1: fechas y hora como texto, cotizado y canal del momento', [s1['FECHA IDA'], s1['FECHA REGRESO'], s1['HORA PEDIDA'], s1['COSTO TIQUETES COTIZADO'], s1['CANAL REGISTRADO'], s1['AEROPUERTOS'], s1['RESULTADO']],
    [plus(14), plus(16), '07:00', 400000, 'Aviatur', 'BOG → MDE,EOH', 'OK']);
  const s9 = filas.find((r) => r['ID SOLICITUD'] === 'SOL-9');
  eq('SOL-9: fecha e ida leídas de celdas tipo fecha y hora; solo ida', [s9['FECHA IDA'], s9['HORA PEDIDA'], s9['FECHA REGRESO'], s9['MISMA AEROLINEA CERCA HORA']], [plus(18), '07:00', '', 498600]);
  const s8 = filas.find((r) => r['ID SOLICITUD'] === 'SOL-8');
  eq('SOL-8 (Tunja): sin aeropuerto, sin consultar', [s8['RESULTADO'], s8['CONSULTAS'], /más cercano/.test(s8['DETALLE'])], ['SIN_AEROPUERTO', 0, true]);
  eq('SOL-2: 2 pasajeros', [t.log.search.find((p) => p.arrival_id === 'CLO' && p.outbound_date === plus(10)).adults], ['2']);
  eq('estado ACTIVO', estadoOf(t.ss)['ESTADO'], 'ACTIVO');

  // 2. Idempotente
  t.ctx.rastrearPrecios();
  eq('segunda pasada: nada nuevo', [rowsOf(hoja).length, t.log.search.length], [6, 5]);

  // 3. Una solicitud se aprueba después de cotizar → COMPRA de la misma solicitud
  t.base.data[2][1] = 'APROBADO';
  t.ctx.rastrearPrecios();
  eq('SOL-2 aprobada: búsqueda de COMPRA', rowsOf(hoja).slice(-1).map((r) => r['ID SOLICITUD'] + ' ' + r['MOMENTO']), ['SOL-2 COMPRA']);

  // 4. Cupo, clave, transitorios, tope diario, fin del estudio
  const nueva = (id, extra = {}) => { const r = solicitudes()[1].slice(); r[0] = id; Object.entries(extra).forEach(([k, v]) => { r[H.indexOf(k)] = v; }); return r; };
  t = loadTracker({ quedan: 10, props: { INICIO_ESTUDIO: today } });
  t.ctx.rastrearPrecios();
  eq('reserva mínima: no busca', [t.log.search.length, estadoOf(t.ss)['ESTADO']], [0, 'SIN CUPO']);
  t = loadTracker({ props: { INICIO_ESTUDIO: today, SERPAPI_KEY: 'otra' } });
  t.ctx.rastrearPrecios();
  eq('clave inválida: no busca', [t.log.search.length, estadoOf(t.ss)['ESTADO']], [0, 'CLAVE INVALIDA']);
  t = loadTracker({ props: { INICIO_ESTUDIO: today }, fallar: { 'MDE,EOH': 429 } });
  t.ctx.rastrearPrecios();
  eq('429 de SerpApi: se detiene', estadoOf(t.ss)['ESTADO'], 'SIN CUPO');
  t = loadTracker({ props: { INICIO_ESTUDIO: today }, fallar: { BOG: 500, CLO: 'red' } });
  t.ctx.rastrearPrecios();
  const tras1 = rowsOf(t.ss.sheets['COMPARATIVO PRECIOS']).map((r) => r['ID SOLICITUD']).sort();
  t.ctx.rastrearPrecios();
  const tras2 = rowsOf(t.ss.sheets['COMPARATIVO PRECIOS']).map((r) => r['ID SOLICITUD']).sort();
  eq('error transitorio: no escribe y reintenta en la siguiente', [tras1.includes('SOL-6'), tras2.includes('SOL-6'), tras2.length], [false, true, 6]);
  eq('el registro de ejecuciones no muestra la clave ni la URL', [t.log.consola.some((l) => l.includes(KEY)), t.log.consola.some((l) => /Sin conexión con SerpApi: Address unavailable: \[dirección\]/.test(l))], [false, true]);
  t = loadTracker({ props: { INICIO_ESTUDIO: today, MAX_BUSQUEDAS_DIA: '2' } });
  t.ctx.rastrearPrecios();
  eq('tope diario', [t.log.search.length, estadoOf(t.ss)['ESTADO']], [2, 'TOPE DIARIO']);
  t = loadTracker({ props: { INICIO_ESTUDIO: plus(-20), FIN_ESTUDIO: plus(-6) } });
  t.ctx.rastrearPrecios();
  eq('estudio terminado: no busca', [t.log.search.length, estadoOf(t.ss)['ESTADO']], [0, 'TERMINADO']);
  t = loadTracker({ props: { INICIO_ESTUDIO: today, MAX_POR_EJECUCION: '2' } });
  t.ctx.rastrearPrecios();
  eq('tope por ejecución: deja el resto pendiente', [rowsOf(t.ss.sheets['COMPARATIVO PRECIOS']).length, estadoOf(t.ss)['PENDIENTES']], [2, 4]);
  t = loadTracker({ props: { INICIO_ESTUDIO: today }, fallar: { UIB: 'vacio' }, rows: [H, nueva('SOL-20', { 'CIUDAD DESTINO': 'QUIBDO', STATUS: 'APROBADO' })] });
  t.ctx.rastrearPrecios();
  eq('sin resultados de Google: queda escrito', rowsOf(t.ss.sheets['COMPARATIVO PRECIOS']).map((r) => r['RESULTADO']), ['SIN_RESULTADOS']);

  // 5. Vendedores solo en el momento configurado
  t = loadTracker({ props: { INICIO_ESTUDIO: today, VENDEDORES: 'compra' } });
  t.ctx.rastrearPrecios();
  const fv = rowsOf(t.ss.sheets['COMPARATIVO PRECIOS']);
  const v1 = fv.find((r) => r['ID SOLICITUD'] === 'SOL-1');
  const v2 = fv.find((r) => r['ID SOLICITUD'] === 'SOL-2');
  eq('vendedores en COMPRA (ida y regreso: 3 consultas) y no en COTIZACION', [v1['CONSULTAS'], JSON.parse(v1['VENDEDORES']).length, v2['CONSULTAS'], v2['VENDEDORES']], [3, 3, 1, '']);
  t = loadTracker({ props: { INICIO_ESTUDIO: today, VENDEDORES: 'compra' }, fallar: { 'MDE,EOH': 'red-vendedores' } });
  t.ctx.rastrearPrecios();
  const fr = rowsOf(t.ss.sheets['COMPARATIVO PRECIOS']).find((r) => r['ID SOLICITUD'] === 'SOL-1');
  eq('falla la red al buscar vendedores: queda la búsqueda, sin la URL ni la clave', [fr['RESULTADO'], /^Vendedores no disponibles: Sin conexión con SerpApi: Address unavailable: \[dirección\]$/.test(fr['DETALLE']),
    JSON.stringify(t.ss.sheets['COMPARATIVO PRECIOS'].data).includes(KEY)], ['OK', true, false]);

  // 6. Desactivar
  t = loadTracker();
  t.ctx.activarRastreo();
  t.ctx.desactivarRastreo();
  eq('desactivar quita el disparador', t.log.triggers, []);

  // 7. La plataforma lee lo que escribió el rastreo
  t = loadTracker();
  t.ctx.activarRastreo();
  const p = loadPlatform(t.ss);
  const snap = JSON.stringify(Object.values(t.ss.sheets).map((s) => s.data));
  const pide = (email) => p.dispatch('getPriceTracking', { userEmail: email, sessionToken: 'x' });
  eq('Laura (analista) no lo ve: lo frena el dispatch con mensaje limpio', pide('compras.equitel@equitel.com.co').error,
    'El comparador de precios está restringido a Yurani Prieto, Diego Caballero y David Sánchez.');
  let lanzo = '';
  try { p.getPriceTracking('compras.equitel@equitel.com.co'); } catch (e) { lanzo = e.message; }
  eq('y la función también la frena', /restringido/.test(lanzo), true);
  eq('otro usuario no lo ve', pide('alguien@ejemplo.test').success, false);
  const r = pide('dsanchez@equitel.com.co');
  eq('David lo ve', r.success, true);
  const d = r.data;
  eq('no escribe nada', JSON.stringify(Object.values(t.ss.sheets).map((s) => s.data)) === snap, true);
  eq('sin correos, cédulas ni nombres', priv.some((x) => JSON.stringify(d).includes(x)), false);
  eq('solicitudes rastreadas: por comprar primero, por fecha de ida', d.items.map((i) => i.requestId), ['SOL-12', 'SOL-1', 'SOL-8', 'SOL-9', 'SOL-2', 'SOL-6']);
  const i1 = d.items.find((i) => i.requestId === 'SOL-1');
  eq('SOL-1: mercado cerca de la hora, diferencia y misma aerolínea', [i1.quoted, i1.market, i1.difference, i1.sameAirline, i1.marketMoment, i1.channel], [400000, 389200, 10800, 455900, 'COMPRA', 'Aviatur']);
  const i12 = d.items.find((i) => i.requestId === 'SOL-12');
  eq('SOL-12 sin hora pedida: referencia del día', [i12.market, i12.atPurchase.referenceIsNear], [351700, false]);
  const i8 = d.items.find((i) => i.requestId === 'SOL-8');
  eq('SOL-8 sin aeropuerto: sin mercado', [i8.market, i8.atPurchase.result], [null, 'SIN_AEROPUERTO']);
  const ap = d.summary.atPurchase;
  // COMPRA OK: SOL-1 (400000 vs 389200 cerca de las 07:00), SOL-12 (350000 vs 351700 del día, sin hora),
  // SOL-9 (600000 vs 389200), SOL-6 (432888 vs 351700: nada sale entre 08:40 y 12:40, referencia del día).
  eq('resumen al comprar', [ap.n, ap.quoted, ap.market, ap.difference, ap.possibleSavings], [4, 1782888, 1481800, 301088, 302788]);
  const i6 = d.items.find((i) => i.requestId === 'SOL-6');
  eq('SOL-6: sin vuelos cerca de las 10:40, referencia del día; misma aerolínea del día', [i6.market, i6.atPurchase.referenceIsNear, i6.sameAirline], [351700, false, 389200]);
  eq('resumen al cotizar (SOL-2, cerca de las 06:30: 800000 vs 389200)', [d.summary.atQuote.n, d.summary.atQuote.quoted, d.summary.atQuote.market], [1, 800000, 389200]);
  eq('por canal', d.summary.byChannel.map((c) => c.channel + ':' + c.requests + ':' + c.n), ['Aviatur:3:3', 'Directo:1:1', 'Sin registrar:2:1']);
  eq('estado del rastreo para el dashboard', [d.meta.installed, d.meta.state['ESTADO'], d.meta.searches, d.meta.queries], [true, 'ACTIVO', 6, 5]);
  const ej = t.ctx.cpResumir(JSON.parse(JSON.stringify(EJEMPLO).replace(/"LATAM"/g, '"COPA"')), { horaIda: '07:00' });
  eq('«Copa Airlines» registrada = «COPA» en Google', [t.ctx.rpMismaAerolinea_(ej.opciones, 'Copa Airlines', '07:00').cerca.precio, t.ctx.rpMismaAerolinea_(ej.opciones, 'Varias aerolíneas', '07:00').cerca], [455900, null]);
  // SOL-2 se aprueba y el mercado sube 10 %: la referencia es la de la compra.
  t.base.data[2][1] = 'APROBADO';
  t.log.factor = 1.1;
  t.ctx.rastrearPrecios();
  const d2 = loadPlatform(t.ss).getPriceTracking('dsanchez@equitel.com.co');
  const i2 = d2.items.find((i) => i.requestId === 'SOL-2');
  eq('con los dos momentos, manda el de la compra', [i2.atQuote.reference, i2.atPurchase.reference, i2.market, i2.marketMoment, i2.difference], [389200, 428120, 428120, 'COMPRA', 371880]);
  const sinTab = loadPlatform(makeSpreadsheet([makeSheet('Nueva Base Solicitudes', solicitudes())]));
  const vacio = sinTab.dispatch('getPriceTracking', { userEmail: 'dsanchez@equitel.com.co', sessionToken: 'x' });
  eq('sin el proyecto aparte instalado: vacío, sin error', [vacio.success, vacio.data.meta.installed, vacio.data.items.length], [true, false, 0]);

  if (failures.length) {
    console.error(`\n✗ Rastreo de precios: ${failures.length} problema(s).\n`);
    failures.forEach((f) => console.error('  · ' + f));
    process.exit(1);
  }
  console.log('Rastreo de precios: momentos de búsqueda, solo sus pestañas, clave fuera de la hoja, cupo, reintentos, vendedores, permisos y cuentas del dashboard OK.');
}

main();
