/**
 * master key を包む2種類の封筒（8.2.2 / 8.2.4）。
 *
 *   password-envelope … パスワード由来鍵でラップしたもの。パスワードを知らないと開けない。
 *   session-envelope  … device wrapping key でラップしたもの。有効期限を持つ。
 *
 * 「120時間ごとにパスワードを求める」という要件は、session-envelope の
 * expiresAt でのみ表現する。アプリを開いた時刻で延長しない（FR-AUTH-001）。
 */

import {
  ALGORITHM_VERSION,
  PBKDF2_ITERATIONS,
  RECORD_PASSWORD_ENVELOPE,
  RECORD_SCHEMA_VERSION,
  RECORD_SESSION_ENVELOPE,
  SESSION_DURATION_MS,
} from '../config/constants';
import { decryptJson, encryptJson, type EncryptedPayload } from './aesGcm';
import { deriveKeyFromPassword, generateSalt } from './kdf';
import { exportMasterKey, importMasterKey, type MasterKeyJwk } from './masterKey';

export interface PasswordEnvelope {
  schemaVersion: number;
  algorithmVersion: number;
  kdf: {
    name: 'PBKDF2';
    hash: 'SHA-256';
    iterations: number;
    salt: Uint8Array;
  };
  payload: EncryptedPayload;
}

export interface SessionEnvelope {
  schemaVersion: number;
  algorithmVersion: number;
  payload: EncryptedPayload;
  /** 期限は暗号文の中にも入れる。ここは一覧表示用の複製で、判定には使わない。 */
  expiresAtHint: number;
}

interface PasswordEnvelopePlaintext {
  schemaVersion: number;
  masterKeyJwk: MasterKeyJwk;
}

export interface SessionEnvelopePlaintext {
  schemaVersion: number;
  masterKeyJwk: MasterKeyJwk;
  authenticatedAt: number;
  expiresAt: number;
}

/** パスワードで master key を包む。 */
export async function createPasswordEnvelope(
  password: string,
  masterKey: CryptoKey,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<PasswordEnvelope> {
  const salt = generateSalt();
  const derivedKey = await deriveKeyFromPassword(password, salt, iterations);

  const plaintext: PasswordEnvelopePlaintext = {
    schemaVersion: RECORD_SCHEMA_VERSION,
    masterKeyJwk: await exportMasterKey(masterKey),
  };

  return {
    schemaVersion: RECORD_SCHEMA_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt },
    payload: await encryptJson(derivedKey, RECORD_PASSWORD_ENVELOPE, plaintext),
  };
}

/**
 * パスワードで master key を取り出す。
 * パスワードが違えば認証タグの検証に失敗し DecryptionError になる。
 */
export async function openPasswordEnvelope(
  password: string,
  envelope: PasswordEnvelope,
): Promise<CryptoKey> {
  const derivedKey = await deriveKeyFromPassword(
    password,
    envelope.kdf.salt,
    envelope.kdf.iterations,
  );
  const plaintext = await decryptJson<PasswordEnvelopePlaintext>(
    derivedKey,
    RECORD_PASSWORD_ENVELOPE,
    envelope.payload,
  );
  return importMasterKey(plaintext.masterKeyJwk);
}

/**
 * セッションを作る。有効期限は「認証した時刻 + 120時間」で固定する。
 *
 * @param authenticatedAt 正しいパスワードを入力した時刻（epoch ms）
 */
export async function createSessionEnvelope(
  deviceKey: CryptoKey,
  masterKey: CryptoKey,
  authenticatedAt: number,
): Promise<SessionEnvelope> {
  const expiresAt = authenticatedAt + SESSION_DURATION_MS;

  const plaintext: SessionEnvelopePlaintext = {
    schemaVersion: RECORD_SCHEMA_VERSION,
    masterKeyJwk: await exportMasterKey(masterKey),
    authenticatedAt,
    expiresAt,
  };

  return {
    schemaVersion: RECORD_SCHEMA_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    payload: await encryptJson(deviceKey, RECORD_SESSION_ENVELOPE, plaintext),
    expiresAtHint: expiresAt,
  };
}

export async function readSessionEnvelope(
  deviceKey: CryptoKey,
  envelope: SessionEnvelope,
): Promise<SessionEnvelopePlaintext> {
  return decryptJson<SessionEnvelopePlaintext>(
    deviceKey,
    RECORD_SESSION_ENVELOPE,
    envelope.payload,
  );
}

/**
 * セッションがまだ有効か（FR-AUTH-001 / AC-004）。
 *
 * 境界の扱い：119:59:59 は有効、120:00:00 ちょうどは無効。
 * `now < expiresAt` で判定するため、等しい瞬間は期限切れになる。
 */
export function isSessionValid(session: SessionEnvelopePlaintext, now: number): boolean {
  return now < session.expiresAt;
}

/** 次にパスワードを求める時刻。設定画面へ表示する（FR-SETTINGS-001）。 */
export function nextPasswordPromptAt(session: SessionEnvelopePlaintext): number {
  return session.expiresAt;
}
