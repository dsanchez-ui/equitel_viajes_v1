#!/usr/bin/env node
/**
 * Verifica el cierre automático por facturas (#A83): corre `server/Code.gs`
 * completo con una hoja SINTÉTICA en memoria (sin datos reales) y comprueba:
 *   - solo RESERVADO y solo con el viaje terminado (antes no: PROCESADO ya no se
 *     puede modificar);
 *   - facturado ≥ cotizado − $1.000 y al menos un PDF subido por factura escrita
 *     cierra (los PDF de la reserva no cuentan); si no, queda "por revisar" desde
 *     el día 7 después del viaje, con el motivo; antes, en espera;
 *   - suma facturas 1 a 6 aunque la configuración del dashboard solo tenga 1 a 3;
 *   - cierra con nota en OBSERVACIONES, sin correos, y re-verifica cada fila;
 *   - omitir el aviso lo oculta, pero si llegan las facturas se cierra igual;
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
  const log = { mails: 0, locks: 0, unlocks: 0, triggers: [] };
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
    Session: { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => '' }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => (n === 'Nueva Base Solicitudes' ? sheet : null) }), flush() {} },
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
  ctx.generateSupportReport = () => 'url';
  ctx.isUserAnalyst = (e) => e === 'admin@p.co';
  ctx.validateUserSession_ = () => true;
  ctx.validateUserEmail_ = () => true;
  return { ctx, table, log };
}

function main() {
  let env;
  try { env = load(); } catch (e) { console.error('✗ No se pudo cargar server/Code.gs para el cierre automático:\n  ' + e.message); process.exit(1); }
  const { ctx, table, log } = env;
  const failures = [];
  const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: da ${JSON.stringify(got)}, se esperaba ${JSON.stringify(want)}`); };
  const col = (h) => table[0].indexOf(h);
  const row = (id) => table.find((r) => r[0] === id);
  const ids = (l) => l.map((x) => x.requestId);

  const s = ctx._invoiceReviewScan_();
  eq('se cierran (facturado ≥ cotizado − $1.000, viaje terminado; factura 4 cuenta)', ids(s.closable).slice().sort(), ['SOL-1', 'SOL-2', 'SOL-7', 'SOL-8']);
  eq('por revisar (menos de lo cotizado, sin facturas o sin sus PDF; 7+ días)', ids(s.alerts).slice().sort(), ['SOL-10', 'SOL-11', 'SOL-12', 'SOL-3', 'SOL-9']);
  eq('motivos', s.alerts.map((x) => x.requestId + ':' + x.reason + ':' + x.uploadedPdfs + '/' + x.invoiceCount).sort(),
    ['SOL-10:FALTAN_PDF:1/2', 'SOL-11:FALTAN_PDF:0/1', 'SOL-12:FALTAN_PDF:0/1', 'SOL-3:FALTAN_FACTURAS:1/1', 'SOL-9:FALTAN_FACTURAS:0/0']);
  eq('en espera (viaje sin terminar o menos de 7 días)', s.waiting, 2);

  const r = ctx._autoCloseInvoiced_({ report: false });
  eq('cerradas', r.closed.map((c) => c.requestId).sort(), ['SOL-1', 'SOL-2', 'SOL-7', 'SOL-8']);
  eq('estados', ['SOL-1', 'SOL-2', 'SOL-3', 'SOL-4', 'SOL-5', 'SOL-7', 'SOL-8', 'SOL-9', 'SOL-10', 'SOL-11', 'SOL-12'].map((id) => row(id)[col('STATUS')]),
    ['PROCESADO', 'PROCESADO', 'RESERVADO', 'RESERVADO', 'RESERVADO', 'PROCESADO', 'PROCESADO', 'RESERVADO', 'RESERVADO', 'RESERVADO', 'RESERVADO']);
  const obs = String(row('SOL-1')[col('OBSERVACIONES')]);
  eq('nota sin borrar lo anterior', obs.startsWith('nota previa\n[CIERRE AUTOMÁTICO ') && /facturado \$950\.000, cotizado \$900\.000, 1 PDF de 1 factura\. Viaje terminado el 2026-09-03\.$/.test(obs), true);
  eq('sin correos', log.mails, 0);
  eq('bloqueo tomado y soltado por cierre', [log.locks, log.unlocks], [4, 4]);
  eq('segunda pasada no cierra nada', ctx._autoCloseInvoiced_({ report: false }).closed.length, 0);

  // re-verificación: si la fila cambió entre la revisión y el cierre, se salta
  const env2 = load();
  const orig = env2.ctx._invoiceReviewScan_;
  env2.ctx._invoiceReviewScan_ = () => { const x = orig(); env2.table.find((rr) => rr[0] === 'SOL-1')[env2.table[0].indexOf('STATUS')] = 'ANULADO'; return x; };
  const r2 = env2.ctx._autoCloseInvoiced_({ report: false });
  eq('fila que cambió: se salta', [r2.closed.length, r2.skipped.map((x) => x.requestId)], [3, ['SOL-1']]);

  // omitir aviso
  ctx.dismissInvoiceAlert('SOL-3', 'Laura@p.co');
  const s2 = ctx._invoiceReviewScan_();
  eq('omitida: sale de por revisar', [ids(s2.alerts).slice().sort(), ids(s2.dismissed)], [['SOL-10', 'SOL-11', 'SOL-12', 'SOL-9'], ['SOL-3']]);
  row('SOL-3')[col('TOTAL FACTURA 2')] = 300000;
  eq('omitida y completa, sin el PDF nuevo: sigue omitida', ids(ctx._invoiceReviewScan_().dismissed), ['SOL-3']);
  row('SOL-3')[col('SOPORTES (JSON)')] = pdf(2);
  eq('omitida, completa y con sus PDF: se cierra igual', ids(ctx._invoiceReviewScan_().closable), ['SOL-3']);
  row('SOL-10')[col('SOPORTES (JSON)')] = pdf(2);
  eq('al subir el PDF que faltaba: se cierra', ids(ctx._invoiceReviewScan_().closable).includes('SOL-10'), true);

  // permisos
  for (const a of ['getInvoiceReview', 'dismissInvoiceAlert', 'setPurchaseInfo']) {
    const res = ctx.dispatch(a, { userEmail: 'otro@p.co', sessionToken: 'x', requestId: 'SOL-9' });
    eq(a + ' solo administradores', res.success === false && /administrador/.test(res.error), true);
  }
  // disparador
  ctx.activarCierreAutomatico(); ctx.activarCierreAutomatico();
  eq('un solo disparador', log.triggers, ['cierreAutomaticoPorFacturas']);
  eq('desactivar', [ctx.desactivarCierreAutomatico().removed, ctx._autoCloseTriggerInstalled_()], [1, false]);

  if (failures.length) {
    console.error(`\n✗ Cierre automático por facturas: ${failures.length} problema(s).\n`);
    failures.forEach((f) => console.error('  · ' + f));
    process.exit(1);
  }
  console.log('Cierre automático por facturas: viaje terminado, redondeo, PDF por factura, plazo de aviso, facturas 1 a 6, nota, bloqueo, omitir y permisos OK.');
}

main();
