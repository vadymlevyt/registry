# Звіт — TASK 3.2: clean_text кнопки ретроактивної очистки + ACTION агента

**Дата:** 2026-06-02
**Гілка:** `claude/clean-text-buttons-phase-vRN3g`
**Тип:** UI-точки виклику ядра 3.1 + AI-first ACTION (ядро 3.1 НЕ чіпалось)
**schemaVersion:** без bump (поля `textFormat`/`cleanedAt` уже з 3.1)
**Спека:** `docs/tasks/TASK_3.2_clean_text_buttons.md` · Parent: `docs/tasks/TASK_3_clean_text.md`

---

## Суть

Дати адвокату очистити **наявні** скан-документи справи заднім числом — через UI
(кнопки в Огляді і Viewer) і через агента (голос/чат). Ядро очистки готове з 3.1
(`cleanTextService.cleanDocument` + Drive-шви `cleanTextDriveAdapter`). 3.2 — лише
**тонкі точки виклику**, які тягнуть готове ядро. Нуль дублювання логіки очистки.

---

## Ключове архітектурне рішення — ОДНА дія, три точки входу

Замість трьох незалежних викликів `cleanDocument` (як у початковій діаграмі parent),
**усі три точки входу маршрутизуються через ОДНУ ACTION `clean_document_text`**:

```
Огляд (цикл N) ─┐
Viewer (один)  ─┼─► executeAction('dossier_agent','clean_document_text') ─► ядро 3.1 (adapter+cleanDocument)
Агент (чат)    ─┘
```

