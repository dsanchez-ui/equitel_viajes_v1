# Documentación — Equitel Viajes

## Archivos

| Archivo | Contenido |
|---|---|
| [guia-administrador.md](./guia-administrador.md) | **Fuente editable** de la guía general del administrador. |
| [guia-administrador.html](./guia-administrador.html) | Render HTML con estilos. Se puede abrir en navegador y Ctrl+P → Guardar como PDF. |
| [guia-administrador.pdf](./guia-administrador.pdf) | PDF final para compartir con el admin del área. |
| [guia-reorganizar-base.md](./guia-reorganizar-base.md) | Guía específica del workflow de reorganización de columnas del sheet principal. |

## Regenerar el PDF

Si editas `guia-administrador.md`, regenera el HTML + PDF con:

```bash
npm run build:guia
```

Esto ejecuta:
1. Convierte el `.md` a `.html` con estilos de impresión (usa `markdown-it` vía `npx --yes`).
2. Usa Chrome headless para imprimir el HTML a PDF.

Requiere Chrome instalado en `C:/Program Files/Google/Chrome/Application/chrome.exe`. Si está en otra ruta, edita `scripts/build-guia.cjs`.
