/**
 * Vitest 共通セットアップ。
 *
 * jsdom には Web Crypto の subtle が無く、IndexedDB も実装されていない。
 * 実装と同じ API 面で試験できるよう、Node の実装を差し込む。
 */

import { webcrypto } from 'node:crypto';

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';

// jsdom の crypto には subtle が無いため Node の Web Crypto を使う。
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

// structuredClone は CryptoKey の保存テストで必要になる。
if (typeof globalThis.structuredClone !== 'function') {
  throw new Error('structuredClone が利用できません。Node 24 以上で実行してください。');
}

afterEach(() => {
  // globals: false で動かしているため Testing Library の自動片付けが登録されない。
  // 明示的に呼ばないと、描画した要素が次のテストへ残る。
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

// IndexedDB を使うテストは、開いている接続を閉じてから消す必要があるため、
// 各テストファイル側で storage/db.ts の destroyDatabase() を呼ぶ。
