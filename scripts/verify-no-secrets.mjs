#!/usr/bin/env node
/**
 * 公開資産へ秘密情報が混入していないか検査する（SEC-002 / AC-002 / AC-017）。
 *
 * 検査対象は git の追跡対象ファイルと、存在すればビルド成果物 dist/。
 * 検出したらプロセスを異常終了させ、CI を失敗させる。
 *
 *   npm run verify:secrets
 *
 * 環境変数 PRIVATE_DOCS_REPO_NAME を渡すと、その文字列が公開資産へ現れていないかも
 * 検査する。値そのものは決してログへ出さない。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 検査から除外する。スキャナ自身とその説明文には検出パターンの断片が載るため。 */
const EXCLUDED_PATHS = [
  'scripts/verify-no-secrets.mjs',
  'tests/unit/scripts/verify-no-secrets.test.ts',
  'package-lock.json',
];

const EXCLUDED_DIRS = ['node_modules', '.git', 'coverage', 'playwright-report', 'test-results'];

/** バイナリを読み込まないための拡張子フィルタ。 */
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.zip',
  '.apk',
  '.aab',
  '.jar',
  '.keystore',
  '.jks',
]);

/**
 * 検出パターン。パターン文字列自体がこのファイルへ現れるが、
 * このファイルは検査対象から除外している。
 */
export const SECRET_PATTERNS = [
  {
    id: 'github-fine-grained-pat',
    // 実物は github_pat_ で始まる長い文字列。断片化して自己検出を避ける。
    pattern: new RegExp(`${'github'}_${'pat'}_[A-Za-z0-9_]{20,}`),
    message: 'GitHub Fine-grained PAT らしき文字列',
  },
  {
    id: 'github-classic-pat',
    pattern: new RegExp(`${'gh'}[pousr]_[A-Za-z0-9]{30,}`),
    message: 'GitHub Classic PAT らしき文字列',
  },
  {
    id: 'private-key-header',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    message: '秘密鍵のヘッダー',
  },
  {
    id: 'pkcs12-header',
    pattern: /-----BEGIN CERTIFICATE-----[\s\S]{0,64}-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    message: '証明書と秘密鍵の同梱',
  },
  {
    id: 'aws-access-key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    message: 'AWS アクセスキー ID らしき文字列',
  },
  {
    id: 'slack-token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
    message: 'Slack トークンらしき文字列',
  },
];

/** 存在自体が禁止されるファイル。 */
export const FORBIDDEN_FILE_PATTERNS = [
  { pattern: /(^|\/)\.env$/, message: '.env の実ファイル' },
  { pattern: /(^|\/)\.env\.(?!example$)[^/]+$/, message: '.env.* の実ファイル' },
  { pattern: /\.(keystore|jks|p12|pfx)$/i, message: 'キーストア' },
  { pattern: /\.(pem|key)$/i, message: '鍵ファイル' },
  { pattern: /(^|\/)google-services\.json$/, message: 'Firebase 設定ファイル' },
];

/**
 * 1ファイル分の内容を検査する。
 * @param {string} relativePath
 * @param {string} content
 * @param {string | undefined} privateRepoName
 * @returns {{path: string, reason: string}[]}
 */
export function inspectContent(relativePath, content, privateRepoName) {
  /** @type {{path: string, reason: string}[]} */
  const findings = [];

  for (const { pattern, message } of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({ path: relativePath, reason: message });
    }
  }

  // AC-002：公開資産へ文書リポジトリ名を残さない。値はログへ出さない。
  if (privateRepoName && privateRepoName.length >= 4 && content.includes(privateRepoName)) {
    findings.push({ path: relativePath, reason: '文書リポジトリ名（値は表示しない）' });
  }

  return findings;
}

/**
 * ファイル名だけで判定できる違反を検査する。
 * @param {string} relativePath
 */
export function inspectPath(relativePath) {
  for (const { pattern, message } of FORBIDDEN_FILE_PATTERNS) {
    if (pattern.test(relativePath)) {
      return { path: relativePath, reason: message };
    }
  }
  return null;
}

function listTrackedFiles() {
  try {
    const output = execFileSync('git', ['ls-files', '-z'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.split('\0').filter((entry) => entry.length > 0);
  } catch {
    return [];
  }
}

function listDirectoryFiles(directory) {
  /** @type {string[]} */
  const results = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      if (EXCLUDED_DIRS.includes(entry)) {
        continue;
      }
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        results.push(relative(ROOT, full));
      }
    }
  };
  if (existsSync(directory)) {
    walk(directory);
  }
  return results;
}

function isBinary(relativePath) {
  const dot = relativePath.lastIndexOf('.');
  return dot >= 0 && BINARY_EXTENSIONS.has(relativePath.slice(dot).toLowerCase());
}

function main() {
  const privateRepoName = process.env.PRIVATE_DOCS_REPO_NAME?.trim();

  const targets = new Set([...listTrackedFiles(), ...listDirectoryFiles(join(ROOT, 'dist'))]);

  /** @type {{path: string, reason: string}[]} */
  const findings = [];

  for (const relativePath of targets) {
    if (EXCLUDED_PATHS.includes(relativePath)) {
      continue;
    }

    const pathFinding = inspectPath(relativePath);
    if (pathFinding) {
      findings.push(pathFinding);
      continue;
    }

    if (isBinary(relativePath)) {
      continue;
    }

    const absolute = join(ROOT, relativePath);
    if (!existsSync(absolute)) {
      continue;
    }

    let content;
    try {
      content = readFileSync(absolute, 'utf8');
    } catch {
      continue;
    }

    findings.push(...inspectContent(relativePath, content, privateRepoName));
  }

  if (findings.length > 0) {
    console.error('秘密情報スキャン：検出されました。公開資産から取り除いてください。');
    for (const finding of findings) {
      console.error(`  ${finding.path}: ${finding.reason}`);
    }
    process.exitCode = 1;
    return;
  }

  const scope = privateRepoName ? '（文書リポジトリ名の混入検査を含む）' : '';
  console.log(`秘密情報スキャン：${String(targets.size)} 件を検査し、問題はありません${scope}。`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
