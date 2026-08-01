/**
 * 文書内 CSS から外部参照を取り除く（FR-VIEW-003）。
 *
 * 許可するのは `data:` と `blob:` だけ。相対パスも外部取得になり得るため落とす。
 * `@import` は無条件に落とす。自己完結型という前提が崩れるため。
 */

/** url(...) の中身として許可する scheme。 */
const ALLOWED_URL_PREFIXES = ['data:', 'blob:'];

function isAllowedCssUrl(value: string): boolean {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '');
  return ALLOWED_URL_PREFIXES.some((prefix) => trimmed.toLowerCase().startsWith(prefix));
}

/**
 * CSS テキストを浄化する。
 * 取り除いた箇所は `none` に置き換え、宣言そのものは壊さない。
 */
export function sanitizeCssText(css: string): string {
  // @import は行ごと落とす。
  let result = css.replace(/@import\s+[^;]*;?/gi, '');

  // url(...) は data: と blob: 以外を none にする。
  result = result.replace(/url\(\s*([^)]*)\s*\)/gi, (match, rawUrl: string) =>
    isAllowedCssUrl(rawUrl) ? match : 'none',
  );

  // CSS の中に紛れ込んだ terminator で文書構造を壊されないようにする。
  result = result.replace(/<\/style/gi, '<\\/style');

  return result;
}

/** style 属性の値を浄化する。危険なら空文字を返す。 */
export function sanitizeInlineStyle(style: string): string {
  const cleaned = sanitizeCssText(style);
  // expression() は古い IE 用の実行経路。念のため落とす。
  return cleaned.replace(/expression\s*\(/gi, '');
}
