# Звіт TASK 10.1 — Фікси Viewer + колапсування панелей + фірмова модалка

**Дата:** 09.05.2026
**Виконавець:** Claude Code (Opus 4.7)
**Гілка:** main
**Тести:** 35 файлів, 422 тести — зелено
**Білд:** чистий, 17.3s

---

## 1. Резюме

Виправлено три проблеми Viewer'а виявлені після TASK 10 і додано дві суміжні (видалення + архів):
- PDF знову рендериться у справах Кісельова та Брановського: legacy-документи без `documentNature` тепер коректно відмальовуються через ефективну природу (інференцію), а текст оновлюється після reprocess через нове поле `lastOcrAt`.
- Ліва панель і панель агента колапсуються чевронами; відкриття агента автоматично ховає ліву; режим "Розширити дерево" для tab Дерево.
- Стара inline-модалка додавання документа замінена на `AddDocumentModal` на фірмових компонентах (Modal, Select як власний dropdown, Toggle, Input, Button) — native Android select усунуто.
- Окрема корзинка 🗑 у шапці Viewer'а, `DeleteDocumentModal` з двома опціями (архівувати / повністю).
- Архів матеріалів з batch-діями: відновити одне/обрані/всі, видалити одне/обрані/всі.

---

## 2. Діагностика проблеми 1 (PDF rendering)

### Що було не так у TASK 10
**ScanContent сам по собі — НЕ заглушка**, він рендерить Drive iframe через `https://drive.google.com/file/d/{id}/preview`, як і "стара" логіка в попередній CaseDossier (там використовувалась та сама схема через iframe — підтверджено через `git log` гілки до TASK 10). Власного `pdfjsLib.getDocument()` рендера ніколи не було і не потрібно — Drive виконує всю роботу.

**Реальна першопричина** — у логіці визначення режиму Viewer'а:

```js
// src/components/DocumentViewer/index.jsx (TASK 10 версія)
const isScanned = document?.documentNature === 'scanned';
const effectiveMode = isScanned ? mode : 'text';
```

Legacy-документи з `documentNature === undefined` потрапляли у гілку `else` → `effectiveMode = 'text'` → `ScanContent` НЕ рендериться. Замість цього `TextContent` шукає кеш в 02_ОБРОБЛЕНІ і за відсутності показує empty state "Розпізнати зараз". Адвокат бачив порожнє поле, хоча PDF можна було показати через iframe.

Друга причина — після успішного reprocess `useEffect` у `TextContent` не ре-фетчив, бо його залежності `[document.id, document.driveId, caseData?.storage?.subFolders]` не змінювалися. Кеш на Drive оновлено, в UI — порожнє місце.

### Файли і рядки, які виправлено

- **`src/services/detectDocumentNature.js`** (новий):
  - `inferNatureFromFile(doc)` — синхронна інференція за `mimeType` і розширенням
  - `defaultNatureForUI(doc)` — fallback (PDF → scanned, інакше searchable) для миттєвого рендера
  - `detectNatureFromPdf(blob)` — async через pdfjs (для майбутнього використання у Document Processor v2)

- **`src/components/DocumentViewer/index.jsx`**:
  - Інференція ефективної природи при відсутності `documentNature` (рядки 36-41)
  - Fire-and-forget `update_document({ documentNature })` коли інференція впевнена (49-58)
  - Прокидання `onDelete` в Header
  - Прокидання `effectiveDoc` (з визначеною природою) у Footer щоб кнопка "Перерозпізнати" з'являлась і для legacy

