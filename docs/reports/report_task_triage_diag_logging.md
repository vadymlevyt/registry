# Report — TASK triage_diag_logging (DP діагностичне логування тріажу)

**Дата:** 2026-06-21
**Тип:** адитивна діагностика (нуль зміни логіки нарізки/тріажу/паспорта/диригента)
**Гілка:** main

---

## База / точка відкату

Локальна база на старті була застарілою (`main` @ `41e0184`) — спека й A4-реленд
лежали на `origin/main`, ще не підтягнуті. Після `git fetch origin`
(`41e0184..66bdeda`) і `git rebase origin/main` обидва доступні:

- **Спека** `docs/tasks/TASK_triage_diag_logging.md` — на `origin/main`; роботу
  звірено з нею (§3 — рівно 4 файли; §4 — нарізка не торкнута; §5 — тести).
- **ROLLBACK ANCHOR** `31d82b903ff332d110243520be3324f33162ef4f` — існує
  (`Reapply "feat(dp): A4-ч.1 пропорційна щільність паспорта меж"`). Регресія →
  відкат на цей хеш.

Комміт перебазовано на свіжий `origin/main` (`66bdeda`) без конфліктів — A4 та
інше не зачеплено.

---

## Суть

У diag-лог (`_diagnostics/dp_diag_*.json`, запис `pipeline_result`) додано
видимість тріажу через канал рішень (`decisions`, `scope==='triage'`):
паспорт (символи + щільність на сторінку), реальні токени тріажу, текст
помилки. Diag-логер у стадії **не** протягувався — канал суто через
`decisions` → `pipeline_result`.

---

## Зміни (4 файли)

### 1. `src/services/documentBoundary/analyzeTriageViaToolUse.js`
Повертає `usage` поряд із планом: `{ documents, unusedPages, usage }`. `usage`
вже надавав `callAgent` (`{ inputTokens, outputTokens }`) — просто прокинуто
наскрізь. JSDoc оновлено.

### 2. `src/contexts/DocumentPipelineContext.jsx` (`aiTriage`)
**Без змін.** `aiTriage` повертає результат `analyzeTriageViaToolUse`
безпосередньо (`return analyzeTriageViaToolUse(...)`, без деструктуризації) —
`usage` проходить наскрізь автоматично. Перевірено.

### 3. `src/services/documentPipeline/stages/triageStage.js`
- Пораховано `passportChars` (сума `a.passport.length`), `totalPages` (сума
  `a.pageCount`), `perPageChars` (округлена щільність).
- `triageUsage` захоплено **до** `normalizePlan` (нормалізація повертає новий
  план без `usage`).
- **Успіх:** до фінального return додано окреме рішення `triage_done`
  (`scope:'triage'`) з `meta { passportChars, totalPages, perPageChars,
  inputTokens, outputTokens, documentsCount, unusedPagesCount, emptyPassports }`.
  Існуюче `document_boundaries` лишається `decisions[0]` — поведінка незмінна.
- **Помилка (catch):** `triage_error` `meta` збагачено
  `{ errorMessage, passportChars, totalPages }` поверх існуючих
  `{ artifactsCount, emptyPassports }`.

### 4. `src/services/documentPipeline/streamingExecutor.js` (`pipeline_result`, ~405)
Додано поле `triage`: фільтрує `result.decisions` за `scope==='triage'` і
розгортає у плоскі записи `{ type, message, ...meta }` (з guard
`Array.isArray`).

---

## Незмінність логіки (доказ)

- Жодного маршруту/гейту/порогу не торкнуто. `normalizePlan`,
  `resolveOverlaps`, `isDegeneratePlan`, детермінована сітка, диригент,
  `buildCompactTriagePassport`, A4-щільність — без змін.
- Усі **існуючі** triageStage-тести (маршрути, кількість документів, дедуп,
  degenerate-пороги) лишилися зеленими без правок — `triage_done` додано як
  `decisions[1]`, тому `decisions[0]` посилання у тестах валідні.

---

## Тести (§5)

`tests/unit/analyzeTriageViaToolUse.test.js`:
- `повертає usage поряд з планом (input/output токени)`.

`tests/unit/triageStage.test.js`:
- успіх → `triage_done` з паспортом/токенами/щільністю поряд із
  `document_boundaries` (перевірка що `decisions[0]` лишається
  `document_boundaries`);
- без-usage → `triage_done.meta.inputTokens=null` (лог ізольований);
- помилка → `triage_error.meta` має `errorMessage` + `passportChars` +
  `totalPages` (+ адитивність існуючих полів).

**Результат `npm test`:** 177 файлів, **2231 тест — усі зелені**.

---

## SAAS / BILLING / AI USAGE IMPLICATIONS

Немає. Чисто діагностичні дані у локальному diag-файлі. Нових ACTIONS,
тумблерів, prompt-ів, схем, полів сутностей, точок білінгу чи AI-викликів не
додано. `callAgent` (Haiku, облік усередині) лишається єдиною точкою обліку
токенів тріажу — `triage_done` лише **відображає** ті самі токени у diag-лозі,
не дублюючи `ai_usage[]`.
