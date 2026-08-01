import { describe, expect, it } from 'vitest';

import {
  countUnread,
  emptyReadState,
  isUnread,
  markAsRead,
  pruneReadState,
} from '@/storage/readState';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const NOW = Date.UTC(2026, 7, 1, 0, 0, 0);

describe('未読判定（FR-DASH-004）', () => {
  it('初めて出現した文書は未読', () => {
    expect(isUnread(emptyReadState(), 'doc_0000000000000001', HASH_A)).toBe(true);
  });

  it('表示に成功したら既読になる', () => {
    const state = markAsRead(emptyReadState(), 'doc_0000000000000001', HASH_A, NOW);
    expect(isUnread(state, 'doc_0000000000000001', HASH_A)).toBe(false);
  });

  it('内容が変わったら未読へ戻る', () => {
    const state = markAsRead(emptyReadState(), 'doc_0000000000000001', HASH_A, NOW);
    expect(isUnread(state, 'doc_0000000000000001', HASH_B)).toBe(true);
  });

  it('別の文書の既読は影響しない', () => {
    const state = markAsRead(emptyReadState(), 'doc_0000000000000001', HASH_A, NOW);
    expect(isUnread(state, 'doc_0000000000000002', HASH_A)).toBe(true);
  });

  it('既読にすると読んだ時刻を保持する', () => {
    const state = markAsRead(emptyReadState(), 'doc_0000000000000001', HASH_A, NOW);
    expect(state.entries.doc_0000000000000001).toEqual({ contentSha256: HASH_A, readAt: NOW });
  });
});

describe('未読件数', () => {
  it('未読の文書だけを数える', () => {
    const state = markAsRead(emptyReadState(), 'doc_0000000000000001', HASH_A, NOW);
    const documents = [
      { id: 'doc_0000000000000001', contentSha256: HASH_A },
      { id: 'doc_0000000000000002', contentSha256: HASH_A },
      { id: 'doc_0000000000000003', contentSha256: HASH_B },
    ];
    expect(countUnread(state, documents)).toBe(2);
  });

  it('文書が無ければ0件', () => {
    expect(countUnread(emptyReadState(), [])).toBe(0);
  });
});

describe('既読情報の整理', () => {
  it('manifest から消えた文書の既読情報を捨てる', () => {
    let state = emptyReadState();
    state = markAsRead(state, 'doc_0000000000000001', HASH_A, NOW);
    state = markAsRead(state, 'doc_0000000000000002', HASH_B, NOW);

    const pruned = pruneReadState(state, ['doc_0000000000000001']);
    expect(Object.keys(pruned.entries)).toEqual(['doc_0000000000000001']);
  });

  it('残る文書の既読情報は保つ', () => {
    const state = markAsRead(emptyReadState(), 'doc_0000000000000001', HASH_A, NOW);
    const pruned = pruneReadState(state, ['doc_0000000000000001', 'doc_0000000000000002']);
    expect(isUnread(pruned, 'doc_0000000000000001', HASH_A)).toBe(false);
  });
});