Чому так (сильніша інтерпретація Rule of Three / AI-first / #11):
- **Один шлях логіки** — adapter+ядро будуються в ОДНОМУ місці (handler ACTION), не в
  трьох UI-обробниках. Кнопки стали по-справжньому тонкими.
- **AI-first / дублювання інтерфейсів** — UI і агент роблять буквально те саме.
- **Однакові перевірки** — permission/tenant/caseAccess + білінг застосовуються
  уніфіковано до всіх трьох.

`module=case_dossier`, `billAsUserAction:true` для всіх трьох (parent §C7).

---

## Складові (що зроблено)

### 3.2.3 — ACTION `clean_document_text` (ядро AI-first)
`src/services/actionsRegistry.js`:
- Нова дія `clean_document_text({caseId, documentId})`: знаходить справу/документ,
  **скоуп-гард** (`documentNature!=='scanned'` → `{skipped, reason:'not_scanned'}`),
  тягне ядро 3.1 через adapter. Маппінг результату ядра у success-контракт:
  `{ok:true}`→`{success:true, attentionNotes, warning}`; `{degraded}`→
  `{success:false, degraded, needsRecleaning, warning}`; інакше `{success:false, error}`.
- **PERMISSIONS**: `dossier_agent` отримав `clean_document_text`. Інші агенти
  (document_processor / court_sync) — без дозволу (blocked).
- **Ліниве завантаження ядра** (dynamic `import()` у handler'і): top-level import
  `cleanTextDriveAdapter`→`ocrService`→`pdfjs-dist` ламав би всі тести, що вантажать
  `actionsRegistry` (DOMMatrix недоступний у Node). Тести ін'єктують стаби через
  `deps.cleanDocument` / `deps.buildCleanDocumentDriveDeps`; прод вантажить ліниво.
- **getApiKey** доданий у `createActions` deps (App.jsx: `() => localStorage…claude_api_key`).
- Tool definition `CLEAN_DOCUMENT_TEXT_TOOL` у `toolDefinitions.js` + у `DOSSIER_AGENT_TOOLS`.
- Промпт агента досьє (`CaseDossier/index.jsx`) — згадка дії у списку tools.

### 3.2.1 — кнопка «Очистити тексти» в Огляді (retroactive, N док.)
`src/components/CaseDossier/index.jsx` + `services/cleanTextCycle.js`:
- Кнопка поряд зі «Створити контекст» (ті самі design-токени).
- **Логіка винесена у чистий модуль `cleanTextCycle.js`** (тестовний без React):
  `partitionForCleaning(documents)` (фільтр scanned+сирий, пропуск searchable/.md/
  архівних) + `runCleanCycle({documents, caseId, executeAction, onProgress})` (цикл
  ACTION по черзі, агрегація cleaned/skipped/degraded/errors + згруповані attentionNotes).
- Підтвердження перед стартом (дорого — N AI-викликів). Прогрес «Чищу N з M».
- `CleanResultCard` — підсумок (очищено/пропущено/деградовано/помилок + місця уваги
  текстом, БЕЗ підсвіток — це 3.4). UI-стан у компоненті.

### 3.2.2 — кнопка «Очистити документ» у Viewer (один)
`DocumentViewer/DocumentViewerFooter.jsx` + `index.jsx` + CaseDossier wiring:
- Кнопка у footer (`Sparkles`), активна лише для `scanned` + `textFormat!=='md'` + Drive.
- Тягне ту саму ACTION через `onCleanText` (CaseDossier → `handleCleanOneDocument`).
- Успіх → форсуємо перечитку Viewer'а (оновлюємо `selectedDoc.textFormat='md'`+`cleanedAt`,
  яке є в deps ефекту `TextContent` → `getCleanOrRawText` віддає свіжий `.md`).
- Деградовано → toast «не завершено, джерела збережено», `.md` не змінюється.
- attentionNotes — у toast (кількість) на успіху.

---

## Білінг — рішення (увага адвоката)

`clean_document_text` САМ звітує `agent_call` усередині ядра (`billAsUserAction:true`,
agentType `text_cleaner`) — **той самий сигнал, що й кнопки UI** (вони теж ідуть через
цю ACTION). Щоб executeAction-hook не **дублював** generic-звіт на ту саму очистку,
додано малий однозначний Set `SELF_BILLING_ACTIONS = {'clean_document_text'}` (єдиний
сенс #11: «дія нараховує свій білінг сама — не нараховуй вдруге»). Без нього виходило б
два `time_entries` на одну очистку.

> Це єдине торкання core-логіки білінгу executeAction. Решта дій без змін.

---

## Долі артефактів / скоуп — успадковані з ядра 3.1 (не змінювались)
`.md` створюється, `.txt`→`_raw_txt/`, `.layout.json` видаляється, метадані
`textFormat='md'`+`cleanedAt`+`attentionNotes`. Скоуп — тільки `scanned`.

---

## Тести
- **`tests/integration/clean_document_text.test.js`** (10): PERMISSIONS (dossier ✓,
  document_processor/court_sync ✗), scanned-гард (searchable→skipped, ядро не викликане),
  виклик ядра з `module=case_dossier`+`billAsUserAction:true`+apiKey, agentId adapter,
  маппінг success/degraded/error/skipped, відсутній документ, обовʼязкові параметри,
  білінг без подвійного звіту (+ контраст add_note).
- **`tests/unit/cleanTextCycle.test.js`** (5): фільтр scanned/пропуск searchable+md+
  архівних, прогрес N/M, агрегація cleaned/degraded/errors, помилка одного не валить
  цикл, ядро-skipped не = помилка.
- Розширено `_actionsTestSetup.js`: `cleanDeps` (стаби getApiKey/cleanDocument/build-deps)
  + `getTrackerCalls()` (перевірка білінгу). Зворотно-сумісно (всі існуючі тести зелені).
- **`npm test` — 144 файли / 1827 тестів зелені. `npm run build` — success.**

---

## Дотримання меж (ЖОРСТКІ МЕЖІ спеки)
- ✅ Ядро 3.1 (`cleanTextService`) НЕ змінювалось — лише викликане через adapter.
- ✅ Підсвітки уваги (`==мітки==`/`<mark>`/чип/панель) — НЕ робились (це 3.4).
- ✅ DP-пайплайн (`splitDocumentsV3`/`DocumentPipelineContext`/`extractV3`/streaming) —
  НЕ чіпався. Інтеграційний clean-text DP тест лишається зеленим.
- ✅ UI-вибір/мультивибір/видалення — НЕ робились (це 3.3).
- ✅ Скоуп тільки `scanned`; design — лише наявні токени/компоненти, без CSS-островів.

---

## Файли
**Змінено:** `src/services/actionsRegistry.js`, `src/services/toolDefinitions.js`,
`src/App.jsx`, `src/components/CaseDossier/index.jsx`,
`src/components/DocumentViewer/index.jsx`, `src/components/DocumentViewer/DocumentViewerFooter.jsx`,
`tests/integration/_actionsTestSetup.js`, `docs/tasks/TASK_3_clean_text.md` (мапа фаз).
**Нове:** `src/components/CaseDossier/services/cleanTextCycle.js`,
`tests/integration/clean_document_text.test.js`, `tests/unit/cleanTextCycle.test.js`,
цей звіт.

---

## Перевірка адвокатом
1. Огляд → «Очистити тексти» → підтвердження → прогрес N/M; чистить лише сирі скани,
   `.md`/цифрові пропускає; ResultCard з підсумком.
2. Viewer scanned (сирий) → «Очистити документ» → гарний `.md`; attentionNotes у toast.
3. Агент досьє: «очисти цей документ» / «почисти всі тексти» → виконує `clean_document_text`.
4. DOCX/HTML / вже-`.md` — кнопки немає (скоуп/фільтр).

**Кінець звіту TASK 3.2.**
