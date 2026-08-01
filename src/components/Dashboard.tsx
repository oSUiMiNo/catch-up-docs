/**
 * SCR-04 ダッシュボード（10.5）。
 *
 * ロック解除後の入り口。文書の一覧、検索、同期、未読表示を担う。
 * Private Repository の完全なパスは通常画面に出さない（FR-DASH-001）。
 */

import { useDeferredValue, useMemo } from 'react';

import { useApp } from '../app/AppProvider';
import { DASHBOARD_VISIBLE_TAGS } from '../config/constants';
import type { ManifestDocument } from '../github/manifestSchema';
import { isUnread } from '../storage/readState';
import { formatBytes, formatDate, formatDateTime, Notice, Spinner } from './ui';

/** タイトル・説明・タグを対象に部分一致で絞る（FR-DASH-002）。 */
export function filterDocuments(
  documents: readonly ManifestDocument[],
  query: string,
): ManifestDocument[] {
  const normalized = query.trim().toLocaleLowerCase('ja');
  if (normalized.length === 0) {
    return [...documents];
  }

  return documents.filter((document) => {
    const haystack = [document.title, document.description, ...document.tags]
      .join('\n')
      .toLocaleLowerCase('ja');
    return haystack.includes(normalized);
  });
}

function DocumentCard({
  document,
  unread,
  onOpen,
}: {
  document: ManifestDocument;
  unread: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const visibleTags = document.tags.slice(0, DASHBOARD_VISIBLE_TAGS);
  const hiddenTagCount = document.tags.length - visibleTags.length;
  const updated = document.updatedAt !== document.addedAt;

  return (
    <button
      type="button"
      className="card document-card"
      onClick={onOpen}
      aria-label={`${document.title}${unread ? '（新着）' : ''}`}
    >
      <div className="stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <h2 className="document-card__title">{document.title}</h2>
          {/* 色だけで新着を示さず、文字でも表す（10.1）。 */}
          {unread && <span className="badge">新着</span>}
        </div>

        {document.description.length > 0 && (
          <p className="document-card__description">{document.description}</p>
        )}

        <div className="row document-card__meta">
          <span>追加 {formatDate(document.addedAt)}</span>
          {updated && <span>更新 {formatDate(document.updatedAt)}</span>}
          <span>{formatBytes(document.sizeBytes)}</span>
        </div>

        {document.tags.length > 0 && (
          <div className="row">
            {visibleTags.map((tag) => (
              <span key={tag} className="tag">
                {tag}
              </span>
            ))}
            {hiddenTagCount > 0 && <span className="tag">ほか{String(hiddenTagCount)}件</span>}
          </div>
        )}
      </div>
    </button>
  );
}

export function Dashboard(): React.JSX.Element {
  const { state, actions } = useApp();

  // 入力のたびに500件を再計算しないよう、描画を遅らせる（NFR-001）。
  const deferredQuery = useDeferredValue(state.searchQuery);

  const manifest = state.manifest;
  const documents = useMemo(() => manifest?.documents ?? [], [manifest]);
  const visible = useMemo(
    () => filterDocuments(documents, deferredQuery),
    [documents, deferredQuery],
  );

  const unreadCount = documents.filter((document) =>
    isUnread(state.readState, document.id, document.contentSha256),
  ).length;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>{state.runtimeConfig?.appName ?? 'catch-up-docs'}</strong>
          <div className="row">
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                void actions.sync();
              }}
              disabled={state.syncing}
              aria-label="今すぐ同期"
            >
              {state.syncing ? '同期中…' : '同期'}
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                void actions.lock();
              }}
            >
              ロック
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                actions.goTo('settings');
              }}
            >
              設定
            </button>
          </div>
        </div>

        <input
          className="input"
          type="search"
          value={state.searchQuery}
          placeholder="タイトル・説明・タグで検索"
          aria-label="文書を検索"
          onChange={(event) => {
            actions.setSearchQuery(event.target.value);
          }}
        />

        <p className="hint" role="status" aria-live="polite">
          {state.syncing
            ? '同期しています…'
            : state.lastSyncedAt !== null
              ? `最終同期 ${formatDateTime(state.lastSyncedAt)}・${String(documents.length)}件・未読${String(unreadCount)}件`
              : 'まだ同期していません'}
        </p>
      </header>

      <main className="document-list">
        {state.updateAvailable && (
          <Notice tone="info" title="新しいバージョンがあります">
            <button
              type="button"
              className="button"
              onClick={() => {
                void actions.applyUpdate();
              }}
            >
              更新して再読み込み
            </button>
          </Notice>
        )}

        {state.error !== null && (
          <Notice tone="error" title={state.error.message}>
            <div className="stack">
              <span>{state.error.action}</span>
              <div className="row">
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    void actions.sync();
                  }}
                >
                  再試行
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    actions.goTo('settings');
                  }}
                >
                  設定を確認
                </button>
              </div>
            </div>
          </Notice>
        )}

        {state.syncing && documents.length === 0 && <Spinner label="文書一覧を取得しています…" />}

        {!state.syncing && state.error === null && documents.length === 0 && (
          <Notice tone="info" title="まだ文書がありません">
            Private Repositoryのdocumentsフォルダへ HTML を追加してください。
          </Notice>
        )}

        {documents.length > 0 && visible.length === 0 && (
          <Notice tone="info">検索条件に合う文書がありません。</Notice>
        )}

        {visible.map((document) => (
          <DocumentCard
            key={document.id}
            document={document}
            unread={isUnread(state.readState, document.id, document.contentSha256)}
            onOpen={() => {
              actions.openDocument(document.id);
            }}
          />
        ))}
      </main>
    </div>
  );
}
