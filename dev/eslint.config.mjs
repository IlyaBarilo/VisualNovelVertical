import { createRequire } from 'node:module';

// Конфигурация из dev загружает зависимости из расположенного рядом package.json.
const loadDevDependency = createRequire(new URL('./package.json', import.meta.url));
const globals = loadDevDependency('globals');

// Набор ограничен правилами, которые находят вероятные дефекты и не навязывают форматирование.
const correctnessRules = {
  'no-dupe-keys': 'error',
  'no-undef': 'error',
  'no-unused-vars': ['error', { caughtErrors: 'none' }],
  'no-fallthrough': 'error',
  'no-unreachable': 'error',
  'eqeqeq': ['error', 'smart'],
  'no-implicit-globals': 'error'
};

export default [
  {
    name: 'Исключения сгенерированных файлов и установленных зависимостей',
    ignores: [
      'dev/node_modules/**',
      'dev/.playwright/**'
    ]
  },
  {
    name: 'Классические браузерные скрипты движка',
    files: [
      'engine/*.js',
      'license-key.js',
      'story-example.js',
      'user-example.js',
      'story.js',
      'dev/tests/e2e/fixtures/*.js'
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        module: 'readonly'
      }
    },
    rules: {
      ...correctnessRules,
      // Тихое подавление допустимо только с поясняющим комментарием внутри catch/callback.
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-empty-function': 'error'
    }
  },
  {
    name: 'Worker-контекст загрузчика сценариев',
    files: ['engine/story-sandbox-loader.js'],
    languageOptions: {
      globals: globals.worker
    }
  },
  {
    name: 'Node.js ESM и автоматические тесты',
    files: ['dev/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node
    },
    rules: correctnessRules
  },
  {
    name: 'Браузерный контекст внутри Playwright E2E',
    files: ['dev/tests/e2e/**/*.mjs', 'dev/tests/release-smoke.mjs'],
    languageOptions: {
      globals: globals.browser
    }
  }
];
