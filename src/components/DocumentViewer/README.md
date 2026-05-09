# DocumentViewer

Переглядач документа справи. Викликається з `CaseDossier` коли адвокат вибирає документ зі списку матеріалів.

## Призначення

- Показати документ (PDF / image / Office) через Drive iframe preview.
- Перемикати між **Скан** (картинка) і **Текст** (OCR) — для сканованих документів.
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

## Логіка режимів Скан/Текст

- `documentNature === 'scanned'` — перемикач видимий, дефолт `scan` (або з localStorage)
- `documentNature === 'searchable'` — перемикач прихований, завжди `text`
- Збереження вибору режиму на per-document рівні в `localStorage` (LRU 100 останніх)

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
├── DocumentViewerContent.jsx    — Scan (iframe/img) і Text (OCR-кеш)
├── DocumentViewerFooter.jsx     — 6 кнопок дій
├── ScanTextToggle.jsx           — перемикач режиму
├── ScanTextToggle.css
└── labels.js                    — людські назви + утиліти форматування
```

## Адаптивність

- **≥768px** — повний layout
- **<768px** — Footer кнопки min-height 44px, `space-around`
- **<480px** — Footer кнопки тільки з іконками (текстові підписи приховано)

## SaaS / canonical schema

Працює з `documentSchema.js v5` — використовує `documentNature`, `procId`, `category`, `author`, `isKey`, `pageCount`, `size`, `originalName`, `mimeType`, `driveId`. Жодних tenant-специфічних хардкодів — підходить для будь-якого тенанта.
