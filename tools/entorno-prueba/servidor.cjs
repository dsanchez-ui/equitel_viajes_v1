#!/usr/bin/env node
'use strict';
/**
 * ENTORNO DE PRUEBA LOCAL (#A103)
 *
 * La app tal cual se va a publicar (el mismo build de producción), contra el Code.gs
 * real corriendo en este PC sobre una COPIA en memoria de la base exportada. Nada sale
 * a Google ni a producción:
 *   - la hoja vive en la memoria de este proceso (se pierde al cerrarlo);
 *   - los archivos van a un Drive simulado en memoria;
 *   - los correos NO se envían: se guardan en la bandeja local (/correos);
 *   - el servidor solo escucha en 127.0.0.1 (no se ve desde otros equipos).
 *
 * Uso:
 *   node tools/entorno-prueba/servidor.cjs --base "/ruta/Sistema Tiquetes Equitel V2.xlsx"
 *   (o un .json ya convertido con exportar_base.py). Abrir http://127.0.0.1:8787
 * Opciones: --pin 24682468  --puerto-api 8787  --puerto-app 3100  --sin-build (usa el último build)
 * Guía: tools/entorno-prueba/README.md
 */
process.env.TZ = 'America/Bogota'; // las horas de la hoja se leen con getHours(), como en Apps Script

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const args = (() => {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    const k = a[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
  }
  return out;
})();
const HOST = '127.0.0.1';
const API_PORT = Number(args.puertoApi || 8787);
const APP_PORT = Number(args.puertoApp || 3100);
const API = `http://${HOST}:${API_PORT}`;
const EXEC = API + '/exec';
const APP = `http://${HOST}:${APP_PORT}`;
const PIN = String(args.pin || '24682468'); // 8 dígitos, como en producción
const TEST_TRAVELER = 'dssanchezr2002@gmail.com'; // PRUEBA1 en USUARIOS (se queda a propósito para probar)
const TEST_APPROVER = 'petersimons988@gmail.com'; // PRUEBA2, su aprobador
const LAURA = 'compras.equitel@equitel.com.co';
const DAVID = 'dsanchez@equitel.com.co';

function fail(msg) { console.error('\n✗ ' + msg + '\n'); process.exit(1); }
const log = (...m) => console.log('[prueba]', ...m);

// ---------------------------------------------------------------------------
// 1. La base exportada
// ---------------------------------------------------------------------------
function loadBase(file) {
  if (!file || file === true) fail('Falta la base: --base "/ruta/Sistema Tiquetes Equitel V2.xlsx"');
  if (!fs.existsSync(file)) fail('No existe el archivo ' + file);
  if (/\.xlsx$/i.test(file)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'equitel-prueba-'));
    const out = path.join(tmp, 'base.json');
    try {
      execFileSync('python3', ['-E', '-P', path.join(__dirname, 'exportar_base.py'), file, out], { stdio: ['ignore', 'ignore', 'inherit'] });
      return JSON.parse(fs.readFileSync(out, 'utf8'));
    } catch (e) {
      fail('No se pudo leer el .xlsx (¿está instalado openpyxl? pip install --user openpyxl): ' + e.message);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true }); // la copia en JSON trae datos personales
    }
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
// {"$d": "ISO sin zona"} = fecha en hora de Bogotá; {"$t": "HH:MM:SS"} = hora (Sheets la da el 30-dic-1899).
function revive(v) {
  if (v && typeof v === 'object') {
    if (v.$d) return new Date(v.$d.replace(/(\.\d{3})\d*$/, '$1') + '-05:00');
    if (v.$t) { const [h, m, s] = v.$t.split(':').map(Number); return new Date(1899, 11, 30, h, m, s || 0); }
  }
  return v === null || v === undefined ? '' : v;
}

// ---------------------------------------------------------------------------
// 2. Google simulado (Sheets, Drive, correo, caché, propiedades)
// ---------------------------------------------------------------------------
const warned = new Set();
/** Objeto tolerante: un método que no existe se avisa una vez y devuelve el mismo objeto (encadenable). */
function lenient(obj, label) {
  const p = new Proxy(obj, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'symbol' || k === 'then' || k === 'toJSON' || k === 'inspect') return undefined;
      const name = label + '.' + String(k);
      if (!warned.has(name)) { warned.add(name); log('(simulado, sin efecto) ' + name); }
      return function () { return p; };
    }
  });
  return p;
}
const colNum = (letters) => letters.toUpperCase().split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colLetters = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

