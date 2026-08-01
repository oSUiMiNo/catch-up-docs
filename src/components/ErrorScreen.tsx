/**
 * SCR-08 エラー（13章）。
 *
 * 分類済みのエラーコードと、次に取れる操作だけを出す。
 * HTTPレスポンス本文や例外の詳細はここへ流さない（SEC-003）。
 */

import { useApp } from '../app/AppProvider';
import { Notice } from './ui';

export function ErrorScreen(): React.JSX.Element {
  const { state, actions } = useApp();
  const error = state.error;

  return (
    <div className="app-shell">
      <div className="centered-screen">
        <Notice tone="error" title={error?.message ?? '問題が発生しました'}>
          <div className="stack">
            <span>{error?.action ?? 'もう一度お試しください。'}</span>
            {error !== undefined && error !== null && (
              <span className="hint">エラーコード：{error.code}</span>
            )}
          </div>
        </Notice>

        <div className="row">
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              actions.clearError();
              void actions.sync();
              actions.goTo('dashboard');
            }}
          >
            再試行
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              actions.clearError();
              actions.goTo('settings');
            }}
          >
            設定を確認
          </button>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => {
              void actions.lock();
            }}
          >
            ロックする
          </button>
        </div>
      </div>
    </div>
  );
}
