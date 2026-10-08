#!/usr/bin/env node
/**
 * La app se publica como UN solo archivo JavaScript (#A96).
 *
 * Incidente del 8-oct-2026: el generador del correo se cargaba bajo demanda
 * (`await import('../utils/EmailGenerator')`). Vite lo ponía en un archivo aparte con
 * un nombre que cambia en cada compilación (EmailGenerator-<hash>.js), y cada push a
 * main reemplaza todos los archivos del servidor. Quien tenía la app abierta desde
 * antes de una publicación pedía el archivo viejo al enviar la solicitud; el servidor
 * respondía con la página principal y el navegador mostraba "Failed to fetch
 * dynamically imported module": nadie con una pestaña vieja podía crear solicitudes.
 *
 * Esta verificación falla si:
 *   1. el código de la app vuelve a usar import() o React.lazy, o
 *   2. la compilación (dist/assets) trae más de un archivo .js propio. Los de
 *      public/assets son copias de versiones anteriores que se dejan a propósito
 *      para las pestañas que siguen abiertas, y no cuentan.
 *
 * Va DESPUÉS de `npm run build` dentro de `npm run verify`.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const failures = [];

// 1. Código de la app
const files = [];
const walk = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(name)) files.push(p);
  }
};
['App.tsx', 'index.tsx', 'types.ts', 'constants.ts'].forEach((f) => { if (fs.existsSync(path.join(ROOT, f))) files.push(path.join(ROOT, f)); });
['components', 'utils', 'services'].forEach((d) => { if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d)); });
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
files.forEach((f) => {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  const rel = path.relative(ROOT, f);
  if (/(^|[^.\w])import\s*\(/.test(src)) failures.push(`${rel}: usa import() (carga bajo demanda). Use un import normal arriba del archivo.`);
  if (/\blazy\s*\(/.test(src)) failures.push(`${rel}: usa React.lazy (carga bajo demanda). Use un import normal.`);
});

// 2. Lo compilado
const assets = path.join(ROOT, 'dist', 'assets');
const legacy = fs.existsSync(path.join(ROOT, 'public', 'assets')) ? fs.readdirSync(path.join(ROOT, 'public', 'assets')) : [];
if (!fs.existsSync(assets)) {
  failures.push('No existe dist/assets: corra `npm run build` antes de esta verificación.');
} else {
  const js = fs.readdirSync(assets).filter((n) => n.endsWith('.js') && !legacy.includes(n));
  const main = js.filter((n) => /^index-[\w-]+\.js$/.test(n));
  if (main.length !== 1 || js.length !== 1) failures.push(`dist/assets debe tener un solo .js (index-*.js) y tiene: ${js.join(', ') || 'ninguno'}.`);
  legacy.forEach((n) => { if (!fs.existsSync(path.join(assets, n))) failures.push(`public/assets/${n} no llegó a dist/assets.`); });
}

if (failures.length) {
  console.error(`\n✗ Un solo archivo JavaScript (#A96): ${failures.length} problema(s).\n`);
  failures.forEach((x) => console.error('  · ' + x));
  process.exit(1);
}
console.log(`Un solo archivo JavaScript: sin cargas bajo demanda en ${files.length} archivos; dist/assets con un index-*.js${legacy.length ? ` y ${legacy.length} copia(s) de versiones anteriores para pestañas abiertas` : ''}. OK`);