function makeSheet(ss, name, rows, hidden) {
  const t = rows;
  let width = t.reduce((m, r) => Math.max(m, r.length), 0);
  const notes = {};
  const sheet = {
    _t: t,
    getName: () => name,
    setName: (n) => { delete ss._sheets[name]; name = n; ss._sheets[n] = proxy; return proxy; },
    getLastRow: () => t.length,
    getLastColumn: () => width,
    getMaxColumns: () => Math.max(width, 26),
    getMaxRows: () => Math.max(t.length, 1000),
    getSheetId: () => name.length,
    getParent: () => ss._proxy,
    isSheetHidden: () => !!hidden,
    hideSheet: () => { hidden = true; return proxy; },
    showSheet: () => { hidden = false; return proxy; },
    getDataRange: () => range(1, 1, Math.max(1, t.length), Math.max(1, width)),
    getRange(a, b, c, d) {
      if (typeof a === 'string') {
        const m = /^([A-Z]*)(\d*)(?::([A-Z]*)(\d*))?$/i.exec(a.replace(/\$/g, '').split('!').pop());
        if (!m) throw new Error('Rango no soportado en el entorno de prueba: ' + a);
        const c1 = m[1] ? colNum(m[1]) : 1, r1 = m[2] ? Number(m[2]) : 1;
        const c2 = m[3] !== undefined ? (m[3] ? colNum(m[3]) : width) : c1;
        const r2 = m[4] !== undefined ? (m[4] ? Number(m[4]) : Math.max(t.length, 1)) : (m[3] !== undefined && !m[4] ? Math.max(t.length, 1) : r1);
        return range(r1, c1, r2 - r1 + 1, c2 - c1 + 1);
      }
      return range(a, b, c || 1, d || 1);
    },
    appendRow(vals) { t.push(vals.slice()); width = Math.max(width, vals.length); return proxy; },
    insertRowAfter(r) { t.splice(r, 0, new Array(width).fill('')); return proxy; },
    insertRowsAfter(r, n) { for (let i = 0; i < n; i++) t.splice(r, 0, new Array(width).fill('')); return proxy; },
    insertRowBefore(r) { t.splice(r - 1, 0, new Array(width).fill('')); return proxy; },
    deleteRow(r) { t.splice(r - 1, 1); return proxy; },
    deleteRows(r, n) { t.splice(r - 1, n); return proxy; },
    insertColumnsAfter(col, n) { t.forEach((row) => { while (row.length < col) row.push(''); row.splice(col, 0, ...new Array(n).fill('')); }); width += n; return proxy; },
    insertColumnAfter(col) { return sheet.insertColumnsAfter(col, 1); },
    insertColumnBefore(col) { return sheet.insertColumnsAfter(col - 1, 1); },
    deleteColumn(col) { t.forEach((row) => row.splice(col - 1, 1)); width = Math.max(0, width - 1); return proxy; },
    clear() { t.length = 0; width = 0; return proxy; },
    clearContents() { t.forEach((row) => row.fill('')); return proxy; },
    getFrozenRows: () => 1,
  };
  function range(r, c, nr, nc) {
    const grow = () => {
      while (t.length < r - 1 + nr) t.push(new Array(width).fill(''));
      for (let i = 0; i < nr; i++) { const row = t[r - 1 + i]; while (row.length < c - 1 + nc) row.push(''); }
      width = Math.max(width, c - 1 + nc);
    };
    const get = (i, j) => { const row = t[r - 1 + i]; const v = row ? row[c - 1 + j] : ''; return v === undefined || v === null ? '' : v; };
    const matrix = (f) => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => f(i, j)));
    const display = (v) => {
      if (v instanceof Date) {
        const p = (n) => String(n).padStart(2, '0');
        return v.getFullYear() < 1900 ? p(v.getHours()) + ':' + p(v.getMinutes()) + ':' + p(v.getSeconds())
          : p(v.getDate()) + '/' + p(v.getMonth() + 1) + '/' + v.getFullYear();
      }
      return String(v);
    };
    const rg = {
      getValues: () => matrix(get),
      getValue: () => get(0, 0),
      getDisplayValues: () => matrix((i, j) => display(get(i, j))),
      getDisplayValue: () => display(get(0, 0)),
      setValues(vals) { grow(); vals.forEach((row, i) => row.forEach((v, j) => { t[r - 1 + i][c - 1 + j] = v; })); return rp; },
      setValue(v) { grow(); for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) t[r - 1 + i][c - 1 + j] = v; return rp; },
      clearContent() { grow(); for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) t[r - 1 + i][c - 1 + j] = ''; return rp; },
      clear() { return rg.clearContent(); },
      getNote: () => notes[r + ':' + c] || '',
      getNotes: () => matrix((i, j) => notes[(r + i) + ':' + (c + j)] || ''),
      setNote(n) { notes[r + ':' + c] = n; return rp; },
      setNotes(m) { m.forEach((row, i) => row.forEach((n, j) => { notes[(r + i) + ':' + (c + j)] = n; })); return rp; },
      getFormula: () => '', getFormulas: () => matrix(() => ''),
      setFormula(f) { return rg.setValue(f); },
      getRow: () => r, getColumn: () => c, getNumRows: () => nr, getNumColumns: () => nc,
      getLastRow: () => r + nr - 1, getLastColumn: () => c + nc - 1,
      getA1Notation: () => colLetters(c) + r + (nr > 1 || nc > 1 ? ':' + colLetters(c + nc - 1) + (r + nr - 1) : ''),
      offset: (dr, dc, nr2, nc2) => range(r + dr, c + dc, nr2 || nr, nc2 || nc),
      getSheet: () => proxy,
      getBackgrounds: () => matrix(() => '#ffffff'), getFontWeights: () => matrix(() => 'normal'),
    };
    const rp = lenient(rg, 'Range');
    return rp;
  }
  const proxy = lenient(sheet, 'Sheet');
  return proxy;
}

function makeSpreadsheet(base) {
  const ss = { _sheets: {} };
  ss._proxy = lenient({
    getSheetByName: (n) => ss._sheets[n] || null,
    getSheets: () => Object.values(ss._sheets),
    insertSheet(n) { const name = typeof n === 'string' ? n : 'Hoja ' + (Object.keys(ss._sheets).length + 1); ss._sheets[name] = makeSheet(ss, name, [], false); return ss._sheets[name]; },
    deleteSheet(sh) { delete ss._sheets[sh.getName()]; },
    getId: () => 'HOJA-DE-PRUEBA', getUrl: () => API + '/', getName: () => 'Copia de prueba (local)',
    getSpreadsheetTimeZone: () => 'America/Bogota', toast() {},
    getActiveSheet: () => Object.values(ss._sheets)[0],
  }, 'Spreadsheet');
  Object.keys(base).forEach((name) => {
    ss._sheets[name] = makeSheet(ss, name, base[name].rows.map((r) => (r || []).map(revive)), base[name].state === 'hidden');
  });
  return ss;
}

