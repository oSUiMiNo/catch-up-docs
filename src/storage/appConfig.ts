/**
 * GitHub 接続設定の暗号化保存（8.2.2 の app-config）。
 *
 * PAT はここにしか置かない。URL、HTML、console、例外メッセージ、診断情報へ
 * 出してはならない（FR-SETUP-004 / SEC-003）。
 */

import { z } from 'zod';

import { DEFAULT_BRANCH, DEFAULT_MANIFEST_PATH, RECORD_APP_CONFIG } from '../config/constants';
import { decryptJson, encryptJson, type EncryptedPayload } from '../crypto/aesGcm';
import { deleteRecord, getRecord, setRecord } from './db';

export const appConfigSchema = z.object({
  owner: z.string().min(1).max(39),
  repo: z.string().min(1).max(100),
  branch: z.string().min(1).max(255),
  manifestPath: z.string().min(1).max(1024),
  personalAccessToken: z.string().min(1),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

/** 初期設定ウィザードの既定値（FR-SETUP-002）。 */
export const appConfigDefaults = {
  branch: DEFAULT_BRANCH,
  manifestPath: DEFAULT_MANIFEST_PATH,
} as const;

export async function saveAppConfig(masterKey: CryptoKey, config: AppConfig): Promise<void> {
  const validated = appConfigSchema.parse(config);
  await setRecord(RECORD_APP_CONFIG, await encryptJson(masterKey, RECORD_APP_CONFIG, validated));
}

/**
 * 設定を読み出す。復号できない、または形式が合わない場合は null を返さず例外にする。
 * 壊れたまま動かすより、リセットへ誘導するほうが安全（SEC-009）。
 */
export async function loadAppConfig(masterKey: CryptoKey): Promise<AppConfig | null> {
  const stored = await getRecord<EncryptedPayload>(RECORD_APP_CONFIG);
  if (!stored) {
    return null;
  }

  const decrypted = await decryptJson<unknown>(masterKey, RECORD_APP_CONFIG, stored);
  return appConfigSchema.parse(decrypted);
}

export async function hasAppConfig(): Promise<boolean> {
  return (await getRecord<EncryptedPayload>(RECORD_APP_CONFIG)) !== null;
}

export async function deleteAppConfig(): Promise<void> {
  await deleteRecord(RECORD_APP_CONFIG);
}

/**
 * 診断や画面表示のために、秘密でない部分だけを取り出す（FR-SETTINGS-001）。
 * PAT は決して含めない。
 */
export function describeAppConfig(
  config: AppConfig,
  masked: boolean,
): {
  owner: string;
  repo: string;
  branch: string;
  manifestPath: string;
} {
  const mask = (value: string): string =>
    value.length <= 2
      ? '••'
      : `${value.slice(0, 1)}${'•'.repeat(Math.min(value.length - 2, 8))}${value.slice(-1)}`;

  return {
    owner: masked ? mask(config.owner) : config.owner,
    repo: masked ? mask(config.repo) : config.repo,
    branch: config.branch,
    manifestPath: masked ? '••••' : config.manifestPath,
  };
}
