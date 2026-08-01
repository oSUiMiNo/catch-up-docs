/**
 * ManifestSchema v1（8.1）のクライアント側検証。
 *
 * 文書リポジトリ側の生成規則と同じ制約を課す。合わなければ表示しない
 * （SEC-009 fail closed）。緩めるとアプリ側だけが壊れたデータを受け入れてしまう。
 */

import { z } from 'zod';

import {
  DOCUMENTS_DIRECTORY,
  MAX_DOCUMENTS,
  MAX_DOCUMENT_BYTES,
  SUPPORTED_MANIFEST_SCHEMA_VERSIONS,
} from '../config/constants';

const utcIso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

const documentPath = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => value.startsWith(`${DOCUMENTS_DIRECTORY}/`))
  .refine((value) => !value.startsWith('/'))
  .refine((value) => !value.split('/').includes('..'));

export const manifestDocumentSchema = z.object({
  id: z.string().regex(/^doc_[0-9a-f]{16}$/),
  path: documentPath,
  title: z.string().min(1).max(200),
  description: z.string().max(500),
  tags: z.array(z.string().min(1).max(40)).max(10),
  addedAt: utcIso,
  updatedAt: utcIso,
  sizeBytes: z.number().int().min(1).max(MAX_DOCUMENT_BYTES),
  gitBlobSha: z.string().min(7).max(64),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const manifestSchema = z.object({
  schemaVersion: z.literal(SUPPORTED_MANIFEST_SCHEMA_VERSIONS[0]),
  generatedAt: utcIso,
  sourceCommitSha: z.string().regex(/^[0-9a-f]{40}$/),
  documents: z.array(manifestDocumentSchema).max(MAX_DOCUMENTS),
});

export type ManifestDocument = z.infer<typeof manifestDocumentSchema>;
export type Manifest = z.infer<typeof manifestSchema>;

/**
 * FR-DASH-001 の並び順：addedAt 降順、同値なら path 昇順。
 * 生成側でも同じ順に並べているが、受け取った側でも保証しておく。
 */
export function sortDocuments(documents: readonly ManifestDocument[]): ManifestDocument[] {
  return [...documents].sort((a, b) => {
    if (a.addedAt !== b.addedAt) {
      return a.addedAt < b.addedAt ? 1 : -1;
    }
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}

/** 検証に通れば manifest を返す。通らなければ null。 */
export function parseManifest(value: unknown): Manifest | null {
  const result = manifestSchema.safeParse(value);
  return result.success ? result.data : null;
}
