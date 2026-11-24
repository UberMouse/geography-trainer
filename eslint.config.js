import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    'dist/',
    'node_modules/',
    'public/data/',
    '.claude/',
    'playwright-report/',
    'test-results/',
    '.cache/',
    '.durable-state/',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
  },
  {
    // The engine is pure TypeScript: no UI, storage or map code (d3-geo is pure math, so allowed).
    files: ['src/engine/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['react', 'react-dom', 'react-router', 'dexie'].map((name) => ({
            name,
            message: 'src/engine must stay pure: no UI or storage imports.',
          })),
          patterns: [
            {
              group: ['react/*', 'react-dom/*', 'react-router/*', 'dexie/*'],
              message: 'src/engine must stay pure: no UI or storage imports.',
            },
            {
              regex: '(^|/)(storage|maps)(/|$)',
              message: 'src/engine must not import from src/storage or src/maps.',
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
]);
