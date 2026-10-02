#!/usr/bin/env node
/**
 * Verifica las reglas de aerolínea y canal de compra (#A82) y que los DOS lados
 * coincidan:
 *
 *   - `server/Code.gs`    → `_normalizePurchaseInfo_`, `_purchaseKey_`, `PURCHASE_CHANNELS`, `PURCHASE_AIRLINES`
 *   - `utils/purchase.ts` → `normalizePurchaseInfo`, `PURCHASE_CHANNELS`, `PURCHASE_AIRLINES`
 *
 * Reglas: el canal es Aviatur, Directo u Otra agencia (sin importar tildes ni
 * mayúsculas); la aerolínea es obligatoria salvo en solo hospedaje, máximo 40
 * caracteres, solo letras, números, espacios y . & ' / -; los nombres conocidos
 * se guardan con su escritura oficial (latam → LATAM).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function extract(source, name, kind) {
  const start = source.indexOf(kind === 'var' ? 'var ' + name + ' = ' : 'function ' + name + '(');
  if (start === -1) throw new Error(`No se encontró ${name} en server/Code.gs`);
  if (kind === 'var') return source.slice(start, source.indexOf(';', start) + 1);
  let depth = 0;
  for (let j = source.indexOf('{', start); j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(start, j + 1);
  }
  throw new Error(`No se pudo delimitar ${name}() en server/Code.gs`);
}

function loadBackend() {
  const gs = fs.readFileSync(path.join(ROOT, 'server', 'Code.gs'), 'utf8');
  const code = [extract(gs, 'PURCHASE_CHANNELS', 'var'), extract(gs, 'PURCHASE_AIRLINES', 'var'), extract(gs, 'PURCHASE_AIRLINE_MAX', 'var'),
    extract(gs, '_purchaseKey_'), extract(gs, '_normalizePurchaseInfo_')].join('\n');
  const ctx = {};
  vm.createContext(ctx);
  new vm.Script(code, { filename: 'Code.gs (extracto compra)' }).runInContext(ctx);
  return {
    channels: vm.runInContext('PURCHASE_CHANNELS', ctx), airlines: vm.runInContext('PURCHASE_AIRLINES', ctx),
    check: (a, c, h) => { ctx.__a = [a, c, h]; return vm.runInContext('_normalizePurchaseInfo_(__a[0], __a[1], __a[2])', ctx); },
  };
}

function loadFrontend() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
  const src = fs.readFileSync(path.join(ROOT, 'utils', 'purchase.ts'), 'utf8');
  const out = esbuild.transformSync(src, { loader: 'ts', format: 'cjs' });
  const mod = { exports: {} };
  new vm.Script(out.code, { filename: 'purchase.ts' }).runInNewContext({ module: mod, exports: mod.exports, require });
  const e = mod.exports;
  if (typeof e.normalizePurchaseInfo !== 'function') throw new Error('utils/purchase.ts no exporta normalizePurchaseInfo()');
  return { channels: e.PURCHASE_CHANNELS, airlines: e.PURCHASE_AIRLINES, check: e.normalizePurchaseInfo };
}

// [aerolínea, canal, soloHospedaje, ok esperado, aerolínea guardada, canal guardado]
const CASES = [
  ['LATAM', 'Aviatur', false, true, 'LATAM', 'Aviatur'],
  ['latam', 'aviatur', false, true, 'LATAM', 'Aviatur'],
  ['  avianca  ', 'DIRECTO', false, true, 'Avianca', 'Directo'],
  ['aeromexico', 'otra agencia', false, true, 'Aeroméxico', 'Otra agencia'],
  ['AEROMÉXICO', 'Otra  Agencia', false, true, 'Aeroméxico', 'Otra agencia'],
  ['jetsmart', 'Aviatur', false, true, 'JetSMART', 'Aviatur'],
  ['Turkish Airlines', 'Aviatur', false, true, 'Turkish Airlines', 'Aviatur'],
  ['Air France / KLM', 'Directo', false, true, 'Air France / KLM', 'Directo'],
  ["Viva Air Perú", 'Directo', false, true, 'Viva Air Perú', 'Directo'],
  ['varias aerolineas', 'Aviatur', false, true, 'Varias aerolíneas', 'Aviatur'],
  ['', 'Aviatur', true, true, '', 'Aviatur'],
  ['LATAM', 'Directo', true, true, '', 'Directo'],
  ['', 'Aviatur', false, false],
  ['   ', 'Aviatur', false, false],
  [null, 'Aviatur', false, false],
  ['LATAM', '', false, false],
  ['LATAM', undefined, false, false],
  ['', '', true, false],
  ['LATAM', 'Booking', false, false],
  ['LATAM', 'aviatur.com', false, false],
  ['=HYPERLINK("x")', 'Aviatur', false, false],
  ['+57 Air', 'Aviatur', false, false],
  ['-Avianca', 'Aviatur', false, false],
  ['Avianca<script>', 'Aviatur', false, false],
  ['A'.repeat(41), 'Aviatur', false, false],
  ['A'.repeat(40), 'Aviatur', false, true, 'A'.repeat(40), 'Aviatur'],
  ['Avianca × 2', 'Aviatur', false, false],
];

function main() {
  let back, front;
  try { back = loadBackend(); front = loadFrontend(); } catch (e) {
    console.error('✗ No se pudieron cargar las reglas de aerolínea y canal:\n  ' + e.message);
    process.exit(1);
  }
  const failures = [];
  if (JSON.stringify(back.channels) !== JSON.stringify(front.channels)) failures.push('Los canales difieren entre backend y frontend.');
  if (JSON.stringify(back.airlines) !== JSON.stringify(front.airlines)) failures.push('La lista de aerolíneas difiere entre backend y frontend.');
  for (const [a, c, h, ok, airline, channel] of CASES) {
    const b = back.check(a, c, h), f = front.check(a, c, h);
    const tag = JSON.stringify([a, c, h]);
    for (const [side, r] of [['backend', b], ['frontend', f]]) {
      if (r.ok !== ok) failures.push(`${tag}: ${side} ${r.ok ? 'acepta' : 'rechaza'} y se esperaba lo contrario`);
      else if (ok && (r.airline !== airline || r.channel !== channel)) failures.push(`${tag}: ${side} guarda ${JSON.stringify([r.airline, r.channel])}`);
      else if (!ok && !r.error) failures.push(`${tag}: ${side} rechaza sin mensaje`);
    }
    if (JSON.stringify(b) !== JSON.stringify(f)) failures.push(`${tag}: frontend y backend no coinciden (${JSON.stringify(b)} / ${JSON.stringify(f)})`);
  }
  if (failures.length) {
    console.error(`\n✗ Aerolínea y canal: ${failures.length} problema(s).\n`);
    failures.forEach((x) => console.error('  · ' + x));
    process.exit(1);
  }
  console.log(`Aerolínea y canal: ${CASES.length} casos OK, frontend y backend coinciden.`);
}

main();
