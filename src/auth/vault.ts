/**
 * ロック・解除・セッションの一連の流れ（7.2）。
 *
 * 画面側はこのモジュールだけを呼ぶ。IndexedDB の構造や暗号の詳細は外へ出さない。
 * master key はここが返す値としてのみメモリ上に存在し、永続化はしない。
 */

import {
  KEY_DEVICE_WRAPPING,
  META_CLOCK_WITNESS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  RECORD_PASSWORD_ENVELOPE,
  RECORD_SESSION_ENVELOPE,
} from '../config/constants';
import { DecryptionError } from '../crypto/aesGcm';
import { advanceWitness, verifyClock, type ClockWitness } from '../crypto/clockGuard';
import {
  createPasswordEnvelope,
  createSessionEnvelope,
  isSessionValid,
  openPasswordEnvelope,
  readSessionEnvelope,
  type PasswordEnvelope,
  type SessionEnvelope,
  type SessionEnvelopePlaintext,
} from '../crypto/envelope';
import { generateDeviceWrappingKey, generateMasterKey } from '../crypto/masterKey';
import {
  clearAuthFailureState,
  isBlocked,
  loadAuthFailureState,
  registerFailure,
  remainingBlockMs,
  saveAuthFailureState,
} from '../storage/authFailure';
import { deleteAppConfig, saveAppConfig, type AppConfig } from '../storage/appConfig';
import {
  deleteMeta,
  deleteRecord,
  destroyDatabase,
  getMeta,
  getRecord,
  getStoredKey,
  setMeta,
  setRecord,
  setStoredKey,
} from '../storage/db';
import { deleteReadState } from '../storage/readState';

/** 解除に失敗した理由。画面のエラーコードへ対応する（13章）。 */
export type UnlockFailureReason =
  'wrong-password' | 'blocked' | 'not-initialized' | 'corrupted' | 'clock-rollback';

export class UnlockError extends Error {
  readonly reason: UnlockFailureReason;
  /** 待機中の場合の残りミリ秒。 */
  readonly retryAfterMs: number;

