#!/usr/bin/env node
/**
 * Digital Asset Links ファイルを生成する（FR-ANDROID-003）。
 *
 *   node scripts/generate-assetlinks.mjs --fingerprint <SHA-256> [--package-id <id>]
 *   node scripts/generate-assetlinks.mjs --keystore <path> --alias <alias>   # keytool 経由
 *
 * 生成先は public/.well-known/assetlinks.json。
 *
 * 重要：このファイルは配信オリジンのルートで HTTP 200 を返す必要がある。
 * PWA をサブパス（例 /catch-up-docs/）で配信する構成では、Pages のルートを持つ
 * ユーザーサイトリポジトリ側へ同じ内容を配置しなければ TWA の検証が通らない。
 * 配置手順は docs/ANDROID_INSTALL.md を参照。
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = join(ROOT, 'public', '.well-known', 'assetlinks.json');

const FINGERPRINT_PATTERN = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/**
 * @param {string[]} argv
 * @returns {Record<string, string | boolean>}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      i += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

/**
 * keytool の出力から release 署名証明書の SHA-256 を取り出す。
 * @param {string} keytoolOutput
 * @returns {string | null}
 */
export function extractSha256Fingerprint(keytoolOutput) {
  const match = /SHA256:\s*((?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2})/.exec(keytoolOutput);
  return match ? match[1].toUpperCase() : null;
}

/**
 * assetlinks.json の中身を組み立てる。
 * @param {string} packageId
 * @param {string} fingerprint
 */
export function buildAssetLinks(packageId, fingerprint) {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageId,
        sha256_cert_fingerprints: [fingerprint],
      },
    },
  ];
}

function readPackageIdFromRuntimeConfig() {
  try {
    const raw = readFileSync(join(ROOT, 'public', 'runtime-config.json'), 'utf8');
    return JSON.parse(raw).androidPackageId;
  } catch {
    return undefined;
  }
}

function readFingerprintFromKeystore(keystorePath, alias) {
  const password = process.env.BUBBLEWRAP_KEYSTORE_PASSWORD;
  if (!password) {
    throw new Error(
      'keystore を読むには環境変数 BUBBLEWRAP_KEYSTORE_PASSWORD が必要です。' +
        'シェル履歴へ残さない方法で渡してください。',
    );
  }
  const output = execFileSync(
    'keytool',
    ['-list', '-v', '-keystore', keystorePath, '-alias', alias, '-storepass', password],
    { encoding: 'utf8' },
  );
  const fingerprint = extractSha256Fingerprint(output);
  if (!fingerprint) {
    throw new Error('keytool の出力から SHA-256 を取得できませんでした。');
  }
  return fingerprint;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const packageId = String(args['package-id'] ?? readPackageIdFromRuntimeConfig() ?? '');
  if (!packageId) {
    console.error('package ID を特定できません。--package-id を指定してください。');
    process.exitCode = 1;
    return;
  }

  let fingerprint;
  if (typeof args.fingerprint === 'string') {
    fingerprint = args.fingerprint.toUpperCase();
  } else if (typeof args.keystore === 'string' && typeof args.alias === 'string') {
    fingerprint = readFingerprintFromKeystore(args.keystore, args.alias);
  } else {
    console.error('--fingerprint か、--keystore と --alias の組を指定してください。');
    process.exitCode = 1;
    return;
  }

  if (!FINGERPRINT_PATTERN.test(fingerprint)) {
    console.error('SHA-256 fingerprint の形式が不正です（AA:BB:... の32バイト表記）。');
    process.exitCode = 1;
    return;
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(
    OUTPUT_PATH,
    `${JSON.stringify(buildAssetLinks(packageId, fingerprint), null, 2)}\n`,
  );

  console.log('生成しました：public/.well-known/assetlinks.json');
  console.log(`  package ID  : ${packageId}`);
  console.log(`  fingerprint : ${fingerprint}`);
  console.log('');
  console.log(
    'この内容を、配信オリジンのルートを持つリポジトリの .well-known/ へも配置してください。',
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
