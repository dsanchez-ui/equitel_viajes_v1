#!/usr/bin/env node
/**
 * Verifica los avisos a los aprobadores (#A118) y «Mis aprobaciones» (#A119): corre
 * `server/Code.gs` completo con una hoja SINTÉTICA en memoria (sin datos reales y sin
 * enviar correos: el envío queda registrado en memoria) y comprueba:
 *   - caso SOL-000695: el aprobador de presupuesto tiene el voto pendiente, se salta la
 *     etapa y le llega un aviso con quién la saltó, cuándo y el motivo; su enlace viejo
 *     dice eso mismo (no «Usted ya había…» ni «Fecha: Desconocida») y no cambia nada;
 *   - quien vota recibe la confirmación (con lo que falta); con la decisión final, los
 *     demás aprobadores reciben un aviso una sola vez (nunca el solicitante ni quien
 *     decidió); denegada, anulada; «Confirmar costos» con salto: a nadie;
 *   - con coaprobadores se registra quién votó; con la solicitud denegada o anulada, el
 *     enlace ya no guarda el voto;
 *   - el primer recordatorio sale después de 2 horas laborales;
 *   - «Mis aprobaciones»: solo lo de esa persona, pendiente e historial, cómo va cada
 *     aprobación, sin cédulas; aprobar y denegar desde la app con el rol que dice el
 *     servidor (y la excepción a la política, para quien la aprueba); nadie más puede.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server', 'Code.gs'), 'utf8');
const TODAY = '2026-10-28'; // miércoles

function headersFromSource() {
  const m = /const HEADERS_REQUESTS = (\[[\s\S]*?\]);/.exec(SRC);
  if (!m) throw new Error('No se encontró HEADERS_REQUESTS en Code.gs');
  // eslint-disable-next-line no-new-func
  const list = new Function('return ' + m[1])();
  ['EVENTOS_JSON', 'COMENTARIOS APROBADORES (JSON)', 'APROBADO PRESUPUESTO', 'REQUIERE APROB PPTO', 'REQUIERE APROB TARIFA',
    'APROBACION CFO ANTICIPACION', 'JUSTIFICACION ANTICIPACION', 'GRUPO MULTIDESTINO', 'TARIFA RECOMENDADA', 'TARIFA NOMBRE',
    'TARIFA JUSTIFICACION'].forEach((h) => { if (!list.includes(h)) list.push(h); });
  return list;
}

function makeSheet(name, table) {
  return {
    getName: () => name, getLastRow: () => table.length, getLastColumn: () => (table[0] || []).length,
    getMaxColumns: () => (table[0] || []).length, getMaxRows: () => table.length,
    insertColumnsAfter() {}, setColumnWidth() {}, insertRowAfter() { table.push(new Array(table[0].length).fill('')); },
    appendRow(vals) { table.push(vals.slice()); },
    setFrozenRows() {}, hideSheet() {},
    getDataRange() { return this.getRange(1, 1, table.length, (table[0] || []).length); },
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
  const users = [['Cedula', 'Nombre', 'Correo'], ['100', 'PEREZ ANA', 'ana@p.co'], ['200', 'JEFE UNO', 'jefe@p.co'],
    ['300', 'GARCIA CEBALLOS SIMON', 'sigarcia@p.co'], ['400', 'PRIETO YURANI', 'yprieto@equitel.com.co'],
    ['500', 'COAPROBADOR A', 'a@p.co'], ['600', 'COAPROBADOR B', 'b@p.co'], ['700', 'GOMEZ ALEJANDRO', 'agdg@equitel.com.co']];
  const sheets = { 'Nueva Base Solicitudes': makeSheet('Nueva Base Solicitudes', req), USUARIOS: makeSheet('USUARIOS', users) };
  const props = {};
  const log = { mails: [] };
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
    Session: { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => '' }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => { const t = []; sheets[n] = makeSheet(n, t); return sheets[n]; },
      }),
      flush() {},
    },
    HtmlService: { createHtmlOutput: (h) => { const o = { html: h, setTitle: () => o, setXFrameOptionsMode: () => o, addMetaTag: () => o, getContent: () => h }; return o; }, XFrameOptionsMode: { DEFAULT: 'DEFAULT' } },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => { const b = { timeBased: () => b, everyHours: () => b, create() {} }; return b; } },
    MailApp: { sendEmail() { throw new Error('no debe enviar'); } }, GmailApp: { sendEmail() { throw new Error('no debe enviar'); }, getAliases: () => [] },
  };
  const stub = () => new Proxy(function () { return stub(); }, { get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : stub()) });
  for (const g of ['DriveApp', 'ContentService', 'UrlFetchApp', 'DocumentApp']) ctx[g] = stub();
  // Reloj fijo: miércoles 28-oct-2026, 10:00 a. m. de Bogotá.
  const NOW = Date.parse(TODAY + 'T15:00:00Z');
  ctx.Date = class extends Date {
    constructor(...a) { super(...(a.length ? a : [NOW])); }
    static now() { return NOW; }
  };
  vm.createContext(ctx);
  new vm.Script(SRC, { filename: 'Code.gs' }).runInContext(ctx);
  for (const fn of ['getMyApprovals', 'decideMyApproval', '_notifyApproversClosed_', '_applyApprovalDecision_']) {
    if (typeof ctx[fn] !== 'function') throw new Error('No se encontró ' + fn + '() en server/Code.gs');
  }
  ctx._todayBogotaIso_ = () => TODAY;
  ctx.isWorkingHour = () => true;
  ctx._isCreateRequestRateLimited_ = () => false;
  ctx.isUserAnalyst = (e) => ['admin@p.co', 'yprieto@equitel.com.co', 'dsanchez@equitel.com.co'].includes(String(e || '').toLowerCase());
  ctx.isSuperAdmin = () => false;
  ctx.validateUserSession_ = () => true;
  ctx.validateUserEmail_ = () => true;
  ctx.getCostCenterData = () => [];
  ctx._resolveApproverForFirstPassenger_ = () => ({ email: 'jefe@p.co', name: 'JEFE UNO' });
  ctx._assertPassportsForInternational_ = () => {};
  ctx._dashInvalidate_ = () => {};
  ctx.sendEmailRich = (to, subject, html, cc) => { log.mails.push({ to, subject, html, cc: cc === undefined ? '(admin)' : cc }); };
  ctx._sendMail_ = (o) => { log.mails.push({ to: o.to, subject: o.subject, html: o.htmlBody || o.body || '', cc: '' }); };
  return { ctx, req, log };
}

function main() {
  let env;
  try { env = load(); } catch (e) { console.error('✗ No se pudo cargar server/Code.gs para las aprobaciones:\n  ' + e.stack); process.exit(1); }
  const { ctx, req, log } = env;
  const failures = [];
  const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: da ${JSON.stringify(got)}, se esperaba ${JSON.stringify(want)}`); };
  const ok = (name, cond) => { if (!cond) failures.push(name); };
  const reset = () => ctx._resetPerExecutionCaches_();
  const col = (h) => { const i = req[0].indexOf(h); if (i < 0) throw new Error('Falta la columna ' + h); return i; };
  const rowOf = (id) => req.find((r) => r[col('ID RESPUESTA')] === id);
  const cell = (id, h) => rowOf(id)[col(h)];
  const setCell = (id, h, v) => { rowOf(id)[col(h)] = v; reset(); };
  const events = (id) => JSON.parse(cell(id, 'EVENTOS_JSON') || '{}');
  const mailsTo = (to) => log.mails.filter((m) => String(m.to).toLowerCase() === to);
  const mailsFor = (id) => log.mails.filter((m) => String(m.subject).indexOf(id) !== -1);
  const CFO = 'agdg@equitel.com.co';
  const YURANI = 'yprieto@equitel.com.co';
  const at = (bogotaHour, min) => new Date(Date.UTC(2026, 9, 28, bogotaHour + 5, min || 0)).toISOString();

  let seq = 900;
  const addRow = (over) => {
    const id = over.id || ('SOL-000' + (seq++));
    const f = Object.assign({
      'ID RESPUESTA': id, STATUS: 'PENDIENTE_APROBACION', 'CORREO ENCUESTADO': 'ana@p.co', 'NOMBRE PERSONA 1': 'PEREZ ANA',
      'CÉDULA PERSONA 1': '71787933', 'CORREOS PASAJEROS (JSON)': '["ana@p.co"]', EMPRESA: 'Cumandes', 'CIUDAD ORIGEN': 'MEDELLIN, COLOMBIA',
      'CIUDAD DESTINO': 'BOGOTA, COLOMBIA', 'FECHA IDA': '2026-11-15', 'FECHA VUELTA': '2026-11-19', 'ES INTERNACIONAL': 'NO',
      'COSTO COTIZADO PARA VIAJE': 528868, 'QUIÉN APRUEBA? (AUTOMÁTICO)': 'JEFE UNO', 'CORREO DE QUIEN APRUEBA (AUTOMÁTICO)': 'jefe@p.co',
      'UNIDAD DE NEGOCIO': 'POTENCIA', SEDE: 'BOGOTA', '# PERSONAS QUE VIAJAN': 1, OBSERVACIONES: 'Viaje a Venezuela',
      EVENTOS_JSON: JSON.stringify({ created: at(5), costConfirmed: at(7, 30) }), 'FECHA SOLICITUD': '2026-10-28',
    }, over.cells || {});
    const row = new Array(req[0].length).fill('');
    Object.entries(f).forEach(([h, v]) => { row[col(h)] = v; });
    req.push(row);
    reset();
    return id;
  };
  const ask = (id) => { reset(); ctx.sendApprovalRequestEmail(ctx.mapRowToRequest(rowOf(id))); };
  const link = (id, decision, role, actor, extra) => {
    const sg = ctx._newApprovalLinkSig_('approve', id, decision, role, actor);
    reset();
    return ctx.processApprovalFromEmail({ parameter: Object.assign({ id, decision, role, actor, t: sg.t, sig: sg.sig, confirm: 'true' }, extra || {}) }).html;
  };
  const app = (action, user, payload) => { reset(); return ctx.dispatch(action, Object.assign({ userEmail: user, sessionToken: 't' }, payload || {})); };

  // ---------------------------------------------------------------------------
  // 1. Lectura de las casillas de voto
  eq('voto: Sí_correo_fecha', ctx._approvalVoteParse_('Sí_agdg@equitel.com.co_28/10/2026 14:02', ''), { decision: 'approved', email: CFO, at: '28/10/2026 14:02' });
  eq('voto: No_correo_fecha', ctx._approvalVoteParse_('No_jefe@p.co_3/9/2026 8:05', '').decision, 'denied');
  eq('voto: área con la hora aparte (AAAA-MM-DD HH:mm)', ctx._approvalVoteParse_('Sí_jefe@p.co', '2026-10-28 13:56'), { decision: 'approved', email: 'jefe@p.co', at: '28/10/2026 13:56' });
  eq('voto: etapa saltada', ctx._approvalVoteParse_('Sí (ETAPA SALTADA por yprieto@equitel.com.co)', '2026-10-28 16:40'), { decision: 'skipped', email: YURANI, at: '28/10/2026 16:40' });
  eq('voto: política vencida', ctx._approvalVoteParse_('Vencida_sistema_21/10/2026 9:00', '').decision, 'expired');
  eq('voto: vacía', ctx._approvalVoteParse_('  ', ''), null);
  eq('hora: fecha de la hoja en 24 h', ctx._approvalTimeText_(new ctx.Date(Date.UTC(2026, 9, 28, 21, 40))), '28/10/2026 16:40');

  // ---------------------------------------------------------------------------
  // 2. Caso SOL-000695: Simón es su propio aprobador; Alejandro vota presupuesto; Yurani salta la etapa.
  const S695 = addRow({ id: 'SOL-000695', cells: { 'CORREO ENCUESTADO': 'sigarcia@p.co', 'NOMBRE PERSONA 1': 'GARCIA CEBALLOS SIMON', 'CORREOS PASAJEROS (JSON)': '["sigarcia@p.co"]',
    'QUIÉN APRUEBA? (AUTOMÁTICO)': 'GARCIA CEBALLOS SIMON', 'CORREO DE QUIEN APRUEBA (AUTOMÁTICO)': 'sigarcia@p.co', 'REQUIERE APROB PPTO': 'SI',
    OBSERVACIONES: 'Viaje a Venezuela \n[PRESUPUESTO]: Solicitud excede el presupuesto de la unidad en mes 10/2026.' } });
  log.mails.length = 0;
  ask(S695);
  eq('695: se pide a Simón (área) y a Alejandro (presupuesto)', log.mails.map((m) => m.to).sort(), [CFO, 'sigarcia@p.co'].sort());
  eq('695: queda registrado a quién se le pidió', events(S695).approvalRequested.to, [{ email: CFO, role: 'BUDGET_OVERRUN' }, { email: 'sigarcia@p.co', role: 'NORMAL' }]);

  log.mails.length = 0;
  let page = link(S695, 'approved', 'NORMAL', 'sigarcia@p.co');
  ok('695: Simón aprueba → aprobación parcial y dice qué falta', /Aprobación Parcial/.test(page) && /Aprobador de Área/.test(page) && /Falta: Aprobador de Presupuesto \(Alejandro Gómez de Greiff\)/.test(page));
  eq('695: sigue pendiente', cell(S695, 'STATUS'), 'PENDIENTE_APROBACION');
  const conf = mailsTo('sigarcia@p.co');
  ok('695: confirmación a Simón, en el mismo hilo, con lo que falta', conf.length === 1 && /APROBACIÓN REQUERIDA$/.test(conf[0].subject) && /Registramos su decisión/.test(conf[0].html) &&
    /APROBADA/.test(conf[0].html) && /Falta: Aprobador de Presupuesto/.test(conf[0].html) && /Cómo va cada aprobación/.test(conf[0].html));
  eq('695: con un voto parcial no hay aviso de decisión final', mailsTo(CFO).length, 0);

  log.mails.length = 0;
  reset();
  ctx.sendPendingApprovalReminders();
  eq('695: el recordatorio va solo a Alejandro (2.5 h laborales pendiente)', mailsFor(S695).map((m) => m.to), [CFO]);

  log.mails.length = 0;
  reset();
  const skip = ctx.skipApprovalStage(S695, 'Se salta aprobacion para ejecutar la compra de los tkts nacionales ya que los internacionales estan comprados', YURANI);
  ok('695: Yurani salta la etapa', skip.success && cell(S695, 'STATUS') === 'APROBADO');
  const notice = mailsTo(CFO);
  ok('695: a Alejandro le llega el aviso con quién, cuándo y el motivo', notice.length === 1 && /DECISIÓN FINAL/.test(notice[0].html) && /APROBADA/.test(notice[0].html) &&
    /PRIETO YURANI/.test(notice[0].html) && /saltó la etapa de aprobación/.test(notice[0].html) && /los internacionales estan comprados/.test(notice[0].html) &&
    /no recibirá más recordatorios/.test(notice[0].html) && /APROBACIÓN REQUERIDA$/.test(notice[0].subject));
  eq('695: el salto no le avisa al solicitante ni a quien saltó', [mailsTo('sigarcia@p.co').length, mailsTo(YURANI).length], [0, 0]);
  const closed695 = events(S695).approvalClosedNotice || {};
  eq('695: el aviso queda registrado una sola vez', [closed695.outcome, closed695.to], ['SALTADA', [CFO]]);
  reset();
  eq('695: repetir el aviso no envía nada', ctx._notifyApproversClosed_(S695, 'SALTADA', YURANI), []);

  log.mails.length = 0;
  reset();
  ctx.sendPendingApprovalReminders();
  eq('695: aprobada, ya no hay recordatorios', mailsFor(S695).length, 0);

  const budgetBefore = cell(S695, 'APROBADO PRESUPUESTO');
  page = link(S695, 'approved', 'BUDGET_OVERRUN', CFO);
  ok('695: el enlace viejo de Alejandro dice quién saltó la etapa, cuándo y por qué', /Decisión Previa Detectada/.test(page) && /PRIETO YURANI/.test(page) &&
    /saltó la etapa de aprobación/.test(page) && /los internacionales estan comprados/.test(page) && /Ya no se necesita su aprobación/.test(page) &&
    /Aprobada; falta la compra/.test(page));
  ok('695: ya no dice «Usted ya había registrado» ni «Desconocida»', !/Usted ya había/.test(page) && !/Desconocida/.test(page));
  eq('695: el enlace viejo no cambia nada', cell(S695, 'APROBADO PRESUPUESTO'), budgetBefore);

  // ---------------------------------------------------------------------------
  // 3. Aprobación completa: área + Cadena de Suministro (más de $1.200.000) + presupuesto.
  const B = addRow({ cells: { 'COSTO COTIZADO PARA VIAJE': 1500000, 'REQUIERE APROB PPTO': 'SI' } });
  log.mails.length = 0;
  ask(B);
  eq('completa: se pide a Cadena de Suministro, presupuesto y área', events(B).approvalRequested.to.map((x) => x.role), ['CDS', 'BUDGET_OVERRUN', 'NORMAL']);
  log.mails.length = 0;
  page = link(B, 'approved', 'NORMAL', 'jefe@p.co');
  ok('completa: el área deja pendientes a Cadena de Suministro y presupuesto', /Dirección Cadena de Suministro \(PRIETO YURANI\)/.test(page) && /Aprobador de Presupuesto/.test(page));
  link(B, 'approved', 'CDS', YURANI);
  log.mails.length = 0;
  page = link(B, 'approved', 'BUDGET_OVERRUN', CFO);
  ok('completa: con el voto del presupuesto queda APROBADO', /Aprobación Completa/.test(page) && cell(B, 'STATUS') === 'APROBADO');
  ok('completa: confirmación a Alejandro', mailsTo(CFO).length === 1 && /completó sus aprobaciones/.test(mailsTo(CFO)[0].html));
  ok('completa: aviso final al área y a Cadena de Suministro', mailsTo('jefe@p.co').length === 1 && mailsTo(YURANI).length === 1 &&
    /DECISIÓN FINAL/.test(mailsTo('jefe@p.co')[0].html) && /quedó <strong>APROBADA<\/strong>/.test(mailsTo('jefe@p.co')[0].html));
  ok('completa: al solicitante solo su aviso de siempre', mailsTo('ana@p.co').every((m) => !/DECISIÓN FINAL/.test(m.html)));

  // ---------------------------------------------------------------------------
  // 4. Denegada por presupuesto con coaprobadores de área que no votaron.
  const C = addRow({ cells: { 'CORREO DE QUIEN APRUEBA (AUTOMÁTICO)': 'a@p.co,b@p.co', 'REQUIERE APROB PPTO': 'SI' } });
  ask(C);
  log.mails.length = 0;
  page = link(C, 'denied', 'BUDGET_OVERRUN', CFO, { reason: 'La unidad ya pasó el presupuesto de octubre' });
  ok('denegada: queda DENEGADO', /DENEGADO/.test(page) && cell(C, 'STATUS') === 'DENEGADO');
  ok('denegada: confirmación a quien denegó', mailsTo(CFO).length === 1 && /DENEGADA/.test(mailsTo(CFO)[0].html));
  ok('denegada: aviso a los dos coaprobadores con quién y el motivo', ['a@p.co', 'b@p.co'].every((e) => mailsTo(e).length === 1 &&
    /quedó <strong>DENEGADA<\/strong>/.test(mailsTo(e)[0].html) && /Alejandro Gómez de Greiff/.test(mailsTo(e)[0].html) && /pasó el presupuesto de octubre/.test(mailsTo(e)[0].html)));
  page = link(C, 'approved', 'NORMAL', 'b@p.co');
  ok('denegada: el enlace de un coaprobador lo dice y no guarda el voto', /Ya no necesita su aprobación/.test(page) && /DENEGADA/.test(page) && cell(C, 'APROBADO POR ÁREA? (AUTOMÁTICO)') === '');

  // ---------------------------------------------------------------------------
  // 5. Coaprobadores: se registra quién votó; al otro le llega el aviso y su enlace lo dice.
  const D = addRow({ cells: { 'CORREO DE QUIEN APRUEBA (AUTOMÁTICO)': 'a@p.co,b@p.co' } });
  ask(D);
  log.mails.length = 0;
  link(D, 'approved', 'NORMAL', 'b@p.co');
  eq('coaprobadores: la casilla dice quién aprobó', [cell(D, 'APROBADO POR ÁREA? (AUTOMÁTICO)'), cell(D, 'STATUS')], ['Sí_b@p.co', 'APROBADO']);
  eq('coaprobadores: aviso final solo al otro', [mailsTo('a@p.co').length, mailsTo('b@p.co').filter((m) => /DECISIÓN FINAL/.test(m.html)).length], [1, 0]);
  page = link(D, 'approved', 'NORMAL', 'a@p.co');
  ok('coaprobadores: el enlace del otro nombra a quien aprobó', /COAPROBADOR B<\/strong> ya aprobó/.test(page) && /28\/10\/2026 10:00/.test(page));
  page = link(D, 'approved', 'NORMAL', 'b@p.co');
  ok('coaprobadores: a quien ya votó le dice «Usted»', /Usted ya aprobó/.test(page));

  // ---------------------------------------------------------------------------
  // 6. Anulada por el solicitante mientras esperaba aprobación.
  const E = addRow({});
  ask(E);
  log.mails.length = 0;
  let r = app('cancelOwnRequest', 'ana@p.co', { requestId: E, reason: 'Se canceló la reunión' });
  ok('anulada: queda ANULADO', r.success && cell(E, 'STATUS') === 'ANULADO');
  ok('anulada: aviso al aprobador con el motivo', mailsTo('jefe@p.co').length === 1 && /ANULADA<\/strong> por el solicitante/.test(mailsTo('jefe@p.co')[0].html) && /Se canceló la reunión/.test(mailsTo('jefe@p.co')[0].html));

  // ---------------------------------------------------------------------------
  // 7. «Confirmar costos» con salto: no se le pidió a nadie → no se avisa a nadie.
  const F = addRow({ cells: { OBSERVACIONES: 'Viaje\n[COSTOS]: Confirmados con intención de saltar aprobación — no se envió correo a aprobadores.', 'REQUIERE APROB PPTO': 'SI' } });
  log.mails.length = 0;
  reset();
  ctx.skipApprovalStage(F, 'Viaje urgente autorizado por gerencia', YURANI);
  eq('salto al confirmar costos: ningún aviso', log.mails.length, 0);

  // ---------------------------------------------------------------------------
  // 8. Recordatorios: el primero, después de 2 horas laborales.
  const R1 = addRow({ cells: { EVENTOS_JSON: JSON.stringify({ costConfirmed: at(9, 30) }) } });
  const R2 = addRow({ cells: { EVENTOS_JSON: JSON.stringify({ costConfirmed: at(7, 50) }) } });
  // Internacional: Cadena de Suministro ya aprobó → a Gerencia General ya no se le recuerda (basta uno de los dos).
  const R3 = addRow({ cells: { 'ES INTERNACIONAL': 'SI', 'CIUDAD DESTINO': 'MIAMI, ESTADOS UNIDOS', EVENTOS_JSON: JSON.stringify({ costConfirmed: at(7) }),
    'APROBADO CDS': 'Sí_' + YURANI + '_28/10/2026 8:00' } });
  // El solicitante es el CEO: solo se le pidió a él → solo a él se le recuerda.
  const R4 = addRow({ cells: { 'ES INTERNACIONAL': 'SI', 'CIUDAD DESTINO': 'MIAMI, ESTADOS UNIDOS', 'CORREO ENCUESTADO': 'misaza@equitel.com.co',
    EVENTOS_JSON: JSON.stringify({ costConfirmed: at(7) }) } });
  log.mails.length = 0;
  reset();
  ctx.sendPendingApprovalReminders();
  eq('recordatorio: a los 30 minutos todavía no', mailsFor(R1).length, 0);
  eq('recordatorio: a las 2 h 10 min sí', mailsFor(R2).map((m) => m.to), ['jefe@p.co']);
  eq('recordatorio internacional: con Cadena de Suministro aprobada, solo el área', mailsFor(R3).map((m) => m.to), ['jefe@p.co']);
  eq('recordatorio: si el solicitante es el CEO, solo a él (a quien se le pidió)', mailsFor(R4).map((m) => m.to), ['misaza@equitel.com.co']);

  // ---------------------------------------------------------------------------
  // 9. «Mis aprobaciones»
  const G = addRow({ cells: { 'REQUIERE APROB PPTO': 'SI', 'REQUIERE APROB TARIFA': 'SI', 'TIPO DE COMPRA DE TKT': 'TIPO 3', 'TARIFA NOMBRE': 'Classic',
    'TARIFA JUSTIFICACION': 'Lleva equipos de medición', 'FECHA IDA': '2026-11-05', SELECCION_TEXTO: 'Opción B',
    'OPCIONES (JSON)': JSON.stringify([{ id: 'A', type: 'FLIGHT', url: 'https://drive.google.com/thumbnail?id=x' }, { id: 'B', type: 'FLIGHT', url: 'javascript:alert(1)' }]) } });
  ask(G);
  const early = addRow({ cells: { STATUS: 'PENDIENTE_OPCIONES', EVENTOS_JSON: JSON.stringify({ created: at(6) }) } });
  r = app('getMyApprovals', 'jefe@p.co');
  ok('mis aprobaciones: responde', r.success && Array.isArray(r.data.pending) && Array.isArray(r.data.history));
  let mine = r.data;
  const pendIds = mine.pending.map((x) => x.id);
  ok('mis aprobaciones (área): G y R1/R2 pendientes, no lo que aún no llega a aprobación', pendIds.includes(G) && pendIds.includes(R1) && !pendIds.includes(early) && !pendIds.includes(S695));
  const g = mine.pending.find((x) => x.id === G);
  ok('mis aprobaciones: el ítem trae el viaje, por qué se pide y cómo va', g.kind === 'approval' && g.role === 'NORMAL' && g.requesterName === 'PEREZ ANA' &&
    g.travelers[0] === 'PEREZ ANA' && g.why.includes('Excede el presupuesto de la unidad') && g.why.includes('Tarifa superior a la del manual') &&
    g.trail.map((s) => s.role + ':' + s.state).join(',') === 'NORMAL:pending,BUDGET_OVERRUN:pending' && g.selection === 'Opción B');
  eq('mis aprobaciones: solo imágenes https', g.options.map((o) => o.id), ['A']);
  eq('mis aprobaciones: el motivo de la tarifa no le llega al área', g.fareReason, '');
  ok('mis aprobaciones: nunca la cédula', JSON.stringify(mine).indexOf('71787933') === -1);
  const hb = mine.history.find((x) => x.id === B);
  ok('mis aprobaciones: historial con su voto', hb && hb.myVote && hb.myVote.decision === 'approved' && hb.status === 'APROBADO');
  ok('mis aprobaciones: historial con la anulada', mine.history.some((x) => x.id === E && /ANULADA/.test(x.outcome)));
  eq('mis aprobaciones: el historial va de la más reciente a la más vieja', mine.history.map((x) => x.seq), mine.history.map((x) => x.seq).slice().sort((a, b) => b - a));

  r = app('getMyApprovals', CFO);
  mine = r.data;
  const gc = mine.pending.find((x) => x.id === G);
  ok('mis aprobaciones (CFO): G pendiente con el motivo de la tarifa', gc && gc.role === 'BUDGET_OVERRUN' && gc.fareReason === 'Lleva equipos de medición');
  const h695 = mine.history.find((x) => x.id === S695);
  ok('mis aprobaciones (CFO): la 695 en el historial con el salto de etapa', h695 && /saltó la etapa/.test(h695.outcome) && /PRIETO YURANI/.test(h695.outcome) &&
    h695.trail.some((s) => s.role === 'BUDGET_OVERRUN' && s.state === 'skipped' && s.who === 'PRIETO YURANI' && s.at === '28/10/2026 10:00'));
  ok('mis aprobaciones (CFO): su denegación', mine.history.some((x) => x.id === C && x.myVote && x.myVote.decision === 'denied'));

  r = app('getMyApprovals', 'ana@p.co');
  eq('mis aprobaciones: quien no aprueba no ve nada', [r.data.pending.length, r.data.history.length], [0, 0]);
  eq('botón: solo a quien aprueba', [ctx._isApproverEmail_('ana@p.co', []), ctx._isApproverEmail_('jefe@p.co', []), ctx._isApproverEmail_(CFO, []),
    ctx._isApproverEmail_('x@p.co', [{ approverEmail: 'z@p.co, x@p.co' }])], [false, true, true, true]);

  // Decidir desde la app
  r = app('decideMyApproval', 'ana@p.co', { requestId: G, decision: 'approved' });
  ok('app: quien no es aprobador no puede', !r.success && /no es aprobador/.test(r.error) && cell(G, 'APROBADO POR ÁREA? (AUTOMÁTICO)') === '');
  r = app('decideMyApproval', 'jefe@p.co', { requestId: G, decision: 'maybe' });
  ok('app: decisión inválida', !r.success);
  log.mails.length = 0;
  r = app('decideMyApproval', 'jefe@p.co', { requestId: G, decision: 'approved', comment: 'Solo el tiquete' });
  ok('app: el área aprueba con el rol que dice el servidor', r.success && r.data.kind === 'approved_partial' && /Falta: Aprobador de Presupuesto/.test(r.data.message) &&
    cell(G, 'APROBADO POR ÁREA? (AUTOMÁTICO)') === 'Sí_jefe@p.co' && !/<[a-z]/.test(r.data.message));
  ok('app: confirmación por correo también', mailsTo('jefe@p.co').length === 1 && /Registramos su decisión/.test(mailsTo('jefe@p.co')[0].html));
  r = app('decideMyApproval', 'jefe@p.co', { requestId: G, decision: 'approved' });
  ok('app: votar dos veces no cambia nada', r.success && r.data.kind === 'already' && /Usted ya aprobó/.test(r.data.message));
  r = app('decideMyApproval', CFO, { requestId: G, decision: 'approved' });
  ok('app: con el CFO queda APROBADO', r.success && r.data.kind === 'approved_full' && cell(G, 'STATUS') === 'APROBADO');

  // Excepción a la política desde la app (la crea un solicitante fuera de plazo).
  reset();
  r = ctx.dispatch('createRequest', { userEmail: 'ana@p.co', sessionToken: 't', emailHtml: '<p>{{REQUEST_ID}}{{ACTION_BUTTONS}}</p>', data: {
    company: 'Equitel', origin: 'BOGOTA, COLOMBIA', destination: 'CALI, COLOMBIA', departureDate: '31-10-2026', returnDate: '01-11-2026',
    passengers: [{ name: 'PEREZ ANA', idNumber: '100', email: 'ana@p.co' }], requesterEmail: 'ana@p.co', costCenter: 'CC1', businessUnit: 'POTENCIA',
    site: 'BOGOTA', requestMode: 'FLIGHT', isInternational: false, policyViolation: true, comments: 'Visita', requiresHotel: false,
    policyJustification: 'El cliente confirmó la visita ayer.' } });
  const P = r.data;
  ok('política: queda en espera', r.success && cell(P, 'STATUS') === 'PENDIENTE_APROBACION_POLITICA');
  r = app('getMyApprovals', CFO);
  const pp = r.data.pending.find((x) => x.id === P);
  ok('mis aprobaciones (CFO): la excepción, con su justificación', pp && pp.kind === 'policy' && pp.policy && pp.policy.justification === 'El cliente confirmó la visita ayer.' && pp.policy.minDays === 8);
  r = app('getMyApprovals', 'jefe@p.co');
  ok('mis aprobaciones (área): la excepción todavía no es suya', !r.data.pending.some((x) => x.id === P));
  r = app('decideMyApproval', 'jefe@p.co', { requestId: P, decision: 'approved' });
  ok('app: la excepción solo la decide el CFO', !r.success && cell(P, 'STATUS') === 'PENDIENTE_APROBACION_POLITICA');
  log.mails.length = 0;
  r = app('decideMyApproval', CFO, { requestId: P, decision: 'approved', comment: 'Ok' });
  ok('app: el CFO aprueba la excepción', r.success && r.data.kind === 'approved' && cell(P, 'STATUS') === 'PENDIENTE_OPCIONES');
  ok('app: confirmación al CFO de la excepción', mailsTo(CFO).some((m) => /EXCEPCIÓN APROBADA/.test(m.html) && m.html.includes(P)));

  if (failures.length) {
    console.error('✗ Avisos a los aprobadores y «Mis aprobaciones» (#A118, #A119):');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('Avisos a los aprobadores y «Mis aprobaciones» (#A118, #A119): caso SOL-000695 (salto de etapa con aviso y enlace que dice quién, cuándo y por qué), confirmación a quien vota, aviso final una sola vez (aprobada, denegada, anulada; nunca al solicitante ni a quien decide; a nadie si no se pidió), coaprobadores, recordatorio después de 2 horas laborales, lista por persona sin cédulas y decisiones desde la app con el rol del servidor. OK');
}

main();
