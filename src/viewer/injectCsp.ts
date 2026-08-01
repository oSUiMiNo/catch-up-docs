/**
 * 文書内 CSP の挿入とビューア用の下地作り（FR-VIEW-005 / FR-VIEW-008 / 10.6）。
 *
 * サニタイズ済みの HTML の head 先頭へ、次を差し込む。
 *   1. Content-Security-Policy（既定ですべて拒否し、data: と blob: だけ通す）
 *   2. viewport 指定
 *   3. 最低限の下地スタイル（文字サイズと読みやすい背景色）
 *
 * 下地スタイルは head の先頭に置くため、文書自身の CSS が後から上書きできる。
 */

import { VIEWER_FONT_SCALE_DEFAULT } from '../config/constants';

/**
 * FR-VIEW-005 の CSP。これ以上緩めない。
 * connect-src 'none' により、仮にスクリプトが動いても外部通信はできない。
 */
export const DOCUMENT_CSP = [
  "default-src 'none'",
  'img-src data: blob:',
  "style-src 'unsafe-inline'",
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "script-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export interface ViewerDocumentOptions {
  /** 文字サイズの倍率（%）。FR-VIEW-008。 */
  fontScale?: number;
  /** アプリ側のテーマ。文書が色を指定していない場合の下地に使う。 */
  colorScheme?: 'dark' | 'light';
}

function buildBaseStyle(fontScale: number, colorScheme: 'dark' | 'light'): string {
  const background = colorScheme === 'dark' ? '#0f1720' : '#ffffff';
  const foreground = colorScheme === 'dark' ? '#e8eef5' : '#12202e';

  return `
:root { color-scheme: ${colorScheme}; font-size: ${String(fontScale)}%; }
html, body { background: ${background}; color: ${foreground}; }
body {
  margin: 0;
  padding: 16px;
  font-family: system-ui, -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
img, video, svg, table { max-width: 100%; }
img, video { height: auto; }
table { display: block; overflow-x: auto; }
a[data-link-removed] { color: inherit; text-decoration: underline dotted; cursor: default; }
`.trim();
}

/**
 * iframe の srcdoc へ渡す最終的な HTML を組み立てる。
 *
 * @param sanitizedHtml sanitizeDocumentHtml() の出力
 */
export function buildViewerDocument(
  sanitizedHtml: string,
  options: ViewerDocumentOptions = {},
): string {
  const fontScale = options.fontScale ?? VIEWER_FONT_SCALE_DEFAULT;
  const colorScheme = options.colorScheme ?? 'dark';

  const parsed = new DOMParser().parseFromString(sanitizedHtml, 'text/html');
  const head = parsed.head;

  const cspMeta = parsed.createElement('meta');
  cspMeta.setAttribute('http-equiv', 'Content-Security-Policy');
  cspMeta.setAttribute('content', DOCUMENT_CSP);

  const viewportMeta = parsed.createElement('meta');
  viewportMeta.setAttribute('name', 'viewport');
  viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1');

  const charsetMeta = parsed.createElement('meta');
  charsetMeta.setAttribute('charset', 'UTF-8');

  const baseStyle = parsed.createElement('style');
  baseStyle.textContent = buildBaseStyle(fontScale, colorScheme);

  // 先頭から charset → CSP → viewport → 下地スタイルの順に並べる。
  head.prepend(baseStyle);
  head.prepend(viewportMeta);
  head.prepend(cspMeta);
  head.prepend(charsetMeta);

  return `<!doctype html>\n${parsed.documentElement.outerHTML}`;
}
