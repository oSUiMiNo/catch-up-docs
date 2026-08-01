/**
 * 秘密情報スキャナの検証（SEC-002 / AC-017）。
 *
 * 検出対象の文字列をこのファイルへ literal で書くと、スキャナ自身が
 * 自分のテストを検出してしまう。連結して組み立てることで literal の出現を避ける。
 * このファイルはスキャナの除外一覧にも入れてある。
 */

import { describe, expect, it } from 'vitest';

// @ts-expect-error - Node スクリプトのため型定義を持たない
import { inspectContent, inspectPath } from '../../../scripts/verify-no-secrets.mjs';

interface Finding {
  path: string;
  reason: string;
}

type InspectContent = (
  relativePath: string,
  content: string,
  privateRepoName: string | undefined,
) => Finding[];
type InspectPath = (relativePath: string) => Finding | null;

const inspect = inspectContent as InspectContent;
const inspectFilePath = inspectPath as InspectPath;

/** literal を残さないよう、実行時に組み立てる。 */
const fakeFineGrainedPat = `${'github'}_${'pat'}_${'A'.repeat(22)}_${'B'.repeat(59)}`;
const fakeClassicPat = `${'gh'}p_${'C'.repeat(36)}`;

describe('トークンらしき文字列の検出（AC-017）', () => {
  it('Fine-grained PAT を検出する', () => {
    const findings = inspect('src/config.ts', `const token = "${fakeFineGrainedPat}";`, undefined);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('Classic PAT を検出する', () => {
    const findings = inspect('README.md', `token: ${fakeClassicPat}`, undefined);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('秘密鍵のヘッダーを検出する', () => {
    const findings = inspect('key.txt', '-----BEGIN RSA PRIVATE KEY-----\nabc\n', undefined);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('AWS のアクセスキーIDを検出する', () => {
    const findings = inspect('config.json', `{"key":"AKIA${'Z'.repeat(16)}"}`, undefined);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('普通の文章は検出しない', () => {
    const content = 'これは説明文です。GitHubのトークンについて書いていますが、値は含みません。';
    expect(inspect('docs/SETUP.md', content, undefined)).toEqual([]);
  });

  it('プレースホルダは検出しない', () => {
    const content = 'gh secret set VAPID_PRIVATE_KEY --repo <GITHUB_OWNER>/<PRIVATE_DOCS_REPO>';
    expect(inspect('docs/SETUP.md', content, undefined)).toEqual([]);
  });
});

describe('文書リポジトリ名の検出（AC-002）', () => {
  it('指定した名前が含まれていれば検出する', () => {
    const findings = inspect('README.md', 'my-private-notes を参照', 'my-private-notes');
    expect(findings.length).toBe(1);
  });

  it('検出理由に値そのものを含めない', () => {
    const findings = inspect('README.md', 'my-private-notes を参照', 'my-private-notes');
    expect(findings[0]?.reason).not.toContain('my-private-notes');
  });

  it('名前が渡されなければ検査しない', () => {
    expect(inspect('README.md', 'my-private-notes を参照', undefined)).toEqual([]);
  });

  it('短すぎる名前は誤検出を避けるため検査しない', () => {
    expect(inspect('README.md', 'abc という語を含む', 'abc')).toEqual([]);
  });
});

describe('ファイル名だけで判定する違反', () => {
  it('.env の実ファイルを拒否する', () => {
    expect(inspectFilePath('.env')).not.toBeNull();
    expect(inspectFilePath('config/.env')).not.toBeNull();
  });

  it('.env.example は許可する', () => {
    expect(inspectFilePath('.env.example')).toBeNull();
  });

  it('.env.local を拒否する', () => {
    expect(inspectFilePath('.env.local')).not.toBeNull();
  });

  it('キーストアを拒否する', () => {
    expect(inspectFilePath('android/android.keystore')).not.toBeNull();
    expect(inspectFilePath('release.jks')).not.toBeNull();
    expect(inspectFilePath('cert.p12')).not.toBeNull();
  });

  it('鍵ファイルを拒否する', () => {
    expect(inspectFilePath('server.pem')).not.toBeNull();
    expect(inspectFilePath('private.key')).not.toBeNull();
  });

  it('通常のソースは許可する', () => {
    expect(inspectFilePath('src/main.tsx')).toBeNull();
    expect(inspectFilePath('public/runtime-config.json')).toBeNull();
  });
});
