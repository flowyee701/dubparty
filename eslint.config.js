import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'storage/**',
      'data/**',
      '.e2e-data/**',
      'playwright-report/**',
      'test-results/**',
      'apps/server/assets/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['apps/client/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['apps/client/public/**/*.js'],
    languageOptions: { globals: { ...globals.audioWorklet } },
  },
  {
    files: [
      'apps/server/**/*.ts',
      'e2e/**/*.ts',
      'scripts/**/*.mjs',
      '*.config.{js,ts}',
      'apps/*/*.config.{js,ts}',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/server/scripts/**/*.ts', 'e2e/**/*.ts', 'scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
);
