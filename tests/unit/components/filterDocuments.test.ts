import { describe, expect, it } from 'vitest';

import { filterDocuments } from '@/components/Dashboard';
import type { ManifestDocument } from '@/github/manifestSchema';

function document(overrides: Partial<ManifestDocument>): ManifestDocument {
  return {
    id: 'doc_0000000000000001',
    path: 'documents/a.html',
    title: 'タイトル',
    description: '説明',
    tags: [],
    addedAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    sizeBytes: 100,
    gitBlobSha: 'b'.repeat(40),
    contentSha256: 'c'.repeat(64),
    ...overrides,
  };
}

describe('検索（FR-DASH-002）', () => {
  const documents = [
    document({ id: 'doc_0000000000000001', title: '八月の議事録', description: '定例の記録' }),
    document({ id: 'doc_0000000000000002', title: 'Release Notes', description: 'Version 2.0' }),
    document({ id: 'doc_0000000000000003', title: '報告書', tags: ['重要', '2026年'] }),
  ];

  it('空の検索語ならすべて返す', () => {
    expect(filterDocuments(documents, '')).toHaveLength(3);
    expect(filterDocuments(documents, '   ')).toHaveLength(3);
  });

  it('タイトルの部分一致で絞る', () => {
    expect(filterDocuments(documents, '議事')).toHaveLength(1);
  });

  it('説明の部分一致で絞る', () => {
    expect(filterDocuments(documents, '定例')).toHaveLength(1);
  });

  it('タグの部分一致で絞る', () => {
    expect(filterDocuments(documents, '重要')).toHaveLength(1);
  });

  it('大文字小文字を区別しない', () => {
    expect(filterDocuments(documents, 'release')).toHaveLength(1);
    expect(filterDocuments(documents, 'RELEASE')).toHaveLength(1);
  });

  it('一致しなければ空になる', () => {
    expect(filterDocuments(documents, '存在しない語')).toHaveLength(0);
  });

  it('パスは検索対象にしない（画面に出さない情報のため）', () => {
    expect(filterDocuments(documents, 'documents/a.html')).toHaveLength(0);
  });

  it('元の配列を変更しない', () => {
    const copy = [...documents];
    filterDocuments(documents, '議事');
    expect(documents).toEqual(copy);
  });
});
