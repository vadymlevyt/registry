# report — micro-TASK 4: correction fix (documentNature + lastOcrAt)

**Дата:** 2026-05-09
**Версія:** 1.0
**Тестів:** 422/422 зелені

---

## 1. Що знайшов про причину чому корекція не працювала

Корекція провалювалась через **stale closure** у `executeAction` після `await` посередині pipeline.

Послідовність подій у `CaseDossier:onSubmit`:

1. `await onExecuteAction('dossier_agent', 'add_document', …)` — `setCases(prev => …)` enqueue, ACTION повертає success.
2. `await ocrService.extractText(ocrFile)` — секунди очікування. **Під час цього await React встигає виконати re-render App.jsx**, нова `executeAction` створюється з новим `cases` (з документом всередині).
3. **АЛЕ** in-flight onSubmit замикання тримає СТАРИЙ `onExecuteAction` — той що передавався у пропсах CaseDossier на момент відкриття модалки.
4. `await onExecuteAction('dossier_agent', 'update_document', …)` викликає СТАРУ функцію.
5. Стара функція → стара `ACTIONS[update_document]` → стара `cases.find(c => c.id === caseId)`.
6. Стара `cases` ще не містить щойно додану доку. `targetCase.documents.findIndex(d => d.id === documentId)` повертає `-1`.
7. update_document повертає `{ success: false, error: "Документ … не знайдено у справі" }`.
8. Pipeline ловить через `try/catch` і пише `console.warn` — ні `lastOcrAt`, ні `documentNature` не записуються.

**Точні рядки до фіксу (App.jsx):**

- `update_document` — рядки 5307–5360.
- Стале читання — рядок 5327: `const targetCase = cases.find(c => c.id === caseId);`
- Невдала перевірка — рядок 5331: `const docIdx = (targetCase.documents || []).findIndex(d => d.id === documentId);`
- Setter після всіх перевірок — рядок 5345: `setCases(prev => prev.map(c => …))`. `setCases` сам по собі функціональний — проблема була в **читанні** перед ним.

**Точка виклику — pipeline (CaseDossier:2895–2904):** `await onExecuteAction('dossier_agent', 'update_document', { caseId, documentId, fields })` — параметри і поля правильні, проблема не тут.

`ALLOWED_UPDATE_FIELDS` на App.jsx:5314–5318 уже включав і `'documentNature'`, і `'lastOcrAt'` — ALLOWLIST це не блокувало.

`extractText` (ocrService.js:228–236) повертає `provider: name` де `name` ∈ `'cache' | 'pdfjsLocal' | 'documentAi' | 'claudeVision'` — pipeline саме цей `result.provider` і використовує для рішення `'searchable' vs 'scanned'` (CaseDossier:2892).

---

## 2. Чи редагувалися Viewer/Header у мікро-TASK 3

**НІ.** Коміт 52d317d (micro-TASK 3) змінив лише два файли:

```
report_micro_task_3_addmodal_pipeline.md  | +210 (новий)
src/components/CaseDossier/index.jsx      | +70/-2
```

DocumentViewer/index.jsx, DocumentViewerHeader.jsx, DocumentViewerContent.jsx, DocumentViewerFooter.jsx — **не торкались**. Останні зміни в них — у TASK 10.1 (коміт 402f22d).

---

## 3. Чи логіка перемикача спирається тільки на documentNature

**ТАК** — підтверджено. Релевантні рядки в `src/components/DocumentViewer/index.jsx`:

- 42–44: `effectiveNature = document?.documentNature || inferred; isScanned = effectiveNature === 'scanned';`
- 95: `<DocumentViewerHeader … showModeToggle={isScanned} … />`

Інші вхідні дані до рішення про показ перемикача — лише `inferred` (fallback за іменем/MIME коли поля немає взагалі, для legacy < v5). Жодних інших прапорів, lastOcrAt, mode не впливають на видимість перемикача.

`DocumentViewerHeader` лише пробрасує `showModeToggle` далі і рендерить `<ScanTextToggle>` за цим прапором. Підтверджено грепом і читанням.

**Висновок:** логіка не була змінена в micro-TASK 3 і поводиться правильно.

---

## 4. Які файли і рядки змінено в цьому мікро-TASK

| Файл | Рядки | Що |
|------|-------|-----|
| `src/App.jsx` | 5307–5374 (`update_document`) | `setCases(prev => …)` функціональна форма з винесеним `outcome` — читання stale `cases` усунено. Allowlist не змінений. Поведінка для caller'ів ідентична (повертає той самий контракт `{success, …}`). |
| `src/components/CaseDossier/index.jsx` | 2433–2493 (`onReprocess`) | Дзеркало логіки pipeline AddDocumentModal: коли `ocrResult.text` непорожній — корекція `documentNature` за `result.provider` (pdfjsLocal → 'searchable', інші → 'scanned') разом з `lastOcrAt`. Якщо текст порожній — лиш `lastOcrAt`. |
| `tests/integration/_actionsHarness.js` | 227 | Додано `'lastOcrAt'` до allowed list (синхронізація з App.jsx). Захист від silent skip у тестах коли в майбутньому додасться інтеграційний тест на reprocess. |

---

## 5. Як працює тепер pipeline (короткий опис)