// Drive en memoria. Los ID tienen la forma de los de Drive para que el código los acepte.
const drive = { files: new Map(), folders: new Map() };
const driveId = () => '1' + crypto.randomBytes(30).toString('base64url').slice(0, 32);
const iter = (list) => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
function makeBlob(bytes, mime, name) {
  let b = Buffer.from((bytes || []).map ? bytes.map((x) => x & 255) : bytes);
  let n = name || 'archivo', m = mime || 'application/octet-stream';
  const blob = {
    getBytes: () => [...b], getContentType: () => m, getName: () => n, setName(x) { n = x; return blob; }, setContentType(x) { m = x; return blob; },
    getDataAsString: () => b.toString('utf8'), copyBlob: () => makeBlob([...b], m, n), getAs: () => blob, _buf: () => b,
  };
  return lenient(blob, 'Blob');
}
function makeFolder(name, parent, id) {
  id = id || driveId();
  const f = {
    getId: () => id, getName: () => name, setName(n) { name = n; return fp; }, getUrl: () => 'https://drive.google.com/drive/folders/' + id,
    getParents: () => iter(parent ? [parent] : []), isTrashed: () => false, setTrashed() { return fp; }, setSharing() { return fp; },
    createFolder: (n) => makeFolder(n, fp),
    createFile(a, content, mime) {
      const blob = typeof a === 'string' ? makeBlob([...Buffer.from(String(content || ''))], mime || 'text/plain', a) : a;
      return makeFile(blob.getName(), blob.getContentType(), blob._buf ? blob._buf() : Buffer.from(blob.getBytes().map((x) => x & 255)), fp);
    },
    getFoldersByName: (n) => iter([...drive.folders.values()].filter((x) => x._parent === fp && x.getName() === n)),
    getFolders: () => iter([...drive.folders.values()].filter((x) => x._parent === fp)),
    getFilesByName: (n) => iter([...drive.files.values()].filter((x) => x._parent === fp && !x.isTrashed() && x.getName() === n)),
    getFiles: () => iter([...drive.files.values()].filter((x) => x._parent === fp && !x.isTrashed())),
    addFile(file) { file._parent = fp; return fp; }, removeFile() { return fp; },
    _parent: parent,
  };
  const fp = lenient(f, 'Folder');
  drive.folders.set(id, fp);
  return fp;
}
function makeFile(name, mime, buf, parent) {
  const id = driveId();
  let trashed = false;
  const f = {
    getId: () => id, getName: () => name, setName(n) { name = n; return fp; }, getMimeType: () => mime, getSize: () => buf.length,
    getUrl: () => 'https://drive.google.com/file/d/' + id + '/view?usp=drivesdk', getDownloadUrl: () => 'https://drive.google.com/uc?export=download&id=' + id,
    getBlob: () => makeBlob([...buf], mime, name), getAs: () => makeBlob([...buf], mime, name),
    getParents: () => iter(fp._parent ? [fp._parent] : []), moveTo(folder) { fp._parent = folder; return fp; },
    makeCopy(n, folder) { return makeFile(n || name, mime, Buffer.from(buf), folder || fp._parent); },
    setSharing() { return fp; }, setTrashed(x) { trashed = !!x; return fp; }, isTrashed: () => trashed,
    getDateCreated: () => new Date(), getLastUpdated: () => new Date(), setDescription() { return fp; },
    _buf: buf, _mime: mime,
  };
  const fp = lenient(f, 'File');
  fp._parent = parent;
  drive.files.set(id, fp);
  return fp;
}
function searchFolders(q) {
  const title = /title (?:contains|=) "((?:[^"\\]|\\.)*)"/.exec(q);
  const parent = /"([^"]+)" in parents/.exec(q);
  const exact = /title = "/.test(q);
  const want = title ? title[1].replace(/\\"/g, '"') : '';
  return iter([...drive.folders.values()].filter((f) => {
    if (want && (exact ? f.getName() !== want : f.getName().indexOf(want) === -1)) return false;
    if (parent && (!f._parent || f._parent.getId() !== parent[1])) return false;
    return true;
  }));
}

// Correos: se guardan aquí y NUNCA se envían (no hay ninguna conexión de red en este servidor).
const outbox = [];
function keepMail(via, o) {
  const mail = {
    n: outbox.length + 1, at: new Date(), via,
    to: String(o.to || ''), cc: String(o.cc || ''), bcc: String(o.bcc || ''), subject: String(o.subject || ''),
    html: String(o.htmlBody || ''), text: String(o.body || ''),
    attachments: (o.attachments || []).map((a) => (a && a.getName ? a.getName() : 'adjunto')),
  };
  outbox.push(mail);
  log('✉ guardado en la bandeja (no se envió): #' + mail.n + ' para ' + mail.to + ' — ' + mail.subject);
}
const mailFromArgs = (via, a, b, c, d) => keepMail(via, typeof a === 'object' && a ? a : Object.assign({ to: a, subject: b, body: c }, d || {}));

// Fechas con patrones de Java (Utilities.formatDate)
function formatDate(date, tz, fmt) {
  const d = new Date(date);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Bogota', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short' }).formatToParts(d).map((x) => [x.type, x.value]));
  const H = Number(p.hour) % 24, M = Number(p.month), D = Number(p.day), Y = p.year;
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pad = (n, l) => String(n).padStart(l || 2, '0');
  return String(fmt).replace(/'([^']*)'|yyyy|yy|MMMM|MMM|MM|M|dd|d|HH|H|hh|h|mm|m|ss|s|a|EEEE|EEE|u/g, (t, lit) => {
    if (lit !== undefined) return lit;
    switch (t) {
      case 'yyyy': return Y; case 'yy': return Y.slice(-2);
      case 'MMMM': return MONTHS[M - 1]; case 'MMM': return MONTHS[M - 1].slice(0, 3); case 'MM': return pad(M); case 'M': return String(M);
      case 'dd': return pad(D); case 'd': return String(D);
      case 'HH': return pad(H); case 'H': return String(H); case 'hh': return pad(H % 12 || 12); case 'h': return String(H % 12 || 12);
      case 'mm': return p.minute; case 'm': return String(Number(p.minute)); case 'ss': return p.second; case 's': return String(Number(p.second));
      case 'a': return H < 12 ? 'AM' : 'PM'; case 'EEEE': return p.weekday; case 'EEE': return p.weekday; case 'u': return String(wd);
      default: return t;
    }
  });
}
const signed = (buf) => [...buf].map((b) => (b > 127 ? b - 256 : b));
const toBuf = (v) => (Array.isArray(v) ? Buffer.from(v.map((b) => b & 255)) : Buffer.from(String(v), 'utf8'));

function makeCache() {
  const m = new Map();
  const live = (k) => { const e = m.get(k); if (!e) return null; if (e.exp < Date.now()) { m.delete(k); return null; } return e.v; };
  return {
    get: (k) => live(k), put: (k, v, ttl) => { m.set(k, { v: String(v), exp: Date.now() + 1000 * (ttl || 600) }); },
    getAll: (ks) => Object.fromEntries(ks.map((k) => [k, live(k)]).filter((x) => x[1] !== null)),
    putAll: (o, ttl) => Object.keys(o).forEach((k) => m.set(k, { v: String(o[k]), exp: Date.now() + 1000 * (ttl || 600) })),
    remove: (k) => m.delete(k), removeAll: (ks) => ks.forEach((k) => m.delete(k)),
  };
}

