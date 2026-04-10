# Multi-stage build for Vite + React app served via `serve`.
# Used by Cloud Build → Cloud Run when buildpacks are unavailable
# (e.g. Docker daemon API mismatches with the buildpack lifecycle).
#
# To switch the Cloud Build trigger to use this Dockerfile instead of
# buildpacks: GCP Console → Cloud Build → Triggers → edit the trigger →
# Configuration → change "Cloud Native Buildpack" to "Dockerfile" → save.

# ---------- Stage 1: build the static assets ----------
FROM node:20-alpine AS builder
WORKDIR /app

# Copy manifests first so the npm install layer caches well
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source and run the Vite build
COPY . .
RUN npm run build

# ---------- Stage 2: minimal runtime image ----------
FROM node:20-alpine
WORKDIR /app

# Install `serve` globally so it lives on PATH (/usr/local/bin/serve).
# Pinned to v14 to match the version declared in package.json.
# Doing this instead of `npm ci --omit=dev` keeps the runtime image
# leaner (no node_modules tree, no package.json) AND ensures the
# binary is invocable directly as `serve` from CMD.
RUN npm install -g serve@14 && npm cache clean --force

# Copy only the built static assets from the builder stage
COPY --from=builder /app/dist ./dist

# Cloud Run injects the PORT env var (default 8080). serve must bind
# to 0.0.0.0 (not localhost) so the container accepts external traffic.
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "serve -s dist -l tcp://0.0.0.0:${PORT}"]
