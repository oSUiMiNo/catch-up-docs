/**
 * PWA として成立しているかの確認（14.5）。
 *
 * Lighthouse を持ち込まず、インストール可能性の条件を個別に検証する。
 * 何が欠けているかが直接わかるため、壊れたときに原因を追いやすい。
 */

import { expect, test } from '@playwright/test';

test.describe('PWA の条件', () => {
  test('Web App Manifest が必要な項目を持つ', async ({ page, request }) => {
    await page.goto('./');

    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();

    const response = await request.get(new URL(href ?? '', page.url()).toString());
    expect(response.status()).toBe(200);

    const manifest = (await response.json()) as {
      name?: string;
      short_name?: string;
      start_url?: string;
      scope?: string;
      display?: string;
      lang?: string;
      icons?: { src: string; sizes: string; purpose?: string }[];
    };

    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.scope).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    expect(manifest.lang).toBe('ja');

    const sizes = (manifest.icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');

    const maskable = (manifest.icons ?? []).filter((icon) => icon.purpose === 'maskable');
    expect(maskable.length).toBeGreaterThan(0);
  });

  test('アイコンが実際に取得できる', async ({ page, request }) => {
    await page.goto('./');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    const manifestUrl = new URL(href ?? '', page.url()).toString();
    const manifest = (await (await request.get(manifestUrl)).json()) as {
      icons?: { src: string }[];
    };

    for (const icon of manifest.icons ?? []) {
      const iconResponse = await request.get(new URL(icon.src, manifestUrl).toString());
      expect(iconResponse.status(), `${icon.src} が取得できません`).toBe(200);
    }
  });

  test('Service Worker が登録され、ページを制御する', async ({ page }) => {
    await page.goto('./');

    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 20_000,
    });

    const state = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.active?.state ?? 'none';
    });
    expect(state).toBe('activated');
  });

  test('アプリシェルの CSP が外部の読み込みを許していない（FR-PWA-004）', async ({ page }) => {
    await page.goto('./');

    const csp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');

    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain('connect-src');
    expect(csp).toContain('https://api.github.com');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");

    // frame-ancestors はヘッダーでしか効かない。meta へ書くと無視されて
    // コンソールにエラーが出るため、含めないことを固定する。
    expect(csp).not.toContain('frame-ancestors');

    // 外部CDNやフォントの読み込みを許す記述が無いこと。
    expect(csp).not.toMatch(/https:\/\/(?!api\.github\.com)/);
  });

  test('起動時にコンソールエラーが出ない（SEC-003）', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    await page.goto('./');
    await expect(page.getByRole('heading', { name: '初期設定' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('オフライン用のページが用意されている（FR-PWA-003）', async ({ page, request }) => {
    await page.goto('./');
    const response = await request.get(new URL('offline.html', page.url()).toString());
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('インターネット接続が必要です');
  });

  test('公開資産に文書やトークンが含まれない（AC-002）', async ({ page, request }) => {
    // 文書リポジトリ名はこのリポジトリへ書かない。CI では Secret から渡す。
    const privateRepoName = process.env.PRIVATE_DOCS_REPO_NAME?.trim();
    const patPrefix = `${'github'}_${'pat'}_`;

    await page.goto('./');
    const html = await page.content();

    expect(html).not.toContain(patPrefix);
    if (privateRepoName) {
      expect(html).not.toContain(privateRepoName);
    }

    const runtimeConfig = await (
      await request.get(new URL('runtime-config.json', page.url()).toString())
    ).text();
    expect(runtimeConfig).not.toContain(patPrefix);
    if (privateRepoName) {
      expect(runtimeConfig).not.toContain(privateRepoName);
    }
  });
});
