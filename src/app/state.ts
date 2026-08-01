/**
 * アプリ全体の状態（10.2 の画面遷移に対応）。
 *
 * master key、PAT、manifest、文書本文はここでメモリ上にだけ保持する。
 * ロック時は必ず clearSensitive() を通し、参照を捨てる（FR-AUTH-006）。
 */

import type { UnlockedVault } from '../auth/vault';
import type { RuntimeConfig } from '../config/runtimeConfig';
import type { AppErrorDescription } from '../github/errors';
import type { Manifest } from '../github/manifestSchema';
import type { AppConfig } from '../storage/appConfig';
import { emptyReadState, type ReadState } from '../storage/readState';

export type Screen =
  'startup' | 'setup' | 'lock' | 'dashboard' | 'viewer' | 'settings' | 'push' | 'error';

export interface AppState {
  screen: Screen;
  runtimeConfig: RuntimeConfig | null;

  /** 解除済みセッション。null ならロック中。 */
  vault: UnlockedVault | null;
  /** 復号済みの GitHub 設定。PAT を含むため画面へ渡さない。 */
  config: AppConfig | null;

  manifest: Manifest | null;
  manifestEtag: string | null;
  readState: ReadState;

  syncing: boolean;
  lastSyncedAt: number | null;
  lastHttpStatus: number | null;

  searchQuery: string;
  openDocumentId: string | null;
  /** ロック中に届いた通知の宛先。解除後に開く（FR-PUSH-008）。 */
  pendingDocumentId: string | null;

  error: AppErrorDescription | null;
  updateAvailable: boolean;
}

export const initialAppState: AppState = {
  screen: 'startup',
  runtimeConfig: null,
  vault: null,
  config: null,
  manifest: null,
  manifestEtag: null,
  readState: emptyReadState(),
  syncing: false,
  lastSyncedAt: null,
  lastHttpStatus: null,
  searchQuery: '',
  openDocumentId: null,
  pendingDocumentId: null,
  error: null,
  updateAvailable: false,
};

export type AppAction =
  | { type: 'runtime-config-loaded'; config: RuntimeConfig }
  | { type: 'go'; screen: Screen }
  | { type: 'unlocked'; vault: UnlockedVault; config: AppConfig; readState: ReadState }
  | { type: 'locked' }
  | { type: 'sync-started' }
  | { type: 'sync-succeeded'; manifest: Manifest; etag: string | null; at: number }
  | { type: 'sync-unchanged'; at: number }
  | { type: 'sync-failed'; error: AppErrorDescription; httpStatus: number | null }
  | { type: 'read-state-changed'; readState: ReadState }
  | { type: 'search-changed'; query: string }
  | { type: 'open-document'; documentId: string }
  | { type: 'close-document' }
  | { type: 'queue-document'; documentId: string }
  | { type: 'consume-queued-document' }
  | { type: 'error'; error: AppErrorDescription }
  | { type: 'clear-error' }
  | { type: 'update-available' };

/**
 * ロック時に捨てる値をまとめる。
 * ここに挙げ忘れると、ロック後も機密が画面に残ってしまう。
 */
function clearSensitive(state: AppState): AppState {
  return {
    ...state,
    vault: null,
    config: null,
    manifest: null,
    manifestEtag: null,
    readState: emptyReadState(),
    openDocumentId: null,
    searchQuery: '',
    lastSyncedAt: null,
  };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'runtime-config-loaded':
      return { ...state, runtimeConfig: action.config };

    case 'go':
      return { ...state, screen: action.screen };

    case 'unlocked':
      return {
        ...state,
        screen: 'dashboard',
        vault: action.vault,
        config: action.config,
        readState: action.readState,
        error: null,
      };

    case 'locked':
      return { ...clearSensitive(state), screen: 'lock', error: null };

    case 'sync-started':
      return { ...state, syncing: true, error: null };

    case 'sync-succeeded':
      return {
        ...state,
        syncing: false,
        manifest: action.manifest,
        manifestEtag: action.etag,
        lastSyncedAt: action.at,
        lastHttpStatus: 200,
        error: null,
      };

    case 'sync-unchanged':
      return {
        ...state,
        syncing: false,
        lastSyncedAt: action.at,
        lastHttpStatus: 304,
        error: null,
      };

    case 'sync-failed':
      return {
        ...state,
        syncing: false,
        // FR-DASH-006：古い一覧を表示し続けない。
        manifest: null,
        manifestEtag: null,
        error: action.error,
        lastHttpStatus: action.httpStatus,
      };

    case 'read-state-changed':
      return { ...state, readState: action.readState };

    case 'search-changed':
      return { ...state, searchQuery: action.query };

    case 'open-document':
      return { ...state, screen: 'viewer', openDocumentId: action.documentId, error: null };

    case 'close-document':
      return { ...state, screen: 'dashboard', openDocumentId: null };

    case 'queue-document':
      return { ...state, pendingDocumentId: action.documentId };

    case 'consume-queued-document':
      return { ...state, pendingDocumentId: null };

    case 'error':
      return { ...state, error: action.error, screen: 'error' };

    case 'clear-error':
      return { ...state, error: null };

    case 'update-available':
      return { ...state, updateAvailable: true };

    default:
      return state;
  }
}
