#!/usr/bin/env node
/**
 * Verifica los centros de costos de otra unidad (#A133; pedido de Yurani, decisiones de David del 24-nov-2026):
 * corre `server/Code.gs` completo con una hoja SINTÉTICA en memoria (sin datos reales y sin enviar correos: el
 * envío queda registrado en memoria) y comprueba:
 *   - la tabla de responsables de MISC (menú 18): se crea con los líderes del dashboard de costos (no «TODAS» ni
 *     «COMPLETO»), no se duplica y la revisión dice qué unidades no reciben viajes de otras;
 *   - al crear: la unidad del viajero sale de USUARIOS (no de lo que mande el navegador); sin unidad registrada,
 *     la que eligió; la unidad que paga es la dueña del centro de costos; un centro de costos de otra unidad
 *     marca la solicitud y pide el voto de su responsable (nunca el del mismo viajero o solicitante); una unidad
 *     sin responsable no recibe viajes de otras (un cambio de un viaje ya creado sí pasa);
 *   - el voto: a quién se le pide, el correo, el enlace (solo los responsables de la solicitud), aprobada,
 *     denegada, cubierta por el voto de la misma persona en otro rol, saltar la etapa, recordatorios, la línea de
 *     tiempo y «Mis aprobaciones»;
 *   - el menú 17 propone la unidad de cada persona por su historial o su código de RR. HH., sin pisar nada;
 *   - el formulario (utils/otherUnit.ts) decide igual que el servidor qué unidad paga y si es otra unidad.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server', 'Code.gs'), 'utf8');
const TODAY = '2026-11-24'; // martes
const POT = 'POTENCIA (GDM - P&M)';
const EPV = 'ENERGIA POSTVENTA';
const EP = 'ENERGIA PROYECTOS';

function headersFromSource() {
  const m = /const HEADERS_REQUESTS = (\[[\s\S]*?\]);/.exec(SRC);
  if (!m) throw new Error('No se encontró HEADERS_REQUESTS en Code.gs');
  // eslint-disable-next-line no-new-func
  const list = new Function('return ' + m[1])();
  ['EVENTOS_JSON', 'COMENTARIOS APROBADORES (JSON)', 'APROBADO PRESUPUESTO', 'REQUIERE APROB PPTO'].forEach((h) => { if (!list.includes(h)) list.push(h); });
  return list;
}

function makeSheet(name, table) {
  const width = () => table.reduce((m, r) => Math.max(m, r.length), 0);
  return {
    getName: () => name, getLastRow: () => table.length, getLastColumn: () => width(),
    getMaxColumns: () => width(), getMaxRows: () => table.length,
    insertColumnsAfter() {}, setColumnWidth() {}, insertRowAfter() { table.push(new Array(width()).fill('')); },
    appendRow(vals) { table.push(vals.slice()); },
    setFrozenRows() {}, hideSheet() {},
    getDataRange() { return this.getRange(1, 1, table.length, width()); },
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      const grow = () => {
        while (table.length < r - 1 + nr) table.push(new Array(width()).fill(''));
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

const USERS_HEAD = ['Cedula', 'Nombre', 'Correo', 'Empresa', 'Sede', 'Centro de Costo', 'Cedulas Aprobadores', 'Correos Aprobadores (auto)',
  'Nombres Aprobadores (auto)', 'PIN', 'Pasaporte Fecha', 'Pasaporte File ID', 'Fecha Nacimiento', 'Celular', 'Unidad de negocio'];
const user = (ced, name, email, code, unit, approver) => [ced, name, email, 'Cumandes', 'BOGOTA', code, '', approver || 'jefe@p.co', 'JEFE UNO', '1234', '', '', '', '', unit];

function load() {
  const H = headersFromSource();
  const req = [H.slice()];
  const users = [USERS_HEAD,
    user('100', 'PEREZ ANA', 'ana@p.co', 20402, EPV),
    user('110', 'ROJAS LUIS', 'luis@p.co', 20101, ''),
    user('115', 'NUEVO SIN HISTORIAL', 'nuevo@p.co', 20101, ''),
    user('116', 'SIN DATOS', 'sindatos@p.co', 999, ''),
    user('117', 'UNIDAD MAL ESCRITA', 'mal@p.co', 20101, 'POTENCIAS'),
    user('120', 'GARCIA SIMON', 'sigarcia@p.co', 20101, POT),
    user('130', 'OCHOA ANA ELVIRA', 'aochoa@p.co', 20401, EP),
    user('150', 'TORRES MARIA', 'maria@p.co', 125, 'ADM AUDITORIA'),
    user('160', 'JEFE UNO', 'jefe@p.co', 101, ''),
    user('170', 'JEFE DE SIMON', 'jefesimon@p.co', 101, ''),
    user('180', 'ROJAS RESPONSABLE', 'resp2@p.co', 20402, EPV),
    user('400', 'PRIETO YURANI', 'yprieto@equitel.com.co', 102, 'ADM INVENTARIOS Y BODEGA'),
    // Menú 17, por el aprobador: el equipo de JEFE DOS es de ENERGIA POSTVENTA; JEFE TRES (ENERGIA PROYECTOS) no tiene equipo con
    // unidad; EQUIPO C1 lo aprueba EQUIPO B1, que recibe la unidad en la primera pasada (cascada).
    user('500', 'JEFE DOS', 'jefe2@p.co', 999, ''),
    user('501', 'EQUIPO A1', 'ea1@p.co', 999, EPV, 'jefe2@p.co'),
    user('502', 'EQUIPO A2', 'ea2@p.co', 999, EPV, 'jefe2@p.co'),
    user('503', 'EQUIPO A3', 'ea3@p.co', 999, '', 'jefe2@p.co'),
    user('510', 'JEFE TRES', 'jefe3@p.co', 999, EP),
    user('511', 'EQUIPO B1', 'eb1@p.co', 999, '', 'jefe3@p.co'),
    user('512', 'EQUIPO C1', 'ec1@p.co', 999, '', 'eb1@p.co')];
  const cds = [['CENTRO COSTOS', 'Descripcion del CC', 'UNIDAD DE NEGOCIO'],
    [100, 'SERVICIO-GDM-GRAL', 'NA'], [101, 'SERVICIO-GDM', POT], [201, 'PARTES Y MOTORES', POT], [401, 'PROYECTOS ENERGIA-EQUIPOS', EP],
    [503, 'POSTVENTA ENERGIA-MTTO CONV', EPV], [1901, 'IG-COMAP', 'INGENERGIA'], [1901, 'IG-COMAP', 'INGENERGIA- COMAP'],
    [9003, 'ADM INVENTARIOS Y BODEGA', 'ADM INVENTARIOS Y BODEGA'], [9013, 'ADM AUDITORIA', 'ADM AUDITORIA'], [9015, 'ADM GENERAL', 'ADM GENERAL'], ['VARIOS', '-', '-']];
  // MISC: tarjetas (A:B), sedes (D) y la tabla de accesos al dashboard (H:I), como en producción.
  const misc = [['TARJETAS', '', '', '', '', '', '', 'DASHBOARD COSTOS · CORREO', 'DASHBOARD COSTOS · UNIDAD DE NEGOCIO'],
    ['VISA', '1234', '', 'SEDES', '', '', '', 'sigarcia@p.co', POT],
    ['', '', '', 'BOGOTA', '', '', '', 'misaza@p.co', 'TODAS'],
    ['', '', '', '', '', '', '', 'aochoa@p.co', EP],
    ['', '', '', '', '', '', '', 'aolave@p.co', EP],
    ['', '', '', '', '', '', '', 'jcpineda@p.co', 'COMPLETO'],
    ['', '', '', '', '', '', '', 'yroncancio@p.co', EPV]];
  const sheets = {
    'Nueva Base Solicitudes': makeSheet('Nueva Base Solicitudes', req), USUARIOS: makeSheet('USUARIOS', users),
    'CDS vs UDEN': makeSheet('CDS vs UDEN', cds), MISC: makeSheet('MISC', misc),
  };
  const props = {};
  const log = { mails: [], alerts: [] };
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
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), getProperties: () => ({ ...props }), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; }, getKeys: () => Object.keys(props) }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {}, getAll: () => ({}), putAll() {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true }) },
    Session: { getActiveUser: () => ({ getEmail: () => 'admin@p.co' }), getEffectiveUser: () => ({ getEmail: () => 'admin@p.co' }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => { const t = []; sheets[n] = makeSheet(n, t); return sheets[n]; },
      }),
      flush() {},
      getUi: () => ({ alert: (...a) => { log.alerts.push(a.join(' | ')); return 'YES'; }, ButtonSet: { OK: 'OK', YES_NO: 'YES_NO' }, Button: { YES: 'YES' } }),
    },
    HtmlService: { createHtmlOutput: (h) => { const o = { html: h, setTitle: () => o, setXFrameOptionsMode: () => o, addMetaTag: () => o, getContent: () => h }; return o; }, XFrameOptionsMode: { DEFAULT: 'DEFAULT' } },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => { const b = { timeBased: () => b, everyHours: () => b, create() {} }; return b; } },
    MailApp: { sendEmail() { throw new Error('no debe enviar'); } }, GmailApp: { sendEmail() { throw new Error('no debe enviar'); }, getAliases: () => [] },
  };
  const stub = () => new Proxy(function () { return stub(); }, { get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : stub()) });
  for (const g of ['DriveApp', 'ContentService', 'UrlFetchApp', 'DocumentApp']) ctx[g] = stub();
  const NOW = Date.parse(TODAY + 'T15:00:00Z'); // 10 a. m. de Bogotá
  ctx.Date = class extends Date {
    constructor(...a) { super(...(a.length ? a : [NOW])); }
    static now() { return NOW; }
  };
  vm.createContext(ctx);
  new vm.Script(SRC, { filename: 'Code.gs' }).runInContext(ctx);
  for (const fn of ['_ouPlan_', '_ouEffective_', 'prepararTablaResponsablesUnidad', '_ouProposeUserUnits_', 'getMyApprovals']) {
    if (typeof ctx[fn] !== 'function') throw new Error('No se encontró ' + fn + '() en server/Code.gs');
  }
  ctx._todayBogotaIso_ = () => TODAY;
  ctx.isWorkingHour = () => true;
  ctx._isCreateRequestRateLimited_ = () => false;
  ctx.isUserAnalyst = (e) => ['admin@p.co', 'yprieto@equitel.com.co', 'dsanchez@equitel.com.co'].includes(String(e || '').toLowerCase());
  ctx.isSuperAdmin = () => false;
  ctx.validateUserSession_ = () => true;
  ctx.validateUserEmail_ = () => true;
  // El aprobador de área sale de USUARIOS (columna H) por la cédula del primer pasajero.
  ctx._resolveApproverForFirstPassenger_ = (ced) => {
    const u = users.find((r) => String(r[0]) === String(ced));
    return u ? { email: u[7], name: u[8] } : null;
  };
  ctx._assertPassportsForInternational_ = () => {};
  ctx._dashInvalidate_ = () => {};
  ctx.sendEmailRich = (to, subject, html, cc) => { log.mails.push({ to, subject, html, cc: cc === undefined ? '(admin)' : cc }); };
  ctx._sendMail_ = (o) => { log.mails.push({ to: o.to, subject: o.subject, html: o.htmlBody || o.body || '', cc: '' }); };
  return { ctx, req, users, misc, log };
}

function loadClient() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
  const out = esbuild.buildSync({ entryPoints: [path.join(ROOT, 'utils', 'otherUnit.ts')], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'error' });
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

function main() {
  let env;
  try { env = load(); } catch (e) { console.error('✗ No se pudo cargar server/Code.gs para los centros de costos de otra unidad:\n  ' + e.stack); process.exit(1); }
  const { ctx, req, users, misc, log } = env;
  const failures = [];
  const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: da ${JSON.stringify(got)}, se esperaba ${JSON.stringify(want)}`); };
  const ok = (name, cond) => { if (!cond) failures.push(name); };
  const reset = () => ctx._resetPerExecutionCaches_();
  const col = (h) => req[0].indexOf(h);
  const rowOf = (id) => req.find((r) => r[col('ID RESPUESTA')] === id);
  const cell = (id, h) => { const r = rowOf(id); const i = col(h); return r && i >= 0 ? (r[i] ?? '') : undefined; };
  const setCell = (id, h, v) => { rowOf(id)[col(h)] = v; reset(); };
  const mapped = (id) => { reset(); return ctx.mapRowToRequest(rowOf(id)); };
  const mailsTo = (to) => log.mails.filter((m) => String(m.to).toLowerCase() === to);
  const pax = (ced, name, email) => [{ name, idNumber: ced, email }];
  const base = (over) => Object.assign({
    company: 'Cumandes', origin: 'BOGOTA, COLOMBIA', destination: 'MEDELLIN, COLOMBIA', departureDate: '20-01-2027', returnDate: '22-01-2027',
    passengers: pax('100', 'PEREZ ANA', 'ana@p.co'), requesterEmail: 'ana@p.co', costCenter: '503', businessUnit: EPV, travelerUnit: EPV,
    site: 'BOGOTA', requestMode: 'FLIGHT', isInternational: false, policyViolation: false, comments: 'Visita técnica', requiresHotel: false,
  }, over || {});
  const strip = (o) => { const c = Object.assign({}, o); delete c.travelerUnit; return c; }; // un formulario anterior
  const create = (data, userEmail) => { reset(); return ctx.dispatch('createRequest', { userEmail: userEmail || data.requesterEmail || 'ana@p.co', sessionToken: 't', data: Object.assign({}, data), emailHtml: '<p>{{REQUEST_ID}}{{ACTION_BUTTONS}}</p>' }); };
  const link = (id, decision, role, actor) => {
    const sg = ctx._newApprovalLinkSig_('approve', id, decision, role, actor);
    reset();
    return ctx.processApprovalFromEmail({ parameter: { id, decision, role, actor, t: sg.t, sig: sg.sig, confirm: 'true', reason: decision === 'denied' ? 'No corresponde a la unidad' : '' } }).html;
  };
  const toApproval = (id) => { setCell(id, 'STATUS', 'PENDIENTE_APROBACION'); setCell(id, 'COSTO COTIZADO PARA VIAJE', 600000); };
  const ask = (id) => { reset(); ctx.sendApprovalRequestEmail(ctx.mapRowToRequest(rowOf(id))); };

  // ---------------------------------------------------------------------------
  // 1. Responsables de cada unidad (menú 18)
  reset();
  const prep = ctx.prepararTablaResponsablesUnidad();
  eq('tabla: se crea con los líderes de una unidad (no TODAS ni COMPLETO)', [prep.created, prep.seeded], [true, 4]);
  const tableRows = misc.slice(1).map((r) => [r[prep.loc.unitCol - 1], r[prep.loc.emailCol - 1]]).filter((r) => r[0] || r[1]);
  eq('tabla: filas sembradas', tableRows, [[POT, 'sigarcia@p.co'], [EP, 'aochoa@p.co'], [EP, 'aolave@p.co'], [EPV, 'yroncancio@p.co']]);
  eq('tabla: encabezados en la fila 1', [misc[0][prep.loc.unitCol - 1], misc[0][prep.loc.emailCol - 1]], ['RESPONSABLE UNIDAD · UNIDAD DE NEGOCIO', 'RESPONSABLE UNIDAD · CORREO']);
  reset();
  eq('tabla: correr el menú otra vez no la duplica', ctx.prepararTablaResponsablesUnidad().created, false);
  // Un segundo responsable de POTENCIA y una fila mal escrita.
  misc.push(new Array(misc[0].length).fill(''));
  misc[misc.length - 1][prep.loc.unitCol - 1] = 'potencia  (gdm - p&m)';
  misc[misc.length - 1][prep.loc.emailCol - 1] = 'resp2@p.co';
  misc.push(new Array(misc[0].length).fill(''));
  misc[misc.length - 1][prep.loc.unitCol - 1] = 'UNIDAD QUE NO EXISTE';
  misc[misc.length - 1][prep.loc.emailCol - 1] = 'otro@p.co';
  reset();
  const rev = ctx.revisarResponsablesUnidad();
  ok('revisión: POTENCIA con sus dos responsables', rev.units.includes(POT + ': GARCIA SIMON o ROJAS RESPONSABLE'));
  ok('revisión: las unidades sin responsable no reciben viajes de otras', ['ADM GENERAL', 'ADM AUDITORIA', 'INGENERGIA'].every((u) => rev.without.includes(u)));
  ok('revisión: avisa la unidad que no existe y el correo que no está en USUARIOS',
    rev.warnings.some((w) => /UNIDAD QUE NO EXISTE/.test(w)) && rev.warnings.some((w) => /yroncancio@p\.co no está en USUARIOS/.test(w)));
  reset();
  const info = ctx._ouPublicInfo_();
  eq('formulario: unidades que reciben viajes de otras, con nombres (el correo solo si no está en USUARIOS)', info.units.map((u) => u.unit + ' = ' + u.approvers),
    [EPV + ' = yroncancio@p.co', EP + ' = OCHOA ANA ELVIRA o aolave@p.co', POT + ' = GARCIA SIMON o ROJAS RESPONSABLE']);
  reset();
  const boot = ctx.dispatch('getFormBootstrap', { userEmail: 'ana@p.co', sessionToken: 't' });
  ok('getFormBootstrap trae la clave otherUnitCharges', boot.success && boot.data.otherUnitCharges && boot.data.otherUnitCharges.units.length === 3);
  reset();
  const dir = ctx._getIntegrantesDataFromUsuarios_();
  eq('directorio: cada persona con su unidad', [dir.find((i) => i.email === 'ana@p.co').businessUnit, dir.find((i) => i.email === 'luis@p.co').businessUnit], [EPV, '']);

  // ---------------------------------------------------------------------------
  // 2. Al crear
  log.mails.length = 0;
  let r = create(base({ costCenter: '201', businessUnit: POT }));
  ok('Ana (ENERGIA POSTVENTA) carga a 201 de POTENCIA: se crea', r.success && /^SOL-/.test(r.data));
  const X1 = r.data;
  eq('X1: paga POTENCIA, el viajero es de ENERGIA POSTVENTA, votan los dos responsables',
    [cell(X1, 'UNIDAD DE NEGOCIO'), cell(X1, 'UNIDAD DEL VIAJERO'), cell(X1, 'APROBADOR OTRA UNIDAD'), cell(X1, 'NOMBRE CENTRO DE COSTOS (AUTOMÁTICO)')],
    [POT, EPV, 'sigarcia@p.co,resp2@p.co', 'PARTES Y MOTORES']);
  ok('X1: queda la nota en OBSERVACIONES', /Visita técnica\n\[OTRA UNIDAD\]: el viajero es de ENERGIA POSTVENTA y el viaje se carga al centro de costos 201 \(PARTES Y MOTORES\), de POTENCIA \(GDM - P&M\)\. Lo aprueba también GARCIA SIMON o ROJAS RESPONSABLE\./.test(cell(X1, 'OBSERVACIONES')));
  const m1 = mapped(X1);
  eq('X1: lo que ve la app', [m1.otherUnitCharge, m1.travelerUnit, m1.requiresOtherUnitApproval, m1.effectiveApprovalOtherUnit, m1.otherUnitApproverName],
    [true, EPV, true, 'PENDING', 'GARCIA SIMON o ROJAS RESPONSABLE']);

  r = create(strip(base({ costCenter: '201', businessUnit: POT })));
  eq('formulario anterior (sin travelerUnit): igual cuenta la unidad de USUARIOS', [cell(r.data, 'UNIDAD DEL VIAJERO'), cell(r.data, 'APROBADOR OTRA UNIDAD')], [EPV, 'sigarcia@p.co,resp2@p.co']);
  r = create(base({ costCenter: '201', businessUnit: POT, travelerUnit: POT }));
  eq('el navegador no decide la unidad del viajero (Ana dice ser de POTENCIA)', [cell(r.data, 'UNIDAD DEL VIAJERO'), cell(r.data, 'APROBADOR OTRA UNIDAD')], [EPV, 'sigarcia@p.co,resp2@p.co']);
  r = create(base({ costCenter: '503' }));
  eq('su propio centro de costos: sin marca ni voto extra', [cell(r.data, 'UNIDAD DE NEGOCIO'), cell(r.data, 'UNIDAD DEL VIAJERO'), cell(r.data, 'APROBADOR OTRA UNIDAD'), /OTRA UNIDAD/.test(cell(r.data, 'OBSERVACIONES'))],
    [EPV, EPV, '', false]);
  ok('propio: la app no lo marca', !mapped(r.data).otherUnitCharge && mapped(r.data).effectiveApprovalOtherUnit === 'NA');

  const luis = { passengers: pax('110', 'ROJAS LUIS', 'luis@p.co'), requesterEmail: 'luis@p.co' };
  r = create(base(Object.assign({ costCenter: '201', businessUnit: POT, travelerUnit: EPV }, luis)));
  eq('Luis sin unidad registrada elige ENERGIA POSTVENTA y carga a POTENCIA: otra unidad', [cell(r.data, 'UNIDAD DEL VIAJERO'), cell(r.data, 'APROBADOR OTRA UNIDAD')], [EPV, 'sigarcia@p.co,resp2@p.co']);
  r = create(base(Object.assign({ costCenter: '201', businessUnit: POT, travelerUnit: POT }, luis)));
  eq('Luis elige POTENCIA: su unidad', [cell(r.data, 'UNIDAD DEL VIAJERO'), cell(r.data, 'APROBADOR OTRA UNIDAD')], [POT, '']);
  r = create(strip(base(Object.assign({ costCenter: '201', businessUnit: 'ADM GENERAL' }, luis))));
  eq('formulario anterior sin unidad registrada: como antes, y paga la dueña del centro de costos', [cell(r.data, 'UNIDAD DE NEGOCIO'), cell(r.data, 'UNIDAD DEL VIAJERO'), cell(r.data, 'APROBADOR OTRA UNIDAD')], [POT, '', '']);

  const rowsBefore = req.length;
  r = create(base({ costCenter: '9015', businessUnit: 'ADM GENERAL' }));
  ok('unidad sin responsable: no se crea y dice por qué', !r.success && /9015 es de ADM GENERAL.*no tiene registrado quién aprueba.*ENERGIA POSTVENTA/.test(r.error));
  eq('unidad sin responsable: ninguna fila nueva', req.length, rowsBefore);
  reset();
  const chg = ctx.createNewRequest(Object.assign(base({ costCenter: '9015', businessUnit: 'ADM GENERAL' }), { requestType: 'MODIFICACION', relatedRequestId: 'SOL-000001', status: 'PENDIENTE_ANALISIS_CAMBIO' }), '<p>{{REQUEST_ID}}</p>');
  eq('un cambio de un viaje ya cargado allá sí pasa (marcado, sin voto extra)', [cell(chg, 'UNIDAD DE NEGOCIO'), cell(chg, 'UNIDAD DEL VIAJERO'), cell(chg, 'APROBADOR OTRA UNIDAD')], ['ADM GENERAL', EPV, '']);
  ok('el cambio queda marcado', mapped(chg).otherUnitCharge === true && mapped(chg).requiresOtherUnitApproval === false);

  r = create(base({ passengers: pax('180', 'ROJAS RESPONSABLE', 'resp2@p.co'), requesterEmail: 'resp2@p.co', costCenter: '201', businessUnit: POT }));
  eq('el viajero es responsable de esa unidad: no vota su propio viaje', cell(r.data, 'APROBADOR OTRA UNIDAD'), 'sigarcia@p.co');
  r = create(base({ passengers: pax('180', 'ROJAS RESPONSABLE', ''), requesterEmail: 'admin@p.co', costCenter: '201', businessUnit: POT }), 'admin@p.co');
  eq('…tampoco si lo pide el área de compras a su nombre (por la cédula)', cell(r.data, 'APROBADOR OTRA UNIDAD'), 'sigarcia@p.co');
  r = create(base({ passengers: pax('150', 'TORRES MARIA', 'maria@p.co'), requesterEmail: 'maria@p.co', costCenter: '9013', businessUnit: 'ADM AUDITORIA' }));
  eq('espacios raros en la unidad («ADM AUDITORIA»): es la suya', [cell(r.data, 'UNIDAD DE NEGOCIO'), cell(r.data, 'APROBADOR OTRA UNIDAD')], ['ADM AUDITORIA', '']);
  r = create(base({ costCenter: 'VARIOS', businessUnit: EPV, variousCostCenters: '503 - POSTVENTA ENERGIA-MTTO CONV' }));
  eq('VARIOS: la unidad del viajero, sin marca', [cell(r.data, 'UNIDAD DE NEGOCIO'), cell(r.data, 'APROBADOR OTRA UNIDAD')], [EPV, '']);
  reset();
  eq('1901 es de dos unidades: si el viajero es de una, es la suya', ctx._ouPlan_({ costCenter: '1901', businessUnit: 'INGENERGIA', travelerUnit: 'INGENERGIA- COMAP', passengers: [{ idNumber: 'x' }] }),
    { travelerUnit: 'INGENERGIA- COMAP', chargedUnit: 'INGENERGIA- COMAP', cross: false, approvers: [] });
  reset();
  eq('una unidad mal escrita en USUARIOS no cuenta: vale la que se eligió', ctx._ouPlan_({ costCenter: '201', businessUnit: POT, travelerUnit: POT, passengers: [{ idNumber: '117' }] }).travelerUnit, POT);

  // ---------------------------------------------------------------------------
  // 3. El voto
  eq('_ouEffective_: sin responsables no aplica', ctx._ouEffective_('', '', {}), 'NA');
  eq('_ouEffective_: voto directo', [ctx._ouEffective_('a@p.co', 'Sí_a@p.co_1/1/2026 8:00', {}), ctx._ouEffective_('a@p.co', 'No_a@p.co_1/1/2026 8:00', {})], ['APPROVED', 'DENIED']);
  eq('_ouEffective_: lo cubre el voto de la misma persona en otro rol, no el de otra',
    [ctx._ouEffective_('a@p.co,b@p.co', '', { area: 'Sí_b@p.co' }), ctx._ouEffective_('a@p.co', '', { area: 'Sí_jefe@p.co' }), ctx._ouEffective_('a@p.co', '', { budget: 'No_a@p.co_1/1/2026 8:00' })],
    ['APPROVED', 'PENDING', 'DENIED']);
  eq('_ouEffective_: etapa saltada', ctx._ouEffective_('a@p.co', 'Sí (ETAPA SALTADA por yprieto@equitel.com.co)', {}), 'APPROVED');

  toApproval(X1);
  reset();
  eq('a quién se le pide: su aprobador y los responsables de POTENCIA', ctx._approvalAskedFor_(ctx.mapRowToRequest(rowOf(X1))).map((a) => a.email + ':' + a.role),
    ['jefe@p.co:NORMAL', 'sigarcia@p.co:OTHER_UNIT', 'resp2@p.co:OTHER_UNIT']);
  log.mails.length = 0;
  ask(X1);
  eq('correos de aprobación', log.mails.map((m) => m.to).sort(), ['jefe@p.co', 'resp2@p.co', 'sigarcia@p.co']);
  ok('el correo explica la otra unidad', /CENTRO DE COSTOS DE OTRA UNIDAD:<\/strong> El viajero es de <strong>ENERGIA POSTVENTA<\/strong>.*PARTES Y MOTORES.*POTENCIA \(GDM - P&amp;M\)/.test(mailsTo('sigarcia@p.co')[0].html));
  ok('el enlace del responsable va con su rol', /role=OTHER_UNIT&actor=sigarcia%40p\.co/.test(mailsTo('sigarcia@p.co')[0].html));

  let html = link(X1, 'approved', 'OTHER_UNIT', 'extrano@p.co');
  ok('un enlace con el rol de la otra unidad para quien no es responsable no cambia nada', /no corresponde/.test(html) && cell(X1, 'APROBADO OTRA UNIDAD') === '');
  html = link(X1, 'approved', 'NORMAL', 'jefe@p.co');
  ok('aprueba el jefe: falta la unidad del centro de costos', cell(X1, 'STATUS') === 'PENDIENTE_APROBACION' && /Responsable de la unidad del centro de costos \(GARCIA SIMON o ROJAS RESPONSABLE\)/.test(html));
  reset();
  const m1b = ctx.mapRowToRequest(rowOf(X1));
  ok('recordatorios: el voto de la unidad sigue pendiente', ctx._approvalRolePending_('OTHER_UNIT', m1b) && !ctx._approvalRolePending_('NORMAL', m1b));
  const mine = ctx.getMyApprovals('sigarcia@p.co');
  const item = mine.pending.find((x) => x.id === X1);
  ok('Mis aprobaciones: lo tiene pendiente con su rol y la unidad del viajero',
    item && item.role === 'OTHER_UNIT' && item.roleText === 'Responsable de la unidad del centro de costos' && item.travelerUnit === EPV &&
    item.why.some((w) => /otra unidad \(el viajero es de ENERGIA POSTVENTA\)/.test(w)));
  reset();
  ok('es aprobador (botón «Mis aprobaciones»)', ctx._isApproverEmail_('resp2@p.co', []) && !ctx._isApproverEmail_('nadie@p.co', []));
  log.mails.length = 0;
  html = link(X1, 'approved', 'OTHER_UNIT', 'sigarcia@p.co');
  eq('aprueba Simón: queda APROBADO y se guarda su voto', [cell(X1, 'STATUS'), /^Sí_sigarcia@p\.co_24\/11\/2026/.test(cell(X1, 'APROBADO OTRA UNIDAD'))], ['APROBADO', true]);
  ok('al otro responsable le llega el aviso de la decisión final', mailsTo('resp2@p.co').some((m) => /DECISIÓN FINAL/.test(m.html)));
  html = link(X1, 'approved', 'OTHER_UNIT', 'resp2@p.co');
  ok('el enlace del otro responsable dice que Simón ya aprobó', /GARCIA SIMON<\/strong> ya aprobó esta solicitud.*Responsable de la unidad del centro de costos/.test(html));
  reset();
  const trail = ctx._approvalTrail_(rowOf(X1), ctx.mapRowToRequest(rowOf(X1)));
  eq('línea de tiempo: el voto de la unidad, con quién', trail.filter((s) => s.role === 'OTHER_UNIT').map((s) => [s.state, s.who, s.label]),
    [['approved', 'GARCIA SIMON', 'Responsable de la unidad del centro de costos']]);

  // Denegada por la unidad
  r = create(base({ costCenter: '201', businessUnit: POT }));
  const X2 = r.data;
  toApproval(X2);
  link(X2, 'denied', 'OTHER_UNIT', 'resp2@p.co');
  ok('la unidad del centro de costos deniega: DENEGADO con el motivo', cell(X2, 'STATUS') === 'DENEGADO' && /No corresponde a la unidad/.test(cell(X2, 'OBSERVACIONES')));

  // Simón es el jefe del viajero y responsable de POTENCIA: un solo voto cubre los dos.
  users.push(user('190', 'VIAJERO DE SIMON', 'vsimon@p.co', 20402, EPV, 'sigarcia@p.co'));
  r = create(base({ passengers: pax('190', 'VIAJERO DE SIMON', 'vsimon@p.co'), requesterEmail: 'vsimon@p.co', costCenter: '201', businessUnit: POT }));
  const X3 = r.data;
  toApproval(X3);
  reset();
  eq('el jefe que también es responsable: se le pide una vez, como jefe', ctx._approvalAskedFor_(ctx.mapRowToRequest(rowOf(X3))).map((a) => a.email + ':' + a.role),
    ['sigarcia@p.co:NORMAL', 'resp2@p.co:OTHER_UNIT']);
  link(X3, 'approved', 'NORMAL', 'sigarcia@p.co');
  eq('…y su voto de jefe cubre el de la unidad', [cell(X3, 'STATUS'), mapped(X3).effectiveApprovalOtherUnit], ['APROBADO', 'APPROVED']);

  // Saltar la etapa (Yurani)
  r = create(base({ costCenter: '201', businessUnit: POT }));
  const X4 = r.data;
  toApproval(X4);
  r = create(base({ costCenter: '503' }));
  const OWN = r.data;
  toApproval(OWN);
  reset();
  ctx.skipApprovalStage(X4, 'Autorizado por teléfono por la gerencia', 'yprieto@equitel.com.co');
  reset();
  ctx.skipApprovalStage(OWN, 'Autorizado por teléfono por la gerencia', 'yprieto@equitel.com.co');
  eq('saltar la etapa marca el voto de la unidad solo donde se pidió', [cell(X4, 'STATUS'), /ETAPA SALTADA/.test(cell(X4, 'APROBADO OTRA UNIDAD')), cell(OWN, 'APROBADO OTRA UNIDAD')],
    ['APROBADO', true, '']);

  // Desde «Mis aprobaciones»
  r = create(base({ costCenter: '201', businessUnit: POT }));
  const X5 = r.data;
  toApproval(X5);
  link(X5, 'approved', 'NORMAL', 'jefe@p.co');
  reset();
  const dec = ctx.decideMyApproval(X5, 'approved', 'Lo pagamos nosotros', 'resp2@p.co');
  eq('Mis aprobaciones: el responsable aprueba en la app', [dec.kind, cell(X5, 'STATUS'), /^Sí_resp2@p\.co/.test(cell(X5, 'APROBADO OTRA UNIDAD'))], ['approved_full', 'APROBADO', true]);
  ok('…con su comentario', /"role":"OTHER_UNIT".*Lo pagamos nosotros/.test(cell(X5, 'COMENTARIOS APROBADORES (JSON)')));

  // ---------------------------------------------------------------------------
  // 4. Menú 17: la unidad de cada persona
  reset();
  const prop = ctx._ouProposeUserUnits_();
  const byName = Object.fromEntries(prop.proposals.map((p) => [p.name, p.unit + ' · ' + p.from]));
  eq('propuestas: Luis por su historial y el nuevo por su código de RR. HH.', [byName['ROJAS LUIS'], byName['NUEVO SIN HISTORIAL']],
    [POT + ' · historial', POT + ' · código 20101']);
  ok('sin datos claros: queda para que la persona la elija', prop.pending.includes('SIN DATOS') && !byName['SIN DATOS']);
  eq('por el aprobador: el equipo de su aprobador, la del aprobador y en cascada', [byName['EQUIPO A3'], byName['EQUIPO B1'], byName['EQUIPO C1']],
    [EPV + ' · equipo de su aprobador', EP + ' · su aprobador', EP + ' · su aprobador']);
  ok('un aprobador con un equipo de varias unidades no reparte la suya (JEFE UNO)', prop.pending.includes('JEFE DOS') &&
    prop.pendingByApprover.some((x) => x[0] === 'JEFE UNO' && x[1] >= 2));
  ok('una unidad mal escrita se reporta y no se toca', prop.invalid.some((w) => /UNIDAD MAL ESCRITA.*POTENCIAS/.test(w)) && !byName['UNIDAD MAL ESCRITA']);
  ok('quien ya tiene unidad no se propone', !byName['PEREZ ANA'] && prop.already >= 4);
  users.find((u) => u[0] === '115')[14] = 'ADM GENERAL'; // alguien la escribió a mano mientras tanto
  reset();
  const w = ctx._ouWriteUserUnits_(prop.proposals);
  eq('escribe solo celdas vacías', [users.find((u) => u[0] === '110')[14], users.find((u) => u[0] === '115')[14], users.find((u) => u[0] === '117')[14]], [POT, 'ADM GENERAL', 'POTENCIAS']);
  ok('cuántas escribió', w.written === prop.proposals.length - 1);

  // ---------------------------------------------------------------------------
  // 5. El formulario decide igual que el servidor (utils/otherUnit.ts)
  let cli;
  try { cli = loadClient(); } catch (e) { failures.push('no se pudo compilar utils/otherUnit.ts: ' + e.message); }
  if (cli) {
    reset();
    const master = ctx.getCostCenterData();
    const codes = ['201', '101', '503', '401', '1901', '9013', '9015', '9003', 'VARIOS', '', '999'];
    const units = ['', POT, EPV, 'INGENERGIA', 'INGENERGIA- COMAP', 'ADM AUDITORIA', 'ADM AUDITORIA', 'adm general'];
    const k = (s) => cli.unitKey(s);
    codes.forEach((code) => units.forEach((unit) => {
      const c = cli.planCharge(code, unit, master);
      let s;
      reset();
      try {
        s = ctx._ouPlan_({ costCenter: code, businessUnit: c.chargedUnit, travelerUnit: unit, passengers: [{ idNumber: 'nadie' }], requesterEmail: 'x@p.co' });
      } catch (e) { s = { cross: true, chargedUnit: c.chargedUnit, threw: true }; }
      if (k(s.chargedUnit) !== k(c.chargedUnit) || !!s.cross !== c.cross) {
        failures.push(`formulario y servidor no coinciden en ${code} con «${unit}»: servidor ${JSON.stringify([s.chargedUnit, s.cross])}, formulario ${JSON.stringify([c.chargedUnit, c.cross])}`);
      }
    }));
    reset();
    const groups = cli.otherUnitGroups(master, EPV, ctx._ouPublicInfo_().units);
    eq('formulario: solo las otras unidades con responsable', groups.map((g) => g.unit + ':' + g.centers.map((c) => c.code).join(',')), [EP + ':401', POT + ':101,201']);
    eq('formulario: en una modificación se conserva su centro de costos aunque la unidad no tenga responsable',
      cli.otherUnitGroups(master, EPV, ctx._ouPublicInfo_().units, '9015').map((g) => g.unit), ['ADM GENERAL', EP, POT]);
    eq('formulario: la unidad del directorio contra la lista', cli.matchUnit('adm  auditoria', ['ADM AUDITORIA', POT]), 'ADM AUDITORIA');
  }

  if (failures.length) {
    console.error('✗ Centros de costos de otra unidad (#A133): ' + failures.length + ' falla(s):');
    failures.forEach((x) => console.error('  - ' + x));
    process.exit(1);
  }
  console.log('Centros de costos de otra unidad (#A133): responsables por unidad, la unidad del viajero desde USUARIOS, la que paga, el voto extra (pedido, aprobado, denegado, cubierto, saltado, en «Mis aprobaciones»), la unidad propuesta de cada persona y el formulario igual que el servidor. OK');
}

main();
