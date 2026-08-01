import { describe, expect, it } from 'vitest';

import { PBKDF2_ITERATIONS, PBKDF2_SALT_BYTES } from '@/config/constants';
import { decryptJson, encryptJson } from '@/crypto/aesGcm';
import { deriveKeyFromPassword, generateSalt } from '@/crypto/kdf';

// 反復回数そのものの検証以外は、テスト時間を抑えるため少ない回数で行う。
const FAST_ITERATIONS = 1_000;

describe('salt', () => {
  it('16バイト以上である', () => {
    expect(generateSalt().length).toBeGreaterThanOrEqual(16);
    expect(generateSalt()).toHaveLength(PBKDF2_SALT_BYTES);
  });

  it('毎回異なる', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 100; index += 1) {
      seen.add(Array.from(generateSalt()).join(','));
    }
    expect(seen.size).toBe(100);
  });
});

describe('鍵導出の決定性', () => {
  it('同じパスワードと salt からは同じ鍵になる', async () => {
    const salt = generateSalt();
    const first = await deriveKeyFromPassword('correct horse battery', salt, FAST_ITERATIONS);
    const second = await deriveKeyFromPassword('correct horse battery', salt, FAST_ITERATIONS);

    const payload = await encryptJson(first, 'password-envelope', { value: 42 });
    expect(await decryptJson(second, 'password-envelope', payload)).toEqual({ value: 42 });
  });

  it('salt が違えば別の鍵になる', async () => {
    const password = 'correct horse battery';
    const first = await deriveKeyFromPassword(password, generateSalt(), FAST_ITERATIONS);
    const second = await deriveKeyFromPassword(password, generateSalt(), FAST_ITERATIONS);

    const payload = await encryptJson(first, 'password-envelope', { value: 42 });
    await expect(decryptJson(second, 'password-envelope', payload)).rejects.toThrow();
  });

  it('パスワードが違えば別の鍵になる', async () => {
    const salt = generateSalt();
    const first = await deriveKeyFromPassword('パスワードA', salt, FAST_ITERATIONS);
    const second = await deriveKeyFromPassword('パスワードB', salt, FAST_ITERATIONS);

    const payload = await encryptJson(first, 'password-envelope', { value: 42 });
    await expect(decryptJson(second, 'password-envelope', payload)).rejects.toThrow();
  });

  it('反復回数が違えば別の鍵になる', async () => {
    const salt = generateSalt();
    const first = await deriveKeyFromPassword('同じパスワード', salt, FAST_ITERATIONS);
    const second = await deriveKeyFromPassword('同じパスワード', salt, FAST_ITERATIONS * 2);

    const payload = await encryptJson(first, 'password-envelope', { value: 42 });
    await expect(decryptJson(second, 'password-envelope', payload)).rejects.toThrow();
  });
});

describe('パスワードの扱い（FR-SETUP-003）', () => {
  it('前後の空白を削らない', async () => {
    const salt = generateSalt();
    const withSpace = await deriveKeyFromPassword('  パスワード  ', salt, FAST_ITERATIONS);
    const trimmed = await deriveKeyFromPassword('パスワード', salt, FAST_ITERATIONS);

    const payload = await encryptJson(withSpace, 'password-envelope', { value: 1 });
    await expect(decryptJson(trimmed, 'password-envelope', payload)).rejects.toThrow();
  });

  it('Unicode（絵文字を含む）を扱える', async () => {
    const salt = generateSalt();
    const password = 'パスワード🔐です';
    const first = await deriveKeyFromPassword(password, salt, FAST_ITERATIONS);
    const second = await deriveKeyFromPassword(password, salt, FAST_ITERATIONS);

    const payload = await encryptJson(first, 'password-envelope', { value: 1 });
    expect(await decryptJson(second, 'password-envelope', payload)).toEqual({ value: 1 });
  });
});

describe('既定の反復回数', () => {
  it('600,000 回である', () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
  });

  it('既定値でも導出できる', async () => {
    const salt = generateSalt();
    const key = await deriveKeyFromPassword('実運用と同じ回数', salt);
    const payload = await encryptJson(key, 'password-envelope', { value: 'ok' });

    const again = await deriveKeyFromPassword('実運用と同じ回数', salt);
    expect(await decryptJson(again, 'password-envelope', payload)).toEqual({ value: 'ok' });
  });
});