// ---------------------------------------------------------------------------
// 3. Code.gs real en un contexto aislado
// ---------------------------------------------------------------------------
function loadPlatform(ss) {
  const props = {
    WEB_APP_URL: EXEC, PLATFORM_URL: APP,
    APPROVAL_LINK_SECRET: crypto.randomBytes(32).toString('hex'),
    ANALYST_EMAILS: JSON.stringify([LAURA, DAVID, 'yprieto@equitel.com.co', 'directorcompras@equitel.com.co']),
    SUPER_ADMIN_EMAILS: JSON.stringify([DAVID, 'yprieto@equitel.com.co']),
    ROOT_DRIVE_FOLDER_ID: 'CARPETA-RAIZ-DE-PRUEBA', BACKUP_FOLDER_ID: 'CARPETA-BACKUP-DE-PRUEBA',
  };
  const html = (content) => {
    let c = String(content || '');
    const o = { _kind: 'html', getContent: () => c, setContent(x) { c = String(x); return op; }, append(x) { c += String(x); return op; } };
    const op = lenient(o, 'HtmlOutput');
    return op;
  };
  const scriptCache = makeCache();
  const ctx = {
    console: { log() {}, info() {}, warn: (...m) => console.warn('[Code.gs]', ...m), error: (...m) => console.error('[Code.gs]', ...m) },
    Logger: { log() {} },
    Utilities: lenient({
      formatDate, getUuid: () => crypto.randomUUID(), sleep() {},
      DigestAlgorithm: { MD5: 'md5', SHA_1: 'sha1', SHA_256: 'sha256', SHA_512: 'sha512' }, Charset: { UTF_8: 'utf8', US_ASCII: 'ascii' },
      computeDigest: (alg, v) => signed(crypto.createHash(alg).update(toBuf(v)).digest()),
      computeHmacSha256Signature: (v, k) => signed(crypto.createHmac('sha256', toBuf(k)).update(toBuf(v)).digest()),
      base64Encode: (v) => toBuf(v).toString('base64'), base64EncodeWebSafe: (v) => toBuf(v).toString('base64url'),
      base64Decode: (s) => signed(Buffer.from(String(s).replace(/^data:[^,]*,/, ''), 'base64')),
      base64DecodeWebSafe: (s) => signed(Buffer.from(String(s), 'base64url')),
      newBlob: (bytes, mime, name) => makeBlob(typeof bytes === 'string' ? [...Buffer.from(bytes)] : bytes, mime, name),
    }, 'Utilities'),
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null), getProperties: () => ({ ...props }), getKeys: () => Object.keys(props),
        setProperty: (k, v) => { props[k] = String(v); }, setProperties: (o) => Object.assign(props, o), deleteProperty: (k) => { delete props[k]; },
      }),
    },
    CacheService: { getScriptCache: () => scriptCache, getUserCache: () => scriptCache },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true }), getUserLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true }) },
    Session: { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => 'entorno-de-prueba@local' }), getScriptTimeZone: () => 'America/Bogota' },
    SpreadsheetApp: lenient({
      getActiveSpreadsheet: () => ss._proxy, getActive: () => ss._proxy, flush() {},
      openById() { throw new Error('En el entorno de prueba no se abren otras hojas de Google.'); },
      getUi: () => ({ alert: () => 'OK', prompt: () => ({ getSelectedButton: () => 'CANCEL', getResponseText: () => '' }), ButtonSet: { OK: 'OK', YES_NO: 'YES_NO', OK_CANCEL: 'OK_CANCEL' }, Button: { YES: 'YES', NO: 'NO', OK: 'OK', CANCEL: 'CANCEL' } }),
      CopyPasteType: {},
    }, 'SpreadsheetApp'),
    DriveApp: lenient({
      getFolderById: (id) => drive.folders.get(id) || makeFolder('Carpeta ' + id, null, id),
      getFileById: (id) => { const f = drive.files.get(id); if (!f) throw new Error('Ese archivo no está en el Drive de prueba (es de producción): ' + id); return f; },
      searchFolders, getRootFolder: () => drive.folders.get('RAIZ') || makeFolder('Mi unidad', null, 'RAIZ'),
      createFolder: (n) => makeFolder(n, null), getFoldersByName: (n) => iter([...drive.folders.values()].filter((f) => f.getName() === n)),
      getFilesByName: (n) => iter([...drive.files.values()].filter((f) => f.getName() === n)),
      Access: { ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', DOMAIN: 'DOMAIN', DOMAIN_WITH_LINK: 'DOMAIN_WITH_LINK', PRIVATE: 'PRIVATE' },
      Permission: { VIEW: 'VIEW', EDIT: 'EDIT', COMMENT: 'COMMENT', OWNER: 'OWNER', NONE: 'NONE' },
    }, 'DriveApp'),
    GmailApp: lenient({ sendEmail: (a, b, c, d) => mailFromArgs('GmailApp', a, b, c, d), getAliases: () => [] }, 'GmailApp'),
    MailApp: lenient({ sendEmail: (a, b, c, d) => mailFromArgs('MailApp', a, b, c, d), getRemainingDailyQuota: () => 1000 }, 'MailApp'),
    HtmlService: lenient({
      createHtmlOutput: (h) => html(h),
      createHtmlOutputFromFile: (name) => html(fs.readFileSync(path.join(ROOT, 'server', name + '.html'), 'utf8')),
      XFrameOptionsMode: { DEFAULT: 'DEFAULT', ALLOWALL: 'ALLOWALL' }, SandboxMode: { IFRAME: 'IFRAME', NATIVE: 'NATIVE' },
    }, 'HtmlService'),
    ContentService: {
      createTextOutput: (s) => { const o = { _kind: 'text', _text: String(s), setMimeType() { return o; }, getContent: () => o._text }; return o; },
      MimeType: { JSON: 'JSON', TEXT: 'TEXT', CSV: 'CSV', JAVASCRIPT: 'JAVASCRIPT' },
    },
    ScriptApp: lenient({
      getService: () => ({ getUrl: () => EXEC }), getProjectTriggers: () => [], deleteTrigger() {}, getScriptId: () => 'proyecto-de-prueba', getOAuthToken: () => '',
      newTrigger: () => { const b = lenient({ create: () => ({}) }, 'TriggerBuilder'); return b; },
      WeekDay: { MONDAY: 'MONDAY', TUESDAY: 'TUESDAY', WEDNESDAY: 'WEDNESDAY', THURSDAY: 'THURSDAY', FRIDAY: 'FRIDAY', SATURDAY: 'SATURDAY', SUNDAY: 'SUNDAY' },
    }, 'ScriptApp'),
    MimeType: { PDF: 'application/pdf', JPEG: 'image/jpeg', PNG: 'image/png', GIF: 'image/gif', PLAIN_TEXT: 'text/plain', CSV: 'text/csv',
      HTML: 'text/html', FOLDER: 'application/vnd.google-apps.folder', GOOGLE_DOCS: 'application/vnd.google-apps.document', GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
    UrlFetchApp: { fetch() { throw new Error('El entorno de prueba no sale a internet.'); } },
    DocumentApp: lenient({ create() { throw new Error('Los informes en Google Docs no están disponibles en el entorno de prueba.'); },
      openById() { throw new Error('Los informes en Google Docs no están disponibles en el entorno de prueba.'); } }, 'DocumentApp'),
  };
  vm.createContext(ctx);
  new vm.Script(fs.readFileSync(path.join(ROOT, 'server', 'Code.gs'), 'utf8'), { filename: 'Code.gs' }).runInContext(ctx);
  props.ADMIN_PIN_HASH = ctx.hashPin_(PIN);
  return ctx;
}

