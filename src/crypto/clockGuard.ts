/**
 * 端末時刻の監視（FR-AUTH-003）。
 *
 * 120 時間セッションは端末時刻に依存する。時計を巻き戻せば期限切れを
 * 回避できてしまうため、次の2つを検知したら再認証させる。
 *
 *   1. 最後に認証した時刻より 5 分以上過去へ戻っている
 *   2. いちど観測した最大時刻より 5 分以上過去へ戻っている
 *      （未来へ飛ばしてから戻す操作を捉える）
 *
 * 完全な防御ではない。ローカルデータを消せば witness も消える。それでも
 * PAT の再入力が必要になるため、要件どおり許容する。
 */

import { CLOCK_ROLLBACK_TOLERANCE_MS } from '../config/constants';

export interface ClockWitness {
  /** これまでに観測した最大の端末時刻（epoch ms）。 */
  maxObservedAt: number;
}

export type ClockVerdict =
  { ok: true } | { ok: false; reason: 'behind-authentication' | 'rolled-back' };

/**
 * 現在時刻が信用できるかを判定する。
 *
 * @param now 端末の現在時刻
 * @param authenticatedAt 最後に正しいパスワードを入力した時刻
 * @param witness 前回までに観測した最大時刻。無ければ判定を省く
 */
export function verifyClock(
  now: number,
  authenticatedAt: number,
  witness: ClockWitness | null,
): ClockVerdict {
  if (now < authenticatedAt - CLOCK_ROLLBACK_TOLERANCE_MS) {
    return { ok: false, reason: 'behind-authentication' };
  }

  if (witness && now < witness.maxObservedAt - CLOCK_ROLLBACK_TOLERANCE_MS) {
    return { ok: false, reason: 'rolled-back' };
  }

  return { ok: true };
}

/** 観測値を更新する。時刻は前へしか進めない。 */
export function advanceWitness(witness: ClockWitness | null, now: number): ClockWitness {
  return { maxObservedAt: Math.max(witness?.maxObservedAt ?? 0, now) };
}
