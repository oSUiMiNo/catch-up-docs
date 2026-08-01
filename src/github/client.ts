/**
 * GitHub Contents API のクライアント（7.4）。
 *
 * 守っていること:
 *   - PAT は Authorization ヘッダーにしか載せない（URL・ログ・例外に出さない）
 *   - 文書は manifest の sourceCommitSha を ref にして取る（FR-GH-003）
 *   - 5xx とネットワークエラーだけ最大2回まで指数バックオフで再試行（FR-GH-006）
 *   - 取得後に SHA-256 を照合し、合わなければ本文を返さない（FR-GH-005 / AC-015）
 */

import {
  GITHUB_MAX_RETRIES,
  GITHUB_RETRY_BASE_DELAY_MS,
  GITHUB_RETRY_MAX_DELAY_MS,
  MAX_DOCUMENT_BYTES,
} from '../config/constants';
import { sha256Hex } from '../crypto/sha256';
import type { AppConfig } from '../storage/appConfig';
import { buildContentsUrl, buildHeaders } from './endpoints';
import { AppError, classifyHttpStatus, isRetryableStatus } from './errors';
import {
  parseManifest,
  sortDocuments,
  type Manifest,
  type ManifestDocument,
} from './manifestSchema';

export interface FetchManifestResult {
  status: 'ok' | 'not-modified';
  manifest: Manifest | null;
  etag: string | null;
  httpStatus: number;
}

interface RequestOptions {
  signal?: AbortSignal;
  etag?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 再試行つきの fetch。
 * 401・403・404・422 は即座に返す。再試行しても結果が変わらないため。
 */
async function fetchWithRetry(
  url: string,
  headers: Headers,
  options: RequestOptions,
): Promise<Response> {
  let lastError: AppError = new AppError('E-NET-001');

  for (let attempt = 0; attempt <= GITHUB_MAX_RETRIES; attempt += 1) {
    let response: Response;
    try {
      const init: RequestInit = { headers, credentials: 'omit', redirect: 'follow' };
      if (options.signal) {
        init.signal = options.signal;
      }
      response = await fetch(url, init);
    } catch {
      // ネットワークエラー。再試行の対象。
      lastError = new AppError('E-NET-001');
      if (attempt < GITHUB_MAX_RETRIES) {
        await sleep(backoffDelay(attempt, null));
        continue;
      }
      throw lastError;
    }

    if (response.ok || response.status === 304) {
      return response;
    }

    if (!isRetryableStatus(response.status)) {
      throw new AppError(classifyHttpStatus(response.status), response.status);
    }

    lastError = new AppError(classifyHttpStatus(response.status), response.status);
    if (attempt < GITHUB_MAX_RETRIES) {
      await sleep(backoffDelay(attempt, response.headers.get('Retry-After')));
    }
  }

  throw lastError;
}

/** 指数バックオフ。Retry-After があれば尊重する（FR-GH-006）。 */
function backoffDelay(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, GITHUB_RETRY_MAX_DELAY_MS);
    }
  }
  return Math.min(GITHUB_RETRY_BASE_DELAY_MS * 2 ** attempt, GITHUB_RETRY_MAX_DELAY_MS);
}

/**
 * manifest を取得する。
 * ETag を渡すと 304 が返り得る。その場合は本文を読まない（FR-DASH-003）。
 */
export async function fetchManifest(
  config: AppConfig,
  options: RequestOptions = {},
): Promise<FetchManifestResult> {
  const url = buildContentsUrl({
    owner: config.owner,
    repo: config.repo,
    path: config.manifestPath,
    ref: config.branch,
  });

  const response = await fetchWithRetry(
    url,
    buildHeaders(config.personalAccessToken, options.etag),
    options,
  );

  if (response.status === 304) {
    return { status: 'not-modified', manifest: null, etag: options.etag ?? null, httpStatus: 304 };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await response.text());
  } catch {
    throw new AppError('E-MAN-001', response.status);
  }

  const manifest = parseManifest(raw);
  if (!manifest) {
    throw new AppError('E-MAN-001', response.status);
  }

  return {
    status: 'ok',
    manifest: { ...manifest, documents: sortDocuments(manifest.documents) },
    etag: response.headers.get('ETag'),
    httpStatus: response.status,
  };
}

/**
 * 接続テスト（FR-SETUP-005）。
 * manifest が取得でき、schema に適合することを確かめる。
 */
export async function testConnection(
  config: AppConfig,
  options: RequestOptions = {},
): Promise<Manifest> {
  const result = await fetchManifest(config, options);
  if (!result.manifest) {
    throw new AppError('E-MAN-001', result.httpStatus);
  }
  return result.manifest;
}

export interface FetchedDocument {
  html: string;
  sizeBytes: number;
  contentSha256: string;
}

/**
 * 文書を取得して完全性を確かめる。
 *
 * ref には branch ではなく manifest の sourceCommitSha を使う。
 * manifest と本文がずれるのを防ぐため（FR-GH-003）。
 */
export async function fetchDocument(
  config: AppConfig,
  manifest: Manifest,
  document: ManifestDocument,
  options: RequestOptions = {},
): Promise<FetchedDocument> {
  const url = buildContentsUrl({
    owner: config.owner,
    repo: config.repo,
    path: document.path,
    ref: manifest.sourceCommitSha,
  });

  const response = await fetchWithRetry(url, buildHeaders(config.personalAccessToken), options);
  const bytes = await response.arrayBuffer();

  // FR-VIEW-002：サイズを先に見る。上限超過なら本文を触らない。
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new AppError('E-DOC-002', response.status);
  }

  const contentSha256 = await sha256Hex(bytes);
  if (contentSha256 !== document.contentSha256) {
    // AC-015：hash が一致しなければ本文を一切表示しない。
    throw new AppError('E-DOC-001', response.status);
  }

  const html = decodeUtf8(bytes);

  return { html, sizeBytes: bytes.byteLength, contentSha256 };
}

/** UTF-8 として厳密に解釈する。壊れていれば表示しない。 */
function decodeUtf8(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new AppError('E-DOC-003');
  }
}
