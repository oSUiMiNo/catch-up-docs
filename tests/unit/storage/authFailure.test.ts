import { describe, expect, it } from 'vitest';

import {
  AUTH_BACKOFF_INITIAL_MS,
  AUTH_BACKOFF_MAX_MS,
  AUTH_FAILURE_THRESHOLD,
} from '@/config/constants';
import {
  initialAuthFailureState,
  isBlocked,
  registerFailure,
  remainingBlockMs,
} from '@/storage/authFailure';

const NOW = Date.UTC(2026, 7, 1, 0, 0, 0);

/** 指定回数だけ失敗を積む。 */
function failTimes(count: number): ReturnType<typeof registerFailure> {
  let state = initialAuthFailureState;
  for (let index = 0; index < count; index += 1) {
    state = registerFailure(state, NOW);
  }
  return state;
}

describe('誤入力への待機（FR-AUTH-005）', () => {
  it('閾値は5回、初回待機は30秒、上限は5分', () => {
    expect(AUTH_FAILURE_THRESHOLD).toBe(5);
    expect(AUTH_BACKOFF_INITIAL_MS).toBe(30_000);
    expect(AUTH_BACKOFF_MAX_MS).toBe(300_000);
  });

  it('4回目までは待機を課さない', () => {
    for (let count = 1; count <= 4; count += 1) {
      const state = failTimes(count);
      expect(state.failureCount).toBe(count);
      expect(isBlocked(state, NOW)).toBe(false);
    }
  });

  it('5回目で30秒待たせる', () => {
    const state = failTimes(5);
    expect(remainingBlockMs(state, NOW)).toBe(30_000);
  });

  it('以降は倍増する', () => {
    expect(remainingBlockMs(failTimes(6), NOW)).toBe(60_000);
    expect(remainingBlockMs(failTimes(7), NOW)).toBe(120_000);
    expect(remainingBlockMs(failTimes(8), NOW)).toBe(240_000);
  });

  it('5分で頭打ちになる', () => {
    expect(remainingBlockMs(failTimes(9), NOW)).toBe(300_000);
    expect(remainingBlockMs(failTimes(20), NOW)).toBe(300_000);
  });

  it('待機時間が過ぎれば試行できる', () => {
    const state = failTimes(5);
    expect(isBlocked(state, NOW + 29_999)).toBe(true);
    expect(isBlocked(state, NOW + 30_000)).toBe(false);
  });

  it('残り時間は負にならない', () => {
    const state = failTimes(5);
    expect(remainingBlockMs(state, NOW + 10 * 60_000)).toBe(0);
  });
});
