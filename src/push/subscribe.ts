/**
 * 通知の購読（FR-PUSH-002 / FR-PUSH-003）。
 *
 * アプリは Private Repository へ書き込まない。ここで作った登録 JSON を
 * 利用者がワークフローへ貼り付ける。これにより PAT を read-only に保てる。
 */

import { PUSH_SUBSCRIPTION_SCHEMA_VERSION } from '../config/constants';

export type PushSupport =
  | { supported: true }
  | {
      supported: false;
      reason: 'no-service-worker' | 'no-push-manager' | 'no-notification' | 'needs-home-screen';
    };

export interface PushRegistrationJson {
  schemaVersion: number;
  id: string;
  label: string;
  createdAt: string;
  subscription: {
    endpoint: string;
    expirationTime: number | null;
    keys: { p256dh: string; auth: string };
  };
}

/** ホーム画面から起動しているか。iOS ではこの形でしか Web Push が使えない。 */
export function isStandaloneDisplay(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) {
    return true;
  }
  // iOS Safari の独自プロパティ。
  return (navigator as { standalone?: boolean }).standalone === true;
}

/** iOS かどうか。ホーム画面追加の案内を出すかの判断に使う。 */
function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/** FR-PUSH-002 の機能検出。 */
export function detectPushSupport(): PushSupport {
  if (!('serviceWorker' in navigator)) {
    return { supported: false, reason: 'no-service-worker' };
  }
  if (!('PushManager' in window)) {
    return { supported: false, reason: 'no-push-manager' };
  }
  if (!('Notification' in window)) {
    return { supported: false, reason: 'no-notification' };
  }
  // iOS は通常のタブでは通知を使えない。
  if (isIos() && !isStandaloneDisplay()) {
    return { supported: false, reason: 'needs-home-screen' };
  }
  return { supported: true };
}

/** base64url の VAPID 公開鍵を pushManager が要求する形へ変える。 */
export function decodeVapidKey(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

/** 購読 id は endpoint の SHA-256 の先頭16文字（FR-PUSH-003）。 */
export async function subscriptionIdFromEndpoint(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

/**
 * 購読を作り、登録用 JSON を組み立てる。
 * 許可要求はこの関数の呼び出し元（ボタン押下）でだけ行う（FR-PUSH-002）。
 */
export async function createPushRegistration(
  vapidPublicKey: string,
  label: string,
): Promise<PushRegistrationJson> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('notification-denied');
  }

  const registration = await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(vapidPublicKey) as BufferSource,
    }));

  const json = subscription.toJSON();
  const endpoint = json.endpoint ?? '';
  const keys = json.keys ?? {};

  if (!endpoint || !keys.p256dh || !keys.auth) {
    throw new Error('subscription-incomplete');
  }

  return {
    schemaVersion: PUSH_SUBSCRIPTION_SCHEMA_VERSION,
    id: await subscriptionIdFromEndpoint(endpoint),
    label,
    createdAt: `${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
    subscription: {
      endpoint,
      expirationTime: json.expirationTime ?? null,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
    },
  };
}

/** 現在の購読 id を返す。設定画面の表示に使う。 */
export async function currentSubscriptionId(): Promise<string | null> {
  if (!('serviceWorker' in navigator)) {
    return null;
  }
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) {
    return null;
  }
  return subscriptionIdFromEndpoint(subscription.endpoint);
}

/** 端末側の購読を解除する。リポジトリ側の削除は別途ワークフローで行う。 */
export async function unsubscribeCurrentDevice(): Promise<boolean> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return (await subscription?.unsubscribe()) ?? false;
}
