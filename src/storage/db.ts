/**
 * IndexedDB への入り口（8.2.1）。
 *
 * ストアは3つ。
 *   appMeta          … 平文で構わない状態（失敗回数、時計の観測値）
 *   encryptedRecords … 暗号化した値と、その封筒
 *   cryptoKeys       … 取り出し不可の CryptoKey そのもの
 *
 * manifest と文書本文はここへ保存しない（8.2.2）。
 */

import { openDB, deleteDB, type DBSchema, type IDBPDatabase } from 'idb';

import {
  DB_NAME,
  DB_VERSION,
  STORE_APP_META,
  STORE_CRYPTO_KEYS,
  STORE_ENCRYPTED_RECORDS,
} from '../config/constants';

interface CatchUpDocsDB extends DBSchema {
  [STORE_APP_META]: { key: string; value: unknown };
  [STORE_ENCRYPTED_RECORDS]: { key: string; value: unknown };
  [STORE_CRYPTO_KEYS]: { key: string; value: CryptoKey };
}

let databasePromise: Promise<IDBPDatabase<CatchUpDocsDB>> | null = null;

function openDatabase(): Promise<IDBPDatabase<CatchUpDocsDB>> {
  return openDB<CatchUpDocsDB>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE_APP_META)) {
        database.createObjectStore(STORE_APP_META);
      }
      if (!database.objectStoreNames.contains(STORE_ENCRYPTED_RECORDS)) {
        database.createObjectStore(STORE_ENCRYPTED_RECORDS);
      }
      if (!database.objectStoreNames.contains(STORE_CRYPTO_KEYS)) {
        database.createObjectStore(STORE_CRYPTO_KEYS);
      }
    },
  });
}

export async function getDatabase(): Promise<IDBPDatabase<CatchUpDocsDB>> {
  databasePromise ??= openDatabase();
  return databasePromise;
}

// ── appMeta ────────────────────────────────────────────────

export async function getMeta<T>(key: string): Promise<T | null> {
  const database = await getDatabase();
  return ((await database.get(STORE_APP_META, key)) as T | undefined) ?? null;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const database = await getDatabase();
  await database.put(STORE_APP_META, value, key);
}

export async function deleteMeta(key: string): Promise<void> {
  const database = await getDatabase();
  await database.delete(STORE_APP_META, key);
}

// ── encryptedRecords ───────────────────────────────────────

export async function getRecord<T>(key: string): Promise<T | null> {
  const database = await getDatabase();
  return ((await database.get(STORE_ENCRYPTED_RECORDS, key)) as T | undefined) ?? null;
}

export async function setRecord(key: string, value: unknown): Promise<void> {
  const database = await getDatabase();
  await database.put(STORE_ENCRYPTED_RECORDS, value, key);
}

export async function deleteRecord(key: string): Promise<void> {
  const database = await getDatabase();
  await database.delete(STORE_ENCRYPTED_RECORDS, key);
}

// ── cryptoKeys ─────────────────────────────────────────────

export async function getStoredKey(key: string): Promise<CryptoKey | null> {
  const database = await getDatabase();
  return (await database.get(STORE_CRYPTO_KEYS, key)) ?? null;
}

export async function setStoredKey(key: string, value: CryptoKey): Promise<void> {
  const database = await getDatabase();
  await database.put(STORE_CRYPTO_KEYS, value, key);
}

// ── 全消去 ─────────────────────────────────────────────────

/** アプリのリセット（FR-SETTINGS-004）。データベースごと消す。 */
export async function destroyDatabase(): Promise<void> {
  if (databasePromise) {
    const database = await databasePromise;
    database.close();
    databasePromise = null;
  }
  await deleteDB(DB_NAME);
}

/** テスト用。接続キャッシュだけを捨てる。 */
export function resetDatabaseHandleForTest(): void {
  databasePromise = null;
}
