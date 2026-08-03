/**
 * 画面から呼べる操作をまとめた層。
 *
 * 画面側は暗号や GitHub API を直接触らない。ここが唯一の窓口になる。
 * PAT を含む設定は state に持つが、画面へは渡さない。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';

import {
  changePassword as changeVaultPassword,
  initializeVault,
  isInitialized,
  lockNow,
  resetVault,
  restoreSession,
  UnlockError,
  unlockWithPassword,
} from '../auth/vault';
import { DEEP_LINK_PARAM } from '../config/constants';
import { loadRuntimeConfig } from '../config/runtimeConfig';
import {
  fetchDocument,
  fetchManifest,
  fetchRegisteredSubscriptionIds,
  testConnection,
} from '../github/client';
import { AppError, describeErrorCode, type AppErrorDescription } from '../github/errors';
import type { ManifestDocument } from '../github/manifestSchema';
import { listenForDeepLinks, registerServiceWorker } from '../push/register';
import { currentSubscriptionId, detectPushSupport } from '../push/subscribe';
import { loadAppConfig, saveAppConfig, type AppConfig } from '../storage/appConfig';
import { loadReadState, markAsRead, pruneReadState, saveReadState } from '../storage/readState';
import { logger } from '../utils/logger';
import { buildViewerDocument } from '../viewer/injectCsp';
import { sanitizeDocumentHtml } from '../viewer/sanitize';
import {
  appReducer,
  initialAppState,
  type AppState,
  type PushStatus,
  type Screen,
} from './state';

export interface ViewerContent {
  document: ManifestDocument;
  /** iframe の srcdoc へ渡す最終的な HTML。 */
  srcdoc: string;
}

export interface AppActions {
  goTo: (screen: Screen) => void;
  completeSetup: (password: string, config: AppConfig) => Promise<void>;
  verifyConnection: (config: AppConfig) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => Promise<void>;
  sync: () => Promise<void>;
  openDocument: (documentId: string) => void;
  closeDocument: () => void;
  loadViewerContent: (documentId: string, fontScale: number) => Promise<ViewerContent>;
  markDocumentRead: (documentId: string, contentSha256: string) => Promise<void>;
  changePassword: (currentPassword: string, nextPassword: string) => Promise<void>;
  updateGitHubConfig: (currentPassword: string, config: AppConfig) => Promise<void>;
  resetApp: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  clearError: () => void;
  applyUpdate: () => Promise<void>;
  /**
   * 通知が届く状態かを調べ直す。
   * 登録ワークフローを実行したあとに押して結果を確かめられるよう、画面からも呼べる。
   */
  refreshPushStatus: () => Promise<void>;
  /**
   * 設定画面が使う。PAT は含めない。
   * manifestPath も返すのは、設定変更の画面で既存の値を初期表示するため。
   * 返さないと、他の項目だけ直して保存したときに既定値へ戻ってしまう。
   */
  describeConnection: () => {
    owner: string;
    repo: string;
    branch: string;
    manifestPath: string;
  } | null;
}

interface AppContextValue {
  state: AppState;
  actions: AppActions;
}

const AppContext = createContext<AppContextValue | null>(null);

function describeUnknownError(error: unknown): AppErrorDescription {
  if (error instanceof AppError) {
    return error.describe();
  }
  if (error instanceof UnlockError) {
    return describeErrorCode(error.reason === 'corrupted' ? 'E-AUTH-002' : 'E-AUTH-001');
  }
  return describeErrorCode('E-NET-001');
}

