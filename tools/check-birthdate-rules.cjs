#!/usr/bin/env node
/**
 * Verifica las reglas de fecha de nacimiento y que los DOS validadores coincidan:
 *
 *   - `server/Code.gs`      → `_normalizeBirthdate_`, `_ageOnDate_`, `_validateBirthdate_`
 *   - `utils/birthdate.ts`  → `normalizeBirthdate`, `ageOnDate`, `validateBirthdate`
 *
 * Reglas confirmadas por David el 2026-09-10: fecha de calendario válida, no
 * posterior a hoy, edad entre 15 y 100 años; se guarda como 'AAAA-MM-DD'.
 *
 * Son gemelos escritos a mano porque Apps Script y Vite/TS no comparten código.
 * Este chequeo falla si:
 *   - algún lado no cumple el resultado esperado de un caso, o
 *   - los dos lados difieren en aceptación, valor normalizado o mensaje de error.
 * Las funciones se extraen por nombre, así que renombrarlas o borrarlas también
 * hace fallar el chequeo en vez de pasar en falso. "Hoy" es fijo: resultado
 * determinista.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const TODAY = '2026-09-10';

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

function extractConst(source, name) {
  const m = source.match(new RegExp('^const ' + name + ' = (\\d+);', 'm'));
  if (!m) throw new Error(`No se encontró la constante ${name} en server/Code.gs`);
  return `var ${name} = ${m[1]};`;
}

function loadBackend() {
  const gs = fs.readFileSync(path.join(ROOT, 'server', 'Code.gs'), 'utf8');
  const code = [
    extractConst(gs, 'BIRTHDATE_MIN_AGE'),
    extractConst(gs, 'BIRTHDATE_MAX_AGE'),
    extractFunction(gs, '_normalizeBirthdate_'),
    extractFunction(gs, '_ageOnDate_'),
    extractFunction(gs, '_validateBirthdate_'),
  ].join('\n');
  const ctx = {};
  vm.createContext(ctx);
  new vm.Script(code, { filename: 'Code.gs (extracto fecha de nacimiento)' }).runInContext(ctx);
  return (raw, today) => { ctx.__in = raw; ctx.__today = today; return vm.runInContext('_validateBirthdate_(__in, __today)', ctx); };
}

function loadFrontend() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
  const src = fs.readFileSync(path.join(ROOT, 'utils', 'birthdate.ts'), 'utf8');
  const out = esbuild.transformSync(src, { loader: 'ts', format: 'cjs' });
  const mod = { exports: {} };
  new vm.Script(out.code, { filename: 'birthdate.ts' }).runInNewContext({ module: mod, exports: mod.exports, require });
  if (typeof mod.exports.validateBirthdate !== 'function') {
    throw new Error('utils/birthdate.ts no exporta validateBirthdate()');
  }
  return (raw, today) => mod.exports.validateBirthdate(raw, today);
}

// [entrada, ok esperado, valor normalizado esperado (solo si ok)]
const CASES = [
  // formatos aceptados
  ['1990-05-12', true, '1990-05-12'],
  ['12/05/1990', true, '1990-05-12'],
  ['12-05-1990', true, '1990-05-12'],
  ['12.05.1990', true, '1990-05-12'],
  ['1/2/1990', true, '1990-02-01'],
  ['1990-5-2', true, '1990-05-02'],
  ['  12/05/1990  ', true, '1990-05-12'],
  // calendario
  ['29/02/2000', true, '2000-02-29'],   // 2000 sí es bisiesto (divisible entre 400)
  ['29/02/2004', true, '2004-02-29'],
  ['29/02/2001', false],
  ['29/02/1900', false],                 // 1900 no es bisiesto
  ['31/04/1990', false],
  ['00/01/1990', false],
  ['32/01/1990', false],
  ['12/13/1990', false],                 // mes 13: no se acepta formato MM/DD
  ['1899-12-31', false],
  // obligatoria / basura
  ['', false],
  ['   ', false],
  [null, false],
  [undefined, false],
  ['abc', false],
  ['12051990', false],
  ['1990/05/12', false],
  // no posterior a hoy
  ['2026-09-11', false],
  ['2026-09-10', false],                 // hoy mismo: edad 0
  // límite inferior: 15 años
  ['2011-09-10', true, '2011-09-10'],    // cumple 15 hoy
  ['2011-09-11', false],                 // cumple 15 mañana → 14
  // límite superior: 100 años
  ['1926-09-10', true, '1926-09-10'],    // cumple 100 hoy
  ['1925-09-11', true, '1925-09-11'],    // cumple 101 mañana → 100
  ['1925-09-10', false],                 // cumple 101 hoy
];

function main() {
  let back, front;
  try {
    back = loadBackend();
    front = loadFrontend();
  } catch (e) {
    console.error('✗ No se pudieron cargar los validadores de fecha de nacimiento:\n  ' + e.message);
    process.exit(1);
  }

  const failures = [];
  for (const [input, expectOk, expectValue] of CASES) {
    const b = back(input, TODAY);
    const f = front(input, TODAY);
    const problems = [];
    for (const [side, r] of [['backend', b], ['frontend', f]]) {
      if (r.ok !== expectOk) problems.push(`${side} ${r.ok ? 'acepta' : 'rechaza'} y se esperaba lo contrario`);
      else if (expectOk && r.value !== expectValue) problems.push(`${side} normaliza a ${JSON.stringify(r.value)}`);
      else if (!r.ok && !r.error) problems.push(`${side} rechaza sin mensaje`);
    }
    if (b.ok !== f.ok || b.value !== f.value || (b.error || '') !== (f.error || '')) {
      problems.push('frontend y backend no coinciden');
    }
    if (problems.length) failures.push({ input, expectOk, expectValue, b, f, problems });
  }

  if (failures.length > 0) {
    console.error(`\n✗ Fecha de nacimiento: ${failures.length} caso(s) con problemas (hoy = ${TODAY}).\n`);
    for (const x of failures) {
      console.error(`  entrada: ${JSON.stringify(x.input)} — esperado: ${x.expectOk ? 'acepta → ' + JSON.stringify(x.expectValue) : 'rechaza'}`);
      x.problems.forEach((p) => console.error(`    · ${p}`));
      console.error(`    backend : ${JSON.stringify(x.b)}`);
      console.error(`    frontend: ${JSON.stringify(x.f)}\n`);
    }
    process.exit(1);
  }

  const accepted = CASES.filter((c) => c[1]).length;
  console.log(
    `Fecha de nacimiento: ${CASES.length} casos OK, frontend y backend coinciden ` +
    `(${accepted} aceptados, ${CASES.length - accepted} rechazados).`
  );
}

main();
