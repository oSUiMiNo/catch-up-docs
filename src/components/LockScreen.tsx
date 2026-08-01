/**
 * SCR-03 ロック解除（10.4）。
 *
 * ロック中は文書タイトル、manifest、リポジトリ名、PAT、未読情報を一切出さない
 * （FR-AUTH-004）。表示してよいのはアプリ名と入力欄だけ。
 */

import { useEffect, useRef, useState } from 'react';

import { UnlockError } from '../auth/vault';
import { useApp } from '../app/AppProvider';
import { ConfirmDialog, Notice, TextField } from './ui';

function formatRemaining(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) {
    return `${String(seconds)}秒`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}分${String(seconds % 60)}秒`;
}

export function LockScreen(): React.JSX.Element {
  const { state, actions } = useApp();
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 待機中は残り秒数を出し続ける（10.4）。
  useEffect(() => {
    if (blockedUntil === null) {
      return;
    }
    const tick = (): void => {
      const left = blockedUntil - Date.now();
      setRemaining(Math.max(0, left));
      if (left <= 0) {
        setBlockedUntil(null);
        setMessage(null);
      }
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => {
      clearInterval(timer);
    };
  }, [blockedUntil]);

  const submit = async (): Promise<void> => {
    if (busy || blockedUntil !== null) {
      return;
    }
    setBusy(true);
    setMessage(null);

    try {
      await actions.unlock(password);
      setPassword('');
    } catch (error) {
      if (error instanceof UnlockError) {
        if (error.reason === 'blocked' || error.retryAfterMs > 0) {
          setBlockedUntil(Date.now() + error.retryAfterMs);
        }
        setMessage(
          error.reason === 'blocked'
            ? '入力の間隔を空けてください。'
            : 'パスワードが正しくありません。',
        );
      } else {
        setMessage('解除できませんでした。');
      }
      // 誤り時は入力欄を選択状態にする（10.4）。
      inputRef.current?.select();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell">
      <div className="centered-screen">
        <div className="stack">
          <h1>{state.runtimeConfig?.appName ?? 'catch-up-docs'}</h1>
          <p className="muted">続けるにはアプリ専用パスワードを入力してください。</p>
        </div>

        <div className="card stack">
          <TextField
            label="アプリ専用パスワード"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            hint="GitHubのパスワードではありません。"
            inputRef={inputRef}
            disabled={blockedUntil !== null}
            onEnter={() => {
              void submit();
            }}
          />

          {message !== null && (
            <Notice tone="error">
              {message}
              {blockedUntil !== null && remaining > 0 && (
                <> あと {formatRemaining(remaining)} 待ってください。</>
              )}
            </Notice>
          )}

          <button
            type="button"
            className="button button--primary"
            disabled={busy || password.length === 0 || blockedUntil !== null}
            onClick={() => {
              void submit();
            }}
          >
            {busy ? '確認しています…' : '解除する'}
          </button>
        </div>

        <div className="stack">
          <p className="hint">
            パスワードを忘れた場合は復旧できません。アプリをリセットして、GitHubのトークンから設定し直してください。
          </p>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => {
              setConfirmReset(true);
            }}
          >
            アプリをリセット
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="アプリをリセットしますか？"
        description="ローカル設定と認証情報をすべて削除します。文書そのものは消えませんが、パスワードとトークンを設定し直す必要があります。"
        confirmLabel="削除する"
        onConfirm={() => {
          void actions.resetApp();
        }}
        onCancel={() => {
          setConfirmReset(false);
        }}
      />
    </div>
  );
}
