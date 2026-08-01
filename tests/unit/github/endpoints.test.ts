import { describe, expect, it } from 'vitest';

import { GITHUB_ACCEPT_RAW, GITHUB_API_VERSION } from '@/config/constants';
import { buildContentsUrl, buildHeaders, encodeContentPath } from '@/github/endpoints';

describe('パスの符号化（FR-GH-001）', () => {
  it('スラッシュは区切りとして残す', () => {
    expect(encodeContentPath('documents/sub/a.html')).toBe('documents/sub/a.html');
  });

  it('日本語を符号化する', () => {
    expect(encodeContentPath('documents/議事録.html')).toBe(
      'documents/%E8%AD%B0%E4%BA%8B%E9%8C%B2.html',
    );
  });

  it('空白を符号化する', () => {
    expect(encodeContentPath('documents/a b.html')).toBe('documents/a%20b.html');
  });

  it('先頭や連続するスラッシュを潰す', () => {
    expect(encodeContentPath('/documents//a.html')).toBe('documents/a.html');
  });

  it('疑問符やシャープを符号化する', () => {
    expect(encodeContentPath('documents/a?b#c.html')).toBe('documents/a%3Fb%23c.html');
  });
});

describe('Contents API の URL', () => {
  it('owner・repo・path・ref を組み立てる', () => {
    const url = buildContentsUrl({
      owner: 'someone',
      repo: 'docs',
      path: '.app/manifest.json',
      ref: 'main',
    });
    expect(url).toBe(
      'https://api.github.com/repos/someone/docs/contents/.app/manifest.json?ref=main',
    );
  });

  it('ref にコミットSHAを使える', () => {
    const sha = 'a'.repeat(40);
    const url = buildContentsUrl({ owner: 'o', repo: 'r', path: 'documents/x.html', ref: sha });
    expect(url).toContain(`ref=${sha}`);
  });
});

describe('ヘッダー（FR-GH-002）', () => {
  it('必要な3つを載せる', () => {
    const headers = buildHeaders('token-value');
    expect(headers.get('Authorization')).toBe('Bearer token-value');
    expect(headers.get('Accept')).toBe(GITHUB_ACCEPT_RAW);
    expect(headers.get('X-GitHub-Api-Version')).toBe(GITHUB_API_VERSION);
  });

  it('ETag があれば If-None-Match を載せる', () => {
    expect(buildHeaders('t', '"abc"').get('If-None-Match')).toBe('"abc"');
  });

  it('ETag が無ければ If-None-Match を載せない', () => {
    expect(buildHeaders('t').get('If-None-Match')).toBeNull();
  });
});
