/**
 * 主要な導線の E2E（14.5）。
 * 初期設定 → 解除 → 一覧 → 閲覧 → ロック と、通知からのディープリンク、リセット。
 */

import { expect, test } from '@playwright/test';

import {
  completeSetup,
  documentId,
  externalRequests,
  mockGitHub,
  PASSWORD,
  type DocumentFixture,
} from './helpers';

const SAMPLE: DocumentFixture = {
  path: 'documents/sample.html',
  title: 'サンプル文書',
  description: 'E2E で表示する文書',
  tags: ['テスト'],
  html: `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><title>サンプル文書</title></head>
<body><h1 id="heading">サンプルの見出し</h1><p>本文のテキスト。</p></body></html>`,
};

const SECOND: DocumentFixture = {
  path: 'documents/second.html',
  title: '2件目の文書',
  description: '検索の確認に使う',
  tags: ['別のタグ'],
  addedAt: '2026-08-02T00:00:00Z',
  html: `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><title>2件目</title></head>
<body><p>2件目の本文。</p></body></html>`,
};

test.describe('初期設定から閲覧まで', () => {
  test('設定・一覧・閲覧・ロックが順に動く', async ({ page, baseURL }) => {
    const { requests } = await mockGitHub(page, { documents: [SAMPLE, SECOND] });

    await page.goto('./');

    // SCR-02 初期設定
    await expect(page.getByRole('heading', { name: '初期設定' })).toBeVisible();
    await completeSetup(page);

    // SCR-04 ダッシュボード
    await expect(page.getByRole('button', { name: /2件目の文書/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /サンプル文書/ })).toBeVisible();

    // 新着として表示される（FR-DASH-004）
    await expect(page.getByText('新着').first()).toBeVisible();

    // 検索で絞り込める（FR-DASH-002）
    await page.getByLabel('文書を検索').fill('2件目');
    await expect(page.getByRole('button', { name: /2件目の文書/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /サンプル文書/ })).toHaveCount(0);
    await page.getByLabel('文書を検索').fill('');

    // SCR-05 ビューア
    await page.getByRole('button', { name: /サンプル文書/ }).click();
    const frame = page.frameLocator('iframe.viewer-frame');
    await expect(frame.locator('#heading')).toHaveText('サンプルの見出し');

    // 戻ると既読になっている
    await page.getByRole('button', { name: '← 戻る' }).click();
    await expect(page.getByRole('button', { name: 'サンプル文書' })).toBeVisible();

    // 文書起因の外部通信が無いこと
    expect(externalRequests(requests, baseURL ?? '')).toEqual([]);

    // ロックすると入力画面へ戻る（FR-AUTH-006）
    await page.getByRole('button', { name: 'ロック' }).click();
    await expect(page.getByLabel('アプリ専用パスワード')).toBeVisible();
  });

  test('ロック後に再読み込みしても一覧を表示しない（AC-005）', async ({ page }) => {
    await mockGitHub(page, { documents: [SAMPLE] });

    await page.goto('./');
    await completeSetup(page);
    await expect(page.getByRole('button', { name: /サンプル文書/ })).toBeVisible();

    await page.getByRole('button', { name: 'ロック' }).click();
    await page.reload();

    await expect(page.getByLabel('アプリ専用パスワード')).toBeVisible();
    await expect(page.getByText('サンプル文書')).toHaveCount(0);
  });

  test('パスワードで再開できる', async ({ page }) => {
    await mockGitHub(page, { documents: [SAMPLE] });

    await page.goto('./');
    await completeSetup(page);
    await page.getByRole('button', { name: 'ロック' }).click();

    await page.getByLabel('アプリ専用パスワード').fill(PASSWORD);
    await page.getByRole('button', { name: '解除する' }).click();

    await expect(page.getByRole('button', { name: /サンプル文書/ })).toBeVisible();
  });

  test('誤ったパスワードでは解除できず、文書情報も出ない', async ({ page }) => {
    await mockGitHub(page, { documents: [SAMPLE] });

    await page.goto('./');
    await completeSetup(page);
    await page.getByRole('button', { name: 'ロック' }).click();

    await page.getByLabel('アプリ専用パスワード').fill('まちがったパスワード');
    await page.getByRole('button', { name: '解除する' }).click();

    await expect(page.getByText('パスワードが正しくありません')).toBeVisible();
    await expect(page.getByText('サンプル文書')).toHaveCount(0);
  });
});

