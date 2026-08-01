/**
 * パスワードからの鍵導出（8.2.3）。
 *
 * PBKDF2-HMAC-SHA-256 を 600,000 回。パスワード自体も導出鍵も永続保存しない。
 * 反復回数を下げるとオフライン総当たりが現実的になるため、性能を理由に緩めない。
 */

import { AES_KEY_BITS, PBKDF2_ITERATIONS, PBKDF2_SALT_BYTES } from '../config/constants';

const textEncoder = new TextEncoder();

/** 16 バイト以上の暗号学的乱数。パスワードごとに新しく作る。 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
}

/**
 * パスワードから AES-GCM 鍵を導出する。
 *
 * 前後の空白を削らない（FR-SETUP-003）。利用者が意図して入れた空白も
 * パスワードの一部として扱う。
 *
 * @param password 利用者が入力したアプリ専用パスワード
 * @param salt 保存済みの salt
 * @param iterations 反復回数。既定値以外はテストと移行のためだけに使う
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    // 導出鍵は取り出せてはならない。
    false,
    ['encrypt', 'decrypt'],
  );
}
