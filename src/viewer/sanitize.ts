/**
 * 文書HTMLのサニタイズ（FR-VIEW-003）。
 *
 * 3層防御のうちの1層目。残る2層は文書内CSPと sandbox iframe で、
 * どれか1つが破られても他が効くように重ねている。
 *
 * DOMPurify にすべてを任せず、URL と CSS は自前で走査する。
 * 「外部への通信を一切させない」という要件は DOMPurify の既定では表現できないため。
 */

import DOMPurify from 'dompurify';

import { sanitizeCssText, sanitizeInlineStyle } from './css';

/** DOC-004 と同じ集合。文書側で弾いているが、表示側でも重ねて落とす。 */
const FORBIDDEN_TAGS = [
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'base',
  'link',
  'meta',
  'noscript',
  'template',
  'frame',
  'frameset',
  'applet',
  'portal',
];

/** 危険な値を持ち得る属性。 */
const FORBIDDEN_ATTRIBUTES = ['srcdoc', 'formaction', 'ping', 'http-equiv', 'nonce', 'integrity'];

/** 外部参照になり得る属性。要素名ごとに見る。 */
const URL_ATTRIBUTES: Record<string, string[]> = {
  img: ['src', 'srcset', 'longdesc'],
  source: ['src', 'srcset'],
  video: ['src', 'poster'],
  audio: ['src'],
  track: ['src'],
  input: ['src'],
  use: ['href', 'xlink:href'],
  image: ['href', 'xlink:href'],
};

/** これらで始まる URL だけをリソースとして許可する。 */
const ALLOWED_RESOURCE_PREFIXES = ['data:', 'blob:'];

/** 明確に危険な scheme。 */
const DANGEROUS_SCHEME = /^\s*(javascript|vbscript|livescript|mocha|data:text\/html)/i;

/**
 * srcdoc で読み込まれた文書自身の URL。
 *
 * srcdoc の文書は「自分の URL は about:srcdoc、ただし相対URLの基準は埋め込み元」
 * という決まりになっている。そのため `href="#見出し"` をそのまま残すと、
 * アプリ本体の URL + #見出し へ移動してしまい、文書が消える。
 * 基準を変える `<base>` は文書内CSPの `base-uri 'none'` で使えないため、
 * リンク側へ文書自身の URL を書き足して同一文書内の移動にする。
 */
const SRCDOC_DOCUMENT_URL = 'about:srcdoc';

export interface SanitizeResult {
  html: string;
  /** 取り除いた項目の要約。診断や説明に使う。本文は含めない。 */
  removed: {
    forbiddenElements: number;
    eventHandlers: number;
    externalResources: number;
    externalLinks: number;
  };
}

function isAllowedResourceUrl(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return ALLOWED_RESOURCE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/** srcset の候補のうち、許可された URL だけを残す。 */
function filterSrcset(srcset: string): string {
  return srcset
    .split(',')
    .map((candidate) => candidate.trim())
    .filter((candidate) => {
      const url = candidate.split(/\s+/)[0];
      return url !== undefined && isAllowedResourceUrl(url);
    })
    .join(', ');
}

/**
 * サニタイズして、安全な HTML 文字列を返す。
 *
 * @param html 取得した文書の生の HTML
 */
export function sanitizeDocumentHtml(html: string): SanitizeResult {
  const removed = {
    forbiddenElements: 0,
    eventHandlers: 0,
    externalResources: 0,
    externalLinks: 0,
  };

  // 1段目：DOMPurify。パーサ差異を突く攻撃への備え。
  const purified = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: FORBIDDEN_ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    ALLOW_ARIA_ATTR: true,
    KEEP_CONTENT: true,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
  });

  // 2段目：自前の走査。URL と CSS は要件どおりに絞る。
  const parsed = new DOMParser().parseFromString(purified, 'text/html');

  for (const element of Array.from(parsed.querySelectorAll('*'))) {
    const tagName = element.tagName.toLowerCase();

    if (FORBIDDEN_TAGS.includes(tagName)) {
      element.remove();
      removed.forbiddenElements += 1;
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;

      // すべての on* イベント属性を落とす。
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
        removed.eventHandlers += 1;
        continue;
      }

      if (FORBIDDEN_ATTRIBUTES.includes(name)) {
        element.removeAttribute(attribute.name);
        continue;
      }

      // javascript: などの危険な scheme。
      if (DANGEROUS_SCHEME.test(value)) {
        element.removeAttribute(attribute.name);
        removed.externalResources += 1;
        continue;
      }

      if (name === 'style') {
        const cleaned = sanitizeInlineStyle(value);
        if (cleaned.trim().length === 0) {
          element.removeAttribute(attribute.name);
        } else {
          element.setAttribute(attribute.name, cleaned);
        }
      }
    }

    // アンカーは fragment だけ残す（FR-VIEW-003）。
    if (tagName === 'a') {
      const href = element.getAttribute('href');
      if (href !== null && !href.startsWith('#')) {
        element.removeAttribute('href');
        element.setAttribute('data-link-removed', 'true');
        removed.externalLinks += 1;
      } else if (href !== null) {
        element.setAttribute('href', `${SRCDOC_DOCUMENT_URL}${href}`);
      }
      // 別ウィンドウで開く指示も落とす。
      element.removeAttribute('target');
      element.removeAttribute('rel');
    }

    // リソース属性は data: と blob: 以外を落とす。
    const urlAttributes = URL_ATTRIBUTES[tagName];
    if (urlAttributes) {
      for (const attributeName of urlAttributes) {
        const value = element.getAttribute(attributeName);
        if (value === null) {
          continue;
        }

        if (attributeName === 'srcset') {
          const filtered = filterSrcset(value);
          if (filtered.length === 0) {
            element.removeAttribute(attributeName);
            removed.externalResources += 1;
          } else if (filtered !== value) {
            element.setAttribute(attributeName, filtered);
            removed.externalResources += 1;
          }
          continue;
        }

        if (!isAllowedResourceUrl(value)) {
          element.removeAttribute(attributeName);
          removed.externalResources += 1;
        }
      }
    }

    // style 要素の中身も浄化する。
    if (tagName === 'style') {
      element.textContent = sanitizeCssText(element.textContent ?? '');
    }
  }

  return { html: serializeDocument(parsed), removed };
}

/**
 * 文書を文字列へ戻す。
 *
 * XMLSerializer は style 要素の中身を XML として実体参照へ変えてしまい、
 * CSS の子孫セレクタなどが壊れる。読み取り専用の outerHTML を使う。
 */
function serializeDocument(document: Document): string {
  return document.documentElement.outerHTML;
}