test.describe('通知からのディープリンク（FR-PUSH-008）', () => {
  test('ロック中に届いた宛先を解除後に開く', async ({ page }) => {
    await mockGitHub(page, { documents: [SAMPLE] });

    await page.goto('./');
    await completeSetup(page);
    await expect(page.getByRole('button', { name: /サンプル文書/ })).toBeVisible();
    await page.getByRole('button', { name: 'ロック' }).click();

    // 通知のリンクで開き直す。
    await page.goto(`./?open=${documentId(SAMPLE.path)}`);

    // ロック中は文書を出さない。
    await expect(page.getByLabel('アプリ専用パスワード')).toBeVisible();
    await expect(page.getByText('サンプルの見出し')).toHaveCount(0);

    await page.getByLabel('アプリ専用パスワード').fill(PASSWORD);
    await page.getByRole('button', { name: '解除する' }).click();

    // 解除後に対象の文書が開く。
    const frame = page.frameLocator('iframe.viewer-frame');
    await expect(frame.locator('#heading')).toHaveText('サンプルの見出し');
  });

  test('存在しない id ならダッシュボードを開く', async ({ page }) => {
    await mockGitHub(page, { documents: [SAMPLE] });

    await page.goto('./');
    await completeSetup(page);
    await page.getByRole('button', { name: 'ロック' }).click();

    await page.goto('./?open=doc_ffffffffffffffff');
    await page.getByLabel('アプリ専用パスワード').fill(PASSWORD);
    await page.getByRole('button', { name: '解除する' }).click();

    await expect(page.getByLabel('文書を検索')).toBeVisible();
  });
});

test.describe('エラー処理', () => {
  test('ハッシュが合わない文書は本文を表示しない（AC-015）', async ({ page }) => {
    await mockGitHub(page, { documents: [SAMPLE], corruptDocument: true });

    await page.goto('./');
    await completeSetup(page);
    await page.getByRole('button', { name: /サンプル文書/ }).click();

    await expect(page.getByText('文書の完全性を確認できません')).toBeVisible();
    await expect(page.locator('iframe.viewer-frame')).toHaveCount(0);
  });

  test('401 なら認証の更新を促す（AC-016）', async ({ page }) => {
    await mockGitHub(page, { documents: [SAMPLE], manifestStatus: 401 });

    await page.goto('./');
    await page.getByLabel('アプリ専用パスワード').fill(PASSWORD);
    await page.getByLabel('もう一度入力').fill(PASSWORD);
    await page.getByRole('button', { name: '次へ' }).click();
    await page.getByLabel('GitHubのオーナー名').fill('example-owner');
    await page.getByLabel('リポジトリ名').fill('example-docs');
    await page.getByRole('button', { name: '次へ' }).click();
    await page.getByLabel('Fine-grained personal access token').fill('invalid-token');
    await page.getByRole('button', { name: '接続テスト' }).click();

    await expect(page.getByText('GitHub認証を更新してください')).toBeVisible();
    // 接続テストが通らないと保存できない（FR-SETUP-006）。
    await expect(page.getByRole('button', { name: '設定を保存して開始' })).toBeDisabled();
  });
});

test.describe('設定画面（AC-020）', () => {
  test('リセットすると初期設定へ戻る', async ({ page }) => {
    await mockGitHub(page, { documents: [SAMPLE] });

    await page.goto('./');
    await completeSetup(page);
    await page.getByRole('button', { name: '設定' }).click();

    await expect(page.getByRole('heading', { name: '状態' })).toBeVisible();

    await page.getByRole('button', { name: 'アプリをリセット' }).click();
    await page.getByRole('button', { name: '削除する' }).click();

    await expect(page.getByRole('heading', { name: '初期設定' })).toBeVisible();
  });

  test('診断情報にトークンやリポジトリ名が含まれない（FR-SETTINGS-003）', async ({ page }) => {
    await mockGitHub(page, { documents: [SAMPLE] });

    await page.goto('./');
    await completeSetup(page);
    await page.getByRole('button', { name: '設定' }).click();

    const diagnostics = await page.locator('pre.diagnostics').first().innerText();
    expect(diagnostics).not.toContain('e2e-token-value');
    expect(diagnostics).not.toContain('example-docs');
    expect(diagnostics).not.toContain('サンプル文書');
  });
});
