import path from 'path';
import { createHash } from 'crypto';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Aviso de versión nueva (#A124, David, 5-nov-2026): cada compilación lleva un identificador
 * (__APP_BUILD_ID__) y publica el mismo en dist/version.json. La app abierta compara los dos
 * (components/UpdateBanner.tsx): si el servidor ya tiene otra versión, le pide a la persona que
 * recargue. Es un archivo fijo que se pide con fetch, no una carga de código: la app sigue siendo
 * un solo archivo JavaScript (#A96).
 *
 * El identificador sale del contenido de lo que se publica (JavaScript y CSS), no de la hora: si un
 * push no cambia la app (p. ej. solo documentación), la versión es la misma y nadie ve el aviso
 * (David, 5-nov). Como el identificador va dentro del mismo JavaScript que se mide, la app se compila
 * con un marcador fijo, se mide y después el marcador se cambia por el resultado (mismo largo, para no
 * correr nada).
 */
const BUILD_ID_PLACEHOLDER = 'equitel-build-id-placeholder-v01';

const versionFile = (): Plugin => ({
  name: 'equitel-version-file',
  apply: 'build',
  enforce: 'post',
  generateBundle(_options, bundle) {
    const hash = createHash('sha256');
    const names = Object.keys(bundle).filter((n) => !/\.(html|map)$/.test(n) && n !== 'version.json').sort();
    for (const name of names) {
      const item = bundle[name];
      hash.update(name).update('\0');
      hash.update(item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : Buffer.from(item.source));
      hash.update('\0');
    }
    const buildId = hash.digest('hex').slice(0, BUILD_ID_PLACEHOLDER.length);
    let replaced = 0;
    for (const name of names) {
      const item = bundle[name];
      if (item.type === 'chunk' && item.code.includes(BUILD_ID_PLACEHOLDER)) {
        item.code = item.code.split(BUILD_ID_PLACEHOLDER).join(buildId);
        replaced++;
      }
    }
    if (!replaced) this.error('No se encontró el marcador de la versión en el JavaScript: la app no podría avisar que hay una versión nueva.');
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId }) + '\n' });
  }
});

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      define: {
        __APP_BUILD_ID__: JSON.stringify(BUILD_ID_PLACEHOLDER),
      },
      plugins: [react(), tailwindcss(), versionFile()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
