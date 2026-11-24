#!/usr/bin/env node
/**
 * Verifica el reporte en Excel de una unidad del dashboard de costos (#A132, pedido de Yurani del 24-nov: llevarle a
 * POTENCIA, o a cualquier unidad, los viajes que suman a su presupuesto para que diga qué pagó la fábrica y qué le
 * reconocen), con una hoja SINTÉTICA en memoria:
 *
 *   1. Facturas 4 a 6: el dashboard las suma (antes solo la 1 a la 3), también con una configuración guardada de tres.
 *   2. Servidor (getCostsUnitReport):
 *      - las mismas cuentas del dashboard (_csBuildData_), con el detalle de cada viaje: ruta, fechas, pasajeros,
 *        motivo sin las notas del sistema, cada factura con su número, fecha, valor e IVA, y de dónde sale el valor;
 *      - lo pendiente de factura sale siempre, marcado; lo cargado a OT, aparte;
 *      - un líder solo recibe sus unidades y sin lo cotizado (la variación es de COSTS_VARIANCE_ALLOWED, #A78);
 *      - nunca una cédula, una fecha de nacimiento, un celular ni una tarjeta.
 *   3. Navegador (CostsDashboard.html): el .xlsx es un ZIP válido (CRC de cada archivo), con XML bien formado, las cinco
 *      hojas, los totales iguales a los del servidor, las columnas amarillas para la unidad y sus fórmulas.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

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

const H = ['ID RESPUESTA', 'CÉDULA PERSONA 1', 'NOMBRE PERSONA 1', 'CÉDULA PERSONA 2', 'NOMBRE PERSONA 2', 'EMPRESA', 'CIUDAD ORIGEN', 'CIUDAD DESTINO',
  '# ORDEN TRABAJO', 'CENTRO DE COSTOS', 'NOMBRE CENTRO DE COSTOS (AUTOMÁTICO)', 'UNIDAD DE NEGOCIO', 'SEDE', '# PERSONAS QUE VIAJAN',
  'FECHA DE COMPRA DE TIQUETE', 'STATUS', 'TIPO DE COMPRA DE TKT', 'FECHA IDA', 'FECHA VUELTA', 'No RESERVA', 'REQUIERE HOSPEDAJE',
  'FECHA DE FACTURA', '# DE FACTURA', 'FECHA FACTURA 2', 'FACTURA 2', 'FECHA FACTURA 4', 'FACTURA 4',
  'VALOR PAGADO A AEROLINEA Y/O HOTEL', 'VALOR PAGADO A AVIATUR Y/O IVA', 'TOTAL FACTURA', 'VALOR FACTURA 2', 'IVA FACTURA 2', 'TOTAL FACTURA 2',
  'VALOR FACTURA 4', 'IVA FACTURA 4', 'TOTAL FACTURA 4', 'TARJETA DE CREDITO CON LA QUE SE HIZO LA COMPRA', 'NOMBRE HOTEL', '# NOCHES (AUTOMÁTICO)',
  'CORREO ENCUESTADO', 'OBSERVACIONES', 'ID SOLICITUD PADRE', 'TIPO DE SOLICITUD', 'TEXTO_CAMBIO', 'ES INTERNACIONAL', 'VIOLACION POLITICA',
  'COSTO_FINAL_TIQUETES', 'COSTO_FINAL_HOTEL', 'MODO_SOLICITUD', 'FECHA SOLICITUD', 'FECHAS NACIMIENTO PASAJEROS (JSON)', 'CELULARES PASAJEROS (JSON)',
  'AEROLINEA', 'CANAL DE COMPRA', 'HOTEL RESERVADO', 'CANAL DE COMPRA HOTEL', 'TARIFA NOMBRE', 'VALOR COMPRA TIQUETES', 'VALOR COMPRA HOTEL',
  'CAMBIO PEDIDO (JSON)', 'PENALIDAD CAMBIO', 'REEMPLAZADA POR', 'JUSTIFICACION ANTICIPACION'];
const R = (o) => H.map((k) => (k in o ? o[k] : ''));
const d = (s) => new Date(s + 'T05:00:00Z'); // medianoche en Bogotá
const BASE = { EMPRESA: 'Cumandes', 'UNIDAD DE NEGOCIO': 'POTENCIA (GDM - P&M)', SEDE: 'MOSQUERA', 'CENTRO DE COSTOS': 2401, 'NOMBRE CENTRO DE COSTOS (AUTOMÁTICO)': 'GDM SERVICIO',
  'TIPO DE SOLICITUD': 'ORIGINAL', MODO_SOLICITUD: 'VIAJE', 'ES INTERNACIONAL': 'NO', 'VIOLACION POLITICA': 'NO',
  'TARJETA DE CREDITO CON LA QUE SE HIZO LA COMPRA': 'VISA 4321', 'FECHAS NACIMIENTO PASAJEROS (JSON)': '{"999":"1980-01-01"}', 'CELULARES PASAJEROS (JSON)': '{"999":"3001112233"}' };
const REQUESTS = [H,
  // 1. Facturado con las facturas 1, 2 y 4 (la 4 no se sumaba antes de #A132); dos pasajeros.
  R({ ...BASE, 'ID RESPUESTA': 'SOL-1', 'CÉDULA PERSONA 1': '79111222', 'NOMBRE PERSONA 1': 'Ana Ruiz', 'CÉDULA PERSONA 2': '1012345678', 'NOMBRE PERSONA 2': 'Luis Mora',
    '# PERSONAS QUE VIAJAN': 2, 'CIUDAD ORIGEN': 'BOGOTA', 'CIUDAD DESTINO': 'CALI', STATUS: 'PROCESADO', 'FECHA SOLICITUD': d('2026-09-01'),
    'FECHA DE COMPRA DE TIQUETE': d('2026-09-03'), 'FECHA IDA': d('2026-09-20'), 'FECHA VUELTA': d('2026-09-23'), 'REQUIERE HOSPEDAJE': 'Sí',
    'HOTEL RESERVADO': 'HOTEL DANN', 'CANAL DE COMPRA HOTEL': 'Aviatur', '# NOCHES (AUTOMÁTICO)': 3, AEROLINEA: 'Avianca', 'CANAL DE COMPRA': 'Aviatur',
    'TIPO DE COMPRA DE TKT': 'TIPO 2', 'TARIFA NOMBRE': 'Classic', 'No RESERVA': 'ABC123',
    'FECHA DE FACTURA': d('2026-09-25'), '# DE FACTURA': 245151689, 'VALOR PAGADO A AEROLINEA Y/O HOTEL': 900000, 'VALOR PAGADO A AVIATUR Y/O IVA': 100000, 'TOTAL FACTURA': 1000000,
    'FECHA FACTURA 2': d('2026-09-28'), 'FACTURA 2': 72073149239504, 'VALOR FACTURA 2': 400000, 'IVA FACTURA 2': 76000, 'TOTAL FACTURA 2': 476000,
    'FECHA FACTURA 4': d('2026-10-02'), 'FACTURA 4': 'NC-77', 'TOTAL FACTURA 4': 50000,
    COSTO_FINAL_TIQUETES: 1100000, COSTO_FINAL_HOTEL: 300000, 'CORREO ENCUESTADO': 'ana@equitel.com.co',
    OBSERVACIONES: 'ENTRENAMIENTO MANUELITA CALI\n[RESERVA]: Registrada sin notificación automática al usuario.\n[SISTEMA]: Se ha solicitado cambio con ID SOL-9.' }),
  // 2. Reservado sin factura con lo pagado al comprar (pendiente); fuera de política, con su justificación.
  R({ ...BASE, 'ID RESPUESTA': 'SOL-2', 'CÉDULA PERSONA 1': '79111222', 'NOMBRE PERSONA 1': 'Ana Ruiz', '# PERSONAS QUE VIAJAN': 1, 'CIUDAD ORIGEN': 'BOGOTA',
    'CIUDAD DESTINO': 'MEDELLIN', STATUS: 'RESERVADO', 'FECHA SOLICITUD': d('2026-10-01'), 'FECHA DE COMPRA DE TIQUETE': d('2026-10-02'), 'FECHA IDA': d('2026-10-05'),
    'VIOLACION POLITICA': 'SI', 'JUSTIFICACION ANTICIPACION': 'Falla en planta del cliente', COSTO_FINAL_TIQUETES: 600000, 'VALOR COMPRA TIQUETES': 580000,
    'CORREO ENCUESTADO': 'ana@equitel.com.co', OBSERVACIONES: 'Atención de emergencia' }),
  // 3. Reservado sin factura y sin lo pagado: lo cotizado (pendiente).
  R({ ...BASE, 'ID RESPUESTA': 'SOL-3', 'NOMBRE PERSONA 1': 'Pedro Gil', 'CÉDULA PERSONA 1': '80000111', '# PERSONAS QUE VIAJAN': 1, 'CIUDAD ORIGEN': 'CALI', 'CIUDAD DESTINO': 'BOGOTA',
    STATUS: 'RESERVADO', 'FECHA DE COMPRA DE TIQUETE': d('2026-10-10'), 'FECHA IDA': d('2026-10-20'), COSTO_FINAL_TIQUETES: 450000, 'CORREO ENCUESTADO': 'pedro@equitel.com.co' }),
  // 4. Cargado a una OT: no suma.
  R({ ...BASE, 'ID RESPUESTA': 'SOL-4', 'NOMBRE PERSONA 1': 'Pedro Gil', 'CÉDULA PERSONA 1': '80000111', '# ORDEN TRABAJO': 'OT-CUBTA-110256', STATUS: 'PROCESADO',
    'FECHA DE COMPRA DE TIQUETE': d('2026-09-15'), 'TOTAL FACTURA': 700000, '# DE FACTURA': 'F-700', 'CORREO ENCUESTADO': 'pedro@equitel.com.co' }),
  // 5. Cerrado sin factura: suma $0 (y se nota).
  R({ ...BASE, 'ID RESPUESTA': 'SOL-5', 'NOMBRE PERSONA 1': 'Ana Ruiz', 'CÉDULA PERSONA 1': '79111222', STATUS: 'PROCESADO', 'FECHA DE COMPRA DE TIQUETE': d('2026-10-12'),
    COSTO_FINAL_TIQUETES: 300000, 'CORREO ENCUESTADO': 'ana@equitel.com.co' }),
  // 6. Cambio de un tiquete comprado: solo el costo del cambio, con su penalidad.
  R({ ...BASE, 'ID RESPUESTA': 'SOL-6', 'NOMBRE PERSONA 1': 'Ana Ruiz', 'CÉDULA PERSONA 1': '79111222', STATUS: 'RESERVADO', 'TIPO DE SOLICITUD': 'MODIFICACION',
    'ID SOLICITUD PADRE': 'SOL-1', 'TEXTO_CAMBIO': 'Regreso un día después', 'CAMBIO PEDIDO (JSON)': '{"v":1,"comprado":true,"costoOriginal":1526000}', 'PENALIDAD CAMBIO': 120000,
    'FECHA DE COMPRA DE TIQUETE': d('2026-10-15'), COSTO_FINAL_TIQUETES: 200000, 'CORREO ENCUESTADO': 'ana@equitel.com.co' }),
  // 7. Fuera del rango (marzo) y 8. anulado: no salen.
  R({ ...BASE, 'ID RESPUESTA': 'SOL-7', 'NOMBRE PERSONA 1': 'Ana Ruiz', STATUS: 'PROCESADO', 'FECHA DE COMPRA DE TIQUETE': d('2026-03-10'), 'TOTAL FACTURA': 123456 }),
  R({ ...BASE, 'ID RESPUESTA': 'SOL-8', 'NOMBRE PERSONA 1': 'Ana Ruiz', STATUS: 'ANULADO', 'FECHA DE COMPRA DE TIQUETE': d('2026-10-01'), 'TOTAL FACTURA': 999999 }),
  // 9. Otra unidad: un líder de POTENCIA no la recibe.
  R({ ...BASE, 'ID RESPUESTA': 'SOL-9', 'UNIDAD DE NEGOCIO': 'ENERGIA', 'NOMBRE PERSONA 1': 'Secreto Otro', 'CÉDULA PERSONA 1': '55555', STATUS: 'PROCESADO',
    'FECHA DE COMPRA DE TIQUETE': d('2026-10-01'), 'TOTAL FACTURA': 400000, 'CORREO ENCUESTADO': 'otro@equitel.com.co' }),
];
const month = (v) => Array(12).fill(v);
const PPTOS = [['ID', 'Empresa', 'Unidad de Negocio', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 'Total', 'Año vigencia'],
  ['2026POT', 'CUMMINS', 'POTENCIA (GDM - P&M)'].concat(month(1000000), ['', 2026]),
  ['2026ENE', 'CUMMINS', 'ENERGIA'].concat(month(500000), ['', 2026])];

function bogotaFormat(dt, tz, f) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(dt)).map((x) => [x.type, x.value]));
  return f.replace(/yyyy|MM|dd|HH|mm|M|d/g, (t) => ({ yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour === '24' ? '00' : p.hour, mm: p.minute, M: String(+p.month), d: String(+p.day) })[t]);
}

function loadServer(savedConfig) {
  const sheets = { 'Nueva Base Solicitudes': makeSheet('Nueva Base Solicitudes', REQUESTS), 'PPTOS UNIDADES': makeSheet('PPTOS UNIDADES', PPTOS) };
  const props = savedConfig ? { COSTS_DASHBOARD_CONFIG: JSON.stringify(savedConfig) } : {};
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} }, Logger: { log() {} },
    Utilities: { formatDate: bogotaFormat },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, getProperties: () => props, setProperty() {}, deleteProperty() {}, getKeys: () => Object.keys(props) }) },
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
  ctx._policyUserNames_ = () => ({ 'ana@equitel.com.co': 'Ana Ruiz', 'pedro@equitel.com.co': 'Pedro Gil', 'yprieto@equitel.com.co': 'Yurani Prieto' });
  const ACCESS = {
    'yprieto@equitel.com.co': { canView: true, canConfig: true, email: 'yprieto@equitel.com.co', role: 'SUPERADMIN', allUnits: true, units: [], unitLabels: [] },
    'lider@equitel.com.co': { canView: true, canConfig: false, email: 'lider@equitel.com.co', role: 'VIEWER', allUnits: false, units: ['potencia (gdm - p&m)'], unitLabels: ['POTENCIA (GDM - P&M)'] },
  };
  ctx._csResolveAccess_ = (e) => ACCESS[e] || { canView: false };
  ctx._canReadCostsVariance_ = (e) => e === 'yprieto@equitel.com.co';
  return ctx;
}

function loadBrowser() {
  const html = fs.readFileSync(path.join(ROOT, 'server', 'CostsDashboard.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, value: '', checked: true, style: {}, innerHTML: '', textContent: '', addEventListener() {} });
  const ctx = {
    console, Date, Math, JSON, Number, String, Array, Object, isNaN, setTimeout, clearTimeout,
    TextEncoder, DataView, ArrayBuffer, Uint8Array,
    document: { addEventListener() {}, getElementById: el, querySelectorAll: () => [], querySelector: () => null, createElement: () => el('x' + Math.random()), body: { appendChild() {} } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, window: { addEventListener() {} },
  };
  vm.createContext(ctx);
  scripts.forEach((code) => new vm.Script(code, { filename: 'CostsDashboard.html' }).runInContext(ctx));
  return ctx;
}

/** Lee un ZIP sin comprimir (o comprimido) y revisa el CRC de cada archivo. */
function unzip(buf) {
  const files = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('sin fin de directorio');
  const n = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  let p = cdOff;
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('directorio central dañado');
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('encabezado local dañado: ' + name);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    let data = buf.slice(start, start + size);
    if (method === 8) data = zlib.inflateRawSync(data);
    if ((zlib.crc32 ? zlib.crc32(data) : crc) >>> 0 !== crc) throw new Error('CRC distinto: ' + name);
    files[name] = data.toString('utf8');
    p += 46 + nameLen + extra + comment;
  }
  return files;
}

