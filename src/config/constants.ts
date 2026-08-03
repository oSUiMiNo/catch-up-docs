/**
 * アプリ全体で使う定数。
 *
 * NFR-003 に従い、マジックナンバーはすべてここへ集約する。
 * 仕様の数値を変えるときはこのファイルだけを直せばよい状態を保つこと。
 */

// ── セッションと認証 ────────────────────────────────────────

/** FR-AUTH-001：最後に正しいパスワードを入力した時刻から 120 時間。 */
export const SESSION_DURATION_MS = 120 * 60 * 60 * 1000;

/** FR-AUTH-003：端末時刻がこれ以上過去へ戻ったら再認証させる。 */
export const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;

/** 時計監視のために「観測した最大時刻」を保存する間隔。 */
export const CLOCK_OBSERVATION_INTERVAL_MS = 60 * 1000;

/** FR-AUTH-005：連続失敗がこの回数に達したら待機を課す。 */
export const AUTH_FAILURE_THRESHOLD = 5;

/** FR-AUTH-005：最初の待機時間。以降は倍増する。 */
export const AUTH_BACKOFF_INITIAL_MS = 30 * 1000;

/** FR-AUTH-005：待機時間の上限。 */
export const AUTH_BACKOFF_MAX_MS = 5 * 60 * 1000;

/** FR-SETUP-003：アプリ専用パスワードの長さ。前後の空白は削らない。 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

// ── 暗号 ────────────────────────────────────────────────────

/** 8.2.3：暗号方式のバージョン。AAD に含めるため、変更は移行を伴う。 */
export const ALGORITHM_VERSION = 1;

/** 8.2.3：PBKDF2-HMAC-SHA-256 の反復回数。 */
export const PBKDF2_ITERATIONS = 600_000;

/** 8.2.3：salt は 16 バイト以上の暗号学的乱数。 */
export const PBKDF2_SALT_BYTES = 16;

/** 8.2.3：導出鍵と master key の長さ。 */
export const AES_KEY_BITS = 256;

/** 8.2.3：AES-GCM の IV は暗号化のたびに 96bit 乱数。 */
export const AES_GCM_IV_BYTES = 12;

/** AES-GCM の認証タグ長。 */
export const AES_GCM_TAG_BITS = 128;

// ── IndexedDB ───────────────────────────────────────────────

/** 8.2.1：データベース名とバージョン。 */
export const DB_NAME = 'private-html-library';
export const DB_VERSION = 1;

export const STORE_APP_META = 'appMeta';
export const STORE_ENCRYPTED_RECORDS = 'encryptedRecords';
export const STORE_CRYPTO_KEYS = 'cryptoKeys';

/** 8.2.2：暗号化レコードのキー。AAD にも使うため文字列を変更しない。 */
export const RECORD_APP_CONFIG = 'app-config';
export const RECORD_READ_STATE = 'read-state';
export const RECORD_PASSWORD_ENVELOPE = 'password-envelope';
export const RECORD_SESSION_ENVELOPE = 'session-envelope';

export const KEY_DEVICE_WRAPPING = 'device-wrapping-key';
export const META_AUTH_FAILURE_STATE = 'auth-failure-state';
export const META_CLOCK_WITNESS = 'clock-witness';

/** 保存レコードのスキーマ版。AAD に含める。 */
export const RECORD_SCHEMA_VERSION = 1;

// ── GitHub API ──────────────────────────────────────────────

/** FR-GH-001：Contents API の基点。 */
export const GITHUB_API_ORIGIN = 'https://api.github.com';

/**
 * FR-GH-002：API バージョンヘッダー。
 * GitHub が更新した場合にここ 1 箇所だけを直せばよいようにする。
 */
export const GITHUB_API_VERSION = '2022-11-28';

/** FR-GH-004：1 MB を超えるファイルにも対応するため常に raw を要求する。 */
export const GITHUB_ACCEPT_RAW = 'application/vnd.github.raw+json';

/** FR-GH-006：再試行は 5xx とネットワークエラーだけ。最大 2 回。 */
export const GITHUB_MAX_RETRIES = 2;
export const GITHUB_RETRY_BASE_DELAY_MS = 500;
export const GITHUB_RETRY_MAX_DELAY_MS = 8_000;

/** 既定値（付録A）。 */
export const DEFAULT_BRANCH = 'main';
export const DEFAULT_MANIFEST_PATH = '.app/manifest.json';
export const DOCUMENTS_DIRECTORY = 'documents';

// ── 文書 ────────────────────────────────────────────────────

/** 付録A：manifest に載せられる文書数の上限。 */
export const MAX_DOCUMENTS = 500;

/** 付録A：1 文書あたりのバイト数上限（20 MB）。 */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** manifest スキーマの対応範囲。 */
export const SUPPORTED_MANIFEST_SCHEMA_VERSIONS = [1] as const;

// ── 通知 ────────────────────────────────────────────────────

/** 付録A：通知を登録できる端末数の上限。 */
export const MAX_PUSH_DEVICES = 5;

/** FR-PUSH-003：購読 JSON のスキーマ版。 */
export const PUSH_SUBSCRIPTION_SCHEMA_VERSION = 1;

/**
 * FR-PUSH-005：文書リポジトリ側で購読を保持しているファイル。
 * アプリはここへ書き込まないが、この端末が登録済みかを確かめるために読む。
 */
export const PUSH_SUBSCRIPTIONS_PATH = '.app/push-subscriptions.json';

/** 通知に載せる文言。FR-PUSH-007 により文書名やリポジトリ名は含めない。 */
export const NOTIFICATION_TITLE = 'catch-up-docs';

/** 通知タップ時のディープリンクを表すクエリパラメータ。 */
export const DEEP_LINK_PARAM = 'open';

// ── UI ──────────────────────────────────────────────────────

/** 10.1：主要ボタンの最小タップ領域。 */
export const MIN_TAP_TARGET_PX = 44;

/** FR-VIEW-008：ビューアの文字サイズ調整範囲（%）。 */
export const VIEWER_FONT_SCALE_MIN = 80;
export const VIEWER_FONT_SCALE_MAX = 200;
export const VIEWER_FONT_SCALE_STEP = 10;
export const VIEWER_FONT_SCALE_DEFAULT = 100;

/** FR-DASH-002：検索入力から表示更新までの目標時間に収めるためのデバウンス。 */
export const SEARCH_DEBOUNCE_MS = 80;

/** FR-DASH-001：カードに表示するタグの最大数。 */
export const DASHBOARD_VISIBLE_TAGS = 3;
