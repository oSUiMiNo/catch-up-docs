/**
 * 引き下げて更新の判定（FR-DASH-003）。
 *
 * 実際の使われ方と同じく、ref を JSX で要素へ結び付けた状態で試す。
 * ジェスチャの途中で状態が変わっても、離したときに更新が走ることを固定する。
 * 効果を張り直す実装だと、引いている最中に途中経過が失われて更新が走らない。
 */

import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { pullToRefreshThresholds, usePullToRefresh } from '@/app/usePullToRefresh';

const { triggerDistance, resistance } = pullToRefreshThresholds;

/** しきい値を超えるのに必要な指の移動量。 */
const ENOUGH = Math.ceil(triggerDistance / resistance) + 10;
const NOT_ENOUGH = Math.floor((triggerDistance / resistance) * 0.5);

/**
 * PointerEvent の構築は環境差があるため、必要な属性だけを持つ event を投げる。
 * 実装は addEventListener で受けるので、これで同じ経路を通る。
 */
function firePointer(target: HTMLElement, type: string, pointerId: number, clientY: number): void {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'clientY', { value: clientY });
  target.dispatchEvent(event);
}

function Harness({
  onRefresh,
  disabled,
}: {
  onRefresh: () => void;
  disabled: boolean;
}): React.JSX.Element {
  const [containerRef, pull] = usePullToRefresh({ onRefresh, disabled });

  return (
    <div ref={containerRef} data-testid="container">
      <span data-testid="distance">{String(Math.round(pull.distance))}</span>
      <span data-testid="armed">{pull.armed ? 'armed' : 'idle'}</span>
    </div>
  );
}

function setup(disabled = false) {
  const onRefresh = vi.fn();
  render(<Harness onRefresh={onRefresh} disabled={disabled} />);
  return { onRefresh, container: screen.getByTestId('container') };
}

const readDistance = (): number => Number(screen.getByTestId('distance').textContent);
const readArmed = (): string => screen.getByTestId('armed').textContent ?? '';

// jsdom は scrollTo を実装していない。scrollY は既定で 0 のため、
// 「一覧の先頭にいる」という前提はそのまま満たされる。

describe('引き下げて更新', () => {
  it('十分に引いて離すと更新が走る', () => {
    const { onRefresh, container } = setup();

    act(() => {
      firePointer(container, 'pointerdown', 1, 0);
      firePointer(container, 'pointermove', 1, ENOUGH);
      firePointer(container, 'pointerup', 1, ENOUGH);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('しきい値に届かなければ更新しない', () => {
    const { onRefresh, container } = setup();

    act(() => {
      firePointer(container, 'pointerdown', 1, 0);
      firePointer(container, 'pointermove', 1, NOT_ENOUGH);
      firePointer(container, 'pointerup', 1, NOT_ENOUGH);
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('上方向へ動かしても更新しない', () => {
    const { onRefresh, container } = setup();

    act(() => {
      firePointer(container, 'pointerdown', 1, 100);
      firePointer(container, 'pointermove', 1, 20);
      firePointer(container, 'pointerup', 1, 20);
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('同期中は反応しない', () => {
    const { onRefresh, container } = setup(true);

    act(() => {
      firePointer(container, 'pointerdown', 1, 0);
      firePointer(container, 'pointermove', 1, ENOUGH);
      firePointer(container, 'pointerup', 1, ENOUGH);
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('別の指の離上では反応しない', () => {
    const { onRefresh, container } = setup();

    act(() => {
      firePointer(container, 'pointerdown', 1, 0);
      firePointer(container, 'pointermove', 1, ENOUGH);
      firePointer(container, 'pointerup', 2, ENOUGH);
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('引いている最中に表示用の状態が更新される', () => {
    const { container } = setup();

    act(() => {
      firePointer(container, 'pointerdown', 1, 0);
      firePointer(container, 'pointermove', 1, ENOUGH);
    });

    expect(readDistance()).toBeGreaterThan(0);
    expect(readArmed()).toBe('armed');
  });

  it('離したあとは表示用の状態が戻る', () => {
    const { container } = setup();

    act(() => {
      firePointer(container, 'pointerdown', 1, 0);
      firePointer(container, 'pointermove', 1, ENOUGH);
      firePointer(container, 'pointerup', 1, ENOUGH);
    });

    expect(readDistance()).toBe(0);
    expect(readArmed()).toBe('idle');
  });

  it('取りやめたあとに引き直せる', () => {
    const { onRefresh, container } = setup();

    act(() => {
      firePointer(container, 'pointerdown', 1, 0);
      firePointer(container, 'pointermove', 1, NOT_ENOUGH);
      firePointer(container, 'pointerup', 1, NOT_ENOUGH);
    });
    expect(onRefresh).not.toHaveBeenCalled();

    act(() => {
      firePointer(container, 'pointerdown', 2, 0);
      firePointer(container, 'pointermove', 2, ENOUGH);
      firePointer(container, 'pointerup', 2, ENOUGH);
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('引いている最中にしきい値を越えても、離せば更新が走る（回帰）', () => {
    const { onRefresh, container } = setup();

    act(() => {
      firePointer(container, 'pointerdown', 1, 0);
      // しきい値の手前と先を行き来させ、状態が何度も変わる状況を作る。
      firePointer(container, 'pointermove', 1, NOT_ENOUGH);
      firePointer(container, 'pointermove', 1, ENOUGH);
      firePointer(container, 'pointermove', 1, ENOUGH + 40);
      firePointer(container, 'pointerup', 1, ENOUGH + 40);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
