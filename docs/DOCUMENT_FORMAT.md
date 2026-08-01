# 追加できるHTMLの決まり

外部のサーバーから何も読み込まない「自己完結型」のHTMLだけを扱います。決まりに反するものを push すると、GitHub Actions が失敗し、一覧にも反映されず通知も飛びません。

---
<br/>
<br/>

## なぜ自己完結型なのか
文書は完全に隔離された領域で表示します。外部への通信を一切許していないため、URLで参照した画像やCSSは、そもそも表示時に読み込めません。読み込めないものを追加できてしまうと、追加した時点では気づかず、開いたときに崩れた表示を見ることになります。

追加の時点で弾くことで、「一覧に出たものは必ず正しく表示できる」状態を保っています。

---
<br/>
<br/>

## 必須の条件
| 項目 | 条件 |
|---|---|
| 置き場所 | `documents/` の配下（サブディレクトリ可） |
| 拡張子 | `.html` |
| 文字コード | UTF-8（BOMは付いていてもよい） |
| サイズ | 1バイト以上、20 MB以下 |
| シンボリックリンク | 使えない |

ファイル名とディレクトリ名に日本語や空白を使えます。

---
<br/>
<br/>

## 使えない要素
| 要素 | 理由 |
|---|---|
| `script` | 文書内でコードを動かさないため |
| `iframe` | 入れ子の隔離領域を作らせないため |
| `object` `embed` | プラグイン経由の実行を防ぐため |
| `form` | 外部への送信経路を作らせないため |
| `base` | 相対URLの解決先を外部へ向けさせないため |

---
<br/>
<br/>

## 使えない参照
外部のURL（`http:` `https:` `//` で始まるもの）を次の場所で使えません。

- `img` の `src` `srcset`
- `source` の `src` `srcset`
- `video` の `src` `poster`
- `audio` の `src`
- `link` の `href`（favicon も含めてすべて）
- CSS の `url(...)`
- CSS の `@import`（相対パスでも不可）

外部サイトへの `a href` は**警告のみ**です。追加はできますが、表示するときにリンクが無効化され、文字だけが残ります。

---
<br/>
<br/>

## 使えるもの
| 種類 | 書き方 |
|---|---|
| スタイル | `<style>` に直接書く。`style` 属性も可 |
| 画像 | `data:` URI で埋め込む。インラインSVGも可 |
| フォント | `data:` URI で埋め込む |
| リンク | `#見出しのid` の形のページ内リンク |
| 表・リスト・見出し | 通常どおり |

---
<br/>
<br/>

## メタデータ
省略しても動きますが、指定すると一覧での見え方が良くなります。

```html
<meta name="app:title" content="八月の議事録" />
<meta name="app:description" content="一覧のカードに表示される説明。" />
<meta name="app:tags" content="議事録, 2026年, 重要" />
```

| 項目 | 決まり方 | 上限 |
|---|---|---|
| タイトル | `app:title` → `<title>` → 拡張子を除いたファイル名 | 200文字 |
| 説明 | `app:description` → `description` → 空 | 500文字 |
| タグ | `app:tags` をカンマ区切り。空要素と重複は除去 | 10件、各40文字 |

上限を超えた分は切り詰められ、ワークフローに警告が出ます。エラーにはなりません。

---
<br/>
<br/>

## 最小の例
```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>八月の議事録</title>
    <meta name="app:tags" content="議事録, 2026年" />
    <style>
      body { font-family: system-ui, sans-serif; line-height: 1.8; padding: 16px; }
      h1 { font-size: 1.5rem; }
    </style>
  </head>
  <body>
    <h1>八月の議事録</h1>
    <p>本文をここに書きます。</p>
  </body>
</html>
```

---
<br/>
<br/>

## 画像を埋め込む
```bash
# PNG を data: URI にする
echo "data:image/png;base64,$(base64 -w0 photo.png)"
```

出力を `src` にそのまま貼ります。

```html
<img src="data:image/png;base64,iVBORw0KGgo..." alt="説明" />
```

サイズは元のファイルの約1.33倍になります。文書全体で20 MBを超えないよう、大きな画像は事前に縮小してください。

グラフや図であれば、インラインSVGのほうが軽く、拡大しても綺麗です。

---
<br/>
<br/>

## 追加・更新・削除の違い
| 操作 | 一覧 | 通知 | 既読状態 |
|---|---|---|---|
| 新しいパスにHTMLを追加 | 増える | **届く** | 未読 |
| 同じパスのHTMLを更新 | 内容が変わる | 届かない | 未読に戻る |
| HTMLを削除 | 消える | 届かない | 情報も消える |
| ファイル名を変更 | 別の文書になる | **届く** | 新しいものは未読 |

ファイル名の変更は「削除して追加した」のと同じ扱いです。文書の識別子はパスから作られるためです。

---
<br/>
<br/>

## 手元で確認する
push する前に確かめられます。

```bash
cd <文書リポジトリ>
node scripts/validate-document.mjs                    # 全件
node scripts/validate-document.mjs documents/new.html # 1件だけ
```

違反があれば、どのファイルの何が問題かが表示されます。
