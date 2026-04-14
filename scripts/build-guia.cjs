/**
 * Build script: convierte docs/guia-administrador.md a HTML styled + PDF.
 *
 * Uso:
 *   npm run build:guia
 *
 * Requisitos:
 *   - Chrome instalado (ver CHROME_PATH abajo)
 *   - markdown-it disponible (se instala auto via npx si no existe)
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MD_PATH = path.join(ROOT, 'docs', 'guia-administrador.md');
const HTML_PATH = path.join(ROOT, 'docs', 'guia-administrador.html');
const PDF_PATH = path.join(ROOT, 'docs', 'guia-administrador.pdf');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// --- 1. Renderizar markdown a HTML ---
let MarkdownIt;
try {
  MarkdownIt = require('markdown-it');
} catch (e) {
  console.log('Instalando markdown-it temporalmente...');
  execSync('npm install --no-save --silent markdown-it', { cwd: ROOT, stdio: 'inherit' });
  MarkdownIt = require('markdown-it');
}

const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
const mdText = fs.readFileSync(MD_PATH, 'utf8');
const bodyHtml = md.render(mdText);

const css = `
  :root {
    --brand: #D71920;
    --text: #1f2937;
    --muted: #6b7280;
    --border: #e5e7eb;
    --bg-light: #f9fafb;
    --bg-code: #f3f4f6;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--text);
    background: white;
    line-height: 1.6;
    font-size: 13px;
  }
  .wrapper { max-width: 820px; margin: 0 auto; padding: 40px 50px; }
  h1 {
    color: var(--brand); font-size: 28px; margin: 0 0 8px;
    letter-spacing: -0.5px; border-bottom: 3px solid var(--brand); padding-bottom: 12px;
  }
  h2 {
    color: #111827; font-size: 20px; margin: 32px 0 12px;
    border-top: 1px solid var(--border); padding-top: 18px;
  }
  h3 { color: #374151; font-size: 15px; margin: 20px 0 8px; font-weight: 600; }
  p { margin: 10px 0; }
  ul, ol { margin: 10px 0; padding-left: 26px; }
  li { margin: 4px 0; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code {
    background: var(--bg-code); padding: 1px 5px; border-radius: 3px;
    font-size: 12px; font-family: Consolas, "Courier New", monospace;
  }
  pre {
    background: #1f2937; color: #e5e7eb; padding: 14px 18px;
    border-radius: 6px; overflow-x: auto; font-size: 11px; line-height: 1.5;
  }
  pre code { background: transparent; color: inherit; padding: 0; font-size: 11px; }
  blockquote {
    border-left: 4px solid var(--brand); background: #fef2f2;
    padding: 10px 16px; margin: 14px 0; color: #7f1d1d; border-radius: 0 4px 4px 0;
  }
  blockquote p { margin: 4px 0; }
  table { border-collapse: collapse; margin: 14px 0; width: 100%; font-size: 12px; }
  th, td {
    border: 1px solid var(--border); padding: 7px 10px;
    text-align: left; vertical-align: top;
  }
  th { background: var(--bg-light); font-weight: 600; color: #111827; }
  tr:nth-child(even) td { background: #fafafa; }
  hr { border: 0; border-top: 1px solid var(--border); margin: 28px 0; }
  strong { color: #111827; }
  @page { size: Letter; margin: 18mm; }
  @media print {
    body { font-size: 11.5px; }
    .wrapper { max-width: 100%; padding: 0; margin: 0; }
    h1 { font-size: 22px; page-break-before: avoid; }
    h2 { page-break-after: avoid; font-size: 16px; }
    h3 { page-break-after: avoid; font-size: 13px; }
    table, pre, blockquote { page-break-inside: avoid; }
    a { color: inherit; text-decoration: none; }
    tr { page-break-inside: avoid; }
  }
`;

const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Guía del Administrador — Equitel Viajes</title>
  <style>${css}</style>
</head>
<body>
  <div class="wrapper">
    ${bodyHtml}
  </div>
</body>
</html>
`;

fs.writeFileSync(HTML_PATH, html, 'utf8');
console.log('✓ HTML generado: docs/guia-administrador.html');

// --- 2. Generar PDF con Chrome headless ---
if (!fs.existsSync(CHROME_PATH)) {
  console.error('✗ Chrome no encontrado en:', CHROME_PATH);
  console.error('  Edita CHROME_PATH en scripts/build-guia.cjs con la ruta correcta,');
  console.error('  o abre docs/guia-administrador.html en tu navegador y Ctrl+P → Guardar como PDF.');
  process.exit(1);
}

// --headless=new es el modo moderno de Chrome que renderiza CSS correctamente.
// --virtual-time-budget da tiempo a que fonts/styles se apliquen antes del print.
// --no-pdf-header-footer quita el header/footer default de Chrome.
const result = spawnSync(CHROME_PATH, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--no-pdf-header-footer',
  '--virtual-time-budget=5000',
  `--print-to-pdf=${PDF_PATH}`,
  `file:///${HTML_PATH.replace(/\\/g, '/')}`,
], { stdio: 'pipe' });

if (result.status === 0) {
  const stats = fs.statSync(PDF_PATH);
  console.log('✓ PDF generado: docs/guia-administrador.pdf (' + Math.round(stats.size / 1024) + ' KB)');
} else {
  console.error('✗ Chrome falló:', result.stderr.toString());
  process.exit(1);
}
