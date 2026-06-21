# TASK — DP: діагностичне логування тріажу (паспорт + токени + текст помилки)

**Статус:** SPEC (на рев'ю адвоката, код не починати до затвердження)
**Дата:** 2026-06-21
**Гілка розробки:** Codespaces / `main`
**Schema bump:** НЕ потрібен (тільки diag-лог на Drive, не registry)
**Скоуп:** ТІЛЬКИ додавання полів у diag-лог. НУЛЬ зміни логіки нарізки.

---

## 🚨 0. ТОЧКА ВІДКАТУ + ГОЛОВНЕ ПРАВИЛО

**ROLLBACK ANCHOR:** `31d82b903ff332d110243520be3324f33162ef4f` (`main`, A4 реленд, працює:
80-стор. том → 17 документів, detectBoundaries 17.3с).

**Це АДИТИВНА діагностика.** Жоден байт логіки нарізки/тріажу/паспорта/диригента не
змінюється — лише **додаються поля у лог** і **прокидається usage**. Якщо тягне змінити
ПОВЕДІНКУ (план, маршрути, артефакти) — СТОП, це не цей TASK. Тести нарізки мають лишитися
зеленими без правок (окрім нових тестів на самі поля логу).

---

## 1. ПРОБЛЕМА

Diag-лог (`_diagnostics/dp_diag_*.json`) показує `routes` і `documentsCount`, але тріаж —
«чорна скринька»:
- **не видно розміру паспорта** (скільки тексту реально пішло в тріаж) → не бачимо
  пропорційну щільність A4 у дії, нема на чому калібрувати бюджет;
- **не видно токенів** тріажу (реальний спожитий бюджет);
- **не видно ТЕКСТУ помилки** на `triage_error` — саме це 2026-06-21 змусило півдня гадати
  «A4 чи баланс» (текст був лише в зниклому UI-тості).

## 2. ЦІЛЬ

У diag-лог потрапляють: розмір паспорта (символи) + к-сть сторінок (→ символів/стор
видно), реальні input/output токени тріажу, к-сть документів, і — на збої — **текст
помилки тріажу**. Усе через наявний канал рішень (decisions) → `pipeline_result` diag.
Diag-логер у стадії НЕ протягуємо (це чіпало б ctx-потік диригента — делікатне).

---

## 3. ЗМІНИ (4 файли, тільки додавання)

### 3.1 `src/services/documentBoundary/analyzeTriageViaToolUse.js`
Повертати `usage` поряд з планом (вже є в `const { text, usage, model } = await callAgent(...)`,
рядок ~57; зараз функція повертає лише `{documents, unusedPages}`, рядок ~89):
```js
return { documents: parsed.documents || [], unusedPages: parsed.unusedPages || [], usage };
```
`usage` = `{ inputTokens, outputTokens }` (контракт callAgent). Споживачі, що читають лише
`documents`/`unusedPages`, не ламаються (зайве поле).

### 3.2 `src/contexts/DocumentPipelineContext.jsx` (`aiTriage`, ~рядок 75)
**Без змін** — `return analyzeTriageViaToolUse(...)` уже віддає весь об'єкт, тож `usage`
пройде наскрізь автоматично. (Перевірити, що не деструктурується по дорозі.)

### 3.3 `src/services/documentPipeline/stages/triageStage.js`
Перед викликом тріажу порахувати розмір паспорта (рядки вже мають `artifacts` і `emptyPassports`):
```js
const passportChars = artifacts.reduce((s, a) => s + ((a.passport || '').length), 0);
const totalPages = artifacts.reduce((s, a) => s + (a.pageCount || 0), 0);
```
- **Успіх:** захопити usage до `normalizePlan` (бо той може зрізати зайве):
  ```js
  const raw = await triage({ ... });
  const usage = raw?.usage || null;
  plan = normalizePlan(raw);
  ```
  На УСПІШНОМУ поверненні плану (де triageStage віддає результат із планом/рішеннями)
  додати рішення:
  ```js
  { type: 'triage_done', scope: 'triage', message: `Triage: ${plan.documents.length} документів`,
    meta: { passportChars, totalPages, perPageChars: totalPages ? Math.round(passportChars/totalPages) : null,
            inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null,
            documentsCount: plan.documents.length, unusedPagesCount: (plan.unusedPages||[]).length,
            emptyPassports } }
  ```
  (Додати у масив рішень успішного шляху — НЕ ламаючи наявні рішення/маршрути.)
- **Помилка (catch):** збагатити наявне рішення `triage_error` meta (текст уже в `message`):
  ```js
  meta: { artifactsCount: artifacts.length, emptyPassports, passportChars, totalPages,
          errorMessage: String(err?.message || err).slice(0, 300) }
  ```
- (Опційно, симетрично) у `triage_empty` додати `passportChars, totalPages` у meta.

### 3.4 `src/services/documentPipeline/streamingExecutor.js` (`pipeline_result` diag, ~рядок 405)
Зараз логиться лише `routes` (типи рішень). Додати **meta рішень тріажу**:
```js
triage: Array.isArray(result.decisions)
  ? result.decisions.filter((d) => d?.scope === 'triage')
      .map((d) => ({ type: d.type, message: d.message || null, ...(d.meta || {}) }))
  : null,
```
diag `sanitize()` сам обріже надто довгі рядки (захист від тексту документа) — числові поля
(passportChars/токени/documentsCount) пройдуть як є; короткий текст помилки — теж.

---

## 4. ЧОГО НЕ ЧІПАЄМО (§2-bis)

- Логіку тріажу/нарізки/паспорта (`pageMarkers`, `splitDocumentsV3`, `buildCompactTriagePassport`,
  A4-щільність), диригент, схему, інші три дороги — **не торкатися**.
- НЕ протягувати diag-логер у стадії; НЕ міняти ctx-потік диригента.
- Жодних нових тумблерів/ACTION/prompt. Маршрути і кількість документів — **байт-у-байт** як зараз.

---

## 5. ТЕСТИ (`tests/unit/`)

- `analyzeTriageViaToolUse` повертає `usage` (мок callAgent → перевірити, що `usage` у результаті).
- `triageStage`: успішний прогін → у рішеннях є `triage_done` з meta (`passportChars`,
  `perPageChars`, `inputTokens`, `documentsCount`); помилковий → `triage_error` meta має
  `errorMessage` + `passportChars`.
- Маршрути/кількість документів існуючих тестів triageStage — **незмінні** (доказ, що логіка та сама).
- `npm test` повністю зелений.

## 6. SAAS / BILLING

- SAAS: жодної registry-схеми. diag-лог — тимчасова діагностика на Drive (як є).
- BILLING: облік (ai_usage/activityTracker) **не чіпаємо** — `usage` лише для diag-видимості,
  не дублюється у білінг. Триаж — той самий 1 виклик.

## 7. ACCEPTANCE

- [ ] У `dp_diag_*.json` запис `pipeline_result` містить `triage:[{... passportChars, perPageChars, inputTokens, outputTokens, documentsCount}]` на успіху.
- [ ] На `triage_error` — `triage:[{ message, errorMessage, passportChars, totalPages }]` (причина видна на Drive).
- [ ] Маршрути/документи нарізки незмінні; `npm test` зелений; чіпнуто лише 4 файли (§3).
- [ ] Звіт `docs/reports/report_task_triage_diag_logging.md`.

---

**Кінець.** Адитивна діагностика: паспорт + токени + текст помилки тріажу у diag-лог на Drive,
через канал рішень. Нуль зміни поведінки нарізки.
