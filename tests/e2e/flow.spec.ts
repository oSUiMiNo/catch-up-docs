/**
 * 主要な導線の E2E（14.5）。
 * 初期設定 → 解除 → 一覧 → 閲覧 → ロック と、通知からのディープリンク、リセット。
 */

import { expect, test } from '@playwright/test';

import {
  completeSetup,
  documentId,
  externalRequests,
  lockApp,
  mockGitHub,
  PASSWORD,
  type DocumentFixture,
} from './helpers';

// Playwright は Service Worker を経由したリクエストの傍受を Chromium でしか行えない。
// Service Worker が動いていると GitHub API のモックが素通りし、実際の GitHub へ
// 飛んでしまう。ここでの関心事は Service Worker ではないため、登録自体を止める。
// Service Worker の挙動は pwa.spec.ts が実物のまま検証している。
test.use({ serviceWorkers: 'block' });

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

    // まだ開いていない文書は「新規」として表示される（FR-DASH-004）
    await expect(page.getByText('新規').first()).toBeVisible();

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
    await lockApp(page);
  });

  test('ロック後に再読み込みしても一覧を表示しない（AC-005）', async ({ page }) => {
    await mockGitHub(page, { documents: [SAMPLE] });

    await page.goto('./');
    await completeSetup(page);
    await expect(page.getByRole('button', { name: /サンプル文書/ })).toBeVisible();

    await lockApp(page);
    await page.reload();

    await expect(page.getByLabel('アプリ専用パスワード')).toBeVisible();
    await expect(page.getByText('サンプル文書')).toHaveCount(0);
  });

  test('パスワードで再開できる', async ({ page }) => {
    await mockGitHub(page, { documents: [SAMPLE] });

    await page.goto('./');
    await completeSetup(page);
    await lockApp(page);

    await page.getByLabel('アプリ専用パスワード').fill(PASSWORD);
    await page.getByRole('button', { name: '解除する' }).click();

    await expect(page.getByRole('button', { name: /サンプル文書/ })).toBeVisible();
  });

  test('初期設定で聞くのはリポジトリ名だけにする', async ({ page }) => {
    await mockGitHub(page, { documents: [SAMPLE] });

    await page.goto('./');
    await page.getByLabel('アプリ専用パスワード').fill(PASSWORD);
    await page.getByLabel('もう一度入力').fill(PASSWORD);
    await page.getByRole('button', { name: '次へ' }).click();

    // オーナー名は公開URLから埋まっている。打ち直す必要がない。
    await expect(page.getByLabel('GitHubのオーナー名')).toHaveValue('osuimino');

    // ブランチと文書一覧の場所は、内部の決めごとなので既定では見せない。
    await expect(page.getByLabel('ブランチ名')).toBeHidden();
    await expect(page.getByLabel('文書一覧ファイルの場所')).toBeHidden();

    // 必要になったときだけ開ける。
    await page.getByText('詳細設定').click();
    await expect(page.getByLabel('ブランチ名')).toHaveValue('main');
    await expect(page.getByLabel('文書一覧ファイルの場所')).toHaveValue('.app/manifest.json');
  });

  test('500件でも一覧を検索して開ける（NFR-001）', async ({ page }) => {
    // 上限いっぱいの件数で、検索と閲覧が成り立つことを見る。
    // 描画の最適化（content-visibility）を使わない判断の裏付けでもある。
    const many: DocumentFixture[] = Array.from({ length: 500 }, (_, index) => ({
      path: `documents/bulk-${String(index).padStart(3, '0')}.html`,
      title: `まとめて追加した文書 ${String(index).padStart(3, '0')}`,
      addedAt: '2026-08-01T00:00:00Z',
      html: `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><title>bulk</title></head>
<body><p id="bulk">${String(index)}番目の本文。</p></body></html>`,
    }));

    await mockGitHub(page, { documents: many });

    await page.goto('./');
    await completeSetup(page);

    // 検索で1件まで絞れる。
    await page.getByLabel('文書を検索').fill('文書 499');
    const target = page.getByRole('button', { name: /まとめて追加した文書 499/ });
    await expect(target).toBeVisible();

    // 絞った先を開ける。
    await target.click();
    await expect(page.frameLocator('iframe.viewer-frame').locator('#bulk')).toHaveText(
      '499番目の本文。',
    );
  });

  test('誤ったパスワードでは解除できず、文書情報も出ない', async ({ page }) => {
    await mockGitHub(page, { documents: [SAMPLE] });

    await page.goto('./');
    await completeSetup(page);
    await lockApp(page);

    await page.getByLabel('アプリ専用パスワード').fill('まちがったパスワード');
    await page.getByRole('button', { name: '解除する' }).click();

    await expect(page.getByText('パスワードが正しくありません')).toBeVisible();
    await expect(page.getByText('サンプル文書')).toHaveCount(0);
  });
});

