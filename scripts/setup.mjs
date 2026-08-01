#!/usr/bin/env node
/**
 * 対話式セットアップ CLI（要件 6.2）。
 *
 *   npm run setup
 *
 * 行うこと:
 *   1. アプリ名、GitHub owner、公開URL、package ID などを質問する
 *   2. VAPID 鍵が無ければ生成する
 *   3. public/runtime-config.json を生成する
 *   4. android/twa-manifest.json を生成または更新する
 *   5. Android 署名鍵が無ければ、環境を汚さない生成手順を案内する
 *   6. 署名証明書の SHA-256 から public/.well-known/assetlinks.json を生成する
 *   7. gh があれば、確認のうえ GitHub Actions Secrets を登録する
 *   8. gh が無ければ、登録すべき Secret 名とコマンドを表示する
 *   9. 秘密情報の混入検査を実行する
 *
 * 秘密情報は通常ログへ出さない。生成直後に一度だけ表示し、保存先を案内する。
 * 生成した鍵はリポジトリ配下へ書き出さない。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateVapidKeys } from './generate-vapid.mjs';
import { buildAssetLinks, extractSha256Fingerprint } from './generate-assetlinks.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_CONFIG_PATH = join(ROOT, 'public', 'runtime-config.json');
const TWA_MANIFEST_PATH = join(ROOT, 'android', 'twa-manifest.json');
const ASSETLINKS_PATH = join(ROOT, 'public', '.well-known', 'assetlinks.json');

/** 秘密情報をリポジトリ外へ置くための既定の保管場所。 */
const SECRETS_DIR = join(homedir(), '.secrets', 'catch-up-docs');
const KEYSTORE_PATH = join(SECRETS_DIR, 'android-release.keystore');
const DOCKER_IMAGE = 'catch-up-docs-android:latest';

const rl = createInterface({ input: process.stdin, output: process.stdout });

// ── 入出力ヘルパー ──────────────────────────────────────────

function heading(text) {
  console.log('');
  console.log(`── ${text} ${'─'.repeat(Math.max(0, 56 - text.length))}`);
}

async function ask(question, defaultValue) {
  const suffix = defaultValue ? `（既定：${defaultValue}）` : '';
  const answer = (await rl.question(`${question}${suffix}\n> `)).trim();
  return answer.length > 0 ? answer : (defaultValue ?? '');
}

async function confirm(question, defaultYes = true) {
  const suffix = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = (await rl.question(`${question} ${suffix}\n> `)).trim().toLowerCase();
  if (answer.length === 0) {
    return defaultYes;
  }
  return answer === 'y' || answer === 'yes';
}

function commandExists(command) {
  return spawnSync('which', [command], { stdio: 'ignore' }).status === 0;
}

