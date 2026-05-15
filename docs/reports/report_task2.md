# Звіт TASK 2 — ACTIONS реєстр документів/проваджень + PERMISSIONS

**Дата:** 2026-05-08
**Виконавець:** Claude Code (Opus 4.7, 1M context)
**Статус:** Завершено, sanity-tests 22/22 пройдено, білд чистий.

---

## Резюме TASK 2

Додано вісім нових ACTION-ів для роботи з документами і провадженнями (`add_document`, `add_documents`, `update_document`, `delete_document`, `add_proceeding`, `update_proceeding`, `delete_proceeding`, `update_processing_context`) і нову агентську роль `document_processor_agent`. Реалізовано патерн UI-only ACTIONS через `_fromUI`-прапор для делетів. Drag-n-drop у досьє переведено з тимчасового обходу через `update_case_field('documents', ...)` на чистий `add_document`. Поле `'documents'` прибрано з allowlist `update_case_field`. Допоміжні Drive/extended-сервіси отримали функції чистого видалення. AUDIT_ACTIONS оновлено.

---

## Виправлення / реалізація з TASK

| Підзадача | Результат | Розташування в коді |
|-----------|-----------|--------------------|
| 2.1 `add_document` | ✓ | `src/App.jsx:5215-5244` |
| 2.2 `add_documents` (batch, атомарна валідація) | ✓ | `src/App.jsx:5246-5295` |
| 2.3 `update_document` (allowlist 13 полів, валідація після оновлення) | ✓ | `src/App.jsx:5297-5350` |
| 2.4 `delete_document` (три режими + UI_ONLY_ACTIONS) | ✓ | `src/App.jsx:5352-5436` |
| 2.5 `add_proceeding` / `update_proceeding` / `delete_proceeding` | ✓ | `src/App.jsx:5438-5577` |
| 2.6 `update_processing_context` | ✓ | `src/App.jsx:5579-5601` |
| 2.7 PERMISSIONS — `document_processor_agent` + нові дії | ✓ | `src/App.jsx:5640-5709` |
| 2.8 Drag-n-drop використовує `add_document` | ✓ | `src/components/CaseDossier/index.jsx:1942-1985` |
| 2.9 Sanity-tests + білд | ✓ 22/22 pass | `scripts/sanity_test_task2.mjs` |

---

## Створені файли

| Файл | Призначення |
|------|-------------|
| `scripts/sanity_test_task2.mjs` | Sanity-тести 9 сценаріїв TASK 2.9 + 4 додаткові (циклічна перевірка проваджень, атомарність батчу, audit-actions, update_processing_context). |
| `report_task2.md` | Цей звіт. |

## Змінені файли

- **`src/App.jsx`**
  - Імпорти (`:7`, `:13`, `:14`): додано `deleteDriveFile`, `deleteOcrCacheForDocument`, `loadExtendedForCase`, `deleteExtendedForDocument`, `validateDocument`.
  - Top-level: `isProceedingDescendant()` (`:212-224`) і константа `UI_ONLY_ACTIONS = { delete_document, delete_proceeding }` (`:226-232`).
  - `update_case_field` allowlist (`:4671-4682`): прибрано `'documents'`, додано коментар чому.
  - `ACTIONS` — нова "ГРУПА 5 — Документи і провадження" (8 дій) перед композитною `batch_update` (`:5215-5601`). Стара "ГРУПА 5" перейменована на "ГРУПА 6 — Композитна дія".
  - `PERMISSIONS` (`:5640-5709`): новий `document_processor_agent` + нові дії в `qi_agent`, `dossier_agent`. `dashboard_agent` без змін.
  - `executeAction` (`:5728-5762`): UI-only check на самому початку (до PERMISSIONS allowlist).

- **`src/services/auditLogService.js`** (`:18-24`): сім нових записів у `AUDIT_ACTIONS` (`add_document`, `add_documents`, `update_document`, `delete_document`, `add_proceeding`, `update_proceeding`, `delete_proceeding`).

