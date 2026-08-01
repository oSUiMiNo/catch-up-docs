#!/usr/bin/env node
/**
 * production ビルドの JS/CSS 合計サイズ（gzip 後）を検査する（NFR-001）。
 *
 *   npm run check:bundle-size
 *
 * 目標は 500 KB 以下。超えた場合は CI を失敗させ、どのファイルが大きいかを示す。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/** NFR-001：production JS bundle 合計 500 KB gzip 以下を目標とする。 */
const LIMIT_BYTES = 500 * 1024;
const MEASURED_EXTENSIONS = ['.js', '.css'];

function collectFiles(directory) {
  /** @type {string[]} */
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        files.push(full);
      }
    }
  };
  walk(directory);
  return files;
}

function formatKilobytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function main() {
  if (!existsSync(DIST)) {
    console.error('dist/ がありません。先に npm run build を実行してください。');
    process.exitCode = 1;
    return;
  }

  const measured = collectFiles(DIST)
    .filter((file) => MEASURED_EXTENSIONS.some((extension) => file.endsWith(extension)))
    .map((file) => ({
      path: relative(DIST, file),
      gzipBytes: gzipSync(readFileSync(file), { level: 9 }).length,
    }))
    .sort((a, b) => b.gzipBytes - a.gzipBytes);

  const total = measured.reduce((sum, entry) => sum + entry.gzipBytes, 0);

  console.log('gzip 後のサイズ（大きい順）:');
  for (const entry of measured) {
    console.log(`  ${formatKilobytes(entry.gzipBytes).padStart(10)}  ${entry.path}`);
  }
  console.log('');
  console.log(`  合計 ${formatKilobytes(total)} / 上限 ${formatKilobytes(LIMIT_BYTES)}`);

  if (total > LIMIT_BYTES) {
    console.error('');
    console.error('バンドルサイズが上限を超えています（NFR-001）。');
    process.exitCode = 1;
    return;
  }

  console.log('バンドルサイズは上限内です。');
}

main();
