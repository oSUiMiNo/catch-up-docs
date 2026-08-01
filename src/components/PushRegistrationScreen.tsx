/**
 * SCR-07 通知登録（7.7）。
 *
 * アプリは Private Repository へ書き込まない。ここで作った登録JSONを
 * 利用者がワークフローの実行画面へ貼り付ける。この一手間により、
 * アクセストークンを読み取り専用のままにできる（FR-PUSH-004）。
 */

import { useEffect, useState } from 'react';

import { useApp } from '../app/AppProvider';
import { buildWorkflowDispatchUrl } from '../config/runtimeConfig';
import { describeErrorCode } from '../github/errors';
import {
  createPushRegistration,
  detectPushSupport,
  isStandaloneDisplay,
  type PushSupport,
} from '../push/subscribe';
import { Notice, TextField } from './ui';

function describeUnsupported(support: Extract<PushSupport, { supported: false }>): {
  title: string;
  body: string;
} {
  switch (support.reason) {
    case 'needs-home-screen':
      return {
        title: 'ホーム画面へ追加してください',
        body: 'iPhoneやiPadでは、共有メニューから「ホーム画面に追加」を行い、そこから起動した場合にだけ通知を使えます。',
      };
    case 'no-service-worker':
    case 'no-push-manager':
    case 'no-notification':
    default:
      return {
        title: describeErrorCode('E-PUSH-001').message,
        body: 'このブラウザは通知に対応していません。別のブラウザで開くか、ホーム画面へ追加してからお試しください。',
      };
  }
}

export function PushRegistrationScreen(): React.JSX.Element {
  const { state, actions } = useApp();

  const [support, setSupport] = useState<PushSupport>({ supported: true });
  const [label, setLabel] = useState('');
  const [registrationJson, setRegistrationJson] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSupport(detectPushSupport());
  }, []);

  const connection = actions.describeConnection();
  const vapidPublicKey = state.runtimeConfig?.vapidPublicKey ?? '';

  const registerWorkflowUrl =
    connection && state.runtimeConfig
      ? buildWorkflowDispatchUrl(
          connection.owner,
          connection.repo,
          state.runtimeConfig.workflowFiles.registerPushDevice,
        )
      : null;

  const enable = async (): Promise<void> => {
    setBusy(true);
    setErrorMessage(null);
    setMessage(null);

    try {
      const registration = await createPushRegistration(vapidPublicKey, label.trim());
      setRegistrationJson(JSON.stringify(registration, null, 2));
      setMessage('購読を作成しました。下のJSONをコピーして登録ワークフローへ貼り付けてください。');
    } catch (error) {
      if (error instanceof Error && error.message === 'notification-denied') {
        setErrorMessage(
          `${describeErrorCode('E-PUSH-002').message}：${describeErrorCode('E-PUSH-002').action}`,
        );
      } else {
        setErrorMessage('通知の購読を作成できませんでした。時間をおいて再試行してください。');
      }
    } finally {
      setBusy(false);
    }
  };

  const copyJson = async (): Promise<void> => {
    if (registrationJson === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(registrationJson);
      setMessage('登録JSONをコピーしました。');
    } catch {
      setErrorMessage('コピーできませんでした。テキストを選択して手動でコピーしてください。');
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => {
              actions.goTo('settings');
            }}
          >
            ← 戻る
          </button>
          <strong>通知の設定</strong>
          <span />
        </div>
      </header>

      <main className="centered-screen" style={{ maxWidth: '40rem' }}>
        <Notice tone="info" title="通知に含まれる情報">
          通知には「新しいドキュメントが追加されました」とだけ表示されます。文書の題名やファイル名、リポジトリ名は含まれません。
        </Notice>

        {!support.supported && (
          <Notice tone="error" title={describeUnsupported(support).title}>
            {describeUnsupported(support).body}
          </Notice>
        )}

        {support.supported && vapidPublicKey.length === 0 && (
          <Notice tone="error" title="通知の設定が未完了です">
            アプリ側の設定に通知用の公開鍵が入っていません。セットアップ手順を完了してください。
          </Notice>
        )}

        {!isStandaloneDisplay() && (
          <Notice tone="info" title="ホーム画面から起動していません">
            通常のブラウザタブでも閲覧はできますが、iPhoneやiPadで通知を受け取るにはホーム画面へ追加してから起動する必要があります。
          </Notice>
        )}

        <section className="card stack">
          <h2>1. この端末の名前を決める</h2>
          <TextField
            label="端末名"
            value={label}
            onChange={setLabel}
            placeholder="例：Pixel、iPhone"
            hint="どの端末の登録かを見分けるためだけに使います。"
          />

          <h2>2. 通知を有効にする</h2>
          <button
            type="button"
            className="button button--primary"
            disabled={
              !support.supported || busy || label.trim().length === 0 || vapidPublicKey.length === 0
            }
            onClick={() => {
              void enable();
            }}
          >
            {busy ? '準備しています…' : '通知を有効にする'}
          </button>
          <p className="hint">押したときにだけ、ブラウザの許可ダイアログが出ます。</p>
        </section>

        {message !== null && <Notice tone="info">{message}</Notice>}
        {errorMessage !== null && <Notice tone="error">{errorMessage}</Notice>}

        {registrationJson !== null && (
          <section className="card stack">
            <h2>3. 登録ワークフローへ貼り付ける</h2>
            <pre className="diagnostics">{registrationJson}</pre>
            <div className="row">
              <button
                type="button"
                className="button"
                onClick={() => {
                  void copyJson();
                }}
              >
                登録JSONをコピー
              </button>
              {registerWorkflowUrl !== null && (
                <a
                  className="button button--primary"
                  href={registerWorkflowUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  登録ワークフローを開く
                </a>
              )}
            </div>
            <p className="hint">
              ワークフローの実行画面で、端末名とこのJSONを貼り付けて実行してください。登録できるのは5台までです。
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
