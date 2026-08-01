# 初回セットアップ

この文書のとおりに進めれば、アプリを使いはじめられます。所要時間は30分ほどです。

`<GITHUB_OWNER>` はあなたのGitHubユーザー名、`<PRIVATE_DOCS_REPO>` は文書を置く非公開リポジトリの名前に読み替えてください。

---
<br/>
<br/>

## 用意するもの
| 項目 | 条件 |
|---|---|
| GitHubアカウント | 2要素認証またはパスキーを設定済みであること |
| Node.js | 24.15 以上（`.nvmrc` を参照） |
| Docker | Androidアプリを作る場合のみ。この端末へJDKを入れずに済ませるため |
| Androidスマートフォン | Android 8 以降 |

---
<br/>
<br/>

## 1. リポジトリを用意する
3つ作ります。それぞれ役割が違います。

| リポジトリ | 可視性 | 役割 |
|---|---|---|
| `catch-up-docs` | Public | アプリ本体。このリポジトリ |
| `<PRIVATE_DOCS_REPO>` | **Private** | 閲覧したいHTMLを置く |
| `<GITHUB_OWNER>.github.io` | Public | Androidの所有権証明ファイルだけを置く |

```bash
gh repo create catch-up-docs --public
gh repo create <PRIVATE_DOCS_REPO> --private
gh repo create <GITHUB_OWNER>.github.io --public
```

文書リポジトリは必ずPrivateにしてください。ここに置いたHTMLがそのまま閲覧対象になります。

3つ目のリポジトリが必要な理由は README の「配信URLとAndroidの所有権証明」に書いてあります。Androidを使わない場合は省略できます。

---
<br/>
<br/>

## 2. アプリの設定を作る
```bash
git clone https://github.com/<GITHUB_OWNER>/catch-up-docs.git
cd catch-up-docs
npm ci
npm run setup
```

対話式に次を聞かれます。

| 質問 | 入れる値 |
|---|---|
| アプリ名 | ホーム画面などに出る名前 |
| GitHubのオーナー名 | あなたのGitHubユーザー名 |
| 公開アプリリポジトリ名 | `catch-up-docs` |
| 公開URL | 既定のままで通常は正しい |
| Android package ID | 例：`io.github.<GITHUB_OWNER>.catchupdocs`。**一度決めたら変更できません** |

続けて次が自動で行われます。

1. 通知用の鍵ペアを作る（秘密鍵は一度だけ画面に出ます）
2. `public/runtime-config.json` を書き出す
3. `android/twa-manifest.json` を書き出す
4. Androidの署名鍵を作る（Dockerを使います。パスワードは一度だけ画面に出ます）
5. 署名証明書から `public/.well-known/assetlinks.json` を作る
6. GitHub Actions Secrets へ登録する
7. 秘密情報が混ざっていないか検査する

> **画面に出た秘密鍵とパスワードは、その場で安全な場所へ保存してください。** 二度と表示されません。署名鍵を失うと、既存のインストールへ上書き更新できなくなります。暗号化したバックアップを2か所に持つことをおすすめします。

---
<br/>
<br/>

## 3. Secrets を確認する
`npm run setup` で登録済みのはずですが、念のため確認します。

```bash
gh secret list --repo <GITHUB_OWNER>/catch-up-docs
gh secret list --repo <GITHUB_OWNER>/<PRIVATE_DOCS_REPO>
```

| リポジトリ | Secret | 用途 |
|---|---|---|
| catch-up-docs | `ANDROID_KEYSTORE_BASE64` | 署名鍵をbase64にしたもの |
| catch-up-docs | `ANDROID_KEYSTORE_PASSWORD` | 署名鍵のパスワード |
| catch-up-docs | `ANDROID_KEY_ALIAS` | 署名鍵のエイリアス |
| catch-up-docs | `ANDROID_KEY_PASSWORD` | 鍵のパスワード |
| catch-up-docs | `PRIVATE_DOCS_REPO_NAME` | 公開資産へ文書リポジトリ名が混ざっていないか検査するため |
| `<PRIVATE_DOCS_REPO>` | `VAPID_PRIVATE_KEY` | 通知の署名に使う秘密鍵 |
| `<PRIVATE_DOCS_REPO>` | `VAPID_SUBJECT` | `mailto:` 形式の連絡先 |