// ---------------------------------------------------------------------------
// 4. Datos de prueba: el PIN para todos y viajes para PRUEBA1
// ---------------------------------------------------------------------------
const dayKey = (n) => { const d = new Date(Date.now() + n * 86400000); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
const ddmm = (k) => k.split('-').reverse().join('-');

function seed(ctx, ss) {
  const users = ss._sheets['USUARIOS'];
  const ut = users._t;
  const pinCol = ut[0].findIndex((h) => String(h).trim().toUpperCase() === 'PIN');
  const hash = ctx.hashPin_(PIN);
  for (let i = 1; i < ut.length; i++) if (pinCol >= 0 && String(ut[i][2] || '').trim()) ut[i][pinCol] = hash;

  const req = ss._sheets['Nueva Base Solicitudes']._t;
  const H = (h) => req[0].findIndex((x) => String(x).trim() === h);
  const rowOf = (id) => req.find((r) => r[H('ID RESPUESTA')] === id);
  // Una columna que la copia no trae se crea como en producción (al final, con _ensureRequestColumn_).
  const set = (id, o) => {
    const r = rowOf(id);
    Object.keys(o).forEach((k) => {
      if (H(k) < 0) { ctx._ensureRequestColumn_(k, ''); ctx._resetPerExecutionCaches_(); }
      r[H(k)] = o[k];
    });
  };
  const cc = (ss._sheets['CDS vs UDEN']._t.slice(1).find((r) => String(r[0] || '').trim() && String(r[2] || '').trim()) || ['100', 'CENTRO DE PRUEBA', 'ADMINISTRACION']);
  const session = ctx.createSession_(DAVID, 'SUPERADMIN');
  const pax = [{ name: 'PRUEBA1', idNumber: '12345678', email: TEST_TRAVELER }];
  const make = (o) => {
    ctx._resetPerExecutionCaches_();
    const data = Object.assign({
      company: 'Equitel', origin: 'BOGOTA, COLOMBIA', destination: 'MEDELLIN, COLOMBIA', passengers: pax, requesterEmail: TEST_TRAVELER,
      costCenter: String(cc[0]).trim(), costCenterName: String(cc[1] || ''), businessUnit: String(cc[2] || '').trim(), site: 'BOGOTA', requestMode: 'FLIGHT',
      isInternational: false, policyViolation: false, requiresHotel: false, comments: 'Viaje de prueba del entorno local.', departureTimePreference: '07:00', returnTimePreference: '18:00',
      checkedBaggage: false,
    }, o);
    const r = ctx.dispatch('createRequest', { userEmail: DAVID, sessionToken: session.token, data, emailHtml: '<p>{{REQUEST_ID}}{{ACTION_BUTTONS}}</p>' });
    if (!r.success) throw new Error('No se pudo crear un viaje de prueba: ' + r.error);
    return r.data;
  };
  const approved = 'Sí_' + TEST_APPROVER + '_' + formatDate(new Date(Date.now() - 5 * 86400000), 'America/Bogota', 'd/M/yyyy H:mm');
  const bought = (id, cost, paid, extra) => set(id, Object.assign({
    STATUS: 'RESERVADO', 'COSTO_FINAL_TIQUETES': cost, 'COSTO_FINAL_HOTEL': 0, 'COSTO COTIZADO PARA VIAJE': cost, 'VALOR COMPRA TIQUETES': paid,
    'No RESERVA': 'PRB' + id.slice(-3), AEROLINEA: 'AVIANCA', 'CANAL DE COMPRA': 'Aviatur', 'TIPO DE COMPRA DE TKT': 'TIPO 2', 'TARIFA NOMBRE': 'Classic',
    'TARIFA RECOMENDADA': 'TIPO 2', 'MALETA DE BODEGA': 'NO', 'TARJETA DE CREDITO CON LA QUE SE HIZO LA COMPRA': 'TC-PRUEBA',
    'FECHA DE COMPRA DE TIQUETE': new Date(Date.now() - 4 * 86400000), 'CORREO DE QUIEN APRUEBA (AUTOMÁTICO)': TEST_APPROVER,
    'APROBADO POR ÁREA? (AUTOMÁTICO)': approved, 'VIOLACION POLITICA': 'NO',
    EVENTOS_JSON: JSON.stringify({ created: new Date(Date.now() - 9 * 86400000).toISOString(), costConfirmed: new Date(Date.now() - 6 * 86400000).toISOString(),
      reservationRegistered: new Date(Date.now() - 4 * 86400000).toISOString() }),
  }, extra || {}));
  const trips = [];
  let id = make({ destination: 'MEDELLIN, COLOMBIA', departureDate: ddmm(dayKey(10)), returnDate: ddmm(dayKey(12)) });
  bought(id, 812000, 780000); trips.push([id, 'Comprado, sale en 10 días: se puede cambiar todo']);
  id = make({ destination: 'CALI, COLOMBIA', departureDate: ddmm(dayKey(1)), returnDate: ddmm(dayKey(3)), departureTimePreference: '06:00' });
  bought(id, 655000, 655000, { AEROLINEA: 'LATAM', 'TARIFA NOMBRE': 'Light' }); trips.push([id, 'Comprado, sale mañana: plazo hasta las 5 p. m. del día hábil anterior']);
  id = make({ destination: 'BARRANQUILLA, COLOMBIA', departureDate: ddmm(dayKey(-1)), returnDate: ddmm(dayKey(3)) });
  bought(id, 930000, 902000); trips.push([id, 'En curso (la ida ya voló): solo se cambia el regreso']);
  id = make({ destination: 'BUCARAMANGA, COLOMBIA', departureDate: ddmm(dayKey(15)), returnDate: ddmm(dayKey(16)) });
  set(id, { STATUS: 'APROBADO', 'COSTO_FINAL_TIQUETES': 540000, 'COSTO COTIZADO PARA VIAJE': 540000, 'CORREO DE QUIEN APRUEBA (AUTOMÁTICO)': TEST_APPROVER,
    'APROBADO POR ÁREA? (AUTOMÁTICO)': approved, 'TIPO DE COMPRA DE TKT': 'TIPO 1', 'TARIFA RECOMENDADA': 'TIPO 1', 'TARIFA NOMBRE': 'Basic', 'VIOLACION POLITICA': 'NO' });
  trips.push([id, 'Aprobado y sin comprar: el cambio se cotiza de nuevo, sin penalidad']);
  id = make({ requestMode: 'HOTEL_ONLY', origin: '', destination: 'CALI, COLOMBIA', departureDate: ddmm(dayKey(20)), returnDate: ddmm(dayKey(23)), requiresHotel: true,
    hotelName: 'Hotel de prueba', nights: 3, departureTimePreference: '', returnTimePreference: '' });
  set(id, { STATUS: 'RESERVADO', 'COSTO_FINAL_TIQUETES': 0, 'COSTO_FINAL_HOTEL': 690000, 'COSTO COTIZADO PARA VIAJE': 690000, 'No RESERVA': 'HTL-PRB',
    'CANAL DE COMPRA': 'Directo', 'HOTEL RESERVADO': 'HOTEL DE PRUEBA', 'CANAL DE COMPRA HOTEL': 'Directo', 'VALOR COMPRA HOTEL': 690000,
    'CORREO DE QUIEN APRUEBA (AUTOMÁTICO)': TEST_APPROVER, 'APROBADO POR ÁREA? (AUTOMÁTICO)': approved, 'VIOLACION POLITICA': 'NO',
    'FECHA DE COMPRA DE TIQUETE': new Date(Date.now() - 2 * 86400000) });
  trips.push([id, 'Solo hospedaje, reservado: cambio de fechas del hotel']);
  ctx._resetPerExecutionCaches_();
  outbox.length = 0; // los avisos de crear los viajes de prueba no interesan
  return trips;
}

// ---------------------------------------------------------------------------
// 5. Servidores: API (8787) y la app compilada (3100)
// ---------------------------------------------------------------------------
// Las direcciones de Drive van al Drive simulado; lo que no esté allí (el logo, archivos
// de producción) se redirige a Google como siempre.
const rewriteDrive = (s) => String(s).split('https://drive.google.com/').join(API + '/gdrive/').split('https://lh3.googleusercontent.com/').join(API + '/glh3/');
const SHIM = `<script>
/* Entorno de prueba: google.script.run llama al servidor local. */
window.google = { script: { host: { close: function () {}, setHeight: function () {}, setWidth: function () {} }, run: (function () {
  function runner(ok, fail) {
    return new Proxy({}, { get: function (_, name) {
      if (name === 'withSuccessHandler') return function (f) { return runner(f, fail); };
      if (name === 'withFailureHandler') return function (f) { return runner(ok, f); };
      if (name === 'withUserObject') return function () { return runner(ok, fail); };
      return function () {
        var a = Array.prototype.slice.call(arguments);
        fetch('${API}/run', { method: 'POST', body: JSON.stringify({ fn: name, args: a }) }).then(function (r) { return r.json(); })
          .then(function (res) { if (res.ok) { if (ok) ok(res.value); } else if (fail) fail(new Error(res.error)); })
          .catch(function (e) { if (fail) fail(e); });
      };
    } });
  }
  return runner(null, null);
})() } };
</script>`;
const PAGE_BANNER = '<div style="position:fixed;bottom:8px;left:8px;z-index:99999;background:#7c2d12;color:#fff;font:12px system-ui;padding:6px 10px;border-radius:6px;opacity:.9">ENTORNO DE PRUEBA · copia local, nada llega a producción · <a href="' + API + '/" style="color:#fde68a">inicio</a></div>';
const withShim = (h) => {
  let s = rewriteDrive(h);
  s = /<head[^>]*>/i.test(s) ? s.replace(/<head[^>]*>/i, (m) => m + SHIM) : SHIM + s;
  return /<\/body>/i.test(s) ? s.replace(/<\/body>/i, PAGE_BANNER + '</body>') : s + PAGE_BANNER;
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const readBody = (req) => new Promise((ok, bad) => { const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => ok(Buffer.concat(ch).toString('utf8'))); req.on('error', bad); });
function send(res, code, type, body, extra) {
  res.writeHead(code, Object.assign({ 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' }, extra || {}));
  res.end(body);
}
function asResponse(res, out) {
  if (out && out._kind === 'html') return send(res, 200, 'text/html; charset=utf-8', withShim(out.getContent()));
  if (out && out._kind === 'text') return send(res, 200, 'application/json; charset=utf-8', rewriteDrive(out._text));
  return send(res, 200, 'application/json; charset=utf-8', rewriteDrive(JSON.stringify(out)));
}
function driveRequest(res, prefix, rest, query) {
  const m = /(?:file\/d\/|folders\/|^d\/)([-\w]{20,})/.exec(rest) || /[?&]id=([-\w]{20,})/.exec('?' + query);
  const id = m && m[1].replace(/=.*$/, '');
  const file = id && drive.files.get(id);
  if (file) return send(res, 200, file._mime || 'application/octet-stream', file._buf, { 'Content-Disposition': 'inline; filename="' + encodeURIComponent(file.getName()) + '"' });
  const folder = id && drive.folders.get(id);
  if (folder) {
    const files = [...drive.files.values()].filter((f) => f._parent === folder && !f.isTrashed());
    return send(res, 200, 'text/html; charset=utf-8', '<meta charset="utf-8"><body style="font-family:system-ui;padding:20px"><h2>📁 ' + esc(folder.getName()) +
      ' <small style="color:#888">(Drive de prueba)</small></h2><ul>' + files.map((f) => '<li><a href="' + API + '/gdrive/file/d/' + f.getId() + '/view">' + esc(f.getName()) + '</a></li>').join('') + '</ul></body>');
  }
  return send(res, 302, 'text/plain', '', { Location: prefix + rest + (query ? '?' + query : '') });
}

function startApi(ctx, ss, trips) {
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, API);
      if (req.method === 'OPTIONS') return send(res, 204, 'text/plain', '');
      if (u.pathname === '/exec' && req.method === 'POST') {
        const body = await readBody(req);
        return asResponse(res, ctx.doPost({ postData: { contents: body, type: 'text/plain' }, parameter: {}, parameters: {} }));
      }
      if (u.pathname === '/exec') {
        const p = Object.fromEntries(u.searchParams.entries());
        return asResponse(res, ctx.doGet({ parameter: p, parameters: Object.fromEntries(Object.keys(p).map((k) => [k, [p[k]]])), queryString: u.search.slice(1) }));
      }
      if (u.pathname === '/run' && req.method === 'POST') {
        const { fn, args: a } = JSON.parse(await readBody(req) || '{}');
        // Solo las funciones que llaman las páginas del web app (dashboard de costos y panel móvil).
        if (!(/^(costsDashboard_|mobileAdmin_)\w+$/.test(String(fn)) || fn === 'verifyUserPin' || fn === 'verifyAdminPin') || typeof ctx[fn] !== 'function') return send(res, 200, 'application/json', JSON.stringify({ ok: false, error: 'Función no disponible: ' + fn }));
        ctx._resetPerExecutionCaches_();
        try { return send(res, 200, 'application/json; charset=utf-8', rewriteDrive(JSON.stringify({ ok: true, value: ctx[fn].apply(null, a || []) }))); }
        catch (e) { return send(res, 200, 'application/json', JSON.stringify({ ok: false, error: String(e && e.message || e) })); }
      }
      if (u.pathname.startsWith('/gdrive/')) return driveRequest(res, 'https://drive.google.com/', u.pathname.slice(8), u.search.slice(1));
      if (u.pathname.startsWith('/glh3/')) return driveRequest(res, 'https://lh3.googleusercontent.com/', u.pathname.slice(6), u.search.slice(1));
      if (u.pathname === '/correos') return send(res, 200, 'text/html; charset=utf-8', outboxPage());
      const mm = /^\/correos\/(\d+)$/.exec(u.pathname);
      if (mm) {
        const mail = outbox[Number(mm[1]) - 1];
        if (!mail) return send(res, 404, 'text/plain; charset=utf-8', 'No existe ese correo.');
        return send(res, 200, 'text/html; charset=utf-8', mailPage(mail));
      }
      if (u.pathname === '/' || u.pathname === '/inicio') return send(res, 200, 'text/html; charset=utf-8', homePage(ctx, ss, trips));
      return send(res, 404, 'text/plain; charset=utf-8', 'No encontrado.');
    } catch (e) {
      console.error('[prueba] error:', e && e.stack || e);
      return send(res, 500, 'application/json', JSON.stringify({ success: false, error: 'Entorno de prueba: ' + (e && e.message || e) }));
    }
  });
  server.listen(API_PORT, HOST);
  return server;
}

