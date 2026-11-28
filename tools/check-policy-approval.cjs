#!/usr/bin/env node
/**
 * Verifica la aprobación del CFO por incumplir la política (#A100): corre
 * `server/Code.gs` completo con una hoja SINTÉTICA en memoria (sin datos reales
 * y sin enviar correos: el envío queda registrado en memoria) y comprueba:
 *   - la anticipación la calcula el servidor (8 días nacional, 30 internacional);
 *   - una solicitud fuera de plazo de un solicitante queda en espera, con su
 *     justificación, sin correo al área de compras y con el aviso al solicitante;
 *     la de un administrador (trazabilidad) sigue normal pero marcada;
 *   - el área de compras no la ve ni la puede gestionar por el API;
 *   - el resumen del CFO: una fila por solicitud, enlaces firmados, urgentes primero;
 *   - aprobar → PENDIENTE_OPCIONES + correo al área de compras; rechazar →
 *     DENEGADO con el motivo, solo al solicitante; enlaces manipulados, repetidos
 *     o de un aprobador anterior no cambian nada;
 *   - vence a los 7 días o al pasar la fecha del viaje;
 *   - los tiempos del flujo empiezan cuando el CFO aprueba;
 *   - tarifa superior a la del manual: marca, voto del CFO (el mismo del
 *     presupuesto) y no se sube la tarifa antes de comprar;
 *   - el interruptor de la configuración apaga las reglas;
 *   - el aviso emergente de la semana del 19-oct y su constancia de lectura;
 *   - el resumen solo en horario laboral (isWorkingHour), como los demás;
 *   - multidestino: si un tramo no cumple, todo el viaje espera, una sola decisión
 *     (aprobar, rechazar o vencer) cubre todos los tramos y se avisa una vez;
 *   - la lista de solo lectura del área de compras (getPolicyHeldRequests).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server', 'Code.gs'), 'utf8');
const TODAY = '2026-10-14';

function headersFromSource() {
  const m = /const HEADERS_REQUESTS = (\[[\s\S]*?\]);/.exec(SRC);
  if (!m) throw new Error('No se encontró HEADERS_REQUESTS en Code.gs');
  // eslint-disable-next-line no-new-func
  const list = new Function('return ' + m[1])();
  ['EVENTOS_JSON', 'COMENTARIOS APROBADORES (JSON)', 'APROBADO PRESUPUESTO', 'REQUIERE APROB PPTO', 'TARIFA RECOMENDADA',
    'TARIFA NOMBRE', 'TARIFA JUSTIFICACION', 'AEROLINEA', 'CANAL DE COMPRA',
    'CAMBIO PEDIDO (JSON)'].forEach((h) => { if (!list.includes(h)) list.push(h); });
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
  // El reloj de Code.gs también queda en TODAY (10 a. m. de Bogotá): la solicitud de ejemplo se crea con
  // new Date() y su anticipación no debe depender del día en que se corre la prueba.
  const NOW = Date.parse(TODAY + 'T15:00:00Z');
  ctx.Date = class extends Date {
    constructor(...a) { super(...(a.length ? a : [NOW])); }
    static now() { return NOW; }
  };
  vm.createContext(ctx);
  new vm.Script(SRC, { filename: 'Code.gs' }).runInContext(ctx);
  if (typeof ctx.processPolicyDecision !== 'function') throw new Error('No se encontró processPolicyDecision() en server/Code.gs');
  // Entorno controlado
  ctx._todayBogotaIso_ = () => TODAY;
  ctx.isWorkingHour = () => false; // cada prueba del resumen fija el horario
  ctx._isCreateRequestRateLimited_ = () => false; // la prueba crea más de 10 solicitudes del mismo solicitante
  ctx.isUserAnalyst = (e) => ['admin@p.co', 'yprieto@equitel.com.co', 'dsanchez@equitel.com.co'].includes(String(e || '').toLowerCase());
  ctx.isSuperAdmin = () => false;
  ctx.validateUserSession_ = () => true;
  ctx.validateUserEmail_ = () => true;
  ctx.getCostCenterData = () => [];
  ctx._resolveApproverForFirstPassenger_ = () => ({ email: 'jefe@p.co', name: 'JEFE' });
  ctx._assertPassportsForInternational_ = () => {};
  ctx.sendEmailRich = (to, subject, html, cc) => { log.mails.push({ to, subject, html, cc: cc === undefined ? '(admin)' : cc }); };
  ctx._sendMail_ = (o) => { log.mails.push({ to: o.to, subject: o.subject, html: o.body || '', cc: '' }); };
  return { ctx, req, users, sheets, props, log, H };
}

function main() {
  let env;
  try { env = load(); } catch (e) { console.error('✗ No se pudo cargar server/Code.gs para la aprobación por política:\n  ' + e.stack); process.exit(1); }
  const { ctx, req, sheets, props, log } = env;
  const failures = [];
  const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: da ${JSON.stringify(got)}, se esperaba ${JSON.stringify(want)}`); };
  const ok = (name, cond) => { if (!cond) failures.push(name); };
  const col = (h) => req[0].indexOf(h);
  const rowOf = (id) => req.find((r) => r[col('ID RESPUESTA')] === id);
  const cell = (id, h) => { const r = rowOf(id); const i = col(h); return r && i >= 0 ? r[i] : undefined; };
  const setCell = (id, h, v) => { rowOf(id)[col(h)] = v; ctx._resetPerExecutionCaches_(); };
  const reset = () => ctx._resetPerExecutionCaches_();
  const mailsTo = (to) => log.mails.filter((m) => String(m.to).toLowerCase() === to);
  const ADMIN = ctx.getConfig_ ? 'compras.equitel@equitel.com.co' : '';
  const CFO = 'agdg@equitel.com.co';
  // DD-MM-AAAA a n días de hoy (2026-10-14)
  const day = (n) => { const d = new Date(Date.UTC(2026, 9, 14 + n)); return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`; };
  const base = (over) => Object.assign({
    company: 'Equitel', origin: 'BOGOTA, COLOMBIA', destination: 'MEDELLIN, COLOMBIA', departureDate: day(3), returnDate: day(4),
    passengers: [{ name: 'PEREZ ANA', idNumber: '100', email: 'ana@p.co' }], requesterEmail: 'ana@p.co', costCenter: 'CC1', businessUnit: 'ENERGIA PROYECTOS',
    site: 'BOGOTA', requestMode: 'FLIGHT', isInternational: false, policyViolation: true, comments: 'Visita técnica', requiresHotel: false,
  }, over || {});
  const create = (data, user) => { reset(); return ctx.dispatch('createRequest', { userEmail: user || 'ana@p.co', sessionToken: 't', data: Object.assign({}, data), emailHtml: '<p>{{REQUEST_ID}}{{ACTION_BUTTONS}}</p>' }); };

  // 1. Anticipación calculada en el servidor
  eq('anticipación: nacional a 7 días no cumple, a 8 sí', [ctx._policyLeadCheck_(day(7), false).violates, ctx._policyLeadCheck_(day(8), false).violates], [true, false]);
  eq('anticipación: internacional a 29 días no cumple, a 30 sí', [ctx._policyLeadCheck_(day(29), true).violates, ctx._policyLeadCheck_(day(30), true).violates], [true, false]);
  eq('anticipación: acepta AAAA-MM-DD y días', [ctx._policyLeadCheck_('2026-10-17', false).days, ctx._policyLeadCheck_('', false).known], [3, false]);

  // 2. Fuera de plazo, solicitante → en espera
  log.mails.length = 0;
  let r = create(base({ policyJustification: '  El cliente confirmó   la visita ayer.  ' }));
  ok('crear fuera de plazo: responde el ID', r.success && /^SOL-/.test(r.data));
  const HELD1 = r.data;
  eq('fuera de plazo: queda en espera del CFO', cell(HELD1, 'STATUS'), 'PENDIENTE_APROBACION_POLITICA');
  eq('fuera de plazo: marcada', cell(HELD1, 'VIOLACION POLITICA'), 'SI');
  eq('justificación en su columna, espacios colapsados', cell(HELD1, 'JUSTIFICACION ANTICIPACION'), 'El cliente confirmó la visita ayer.');
  eq('fuera de plazo: nada al área de compras', log.mails.filter((m) => /compras\.equitel/.test(m.to)).length, 0);
  const notice = mailsTo('ana@p.co');
  ok('fuera de plazo: el solicitante recibe la explicación', notice.length === 1 && /EN ESPERA DE APROBACIÓN/.test(notice[0].subject) && /Alejandro Gómez de Greiff/.test(notice[0].html) && /8 días/.test(notice[0].html));
  const ev1 = JSON.parse(cell(HELD1, 'EVENTOS_JSON') || '{}');
  ok('eventos: created y policyHold', !!ev1.created && !!ev1.policyHold);

  // justificación corta → error y no crea nada
  const rowsBefore = req.length;
  r = create(base({ policyJustification: 'corto' }));
  ok('justificación de menos de 10 caracteres: error', !r.success && /mínimo 10/.test(r.error));
  eq('justificación inválida: no se crea fila', req.length, rowsBefore);

  // app anterior (sin la clave) y navegador que dice que sí cumple: el servidor manda
  r = create(base({ policyViolation: false, destination: 'CALI, COLOMBIA', departureDate: day(1), returnDate: '' }));
  const HELD2 = r.data;
  eq('app anterior: igual queda en espera (sin justificación)', [cell(HELD2, 'STATUS'), cell(HELD2, 'VIOLACION POLITICA'), cell(HELD2, 'JUSTIFICACION ANTICIPACION')], ['PENDIENTE_APROBACION_POLITICA', 'SI', '']);

  // solo hospedaje también
  r = create(base({ requestMode: 'HOTEL_ONLY', origin: '', destination: 'BARRANQUILLA, COLOMBIA', departureDate: day(5), returnDate: day(7), requiresHotel: true, policyJustification: 'Reunión con cliente agendada hoy.' }));
  const HELD3 = r.data;
  eq('solo hospedaje fuera de plazo: en espera', cell(HELD3, 'STATUS'), 'PENDIENTE_APROBACION_POLITICA');

  // administrador (trazabilidad) → sigue normal, marcada
  log.mails.length = 0;
  r = create(base({ requesterEmail: 'admin@p.co', policyJustification: 'Viaje ya comprado por fuera.' }), 'admin@p.co');
  const ADMIN1 = r.data;
  eq('creada por administrador: flujo normal y marcada', [cell(ADMIN1, 'STATUS'), cell(ADMIN1, 'VIOLACION POLITICA')], ['PENDIENTE_OPCIONES', 'SI']);
  ok('creada por administrador: le llega al área de compras', log.mails.some((m) => /compras\.equitel/.test(m.to)));

  // dentro de plazo → normal, sin marca aunque el navegador diga lo contrario
  r = create(base({ departureDate: day(10), returnDate: day(12), policyViolation: true }));
  const OK1 = r.data;
  eq('dentro de plazo: normal y sin marca', [cell(OK1, 'STATUS'), cell(OK1, 'VIOLACION POLITICA')], ['PENDIENTE_OPCIONES', 'NO']);

  // internacional a 20 días → en espera
  r = create(base({ isInternational: true, destination: 'MIAMI, ESTADOS UNIDOS', departureDate: day(20), returnDate: day(25), policyJustification: 'Feria del sector confirmada.' }));
  const HELD4 = r.data;
  eq('internacional a 20 días: en espera', cell(HELD4, 'STATUS'), 'PENDIENTE_APROBACION_POLITICA');

  // 3. El área de compras no la ve ni la gestiona
  reset();
  const lite = ctx.getAllRequestsLite().map((x) => x.requestId);
  ok('lista del área de compras: sin las que esperan al CFO', !lite.includes(HELD1) && lite.includes(ADMIN1) && lite.includes(OK1));
  reset();
  ok('lista completa (getAllRequests): sin las que esperan', !ctx.getAllRequests().some((x) => x.requestId === HELD1));
  reset();
  const mine = ctx.getMyRequestsLite('ana@p.co').find((x) => x.requestId === HELD1);
  ok('el solicitante sí la ve, con quién aprueba y su justificación', mine && mine.status === 'PENDIENTE_APROBACION_POLITICA' && mine.policyApproverName === 'Alejandro Gómez de Greiff' && mine.policyJustification === 'El cliente confirmó la visita ayer.');
  for (const [action, payload] of [['updateRequest', { id: HELD1, status: 'PENDIENTE_SELECCION' }], ['uploadOptionImage', { requestId: HELD1 }], ['registerReservation', { requestId: HELD1 }], ['requestModification', { requestId: HELD1 }]]) {
    reset();
    const res = ctx.dispatch(action, Object.assign({ userEmail: 'admin@p.co', sessionToken: 't' }, payload));
    ok(`API: ${action} sobre una en espera se rechaza`, !res.success && /espera la aprobación/.test(res.error));
  }
  eq('API: el estado no cambió', cell(HELD1, 'STATUS'), 'PENDIENTE_APROBACION_POLITICA');
  eq('formulario: aplica al solicitante, no al administrador', [ctx._policyApprovalPublicInfo_('ana@p.co').appliesToUser, ctx._policyApprovalPublicInfo_('admin@p.co').appliesToUser, ctx._policyApprovalPublicInfo_('ana@p.co').approverName], [true, false, 'Alejandro Gómez de Greiff']);

  // 4. Resumen del CFO
  log.mails.length = 0;
  reset();
  const listed = ctx._policySendDigest_(true);
  eq('resumen: lista las 4 en espera', listed, 4);
  const dig = mailsTo(CFO);
  ok('resumen: un solo correo al CFO con el asunto claro', dig.length === 1 && /incumplimiento de la política de anticipación: 4 solicitudes pendientes/.test(dig[0].subject));
  if (!dig.length) { console.error('✗ Aprobación del CFO por la política (#A100): no salió el resumen. Fallas hasta aquí:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  const html = dig[0].html;
  ok('resumen: una fila por solicitud con Aprobar y Rechazar', (html.match(/action=policy_decision/g) || []).length === 8 && (html.match(/APROBAR</g) || []).length === 4);
  ok('resumen: urgentes primero (sale mañana antes que pasado mañana)', html.indexOf(HELD2) < html.indexOf(HELD1));
  ok('resumen: quién la pidió, quién viaja, justificación y anticipación', /PEREZ ANA/.test(html) && /El cliente confirmó la visita ayer\./.test(html) && /3 días antes/.test(html) && /la política pide 8/.test(html));
  ok('resumen: la de la app anterior dice que no hay justificación', /No la escribió/.test(html));
  ok('resumen: enlaces con el dominio del web app y sin datos de sesión', !/sessionToken/.test(html));
  const links = [...html.matchAll(/href="([^"]*action=policy_decision[^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  const params = (u) => Object.fromEntries(new URL(u).searchParams.entries());
  const linkFor = (id, decision) => params(links.find((u) => u.includes('id=' + encodeURIComponent(id)) && u.includes('decision=' + decision)));

  // 5. Decisiones
  reset();
  let page = ctx.processPolicyDecision({ parameter: linkFor(HELD1, 'approved') });
  ok('aprobar: primero una página para confirmar, con los datos', /¿Aprobar la excepción\?/.test(page.html) && /El cliente confirmó la visita ayer\./.test(page.html));
  eq('aprobar: la página no cambia nada', cell(HELD1, 'STATUS'), 'PENDIENTE_APROBACION_POLITICA');
  log.mails.length = 0;
  reset();
  page = ctx.processPolicyDecision({ parameter: Object.assign(linkFor(HELD1, 'approved'), { confirm: 'true', comment: 'Solo el tiquete, sin hotel.' }) });
  ok('aprobar: confirmación', /Excepción aprobada/.test(page.html));
  eq('aprobar: entra al flujo normal', cell(HELD1, 'STATUS'), 'PENDIENTE_OPCIONES');
  ok('aprobar: decisión registrada', /^Sí_agdg@equitel\.com\.co_/.test(cell(HELD1, 'APROBACION CFO ANTICIPACION')));
  const evA = JSON.parse(cell(HELD1, 'EVENTOS_JSON'));
  ok('aprobar: eventos policyApproved y policyDecision', !!evA.policyApproved && evA.policyDecision && evA.policyDecision.decision === 'approved');
  ok('aprobar: comentario del CFO guardado', /Solo el tiquete, sin hotel\./.test(cell(HELD1, 'COMENTARIOS APROBADORES (JSON)')) && /POLICY_EXCEPTION/.test(cell(HELD1, 'COMENTARIOS APROBADORES (JSON)')));
  const toAdmin = log.mails.filter((m) => /compras\.equitel/.test(m.to));
  ok('aprobar: le llega al área de compras como nueva, con copia al solicitante', toAdmin.length === 1 && /APROBADA POR EXCEPCIÓN/.test(toAdmin[0].subject) && /ana@p\.co/.test(toAdmin[0].cc));
  reset();
  ok('aprobada: ahora sí la ve el área de compras', ctx.getAllRequestsLite().some((x) => x.requestId === HELD1));
  reset();
  page = ctx.processPolicyDecision({ parameter: Object.assign(linkFor(HELD1, 'denied'), { confirm: 'true' }) });
  ok('segundo clic (rechazar una ya aprobada): sin cambios', /Sin cambios/.test(page.html) && cell(HELD1, 'STATUS') === 'PENDIENTE_OPCIONES');

  log.mails.length = 0;
  reset();
  page = ctx.processPolicyDecision({ parameter: Object.assign(linkFor(HELD2, 'denied'), { confirm: 'true', comment: 'Debe planearse con tiempo.' }) });
  eq('rechazar: denegada', cell(HELD2, 'STATUS'), 'DENEGADO');
  ok('rechazar: motivo automático + comentario en observaciones', /No se aprobó la excepción por incumplimiento de la política de anticipación\. Comentario: Debe planearse con tiempo\./.test(cell(HELD2, 'OBSERVACIONES')));
  ok('rechazar: decisión registrada', /^No_agdg@equitel\.com\.co_/.test(cell(HELD2, 'APROBACION CFO ANTICIPACION')));
  // #A118: además, el CFO recibe la confirmación de su decisión (no cuenta como aviso a terceros).
  const denyMails = log.mails.filter((m) => m.to !== CFO);
  ok('rechazar: correo solo al solicitante, con el motivo', denyMails.length === 1 && denyMails[0].to === 'ana@p.co' && /incumplimiento de la política/.test(denyMails[0].html) && !/compras\.equitel/.test(String(denyMails[0].cc)));
  ok('rechazar: confirmación al CFO (#A118)', mailsTo(CFO).length === 1 && /EXCEPCIÓN RECHAZADA/.test(mailsTo(CFO)[0].html) && /Debe planearse con tiempo\./.test(mailsTo(CFO)[0].html));

  reset();
  const bad = Object.assign(linkFor(HELD3, 'approved'), { confirm: 'true' });
  bad.sig = bad.sig.replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
  page = ctx.processPolicyDecision({ parameter: bad });
  ok('enlace manipulado: inválido y sin cambios', /Enlace inválido/.test(page.html) && cell(HELD3, 'STATUS') === 'PENDIENTE_APROBACION_POLITICA');
  reset();
  page = ctx.processPolicyDecision({ parameter: Object.assign(linkFor(HELD3, 'approved'), { id: HELD4, confirm: 'true' }) });
  ok('enlace de otra solicitud: inválido', /Enlace inválido/.test(page.html) && cell(HELD4, 'STATUS') === 'PENDIENTE_APROBACION_POLITICA');

  // Cambio de aprobador en la configuración del dashboard
  const cfg = JSON.parse(JSON.stringify(ctx._csDefaultConfig_()));
  cfg.budgetApproverEmail = 'nuevo.cfo@p.co'; cfg.budgetApproverName = 'Nuevo CFO';
  props.COSTS_DASHBOARD_CONFIG = JSON.stringify(cfg);
  reset();
  page = ctx.processPolicyDecision({ parameter: Object.assign(linkFor(HELD3, 'approved'), { confirm: 'true' }) });
  ok('aprobador cambiado: los enlaces del anterior ya no sirven', /Enlace ya no válido/.test(page.html) && /Nuevo CFO/.test(page.html) && cell(HELD3, 'STATUS') === 'PENDIENTE_APROBACION_POLITICA');
  log.mails.length = 0;
  reset();
  ctx._policySendDigest_(true);
  ok('aprobador cambiado: el resumen le llega al nuevo', mailsTo('nuevo.cfo@p.co').length === 1 && mailsTo(CFO).length === 0);
  delete props.COSTS_DASHBOARD_CONFIG;

  // 6. Vencimiento: 7 días o la fecha del viaje
  r = create(base({ departureDate: day(6), returnDate: '', policyJustification: 'Capacitación reprogramada.' }));
  const OLD = r.data;
  setCell(OLD, 'FECHA SOLICITUD', new Date('2026-10-07T10:00:00-05:00'));
  r = create(base({ departureDate: day(2), returnDate: '', policyJustification: 'Capacitación reprogramada.' }));
  const PAST = r.data;
  setCell(PAST, 'FECHA IDA', '13-10-2026');
  log.mails.length = 0;
  reset();
  const run = ctx.procesarAprobacionesPolitica();
  eq('vencidas: 7 días desde que se pidió y fecha del viaje pasada', run.expired.slice().sort(), [OLD, PAST].sort());
  eq('vencidas: denegadas por el sistema', [cell(OLD, 'STATUS'), String(cell(PAST, 'APROBACION CFO ANTICIPACION')).slice(0, 16)], ['DENEGADO', 'Vencida_sistema_']);
  ok('vencidas: motivo de vencimiento', /nadie la aprobó antes del plazo/.test(cell(OLD, 'OBSERVACIONES')));
  eq('vencidas: las demás siguen en espera', [cell(HELD3, 'STATUS'), cell(HELD4, 'STATUS')], ['PENDIENTE_APROBACION_POLITICA', 'PENDIENTE_APROBACION_POLITICA']);
  ok('vencidas: avisa a cada solicitante', log.mails.filter((m) => m.to === 'ana@p.co').length >= 2);

  // Aprobar después de la fecha del viaje (antes de la pasada automática): queda vencida
  r = create(base({ departureDate: day(2), returnDate: '', policyJustification: 'Capacitación reprogramada.' }));
  const LATE = r.data;
  reset();
  ctx._policySendDigest_(true);
  const lateLinks = [...log.mails[log.mails.length - 1].html.matchAll(/href="([^"]*action=policy_decision[^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  const lateApprove = params(lateLinks.find((u) => u.includes('id=' + encodeURIComponent(LATE)) && u.includes('decision=approved')));
  setCell(LATE, 'FECHA IDA', '12-10-2026');
  page = ctx.processPolicyDecision({ parameter: Object.assign(lateApprove, { confirm: 'true' }) });
  ok('aprobar con el viaje ya pasado: no entra al flujo, queda vencida', /Fecha del viaje vencida/.test(page.html) && cell(LATE, 'STATUS') === 'DENEGADO' && /^Vencida_sistema_/.test(cell(LATE, 'APROBACION CFO ANTICIPACION')));

  // Anular una en espera: sin aviso al área de compras
  log.mails.length = 0;
  reset();
  const canc = ctx.dispatch('cancelOwnRequest', { userEmail: 'ana@p.co', sessionToken: 't', requestId: HELD4, reason: 'Ya no viajo' });
  ok('anular en espera: queda anulada sin correo al área de compras', canc.success && cell(HELD4, 'STATUS') === 'ANULADO' && !log.mails.some((m) => /compras\.equitel/.test(m.to)));

  // Horario laboral: fuera de él no sale el resumen (sí se deniegan las vencidas)
  log.mails.length = 0;
  reset();
  ctx.isWorkingHour = () => false;
  ctx.procesarAprobacionesPolitica();
  eq('fuera del horario laboral: no le llega nada al CFO', mailsTo(CFO).length, 0);
  ctx.isWorkingHour = () => true;
  reset();
  ctx.procesarAprobacionesPolitica();
  eq('en horario laboral: le llega el resumen', mailsTo(CFO).length, 1);
  ctx.isWorkingHour = () => false;

  // Multidestino: el tramo 1 no cumple → todo el viaje espera; una sola decisión
  const leg = (key, n, total, dep, extra) => base(Object.assign({ departureDate: day(dep), returnDate: '', multiGroupKey: key, multiGroupIndex: n, multiGroupTotal: total,
    policyGroupHold: true, policyJustification: 'Reunión con cliente confirmada ayer.', comments: '[MULTIDESTINO] Tramo ' + n + '/' + total + ' · Itinerario: x\nVisita' }, extra || {}));
  log.mails.length = 0;
  const G1 = [create(leg('MD-viajeuno01', 1, 3, 3)).data, create(leg('MD-viajeuno01', 2, 3, 9, { origin: 'MEDELLIN, COLOMBIA', destination: 'CALI, COLOMBIA' })).data,
    create(leg('MD-viajeuno01', 3, 3, 12, { origin: 'CALI, COLOMBIA', destination: 'BOGOTA, COLOMBIA' })).data];
  eq('multidestino: los 3 tramos esperan (aunque el 2 y el 3 cumplan)', G1.map((id) => cell(id, 'STATUS')), Array(3).fill('PENDIENTE_APROBACION_POLITICA'));
  eq('multidestino: cada tramo con su propia marca de anticipación', G1.map((id) => cell(id, 'VIOLACION POLITICA')), ['SI', 'NO', 'NO']);
  eq('multidestino: enlazados', G1.map((id) => cell(id, 'GRUPO MULTIDESTINO')), Array(3).fill('MD-viajeuno01'));
  eq('multidestino: un solo correo al solicitante, que lo explica', [mailsTo('ana@p.co').length, /multidestino de <strong>3 tramos/.test((mailsTo('ana@p.co')[0] || {}).html || '')], [1, true]);
  // sin la marca del formulario: si ya hay un tramo del viaje en espera, el siguiente también espera
  const G2 = [create(leg('MD-viajedos02', 1, 2, 2, { policyGroupHold: undefined })).data, create(leg('MD-viajedos02', 2, 2, 15, { policyGroupHold: undefined, origin: 'MEDELLIN, COLOMBIA', destination: 'BOGOTA, COLOMBIA' })).data];
  eq('multidestino: el tramo que cumple espera si otro del viaje ya espera', G2.map((id) => cell(id, 'STATUS')), Array(2).fill('PENDIENTE_APROBACION_POLITICA'));
  reset();
  const panel = ctx.getPolicyHeldRequests();
  const g1Item = panel.items.find((it) => it.ids.includes(G1[0]));
  ok('lista del área de compras: el viaje multidestino es una sola entrada con sus 3 tramos', g1Item && g1Item.ids.join() === G1.join() && g1Item.legs.length === 3 && g1Item.id === G1[0]);
  ok('lista del área de compras: trae quién aprueba y la justificación', panel.approverName === 'Alejandro Gómez de Greiff' && g1Item.justification === 'Reunión con cliente confirmada ayer.');
  reset();
  const resA = ctx.dispatch('getPolicyHeldRequests', { userEmail: 'ana@p.co', sessionToken: 't' });
  ok('lista del área de compras: solo administradores', !resA.success);
  log.mails.length = 0;
  reset();
  ctx._policySendDigest_(true);
  const dg = mailsTo(CFO)[0].html;
  ok('resumen: el viaje multidestino es una fila con Aprobar y Rechazar', (dg.match(new RegExp('id=' + G1[0] + '&', 'g')) || []).length === 2 && !new RegExp('id=' + G1[1] + '&').test(dg) && /Viaje multidestino de 3 tramos/.test(dg));
  const gLinks = [...dg.matchAll(/href="([^"]*action=policy_decision[^"]*)"/g)].map((m) => params(m[1].replace(/&amp;/g, '&')));
  log.mails.length = 0;
  reset();
  page = ctx.processPolicyDecision({ parameter: Object.assign(gLinks.find((q) => q.id === G1[0] && q.decision === 'approved'), { confirm: 'true' }) });
  eq('multidestino: aprobar el viaje libera los 3 tramos', G1.map((id) => cell(id, 'STATUS')), Array(3).fill('PENDIENTE_OPCIONES'));
  eq('multidestino: al área de compras le llega cada tramo como nuevo', log.mails.filter((m) => /compras\.equitel/.test(m.to)).length, 3);
  log.mails.length = 0;
  reset();
  page = ctx.processPolicyDecision({ parameter: Object.assign(gLinks.find((q) => q.id === G2[0] && q.decision === 'denied'), { confirm: 'true' }) });
  eq('multidestino: rechazar el viaje deniega todos los tramos', G2.map((id) => cell(id, 'STATUS')), ['DENEGADO', 'DENEGADO']);
  const groupDeny = log.mails.filter((m) => m.to !== CFO);
  ok('multidestino: un solo correo de rechazo, que nombra los demás tramos', groupDeny.length === 1 && new RegExp(G2[1]).test(groupDeny[0].html));
  ok('multidestino: una sola confirmación al CFO, con todos los tramos (#A118)', mailsTo(CFO).length === 1 && G2.every((id) => mailsTo(CFO)[0].html.includes(id)));
  // vencimiento conjunto: pasó la fecha del primer tramo
  const G3 = [create(leg('MD-viajetres3', 1, 2, 2)).data, create(leg('MD-viajetres3', 2, 2, 20, { origin: 'MEDELLIN, COLOMBIA', destination: 'BOGOTA, COLOMBIA' })).data];
  setCell(G3[0], 'FECHA IDA', '13-10-2026');
  log.mails.length = 0;
  reset();
  const run2 = ctx.procesarAprobacionesPolitica();
  ok('multidestino: vence el viaje completo, con un solo aviso', G3.every((id) => run2.expired.includes(id) && cell(id, 'STATUS') === 'DENEGADO') && log.mails.filter((m) => m.to === 'ana@p.co').length === 1);
  // un administrador registrando un multidestino: no espera
  const GA = create(leg('MD-viajeadm4', 1, 1, 3, { requesterEmail: 'admin@p.co' }), 'admin@p.co').data;
  eq('multidestino creado por un administrador: no espera', cell(GA, 'STATUS'), 'PENDIENTE_OPCIONES');

  // 7. Disparador
  ctx.activarAprobacionesPolitica();
  eq('disparador: uno, cada 2 horas', [log.triggers.filter((t) => t === 'procesarAprobacionesPolitica').length, log.everyHours], [1, 2]);
  ctx.activarAprobacionesPolitica();
  eq('disparador: activar dos veces no lo duplica', log.triggers.filter((t) => t === 'procesarAprobacionesPolitica').length, 1);
  // Producción (14-oct): el manifiesto no tiene script.scriptapp. El menú 13 da los pasos para
  // crearlo a mano en Activadores y el menú 14 sigue funcionando (sin decir «NO ACTIVO»).
  const realScriptApp = ctx.ScriptApp;
  const denied = () => { throw new Error('Los permisos especificados no son suficientes para llamar a ScriptApp.getProjectTriggers.'); };
  ctx.ScriptApp = { getProjectTriggers: denied, deleteTrigger: denied, newTrigger: denied };
  log.alerts.length = 0;
  const manual = ctx.activarAprobacionesPolitica();
  ok('disparador sin permiso: el menú 13 explica cómo crearlo a mano', /Activadores/.test(manual) && /procesarAprobacionesPolitica/.test(manual) && /Cada 2 horas/.test(manual) && log.alerts.length === 1);
  ok('disparador sin permiso: quitarlo explica cómo borrarlo a mano', /Borrar activador/.test(ctx.desactivarAprobacionesPolitica()));
  log.alerts.length = 0;
  ctx.menuVerAprobacionesPolitica();
  ok('disparador sin permiso: el menú 14 abre y remite a Activadores', log.alerts.length === 1 && !/^Error/.test(log.alerts[0]) && /revíselo en Activadores/.test(log.alerts[0]));
  ctx.ScriptApp = realScriptApp;
  log.alerts.length = 0;
  ctx.menuVerAprobacionesPolitica();
  ok('disparador con permiso: el menú 14 dice que está activo', /Resumen cada 2 h: activo/.test(log.alerts[0] || ''));

  // 8. Métricas: el área de compras cuenta desde la aprobación
  const t0 = '2026-10-13T14:00:00.000Z', t1 = '2026-10-14T14:00:00.000Z', t2 = '2026-10-14T16:00:00.000Z';
  const fake = ['SOL-X', 'a@p.co', 'CALI', 'Equitel', 'PENDIENTE_SELECCION'];
  const m1 = ctx._buildRequestMetrics_('SOL-X', fake, 1, 2, 3, 4, { created: t0, policyApproved: t1, optionsUploaded: t2 });
  eq('métricas: tiempo a opciones desde la aprobación del CFO', m1.timeToOptionsMinutes, ctx._realMinutesBetween_(t1, t2));
  const m2 = ctx._buildRequestMetrics_('SOL-X', fake, 1, 2, 3, 4, { created: t0, optionsUploaded: t2 });
  eq('métricas: sin espera, desde la creación (horas reales, #A121)', m2.timeToOptionsMinutes, ctx._realMinutesBetween_(t0, t2));

  // 9. Tarifa superior a la del manual
  eq('tarifa superior: solo si sube y es excepción', [ctx._fareIsAboveManual_('TIPO 2', 'TIPO 1', 'Lleva herramienta'), ctx._fareIsAboveManual_('TIPO 3', 'TIPO 2', ''),
    ctx._fareIsAboveManual_('TIPO 1', 'TIPO 2', 'x'), ctx._fareIsAboveManual_('TIPO 2', '', 'x')], [true, false, false, false]);
  // #A137: con OT no se le pide nada al CFO; sin OT, el presupuesto y la tarifa sí.
  eq('voto del CFO: presupuesto o tarifa, y la OT lo quita', [ctx._requiresCfoVote_('SI', '', ''), ctx._requiresCfoVote_('SI', 'OT-CUBTA-110256', ''), ctx._requiresCfoVote_('', 'OT-CUBTA-110256', 'SI'), ctx._requiresCfoVote_('', '', 'SI'), ctx._requiresCfoVote_('', '', '')], [true, false, false, true, false]);
  const FARE = OK1;
  setCell(FARE, 'TIPO DE COMPRA DE TKT', 'TIPO 2'); setCell(FARE, 'TARIFA RECOMENDADA', 'TIPO 1'); setCell(FARE, 'TARIFA NOMBRE', 'Light'); setCell(FARE, 'TARIFA JUSTIFICACION', 'El técnico lleva herramienta.');
  reset();
  const sh = sheets['Nueva Base Solicitudes'];
  const rn = () => req.indexOf(rowOf(FARE)) + 1;
  eq('confirmar costos con tarifa superior: marca SI', [ctx._updateFareCfoFlag_(sh, rn()), cell(FARE, 'REQUIERE APROB TARIFA')], [true, 'SI']);
  ok('confirmar costos: nota en observaciones', /\[TARIFA\]: TIPO 2 \(Light\) es superior a la del manual \(TIPO 1\)/.test(cell(FARE, 'OBSERVACIONES')));
  reset();
  let mapped = ctx.mapRowToRequest(rowOf(FARE));
  eq('detalle: el CFO vota por la tarifa, sin presupuesto excedido', [mapped.requiresBudgetOverrunApproval, mapped.budgetExceeded, mapped.requiresFareApproval, mapped.effectiveApprovalBudgetOverrun], [true, false, true, 'PENDING']);
  setCell(FARE, 'APROBADO PRESUPUESTO', 'Sí_agdg@equitel.com.co_14/10/2026 9:00');
  reset();
  mapped = ctx.mapRowToRequest(rowOf(FARE));
  eq('detalle: con el voto del CFO, aprobado', mapped.effectiveApprovalBudgetOverrun, 'APPROVED');
  setCell(FARE, 'TIPO DE COMPRA DE TKT', 'TIPO 1'); setCell(FARE, 'TARIFA JUSTIFICACION', '');
  reset();
  eq('reconfirmar con la tarifa del manual: limpia la marca', [ctx._updateFareCfoFlag_(sh, rn()), cell(FARE, 'REQUIERE APROB TARIFA')], [false, '']);

  // Motor de aprobación: con la marca de tarifa, el voto del área no basta; el del CFO completa.
  r = create(base({ departureDate: day(12), returnDate: day(13) }));
  const APR = r.data;
  setCell(APR, 'STATUS', 'PENDIENTE_APROBACION'); setCell(APR, 'COSTO COTIZADO PARA VIAJE', 600000);
  setCell(APR, 'CORREO DE QUIEN APRUEBA (AUTOMÁTICO)', 'jefe@p.co'); setCell(APR, 'REQUIERE APROB TARIFA', 'SI');
  const vote = (role, actor) => {
    const sg = ctx._newApprovalLinkSig_('approve', APR, 'approved', role, actor);
    reset();
    return ctx.processApprovalFromEmail({ parameter: { id: APR, decision: 'approved', role, actor, t: sg.t, sig: sg.sig, confirm: 'true' } });
  };
  vote('NORMAL', 'jefe@p.co');
  eq('aprobación: con tarifa superior, el área sola no la aprueba', cell(APR, 'STATUS'), 'PENDIENTE_APROBACION');
  vote('BUDGET_OVERRUN', CFO);
  eq('aprobación: con el voto del CFO queda APROBADO', [cell(APR, 'STATUS'), String(cell(APR, 'APROBADO PRESUPUESTO')).slice(0, 23)], ['APROBADO', 'Sí_agdg@equitel.com.co_']);
  setCell(APR, 'STATUS', 'PENDIENTE_APROBACION'); setCell(APR, 'REQUIERE APROB TARIFA', ''); setCell(APR, 'APROBADO PRESUPUESTO', '');
  setCell(APR, 'APROBADO POR ÁREA? (AUTOMÁTICO)', ''); setCell(APR, 'FECHA/HORA (AUTOMÁTICO)', '');
  vote('NORMAL', 'jefe@p.co');
  eq('aprobación: sin marca de tarifa (ni presupuesto), el área basta (igual que antes)', cell(APR, 'STATUS'), 'APROBADO');

  // No subir la tarifa antes de comprar
  // viaje de 1 noche: el manual pide TIPO 1
  setCell(FARE, 'FECHA VUELTA', day(11));
  setCell(FARE, 'STATUS', 'APROBADO'); setCell(FARE, 'TIPO DE COMPRA DE TKT', 'TIPO 1'); setCell(FARE, 'AEROLINEA', 'LATAM');
  reset();
  let sp = ctx.dispatch('setPurchaseInfo', { userEmail: 'admin@p.co', sessionToken: 't', requestId: FARE, airline: 'LATAM', channel: 'Aviatur', fareOption: '2', fareJustification: 'El técnico lleva herramienta.' });
  ok('registrar compra con tarifa superior a la aprobada: bloqueado', !sp.success && /Sin la aprobación de/.test(sp.error) && cell(FARE, 'TIPO DE COMPRA DE TKT') === 'TIPO 1');
  reset();
  sp = ctx.dispatch('setPurchaseInfo', { userEmail: 'yprieto@equitel.com.co', sessionToken: 't', requestId: FARE, airline: 'LATAM', channel: 'Aviatur', fareOption: '2', fareJustification: 'El técnico lleva herramienta.' });
  ok('Yurani o David sí pueden autorizarla', sp.success && cell(FARE, 'TIPO DE COMPRA DE TKT') === 'TIPO 2');
  setCell(FARE, 'TIPO DE COMPRA DE TKT', 'TIPO 2'); setCell(FARE, 'STATUS', 'APROBADO');
  reset();
  sp = ctx.dispatch('setPurchaseInfo', { userEmail: 'admin@p.co', sessionToken: 't', requestId: FARE, airline: 'LATAM', channel: 'Aviatur', fareOption: '2', fareJustification: 'El técnico lleva herramienta.' });
  ok('registrar la misma tarifa aprobada: permitido', sp.success);
  setCell(FARE, 'STATUS', 'RESERVADO'); setCell(FARE, 'TIPO DE COMPRA DE TKT', 'TIPO 1');
  reset();
  sp = ctx.dispatch('setPurchaseInfo', { userEmail: 'admin@p.co', sessionToken: 't', requestId: FARE, airline: 'LATAM', channel: 'Aviatur', fareOption: '3', fareJustification: 'Corrección: se compró Full.' });
  ok('corregir lo ya comprado (RESERVADO): permitido, refleja lo real', sp.success);

  // 10. Interruptor
  const off = JSON.parse(JSON.stringify(ctx._csDefaultConfig_()));
  off.policyApprovalEnabled = false;
  props.COSTS_DASHBOARD_CONFIG = JSON.stringify(off);
  r = create(base({ policyJustification: 'Cliente confirmó ayer.' }));
  eq('interruptor apagado: flujo normal, pero marcada', [cell(r.data, 'STATUS'), cell(r.data, 'VIOLACION POLITICA')], ['PENDIENTE_OPCIONES', 'SI']);
  delete props.COSTS_DASHBOARD_CONFIG;
  eq('configuración: el interruptor debe ser booleano', [ctx._csIsConfigValid_(Object.assign(JSON.parse(JSON.stringify(ctx._csDefaultConfig_())), { policyApprovalEnabled: 'no' })),
    ctx._csIsConfigValid_(Object.assign(JSON.parse(JSON.stringify(ctx._csDefaultConfig_())), { policyApprovalEnabled: false }))], [false, true]);

  // 11. Aviso emergente de la semana del 19-oct y su constancia
  if (typeof ctx._policyNoticeFor_ === 'function') {
    reset();
    const n1 = ctx._policyNoticeFor_('ana@p.co');
    ok('aviso: se muestra al solicitante dentro de la ventana', n1 && n1.show === true && n1.approverName === 'Alejandro Gómez de Greiff');
    ok('aviso: no a los administradores', ctx._policyNoticeFor_('admin@p.co').show === false);
    reset();
    const a1 = ctx.dispatch('ackPolicyNotice', { userEmail: 'ana@p.co', sessionToken: 't', noticeId: n1.id });
    ok('aviso: «Entendido» deja constancia', a1.success && sheets['CONSTANCIA AVISOS'] && sheets['CONSTANCIA AVISOS']._t.some((row) => row[1] === 'ana@p.co' && row[2] === n1.id));
    reset();
    ctx.dispatch('ackPolicyNotice', { userEmail: 'ana@p.co', sessionToken: 't', noticeId: n1.id });
    eq('aviso: una sola constancia por persona', sheets['CONSTANCIA AVISOS']._t.filter((row) => row[1] === 'ana@p.co').length, 1);
    reset();
    ok('aviso: ya leído, no vuelve a salir', ctx._policyNoticeFor_('ana@p.co').show === false && ctx._policyNoticeFor_('luis@p.co').show === true);
    ctx._todayBogotaIso_ = () => '2026-10-26';
    reset();
    ok('aviso: sin fecha de fin, después del 25-oct sigue saliendo a quien no lo ha leído (David, 15-oct)', ctx._policyNoticeFor_('luis@p.co').show === true);
    ok('aviso: y no vuelve a quien ya lo aceptó', ctx._policyNoticeFor_('ana@p.co').show === false);
    ctx._todayBogotaIso_ = () => '2027-06-30';
    reset();
    ok('aviso: meses después, todavía a quien no lo ha leído', ctx._policyNoticeFor_('luis@p.co').show === true);
    ctx._todayBogotaIso_ = () => TODAY;
  } else {
    failures.push('aviso emergente: falta _policyNoticeFor_ en Code.gs');
  }

  // 12. #A136 — Con orden de trabajo el viaje lo paga el cliente y no espera
  const OT = 'OT-CUBTA-110256';
  log.mails.length = 0;
  r = create(base({ workOrder: OT, policyJustification: '  El cliente confirmó   la visita ayer.  ' }));
  const OT1 = r.data;
  eq('con OT fuera de plazo: sigue el flujo normal, no espera', cell(OT1, 'STATUS'), 'PENDIENTE_OPCIONES');
  eq('con OT: igual queda marcada y con su justificación, y guarda la OT canónica',
    [cell(OT1, 'VIOLACION POLITICA'), cell(OT1, 'JUSTIFICACION ANTICIPACION'), cell(OT1, '# ORDEN TRABAJO')],
    ['SI', 'El cliente confirmó la visita ayer.', OT]);
  eq('con OT: la columna de la decisión del CFO queda vacía (nadie decidió)', String(cell(OT1, 'APROBACION CFO ANTICIPACION') || ''), '');
  ok('con OT: le llega al área de compras como cualquier solicitud nueva', log.mails.some((m) => /compras\.equitel/.test(m.to)));
  ok('con OT: al solicitante no se le avisa de ninguna espera', !mailsTo('ana@p.co').some((m) => /EN ESPERA DE APROBACIÓN/.test(m.subject)));
  const evOT = JSON.parse(cell(OT1, 'EVENTOS_JSON') || '{}');
  ok('con OT: queda la constancia policyOtExempt y no policyHold', !!evOT.policyOtExempt && !evOT.policyHold);

  // La OT tiene que estar bien escrita (compuerta de #A66): con basura no se cuela nadie
  const filasAntes = req.length;
  r = create(base({ workOrder: 'OT 1234', policyJustification: 'El cliente confirmó la visita ayer.' }));
  ok('OT incompleta: no crea nada y lo explica', !r.success && /Orden de Trabajo/.test(r.error) && req.length === filasAntes);
  r = create(base({ workOrder: 'OTROS GASTOS 5', policyJustification: 'El cliente confirmó la visita ayer.' }));
  ok('un texto que empieza por OT no es una OT: no crea nada', !r.success && req.length === filasAntes);
  eq('la regla de la OT es la estricta, no la del presupuesto',
    [ctx._policyWorkOrderExempt_(ctx._normalizeWorkOrder_('OTROS GASTOS 5')), ctx._policyWorkOrderExempt_(ctx._normalizeWorkOrder_('ot-cubta 110256')), ctx._policyWorkOrderExempt_('')],
    [false, true, false]);

  // Internacional con OT: tampoco espera (Yurani: «todos los que tengan OT»)
  r = create(base({ isInternational: true, destination: 'MIAMI, ESTADOS UNIDOS', departureDate: day(20), returnDate: day(25), workOrder: OT, policyJustification: 'Feria del sector confirmada.' }));
  eq('internacional con OT: tampoco espera', cell(r.data, 'STATUS'), 'PENDIENTE_OPCIONES');

  // Multidestino con OT: ningún tramo espera, aunque el navegador pida esperar
  const GOT = [create(leg('MD-viajeot005', 1, 2, 3, { workOrder: OT })).data,
    create(leg('MD-viajeot005', 2, 2, 9, { workOrder: OT, origin: 'MEDELLIN, COLOMBIA', destination: 'CALI, COLOMBIA' })).data];
  eq('multidestino con OT: ningún tramo espera (ni con policyGroupHold del navegador)',
    GOT.map((id) => cell(id, 'STATUS')), ['PENDIENTE_OPCIONES', 'PENDIENTE_OPCIONES']);

  // Administradores: su solicitud nunca esperaba, así que la OT no cambia nada
  r = create(base({ requesterEmail: 'admin@p.co', workOrder: OT, policyJustification: 'Viaje ya comprado por fuera.' }), 'admin@p.co');
  ok('creada por un administrador con OT: flujo normal y sin constancia de exención',
    cell(r.data, 'STATUS') === 'PENDIENTE_OPCIONES' && !JSON.parse(cell(r.data, 'EVENTOS_JSON') || '{}').policyOtExempt);

  eq('formulario: el servidor le anuncia la regla de la OT', ctx._policyApprovalPublicInfo_('ana@p.co').workOrderExempt, true);

  // Las que YA estaban esperando con OT: la pasada de cada 2 horas las suelta
  const WAIT = create(base({ departureDate: day(5), returnDate: day(6), policyJustification: 'El cliente confirmó la visita ayer.' })).data;
  eq('sin OT: espera como siempre', cell(WAIT, 'STATUS'), 'PENDIENTE_APROBACION_POLITICA');
  setCell(WAIT, '# ORDEN TRABAJO', OT);
  const STILL = create(base({ departureDate: day(6), returnDate: day(7), policyJustification: 'Otra visita confirmada ayer.' })).data;
  log.mails.length = 0;
  reset();
  const run3 = ctx.procesarAprobacionesPolitica();
  eq('la que esperaba y tiene OT se suelta sola', [run3.released, cell(WAIT, 'STATUS')], [[WAIT], 'PENDIENTE_OPCIONES']);
  eq('la que no tiene OT sigue esperando', cell(STILL, 'STATUS'), 'PENDIENTE_APROBACION_POLITICA');
  eq('soltada: la columna de la decisión del CFO sigue vacía', String(cell(WAIT, 'APROBACION CFO ANTICIPACION') || ''), '');
  ok('soltada: le llega al área de compras, con copia al solicitante',
    log.mails.some((m) => /compras\.equitel/.test(m.to) && /EN GESTIÓN/.test(m.subject) && /ana@p\.co/.test(String(m.cc))));
  const evW = JSON.parse(cell(WAIT, 'EVENTOS_JSON') || '{}');
  ok('soltada: constancia, y los tiempos del área de compras cuentan desde ahí',
    !!evW.policyOtExempt && !!evW.policyApproved && evW.policyDecision && evW.policyDecision.decision === 'exempt');
  ok('soltada: la observación no dice por qué (la regla no se anuncia)',
    /No requirió la aprobación de la excepción/.test(String(cell(WAIT, 'OBSERVACIONES'))) && !/OT-/.test(String(cell(WAIT, 'OBSERVACIONES'))));
  reset();
  const stW = ctx.dispatch('getRequestById', { userEmail: 'ana@p.co', sessionToken: 't', requestId: WAIT });
  ok('soltada: el semáforo la da por resuelta y no inventa quién la aprobó',
    stW.success && stW.data.stages && stW.data.stages.policy && stW.data.stages.policy.decision === 'exempt' &&
    !!stW.data.stages.policy.at && stW.data.stages.policy.who === '');
  reset();
  ok('soltada: ahora sí la ve el área de compras', ctx.getAllRequestsLite().some((x) => x.requestId === WAIT));

  // Con OT pero con el viaje ya pasado: no se suelta, vence como siempre
  const GONE = create(base({ departureDate: day(2), returnDate: day(3), policyJustification: 'El cliente confirmó la visita ayer.' })).data;
  setCell(GONE, '# ORDEN TRABAJO', OT);
  setCell(GONE, 'FECHA IDA', '13-10-2026');
  reset();
  const run4 = ctx.procesarAprobacionesPolitica();
  ok('con OT pero con la fecha del viaje ya pasada: no se suelta, se deniega',
    run4.released.indexOf(GONE) === -1 && cell(GONE, 'STATUS') === 'DENEGADO');

  // Interruptor de la regla
  ctx.POLICY_WORK_ORDER_EXEMPT = false;
  reset();
  r = create(base({ workOrder: OT, policyJustification: 'El cliente confirmó la visita ayer.' }));
  eq('interruptor de la OT apagado: vuelve a esperar y el formulario se entera',
    [cell(r.data, 'STATUS'), ctx._policyApprovalPublicInfo_('ana@p.co').workOrderExempt], ['PENDIENTE_APROBACION_POLITICA', false]);
  eq('interruptor apagado: tampoco suelta las que esperan', ctx._policyReleaseExempt_(), []);
  ctx.POLICY_WORK_ORDER_EXEMPT = true;

  // El formulario: misma regla, solo cambia el texto (gemelo de utils/workOrder.ts)
  const FORM = fs.readFileSync(path.join(ROOT, 'components', 'RequestForm.tsx'), 'utf8');
  ok('formulario: el texto de la OT solo sale si el servidor anuncia la regla', /policyApproval\?\.workOrderExempt/.test(FORM));
  ok('formulario: usa la misma compuerta estricta de la OT', /const workOrderExempts[\s\S]{0,300}validateWorkOrder\(formData\.workOrder\)/.test(FORM));
  ok('formulario: el recuadro y la justificación obligatoria salen en los dos casos',
    /\{policyWarns && \(/.test(FORM) && /if \(policyWarns\) \{/.test(FORM) && /policyJustification: policyWarns \?/.test(FORM));
  ok('formulario: con OT el aviso dice «puede necesitar», no «necesita»', /policyHoldApplies \? 'necesita' : 'puede necesitar'/.test(FORM));
  ok('formulario: la marca del grupo solo viaja si de verdad espera', /policyGroupHold: policyHoldApplies/.test(FORM));
  ok('formulario: el aviso de espera del multidestino se decide por esa marca', /it\.payload\.policyGroupHold === true/.test(FORM));

  // 13. #A137 — Con OT no se le pide NADA al CFO: ni presupuesto, ni tarifa, ni cambio tarde
  const LATE_JSON = JSON.stringify({ v: 1, fueraDePlazo: { limite: '2026-11-18', hora: 17 } });
  eq('voto del CFO: la OT lo quita por los tres motivos',
    [ctx._requiresCfoVote_('SI', OT, ''), ctx._requiresCfoVote_('', OT, 'SI'), ctx._requiresCfoVote_('', OT, '', LATE_JSON),
      ctx._requiresCfoVote_('', '', '', LATE_JSON)],
    [false, false, false, true]);

  const FOT = create(base({ departureDate: day(12), returnDate: day(13), workOrder: OT })).data;
  setCell(FOT, 'TIPO DE COMPRA DE TKT', 'TIPO 2'); setCell(FOT, 'TARIFA RECOMENDADA', 'TIPO 1');
  setCell(FOT, 'TARIFA NOMBRE', 'Light'); setCell(FOT, 'TARIFA JUSTIFICACION', 'El técnico lleva herramienta.');
  reset();
  const rnOt = () => req.indexOf(rowOf(FOT)) + 1;
  eq('con OT: la tarifa superior se marca igual (mide, y va al informe mensual)',
    [ctx._updateFareCfoFlag_(sh, rnOt()), cell(FOT, 'REQUIERE APROB TARIFA')], [true, 'SI']);
  ok('con OT: la nota no promete una aprobación que nadie va a dar',
    /\[TARIFA\]: TIPO 2 \(Light\) es superior a la del manual \(TIPO 1\)\./.test(String(cell(FOT, 'OBSERVACIONES'))) &&
    !/Requiere la aprobación/.test(String(cell(FOT, 'OBSERVACIONES'))));
  reset();
  let mOt = ctx.mapRowToRequest(rowOf(FOT));
  eq('con OT: el detalle no pide el voto del CFO por la tarifa, y no nombra a nadie',
    [mOt.requiresFareApproval, mOt.requiresBudgetOverrunApproval, mOt.policyApproverName], [false, false, '']);

  setCell(FOT, 'CAMBIO PEDIDO (JSON)', LATE_JSON);
  reset();
  mOt = ctx.mapRowToRequest(rowOf(FOT));
  eq('con OT: el cambio pedido después del plazo se registra, pero tampoco lo vota el CFO',
    [mOt.lateChange, mOt.lateChangeNeedsCfo, mOt.requiresBudgetOverrunApproval], [true, false, false]);
  setCell(FOT, 'CAMBIO PEDIDO (JSON)', '');

  // El motor de aprobación: con OT, el voto del jefe basta aunque todo esté marcado
  setCell(FOT, 'STATUS', 'PENDIENTE_APROBACION'); setCell(FOT, 'COSTO COTIZADO PARA VIAJE', 600000);
  setCell(FOT, 'CORREO DE QUIEN APRUEBA (AUTOMÁTICO)', 'jefe@p.co'); setCell(FOT, 'REQUIERE APROB PPTO', 'SI');
  const sgOt = ctx._newApprovalLinkSig_('approve', FOT, 'approved', 'NORMAL', 'jefe@p.co');
  reset();
  ctx.processApprovalFromEmail({ parameter: { id: FOT, decision: 'approved', role: 'NORMAL', actor: 'jefe@p.co', t: sgOt.t, sig: sgOt.sig, confirm: 'true' } });
  eq('con OT, presupuesto y tarifa marcados: el voto del jefe basta', cell(FOT, 'STATUS'), 'APROBADO');

  // Antes de comprar: con OT se puede registrar una tarifa más alta (nadie la va a aprobar)
  reset();
  const spOt = ctx.dispatch('setPurchaseInfo', { userEmail: 'admin@p.co', sessionToken: 't', requestId: FOT,
    airline: 'LATAM', channel: 'Aviatur', fareOption: '3', fareJustification: 'El técnico lleva herramienta y maleta.' });
  ok('con OT: el área de compras registra una tarifa más alta sin esperar al CFO (' + (spOt.error || '') + ')',
    spOt.success && cell(FOT, 'TIPO DE COMPRA DE TKT') === 'TIPO 3');

  // La OT le quita a Alejandro el voto de CFO, NUNCA el de jefe directo
  const BOSS = create(base({ departureDate: day(12), returnDate: day(13), workOrder: OT })).data;
  setCell(BOSS, 'STATUS', 'PENDIENTE_APROBACION'); setCell(BOSS, 'COSTO COTIZADO PARA VIAJE', 600000);
  setCell(BOSS, 'CORREO DE QUIEN APRUEBA (AUTOMÁTICO)', CFO); setCell(BOSS, 'REQUIERE APROB TARIFA', 'SI');
  reset();
  const askedBoss = ctx._approvalAskedFor_(ctx.mapRowToRequest(rowOf(BOSS)))
    .map((a) => String(a.email).toLowerCase() + ':' + a.role).sort();
  eq('con OT, al CFO se le sigue pidiendo su voto de JEFE DIRECTO (y solo ese)', askedBoss, [CFO + ':NORMAL']);
  reset();
  ok('con OT y el CFO de jefe: sin su voto no se destraba', ctx._policyUnblockWorkOrders_().indexOf(BOSS) === -1 && cell(BOSS, 'STATUS') === 'PENDIENTE_APROBACION');
  const sgB = ctx._newApprovalLinkSig_('approve', BOSS, 'approved', 'NORMAL', CFO);
  reset();
  ctx.processApprovalFromEmail({ parameter: { id: BOSS, decision: 'approved', role: 'NORMAL', actor: CFO, t: sgB.t, sig: sgB.sig, confirm: 'true' } });
  eq('con OT y el CFO de jefe: con su voto de área, aprobada', cell(BOSS, 'STATUS'), 'APROBADO');

  // Destrabar las que quedaron esperando SOLO el voto del CFO teniendo OT
  const stuck = (over, ot) => {
    const id = create(base(Object.assign({ departureDate: day(12), returnDate: day(13) }, ot ? { workOrder: OT } : {}))).data;
    setCell(id, 'STATUS', 'PENDIENTE_APROBACION'); setCell(id, 'COSTO COTIZADO PARA VIAJE', 600000);
    setCell(id, 'CORREO DE QUIEN APRUEBA (AUTOMÁTICO)', 'jefe@p.co');
    setCell(id, 'REQUIERE APROB TARIFA', 'SI');
    Object.keys(over || {}).forEach((h) => setCell(id, h, over[h]));
    return id;
  };
  const AREA_OK = 'Sí_jefe@p.co_14/10/2026 9:00';
  const STUCK_OT = stuck({ 'APROBADO POR ÁREA? (AUTOMÁTICO)': AREA_OK }, true);
  const STUCK_NO_OT = stuck({ 'APROBADO POR ÁREA? (AUTOMÁTICO)': AREA_OK }, false);
  const STUCK_SIN_JEFE = stuck({}, true);
  log.mails.length = 0;
  reset();
  const run5 = ctx.procesarAprobacionesPolitica();
  eq('con OT y el jefe ya votado: se destraba sola, sin esperar al CFO',
    [run5.unblocked.indexOf(STUCK_OT) !== -1, cell(STUCK_OT, 'STATUS')], [true, 'APROBADO']);
  eq('sin OT: sigue esperando el voto del CFO', cell(STUCK_NO_OT, 'STATUS'), 'PENDIENTE_APROBACION');
  eq('con OT pero sin el voto del jefe: no se le salta el turno a nadie', cell(STUCK_SIN_JEFE, 'STATUS'), 'PENDIENTE_APROBACION');
  reset();
  eq('destrabar es idempotente: a la segunda pasada no vuelve a tocar nada', ctx._policyUnblockWorkOrders_(), []);
  ctx.POLICY_WORK_ORDER_EXEMPT = false;
  reset();
  eq('interruptor apagado: tampoco destraba', ctx._policyUnblockWorkOrders_(), []);
  ctx.POLICY_WORK_ORDER_EXEMPT = true;

  // El formulario del cambio no le promete al viajero un voto que no se va a pedir
  const TCM = fs.readFileSync(path.join(ROOT, 'components', 'TripChangeModal.tsx'), 'utf8');
  ok('el modal del cambio solo nombra al CFO si el servidor lo manda', !/quien aprueba las excepciones'\}/.test(TCM));
  const FF = fs.readFileSync(path.join(ROOT, 'components', 'FareFields.tsx'), 'utf8');
  ok('el aviso de la tarifa solo sale si el servidor manda a quién aprueba', /option > rec\.option && cfoApproverName &&/.test(FF));

  if (failures.length) {
    console.error('✗ Aprobación del CFO por la política (#A100): ' + failures.length + ' falla(s):');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('Aprobación del CFO por la política (#A100): anticipación en el servidor, espera oculta al área de compras, resumen con enlaces firmados, aprobar/rechazar/vencer, métricas desde la aprobación, resumen solo en horario laboral, multidestino con una sola decisión, lista de solo lectura del área de compras, tarifa superior con voto del CFO, interruptor y aviso con constancia. ' +
    'Órdenes de trabajo (#A136): con OT válida no espera pero queda marcada y con su justificación, la OT mal escrita no exime, las que ya esperaban se sueltan sin inventar un aprobador y el formulario dice «puede necesitar». ' +
    '#A137: con OT no se le pide nada al CFO (presupuesto, tarifa superior ni cambio después del plazo), las marcas se siguen escribiendo, la app no nombra a nadie y las que esperaban solo su voto se destraban solas sin saltarle el turno a nadie. OK');
}

main();
