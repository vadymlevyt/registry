# Звіт — A7.4: inline-правка метаданів у «Деталях» вʼювера

**Дата:** 2026-06-25
**Гілка:** `claude/a7-4-viewer-edit`
**Вісь:** A (Document Processor) — фінальна фаза TASK A7 (виняток (i), §2.4).
**Передумови:** A7.1–A7.3 уже в `main` (двофазний backend + екран нарізки + дата у плані).

---

## 1. ЩО ЗРОБЛЕНО

Кнопка «Деталі» (іконка Wrench) у вʼювері документа була заглушкою
(`toast.info('Панель деталей у розробці')`). Тепер це **панель правки метаданів
одного документа**: `date` / `author` / `category`.

Запис іде **через `executeAction('dossier_agent','update_document', {caseId,
documentId, fields})`** (R2) — не локальний `updateCase` повз архіваріус. Так
зберігаються аудит, білінг (`EDIT_ACTIONS_SOURCE_AWARE` із `source='manual'`),
permission-перевірки і валідація документа.

---

## 2. ЗМІНИ ПО ФАЙЛАХ

### Новий файл
- **`src/components/DocumentViewer/DocumentDetailsPanel.jsx`** — панель на спільних
  UI-компонентах (`Modal` `size="sm"` + `DatePicker` + два `Select`). Без емодзі,
  лише наявні design-токени.
  - `computeChangedFields(original, draft)` — **чисте, експортоване ядро**: повертає
    лише змінені поля; `''`/`undefined`/`null` нормалізуються в єдиний сенс «не
    вказано». Порожній результат → save не викликається.
  - Чернетка перезавантажується при відкритті / зміні документа; кнопка «Зберегти»
    `disabled` поки немає змін або триває запис.

### Правки
- **`src/components/CaseDossier/index.jsx`**
  - імпорт `DocumentDetailsPanel`;
  - стан `detailsOpen`;
  - `onOpenDetails` заглушка → `setDetailsOpen(true)`;
  - рендер `<DocumentDetailsPanel>` з `onSave`, що маршрутизує в
    `onExecuteAction('dossier_agent','update_document', …)`; на успіх синхронізує
    локальний `selectedDoc` і показує toast, на помилку — toast із текстом помилки.

### Без змін (перевірено)
- `update_document` ACTION уже має `date`/`author`/`category` в `ALLOWED_UPDATE_FIELDS`.
- `dossier_agent` уже має дозвіл `update_document` у PERMISSIONS.
  → **жодних змін схеми, allowlist чи permissions не потрібно.**

---

## 3. ТЕСТИ

- **unit** `tests/unit/documentDetailsPanel.test.js` (7) — `computeChangedFields`:
  без змін → `{}`; зміна одного/двох полів; очищення дати → `date:null`; `''`↔`null`
  без змін; `original=undefined` не падає.
- **integration** `tests/integration/actions.test.js` (+2) — `date/author/category`
  тече через `update_document` ACTION і персистить; очищення дати (`null`) валідне.
- Повний прогін: **184 файли, 2306 тестів — зелено**. `npm run build` — успішно.

---

## 4. МЕЖІ (що НЕ входило)
- Екран нарізки (A7.1–A7.3), `run`/`proposeRun`/`executeRun` — не торкались.
- Повна A5 (авто `author`/`category`, наскрізний `MetadataEditor`) — серверна ера.
- AI у панелі немає — правка суто ручна (відповідає §7 спеки).

---

## 5. AI-FIRST / SAAS / BILLING
- **AI-first:** запис через той самий `update_document` ACTION, доступний і агенту
  (дублювання інтерфейсів збережено: UI-панель ↔ агент через executeAction).
- **SAAS:** шлях через `executeAction` зберігає `checkTenantAccess`/`checkCaseAccess`.
- **BILLING:** `update_document` з `source='manual'` нараховується наявним правилом
  `EDIT_ACTIONS_SOURCE_AWARE`; нових категорій/інструментації не додавалось.
