/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** package.json の version。vite.config.ts の define で埋め込む。 */
declare const __APP_VERSION__: string;

/** ビルド元のコミット SHA。設定画面へ表示する（SEC-006）。 */
declare const __BUILD_COMMIT_SHA__: string;

/** GitHub Pages の配信パス。末尾スラッシュ付き。 */
declare const __BASE_PATH__: string;
