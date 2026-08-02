import { describe, expect, it } from 'vitest';

import { sanitizeCssText, sanitizeInlineStyle } from '@/viewer/css';
import { sanitizeDocumentHtml } from '@/viewer/sanitize';
import { MALICIOUS_DOCUMENTS } from '../../fixtures/maliciousDocuments';

const sanitize = (html: string): string => sanitizeDocumentHtml(html).html;

describe('禁止要素の除去（FR-VIEW-003）', () => {
  it('script を取り除く', () => {
    const result = sanitize(MALICIOUS_DOCUMENTS.inlineScript);
    expect(result).not.toContain('<script');
    expect(result).not.toContain('script-executed');
  });

  it('iframe・object・embed を取り除く', () => {
    const result = sanitize(MALICIOUS_DOCUMENTS.nestedFrames);
    expect(result).not.toContain('<iframe');
    expect(result).not.toContain('<object');
    expect(result).not.toContain('<embed');
  });

  it('form を取り除く', () => {
    const result = sanitize(MALICIOUS_DOCUMENTS.formSubmission);
    expect(result).not.toContain('<form');
    expect(result).not.toContain('attacker.example');
  });

  it('base を取り除く', () => {
    const result = sanitize(MALICIOUS_DOCUMENTS.baseTag);
    expect(result).not.toContain('<base');
  });

  it('meta[http-equiv] を取り除く', () => {
    const result = sanitize(MALICIOUS_DOCUMENTS.topNavigation);
    expect(result.toLowerCase()).not.toContain('http-equiv');
  });

  it('link を取り除く', () => {
    const result = sanitize(MALICIOUS_DOCUMENTS.externalStylesheet);
    expect(result).not.toContain('<link');
  });
});

describe('イベント属性の除去', () => {
  it('onerror・onclick・onmouseover を落とす', () => {
    const result = sanitize(MALICIOUS_DOCUMENTS.onErrorHandler);
    expect(result.toLowerCase()).not.toContain('onerror');
    expect(result.toLowerCase()).not.toContain('onclick');
    expect(result.toLowerCase()).not.toContain('onmouseover');
  });

  it('どの要素にも on* 属性が残らない', () => {
    const result = sanitize(
      '<p onclick="x()" onfocus="y()">a</p><div onpointerdown="z()"><span onload="w()">b</span></div>',
    );

    const parsed = new DOMParser().parseFromString(result, 'text/html');
    const remaining = Array.from(parsed.querySelectorAll('*')).flatMap((element) =>
      Array.from(element.attributes)
        .map((attribute) => attribute.name)
        .filter((name) => name.toLowerCase().startsWith('on')),
    );

    expect(remaining).toEqual([]);
  });
});

