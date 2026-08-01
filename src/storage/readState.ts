/**
 * 既読状態の暗号化保存（FR-DASH-004）。
 *
 * 既読かどうかは document id と、既読にした時点の contentSha256 の組で決める。
 * 内容が変われば hash が変わるので、自動的に未読へ戻る。
 */

import { z } from 'zod';

import { RECORD_READ_STATE } from '../config/constants';
import { decryptJson, encryptJson, type EncryptedPayload } from '../crypto/aesGcm';
import { deleteRecord, getRecord, setRecord } from './db';

const readEntrySchema = z.object({
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  readAt: z.number().int().nonnegative(),
});

const readStateSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.record(z.string(), readEntrySchema),
});

export type ReadEntry = z.infer<typeof readEntrySchema>;
export type ReadState = z.infer<typeof readStateSchema>;

export function emptyReadState(): ReadState {
  return { schemaVersion: 1, entries: {} };
}

export async function loadReadState(masterKey: CryptoKey): Promise<ReadState> {
  const stored = await getRecord<EncryptedPayload>(RECORD_READ_STATE);
  if (!stored) {
    return emptyReadState();
  }

  const decrypted = await decryptJson<unknown>(masterKey, RECORD_READ_STATE, stored);
  const parsed = readStateSchema.safeParse(decrypted);
  // 既読状態が壊れていても致命的ではない。全件未読として作り直す。
  return parsed.success ? parsed.data : emptyReadState();
}

export async function saveReadState(masterKey: CryptoKey, state: ReadState): Promise<void> {
  await setRecord(RECORD_READ_STATE, await encryptJson(masterKey, RECORD_READ_STATE, state));
}

export async function deleteReadState(): Promise<void> {
  await deleteRecord(RECORD_READ_STATE);
}

/**
 * 未読かどうかを判定する（FR-DASH-004）。
 *
 * 次のいずれかなら未読。
 *   - 初めて出現した document id
 *   - 既読にしたときから contentSha256 が変わっている
 */
export function isUnread(state: ReadState, documentId: string, contentSha256: string): boolean {
  const entry = state.entries[documentId];
  if (!entry) {
    return true;
  }
  return entry.contentSha256 !== contentSha256;
}

/** 表示に成功した時点で既読にする。 */
export function markAsRead(
  state: ReadState,
  documentId: string,
  contentSha256: string,
  readAt: number,
): ReadState {
  return {
    ...state,
    entries: { ...state.entries, [documentId]: { contentSha256, readAt } },
  };
}

/**
 * manifest から消えた文書の既読情報を捨てる。
 * 放置すると際限なく増えるため、同期のたびに整理する。
 */
export function pruneReadState(state: ReadState, knownDocumentIds: readonly string[]): ReadState {
  const known = new Set(knownDocumentIds);
  const entries: Record<string, ReadEntry> = {};
  for (const [documentId, entry] of Object.entries(state.entries)) {
    if (known.has(documentId)) {
      entries[documentId] = entry;
    }
  }
  return { ...state, entries };
}

/** 未読件数。ダッシュボードのバッジに使う。 */
export function countUnread(
  state: ReadState,
  documents: readonly { id: string; contentSha256: string }[],
): number {
  return documents.filter((document) => isUnread(state, document.id, document.contentSha256))
    .length;
}
