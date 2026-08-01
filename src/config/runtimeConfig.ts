/**
 * 公開してよいビルド時設定（runtime-config.json）の読み込みと検証。
 *
 * ここに文書リポジトリ名や PAT は含まれない。利用者固有の接続先は、
 * 初期設定ウィザードで入力し暗号化して IndexedDB へ保存する。
 */

import { z } from 'zod';

const urlString = z.string().refine(
  (value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  },
  { message: 'URL の形式が不正です' },
);

const cssColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, '色は #rrggbb 形式で指定します');

export const runtimeConfigSchema = z.object({
  schemaVersion: z.literal(1),
  appName: z.string().min(1).max(64),
  appShortName: z.string().min(1).max(32),
  appDescription: z.string().max(200),
  language: z.string().min(2).max(8),
  themeColor: cssColor,
  backgroundColor: cssColor,
  publicBaseUrl: urlString,
  androidPackageId: z.string().min(3).max(128),
  /** 空文字はセットアップ未完了を意味する。通知機能だけが無効になる。 */
  vapidPublicKey: z.string(),
  workflowFiles: z.object({
    registerPushDevice: z.string().min(1),
    removePushDevice: z.string().min(1),
    sendTestPush: z.string().min(1),
  }),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

let cached: RuntimeConfig | null = null;

/**
 * runtime-config.json を取得して検証する。1 度だけ取得し、以後は使い回す。
 * 失敗時は例外を投げ、起動判定画面がエラー表示へ倒す（SEC-009 の fail closed）。
 */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (cached) {
    return cached;
  }

  const response = await fetch(`${__BASE_PATH__}runtime-config.json`, {
    credentials: 'omit',
    cache: 'no-cache',
  });

  if (!response.ok) {
    throw new Error('アプリ設定を読み込めませんでした');
  }

  const parsed = runtimeConfigSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('アプリ設定の形式が未対応です');
  }

  cached = parsed.data;
  return cached;
}

/** テスト用。読み込み済みの設定を差し替える。 */
export function setRuntimeConfigForTest(config: RuntimeConfig | null): void {
  cached = config;
}

/** 通知登録ワークフローの実行画面 URL を組み立てる（FR-PUSH-004）。 */
export function buildWorkflowDispatchUrl(
  owner: string,
  repo: string,
  workflowFile: string,
): string {
  const encode = (value: string): string => encodeURIComponent(value);
  return `https://github.com/${encode(owner)}/${encode(repo)}/actions/workflows/${encode(workflowFile)}`;
}
