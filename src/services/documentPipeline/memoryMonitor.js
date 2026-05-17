// ── DP-3 · MEMORY MONITOR ───────────────────────────────────────────────────
// Memory-aware execution: радник розміру chunk на основі реально доступної
// пам'яті де браузер це дозволяє, з чесним fallback де ні.
//
// `performance.memory` — НЕстандартний Chrome-only API (jsHeapSizeLimit,
// usedJSHeapSize, totalJSHeapSize). Safari/iPad його НЕ має. Тому це лише
// БОНУС (як Idle Detection у білінгу — філософія §9): де є — підкручуємо
// chunk менше під тиском пам'яті; де нема — статичний розрахунок за розміром
// файлу (консервативний, працює всюди).
//
// Чистий модуль: без React/Drive/мережі. `performance` ін'єктується (тест
// підставляє стаб; за замовчуванням — глобальний `performance`).
//
// Один сенс кожної функції (правило #11):
//   • readMemory       — знімок пам'яті АБО null якщо API недоступне.
//   • memoryPressure   — частка використаної купи [0..1] АБО null.
//   • adviseChunkPages — скільки сторінок брати в один chunk (бере min з
//                        ліміту за розміром файлу і ліміту за тиском пам'яті).

// Дефолтні межі. experimental — review after 1 month (філософія варіабельності).
export const DEFAULT_CHUNK_PAGES = 25;          // як legacy pdf-lib чанк (CLAUDE.md OCR)
export const MIN_CHUNK_PAGES = 5;               // нижче — накладні витрати > користь
export const MAX_CHUNK_PAGES = 40;
// Орієнтовний слід одної сторінки скана у RAM при обробці (PDF-байти +
// pdf-lib структури + Document AI відповідь). Свідомо песимістично.
const APPROX_PAGE_RAM_BYTES = 6 * 1024 * 1024;
// Поріг тиску купи, вище якого активно зменшуємо chunk і частіше GC-натякаємо.
const HIGH_PRESSURE = 0.8;

function resolvePerf(perf) {
  if (perf) return perf;
  return typeof performance !== 'undefined' ? performance : null;
}

// Знімок пам'яті або null (API недоступне — Safari/iPad/Node).
export function readMemory(perf) {
  const p = resolvePerf(perf);
  const m = p && p.memory;
  if (!m || typeof m.jsHeapSizeLimit !== 'number' || m.jsHeapSizeLimit <= 0) {
    return null;
  }
  return {
    limit: m.jsHeapSizeLimit,
    used: m.usedJSHeapSize || 0,
    total: m.totalJSHeapSize || 0,
  };
}

// Частка використаної купи [0..1], або null якщо виміряти неможливо.
export function memoryPressure(perf) {
  const mem = readMemory(perf);
  if (!mem) return null;
  return Math.min(1, Math.max(0, mem.used / mem.limit));
}

// Скільки сторінок класти в один chunk. Бере МІНІМУМ з двох обмежень:
//   1. за розміром файлу — рівномірний розподіл, не більше DEFAULT.
//   2. за тиском пам'яті (тільки де API є) — під тиском ріжемо chunk менше.
// Завжди в межах [MIN, MAX]. Один сенс: «безпечний розмір chunk зараз».
export function adviseChunkPages({ totalPages, fileSizeBytes = 0, perf } = {}) {
  const pages = Math.max(1, Number(totalPages) || 0);
  let advised = DEFAULT_CHUNK_PAGES;

  // Обмеження за розміром файлу: великий файл → менший chunk, щоб байтовий
  // слід одного chunk лишався поміркованим (грубо ≤ ~40 МБ на chunk).
  if (fileSizeBytes > 0 && pages > 0) {
    const bytesPerPage = fileSizeBytes / pages;
    if (bytesPerPage > 0) {
      const pagesFor40MB = Math.floor((40 * 1024 * 1024) / bytesPerPage);
      if (pagesFor40MB >= 1) advised = Math.min(advised, pagesFor40MB);
    }
  }

  // Обмеження за тиском пам'яті (бонус, тільки Chrome).
  const mem = readMemory(perf);
  if (mem) {
    const free = Math.max(0, mem.limit - mem.used);
    // Лишаємо half-headroom: використовуємо не більше половини вільної купи.
    const pagesForFreeRam = Math.floor((free * 0.5) / APPROX_PAGE_RAM_BYTES);
    if (pagesForFreeRam >= 1) advised = Math.min(advised, pagesForFreeRam);
    const pressure = mem.used / mem.limit;
    if (pressure >= HIGH_PRESSURE) {
      advised = Math.min(advised, MIN_CHUNK_PAGES);  // під тиском — найменший
    }
  }

  advised = Math.min(advised, pages);                // не більше ніж є сторінок
  return Math.max(MIN_CHUNK_PAGES, Math.min(MAX_CHUNK_PAGES, advised || MIN_CHUNK_PAGES));
}

// Чи варто наполегливо звільняти пам'ять (занулення + опційний GC-натяк).
// true коли тиск високий (Chrome) — інакше false (нема даних = не панікуємо).
export function shouldFreeAggressively(perf) {
  const pressure = memoryPressure(perf);
  return pressure !== null && pressure >= HIGH_PRESSURE;
}

// GC-дисципліна: браузер не дає примусовий GC (крім --expose-gc).
// Чесно намагаємось підказати рушію якщо доступно; інакше no-op. Реальне
// звільнення — занулення посилань у caller'і ПІСЛЯ кожного chunk.
export function hintGarbageCollection() {
  try {
    if (typeof globalThis !== 'undefined' && typeof globalThis.gc === 'function') {
      globalThis.gc();
      return true;
    }
  } catch { /* gc недоступний — норма */ }
  return false;
}
