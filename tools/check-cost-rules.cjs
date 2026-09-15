#!/usr/bin/env node
/**
 * Verifica las reglas de los costos que confirma el área de viajes (#A79) y que
 * los DOS lados coincidan:
 *
 *   - `server/Code.gs`  → `_formatCop_`, `_parseCopAmount_`, `_validateCostAmount_`, `COST_MIN_PESOS`
 *   - `utils/money.ts`  → `formatCop`, `parseCopAmount`, `validateCostAmount`, `COST_MIN_PESOS`
 *
 * Reglas (David, 2026-09-14): pesos enteros, con o sin puntos de miles; los
 * centavos se redondean; 0 es válido y cualquier otro valor debe ser de al menos
 * $10.000. Un número con decimales se rechaza: así llegaba "889.518" escrito con
 * punto de miles.
 *
 * Son gemelos escritos a mano porque Apps Script y Vite/TS no comparten código.
 * Este chequeo falla si algún lado no da el resultado esperado de un caso, o si
 * los dos lados difieren en aceptación, valor o mensaje de error. Las funciones
 * se extraen por nombre: renombrarlas o borrarlas también falla.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  if (start === -1) throw new Error(`No se encontró la función ${name}() en server/Code.gs`);
  let depth = 0;
  for (let j = source.indexOf('{', start); j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(start, j + 1);
  }
  throw new Error(`No se pudo delimitar ${name}() en server/Code.gs`);
}

function loadBackend() {
  const gs = fs.readFileSync(path.join(ROOT, 'server', 'Code.gs'), 'utf8');
  const min = gs.match(/^var COST_MIN_PESOS = (\d+);$/m);
  if (!min) throw new Error('No se encontró "var COST_MIN_PESOS = …;" en server/Code.gs');
  const code = [min[0], extractFunction(gs, '_formatCop_'), extractFunction(gs, '_parseCopAmount_'), extractFunction(gs, '_validateCostAmount_')].join('\n');
  const ctx = {};
  vm.createContext(ctx);
  new vm.Script(code, { filename: 'Code.gs (extracto costos)' }).runInContext(ctx);
  const call = (expr, args) => { ctx.__a = args; return vm.runInContext(expr, ctx); };
  return {
    min: Number(min[1]),
    format: (n) => call('_formatCop_(__a[0])', [n]),
    parse: (raw) => call('_parseCopAmount_(__a[0])', [raw]),
    validate: (raw, label, required) => call('_validateCostAmount_(__a[0], __a[1], __a[2])', [raw, label, required]),
  };
}

function loadFrontend() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
  const src = fs.readFileSync(path.join(ROOT, 'utils', 'money.ts'), 'utf8');
  const out = esbuild.transformSync(src, { loader: 'ts', format: 'cjs' });
  const mod = { exports: {} };
  new vm.Script(out.code, { filename: 'money.ts' }).runInNewContext({ module: mod, exports: mod.exports, require });
  const e = mod.exports;
  if (typeof e.formatCop !== 'function' || typeof e.parseCopAmount !== 'function' || typeof e.validateCostAmount !== 'function' || typeof e.COST_MIN_PESOS !== 'number') {
    throw new Error('utils/money.ts no exporta formatCop(), parseCopAmount(), validateCostAmount() y COST_MIN_PESOS');
  }
  return { min: e.COST_MIN_PESOS, format: e.formatCop, parse: e.parseCopAmount, validate: e.validateCostAmount };
}

const T = 'de los tiquetes', HOT = 'del hotel';
// [entrada, etiqueta, obligatorio, ok esperado, valor esperado]
const CASES = [
  // con y sin puntos de miles
  ['889.518', T, true, true, 889518], ['889518', T, true, true, 889518], ['889,518', T, true, true, 889518],
  ['$ 889.518', T, true, true, 889518], [' 1 200 000 ', T, true, true, 1200000], ['1.200.000', T, true, true, 1200000],
  ['1,200,000', T, true, true, 1200000], ['10.000', T, true, true, 10000], [889518, T, true, true, 889518],
  // centavos: se redondean
  ['1.234.567,50', T, true, true, 1234568], ['1,234,567.49', T, true, true, 1234567], ['889.518,00', T, true, true, 889518],
  // cero y vacío
  ['0', HOT, true, true, 0], [0, HOT, true, true, 0], ['', HOT, false, true, 0], [null, HOT, false, true, 0],
  ['', HOT, true, false], ['   ', T, true, false], [undefined, T, true, false],
  // imposibles: menos de $10.000
  ['800', T, true, false], ['9.999', T, true, false], ['1.500', T, true, false], ['889.51', T, true, false],
  ['1.5', T, true, false], [889, T, true, false], [1, HOT, false, false],
  // números con decimales (formulario anterior o API)
  [889.518, T, true, false], [299.468, T, false, false], [1234567.5, T, true, false],
  // no son pesos
  ['12a', T, true, false], ['-5000', T, true, false], [-5000, T, true, false], ['12.34.567', T, true, false],
  ['88.9518', T, true, false], ['1.234,567', T, true, false], ['.50', T, true, false], [NaN, T, true, false], [Infinity, T, true, false],
];

function main() {
  let back, front;
  try {
    back = loadBackend();
    front = loadFrontend();
  } catch (e) {
    console.error('✗ No se pudieron cargar los validadores de costos:\n  ' + e.message);
    process.exit(1);
  }
  const failures = [];
  if (back.min !== front.min) failures.push({ input: 'COST_MIN_PESOS', problems: [`backend ${back.min} y frontend ${front.min}`] });
  for (const n of [0, 999, 1000, 10000, 889518, 1234567, 123456789]) {
    if (back.format(n) !== front.format(n)) failures.push({ input: n, problems: [`formatCop difiere: ${back.format(n)} / ${front.format(n)}`] });
  }
  if (front.format(889518) !== '889.518' || front.format(1234567) !== '1.234.567') failures.push({ input: 'formatCop', problems: ['no usa punto de miles'] });
  for (const [input, label, required, expectOk, expectValue] of CASES) {
    const b = back.validate(input, label, required);
    const f = front.validate(input, label, required);
    const problems = [];
    for (const [side, r] of [['backend', b], ['frontend', f]]) {
      if (r.ok !== expectOk) problems.push(`${side} ${r.ok ? 'acepta' : 'rechaza'} y se esperaba lo contrario`);
      else if (expectOk && r.value !== expectValue) problems.push(`${side} da ${JSON.stringify(r.value)}`);
      else if (!r.ok && !r.error) problems.push(`${side} rechaza sin mensaje`);
    }
    if (b.ok !== f.ok || b.value !== f.value || (b.error || '') !== (f.error || '')) problems.push('frontend y backend no coinciden');
    if (JSON.stringify(back.parse(input)) !== JSON.stringify(front.parse(input))) problems.push('parseCopAmount difiere entre frontend y backend');
    if (problems.length) failures.push({ input, label, required, expectOk, expectValue, b, f, problems });
  }
  if (failures.length > 0) {
    console.error(`\n✗ Costos: ${failures.length} caso(s) con problemas.\n`);
    for (const x of failures) {
      console.error(`  entrada: ${JSON.stringify(x.input)}${x.label ? ` (${x.label}${x.required ? ', obligatorio' : ''}) — esperado: ${x.expectOk ? 'acepta → ' + x.expectValue : 'rechaza'}` : ''}`);
      x.problems.forEach((p) => console.error(`    · ${p}`));
      if (x.b) { console.error(`    backend : ${JSON.stringify(x.b)}`); console.error(`    frontend: ${JSON.stringify(x.f)}\n`); }
    }
    process.exit(1);
  }
  const accepted = CASES.filter((c) => c[3]).length;
  console.log(`Costos: ${CASES.length} casos OK, frontend y backend coinciden (${accepted} aceptados, ${CASES.length - accepted} rechazados; mínimo $${front.format(front.min)}).`);
}

main();
