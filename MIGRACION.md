# Migración y trabajo alternando entre máquinas

Cómo levantar este proyecto en una máquina nueva (Linux, macOS o Windows) y cómo
alternar entre varias sin perder trabajo ni contexto.

**Contexto:** el proyecto se desarrolla alternando entre un Mac (Apple Silicon) y
un PC Linux. El código y la documentación viajan por git; los secretos y las
dependencias, no.

---

## 1. Instalación en una máquina nueva

### Requisitos

| Herramienta | Versión | Para qué |
|---|---|---|
| Node.js | 20 LTS o superior | Build y dev server |
| npm | 10 o superior | Dependencias |
| git | cualquiera reciente | — |
| Google Chrome | opcional | Solo para `npm run build:guia` (PDF de las guías) |

Mantén **la misma versión mayor de npm en todas las máquinas**. Si no, el
`package-lock.json` sufre cambios de ida y vuelta (ver Problemas típicos).

### Pasos

```bash
# 1. Clonar
git clone <url-del-repo> equitel_viajes_v1
cd equitel_viajes_v1

# 2. Copiar los secretos A MANO (no vienen en git — ver sección 2)
#    .env  y  .env.local

# 3. Instalar dependencias — SIEMPRE en la máquina destino, nunca copiadas
npm install

# 4. Verificar que todo está sano
npm run verify

# 5. Levantar
npm run dev      # http://localhost:3000
```

`npm run verify` debe terminar en verde. Corre, en orden: typecheck de TypeScript,
sintaxis del backend (`Code.gs` + el JS embebido en `server/*.html`) y el build de
producción.

---

## 2. Archivos que NO viajan con git — copiar a mano

Estos están en `.gitignore` a propósito y hay que llevarlos manualmente
(USB, gestor de contraseñas, canal seguro — **no** por chat ni correo):

| Archivo | Para qué sirve | ¿Obligatorio? |
|---|---|---|
| `.env` | `VITE_API_BASE_URL` apuntando al deployment de **producción** de Apps Script | Recomendado |
| `.env.local` | Igual, pero apuntando al deployment de **prueba**. **Le gana a `.env` en `npm run dev`.** | Recomendado para desarrollar |

Si no copias ninguno, la app **igual funciona**: `constants.ts` trae como default
la URL de producción, que es un endpoint público de Apps Script y no es un secreto.
El riesgo de no copiar `.env.local` es el contrario: **desarrollarías contra
producción sin darte cuenta.** Cópialo.

Hay un `.env.example` en el repo con el formato esperado.

### Lo que NO se copia entre máquinas (se regenera)

| Carpeta | Por qué |
|---|---|
| `node_modules/` | Contiene **binarios nativos por sistema operativo y arquitectura** (`@rollup`, `@esbuild`, `lightningcss`, `@tailwindcss/oxide`). Copiar la carpeta del Mac a Linux rompe el build. Siempre `npm install`. |
| `dist/` | Artefacto de build. Se regenera con `npm run build`. |
| `.claude/` | Configuración local de Claude Code, incluidos los permisos. Se regenera sola. |

### Lo que no viaja y no se puede copiar

La **memoria local de Claude Code** (fuera del repo) es por máquina. Por eso todo
lo importante vive en [CLAUDE.md](CLAUDE.md) y [BUG_REPORT.md](BUG_REPORT.md), que
sí están versionados. **Si aprendes algo que valga la pena recordar, escríbelo ahí,
no lo dejes solo en la memoria local.**

---

## 3. Regla de alternancia entre máquinas

> **Al terminar en una máquina: commit + push.**
> **Al empezar en la otra: `git pull` antes de tocar nada.**

```bash
# Al terminar la sesión
npm run verify          # que quede en verde
git status              # revisar que no quede nada suelto
git add -A && git commit -m "..."
git push                # ⚠️ un push a main DESPLIEGA el frontend a producción

# Al empezar en la otra máquina
git pull
npm install             # por si cambiaron las dependencias
npm run verify
```

**Ojo con el push:** `main` está conectado a un trigger de Cloud Build que
redespliega el frontend en Cloud Run. Un push no es solo "guardar en la nube": es
un despliegue a producción. El backend de Apps Script, en cambio, es 100% manual
(ver el mapa de despliegue en `CLAUDE.md`).

Si dejas trabajo a medias, súbelo en una rama en vez de a `main`:

```bash
git checkout -b wip/lo-que-sea
git push -u origin wip/lo-que-sea
```

---

## 4. Problemas típicos

| Síntoma | Causa | Solución |
|---|---|---|
| `Cannot find module @rollup/rollup-linux-x64-gnu` (o `darwin-arm64`) al hacer build | Se copió `node_modules/` entre sistemas operativos | `rm -rf node_modules && npm install` |
| `git status` lleno de archivos `._algo` | AppleDouble de macOS: aparecen al copiar carpetas desde un Mac a un disco no-HFS | `find . -name "._*" -not -path "./node_modules/*" -delete`. Están en `.gitignore`. |
| `package-lock.json` sale modificado sin haber tocado dependencias | Versiones distintas de npm entre máquinas: las nuevas escriben campos `libc` que las viejas borran | Alinear la versión mayor de npm. Mientras tanto: `git checkout package-lock.json` |
| `npm run build:guia` falla con "no se encontró Chrome" | Chrome no instalado, o en una ruta no estándar | Instalar Chrome. `scripts/build-guia.cjs` ya lo busca por plataforma (macOS/Windows/Linux) y en el `PATH`. |
| Claude Code vuelve a pedir permisos que ya habías concedido | `.claude/settings.local.json` no está versionado (a propósito) | Normal. Se vuelven a conceder. |
| Diffs enormes de "todo el archivo cambió" sin haber tocado nada | Fines de línea CRLF vs LF | Ya está cubierto por `.gitattributes` (`* text=auto eol=lf`). Verificar con `git add --renormalize . --dry-run` |
| Estoy probando y no sé contra qué backend | `.env.local` le gana a `.env` en `npm run dev` | Revisar ambos archivos. Ver la tabla en `CLAUDE.md`. |

---

## 5. Verificación de sanidad

Después de instalar en una máquina nueva, esto debe pasar completo:

```bash
npm run verify
```

Sale en verde cuando:

- `tsc --noEmit` no reporta errores de tipos.
- Los 5 archivos de `server/` compilan sin errores de sintaxis.
- El build de Vite termina y escribe `dist/`.

Además, como prueba de humo:

```bash
npm run dev
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/   # debe dar 200
```

El backend de Apps Script **no se puede probar localmente**: vive en la
infraestructura de Google. Los cambios de `Code.gs` se prueban desplegando al
deployment de **prueba** y apuntando `.env.local` ahí.

---

## 6. Nota de seguridad sobre credenciales de git

Si clonaste con un token embebido en la URL del remote
(`https://usuario:ghp_xxx@github.com/...`), ese token queda **en texto plano** en
`.git/config` de cada máquina. No viaja con el repo (`.git/config` no se versiona),
pero se acumula en cada equipo donde clones.

Recomendado: usar SSH o un credential helper.

```bash
# Ver si el remote tiene un token embebido
git remote -v

# Limpiarlo (deja que git pida credenciales o use el helper)
git remote set-url origin https://github.com/<usuario>/<repo>.git

# O pasar a SSH
git remote set-url origin git@github.com:<usuario>/<repo>.git
```

Si un token estuvo expuesto, **rótalo** en GitHub → Settings → Developer settings →
Personal access tokens.
