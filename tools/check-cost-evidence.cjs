#!/usr/bin/env node
/**
 * Verifica el soporte del costo confirmado (#A128): corre `server/Code.gs` completo con una
 * hoja y un Drive SINTÉTICOS en memoria (sin datos reales y sin enviar correos) y comprueba:
 *   - subir un soporte: solo administradores, solo imágenes o PDF y solo con la solicitud en
 *     PENDIENTE_CONFIRMACION_COSTO; queda en la carpeta de la solicitud con su prefijo;
 *   - confirmar costos con soportes: se guarda cuándo, quién, cuánto y los archivos; el correo
 *     de aprobación (y el recordatorio) lo muestra con la fecha, la hora y los enlaces;
 *   - el servidor no confía en el cliente: descarta un costEvidence que venga de la app y rechaza
 *     IDs de otra solicitud, en la papelera o de más (sin cambiar nada);
 *   - sin soportes (o con una app anterior que no manda la clave) igual queda cuándo y quién;
 *   - la app lo recibe sin el correo de quien confirmó, también el viajero y el aprobador en
 *     «Mis aprobaciones»; volver a confirmar suma otra y se muestra la última;
 *   - los textos de la app (fecha en 24 h, «hace X», tipos de archivo).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server', 'Code.gs'), 'utf8');
const TODAY = '2026-11-18'; // miércoles
const LAURA = 'compras.equitel@equitel.com.co';

function headersFromSource() {
  const m = /const HEADERS_REQUESTS = (\[[\s\S]*?\]);/.exec(SRC);
  if (!m) throw new Error('No se encontró HEADERS_REQUESTS en Code.gs');
  // eslint-disable-next-line no-new-func
  const list = new Function('return ' + m[1])();
  ['EVENTOS_JSON', 'COMENTARIOS APROBADORES (JSON)', 'APROBADO PRESUPUESTO', 'REQUIERE APROB PPTO', 'REQUIERE APROB TARIFA',
    'TARIFA RECOMENDADA', 'TARIFA NOMBRE', 'TARIFA JUSTIFICACION'].forEach((h) => { if (!list.includes(h)) list.push(h); });
  return list;
}

function makeSheet(name, table) {
  return {
    getName: () => name, getLastRow: () => table.length, getLastColumn: () => (table[0] || []).length,
    getMaxColumns: () => (table[0] || []).length, getMaxRows: () => table.length,
    insertColumnsAfter() {}, setColumnWidth() {}, insertRowAfter() { table.push(new Array(table[0].length).fill('')); },
    appendRow(vals) { table.push(vals.slice()); }, setFrozenRows() {}, hideSheet() {},
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
    ['800', 'MOLINA LAURA', LAURA]];
  const sheets = { 'Nueva Base Solicitudes': makeSheet('Nueva Base Solicitudes', req), USUARIOS: makeSheet('USUARIOS', users) };
  const props = {};
  const log = { mails: [] };
  const formatDate = (d, tz, f) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short' })
      .formatToParts(d).map((x) => [x.type, x.value]));
    const hour = p.hour === '24' ? '00' : p.hour;
    const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
    return f.replace(/yyyy|MM|dd|HH|mm|ss|M|d|H|u/g, (t) => ({ yyyy: p.year, MM: p.month, dd: p.day, HH: hour, mm: p.minute, ss: p.second, M: String(+p.month), d: String(+p.day), H: String(+hour), u: String(wd) })[t]);
  };
  const signed = (buf) => [...buf].map((b) => (b > 127 ? b - 256 : b));

  // Drive simulado: carpetas y archivos en memoria.
  const drive = { files: new Map(), folders: new Map() };
  let n = 0;
  const newId = () => '1Ab' + String(++n).padStart(10, '0') + crypto.randomBytes(6).toString('hex');
  const makeFolder = (name) => {
    const id = newId();
    const folder = {
      getId: () => id, getName: () => name, getUrl: () => 'https://drive.google.com/drive/folders/' + id,
      createFile(blob) {
        const fid = newId();
        let trashed = false;
        const f = {
          getId: () => fid, getName: () => blob.getName(), getMimeType: () => blob.getContentType(), getUrl: () => 'https://drive.google.com/file/d/' + fid + '/view',
          setSharing() { f._shared = true; return f; }, isTrashed: () => trashed, setTrashed(x) { trashed = !!x; return f; }, _folder: folder, _shared: false,
        };
        drive.files.set(fid, f);
        return f;
      },
    };
    drive.folders.set(id, folder);
    return folder;
  };

  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} }, Logger: { log() {} },
    MimeType: { PNG: 'image/png', PDF: 'application/pdf', JPEG: 'image/jpeg' },
    Utilities: {
      formatDate, getUuid: () => crypto.randomUUID(), sleep() {},
      computeHmacSha256Signature: (value, key) => signed(crypto.createHmac('sha256', key).update(value).digest()),
      DigestAlgorithm: { MD5: 'md5', SHA_256: 'sha256', SHA_1: 'sha1' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, value) => signed(crypto.createHash(alg).update(String(value)).digest()),
      base64Encode: (v) => Buffer.from(Array.isArray(v) ? v.map((b) => b & 255) : String(v)).toString('base64'),
      base64Decode: (s) => signed(Buffer.from(String(s), 'base64')),
      newBlob: (bytes, mime, name) => { const b = { getName: () => name, setName(x) { name = x; return b; }, getContentType: () => mime, getBytes: () => bytes }; return b; },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), getProperties: () => ({ ...props }), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; }, getKeys: () => Object.keys(props) }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {}, getAll: () => ({}), putAll() {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true }) },
    Session: { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => '' }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: (nm) => sheets[nm] || null, insertSheet: (nm) => { const t = []; sheets[nm] = makeSheet(nm, t); return sheets[nm]; } }),
      flush() {},
    },
    DriveApp: {
      getFileById: (id) => { const f = drive.files.get(id); if (!f) throw new Error('No se encontró el archivo ' + id); return f; },
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { VIEW: 'VIEW' },
    },
    HtmlService: { createHtmlOutput: (h) => { const o = { html: h, setTitle: () => o, setXFrameOptionsMode: () => o, addMetaTag: () => o, getContent: () => h }; return o; }, XFrameOptionsMode: { DEFAULT: 'DEFAULT' } },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => { const b = { timeBased: () => b, everyHours: () => b, create() {} }; return b; } },
    MailApp: { sendEmail() { throw new Error('no debe enviar'); } }, GmailApp: { sendEmail() { throw new Error('no debe enviar'); }, getAliases: () => [] },
  };
  const stub = () => new Proxy(function () { return stub(); }, { get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : stub()) });
  for (const g of ['ContentService', 'UrlFetchApp', 'DocumentApp']) ctx[g] = stub();
  // Reloj fijo: miércoles 18-nov-2026, 10:00 a. m. de Bogotá.
  let NOW = Date.parse(TODAY + 'T15:00:00Z');
  ctx.Date = class extends Date {
    constructor(...a) { super(...(a.length ? a : [NOW])); }
    static now() { return NOW; }
  };
  vm.createContext(ctx);
  new vm.Script(SRC, { filename: 'Code.gs' }).runInContext(ctx);
  for (const fn of ['uploadCostEvidence', '_normalizeCostEvidence_', '_costEvidenceForApp_', 'dispatch', 'getMyApprovals']) {
    if (typeof ctx[fn] !== 'function') throw new Error('No se encontró ' + fn + '() en server/Code.gs');
  }
  ctx._todayBogotaIso_ = () => TODAY;
  ctx.isWorkingHour = () => true;
  ctx.isUserAnalyst = (e) => [LAURA, 'admin@p.co'].includes(String(e || '').toLowerCase());
  ctx.isSuperAdmin = () => false;
  ctx.validateUserSession_ = () => true;
  ctx.validateUserEmail_ = () => true;
  ctx._dashInvalidate_ = () => {};
  ctx._calcularEjecutadoPeriodo_ = () => ({ exceedsBudget: false, featureEnabled: false });
  const folders = {};
  ctx.getOrCreateRequestFolder_ = (id) => (folders[id] = folders[id] || makeFolder(id));
  ctx.sendEmailRich = (to, subject, html, cc) => { log.mails.push({ to, subject, html, cc }); };
  ctx._sendMail_ = (o) => { log.mails.push({ to: o.to, subject: o.subject, html: o.htmlBody || o.body || '', cc: '' }); };
  return { ctx, req, log, drive, setNow: (ms) => { NOW = ms; } };
}

function main() {
  let env;
  try { env = load(); } catch (e) { console.error('✗ No se pudo cargar server/Code.gs para el soporte del costo:\n  ' + e.stack); process.exit(1); }
  const { ctx, req, log, drive, setNow } = env;
  const failures = [];
  const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: da ${JSON.stringify(got)}, se esperaba ${JSON.stringify(want)}`); };
  const ok = (name, cond) => { if (!cond) failures.push(name); };
  const reset = () => ctx._resetPerExecutionCaches_();
  const col = (h) => req[0].indexOf(h);
  const rowOf = (id) => req.find((r) => r[col('ID RESPUESTA')] === id);
  const cell = (id, h) => { const i = col(h); return i < 0 ? undefined : rowOf(id)[i]; };
  const evidenceList = (id) => JSON.parse(cell(id, 'SOPORTE COSTO (JSON)') || '[]');

  let seq = 800;
  const addRow = (over) => {
    const id = 'SOL-000' + (seq++);
    const f = Object.assign({
      'ID RESPUESTA': id, STATUS: 'PENDIENTE_CONFIRMACION_COSTO', 'CORREO ENCUESTADO': 'ana@p.co', 'NOMBRE PERSONA 1': 'PEREZ ANA',
      'CÉDULA PERSONA 1': '71787933', 'CORREOS PASAJEROS (JSON)': '["ana@p.co"]', EMPRESA: 'Cumandes', 'CIUDAD ORIGEN': 'MEDELLIN, COLOMBIA',
      'CIUDAD DESTINO': 'BOGOTA, COLOMBIA', 'FECHA IDA': '2026-12-15', 'FECHA VUELTA': '2026-12-16', 'ES INTERNACIONAL': 'NO',
      'QUIÉN APRUEBA? (AUTOMÁTICO)': 'JEFE UNO', 'CORREO DE QUIEN APRUEBA (AUTOMÁTICO)': 'jefe@p.co',
      'UNIDAD DE NEGOCIO': 'POTENCIA', SEDE: 'BOGOTA', '# PERSONAS QUE VIAJAN': 1, OBSERVACIONES: 'Visita a cliente',
      SELECCION_TEXTO: 'Opción A, Avianca 6:00', EVENTOS_JSON: JSON.stringify({ created: '2026-11-17T13:00:00.000Z' }), 'FECHA SOLICITUD': '2026-11-17',
    }, over || {});
    const row = new Array(req[0].length).fill('');
    Object.entries(f).forEach(([h, v]) => { if (col(h) >= 0) row[col(h)] = v; });
    req.push(row);
    reset();
    return id;
  };
  const app = (action, user, payload) => { reset(); return ctx.dispatch(action, Object.assign({ userEmail: user, sessionToken: 't' }, payload || {})); };
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
  const upload = (id, name, mimeType, user) => app('uploadCostEvidence', user || LAURA, { requestId: id, fileData: PNG, fileName: name, mimeType });
  const confirm = (id, extra, user) => app('updateRequest', user || LAURA, {
    id, status: 'PENDIENTE_APROBACION',
    payload: Object.assign({ finalCostTickets: 889518, finalCostHotel: 0, totalCost: 889518, skipApprovalNotification: false }, extra || {}),
  });

  // ---------------------------------------------------------------------------
  // 1. Subir un soporte
  const A = addRow();
  const u1 = upload(A, 'cotizacion aviatur.png', 'image/png');
  ok('subir: el área de compras sube una imagen (' + JSON.stringify(u1) + ')', u1.success && u1.data && u1.data.id);
  const f1 = u1.success ? drive.files.get(u1.data.id) : null;
  ok('subir: queda en la carpeta de la solicitud', f1 && f1._folder.getName() === A);
  ok('subir: con el prefijo de la solicitud y la hora', f1 && /^SoporteCosto_SOL-000800_20261118-100000_cotizacion aviatur\.png$/.test(f1.getName()));
  ok('subir: enlace de solo lectura', f1 && f1._shared);
  eq('subir: devuelve el nombre como lo subió', u1.data && u1.data.name, 'cotizacion aviatur.png');
  const u2 = upload(A, 'cotizacion.pdf', 'application/pdf');
  ok('subir: también un PDF', u2.success);
  const uNo = upload(A, 'x.png', 'image/png', 'ana@p.co');
  ok('subir: el viajero no puede', !uNo.success && /administrador/.test(uNo.error));
  const uZip = upload(A, 'x.zip', 'application/zip');
  ok('subir: un .zip no', !uZip.success);
  const uXls = upload(A, 'x.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  ok('subir: un Excel tampoco (solo imágenes o PDF)', !uXls.success && /imagen o un PDF/.test(uXls.error));
  const B = addRow({ STATUS: 'PENDIENTE_APROBACION' });
  const uB = upload(B, 'x.png', 'image/png');
  ok('subir: solo al confirmar costos (no en PENDIENTE_APROBACION)', !uB.success && /al confirmar los costos/.test(uB.error));

  // ---------------------------------------------------------------------------
  // 2. Confirmar costos con soportes
  log.mails.length = 0;
  const c1 = confirm(A, { costEvidenceIds: [u1.data.id, u2.data.id, u1.data.id],
    costEvidence: { by: 'otro@p.co', byName: 'Inventado', total: 1, files: [{ id: 'falso1234567', name: 'x' }] } });
  ok('confirmar: sale bien (' + JSON.stringify(c1) + ')', c1.success);
  eq('confirmar: pasa a aprobación', cell(A, 'STATUS'), 'PENDIENTE_APROBACION');
  const l1 = evidenceList(A);
  eq('confirmar: una confirmación guardada', l1.length, 1);
  const e1 = l1[0] || {};
  eq('confirmar: cuándo (hora del servidor)', e1.at, '2026-11-18T15:00:00.000Z');
  eq('confirmar: quién (el del servidor, no el que mandó la app)', [e1.by, e1.byName], [LAURA, 'MOLINA LAURA']);
  eq('confirmar: cuánto', [e1.tickets, e1.hotel, e1.total], [889518, 0, 889518]);
  eq('confirmar: los archivos (sin repetir; nada del cliente)', (e1.files || []).map((f) => [f.id, f.name, f.mimeType]),
    [[u1.data.id, 'cotizacion aviatur.png', 'image/png'], [u2.data.id, 'cotizacion.pdf', 'application/pdf']]);

  const mail = log.mails.find((m) => m.to === 'jefe@p.co');
  ok('correo: le llega al aprobador', !!mail);
  const html = mail ? mail.html : '';
  ok('correo: «Soporte del costo»', /Soporte del costo/.test(html));
  ok('correo: quién y cuándo', /MOLINA LAURA \(área de compras\) confirmó este costo el <strong>miércoles 18 de noviembre de 2026 a las 10:00<\/strong>/.test(html));
  ok('correo: el aviso de que las tarifas cambian', /Las tarifas cambian con los días: este es el valor de ese momento\./.test(html));
  ok('correo: enlace a la imagen y su miniatura', html.includes('https://drive.google.com/file/d/' + u1.data.id + '/view') && html.includes('https://drive.google.com/thumbnail?id=' + u1.data.id + '&amp;sz=w1000'));
  ok('correo: enlace al PDF (sin miniatura)', html.includes('https://drive.google.com/file/d/' + u2.data.id + '/view') && !html.includes('thumbnail?id=' + u2.data.id));
  ok('correo: el soporte va antes de los botones', html.indexOf('Soporte del costo') > -1 && html.indexOf('Soporte del costo') < html.indexOf('>APROBAR<'));

  reset();
  log.mails.length = 0;
  ctx.sendReminderEmail(ctx.mapRowToRequest(rowOf(A)), 'jefe@p.co', 'NORMAL');
  ok('recordatorio: también lleva el soporte', log.mails.length === 1 && /Soporte del costo/.test(log.mails[0].html) && log.mails[0].html.includes(u1.data.id));

  // ---------------------------------------------------------------------------
  // 3. Lo que recibe la app
  reset();
  const forApp = ctx.mapRowToRequest(rowOf(A)).costEvidence;
  eq('app: la última confirmación', forApp && [forApp.at, forApp.byName, forApp.total, forApp.count], ['2026-11-18T15:00:00.000Z', 'MOLINA LAURA', 889518, 1]);
  ok('app: sin el correo de quien confirmó', forApp && !JSON.stringify(forApp).includes(LAURA) && forApp.by === undefined);
  eq('app: archivos con su enlace y miniatura', forApp && forApp.files.map((f) => [f.url, f.thumb]), [
    ['https://drive.google.com/file/d/' + u1.data.id + '/view', 'https://drive.google.com/thumbnail?id=' + u1.data.id + '&sz=w1000'],
    ['https://drive.google.com/file/d/' + u2.data.id + '/view', '']]);
  const lite = ctx.mapRowToRequest(rowOf(A), true).costEvidence;
  ok('app: también en las filas del panel (lite)', lite && lite.files.length === 2);
  const C0 = addRow();
  reset();
  ok('app: sin confirmación, la clave viene en null (el servidor ya los recibe)', ctx.mapRowToRequest(rowOf(C0)).costEvidence === null);
  const mine = app('getRequestById', 'ana@p.co', { requestId: A });
  ok('app: el viajero lo ve en su solicitud', mine.success && mine.data && mine.data.costEvidence && mine.data.costEvidence.files.length === 2);
  const myAp = app('getMyApprovals', 'jefe@p.co', {});
  const pend = myAp.success ? myAp.data.pending.find((x) => x.id === A) : null;
  ok('«Mis aprobaciones»: el aprobador lo ve (' + (myAp.error || '') + ')', pend && pend.costEvidence && pend.costEvidence.files.length === 2 && pend.costEvidence.byName === 'MOLINA LAURA');

  // ---------------------------------------------------------------------------
  // 4. El servidor no confía en el cliente
  const D = addRow();
  const uOther = upload(C0, 'otra.png', 'image/png');
  const cOther = confirm(D, { costEvidenceIds: [uOther.data.id] });
  ok('rechaza el soporte de otra solicitud', !cOther.success && /no es de SOL-000/.test(cOther.error));
  eq('…y no cambia nada', [cell(D, 'STATUS'), evidenceList(D).length], ['PENDIENTE_CONFIRMACION_COSTO', 0]);
  const uTrash = upload(D, 'borrado.png', 'image/png');
  drive.files.get(uTrash.data.id).setTrashed(true);
  const cTrash = confirm(D, { costEvidenceIds: [uTrash.data.id] });
  ok('rechaza un soporte en la papelera', !cTrash.success && cell(D, 'STATUS') === 'PENDIENTE_CONFIRMACION_COSTO');
  const cFake = confirm(D, { costEvidenceIds: ['../../etc'] });
  ok('rechaza un ID que no es de Drive', !cFake.success && cell(D, 'STATUS') === 'PENDIENTE_CONFIRMACION_COSTO');
  const cNotArr = confirm(D, { costEvidenceIds: 'abc' });
  ok('rechaza IDs que no vienen en una lista', !cNotArr.success);
  const six = [1, 2, 3, 4, 5, 6].map((i) => upload(D, 'p' + i + '.png', 'image/png').data.id);
  const cSix = confirm(D, { costEvidenceIds: six });
  ok('rechaza más de 5 soportes', !cSix.success && /Máximo 5/.test(cSix.error) && cell(D, 'STATUS') === 'PENDIENTE_CONFIRMACION_COSTO');

  // ---------------------------------------------------------------------------
  // 5. Sin soportes y con una app anterior
  const cNone = confirm(D, { costEvidenceIds: [] });
  ok('sin soportes: confirma', cNone.success && cell(D, 'STATUS') === 'PENDIENTE_APROBACION');
  eq('sin soportes: igual queda cuándo y quién', evidenceList(D).map((e) => [e.at, e.by, e.files.length]), [['2026-11-18T15:00:00.000Z', LAURA, 0]]);
  const mailNone = log.mails.filter((m) => m.to === 'jefe@p.co').pop();
  ok('sin soportes: el correo lo dice', mailNone && /No se adjuntó soporte\./.test(mailNone.html));
  const E = addRow();
  const cOld = confirm(E, {});
  ok('app anterior (sin la clave): confirma y deja cuándo y quién', cOld.success && evidenceList(E).length === 1 && evidenceList(E)[0].files.length === 0);
  const F = addRow({ STATUS: 'PENDIENTE_OPCIONES' });
  const cOpts = app('updateRequest', LAURA, { id: F, status: 'PENDIENTE_SELECCION', payload: { analystOptions: [], costEvidenceIds: ['abc'] } });
  ok('otros cambios de estado no registran soporte (' + (cOpts.error || '') + ')', cOpts.success && evidenceList(F).length === 0);

  // ---------------------------------------------------------------------------
  // 6. Volver a confirmar (p. ej. después de revertir a selección)
  rowOf(A)[col('STATUS')] = 'PENDIENTE_CONFIRMACION_COSTO';
  setNow(Date.parse('2026-11-20T21:30:00Z')); // viernes 20-nov, 4:30 p. m.
  const u3 = upload(A, 'nueva.png', 'image/png');
  const c3 = confirm(A, { finalCostTickets: 1100000, totalCost: 1100000, costEvidenceIds: [u3.data.id] });
  ok('reconfirmar: sale bien', c3.success && u3.success);
  reset();
  const again = ctx.mapRowToRequest(rowOf(A)).costEvidence;
  eq('reconfirmar: se muestra la última y cuántas van', again && [again.count, again.total, again.files.map((f) => f.name), again.at], [2, 1100000, ['nueva.png'], '2026-11-20T21:30:00.000Z']);
  eq('reconfirmar: la hoja guarda las dos', evidenceList(A).map((e) => e.total), [889518, 1100000]);
  ok('reconfirmar: el correo trae la hora nueva en 24 h', /viernes 20 de noviembre de 2026 a las 16:30/.test((log.mails.filter((m) => m.to === 'jefe@p.co').pop() || {}).html || ''));

  // ---------------------------------------------------------------------------
  // 7. Textos de la app (components/CostEvidence.tsx)
  try {
    const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
    const out = esbuild.buildSync({ entryPoints: [path.join(ROOT, 'components', 'CostEvidence.tsx')], bundle: true, format: 'cjs', platform: 'node',
      write: false, logLevel: 'error', external: ['react', 'react-dom'], define: { 'import.meta.env': '{"PROD":false}' } });
    const mod = { exports: {} };
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, (m) => require(path.join(ROOT, 'node_modules', m)));
    const ui = mod.exports;
    eq('app: fecha y hora de Bogotá en 24 h', ui.costEvidenceWhen('2026-11-20T21:30:00.000Z'), 'viernes, 20 de noviembre de 2026 a las 16:30');
    const base = Date.parse('2026-11-20T21:30:00.000Z');
    eq('app: «hace X»', [0, 25, 60 * 5, 60 * 24, 60 * 24 * 3].map((m) => ui.costEvidenceAgo('2026-11-20T21:30:00.000Z', base + m * 60000)),
      ['hace un momento', 'hace 25 min', 'hace 5 horas', 'hace 1 día', 'hace 3 días']);
    const fileOf = (name, type) => ({ name, type });
    eq('app: tipos que acepta', [fileOf('a.png', 'image/png'), fileOf('b.pdf', 'application/pdf'), fileOf('c.PDF', ''), fileOf('d.jpeg', ''), fileOf('e.zip', 'application/zip'), fileOf('f.docx', '')]
      .map((f) => ui.evidenceMimeType(f)), ['image/png', 'application/pdf', 'application/pdf', 'image/jpeg', '', '']);
    eq('app: máximo de soportes igual al del servidor', ui.COST_EVIDENCE_MAX_FILES, Number(/var COST_EVIDENCE_MAX_FILES = (\d+);/.exec(SRC)[1]));
  } catch (e) {
    failures.push('No se pudo compilar components/CostEvidence.tsx: ' + e.message);
  }

  if (failures.length) {
    console.error('✗ Soporte del costo (#A128): ' + failures.length + ' falla(s):');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('Soporte del costo (#A128): subir, confirmar, correo y recordatorio, «Mis aprobaciones», validaciones del servidor y textos de la app. OK');
}

main();