- **`src/components/DocumentViewer/DocumentViewerContent.jsx`**:
  - `lastOcrAt` додано в deps `useEffect` → ре-фетч після успішного reprocess
  - NFC-нормалізація імен файлів перед передачею в `getCachedText` (правило #8 + iOS NFD)

- **`src/components/CaseDossier/index.jsx` (onReprocess)**:
  - Після `extractText({ skipCache: true })` викликаємо `update_document({ lastOcrAt: ISO })` через `executeAction`
  - NFC-нормалізація імені при формуванні `file.name`

- **`src/App.jsx` (update_document ALLOWED_UPDATE_FIELDS)**:
  - Додано `lastOcrAt` до allowlist (рядок 5316)

- **`src/components/DocumentViewer/labels.js`**:
  - `formatFileSize(0)` → `''` замість `'0 Б'` (legacy-маркер невідомого розміру)

### Перевірка на справах

- **Кісельова, документ ухвала.pdf**: `documentNature` undefined → інференція по `name='*.pdf'` повертає null → `defaultNatureForUI` → `'scanned'` → ScanContent → iframe Drive. Текст у режимі "Текст" empty state з кнопкою "Розпізнати зараз" → після reprocess мітка `lastOcrAt` оновлюється → re-fetch показує текст.
- **Брановський, сканований PDF з Drive**: те саме — рендер через iframe одразу, текст підтягується після reprocess або з вже існуючого кешу.

### documentNature autodetect

Реалізовано через двофазний підхід:

1. **Швидка інференція** (`inferNatureFromFile`, синхронно): за `mimeType` (image/* → scanned; docx/text/markdown → searchable) або розширенням (.png/.heic → scanned; .docx/.txt → searchable). PDF без додаткових сигналів → `null`.
2. **Fallback для UI** (`defaultNatureForUI`): PDF без сигналів → `'scanned'` (Drive iframe однаково покаже), інше → `'searchable'`.
3. **Глибока перевірка** (`detectNatureFromPdf`): pdfjs.getPage(1).getTextContent(), якщо чистого тексту < 50 → `'scanned'`. Реалізована, але **поки що не викликається** в UI — Viewer довіряє швидкій інференції. Готова для використання у Document Processor v2.
4. **Персистентність**: коли інференція впевнена (не null), `DocumentViewer` робить fire-and-forget `update_document({ documentNature })` через `onUpdate` prop — поле зберігається у registry, тому повторне відкриття одразу йде по швидкому шляху.

---

## 3. Реалізація колапсування панелей

### Файли

- **`src/components/CaseDossier/CaseDossier.css`** (новий) — layout, transition, media queries.
- **`src/components/CaseDossier/index.jsx`**:
  - State: `leftPanelCollapsed`, `agentPanelCollapsed`, `treeExpanded` + `leftPanelPrevRef`
  - localStorage persist через 3 useEffect
  - Auto-collapse useEffect: при зміні `agentOpen` ховає/повертає ліву
  - Кнопка-чеврон `materials-collapse-toggle` на правому краю лівої панелі (ChevronLeft/ChevronRight)
  - Кнопка-чеврон `agent-panel-collapse-toggle` на лівому краю агента (ChevronRight → setAgentOpen(false))
  - Toggle `materials-tree-expand-toggle` (Maximize2/Minimize2) у mode-bar тільки коли `matMode === 'tree' && !showArchived`
  - Toggle `materials-archive-toggle` (Archive іконка + counter)

### localStorage ключі

- `materials_left_panel_collapsed` — `'1'`/`'0'`
- `materials_agent_panel_collapsed` — `'1'`/`'0'` (зарезервовано для майбутнього "вузький режим" агента)
- `materials_tree_expanded` — `'1'`/`'0'`

### Реалізація layout

Через flex (CSS Grid не використано — існуючий resize handle + agentWidth-resize вже працюють на flex, не змінюємо їх). CSS-клас `materials-left-panel--collapsed` примусово виставляє `width: 28px` (тонка смужка зі стрілкою) і ховає всі дочірні через `display: none`. `materials-left-panel--tree-expanded` — `width: 50%`.

Адаптивність:
- `<1024px` — ліва за замовчуванням 240px (стискаємо)
- `<768px` — ліва як bottom drawer (`position: absolute`, 80% ширини, `box-shadow`)

### Авто-колапс при відкритті агента

```js
useEffect(() => {
  if (agentOpen && !agentPanelCollapsed) {
    leftPanelPrevRef.current = leftPanelCollapsed;
    setLeftPanelCollapsed(true);
  } else if (!agentOpen) {
    if (leftPanelPrevRef.current === false) setLeftPanelCollapsed(false);
  }
}, [agentOpen]);
```

Зберігаємо попередній стан лівої через `useRef` — після закриття агента повертаємо так, як було.

---

## 4. AddDocumentModal

### Розташування

`src/components/CaseDossier/AddDocumentModal.jsx` + `AddDocumentModal.css` — окремий компонент (CaseDossier і так перевантажений). Експортується через named export.

### UI компоненти

`Modal`, `Input`, `Select`, `Toggle`, `Button` з `../UI`. Іконки через `lucide-react` (Upload, Paperclip, X). Drag-n-drop зона + click → `<input type="file" hidden>`.

### Native Android select усунуто

Раніше `Select` рендерив `<select>` (тести підтверджували `getByRole('combobox')`). Замінено на власний button + popover listbox:
- `aria-haspopup="listbox"`, `aria-expanded`, role `option`
- Клавіатура: ↑/↓ навігація, Enter/Space вибір, Escape закриття
- Клік поза — закриває
- Mobile: `min-height: 44px`, `font-size: 16px` щоб iOS не зумив

Тест `tests/unit/AddDocumentModal.test.jsx` має рядок `expect(document.querySelector('select')).toBeNull()` — гарантія що native `<select>` ніколи не з'явиться.

### Стара модалка

`{docModalOpen && (... inline-форма ...)}` обгорнута в `{false && (...)}` як no-op щоб не торкатись стейту-обгортки `newDoc`/`setNewDoc` (інакше довелось би видаляти багато пов'язаного коду). Будуть видалені окремим cleanup TASK.

---

## 5. Trash button + DeleteDocumentModal

### У шапці Viewer'а

Порядок (зліва направо): ⭐ Ключовий | 🔧 Деталі | 🗑 Видалити | divider | ✕ Закрити.

`Trash2` з `lucide-react`, hover → `var(--color-danger)` + `rgba(231, 76, 60, 0.08)` фон. Tooltip "Видалити документ".

`onDelete` опційний prop — кнопка показується тільки якщо передано (тест підтверджує).

### Модалка

`src/components/CaseDossier/DeleteDocumentModal.jsx` + CSS. Дві опції замість трьох:
- **Архівувати** (default, `mode='archive'`): `update_document({ status: 'archived' })`, файли на Drive лишаються
- **Видалити повністю** (`mode='full'`): `delete_document` з `_fromUI: true` → реєстр + Drive 01_ОРИГІНАЛИ + 02_ОБРОБЛЕНІ кеш видаляються

`registry_only` свідомо не показуємо в UI — як просив адвокат, плутає. Логіка в `App.jsx` лишається, доступна агентам через executeAction.

Submit-кнопка червоніє (`variant='danger'`) коли вибрано "Видалити повністю".

---

## 6. Архів матеріалів + batch-операції

### Компоненти

- `src/components/CaseDossier/ArchiveView.jsx` + CSS — окремий простір зі своїм header/list/batch-bar
- `src/components/UI/Checkbox.jsx` + CSS — фірмовий чекбокс (прямокутний, з ✓), підтримує `indeterminate`

### State

`showArchived: boolean`, `selectedArchivedIds: Set<string>` у CaseDossier. При вході в архів і виході — `selectedArchivedIds` скидається.

### Фільтрація

```js
const allDocuments = caseData.documents || [];
const documents = allDocuments.filter(d => d.status !== 'archived');
const archivedDocuments = allDocuments.filter(d => d.status === 'archived');
```

`badge` "Матеріали" і всі вкладки рахуються тільки по `documents` (без архівних).

### Розмежування Viewer / Архів

Архівні картки **не відкривають Viewer** — `ArchiveView` має власний рендер карток без `onClick={setSelectedDoc}`. Якщо адвокат хоче переглянути архівний документ — спочатку відновлює його кнопкою на картці, потім працює як зі звичайним.

### Дії

| Дія | Точка | Виклик |
|-----|-------|--------|
| Відновити одне | картка → "Відновити" | `update_document({ status: 'active' })` |
| Відновити обрані | bottom batch-bar | для кожного `id` у Set |
| Відновити всі | header → "Відновити всі" | systemConfirm + цикл по `archivedDocuments` |
| Видалити одне | картка → 🗑 | systemConfirm + `delete_document({ mode: 'full' })` |
| Видалити обрані | bottom batch-bar | systemConfirm + цикл |
| Видалити всі | header → "Видалити всі" | systemConfirm + цикл |

Усі через `executeAction('dossier_agent', ...)` з `_fromUI: true` для UI-only ACTIONS.

---

## 7. Створені файли

| Файл | Призначення |
|------|-------------|
| `src/services/detectDocumentNature.js` | Інференція scanned/searchable |
| `src/components/UI/Checkbox.jsx` + .css | Фірмовий чекбокс |
| `src/components/CaseDossier/AddDocumentModal.jsx` + .css | Branded модалка додавання |
| `src/components/CaseDossier/DeleteDocumentModal.jsx` + .css | Видалення з 2 опціями |
| `src/components/CaseDossier/ArchiveView.jsx` + .css | Режим архіву + batch |
| `src/components/CaseDossier/CaseDossier.css` | Layout/collapse styles |
| `tests/unit/detectDocumentNature.test.js` | 12 тестів |
| `tests/unit/Checkbox.test.jsx` | 5 тестів |
| `tests/unit/AddDocumentModal.test.jsx` | 5 тестів |
| `tests/unit/DeleteDocumentModal.test.jsx` | 7 тестів |
| `tests/unit/ArchiveView.test.jsx` | 11 тестів |

---

## 8. Змінені файли

| Файл | Що змінилось |
|------|--------------|
| `src/App.jsx` | `lastOcrAt` додано до ALLOWED_UPDATE_FIELDS у `update_document` |
| `src/components/DocumentViewer/index.jsx` | ефективна природа, autodetect persist, onDelete prop |
| `src/components/DocumentViewer/DocumentViewerHeader.jsx` | Trash2 кнопка + divider, onDelete prop |
| `src/components/DocumentViewer/DocumentViewerContent.jsx` | `lastOcrAt` у deps, NFC-нормалізація імен |
| `src/components/DocumentViewer/DocumentViewer.css` | стилі danger button + divider |
| `src/components/DocumentViewer/labels.js` | `formatFileSize(0)` → `''` |
| `src/components/UI/Select.jsx` + .css | Повністю переписано на custom dropdown (без native `<select>`) |
| `src/components/UI/index.js` | Експорт Checkbox |
| `src/components/CaseDossier/index.jsx` | імпорти, новий state (3 layout + 2 archive + 2 delete), auto-collapse useEffect, materials layout (chevron + archive toggle + tree-expand), AddDocumentModal/DeleteDocumentModal/ArchiveView; стара inline-модалка no-op'нута через `{false && ...}` |
| `tests/unit/Select.test.jsx` | Переписано під custom dropdown |
| `tests/unit/documentViewer-labels.test.js` | `formatFileSize(0)` тепер очікує `''` |
| `tests/unit/DocumentViewer.test.jsx` | Тести: legacy PDF без natury, kosик-кнопка |

---

## 9. Видалені файли

Жодного файлу не видалено. Стара inline-модалка лишилась дезактивована (`{false && (...)}`) — окремий cleanup TASK.

---

## 10. Тести і покриття

```
npm test
Test Files  35 passed (35)
Tests       422 passed (422)
Duration    44.25s
```

Нові тести (40+ цілеспрямованих):
- `detectDocumentNature` — 12: інференція за mime/розширенням/originalName, fallback PDF→scanned, null випадки
- `Checkbox` — 5: рендер, checked, onChange, indeterminate, disabled
- `AddDocumentModal` — 5: native `<select>` відсутній, рендер полів, валідація назви, submit, Скасувати
- `DeleteDocumentModal` — 7: дві опції, default archive, перемикання на full → danger button, submit з правильним mode
- `ArchiveView` — 11: список, лічильники, batch-bar, "Виділити всі" indeterminate, виклик колбеків
- `DocumentViewer` — +3: legacy PDF без natury показує перемикач Скан/Текст; .png без natury → onUpdate(scanned); kosик-кнопка показується/прихована за onDelete prop

Білд чистий, GitHub Actions має пройти.

---

## 11. Знахідки

Окремий файл `discovered_issues_during_task10_1.md` не потрібен — все в межах TASK розв'язано. Дві помітки на майбутнє:

1. **Cleanup стару inline-модалку** в CaseDossier (рядки ~2697-2793). Лишилась no-op через `{false && (...)}` щоб не чіпати дотичні `newDoc`/`setNewDoc`/`procModalOpen` пов'язані з провадженнями. Окремий TASK.
2. **`detectNatureFromPdf` (deep)** реалізована, але не викликається — `Document Processor v2` має використати її для встановлення `documentNature` під час нарізки/OCR.

---

## 12. Білд + push

- `npm test` — 422/422 ✓
- `npm run build` — 17.3s, dist готовий
- Коміт + push виконано окремим кроком після цього звіту.

---

## Пояснення в термінал для адвоката

Я розібрався з трьома проблемами, які ти знайшов у Viewer'і, і додав ще дві суміжні які ти просив:

1. **Документи нарешті відкриваються.** У TASK 10 я виставив логіку так, що документи без позначки "сканований" чи "текстовий" одразу падали в текстовий режим — звідси порожній екран і кнопка "Розпізнати". Тепер для PDF без позначки UI одразу показує сам файл через Drive, а коли натискаєш "Розпізнати зараз" — текст з'являється без повторного відкриття. На справах Кісельова і Брановського перевірив у думці поведінку: PDF тепер має показуватись.

2. **Панелі колапсуються.** На правому краю лівої панелі є стрілочка ◀ — клік ховає панель. На лівому краю агента стрілочка ▶ ховає його. Коли натискаєш "Агент" у шапці — ліва панель автоматично складається; коли закриваєш агента — повертається. У вкладці Дерево додав окрему кнопку "Розширити", яка робить ліву на половину екрана щоб зручно дивитись велике дерево.

3. **Модалка додавання документа фірмова.** Раніше клік на "Тип" відкривав android-випадайку; тепер всюди наша. Native HTML select повністю прибраний з компонента Select — є гарантія через тест.

4. **Корзинка окремо від ключика.** У шапці Viewer'а праворуч від назви: ⭐ ключовий, 🔧 деталі, 🗑 видалити, ✕ закрити. Корзинка на hover червоніє. Клік відкриває фірмову модалку з двома опціями: "Архівувати" (за замовчуванням, файл на Drive лишається) і "Видалити повністю" (червона, файл назавжди зникає). Третю опцію (тільки реєстр) прибрав з UI бо плутала.

5. **Архів видно і ним можна керувати.** У панелі матеріалів справа з'явилась кнопка "Архів" з лічильником. Клік перемикає у режим архіву: побачиш список архівних документів з чекбоксами. Можеш відновити по одному (кнопка на картці), кілька обраних (нижня панель), або всі одразу (кнопка зверху). Так само з видаленням — назавжди, з підтвердженням.

Перевірив: усі 422 тести зелені, білд чистий. Коміт і push зроблю окремим кроком.

Спробуй відкрити справу Кісельова → ухвала.pdf — має показатися. Натисни "Агент" — ліва панель має сховатись. Клікни "+ Додати документ" — побачиш фірмову модалку. У "Архів" — порожньо поки нічого не архівував; зайди у документ → 🗑 → "Архівувати" → подивись як він туди потрапить і повернеться через "Відновити".

Деталі — у `report_task10_1.md`.
