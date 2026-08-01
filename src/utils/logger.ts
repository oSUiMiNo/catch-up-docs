/**
 * ログ出力の唯一の窓口（SEC-003）。
 *
 * production ビルドではデバッグログを抑制する。どのレベルであっても、
 * PAT、パスワード、master key、Push endpoint、文書本文を渡してはならない。
 * 呼び出し側は値そのものではなく「何が起きたか」を渡すこと。
 */

const isDevelopment = import.meta.env.DEV;

export const logger = {
  debug(message: string, ...details: unknown[]): void {
    if (isDevelopment) {
      console.debug(`[catch-up-docs] ${message}`, ...details);
    }
  },

  info(message: string, ...details: unknown[]): void {
    if (isDevelopment) {
      console.info(`[catch-up-docs] ${message}`, ...details);
    }
  },

  warn(message: string): void {
    console.warn(`[catch-up-docs] ${message}`);
  },

  /**
   * 例外の内容をそのまま出さない。HTTP のレスポンス本文や暗号素材が
   * 混ざる可能性があるため、呼び出し側が要約した文言だけを渡す。
   */
  error(message: string): void {
    console.error(`[catch-up-docs] ${message}`);
  },
};