/** XML bien formado (etiquetas que abren y cierran en orden, entidades conocidas). */
function wellFormed(xml) {
  const body = xml.replace(/^<\?xml[^>]*\?>/, '');
  const stack = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>|&(?!(?:amp|lt|gt|quot|apos|#\d+);)/g;
  let m;
  while ((m = re.exec(body))) {
    if (!m[2]) return 'entidad sin escapar en ' + m.index;
    if (m[1]) { if (stack.pop() !== m[2]) return 'cierre fuera de orden: ' + m[2]; } else if (!m[4]) stack.push(m[2]);
  }
  return stack.length ? 'sin cerrar: ' + stack.join(',') : '';
}

/** Celdas de una hoja: { A1: { v, f, s, t } } con el texto de las cadenas en línea. */
function cells(xml) {
  const out = {};
  const re = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = re.exec(xml))) {
    const inner = m[3] || '';
    const f = /<f>([\s\S]*?)<\/f>/.exec(inner), v = /<v>([\s\S]*?)<\/v>/.exec(inner), t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner), s = /s="(\d+)"/.exec(m[2]);
    const un = (x) => x.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    out[m[1]] = { v: t ? un(t[1]) : v ? Number(v[1]) : '', f: f ? un(f[1]) : '', s: s ? +s[1] : 0 };
  }
  return out;
}