function readJsonIfExists(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** ランダムな英数字パスワード。keystore 用。 */
function randomPassword(length = 32) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

// ── 各ステップ ──────────────────────────────────────────────

async function collectBasicSettings(existing) {
  heading('基本設定');

  const appName = await ask('アプリ名', existing?.appName ?? 'catch-up-docs');
  const appShortName = await ask(
    'アプリの短縮名（ホーム画面のラベル）',
    existing?.appShortName ?? appName,
  );
  const appDescription = await ask(
    'アプリの説明',
    existing?.appDescription ?? '個人用の非公開HTML文書ライブラリ',
  );

  const githubOwner = await ask('GitHub のオーナー名（ユーザー名）', detectGitHubOwner());
  const appRepoName = await ask('公開アプリリポジトリ名', 'catch-up-docs');

  const defaultBaseUrl =
    appRepoName.toLowerCase() === `${githubOwner.toLowerCase()}.github.io`
      ? `https://${githubOwner.toLowerCase()}.github.io/`
      : `https://${githubOwner.toLowerCase()}.github.io/${appRepoName}/`;
  const publicBaseUrl = ensureTrailingSlash(
    await ask('公開URL', existing?.publicBaseUrl ?? defaultBaseUrl),
  );

  const androidPackageId = await ask(
    'Android package ID（一度決めたら変更不可）',
    existing?.androidPackageId ?? 'io.github.example.catchupdocs',
  );

  return {
    appName,
    appShortName,
    appDescription,
    githubOwner,
    appRepoName,
    publicBaseUrl,
    androidPackageId,
  };
}

function detectGitHubOwner() {
  try {
    return execFileSync('gh', ['api', 'user', '--jq', '.login'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function ensureTrailingSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

async function resolveVapidKeys(existing) {
  heading('Web Push（VAPID 鍵）');

  const currentPublicKey = existing?.vapidPublicKey ?? '';
  if (currentPublicKey.length > 0) {
    console.log('既存の VAPID 公開鍵が runtime-config.json に設定されています。');
    const regenerate = await confirm(
      '再生成しますか？（再生成すると全端末の通知購読が無効になり、再登録が必要です）',
      false,
    );
    if (!regenerate) {
      return { publicKey: currentPublicKey, privateKey: null };
    }
  }

  const keys = await generateVapidKeys();
  console.log('');
  console.log('VAPID 鍵ペアを生成しました。秘密鍵は今だけ表示します。');
  console.log('');
  console.log('  公開鍵（秘密ではない）:');
  console.log(`    ${keys.publicKey}`);
  console.log('');
  console.log('  秘密鍵:');
  console.log(`    ${keys.privateKey}`);
  console.log('');
  console.log(`  ※ 秘密鍵は ${SECRETS_DIR} などリポジトリ外へ保管し、Git へ入れないこと。`);
  return keys;
}

function writeRuntimeConfig(settings, vapidPublicKey) {
  heading('runtime-config.json');

  const config = {
    schemaVersion: 1,
    appName: settings.appName,
    appShortName: settings.appShortName,
    appDescription: settings.appDescription,
    language: 'ja',
    themeColor: '#0f1720',
    backgroundColor: '#0f1720',
    publicBaseUrl: settings.publicBaseUrl,
    androidPackageId: settings.androidPackageId,
    vapidPublicKey,
    workflowFiles: {
      registerPushDevice: 'register-push-device.yml',
      removePushDevice: 'remove-push-device.yml',
      sendTestPush: 'send-test-push.yml',
    },
  };

  writeJson(RUNTIME_CONFIG_PATH, config);
  console.log('書き出しました：public/runtime-config.json');
  console.log('  ※ 文書リポジトリ名は含めない。利用者がアプリの初期設定画面で入力する。');
  return config;
}

function writeTwaManifest(settings) {
  heading('android/twa-manifest.json');

  const baseUrl = new URL(settings.publicBaseUrl);
  const existing = readJsonIfExists(TWA_MANIFEST_PATH);

  const manifest = {
    packageId: settings.androidPackageId,
    host: baseUrl.host,
    name: settings.appName,
    launcherName: settings.appShortName,
    display: 'standalone',
    themeColor: '#0f1720',
    themeColorDark: '#0f1720',
    navigationColor: '#0f1720',
    navigationColorDark: '#0f1720',
    navigationDividerColor: '#0f1720',
    navigationDividerColorDark: '#0f1720',
    backgroundColor: '#0f1720',
    enableNotifications: true,
    startUrl: baseUrl.pathname,
    iconUrl: new URL('icons/icon-512.png', settings.publicBaseUrl).toString(),
    maskableIconUrl: new URL('icons/icon-maskable-512.png', settings.publicBaseUrl).toString(),
    splashScreenFadeOutDuration: 300,
    // パスワードは環境変数から渡す。ここには書かない（FR-ANDROID-004）。
    signingKey: {
      path: existing?.signingKey?.path ?? KEYSTORE_PATH,
      alias: existing?.signingKey?.alias ?? 'catch-up-docs',
    },
    appVersion: existing?.appVersion ?? '1.0.0',
    appVersionCode: existing?.appVersionCode ?? 1,
    shortcuts: [],
    generatorApp: 'bubblewrap-cli',
    webManifestUrl: new URL('manifest.webmanifest', settings.publicBaseUrl).toString(),
    fallbackType: 'customtabs',
    features: {},
    alphaDependencies: { enabled: false },
    enableSiteSettingsShortcut: true,
    isChromeOSOnly: false,
    isMetaQuest: false,
    fullScopeUrl: settings.publicBaseUrl,
    minSdkVersion: 26,
    orientation: 'any',
    fingerprints: [],
    additionalTrustedOrigins: [],
    retainedBundles: [],
    displayOverride: [],
  };

  writeJson(TWA_MANIFEST_PATH, manifest);
  console.log('書き出しました：android/twa-manifest.json');
  return manifest;
}

async function ensureKeystore(settings) {
  heading('Android 署名鍵');

  if (existsSync(KEYSTORE_PATH)) {
    console.log(`既存の keystore を見つけました：${KEYSTORE_PATH}`);
    return { path: KEYSTORE_PATH, created: false };
  }

  console.log('release APK の署名鍵がまだありません。');
  console.log('この端末に Java を入れずに済むよう、Docker コンテナ内の keytool で生成します。');
  console.log('');

  if (!commandExists('docker')) {
    printManualKeystoreInstructions(settings);
    return null;
  }

  const shouldCreate = await confirm('いま生成しますか？', true);
  if (!shouldCreate) {
    printManualKeystoreInstructions(settings);
    return null;
  }

  const alias = 'catch-up-docs';
  const password = randomPassword();

  mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });

  execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '--user',
      `${String(process.getuid?.() ?? 0)}:${String(process.getgid?.() ?? 0)}`,
      '-v',
      `${SECRETS_DIR}:/keys`,
      '-e',
      `KS_PASS=${password}`,
      DOCKER_IMAGE,
      'bash',
      '-lc',
      [
        'keytool -genkeypair -v',
        '-keystore /keys/android-release.keystore',
        '-storetype PKCS12',
        `-alias ${alias}`,
        '-keyalg RSA -keysize 4096 -validity 10000',
        `-dname "CN=${settings.appName}, OU=Personal, O=Personal, L=-, ST=-, C=JP"`,
        '-storepass "$KS_PASS" -keypass "$KS_PASS"',
      ].join(' '),
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );

  console.log('');
  console.log(`keystore を生成しました：${KEYSTORE_PATH}`);
  console.log('');
  console.log('  エイリアス:');
  console.log(`    ${alias}`);
  console.log('  パスワード（今だけ表示します）:');
  console.log(`    ${password}`);
  console.log('');
  console.log(
    '  ※ この keystore とパスワードを失うと、既存インストールへ上書き更新できなくなります。',
  );
  console.log('  ※ 暗号化したバックアップを2か所へ保管してください（要件 16.7）。');

  return { path: KEYSTORE_PATH, alias, password, created: true };
}

function printManualKeystoreInstructions(settings) {
  console.log('次のコマンドで生成できます（Docker イメージは npm run android:image で作成）:');
  console.log('');
  console.log(`  mkdir -p ${SECRETS_DIR}`);
  console.log(`  docker run --rm -v "${SECRETS_DIR}:/keys" ${DOCKER_IMAGE} \\`);
  console.log('    keytool -genkeypair -v -keystore /keys/android-release.keystore \\');
  console.log('      -storetype PKCS12 -alias catch-up-docs \\');
  console.log('      -keyalg RSA -keysize 4096 -validity 10000 \\');
  console.log(`      -dname "CN=${settings.appName}, OU=Personal, O=Personal, L=-, ST=-, C=JP"`);
  console.log('');
}

function generateAssetLinks(settings, keystore) {
  heading('Digital Asset Links');

  if (!keystore) {
    console.log(
      '署名鍵が無いため assetlinks.json は生成しません。鍵を作ってから再実行してください。',
    );
    return null;
  }

  const password = keystore.password ?? process.env.BUBBLEWRAP_KEYSTORE_PASSWORD;
  if (!password) {
    console.log(
      'keystore のパスワードが分かりません。次のように環境変数で渡して再実行してください。',
    );
    console.log('  BUBBLEWRAP_KEYSTORE_PASSWORD=… npm run setup');
    return null;
  }

  const alias = keystore.alias ?? 'catch-up-docs';
  const output = execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${SECRETS_DIR}:/keys:ro`,
      '-e',
      `KS_PASS=${password}`,
      DOCKER_IMAGE,
      'bash',
      '-lc',
      `keytool -list -v -keystore /keys/android-release.keystore -alias ${alias} -storepass "$KS_PASS"`,
    ],
    { encoding: 'utf8' },
  );

  const fingerprint = extractSha256Fingerprint(output);
  if (!fingerprint) {
    console.log('署名証明書の SHA-256 を取得できませんでした。');
    return null;
  }

  writeJson(ASSETLINKS_PATH, buildAssetLinks(settings.androidPackageId, fingerprint));

  console.log('書き出しました：public/.well-known/assetlinks.json');
  console.log(`  fingerprint : ${fingerprint}`);
  console.log('');

  const baseUrl = new URL(settings.publicBaseUrl);
  if (baseUrl.pathname !== '/') {
    console.log('  重要：TWA の検証はオリジンのルートしか見ません。');
    console.log(`  ${baseUrl.origin}/.well-known/assetlinks.json が 200 を返すよう、`);
    console.log(`  ${baseUrl.host} のルートを配信するリポジトリへ同じ内容を配置してください。`);
  }

  return fingerprint;
}

async function registerSecrets(settings, vapidPrivateKey, keystore) {
  heading('GitHub Actions Secrets');

  const appRepo = `${settings.githubOwner}/${settings.appRepoName}`;

  if (!commandExists('gh')) {
    printSecretInstructions(appRepo);
    return;
  }

  const shouldRegister = await confirm('gh を使って Secrets を登録しますか？', true);
  if (!shouldRegister) {
    printSecretInstructions(appRepo);
    return;
  }

  const docsRepoName = await ask('文書リポジトリ名（Secrets の登録先。ここでしか使いません）');
  const docsRepo = docsRepoName ? `${settings.githubOwner}/${docsRepoName}` : null;

  /** 値を引数に置かず標準入力で渡す。シェル履歴やプロセス一覧へ残さないため。 */
  const setSecret = (repo, name, value) => {
    execFileSync('gh', ['secret', 'set', name, '--repo', repo], {
      input: value,
      stdio: ['pipe', 'ignore', 'inherit'],
    });
    console.log(`  登録しました：${repo} / ${name}`);
  };

  if (docsRepo && vapidPrivateKey) {
    setSecret(docsRepo, 'VAPID_PRIVATE_KEY', vapidPrivateKey);
    const subject = await ask(
      'VAPID_SUBJECT（mailto: 形式）',
      `mailto:${settings.githubOwner}@users.noreply.github.com`,
    );
    setSecret(docsRepo, 'VAPID_SUBJECT', subject);
  }

  if (docsRepoName) {
    // 公開資産へ文書リポジトリ名が混入していないか CI で検査するために使う。
    setSecret(appRepo, 'PRIVATE_DOCS_REPO_NAME', docsRepoName);
  }

  if (keystore?.created) {
    const keystoreBase64 = readFileSync(keystore.path).toString('base64');
    setSecret(appRepo, 'ANDROID_KEYSTORE_BASE64', keystoreBase64);
    setSecret(appRepo, 'ANDROID_KEYSTORE_PASSWORD', keystore.password);
    setSecret(appRepo, 'ANDROID_KEY_ALIAS', keystore.alias);
    setSecret(appRepo, 'ANDROID_KEY_PASSWORD', keystore.password);
  }
}

function printSecretInstructions(appRepo) {
  console.log('登録すべき Secrets:');
  console.log('');
  console.log(`  ${appRepo}`);
  console.log('    ANDROID_KEYSTORE_BASE64    base64 -w0 <keystore>');
  console.log('    ANDROID_KEYSTORE_PASSWORD');
  console.log('    ANDROID_KEY_ALIAS');
  console.log('    ANDROID_KEY_PASSWORD');
  console.log('    PRIVATE_DOCS_REPO_NAME');
  console.log('');
  console.log('  <GITHUB_OWNER>/<PRIVATE_DOCS_REPO>');
  console.log('    VAPID_PRIVATE_KEY');
  console.log('    VAPID_SUBJECT');
  console.log('');
  console.log('登録コマンドの例（値は対話入力になり、シェル履歴へ残りません）:');
  console.log(`  gh secret set ANDROID_KEYSTORE_PASSWORD --repo ${appRepo}`);
}

function runSecretScan() {
  heading('秘密情報の混入検査');
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'verify-no-secrets.mjs')], {
    stdio: 'inherit',
    cwd: ROOT,
  });
  if (result.status !== 0) {
    console.error('検査に失敗しました。指摘された箇所を取り除いてから再実行してください。');
    process.exitCode = 1;
  }
}

// ── エントリポイント ────────────────────────────────────────

async function main() {
  console.log('catch-up-docs セットアップ');
  console.log('入力した内容のうち、秘密情報はリポジトリへ書き込みません。');

  const existingConfig = readJsonIfExists(RUNTIME_CONFIG_PATH);

  const settings = await collectBasicSettings(existingConfig);
  const vapid = await resolveVapidKeys(existingConfig);

  writeRuntimeConfig(settings, vapid.publicKey);
  writeTwaManifest(settings);

  const keystore = await ensureKeystore(settings);
  generateAssetLinks(settings, keystore);
  await registerSecrets(settings, vapid.privateKey, keystore);

  runSecretScan();

  heading('次にすること');
  console.log('  1. docs/SETUP.md の残りの手順を実施する');
  console.log(
    '  2. Fine-grained PAT を発行する（対象は文書リポジトリ1つ、Contents: Read-only のみ）',
  );
  console.log('  3. 公開URLを開き、初期設定ウィザードを完了する');
  console.log('  4. 設定画面から通知を有効化し、登録ワークフローを実行する');
  console.log('');
}

try {
  await main();
} finally {
  rl.close();
}
