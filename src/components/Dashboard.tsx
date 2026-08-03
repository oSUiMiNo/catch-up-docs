/**
 * SCR-04 ダッシュボード（10.5）。
 *
 * ロック解除後の入り口。文書の一覧、検索、同期、未読表示を担う。
 * Private Repository の完全なパスは通常画面に出さない（FR-DASH-001）。
 */

import { useDeferredValue, useMemo } from 'react';

import { useApp } from '../app/AppProvider';
import type { PushStatus } from '../app/state';
import { usePullToRefresh } from '../app/usePullToRefresh';
import { DASHBOARD_VISIBLE_TAGS } from '../config/constants';
import type { ManifestDocument } from '../github/manifestSchema';
import { unreadKind, type UnreadKind } from '../storage/readState';
import { formatBytes, formatDate, formatDateTime, Notice, Spinner } from './ui';

/**
 * 通知が届かない状態のとき、一覧の上に出す案内。
 * 届く状態と、調べられなかった状態では何も出さない。黙って邪魔をしないため。
 */
const PUSH_NOTICE: Partial<Record<PushStatus, { title: string; body: string }>> = {
  'no-subscription': {
    title: '通知を受け取る設定がまだです',
    body: '文書が追加されたときに知らせを受け取るには、この端末で通知を有効にしてください。',
  },
  'not-registered': {
    title: 'あと1手順で通知が届きます',
    body: 'この端末の通知は有効ですが、登録ワークフローの実行が終わっていません。済ませるまで通知は届きません。',
  },
};

/** 未読の種類ごとのバッジ。新規と更新は対で読めるよう短い語で揃える。 */
const UNREAD_BADGE: Record<Exclude<UnreadKind, 'none'>, { label: string; className: string }> = {
  new: { label: '新規', className: 'badge' },
  updated: { label: '更新', className: 'badge badge--updated' },
};

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
  unread: UnreadKind;
  onOpen: () => void;
}): React.JSX.Element {
  const visibleTags = document.tags.slice(0, DASHBOARD_VISIBLE_TAGS);
  const hiddenTagCount = document.tags.length - visibleTags.length;
  const updated = document.updatedAt !== document.addedAt;
  const badge = unread === 'none' ? null : UNREAD_BADGE[unread];

  return (
    <button
      type="button"
      className="card document-card"
      onClick={onOpen}
      aria-label={`${document.title}${badge ? `（${badge.label}）` : ''}`}
    >
      <div className="stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <h2 className="document-card__title">{document.title}</h2>
          {/* 色だけで区別させず、新規と更新を文字でも分ける（10.1）。 */}
          {badge && <span className={badge.className}>{badge.label}</span>}
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

  const unread = useMemo(() => {
    const kinds = documents.map((document) =>
      unreadKind(state.readState, document.id, document.contentSha256),
    );
    return {
      new: kinds.filter((kind) => kind === 'new').length,
      updated: kinds.filter((kind) => kind === 'updated').length,
    };
  }, [documents, state.readState]);
  const unreadCount = unread.new + unread.updated;

  const pushNotice = PUSH_NOTICE[state.pushStatus] ?? null;

  // FR-DASH-003：引き下げて更新。一覧の先頭にいるときだけ反応する。
  const [pullContainerRef, pull] = usePullToRefresh({
    onRefresh: () => actions.sync(),
    disabled: state.syncing,
  });

  return (
    <div className="app-shell" ref={pullContainerRef}>
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
              ? `最終同期 ${formatDateTime(state.lastSyncedAt)}・${String(documents.length)}件・未読${String(unreadCount)}件${unreadCount > 0 ? `（新規${String(unread.new)}・更新${String(unread.updated)}）` : ''}`
              : 'まだ同期していません'}
        </p>
      </header>

      {pull.distance > 0 && (
        <div
          className="pull-indicator"
          style={{ height: `${String(pull.distance)}px` }}
          role="status"
          aria-live="polite"
        >
          {pull.armed ? '離すと更新します' : '引き下げて更新'}
        </div>
      )}

      <main className="document-list">
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

        {/*
          通知の登録は2段構えで、端末で許可しただけでは届かない。
          残りの手順があることをここで知らせないと、届かない理由が誰にも分からない。
        */}
        {pushNotice && (
          <Notice tone="info" title={pushNotice.title}>
            <div className="stack">
              <span>{pushNotice.body}</span>
              <div className="row">
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    actions.goTo('push');
                  }}
                >
                  通知の設定へ
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
            unread={unreadKind(state.readState, document.id, document.contentSha256)}
            onOpen={() => {
              actions.openDocument(document.id);
            }}
          />
        ))}
      </main>
    </div>
  );
}