手で登録する場合は次のようにします。値は対話入力になるので、シェルの履歴に残りません。

```bash
gh secret set VAPID_PRIVATE_KEY --repo <GITHUB_OWNER>/<PRIVATE_DOCS_REPO>
```

---
<br/>
<br/>

## 4. アプリを公開する
```bash
git add -A && git commit -m "chore: セットアップの結果を反映"
git push origin main
```

GitHub Actions が検査・ビルド・配信まで行います。数分で `https://<GITHUB_OWNER>.github.io/catch-up-docs/` が開けるようになります。

Pages が有効になっていない場合は、リポジトリの Settings → Pages で Source を「GitHub Actions」にしてください。

---
<br/>
<br/>

## 5. 所有権証明ファイルを配置する
Androidアプリを使う場合だけ必要です。

`public/.well-known/assetlinks.json` の中身を、`<GITHUB_OWNER>.github.io` リポジトリの同じパスへコピーして push します。あわせて、リポジトリのルートに空の `.nojekyll` ファイルを置いてください。これが無いと、ドットで始まるディレクトリが配信されません。

```bash
curl -s https://<GITHUB_OWNER>.github.io/.well-known/assetlinks.json
```

JSONが返れば正しく配置できています。

---
<br/>
<br/>

## 6. 文書リポジトリを用意する
文書リポジトリのテンプレートは、このリポジトリとは別に用意されています。`documents/` にサンプルのHTMLと、検証・一覧生成・通知送信の仕組みが入っています。

`.app/push-config.json` の `vapidPublicKey` に、手順2で作った**公開鍵**を設定してください（秘密鍵ではありません）。`appBaseUrl` はアプリの公開URLです。

設定したら push します。GitHub Actions が動いて `.app/manifest.json` が作られます。

---
<br/>
<br/>

## 7. アクセストークンを発行する
**この作業はあなた自身が行ってください。** トークンは他人に渡さず、アプリの画面へ直接入力します。

1. GitHub の Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. 「Generate new token」を押す
3. 次のように設定する

| 項目 | 値 |
|---|---|
| Resource owner | あなたのアカウント |
| Repository access | Only select repositories |
| Selected repositories | `<PRIVATE_DOCS_REPO>` **だけ** |
| Repository permissions → Contents | **Read-only** |
| その他の権限 | すべて No access |

4. 生成された文字列をコピーする

書き込み権限は要りません。アプリは文書を読むだけです。権限を絞るほど、万一漏れたときの影響が小さくなります。

---
<br/>
<br/>

## 8. アプリの初期設定をする
スマートフォンで `https://<GITHUB_OWNER>.github.io/catch-up-docs/` を開きます。

**Step 1** アプリ専用パスワードを決めます。10文字以上。GitHubのパスワードとは別のものにしてください。忘れると復旧できません。

**Step 2** 文書リポジトリの情報を入れます。オーナー名とリポジトリ名です。

**Step 3** 手順7のトークンを貼り付けて「接続テスト」を押します。成功したら「設定を保存して開始」を押します。

一覧が表示されれば完了です。

---
<br/>
<br/>

## 9. 通知を登録する
設定画面 →「通知の設定」から進みます。詳しい手順は `docs/PUSH_REGISTRATION.md` を参照してください。

---
<br/>
<br/>

## 10. Androidアプリを入れる
`docs/ANDROID_INSTALL.md` を参照してください。iPhone・iPadの場合は `docs/IOS_INSTALL.md` です。

---
<br/>
<br/>

## うまくいかないとき
| 症状 | 確認すること |
|---|---|
| 接続テストで「GitHub認証を更新してください」 | トークンが正しいか、期限が切れていないか |
| 「権限または利用制限を確認してください」 | トークンの対象リポジトリと権限。組織のポリシー |
| 「GitHub設定を確認してください」 | オーナー名、リポジトリ名、ブランチ名、文書一覧の場所 |
| 「文書一覧の形式が未対応です」 | 文書リポジトリ側のワークフローが成功しているか |
| 一覧が空のまま | `documents/` にHTMLがあるか。ワークフローが成功しているか |
| 通知が来ない | `docs/PUSH_REGISTRATION.md` の確認手順へ |

設定画面の「診断情報をコピー」で状態を書き出せます。トークンやリポジトリ名は含まれません。