test.describe('文書内の移動', () => {
  const WITH_TOC: DocumentFixture = {
    path: 'documents/toc.html',
    title: '目次のある文書',
    html: `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><title>目次のある文書</title></head>
<body>
  <nav><a id="toclink" href="#section2">2章へ</a></nav>
  <h2 id="section1">1章</h2>
  <p style="margin-bottom: 2000px">1章の本文。</p>
  <h2 id="section2">2章</h2>
  <p id="body2">2章の本文。</p>
</body></html>`,
  };

  test('目次のリンクで文書内を移動でき、別ページへ飛ばない', async ({ page }) => {
    await mockGitHub(page, { documents: [WITH_TOC] });

    await page.goto('./');
    await completeSetup(page);
    await page.getByRole('button', { name: /目次のある文書/ }).click();

    const frame = page.frameLocator('iframe.viewer-frame');
    await expect(frame.locator('#body2')).toHaveText('2章の本文。');

    await frame.locator('#toclink').click();

    // 文書が残っていること。別ページを読み込むと本文ごと消える。
    await expect(frame.locator('#body2')).toHaveText('2章の本文。');

    // 見出しが画面内へ来ていること。
    await expect(frame.locator('#section2')).toBeInViewport();
  });
});

test.describe('未読バッジの出し分け（FR-DASH-004）', () => {
  test('新規と、読んだあとで書き換わったものを区別する', async ({ page }) => {
    // mockGitHub はこの配列を毎回のリクエストで読み直すため、
    // 中身を書き換えれば「文書が更新された」状況を作れる。
    const target: DocumentFixture = { ...SAMPLE };
    await mockGitHub(page, { documents: [target] });

    await page.goto('./');
    await completeSetup(page);

    const card = page.getByRole('button', { name: /サンプル文書/ });

    // まだ開いていないので新規。
    await expect(card).toContainText('新規');

    // 開いて戻るとバッジが消える。
    await card.click();
    await expect(page.frameLocator('iframe.viewer-frame').locator('#heading')).toBeVisible();
    await page.getByRole('button', { name: '← 戻る' }).click();
    await expect(card).not.toContainText('新規');
    await expect(card).not.toContainText('更新');

    // 中身を差し替えると contentSha256 が変わる。
    target.html = `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><title>サンプル文書</title></head>
<body><h1 id="heading">書き換えた見出し</h1><p>差し替えた本文。</p></body></html>`;

    await page.getByRole('button', { name: '今すぐ同期' }).click();

    // 一度読んでいるので、新規ではなく更新として出る。
    await expect(card).toContainText('更新');
    await expect(card).not.toContainText('新規');
  });
});

test.describe('通知の登録漏れの案内（FR-PUSH-004）', () => {
  test('通知が届かない端末には一覧で知らせ、設定画面へ送る', async ({ page, browserName }) => {
    await mockGitHub(page, { documents: [SAMPLE] });

    await page.goto('./');
    await completeSetup(page);

    const notice = page.getByText('通知を受け取る設定がまだです');

    if (browserName === 'webkit') {
      // iPhone は通常のタブでは通知そのものを使えないため、一覧では促さない。
      // 促しても解決できないことを求めることになる。案内は通知画面側にある。
      await expect(notice).toHaveCount(0);
      return;
    }

    // 許可していない端末では、通知が来ない理由が一覧から分かる。
    await expect(notice).toBeVisible();

    await page.getByRole('button', { name: '通知の設定へ' }).click();
    await expect(page.getByRole('heading', { name: '1. この端末の名前を決める' })).toBeVisible();
  });
});

test.describe('通知からのディープリンク（FR-PUSH-008）', () => {
  test('ロック中に届いた宛先を解除後に開く', async ({ page }) => {
    await mockGitHub(page, { documents: [SAMPLE] });

    await page.goto('./');
    await completeSetup(page);
    await expect(page.getByRole('button', { name: /サンプル文書/ })).toBeVisible();
    await lockApp(page);

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
    await lockApp(page);

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
    await page.getByRole('button', { name: '設定', exact: true }).click();

    await expect(page.getByRole('heading', { name: '状態' })).toBeVisible();

    await page.getByRole('button', { name: 'アプリをリセット' }).click();
    await page.getByRole('button', { name: '削除する' }).click();

    await expect(page.getByRole('heading', { name: '初期設定' })).toBeVisible();
  });

  test('GitHub設定の変更画面に現在の値が入っている', async ({ page }) => {
    await mockGitHub(page, { documents: [SAMPLE] });

    await page.goto('./');
    await completeSetup(page);
    await page.getByRole('button', { name: '設定', exact: true }).click();

    const section = page.locator('section', { hasText: 'GitHub設定とトークンの更新' });
    await section.getByRole('button', { name: '変更する' }).click();

    // 触っていない項目が既定値へ書き換わらないよう、現在の値を初期表示する。
    await expect(page.getByLabel('リポジトリ名')).toHaveValue('example-docs');
    await expect(page.getByLabel('GitHubのオーナー名')).toHaveValue('example-owner');

    await section.getByText('詳細設定').click();
    await expect(page.getByLabel('ブランチ名')).toHaveValue('main');
    await expect(page.getByLabel('文書一覧ファイルの場所')).toHaveValue('.app/manifest.json');
  });

  test('診断情報にトークンやリポジトリ名が含まれない（FR-SETTINGS-003）', async ({ page }) => {
    await mockGitHub(page, { documents: [SAMPLE] });

    await page.goto('./');
    await completeSetup(page);
    await page.getByRole('button', { name: '設定', exact: true }).click();

    const diagnostics = await page.locator('pre.diagnostics').first().innerText();
    expect(diagnostics).not.toContain('e2e-token-value');
    expect(diagnostics).not.toContain('example-docs');
    expect(diagnostics).not.toContain('サンプル文書');
  });
});
