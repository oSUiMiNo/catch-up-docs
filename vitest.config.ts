import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // vite-plugin-pwa の仮想モジュールはテスト環境では解決できない。
      'virtual:pwa-register': fileURLToPath(
        new URL('./tests/helpers/pwaRegisterStub.ts', import.meta.url),
      ),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
    __BUILD_COMMIT_SHA__: JSON.stringify('testsha'),
    __BASE_PATH__: JSON.stringify('/catch-up-docs/'),
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
          setupFiles: ['tests/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'jsdom',
          include: ['tests/integration/**/*.test.ts', 'tests/integration/**/*.test.tsx'],
          setupFiles: ['tests/setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.d.ts', 'src/main.tsx', 'src/push/sw.ts'],
    },
    // PBKDF2 600,000 回の実測を行うため、暗号まわりのテストは既定より長い猶予が要る。
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
