/**
 * SCR-02 初期設定ウィザード（10.3）。
 *
 * 3ステップに分ける。1画面へ詰め込むと、GitHubのパスワードと取り違えたり
 * PATの権限を間違えたまま進んでしまう。
 *
 * ページを再読み込みすると PAT の平文は保持しない。
 */

import { useState } from 'react';

import { validatePassword } from '../auth/vault';
import { PASSWORD_MIN_LENGTH } from '../config/constants';
import { useApp } from '../app/AppProvider';
import { deriveOwnerFromPublicUrl } from '../config/runtimeConfig';
import { appConfigDefaults, type AppConfig } from '../storage/appConfig';
import { AppError } from '../github/errors';
import { Notice, Spinner, TextField } from './ui';

type Step = 1 | 2 | 3;

/** パスワードの強さを大まかに示す（FR-SETUP-003）。 */
function describeStrength(password: string): { label: string; level: number } {
  if (password.length === 0) {
    return { label: '未入力', level: 0 };
  }

  let score = 0;
  if (password.length >= 12) {
    score += 1;
  }
  if (password.length >= 20) {
    score += 1;
  }
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) {
    score += 1;
  }
  if (/\d/.test(password)) {
    score += 1;
  }
  if (/[^\p{L}\p{N}]/u.test(password)) {
    score += 1;
  }

  const labels = ['とても短い', '弱い', 'ふつう', 'やや強い', '強い', 'とても強い'];
  return { label: labels[score] ?? 'ふつう', level: score };
}

