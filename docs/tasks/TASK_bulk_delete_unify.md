# TASK — Уніфікація видалення: спільний мультивибір (архів + реєстр) + швидкий батч

**Дата:** 2026-06-04
**Тип:** UI (спільний компонент вибору) + батч-ACTIONS + Drive-батч (перформанс) + дедуп архіву.
**Гілка:** правило №1 CLAUDE.md (remote → `claude/*`; фолд після підтвердження адвоката — **код+деплой**).
**schemaVersion:** без bump (немає нових полів даних).
**PHILOSOPHY:** прочитати `DEVELOPMENT_PHILOSOPHY.md` перед стартом (обов'язково). Спільність UI+логіки (правило #11 — одне ім'я = один сенс), `executeAction` як єдина точка мутацій, ембріон з повним ДНК (SaaS-готовність).

---

## ПРОБЛЕМА (звірено по коду)

Адвокат: «видалення треба допиляти; в архіві дублюється функція (є кнопка „Видалити все“ і окремо вибір файлів); те саме потрібно в реєстрі; і видалення **дуже повільне**».

Три дефекти + один баг-сирота:

1. **Дублювання в архіві.** `ArchiveView.jsx` уже має повноцінний мультивибір (чекбокси + «виділити всі» + батч-бар «Відновити/Видалити обрані», рядки 78-127) **І** окремо — верхні кнопки «Відновити всі»/«Видалити всі» (рядки 49-68). Останні — дубль: select-all + батч-бар покривають їх повністю.

2. **У реєстрі немає мультивибору.** Реєстр (`CaseDossier/index.jsx`, блок `matMode === "registry"`, рядки 2153-2212, `filteredDocs.map`) дає лише одиночне видалення через `DocumentViewer` → `DeleteDocumentModal` (вибір «Архівувати» / «Видалити повністю»). Масово вибрати й видалити/архівувати — неможливо.

3. **Повільність (корінь знайдено).**
   - `App.jsx` **EFFECT-B** (рядки 4455-4523) пише **весь `registry_data.json` на Drive при КОЖНІЙ зміні `cases`** (немає дебаунсу). Масове видалення — це цикл `for (doc of docs) await delete_document(...)` (`CaseDossier:2099-2102`, `2067-2071`, `2079-2082`), де кожна ітерація робить `setCases` → **N повних перезаписів реєстру**.
   - `deleteOcrCacheForDocument` (`driveService.js:543-579`) **лістить усю папку `02_ОБРОБЛЕНІ` на КОЖЕН документ** → N однакових LIST-запитів.
   - усі Drive-DELETE **послідовні** (2-5 на документ).
   - 10 документів → ~50-80 послідовних HTTP + 10 перезаписів реєстру.

4. **Баг-сирота (полагодити тут).** `deleteOcrCacheForDocument` видаляє лише `<base>_<driveId>.txt` і `.layout.json` — **НЕ чистить `.clean.md`/`.digest.md`** (варіанти clean_text v2, схема v11). Після видалення документа варіанти лишаються сиротами на Drive.

---

## РІШЕННЯ АДВОКАТА (узгоджено — НЕ переобговорювати)

- **Реєстр, мультивибір:** дві масові дії — **«Архівувати обрані»** і **«Видалити обрані повністю»** (дзеркало одиночної модалки `DeleteDocumentModal`).
- **Архів, мультивибір:** лишити дві дії — **«Відновити обрані»** і **«Видалити обрані»**. Прибрати **обидві** верхні кнопки «…всі» (і «Відновити всі», і «Видалити всі») — select-all + батч-бар їх замінюють.
- **Спільність:** і UI (компонент панелі + хук вибору), і логіка (батч-ACTION + Drive-батч) — **спільні**, живуть **окремо** (не інлайн у кожному компоненті), переюзають архів і реєстр.
- **Швидкість:** видалення має бути швидким.

---

## АРХІТЕКТУРА РІШЕННЯ

### A. Спільний модуль вибору (UI + логіка) — `src/components/UI/`

Кладемо в наявну спільну теку `src/components/UI/` (там уже `Button`, `Checkbox`, `icons.js`).

