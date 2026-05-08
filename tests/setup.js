// Глобальний setup Vitest.
// jest-dom matchers (toBeInTheDocument, toHaveClass, тощо) — підключаються
// для всіх тестів. У node environment це no-op (matchers не активуються),
// у jsdom — додаються до expect.
import '@testing-library/jest-dom/vitest';
