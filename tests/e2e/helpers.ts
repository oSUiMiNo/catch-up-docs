/**
 * E2E の共通処理。
 *
 * GitHub API は Playwright の route で差し替える。実際のトークンを使わずに、
 * 初期設定から文書表示までの一連を再現できるようにする。
 */

import { createHash } from 'node:crypto';

import { expect, type Page, type Route } from '@playwright/test';

export const OWNER = 'example-owner';
export const REPO = 'example-docs';
export const BRANCH = 'main';
export const MANIFEST_PATH = '.app/manifest.json';
export const TOKEN = 'e2e-token-value';
export const PASSWORD = 'とても長いテスト用パスワード';
export const SOURCE_COMMIT_SHA = 'a'.repeat(40);

export function sha256Hex(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

export function documentId(path: string): string {
  return `doc_${sha256Hex(path).slice(0, 16)}`;
}

export interface DocumentFixture {
  path: string;
  html: string;
  title: string;
  description?: string;
  tags?: string[];
  addedAt?: string;
}

export function buildManifest(documents: DocumentFixture[]): unknown {
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-01T00:00:00Z',
    sourceCommitSha: SOURCE_COMMIT_SHA,
    documents: documents.map((document, index) => ({
      id: documentId(document.path),
      path: document.path,
      title: document.title,
      description: document.description ?? '',
      tags: document.tags ?? [],
      addedAt: document.addedAt ?? `2026-08-0${String(index + 1)}T00:00:00Z`,
      updatedAt: document.addedAt ?? `2026-08-0${String(index + 1)}T00:00:00Z`,
      sizeBytes: Buffer.byteLength(document.html, 'utf8'),
      gitBlobSha: 'b'.repeat(40),
      contentSha256: sha256Hex(document.html),
    })),
  };
}

export interface MockOptions {
  documents: DocumentFixture[];
  /** manifest の取得に対して返すステータス。省略すれば 200。 */
  manifestStatus?: number;
  /** 文書の中身を差し替える。ハッシュ不一致の検証に使う。 */
  corruptDocument?: boolean;
}

/**
 * api.github.com への通信を差し替える。
 * 併せて、差し替えた以外の外部通信が起きていないかを記録する。
 *
 * page ではなく context へ仕掛けるのが要点。Service Worker が動いているページ
 * からの通信は、ブラウザによっては Service Worker 発として扱われ、page.route
 * では捕まえられない。差し替えが外れると実際の GitHub へ飛んで失敗する。
 */
export async function mockGitHub(
  page: Page,
  options: MockOptions,
): Promise<{ requests: string[] }> {
  const requests: string[] = [];
  const context = page.context();

  context.on('request', (request) => {
    requests.push(request.url());
  });

  await context.route('https://api.github.com/**', async (route: Route) => {
    const url = new URL(route.request().url());

    if (url.pathname.endsWith(MANIFEST_PATH)) {
      if (options.manifestStatus && options.manifestStatus !== 200) {
        await route.fulfill({ status: options.manifestStatus, body: '' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildManifest(options.documents)),
      });
      return;
    }

    const matched = options.documents.find((document) =>
      url.pathname.endsWith(encodeURI(document.path)),
    );

    if (matched) {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: options.corruptDocument ? '<p>改ざんされた内容</p>' : matched.html,
      });
      return;
    }

    await route.fulfill({ status: 404, body: '' });
  });

  return { requests };
}

/**
 * 初期設定ウィザードを最後まで進め、ダッシュボードに着くまで待つ。
 *
 * 各段階で「次へ進める状態になったこと」を確かめてから進む。押せるようになるのを
 * 暗黙に待つだけだと、遅い環境で前段の非同期処理が終わらないまま次を押してしまう。
 */
export async function completeSetup(page: Page): Promise<void> {
  await page.getByLabel('アプリ専用パスワード').fill(PASSWORD);
  await page.getByLabel('もう一度入力').fill(PASSWORD);
  await page.getByRole('button', { name: '次へ' }).click();

  await page.getByLabel('GitHubのオーナー名').fill(OWNER);
  await page.getByLabel('リポジトリ名').fill(REPO);
  await page.getByRole('button', { name: '次へ' }).click();

  await page.getByLabel('Fine-grained personal access token').fill(TOKEN);
  await page.getByRole('button', { name: '接続テスト' }).click();

  // 接続テストの成功を待たずに保存を押すと、ボタンが無効なままになる。
  await expect(page.getByText('接続できました')).toBeVisible();

  await page.getByRole('button', { name: '設定を保存して開始' }).click();

  // 初期設定の完了はダッシュボードの表示で判断する。
  await expect(page.getByLabel('文書を検索')).toBeVisible();
}

/**
 * ロックして、ロック画面が出るまで待つ。
 *
 * 押しただけでは IndexedDB からセッションを消す処理が終わっていない。
 * 待たずに再読み込みすると、消える前の状態で復元されてしまう。
 */
export async function lockApp(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'ロック' }).click();
  await expect(page.getByLabel('アプリ専用パスワード')).toBeVisible();
}

/** 外部（同一オリジンと api.github.com 以外）への通信を抽出する。 */
export function externalRequests(requests: string[], baseUrl: string): string[] {
  const origin = new URL(baseUrl).origin;
  return requests.filter((url) => {
    if (url.startsWith(origin)) {
      return false;
    }
    if (url.startsWith('https://api.github.com/')) {
      return false;
    }
    // about:blank や data: は文書の内部表現なので対象外。
    return !/^(about:|data:|blob:|chrome-extension:)/.test(url);
  });
}
