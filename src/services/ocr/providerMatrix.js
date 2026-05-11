// ── OCR PROVIDER MATRIX ─────────────────────────────────────────────────────
//
// Дві окремі матриці. Перша — який провайдер обробляє який тип файлу.
// Друга — що повертає кожен провайдер. Розділені свідомо: матриця замовника
// керує вибором, матриця виконавця документує контракт результату.
//
// Розрізнення CONTENT-properties vs FILE-properties:
//   У Drive API ми знаємо тільки mimeType. "searchable PDF" vs "scanned PDF" —
//   це властивість КОНТЕНТУ, не файлу. Виявляється тільки після того як
//   pdfjsLocal спробував витягти текстовий шар. Тому матриця замовника описує
//   ЛАНЦЮЖКИ з фолбеком, а не одиничний вибір. Для application/pdf ланцюжок
//   починається з pdfjsLocal (дешево, локально, без API). Якщо текстового
//   шару немає — pdfjsLocal кидає UNSUPPORTED, і фолбек на documentAi
//   (справжній OCR). Це економить виклики Document AI на searchable документах.
//
// ────────────────────────────────────────────────────────────────────────────
// МАТРИЦЯ ЗАМОВНИКА — який провайдер обробляє який тип файлу
// ────────────────────────────────────────────────────────────────────────────
//
//                  │ application/pdf │ image/*  │ google-doc │ text/*   │ html
// ─────────────────┼─────────────────┼──────────┼────────────┼──────────┼──────
// pdfjsLocal       │       1️⃣        │          │    1️⃣      │    1️⃣    │  1️⃣
// documentAi       │       2️⃣        │   1️⃣     │            │          │
// claudeVision     │       3️⃣        │   2️⃣     │            │          │
//
// 1️⃣ 2️⃣ 3️⃣ — порядок у ланцюжку фолбеку. pdfjsLocal для PDF пробується першим
// бо швидко відсіває searchable документи без витрат на Document AI.
//
// ────────────────────────────────────────────────────────────────────────────
// МАТРИЦЯ ВИКОНАВЦЯ — що повертає кожен провайдер
// ────────────────────────────────────────────────────────────────────────────
//
//                  │ text │ pageCount │ pageStructure
// ─────────────────┼──────┼───────────┼──────────────
// pdfjsLocal       │  ✓   │     ✓     │      ✗
// documentAi       │  ✓   │     ✓     │      ✓
// claudeVision     │  ✓   │     ✓     │      ✗ (план — окремий TASK)
//
// pageStructure — масив page об'єктів у форматі Document AI:
//   { pageNumber, paragraphs, blocks, tables, headers, footers, layout, ... }
// Інші провайдери що додаватимуть pageStructure — мають мапити свої формати
// у цю стандартну структуру.
//
// НЕ декларуємо "повертає метадані" як константу на провайдері — це створює
// двозначність "ЗАВЖДИ повертає" vs "МОЖЕ повертати". Натомість ocrService
// дивиться у ФАКТИЧНУ відповідь: є pageStructure → пише .layout.json, немає
// → пише тільки .txt. Принцип "однозначність" з DEVELOPMENT_PHILOSOPHY.md —
// факт у відповіді, не декларація на провайдері.
//
// ────────────────────────────────────────────────────────────────────────────

// FALLBACK_CHAINS_BY_MIME — ланцюжок провайдерів для сімейства mimeType.
// Ключ — функція-предикат над file. Перший ланцюжок з true-предикатом виграє.
// Список свідомо короткий: PDF, зображення, текстові формати. Розширення
// (DOCX, XLSX, інші) — додати запис, решта системи не міняється.
const FALLBACK_CHAINS_BY_MIME = [
  {
    name: 'pdf',
    test: (file) => {
      const lname = (file?.name || '').toLowerCase();
      return file?.mimeType === 'application/pdf' || lname.endsWith('.pdf');
    },
    chain: ['pdfjsLocal', 'documentAi', 'claudeVision'],
  },
  {
    name: 'image',
    test: (file) => file?.mimeType?.startsWith('image/'),
    chain: ['documentAi', 'claudeVision'],
  },
  {
    name: 'google_doc',
    test: (file) => file?.mimeType === 'application/vnd.google-apps.document',
    chain: ['pdfjsLocal'],
  },
  {
    name: 'text',
    test: (file) => {
      const lname = (file?.name || '').toLowerCase();
      return (
        file?.mimeType === 'text/plain' ||
        file?.mimeType === 'text/markdown' ||
        lname.endsWith('.txt') ||
        lname.endsWith('.md')
      );
    },
    chain: ['pdfjsLocal'],
  },
  {
    name: 'html',
    test: (file) => {
      const lname = (file?.name || '').toLowerCase();
      return (
        file?.mimeType === 'text/html' ||
        file?.mimeType === 'application/xhtml+xml' ||
        lname.endsWith('.html') ||
        lname.endsWith('.htm')
      );
    },
    chain: ['pdfjsLocal'],
  },
];

// selectProviderChain — повертає ланцюжок провайдерів для файлу.
// Порожній масив означає "немає провайдера" (DOCX, XLSX тощо — для них
// OCR не потрібен, Viewer показує оригінал через iframe Drive).
//
// Один сенс: "ось ланцюжок з фолбеком який треба пробувати у порядку".
// Не змішується з декларацією здатностей провайдера — це окрема відповідальність.
export function selectProviderChain(file) {
  if (!file) return [];
  for (const entry of FALLBACK_CHAINS_BY_MIME) {
    if (entry.test(file)) return [...entry.chain];
  }
  return [];
}

// hasAnyProvider — true якщо для файлу є хоч один провайдер.
// Викликається CaseDossier'ом перед OCR pipeline щоб для непідтримуваних
// форматів одразу пропустити OCR крок без warning-тоста.
export function hasAnyProvider(file) {
  return selectProviderChain(file).length > 0;
}

export { FALLBACK_CHAINS_BY_MIME };
