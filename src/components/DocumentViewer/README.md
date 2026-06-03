# DocumentViewer

Переглядач документа справи. Викликається з `CaseDossier` коли адвокат вибирає документ зі списку матеріалів.

## Призначення

- Показати документ (PDF / image / Office) через власні рендери / Drive preview.
- Перемикати **режими перегляду** (V2-B):
  - scanned: **Скан** (картинка) / **Точний** (live layout, 0 токенів) / **Чистий ✨** (AI, дослівний) / **Конспект ✨** (AI, переказ).
  - searchable: **Документ** (нативний рендер) / **Конспект ✨** (AI).
- Швидкі дії над документом: відкрити в Drive, завантажити, копіювати, поділитись, обговорити з агентом, перерозпізнати.
- Базові метадані одним рядком — категорія, автор, провадження, дата, к-ть сторінок, розмір.

## Імпорт

```jsx
import { DocumentViewer } from '@/components/DocumentViewer';
```

## Props

| Prop | Тип | Опис |
|------|-----|------|
| `document` | object \| null | Канонічний документ (schemaVersion 5). null → empty state. |
| `caseData` | object | Справа з `proceedings[]`, `storage.subFolders` |
| `onClose` | `() => void` | Закрити viewer |
| `onUpdate` | `(documentId, fields) => void` | Оновити поля документа (наприклад `{ isKey: true }`) |
| `onOpenDetails` | `(documentId) => void` | Відкрити панель деталей (TASK 11 — поки заглушка) |
| `onDiscussWithAgent` | `(document) => void` | Передати документ в чат агента |
| `onReprocess` | `(document) => void` | Перерозпізнати OCR (тільки для scanned) |
| `onGenerateVariant` | `(document, mode) => Promise<result>` | Згенерувати AI-варіант `'clean'`/`'digest'` на вимогу (кнопка «Згенерувати» у вкладці) |

## Логіка режимів (V2-B)

- Набір вкладок рахує `buildViewerTabs({ isScanned, exactReady, variants })`:
  - scanned → `[Скан][Точний?][Чистий✨][Конспект✨]` (Точний — лише коли є layout).
  - searchable → `[Документ][Конспект✨]`.
- **Дефолт-таб:** scanned → Точний (якщо layout готовий), інакше Скан; searchable → Документ.
  На AI-режим автоматично НЕ потрапляєш.
- 🔴 **Перемикання вкладок НЕ запускає AI.** Незгенерований AI-таб (`variants[mode]` нема) →
  заглушка з кнопкою «Згенерувати ✨». AI стартує ВИКЛЮЧНО по кнопці (→ `onGenerateVariant`).
  Згенерований таб → миттєвий показ збереженого `.md` (`getVariantMarkdown`) без повторного AI.
- Збереження вибору режиму per-document у `localStorage` (LRU 100 останніх).

## Залежності

- `lucide-react` — іконки
- `services/ocrService.js`:
  - `getCachedText(file)` — підтягнути текст з `02_ОБРОБЛЕНІ`
  - `extractText(file, { skipCache: true })` — для перерозпізнання (виклик з батька через `onReprocess`)
  - `localizeOcrError(code)` — людська локалізація помилок
- `services/driveAuth.js` — `driveRequest` для скачування
- `services/toast.js` — повідомлення про успіх/помилку

## Структура файлів

```
DocumentViewer/
├── index.jsx                    — головний компонент
├── DocumentViewer.css           — стилі (BEM .document-viewer__*)
├── DocumentViewerHeader.jsx     — назва, метарядок, кнопки керування
├── DocumentViewerContent.jsx    — Scan/Документ, Точний, Чистий/Конспект (VariantContent)
├── DocumentViewerFooter.jsx     — 5 кнопок дій
├── ScanTextToggle.jsx           — перемикач режимів (tabs-driven)
├── ScanTextToggle.css
└── labels.js                    — людські назви + утиліти форматування
```

## Адаптивність

- **≥768px** — повний layout
- **<768px** — Footer кнопки min-height 44px, `space-around`
- **<480px** — Footer кнопки тільки з іконками (текстові підписи приховано)

## SaaS / canonical schema

Працює з `documentSchema.js v5` — використовує `documentNature`, `procId`, `category`, `author`, `isKey`, `pageCount`, `size`, `originalName`, `mimeType`, `driveId`. Жодних tenant-специфічних хардкодів — підходить для будь-якого тенанта.
