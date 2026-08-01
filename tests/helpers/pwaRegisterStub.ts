/**
 * テスト環境用の `virtual:pwa-register` の代替。
 *
 * vite-plugin-pwa の仮想モジュールは Vitest では解決できないため、
 * vitest.config.ts のエイリアスでこのファイルへ差し替える。
 */

export interface RegisterSWOptions {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisterError?: (error: unknown) => void;
}

export function registerSW(_options: RegisterSWOptions = {}): (reload?: boolean) => Promise<void> {
  return () => Promise.resolve();
}