export function SetupWizard(): React.JSX.Element {
  const { state, actions } = useApp();

  // 公開URLから導けるものは既定値として埋め、利用者に打たせない。
  const derivedOwner = deriveOwnerFromPublicUrl(state.runtimeConfig?.publicBaseUrl ?? '');

  const [step, setStep] = useState<Step>(1);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [owner, setOwner] = useState(derivedOwner);
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState<string>(appConfigDefaults.branch);
  const [manifestPath, setManifestPath] = useState<string>(appConfigDefaults.manifestPath);
  const [token, setToken] = useState('');
  // ブランチと文書一覧の場所は、通常は触る必要がない。既定値で隠しておく。
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const strength = describeStrength(password);
  const passwordErrors = validatePassword(password);
  const passwordsMatch = password.length > 0 && password === passwordConfirm;
  const canLeaveStep1 = passwordErrors.length === 0 && passwordsMatch;
  const canLeaveStep2 =
    owner.trim().length > 0 && repo.trim().length > 0 && branch.trim().length > 0;

  const buildConfig = (): AppConfig => ({
    owner: owner.trim(),
    repo: repo.trim(),
    branch: branch.trim(),
    manifestPath: manifestPath.trim(),
    personalAccessToken: token,
  });

  const runConnectionTest = async (): Promise<void> => {
    setTesting(true);
    setMessage(null);
    try {
      await actions.verifyConnection(buildConfig());
      setTested(true);
      setMessage('接続できました。文書一覧の形式も確認できています。');
    } catch (error) {
      setTested(false);
      setMessage(
        error instanceof AppError
          ? `${error.describe().message}：${error.describe().action}`
          : '接続できませんでした。入力内容と通信環境を確認してください。',
      );
    } finally {
      setTesting(false);
    }
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setMessage(null);
    try {
      await actions.completeSetup(password, buildConfig());
    } catch (error) {
      setMessage(
        error instanceof AppError
          ? `${error.describe().message}：${error.describe().action}`
          : '設定を保存できませんでした。',
      );
      setSaving(false);
    }
  };

  return (
    <div className="app-shell">
      <div className="centered-screen">
        <div className="stack">
          <h1>初期設定</h1>
          <p className="muted" aria-live="polite">
            ステップ {step} / 3
          </p>
        </div>

        {step === 1 && (
          <div className="card stack">
            <h2>アプリ専用パスワードを決める</h2>
            <p className="muted">
              この端末でこのアプリを開くためだけのパスワードです。GitHubのパスワードではありません。
            </p>
            <Notice tone="info">
              忘れると復旧できません。アプリをリセットして、GitHubのトークンから設定し直すことになります。
            </Notice>

            <TextField
              label="アプリ専用パスワード"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              hint={`${String(PASSWORD_MIN_LENGTH)}文字以上。前後の空白も一部として扱います。`}
            />
            <p className="hint">
              強さ：{strength.label}（{String(strength.level)} / 5）
            </p>

            <TextField
              label="もう一度入力"
              type="password"
              value={passwordConfirm}
              onChange={setPasswordConfirm}
              autoComplete="new-password"
            />

            {password.length > 0 && passwordErrors.length > 0 && (
              <Notice tone="error">{passwordErrors.join(' / ')}</Notice>
            )}
            {passwordConfirm.length > 0 && !passwordsMatch && (
              <Notice tone="error">2つの入力が一致していません。</Notice>
            )}

            <button
              type="button"
              className="button button--primary"
              disabled={!canLeaveStep1}
              onClick={() => {
                setStep(2);
              }}
            >
              次へ
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="card stack">
            <h2>文書リポジトリを指定する</h2>
            <p className="muted">閲覧したいHTMLを置いてある、非公開リポジトリの名前を入れます。</p>

            <TextField
              label="リポジトリ名"
              value={repo}
              onChange={setRepo}
              placeholder="例：my-private-docs"
              autoComplete="off"
              hint="この名前はアプリの外に出ません。端末の中で暗号化して保存します。"
            />

            <TextField
              label="GitHubのオーナー名"
              value={owner}
              onChange={setOwner}
              placeholder="例：your-account"
              autoComplete="off"
              hint={
                derivedOwner.length > 0
                  ? '公開URLから自動で入れています。違う場合だけ直してください。'
                  : undefined
              }
            />

            {/* 通常は触る必要がないため畳んでおく。変えられる余地は残す。 */}
            <details
              open={advancedOpen}
              onToggle={(event) => {
                setAdvancedOpen(event.currentTarget.open);
              }}
            >
              <summary className="disclosure">詳細設定</summary>
              <div className="stack" style={{ marginTop: 'var(--space-3)' }}>
                <p className="hint">
                  通常は変更しません。ブランチを分けている場合や、文書一覧の置き場所を変えた場合だけ使います。
                </p>
                <TextField
                  label="ブランチ名"
                  value={branch}
                  onChange={setBranch}
                  autoComplete="off"
                />
                <TextField
                  label="文書一覧ファイルの場所"
                  value={manifestPath}
                  onChange={setManifestPath}
                  autoComplete="off"
                />
              </div>
            </details>

            <div className="row">
              <button
                type="button"
                className="button"
                onClick={() => {
                  setStep(1);
                }}
              >
                戻る
              </button>
              <button
                type="button"
                className="button button--primary"
                disabled={!canLeaveStep2}
                onClick={() => {
                  setStep(3);
                }}
              >
                次へ
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="card stack">
            <h2>アクセストークンを入力する</h2>
            <p className="muted">
              GitHubの Fine-grained personal access token
              を使います。対象は先ほどのリポジトリ1つだけ、権限は Contents の Read-only
              だけで足ります。
            </p>
            <Notice tone="info">
              GitHubアカウントのパスワードは入力しません。トークンはこの端末の中で暗号化して保存され、外部へは送信されません。
            </Notice>

            <TextField
              label="Fine-grained personal access token"
              type="password"
              value={token}
              onChange={(value) => {
                setToken(value);
                setTested(false);
              }}
              autoComplete="off"
              placeholder="github_pat_ で始まる文字列"
            />

            <button
              type="button"
              className="button"
              disabled={testing || token.length === 0}
              onClick={() => {
                void runConnectionTest();
              }}
            >
              接続テスト
            </button>

            {testing && <Spinner label="接続を確認しています…" />}
            {message !== null && <Notice tone={tested ? 'info' : 'error'}>{message}</Notice>}

            <div className="row">
              <button
                type="button"
                className="button"
                onClick={() => {
                  setStep(2);
                }}
              >
                戻る
              </button>
              <button
                type="button"
                className="button button--primary"
                disabled={!tested || saving}
                onClick={() => {
                  void save();
                }}
              >
                {saving ? '保存しています…' : '設定を保存して開始'}
              </button>
            </div>
            {!tested && <p className="hint">接続テストに成功すると保存できるようになります。</p>}
          </div>
        )}
      </div>
    </div>
  );
}
