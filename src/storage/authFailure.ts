/**
 * パスワード誤入力に対する待機（FR-AUTH-005）。
 *
 * 5 回連続で失敗したら 30 秒待たせ、以降は失敗のたびに倍増して最大 5 分。
 * 成功したら回数をリセットする。
 *
 * この状態は暗号化しない。改ざんされても漏れる秘密が無く、
 * アプリデータを消せばどのみち消えるため（8.2.2）。
 */

import {
  AUTH_BACKOFF_INITIAL_MS,
  AUTH_BACKOFF_MAX_MS,
  AUTH_FAILURE_THRESHOLD,
  META_AUTH_FAILURE_STATE,
} from '../config/constants';
import { deleteMeta, getMeta, setMeta } from './db';

export interface AuthFailureState {
  failureCount: number;
  /** この時刻までは試行を受け付けない（epoch ms）。 */
  blockedUntil: number;
}

export const initialAuthFailureState: AuthFailureState = { failureCount: 0, blockedUntil: 0 };

export async function loadAuthFailureState(): Promise<AuthFailureState> {
  const stored = await getMeta<AuthFailureState>(META_AUTH_FAILURE_STATE);
  if (
    !stored ||
    typeof stored.failureCount !== 'number' ||
    typeof stored.blockedUntil !== 'number'
  ) {
    return initialAuthFailureState;
  }
  return stored;
}

export async function saveAuthFailureState(state: AuthFailureState): Promise<void> {
  await setMeta(META_AUTH_FAILURE_STATE, state);
}

export async function clearAuthFailureState(): Promise<void> {
  await deleteMeta(META_AUTH_FAILURE_STATE);
}

/**
 * 失敗を 1 回積む。
 *
 * 閾値に届くまでは待機を課さない。届いた後は失敗のたびに倍増させる。
 * 5回目: 30秒 / 6回目: 60秒 / 7回目: 120秒 / 8回目: 240秒 / 9回目以降: 300秒
 */
export function registerFailure(state: AuthFailureState, now: number): AuthFailureState {
  const failureCount = state.failureCount + 1;

  if (failureCount < AUTH_FAILURE_THRESHOLD) {
    return { failureCount, blockedUntil: 0 };
  }

  const steps = failureCount - AUTH_FAILURE_THRESHOLD;
  const waitMs = Math.min(AUTH_BACKOFF_INITIAL_MS * 2 ** steps, AUTH_BACKOFF_MAX_MS);

  return { failureCount, blockedUntil: now + waitMs };
}

/** 待機の残り時間（ミリ秒）。0 なら試行できる。 */
export function remainingBlockMs(state: AuthFailureState, now: number): number {
  return Math.max(0, state.blockedUntil - now);
}

export function isBlocked(state: AuthFailureState, now: number): boolean {
  return remainingBlockMs(state, now) > 0;
}
