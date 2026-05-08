// ── VITEST CONFIG ────────────────────────────────────────────────────────────
// Конфіг тестів для Legal BMS. Принцип: швидкий повний прогон.
//
// Структура тестів:
//   tests/unit/         — юніт-тести сервісів і UI компонентів
//   tests/integration/  — інтеграційні тести workflow'ів (з mock state)
//
// Environment вибирається за розширенням файлу:
//   .test.jsx → jsdom (для рендеру React-компонентів через Testing Library)
//   .test.js / .test.mjs → node (для сервісних тестів — швидше)

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],   // JSX transform + automatic React import для .jsx тестів
  test: {
    globals: true,                  // describe / it / expect доступні без імпорту
    environment: 'node',
    include: ['tests/**/*.test.{js,mjs,jsx}'],
    exclude: ['node_modules', 'dist', '.git'],
    testTimeout: 10000,             // 10с на тест (vs дефолт 5с)
    pool: 'threads',
    maxWorkers: 4,
    minWorkers: 1,
    reporters: process.env.CI ? ['default', 'json'] : ['default'],
    outputFile: process.env.CI ? './test-results.json' : undefined,

    // Vitest 4 прибрав environmentMatchGlobs. Кожен .jsx тест задає
    // jsdom через рядок `// @vitest-environment jsdom` зверху файлу.
    // Сервісні .test.js / .test.mjs лишаються у node за дефолтом.

    // Глобальний setup для @testing-library/jest-dom matchers.
    setupFiles: ['tests/setup.js'],
  },
});
