#!/usr/bin/env node
/**
 * Web Push 用の VAPID 鍵ペアを生成する。
 *
 * web-push パッケージを持ち込まずに Node 標準の Web Crypto だけで作る。
 * VAPID は P-256 の鍵ペアで、公開鍵は非圧縮形式（65バイト）の base64url、
 * 秘密鍵は 32 バイトのスカラーの base64url として扱う。
 *
 *   node scripts/generate-vapid.mjs            # 標準出力へ表示
 *   node scripts/generate-vapid.mjs --json     # JSON で出力
 *
 * 秘密鍵はファイルへ書き出さない。表示された値をただちに GitHub Actions Secret
 * （文書リポジトリの VAPID_PRIVATE_KEY）へ登録し、端末には残さないこと。
 */

import { webcrypto } from 'node:crypto';

/** @param {ArrayBuffer | Uint8Array} input */
function toBase64Url(input) {
  return Buffer.from(input instanceof Uint8Array ? input : new Uint8Array(input))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function generateVapidKeys() {
  const keyPair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);

  const rawPublicKey = await webcrypto.subtle.exportKey('raw', keyPair.publicKey);
  const jwkPrivateKey = await webcrypto.subtle.exportKey('jwk', keyPair.privateKey);

  if (!jwkPrivateKey.d) {
    throw new Error('秘密鍵の取り出しに失敗しました');
  }

  return {
    // 65 バイトの非圧縮 EC ポイント。pushManager.subscribe へ渡す値。
    publicKey: toBase64Url(rawPublicKey),
    // jwk.d はすでに base64url。
    privateKey: jwkPrivateKey.d,
  };
}

async function main() {
  const keys = await generateVapidKeys();

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(keys)}\n`);
    return;
  }

  console.log('VAPID 鍵ペアを生成しました。');
  console.log('');
  console.log('  公開鍵（秘密ではない。runtime-config.json と push-config.json へ設定する）:');
  console.log(`    ${keys.publicKey}`);
  console.log('');
  console.log('  秘密鍵（文書リポジトリの Actions Secret VAPID_PRIVATE_KEY へ登録する）:');
  console.log(`    ${keys.privateKey}`);
  console.log('');
  console.log('登録コマンドの例:');
  console.log('  gh secret set VAPID_PRIVATE_KEY --repo <GITHUB_OWNER>/<PRIVATE_DOCS_REPO>');
  console.log('');
  console.log(
    '注意：秘密鍵を変更すると既存の購読はすべて無効になり、全端末で再登録が必要になります。',
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
