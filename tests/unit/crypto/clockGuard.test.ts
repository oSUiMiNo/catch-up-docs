import { describe, expect, it } from 'vitest';

import { CLOCK_ROLLBACK_TOLERANCE_MS } from '@/config/constants';
import { advanceWitness, verifyClock } from '@/crypto/clockGuard';

const AUTHENTICATED_AT = Date.UTC(2026, 7, 1, 0, 0, 0);

describe('時計の巻き戻し検知（FR-AUTH-003）', () => {
  it('許容範囲は5分である', () => {
    expect(CLOCK_ROLLBACK_TOLERANCE_MS).toBe(5 * 60 * 1000);
  });

  it('前に進んでいれば問題ない', () => {
    expect(verifyClock(AUTHENTICATED_AT + 60_000, AUTHENTICATED_AT, null)).toEqual({ ok: true });
  });

  it('わずかな誤差（5分未満の過去）は許容する', () => {
    const now = AUTHENTICATED_AT - (CLOCK_ROLLBACK_TOLERANCE_MS - 1);
    expect(verifyClock(now, AUTHENTICATED_AT, null)).toEqual({ ok: true });
  });

  it('認証時刻より5分以上過去なら再認証させる', () => {
    const now = AUTHENTICATED_AT - CLOCK_ROLLBACK_TOLERANCE_MS - 1;
    expect(verifyClock(now, AUTHENTICATED_AT, null)).toEqual({
      ok: false,
      reason: 'behind-authentication',
    });
  });

  it('未来へ飛ばしてから戻した操作を検知する', () => {
    // いちど遠い未来を観測させる。
    const witness = advanceWitness(null, AUTHENTICATED_AT + 10 * 24 * 60 * 60 * 1000);

    // その後、認証直後の時刻へ戻しても観測値より過去なので弾かれる。
    const now = AUTHENTICATED_AT + 60_000;
    expect(verifyClock(now, AUTHENTICATED_AT, witness)).toEqual({
      ok: false,
      reason: 'rolled-back',
    });
  });

  it('観測値の直後なら通す', () => {
    const witness = advanceWitness(null, AUTHENTICATED_AT + 60_000);
    expect(verifyClock(AUTHENTICATED_AT + 61_000, AUTHENTICATED_AT, witness)).toEqual({ ok: true });
  });
});

describe('観測値の更新', () => {
  it('初回はその時刻を記録する', () => {
    expect(advanceWitness(null, 1000)).toEqual({ maxObservedAt: 1000 });
  });

  it('前へ進むときだけ更新する', () => {
    const witness = advanceWitness(null, 5000);
    expect(advanceWitness(witness, 9000)).toEqual({ maxObservedAt: 9000 });
  });

  it('過去の時刻では巻き戻さない', () => {
    const witness = advanceWitness(null, 5000);
    expect(advanceWitness(witness, 1000)).toEqual({ maxObservedAt: 5000 });
  });
});