  constructor(reason: UnlockFailureReason, retryAfterMs = 0) {
    super(reason);
    this.name = 'UnlockError';
    this.reason = reason;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface UnlockedVault {
  masterKey: CryptoKey;
  authenticatedAt: number;
  expiresAt: number;
}

/** 自動解除の結果。 */
export type RestoreResult =
  | { status: 'unlocked'; vault: UnlockedVault }
  | { status: 'locked'; reason: 'no-session' | 'expired' | 'corrupted' | 'clock-rollback' };

// ── 初期化の状態 ───────────────────────────────────────────

/** FR-SETUP-001：有効な暗号化設定があるか。 */
export async function isInitialized(): Promise<boolean> {
  return (await getRecord<PasswordEnvelope>(RECORD_PASSWORD_ENVELOPE)) !== null;
}

/** FR-SETUP-003：パスワードの条件。前後の空白は削らない。 */
export function validatePassword(password: string): string[] {
  const errors: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`${String(PASSWORD_MIN_LENGTH)}文字以上にしてください`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    errors.push(`${String(PASSWORD_MAX_LENGTH)}文字以内にしてください`);
  }
  return errors;
}

// ── 端末鍵 ─────────────────────────────────────────────────

async function ensureDeviceWrappingKey(): Promise<CryptoKey> {
  const existing = await getStoredKey(KEY_DEVICE_WRAPPING);
  if (existing) {
    return existing;
  }
  const created = await generateDeviceWrappingKey();
  await setStoredKey(KEY_DEVICE_WRAPPING, created);
  return created;
}

// ── セッション ─────────────────────────────────────────────

async function startSession(masterKey: CryptoKey, now: number): Promise<UnlockedVault> {
  const deviceKey = await ensureDeviceWrappingKey();
  const envelope = await createSessionEnvelope(deviceKey, masterKey, now);
  await setRecord(RECORD_SESSION_ENVELOPE, envelope);
  await setMeta(META_CLOCK_WITNESS, advanceWitness(null, now));

  return { masterKey, authenticatedAt: now, expiresAt: envelope.expiresAtHint };
}

/**
 * 保存済みセッションから自動解除する（FR-AUTH-002）。
 * 期限切れ、破損、時計の巻き戻しを検知したらロックのままにする。
 */
export async function restoreSession(now: number): Promise<RestoreResult> {
  const envelope = await getRecord<SessionEnvelope>(RECORD_SESSION_ENVELOPE);
  if (!envelope) {
    return { status: 'locked', reason: 'no-session' };
  }

  const deviceKey = await getStoredKey(KEY_DEVICE_WRAPPING);
  if (!deviceKey) {
    await deleteRecord(RECORD_SESSION_ENVELOPE);
    return { status: 'locked', reason: 'corrupted' };
  }

  let session: SessionEnvelopePlaintext;
  try {
    session = await readSessionEnvelope(deviceKey, envelope);
  } catch {
    await deleteRecord(RECORD_SESSION_ENVELOPE);
    return { status: 'locked', reason: 'corrupted' };
  }

  const witness = await getMeta<ClockWitness>(META_CLOCK_WITNESS);
  const verdict = verifyClock(now, session.authenticatedAt, witness);
  if (!verdict.ok) {
    await deleteRecord(RECORD_SESSION_ENVELOPE);
    return { status: 'locked', reason: 'clock-rollback' };
  }

  if (!isSessionValid(session, now)) {
    await deleteRecord(RECORD_SESSION_ENVELOPE);
    return { status: 'locked', reason: 'expired' };
  }

  // 観測した時刻を進める。期限そのものは延長しない（FR-AUTH-001）。
  await setMeta(META_CLOCK_WITNESS, advanceWitness(witness, now));

  const { importMasterKey } = await import('../crypto/masterKey');
  return {
    status: 'unlocked',
    vault: {
      masterKey: await importMasterKey(session.masterKeyJwk),
      authenticatedAt: session.authenticatedAt,
      expiresAt: session.expiresAt,
    },
  };
}

// ── 初回設定 ───────────────────────────────────────────────

/**
 * FR-SETUP-006：接続テストに成功した後にだけ呼ぶ。
 * master key を作り、パスワードで包み、設定を暗号化して保存する。
 */
export async function initializeVault(
  password: string,
  config: AppConfig,
  now: number,
): Promise<UnlockedVault> {
  const errors = validatePassword(password);
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  const masterKey = await generateMasterKey();
  const envelope = await createPasswordEnvelope(password, masterKey);

  await setRecord(RECORD_PASSWORD_ENVELOPE, envelope);
  await saveAppConfig(masterKey, config);
  await clearAuthFailureState();

  return startSession(masterKey, now);
}

// ── 解除 ───────────────────────────────────────────────────

/**
 * パスワードで解除する（FR-AUTH-005）。
 * 誤入力の詳細は返さない。待機中は残り時間だけを伝える。
 */
export async function unlockWithPassword(password: string, now: number): Promise<UnlockedVault> {
  const failureState = await loadAuthFailureState();
  if (isBlocked(failureState, now)) {
    throw new UnlockError('blocked', remainingBlockMs(failureState, now));
  }

  const envelope = await getRecord<PasswordEnvelope>(RECORD_PASSWORD_ENVELOPE);
  if (!envelope) {
    throw new UnlockError('not-initialized');
  }

  let masterKey: CryptoKey;
  try {
    masterKey = await openPasswordEnvelope(password, envelope);
  } catch (error) {
    if (error instanceof DecryptionError) {
      const next = registerFailure(failureState, now);
      await saveAuthFailureState(next);
      throw new UnlockError('wrong-password', remainingBlockMs(next, now));
    }
    throw new UnlockError('corrupted');
  }

  await clearAuthFailureState();
  return startSession(masterKey, now);
}

// ── ロック ─────────────────────────────────────────────────

/**
 * FR-AUTH-006：今すぐロック。
 * session envelope を消す。メモリ上の master key と PAT の破棄は呼び出し側が行う。
 */
export async function lockNow(): Promise<void> {
  await deleteRecord(RECORD_SESSION_ENVELOPE);
}

// ── パスワード変更 ─────────────────────────────────────────

/**
 * FR-AUTH-007：master key を作り直さず、新しいパスワード由来鍵で包み直す。
 * これにより app-config と read-state を平文へ展開せずに済む。
 */
export async function changePassword(
  currentPassword: string,
  nextPassword: string,
  now: number,
): Promise<UnlockedVault> {
  const errors = validatePassword(nextPassword);
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  const masterKey = (await unlockWithPassword(currentPassword, now)).masterKey;
  await setRecord(RECORD_PASSWORD_ENVELOPE, await createPasswordEnvelope(nextPassword, masterKey));

  return startSession(masterKey, now);
}

// ── リセット ───────────────────────────────────────────────

/**
 * FR-SETTINGS-004：ローカルデータをすべて消す。
 * Private Repository 側の購読情報は消せないため、画面側で削除ワークフローへ誘導する。
 */
export async function resetVault(): Promise<void> {
  await deleteAppConfig();
  await deleteReadState();
  await deleteRecord(RECORD_PASSWORD_ENVELOPE);
  await deleteRecord(RECORD_SESSION_ENVELOPE);
  await deleteMeta(META_CLOCK_WITNESS);
  await clearAuthFailureState();
  await destroyDatabase();
}
