/**
 * GitHub API 連携の統合テスト（14.2）。
 * MSW で api.github.com を模擬し、実際の fetch 経路を通して検証する。
 */

import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initializeVault, lockNow, restoreSession } from '@/auth/vault';
import { GITHUB_API_VERSION, SESSION_DURATION_MS } from '@/config/constants';
import {
  fetchDocument,
  fetchManifest,
  fetchRegisteredSubscriptionIds,
  testConnection,
} from '@/github/client';
import { AppError } from '@/github/errors';
import type { AppConfig } from '@/storage/appConfig';
import { destroyDatabase } from '@/storage/db';
import { buildDocumentEntry, buildManifest, SOURCE_COMMIT_SHA } from '../helpers/manifestFixture';

const CONFIG: AppConfig = {
  owner: 'example-owner',
  repo: 'example-docs',
  branch: 'main',
  manifestPath: '.app/manifest.json',
  personalAccessToken: 'test-token-value',
};

const MANIFEST_URL =
  'https://api.github.com/repos/example-owner/example-docs/contents/.app/manifest.json';
const DOCUMENT_PATH = 'documents/sample.html';
const DOCUMENT_URL = `https://api.github.com/repos/example-owner/example-docs/contents/documents/sample.html`;
const DOCUMENT_HTML =
  '<!doctype html><html><head><title>テスト</title></head><body>本文</body></html>';

const SUBSCRIPTIONS_URL =
  'https://api.github.com/repos/example-owner/example-docs/contents/.app/push-subscriptions.json';

const server = setupServer();

/** リクエストを記録して、ヘッダーと ref を検証できるようにする。 */
const requests: { url: string; headers: Record<string, string> }[] = [];

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    requests.push({
      url: request.url,
      headers: Object.fromEntries(request.headers.entries()),
    });
  });
});

afterEach(() => {
  server.resetHandlers();
  requests.length = 0;
});

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  await destroyDatabase();
});

async function manifestFixture() {
  return buildManifest([await buildDocumentEntry(DOCUMENT_PATH, DOCUMENT_HTML)]);
}

describe('manifest の取得', () => {
  it('取得して schema 検証を通す', async () => {
    const manifest = await manifestFixture();
    server.use(http.get(MANIFEST_URL, () => HttpResponse.json(manifest)));

    const result = await fetchManifest(CONFIG);
    expect(result.status).toBe('ok');
    expect(result.manifest?.documents).toHaveLength(1);
  });

  it('PAT を Authorization ヘッダーにだけ載せる（URL へは載せない）', async () => {
    server.use(http.get(MANIFEST_URL, async () => HttpResponse.json(await manifestFixture())));
    await fetchManifest(CONFIG);

    const recorded = requests[0];
    expect(recorded?.headers.authorization).toBe(`Bearer ${CONFIG.personalAccessToken}`);
    expect(recorded?.url).not.toContain(CONFIG.personalAccessToken);
  });

  it('API バージョンと raw の Accept を送る', async () => {
    server.use(http.get(MANIFEST_URL, async () => HttpResponse.json(await manifestFixture())));
    await fetchManifest(CONFIG);

    const recorded = requests[0];
    expect(recorded?.headers['x-github-api-version']).toBe(GITHUB_API_VERSION);
    expect(recorded?.headers.accept).toBe('application/vnd.github.raw+json');
  });

  it('branch を ref に使う', async () => {
    server.use(http.get(MANIFEST_URL, async () => HttpResponse.json(await manifestFixture())));
    await fetchManifest(CONFIG);
    expect(requests[0]?.url).toContain('ref=main');
  });

  it('ETag を返し、次回は If-None-Match を送る', async () => {
    server.use(
      http.get(MANIFEST_URL, async ({ request }) => {
        if (request.headers.get('If-None-Match') === '"etag-1"') {
          return new HttpResponse(null, { status: 304 });
        }
        return HttpResponse.json(await manifestFixture(), { headers: { ETag: '"etag-1"' } });
      }),
    );

    const first = await fetchManifest(CONFIG);
    expect(first.etag).toBe('"etag-1"');

    const second = await fetchManifest(CONFIG, { etag: '"etag-1"' });
    expect(second.status).toBe('not-modified');
    expect(second.manifest).toBeNull();
  });

  it('schema に合わない manifest を拒否する', async () => {
    server.use(http.get(MANIFEST_URL, () => HttpResponse.json({ schemaVersion: 99 })));
    await expect(fetchManifest(CONFIG)).rejects.toMatchObject({ code: 'E-MAN-001' });
  });

  it('JSON でない応答を拒否する', async () => {
    server.use(http.get(MANIFEST_URL, () => HttpResponse.text('not json')));
    await expect(fetchManifest(CONFIG)).rejects.toMatchObject({ code: 'E-MAN-001' });
  });
});

