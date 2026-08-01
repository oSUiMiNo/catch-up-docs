/**
 * Service Worker の登録と更新通知（FR-PWA-002）。
 *
 * 更新は自動適用せず、待機中の Service Worker があることを利用者へ知らせて
 * 明示的に適用させる。適用後の再読み込みでは URL に鍵やセッション情報を載せない。
 */

import { registerSW } from 'virtual:pwa-register';

import { logger } from '../utils/logger';

export interface ServiceWorkerHandle {
  /** 待機中の新しい Service Worker を適用し、ページを再読み込みする。 */
  applyUpdate: () => Promise<void>;
}

export interface RegisterOptions {
  onUpdateAvailable: () => void;
  onOfflineReady?: () => void;
}

export function registerServiceWorker(options: RegisterOptions): ServiceWorkerHandle {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      logger.info('新しいバージョンが利用できます');
      options.onUpdateAvailable();
    },
    onOfflineReady() {
      logger.info('オフラインでもアプリシェルを表示できます');
      options.onOfflineReady?.();
    },
    onRegisterError() {
      logger.warn('Service Worker の登録に失敗しました');
    },
  });

  return {
    async applyUpdate() {
      await updateSW(true);
    },
  };
}

/**
 * Service Worker からのディープリンク通知を受け取る（FR-PUSH-008）。
 * ロック中に届いた場合は呼び出し側が保留し、解除後に処理する。
 */
export function listenForDeepLinks(handler: (url: string) => void): () => void {
  if (!('serviceWorker' in navigator)) {
    return () => undefined;
  }

  const listener = (event: MessageEvent<unknown>): void => {
    const data = event.data as { type?: string; url?: string } | undefined;
    if (data?.type === 'deep-link' && typeof data.url === 'string') {
      handler(data.url);
    }
  };

  navigator.serviceWorker.addEventListener('message', listener);
  return () => {
    navigator.serviceWorker.removeEventListener('message', listener);
  };
}
