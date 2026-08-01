# catch-up-docs

個人用の非公開HTML文書ライブラリです。GitHubのPrivate Repositoryへ自己完結型のHTMLを追加すると、スマートフォンへ通知が届き、アプリから安全に閲覧できます。

サーバーもデータベースもクラウドも使いません。GitHub Pages、Private Repository、GitHub Actions、GitHub REST API、標準のWeb Pushだけで動きます。

---
<br/>
<br/>

## 何ができるのか
1. Private Repository の `documents/` へHTMLをコミットする
2. GitHub Actions が内容を検証し、文書一覧を更新する
3. 登録した端末へ通知が届く（「新しいドキュメントが追加されました」とだけ）
4. アプリを開くと一覧に現れる
5. タップすると、GitHubから認証付きで取得して隔離された領域に表示する

閲覧にはアプリ専用パスワードが必要です。最後に正しく入力してから120時間（5日間）は再入力なしで開けます。

---
<br/>
<br/>

## 構成
このリポジトリはアプリ本体だけを持ちます。文書は別の非公開リポジトリにあり、そちらの中身は公開されません。

| 場所 | 役割 | 公開 |
|---|---|---|
| このリポジトリ | PWA本体、Android TWA、CI/CD | 公開 |
| `<PRIVATE_DOCS_REPO>` | 閲覧対象のHTML、文書一覧、通知の仕組み | 非公開 |
| `<GITHUB_OWNER>.github.io` | Androidの所有権証明ファイルのみ | 公開 |

このリポジトリには、文書の中身も、アクセストークンも、通知の秘密鍵も、Androidの署名鍵も含まれていません。CIが毎回それを検査しています。

---
<br/>
<br/>

## 使いはじめる
導入手順は `docs/SETUP.md` にまとめています。おおまかには次の流れです。

1. 2つのリポジトリを用意する
2. `npm run setup` で設定と鍵を作る
3. GitHub Actions Secrets を登録する
4. Fine-grained personal access token を発行する
5. 公開URLを開いて初期設定を済ませる
6. 通知を登録する
7. Android用のAPKを作って端末へ入れる

| 目的 | 参照先 |
|---|---|
| 初回セットアップ | `docs/SETUP.md` |
| あなたが手を動かす工程の一覧 | `docs/USER_ACTIONS.md` |
| Androidへの導入 | `docs/ANDROID_INSTALL.md` |
| iPhone・iPadへの導入 | `docs/IOS_INSTALL.md` |
| 追加できるHTMLの決まり | `docs/DOCUMENT_FORMAT.md` |
| 通知の登録と解除 | `docs/PUSH_REGISTRATION.md` |
| 受け入れ条件の確認結果 | `docs/ACCEPTANCE_CHECKLIST.md` |
| 脅威モデルと制限 | `SECURITY.md` |

---
<br/>
<br/>

## 開発
Node.js 24.15 以上が必要です（`.nvmrc` を参照）。

```bash
npm ci
npm run dev              # 開発サーバー
npm run verify:all       # lint・整形・型検査・テスト・ビルド・秘密情報検査・サイズ検査
```

個別に実行する場合：

| コマンド | 内容 |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | 3つの tsconfig で型検査 |
| `npm test` | 単体テストと統合テスト |
| `npm run test:e2e` | Playwright（Chromium / WebKit） |
| `npm run build` | production ビルド |
| `npm run verify:secrets` | 公開資産へ秘密情報が混ざっていないか検査 |
| `npm run check:bundle-size` | gzip 後 500 KB の上限を確認 |

### Android のビルド
この端末へ JDK や Android SDK を入れずに済むよう、Docker に閉じています。

```bash
npm run android:image    # ビルド環境のイメージを作る（初回のみ、数分）
```

イメージの作成後、`docs/ANDROID_INSTALL.md` の手順でAPKを作れます。CIでも同じバージョンの道具を使います。

---
<br/>
<br/>

## 設計上の判断と、その理由
実装にあたって仕様から補正した点と、迷いやすい箇所の判断を残しておきます。

### 配信URLとAndroidの所有権証明
Androidアプリ（TWA）がアドレスバーなしで起動するには、`https://<ドメイン>/.well-known/assetlinks.json` が応答する必要があります。この場所はAndroid側の仕様で固定されており、変更できません。

一方 GitHub Pages では、ドメインのルート直下を配信できるのは `<ユーザー名>.github.io` という名前のリポジトリだけです。アプリ本体をサブパスで配信する構成では、ルート専用の小さなリポジトリを別に用意する必要があります。

### TypeScript のバージョン
実装時点の最新は 7 系ですが、5.9 系を使っています。lint に使う typescript-eslint の対応範囲が `<6.1.0` であり、7 系では型情報を使った検査ができないためです。安全側に倒して 5 系で固定しました。

### Service Worker を手書きしている理由
Workbox のランタイムを載せず、キャッシュ処理を自前で書いています。「プリキャッシュしたアプリシェル以外は絶対にキャッシュしない」という要件を、コードの上で一目で確かめられるようにするためです。同一オリジン以外のリクエストには一切介入しないので、GitHub APIの応答や文書の中身がキャッシュへ入る経路がありません。

### アプリシェルのCSPに `data:` を許している理由
文書は `srcdoc` の iframe で表示します。この形の iframe は埋め込み元のCSPを継承する仕様のため、アプリシェル側で `data:` を塞ぐと、文書に埋め込まれた画像やフォントも表示できなくなります。外部への通信は許していません。

### 通知の登録を手作業にしている理由
アプリからPrivate Repositoryへ書き込めば自動化できますが、そのためにはトークンへ書き込み権限が必要になります。閲覧しかしないアプリに書き込み権限を持たせないため、購読情報の登録だけは利用者がワークフローへ貼り付ける形にしました。

### manifest の生成時刻に現在時刻を使わない理由
同じ入力からは常に同じ内容の文書一覧が生成されるようにするためです。生成時刻には起点コミットの日時を使っています。これにより、内容が変わっていないのに差分が出る事態を防げます。

---
<br/>
<br/>

## 制限
- パスワードを忘れると復旧できません。アプリをリセットして設定し直します
- オフラインでは文書を読めません。毎回GitHubから取得するためです
- 通知の秘密鍵を変えると、登録済みの端末はすべて再登録が必要です
- Androidの署名鍵を失うと、既存のインストールへ上書き更新できません
- root化した端末、悪意あるブラウザ拡張、GitHubアカウントの完全な乗っ取りは防げません

詳しくは `SECURITY.md` を参照してください。
