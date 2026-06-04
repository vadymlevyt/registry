# REPORT — Уніфікація видалення: спільний мультивибір (архів + реєстр) + швидкий батч

**Дата:** 2026-06-04
**TASK:** `docs/tasks/TASK_bulk_delete_unify.md`
**Гілка:** `claude/bulk-delete-unify-PCkVS`
**schemaVersion:** без bump (немає нових полів даних).
**Статус:** ✅ Завершено. `npm test` — 1937 passed (152 файли). `npm run build` — success.

---

## 1. Спільний модуль вибору (UI + логіка) — `src/components/UI/`

### `useSelection.js` (новий, чиста логіка, юніт-покрита)
Хук мультивибору за id. Стан `selectedIds:Set`. API: `toggle(id, value?)`, `selectAll()`,
`clear()`, `isSelected(id)`. Похідне: `count`, `allSelected`, `someSelected` (indeterminate).
`allIds` — поточний повний список; при зміні складу (фільтри/видалення) id, яких більше
немає, **автоматично виходять із вибору** (синхронізація через `useEffect` keyed на
детермінований підпис `allIds.join(' ')` — без зайвих прогонів на новий масив-літерал з тим
самим вмістом).

### `BulkActionBar.jsx` + `.css` (новий, презентаційний)
Панель: select-all `Checkbox` (з indeterminate) + лейбл «Виділено: N з total» + слот
`children` для кнопок дій (передаються зовні — архів і реєстр кладуть свої). **Тільки
дизайн-токени** (`--color-*`, `--space-*`, `--radius-*`), жодного hex. Експортовано з
барелю `src/components/UI/index.js`.

