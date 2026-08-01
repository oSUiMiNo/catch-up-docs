import { describe, expect, it } from 'vitest';

import { VIEWER_FONT_SCALE_DEFAULT } from '@/config/constants';
import { buildViewerDocument, DOCUMENT_CSP } from '@/viewer/injectCsp';
import { sanitizeDocumentHtml } from '@/viewer/sanitize';
import { MALICIOUS_DOCUMENTS } from '../../fixtures/maliciousDocuments';

function build(html: string, fontScale = VIEWER_FONT_SCALE_DEFAULT): string {
  return buildViewerDocument(sanitizeDocumentHtml(html).html, { fontScale });
}

describe('文書内 CSP（FR-VIEW-005）', () => {
  it('既定ですべて拒否する', () => {
    expect(DOCUMENT_CSP).toContain("default-src 'none'");
  });

  it('画像とメディアは data: と blob: だけ許可する', () => {
    expect(DOCUMENT_CSP).toContain('img-src data: blob:');
    expect(DOCUMENT_CSP).toContain('media-src data: blob:');
  });

  it('フォントは data: だけ許可する', () => {
    expect(DOCUMENT_CSP).toContain('font-src data:');
  });

  it('インラインCSSだけを許可する', () => {
    expect(DOCUMENT_CSP).toContain("style-src 'unsafe-inline'");
  });

  it('外部通信・オブジェクト・フレーム・フォーム送信を禁じる', () => {
    expect(DOCUMENT_CSP).toContain("connect-src 'none'");
    expect(DOCUMENT_CSP).toContain("object-src 'none'");
    expect(DOCUMENT_CSP).toContain("frame-src 'none'");
    expect(DOCUMENT_CSP).toContain("form-action 'none'");
    expect(DOCUMENT_CSP).toContain("base-uri 'none'");
  });

  it('スクリプトを禁じる', () => {
    expect(DOCUMENT_CSP).toContain("script-src 'none'");
  });

  it('http や https を許可する記述が無い', () => {
    expect(DOCUMENT_CSP).not.toMatch(/https?:/);
  });
});

describe('ビューア用HTMLの組み立て', () => {
  it('doctype から始まる', () => {
    expect(build(MALICIOUS_DOCUMENTS.benign).startsWith('<!doctype html>')).toBe(true);
  });

  it('CSP を head の先頭付近へ入れる', () => {
    const result = build(MALICIOUS_DOCUMENTS.benign);
    const headIndex = result.indexOf('<head>');
    const cspIndex = result.indexOf('Content-Security-Policy');
    const bodyIndex = result.indexOf('<body');

    expect(cspIndex).toBeGreaterThan(headIndex);
    expect(cspIndex).toBeLessThan(bodyIndex);
  });

  it('文書側の CSP を持ち込ませない（サニタイズ済みなので meta は残らない）', () => {
    const withOwnCsp = `<!doctype html><html><head>
      <meta http-equiv="Content-Security-Policy" content="default-src *">
      </head><body>x</body></html>`;
    const result = build(withOwnCsp);
    expect(result).not.toContain('default-src *');
  });

  it('文字サイズを反映する（FR-VIEW-008）', () => {
    expect(build(MALICIOUS_DOCUMENTS.benign, 150)).toContain('font-size: 150%');
  });

  it('下地スタイルを文書側の CSS が上書きできる順序で入れる', () => {
    const result = build(MALICIOUS_DOCUMENTS.benign);
    const baseIndex = result.indexOf('color-scheme:');
    const documentStyleIndex = result.indexOf('#123456');
    expect(baseIndex).toBeLessThan(documentStyleIndex);
  });

  it('文書の本文を保つ', () => {
    expect(build(MALICIOUS_DOCUMENTS.benign)).toContain('見出し');
  });
});
