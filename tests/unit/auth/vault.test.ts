import { beforeEach, describe, expect, it } from 'vitest';

import { SESSION_DURATION_MS } from '@/config/constants';
import {
  changePassword,
  initializeVault,
  isInitialized,
  lockNow,
  resetVault,
  restoreSession,
  UnlockError,
  unlockWithPassword,
  validatePassword,
} from '@/auth/vault';
import { loadAppConfig, type AppConfig } from '@/storage/appConfig';
import { destroyDatabase } from '@/storage/db';
import { loadReadState, markAsRead, saveReadState } from '@/storage/readState';

const NOW = Date.UTC(2026, 7, 1, 0, 0, 0);
const PASSWORD = 'とても長いパスワード';

const CONFIG: AppConfig = {
  owner: 'example-owner',
  repo: 'example-docs',
  branch: 'main',
  manifestPath: '.app/manifest.json',
  personalAccessToken: 'example-token-value',
};

beforeEach(async () => {
  await destroyDatabase();
});

describe('パスワードの条件（FR-SETUP-003）', () => {
  it('10文字未満を拒否する', () => {
    expect(validatePassword('123456789')).not.toEqual([]);
  });

  it('10文字ちょうどを受け入れる', () => {
    expect(validatePassword('1234567890')).toEqual([]);
  });

  it('128文字ちょうどを受け入れる', () => {
    expect(validatePassword('a'.repeat(128))).toEqual([]);
  });

  it('129文字を拒否する', () => {
    expect(validatePassword('a'.repeat(129))).not.toEqual([]);
  });

  it('空白だけでも長さを満たせば受け入れる（前後の空白を削らないため）', () => {
    expect(validatePassword(' '.repeat(12))).toEqual([]);
  });
});

describe('初回設定（FR-SETUP-001 / FR-SETUP-006）', () => {
  it('設定前は未初期化と判定する', async () => {
    expect(await isInitialized()).toBe(false);
  });

  it('設定すると初期化済みになる', async () => {
    await initializeVault(PASSWORD, CONFIG, NOW);
    expect(await isInitialized()).toBe(true);
  });

  it('設定を暗号化して保存し、master key で読み出せる', async () => {
    const vault = await initializeVault(PASSWORD, CONFIG, NOW);
    expect(await loadAppConfig(vault.masterKey)).toEqual(CONFIG);
  });

  it('有効期限は認証時刻から120時間後になる', async () => {
    const vault = await initializeVault(PASSWORD, CONFIG, NOW);
    expect(vault.expiresAt).toBe(NOW + SESSION_DURATION_MS);
  });

  it('短すぎるパスワードでは初期化できない', async () => {
    await expect(initializeVault('short', CONFIG, NOW)).rejects.toThrow();
  });
});

describe('パスワードによる解除', () => {
  beforeEach(async () => {
    await initializeVault(PASSWORD, CONFIG, NOW);
    await lockNow();
  });

  it('正しいパスワードで解除できる', async () => {
    const vault = await unlockWithPassword(PASSWORD, NOW + 1000);
    expect(await loadAppConfig(vault.masterKey)).toEqual(CONFIG);
  });

  it('解除するたびに期限が引き直される', async () => {
    const later = NOW + 60_000;
    const vault = await unlockWithPassword(PASSWORD, later);
    expect(vault.expiresAt).toBe(later + SESSION_DURATION_MS);
  });

  it('誤ったパスワードは wrong-password になる', async () => {
    await expect(unlockWithPassword('ちがうパスワード', NOW)).rejects.toMatchObject({
      reason: 'wrong-password',
    });
  });

  it('5回失敗すると待機を課される', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(unlockWithPassword('ちがうパスワード', NOW)).rejects.toBeInstanceOf(UnlockError);
    }

    // 6回目は正しいパスワードでも待機中で弾かれる。
    await expect(unlockWithPassword(PASSWORD, NOW)).rejects.toMatchObject({ reason: 'blocked' });
  });

  it('待機時間が過ぎれば解除できる', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(unlockWithPassword('ちがうパスワード', NOW)).rejects.toBeInstanceOf(UnlockError);
    }

    const vault = await unlockWithPassword(PASSWORD, NOW + 30_000);
    expect(vault.masterKey).toBeDefined();
  });

  it('解除に成功すると失敗回数がリセットされる', async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(unlockWithPassword('ちがうパスワード', NOW)).rejects.toBeInstanceOf(UnlockError);
    }
    await unlockWithPassword(PASSWORD, NOW);

    // リセットされていれば、次の4回でも待機は発生しない。
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(unlockWithPassword('ちがうパスワード', NOW)).rejects.toMatchObject({
        reason: 'wrong-password',
      });
    }
  });
});