describe('HTTP ステータスの分類（FR-SETUP-005）', () => {
  const cases: [number, string][] = [
    [401, 'E-GH-401'],
    [403, 'E-GH-403'],
    [404, 'E-GH-404'],
    [422, 'E-GH-422'],
  ];

  for (const [status, code] of cases) {
    it(`${String(status)} を ${code} として扱う`, async () => {
      server.use(http.get(MANIFEST_URL, () => new HttpResponse(null, { status })));
      await expect(fetchManifest(CONFIG)).rejects.toMatchObject({ code });
    });
  }

  it('401 は再試行しない', async () => {
    let calls = 0;
    server.use(
      http.get(MANIFEST_URL, () => {
        calls += 1;
        return new HttpResponse(null, { status: 401 });
      }),
    );

    await expect(fetchManifest(CONFIG)).rejects.toBeInstanceOf(AppError);
    expect(calls).toBe(1);
  });

  it('5xx は再試行して、成功すれば結果を返す', async () => {
    let calls = 0;
    server.use(
      http.get(MANIFEST_URL, async () => {
        calls += 1;
        if (calls === 1) {
          return new HttpResponse(null, { status: 503 });
        }
        return HttpResponse.json(await manifestFixture());
      }),
    );

    const result = await fetchManifest(CONFIG);
    expect(result.status).toBe('ok');
    expect(calls).toBe(2);
  });

  it('5xx が続けば最大3回で諦める', async () => {
    let calls = 0;
    server.use(
      http.get(MANIFEST_URL, () => {
        calls += 1;
        return new HttpResponse(null, { status: 500 });
      }),
    );

    await expect(fetchManifest(CONFIG)).rejects.toBeInstanceOf(AppError);
    expect(calls).toBe(3);
  });
});

describe('文書の取得', () => {
  it('manifest の sourceCommitSha を ref にする（FR-GH-003）', async () => {
    const manifest = await manifestFixture();
    server.use(http.get(DOCUMENT_URL, () => HttpResponse.text(DOCUMENT_HTML)));

    await fetchDocument(CONFIG, manifest, manifest.documents[0]!);

    const documentRequest = requests.find((entry) => entry.url.includes('documents/sample.html'));
    expect(documentRequest?.url).toContain(`ref=${SOURCE_COMMIT_SHA}`);
    expect(documentRequest?.url).not.toContain('ref=main');
  });

  it('hash が一致すれば本文を返す', async () => {
    const manifest = await manifestFixture();
    server.use(http.get(DOCUMENT_URL, () => HttpResponse.text(DOCUMENT_HTML)));

    const result = await fetchDocument(CONFIG, manifest, manifest.documents[0]!);
    expect(result.html).toBe(DOCUMENT_HTML);
  });

  it('hash が一致しなければ本文を返さない（AC-015）', async () => {
    const manifest = await manifestFixture();
    server.use(http.get(DOCUMENT_URL, () => HttpResponse.text('<p>改ざんされた内容</p>')));

    await expect(fetchDocument(CONFIG, manifest, manifest.documents[0]!)).rejects.toMatchObject({
      code: 'E-DOC-001',
    });
  });

  it('日本語のファイル名を符号化して要求する', async () => {
    const path = 'documents/議事録/8月.html';
    const html = '<!doctype html><title>議事録</title>';
    const manifest = buildManifest([await buildDocumentEntry(path, html)]);

    server.use(
      http.get(
        'https://api.github.com/repos/example-owner/example-docs/contents/documents/:dir/:file',
        () => HttpResponse.text(html),
      ),
    );

    const result = await fetchDocument(CONFIG, manifest, manifest.documents[0]!);
    expect(result.html).toBe(html);

    const documentRequest = requests.find((entry) =>
      entry.url.includes('%E8%AD%B0%E4%BA%8B%E9%8C%B2'),
    );
    expect(documentRequest).toBeDefined();
  });
});

