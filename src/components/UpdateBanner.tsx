/**
 * 新しいバージョンが待機中であることの通知（FR-PWA-002）。
 *
 * どの画面にいても出す。ロック画面や初期設定で止まっている利用者にも
 * 更新の機会が要るため、画面ごとに置かず、アプリの外枠へ1つだけ置く。
 *
 * 自動では適用しない。適用のタイミングを利用者が選べるようにするため。
 */

import { useState } from 'react';

import { useApp } from '../app/AppProvider';

export function UpdateBanner(): React.JSX.Element | null {
  const { state, actions } = useApp();
  const [dismissed, setDismissed] = useState(false);
  const [applying, setApplying] = useState(false);

  if (!state.updateAvailable || dismissed) {
    return null;
  }

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <span>新しいバージョンがあります。</span>
      <div className="row">
        <button
          type="button"
          className="button button--primary"
          disabled={applying}
          onClick={() => {
            setApplying(true);
            // 適用後は再読み込みされる。URLへ鍵やセッションを載せない。
            void actions.applyUpdate();
          }}
        >
          {applying ? '更新しています…' : '更新する'}
        </button>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => {
            setDismissed(true);
          }}
        >
          あとで
        </button>
      </div>
    </div>
  );
}
