# Androidへの導入

Google Play を経由せず、APKを直接インストールします。

---
<br/>
<br/>

## APKを入手する
GitHub の Releases から `private-html-library-vX.Y.Z.apk` をダウンロードします。スマートフォンのブラウザで直接開いても構いません。

`.apk.sha256` も一緒に置いてあります。ファイルが途中で壊れていないか確かめたい場合に使います。

```bash
sha256sum -c private-html-library-v1.0.0.apk.sha256
```

---
<br/>
<br/>

## インストールする
Android 8 以降では、アプリごとに「提供元不明のアプリ」を許可する形になっています。

1. ダウンロードしたAPKをタップする
2. 「この提供元のアプリのインストールは許可されていません」と出たら「設定」を押す
3. 「この提供元のアプリを許可」をオンにする
4. 戻ってインストールを続ける

ブラウザからインストールした場合は、そのブラウザに対して許可を与えることになります。インストールが終わったら、許可を戻しておいても構いません。

---
<br/>
<br/>

## 起動して確認する
アプリを開いたとき、**画面上部にアドレスバーが出ていなければ成功**です。

端末の自動回転をオフにした状態で倒しても、画面が回らなければ正しい状態です（v1.0.1 以降）。回したいときは、倒したときに画面の隅へ出る回転ボタンを押します。

アドレスバーが出ている場合は、所有権の確認が通っていません。次を確認してください。

```bash
curl -s https://<GITHUB_OWNER>.github.io/.well-known/assetlinks.json
```

| 確認すること | 期待する状態 |
|---|---|
| HTTPステータス | 200 |
| `package_name` | アプリの package ID と一致 |
| `sha256_cert_fingerprints` | APKの署名証明書と一致 |

APK側のフィンガープリントは次で確認できます。

```bash
docker run --rm -v "$PWD:/work" catch-up-docs-android:latest \
  bash -lc 'cd /work && $ANDROID_HOME/build-tools/36.1.0/apksigner verify --print-certs *.apk | grep -i "SHA-256 digest"'
```

`assetlinks.json` はコロン区切りの大文字、apksigner の出力はコロン無しの小文字で表示されます。区切りと大小を揃えて比べてください。

なお、Androidは所有権確認の結果を一定時間キャッシュします。ファイルを直した直後は、アプリを再インストールするか、しばらく待ってから確認してください。

---
<br/>
<br/>

## 更新する
新しいバージョンのAPKをダウンロードして、同じようにインストールすれば上書きされます。アプリ内のデータ（パスワード設定、トークン、既読情報）は保持されます。

上書きできるのは、**同じ package ID と同じ署名鍵**で作られたAPKだけです。どちらかが違うと「アプリがインストールされていません」と表示されます。

Webアプリ側の変更（画面や機能の修正）は、GitHub Pages への配信だけで反映されます。APKを作り直す必要はありません。APKの更新が要るのは次の場合だけです。

- package ID を変えたとき
- 署名鍵を変えたとき
- アイコンやアプリ名を変えたとき
- 権限やTWAの設定を変えたとき

**画面の向きの扱いはTWAの設定に含まれます。** v1.0.1 で「端末の自動回転をオフにしていても倒すと回ってしまう」問題を直しましたが、これはAPKに焼き込まれる設定のため、新しいAPKを入れるまで直りません。

---
<br/>
<br/>

## 自分でAPKを作る
### GitHub Actions で作る（推奨）
タグを打つと自動で作られ、Releases へ添付されます。

```bash
git tag -a android-v1.0.1 -m "Android v1.0.1"
git push origin android-v1.0.1
```

手動で実行する場合は Actions → Android release → Run workflow から、バージョンを入力します。

### 手元で作る
この端末へJDKやAndroid SDKを入れずに済むよう、Dockerに閉じています。

```bash
# 1. ビルド環境のイメージを作る（初回のみ、数分かかります）
npm run android:image

# 2. 署名鍵を配置する
cp ~/.secrets/catch-up-docs/android-release.keystore android/android.keystore

# 3. Androidプロジェクトを再生成する
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD/android:/work" -e HOME=/tmp \
  catch-up-docs-android:latest \
  bash -lc 'mkdir -p /tmp/.bubblewrap && cp /home/builder/.bubblewrap/config.json /tmp/.bubblewrap/ && cd /work && bubblewrap update --skipVersionUpgrade'

# 4. ビルドする（初回は依存の取得に10分以上かかります）
mkdir -p ~/.cache/catch-up-docs-gradle
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD/android:/work" \
  -v "$HOME/.cache/catch-up-docs-gradle:/gradle" \
  -e HOME=/tmp -e GRADLE_USER_HOME=/gradle \
  -e GRADLE_OPTS="-Dorg.gradle.daemon=false" \
  -e BUBBLEWRAP_KEYSTORE_PASSWORD="$(cat ~/.secrets/catch-up-docs/keystore-password.txt)" \
  -e BUBBLEWRAP_KEY_PASSWORD="$(cat ~/.secrets/catch-up-docs/keystore-password.txt)" \
  catch-up-docs-android:latest \
  bash -lc 'mkdir -p /tmp/.bubblewrap && cp /home/builder/.bubblewrap/config.json /tmp/.bubblewrap/ && cd /work && bubblewrap build --skipPwaValidation'

# 5. 署名を確認する
docker run --rm -v "$PWD/android:/work" -e HOME=/tmp catch-up-docs-android:latest \
  bash -lc 'cd /work && $ANDROID_HOME/build-tools/36.1.0/apksigner verify --verbose app-release-signed.apk'

# 6. 署名鍵を消す
rm android/android.keystore
```

ビルドを途中で止めると、Gradleのキャッシュにロックが残って次回が失敗します。その場合は次で復旧します。

```bash
find ~/.cache/catch-up-docs-gradle -name '*.lock' -delete
rm -rf ~/.cache/catch-up-docs-gradle/caches/journal-1
```

---
<br/>
<br/>

## 署名鍵について
署名鍵を失うと、既存のインストールへ上書き更新できなくなります。新しい package ID で作り直し、利用者に入れ直してもらうしかありません。

暗号化したバックアップを2か所に保管してください。バックアップに必要なのは次の2つです。

- `~/.secrets/catch-up-docs/android-release.keystore`
- `~/.secrets/catch-up-docs/keystore-password.txt`

なお、2026年以降のAndroidの開発者確認制度に備えて、package ID と署名証明書のフィンガープリントは固定しています。制度の適用状況は配布時に公式ドキュメントで確認してください。

---
<br/>
<br/>

## 通知の確認
アプリを開いて設定 →「通知の設定」から登録します。手順は `docs/PUSH_REGISTRATION.md` を参照してください。

通知をタップするとアプリが開きます。ロックされていればパスワード入力が出て、解除すると対象の文書が開きます。ロック画面に出る通知には文書の題名もファイル名も含まれません。
