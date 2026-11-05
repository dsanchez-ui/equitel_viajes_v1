import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Aviso de versión nueva (#A124, David, 5-nov-2026): cada compilación lleva un identificador
 * (__APP_BUILD_ID__) y publica el mismo en dist/version.json. La app abierta compara los dos
 * (components/UpdateBanner.tsx): si el servidor ya tiene otra versión, le pide a la persona que
 * recargue. Es un archivo fijo que se pide con fetch, no una carga de código: la app sigue siendo
 * un solo archivo JavaScript (#A96).
 */
const versionFile = (buildId: string): Plugin => ({
  name: 'equitel-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId }) + '\n' });
  }
});

export default defineConfig(() => {
    const buildId = new Date().toISOString();
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      define: {
        __APP_BUILD_ID__: JSON.stringify(buildId),
      },
      plugins: [react(), tailwindcss(), versionFile(buildId)],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
