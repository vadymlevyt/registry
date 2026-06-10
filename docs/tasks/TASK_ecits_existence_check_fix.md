# TASK — Фікс гонки існування у `update_case_ecits_state` / `mark_synced_from_ecits`

**Тип:** спека для сесії-виконавця. Адмін-сесія НЕ реалізує сама.
**Статус:** очікує затвердження → виконавець.
**Дата:** 2026-06-10
**Пріоритет:** баг — реальний ЄСІТС-імпорт існуючих справ падає недетерміновано.

---

## 0. Проблема (доведено реальним прогоном)

Реальний smoke-імпорт 3 існуючих справ ПІСЛЯ FIX-IDENTITY і ПІСЛЯ hard-reload дав:
`Створено 0 | Оновлено 1 | Помилки 2` — дві справи з
`update_case_ecits_state failed: Справу case_… не знайдено`, хоча справи існують
(getCases їх знаходить, гілка «оновити» взята). Недетерміновано: одна оновилась,
дві ні.

**Корінь — гонка `found`-after-async-setCases** (`actionsRegistry.js`):
```js
let found = false;
setCases(prev => prev.map(c => {
  if (c.id !== caseId) return c;
  found = true;            // ← виставляється ВСЕРЕДИНІ updater'а
  ...
}));
if (!found) return { error: `Справу ${caseId} не знайдено` };  // ← читається СИНХРОННО
```
`found` мутується всередині функції-updater'а `setCases`. У ланцюгу імпорту
(`await executeAction…`) React **батчить** оновлення → updater виконується
**пізніше**, не синхронно → на момент `if (!found)` він ще `false` → хибне
«не знайдено». Перший `setCases` у послідовності інколи зливається синхронно
(тому 1 пройшла), наступні — ні → недетермінізм.

FIX-IDENTITY полагодив **читання** (`getCases`→casesRef.current живий), але **цю
внутрішню перевірку `found`** не торкнув. Той самий патерн — у
`mark_synced_from_ecits`.

> Це НЕ «стале дедуп-посилання» (мапи `case_no→case_id` не існує) і НЕ пам'ять-
> привид (hard-reload не допоміг). Корінь суто в цьому хендлері.

---

## 1. Зміна A — `update_case_ecits_state`: синхронна перевірка існування

Визначати існування **синхронно через `getCases()`** (живий, casesRef) ДО
`setCases`, не через прапор в updater'і:
```js
update_case_ecits_state: ({ caseId, patch, source }) => {
  if (!caseId) return { success:false, error:"caseId обов'язковий" };
  if (!patch || typeof patch !== 'object') return { success:false, error:"patch обов'язковий (object)" };
  if (!source) return { success:false, error:"source обов'язковий" };

  const target = getCases().find(c => c.id === caseId);
  if (!target) return { success:false, error:`Справу ${caseId} не знайдено` };

  // overwriteSkipped рахуємо з target СИНХРОННО (не в updater'і)
  const existingState = target.ecitsState || {};
  const existingSource = existingState._lastSource;
  const overwriteSkipped = !!(existingSource && !canOverwrite(existingSource, source));

  const timestamp = new Date().toISOString();
  const userId = getCurrentUser().userId;
  const tenantId = getCurrentUser().tenantId;

  if (!overwriteSkipped) {
    setCases(prev => prev.map(c => c.id === caseId
      ? { ...c, ecitsState: { ...(c.ecitsState||{}), ...patch, _lastSource: source }, updatedAt: timestamp }
      : c));
  }

  try { eventBus.publish(ECITS_CASE_STATE_UPDATED, { caseId, tenantId, userId, fieldsChanged: Object.keys(patch), source, timestamp, overwriteSkipped }); }
  catch (e) { console.warn('[update_case_ecits_state] eventBus publish failed:', e); }

  return { success:true, overwriteSkipped };
}
```
Семантика незмінна (той самий патч, той самий overwriteSkipped, та сама подія) —
прибрано лише гонку. **Жодного прапора, мутованого всередині updater'а.**

## 2. Зміна B — `mark_synced_from_ecits`: те саме

Той самий патерн (`let found=false; setCases(...found=true...); if(!found)`).
Переробити аналогічно: `const target = getCases().find(c=>c.id===caseId); if(!target) return {success:false, error:...};` синхронно, потім `setCases` для мутації
syncMetrics. Семантику інкременту лічильників зберегти (рахувати від
`target.ecitsState.syncMetrics`).

## 3. Зміна C (вторинне, окремо допустимо) — персист видалення

Симптом: видалені ЄСІТС-справи **пережили hard-reload** (getCases їх знаходить) →
видалення не зберіглося на Drive. Перевірити `deleteCasePermanently` (App.jsx ~4879):
після `setCases(filter)` має спрацювати Drive-збереження `cases`. Відтворити:
створити ЄСІТС-справу (без driveFolderId) → видалити → перевірити, що
registry_data.json на Drive більше її не містить (або після reload її нема). Якщо
не персиститься — полагодити тригер збереження. **Якщо не відтворюється швидко —
винести в окремий борг, не блокувати Зміни A/B.**

## 4. Тести (обов'язково, `npm test` зелений)

- **Регрес гонки:** тест, де `getCases` ПОВЕРТАЄ справу, а `setCases` — стаб, що
  **НЕ виконує updater синхронно** (відкладає). Перевірити: `update_case_ecits_state`
  на існуючий `caseId` повертає `{success:true}` (бо існування — з getCases, не з
  прапора). На неіснуючий `caseId` → `{success:false, error:'…не знайдено'}`. Те
  саме для `mark_synced_from_ecits`. Це і є пін фіксу (поточний код тут впав би при
  deferred setCases).
- Існуючі actions/court-sync тести лишаються зелені (семантика незмінна).
- Наскрізний ЄСІТС re-import: справа існує → `update`, без хибних «не знайдено».

## 5. Межі / SEMANTIC CLARITY

- НЕ міняти семантику update/mark (той самий патч/лічильники/подія/overwriteSkipped)
  — лише прибрати гонку. НЕ чіпати v12-контракт, FIX-IDENTITY, дедуп.
- #11: рішення «існує/ні» — одне джерело (`getCases()` синхронно), не прапор,
  мутований в асинхронному updater'і.

## 6. Воркфлоу / здача

- НЕ пушити в main. Запуш СВОЮ робочу гілку, назви її. Адмін-сесія звірить діф,
  адвокат дає одне-реченнєве «ок» → FF у main.
- Звіт: `docs/reports/report_task_ecits_existence_check_fix.md`.
- Будь-яка двозначність → ЗУПИНИСЬ і спитай, не вигадуй.

Критерій готовності: `update_case_ecits_state`/`mark_synced_from_ecits` визначають
існування синхронно через getCases; недетермінованих «не знайдено» немає; re-import
існуючих справ → оновлює без помилок; `npm test` зелений.
