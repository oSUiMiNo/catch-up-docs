/**
 * SCR-05 文書ビューア（7.5 / 10.6）。
 *
 * 表示は完全に隔離した iframe の中で行う。
 *   - sandbox="" なのでスクリプト実行も同一オリジン扱いもフォーム送信もできない
 *   - referrerpolicy="no-referrer" で参照元も渡さない
 *   - srcdoc の中身は サニタイズ済み + 文書内CSP 付き
 *
 * 閉じるときは srcdoc を空にして参照を捨てる（FR-VIEW-007）。
 * 本文は Cache Storage にも IndexedDB にも localStorage にも保存しない。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useApp } from '../app/AppProvider';
import {
  VIEWER_FONT_SCALE_DEFAULT,
  VIEWER_FONT_SCALE_MAX,
  VIEWER_FONT_SCALE_MIN,
  VIEWER_FONT_SCALE_STEP,
} from '../config/constants';
import { AppError } from '../github/errors';
import type { ManifestDocument } from '../github/manifestSchema';
import { formatBytes, formatDateTime, Notice, Spinner } from './ui';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; document: ManifestDocument; srcdoc: string }
  | { status: 'failed'; message: string; action: string };

export function DocumentViewerScreen(): React.JSX.Element {
  const { state, actions } = useApp();
  const documentId = state.openDocumentId;

  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [fontScale, setFontScale] = useState(VIEWER_FONT_SCALE_DEFAULT);
  const [infoOpen, setInfoOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 一覧が消えた状態でも、タイトルだけは先に出せるようにする（FR-VIEW-001）。
  const meta = state.manifest?.documents.find((document) => document.id === documentId) ?? null;

  const close = useCallback(() => {
    // 参照を断ってから画面を替える。
    const frame = iframeRef.current;
    if (frame) {
      frame.srcdoc = '';
    }
    setLoad({ status: 'loading' });
    actions.closeDocument();
  }, [actions]);

  useEffect(() => {
    if (documentId === null) {
      return;
    }

    let cancelled = false;
    setLoad({ status: 'loading' });

    const run = async (): Promise<void> => {
      try {
        const content = await actions.loadViewerContent(documentId, fontScale);
        if (cancelled) {
          return;
        }
        setLoad({ status: 'ready', document: content.document, srcdoc: content.srcdoc });
        // FR-DASH-004：表示に成功した時点で既読にする。
        await actions.markDocumentRead(content.document.id, content.document.contentSha256);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const described =
          error instanceof AppError
            ? error.describe()
            : { message: '文書を表示できませんでした', action: '再試行してください' };
        setLoad({ status: 'failed', message: described.message, action: described.action });
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
    // fontScale の変更でも作り直す。文字サイズは文書内CSSへ埋め込むため。
  }, [documentId, fontScale, reloadToken, actions]);

  // Android の戻る操作とブラウザ履歴に対応する（10.1）。
  useEffect(() => {
    window.history.pushState({ viewer: true }, '');
    const onPopState = (): void => {
      close();
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, [close]);

  // 画面を離れるときに必ず本文を捨てる（FR-VIEW-007）。
  useEffect(() => {
    // 後片付けの時点では ref が差し替わっている可能性があるため、
    // 効果の実行時点の要素を捕まえておく。
    const frame = iframeRef.current;
    return () => {
      if (frame) {
        frame.srcdoc = '';
      }
    };
  }, [load.status]);

  const title = load.status === 'ready' ? load.document.title : (meta?.title ?? '文書');
  const shown = load.status === 'ready' ? load.document : meta;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="button button--quiet" onClick={close}>
            ← 戻る
          </button>
          <div className="row">
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                setFontScale((current) =>
                  Math.max(VIEWER_FONT_SCALE_MIN, current - VIEWER_FONT_SCALE_STEP),
                );
              }}
              aria-label="文字を小さくする"
              disabled={fontScale <= VIEWER_FONT_SCALE_MIN}
            >
              A−
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                setFontScale((current) =>
                  Math.min(VIEWER_FONT_SCALE_MAX, current + VIEWER_FONT_SCALE_STEP),
                );
              }}
              aria-label="文字を大きくする"
              disabled={fontScale >= VIEWER_FONT_SCALE_MAX}
            >
              A＋
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                setInfoOpen((current) => !current);
              }}
              aria-expanded={infoOpen}
            >
              情報
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                setReloadToken((current) => current + 1);
              }}
              aria-label="再読み込み"
            >
              再読込
            </button>
          </div>
        </div>

        <h1 className="viewer-title">{title}</h1>

        {infoOpen && shown && (
          <div className="card stack">
            <p>追加日：{formatDateTime(shown.addedAt)}</p>
            <p>更新日：{formatDateTime(shown.updatedAt)}</p>
            <p>サイズ：{formatBytes(shown.sizeBytes)}</p>
            <p className="hint">文字サイズ：{String(fontScale)}%</p>
          </div>
        )}
      </header>

      <main className="viewer-body">
        {load.status === 'loading' && (
          <div className="centered-screen">
            <Spinner label="文書を取得しています…" />
          </div>
        )}

        {load.status === 'failed' && (
          <div className="centered-screen">
            <Notice tone="error" title={load.message}>
              <div className="stack">
                <span>{load.action}</span>
                <div className="row">
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      setReloadToken((current) => current + 1);
                    }}
                  >
                    再試行
                  </button>
                  <button type="button" className="button" onClick={close}>
                    閉じる
                  </button>
                </div>
              </div>
            </Notice>
          </div>
        )}

        {load.status === 'ready' && (
          <iframe
            ref={iframeRef}
            className="viewer-frame"
            title={load.document.title}
            /* allow-scripts も allow-same-origin も付けない（FR-VIEW-004）。 */
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={load.srcdoc}
          />
        )}
      </main>
    </div>
  );
}
