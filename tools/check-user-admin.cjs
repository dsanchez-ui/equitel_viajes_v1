#!/usr/bin/env node
/**
 * Verifica la administración de usuarios de #A135 (David, 25-nov-2026): corre `server/Code.gs` completo con una
 * hoja SINTÉTICA en memoria (sin datos reales ni correos) y comprueba:
 *   - la unidad de negocio de cada persona: se ve en la lista, se cambia al crear, al editar (solo si viene la
 *     clave) y en la edición masiva, siempre como está en «CDS vs UDEN»; una unidad que no existe no se escribe;
 *   - los responsables de cada unidad (tabla de MISC): quién responde, las sugerencias (quién más aprobó sus
 *     viajes en la ventana, sin cambios de viaje ni viajes cargados desde otra unidad), quién puede cambiarlos
 *     (lista fija + administrador; en el sidebar por getActiveUser, nunca por getEffectiveUser), cómo se reescribe
 *     la tabla sin tocar las demás columnas de MISC y la constancia del cambio;
 *   - el panel móvil: ?action=admin sirve el sidebar en modo móvil (o un aviso si el HTML es de antes),
 *     mobileAdmin_run valida la sesión, solo deja las funciones del sidebar, no manda fechas de nacimiento ni
 *     celulares en la lista y cambia responsables con el correo de la sesión;
 *   - toda llamada del sidebar al servidor existe también en el panel móvil (navegador y servidor), así lo que
 *     se agregue al sidebar no se queda por fuera del celular.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server', 'Code.gs'), 'utf8');
const SIDEBAR = fs.readFileSync(path.join(ROOT, 'server', 'AdminSidebar.html'), 'utf8');
const TODAY = '2026-11-25';
const POT = 'POTENCIA (GDM - P&M)';
const EP = 'ENERGIA PROYECTOS';
const EPV = 'ENERGIA POSTVENTA';
const AUD = 'ADM AUDITORIA';

function makeSheet(name, table) {
  const width = () => table.reduce((m, r) => Math.max(m, r.length), 0);
  return {
    getName: () => name, getLastRow: () => {
      let n = table.length;
      while (n > 0 && table[n - 1].every((v) => v === '' || v === null || v === undefined)) n--;
      return n;
    },
    getLastColumn: () => width(), getMaxColumns: () => width(), getMaxRows: () => table.length,
    insertColumnsAfter() {}, setColumnWidth() {}, setFrozenRows() {}, hideSheet() { this.hidden = true; },
    appendRow(vals) { table.push(vals.slice()); },
    deleteRow(r) { table.splice(r - 1, 1); },
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
        clearContent: () => { grow(); for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) table[r - 1 + i][c - 1 + j] = ''; return rng; },
        setNote: () => rng, setFontWeight: () => rng, setBackground: () => rng, setFontColor: () => rng, setNumberFormat: () => rng,
      };
      return rng;
    },
  };
}

const USERS_HEAD = ['Cedula', 'Nombre', 'Correo', 'Empresa', 'Sede', 'Centro de Costo', 'Cedulas Aprobadores', 'Correos Aprobadores (auto)',
  'Nombres Aprobadores (auto)', 'PIN', 'Pasaporte Fecha', 'Pasaporte File ID', 'Fecha Nacimiento', 'Celular', 'Unidad de negocio'];
const user = (ced, name, email, unit) => [ced, name, email, 'Cumandes', 'BOGOTA', '20101', '', '', '', 'hash', '', '', new Date(Date.UTC(1990, 4, 6, 12)), '3001234567', unit];

function load(opts) {
  opts = opts || {};
  const m = /const HEADERS_REQUESTS = (\[[\s\S]*?\]);/.exec(SRC);
  // eslint-disable-next-line no-new-func
  const H = new Function('return ' + m[1])();
  ['UNIDAD DEL VIAJERO', 'TIPO DE SOLICITUD', 'FECHA SOLICITUD'].forEach((h) => { if (!H.includes(h)) H.push(h); });
  const req = [H.slice()];
  const users = [USERS_HEAD,
    user('100', 'HERNANDEZ DIANA', 'dahernandez@p.co', POT),
    user('110', 'GARCIA SIMON', 'sigarcia@p.co', POT),
    user('120', 'AMEZQUITA FRANCISCO', 'famezquita@p.co', POT),
    user('130', 'OLAVE ALEXANDRA', 'aolave@p.co', EP),
    user('140', 'SIN UNIDAD', 'sinunidad@p.co', ''),
    user('150', 'GIRALDO CARLOS', 'cgiraldo@p.co', AUD),
    user('400', 'PRIETO YURANI', 'yprieto@equitel.com.co', 'ADM INVENTARIOS Y BODEGA'),
    user('401', 'SANCHEZ DAVID', 'dsanchez@equitel.com.co', 'ADM SISTEMAS'),
    user('402', 'MOLINA LAURA', 'admin@p.co', 'ADM COMPRAS Y SEGURIDAD')];
  const cds = [['CENTRO COSTOS', 'Descripcion del CC', 'UNIDAD DE NEGOCIO'],
    [100, 'SERVICIO-GDM-GRAL', 'NA'], [101, 'SERVICIO-GDM', POT], [401, 'PROYECTOS ENERGIA-EQUIPOS', EP], [503, 'POSTVENTA', EPV],
    [9013, 'ADM AUDITORIA', AUD], [9003, 'ADM INVENTARIOS Y BODEGA', 'ADM INVENTARIOS Y BODEGA'], [9010, 'ADM SISTEMAS', 'ADM SISTEMAS'],
    [9004, 'ADM COMPRAS', 'ADM COMPRAS Y SEGURIDAD'], ['VARIOS', '-', '-']];
  // MISC como en producción: tarjetas (A:B), sedes (D), accesos al dashboard (H:I) y la tabla de responsables (Q:R).
  const misc = [
    ['TARJETAS', '', '', '', '', '', '', 'DASHBOARD COSTOS · CORREO', 'DASHBOARD COSTOS · UNIDAD DE NEGOCIO', '', '', '', '', '', '', '', 'RESPONSABLE UNIDAD · UNIDAD DE NEGOCIO', 'RESPONSABLE UNIDAD · CORREO'],
    ['VISA', '1234', '', 'SEDES', '', '', '', 'sigarcia@p.co', POT, '', '', '', '', '', '', '', POT, 'sigarcia@p.co'],
    ['', '', '', 'BOGOTA', '', '', '', 'misaza@p.co', 'TODAS', '', '', '', '', '', '', '', EP, 'aochoa@p.co'],
    ['', '', '', 'MEDELLIN', '', '', '', 'aochoa@p.co', EP, '', '', '', '', '', '', '', EPV, 'yroncancio@p.co'],
    ['', '', '', '', '', '', '', 'aolave@p.co', EP, '', '', '', '', '', '', '', EP, 'aolave@p.co'],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'UNIDAD QUE NO EXISTE', 'x@p.co'],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', AUD, 'yprieto@equitel.com.co']];
  const sheets = {
    'Nueva Base Solicitudes': makeSheet('Nueva Base Solicitudes', req), USUARIOS: makeSheet('USUARIOS', users),
    'CDS vs UDEN': makeSheet('CDS vs UDEN', cds), MISC: makeSheet('MISC', misc),
  };
  const fmt = (d, tz, f) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(d).map((x) => [x.type, x.value]));
    const hour = p.hour === '24' ? '00' : p.hour;
    return f.replace(/yyyy|MM|dd|HH|mm|M|d|H/g, (t) => ({ yyyy: p.year, MM: p.month, dd: p.day, HH: hour, mm: p.minute, M: String(+p.month), d: String(+p.day), H: String(+hour) })[t]);
  };
  const who = { active: 'yprieto@equitel.com.co', effective: 'dsanchez@equitel.com.co' };
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} }, Logger: { log() {} },
    Utilities: { formatDate: fmt, getUuid: () => crypto.randomUUID(), sleep() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, getProperties: () => ({}), setProperty() {}, deleteProperty() {}, getKeys: () => [] }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {}, getAll: () => ({}), putAll() {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true }) },
    Session: { getActiveUser: () => ({ getEmail: () => who.active }), getEffectiveUser: () => ({ getEmail: () => who.effective }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => { sheets[n] = makeSheet(n, []); return sheets[n]; },
      }),
      flush() {},
      getUi: () => { throw new Error('getUi no está disponible fuera de la hoja'); },
    },
    HtmlService: {
      createHtmlOutput: (h) => { const o = { html: String(h), title: '', setTitle: (t) => { o.title = t; return o; }, setXFrameOptionsMode: () => o, addMetaTag: () => o, getContent: () => o.html }; return o; },
      createHtmlOutputFromFile: (name) => ctx.HtmlService.createHtmlOutput(opts.sidebarHtml !== undefined && name === 'AdminSidebar' ? opts.sidebarHtml
        : fs.readFileSync(path.join(ROOT, 'server', name + '.html'), 'utf8')),
      XFrameOptionsMode: { DEFAULT: 'DEFAULT', ALLOWALL: 'ALLOWALL' },
    },
    MailApp: { sendEmail() { throw new Error('no debe enviar'); } }, GmailApp: { sendEmail() { throw new Error('no debe enviar'); }, getAliases: () => [] },
  };
  const stub = () => new Proxy(function () { return stub(); }, { get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : stub()) });
  for (const g of ['DriveApp', 'ContentService', 'UrlFetchApp', 'DocumentApp', 'ScriptApp']) ctx[g] = stub();
  const NOW = Date.parse(TODAY + 'T15:00:00Z');
  ctx.Date = class extends Date {
    constructor(...a) { super(...(a.length ? a : [NOW])); }
    static now() { return NOW; }
  };
  vm.createContext(ctx);
  new vm.Script(SRC, { filename: 'Code.gs' }).runInContext(ctx);
  ctx.isUserAnalyst = (e) => ['admin@p.co', 'yprieto@equitel.com.co', 'dsanchez@equitel.com.co'].includes(String(e || '').toLowerCase());
  ctx.isSuperAdmin = () => false;
  ctx.validateUserSession_ = (email, token) => token === 'ok' ? { email } : null;
  ctx._csLoadConfig_ = () => ({});
  ctx._readMaestroRH_ = () => ({ lookup: {} });

  // Viajes: quién aprobó los de cada unidad.
  const col = (h) => H.indexOf(h);
  const days = (n) => new Date(NOW - n * 86400000);
  const trip = (id, unit, vote, when, extra) => {
    const r = new Array(H.length).fill('');
    r[col('ID RESPUESTA')] = id;
    r[col('UNIDAD DE NEGOCIO')] = unit;
    r[col('APROBADO POR ÁREA? (AUTOMÁTICO)')] = vote;
    r[col('FECHA SOLICITUD')] = when;
    Object.keys(extra || {}).forEach((k) => { r[col(k)] = extra[k]; });
    req.push(r);
  };
  trip('SOL-1', POT, 'Sí_dahernandez@p.co', days(10));
  trip('SOL-2', POT, 'Sí_dahernandez@p.co_2026-11-20 10:00', days(20));
  trip('SOL-3', POT, 'Sí_dahernandez@p.co', days(30));
  trip('SOL-4', POT, 'Sí_sigarcia@p.co', days(40));
  trip('SOL-5', POT, 'Sí_sigarcia@p.co', days(50));
  trip('SOL-6', POT, 'Sí_famezquita@p.co', days(60));
  trip('SOL-7', POT, 'Sí_famezquita@p.co', days(400));                           // fuera de la ventana
  trip('SOL-8', POT, 'Sí_famezquita@p.co', days(5), { 'TIPO DE SOLICITUD': 'MODIFICACION' }); // un cambio: no cuenta
  trip('SOL-9', POT, 'Sí_aolave@p.co', days(5), { 'UNIDAD DEL VIAJERO': EP });     // cargado desde otra unidad: no cuenta
  trip('SOL-10', POT, 'Sí (ETAPA SALTADA por yprieto@equitel.com.co)', days(5));  // cuenta como viaje, no como aprobación
  trip('SOL-11', POT, 'Sí_externo@otra.co', days(5));                             // no está en USUARIOS: no se sugiere
  trip('SOL-12', 'potencia (gdm - p&m)', 'No_dahernandez@p.co', days(5));         // denegada: viaje sí, aprobación no
  trip('SOL-13', AUD, 'Sí_cgiraldo@p.co', days(3));
  return { ctx, req, users, misc, sheets, who };
}

function main() {
  const failures = [];
  const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: da ${JSON.stringify(got)}, se esperaba ${JSON.stringify(want)}`); };
  const ok = (name, cond) => { if (!cond) failures.push(name); };
  const throws = (name, fn, re) => {
    try { fn(); failures.push(name + ': no lanzó error'); } catch (e) { if (re && !re.test(String(e.message))) failures.push(name + ': error inesperado «' + e.message + '»'); }
  };
  let env;
  try { env = load(); } catch (e) { console.error('✗ No se pudo cargar server/Code.gs:\n  ' + e.stack); process.exit(1); }
  const { ctx, users, misc, sheets, who } = env;
  const reset = () => ctx._resetPerExecutionCaches_();
  const unitOf = (ced) => (users.find((r) => r[0] === ced) || [])[14];
  const table = () => misc.slice(1).map((r) => [r[16], r[17]]).filter((r) => r[0] || r[1]);

  // ---------------------------------------------------------------------------
  // 1. La unidad de cada persona
  reset();
  const list = ctx.usuarios_listAll();
  eq('lista: trae la unidad', list.filter((u) => u.cedula === '100')[0].unidadNegocio, POT);
  eq('lista: sin unidad = vacía', list.filter((u) => u.cedula === '140')[0].unidadNegocio, '');
  reset();
  eq('unidades: las de CDS vs UDEN, sin NA ni «-», en orden', ctx.usuarios_getUnidades(),
    ['ADM AUDITORIA', 'ADM COMPRAS Y SEGURIDAD', 'ADM INVENTARIOS Y BODEGA', 'ADM SISTEMAS', EPV, EP, POT]);

  const base = (over) => Object.assign({ cedula: '140', nombre: 'SIN UNIDAD', correo: 'sinunidad@p.co', empresa: 'Cumandes', sede: 'BOGOTA', centroCosto: '20101', cedulasAprobadores: '' }, over || {});
  reset(); ctx.usuarios_update('140', base({ unidadNegocio: 'energia  proyectos' }));
  eq('editar: la unidad se guarda como en CDS vs UDEN', unitOf('140'), EP);
  reset(); ctx.usuarios_update('140', base());
  eq('editar: sin la clave no se toca la unidad', unitOf('140'), EP);
  reset(); throws('editar: una unidad que no existe da error', () => ctx.usuarios_update('140', base({ unidadNegocio: 'POTENCIAS', nombre: 'OTRO NOMBRE' })), /CDS vs UDEN/);
  eq('editar: con una unidad que no existe no se escribe nada', [unitOf('140'), users.find((r) => r[0] === '140')[1]], [EP, 'SIN UNIDAD']);
  reset(); ctx.usuarios_update('140', base({ unidadNegocio: '' }));
  eq('editar: vacía = sin unidad', unitOf('140'), '');
  eq('editar: la fecha de nacimiento y el celular siguen ahí', [users.find((r) => r[0] === '140')[12] instanceof Date, users.find((r) => r[0] === '140')[13]], [true, '3001234567']);

  reset(); ctx.usuarios_create({ cedula: '777', nombre: 'NUEVO', correo: 'nuevo@p.co', fechaNacimiento: '1990-05-06', unidadNegocio: 'adm auditoria' });
  eq('crear: con la unidad elegida', unitOf('777'), AUD);
  const before = users.length;
  reset(); throws('crear: con una unidad que no existe da error', () => ctx.usuarios_create({ cedula: '778', nombre: 'OTRO', correo: 'otro@p.co', fechaNacimiento: '1990-05-06', unidadNegocio: 'NO EXISTE' }), /CDS vs UDEN/);
  eq('crear: con una unidad que no existe no queda la fila', users.length, before);

  reset(); const bulk = ctx.usuarios_bulkUpdate({ action: 'unidadNegocio', cedulas: ['140', '777'], value: 'Energia Postventa' });
  eq('edición masiva: cambia la unidad', [bulk.affected, unitOf('140'), unitOf('777')], [2, EPV, EPV]);
  reset(); throws('edición masiva: unidad que no existe', () => ctx.usuarios_bulkUpdate({ action: 'unidadNegocio', cedulas: ['140'], value: 'XYZ' }), /CDS vs UDEN/);
  reset(); throws('edición masiva: unidad vacía', () => ctx.usuarios_bulkUpdate({ action: 'unidadNegocio', cedulas: ['140'], value: '' }), /vac/);
  reset();
  eq('después de cambiarla, la regla de otra unidad usa la nueva', ctx._ouUserUnits_().byCedula['140'], EPV);

  // ---------------------------------------------------------------------------
  // 2. Responsables de cada unidad: lo que se ve
  reset(); who.active = 'admin@p.co';
  let ov = ctx.usuarios_getResponsables();
  const pot = () => ov.units.find((u) => u.unit === POT);
  eq('vista: Laura (administradora fuera de la lista) no puede cambiarlos', [ov.canEdit, ov.editors], [false, 'Yurani Prieto y David Sánchez']);
  eq('vista: responsables de POTENCIA', pot().responsables.map((p) => [p.email, p.name, p.inUsers]), [['sigarcia@p.co', 'GARCIA SIMON', true]]);
  eq('vista: sugerencias de POTENCIA (más aprobaron; sin cambios, otra unidad, fuera de la ventana ni externos)',
    pot().suggestions.map((p) => [p.email, p.count, p.current]), [['dahernandez@p.co', 3, false], ['sigarcia@p.co', 2, true], ['famezquita@p.co', 1, false]]);
  eq('vista: viajes de POTENCIA en la ventana (con la saltada y la denegada)', pot().trips, 9);
  eq('vista: ENERGIA PROYECTOS con dos responsables', ov.units.find((u) => u.unit === EP).responsables.map((p) => [p.email, p.inUsers]), [['aochoa@p.co', false], ['aolave@p.co', true]]);
  eq('vista: una unidad sin responsable', ov.units.find((u) => u.unit === 'ADM SISTEMAS').responsables, []);
  ok('vista: avisa la fila con una unidad que no existe', ov.warnings.some((w) => /UNIDAD QUE NO EXISTE/.test(w)));
  ok('vista: no trae cédulas', !JSON.stringify(ov).includes('"100"'));

  // 3. Quién puede cambiarlos
  reset(); who.active = 'admin@p.co';
  throws('cambiar: una administradora fuera de la lista no puede (sidebar)', () => ctx.usuarios_setResponsables(POT, ['dahernandez@p.co']), /reservado a Yurani Prieto y David Sánchez/);
  reset(); who.active = ''; who.effective = 'dsanchez@equitel.com.co';
  throws('cambiar: sin correo de quien usa el sidebar no se toma el del dueño del script', () => ctx.usuarios_setResponsables(POT, ['dahernandez@p.co']), /reservado/);
  reset(); ctx.isUserAnalyst = (e) => ['admin@p.co', 'dsanchez@equitel.com.co'].includes(String(e || '').toLowerCase()); who.active = 'yprieto@equitel.com.co';
  throws('cambiar: estar en la lista no basta si no es administrador', () => ctx.usuarios_setResponsables(POT, ['dahernandez@p.co']), /reservado/);
  ctx.isUserAnalyst = (e) => ['admin@p.co', 'yprieto@equitel.com.co', 'dsanchez@equitel.com.co'].includes(String(e || '').toLowerCase());
  eq('cambiar: nada cambió en la tabla', table()[0], [POT, 'sigarcia@p.co']);

  // 4. Cambiarlos (Yurani en el sidebar)
  const keepOther = () => misc.slice(0, 7).map((r) => r.slice(0, 16).join('|')).join('\n');
  const otherBefore = keepOther();
  reset(); who.active = 'yprieto@equitel.com.co';
  throws('cambiar: un correo que no está en USUARIOS', () => ctx.usuarios_setResponsables(POT, ['nadie@p.co']), /no está en USUARIOS/);
  throws('cambiar: una unidad que no existe', () => ctx.usuarios_setResponsables('NO EXISTE', ['dahernandez@p.co']), /no es una unidad/);
  throws('cambiar: más de 5', () => ctx.usuarios_setResponsables(POT, ['a@p.co', 'b@p.co', 'c@p.co', 'd@p.co', 'e@p.co', 'f@p.co']), /Máximo 5/);
  reset(); ov = ctx.usuarios_setResponsables('potencia (gdm - p&m)', ['DAHernandez@p.co']);
  eq('cambiar: POTENCIA queda con Diana en su misma fila', table()[0], [POT, 'dahernandez@p.co']);
  eq('cambiar: la vista que vuelve ya trae a Diana', pot().responsables.map((p) => p.email), ['dahernandez@p.co']);
  reset(); ctx.usuarios_setResponsables(EP, ['aolave@p.co']);
  eq('cambiar: quitar a Ana deja la tabla compacta y en su orden',
    table(), [[POT, 'dahernandez@p.co'], [EP, 'aolave@p.co'], [EPV, 'yroncancio@p.co'], ['UNIDAD QUE NO EXISTE', 'x@p.co'], [AUD, 'yprieto@equitel.com.co']]);
  reset(); ctx.usuarios_setResponsables(AUD, ['cgiraldo@p.co', 'yprieto@equitel.com.co']);
  reset(); ctx.usuarios_setResponsables('ADM SISTEMAS', ['dsanchez@equitel.com.co']);
  eq('cambiar: varios responsables y una unidad nueva al final',
    table(), [[POT, 'dahernandez@p.co'], [EP, 'aolave@p.co'], [EPV, 'yroncancio@p.co'], ['UNIDAD QUE NO EXISTE', 'x@p.co'],
      [AUD, 'cgiraldo@p.co'], [AUD, 'yprieto@equitel.com.co'], ['ADM SISTEMAS', 'dsanchez@equitel.com.co']]);
  reset(); ov = ctx.usuarios_setResponsables(EPV, []);
  eq('cambiar: dejar una unidad sin responsable', [table().some((r) => r[0] === EPV), ov.units.find((u) => u.unit === EPV).responsables], [false, []]);
  eq('cambiar: las tarjetas, las sedes y los accesos del dashboard de MISC no se tocan', keepOther(), otherBefore);
  reset();
  eq('cambiar: la regla de otra unidad lee la tabla nueva', ctx._ouApproversByUnit_()[ctx._csNormalize_(POT)].emails, ['dahernandez@p.co']);
  const logSheet = sheets['CAMBIOS RESPONSABLES'];
  ok('constancia: se crea la hoja oculta', logSheet && logSheet.hidden);
  const logRows = logSheet ? logSheet.getRange(1, 1, logSheet.getLastRow(), 5).getValues() : [];
  eq('constancia: encabezados', logRows[0], ['FECHA', 'QUIÉN', 'UNIDAD', 'ANTES', 'AHORA']);
  eq('constancia: el cambio de POTENCIA', logRows[1].slice(1), ['yprieto@equitel.com.co', POT, 'sigarcia@p.co', 'dahernandez@p.co']);
  eq('constancia: quitar a Ana', logRows[2].slice(1), ['yprieto@equitel.com.co', EP, 'aochoa@p.co, aolave@p.co', 'aolave@p.co']);
  reset(); ov = ctx.usuarios_getResponsables();
  ok('vista: el último cambio con fecha y nombre', /25\/11\/2026 .* · PRIETO YURANI/.test(pot().lastChange));

  // ---------------------------------------------------------------------------
  // 5. Panel móvil
  reset();
  const page = ctx.doGet({ parameter: { action: 'admin' }, parameters: {} });
  ok('móvil: ?action=admin sirve el sidebar en modo móvil', /<body data-mode="mobile">/.test(page.getContent()) && /id="mobileLogin"/.test(page.getContent()));
  const old = load({ sidebarHtml: '<!DOCTYPE html><html><body><h2>Gestión de Usuarios</h2></body></html>' });
  const oldPage = old.ctx.doGet({ parameter: { action: 'admin' }, parameters: {} });
  ok('móvil: con un AdminSidebar.html de antes, un aviso (nunca el sidebar sin inicio de sesión)', /se está actualizando/.test(oldPage.getContent()) && !/<h2>Gestión de Usuarios/.test(oldPage.getContent()));
  ok('móvil: AdminMobile.html ya no existe ni se sirve', !fs.existsSync(path.join(ROOT, 'server', 'AdminMobile.html')) && !/createHtmlOutputFromFile\('AdminMobile'\)/.test(SRC));

  reset();
  throws('móvil: sin sesión', () => ctx.mobileAdmin_run('yprieto@equitel.com.co', 'malo', 'usuarios_listAll', []), /Sesión/);
  throws('móvil: con sesión pero sin ser administrador', () => ctx.mobileAdmin_run('sinunidad@p.co', 'ok', 'usuarios_listAll', []), /No autorizado/);
  for (const fn of ['setScriptProperty', 'updateAdminPin', 'constructor', '__proto__', 'toString', 'usuarios_getCatalogoOrg_', '']) {
    throws('móvil: «' + fn + '» no está permitida', () => ctx.mobileAdmin_run('admin@p.co', 'ok', fn, []), /no está disponible/);
  }
  const mlist = ctx.mobileAdmin_run('admin@p.co', 'ok', 'usuarios_listAll', []);
  const m100 = mlist.find((u) => u.cedula === '100');
  eq('móvil: la lista no trae fechas de nacimiento ni celulares, sí la unidad', ['fechaNacimiento' in m100, 'celular' in m100, m100.unidadNegocio], [false, false, POT]);
  reset();
  ok('móvil: el detalle es privado (no se puede llamar con google.script.run)', typeof ctx.usuarios_getUserDetail === 'undefined' && typeof ctx._usuariosGetUserDetail_ === 'function');
  eq('móvil: el detalle de una persona sí', ctx.mobileAdmin_run('admin@p.co', 'ok', 'usuarios_getUserDetail', ['100']), { cedula: '100', fechaNacimiento: '1990-05-06', celular: '3001234567' });
  reset();
  throws('móvil: Laura no cambia responsables aunque use el panel', () => ctx.mobileAdmin_run('admin@p.co', 'ok', 'usuarios_setResponsables', [POT, ['sigarcia@p.co']]), /reservado/);
  reset(); who.active = 'admin@p.co';
  ctx.mobileAdmin_run('dsanchez@equitel.com.co', 'ok', 'usuarios_setResponsables', [POT, ['sigarcia@p.co', 'dahernandez@p.co']]);
  eq('móvil: David los cambia con el correo de su sesión (no el del sidebar)', table().filter((r) => r[0] === POT).map((r) => r[1]), ['sigarcia@p.co', 'dahernandez@p.co']);
  const lastLog = logSheet.getRange(logSheet.getLastRow(), 1, 1, 5).getValues()[0];
  eq('móvil: la constancia dice quién entró al panel', lastLog[1], 'dsanchez@equitel.com.co');
  reset();
  const mov = ctx.mobileAdmin_run('admin@p.co', 'ok', 'usuarios_getResponsables', []);
  eq('móvil: la vista dice si quien entró puede cambiarlos', mov.canEdit, false);
  reset(); ctx.mobileAdmin_run('admin@p.co', 'ok', 'usuarios_update', ['140', base({ unidadNegocio: POT })]);
  eq('móvil: editar la unidad de una persona', unitOf('140'), POT);

  // 6. Todo lo que el sidebar le pide al servidor existe en el panel móvil (navegador y servidor).
  const script = SIDEBAR.slice(SIDEBAR.indexOf('<script>'));
  // La última llamada de cada cadena `prefijo.with…(…).with…(…).función(`: se recorre el código saltando
  // paréntesis anidados y textos entre comillas (los manejadores llevan funciones completas adentro).
  const chainTargets = (prefix) => {
    const out = [];
    let at = script.indexOf(prefix);
    while (at !== -1) {
      let i = at + prefix.length;
      for (;;) {
        while (/\s/.test(script[i])) i++;
        if (script[i] !== '.') break;
        i++;
        const id = /^\w+/.exec(script.slice(i));
        if (!id) break;
        i += id[0].length;
        if (script[i] !== '(') break;
        let depth = 0;
        for (; i < script.length; i++) {
          const ch = script[i];
          if (ch === "'" || ch === '"') { const q = ch; i++; while (i < script.length && script[i] !== q) { if (script[i] === '\\') i++; i++; } continue; }
          if (ch === '(') depth++;
          else if (ch === ')') { depth--; if (depth === 0) { i++; break; } }
        }
        if (!/^with/.test(id[0])) { out.push(id[0]); break; }
      }
      at = script.indexOf(prefix, at + prefix.length);
    }
    return out;
  };
  const called = new Set(chainTargets('gsRun()'));
  if (process.env.VER_LLAMADAS) console.log([...called].sort().join(', '));
  const clientList = (/var MOBILE_FNS = \[([\s\S]*?)\];/.exec(script) || [])[1] || '';
  const client = new Set((clientList.match(/'(\w+)'/g) || []).map((s) => s.slice(1, -1)));
  reset();
  const server = new Set(Object.keys(ctx._adminMobileApi_('x@p.co')));
  const missingClient = [...called].filter((f) => !client.has(f));
  const missingServer = [...called].filter((f) => !server.has(f));
  ok('paridad: el sidebar llama al menos las funciones conocidas (' + [...called].length + ')', called.size >= 19);
  eq('paridad: lo que llama el sidebar está en MOBILE_FNS', missingClient, []);
  eq('paridad: lo que llama el sidebar está en _adminMobileApi_', missingServer, []);
  eq('paridad: MOBILE_FNS y _adminMobileApi_ son la misma lista', [...client].sort(), [...server].sort());
  eq('paridad: no queda ninguna llamada directa a google.script.run salvo el inicio de sesión y la puerta del panel',
    chainTargets('google.script.run').sort(), ['mobileAdmin_run', 'verifyAdminPin']);

  if (failures.length) {
    console.error('✗ Administración de usuarios (#A135): ' + failures.length + ' falla(s):');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('✓ Administración de usuarios (#A135): unidad de cada persona, responsables con sugerencias y permisos, panel móvil con todo el sidebar');
}

main();
