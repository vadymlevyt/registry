// Глобальний setup Vitest.
// jest-dom matchers (toBeInTheDocument, toHaveClass, тощо) — підключаються
// для всіх тестів. У node environment це no-op (matchers не активуються),
// у jsdom — додаються до expect.
import '@testing-library/jest-dom/vitest';

// Полифіл DOMMatrix — pdfjs-dist (canvas.js) звертається до нього на рівні
// модуля. jsdom його не визначає, тож будь-який тест, що транзитивно тягне
// pdfjs (напр. рендер CaseDossier → ocrService → claudeVision), падав на
// import. Визначаємо мінімальну заглушку лише якщо глобал відсутній —
// у node-env це no-op для логіки, у jsdom прибирає ReferenceError.
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() { return this; }
  };
}