**A.1 — хук `useSelection(allIds)` (`src/components/UI/useSelection.js`):** чиста логіка мультивибору, переюзна.
- Стан `selectedIds: Set`. API: `toggle(id, value?)`, `selectAll()`, `clear()`, `isSelected(id)`.
- Похідне: `allSelected`, `someSelected` (indeterminate), `count`.
- `allIds` — поточний повний список (для select-all/indeterminate). При зміні складу списку (фільтри/видалення) — **прибрати з selectedIds ті id, яких уже немає** (синхронізація через `useEffect`/derive, без «привидів»).
- Чистий, без DOM → юніт-тест.

**A.2 — компонент `BulkActionBar` (`src/components/UI/BulkActionBar.jsx` + `.css`):** презентаційна панель.
- Props: `{ total, selectedCount, allSelected, someSelected, onToggleSelectAll, children }`.
- Рендерить: select-all `Checkbox` (з `indeterminate`) + лейбл «Виділено: N з total» + слот `children` для кнопок дій (передаються зовні — архів і реєстр кладуть свої).
- **Тільки дизайн-токени** (`--color-*`, `--space-*`, `--radius-*`), жодних hex. Стиль спільний для обох місць.
- Рядковий чекбокс — наявний `Checkbox` з `../UI` (вже спільний; реєстрові інлайн-рядки отримують його).

> **#11 / спільність (parent-принцип clean_text):** НЕ робити двох копій логіки вибору чи двох стилів панелі. Архів і реєстр імпортують `useSelection` + `BulkActionBar`. Якщо десь потрібен варіант кнопок — передається через `children`, ядро не дублюється.

### B. Батч-логіка видалення — `actionsRegistry.js` + `driveService.js`

