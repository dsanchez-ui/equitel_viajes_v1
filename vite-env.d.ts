/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Identificador de la compilación (vite.config.ts, #A124): el mismo de dist/version.json. */
declare const __APP_BUILD_ID__: string;
