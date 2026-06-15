# TASK — Case UI: inline-edit у досьє + людські назви категорій + прибрати «військову» + per-case деталі Result

**Тип:** спека для сесії-виконавця. Адмін-сесія НЕ реалізує сама.
**Статус:** очікує затвердження адвоката → виконавець.
**Дата:** 2026-06-15
**Підстава:** 6 пунктів від сесії розширення за фінальним прогоном (п.4 — підтвердження без коду; п.6 — позитив без дії).
**Пріоритет:** §1 БЛОКЕР (ручне виправлення назв не працює), далі §2-§3 (категорії), §4 (Result-деталі).

---

## §1 — БАГ: inline-edit назви/клієнта не працює (ПРІОРИТЕТ)

**Корінь (знайдено):** inline-edit (`InlineEditableText`) додали ТІЛЬКИ у `CaseModal`
(App.jsx ~305) — швидкий модал, який майже не показується. А клік по справі в реєстрі
відкриває **CaseDossier** (`onClick={() => setDossierCase(c)}`, App.jsx ~5503), де назва —
звичайний текст (`CaseDossier/index.jsx` ~2368: `{caseData.name}`). Тому «клік по назві
не оживляє поле».

**Фікс:** підключити `InlineEditableText` у **CaseDossier** — на назву (header ~2368) і на
клієнта. Збереження — через `executeAction('qi_agent','update_case_field',{caseId, field,
value})` (ця дія вже ставить `nameSource:'manual'` → авто-оновлення з ЄСІТС ручну правку
не перезапише). Має правитись **БУДЬ-ЯКА** назва: і `[ЄСІТС]`-автоназви, і заведені вручну
(Манолюк, Брановський). name — порожнє заборонено (`allowEmpty={false}`); client — дозволено.
- CaseDossier має отримувати/мати `executeAction` (перевірити проп від App; якщо нема — додати).
- CaseModal-варіант лишити як є (не ламати).
- Токени дизайн-системи, без inline-кольорів.

## §2 — Людські назви категорій при показі

Зараз бейдж/поля показують машинний enum (`administrative_offense`, `admin`, далі
`commercial`) — бо `CAT_LABELS` (App.jsx:168) неповний. **Оновити мапу показу** на:
```
civil → Цивільна
criminal → Кримінальна
administrative → Адміністративна
admin → Адміністративна          (наше storage-значення; admin ≡ administrative)
commercial → Господарська
administrative_offense → Справа про адміністративне правопорушення
null / невідоме → Не визначено
```
- Оновити ВСІ точки показу категорії однією мапою (DRY): `CAT_LABELS` (App.jsx:168,
  вживається ~257/323/338), `catMap` (App.jsx ~967), бейдж/поля у `CaseDossier`,
  фільтр-таби (App.jsx ~5435). Винести в один експортований словник, щоб не розповзалось
  (правило #11: одне джерело назв категорій).
- Для тісного бейджа `administrative_offense` можна короткий варіант («Адмінправопорушення»)
  на розсуд у межах дизайн-системи; повна назва — у деталях/полі «Категорія».

## §3 — Прибрати «Військову» категорію

Військові справи юридично адміністративні; з кабінету приходять як `administrative`(→`admin`).
Окрема `military` лише плутає.
- **Прибрати `military`** з: `CAT_LABELS`/`catMap`, `<option value="military">` (App.jsx ~2788),
  фільтр-список (App.jsx ~5435), enum у `caseSchema.js` (~32).
- **Мігрувати наявні** `category:'military'` → `'admin'` лінивою нормалізацією у
  `normalizeCases` (App.jsx) — щоб реальні справи адвоката (і seed Корева/Конах) стали
  адміністративними на завантаженні. Оновити й значення в `INITIAL_CASES` (military→admin).
- У селекторі create/edit додати наявні валідні категорії: `commercial` (Господарська),
  `administrative_offense` (Справа про адмінправопорушення) — щоб ручне створення їх пропонувало.
  Залишити: civil, criminal, administrative(=admin), commercial, administrative_offense.
- Display-мапа має м'яко віддавати «Не визначено» для невідомого (на випадок стрічкового military).

## §4 — Per-case деталі у Result (інформативність)

Зараз Result — лише числа. Додати `result.details: [{ case_no, action:'created'|'updated'|
'skipped', changed: string[] }]` — поіменно ЩО сталося.
- `scenarioProcessor.processCase` повертає (через `inc`) деталь по справі: `action` (створено/
  оновлено/пропущено), `changed` — людиночитні позначки: «нова назва: …», «+N засідань»,
  «оновлено ecitsState», «пропущено: <причина>». Агрегувати у `result.details[]`
  (cap ~200, як history).
- `ImportTab` ResultCard: під числами — згортуваний список «Деталі по справах» (case_no →
  дія + зміни). Не ламати числа/persisted/warnings/pendingReview.
- Адитивно: старі тести Result не падають (details — нове поле).

## Підтверджено без коду
- **§ (п.4 розширення) Повне ПІБ:** `buildCaseIdentity` робить `resolveRepresentedParties().
  join(', ')` — масив береться **ЯК Є, без ре-скорочення**. Повні ПІБ у `representedParties`
  → повна назва «Бабенко Олександра Іванівна, Бабенко Олександр Миколайович (case_no)». ✓
  Змін не треба.

## Тести (обов'язково, `npm test` зелений)
- §1: InlineEditableText у CaseDossier — клік→input→Enter зберігає через update_case_field;
  name порожнє заборонено; правка ставить nameSource:'manual'; працює для manual-справи.
- §2: display-мапа повертає правильні укр-назви для всіх enum + null→«Не визначено».
- §3: `normalizeCases` переводить military→admin; селектор/фільтр/enum без military;
  commercial/administrative_offense пропонуються.
- §4: processCase повертає action/changed; submitScenarioResult агрегує result.details;
  ImportTab рендерить per-case список; старі callers без details не падають.

## Межі / SEMANTIC CLARITY
- НЕ чіпати дедуп/контракт/v12/delete-persist/durability/race-фікс. #11: один словник назв
  категорій (не дублювати по точках); `nameSource` семантику не міняти.
- НЕ бампити schema (category — описовий enum; military→admin — нормалізація даних, не bump).
- Двозначність → ЗУПИНИСЬ і спитай.

## Воркфлоу / здача
- Від СВІЖОГО main (`git fetch origin main && git checkout -b <branch> origin/main`).
- НЕ пушити в main. Запуш СВОЮ гілку → адмін-звірка → одне-реченнєве «ок» адвоката → FF.
- Звіт: `docs/reports/report_task_case_ui_and_result_polish.md`.

Критерій готовності: назва/клієнт правляться кліком у досьє (будь-яка справа), ручне →
manual; категорії показуються по-людськи; «військова» прибрана (наявні military→admin);
Result має per-case деталі; full ПІБ у назві; `npm test` зелений.
