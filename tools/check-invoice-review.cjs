#!/usr/bin/env node
/**
 * Verifica las facturas listas para cerrar y por revisar (#A83): corre
 * `server/Code.gs` completo con una hoja SINTÉTICA en memoria (sin datos reales)
 * y comprueba:
 *   - solo RESERVADO y solo con el viaje terminado (antes no: PROCESADO ya no se
 *     puede modificar);
 *   - facturado ≥ cotizado − $1.000 y al menos un PDF subido por factura escrita
 *     = lista para cerrar (los PDF de la reserva no cuentan); si no, queda "por
 *     revisar" desde el día 7 después del viaje, con el motivo; antes, en espera;
 *   - suma facturas 1 a 6 aunque la configuración del dashboard solo tenga 1 a 3;
 *   - NADA se cierra solo: revisar no escribe en la hoja, no hay disparador y el
 *     de la primera versión se borra sin cerrar nada;
 *   - el cierre manual de una lista para cerrar no pide confirmar facturas;
 *   - omitir el aviso lo oculta, y si después se completa pasa a listas para cerrar;
 *   - acciones nuevas solo para administradores.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const H = ['ID RESPUESTA', 'STATUS', 'MODO_SOLICITUD', 'CIUDAD ORIGEN', 'CIUDAD DESTINO', 'CORREO ENCUESTADO', 'FECHA IDA', 'FECHA VUELTA',
  'COSTO COTIZADO PARA VIAJE', 'COSTO_FINAL_TIQUETES', 'COSTO_FINAL_HOTEL', 'TOTAL FACTURA', 'VALOR PAGADO A AEROLINEA Y/O HOTEL',
  'VALOR PAGADO A AVIATUR Y/O IVA', 'TOTAL FACTURA 2', 'VALOR FACTURA 2', 'IVA FACTURA 2', 'TOTAL FACTURA 4', 'OBSERVACIONES', 'SOPORTES (JSON)'];
// SOPORTES: n PDF de facturas y r de la reserva
const pdf = (n, r = 0) => JSON.stringify({ files: [...Array(n)].map((_, i) => ({ id: 'f' + i })).concat([...Array(r)].map((_, i) => ({ id: 'r' + i, isReservation: true }))) });
// hoy = 2026-09-29
const ROWS = [
  ['SOL-1', 'RESERVADO', 'VIAJE', 'BOGOTA', 'CALI', 'a@p.co', '2026-09-01', '2026-09-03', 900000, 900000, 0, 950000, '', '', '', '', '', '', 'nota previa', pdf(1, 1)],
  ['SOL-2', 'RESERVADO', 'VIAJE', 'BOGOTA', 'CALI', 'b@p.co', '2026-09-01', '2026-09-03', 900000, 900000, 0, 899500, '', '', '', '', '', '', '', pdf(1)],
  ['SOL-3', 'RESERVADO', 'VIAJE', 'BOGOTA', 'CALI', 'c@p.co', '2026-09-01', '2026-09-03', 900000, 900000, 0, 600000, '', '', '', '', '', '', '', pdf(1)],
  ['SOL-4', 'RESERVADO', 'VIAJE', 'BOGOTA', 'CALI', 'd@p.co', '2026-10-05', '2026-10-07', 500000, 500000, 0, 600000, '', '', '', '', '', '', '', pdf(1)],
  ['SOL-5', 'RESERVADO', 'VIAJE', 'BOGOTA', 'CALI', 'e@p.co', '2026-09-20', '2026-09-25', 500000, 500000, 0, 100000, '', '', '', '', '', '', '', pdf(1)],
  ['SOL-6', 'PROCESADO', 'VIAJE', 'BOGOTA', 'CALI', 'f@p.co', '2026-09-01', '2026-09-03', 500000, 500000, 0, 900000, '', '', '', '', '', '', '', ''],
  ['SOL-7', 'RESERVADO', 'SOLO_HOSPEDAJE', '', 'MEDELLIN', 'g@p.co', '2026-09-01', '2026-09-04', 600000, 0, 600000, 0, 300000, 0, '', 250000, 50000, '', '', pdf(2)],
  ['SOL-8', 'RESERVADO', 'VIAJE', 'BOGOTA', 'CALI', 'h@p.co', '2026-09-01', '', 400000, 400000, 0, 100000, '', '', '', '', '', 300000, '', pdf(2)],
  ['SOL-9', 'RESERVADO', 'VIAJE', 'BOGOTA', 'CALI', 'i@p.co', '2026-09-01', '2026-09-03', 800000, 800000, 0, 0, '', '', '', '', '', '', '', ''],
  // facturas completas pero menos PDF que facturas (2 facturas, 1 PDF)
  ['SOL-10', 'RESERVADO', 'VIAJE', 'BOGOTA', 'CALI', 'j@p.co', '2026-09-01', '2026-09-03', 700000, 500000, 200000, 500000, '', '', 200000, '', '', '', '', pdf(1)],
  // facturas completas, solo PDF de la reserva (no cuentan)
  ['SOL-11', 'RESERVADO', 'VIAJE', 'BOGOTA', 'CALI', 'k@p.co', '2026-09-01', '2026-09-03', 500000, 500000, 0, 500000, '', '', '', '', '', '', '', pdf(0, 3)],
  // SOPORTES ilegible: 0 PDF
  ['SOL-12', 'RESERVADO', 'VIAJE', 'BOGOTA', 'CALI', 'l@p.co', '2026-09-01', '2026-09-03', 500000, 500000, 0, 500000, '', '', '', '', '', '', '', '{no es json'],
];

function load() {
  const table = [H.slice(), ...ROWS.map((r) => r.map((v, j) => (/^FECHA/.test(H[j]) && v ? new Date(v + 'T00:00:00-05:00') : v)))];
  const log = { mails: 0, locks: 0, unlocks: 0, triggers: [], alerts: [] };
  const sheet = {
    getName: () => 'Nueva Base Solicitudes', getLastRow: () => table.length, getLastColumn: () => table[0].length, getMaxColumns: () => table[0].length,
    insertColumnsAfter() {}, setColumnWidth() {},
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      const grow = () => table.forEach((row) => { while (row.length < c - 1 + nc) row.push(''); });
      const rng = {
        getValue: () => (table[r - 1] || [])[c - 1] ?? '',
        getValues: () => table.slice(r - 1, r - 1 + nr).map((row) => { const o = row.slice(c - 1, c - 1 + nc); while (o.length < nc) o.push(''); return o; }),
        setValue: (v) => { grow(); table[r - 1][c - 1] = v; return rng; },
        setValues: (vals) => { grow(); vals.forEach((row, i) => row.forEach((v, j) => { table[r - 1 + i][c - 1 + j] = v; })); return rng; },
        setNote: () => rng, setFontWeight: () => rng, setBackground: () => rng, setFontColor: () => rng,
      };
      return rng;
    },
  };
  const bogota = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const formatDate = (d, tz, f) => { const p = Object.fromEntries(bogota.formatToParts(d).map((x) => [x.type, x.value])); return f.replace(/yyyy|MM|dd|HH|mm/g, (t) => ({ yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour === '24' ? '00' : p.hour, mm: p.minute })[t]); };
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} }, Utilities: { formatDate }, Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, getProperties: () => ({}), setProperty() {}, deleteProperty() {}, getKeys: () => [] }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => { log.locks++; return true; }, waitLock() {}, releaseLock() { log.unlocks++; }, hasLock: () => true }) },
    Session: { getActiveUser: () => ({ getEmail: () => 'admin@p.co' }), getEffectiveUser: () => ({ getEmail: () => 'admin@p.co' }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: (n) => (n === 'Nueva Base Solicitudes' ? sheet : null) }), flush() {},
      getUi: () => ({ alert: (...a) => { log.alerts.push(a.join(' | ')); return 'OK'; }, ButtonSet: { OK: 'OK', YES_NO: 'YES_NO' }, Button: { YES: 'YES' } }),
    },
    MailApp: { sendEmail() { log.mails++; } }, GmailApp: { sendEmail() { log.mails++; } },
    ScriptApp: {
      getProjectTriggers: () => log.triggers.map((h) => ({ getHandlerFunction: () => h, _h: h })),
      deleteTrigger: (t) => log.triggers.splice(log.triggers.indexOf(t._h), 1),
      newTrigger: (h) => { const b = { timeBased: () => b, everyHours: () => b, create: () => log.triggers.push(h) }; return b; },
    },
  };
  const stub = () => new Proxy(function () { return stub(); }, { get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : stub()) });
  for (const g of ['DriveApp', 'HtmlService', 'ContentService', 'UrlFetchApp', 'DocumentApp']) ctx[g] = stub();
  vm.createContext(ctx);
  new vm.Script(fs.readFileSync(path.join(ROOT, 'server', 'Code.gs'), 'utf8'), { filename: 'Code.gs' }).runInContext(ctx);
  if (typeof ctx._invoiceReviewScan_ !== 'function') throw new Error('No se encontró _invoiceReviewScan_() en server/Code.gs');
  ctx._todayBogotaIso_ = () => '2026-09-29';
  ctx.generateSupportReport = (id) => { log.reports = (log.reports || []).concat(id); return 'url'; };
  ctx.isUserAnalyst = (e) => e === 'admin@p.co';
  ctx.validateUserSession_ = () => true;
  ctx.validateUserEmail_ = () => true;
  return { ctx, table, log };
}

function main() {
  let env;
  try { env = load(); } catch (e) { console.error('✗ No se pudo cargar server/Code.gs para las facturas por cerrar:\n  ' + e.message); process.exit(1); }
  const { ctx, table, log } = env;
  const failures = [];
  const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: da ${JSON.stringify(got)}, se esperaba ${JSON.stringify(want)}`); };
  const col = (h) => table[0].indexOf(h);
  const row = (id) => table.find((r) => r[0] === id);
  const ids = (l) => l.map((x) => x.requestId);

  const before = JSON.stringify(table);
  const s = ctx._invoiceReviewScan_();
  eq('listas para cerrar (facturado ≥ cotizado − $1.000, viaje terminado; factura 4 cuenta)', ids(s.closable).slice().sort(), ['SOL-1', 'SOL-2', 'SOL-7', 'SOL-8']);
  eq('por revisar (menos de lo cotizado, sin facturas o sin sus PDF; 7+ días)', ids(s.alerts).slice().sort(), ['SOL-10', 'SOL-11', 'SOL-12', 'SOL-3', 'SOL-9']);
  eq('motivos', s.alerts.map((x) => x.requestId + ':' + x.reason + ':' + x.uploadedPdfs + '/' + x.invoiceCount).sort(),
    ['SOL-10:FALTAN_PDF:1/2', 'SOL-11:FALTAN_PDF:0/1', 'SOL-12:FALTAN_PDF:0/1', 'SOL-3:FALTAN_FACTURAS:1/1', 'SOL-9:FALTAN_FACTURAS:0/0']);
  eq('en espera (viaje sin terminar o menos de 7 días)', s.waiting, 2);

  // Nada se cierra solo
  const g = ctx.getInvoiceReview();
  eq('panel: listas para cerrar (ordenadas por fin de viaje) y por revisar', [ids(g.pendingClose), g.alerts.length, g.graceDays], [['SOL-8', 'SOL-1', 'SOL-2', 'SOL-7'], 5, 7]);
  eq('panel: sin estado de disparador', 'autoCloseActive' in g, false);
  eq('revisar no escribe en la hoja, no bloquea ni envía correos', [JSON.stringify(table) === before, log.locks, log.mails], [true, 0, 0]);
  eq('no queda ninguna función que cierre sola', ['_autoCloseInvoiced_', 'activarCierreAutomatico', 'desactivarCierreAutomatico', 'menuCierreAutomaticoFacturas'].filter((f) => typeof ctx[f] === 'function'), []);
  log.triggers.push('cierreAutomaticoPorFacturas', 'backupDiarioAutomatico');
  ctx.cierreAutomaticoPorFacturas();
  eq('disparador de la primera versión: se borra solo sin cerrar nada', [log.triggers, JSON.stringify(table) === before], [['backupDiarioAutomatico'], true]);
  ctx.menuColumnasCompraFacturas();
  eq('menú 12: crea las 3 columnas, no cierra nada ni crea disparadores',
    [['AEROLINEA', 'CANAL DE COMPRA', 'AVISO FACTURAS OMITIDO'].every((h) => table[0].includes(h)), table.slice(1).filter((r) => r[col('STATUS')] === 'PROCESADO').length, log.triggers, /Listas para cerrar[^:]*: 4/.test(log.alerts.join('\n'))],
    [true, 1, ['backupDiarioAutomatico'], true]);

  // El cierre manual (botón Cerrar de la bandeja) no pide confirmar facturas en las listas
  for (const id of ['SOL-1', 'SOL-2', 'SOL-7', 'SOL-8']) {
    const res = ctx.dispatch('closeRequest', { userEmail: 'admin@p.co', sessionToken: 'x', requestId: id, options: { invoiceCheck: true } });
    eq(id + ' se cierra a mano sin aviso de facturas', [res.success, res.data && res.data.closed, res.data && res.data.needsInvoiceAck, row(id)[col('STATUS')]], [true, true, undefined, 'PROCESADO']);
  }
  eq('cerradas a mano: salen de la lista', ctx.getInvoiceReview().pendingClose.length, 0);
  eq('cierre manual sin correos', log.mails, 0);

  // omitir aviso
  ctx.dismissInvoiceAlert('SOL-3', 'Laura@p.co');
  const s2 = ctx._invoiceReviewScan_();
  eq('omitida: sale de por revisar', [ids(s2.alerts).slice().sort(), ids(s2.dismissed)], [['SOL-10', 'SOL-11', 'SOL-12', 'SOL-9'], ['SOL-3']]);
  row('SOL-3')[col('TOTAL FACTURA 2')] = 300000;
  eq('omitida y completa, sin el PDF nuevo: sigue omitida', ids(ctx._invoiceReviewScan_().dismissed), ['SOL-3']);
  row('SOL-3')[col('SOPORTES (JSON)')] = pdf(2);
  eq('omitida, completa y con sus PDF: pasa a listas para cerrar', ids(ctx._invoiceReviewScan_().closable), ['SOL-3']);
  row('SOL-10')[col('SOPORTES (JSON)')] = pdf(2);
  eq('al subir el PDF que faltaba: pasa a listas para cerrar', ids(ctx._invoiceReviewScan_().closable).includes('SOL-10'), true);
  eq('y sigue RESERVADO hasta que la cierren', row('SOL-10')[col('STATUS')], 'RESERVADO');

  // permisos
  for (const a of ['getInvoiceReview', 'dismissInvoiceAlert', 'setPurchaseInfo']) {
    const res = ctx.dispatch(a, { userEmail: 'otro@p.co', sessionToken: 'x', requestId: 'SOL-9' });
    eq(a + ' solo administradores', res.success === false && /administrador/.test(res.error), true);
  }

  if (failures.length) {
    console.error(`\n✗ Facturas por cerrar y por revisar: ${failures.length} problema(s).\n`);
    failures.forEach((f) => console.error('  · ' + f));
    process.exit(1);
  }
  console.log('Facturas por cerrar y por revisar: viaje terminado, redondeo, PDF por factura, plazo de aviso, facturas 1 a 6, nada se cierra solo, cierre manual, omitir y permisos OK.');
}

main();
