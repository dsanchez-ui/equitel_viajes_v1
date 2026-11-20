/**
 * Manuales publicados en la app (#A130).
 *
 * Qué garantiza, dentro de `npm run verify`:
 *   1. Lo que está en `public/manuales/` es EXACTAMENTE lo que sale de `docs/`
 *      (byte a byte). Así nadie publica una guía vieja por olvidar `build:guia`.
 *   2. En esa carpeta no hay nada fuera de la lista permitida: la guía técnica
 *      del administrador y los planes internos no se publican nunca.
 *   3. Ningún HTML publicado trae <script>: la política de seguridad de la
 *      plataforma (CSP, `script-src 'self'`) lo bloquearía y la página saldría rota.
 *   4. El panel «Ayuda» (components/HelpMenu.tsx) ofrece solo archivos que existen,
 *      y todo lo publicado está ofrecido a alguien: ni enlaces rotos ni archivos huérfanos.
 *   5. Cada guía dice cuándo se actualizó.
 *   6. `public/serve.json` es válido para `serve` y trae `cleanUrls: false`.
 *      Lo segundo porque la app se sirve con `serve -s` (una sola página): con
 *      `cleanUrls` encendido, /manuales/x.html redirige a /manuales/x, ese archivo
 *      no existe y la regla de página única devuelve la app en vez del manual.
 *      Lo primero porque el esquema no admite claves desconocidas (ni comentarios):
 *      una de más y `serve` no arranca — el sitio entero se cae.
 *
 * No puede saber si el .md quedó al día con la app: eso se revisa al escribir la
 * entrada de BUG_REPORT.md.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'public', 'manuales');
const HELP = path.join(ROOT, 'components', 'HelpMenu.tsx');
const { PUBLICADOS } = require(path.join(ROOT, 'scripts', 'build-guia.cjs'));

const fallas = [];
const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// --- 1 y 2: la carpeta publicada coincide con docs/ y no trae nada de más ---
if (!fs.existsSync(DIR)) {
  fallas.push('no existe public/manuales/. Corre: npm run build:guia');
} else {
  const presentes = fs.readdirSync(DIR).filter((n) => !n.startsWith('.'));
  Object.keys(PUBLICADOS).forEach((nombre) => {
    const destino = path.join(DIR, nombre);
    const origen = PUBLICADOS[nombre];
    if (!fs.existsSync(origen)) {
      fallas.push(`falta el archivo de origen ${path.relative(ROOT, origen)}`);
      return;
    }
    if (!fs.existsSync(destino)) {
      fallas.push(`falta public/manuales/${nombre}. Corre: npm run build:guia`);
      return;
    }
    if (hash(destino) !== hash(origen)) {
      fallas.push(`public/manuales/${nombre} no coincide con ${path.relative(ROOT, origen)}: está desactualizado. Corre: npm run build:guia`);
    }
  });
  presentes.forEach((nombre) => {
    if (!PUBLICADOS[nombre]) {
      fallas.push(`public/manuales/${nombre} no está en la lista de publicados: bórralo o agrégalo a PUBLICADOS en scripts/build-guia.cjs`);
    }
  });

  // --- 3: sin <script> (lo bloquearía la CSP) ---
  presentes.filter((n) => n.endsWith('.html')).forEach((nombre) => {
    const texto = fs.readFileSync(path.join(DIR, nombre), 'utf8');
    if (/<script\b/i.test(texto)) {
      fallas.push(`public/manuales/${nombre} tiene <script>: la política de seguridad de la app lo bloquea`);
    }
    // --- 5: cada guía dice cuándo se actualizó ---
    if (!/Última actualización|Noviembre de 20\d\d|[A-Z][a-z]+ de 20\d\d/.test(texto)) {
      fallas.push(`public/manuales/${nombre} no dice cuándo se actualizó`);
    }
  });
}

// --- 4: el panel ofrece lo que existe, y lo que existe está ofrecido ---
const help = fs.readFileSync(HELP, 'utf8');
const ofrecidos = [];
const re = /archivo:\s*'([a-z0-9-]+)',\s*html:\s*(true|false)/g;
let m;
while ((m = re.exec(help)) !== null) ofrecidos.push({ archivo: m[1], html: m[2] === 'true' });
if (!ofrecidos.length) {
  fallas.push('no se pudo leer la lista MANUALES de components/HelpMenu.tsx (¿cambió el formato?)');
}
const esperados = new Set();
ofrecidos.forEach(({ archivo, html }) => {
  esperados.add(`${archivo}.pdf`);
  if (html) esperados.add(`${archivo}.html`);
  [`${archivo}.pdf`].concat(html ? [`${archivo}.html`] : []).forEach((n) => {
    if (!PUBLICADOS[n]) fallas.push(`el panel «Ayuda» ofrece /manuales/${n}, que no se publica`);
  });
});
Object.keys(PUBLICADOS).forEach((n) => {
  if (!esperados.has(n)) fallas.push(`se publica ${n} pero el panel «Ayuda» no lo ofrece a nadie`);
});

// --- 6: la configuración con que se sirven ---
const SERVE = path.join(ROOT, 'public', 'serve.json');
try {
  const cfg = JSON.parse(fs.readFileSync(SERVE, 'utf8'));
  if (cfg.cleanUrls !== false) {
    fallas.push('public/serve.json debe tener "cleanUrls": false; si no, /manuales/x.html devuelve la app en vez del manual');
  }
  // Mismo esquema que usa `serve` al arrancar: no admite claves desconocidas.
  let Ajv, schema;
  try {
    Ajv = require('ajv');
    schema = require('@zeit/schemas/deployment/config-static.js');
  } catch (e) { /* sin las dependencias de serve no se puede validar; no es motivo de falla */ }
  if (Ajv && schema) {
    const validar = new Ajv({ allowUnionTypes: true, strict: false }).compile(schema);
    if (!validar(cfg)) {
      (validar.errors || []).forEach((e) => {
        fallas.push(`public/serve.json no cumple el esquema de serve (${e.instancePath || '/'} ${e.message}): con una clave de más, serve no arranca y el sitio no sirve nada`);
      });
    }
  }
} catch (e) {
  fallas.push('no se pudo leer public/serve.json: ' + e.message);
}

// --- resultado ---
if (fallas.length) {
  console.error('✗ Manuales publicados: ' + fallas.length + ' problema(s):');
  fallas.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
const n = Object.keys(PUBLICADOS).length;
console.log('✓ Manuales (#A130): ' + n + ' archivos en public/manuales iguales a los de docs/, sin <script>, ' +
  'sin nada fuera de la lista y todos ofrecidos por el panel «Ayuda» (' + ofrecidos.length + ' guías por rol). OK');
