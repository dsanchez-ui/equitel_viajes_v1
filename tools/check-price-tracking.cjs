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
 *   5. Formato 2 (#A86): cada tramo se busca por separado, con su hora pedida; la
 *      referencia es la suma de los tramos (internacional de ida y vuelta: el menor
 *      entre esa suma y el tiquete redondo); el detalle de un viaje trae los vuelos
 *      de cada tramo; las búsquedas del formato anterior se repiten una vez.
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
  'EMPRESA', 'UNIDAD DE NEGOCIO', 'CORREO ENCUESTADO', 'CÉDULA PERSONA 1', 'NOMBRE PERSONA 1',
  'HORA LLEGADA VUELO VUELTA', 'ES INTERNACIONAL', 'AEROLINEA REGRESO', 'COSTO_FINAL_HOTEL', 'TOTAL FACTURA'];
const ev = (o) => JSON.stringify(o);
const hace = (h) => new Date(Date.now() - h * 3600000).toISOString();
const priv = ['pasajero@ejemplo.test', 'CEDULA-FICTICIA-1', 'NOMBRE PRIVADO'];
function solicitudes() {
  // Las columnas del final (hora del regreso, internacional, aerolínea del regreso, hotel y factura) van vacías salvo donde se ponen.
  const rows = filasBase().map((r) => r.concat(Array(Math.max(0, H.length - r.length)).fill('')));
  const set = (id, k, v) => { rows.find((r) => r[0] === id)[H.indexOf(k)] = v; };
  set('SOL-6', 'TOTAL FACTURA', 410000);        // ya comprada y facturada, sin hotel
  set('SOL-9', 'COSTO_FINAL_HOTEL', 200000);    // con hotel: la factura lo incluye
  set('SOL-9', 'TOTAL FACTURA', 900000);
  return [H].concat(rows);
}
function filasBase() {
  return [
    ['SOL-1', 'APROBADO', 'VIAJE', 'BOGOTA, COLOMBIA', 'MEDELLIN, COLOMBIA', plus(14), plus(16), 1, '07:00',
      ev({ costConfirmed: hace(30), costConfirmedBy: { email: 'compras.equitel@equitel.com.co', at: hace(30) } }), 400000, 'LATAM', 'Aviatur', 'Equitel', 'POTENCIA', ...priv, '06:00', '', ''],
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
  const log = { search: [], account: 0, triggers: [], quedan: opts.quedan ?? 200, fallar: opts.fallar || {}, factor: 1, factorIdaYVuelta: 1, consola: [] };
  // DOS_NIVELES 'no' en las pruebas de siempre; la búsqueda del otro equipaje (#A97) se prueba aparte.
  const props = Object.assign({ SERPAPI_KEY: KEY, SPREADSHEET_ID: 'HOJA-ID', DOS_NIVELES: 'no' }, opts.props || {});
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
        const gf = log.urlMala === 'clave' ? 'https://www.google.com/travel/flights?x=' + p.api_key
          : log.urlMala === 'otra' ? 'javascript:alert(1)'
            : 'https://www.google.com/travel/flights?hl=es-419&gl=co&curr=COP&tfs=PRUEBA-' + encodeURIComponent(p.departure_id + '-' + p.arrival_id + '-' + p.outbound_date);
        r.search_metadata = { url_con_clave: 'https://serpapi.com/search?api_key=' + p.api_key, google_flights_url: gf };
        const f2 = log.factor * (p.type === '1' ? log.factorIdaYVuelta : 1);
        if (log.escalaBarata) [].concat(r.best_flights, r.other_flights).forEach((o) => { if (o.flights.length > 1) o.price = log.escalaBarata; });
        if (log.todoConEscala) [].concat(r.best_flights, r.other_flights).forEach((o) => { if (o.flights.length === 1) o.flights = [o.flights[0], Object.assign({}, o.flights[0], { flight_number: 'XX 1' })]; });
        [].concat(r.best_flights, r.other_flights).forEach((o) => { if (typeof o.price === 'number') o.price = Math.round(o.price * f2); });
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
  eq('consultas a SerpApi: una por tramo (ida y regreso = 2); sin aeropuerto no consulta', t.log.search.length, 7);
  eq('cada tramo es una búsqueda de solo ida', t.log.search.every((p) => p.type === '2' && !p.return_date), true);
  eq('la hoja de solicitudes queda idéntica', JSON.stringify(t.base.data) === before, true);
  const todo = JSON.stringify(Object.values(t.ss.sheets).map((s) => s.data));
  eq('la clave nunca llega a la hoja', todo.includes(KEY), false);
  const s1 = filas.find((r) => r['ID SOLICITUD'] === 'SOL-1');
  // Ida 07:00 y regreso 06:00: en los dos tramos lo más barato a ±2 h es Wingo 05:40 ($389.200); en el día, JetSMART 13:20
  // ($351.700); LATAM (registrada) a la hora, 06:30 ($455.900). El viaje = ida + regreso.
  eq('SOL-1: más barato, a la hora pedida de cada tramo y misma aerolínea, sumando ida y regreso', [s1['MAS BARATO'], s1['AEROLINEA MAS BARATA'], s1['MAS BARATO CERCA HORA'], s1['AEROLINEA CERCA HORA'], s1['SALIDA CERCA HORA'], s1['MISMA AEROLINEA CERCA HORA'], s1['MISMA AEROLINEA DIA'], s1['MISMA AEROLINEA']],
    [703400, 'JetSMART / JetSMART', 778400, 'Wingo / Wingo', '05:40 / 05:40', 911800, 911800, 911800]);
  eq('SOL-1: referencia por tramos, las dos horas a tiempo, formato 3', [s1['REFERENCIA'], s1['REFERENCIA A LA HORA'], s1['REFERENCIA TIPO'], s1['FORMATO'], s1['HORA REGRESO PEDIDA'], s1['IDA Y VUELTA JUNTOS']],
    [778400, 'SI', 'TRAMOS', 3, '06:00', '']);
  const t1 = JSON.parse(s1['TRAMOS']);
  eq('SOL-1: tramos con su ruta, fecha y hora', t1.map((l) => [l.t, l.de, l.a, l.f, l.h, l.ar, l.ref, l.refCerca]),
    [['IDA', 'BOG', 'MDE,EOH', plus(14), '07:00', 'LATAM', 389200, true], ['REGRESO', 'MDE,EOH', 'BOG', plus(16), '06:00', 'LATAM', 389200, true]]);
  eq('SOL-1: los vuelos de cada tramo: primero los directos por hora de salida, después los de escala', t1[0].ops.map((o) => o[2] + ' ' + o[0] + ' ' + o[6]),
    ['05:00 Avianca 612400', '05:40 Wingo 389200', '06:30 LATAM 455900', '07:05 Avianca 498600', '13:20 JetSMART 351700', '06:00 Avianca 540100']);
  eq('SOL-1: el vuelo con escala trae sus dos números, la escala y la duración', t1[0].ops[5].slice(1, 6), ['AV 9290 / AV 9902', '06:00', '08:50', 1, 170]);
  eq('SOL-1: los tramos tenían directos y solo esos cuentan', t1.map((l) => l.dir), [true, true]);
  eq('SOL-1: cada tramo guarda el enlace a la misma búsqueda en Google Flights', t1.map((l) => l.url),
    ['BOG-MDE,EOH-' + plus(14), 'MDE,EOH-BOG-' + plus(16)].map((x) => 'https://www.google.com/travel/flights?hl=es-419&gl=co&curr=COP&tfs=PRUEBA-' + encodeURIComponent(x)));
  eq('SOL-1: búsquedas de ida y de regreso con sus fechas', t.log.search.filter((p) => ['BOG|MDE,EOH|' + plus(14), 'MDE,EOH|BOG|' + plus(16)].includes(p.departure_id + '|' + p.arrival_id + '|' + p.outbound_date)).length, 2);
  const s2 = filas.find((r) => r['ID SOLICITUD'] === 'SOL-2');
  eq('SOL-2 sin hora de regreso: ida a la hora (06:30) + regreso el más barato del día', [s2['REFERENCIA'], s2['REFERENCIA A LA HORA'], s2['MAS BARATO CERCA HORA']], [740900, 'PARCIAL', '']);
  eq('SOL-1: fechas y hora como texto, cotizado y canal del momento', [s1['FECHA IDA'], s1['FECHA REGRESO'], s1['HORA PEDIDA'], s1['COSTO TIQUETES COTIZADO'], s1['CANAL REGISTRADO'], s1['AEROPUERTOS'], s1['RESULTADO']],
    [plus(14), plus(16), '07:00', 400000, 'Aviatur', 'BOG → MDE,EOH', 'OK']);
  const s9 = filas.find((r) => r['ID SOLICITUD'] === 'SOL-9');
  eq('SOL-9: fecha e ida leídas de celdas tipo fecha y hora; solo ida', [s9['FECHA IDA'], s9['HORA PEDIDA'], s9['FECHA REGRESO'], s9['MISMA AEROLINEA CERCA HORA']], [plus(18), '07:00', '', 498600]);
  eq('SOL-9 solo ida: un tramo y referencia a la hora', [JSON.parse(s9['TRAMOS']).length, s9['REFERENCIA'], s9['REFERENCIA A LA HORA'], s9['CONSULTAS']], [1, 389200, 'SI', 1]);
  const s8 = filas.find((r) => r['ID SOLICITUD'] === 'SOL-8');
  eq('SOL-8 (Tunja): sin aeropuerto, sin consultar', [s8['RESULTADO'], s8['CONSULTAS'], /más cercano/.test(s8['DETALLE'])], ['SIN_AEROPUERTO', 0, true]);
  eq('SOL-2: 2 pasajeros', [t.log.search.find((p) => p.arrival_id === 'CLO' && p.outbound_date === plus(10)).adults], ['2']);
  eq('estado ACTIVO', estadoOf(t.ss)['ESTADO'], 'ACTIVO');

  // 2. Idempotente
  t.ctx.rastrearPrecios();
  eq('segunda pasada: nada nuevo', [rowsOf(hoja).length, t.log.search.length], [6, 7]);

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
  eq('vendedores en COMPRA (2 tramos + vendedores de cada uno: 4 consultas) y no en COTIZACION', [v1['CONSULTAS'], JSON.parse(v1['VENDEDORES']).map((x) => x.t), v2['CONSULTAS'], v2['VENDEDORES']],
    [4, ['IDA', 'IDA', 'IDA', 'REGRESO', 'REGRESO', 'REGRESO'], 2, '']);
  eq('vendedores guardados también en cada tramo', JSON.parse(v1['TRAMOS']).map((l) => (l.vend || []).length), [3, 3]);
  t = loadTracker({ props: { INICIO_ESTUDIO: today, VENDEDORES: 'compra' }, fallar: { 'MDE,EOH': 'red-vendedores' } });
  t.ctx.rastrearPrecios();
  const fr = rowsOf(t.ss.sheets['COMPARATIVO PRECIOS']).find((r) => r['ID SOLICITUD'] === 'SOL-1');
  eq('falla la red al buscar vendedores: queda la búsqueda, sin la URL ni la clave', [fr['RESULTADO'], /^Vendedores no disponibles: Sin conexión con SerpApi: Address unavailable: \[dirección\]$/.test(fr['DETALLE']),
    JSON.stringify(t.ss.sheets['COMPARATIVO PRECIOS'].data).includes(KEY)], ['OK', true, false]);

  // 5b. Internacional de ida y vuelta: además de los tramos, el tiquete redondo; manda el más barato.
  const intl = () => [H, nueva('SOL-30', { 'CIUDAD DESTINO': 'MIAMI', STATUS: 'APROBADO', 'ES INTERNACIONAL': 'SI' })];
  t = loadTracker({ props: { INICIO_ESTUDIO: today }, rows: intl() });
  eq('probarConfiguracion dice cuántas consultas gasta', /SOL-30 COMPRA .* 3 consulta\(s\)/.test(t.ctx.probarConfiguracion()), true);
  t.ctx.rastrearPrecios();
  let fi = rowsOf(t.ss.sheets['COMPARATIVO PRECIOS'])[0];
  eq('internacional: 3 consultas, la tercera de ida y vuelta con regreso', [fi['CONSULTAS'], t.log.search.map((p) => p.type).join(','), t.log.search[2].return_date], [3, '2,2,1', plus(16)]);
  eq('internacional: el redondo ($389.200) es más barato que los tramos ($778.400)', [fi['REFERENCIA'], fi['REFERENCIA TIPO'], fi['IDA Y VUELTA JUNTOS'], fi['REFERENCIA A LA HORA'], JSON.parse(fi['TRAMOS']).map((l) => l.t)],
    [389200, 'IDA Y VUELTA', 389200, 'SI', ['IDA', 'REGRESO', 'IDA Y VUELTA']]);
  t = loadTracker({ props: { INICIO_ESTUDIO: today }, rows: intl() });
  t.log.factorIdaYVuelta = 3;
  t.ctx.rastrearPrecios();
  fi = rowsOf(t.ss.sheets['COMPARATIVO PRECIOS'])[0];
  eq('internacional: si el redondo es más caro, mandan los tramos', [fi['REFERENCIA'], fi['REFERENCIA TIPO'], fi['IDA Y VUELTA JUNTOS']], [778400, 'TRAMOS', 1167600]);
  t = loadTracker({ props: { INICIO_ESTUDIO: today, MAX_BUSQUEDAS_DIA: '2' }, rows: intl() });
  t.ctx.rastrearPrecios();
  eq('tope diario: no empieza una búsqueda que lo pasaría', [t.log.search.length, estadoOf(t.ss)['ESTADO']], [0, 'TOPE DIARIO']);

  // 5a. El enlace a Google Flights nunca lleva la clave ni es de otro sitio.
  for (const mala of ['clave', 'otra']) {
    t = loadTracker({ props: { INICIO_ESTUDIO: today }, rows: [H, nueva('SOL-40', { STATUS: 'APROBADO' })] });
    t.log.urlMala = mala;
    t.ctx.rastrearPrecios();
    const fm = rowsOf(t.ss.sheets['COMPARATIVO PRECIOS'])[0];
    eq('enlace de Google rechazado (' + mala + ')', [fm['RESULTADO'], JSON.parse(fm['TRAMOS']).map((l) => l.url), JSON.stringify(t.ss.sheets['COMPARATIVO PRECIOS'].data).includes(KEY)], ['OK', [undefined, undefined], false]);
  }

  // 5b2. Regreso registrado con otra aerolínea (#A85): misma aerolínea = LATAM de ida + Wingo de regreso.
  t = loadTracker({ props: { INICIO_ESTUDIO: today }, rows: [H, nueva('SOL-31', { STATUS: 'APROBADO', 'AEROLINEA REGRESO': 'Wingo' })] });
  t.ctx.rastrearPrecios();
  const fw = rowsOf(t.ss.sheets['COMPARATIVO PRECIOS'])[0];
  eq('regreso con otra aerolínea: cada tramo con la suya', [JSON.parse(fw['TRAMOS']).map((l) => l.ar), fw['AEROLINEA REGRESO REGISTRADA'], fw['MISMA AEROLINEA']], [['LATAM', 'Wingo'], 'Wingo', 455900 + 389200]);
  // Avianca con ida a las 05:00: a la hora (03:00–07:00) el directo es el de las 05:00 ($612.400); el de las 06:00
  // ($540.100) tiene escala y no cuenta, y el de $498.600 (07:05) queda fuera de la hora. Regreso sin hora: el directo
  // más barato del día ($498.600). Misma aerolínea = 612.400 + 498.600.
  t = loadTracker({ props: { INICIO_ESTUDIO: today }, rows: [H, nueva('SOL-32', { STATUS: 'APROBADO', AEROLINEA: 'Avianca', 'HORA LLEGADA VUELO IDA': '05:00', 'HORA LLEGADA VUELO VUELTA': '' })] });
  t.ctx.rastrearPrecios();
  const fa = rowsOf(t.ss.sheets['COMPARATIVO PRECIOS'])[0];
  eq('misma aerolínea por tramo: a la hora en la ida, del día en el regreso', [fa['MISMA AEROLINEA'], fa['MISMA AEROLINEA CERCA HORA'], fa['MISMA AEROLINEA DIA'],
    loadPlatform(t.ss).getPriceTracking('dsanchez@equitel.com.co').items[0].sameAirline], [1111000, '', 997200, 1111000]);

  // Vuelos directos primero (#A88): un vuelo con escala más barato no le gana a los directos…
  t = loadTracker({ props: { INICIO_ESTUDIO: today }, rows: [H, nueva('SOL-33', { STATUS: 'APROBADO' })] });
  t.log.escalaBarata = 100000;
  t.ctx.rastrearPrecios();
  const fe = rowsOf(t.ss.sheets['COMPARATIVO PRECIOS'])[0];
  eq('directos primero: el de escala a $100.000 no cuenta', [fe['REFERENCIA'], fe['MAS BARATO'], JSON.parse(fe['TRAMOS'])[0].ops.slice(-1)[0][6]], [778400, 703400, 100000]);
  // …y si la ruta no tiene directos ese día, cuentan los de escala.
  t = loadTracker({ props: { INICIO_ESTUDIO: today }, rows: [H, nueva('SOL-34', { STATUS: 'APROBADO', 'FECHA VUELTA': '' })] });
  t.log.todoConEscala = true;
  t.ctx.rastrearPrecios();
  const fs2 = rowsOf(t.ss.sheets['COMPARATIVO PRECIOS'])[0];
  eq('sin directos: cuentan los de escala', [fs2['REFERENCIA'], JSON.parse(fs2['TRAMOS'])[0].dir, fs2['REFERENCIA A LA HORA']], [389200, false, 'SI']);
  let lanzoDet = '';
  try { loadPlatform(t.ss).getPriceTrackingDetail('compras.equitel@equitel.com.co', 'SOL-31'); } catch (e) { lanzoDet = e.message; }
  eq('detalle: la función también frena a Laura', /restringido/.test(lanzoDet), true);

  // 5c. Búsquedas del formato anterior (ida y regreso juntos): se repiten una vez por tramos
  // si la solicitud sigue en su momento; las demás se quedan y el dashboard las sigue leyendo.
  t = loadTracker({ props: { INICIO_ESTUDIO: today } });
  const v1Head = t.ctx.RP_ENCABEZADOS.slice(0, t.ctx.RP_ENCABEZADOS.indexOf('FORMATO'));
  const v1Row = (o) => v1Head.map((k) => (k in o ? o[k] : ''));
  const viejo = new Date(Date.now() - 3600000);
  t.ss.sheets['COMPARATIVO PRECIOS'] = makeSheet('COMPARATIVO PRECIOS', [v1Head,
    v1Row({ 'FECHA BUSQUEDA': viejo, MOMENTO: 'COMPRA', 'ID SOLICITUD': 'SOL-1', 'FECHA REGRESO': plus(16), 'MAS BARATO': 351700, 'MAS BARATO CERCA HORA': 389200, RESULTADO: 'OK', CONSULTAS: 1 }),
    v1Row({ 'FECHA BUSQUEDA': viejo, MOMENTO: 'COMPRA', 'ID SOLICITUD': 'SOL-7', 'MAS BARATO': 351700, 'MAS BARATO CERCA HORA': 389200, RESULTADO: 'OK', CONSULTAS: 1 })]);
  t.ctx.rastrearPrecios();
  const hv = t.ss.sheets['COMPARATIVO PRECIOS'];
  eq('formato anterior: las columnas nuevas quedan al final', hv.data[0].slice(v1Head.length), t.ctx.RP_ENCABEZADOS.slice(v1Head.length));
  eq('formato anterior: SOL-1 (aprobada) se busca otra vez por tramos; SOL-7 (comprada hace 2 días) no', rowsOf(hv).filter((r) => r['ID SOLICITUD'] === 'SOL-1' || r['ID SOLICITUD'] === 'SOL-7').map((r) => r['ID SOLICITUD'] + ':' + (r['FORMATO'] || 1)),
    ['SOL-1:1', 'SOL-7:1', 'SOL-1:3']);
  const pv = loadPlatform(t.ss).getPriceTracking('dsanchez@equitel.com.co');
  const pv1 = pv.items.find((i) => i.requestId === 'SOL-1'), pv7 = pv.items.find((i) => i.requestId === 'SOL-7');
  eq('dashboard: SOL-1 usa la búsqueda nueva; SOL-7 la anterior', [pv1.market, pv1.atPurchase.format, pv1.atPurchase.legs.length, pv7.market, pv7.atPurchase.format, pv7.atPurchase.legs.length],
    [778400, 3, 2, 389200, 1, 0]);
  // Una búsqueda del formato 2 (por tramos, sin preferir directos) también se repite una vez.
  t = loadTracker({ props: { INICIO_ESTUDIO: today } });
  t.ss.sheets['COMPARATIVO PRECIOS'] = makeSheet('COMPARATIVO PRECIOS', [t.ctx.RP_ENCABEZADOS.slice(),
    t.ctx.RP_ENCABEZADOS.map((k) => ({ 'FECHA BUSQUEDA': viejo, MOMENTO: 'COMPRA', 'ID SOLICITUD': 'SOL-1', RESULTADO: 'OK', CONSULTAS: 2, FORMATO: 2 })[k] ?? '')]);
  t.ctx.rastrearPrecios();
  eq('formato 2: se repite una vez con directos primero', rowsOf(t.ss.sheets['COMPARATIVO PRECIOS']).filter((r) => r['ID SOLICITUD'] === 'SOL-1').map((r) => r['FORMATO']), [2, 3]);
  const viejaIyV = loadPlatform(t.ss)._ptSnapshot_(rowsOf(hv)[0]);
  eq('formato anterior de ida y vuelta: precio junto, a la hora del vuelo de ida', [viejaIyV.format, viejaIyV.referenceKind, viejaIyV.reference, viejaIyV.referenceIsNear], [1, 'IDA Y VUELTA', 389200, true]);

  // 5d. Tarifa del manual (#A95, «peras con peras»): TIPO 2 o 3 se busca con una maleta de mano por
  // pasajero; TIPO 1 o sin tarifa, sin maleta. Una búsqueda con otro equipaje se repite una vez.
  const HF = H.concat(['TIPO DE COMPRA DE TKT', 'TARIFA RECOMENDADA']);
  const conTarifa = (id, tipo, rec, extra = {}) => nueva(id, extra).concat([tipo, rec]);
  t = loadTracker({ props: { INICIO_ESTUDIO: today }, rows: [HF,
    conTarifa('SOL-50', 'TIPO 2', 'TIPO 2', { STATUS: 'APROBADO', '# PERSONAS QUE VIAJAN': 2, AEROLINEA: 'Avianca' }),
    conTarifa('SOL-51', 'TIPO 1', 'TIPO 2', { STATUS: 'APROBADO', 'FECHA VUELTA': '' }),
    conTarifa('SOL-52', '', 'TIPO 3', { STATUS: 'APROBADO', 'FECHA VUELTA': '' }),
    conTarifa('SOL-53', '', '', { STATUS: 'APROBADO', 'FECHA VUELTA': '' })] });
  eq('probarConfiguracion dice la tarifa y el equipaje', /SOL-50 COMPRA .*TIPO 2, con maleta de mano/.test(t.ctx.probarConfiguracion()), true);
  t.ctx.rastrearPrecios();
  const bagsOf = (dest, fecha) => t.log.search.filter((p) => p.outbound_date === fecha && !p.booking_token).map((p) => p.bags);
  eq('TIPO 2 con 2 pasajeros: ida y regreso con 2 maletas de mano', bagsOf('', plus(14)).slice(0, 1).concat(bagsOf('', plus(16))), ['2', '2']);
  const ft = Object.fromEntries(rowsOf(t.ss.sheets['COMPARATIVO PRECIOS']).map((r) => [r['ID SOLICITUD'], [r['TARIFA'], r['MALETA DE MANO']]]));
  // SOL-53 no tiene tarifa: se busca con la que corresponde por noches (solo ida sin hotel = TIPO 1, #A97).
  eq('cada búsqueda guarda la tarifa y las maletas', [ft['SOL-50'], ft['SOL-51'], ft['SOL-52'], ft['SOL-53']], [['TIPO 2', 2], ['TIPO 1', 0], ['TIPO 3', 1], ['TIPO 1', 0]]);
  eq('sin maleta no se manda el parámetro', t.log.search.filter((p) => !p.bags).length, 2);
  t.ctx.rastrearPrecios();
  eq('segunda pasada: nada nuevo', rowsOf(t.ss.sheets['COMPARATIVO PRECIOS']).length, 4);
  // El área de viajes registra que SOL-51 se compra en TIPO 2: se busca otra vez, ahora con maleta, y solo una vez.
  t.base.data.find((r) => r[0] === 'SOL-51')[HF.indexOf('TIPO DE COMPRA DE TKT')] = 'TIPO 2';
  t.ctx.rastrearPrecios();
  t.ctx.rastrearPrecios();
  const r51 = rowsOf(t.ss.sheets['COMPARATIVO PRECIOS']).filter((r) => r['ID SOLICITUD'] === 'SOL-51').map((r) => r['MALETA DE MANO']);
  eq('cambió la tarifa: se repite una vez con maleta', r51, [0, 1]);
  const pf = loadPlatform(t.ss).getPriceTracking('dsanchez@equitel.com.co');
  const fOf = (id) => pf.items.find((i) => i.requestId === id).fare;
  // #A97: sin tarifa registrada se compara con la que corresponde por noches (SOL-52: TIPO 3; SOL-53: TIPO 1).
  eq('dashboard: la tarifa y si se buscó con su equipaje', ['SOL-50', 'SOL-51', 'SOL-52', 'SOL-53'].map((id) => [fOf(id).type, fOf(id).searchedBags, fOf(id).match]),
    [['2', 2, true], ['2', 1, true], ['', 1, true], ['', 0, true]]);
  eq('dashboard: la tarifa con que se compara y de dónde sale', ['SOL-50', 'SOL-51', 'SOL-52', 'SOL-53'].map((id) => [fOf(id).effective, fOf(id).basis]),
    [['2', 'registrada'], ['2', 'registrada'], ['3', 'recomendada'], ['1', 'recomendada']]);
  eq('dashboard: qué tan comparable (TIPO 1 exacta; TIPO 3 fuera de Avianca aproximada)', ['SOL-50', 'SOL-52', 'SOL-53'].map((id) => fOf(id).quality),
    ['exacta', 'aproximada', 'exacta']);
  eq('dashboard: la recomendada se lee de la hoja o se calcula por las noches', [fOf('SOL-50').recommended, fOf('SOL-53').recommended], ['2', '1']);
  eq('resumen con la misma tarifa: las 4 (2 por noches) y solo exactas: 3', [pf.summary.sameFare.overall.n, pf.summary.exact.overall.n, pf.summary.overall.n, pf.summary.fareCounts],
    [4, 3, 4, { match: 4, mismatch: 0, unknown: 0, noFare: 0, noResult: 0, byRecommendation: 2, exact: 3, approx: 1 }]);
  // Si la búsqueda con maleta falta (p. ej. aún no corre), la de sin maleta no se toma como la misma tarifa.
  const cp = t.ss.sheets['COMPARATIVO PRECIOS'].data, iId = cp[0].indexOf('ID SOLICITUD'), iBags = cp[0].indexOf('MALETA DE MANO');
  cp.splice(cp.findIndex((r, i) => i > 0 && r[iId] === 'SOL-51' && r[iBags] === 1), 1);
  const pf2 = loadPlatform(t.ss).getPriceTracking('dsanchez@equitel.com.co');
  const f51 = pf2.items.find((i) => i.requestId === 'SOL-51');
  eq('sin búsqueda con su equipaje: no se compara', [f51.fare.match, f51.fare.searchedBags, f51.fare.quality, pf2.summary.fareCounts.mismatch, pf2.summary.sameFare.overall.n],
    [false, 0, 'no comparable', 1, 3]);
  // #A97: la regla de cada aerolínea (prueba del 9-oct con SerpApi) y la búsqueda del otro equipaje en el detalle.
  const q = loadPlatform(t.ss);
  const snapCon = (airline, bags) => ({ result: 'OK', bags, format: 3, referenceKind: 'TRAMOS', legs: [{ leg: 'IDA', referenceIsNear: true, near: { airline } }] });
  eq('calidad por aerolínea y tarifa', [
    q._ptQuality_(1, snapCon('LATAM', 0), true).quality, q._ptQuality_(2, snapCon('Avianca', 1), true).quality,
    q._ptQuality_(2, snapCon('LATAM', 1), true).quality, q._ptQuality_(2, snapCon('JetSMART', 1), true).quality,
    q._ptQuality_(3, snapCon('Avianca', 1), true).quality, q._ptQuality_(3, snapCon('Wingo', 1), true).quality,
    q._ptQuality_(2, snapCon('Avianca', 0), false).quality, q._ptQuality_(2, null, false).quality],
    ['exacta', 'exacta', 'aproximada', 'exacta', 'exacta', 'aproximada', 'no comparable', '']);
  eq('LATAM en TIPO 2 dice por qué es aproximada', /LATAM: Google no distingue/.test(q._ptQuality_(2, snapCon('LATAM', 1), true).reason), true);
  // Una búsqueda más reciente que falla no tapa la anterior que sí trajo precio (revisión del 8-oct).
  const iRes = cp[0].indexOf('RESULTADO'), iFecha = cp[0].indexOf('FECHA BUSQUEDA');
  const ok50 = cp.find((r, i) => i > 0 && r[iId] === 'SOL-50' && r[iRes] === 'OK');
  const before50 = pf2.items.find((i) => i.requestId === 'SOL-50');
  const failed = ok50.slice(); failed[iRes] = 'SIN_RESULTADOS'; failed[iFecha] = new Date(Date.now() + 3600000);
  cp.push(failed);
  const pf3 = loadPlatform(t.ss).getPriceTracking('dsanchez@equitel.com.co');
  const after50 = pf3.items.find((i) => i.requestId === 'SOL-50');
  eq('una búsqueda nueva que falla no borra el precio de la anterior', [after50.market, after50.fare.match, after50.atPurchase.result], [before50.market, true, 'OK']);
  const det50 = loadPlatform(t.ss).getPriceTrackingDetail('dsanchez@equitel.com.co', 'SOL-50');
  eq('el detalle también muestra la búsqueda que sí trajo precio', [det50.searches.COMPRA && det50.searches.COMPRA.result, det50.searchCount.COMPRA >= 2], ['OK', true]);

  // 5e. Dos precios por vuelo (#A97): con DOS_NIVELES = compra, al comprar se busca también el otro equipaje.
  t = loadTracker({ props: { INICIO_ESTUDIO: today, DOS_NIVELES: 'compra' }, rows: [HF,
    conTarifa('SOL-60', 'TIPO 2', 'TIPO 2', { STATUS: 'APROBADO', 'FECHA VUELTA': '', AEROLINEA: 'Avianca' }),
    conTarifa('SOL-61', '', '', { STATUS: 'APROBADO', 'FECHA VUELTA': '' })] });
  eq('probarConfiguracion avisa la búsqueda del otro equipaje', /SOL-60 COMPRA .*otro equipaje/.test(t.ctx.probarConfiguracion()), true);
  t.ctx.rastrearPrecios();
  const dos = rowsOf(t.ss.sheets['COMPARATIVO PRECIOS']).map((r) => r['ID SOLICITUD'] + ' ' + r['MALETA DE MANO']).sort();
  eq('cada viaje se busca con los dos equipajes (el de la tarifa primero)', dos, ['SOL-60 0', 'SOL-60 1', 'SOL-61 0', 'SOL-61 1']);
  t.ctx.rastrearPrecios();
  eq('segunda pasada: nada nuevo', rowsOf(t.ss.sheets['COMPARATIVO PRECIOS']).length, 4);
  const p60 = loadPlatform(t.ss);
  const it60 = p60.getPriceTracking('dsanchez@equitel.com.co').items.find((i) => i.requestId === 'SOL-60');
  eq('el comparador usa la búsqueda con el equipaje de la tarifa', [it60.fare.match, it60.fare.searchedBags, it60.atPurchase.bags], [true, 1, 1]);
  const d60 = p60.getPriceTrackingDetail('dsanchez@equitel.com.co', 'SOL-60');
  eq('el detalle trae también la del otro equipaje', [d60.searches.COMPRA.bags, d60.otherLevel.COMPRA && d60.otherLevel.COMPRA.bags, d60.otherLevel.COTIZACION], [1, 0, null]);
  t = loadTracker({ props: { INICIO_ESTUDIO: today, DOS_NIVELES: 'no' }, rows: [HF, conTarifa('SOL-62', 'TIPO 1', '', { STATUS: 'APROBADO', 'FECHA VUELTA': '' })] });
  t.ctx.rastrearPrecios();
  eq('con DOS_NIVELES = no, solo el equipaje de la tarifa', rowsOf(t.ss.sheets['COMPARATIVO PRECIOS']).map((r) => r['MALETA DE MANO']), [0]);

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
  eq('SOL-1: más barato en Google (ida + regreso), diferencia y misma aerolínea', [i1.quoted, i1.market, i1.difference, i1.sameAirline, i1.marketMoment, i1.channel], [400000, 778400, -378400, 911800, 'COMPRA', 'Aviatur']);
  eq('SOL-1: horas pedidas y tramos en la lista, sin la lista de vuelos (va en el detalle)', [i1.departureTime, i1.returnTime, i1.atPurchase.legs.map((l) => l.leg + ' ' + l.near.airline + ' ' + l.near.departs + ' ' + l.reference), i1.atPurchase.legs[0].options],
    ['07:00', '06:00', ['IDA Wingo 05:40 389200', 'REGRESO Wingo 05:40 389200'], undefined]);
  const i12 = d.items.find((i) => i.requestId === 'SOL-12');
  eq('SOL-12 sin hora pedida: referencia del día', [i12.market, i12.atPurchase.referenceIsNear], [351700, false]);
  const i8 = d.items.find((i) => i.requestId === 'SOL-8');
  eq('SOL-8 sin aeropuerto: sin mercado', [i8.market, i8.atPurchase.result], [null, 'SIN_AEROPUERTO']);
  const ap = d.summary.atPurchase;
  // COMPRA OK: SOL-1 (400000 vs 389200 + 389200 por tramos), SOL-12 (350000 vs 351700 del día, sin hora),
  // SOL-9 (600000 vs 389200), SOL-6 (432888 vs 351700: nada sale entre 08:40 y 12:40, referencia del día).
  eq('resumen al comprar', [ap.n, ap.quoted, ap.market, ap.difference, ap.possibleSavings], [4, 1782888, 1871000, -88112, 291988]);
  const i6 = d.items.find((i) => i.requestId === 'SOL-6');
  eq('SOL-6: sin vuelos cerca de las 10:40, referencia del día; misma aerolínea del día', [i6.market, i6.atPurchase.referenceIsNear, i6.sameAirline], [351700, false, 389200]);
  const i9 = d.items.find((i) => i.requestId === 'SOL-9');
  eq('lo facturado: SOL-6 sin hotel se compara con Google; SOL-9 con hotel no', [i6.invoiced, i6.invoiceCount, i6.invoicedIncludesHotel, i6.invoicedVsGoogle, i9.invoiced, i9.invoicedIncludesHotel, i9.invoicedVsGoogle, i1.invoiced],
    [410000, 1, false, 58300, 900000, true, null, null]);
  eq('resumen de lo facturado frente a Google', [d.summary.invoiced.n, d.summary.invoiced.quoted, d.summary.invoiced.market, d.summary.invoiced.difference], [1, 410000, 351700, 58300]);
  eq('resumen al cotizar (SOL-2: 800000 vs ida 06:30 389200 + regreso del día 351700)', [d.summary.atQuote.n, d.summary.atQuote.quoted, d.summary.atQuote.market], [1, 800000, 740900]);
  eq('por canal', d.summary.byChannel.map((c) => c.channel + ':' + c.requests + ':' + c.n), ['Aviatur:3:3', 'Directo:1:1', 'Sin registrar:2:1']);
  eq('estado del rastreo para el dashboard', [d.meta.installed, d.meta.state['ESTADO'], d.meta.searches, d.meta.queries], [true, 'ACTIVO', 6, 7]);

  // Detalle de un viaje (#A86)
  t.ss.sheets['USUARIOS'] = makeSheet('USUARIOS', [['#', 'NOMBRE', 'CORREO'], ['1', 'Laura de Prueba', 'compras.equitel@equitel.com.co']]);
  const det = (email, id) => p.dispatch('getPriceTrackingDetail', { userEmail: email, sessionToken: 'x', requestId: id });
  eq('detalle: Laura no lo ve', det('compras.equitel@equitel.com.co', 'SOL-1').error, 'El comparador de precios está restringido a Yurani Prieto, Diego Caballero y David Sánchez.');
  const dd = det('dsanchez@equitel.com.co', 'SOL-1');
  eq('detalle: lo que registró el área de viajes y lo que pidió el viajero', dd.success && [dd.data.request.quoted, dd.data.request.airline, dd.data.request.channel, dd.data.request.passengers,
    dd.data.request.departure, dd.data.request.departureTime, dd.data.request.returnDate, dd.data.request.returnTime, dd.data.request.costConfirmedBy],
    [400000, 'LATAM', 'Aviatur', 1, plus(14), '07:00', plus(16), '06:00', { email: 'compras.equitel@equitel.com.co', name: 'Laura de Prueba' }]);
  const dl = dd.data.searches.COMPRA.legs;
  eq('detalle: cada tramo con todos sus vuelos', [dd.data.searchCount, dd.data.searches.COTIZACION, dl.map((l) => l.leg + ':' + l.options.length), dl[1].options[1]],
    [{ COTIZACION: 0, COMPRA: 1 }, null, ['IDA:6', 'REGRESO:6'], { airline: 'Wingo', flights: 'P5 7120', departs: '05:40', arrives: '06:45', stops: 0, minutes: 65, price: 389200 }]);
  eq('detalle: sin datos de los pasajeros ni del solicitante', priv.some((x) => JSON.stringify(dd).includes(x)), false);
  eq('detalle: enlace de cada tramo a Google Flights', dl.map((l) => /^https:\/\/www\.google\.com\/travel\/flights\?.*PRUEBA-/.test(l.googleUrl)), [true, true]);
  eq('detalle: un enlace que no es de Google Flights no llega al dashboard', ['javascript:alert(1)', 'https://evil.example/travel/flights?x', 'https://www.google.com/travel/flights?x="><script>']
    .map((u) => p._ptLeg_({ t: 'IDA', ok: true, url: u }).googleUrl), ['', '', '']);
  const d6 = det('dsanchez@equitel.com.co', 'SOL-6').data.request;
  eq('detalle: lo facturado', [d6.invoiced, d6.invoiceCount, d6.invoicedIncludesHotel, dd.data.request.invoiced], [410000, 1, false, null]);
  eq('detalle: solicitud sin búsquedas', /no tiene búsquedas/.test(det('dsanchez@equitel.com.co', 'SOL-404').error), true);
  eq('detalle: no escribe nada', JSON.stringify(Object.values(t.ss.sheets).filter((s) => s.name !== 'USUARIOS').map((s) => s.data)) === snap, true);
  const ej = t.ctx.cpResumir(JSON.parse(JSON.stringify(EJEMPLO).replace(/"LATAM"/g, '"COPA"')), { horaIda: '07:00' });
  eq('«Copa Airlines» registrada = «COPA» en Google', [t.ctx.rpMismaAerolinea_(ej.opciones, 'Copa Airlines', '07:00').cerca.precio, t.ctx.rpMismaAerolinea_(ej.opciones, 'Varias aerolíneas', '07:00').cerca], [455900, null]);
  // SOL-2 se aprueba y el mercado sube 10 %: la referencia es la de la compra.
  t.base.data[2][1] = 'APROBADO';
  t.log.factor = 1.1;
  t.ctx.rastrearPrecios();
  const d2 = loadPlatform(t.ss).getPriceTracking('dsanchez@equitel.com.co');
  const i2 = d2.items.find((i) => i.requestId === 'SOL-2');
  eq('con los dos momentos, manda el de la compra', [i2.atQuote.reference, i2.atPurchase.reference, i2.market, i2.marketMoment, i2.difference], [740900, 814990, 814990, 'COMPRA', -14990]);
  // #A85: aerolínea del regreso distinta. Sin la columna, vacía; con ella, el dashboard la recibe.
  eq('sin aerolínea de regreso: vacía', d2.items.find((i) => i.requestId === 'SOL-1').returnAirline, '');
  t.base.data[1][H.indexOf('AEROLINEA REGRESO')] = 'Avianca';
  const i1r = loadPlatform(t.ss).getPriceTracking('dsanchez@equitel.com.co').items.find((i) => i.requestId === 'SOL-1');
  eq('SOL-1 con LATAM de ida y Avianca de regreso', [i1r.airline, i1r.returnAirline], ['LATAM', 'Avianca']);
  const sinTab = loadPlatform(makeSpreadsheet([makeSheet('Nueva Base Solicitudes', solicitudes())]));
  const vacio = sinTab.dispatch('getPriceTracking', { userEmail: 'dsanchez@equitel.com.co', sessionToken: 'x' });
  eq('sin el proyecto aparte instalado: vacío, sin error', [vacio.success, vacio.data.meta.installed, vacio.data.items.length], [true, false, 0]);

  if (failures.length) {
    console.error(`\n✗ Rastreo de precios: ${failures.length} problema(s).\n`);
    failures.forEach((f) => console.error('  · ' + f));
    process.exit(1);
  }
  console.log('Rastreo de precios: momentos de búsqueda, tramos por separado, internacional, formato anterior, solo sus pestañas, clave fuera de la hoja, cupo, reintentos, vendedores, permisos, cuentas y detalle del dashboard OK.');
}

main();
