import { useEffect, useState } from 'react';

import { loadRuntimeConfig, type RuntimeConfig } from '../config/runtimeConfig';

type BootState =
  | { status: 'loading' }
  | { status: 'ready'; config: RuntimeConfig }
  | { status: 'error'; message: string };

/**
 * SCR-01 起動判定。
 * 現時点では公開設定の読み込みだけを行う。以降のフェーズでロック判定と
 * ルーティングを接続する。
 */
export function App(): React.JSX.Element {
  const [state, setState] = useState<BootState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    void loadRuntimeConfig()
      .then((config) => {
        if (!cancelled) {
          setState({ status: 'ready', config });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: 'error', message: 'アプリ設定を読み込めませんでした' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="app-shell">
        <div className="centered-screen" role="status" aria-live="polite">
          <div className="spinner" aria-hidden="true" />
          <p>読み込んでいます…</p>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="app-shell">
        <div className="centered-screen">
          <div className="notice notice--error">
            <h1>起動できません</h1>
            <p>{state.message}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="centered-screen">
        <h1>{state.config.appName}</h1>
        <p className="muted">初期化しました。</p>
      </div>
    </div>
  );
}
