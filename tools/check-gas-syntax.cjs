#!/usr/bin/env node
/**
 * Verificador de sintaxis para el código que NO pasa por TypeScript/Vite:
 *
 *   - `server/Code.gs`            — el backend completo de Apps Script.
 *   - `server/*.html`             — sidebars y paneles con JS embebido en <script>.
 *
 * Por qué existe: `node --check` no acepta la extensión `.gs` (la trata como
 * ESM desconocido) y nunca mira dentro del HTML. Sin esto, un error de sintaxis
 * en Code.gs solo aparece al pegar el archivo en el editor de Apps Script, y uno
 * en un sidebar aparece cuando la administradora abre el panel y no carga nada.
 *
 * Cómo funciona: compila cada bloque con `vm.Script`, que parsea SIN ejecutar.
 * Se compila en modo "script" (sloppy), igual que Apps Script — por eso los
 * `function` de nivel superior y la ausencia de `import`/`export` son válidos.
 * No se resuelven las globales de GAS (SpreadsheetApp, Logger, …): no se ejecuta
 * nada, así que su ausencia es irrelevante.
 *
 * Uso:  node tools/check-gas-syntax.cjs [archivo...]
 *       (sin argumentos: server/Code.gs + server/*.html)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

/** Compila `code` sin ejecutarlo. Devuelve null si está bien, o el error. */
function compile(code, filename) {
  try {
    new vm.Script(code, { filename });
    return null;
  } catch (err) {
    return err;
  }
}

/**
 * Extrae los bloques <script> con JS propio de un HTML.
 * Ignora los que tienen `src=` (no hay código que revisar) y los que declaran
 * un `type` que no sea JavaScript (plantillas, JSON embebido, etc.).
 * Devuelve el código junto con la línea donde empieza, para que los números de
 * línea del error apunten al archivo real y no al fragmento.
 */
function extractScripts(html) {
  const blocks = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const typeMatch = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i);
    if (typeMatch && !/^(text\/javascript|application\/javascript|module)$/i.test(typeMatch[1])) {
      continue;
    }
    // Línea (1-indexada) donde arranca el contenido del bloque.
    const startLine = html.slice(0, m.index + m[0].indexOf('>') + 1).split('\n').length;
    blocks.push({ code: m[2], startLine, isModule: typeMatch && /^module$/i.test(typeMatch[1]) });
  }
  return blocks;
}

/** Saca el número de línea del stack de un error de compilación de vm.Script. */
function errorLine(err, filename) {
  const stack = String(err.stack || '');
  const esc = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = stack.match(new RegExp(esc + ':(\\d+)'));
  return m ? parseInt(m[1], 10) : null;
}

function checkFile(relPath) {
  const abs = path.resolve(ROOT, relPath);
  if (!fs.existsSync(abs)) {
    return [{ file: relPath, message: 'archivo no encontrado' }];
  }
  const source = fs.readFileSync(abs, 'utf8');
  const failures = [];

  if (/\.html?$/i.test(relPath)) {
    const blocks = extractScripts(source);
    if (blocks.length === 0) {
      console.log(`  · ${relPath} — sin <script> propio, nada que revisar`);
      return failures;
    }
    blocks.forEach((block, i) => {
      // `vm.Script` no parsea sintaxis de módulos. Un <script type="module">
      // se salta con aviso en vez de reportarse como error falso.
      if (block.isModule) {
        console.log(`  · ${relPath} — bloque ${i + 1} es type="module", omitido`);
        return;
      }
      const err = compile(block.code, relPath);
      if (err) {
        const rel = errorLine(err, relPath);
        // El bloque empieza en `startLine`; su línea 1 es esa misma línea.
        const line = rel ? block.startLine + rel - 1 : null;
        failures.push({
          file: relPath,
          line,
          message: `${err.message} (bloque <script> ${i + 1} de ${blocks.length})`,
        });
      }
    });
    if (failures.length === 0) {
      console.log(`  ✓ ${relPath} — ${blocks.length} bloque(s) <script> OK`);
    }
    return failures;
  }

  const err = compile(source, relPath);
  if (err) {
    failures.push({ file: relPath, line: errorLine(err, relPath), message: err.message });
  } else {
    const lines = source.split('\n').length;
    console.log(`  ✓ ${relPath} — ${lines} líneas OK`);
  }
  return failures;
}

function defaultTargets() {
  const serverDir = path.join(ROOT, 'server');
  if (!fs.existsSync(serverDir)) return [];
  return fs
    .readdirSync(serverDir)
    .filter((f) => /\.(gs|html?)$/i.test(f))
    .sort()
    .map((f) => path.join('server', f));
}

function main() {
  const args = process.argv.slice(2);
  const targets = args.length > 0 ? args : defaultTargets();

  if (targets.length === 0) {
    console.error('No hay archivos que revisar.');
    process.exit(1);
  }

  console.log(`Sintaxis del backend (${targets.length} archivo(s)):`);
  const failures = targets.flatMap(checkFile);

  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} error(es) de sintaxis:\n`);
    for (const f of failures) {
      console.error(`  ${f.file}${f.line ? ':' + f.line : ''}`);
      console.error(`    ${f.message}\n`);
    }
    process.exit(1);
  }

  console.log('Sintaxis del backend: OK');
}

main();
