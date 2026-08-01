/**
 * AES-GCM による暗号化と復号（8.2.3）。
 *
 * 設計上の決めごと:
 *   - IV は暗号化のたびに 96bit の乱数を作る。使い回さない。
 *   - AAD に `schemaVersion|recordKey|algorithmVersion` を入れる。これにより、
 *     あるレコードの暗号文を別のレコードへ差し替える改ざんが検出できる。
 *   - 復号に失敗したら例外を投げ、呼び出し側は表示を中止する（SEC-009 fail closed）。
 */

import {
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BITS,
  ALGORITHM_VERSION,
  RECORD_SCHEMA_VERSION,
} from '../config/constants';

/** IndexedDB へそのまま保存できる形。structured clone で Uint8Array を運べる。 */
export interface EncryptedPayload {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

export class DecryptionError extends Error {
  constructor(message = '暗号化データを復号できませんでした') {
    super(message);
    this.name = 'DecryptionError';
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * 追加認証データ。暗号文そのものには含まれないが、改ざんすると復号が失敗する。
 * レコードごとに異なる値になるため、暗号文の入れ替えを検出できる。
 */
export function buildAdditionalData(recordKey: string): Uint8Array {
  return textEncoder.encode(
    `${String(RECORD_SCHEMA_VERSION)}|${recordKey}|${String(ALGORITHM_VERSION)}`,
  );
}

/** 暗号学的乱数の IV を作る。 */
export function generateIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
}

export async function encryptBytes(
  key: CryptoKey,
  recordKey: string,
  plaintext: Uint8Array,
): Promise<EncryptedPayload> {
  const iv = generateIv();
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
      additionalData: buildAdditionalData(recordKey) as BufferSource,
      tagLength: AES_GCM_TAG_BITS,
    },
    key,
    plaintext as BufferSource,
  );

  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

export async function decryptBytes(
  key: CryptoKey,
  recordKey: string,
  payload: EncryptedPayload,
): Promise<Uint8Array> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: payload.iv as BufferSource,
        additionalData: buildAdditionalData(recordKey) as BufferSource,
        tagLength: AES_GCM_TAG_BITS,
      },
      key,
      payload.ciphertext as BufferSource,
    );
    return new Uint8Array(plaintext);
  } catch {
    // 例外の中身には鍵素材の手がかりが入り得るため、そのまま伝播させない。
    throw new DecryptionError();
  }
}

export async function encryptJson(
  key: CryptoKey,
  recordKey: string,
  value: unknown,
): Promise<EncryptedPayload> {
  return encryptBytes(key, recordKey, textEncoder.encode(JSON.stringify(value)));
}

export async function decryptJson<T>(
  key: CryptoKey,
  recordKey: string,
  payload: EncryptedPayload,
): Promise<T> {
  const plaintext = await decryptBytes(key, recordKey, payload);
  try {
    return JSON.parse(textDecoder.decode(plaintext)) as T;
  } catch {
    throw new DecryptionError('復号後のデータを解釈できませんでした');
  }
}