- **`src/services/driveService.js`** (`:346-396`): дві нові експортовані функції `deleteDriveFile(fileId)`, `deleteOcrCacheForDocument(caseData, doc)`. Друга шукає `<sanitizedName>_<driveId>.txt` у `02_ОБРОБЛЕНІ` через q=parent з фільтрацією у JS (правило #8 — без кирилиці у q=).

- **`src/services/documentsExtended.js`** (`:101-110`): нова експортована `deleteExtendedForDocument(caseId, caseData, documentId)`.

- **`src/components/CaseDossier/index.jsx`** (`:1942-1985`): drag-n-drop drop queue тепер ітерує файли і викликає `add_document` per-file. Видалено локальне накопичення масиву + єдиний `update_case_field` в кінці. Race-condition між послідовними setState вирішується тим, що ACTIONS використовують функціональні `setCases(prev => ...)`.

- **`recommended_task_claude_md_audit.md`** (новий розділ внизу): "TASK 2 — ACTIONS і PERMISSIONS зміни" з рекомендаціями для майбутнього CLAUDE.md аудиту.

---

## Відхилення від TASK з обґрунтуванням

1. **`requireUI: true` як поле ACTIONS-об'єкта** vs **`UI_ONLY_ACTIONS` Set** — TASK пропонував два варіанти; я обрав Set, бо реальна структура `const ACTIONS = { name: handler }` — мапа функцій, не об'єктів `{handler, audit, requireUI}`. Зміна на іншу структуру переписала б увесь реєстр (30+ дій). Set дає той самий ефект і узгоджується з існуючим патерном `AUDIT_ACTIONS` як масивом.

2. **Поле провадження — `title`, не `name`** — поточна seed-структура (`App.jsx:101-102`) і UI використовують `proc.title`, не `proc.name`. ACTIONS адаптовані: приймають `title` або `name` як alias, зберігають як `title`.

3. **Тип провадження не редагується через `update_proceeding`** — додано в коментар. Зміна типу провадження (first → appeal → cassation) — структурне рішення, потребує окремого ACTION у майбутньому.

4. **Хелпер `isProceedingDescendant` — у App.jsx, не в окремому `proceedingsService.js`** — використовується лише в одній ACTION; виносити в окремий файл для 12 рядків було б передчасною абстракцією.

5. **`deleteOcrCacheForDocument` — у `driveService.js`, не в `documentsService.js`** — `documentsService.js` не існує; логіка пов'язана з Drive операцією, не з канонічною схемою документа. Плюс використовує патерн q=parent (правило #8 без кирилиці).

6. **DocumentProcessor досі викликає `updateCase` напряму** — навмисне обмеження scope. Переписування DP на `add_documents` потребує одночасної міграції на Tool Use, що окремий TASK (Фаза 2). Інфраструктура готова — `add_documents` ACTION і `document_processor_agent` permission уже існують і чекають на DP v2.

---

## Знахідки

- **Поле проваджень неузгоджене з TASK** — TASK писав `proceeding.name`, реальність — `proceeding.title`. Адаптовано без зміни існуючих даних.
- **`agentId` у `batch_update` параметрах** — існуюча композитна дія приймає agentId через `params`, а не з outer scope `executeAction(agentId, ...)`. Не змінював, бо це поза scope TASK 2.
- **DocumentProcessor пише в documents напряму** — досі. Це баг архітектури згідно `diagnostic_report_2026-05-07.md` (виявлення №2), але повне виправлення — TASK Document Processor v2.
- **`'documents'` як єдине поле, прибране з allowlist** — `proceedings` ніколи не було в allowlist `update_case_field`, тож не потребує видалення; CaseDossier модальне вікно "+ Додати документ" (`:2483-2517`) досі використовує `updateCase(caseData.id, "documents", ...)` напряму (через старий пропс `updateCase`, не через `executeAction`). Це не drag-n-drop, тож поза scope TASK 2.8 — окремий малий фікс на майбутнє.

Окремий файл `discovered_issues_during_task2.md` не створював, бо знахідки невеликі і покриваються цим звітом.

---

## Sanity-tests результати

22/22 pass:

```
✓ AUDIT_ACTIONS має add_document
✓ AUDIT_ACTIONS має add_documents
✓ AUDIT_ACTIONS має update_document
✓ AUDIT_ACTIONS має delete_document
✓ AUDIT_ACTIONS має add_proceeding
✓ AUDIT_ACTIONS має update_proceeding
✓ AUDIT_ACTIONS має delete_proceeding
✓ update_processing_context НЕ в audit (службова)

✓ Test 1: add_document success
✓ Test 2: add_documents batch addedCount=3
✓ Test 3: update_document allowed field (isKey)
✓ Test 4: update_document forbidden field (addedBy) — error як очікувалось
✓ Test 5: delete_document blocked без _fromUI
✓ Test 6: delete_document _fromUI archive
✓ Test 7: add_proceeding з parentProcId
✓ Test 8: delete_proceeding blocked без _fromUI
✓ Test 9: document_processor_agent заблокований на create_case

✓ Bonus: isProceedingDescendant proc_sub є нащадком proc_main
✓ Bonus: proc_main НЕ нащадок proc_sub
✓ Bonus: add_documents атомарність — батч з невалідним падає
✓ Bonus: жодного документа з провального батчу не додано
✓ Bonus: update_processing_context дозволений dossier_agent

━━━ Результат: 22 pass, 0 fail ━━━
```

Запуск: `node scripts/sanity_test_task2.mjs`

---

## Рекомендації для CLAUDE.md

Додано секцію в `recommended_task_claude_md_audit.md` ("TASK 2 — ACTIONS і PERMISSIONS зміни"):
- Розділ "ACTIONS і PERMISSIONS" — оновити з 30 → 38 ACTIONS, 3 → 4 ролі
- Новий патерн `UI_ONLY_ACTIONS` / `_fromUI`
- `'documents'` прибрано з allowlist `update_case_field`
- Розширити список AUDIT_ACTIONS у CLAUDE.md
- "PHASE 1.5" доповнити підрозділ "Точки створення документа" — drag-n-drop через add_document; delete_document з трьома режимами; каскадне обнулення procId
- Перелік нових сервіс-функцій (`deleteDriveFile`, `deleteOcrCacheForDocument`, `deleteExtendedForDocument`, `isProceedingDescendant`)

CLAUDE.md у TASK 2 не оновлював (Варіант C — мінімальне втручання, окремий TASK CLAUDE.md Audit).

---

## Білд + push

- **`npm run build`** — ✓ чистий (1 974 KB JS bundle, 9.57s).
- **Sanity-tests** — ✓ 22/22 pass (`node scripts/sanity_test_task2.mjs`).
- **Git коміт + push** — буде виконано наступним кроком.

---

## Пояснення в термінал для адвоката

Я закінчив другий TASK з підготовки системи для роботи з документами і провадженнями. Тепер агенти-помічники AI отримали окремі правильні команди для додавання, оновлення і видалення документів — раніше при перетягуванні файлу в досьє система йшла обхідним шляхом, тепер усе працює як треба.

**Що змінилося для тебе:**
- Перетягуєш файл у досьє → система додає документ через ту саму "офіційну" процедуру, що й усі інші модулі. Якщо помилка під час завантаження одного файлу — інші файли все одно додаються, у списку черги покаже знак "✗" біля проблемного.
- Видалення документа отримало три режими (повне видалення з Drive / тільки з реєстру / архівувати). Кнопок у UI поки немає — це окремий TASK; зараз ці режими перевірено в коді й готові до підключення.
- Помічник Document Processor (який нарізає PDF на окремі документи) тепер має своє окреме місце в системі прав. Він може додавати документи, але не може випадково видалити справу чи створити нову — це знімає клас потенційних збоїв.
- Агент у досьє тепер може окремо додавати/оновлювати провадження (основне, апеляцію, касацію). Видалення провадження все одно доступне тільки через UI з підтвердженням — щоб випадкове "видали апеляцію" в чаті не знесло реальні дані.

**Чи все працює:**
Так. Усі автоматичні перевірки зелені (22 з 22), збірка проекту проходить без помилок.

**Що зробити далі:**
Перевір на сайті після деплою (зазвичай 2-3 хвилини після push):
- Зайди в досьє Брановського або іншої справи з папкою на Drive.
- Перетягни 2-3 файли в зону "📎 Перетягніть або натисніть".
- Натисни "▶ Завантажити на Drive".
- Переконайся, що документи з'явились у "Матеріалах" з маркером ⚠ (бо тип/автор/провадження ще не задані — це правильна поведінка, як у TASK 1).

Якщо додавання працює і документи з'являються — все ОК.

**Деталі:**
Повний технічний звіт — у файлі `report_task2.md` у корені репо. Завантаж його в адмін-чат щоб подивитись повну картину змін, кожен відсутній/виправлений нюанс і перелік файлів які були змінені.
