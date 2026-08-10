import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(__dirname, 'app/tank-web');

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['app/tank-web/**/*.test.ts'],
    setupFiles: ['app/tank-web/vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': frontendRoot,
      '@app': resolve(frontendRoot, 'app'),
      '@features': resolve(frontendRoot, 'features'),
      '@platform': resolve(frontendRoot, 'platform'),
      '@shared': resolve(frontendRoot, 'shared'),
    },
  },
});
