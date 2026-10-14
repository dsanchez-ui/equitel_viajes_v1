#!/usr/bin/env node
/**
 * Verifica el informe mensual de cumplimiento de la política de viajes (#A101):
 * corre `server/Code.gs` completo con una hoja SINTÉTICA en memoria (sin datos
 * reales y sin enviar correos: el envío queda registrado en memoria) y comprueba:
 *   - primer día hábil del mes con los festivos de Colombia (el 2-nov-2026 es
 *     festivo: el de octubre sale el martes 3-nov);
 *   - las reglas del informe del 13-oct: solo vuelos comprados, por mes de la
 *     solicitud; sin modificaciones ni registros posteriores en la anticipación;
 *     8 días nacional / 30 internacional; tarifa solo la registrada y por mes de
 *     compra (David, 14-oct: cada compra sale una sola vez);
 *   - tendencia, unidades, «quién pide» y cuadros de honor y de deshonor de los
 *     últimos 3 meses; lo que pasó por el CFO (#A100);
 *   - el CSV de detalle (sin cédulas) y el PDF adjunto;
 *   - el envío automático: solo desde el primer día hábil, en horario laboral, una
 *     sola vez por mes (constancia en INFORMES ENVIADOS), a quien aprueba con copia
 *     a Yurani y David, desde el informe de octubre de 2026;
 *   - la prueba del menú 15: solo a quien la corre, sin copia y sin constancia.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server', 'Code.gs'), 'utf8');

function headersFromSource() {
  const m = /const HEADERS_REQUESTS = (\[[\s\S]*?\]);/.exec(SRC);
  if (!m) throw new Error('No se encontró HEADERS_REQUESTS en Code.gs');
  // eslint-disable-next-line no-new-func
  const list = new Function('return ' + m[1])();
  ['FECHA SOLICITUD', 'FECHA/HORA (AUTOMÁTICO)', 'FECHA DE COMPRA DE TIQUETE', 'SELECCION_TEXTO', 'TIPO DE SOLICITUD', '# NOCHES (AUTOMÁTICO)',
    'MODO_SOLICITUD', 'ES INTERNACIONAL', 'NOMBRE PERSONA 1', 'NOMBRE PERSONA 2', 'NOMBRE PERSONA 3', 'NOMBRE PERSONA 4', 'NOMBRE PERSONA 5',
    'TIPO DE COMPRA DE TKT', 'APROBACION CFO ANTICIPACION', 'REQUIERE APROB TARIFA', 'UNIDAD DE NEGOCIO', 'EMPRESA', 'CORREO ENCUESTADO',
    'CIUDAD ORIGEN', 'CIUDAD DESTINO', 'FECHA IDA', 'FECHA VUELTA', 'STATUS', 'ID RESPUESTA', 'CEDULA PERSONA 1']
    .forEach((h) => { if (!list.includes(h)) list.push(h); });
  return list;
}

function makeSheet(name, table) {
  return {
    _t: table, hidden: false,
    getName: () => name, getLastRow: () => table.length, getLastColumn: () => (table[0] || []).length,
    getMaxColumns: () => (table[0] || []).length, getMaxRows: () => table.length,
    appendRow(vals) { table.push(vals.slice()); },
    setFrozenRows() {}, hideSheet() { this.hidden = true; },
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      return {
        getValue: () => (table[r - 1] || [])[c - 1] ?? '',
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = table[r - 1 + i] || []; const o = row.slice(c - 1, c - 1 + nc); while (o.length < nc) o.push(''); out.push(o); } return out; },
        setValue: (v) => { table[r - 1][c - 1] = v; },
      };
    },
  };
}

function load() {
  const H = headersFromSource();
  const req = [H.slice()];
  const users = [['Cedula', 'Nombre', 'Correo'], ['100', 'PEREZ ANA', 'ana@p.co'], ['200', 'ROJAS LUIS', 'luis@p.co'], ['300', 'DIAZ JORGE', 'jorge@p.co']];
  const sheets = { 'Nueva Base Solicitudes': makeSheet('Nueva Base Solicitudes', req), USUARIOS: makeSheet('USUARIOS', users) };
  const props = {};
  const log = { mails: [], alerts: [], prompts: [], promptAnswer: '', working: true, today: '2026-10-14' };
  const formatDate = (d, tz, f) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' })
      .formatToParts(d).map((x) => [x.type, x.value]));
    const hour = p.hour === '24' ? '00' : p.hour;
    const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
    return f.replace(/yyyy|MM|dd|HH|mm|M|d|H|u/g, (t) => ({ yyyy: p.year, MM: p.month, dd: p.day, HH: hour, mm: p.minute, M: String(+p.month), d: String(+p.day), H: String(+hour), u: String(wd) })[t]);
  };
  const blob = (data, type, name) => ({ data, type, name, getAs: (t) => ({ setName: (n) => ({ name: n, type: t, fromHtml: data }) }) });
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} }, Logger: { log() {} },
    Utilities: {
      formatDate, getUuid: () => crypto.randomUUID(), sleep() {}, newBlob: blob,
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
      getUi: () => ({
        alert: (...a) => { log.alerts.push(a.join(' | ')); return 'OK'; },
        prompt: (...a) => { log.prompts.push(a.join(' | ')); return { getSelectedButton: () => 'OK', getResponseText: () => log.promptAnswer }; },
        ButtonSet: { OK: 'OK', YES_NO: 'YES_NO', OK_CANCEL: 'OK_CANCEL' }, Button: { YES: 'YES', OK: 'OK' },
      }),
    },
    HtmlService: { createHtmlOutput: (h) => { const o = { html: h, setTitle: () => o, setXFrameOptionsMode: () => o, addMetaTag: () => o, getContent: () => h }; return o; }, XFrameOptionsMode: { DEFAULT: 'DEFAULT' } },
    ScriptApp: { getProjectTriggers: () => [] },
    MailApp: { sendEmail() { throw new Error('no debe enviar'); } }, GmailApp: { sendEmail() { throw new Error('no debe enviar'); }, getAliases: () => [] },
  };
  const stub = () => new Proxy(function () { return stub(); }, { get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : stub()) });
  for (const g of ['DriveApp', 'ContentService', 'UrlFetchApp', 'DocumentApp']) ctx[g] = stub();
  vm.createContext(ctx);
  new vm.Script(SRC, { filename: 'Code.gs' }).runInContext(ctx);
  if (typeof ctx._mrBuild_ !== 'function') throw new Error('No se encontró _mrBuild_() en server/Code.gs');
  ctx._todayBogotaIso_ = () => log.today;
  ctx.isWorkingHour = () => log.working;
  ctx.isUserAnalyst = (e) => ['admin@p.co'].includes(String(e || '').toLowerCase());
  ctx._sendMail_ = (o) => { log.mails.push(o); };
  return { ctx, req, H, sheets, props, log };
}

function main() {
  let env;
  try { env = load(); } catch (e) { console.error('✗ No se pudo cargar server/Code.gs para el informe mensual:\n  ' + e.stack); process.exit(1); }
  const { ctx, req, H, sheets, props, log } = env;
  const failures = [];
  const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: da ${JSON.stringify(got)}, se esperaba ${JSON.stringify(want)}`); };
  const ok = (name, cond) => { if (!cond) failures.push(name); };
  const reset = () => ctx._resetPerExecutionCaches_();

  // 1. Fechas
  eq('primer día hábil: nov-2026 es el martes 3 (el 2 es festivo)', ctx._mrFirstBusinessDay_('2026-11'), '2026-11-03');
  eq('primer día hábil: dic-2026, ene-2027 (el 1 es festivo), feb-2027', ['2026-12', '2027-01', '2027-02'].map((m) => ctx._mrFirstBusinessDay_(m)), ['2026-12-01', '2027-01-04', '2027-02-01']);
  eq('meses: sumar y restar cruzando el año', [ctx._mrAddMonths_('2026-01', -1), ctx._mrAddMonths_('2026-12', 1), ctx._mrAddMonths_('2026-10', -2)], ['2025-12', '2027-01', '2026-08']);
  eq('nombres: mayúsculas de la hoja a nombre propio', ctx._mrName_('PINZÓN GONZÁLEZ  MAURICIO'), 'Pinzón González Mauricio');

  // 2. Hoja sintética
  let seq = 0;
  const row = (o) => {
    const r = new Array(H.length).fill('');
    const set = (h, v) => { const i = H.indexOf(h); if (i < 0) throw new Error('falta ' + h); r[i] = v; };
    set('ID RESPUESTA', o.id || 'SOL-' + String(++seq).padStart(6, '0'));
    set('STATUS', o.status || 'RESERVADO');
    set('MODO_SOLICITUD', o.hotelOnly ? 'SOLO_HOSPEDAJE' : 'VUELO');
    set('ES INTERNACIONAL', o.intl ? 'SI' : 'NO');
    set('FECHA SOLICITUD', o.sol);
    set('FECHA IDA', o.ida);
    set('FECHA VUELTA', o.vuelta === undefined ? o.ida : o.vuelta);
    set('FECHA DE COMPRA DE TIQUETE', o.compra || '');
    set('SELECCION_TEXTO', o.traz ? 'SOLO POR TRAZABILIDAD - compra por fuera' : 'Opción A');
    set('TIPO DE SOLICITUD', o.mod ? 'MODIFICACION' : 'ORIGINAL');
    set('CORREO ENCUESTADO', o.req || 'ana@p.co');
    set('EMPRESA', o.company || 'Cumandes');
    set('UNIDAD DE NEGOCIO', o.unit || 'POTENCIA');
    set('CIUDAD ORIGEN', 'BOGOTA, COLOMBIA');
    set('CIUDAD DESTINO', o.intl ? 'MIAMI, ESTADOS UNIDOS' : 'MEDELLIN, COLOMBIA');
    (o.travelers || ['PEREZ ANA']).forEach((n, i) => set('NOMBRE PERSONA ' + (i + 1), n));
    set('CEDULA PERSONA 1', '987654321');
    set('TIPO DE COMPRA DE TKT', o.fare || '');
    set('APROBACION CFO ANTICIPACION', o.decision || '');
    set('REQUIERE APROB TARIFA', o.fareFlag ? 'SI' : '');
    req.push(r);
    return r[H.indexOf('ID RESPUESTA')];
  };
  // Octubre 2026 (el mes del informe)
  row({ id: 'OCT-OK1', sol: '2026-10-01', ida: '2026-10-20', compra: '2026-10-02', fare: 'TIPO 1' });                        // a tiempo, compra a tiempo, 0 noches TIPO 1
  row({ id: 'OCT-LATE1', sol: '2026-10-05', ida: '2026-10-08', vuelta: '2026-10-09', compra: '2026-10-06', fare: 'TIPO 2', unit: 'ENERGIA PROYECTOS', req: 'luis@p.co', travelers: ['ROJAS LUIS'] }); // fuera, 1 noche en superior
  row({ id: 'OCT-INTL', sol: '2026-10-02', ida: '2026-10-25', vuelta: '2026-10-30', compra: '2026-10-03', intl: true, fare: 'TIPO 2', unit: 'ENERGIA PROYECTOS', req: 'luis@p.co', travelers: ['ROJAS LUIS'] }); // 23 < 30
  row({ id: 'OCT-OKLATEBUY', sol: '2026-10-03', ida: '2026-10-15', compra: '2026-10-12', fare: 'TIIPO 1' });                  // pedido a tiempo, comprado tarde (3 días)
  row({ id: 'OCT-MOD', sol: '2026-10-06', ida: '2026-10-07', compra: '2026-10-06', mod: true });                                // no cuenta
  row({ id: 'OCT-TRAZ', sol: '2026-10-09', ida: '2026-10-08', compra: '2026-10-07', traz: true, travelers: ['DIAZ JORGE'], req: 'admin@p.co' }); // registrada después
  row({ id: 'OCT-HOTEL', sol: '2026-10-04', ida: '2026-10-06', hotelOnly: true });                                               // fuera
  row({ id: 'OCT-ANUL', sol: '2026-10-04', ida: '2026-10-06', status: 'ANULADO' });                                              // fuera
  row({ id: 'OCT-APROB', sol: '2026-10-28', ida: '2026-11-20', status: 'APROBADO' });                                            // aún no se compra: fuera
  row({ id: 'OCT-TEST', sol: '2026-10-04', ida: '2026-10-06', travelers: ['PRUEBA1'] });                                         // prueba: fuera
  // Lo que pasó por el CFO en octubre (#A100)
  row({ id: 'POL-SI', sol: '2026-10-15', ida: '2026-10-19', status: 'PENDIENTE_OPCIONES', decision: 'Sí_agdg@equitel.com.co_15/10/2026 09:00' });
  row({ id: 'POL-NO', sol: '2026-10-15', ida: '2026-10-17', status: 'DENEGADO', decision: 'No_agdg@equitel.com.co_15/10/2026 09:05' });
  row({ id: 'POL-VENC', sol: '2026-10-16', ida: '2026-10-18', status: 'DENEGADO', decision: 'Vencida_sistema_18/10/2026' });
  row({ id: 'POL-ESPERA', sol: '2026-10-30', ida: '2026-11-03', status: 'PENDIENTE_APROBACION_POLITICA' });
  row({ id: 'POL-TARIFA', sol: '2026-10-10', ida: '2026-10-30', status: 'APROBADO', fareFlag: true });
  row({ id: 'POL-SEP', sol: '2026-09-20', ida: '2026-09-22', status: 'DENEGADO', decision: 'No_agdg@equitel.com.co_20/09/2026' }); // otro mes
  // Septiembre (mes anterior)
  row({ id: 'SEP-LATE', sol: '2026-09-10', ida: '2026-09-12', compra: '2026-09-11', fare: 'TIPO 1' });
  row({ id: 'SEP-OK', sol: '2026-09-01', ida: '2026-09-15', compra: '2026-09-02', fare: 'TIPO 3' });                            // 0 noches en TIPO 3: superior
  // Cuadros (agosto a octubre): GOMEZ HONOR 5 a tiempo; LOPEZ TARDE 4 con 3 fuera, pedidos por Ana
  ['2026-08-03', '2026-08-20', '2026-09-05', '2026-10-01', '2026-10-06'].forEach((d, i) => row({ id: 'HON-' + i, sol: d, ida: ctx._psKeyFromDayNumber_(ctx._psDayNumber_(d) + 12), compra: d, travelers: ['GOMEZ HONOR'], req: 'jorge@p.co', unit: 'LAP' }));
  ['2026-08-10', '2026-09-10', '2026-10-10', '2026-10-12'].forEach((d, i) => row({ id: 'TAR-' + i, sol: d, ida: ctx._psKeyFromDayNumber_(ctx._psDayNumber_(d) + (i === 0 ? 10 : 2)), compra: d, travelers: ['LOPEZ TARDE'], req: 'ana@p.co', unit: 'ENERGIA POSTVENTA' }));
  row({ id: 'JUL-OLD', sol: '2026-07-01', ida: '2026-07-03', compra: '2026-07-01', travelers: ['LOPEZ TARDE'], req: 'ana@p.co', unit: 'ENERGIA POSTVENTA' }); // fuera de la ventana

  // 3. Cifras del informe de octubre
  reset();
  const r = ctx._mrBuild_('2026-10');
  // Octubre que cuenta: OK1, LATE1, INTL, OKLATEBUY, HON-3, HON-4, TAR-2, TAR-3 = 8; fuera: LATE1, INTL, TAR-2, TAR-3 = 4
  eq('octubre: viajes que cuentan y fuera de plazo', [r.stats.n, r.stats.late], [8, 4]);
  eq('octubre: nacional e internacional', [r.stats.natN, r.stats.natOnTime, r.stats.intlN, r.stats.intlOnTime], [7, 4, 1, 0]);
  eq('octubre: compras a tiempo (OKLATEBUY y los fuera de plazo no)', [r.stats.bought, r.stats.boughtOnTime], [8, 3]);
  eq('octubre: pedidos a tiempo comprados tarde', [r.stats.onTimeN, r.stats.onTimeBoughtLate], [4, 1]);
  eq('septiembre (comparación): SEP-LATE, SEP-OK, HON-2, TAR-1', [r.prevStats.n, r.prevStats.late], [4, 2]);
  eq('modificaciones del mes (no cuentan)', r.mods, 1);
  eq('registradas después de comprar: listadas aparte', r.traz.map((t) => t.id), ['OCT-TRAZ']);
  eq('tarifa 0-1 noche: OK1 y OKLATEBUY (TIIPO 1) en la del manual, LATE1 superior', [r.fares.buckets[0].n, r.fares.buckets[0].superior], [3, 1]);
  eq('tarifa: sin tarifa registrada no entran (la modificación, la registrada después, HON y TAR del mes)', r.fares.withoutFare, 6);
  eq('tarifa septiembre: SEP-OK en TIPO 3 con 0 noches es superior', [r.faresPrev.buckets[0].n, r.faresPrev.buckets[0].superior], [2, 1]);
  eq('CFO: en espera, aprobadas, rechazadas, vencidas', [r.policy.held, r.policy.approved, r.policy.denied, r.policy.expired, r.policy.waiting], [4, 1, 1, 1, 1]);
  eq('CFO: tarifa superior', [r.policy.fare, r.policy.fareApproved, r.policy.fareDenied], [1, 1, 0]);
  eq('tendencia: julio a octubre con datos (los meses sin viajes no salen)', r.trend.map((t) => t.ym), ['2026-07', '2026-08', '2026-09', '2026-10']);
  const unitNames = r.units.map((u) => u.unit);
  eq('unidades: la de más viajes fuera de plazo primero', unitNames[0], 'ENERGIA POSTVENTA');
  ok('unidades: todas las del mes', ['ENERGIA PROYECTOS', 'POTENCIA', 'LAP', 'ENERGIA POSTVENTA'].every((u) => unitNames.includes(u)));
  eq('cuadro de honor (3 meses): Gómez con 5 a tiempo', r.honor.map((v) => [v.name, v.n, v.late]), [['GOMEZ HONOR', 5, 0]]);
  eq('cuadro de deshonor: López, 3 de 4 fuera (julio queda fuera de la ventana), pedidos por otra', r.shame.map((v) => [v.name, v.n, v.late, v.byOthers]), [['LOPEZ TARDE', 4, 3, 4]]);
  eq('quién pide: Ana (octubre, septiembre y los de López) con 4 o más pedidos y alguno fuera', r.requesters.map((q) => [q.name, q.n, q.late, q.forOthers]), [['PEREZ ANA', 8, 4, 4]]);

  const html = r.html;
  ok('correo: título con el mes', /Cumplimiento de la política de viajes · octubre de 2026/.test(html) && r.subject === 'Cumplimiento de la política de viajes · octubre de 2026');
  ok('correo: las tres cifras del resumen', /50 %<\/div>/.test(html) && /de los viajes se pidió fuera de plazo/.test(html) && /de los tiquetes se compró a tiempo/.test(html) && /en tarifa superior/.test(html));
  ok('correo: comparación con el mes anterior', /septiembre de 2026: 50 %/.test(html));
  ok('correo: cuadros de honor y de deshonor con nombres propios', /Cuadro de honor/.test(html) && /Gomez Honor/.test(html) && /Cuadro de deshonor/.test(html) && /Lopez Tarde/.test(html));
  ok('correo: aprobaciones del CFO y compras por fuera', /Aprobaciones de Alejandro Gómez de Greiff/.test(html) && /OCT-TRAZ/.test(html));
  ok('correo: cómo se calculó', /Cómo se calculó/.test(html) && /8 días o más/.test(html));
  ok('correo: sin cédulas', !/987654321/.test(html));
  ok('correo: nombres escapados', !/<script/i.test(html));

  const csv = r.csv;
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  ok('CSV: con BOM para las tildes en Excel y separador ;', csv.charCodeAt(0) === 0xfeff && lines[0].split(';').length === 21);
  eq('CSV: una fila por solicitud comprada del mes (incluye modificación y registrada después)', lines.length - 1, 10);
  ok('CSV: sin cédulas', !/987654321/.test(csv));
  ok('CSV: marca la clase', lines.some((l) => /^OCT-TRAZ;Registrada después de comprar;/.test(l)) && lines.some((l) => /^OCT-MOD;Modificación;/.test(l)));
  ok('CSV: dice dónde cuenta cada fila', lines.some((l) => /^OCT-OK1;.*;SI;SI$/.test(l)) && lines.some((l) => /^OCT-MOD;.*;NO;NO$/.test(l)) && lines.some((l) => /^OCT-TRAZ;.*;NO;NO$/.test(l)));
  ok('correo: la tarifa por mes de compra, explicada', /Cuenta la fecha de compra, no la de la solicitud/.test(html) && /la tarifa, por el mes en que se compraron/.test(html));

  // 3b. Tarifa por mes de compra (David, 14-oct): una pedida en septiembre y comprada en octubre entra en
  // octubre; una pedida en octubre y comprada en noviembre entra en noviembre. La anticipación no cambia de mes.
  const before = req.length;
  row({ id: 'SEP-BUYOCT', sol: '2026-09-28', ida: '2026-10-20', compra: '2026-10-02', fare: 'TIPO 1', req: 'otro@p.co', travelers: ['RUIZ OTRO'] }); // 0 noches en TIPO 1: la del manual
  row({ id: 'OCT-TRAZFARE', sol: '2026-10-11', ida: '2026-10-10', compra: '2026-10-09', traz: true, fare: 'TIPO 2', req: 'admin@p.co', travelers: ['DIAZ JORGE'] }); // registrada después: su tarifa sí cuenta
  row({ id: 'OCT-BUYNOV', sol: '2026-10-29', ida: '2026-11-20', compra: '2026-11-04', fare: 'TIPO 2', req: 'otro@p.co', travelers: ['RUIZ OTRO'] }); // 0 noches en TIPO 2: superior
  reset();
  const rc = ctx._mrBuild_('2026-10');
  eq('tarifa por mes de compra: octubre suma SEP-BUYOCT y la registrada después (superior), no OCT-BUYNOV', [rc.fares.buckets[0].n, rc.fares.buckets[0].superior], [5, 2]);
  eq('tarifa por mes de compra: septiembre ya no cuenta SEP-BUYOCT', [rc.faresPrev.buckets[0].n, rc.faresPrev.buckets[0].superior], [2, 1]);
  eq('anticipación por mes de solicitud: OCT-BUYNOV cuenta en octubre, SEP-BUYOCT en septiembre', [rc.stats.n, rc.prevStats.n], [9, 5]);
  const lc = rc.csv.replace(/^﻿/, '').split('\r\n');
  eq('CSV de octubre: lo pedido en octubre y lo comprado en octubre', lc.length - 1, 13);
  ok('CSV de octubre: la registrada después cuenta en la tarifa y no en la anticipación', lc.some((l) => /^OCT-TRAZFARE;Registrada después de comprar;.*;NO;SI$/.test(l)));
  ok('CSV de octubre: SEP-BUYOCT solo en la tarifa, OCT-BUYNOV solo en la anticipación', lc.some((l) => /^SEP-BUYOCT;.*;NO;SI$/.test(l)) && lc.some((l) => /^OCT-BUYNOV;.*;SI;NO$/.test(l)));
  reset();
  const rn = ctx._mrBuild_('2026-11');
  eq('noviembre: la tarifa de OCT-BUYNOV entra en noviembre', [rn.fares.buckets[0].n, rn.fares.buckets[0].superior], [1, 1]);
  ok('noviembre: el CSV la trae aunque se pidió en octubre', /\r\nOCT-BUYNOV;.*;NO;SI(\r\n|$)/.test(rn.csv));
  ok('noviembre: sin la nota del 8-oct (solo para octubre)', !/la plataforma la registra desde/.test(rn.html));
  ok('octubre: con la nota del 8-oct si faltan tarifas', /la plataforma la registra desde el/.test(rc.html));
  req.splice(before);

  // 4. Envío automático
  const auto = () => { reset(); return ctx._mrMaybeSendMonthly_(); };
  log.mails.length = 0;
  log.today = '2026-10-14'; log.working = true;
  eq('14-oct: el de septiembre no sale (el primero es el de octubre)', auto(), '');
  log.today = '2026-11-02';
  eq('2-nov (festivo): no sale', auto(), '');
  log.today = '2026-11-03'; log.working = false;
  eq('3-nov fuera del horario laboral: no sale', auto(), '');
  eq('nada enviado hasta aquí', log.mails.length, 0);
  log.working = true;
  eq('3-nov en horario laboral: sale el de octubre', auto(), '2026-10');
  eq('un solo correo', log.mails.length, 1);
  const m = log.mails[0] || {};
  eq('para quien aprueba, con copia a Yurani y David', [m.to, m.cc], ['agdg@equitel.com.co', 'yprieto@equitel.com.co,dsanchez@equitel.com.co']);
  ok('asunto con el mes', /octubre de 2026/.test(m.subject || ''));
  eq('adjuntos: PDF y CSV', (m.attachments || []).map((a) => a.name), ['Cumplimiento politica de viajes 2026-10.pdf', 'Detalle solicitudes 2026-10.csv']);
  const sent = sheets['INFORMES ENVIADOS'];
  ok('constancia en la hoja INFORMES ENVIADOS (oculta)', sent && sent.hidden && sent._t.length === 2 && sent._t[1][2] === "'2026-10" && sent._t[1][3] === 'agdg@equitel.com.co');
  eq('segunda pasada el mismo día: no repite', [auto(), log.mails.length], ['', 1]);
  log.today = '2026-11-20';
  eq('más tarde en noviembre: no repite', [auto(), log.mails.length], ['', 1]);
  log.today = '2026-12-01';
  eq('1-dic: sale el de noviembre', [auto(), log.mails.length], ['2026-11', 2]);
  sent._t[2][2] = new Date(Date.UTC(2026, 10, 15, 12));
  reset();
  eq('constancia que Sheets convirtió en fecha: se reconoce', ctx._mrLastSent_(), '2026-11');
  log.today = '2026-12-02';
  eq('2-dic: no repite', auto(), '');
  // Si el primer día hábil no corrió la pasada, sale en la siguiente del mes.
  sent._t.length = 1;
  log.today = '2027-01-05'; log.mails.length = 0;
  eq('5-ene (el 4 no salió): sale el de diciembre', auto(), '2026-12');
  // Otro aprobador en la configuración, que además está en la copia: no se duplica.
  const cfg = JSON.parse(JSON.stringify(ctx._csDefaultConfig_()));
  cfg.budgetApproverEmail = 'yprieto@equitel.com.co'; cfg.budgetApproverName = 'Yurani Prieto';
  props.COSTS_DASHBOARD_CONFIG = JSON.stringify(cfg);
  log.today = '2027-02-01'; log.mails.length = 0;
  eq('aprobador cambiado: le llega al nuevo, sin duplicarlo en la copia', [auto(), log.mails[0] && log.mails[0].to, log.mails[0] && log.mails[0].cc], ['2027-01', 'yprieto@equitel.com.co', 'dsanchez@equitel.com.co']);
  delete props.COSTS_DASHBOARD_CONFIG;

  // 5. La pasada de cada 2 h lo envía
  sent._t.length = 1;
  log.today = '2026-11-03'; log.working = true; log.mails.length = 0;
  reset();
  const pass = ctx.procesarAprobacionesPolitica();
  eq('procesarAprobacionesPolitica: envía el informe del mes anterior', pass.monthly, '2026-10');

  // 6. Menú 15: prueba solo a quien la corre
  log.mails.length = 0; log.alerts.length = 0;
  const rowsBefore = sent._t.length;
  log.today = '2026-10-14'; log.promptAnswer = '2026-10';
  reset();
  ctx.menuInformeMensualPrueba();
  eq('prueba: un correo a quien la corre, sin copia', log.mails.map((x) => [x.to, x.cc || '']), [['admin@p.co', '']]);
  eq('prueba: no deja constancia', sent._t.length, rowsBefore);
  ok('prueba: el aviso dice cuándo sale el automático y para quién', /octubre de 2026 sale el (mar|vie) /.test(log.alerts[0] || '') && /Alejandro Gómez de Greiff/.test(log.alerts[0] || ''));
  log.mails.length = 0; log.alerts.length = 0; log.promptAnswer = '';
  reset();
  ctx.menuInformeMensualPrueba();
  ok('prueba: vacío = el mes anterior', /septiembre de 2026/.test(log.alerts[0] || '') && log.mails.length === 1);
  log.mails.length = 0; log.alerts.length = 0; log.promptAnswer = 'octubre';
  reset();
  ctx.menuInformeMensualPrueba();
  ok('prueba: mes mal escrito → error y nada enviado', /^Error/.test(log.alerts[0] || '') && log.mails.length === 0);
  log.alerts.length = 0;
  reset();
  ctx.menuVerAprobacionesPolitica();
  ok('menú 14: dice cuándo sale el informe mensual', /Informe mensual \(#A101\)/.test(log.alerts[0] || ''));

  if (failures.length) {
    console.error('✗ Informe mensual de la política (#A101):\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
  console.log('Informe mensual de la política (#A101): primer día hábil con festivos, reglas del informe del 13-oct, tendencia, unidades, cuadros de honor y deshonor de 3 meses, aprobaciones del CFO, CSV sin cédulas, envío una sola vez con constancia y prueba solo a quien la corre. OK');
}

main();