describe('危険なURLの除去', () => {
  it('javascript: を落とす', () => {
    const result = sanitize(MALICIOUS_DOCUMENTS.javascriptUrl);
    expect(result.toLowerCase()).not.toContain('javascript:');
  });

  it('vbscript: を落とす', () => {
    expect(sanitize('<a href="vbscript:msgbox(1)">x</a>').toLowerCase()).not.toContain('vbscript:');
  });

  it('data:text/html を落とす', () => {
    const result = sanitize('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(result.toLowerCase()).not.toContain('data:text/html');
  });
});

describe('外部リソースの除去（FR-VIEW-003）', () => {
  it('外部の img src を落とす', () => {
    const result = sanitize(MALICIOUS_DOCUMENTS.externalImage);
    expect(result).not.toContain('attacker.example');
  });

  it('srcset の外部候補を落とす', () => {
    const result = sanitize('<img srcset="https://x.example/a.png 1x" alt="">');
    expect(result).not.toContain('x.example');
  });

  it('video の poster を落とす', () => {
    const result = sanitize('<video poster="https://x.example/p.jpg"></video>');
    expect(result).not.toContain('x.example');
  });

  it('プロトコル相対の URL も落とす', () => {
    const result = sanitize('<img src="//x.example/a.png" alt="">');
    expect(result).not.toContain('x.example');
  });

  it('data: 画像は残す', () => {
    const result = sanitize(MALICIOUS_DOCUMENTS.benign);
    expect(result).toContain('data:image/gif;base64,');
  });
});

describe('アンカーの扱い', () => {
  it('ページ内リンクは文書自身の URL を足して残す', () => {
    const result = sanitize(MALICIOUS_DOCUMENTS.benign);
    // srcdoc の相対URLの基準は埋め込み元のページになるため、
    // `#section` のままだとアプリ本体へ移動してしまう。
    expect(result).toContain('href="about:srcdoc#section"');
  });

  it('ページ内リンクの飛び先はアプリ本体にならない', () => {
    const result = sanitize('<a href="#ch2">2章へ</a><h2 id="ch2">2章</h2>');
    const resolved = new URL(
      /href="([^"]+)"/.exec(result)?.[1] ?? '',
      'https://example.test/catch-up-docs/',
    );
    expect(resolved.href).toBe('about:srcdoc#ch2');
  });

  it('外部リンクの href を落として印を付ける', () => {
    const result = sanitize('<a href="https://x.example/">link</a>');
    expect(result).not.toContain('x.example');
    expect(result).toContain('data-link-removed');
    // 文字は残す。
    expect(result).toContain('link');
  });

  it('相対リンクも落とす（外部取得になり得るため）', () => {
    const result = sanitize('<a href="other.html">link</a>');
    expect(result).not.toContain('other.html');
  });

  it('target を落とす', () => {
    const result = sanitize('<a href="#x" target="_top">link</a>');
    expect(result).not.toContain('_top');
  });
});

describe('CSS の浄化（FR-VIEW-003）', () => {
  it('@import を落とす', () => {
    expect(
      sanitizeCssText('@import url("https://x.example/a.css"); body{color:red}'),
    ).not.toContain('@import');
  });

  it('相対パスの @import も落とす', () => {
    expect(sanitizeCssText('@import "theme.css";')).not.toContain('theme.css');
  });

  it('外部 url() を none にする', () => {
    expect(sanitizeCssText('body{background:url(https://x.example/a.png)}')).not.toContain(
      'x.example',
    );
  });

  it('data: の url() は残す', () => {
    const css = 'body{background:url(data:image/gif;base64,R0lGOD)}';
    expect(sanitizeCssText(css)).toContain('data:image/gif');
  });

  it('blob: の url() は残す', () => {
    expect(sanitizeCssText('body{background:url(blob:abc)}')).toContain('blob:abc');
  });

  it('style 属性の外部参照を落とす', () => {
    expect(sanitizeInlineStyle('background:url(https://x.example/a.png)')).not.toContain(
      'x.example',
    );
  });

  it('style 要素の中の外部参照を落とす', () => {
    const result = sanitize(MALICIOUS_DOCUMENTS.externalStylesheet);
    expect(result).not.toContain('attacker.example');
  });

  it('通常の CSS セレクタを壊さない', () => {
    const result = sanitize(MALICIOUS_DOCUMENTS.benign);
    expect(result).toContain('.box > p');
    expect(result).toContain('#123456');
  });
});

describe('過剰な除去をしない', () => {
  it('見出しと段落を残す', () => {
    const result = sanitize(MALICIOUS_DOCUMENTS.benign);
    expect(result).toContain('<h1>見出し</h1>');
    expect(result).toContain('<p>本文</p>');
  });

  it('インラインSVGを残す', () => {
    const result = sanitize(MALICIOUS_DOCUMENTS.benign);
    expect(result).toContain('<svg');
    expect(result).toContain('rect');
  });

  it('日本語をそのまま保つ', () => {
    const result = sanitize('<p>日本語のテキスト。記号：〜、（）</p>');
    expect(result).toContain('日本語のテキスト。記号：〜、（）');
  });
});
