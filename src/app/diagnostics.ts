/**
 * 診断情報（FR-SETTINGS-003）。
 *
 * 含めてよいもの：アプリ版、ビルドSHA、UA、表示形態、通知の対応状況、
 * Service Worker の状態、直近のHTTPステータス、manifest の schema 版。
 *
 * 含めてはならないもの：PAT、パスワード、master key、リポジトリ名、
 * 文書のタイトルや本文、Push の endpoint と鍵。
 */

export interface Diagnostics {
  appVersion: string;
  buildCommitSha: string;
  userAgent: string;
  displayMode: string;
  notificationSupported: boolean;
  notificationPermission: string;
  serviceWorkerState: string;
  lastHttpStatus: number | null;
  manifestSchemaVersion: number | null;
  documentCount: number | null;
  collectedAt: string;
}

export interface DiagnosticsInput {
  lastHttpStatus: number | null;
  manifestSchemaVersion: number | null;
  documentCount: number | null;
}

function detectDisplayMode(): string {
  const modes = ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay'];
  for (const mode of modes) {
    if (window.matchMedia(`(display-mode: ${mode})`).matches) {
      return mode;
    }
  }
  if ((navigator as { standalone?: boolean }).standalone === true) {
    return 'ios-home-screen';
  }
  return 'browser';
}

async function detectServiceWorkerState(): Promise<string> {
  if (!('serviceWorker' in navigator)) {
    return 'unsupported';
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      return 'unregistered';
    }
    if (registration.active) {
      return 'active';
    }
    if (registration.installing) {
      return 'installing';
    }
    if (registration.waiting) {
      return 'waiting';
    }
    return 'registered';
  } catch {
    return 'unknown';
  }
}

export async function collectDiagnostics(input: DiagnosticsInput): Promise<Diagnostics> {
  return {
    appVersion: __APP_VERSION__,
    buildCommitSha: __BUILD_COMMIT_SHA__,
    userAgent: navigator.userAgent,
    displayMode: detectDisplayMode(),
    notificationSupported: 'Notification' in window,
    notificationPermission: 'Notification' in window ? Notification.permission : 'unsupported',
    serviceWorkerState: await detectServiceWorkerState(),
    lastHttpStatus: input.lastHttpStatus,
    manifestSchemaVersion: input.manifestSchemaVersion,
    documentCount: input.documentCount,
    collectedAt: new Date().toISOString(),
  };
}

/** コピー用のテキストにする。 */
export function formatDiagnostics(diagnostics: Diagnostics): string {
  return [
    `app version      : ${diagnostics.appVersion}`,
    `build commit     : ${diagnostics.buildCommitSha}`,
    `display mode     : ${diagnostics.displayMode}`,
    `notification     : ${diagnostics.notificationSupported ? diagnostics.notificationPermission : 'unsupported'}`,
    `service worker   : ${diagnostics.serviceWorkerState}`,
    `last http status : ${diagnostics.lastHttpStatus === null ? '-' : String(diagnostics.lastHttpStatus)}`,
    `manifest schema  : ${diagnostics.manifestSchemaVersion === null ? '-' : String(diagnostics.manifestSchemaVersion)}`,
    `document count   : ${diagnostics.documentCount === null ? '-' : String(diagnostics.documentCount)}`,
    `collected at     : ${diagnostics.collectedAt}`,
    `user agent       : ${diagnostics.userAgent}`,
  ].join('\n');
}
