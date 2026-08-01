/**
 * SCR-01 起動判定。
 *
 * 設定の読み込みとセッションの復元が終わるまでの表示。
 * ここでは文書に関する情報を一切出さない。
 */

import { Spinner } from './ui';

export function StartupScreen(): React.JSX.Element {
  return (
    <div className="app-shell">
      <div className="centered-screen" style={{ alignItems: 'center', textAlign: 'center' }}>
        <img
          src={`${__BASE_PATH__}icons/icon-192.png`}
          alt=""
          width={96}
          height={96}
          style={{ borderRadius: 'var(--radius-lg)' }}
        />
        <Spinner label="準備しています…" />
      </div>
    </div>
  );
}