**AddDocumentModal → onSubmit:**
1. Завантажити файл у 01_ОРИГІНАЛИ → `driveId`.
2. Обчислити `initialNature` (для PDF → 'scanned' за дефолтом).
3. `add_document` (передає документ у реєстр) — модалка може закритись.
4. `extractText(ocrFile)` — OCR pipeline, копія тексту в 02_ОБРОБЛЕНІ.
5. Якщо текст непорожній → корекція через `update_document`:
   - `lastOcrAt` ← поточний час
   - `documentNature` ← `'searchable'` якщо `provider === 'pdfjsLocal'`, інакше `'scanned'`
6. **Тепер працює** бо `update_document` через функціональну форму `setCases(prev => …)` бачить актуальний стан з щойно доданою докою.

**onReprocess (кнопка "Перерозпізнати" у Viewer):**
1. Той самий `extractText({ skipCache: true })`.
2. Так само корекція `documentNature` + `lastOcrAt`.
3. Drive файл і реєстр оновлюються — Viewer повторно фетчить кеш через залежність `useEffect` від `lastOcrAt` і вже бачить правильний режим (Scan/Text або тільки Text).

---

## 6. Як адвокат може виправити старі документи

**Для 5 з 7 документів Кісельової з `documentNature='scanned'`** (Ухвала, Рішення суду, Витяг з ЄДР, РНОКПП, Довідка садок):

1. Відкрити документ у Viewer.
2. У підвалі натиснути **"Перерозпізнати"**.
3. Дочекатись toast "Текст розпізнано і збережено".
4. Перевірити: для текстових PDF (Ухвала, Рішення, Витяг) перемикач Скан/Текст **ЗНИКАЄ** і лишається тільки Текст — це правильно. Для скан-PDF/JPEG (РНОКПП, Довідка садок) перемикач лишається — теж правильно.

**Для документів `documentNature='searchable'`:**

- Позовна заява (.docx) — реально текстова, нічого виправляти не треба.
- Адвокатський запит (реально сканований PDF, помилково 'searchable') — **ЦЕЙ випадок виправити через UI зараз НЕ МОЖНА**, причина у пункті 7.

---

## 7. Що НЕ зроблено і чому

### 7.1. Кнопка "Перерозпізнати" видима лише для documentNature='scanned'

`DocumentViewerFooter.jsx:171–181`:
```jsx
{isScanned && (
  <Button … onClick={handleReprocess} disabled={!hasDrive}>
    Перерозпізнати
  </Button>
)}
```

Це означає: документ помилково помічений як `'searchable'` (Адвокатський запит) — **кнопки в підвалі не видно**, виправити з UI без видалення/перезавантаження не можна.

**Чому НЕ виправив:** TASK явно пише *"НЕ переписуй DocumentViewer чи його логіку показу"* і *"Якщо доведеться зачепити рендер Viewer — зупинись, поясни мені у звіті чому потрібно і що саме хочеш змінити, і не міняй без додаткового підтвердження."*

**Що пропоную (потребує підтвердження адвоката окремою репліки):**

- Варіант A — показувати "Перерозпізнати" завжди коли `hasDrive`, не лише для scanned. Користь: завжди можна перевірити що OCR класифікував документ правильно, навіть якщо думали що він текстовий. Ризик: нульовий — кнопка просто доступна частіше. Зміна: одна умова в `DocumentViewerFooter.jsx:171` — `{isScanned && …}` → `{hasDrive && …}` (або без зовнішнього guard, бо disabled теж є).
- Варіант B — показувати лише коли `documentNature` є в стані де можна сумніватись (наприклад є `lastOcrAt` старе або немає взагалі).
- Варіант C — нічого не міняти, для виправлення `Адвокатський запит` адвокат його видаляє і додає заново.

Рекомендую **Варіант A** — найпростіший і найгнучкіший: кнопка завжди доступна для документів з файлом на Drive, ніяких прихованих станів.

### 7.2. Не виправив `add_document` і `delete_document` ACTIONS

Ті самі `cases.find(…)` з замикання живуть в `add_document` (App.jsx:5233), `add_documents` (5276), `delete_document` (5369). У продакшні **ще** не зловлено — поточний баг проявлявся бо `add_document` → `update_document` йшли в один pipeline. Якщо в майбутньому з'явиться pipeline з двома `add_*` поспіль або `add_*` → `delete_*` — тий же сценарій повториться.

**Чому НЕ виправив:** TASK явно просив *мінімальний* фікс і *"НЕ міняй архітектуру pipeline"*. Окремий TASK на аудит усіх ACTIONS на стале читання cases — рекомендую закласти, але виходить за scope micro-TASK 4.

### 7.3. Не торкав `extractText`, `documentFactory`, `DocumentViewer`, формат текстових копій

Згідно зі скоупом TASK ("Поза скопом").

---

## Тести

```
Test Files  35 passed (35)
Tests       422 passed (422)
Duration    50.14s
```

Зокрема:
- `tests/integration/actions.test.js` — 14 тестів зелені (включно з update_document edge-cases).
- `tests/integration/documentViewer-workflow.test.jsx` — 4 тести зелені (включно з "Перерозпізнати викликає onReprocess з документом").

Інтеграційного тесту на повний pipeline AddDocumentModal зі stale closure поки немає — harness не симулює React render race. Окремий TASK ActionsRegistry refactor (винести ACTIONS з App.jsx у `src/services/actionsRegistry.js` як factory) дозволить написати такий тест, він уже згаданий у `_actionsHarness.js:5` і CLAUDE.md розділ "ТЕСТУВАННЯ".
