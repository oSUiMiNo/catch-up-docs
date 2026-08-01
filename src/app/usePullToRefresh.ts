/**
 * 引き下げて更新（FR-DASH-003）。
 *
 * 一覧の先頭で下方向へ引いたときだけ反応する。途中までスクロールしている状態や、
 * 横方向の動き、すでに同期中のときは何もしない。
 *
 * ライブラリを足さずに Pointer Events だけで組む。指でもマウスでも同じ経路を通る。
 */

import { useEffect, useRef, useState } from 'react';

/** これ以上引いたら更新する距離（CSS px）。 */
const TRIGGER_DISTANCE = 72;

/** 引いた距離の見た目上の上限。実距離の何割を表示に反映するか。 */
const MAX_INDICATOR_DISTANCE = 96;
const RESISTANCE = 0.45;

export interface PullToRefreshState {
  /** 表示用の引き下げ距離（0〜MAX_INDICATOR_DISTANCE）。 */
  distance: number;
  /** 離せば更新される位置まで引いているか。 */
  armed: boolean;
}

export interface PullToRefreshOptions {
  /** 更新の実行。完了を待つ。 */
  onRefresh: () => void | Promise<void>;
  /** 同期中は反応させない。 */
  disabled: boolean;
}

/**
 * 監視対象の要素へ渡す ref と、表示に使う状態を返す。
 */
export function usePullToRefresh({
  onRefresh,
  disabled,
}: PullToRefreshOptions): [React.RefObject<HTMLDivElement | null>, PullToRefreshState] {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PullToRefreshState>({ distance: 0, armed: false });

  // 効果の中から最新の値を読めるようにする。
  const optionsRef = useRef({ onRefresh, disabled });
  optionsRef.current = { onRefresh, disabled };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let pointerId: number | null = null;
    let startY = 0;
    let pulling = false;

    const reset = (): void => {
      pointerId = null;
      pulling = false;
      setState({ distance: 0, armed: false });
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (optionsRef.current.disabled || pointerId !== null) {
        return;
      }
      // 先頭に居るときだけ引き下げの候補にする。
      if (getScrollTop() > 0) {
        return;
      }
      pointerId = event.pointerId;
      startY = event.clientY;
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) {
        return;
      }
      const delta = event.clientY - startY;

      if (delta <= 0 || getScrollTop() > 0) {
        if (pulling) {
          reset();
        }
        return;
      }

      pulling = true;
      const distance = Math.min(delta * RESISTANCE, MAX_INDICATOR_DISTANCE);
      setState({ distance, armed: distance >= TRIGGER_DISTANCE });
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) {
        return;
      }
      const shouldRefresh = pulling && state.armed;
      reset();
      if (shouldRefresh && !optionsRef.current.disabled) {
        void optionsRef.current.onRefresh();
      }
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);

    return () => {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
    };
    // state.armed を読むため依存に含める。
  }, [state.armed]);

  return [containerRef, state];
}

/** ページ全体のスクロール位置。一覧はページごとスクロールする。 */
function getScrollTop(): number {
  return window.scrollY || document.documentElement.scrollTop;
}
