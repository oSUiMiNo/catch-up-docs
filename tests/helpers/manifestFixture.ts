/**
 * テスト用の manifest と文書の組み立て。
 * contentSha256 は実際に計算するため、ハッシュ照合の経路も本物で試せる。
 */

import type { Manifest, ManifestDocument } from '@/github/manifestSchema';

export const SOURCE_COMMIT_SHA = 'a'.repeat(40);

export async function sha256HexOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function documentIdOf(path: string): Promise<string> {
  return sha256HexOf(path).then((hex) => `doc_${hex.slice(0, 16)}`);
}

export async function buildDocumentEntry(
  path: string,
  html: string,
  overrides: Partial<ManifestDocument> = {},
): Promise<ManifestDocument> {
  return {
    id: await documentIdOf(path),
    path,
    title: 'テスト文書',
    description: '説明',
    tags: ['テスト'],
    addedAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    sizeBytes: new TextEncoder().encode(html).byteLength,
    gitBlobSha: 'b'.repeat(40),
    contentSha256: await sha256HexOf(html),
    ...overrides,
  };
}

export function buildManifest(documents: ManifestDocument[]): Manifest {
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-01T00:00:00Z',
    sourceCommitSha: SOURCE_COMMIT_SHA,
    documents,
  };
}