**B.1 — Drive-батч `deleteDocumentsArtifactsBatch(caseData, docs)` (`driveService.js`):**
- **ОДИН** LIST `02_ОБРОБЛЕНІ` (`q=` по parent, фільтр у JS — правило #8, кирилиця в іменах).
- **Зіставлення за стабільним суфіксом, НЕ за переліком розширень.** Імена артефактів мають форму `<base>_<driveId>.<ext>` — `driveId` унікальний і стабільний. Брати **ВСІ** файли папки, чиє ім'я містить `_${doc.driveId}.` → це ловить `.txt`, `.layout.json`, `.clean.md`, `.digest.md` **і будь-який майбутній суфікс** (правило «для системи їх не існує» — нуль сиріт навіть коли додадуть новий тип артефакту). Не хардкодити 4 імені.
- Додати `doc.driveId`, `doc.originalDriveId` кожного документа (прямі id, незалежні від папки).
- **Дедуп** усіх fileId → видалити з **обмеженою конкурентністю** (пул, напр. 6 одночасних) через новий хелпер `runWithConcurrency(items, limit, fn)` (теж у `driveService.js` або `src/utils/`). Кожне видалення в try/catch — падіння одного не блокує інші.
- Повертає `{ deletedCount, failedCount }`.
- `deleteOcrCacheForDocument` — лишити для зворотної сумісності, **але перевести на той самий суфікс-матч** (щоб і одиночний шлях чистив `.clean.md`/`.digest.md` — баг #4). Винести логіку «знайти всі fileId документа в 02» у спільну функцію, щоб не було двох розбіжних реалізацій.

**B.2 — ACTION `delete_documents({ caseId, documentIds, mode })`** (`actionsRegistry.js`, поряд із `delete_document:944`):
- `mode ∈ {'full','registry_only','archive'}` — **точний паритет** із `delete_document` (зокрема `archive` — це той самий наявний overload single-екшена; НЕ новий сенс, тому #11 не порушено — батч дзеркалить single).
- `archive`: **ОДИН** `setCases` — усім `documentIds` `status:'archived'`, `updatedAt`.
- `full`/`registry_only`: **ОДИН** `setCases` — `documents.filter(d => !ids.has(d.id))`; **ОДИН** прохід `documents_extended` (батч-хелпер `deleteExtendedForDocuments` + `invalidateCache`, не N викликів); далі (тільки `full`) — `deleteDocumentsArtifactsBatch` + `resumeStore.clearResume(driveId)` по кожному. Повний чек-ліст сховищ — **B.4** (нуль сиріт).
- Повертає `{ success, mode, deleted:[ids], failed:[ids], message }`.
- **`delete_document` рефакторнути в обгортку**: `delete_document({...}) → delete_documents({ documentIds:[documentId], ... })` + адаптувати повернення під старий контракт (`{success, mode, documentId, message}`) — ОДНА логіка, нуль дублювання. Існуючі тести `delete_document` мусять лишитись зеленими.
- `UI_ONLY_ACTIONS` (`actionsRegistry.js:~41`): додати `delete_documents` (вимагає `_fromUI:true`, як `delete_document`).
- `PERMISSIONS.dossier_agent`: додати `delete_documents` (там, де є `delete_document`).

**B.3 — ACTION `restore_documents({ caseId, documentIds })`** (інверсія архіву):
- **ОДИН** `setCases` — усім `documentIds` `status:'active'`. Без Drive, без extended.
- Дзеркало `onRestoreSelected`. Повертає `{ success, restored:[ids] }`.
- `PERMISSIONS.dossier_agent`: додати. Не UI-only (як `update_document` — звичайна зміна; але виклик іде з кнопки, лишити консистентно з restore — **не** додавати в UI_ONLY, бо restore не деструктивний; одиночний restore зараз іде через `update_document` без `_fromUI`).

> **Перформанс-ефект:** N документів → **1** `setCases` (1 перезапис реєстру) + **1** LIST + паралельні DELETE (пул) + **1** extended-write. Замість ~50-80 послідовних — одиниці батчів. Це і є фікс повільності. **Жодного дебаунсу EFFECT-B не чіпати** (ризик race з write-guard) — батч прибирає N-перезаписів у корені.

### B.4 — ПОВНОТА ВИДАЛЕННЯ — НУЛЬ СИРІТ (вимога адвоката: «для системи їх не існує»)

Повне видалення (`mode:'full'`) мусить прибрати **ВСЕ**, що повʼязане з документом — жодного сліду в жодному сховищі. Чек-ліст (виконавець проходить кожен пункт):

| Сховище | Що прибрати | Як |
|---------|-------------|-----|
| **registry_data.json** `cases[].documents[]` | сам запис документа (всі легкі поля) | `setCases` filter (B.2) |
| **`documents_extended.json`** (Drive, `.metadata/`) | важка метадата: `tags, notes, annotations, processingHistory, extractedTextSummary, customFields, attentionNotes` | **батч** `deleteExtendedForDocuments(caseId, caseData, ids)` (ОДИН read+filter+save замість N) — додати у `documentsExtended.js` поряд із `deleteExtendedForDocument:102` |
| **In-memory extended cache** | Map по `caseId` | `invalidateCache(caseId)` (`documentsExtended.js:113`) після save |
| **Drive 01_ОРИГІНАЛИ / основний файл** | `doc.driveId` (PDF/основний, де б не лежав — id незалежний від папки) | `deleteDriveFile` (у пулі B.1) |
| **Drive оригінал поряд** | `doc.originalDriveId` (DOCX/HTML після конвертації) | `deleteDriveFile` (у пулі B.1) |
| **Drive 02_ОБРОБЛЕНІ** | **усі** `*_<driveId>.*` (`.txt`, `.layout.json`, `.clean.md`, `.digest.md`, будь-який майбутній) | суфікс-матч (B.1) |
| **OCR resume-стан** | in-memory partial-OCR по `driveId` | `resumeStore.clearResume(doc.driveId)` (`ocr/resumeStore.js:45`) |
| **In-memory OCR cache** (якщо тримає текст/layout по `<base>_<driveId>`) | запис документа | інвалідувати, якщо у `ocrService` є відповідний хелпер; інакше — Drive-файли вже видалені, lookup дасть міс (зафіксувати у звіті) |

- **Фрагменти/інші папки (03_ФРАГМЕНТИ/04_ПОЗИЦІЯ/05_ЗОВНІШНІ):** у поточній архітектурі похідні артефакти документа живуть у 02_ОБРОБЛЕНІ; якщо у справі виявляться файли по `_<driveId>.` в інших папках — звірити й при потребі розширити LIST. Зафіксувати у звіті, що перевірено.
- **МЕЖА (НЕ видаляти автоматично):** `time_entries[]` та `ai_usage[]`, що містять `documentId` — це **бухгалтерські леджери** (облік часу адвоката / телеметрія токенів), історичні записи. Видалення документа їх **НЕ чіпає** (видалення записів обліку спотворило б білінг/історію). Це свідома межа — якщо колись треба «забути й облік» — окреме рішення/борг. **Зафіксувати у звіті як свідоме виключення.**

### C. UI-зміни по місцях

**C.1 — Архів (`ArchiveView.jsx` + `CaseDossier`):**
- Прибрати верхній блок `archive-view__bulk-actions` (рядки 49-68) — **обидві** кнопки «Відновити всі»/«Видалити всі». Прибрати props `onRestoreAll`/`onDeleteAll` і відповідні хендлери в `CaseDossier` (`2064-2075`, `2096-2107`).
- Батч-бар (select-all + «Відновити обрані»/«Видалити обрані») — лишити, перевести на `useSelection` + `BulkActionBar` (спільні), а хендлери `onRestoreSelected`/`onDeleteSelected` — на **`restore_documents`** / **`delete_documents`** (`mode:'full'`, `_fromUI:true`) з **ОДНИМ** `systemConfirm` на пачку. `onDeleteOne`/`onRestoreOne` — лишити (single, теж можна перевести на батч-екшн із 1 id для єдиного шляху).

**C.2 — Реєстр (`CaseDossier`, `matMode === "registry"`, 2153-2212):**
- Додати мультивибір: рядковий `Checkbox` (спільний) у кожен `filteredDocs.map` рядок (клік по чекбоксу НЕ відкриває `setSelectedDoc`; `stopPropagation`), select-all + `BulkActionBar` зверху списку.
- Стан вибору — через `useSelection(filteredDocs.map(d=>d.id))` (синхронізувати з фільтрами — A.1).
- Дві кнопки в барі: **«Архівувати обрані»** → `delete_documents({mode:'archive', _fromUI:true})`; **«Видалити обрані повністю»** → `delete_documents({mode:'full', _fromUI:true})`. По одному `systemConfirm` на дію (текст «повністю» — наголос що файли зникнуть з Drive).
- **Scope:** мультивибір — у вкладці **Реєстр** (`matMode==="registry"`). Вкладка **Дерево** (`matMode==="tree"`, 2124-2150) — поза скоупом (там навігація кліком). Архівні рядки у Viewer не відкриваються (як було).

---

## SAAS / BILLING / AUDIT

- **SaaS:** батч-екшени працюють у межах справи (tenant успадковується); жодних нових сутностей без `tenantId`. Перевірки доступу — наявний `executeAction` ланцюг (checkCaseAccess) спрацьовує per-call.
- **Billing:** видалення/архівування/відновлення — **не білабельна робота** (немає `time_entry`, немає `ai_usage`), як і поточний `delete_document`. Не інструментувати.
- **Audit:** паритет із `delete_document` — він **не** в `AUDIT_ACTIONS` (документи не аудуються, лише `destroy_case`/`delete_hearing`/`delete_deadline`). Батч теж **не** аудувати (консистентність). Якщо колись треба — окремий борг, не тут.

---

## ACCEPTANCE
- [ ] `useSelection` + `BulkActionBar` — спільні, у `src/components/UI/`, переюзані архівом і реєстром (нуль дублювання логіки/стилів; тільки дизайн-токени).
- [ ] Архів: верхні кнопки «Відновити всі»/«Видалити всі» **прибрані**; лишився select-all + батч-бар «Відновити/Видалити обрані».
- [ ] Реєстр: мультивибір із select-all + «Архівувати обрані»/«Видалити обрані повністю»; клік по чекбоксу не відкриває документ; вибір синхронізований із фільтрами.
- [ ] `delete_documents` (batch, modes full/registry_only/archive) + `restore_documents`; `delete_document` рефакторено в обгортку над batch (старий контракт/тести зелені); обидва в PERMISSIONS, `delete_documents` у UI_ONLY.
- [ ] Drive-батч: **1** LIST `02_ОБРОБЛЕНІ`, паралельні DELETE (пул), дедуп fileId; зіставлення за суфіксом `_<driveId>.` (ловить `.txt`/`.layout.json`/`.clean.md`/`.digest.md` + майбутні) — баг #4 закрито.
- [ ] **Повнота (B.4):** після `full` не лишилось сліду документа — ні в `documents_extended.json` (батч-delete + invalidateCache), ні в `resumeStore`, ні на Drive (усі `_<driveId>.*` + driveId + originalDriveId). `time_entries`/`ai_usage` — свідомо НЕ чіпано (зафіксувати у звіті).
- [ ] Масове видалення N документів = **1** перезапис реєстру (1 `setCases`) + **1** LIST + паралельні DELETE — помітно швидше; **1** `systemConfirm` на пачку.
- [ ] EFFECT-B (App.jsx) **не чіпано**; нестрімові/інші шляхи не зачеплені.
- [ ] `npm test` зелений, `npm run build` success.

## ЩО НЕ РОБИТИ
- ❌ Дебаунсити/міняти EFFECT-B чи write-guard (ризик race; батч прибирає причину).
- ❌ Дублювати логіку вибору чи стилі панелі в кожному компоненті — лише спільні `useSelection`/`BulkActionBar`.
- ❌ Розширювати мультивибір на вкладку «Дерево» (поза скоупом).
- ❌ Додавати audit/billing для видалення (паритет із наявним).
- ❌ Bump schemaVersion (немає нових полів).
- ❌ Кирилиця в `q=` Drive API (правило #8) — фільтр імен у JS.
- ❌ Обходити `executeAction`/`createDocument`; чіпати `case.timeLog`.

## ТЕСТИ
- Unit `useSelection`: toggle/selectAll/clear, indeterminate, синхронізація при зміні `allIds` (зник id → виходить із selected).
- Unit `delete_documents`: один `setCases` прибирає всі id; `mode:'archive'` → усі status archived; `mode:'full'` → виклик Drive-батча; повернення `{deleted,failed}`. `restore_documents`: усі status active одним проходом. `delete_document` як обгортка — старий контракт.
- Unit Drive-батч (`deleteDocumentsArtifactsBatch`, стаб `driveRequest`/`deleteDriveFile`): один LIST; суфікс-матч `_<driveId>.` ловить `.txt`/`.layout`/`.clean.md`/`.digest.md` **і вигаданий новий `_<driveId>.foo`**; + driveId+originalDriveId; дедуп; конкурентність ≤ ліміт; падіння одного не блокує.
- Unit повнота (B.4): `deleteExtendedForDocuments` прибирає всі id за один save + `invalidateCache`; `delete_documents(full)` кличе `clearResume` по кожному driveId; `time_entries`/`ai_usage` НЕ зачеплені (лишаються).
- Integration: архів без верхніх «…всі» кнопок (видалено, нічого не зламано); реєстр-мультивибір → батч-архів і батч-видалення (один confirm, один екшн); існуючі `delete_document`-тести зелені.

## ЗВІТ
`docs/reports/report_task_bulk_delete_unify.md`: спільний модуль (хук+бар); батч-екшени + Drive-батч (1 LIST + пул + варіанти); дедуп архіву; мультивибір реєстру; перформанс до/після; що НЕ зачеплено (EFFECT-B, дерево, інші споживачі); тести; git confirm.

## ПЕРЕВІРКА АДВОКАТОМ
1. **Архів:** верхніх кнопок «Відновити всі»/«Видалити всі» немає; «виділити всі» → «Видалити обрані» видаляє все (швидко); один запит підтвердження.
2. **Реєстр:** вибрати кілька → «Видалити обрані повністю» (зникають з реєстру і Drive) і «Архівувати обрані» (їдуть в архів); «виділити всі» → одна дія на всіх.
3. **Швидкість:** масове видавлення 10+ документів — секунди, не десятки секунд.
4. **Нуль сиріт:** після повного видалення документа для системи його не існує — нема ні файлів (01/02, усі `_<driveId>.*`: `.txt`/`.layout.json`/`.clean.md`/`.digest.md`, оригінал), ні запису в реєстрі, ні extended-метадати, ні resume-стану. (Облік часу/токенів — навмисно лишається.)

**Кінець TASK.**
