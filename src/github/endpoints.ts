/**
 * GitHub REST API の URL とヘッダーの唯一の定義箇所（FR-GH-001 / FR-GH-002）。
 *
 * API バージョンが上がったときに直す場所をここ 1 箇所に保つ。
 * `download_url` は使わない。失効し得るため、毎回 Contents API を叩く（FR-GH-007）。
 */

import { GITHUB_ACCEPT_RAW, GITHUB_API_ORIGIN, GITHUB_API_VERSION } from '../config/constants';

/**
 * パスを URL へ埋め込む。
 * スラッシュは区切りとして残し、各セグメントだけを符号化する。
 * 日本語のファイル名や空白を含むパスでも壊れない。
 */
export function encodeContentPath(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export interface ContentsUrlParams {
  owner: string;
  repo: string;
  path: string;
  ref: string;
}

export function buildContentsUrl({ owner, repo, path, ref }: ContentsUrlParams): string {
  const encodedOwner = encodeURIComponent(owner);
  const encodedRepo = encodeURIComponent(repo);
  const encodedPath = encodeContentPath(path);

  return `${GITHUB_API_ORIGIN}/repos/${encodedOwner}/${encodedRepo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
}

/**
 * 認証ヘッダー。PAT はここでしか組み立てない。
 * URL のクエリへ載せない（ログや Referer から漏れるため）。
 */
export function buildHeaders(personalAccessToken: string, etag?: string): Headers {
  const headers = new Headers({
    Accept: GITHUB_ACCEPT_RAW,
    Authorization: `Bearer ${personalAccessToken}`,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  });

  // FR-DASH-003：manifest の再取得では ETag を使って転送量を抑える。
  if (etag) {
    headers.set('If-None-Match', etag);
  }

  return headers;
}