describe('接続テスト（FR-SETUP-005）', () => {
  it('成功すると manifest を返す', async () => {
    server.use(http.get(MANIFEST_URL, async () => HttpResponse.json(await manifestFixture())));
    await expect(testConnection(CONFIG)).resolves.toMatchObject({ schemaVersion: 1 });
  });

  it('401 なら分類されたエラーになる', async () => {
    server.use(http.get(MANIFEST_URL, () => new HttpResponse(null, { status: 401 })));
    await expect(testConnection(CONFIG)).rejects.toMatchObject({ code: 'E-GH-401' });
  });
});

describe('ロック状態との関係', () => {
  it('ロック後は保存済みセッションから復元できない（AC-005）', async () => {
    const now = Date.UTC(2026, 7, 1);
    await initializeVault('とても長いパスワード', CONFIG, now);
    await lockNow();

    expect(await restoreSession(now + 1000)).toEqual({ status: 'locked', reason: 'no-session' });
  });

  it('期限が切れていれば復元できず、API も呼ばれない', async () => {
    const now = Date.UTC(2026, 7, 1);
    await initializeVault('とても長いパスワード', CONFIG, now);

    requests.length = 0;
    const result = await restoreSession(now + SESSION_DURATION_MS);

    expect(result).toEqual({ status: 'locked', reason: 'expired' });
    expect(requests).toHaveLength(0);
  });
});

describe('通知の登録状態（FR-PUSH-004）', () => {
  it('登録済みの購読 id を取り出せる', async () => {
    server.use(
      http.get(SUBSCRIPTIONS_URL, () =>
        HttpResponse.json({
          schemaVersion: 1,
          updatedAt: '2026-08-02T00:00:00Z',
          subscriptions: [
            {
              id: '0123456789abcdef',
              label: 'Pixel',
              createdAt: '2026-08-02T00:00:00Z',
              endpoint: 'https://push.example/endpoint-value',
              keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
            },
          ],
        }),
      ),
    );

    const ids = await fetchRegisteredSubscriptionIds(CONFIG);

    expect(ids).toEqual(['0123456789abcdef']);
  });

  it('endpoint と鍵は取り出さない', async () => {
    server.use(
      http.get(SUBSCRIPTIONS_URL, () =>
        HttpResponse.json({
          schemaVersion: 1,
          updatedAt: '2026-08-02T00:00:00Z',
          subscriptions: [
            {
              id: '0123456789abcdef',
              label: 'Pixel',
              createdAt: '2026-08-02T00:00:00Z',
              endpoint: 'https://push.example/endpoint-value',
              keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
            },
          ],
        }),
      ),
    );

    // 必要なのは「この端末が載っているか」だけ。持ち回れば漏れる経路が増える。
    const serialized = JSON.stringify(await fetchRegisteredSubscriptionIds(CONFIG));

    expect(serialized).not.toContain('endpoint-value');
    expect(serialized).not.toContain('p256dh-value');
    expect(serialized).not.toContain('auth-value');
  });

  it('購読が0件なら空の配列になる', async () => {
    server.use(
      http.get(SUBSCRIPTIONS_URL, () =>
        HttpResponse.json({ schemaVersion: 1, updatedAt: '2026-08-02T00:00:00Z', subscriptions: [] }),
      ),
    );

    expect(await fetchRegisteredSubscriptionIds(CONFIG)).toEqual([]);
  });

  it('ファイルが無ければ null を返す。未登録と決めつけない', async () => {
    server.use(http.get(SUBSCRIPTIONS_URL, () => new HttpResponse(null, { status: 404 })));

    expect(await fetchRegisteredSubscriptionIds(CONFIG)).toBeNull();
  });

  it('壊れた内容でも例外にせず null を返す', async () => {
    server.use(
      http.get(SUBSCRIPTIONS_URL, () => new HttpResponse('{ 壊れた', { status: 200 })),
    );

    expect(await fetchRegisteredSubscriptionIds(CONFIG)).toBeNull();
  });
});