function buildApp() {
  const out = path.join(os.tmpdir(), 'equitel-entorno-prueba-app');
  if (args.sinBuild && fs.existsSync(path.join(out, 'index.html'))) return out;
  log('Compilando la app tal cual se publica (vite build) contra ' + EXEC + ' …');
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'warn'],
    { cwd: ROOT, env: Object.assign({}, process.env, { VITE_API_BASE_URL: EXEC }), stdio: 'inherit' });
  return out;
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.gif': 'image/gif' };
function startApp(dir) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, APP);
    let file = path.normalize(path.join(dir, decodeURIComponent(u.pathname)));
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html');
    const ext = path.extname(file).toLowerCase();
    let body = fs.readFileSync(file);
    if (ext === '.js' || ext === '.html') body = Buffer.from(rewriteDrive(body.toString('utf8')));
    if (ext === '.html') body = Buffer.from(body.toString('utf8').replace(/<\/body>/i, PAGE_BANNER + '</body>'));
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  });
  server.listen(APP_PORT, HOST);
  return server;
}

// ---------------------------------------------------------------------------
// 6. Páginas del entorno
// ---------------------------------------------------------------------------
const STYLE = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f8fafc;color:#111827}' +
  '.w{max-width:980px;margin:0 auto;padding:20px 16px 60px}h1{font-size:22px;margin:8px 0}h2{font-size:16px;margin:26px 0 8px}' +
  '.warn{background:#fff7ed;border:1px solid #fdba74;border-left:5px solid #ea580c;border-radius:8px;padding:12px 14px;font-size:14px;line-height:1.5}' +
  'table{width:100%;border-collapse:collapse;background:#fff;font-size:13px}th,td{border-bottom:1px solid #e5e7eb;padding:7px 8px;text-align:left;vertical-align:top}th{background:#f1f5f9;font-size:12px}' +
  '.btn{display:inline-block;background:#b91c1c;color:#fff;text-decoration:none;padding:9px 14px;border-radius:6px;font-weight:600;margin:4px 6px 4px 0}.btn.alt{background:#1f2937}' +
  'code{background:#eef2ff;padding:1px 5px;border-radius:4px}ol li{margin:6px 0;line-height:1.45}.muted{color:#6b7280;font-size:12px}</style>';
