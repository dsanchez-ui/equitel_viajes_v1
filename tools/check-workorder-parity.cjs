#!/usr/bin/env node
/**
 * Verifica que los DOS validadores de Orden de Trabajo se comporten igual:
 *
 *   - `utils/workOrder.ts`  (frontend, TypeScript)
 *   - `server/Code.gs`      (backend, Apps Script)
 *
 * Son gemelos escritos a mano porque no se puede compartir código entre Vite/TS
 * y Apps Script. Este chequeo existe para que no se separen en silencio: si
 * alguien cambia las reglas en un lado y no en el otro, `npm run verify` falla.
 *
 * El corpus incluye los casos reales encontrados en la hoja de producción
 * (2026-09-05) más los bordes que importan.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Lado frontend: se compila utils/workOrder.ts con el esbuild que ya trae Vite.
// ---------------------------------------------------------------------------
function loadFrontend() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
  const src = fs.readFileSync(path.join(ROOT, 'utils', 'workOrder.ts'), 'utf8');
  const out = esbuild.transformSync(src, { loader: 'ts', format: 'cjs' });
  const mod = { exports: {} };
  new vm.Script(out.code, { filename: 'workOrder.ts' }).runInNewContext({
    module: mod,
    exports: mod.exports,
    require,
  });
  return mod.exports;
}

// ---------------------------------------------------------------------------
// Lado backend: se extraen las dos funciones de Code.gs y se evalúan aisladas.
// Se extraen por nombre para que el chequeo falle si alguien las renombra o
// borra, en vez de pasar en falso.
// ---------------------------------------------------------------------------
function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  if (start === -1) throw new Error(`No se encontró la función ${name}() en server/Code.gs`);
  // Recorre contando llaves desde la primera '{' para hallar el cierre real.
  let i = source.indexOf('{', start);
  if (i === -1) throw new Error(`Cuerpo de ${name}() mal formado en server/Code.gs`);
  let depth = 0;
  for (let j = i; j < source.length; j++) {
    const ch = source[j];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, j + 1);
    }
  }
  throw new Error(`No se pudo delimitar ${name}() en server/Code.gs`);
}

function loadBackend() {
  const gs = fs.readFileSync(path.join(ROOT, 'server', 'Code.gs'), 'utf8');
  const code =
    extractFunction(gs, '_normalizeWorkOrder_') +
    '\n' +
    extractFunction(gs, '_validateAndNormalizeWorkOrder_') +
    '\nthis.__api = { _normalizeWorkOrder_: _normalizeWorkOrder_,' +
    ' _validateAndNormalizeWorkOrder_: _validateAndNormalizeWorkOrder_ };';
  const ctx = {};
  new vm.Script(code, { filename: 'Code.gs (extracto OT)' }).runInNewContext(ctx);
  return ctx.__api;
}

// ---------------------------------------------------------------------------
// Corpus: valores reales de producción + bordes.
// ---------------------------------------------------------------------------
const CORPUS = [
  // --- válidos, ya canónicos ---
  'OT-CUBTA-110256', 'OT-LIMED-2001', 'OT-IGBTA-44', 'OT-CUPEI-8', 'OT-LIBTA-4348',
  // --- válidos tras normalizar (variantes reales de la hoja) ---
  'OTCUURA-207', 'OT-CUMED 46437', 'OT-CUBTA 117010', 'OTCUURA131', 'OT-CUURA 274',
  'OT-CUMED55980', 'OT CUBTA 15560', 'OT- CUPSO 1817', 'CUYUM 11301', 'ETMED 31701',
  'CUBEL 482', 'ot-cubta-110256', '  OT-CUBTA-110256  ', 'OT_CUBTA_110256',
  // --- "no aplica" ---
  'NA', 'na', 'N/A', 'n/a', 'No aplica', 'NINGUNA', 'SIN OT', 'PENDIENTE',
  // --- solo consecutivo ---
  '16034', '123573', '55326', '482',
  // --- basura / prosa ---
  'dfssfs33', 'PRUEBA!!', 'Visita Barranquilla', 'Curso de entrenamiento',
  'Traslado  bodega', 'PROBANDOOOO',
  // --- con prefijo pero sin código de ciudad ---
  'OT116514', 'OT 116439', 'OT 15606', 'OT-122912', 'OT 119320',
  // --- con texto extra alrededor ---
  'OT-CUMED-55738 Medellín', 'INDUSUR-PUNTO NET.. OT-CUBTA-110256',
  // --- bordes ---
  '', '   ', null, undefined, 'OT', 'OT-', 'OT-CUBTA-', 'OT-CUBTA-0482',
  'OT-CUBTA-12345678901', 'OT-CU-482', 'OT-CUBTAX-482',
];

function frontendResult(api, input) {
  const r = api.validateWorkOrder(input);
  return r.ok ? { ok: true, value: r.value } : { ok: false };
}

function backendResult(api, input) {
  const data = { workOrder: input };
  try {
    api._validateAndNormalizeWorkOrder_(data);
    return { ok: true, value: data.workOrder };
  } catch (e) {
    return { ok: false };
  }
}

function main() {
  let front, back;
  try {
    front = loadFrontend();
    back = loadBackend();
  } catch (e) {
    console.error('✗ No se pudieron cargar los validadores de OT:\n  ' + e.message);
    process.exit(1);
  }

  const mismatches = [];
  for (const input of CORPUS) {
    const f = frontendResult(front, input);
    const b = backendResult(back, input);
    if (f.ok !== b.ok || (f.ok && f.value !== b.value)) {
      mismatches.push({ input, f, b });
    }
  }

  const label = (r) => (r.ok ? `acepta -> ${JSON.stringify(r.value)}` : 'rechaza');

  if (mismatches.length > 0) {
    console.error(
      `\n✗ Los validadores de OT NO coinciden en ${mismatches.length} caso(s).` +
      '\n  utils/workOrder.ts y server/Code.gs deben aplicar las mismas reglas.\n'
    );
    for (const m of mismatches) {
      console.error(`  entrada: ${JSON.stringify(m.input)}`);
      console.error(`    frontend: ${label(m.f)}`);
      console.error(`    backend : ${label(m.b)}\n`);
    }
    process.exit(1);
  }

  const accepted = CORPUS.filter((i) => frontendResult(front, i).ok).length;
  console.log(
    `Validadores de OT: ${CORPUS.length} casos, frontend y backend coinciden ` +
    `(${accepted} aceptados, ${CORPUS.length - accepted} rechazados). OK`
  );
}

main();
