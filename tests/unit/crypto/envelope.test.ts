import { describe, expect, it } from 'vitest';

import { SESSION_DURATION_MS } from '@/config/constants';
import { DecryptionError } from '@/crypto/aesGcm';
import {
  createPasswordEnvelope,
  createSessionEnvelope,
  isSessionValid,
  nextPasswordPromptAt,
  openPasswordEnvelope,
  readSessionEnvelope,
} from '@/crypto/envelope';
import { generateDeviceWrappingKey, generateMasterKey } from '@/crypto/masterKey';

const FAST_ITERATIONS = 1_000;
const AUTHENTICATED_AT = Date.UTC(2026, 7, 1, 0, 0, 0);

describe('password envelope', () => {
  it('正しいパスワードで master key を取り出せる', async () => {
    const masterKey = await generateMasterKey();
    const envelope = await createPasswordEnvelope('正しいパスワード', masterKey, FAST_ITERATIONS);

    const restored = await openPasswordEnvelope('正しいパスワード', envelope);

    // 同じ鍵であることを、暗号文の相互復号で確かめる。
    const { encryptJson, decryptJson } = await import('@/crypto/aesGcm');
    const payload = await encryptJson(masterKey, 'app-config', { ok: true });
    expect(await decryptJson(restored, 'app-config', payload)).toEqual({ ok: true });
  });

  it('誤ったパスワードでは開けない', async () => {
    const envelope = await createPasswordEnvelope(
      '正しいパスワード',
      await generateMasterKey(),
      FAST_ITERATIONS,
    );

    await expect(openPasswordEnvelope('誤ったパスワード', envelope)).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it('salt と反復回数を保持する', async () => {
    const envelope = await createPasswordEnvelope(
      'パスワード',
      await generateMasterKey(),
      FAST_ITERATIONS,
    );

    expect(envelope.kdf.name).toBe('PBKDF2');
    expect(envelope.kdf.hash).toBe('SHA-256');
    expect(envelope.kdf.iterations).toBe(FAST_ITERATIONS);
    expect(envelope.kdf.salt.length).toBeGreaterThanOrEqual(16);
  });

  it('封筒に master key の平文が含まれない', async () => {
    const masterKey = await generateMasterKey();
    const exported = await crypto.subtle.exportKey('jwk', masterKey);
    const envelope = await createPasswordEnvelope('パスワード', masterKey, FAST_ITERATIONS);

    const serialized = JSON.stringify({
      ...envelope,
      kdf: { ...envelope.kdf, salt: Array.from(envelope.kdf.salt) },
      payload: {
        iv: Array.from(envelope.payload.iv),
        ciphertext: Array.from(envelope.payload.ciphertext),
      },
    });

    expect(exported.k).toBeDefined();
    expect(serialized).not.toContain(exported.k);
  });
});

describe('session envelope', () => {
  it('device key で開ける', async () => {
    const deviceKey = await generateDeviceWrappingKey();
    const envelope = await createSessionEnvelope(
      deviceKey,
      await generateMasterKey(),
      AUTHENTICATED_AT,
    );

    const session = await readSessionEnvelope(deviceKey, envelope);
    expect(session.authenticatedAt).toBe(AUTHENTICATED_AT);
    expect(session.expiresAt).toBe(AUTHENTICATED_AT + SESSION_DURATION_MS);
  });

  it('別の device key では開けない', async () => {
    const envelope = await createSessionEnvelope(
      await generateDeviceWrappingKey(),
      await generateMasterKey(),
      AUTHENTICATED_AT,
    );

    await expect(
      readSessionEnvelope(await generateDeviceWrappingKey(), envelope),
    ).rejects.toBeInstanceOf(DecryptionError);
  });

  it('device wrapping key は取り出せない', async () => {
    const deviceKey = await generateDeviceWrappingKey();
    expect(deviceKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', deviceKey)).rejects.toThrow();
  });
});

describe('120時間の境界（FR-AUTH-001 / AC-004）', () => {
  const session = {
    schemaVersion: 1,
    masterKeyJwk: { kty: 'oct' as const, k: 'x', alg: 'A256GCM' as const, ext: true as const },
    authenticatedAt: AUTHENTICATED_AT,
    expiresAt: AUTHENTICATED_AT + SESSION_DURATION_MS,
  };

  it('120時間は 432,000,000 ミリ秒である', () => {
    expect(SESSION_DURATION_MS).toBe(120 * 60 * 60 * 1000);
  });

  it('119時間59分59秒では有効', () => {
    const elapsed = (119 * 60 * 60 + 59 * 60 + 59) * 1000;
    expect(isSessionValid(session, AUTHENTICATED_AT + elapsed)).toBe(true);
  });

  it('119時間59分59秒999ミリ秒でも有効', () => {
    expect(isSessionValid(session, AUTHENTICATED_AT + SESSION_DURATION_MS - 1)).toBe(true);
  });

  it('120時間00分00秒ちょうどでは無効', () => {
    expect(isSessionValid(session, AUTHENTICATED_AT + SESSION_DURATION_MS)).toBe(false);
  });

  it('120時間を超えれば無効', () => {
    expect(isSessionValid(session, AUTHENTICATED_AT + SESSION_DURATION_MS + 1)).toBe(false);
  });

  it('認証直後は有効', () => {
    expect(isSessionValid(session, AUTHENTICATED_AT)).toBe(true);
  });

  it('次回パスワード要求時刻は期限と一致する', () => {
    expect(nextPasswordPromptAt(session)).toBe(AUTHENTICATED_AT + SESSION_DURATION_MS);
  });
});
