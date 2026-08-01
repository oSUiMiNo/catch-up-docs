/**
 * 引き下げて更新（FR-DASH-003）。
 *
 * 一覧の先頭で下方向へ引いたときだけ反応する。途中までスクロールしている状態や、
 * 横方向の動き、すでに同期中のときは何もしない。
 *
 * ライブラリを足さずに Pointer Events だけで組む。指でもマウスでも同じ経路を通る。
 *
 * ジェスチャの途中経過は ref に置き、効果は一度だけ張る。
 * state に置いて依存に含めると、引いている最中に効果が張り直されて
 * 途中経過（どの指が触れているか）が失われ、離しても更新が走らなくなる。
 */

import { useEffect, useRef, useState } from 'react';

/** これ以上引いたら更新する距離（CSS px）。 */
const TRIGGER_DISTANCE = 72;

/** 引いた距離の見た目上の上限。 */
const MAX_INDICATOR_DISTANCE = 96;

/** 実際の移動量のうち、見た目へ反映する割合。指の動きより控えめに動かす。 */
const RESISTANCE = 0.45;

export interface PullToRefreshState {
  /** 表示用の引き下げ距離（0〜MAX_INDICATOR_DISTANCE）。 */
  distance: number;
  /** 離せば更新される位置まで引いているか。 */
  armed: boolean;
}

export interface PullToRefreshOptions {
  /** 更新の実行。 */
  onRefresh: () => void | Promise<void>;
  /** 同期中は反応させない。 */
  disabled: boolean;
}

interface Gesture {
  pointerId: number | null;
  startY: number;
  pulling: boolean;
  armed: boolean;
}

export function usePullToRefresh({
  onRefresh,
  disabled,
}: PullToRefreshOptions): [React.RefObject<HTMLDivElement | null>, PullToRefreshState] {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PullToRefreshState>({ distance: 0, armed: false });

  const gestureRef = useRef<Gesture>({ pointerId: null, startY: 0, pulling: false, armed: false });

  // 効果を張り直さずに最新の値を読むための入れ物。
  const optionsRef = useRef({ onRefresh, disabled });
  optionsRef.current = { onRefresh, disabled };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const reset = (): void => {
      gestureRef.current = { pointerId: null, startY: 0, pulling: false, armed: false };
      setState({ distance: 0, armed: false });
    };

    const onPointerDown = (event: PointerEvent): void => {
      const gesture = gestureRef.current;
      if (optionsRef.current.disabled || gesture.pointerId !== null) {
        return;
      }
      // 先頭に居るときだけ引き下げの候補にする。
      if (getScrollTop() > 0) {
        return;
      }
      gesture.pointerId = event.pointerId;
      gesture.startY = event.clientY;
    };

    const onPointerMove = (event: PointerEvent): void => {
      const gesture = gestureRef.current;
      if (gesture.pointerId !== event.pointerId) {
        return;
      }

      const delta = event.clientY - gesture.startY;

      // 上方向へ動いた、または途中までスクロールしたら取りやめる。
      if (delta <= 0 || getScrollTop() > 0) {
        if (gesture.pulling) {
          reset();
        }
        return;
      }

      const distance = Math.min(delta * RESISTANCE, MAX_INDICATOR_DISTANCE);
      const armed = distance >= TRIGGER_DISTANCE;

      gesture.pulling = true;
      gesture.armed = armed;
      setState({ distance, armed });
    };

    const onPointerUp = (event: PointerEvent): void => {
      const gesture = gestureRef.current;
      if (gesture.pointerId !== event.pointerId) {
        return;
      }

      const shouldRefresh = gesture.pulling && gesture.armed;
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
  }, []);

  return [containerRef, state];
}

/** ページ全体のスクロール位置。一覧はページごとスクロールする。 */
function getScrollTop(): number {
  return window.scrollY || document.documentElement.scrollTop;
}

/** テストから判定条件を確かめられるよう、しきい値を公開する。 */
export const pullToRefreshThresholds = {
  triggerDistance: TRIGGER_DISTANCE,
  maxIndicatorDistance: MAX_INDICATOR_DISTANCE,
  resistance: RESISTANCE,
};
