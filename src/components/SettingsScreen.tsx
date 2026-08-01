/**
 * SCR-06 設定・保守（7.10）。
 *
 * 表示するのは運用に必要な最小限。PAT、パスワード、master key、
 * Push の endpoint と鍵は決して出さない。リポジトリ名は既定でマスクする。
 */

import { useCallback, useEffect, useState } from 'react';

import { useApp } from '../app/AppProvider';
import { collectDiagnostics, formatDiagnostics } from '../app/diagnostics';
import { buildWorkflowDispatchUrl } from '../config/runtimeConfig';
import { AppError } from '../github/errors';
import { currentSubscriptionId, unsubscribeCurrentDevice } from '../push/subscribe';
import { appConfigDefaults, type AppConfig } from '../storage/appConfig';
import { ConfirmDialog, Notice, TextField, formatDateTime } from './ui';

function maskValue(value: string): string {
  if (value.length <= 2) {
    return '••';
  }
  return `${value.slice(0, 1)}${'•'.repeat(Math.min(value.length - 2, 8))}${value.slice(-1)}`;
}

export function SettingsScreen(): React.JSX.Element {
  const { state, actions } = useApp();

  const [revealRepository, setRevealRepository] = useState(false);
  const [diagnosticsText, setDiagnosticsText] = useState('');
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const [passwordPanelOpen, setPasswordPanelOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [nextPasswordConfirm, setNextPasswordConfirm] = useState('');

  const [githubPanelOpen, setGithubPanelOpen] = useState(false);
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState<string>(appConfigDefaults.branch);
  const [manifestPath, setManifestPath] = useState<string>(appConfigDefaults.manifestPath);
  const [token, setToken] = useState('');
  const [githubPassword, setGithubPassword] = useState('');

  const connection = actions.describeConnection();

  const refreshDiagnostics = useCallback(async () => {
    const diagnostics = await collectDiagnostics({
      lastHttpStatus: state.lastHttpStatus,
      manifestSchemaVersion: state.manifest?.schemaVersion ?? null,
      documentCount: state.manifest?.documents.length ?? null,
    });
    setDiagnosticsText(formatDiagnostics(diagnostics));
  }, [state.lastHttpStatus, state.manifest]);

  useEffect(() => {
    void refreshDiagnostics();
    void currentSubscriptionId().then(setSubscriptionId);
  }, [refreshDiagnostics]);

  useEffect(() => {
    if (githubPanelOpen && connection) {
      setOwner(connection.owner);
      setRepo(connection.repo);
      setBranch(connection.branch);
    }
    // 開いたときだけ初期化する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [githubPanelOpen]);

  const copy = async (text: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`${label}をコピーしました。`);
    } catch {
      setErrorMessage('コピーできませんでした。手動で選択してください。');
    }
  };

  const submitPasswordChange = async (): Promise<void> => {
    setErrorMessage(null);
    if (nextPassword !== nextPasswordConfirm) {
      setErrorMessage('新しいパスワードの2つの入力が一致していません。');
      return;
    }
    try {
      await actions.changePassword(currentPassword, nextPassword);
      setMessage('パスワードを変更しました。');
      setPasswordPanelOpen(false);
      setCurrentPassword('');
      setNextPassword('');
      setNextPasswordConfirm('');
    } catch {
      setErrorMessage('変更できませんでした。現在のパスワードと条件を確認してください。');
    }
  };

  const submitGithubChange = async (): Promise<void> => {
    setErrorMessage(null);
    const config: AppConfig = {
      owner: owner.trim(),
      repo: repo.trim(),
      branch: branch.trim(),
      manifestPath: manifestPath.trim(),
      personalAccessToken: token,
    };
    try {
      await actions.updateGitHubConfig(githubPassword, config);
      setMessage('GitHub設定を更新しました。');
      setGithubPanelOpen(false);
      setToken('');
      setGithubPassword('');
    } catch (error) {
      setErrorMessage(
        error instanceof AppError
          ? `${error.describe().message}：${error.describe().action}`
          : '更新できませんでした。パスワードと入力内容を確認してください。',
      );
    }
  };

  const workflowUrl = (file: string): string | null => {
    if (!connection || !state.runtimeConfig) {
      return null;
    }
    return buildWorkflowDispatchUrl(connection.owner, connection.repo, file);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => {
              actions.goTo('dashboard');
            }}
          >
            ← 戻る
          </button>
          <strong>設定</strong>
          <span />
        </div>
      </header>

      <main className="centered-screen" style={{ maxWidth: '40rem' }}>
        {message !== null && <Notice tone="info">{message}</Notice>}
        {errorMessage !== null && <Notice tone="error">{errorMessage}</Notice>}

        <section className="card stack">
          <h2>状態</h2>
          <dl className="definition-list">
            <dt>アプリのバージョン</dt>
            <dd>{__APP_VERSION__}</dd>
            <dt>ビルド元のコミット</dt>
            <dd>
              <code>{__BUILD_COMMIT_SHA__.slice(0, 12)}</code>
            </dd>
            <dt>接続先</dt>
            <dd>
              {connection
                ? revealRepository
                  ? `${connection.owner}/${connection.repo}`
                  : `${maskValue(connection.owner)}/${maskValue(connection.repo)}`
                : '未設定'}{' '}
              <button
                type="button"
                className="button button--quiet"
                onClick={() => {
                  setRevealRepository((current) => !current);
                }}
              >
                {revealRepository ? '隠す' : '表示'}
              </button>
            </dd>
            <dt>ブランチ</dt>
            <dd>{connection?.branch ?? '-'}</dd>
            <dt>最終同期</dt>
            <dd>{state.lastSyncedAt === null ? '未同期' : formatDateTime(state.lastSyncedAt)}</dd>
            <dt>次回パスワード要求</dt>
            <dd>{state.vault ? formatDateTime(state.vault.expiresAt) : '-'}</dd>
            <dt>通知の許可</dt>
            <dd>{'Notification' in window ? Notification.permission : '非対応'}</dd>
            <dt>購読 id</dt>
            <dd>{subscriptionId ?? '未登録'}</dd>
          </dl>
        </section>

        <section className="card stack">
          <h2>操作</h2>
          <div className="row">
            <button
              type="button"
              className="button"
              onClick={() => {
                void actions.sync();
              }}
              disabled={state.syncing}
            >
              今すぐ同期
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                void actions.lock();
              }}
            >
              今すぐロック
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                actions.goTo('push');
              }}
            >
              通知の設定
            </button>
          </div>
        </section>

        <section className="card stack">
          <h2>パスワードの変更</h2>
          {!passwordPanelOpen ? (
            <button
              type="button"
              className="button"
              onClick={() => {
                setPasswordPanelOpen(true);
              }}
            >
              変更する
            </button>
          ) : (
            <>
              <TextField
                label="現在のパスワード"
                type="password"
                value={currentPassword}
                onChange={setCurrentPassword}
                autoComplete="current-password"
              />
              <TextField
                label="新しいパスワード"
                type="password"
                value={nextPassword}
                onChange={setNextPassword}
                autoComplete="new-password"
              />
              <TextField
                label="新しいパスワード（確認）"
                type="password"
                value={nextPasswordConfirm}
                onChange={setNextPasswordConfirm}
                autoComplete="new-password"
              />
              <div className="row">
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setPasswordPanelOpen(false);
                  }}
                >
                  やめる
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => {
                    void submitPasswordChange();
                  }}
                >
                  変更する
                </button>
              </div>
            </>
          )}
        </section>

        <section className="card stack">
          <h2>GitHub設定とトークンの更新</h2>
          <p className="muted">変更するには現在のアプリ専用パスワードが必要です。</p>
          {!githubPanelOpen ? (
            <button
              type="button"
              className="button"
              onClick={() => {
                setGithubPanelOpen(true);
              }}
            >
              変更する
            </button>
          ) : (
            <>
              <TextField label="GitHubのオーナー名" value={owner} onChange={setOwner} />
              <TextField label="リポジトリ名" value={repo} onChange={setRepo} />
              <TextField label="ブランチ名" value={branch} onChange={setBranch} />
              <TextField
                label="文書一覧ファイルの場所"
                value={manifestPath}
                onChange={setManifestPath}
              />
              <TextField
                label="アクセストークン"
                type="password"
                value={token}
                onChange={setToken}
                hint="Contents の Read-only だけで足ります。"
              />
              <TextField
                label="現在のアプリ専用パスワード"
                type="password"
                value={githubPassword}
                onChange={setGithubPassword}
                autoComplete="current-password"
              />
              <div className="row">
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setGithubPanelOpen(false);
                  }}
                >
                  やめる
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => {
                    void submitGithubChange();
                  }}
                >
                  接続テストして保存
                </button>
              </div>
            </>
          )}
        </section>

        <section className="card stack">
          <h2>通知端末の管理</h2>
          <p className="muted">
            登録と削除は文書リポジトリのワークフローで行います。アプリはリポジトリへ書き込みません。
          </p>
          <div className="row">
            {workflowUrl(state.runtimeConfig?.workflowFiles.sendTestPush ?? '') !== null && (
              <a
                className="button"
                href={workflowUrl(state.runtimeConfig?.workflowFiles.sendTestPush ?? '') ?? '#'}
                target="_blank"
                rel="noreferrer noopener"
              >
                テスト通知を送る
              </a>
            )}
            {workflowUrl(state.runtimeConfig?.workflowFiles.removePushDevice ?? '') !== null && (
              <a
                className="button"
                href={workflowUrl(state.runtimeConfig?.workflowFiles.removePushDevice ?? '') ?? '#'}
                target="_blank"
                rel="noreferrer noopener"
              >
                登録を削除する
              </a>
            )}
            <button
              type="button"
              className="button"
              onClick={() => {
                void unsubscribeCurrentDevice().then((done) => {
                  setSubscriptionId(null);
                  setMessage(
                    done
                      ? 'この端末の購読を解除しました。リポジトリ側の削除も行ってください。'
                      : '解除する購読がありませんでした。',
                  );
                });
              }}
            >
              この端末の購読を解除
            </button>
          </div>
        </section>

        <section className="card stack">
          <h2>診断情報</h2>
          <p className="muted">トークン、パスワード、リポジトリ名、文書の内容は含まれません。</p>
          <pre className="diagnostics">{diagnosticsText}</pre>
          <div className="row">
            <button
              type="button"
              className="button"
              onClick={() => {
                void copy(diagnosticsText, '診断情報');
              }}
            >
              診断情報をコピー
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                void refreshDiagnostics();
              }}
            >
              更新
            </button>
          </div>
        </section>

        <section className="card stack">
          <h2>アプリのリセット</h2>
          <p className="muted">
            ローカル設定と認証情報をすべて削除します。文書そのものは消えません。
          </p>
          <button
            type="button"
            className="button button--danger"
            onClick={() => {
              setConfirmReset(true);
            }}
          >
            アプリをリセット
          </button>
        </section>
      </main>

      <ConfirmDialog
        open={confirmReset}
        title="アプリをリセットしますか？"
        description="ローカル設定と認証情報をすべて削除します。文書リポジトリ側の通知登録は自動では消えないため、削除ワークフローも実行してください。"
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
