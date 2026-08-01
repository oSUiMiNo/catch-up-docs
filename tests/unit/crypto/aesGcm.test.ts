import { describe, expect, it } from 'vitest';

import { AES_GCM_IV_BYTES, ALGORITHM_VERSION, RECORD_SCHEMA_VERSION } from '@/config/constants';
import {
  buildAdditionalData,
  DecryptionError,
  decryptBytes,
  decryptJson,
  encryptBytes,
  encryptJson,
  generateIv,
} from '@/crypto/aesGcm';

async function makeKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

describe('IV の生成', () => {
  it('96bit（12バイト）である', () => {
    expect(generateIv()).toHaveLength(AES_GCM_IV_BYTES);
  });

  it('毎回異なる値になる', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      seen.add(Array.from(generateIv()).join(','));
    }
    expect(seen.size).toBe(200);
  });
});

describe('追加認証データ', () => {
  it('schemaVersion|recordKey|algorithmVersion の形をとる', () => {
    const decoded = new TextDecoder().decode(buildAdditionalData('app-config'));
    expect(decoded).toBe(
      `${String(RECORD_SCHEMA_VERSION)}|app-config|${String(ALGORITHM_VERSION)}`,
    );
  });

  it('レコードキーが違えば別の値になる', () => {
    expect(buildAdditionalData('app-config')).not.toEqual(buildAdditionalData('read-state'));
  });
});

describe('暗号化と復号', () => {
  it('往復して元に戻る', async () => {
    const key = await makeKey();
    const original = new TextEncoder().encode('秘密の値');

    const payload = await encryptBytes(key, 'app-config', original);
    const restored = await decryptBytes(key, 'app-config', payload);

    // jsdom と Node の Web Crypto では Uint8Array の由来が異なり、
    // 型そのものの比較は環境差で落ちる。中身のバイト列で比べる。
    expect(Array.from(restored)).toEqual(Array.from(original));
  });

  it('同じ平文でも暗号文は毎回変わる（IV が異なるため）', async () => {
    const key = await makeKey();
    const plaintext = new TextEncoder().encode('同じ値');

    const first = await encryptBytes(key, 'app-config', plaintext);
    const second = await encryptBytes(key, 'app-config', plaintext);

    expect(first.iv).not.toEqual(second.iv);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
  });

  it('JSON を往復できる', async () => {
    const key = await makeKey();
    const value = { owner: 'someone', nested: { list: [1, 2, 3] }, 日本語: 'あり' };

    const payload = await encryptJson(key, 'app-config', value);
    expect(await decryptJson(key, 'app-config', payload)).toEqual(value);
  });

  it('別の鍵では復号できない', async () => {
    const payload = await encryptJson(await makeKey(), 'app-config', { a: 1 });
    await expect(decryptJson(await makeKey(), 'app-config', payload)).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it('別のレコードキーでは復号できない（暗号文の差し替えを検出する）', async () => {
    const key = await makeKey();
    const payload = await encryptJson(key, 'app-config', { a: 1 });

    await expect(decryptJson(key, 'read-state', payload)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('暗号文を1バイト書き換えると復号に失敗する', async () => {
    const key = await makeKey();
    const payload = await encryptJson(key, 'app-config', { a: 1 });

    const tampered = new Uint8Array(payload.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;

    await expect(
      decryptJson(key, 'app-config', { iv: payload.iv, ciphertext: tampered }),
    ).rejects.toBeInstanceOf(DecryptionError);
  });

  it('IV を書き換えると復号に失敗する', async () => {
    const key = await makeKey();
    const payload = await encryptJson(key, 'app-config', { a: 1 });

    const tamperedIv = new Uint8Array(payload.iv);
    tamperedIv[0] = (tamperedIv[0] ?? 0) ^ 0xff;

    await expect(
      decryptJson(key, 'app-config', { iv: tamperedIv, ciphertext: payload.ciphertext }),
    ).rejects.toBeInstanceOf(DecryptionError);
  });

  it('失敗時の例外に鍵素材や平文が含まれない', async () => {
    const key = await makeKey();
    const payload = await encryptJson(key, 'app-config', { token: 'super-secret-value' });

    await expect(decryptJson(key, 'read-state', payload)).rejects.toThrow(
      /暗号化データを復号できませんでした/,
    );
  });
});
