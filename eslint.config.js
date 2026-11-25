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
      // JSX compiles to react/jsx-runtime calls with no import statement to catch.
      'no-restricted-syntax': [
        'error',
        ...['JSXElement', 'JSXFragment'].map((selector) => ({
          selector,
          message: 'src/engine must stay pure: no JSX.',
        })),
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'src/engine takes time as an argument: no argument-less new Date().',
        },
        {
          selector: "CallExpression[callee.name='Date']",
          message: 'src/engine takes time as an argument: no Date() (it returns the current time).',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'src/engine takes an rng argument: no Math.random().',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'src/engine takes time as an argument: no Date.now().',
        },
        {
          object: 'performance',
          property: 'now',
          message: 'src/engine takes time as an argument: no performance.now().',
        },
      ],
      'no-restricted-globals': [
        'error',
        ...['globalThis', 'window', 'self', 'crypto', 'performance'].map((name) => ({
          name,
          message: `src/engine takes time and randomness as arguments and has no DOM: no ${name}.`,
        })),
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            'react',
            'react-dom',
            'react-router',
            'react-router-dom',
            'dexie',
            'dexie-react-hooks',
            'idb',
          ].map((name) => ({
            name,
            message: 'src/engine must stay pure: no UI or storage imports.',
          })),
          patterns: [
            {
              group: [
                'react/*',
                'react-dom/*',
                'react-router/*',
                'react-router-dom/*',
                'dexie/*',
                'dexie-react-hooks/*',
                'idb/*',
              ],
              message: 'src/engine must stay pure: no UI or storage imports.',
            },
            {
              regex: '(^|/)(storage|maps)(/|\\.|$)',
              message: 'src/engine must not import from src/storage or src/maps.',
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
]);
