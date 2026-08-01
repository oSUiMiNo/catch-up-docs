import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * SEC-004 の「文書表示に innerHTML 系を使わない」を機械的に強制する。
 * 文書HTMLは必ず sandbox iframe の srcdoc へ渡す。
 */
const forbiddenDomSinks = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: 'dangerouslySetInnerHTML は使用禁止（SEC-004）。sandbox iframe の srcdoc を使うこと。',
  },
  // 代入だけを禁じる。読み取りは注入経路にならないため、
  // サニタイズ結果の直列化に outerHTML を読むことは許す。
  {
    selector: "AssignmentExpression[left.property.name='innerHTML']",
    message: 'innerHTML への代入は使用禁止（SEC-004）。sandbox iframe の srcdoc を使うこと。',
  },
  {
    selector: "AssignmentExpression[left.property.name='outerHTML']",
    message: 'outerHTML への代入は使用禁止（SEC-004）。',
  },
  {
    selector: "NewExpression[callee.name='Function']",
    message: '動的コード生成は使用禁止。',
  },
];

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'android/**',
      'playwright-report/**',
      'test-results/**',
      'dev-dist/**',
    ],
  },

  // ── TypeScript（型情報あり） ────────────────────────────────
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        // このリポジトリは用途ごとに lib が異なる3つの tsconfig を持つ。
        // 既定はアプリ本体とテスト。以降のブロックでファイル種別ごとに上書きする。
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': ['error', ...forbiddenDomSinks],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-console': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'all'],
    },
  },

  // ── React コンポーネント ───────────────────────────────────
  {
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // ── ログ出力の唯一の許可箇所 ───────────────────────────────
  {
    files: ['src/utils/logger.ts'],
    rules: { 'no-console': 'off' },
  },

  // ── Service Worker / Web Worker ────────────────────────────
  {
    files: ['src/push/sw.ts', 'src/crypto/sha256.worker.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.worker.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.serviceworker, ...globals.worker },
    },
  },

  // ── テスト ────────────────────────────────────────────────
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  // ── ビルド設定と E2E（Node 環境で動く） ────────────────────
  {
    files: ['*.config.ts', 'tests/e2e/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  // ── Node スクリプト（型情報なし） ──────────────────────────
  {
    files: ['scripts/**/*.mjs', '*.js', '*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'all'],
    },
  },
);
