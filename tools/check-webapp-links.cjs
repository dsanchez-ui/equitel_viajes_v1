#!/usr/bin/env node
/**
 * Enlaces a páginas del web app que abre una persona (#A91): siempre con el dominio
 * de Workspace (script.google.com/a/macros/equitel.com.co/…). Con la URL corta, un
 * celular con varias cuentas de Google muestra "No se pudo abrir el archivo" (#A53).
 * Las llamadas del API (gasService) siguen con la URL corta y no se tocan.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
const src = fs.readFileSync(path.join(ROOT, 'constants.ts'), 'utf8');
const out = esbuild.transformSync(src, { loader: 'ts', format: 'cjs', define: { 'import.meta.env': '{}' } });
const mod = { exports: {} };
new vm.Script(out.code, { filename: 'constants.ts' }).runInNewContext({ module: mod, exports: mod.exports, require });
const c = mod.exports;

const failures = [];
const eq = (name, got, want) => { if (got !== want) failures.push(`${name}: da ${got}, se esperaba ${want}`); };
const ID = 'AKfycbymPQQO0C8Xf089bjAVIciWNbsr9DmS50odghFp7t_nh5ZqHGFe7HisbaFF-TqMPxPwwQ';
eq('dashboard de costos con el dominio (el enlace que funciona en el celular)', c.webAppPageUrl('view=costs-dashboard'),
  `https://script.google.com/a/macros/equitel.com.co/s/${ID}/exec?view=costs-dashboard`);
eq('una URL que ya trae el dominio no cambia', c.webAppPageUrl('view=costs-dashboard', `https://script.google.com/a/macros/equitel.com.co/s/${ID}/exec`),
  `https://script.google.com/a/macros/equitel.com.co/s/${ID}/exec?view=costs-dashboard`);
eq('con parámetros previos agrega &', c.webAppPageUrl('view=x', `https://script.google.com/macros/s/${ID}/exec?a=1`),
  `https://script.google.com/a/macros/equitel.com.co/s/${ID}/exec?a=1&view=x`);
eq('el API sigue con la URL corta', c.API_BASE_URL, `https://script.google.com/macros/s/${ID}/exec`);

// Ningún componente abre una página con la URL del API directamente.
const dir = path.join(ROOT, 'components');
fs.readdirSync(dir).filter((f) => f.endsWith('.tsx')).forEach((f) => {
  const code = fs.readFileSync(path.join(dir, f), 'utf8');
  if (/window\.open\(\s*API_BASE_URL/.test(code) || /href=\{?\s*API_BASE_URL/.test(code)) failures.push(`${f}: abre una página con API_BASE_URL; use webAppPageUrl()`);
});

if (failures.length) {
  console.error(`\n✗ Enlaces del web app: ${failures.length} problema(s).\n`);
  failures.forEach((x) => console.error('  · ' + x));
  process.exit(1);
}
console.log('Enlaces del web app: con el dominio de Equitel para abrir en celulares con varias cuentas; el API sin cambios. OK');
