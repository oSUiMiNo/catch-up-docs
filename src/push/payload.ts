/**
 * プッシュ通知のペイロード処理（FR-PUSH-007 / FR-PUSH-008）。
 *
 * 通知の文言には文書タイトル、ファイル名、リポジトリ名、パス、本文を含めない。
 * 含めてよいのは件数と document id だけ。
 *
 * このモジュールは Service Worker からも読み込むため、DOM API に依存しない。
 */

import { DEEP_LINK_PARAM } from '../config/constants';

export interface DocumentsAddedPayload {
  type: 'documents-added';
  count: number;
  documentIds: string[];
  url?: string;
}

const MAX_REPORTED_COUNT = 999;

/**
 * push イベントの本文を安全に解釈する。
 * 壊れた JSON や想定外の形でも例外を投げず、最小限の通知を出せる形へ落とす。
 */
export function parsePushPayload(raw: string | undefined): DocumentsAddedPayload {
  const fallback: DocumentsAddedPayload = { type: 'documents-added', count: 1, documentIds: [] };

  if (!raw) {
    return fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return fallback;
  }

  const candidate = parsed as Record<string, unknown>;

  const count =
    typeof candidate.count === 'number' && Number.isFinite(candidate.count)
      ? Math.min(Math.max(Math.trunc(candidate.count), 1), MAX_REPORTED_COUNT)
      : fallback.count;

  const documentIds = Array.isArray(candidate.documentIds)
    ? candidate.documentIds.filter((id): id is string => typeof id === 'string')
    : [];

  const payload: DocumentsAddedPayload = { type: 'documents-added', count, documentIds };

  if (typeof candidate.url === 'string') {
    payload.url = candidate.url;
  }

  return payload;
}

/**
 * FR-PUSH-007：一般化された本文。ロック画面に出ても内容が分からない文言にする。
 */
export function buildNotificationBody(count: number): string {
  if (count <= 1) {
    return '新しいドキュメントが追加されました。';
  }
  return `新しいドキュメントが${String(count)}件追加されました。`;
}

/**
 * 通知タップ時に開く URL を決める。
 *
 * 送信側が付けた url は信用しきらず、必ず自分の配信オリジンとスコープの内側へ
 * 収める。複数件の追加ならダッシュボード（スコープのルート）を開く。
 *
 * @param payload push で受け取ったペイロード
 * @param scopeUrl Service Worker のスコープ（絶対 URL、末尾スラッシュ付き）
 */
export function resolveDeepLinkUrl(payload: DocumentsAddedPayload, scopeUrl: string): string {
  const scope = new URL(scopeUrl);

  if (payload.count > 1) {
    return scope.toString();
  }

  const documentId = payload.documentIds[0];
  if (documentId !== undefined && isSafeDocumentId(documentId)) {
    const target = new URL(scope.toString());
    target.searchParams.set(DEEP_LINK_PARAM, documentId);
    return target.toString();
  }

  if (payload.url !== undefined) {
    try {
      const candidate = new URL(payload.url, scope);
      const withinScope =
        candidate.origin === scope.origin && candidate.pathname.startsWith(scope.pathname);
      if (withinScope) {
        return candidate.toString();
      }
    } catch {
      // 解釈できない URL は無視してスコープのルートへ倒す。
    }
  }

  return scope.toString();
}

/** document id は `doc_` + 16桁の16進数（8.1.1）。 */
export function isSafeDocumentId(value: string): boolean {
  return /^doc_[0-9a-f]{16}$/.test(value);
}