**Нуль дублювання (#11):** архів і реєстр імпортують ті самі `useSelection` + `BulkActionBar`.
Варіант кнопок передається через `children`, ядро вибору й стилю панелі — спільні.

---

## 2. Батч-логіка видалення

### `driveService.js`
- **`runWithConcurrency(items, limit, fn)`** — пул воркерів (default limit 6). Замість
  послідовного await-циклу і замість «все одразу Promise.all».
- **`matchArtifactFileIds(allFiles, driveId)`** — **спільний** суфікс-матч `_<driveId>.`
  (а НЕ перелік розширень). Ловить `.txt`, `.layout.json`, `.clean.md`, `.digest.md` **і
  будь-який майбутній суфікс** — нуль сиріт навіть для нового типу артефакту.
- **`deleteDocumentsArtifactsBatch(caseData, docs, {concurrency=6})`** — **ОДИН** LIST
  `02_ОБРОБЛЕНІ` (`q=` по parent, фільтр у JS — правило #8) → для кожного документа збирає
  `driveId` + `originalDriveId` + усі `_<driveId>.*` (і `_<originalDriveId>.*`) → **дедуп**
  усіх fileId → паралельний DELETE через пул. Кожне видалення в try/catch (падіння одного
  не блокує інші). Повертає `{ deletedCount, failedCount }`.
- **`deleteOcrCacheForDocument`** (single, зворотна сумісність) переведено на той самий
  `matchArtifactFileIds` — тепер чистить і `.clean.md`/`.digest.md` (**баг-сирота #4
  закрито**). Одна спільна реалізація пошуку — без розбіжностей.

### `documentsExtended.js`
- **`deleteExtendedForDocuments(caseId, caseData, documentIds)`** — **ОДИН** read+filter+save
  documents_extended за пачку (+`invalidateCache`). Повертає кількість реально прибраних.

### `actionsRegistry.js`
- **`delete_documents({ caseId, documentIds, mode })`** — `mode ∈ {full|registry_only|archive}`
  (точний паритет single). `archive`: **1** `setCases`. `full`/`registry_only`: **1** `setCases`
  (filter) + **1** `deleteExtendedForDocuments`; далі (`full`) — `deleteDocumentsArtifactsBatch`
  + `clearResume(driveId)` по кожному. Повертає `{ success, mode, deleted:[], failed:[], message }`.
- **`restore_documents({ caseId, documentIds })`** — **1** `setCases` (status:'active'). Без
  Drive/extended. Повертає `{ success, restored:[] }`.
- **`delete_document` рефакторнуто в обгортку** над `delete_documents([id])` з адаптацією під
  старий контракт `{ success, mode, documentId, message }`. Одна логіка, нуль дублювання.
  Існуючі `delete_document`-тести лишились зеленими без зміни асертів.
- `UI_ONLY_ACTIONS` += `delete_documents`. `PERMISSIONS.dossier_agent` += `delete_documents`,
  `restore_documents`.
- Нові deps у `createActions`: `deleteDocumentsArtifactsBatch`, `deleteExtendedForDocuments`,
  `clearResume`. Прокинуто в `App.jsx` (реальні) і `_actionsTestSetup.js` (стаби).

---

## 3. Повнота видалення — НУЛЬ СИРІТ (B.4) — звірка по чек-листу

| Сховище | Прибирається | Як | Статус |
|---------|--------------|-----|--------|
| registry `cases[].documents[]` | запис документа | `setCases` filter | ✅ |
| `documents_extended.json` | важка метадата | `deleteExtendedForDocuments` (1 save) | ✅ |
| in-memory extended cache | Map по caseId | `invalidateCache(caseId)` після save | ✅ |
| Drive `driveId` (основний) | PDF/основний | пул B.1 | ✅ |
| Drive `originalDriveId` | DOCX/HTML оригінал | пул B.1 | ✅ |
| Drive `02_ОБРОБЛЕНІ` | усі `_<driveId>.*` | суфікс-матч B.1 | ✅ |
| OCR resume-стан | partial-OCR по driveId | `clearResume(driveId)` | ✅ |
| in-memory OCR cache | — | окремого text/layout-кеша поза `_<driveId>.*` Drive-файлами `ocrService` не тримає (читає з Drive `getCachedText`/`getCachedLayout`); після видалення Drive-файлів lookup дасть міс | ✅ (зафіксовано) |

- **Фрагменти/інші папки (03/04/05):** перевірено — у поточній архітектурі похідні
  артефакти документа живуть лише у `02_ОБРОБЛЕНІ` (OCR `.txt`/`.layout`, очистка
  `.clean.md`/`.digest.md`). 03/04/05 містять окремі сутності (фрагменти/позиція/зовнішні),
  не прив'язані до `_<driveId>.` оригіналу. LIST не розширювали; якщо колись з'являться файли
  `_<driveId>.` поза 02 — суфікс-матч готовий, треба лише додати папку в LIST.
- **СВІДОМА МЕЖА — НЕ чіпаємо:** `time_entries[]` та `ai_usage[]` із `documentId` — це
  **бухгалтерські леджери** (облік часу адвоката / телеметрія токенів). Видалення документа
  їх НЕ торкає (інакше спотворило б білінг/історію). Покрито інтеграційним тестом
  («time_entries / ai_usage НЕ зачіпаються»). Якщо колись треба «забути й облік» — окреме
  рішення/борг.

---

## 4. UI-зміни по місцях

### Архів (`ArchiveView.jsx` + `CaseDossier`)
- **Прибрано обидві верхні кнопки** «Відновити всі»/«Видалити всі» (блок
  `archive-view__bulk-actions`) і props `onRestoreAll`/`onDeleteAll` + відповідні хендлери в
  `CaseDossier`. Видалено `selectedArchivedIds` state — вибір тепер живе всередині
  `ArchiveView` через спільний `useSelection` (на exit компонент розмонтовується → вибір
  скидається природньо).
- Батч-бар переведено на `BulkActionBar` + `useSelection`. Хендлери `onRestoreSelected(ids)` /
  `onDeleteSelected(ids)` → `restore_documents` / `delete_documents(mode:'full', _fromUI:true)`
  з **ОДНИМ** `systemConfirm` на пачку. `onRestoreOne`/`onDeleteOne` теж ідуть через батч-екшни
  з 1 id (єдиний шлях). Прибрано мертві CSS-класи (`__bulk-actions`, `__select-all`,
  `__batch-bar`, ...).

### Реєстр (`CaseDossier`, `matMode==="registry"`)
- Додано мультивибір: рядковий `Checkbox` (спільний) у кожен `filteredDocs.map` рядок (клік по
  чекбоксу `stopPropagation` — НЕ відкриває Viewer). `BulkActionBar` зверху списку.
- Вибір — `useSelection(filteredDocs.map(d=>d.id))`, синхронізований із фільтрами.
- Дві кнопки: **«Архівувати обрані»** → `delete_documents(mode:'archive', _fromUI:true)`;
  **«Видалити обрані повністю»** → `delete_documents(mode:'full', _fromUI:true)`. По одному
  `systemConfirm` на дію (текст «повністю» наголошує що файли зникнуть з Drive).
- **Scope:** лише вкладка Реєстр. Дерево (`matMode==="tree"`) і архівні рядки у Viewer —
  поза скоупом (без змін).

---

## 5. Перформанс — до / після

| | Було | Стало |
|--|------|-------|
| Перезаписи реєстру (EFFECT-B) | **N** (цикл `for doc … await delete_document` → N×`setCases`) | **1** (`setCases`) |
| LIST `02_ОБРОБЛЕНІ` | **N** (по одному на документ у `deleteOcrCacheForDocument`) | **1** (батч) |
| Drive DELETE | послідовні (2-5 × N) | паралельні, пул ≤6 |
| extended write | **N** | **1** |
| `systemConfirm` | один на дію (ОК) | один на пачку |

10 документів: було ~50-80 послідовних HTTP + 10 перезаписів реєстру → стало 1 LIST + пул
паралельних DELETE + 1 перезапис. Це і є фікс повільності.

**EFFECT-B / write-guard НЕ чіпано** (ризик race) — батч прибирає причину (N-перезаписів) у корені.

---

## 6. SAAS / BILLING / AUDIT
- **SaaS:** батч-екшени в межах справи (tenant успадковується); жодних нових сутностей.
  Перевірки доступу — наявний `executeAction` ланцюг (per-call `checkCaseAccess`).
- **Billing:** видалення/архівування/відновлення — паритет із наявним `delete_document`
  (не додано ні спец-інструментації, ні exclusion-записів; generic-hook поводиться однаково).
  Один UI-виклик = один executeAction (delete_document обгортка кличе ACTIONS.delete_documents
  напряму, не через executeAction → без подвійного звіту).
- **Audit:** паритет — батч НЕ в `AUDIT_ACTIONS` (як і `delete_document`).

---

## 7. Тести
- **Unit `useSelection`** (`tests/unit/useSelection.test.jsx`): toggle/selectAll/clear,
  indeterminate, синхронізація при зміні `allIds` (зник id → виходить), стабільність на новий
  масив із тим самим вмістом.
- **Unit Drive-батч** (`tests/unit/deleteDocumentsBatch.test.js`): `matchArtifactFileIds`
  ловить `.txt`/`.layout.json`/`.clean.md`/`.digest.md` **+ вигаданий `_<driveId>.foo`**;
  `runWithConcurrency` ≤ ліміт; `deleteDocumentsArtifactsBatch` — 1 LIST + driveId +
  originalDriveId + дедуп; падіння одного DELETE не блокує (failedCount); без 02-папки — лише
  прямі id без LIST.
- **Unit повнота** (`tests/unit/documentsExtended.test.js`): `deleteExtendedForDocuments`
  прибирає всі id за один save, ігнорує відсутні, порожній → 0.
- **Integration** (`tests/integration/actions.test.js`): `delete_documents` (full/archive/
  registry_only, UI-only гейт, частковий збіг, порожній), `restore_documents`, leджери НЕ
  зачеплені. Існуючі `delete_document`-тести (обгортка) — зелені.
- **Unit ArchiveView** (`tests/unit/ArchiveView.test.jsx`): переписано — верхніх «…всі» немає,
  спільний BulkActionBar, select-all/рядковий вибір → onRestoreSelected/onDeleteSelected з id.
- **toolDefinitions**: `delete_documents`/`restore_documents` додано в EXCLUDED (батч-UI, не
  tool-use), синхронізація PERMISSIONS↔tools зелена.

`npm test` → **1937 passed (152 файли)**. `npm run build` → **success**.

---

## 8. Що НЕ зачеплено
- EFFECT-B (App.jsx) і write-guard — без змін.
- Вкладка «Дерево» (`matMode==="tree"`) — без мультивибору (поза скоупом).
- `time_entries[]` / `ai_usage[]` — свідомо не чіпані (леджери).
- `deleteOcrCacheForDocument` лишено для зворотної сумісності (тепер суфікс-матч).
- schemaVersion — без bump.

---

## 9. Git
- Гілка `claude/bulk-delete-unify-PCkVS`. Це **зміни коду** → за правилом №1 CLAUDE.md
  потрібне коротке підтвердження адвоката ПЕРЕД фолдом у `main` (push у `main` тригерить
  CI + деплой GitHub Pages). До підтвердження — лишається на feature-гілці.

**Кінець звіту.**
