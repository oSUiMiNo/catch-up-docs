/// <reference lib="webworker" />
/**
 * Service Worker（FR-PWA-002 / FR-PWA-003 / FR-PUSH-001 / FR-PUSH-008）。
 *
 * 方針:
 *   - プリキャッシュするのはアプリシェルだけ。
 *   - GitHub API のレスポンスと文書 HTML は絶対にキャッシュしない。
 *     そのため、同一オリジン以外のリクエストには一切介入しない。
 *   - 通知の文言は一般化し、文書名やリポジトリ名を含めない。
 *
 * Workbox のランタイムを載せずに手書きしているのは、キャッシュ対象を
 * 「プリキャッシュ済みのアプリシェルだけ」に限定していることをコード上で
 * 明示し、取りこぼしで機密データがキャッシュへ入る事故を防ぐため。
 */

import { NOTIFICATION_TITLE } from '../config/constants';
import { buildNotificationBody, parsePushPayload, resolveDeepLinkUrl } from './payload';

declare let self: ServiceWorkerGlobalScope;

interface PrecacheEntry {
  url: string;
  revision: string | null;
}

const precacheEntries = (self as unknown as { __WB_MANIFEST: PrecacheEntry[] }).__WB_MANIFEST;

const SCOPE_URL = new URL('./', self.location.href).toString();
const CACHE_PREFIX = 'catch-up-docs-shell';
const CACHE_NAME = `${CACHE_PREFIX}-${buildRevisionTag(precacheEntries)}`;
const OFFLINE_URL = new URL('offline.html', SCOPE_URL).toString();
const APP_SHELL_URL = new URL('index.html', SCOPE_URL).toString();

/** プリキャッシュ内容が変われば別のキャッシュ名になるようにする。 */
function buildRevisionTag(entries: PrecacheEntry[]): string {
  let hash = 0x811c9dc5;
  for (const entry of entries) {
    const token = `${entry.url}|${entry.revision ?? ''}`;
    for (let index = 0; index < token.length; index += 1) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16);
}

function toAbsoluteUrl(entry: PrecacheEntry): string {
  return new URL(entry.url, SCOPE_URL).toString();
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const urls = new Set(precacheEntries.map(toAbsoluteUrl));
      urls.add(APP_SHELL_URL);
      urls.add(OFFLINE_URL);
      // 一部が取得できなくても install 全体を失敗させない。
      await Promise.all(
        Array.from(urls, async (url) => {
          try {
            const response = await fetch(url, { cache: 'no-cache', credentials: 'omit' });
            if (response.ok) {
              await cache.put(url, response);
            }
          } catch {
            // ネットワーク不調時は次回の install で埋まる。
          }
        }),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // 同一オリジン以外（= GitHub API）には介入しない。
  // これによりトークン付きレスポンスや文書本文がキャッシュへ入る経路を断つ。
  if (url.origin !== self.location.origin) {
    return;
  }

  // スコープ外の同一オリジン資産にも触らない。
  if (!url.pathname.startsWith(new URL(SCOPE_URL).pathname)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  event.respondWith(handleAsset(request));
});

/** FR-PWA-002：navigation fallback。オフラインでもロック画面までは開ける。 */
async function handleNavigation(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);

  const cachedShell = await cache.match(APP_SHELL_URL);
  if (cachedShell) {
    return cachedShell;
  }

  try {
    return await fetch(request);
  } catch {
    const offline = await cache.match(OFFLINE_URL);
    return offline ?? new Response('オフラインです。', { status: 503 });
  }
}

/** プリキャッシュ済みならキャッシュを返す。未知の資産はネットワークのみで、保存しない。 */
async function handleAsset(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: false });
  if (cached) {
    return cached;
  }

  try {
    return await fetch(request);
  } catch {
    return new Response('', { status: 504 });
  }
}

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event.data?.text());

  event.waitUntil(
    self.registration.showNotification(NOTIFICATION_TITLE, {
      body: buildNotificationBody(payload.count),
      // 端末に同種の通知が積み上がらないようまとめる。
      tag: 'documents-added',
      icon: new URL('icons/icon-192.png', SCOPE_URL).toString(),
      badge: new URL('icons/icon-192.png', SCOPE_URL).toString(),
      data: { url: resolveDeepLinkUrl(payload, SCOPE_URL) },
      requireInteraction: false,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data as { url?: string } | undefined;
  const targetUrl = typeof data?.url === 'string' ? data.url : SCOPE_URL;

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // FR-PUSH-008：開いているクライアントがあれば focus し、遷移は本体側へ委ねる。
      // ロック中の場合、本体がディープリンクを保留して解除後に処理する。
      for (const client of clientList) {
        if (client.url.startsWith(SCOPE_URL)) {
          await client.focus();
          client.postMessage({ type: 'deep-link', url: targetUrl });
          return;
        }
      }

      await self.clients.openWindow(targetUrl);
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data as { type?: string } | undefined;
  if (data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});
