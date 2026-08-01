/**
 * master key の生成と持ち運び（8.2.3 / 8.2.4）。
 *
 * master key は 256bit の AES-GCM 鍵で、app-config（PAT を含む）と read-state を
 * 暗号化するために使う。パスワード由来鍵と device wrapping key の2通りで
 * ラップして保存し、平文のままディスクへ書くことはない。
 */

import { AES_KEY_BITS } from '../config/constants';

/** 8.2.4 の session envelope が持つ形。 */
export interface MasterKeyJwk {
  kty: 'oct';
  k: string;
  alg: 'A256GCM';
  ext: true;
}

/**
 * 新しい master key を作る。
 * ラップのために取り出す必要があるので extractable にする。
 * ただし取り出した値は必ず暗号化してから保存する。
 */
export async function generateMasterKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: AES_KEY_BITS }, true, [
    'encrypt',
    'decrypt',
  ]);
}

export async function exportMasterKey(key: CryptoKey): Promise<MasterKeyJwk> {
  const jwk = await crypto.subtle.exportKey('jwk', key);
  if (jwk.kty !== 'oct' || typeof jwk.k !== 'string') {
    throw new Error('master key を書き出せませんでした');
  }
  return { kty: 'oct', k: jwk.k, alg: 'A256GCM', ext: true };
}

export async function importMasterKey(jwk: MasterKeyJwk): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'AES-GCM', length: AES_KEY_BITS }, true, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * 端末に紐づくラップ鍵を作る（8.2.3）。
 *
 * `extractable: false` なので、IndexedDB を覗いても鍵の値は読み出せない。
 * これが 120 時間セッションの拠り所になる。
 */
export async function generateDeviceWrappingKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: AES_KEY_BITS }, false, [
    'encrypt',
    'decrypt',
  ]);
}
