import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * 公開URLのパス部分。ユーザーサイト直下へ配信する構成へ変更する場合は
 * 環境変数 BASE_PATH に "/" を渡す。
 */
const basePath = normalizeBasePath(process.env.BASE_PATH ?? '/catch-up-docs/');

/** runtime-config.json をビルド時にも読み、アプリ名や色の定義を1箇所に保つ。 */
const runtimeConfig = readRuntimeConfig();

const appVersion = readPackageVersion();
const buildCommitSha = resolveCommitSha();

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/push',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest,json}'],
        // GitHub API のレスポンスと文書 HTML は決してプリキャッシュしない。
        globIgnores: ['**/node_modules/**', '**/.well-known/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      manifest: {
        id: basePath,
        name: runtimeConfig.appName,
        short_name: runtimeConfig.appShortName,
        description: runtimeConfig.appDescription,
        start_url: basePath,
        scope: basePath,
        display: 'standalone',
        lang: runtimeConfig.language,
        // 日本語UIのみのため左横書き固定。プラグインの型は 'auto' を受け付けない。
        dir: 'ltr',
        // orientation は指定しない。指定すると端末の自動回転の設定より
        // アプリの宣言が優先され、回転をオフにしていても倒すだけで回ってしまう。
        // 指定しなければどの向きも許され、回すかどうかを利用者が決められる。
        theme_color: runtimeConfig.themeColor,
        background_color: runtimeConfig.backgroundColor,
        categories: ['productivity', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_COMMIT_SHA__: JSON.stringify(buildCommitSha),
    __BASE_PATH__: JSON.stringify(basePath),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    cssCodeSplit: false,
    reportCompressedSize: true,
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});

function normalizeBasePath(value: string): string {
  const withLeading = value.startsWith('/') ? value : `/${value}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

interface BuildTimeRuntimeConfig {
  appName: string;
  appShortName: string;
  appDescription: string;
  language: string;
  themeColor: string;
  backgroundColor: string;
}

function readRuntimeConfig(): BuildTimeRuntimeConfig {
  const fallback: BuildTimeRuntimeConfig = {
    appName: 'catch-up-docs',
    appShortName: 'catch-up-docs',
    appDescription: '個人用の非公開HTML文書ライブラリ',
    language: 'ja',
    themeColor: '#0f1720',
    backgroundColor: '#0f1720',
  };
  try {
    const raw = readFileSync(new URL('./public/runtime-config.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw) as Partial<BuildTimeRuntimeConfig>;
    return {
      appName: parsed.appName ?? fallback.appName,
      appShortName: parsed.appShortName ?? fallback.appShortName,
      appDescription: parsed.appDescription ?? fallback.appDescription,
      language: parsed.language ?? fallback.language,
      themeColor: parsed.themeColor ?? fallback.themeColor,
      backgroundColor: parsed.backgroundColor ?? fallback.backgroundColor,
    };
  } catch {
    return fallback;
  }
}

function readPackageVersion(): string {
  try {
    const raw = readFileSync(new URL('./package.json', import.meta.url), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** 設定画面へ表示するビルド元コミット。改ざん検知の手がかりになる（SEC-006）。 */
function resolveCommitSha(): string {
  const fromCi = process.env.GITHUB_SHA;
  if (fromCi && fromCi.length > 0) {
    return fromCi;
  }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}