const failures = [];
const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: da ${JSON.stringify(got)}, se esperaba ${JSON.stringify(want)}`); };
const ok = (name, cond) => { if (!cond) failures.push(name); };

function main() {
  // ---------------------------------------------------------------- 1. Facturas 4 a 6
  const srv = loadServer();
  const dash = srv._csBuildData_({ year: 2026, fromMonth: 4, toMonth: 12 }, null);
  const pot = dash.rows.find((b) => b.unit === 'POTENCIA (GDM - P&M)');
  const s1 = pot.requests.find((r) => r.requestId === 'SOL-1');
  eq('la factura 4 suma (1.000.000 + 476.000 + 50.000)', s1 && s1.executed, 1526000);
  eq('configuración por defecto: seis facturas', srv._csDefaultConfig_().facturas.map((f) => f.totalHeader),
    ['TOTAL FACTURA', 'TOTAL FACTURA 2', 'TOTAL FACTURA 3', 'TOTAL FACTURA 4', 'TOTAL FACTURA 5', 'TOTAL FACTURA 6']);
  const saved = JSON.parse(JSON.stringify(srv._csDefaultConfig_()));
  saved.facturas = saved.facturas.slice(0, 3);
  saved.budgetPeriodMonths = 3;
  const srvSaved = loadServer(saved);
  const cfg = srvSaved._csLoadConfig_();
  eq('una configuración guardada de tres facturas recibe la 4, la 5 y la 6 (y conserva lo demás)', [cfg.facturas.length, cfg.budgetPeriodMonths], [6, 3]);
  const potSaved = srvSaved._csBuildData_({ year: 2026, fromMonth: 4, toMonth: 12 }, null).rows.find((b) => b.unit === 'POTENCIA (GDM - P&M)');
  eq('…y el dashboard suma la factura 4 con ella', potSaved.requests.find((r) => r.requestId === 'SOL-1').executed, 1526000);

  // ---------------------------------------------------------------- 2. Servidor
  const rep = srv.getCostsUnitReport({ year: 2026, fromMonth: 4, toMonth: 12, businessUnits: ['POTENCIA (GDM - P&M)'] }, 'yprieto@equitel.com.co');
  eq('una sola unidad', rep.rows.map((b) => b.unit), ['POTENCIA (GDM - P&M)']);
  const b = rep.rows[0];
  eq('mismas cuentas que el dashboard', [b.totalExecutedReal, b.totalExecutedEstimated, b.requestCount, b.otRequestCount],
    [pot.totalExecutedReal, pot.totalExecutedEstimated, pot.requestCount, pot.otRequestCount]);
  eq('los viajes que suman y el de OT', [b.requests.map((r) => r.requestId).sort(), b.otRequests.map((r) => r.requestId)], [['SOL-1', 'SOL-2', 'SOL-3', 'SOL-5', 'SOL-6'], ['SOL-4']]);
  const det = (id) => (b.requests.concat(b.otRequests).find((r) => r.requestId === id) || {}).detail || {};
  const d1 = det('SOL-1');
  eq('SOL-1: ruta, fechas, pasajeros, hotel y compra', [d1.origin, d1.destination, d1.departDate, d1.returnDate, d1.purchaseDate, d1.requestDate, d1.passengers, d1.pax,
    d1.hotel, d1.hotelName, d1.nights, d1.airline, d1.channel, d1.fare, d1.pnr, d1.requesterName, d1.costCenter, d1.costCenterName, d1.leadDays],
    ['BOGOTA', 'CALI', '2026-09-20', '2026-09-23', '2026-09-03', '2026-09-01', ['Ana Ruiz', 'Luis Mora'], 2, true, 'HOTEL DANN', 3, 'Avianca', 'Aviatur', 'TIPO 2 (Classic)', 'ABC123',
      'Ana Ruiz', '2401', 'GDM SERVICIO', 17]);
  eq('SOL-1: el motivo sin las notas del sistema', d1.reason, 'ENTRENAMIENTO MANUELITA CALI');
  eq('SOL-1: cada factura con su número, fecha, valor e IVA', d1.invoices, [
    { n: 1, number: '245151689', date: '2026-09-25', value: 900000, tax: 100000, total: 1000000 },
    { n: 2, number: '72073149239504', date: '2026-09-28', value: 400000, tax: 76000, total: 476000 },
    { n: 4, number: 'NC-77', date: '2026-10-02', value: null, tax: null, total: 50000 }]);
  eq('SOL-1: facturado', [d1.source, d1.invoiced, d1.counted, d1.quotedTickets, d1.quotedHotel], ['FACTURADO', 1526000, 1526000, 1100000, 300000]);
  const d2 = det('SOL-2');
  eq('SOL-2: pendiente con lo pagado; fuera de política con su justificación', [d2.source, d2.counted, d2.paidTickets, d2.policyViolation, d2.leadJustification],
    ['PAGADO', 580000, 580000, true, 'Falla en planta del cliente']);
  eq('SOL-3: pendiente con lo cotizado', [det('SOL-3').source, det('SOL-3').counted], ['COTIZADO', 450000]);
  eq('SOL-5: cerrado sin factura, $0', [det('SOL-5').source, det('SOL-5').counted], ['SIN_VALOR', 0]);
  const d6 = det('SOL-6');
  eq('SOL-6: cambio de un tiquete comprado, con su penalidad', [d6.kind, d6.parentId, d6.changeText, d6.penalty, d6.counted], ['CAMBIO_COMPRADO', 'SOL-1', 'Regreso un día después', 120000, 200000]);
  eq('SOL-4: cargado a OT, con su detalle', [b.otRequests[0].workOrder, det('SOL-4').invoices.map((i) => i.number), det('SOL-4').counted], ['OT-CUBTA-110256', ['F-700'], 700000]);
  eq('quien lo generó y que ve lo cotizado', [rep.meta.report.generatedBy, rep.meta.report.showQuoted, rep.meta.report.invoiceCount], ['Yurani Prieto', true, 6]);
  const json = JSON.stringify(rep);
  ok('sin cédulas, fechas de nacimiento, celulares ni tarjetas', !/79111222|1012345678|80000111|55555|1980-01-01|3001112233|VISA 4321/.test(json));
  ok('sin la otra unidad', !/Secreto Otro|SOL-9|SOL-7|SOL-8/.test(json));

  const all = srv.getCostsUnitReport({ year: 2026, fromMonth: 4, toMonth: 12 }, 'yprieto@equitel.com.co');
  eq('todas las unidades', all.rows.map((x) => x.unit).sort(), ['ENERGIA', 'POTENCIA (GDM - P&M)']);
  const lid = srv.getCostsUnitReport({ year: 2026, fromMonth: 4, toMonth: 12 }, 'lider@equitel.com.co');
  eq('un líder: solo sus unidades', lid.rows.map((x) => x.unit), ['POTENCIA (GDM - P&M)']);
  const ld1 = lid.rows[0].requests.find((r) => r.requestId === 'SOL-1').detail;
  ok('un líder: sin lo cotizado ni lo pagado (#A78)', !('quotedTickets' in ld1) && !('paidTickets' in ld1) && lid.meta.report.showQuoted === false);
  eq('un líder que pide otra unidad no recibe nada', srv.getCostsUnitReport({ year: 2026, businessUnits: ['ENERGIA'] }, 'lider@equitel.com.co').rows.length, 0);
  let denied = '';
  try { srv.getCostsUnitReport({ year: 2026 }, 'nadie@equitel.com.co'); } catch (e) { denied = e.message; }
  ok('sin acceso: error', /acceso|autoriza/i.test(denied));

  // ---------------------------------------------------------------- 3. Navegador: el .xlsx
  const br = loadBrowser();
  const ctx = { year: 2026, fromMonth: 4, toMonth: 12, unitLabel: 'POTENCIA (GDM - P&M)', multiUnit: false, companyLabel: 'todas',
    rangeText: 'abril a diciembre de 2026', rangeShort: 'abr a dic 2026', generatedBy: 'Yurani Prieto', generatedText: '24/11/2026 10:00' };
  const out = br.rpBuildWorkbook(JSON.parse(JSON.stringify(rep)), ctx);
  eq('nombre del archivo', out.fileName, 'Viajes que suman - POTENCIA (GDM - P&M) - abr a dic 2026.xlsx');
  let files;
  try { files = unzip(Buffer.from(out.bytes)); } catch (e) { failures.push('ZIP: ' + e.message); files = {}; }
  eq('archivos del libro', Object.keys(files).sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml',
    'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml', 'xl/worksheets/sheet4.xml', 'xl/worksheets/sheet5.xml']);
  Object.keys(files).forEach((k) => { const w = wellFormed(files[k]); if (w) failures.push('XML mal formado en ' + k + ': ' + w); });
  const names = [...(files['xl/workbook.xml'] || '').matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
  eq('hojas', names, ['Resumen', 'Viajes que suman', 'Facturas', 'Por pasajero', 'Cargados a OT (no suman)']);
  const all5 = Object.values(files).join('');
  ok('el archivo tampoco lleva cédulas', !/79111222|1012345678|80000111|VISA 4321/.test(all5));

  const v = cells(files['xl/worksheets/sheet2.xml'] || '');
  const head = {};
  Object.keys(v).filter((k) => /^[A-Z]+1$/.test(k)).forEach((k) => { head[v[k].v] = k.replace(/1$/, ''); });
  const col = (h) => head[h];
  ['Solicitud', 'Pasajeros', 'Origen', 'Destino', 'Fecha de ida', 'Motivo del viaje (lo que escribió el solicitante)', 'Cotizado: tiquetes', 'Total facturado',
    'Estado del valor', 'Valor que suma al presupuesto', '¿A qué OT corresponde? (si aplica)', 'Valor que pagó la fábrica',
    'Valor reconocido con descuento o nota crédito', 'Justificación de la unidad', 'Valor neto para la unidad'].forEach((h) => ok('columna «' + h + '»', !!col(h)));
  const rowOf = (id) => { const k = Object.keys(v).find((c) => /^A\d+$/.test(c) && v[c].v === id); return k ? +k.slice(1) : 0; };
  const r1 = rowOf('SOL-1'), r2 = rowOf('SOL-2');
  ok('SOL-1 y SOL-2 en la hoja, por fecha de compra', r1 === 2 && r2 > r1);
  eq('SOL-1: pasajeros, valor y estado', [v[col('Pasajeros') + r1].v, v[col('Valor que suma al presupuesto') + r1].v, v[col('Estado del valor') + r1].v],
    ['Ana Ruiz, Luis Mora', 1526000, 'Facturado']);
  eq('SOL-1: la fecha de ida es una fecha de Excel', [v[col('Fecha de ida') + r1].v, v[col('Fecha de ida') + r1].s], [46285, br.XS.date]);
  eq('SOL-2: pendiente de factura', v[col('Estado del valor') + r2].v, 'Pendiente de factura (valor pagado al comprar)');
  const net = v[col('Valor neto para la unidad') + r1];
  eq('valor neto: fórmula sobre las columnas amarillas', net.f, col('Valor que suma al presupuesto') + r1 + '-' + col('Valor que pagó la fábrica') + r1 + '-' + col('Valor reconocido con descuento o nota crédito') + r1);
  eq('columnas amarillas vacías y con su estilo', [v[col('Valor que pagó la fábrica') + r1].v, v[col('Valor que pagó la fábrica') + r1].s, v[col('Valor que pagó la fábrica') + '1'].s],
    ['', br.XS.inMoney, br.XS.headIn]);
  const last = 2 + b.requests.length;
  const tot = v[col('Valor que suma al presupuesto') + last];
  eq('fila de total: SUBTOTAL y el mismo total del dashboard', [tot.f, tot.v], ['SUBTOTAL(9,' + col('Valor que suma al presupuesto') + '2:' + col('Valor que suma al presupuesto') + (last - 1) + ')',
    pot.totalExecutedReal + pot.totalExecutedEstimated]);

  const sum = cells(files['xl/worksheets/sheet1.xml'] || '');
  const sumRow = (label) => { const k = Object.keys(sum).find((c) => /^A\d+$/.test(c) && sum[c].v === label); return k ? +k.slice(1) : 0; };
  const rt = sumRow('Total que suma al presupuesto');
  eq('resumen: total y viajes', [sum['B' + rt] && sum['B' + rt].v, sum['C' + rt] && sum['C' + rt].v], [pot.totalExecutedReal + pot.totalExecutedEstimated, 5]);
  eq('resumen: facturado y pendientes', [sum['B' + sumRow('Facturado')].v, sum['B' + sumRow('Pendiente de factura: valor pagado al comprar')].v,
    sum['B' + sumRow('Pendiente de factura: valor cotizado')].v], [1526000, 580000, 650000]);
  eq('resumen: cargado a OT', [sum['B' + sumRow('Cargado a una OT (no suma)')].v, sum['C' + sumRow('Cargado a una OT (no suma)')].v], [700000, 1]);
  ok('resumen: lo que escribe la unidad son fórmulas sobre la hoja de viajes', /^SUM\('Viajes que suman'!/.test((sum['B' + sumRow('Pagado por la fábrica')] || {}).f) &&
    /^SUMIF\('Viajes que suman'!/.test((sum['B' + sumRow('Viajes que la unidad asigna a una OT')] || {}).f));
  ok('resumen: presupuesto y %', sum['B' + sumRow('Presupuesto de la unidad')].v === 9000000 && Math.abs(sum['B' + sumRow('% del presupuesto usado')].v - 2756000 / 9000000) < 1e-9);

  const inv = cells(files['xl/worksheets/sheet3.xml'] || '');
  const invIds = Object.keys(inv).filter((k) => /^A\d+$/.test(k) && /^SOL-/.test(inv[k].v)).map((k) => inv[k].v);
  eq('facturas una por una (las de OT al final)', invIds, ['SOL-1', 'SOL-1', 'SOL-1', 'SOL-4']);
  eq('factura 4 de SOL-1', ['C4', 'D4', 'H4'].map((k) => inv[k].v), ['Factura 4', 'NC-77', 50000]);
  const pax = cells(files['xl/worksheets/sheet4.xml'] || '');
  eq('por pasajero: Ana primero, con su parte', [pax.A2.v, pax.B2.v, pax.C2.v], ['Ana Ruiz', 4, 763000 + 580000 + 0 + 200000]);
  const otc = cells(files['xl/worksheets/sheet5.xml'] || '');
  eq('cargados a OT: con su número', [otc.A2.v, otc.B2.v], ['SOL-4', 'OT-CUBTA-110256']);

  // Un líder: sin las columnas de lo cotizado.
  const outL = br.rpBuildWorkbook(JSON.parse(JSON.stringify(lid)), ctx);
  const vl = cells(unzip(Buffer.from(outL.bytes))['xl/worksheets/sheet2.xml']);
  ok('un líder: el Excel no trae lo cotizado', !Object.values(vl).some((c) => /^Cotizado|^Pagado al comprar/.test(String(c.v))));
  // Todas las unidades: columna de unidad y tabla por unidad.
  const outA = br.rpBuildWorkbook(JSON.parse(JSON.stringify(all)), { ...ctx, unitLabel: 'Todas las unidades', multiUnit: true });
  const fa = unzip(Buffer.from(outA.bytes));
  ok('todas las unidades: columna «Unidad de negocio» y «Por unidad de negocio»', /Unidad de negocio/.test(fa['xl/worksheets/sheet2.xml']) && /Por unidad de negocio/.test(fa['xl/worksheets/sheet1.xml']));
  // Sin viajes: igual sale un libro válido.
  const empty = JSON.parse(JSON.stringify(rep)); empty.rows = [];
  try { const fe = unzip(Buffer.from(br.rpBuildWorkbook(empty, ctx).bytes)); Object.keys(fe).forEach((k) => { const w = wellFormed(fe[k]); if (w) failures.push('vacío, ' + k + ': ' + w); }); }
  catch (e) { failures.push('sin viajes: ' + e.message); }
  ok('xlsxEsc quita caracteres de control y escapa', br.xlsxEsc('a\u0001<b>&"') === 'a&lt;b&gt;&amp;&quot;');

  if (failures.length) {
    console.error('✗ Reporte en Excel de una unidad (#A132): ' + failures.length + ' falla(s):');
    failures.forEach((x) => console.error('  - ' + x));
    process.exit(1);
  }
  console.log('Reporte en Excel de una unidad (#A132): facturas 4 a 6 en el dashboard, mismas cuentas con el detalle de cada viaje, permisos (líder sin lo cotizado), sin datos personales, y un .xlsx válido con sus cinco hojas, totales y fórmulas. OK');
}

main();