/** 通知から渡された URL から document id を取り出す。 */
function readDeepLinkId(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.href);
    const id = parsed.searchParams.get(DEEP_LINK_PARAM);
    return id && /^doc_[0-9a-f]{16}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, dispatch] = useReducer(appReducer, initialAppState);

  // ロック解除の直後に自動同期するため、最新の設定を参照できるようにする。
  const stateRef = useRef(state);
  stateRef.current = state;

  const updateHandle = useRef<{ applyUpdate: () => Promise<void> } | null>(null);

  const goTo = useCallback((screen: Screen) => {
    dispatch({ type: 'go', screen });
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: 'clear-error' });
  }, []);

  const setSearchQuery = useCallback((query: string) => {
    dispatch({ type: 'search-changed', query });
  }, []);

  // ── 同期 ─────────────────────────────────────────────────

  const sync = useCallback(async () => {
    const current = stateRef.current;
    if (!current.config || !current.vault || current.syncing) {
      return;
    }

    dispatch({ type: 'sync-started' });

    try {
      const options = current.manifestEtag ? { etag: current.manifestEtag } : {};
      const result = await fetchManifest(current.config, options);

      if (result.status === 'not-modified' || !result.manifest) {
        dispatch({ type: 'sync-unchanged', at: Date.now() });
        return;
      }

      dispatch({
        type: 'sync-succeeded',
        manifest: result.manifest,
        etag: result.etag,
        at: Date.now(),
      });

      // manifest から消えた文書の既読情報を捨てる。
      const pruned = pruneReadState(
        current.readState,
        result.manifest.documents.map((document) => document.id),
      );
      dispatch({ type: 'read-state-changed', readState: pruned });
      await saveReadState(current.vault.masterKey, pruned);
    } catch (error) {
      const description = describeUnknownError(error);
      dispatch({
        type: 'sync-failed',
        error: description,
        httpStatus: error instanceof AppError ? error.httpStatus : null,
      });
    }
  }, []);

  // ── 解除とロック ─────────────────────────────────────────

  const finishUnlock = useCallback(
    async (vault: Awaited<ReturnType<typeof unlockWithPassword>>) => {
      const config = await loadAppConfig(vault.masterKey);
      if (!config) {
        dispatch({ type: 'error', error: describeErrorCode('E-AUTH-002') });
        return;
      }
      const readState = await loadReadState(vault.masterKey);
      dispatch({ type: 'unlocked', vault, config, readState });

      // FR-DASH-003：解除に成功したら自動で同期する。
      stateRef.current = { ...stateRef.current, vault, config, readState };
      await sync();
    },
    [sync],
  );

  const unlock = useCallback(
    async (password: string) => {
      const vault = await unlockWithPassword(password, Date.now());
      await finishUnlock(vault);
    },
    [finishUnlock],
  );

  const lock = useCallback(async () => {
    await lockNow();
    dispatch({ type: 'locked' });
  }, []);

  // ── 初期設定 ─────────────────────────────────────────────

  const verifyConnection = useCallback(async (config: AppConfig) => {
    await testConnection(config);
  }, []);

  const completeSetup = useCallback(
    async (password: string, config: AppConfig) => {
      // FR-SETUP-006：接続テストに成功したときだけ保存する。
      await testConnection(config);
      const vault = await initializeVault(password, config, Date.now());
      await finishUnlock(vault);
    },
    [finishUnlock],
  );

  // ── 文書 ─────────────────────────────────────────────────

  const openDocument = useCallback((documentId: string) => {
    dispatch({ type: 'open-document', documentId });
  }, []);

  const closeDocument = useCallback(() => {
    dispatch({ type: 'close-document' });
  }, []);

  const loadViewerContent = useCallback(
    async (documentId: string, fontScale: number): Promise<ViewerContent> => {
      const current = stateRef.current;
      if (!current.config || !current.manifest) {
        throw new AppError('E-NET-001');
      }

      const target = current.manifest.documents.find((document) => document.id === documentId);
      if (!target) {
        throw new AppError('E-GH-404');
      }

      const fetched = await fetchDocument(current.config, current.manifest, target);
      const sanitized = sanitizeDocumentHtml(fetched.html);
      const srcdoc = buildViewerDocument(sanitized.html, { fontScale });

      logger.debug('文書を表示します', {
        removed: sanitized.removed,
      });

      return { document: target, srcdoc };
    },
    [],
  );

  const markDocumentRead = useCallback(async (documentId: string, contentSha256: string) => {
    const current = stateRef.current;
    if (!current.vault) {
      return;
    }
    const next = markAsRead(current.readState, documentId, contentSha256, Date.now());
    dispatch({ type: 'read-state-changed', readState: next });
    await saveReadState(current.vault.masterKey, next);
  }, []);

  // ── 設定変更 ─────────────────────────────────────────────

  const changePassword = useCallback(
    async (currentPassword: string, nextPassword: string) => {
      const vault = await changeVaultPassword(currentPassword, nextPassword, Date.now());
      await finishUnlock(vault);
    },
    [finishUnlock],
  );

  const updateGitHubConfig = useCallback(
    async (currentPassword: string, config: AppConfig) => {
      // FR-SETUP-007：現在のパスワードを要求してから差し替える。
      const vault = await unlockWithPassword(currentPassword, Date.now());
      await testConnection(config);
      await saveAppConfig(vault.masterKey, config);
      await finishUnlock(vault);
    },
    [finishUnlock],
  );

  const resetApp = useCallback(async () => {
    await resetVault();
    // 再登録できるよう、可能なら購読も解除する（FR-SETTINGS-004）。
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      await subscription?.unsubscribe();
    } catch {
      logger.debug('購読の解除に失敗しました');
    }
    window.location.reload();
  }, []);

  const applyUpdate = useCallback(async () => {
    await updateHandle.current?.applyUpdate();
  }, []);

  // ── 通知の登録状態 ───────────────────────────────────────

  /**
   * 通知が届く状態かを判定する（FR-PUSH-004）。
   *
   * 端末に購読があるかだけでは足りない。購読を作ったあとワークフローへ
   * 貼り付けるのを忘れていると、端末側は何も変わらないまま通知だけが届かない。
   * 文書リポジトリの購読ファイルに、この端末の id が載っているかまで確かめる。
   *
   * 判定に失敗しても他の機能を止めない。通知はあくまで補助であり、
   * 一覧の閲覧を妨げてまで知らせる価値はないため。
   */
  const refreshPushStatus = useCallback(async () => {
    const decide = async (): Promise<PushStatus> => {
      if (!detectPushSupport().supported) {
        return 'unsupported';
      }

      const subscriptionId = await currentSubscriptionId();
      if (subscriptionId === null) {
        return 'no-subscription';
      }

      const config = stateRef.current.config;
      if (!config) {
        return 'unknown';
      }

      const registered = await fetchRegisteredSubscriptionIds(config);
      if (registered === null) {
        // 購読ファイルを読めなかった。未登録と決めつけない。
        return 'unknown';
      }

      return registered.includes(subscriptionId) ? 'registered' : 'not-registered';
    };

    try {
      dispatch({ type: 'push-status-changed', status: await decide() });
    } catch {
      logger.debug('通知の登録状態を確かめられませんでした');
      dispatch({ type: 'push-status-changed', status: 'unknown' });
    }
  }, []);

  const describeConnection = useCallback(() => {
    const config = stateRef.current.config;
    if (!config) {
      return null;
    }
    return {
      owner: config.owner,
      repo: config.repo,
      branch: config.branch,
      manifestPath: config.manifestPath,
    };
  }, []);

  // ── 起動 ─────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    const boot = async (): Promise<void> => {
      try {
        const runtimeConfig = await loadRuntimeConfig();
        if (cancelled) {
          return;
        }
        dispatch({ type: 'runtime-config-loaded', config: runtimeConfig });
      } catch {
        dispatch({ type: 'error', error: describeErrorCode('E-NET-001') });
        return;
      }

      // 通知から起動した場合の宛先を先に控える（FR-PUSH-008）。
      const deepLinkId = readDeepLinkId(window.location.href);
      if (deepLinkId) {
        dispatch({ type: 'queue-document', documentId: deepLinkId });
        // 解除前に URL から手がかりを消す。
        window.history.replaceState(null, '', window.location.pathname);
      }

      if (!(await isInitialized())) {
        dispatch({ type: 'go', screen: 'setup' });
        return;
      }

      const result = await restoreSession(Date.now());
      if (cancelled) {
        return;
      }

      if (result.status === 'unlocked') {
        await finishUnlock(result.vault);
        return;
      }

      dispatch({ type: 'go', screen: 'lock' });
    };

    void boot();

    return () => {
      cancelled = true;
    };
  }, [finishUnlock]);

  // Service Worker の登録と更新通知。
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    updateHandle.current = registerServiceWorker({
      onUpdateAvailable: () => {
        dispatch({ type: 'update-available' });
      },
    });

    return listenForDeepLinks((url) => {
      const documentId = readDeepLinkId(url);
      if (documentId) {
        dispatch({ type: 'queue-document', documentId });
      }
    });
  }, []);

  // 解除できたら、通知が届く状態かを確かめる（FR-PUSH-004）。
  // 「許可したのに来ない」を放置しないための確認で、失敗しても他は止めない。
  useEffect(() => {
    if (!state.vault || !state.config) {
      return;
    }
    void refreshPushStatus();
  }, [state.vault, state.config, refreshPushStatus]);

  // 解除済みで保留中のディープリンクがあれば開く。
  useEffect(() => {
    if (!state.vault || !state.manifest || !state.pendingDocumentId) {
      return;
    }

    const exists = state.manifest.documents.some(
      (document) => document.id === state.pendingDocumentId,
    );
    dispatch({ type: 'consume-queued-document' });

    // FR-PUSH-008：manifest に無い id ならダッシュボードのままにする。
    if (exists && state.pendingDocumentId) {
      dispatch({ type: 'open-document', documentId: state.pendingDocumentId });
    }
  }, [state.vault, state.manifest, state.pendingDocumentId]);

  const actions = useMemo<AppActions>(
    () => ({
      goTo,
      completeSetup,
      verifyConnection,
      unlock,
      lock,
      sync,
      openDocument,
      closeDocument,
      loadViewerContent,
      markDocumentRead,
      changePassword,
      updateGitHubConfig,
      resetApp,
      setSearchQuery,
      clearError,
      applyUpdate,
      refreshPushStatus,
      describeConnection,
    }),
    [
      goTo,
      completeSetup,
      verifyConnection,
      unlock,
      lock,
      sync,
      openDocument,
      closeDocument,
      loadViewerContent,
      markDocumentRead,
      changePassword,
      updateGitHubConfig,
      resetApp,
      setSearchQuery,
      clearError,
      applyUpdate,
      refreshPushStatus,
      describeConnection,
    ],
  );

  const value = useMemo(() => ({ state, actions }), [state, actions]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) {
    throw new Error('AppProvider の外では使用できません');
  }
  return value;
}
