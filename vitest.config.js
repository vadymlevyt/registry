// ── VITEST CONFIG ────────────────────────────────────────────────────────────
// Конфіг тестів для Legal BMS. Мінімальний — додаткові плагіни (coverage,
// jsdom) додаємо лише коли реально потрібні. Принцип: швидкий повний прогон.
//
// Структура тестів:
//   tests/unit/         — юніт-тести сервісів (чисті функції, без DOM)
//   tests/integration/  — інтеграційні тести workflow'ів (з mock state)

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,                  // describe / it / expect доступні без імпорту
    environment: 'node',            // node environment — UI наразі не тестуємо
    include: ['tests/**/*.test.{js,mjs,jsx}'],
    exclude: ['node_modules', 'dist', '.git'],
    testTimeout: 10000,             // 10с на тест (vs дефолт 5с)
    pool: 'threads',
    maxWorkers: 4,
    minWorkers: 1,
    reporters: process.env.CI ? ['default', 'json'] : ['default'],
    outputFile: process.env.CI ? './test-results.json' : undefined,
  },
});
