/**
 * ビューアの隔離を実ブラウザで確かめる（14.3 / AC-008）。
 *
 * 悪意ある HTML を文書として配ったうえで、
 * スクリプト実行・外部通信・親DOMアクセス・フォーム送信・最上位遷移が
 * いずれも起きないことを見る。
 */

import { expect, test, type Page } from '@playwright/test';

import { MALICIOUS_DOCUMENTS } from '../fixtures/maliciousDocuments';
import { completeSetup, externalRequests, mockGitHub, type DocumentFixture } from './helpers';

// Playwright は Service Worker を経由したリクエストの傍受を Chromium でしか行えない。
// Service Worker が動いていると GitHub API のモックが素通りし、実際の GitHub へ
// 飛んでしまう。ここでの関心事は Service Worker ではないため、登録自体を止める。
// Service Worker の挙動は pwa.spec.ts が実物のまま検証している。
test.use({ serviceWorkers: 'block' });

function fixture(name: string, html: string): DocumentFixture {
  return { path: `documents/${name}.html`, title: name, html };
}

const DOCUMENTS: DocumentFixture[] = [
  fixture('inline-script', MALICIOUS_DOCUMENTS.inlineScript),
  fixture('on-error', MALICIOUS_DOCUMENTS.onErrorHandler),
  fixture('parent-access', MALICIOUS_DOCUMENTS.parentAccess),
  fixture('external-image', MALICIOUS_DOCUMENTS.externalImage),
  fixture('external-css', MALICIOUS_DOCUMENTS.externalStylesheet),
  fixture('form', MALICIOUS_DOCUMENTS.formSubmission),
  fixture('top-navigation', MALICIOUS_DOCUMENTS.topNavigation),
  fixture('javascript-url', MALICIOUS_DOCUMENTS.javascriptUrl),
  fixture('nested-frames', MALICIOUS_DOCUMENTS.nestedFrames),
];

async function openDocument(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(title) }).click();
  await expect(page.locator('iframe.viewer-frame')).toBeVisible();
}

test.describe('悪意あるHTMLの隔離', () => {
  test('script が実行されない', async ({ page }) => {
    await mockGitHub(page, { documents: DOCUMENTS });
    await page.goto('./');
    await completeSetup(page);
    await openDocument(page, 'inline-script');

    const frame = page.frameLocator('iframe.viewer-frame');
    // script が動いていれば 'script-executed' に書き換わる。
    await expect(frame.locator('#marker')).toHaveText('before');
  });

  test('親のDOMが書き換えられない', async ({ page }) => {
    await mockGitHub(page, { documents: DOCUMENTS });
    await page.goto('./');
    await completeSetup(page);

    const titleBefore = await page.title();
    await openDocument(page, 'parent-access');

    await expect(page).toHaveTitle(titleBefore);
    expect(await page.title()).not.toBe('leaked');
  });

  test('最上位のURLが変わらない', async ({ page }) => {
    await mockGitHub(page, { documents: DOCUMENTS });
    await page.goto('./');
    await completeSetup(page);

    const urlBefore = page.url();
    await openDocument(page, 'top-navigation');
    await page.waitForTimeout(500);

    expect(page.url()).toBe(urlBefore);
  });

  test('外部の画像を取得しない', async ({ page, baseURL }) => {
    const { requests } = await mockGitHub(page, { documents: DOCUMENTS });
    await page.goto('./');
    await completeSetup(page);
    await openDocument(page, 'external-image');
    await page.waitForTimeout(500);

    expect(requests.filter((url) => url.includes('attacker.example'))).toEqual([]);
    expect(externalRequests(requests, baseURL ?? '')).toEqual([]);
  });

  test('外部のスタイルシートを取得しない', async ({ page, baseURL }) => {
    const { requests } = await mockGitHub(page, { documents: DOCUMENTS });
    await page.goto('./');
    await completeSetup(page);
    await openDocument(page, 'external-css');
    await page.waitForTimeout(500);

    expect(requests.filter((url) => url.includes('attacker.example'))).toEqual([]);
    expect(externalRequests(requests, baseURL ?? '')).toEqual([]);
  });

  test('フォームが残らない', async ({ page }) => {
    await mockGitHub(page, { documents: DOCUMENTS });
    await page.goto('./');
    await completeSetup(page);
    await openDocument(page, 'form');

    const frame = page.frameLocator('iframe.viewer-frame');
    await expect(frame.locator('form')).toHaveCount(0);
  });

  test('javascript: の URL が残らない', async ({ page }) => {
    await mockGitHub(page, { documents: DOCUMENTS });
    await page.goto('./');
    await completeSetup(page);
    await openDocument(page, 'javascript-url');

    const frame = page.frameLocator('iframe.viewer-frame');
    await expect(frame.locator('#jsurl')).not.toHaveAttribute('href', /javascript:/);
  });

  test('入れ子の iframe や object が残らない', async ({ page }) => {
    await mockGitHub(page, { documents: DOCUMENTS });
    await page.goto('./');
    await completeSetup(page);
    await openDocument(page, 'nested-frames');

    const frame = page.frameLocator('iframe.viewer-frame');
    await expect(frame.locator('iframe')).toHaveCount(0);
    await expect(frame.locator('object')).toHaveCount(0);
    await expect(frame.locator('embed')).toHaveCount(0);
  });

  test('イベント属性が残らない', async ({ page }) => {
    await mockGitHub(page, { documents: DOCUMENTS });
    await page.goto('./');
    await completeSetup(page);
    await openDocument(page, 'on-error');

    const frame = page.frameLocator('iframe.viewer-frame');
    await expect(frame.locator('[onerror]')).toHaveCount(0);
    await expect(frame.locator('[onclick]')).toHaveCount(0);
  });

  test('iframe が完全なサンドボックスで動く', async ({ page }) => {
    await mockGitHub(page, { documents: DOCUMENTS });
    await page.goto('./');
    await completeSetup(page);
    await openDocument(page, 'inline-script');

    const sandbox = await page.locator('iframe.viewer-frame').getAttribute('sandbox');
    expect(sandbox).toBe('');

    const referrerPolicy = await page.locator('iframe.viewer-frame').getAttribute('referrerpolicy');
    expect(referrerPolicy).toBe('no-referrer');
  });

  test('ビューアを閉じると本文が残らない（FR-VIEW-007）', async ({ page }) => {
    await mockGitHub(page, { documents: DOCUMENTS });
    await page.goto('./');
    await completeSetup(page);
    await openDocument(page, 'inline-script');

    await page.getByRole('button', { name: '← 戻る' }).click();
    await expect(page.locator('iframe.viewer-frame')).toHaveCount(0);
  });
});
