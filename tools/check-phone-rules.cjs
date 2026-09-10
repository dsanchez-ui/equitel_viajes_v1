#!/usr/bin/env node
/**
 * Verifica las reglas del celular del pasajero y que los DOS validadores coincidan:
 *
 *   - `server/Code.gs`  → `_normalizePhone_`, `_validateOptionalPhone_`
 *   - `utils/phone.ts`  → `normalizePhone`, `validateOptionalPhone`
 *
 * Reglas (David, 2026-09-10): opcional; si se escribe, celular colombiano de 10
 * dígitos que empieza por 3; se guarda sin espacios.
 *
 * Son gemelos escritos a mano porque Apps Script y Vite/TS no comparten código.
 * Este chequeo falla si algún lado no da el resultado esperado de un caso, o si
 * los dos lados difieren en aceptación, valor normalizado o mensaje de error.
 * Las funciones se extraen por nombre: renombrarlas o borrarlas también falla.
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
  const code = [extractFunction(gs, '_normalizePhone_'), extractFunction(gs, '_validateOptionalPhone_')].join('\n');
  const ctx = {};
  vm.createContext(ctx);
  new vm.Script(code, { filename: 'Code.gs (extracto celular)' }).runInContext(ctx);
  return {
    normalize: (raw) => { ctx.__in = raw; return vm.runInContext('_normalizePhone_(__in)', ctx); },
    validate: (raw) => { ctx.__in = raw; return vm.runInContext('_validateOptionalPhone_(__in)', ctx); },
  };
}

function loadFrontend() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
  const src = fs.readFileSync(path.join(ROOT, 'utils', 'phone.ts'), 'utf8');
  const out = esbuild.transformSync(src, { loader: 'ts', format: 'cjs' });
  const mod = { exports: {} };
  new vm.Script(out.code, { filename: 'phone.ts' }).runInNewContext({ module: mod, exports: mod.exports, require });
  if (typeof mod.exports.normalizePhone !== 'function' || typeof mod.exports.validateOptionalPhone !== 'function') {
    throw new Error('utils/phone.ts no exporta normalizePhone() y validateOptionalPhone()');
  }
  return { normalize: mod.exports.normalizePhone, validate: mod.exports.validateOptionalPhone };
}

// [entrada, ok esperado, valor esperado ('' = vacío permitido)]
const CASES = [
  // opcional
  ['', true, ''], ['   ', true, ''], [null, true, ''], [undefined, true, ''],
  // formatos aceptados
  ['3001234567', true, '3001234567'], ['300 123 4567', true, '3001234567'], ['300 1234567', true, '3001234567'],
  ['300-123-4567', true, '3001234567'], ['(300) 123 45 67', true, '3001234567'], ['+57 300 123 4567', true, '3001234567'],
  ['573001234567', true, '3001234567'], ['3001234567T', true, '3001234567'], ['  3151234567  ', true, '3151234567'],
  ['3001234567.0', true, '3001234567'], [3001234567, true, '3001234567'],
  // rechazados
  ['300123456', false], ['30012345678', false], ['6015551234', false], ['5730012345', false], ['#N/A', false],
  ['qa', false], ['0', false], [0, false], [300771997, false], [3001234567.5, false],
  ['300 123 4567 / 310 555 6677', false], ['+1 300 123 4567', false],
];

function main() {
  let back, front;
  try {
    back = loadBackend();
    front = loadFrontend();
  } catch (e) {
    console.error('✗ No se pudieron cargar los validadores de celular:\n  ' + e.message);
    process.exit(1);
  }
  const failures = [];
  for (const [input, expectOk, expectValue] of CASES) {
    const b = back.validate(input);
    const f = front.validate(input);
    const problems = [];
    for (const [side, r] of [['backend', b], ['frontend', f]]) {
      if (r.ok !== expectOk) problems.push(`${side} ${r.ok ? 'acepta' : 'rechaza'} y se esperaba lo contrario`);
      else if (expectOk && r.value !== expectValue) problems.push(`${side} normaliza a ${JSON.stringify(r.value)}`);
      else if (!r.ok && !r.error) problems.push(`${side} rechaza sin mensaje`);
    }
    if (b.ok !== f.ok || b.value !== f.value || (b.error || '') !== (f.error || '')) problems.push('frontend y backend no coinciden');
    if (back.normalize(input) !== front.normalize(input)) problems.push('normalizePhone difiere entre frontend y backend');
    if (problems.length) failures.push({ input, expectOk, expectValue, b, f, problems });
  }
  if (failures.length > 0) {
    console.error(`\n✗ Celular: ${failures.length} caso(s) con problemas.\n`);
    for (const x of failures) {
      console.error(`  entrada: ${JSON.stringify(x.input)} — esperado: ${x.expectOk ? 'acepta → ' + JSON.stringify(x.expectValue) : 'rechaza'}`);
      x.problems.forEach((p) => console.error(`    · ${p}`));
      console.error(`    backend : ${JSON.stringify(x.b)}`);
      console.error(`    frontend: ${JSON.stringify(x.f)}\n`);
    }
    process.exit(1);
  }
  const accepted = CASES.filter((c) => c[1]).length;
  console.log(`Celular: ${CASES.length} casos OK, frontend y backend coinciden (${accepted} aceptados, ${CASES.length - accepted} rechazados).`);
}

main();
