import { describe, expect, it } from 'vitest';

import {
  buildNotificationBody,
  isSafeDocumentId,
  parsePushPayload,
  resolveDeepLinkUrl,
} from '@/push/payload';
import { decodeVapidKey } from '@/push/subscribe';

const SCOPE = 'https://example.github.io/catch-up-docs/';

describe('ペイロードの解釈', () => {
  it('正しい JSON を読む', () => {
    const payload = parsePushPayload(
      JSON.stringify({ type: 'documents-added', count: 3, documentIds: ['doc_0000000000000001'] }),
    );
    expect(payload).toEqual({
      type: 'documents-added',
      count: 3,
      documentIds: ['doc_0000000000000001'],
    });
  });

  it('壊れた JSON でも最小限の通知に落とす', () => {
    expect(parsePushPayload('{ broken')).toEqual({
      type: 'documents-added',
      count: 1,
      documentIds: [],
    });
  });

  it('本文が無い場合も落ちない', () => {
    expect(parsePushPayload(undefined).count).toBe(1);
  });

  it('件数が不正なら1件として扱う', () => {
    expect(parsePushPayload(JSON.stringify({ count: 'many' })).count).toBe(1);
    expect(parsePushPayload(JSON.stringify({ count: -5 })).count).toBe(1);
  });

  it('文字列でない document id を捨てる', () => {
    const payload = parsePushPayload(JSON.stringify({ documentIds: ['doc_x', 42, null] }));
    expect(payload.documentIds).toEqual(['doc_x']);
  });

  it('テスト通知を見分ける', () => {
    expect(parsePushPayload(JSON.stringify({ type: 'test' })).type).toBe('test');
  });
});

describe('通知本文（FR-PUSH-007）', () => {
  it('1件のとき', () => {
    expect(buildNotificationBody({ type: 'documents-added', count: 1, documentIds: [] })).toBe(
      '新しいドキュメントが追加されました。',
    );
  });

  it('複数件のとき件数を出す', () => {
    expect(buildNotificationBody({ type: 'documents-added', count: 3, documentIds: [] })).toBe(
      '新しいドキュメントが3件追加されました。',
    );
  });

  it('テスト通知は受信確認の文言になる', () => {
    expect(buildNotificationBody({ type: 'test', count: 1, documentIds: [] })).toContain('テスト');
  });

  it('文書名やリポジトリ名を含まない', () => {
    const body = buildNotificationBody({
      type: 'documents-added',
      count: 2,
      documentIds: ['doc_0000000000000001'],
    });
    expect(body).not.toContain('doc_');
    expect(body).not.toMatch(/\.html|repo|title/i);
  });
});

describe('ディープリンクの解決（FR-PUSH-008）', () => {
  it('1件なら該当文書を開く', () => {
    const url = resolveDeepLinkUrl(
      { type: 'documents-added', count: 1, documentIds: ['doc_0123456789abcdef'] },
      SCOPE,
    );
    expect(url).toBe(`${SCOPE}?open=doc_0123456789abcdef`);
  });

  it('複数件ならダッシュボードを開く', () => {
    const url = resolveDeepLinkUrl(
      { type: 'documents-added', count: 2, documentIds: ['doc_0123456789abcdef'] },
      SCOPE,
    );
    expect(url).toBe(SCOPE);
  });

  it('テスト通知はダッシュボードを開く', () => {
    expect(resolveDeepLinkUrl({ type: 'test', count: 1, documentIds: [] }, SCOPE)).toBe(SCOPE);
  });

  it('形式の合わない id は無視する', () => {
    const url = resolveDeepLinkUrl(
      { type: 'documents-added', count: 1, documentIds: ['../../evil'] },
      SCOPE,
    );
    expect(url).toBe(SCOPE);
  });

  it('別オリジンの url を採用しない', () => {
    const url = resolveDeepLinkUrl(
      { type: 'documents-added', count: 1, documentIds: [], url: 'https://attacker.example/' },
      SCOPE,
    );
    expect(url).toBe(SCOPE);
  });

  it('スコープ外のパスを採用しない', () => {
    const url = resolveDeepLinkUrl(
      { type: 'documents-added', count: 1, documentIds: [], url: '/other-app/' },
      SCOPE,
    );
    expect(url).toBe(SCOPE);
  });
});

describe('document id の形式', () => {
  it('doc_ と16桁の16進数だけを通す', () => {
    expect(isSafeDocumentId('doc_0123456789abcdef')).toBe(true);
    expect(isSafeDocumentId('doc_0123456789ABCDEF')).toBe(false);
    expect(isSafeDocumentId('doc_short')).toBe(false);
    expect(isSafeDocumentId('../etc/passwd')).toBe(false);
  });
});

describe('VAPID 公開鍵の変換', () => {
  it('base64url を 65 バイトへ戻す', () => {
    // 非圧縮 EC ポイントは先頭が 0x04 の 65 バイト。
    const bytes = new Uint8Array(65);
    bytes[0] = 4;
    for (let index = 1; index < 65; index += 1) {
      bytes[index] = index;
    }
    const base64Url = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    expect(Array.from(decodeVapidKey(base64Url))).toEqual(Array.from(bytes));
  });
});
