/**
 * GitHub 連携のエラー分類（13章のエラーコード表）。
 *
 * 画面へ渡すのはここで決めた文言だけ。HTTP レスポンス本文をそのまま
 * 表示しない（SEC-003）。PAT や endpoint を含めない。
 */

export type AppErrorCode =
  | 'E-AUTH-001'
  | 'E-AUTH-002'
  | 'E-GH-401'
  | 'E-GH-403'
  | 'E-GH-404'
  | 'E-GH-422'
  | 'E-MAN-001'
  | 'E-DOC-001'
  | 'E-DOC-002'
  | 'E-DOC-003'
  | 'E-NET-001'
  | 'E-PUSH-001'
  | 'E-PUSH-002';

export interface AppErrorDescription {
  code: AppErrorCode;
  /** 利用者向けの短い説明。 */
  message: string;
  /** 次に取れる操作の案内。 */
  action: string;
}

const DESCRIPTIONS: Record<AppErrorCode, Omit<AppErrorDescription, 'code'>> = {
  'E-AUTH-001': { message: 'パスワードが正しくありません', action: 'もう一度入力してください' },
  'E-AUTH-002': {
    message: 'ローカル設定を読み込めません',
    action: 'アプリをリセットして設定し直してください',
  },
  'E-GH-401': {
    message: 'GitHub認証を更新してください',
    action: 'アクセストークンが無効か期限切れです',
  },
  'E-GH-403': {
    message: '権限または利用制限を確認してください',
    action: 'トークンの権限、レート制限、組織のポリシーを確認してください',
  },
  'E-GH-404': {
    message: 'GitHub設定を確認してください',
    action: 'リポジトリ名、ブランチ名、manifestの場所のいずれかが違います',
  },
  'E-GH-422': {
    message: '入力値を確認してください',
    action: 'ブランチ名やパスの形式が正しくありません',
  },
  'E-MAN-001': {
    message: '文書一覧の形式が未対応です',
    action: '文書リポジトリ側の処理が完了しているか確認してください',
  },
  'E-DOC-001': {
    message: '文書の完全性を確認できません',
    action: 'もう一度同期してください',
  },
  'E-DOC-002': { message: 'この文書は上限を超えています', action: '閉じてください' },
  'E-DOC-003': { message: '安全に表示できない文書です', action: '閉じてください' },
  'E-NET-001': {
    message: 'インターネット接続が必要です',
    action: '接続を確認して再試行してください',
  },
  'E-PUSH-001': {
    message: 'この環境は通知に対応していません',
    action: 'ホーム画面へ追加してから開き直してください',
  },
  'E-PUSH-002': {
    message: 'OSまたはブラウザの設定で通知が拒否されています',
    action: '端末の設定から通知を許可してください',
  },
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  /** 診断情報に載せるための HTTP ステータス。本文は保持しない。 */
  readonly httpStatus: number | null;

  constructor(code: AppErrorCode, httpStatus: number | null = null) {
    super(DESCRIPTIONS[code].message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
  }

  describe(): AppErrorDescription {
    return { code: this.code, ...DESCRIPTIONS[this.code] };
  }
}

export function describeErrorCode(code: AppErrorCode): AppErrorDescription {
  return { code, ...DESCRIPTIONS[code] };
}

/** HTTP ステータスをアプリのエラーコードへ写す（FR-SETUP-005）。 */
export function classifyHttpStatus(status: number): AppErrorCode {
  switch (status) {
    case 401:
      return 'E-GH-401';
    case 403:
      return 'E-GH-403';
    case 404:
      return 'E-GH-404';
    case 422:
      return 'E-GH-422';
    default:
      // 5xx とその他は接続の問題として扱い、再試行を促す。
      return 'E-NET-001';
  }
}

/** 自動再試行してよいか（FR-GH-006）。 */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 && status < 600;
}