describe('セッションの自動復元（FR-AUTH-002）', () => {
  it('期限内なら自動で解除される', async () => {
    await initializeVault(PASSWORD, CONFIG, NOW);

    const result = await restoreSession(NOW + SESSION_DURATION_MS - 1);
    expect(result.status).toBe('unlocked');
  });

  it('120時間ちょうどでは期限切れになる（AC-004）', async () => {
    await initializeVault(PASSWORD, CONFIG, NOW);

    const result = await restoreSession(NOW + SESSION_DURATION_MS);
    expect(result).toEqual({ status: 'locked', reason: 'expired' });
  });

  it('復元した master key で設定を読める', async () => {
    await initializeVault(PASSWORD, CONFIG, NOW);

    const result = await restoreSession(NOW + 60_000);
    if (result.status !== 'unlocked') {
      throw new Error('解除できませんでした');
    }
    expect(await loadAppConfig(result.vault.masterKey)).toEqual(CONFIG);
  });

  it('アプリを開いた時刻では期限を延長しない（FR-AUTH-001）', async () => {
    await initializeVault(PASSWORD, CONFIG, NOW);

    const midway = await restoreSession(NOW + 60 * 60 * 1000);
    if (midway.status !== 'unlocked') {
      throw new Error('解除できませんでした');
    }
    expect(midway.vault.expiresAt).toBe(NOW + SESSION_DURATION_MS);
  });

  it('今すぐロックの後は復元できない（FR-AUTH-006 / AC-005）', async () => {
    await initializeVault(PASSWORD, CONFIG, NOW);
    await lockNow();

    expect(await restoreSession(NOW + 1000)).toEqual({ status: 'locked', reason: 'no-session' });
  });

  it('時計を巻き戻すとロックされる（FR-AUTH-003）', async () => {
    await initializeVault(PASSWORD, CONFIG, NOW);

    const result = await restoreSession(NOW - 10 * 60 * 1000);
    expect(result).toEqual({ status: 'locked', reason: 'clock-rollback' });
  });

  it('未来へ飛ばしてから戻すとロックされる', async () => {
    await initializeVault(PASSWORD, CONFIG, NOW);

    // いちど未来を観測させる（期限内の範囲で）。
    await restoreSession(NOW + 100 * 60 * 60 * 1000);

    const result = await restoreSession(NOW + 60_000);
    expect(result).toEqual({ status: 'locked', reason: 'clock-rollback' });
  });

  it('期限切れを検知したらセッションを破棄する', async () => {
    await initializeVault(PASSWORD, CONFIG, NOW);
    await restoreSession(NOW + SESSION_DURATION_MS);

    expect(await restoreSession(NOW + SESSION_DURATION_MS + 1)).toEqual({
      status: 'locked',
      reason: 'no-session',
    });
  });
});

describe('パスワード変更（FR-AUTH-007）', () => {
  it('新しいパスワードで解除できるようになる', async () => {
    await initializeVault(PASSWORD, CONFIG, NOW);
    await changePassword(PASSWORD, '新しく長いパスワード', NOW);
    await lockNow();

    const vault = await unlockWithPassword('新しく長いパスワード', NOW);
    expect(await loadAppConfig(vault.masterKey)).toEqual(CONFIG);
  });

  it('古いパスワードでは解除できなくなる', async () => {
    await initializeVault(PASSWORD, CONFIG, NOW);
    await changePassword(PASSWORD, '新しく長いパスワード', NOW);
    await lockNow();

    await expect(unlockWithPassword(PASSWORD, NOW)).rejects.toMatchObject({
      reason: 'wrong-password',
    });
  });

  it('変更しても保存済みデータはそのまま読める（master key を作り直さない）', async () => {
    const vault = await initializeVault(PASSWORD, CONFIG, NOW);
    await saveReadState(
      vault.masterKey,
      markAsRead(await loadReadState(vault.masterKey), 'doc_0000000000000001', 'a'.repeat(64), NOW),
    );

    const updated = await changePassword(PASSWORD, '新しく長いパスワード', NOW);
    const state = await loadReadState(updated.masterKey);

    expect(state.entries.doc_0000000000000001).toBeDefined();
  });

  it('現在のパスワードが違えば変更できない', async () => {
    await initializeVault(PASSWORD, CONFIG, NOW);
    await expect(changePassword('ちがうパスワード', '新しく長いパスワード', NOW)).rejects.toThrow();
  });

  it('新しいパスワードが条件を満たさなければ変更できない', async () => {
    await initializeVault(PASSWORD, CONFIG, NOW);
    await expect(changePassword(PASSWORD, 'short', NOW)).rejects.toThrow();
  });
});

describe('リセット（FR-SETTINGS-004 / AC-020）', () => {
  it('すべて消えて未初期化に戻る', async () => {
    const vault = await initializeVault(PASSWORD, CONFIG, NOW);
    await saveReadState(
      vault.masterKey,
      markAsRead(await loadReadState(vault.masterKey), 'doc_0000000000000001', 'a'.repeat(64), NOW),
    );

    await resetVault();

    expect(await isInitialized()).toBe(false);
    expect(await restoreSession(NOW)).toEqual({ status: 'locked', reason: 'no-session' });
  });

  it('リセット後は古いパスワードで解除できない', async () => {
    await initializeVault(PASSWORD, CONFIG, NOW);
    await resetVault();

    await expect(unlockWithPassword(PASSWORD, NOW)).rejects.toMatchObject({
      reason: 'not-initialized',
    });
  });
});
