# Documentación — Equitel Viajes

## Archivos

| Archivo | Contenido |
|---|---|
| [guia-administrador.md](./guia-administrador.md) | **Guía técnica completa** del administrador — arquitectura, workflows, Script Properties, triggers, troubleshooting. |
| [guia-administrador.pdf](./guia-administrador.pdf) | PDF de la guía técnica (11 páginas). |
| [guia-hoja-calculo.md](./guia-hoja-calculo.md) | **Guía simple del Google Sheets** — explicación no-técnica de cada hoja, cada botón del menú, qué editar y qué no. |
| [guia-hoja-calculo.pdf](./guia-hoja-calculo.pdf) | PDF de la guía del Sheets (7 páginas). Recomendada para admins nuevos. |
| [guia-reorganizar-base.md](./guia-reorganizar-base.md) | Guía específica del workflow de reorganización de columnas de la hoja principal. |

**Versiones HTML** (`.html`) se generan automáticamente y se pueden abrir en navegador.

## Regenerar los PDFs

Si editas alguno de los `.md`, regenera con:

```bash
npm run build:guia                 # construye AMBAS guías
node scripts/build-guia.cjs administrador    # solo la técnica
node scripts/build-guia.cjs hoja-calculo     # solo la del Sheets
```

Esto genera HTML + PDF para cada guía. Usa Chrome headless para el PDF.

Requiere Chrome instalado en `C:/Program Files/Google/Chrome/Application/chrome.exe`. Si está en otra ruta, edita `scripts/build-guia.cjs`.