function homePage(ctx, ss, trips) {
  const req = ss._sheets['Nueva Base Solicitudes']._t;
  const H = (h) => req[0].findIndex((x) => String(x).trim() === h);
  const now = Date.now();
  const rows = trips.map(([id, what]) => {
    const r = req.find((x) => x[H('ID RESPUESTA')] === id) || [];
    const dep = ctx._psDateKey_(r[H('FECHA IDA')]), ret = ctx._psDateKey_(r[H('FECHA VUELTA')]);
    const w = ctx._tripChangeWindow_(dep, ret, now, false);
    const win = w.open ? (w.mode === 'return' ? 'Solo el regreso, ' : 'Todo, ') + 'hasta el ' + ctx._changeDeadlineText_(w.deadlineKey, w.deadlineHour)
      : w.reason === 'ended' ? 'El viaje terminó' : 'Venció el plazo (' + (w.deadlineKey ? ctx._changeDeadlineText_(w.deadlineKey, w.deadlineHour) : '—') + '): solo el área de viajes';
    const replaced = H('REEMPLAZADA POR') >= 0 ? r[H('REEMPLAZADA POR')] : '';
    return '<tr><td><b>' + esc(id) + '</b></td><td>' + esc(what) + '</td><td>' + esc(r[H('STATUS')]) + (replaced ? '<br><span class="muted">Cambiada por ' + esc(replaced) + '</span>' : '') +
      '</td><td>' + esc(String(r[H('CIUDAD ORIGEN')] || '').split(',')[0]) + ' → ' + esc(String(r[H('CIUDAD DESTINO')] || '').split(',')[0]) + '<br><span class="muted">' + esc(dep) + (ret ? ' a ' + esc(ret) : '') +
      '</span></td><td>' + esc(win) + '</td></tr>';
  }).join('');
  return '<!doctype html><title>Entorno de prueba · Equitel Viajes</title>' + STYLE + '<div class="w">' +
    '<h1>🧪 Entorno de prueba · Equitel Viajes</h1>' +
    '<div class="warn"><b>Copia local de la base exportada.</b> Nada de lo que haga aquí llega a producción ni a Google: la hoja vive en la memoria de este PC, ' +
    'los archivos en un Drive simulado y <b>los correos no se envían</b> (quedan en la bandeja de abajo). Al cerrar el servidor todo vuelve a la copia original.</div>' +
    '<h2>Entrar</h2><p><a class="btn" href="' + APP + '" target="_blank">Abrir la app</a><a class="btn alt" href="' + EXEC + '?action=costs-dashboard" target="_blank">Dashboard de costos</a>' +
    '<a class="btn alt" href="' + API + '/correos" target="_blank">Bandeja de correos (' + outbox.length + ')</a></p>' +
    '<p>El PIN de <b>todos</b> los usuarios y el de administrador es <code>' + esc(PIN) + '</code>.</p>' +
    '<table><tr><th>Quién</th><th>Correo</th><th>Cómo entra</th></tr>' +
    '<tr><td>Viajero de prueba (PRUEBA1)</td><td><code>' + TEST_TRAVELER + '</code></td><td>Correo y PIN (solicitante)</td></tr>' +
    '<tr><td>Su aprobador (PRUEBA2)</td><td><code>' + TEST_APPROVER + '</code></td><td>Aprueba desde el correo en la bandeja</td></tr>' +
    '<tr><td>Área de viajes (Laura)</td><td><code>' + LAURA + '</code></td><td>Botón ADMINISTRADOR, PIN de administrador</td></tr>' +
    '<tr><td>David</td><td><code>' + DAVID + '</code></td><td>Botón ADMINISTRADOR; en el dashboard de costos ve el comparador</td></tr></table>' +
    '<h2>Viajes de PRUEBA1 para probar «Cambiar mi viaje»</h2><table><tr><th>Solicitud</th><th>Para qué sirve</th><th>Estado</th><th>Viaje</th><th>¿Qué puede cambiar hoy el viajero?</th></tr>' + rows + '</table>' +
    '<p class="muted">Todas las demás solicitudes son las de producción (copia del ' + esc(BASE_LABEL) + '). También se pueden usar, sin miedo: nada se guarda en la hoja real.</p>' +
    '<h2>Recorrido sugerido</h2><ol>' +
    '<li>Entre a la app como <b>PRUEBA1</b>. Arriba verá el aviso del sistema nuevo de cambios. Abra el viaje comprado que sale en 10 días y toque <b>😕 Cambiar mi viaje</b>: cambie la hora, la fecha o agregue maleta, escriba el motivo y envíe.</li>' +
    '<li>En la <a href="' + API + '/correos" target="_blank">bandeja</a> verá el aviso al área de viajes. Entre como <b>Laura</b> (ADMINISTRADOR): en la solicitud de cambio toque <b>ACEPTAR Y COTIZAR</b> (verá lo ya comprado y el mensaje para la agencia), cargue opciones o salte la selección, y en <b>Confirmar costos</b> escriba la penalidad y la diferencia de tarifa.</li>' +
    '<li>En la bandeja abra el correo <b>APROBACIÓN DE CAMBIO</b> para PRUEBA2: muestra lo que costó el viaje, el costo del cambio y el viaje con el cambio. Apruebe desde el botón del correo.</li>' +
    '<li>Como Laura, <b>registre la reserva</b> del cambio (cualquier PDF). La solicitud original queda «Cambiada» (no se anula) y el viajero ve el viaje vigente.</li>' +
    '<li>Revise el control: <b>Métricas → 🔄 Cambios</b> en la app, la sección <b>Cambios de viaje</b> del dashboard de costos y, como David, el <b>comparador de precios</b> con la cifra corregida.</li>' +
    '<li>Pruebe también los límites: el viaje que sale mañana (después de las 5 p. m. del día hábil anterior ya no deja), el viaje en curso (solo el regreso) y el que no se ha comprado.</li></ol>' +
    '<p class="muted">Para empezar de cero: cierre el servidor (Ctrl+C en la terminal) y vuelva a correrlo.</p></div>';
}
function outboxPage() {
  return '<!doctype html><title>Bandeja de correos · prueba</title>' + STYLE + '<div class="w"><h1>✉ Bandeja de correos del entorno de prueba</h1>' +
    '<div class="warn">Estos correos <b>no se enviaron</b>: el entorno de prueba los guarda aquí. Los botones de aprobar y rechazar funcionan contra la copia local.</div>' +
    '<p><a href="' + API + '/">← Inicio</a> · <a href="' + API + '/correos">Actualizar</a></p>' +
    (outbox.length ? '<table><tr><th>#</th><th>Hora</th><th>Para</th><th>Asunto</th></tr>' + outbox.slice().reverse().map((m) =>
      '<tr><td>' + m.n + '</td><td>' + esc(formatDate(m.at, 'America/Bogota', 'd/M H:mm:ss')) + '</td><td>' + esc(m.to) + (m.cc ? '<br><span class="muted">cc ' + esc(m.cc) + '</span>' : '') +
      '</td><td><a href="' + API + '/correos/' + m.n + '" target="_blank">' + esc(m.subject) + '</a>' + (m.attachments.length ? '<br><span class="muted">📎 ' + esc(m.attachments.join(', ')) + '</span>' : '') + '</td></tr>').join('') + '</table>'
      : '<p>Todavía no hay correos.</p>') + '</div>';
}
function mailPage(m) {
  const head = '<div style="font:13px system-ui;background:#fff7ed;border-bottom:1px solid #fdba74;padding:10px 14px">' +
    '<b>Entorno de prueba — este correo no se envió.</b><br>Para: ' + esc(m.to) + (m.cc ? ' · cc: ' + esc(m.cc) : '') + '<br>Asunto: <b>' + esc(m.subject) + '</b> · <a href="' + API + '/correos">← bandeja</a></div>';
  return '<!doctype html><meta charset="utf-8">' + head + rewriteDrive(m.html || '<pre style="white-space:pre-wrap;font:13px system-ui;padding:14px">' + esc(m.text) + '</pre>');
}

// ---------------------------------------------------------------------------
// 7. Arranque
// ---------------------------------------------------------------------------
let BASE_LABEL = '';
(function main() {
  const t0 = Date.now();
  BASE_LABEL = path.basename(String(args.base || ''));
  const base = loadBase(args.base);
  if (!base['Nueva Base Solicitudes'] || !base['USUARIOS']) fail('La base no trae las hojas «Nueva Base Solicitudes» y «USUARIOS».');
  const ss = makeSpreadsheet(base);
  const ctx = loadPlatform(ss);
  const trips = seed(ctx, ss);
  const dir = buildApp();
  startApi(ctx, ss, trips);
  startApp(dir);
  log('Listo en ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s. Solicitudes en la copia: ' + (ss._sheets['Nueva Base Solicitudes']._t.length - 1) + '.');
  log('Inicio y guía:  ' + API + '/');
  log('La app:         ' + APP);
  log('Correos:        ' + API + '/correos   (no se envían)');
  log('PIN de todos:   ' + PIN + '      Detener: Ctrl+C');
})();
