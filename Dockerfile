# Multi-stage build for Vite + React app served via `serve`.
# ESTE ARCHIVO ES EL QUE CONSTRUYE PRODUCCIÓN (verificado con gcloud el 22-oct-2026): el activador
# rmgpgab-sistematiquetesequitel-us-west1-dsanchez-ui-equitel-rxk (proyecto gen-lang-client-0192295875)
# corre `docker build .` → push a Artifact Registry → `gcloud run services update sistematiquetesequitel`
# (us-west1) en cada push a main. No usa buildpacks.

# Node fijo en las dos etapas (revisión de seguridad del 22-oct-2026): Node 20 dejó de
# tener soporte en abril de 2026 y no recibe la corrección de seguridad del 20-oct
# (CVE-2026-111497 y otros 9). 24.22.1 es la LTS corregida. Al subirla, cambiar las dos.
# Con npm 11 (viene con Node 24) solo corren los scripts de instalación aprobados en
# package.json ("allowScripts": hoy solo esbuild, que compila la app).

# ---------- Stage 1: build the static assets ----------
FROM node:24.22.1-alpine AS builder
WORKDIR /app

# Copy manifests first so the npm install layer caches well
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source and run the Vite build
COPY . .
RUN npm run build

# ---------- Stage 2: minimal runtime image ----------
FROM node:24.22.1-alpine
WORKDIR /app

# `serve` se instala desde package-lock.json (solo dependencias de producción), no con
# `npm install -g`: la instalación global no usa el lockfile ni los "overrides" de
# package.json. serve 14.2.6 (la última) fija compression 1.8.1, que tiene una
# denegación de servicio (GHSA-vc2v-76pw-4v95); el override la sube a 1.8.2, y
# también brace-expansion y fast-uri. Ningún paquete de producción tiene scripts de
# instalación, así que van apagados.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy only the built static assets from the builder stage
COPY --from=builder /app/dist ./dist

# Cloud Run injects the PORT env var (default 8080). serve must bind
# to 0.0.0.0 (not localhost) so the container accepts external traffic.
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "./node_modules/.bin/serve -s dist -l tcp://0.0.0.0:${PORT}"]
