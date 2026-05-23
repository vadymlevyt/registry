# Handoff: продовження сесії DP v2 revert + Drive UX fixes + crash fix

**Дата:** 2026-05-23
**Попередня сесія:** Codespaces на iMac адвоката, ця сесія
**Наступна сесія:** планшет/мобільний застосунок Claude
**Поточний HEAD на main:** `b330e8b` (плюс паралельний коміт ЄСІТС `2967b11`)

---

## Проєкт

Legal BMS адвокатського бюро Левицького (Registry v3). React 18 + Vite + ES modules,
GitHub Pages деплой, репо github.com/vadymlevyt/registry.

**ПЕРЕД БУДЬ-ЯКОЮ РОБОТОЮ — прочитати у такому порядку:**

1. `CLAUDE.md` (корінь) — архітектура, тверді правила
2. `DEVELOPMENT_PHILOSOPHY.md` (корінь) — філософія розробки, БЕЗ цього файлу не починати
3. Цей файл (handoff) — контекст останньої сесії

Паралельно адвокат запустив **TASK 0.4.1 Court Sync prompt optimization** у іншій сесії
(коміт `2967b11`). НЕ чіпати файли Court Sync (`src/components/CourtSync/`,
`src/services/ecits/*`) у цій сесії — там може бути активна робота.

---

## Що сталось цієї сесії

### 1. ФД-серія revert (13 комітів)

**Контекст:** ФД-серія була спробою закрити борги #19 (збагачений дайджест) і #21
(детектор реєстру) для покращення якості нарізки DP v2 на великих томах
(>100 стор.). Запланована мета — підняти точність з 35% baseline до 80%+.

**Реальний результат:** регрес. На Нестеренку (273 стор., crim case) DP давав
**1 документ замість 26-74** (1.3% точність) + **02_ОБРОБЛЕНІ порожня**.
Корінь: `tocDetector` false-positive на томах без справжнього реєстру —
повертав `isToc:true` з вирожденим планом (1 document = весь том),
`triageStage` обходив AI Triage.

**Revert виконаний:**
- 13 ФД-комітів через `git revert --no-commit` → агреговано в 2 squash-коміти:
  - `5fbd80a` — Revert "ФД-Z" (з ним пройшли 11 з 13)
  - `03a93ec` — Revert "TASK + diagnostic" (12-й і 13-й)
- 5 нерелевантних тестів видалено автоматично revert'ами
- **Court Sync MVP (a2cb46b) збережений** — не торкало DP файли
- Phase A B1-B3 fixes (layout-leak fix) залишилися активними
- Safety tag `backup-pre-fd-revert` стоїть на `a2cb46b` (можна повернути ФД при потребі)

**Підтверджено git diff `8c555c5..HEAD`:** DP-pipeline ідентичний `8c555c5` baseline
(після revert Phase B). Між ними тільки Court Sync файли + дрібні docs.

### 2. NFC + trim фікс у `findOrCreateFolder`

**Контекст:** на Нестеренку було дві папки на Drive. Спочатку діагноз
підозрював `findOrCreateFolder` (NFC). Адвокат потім пояснив що
насправді — стара папка з 13 квітня просто перестала бачитись після
місяця змін (можливо рукою перейменована), він **створив нову вручну**.

**NFC+trim фікс залишається корисним як профілактика** на майбутнє:
- `src/services/driveService.js:51-65` — додано `name.normalize('NFC').trim()`
  з обох сторін порівняння перед `===`
- 6 нових тестів у `tests/unit/driveService.test.js` (trailing whitespace,
  NFD-латиниця, regression ASCII)
- Кирилична `normalize('NFC')` для precomposed імен зазвичай ідентична
  оригіналу (українська = NFC=NFD), але `trim()` врятує від інших
  whitespace-причин дублів. Race condition залишається теоретичною
  проблемою без покриття цим фіксом.

**Коміт:** `0842124`.

### 3. Smart Drive buttons у CaseDossier

**Контекст:** після видалення обох старих папок Нестеренка з Drive,
`caseData.storage.driveFolderId` все ще вказував на видалену. Кнопка
«Відкрити» в UI вела в кошик. Кнопки «Створити структуру» не було видно
(вона показувалась тільки коли `driveFolderId` пустий).

**Реалізація — активна детекція стану папки:**
- Новий state `folderStatus`: `'unknown'|'alive'|'trashed'|'missing'`
- useEffect один Drive GET на `files/<id>?fields=id,trashed` при зміні
  `storage.driveFolderId`. 404 → `missing`, `trashed=true` → `trashed`,
  інакше `alive`. Network errors → `unknown` (не агресивний fallback)
- **Кнопка в блоці «Сховище»** залежно від стану:
  - `missing` → «Створити структуру на Drive» (як раніше)
  - `trashed` → червоний warning «Поточна папка у кошику Drive» +
    «↻ Перестворити структуру»
  - `alive` → назва папки + «Відкрити» (як раніше)
  - `unknown` → нейтральна плашка «Перевіряю стан папки на Drive…»
- **Chip «Drive» біля «Закрити справу»** — той самий `folderStatus`,
  4 стани: активний/у кошику/створіть/перевіряю. У trashed/missing —
  некліkабельний з підказкою «натисни ↻ Перестворити у блоці нижче»

**Коміти:** `f2c544d` (перша версія з двома кнопками), `df38548` (smart кнопка),
`a9136c7` (chip теж smart). `870254f` — empty commit для re-trigger CI
(перший deploy `df38548` впав на checkout — інфраструктурний баг GitHub).

### 4. CropperHost crash fix (userRotation is not defined)

**Контекст:** адвокат повідомив що при відкритті обрізаного документа
в модалці матеріалів справи — crash `ReferenceError: userRotation is not defined`.
Repro точний:
1. Модалка матеріалів → тапнути thumb → cropper popup
2. Обрізати → ✓ Готово → popup закривається
3. Тапнути той самий thumb знову → CRASH

**Корінь:** `CropperHost` функція (`ImageMergePanel.jsx:2601`) приймала
props `{cropperRef, displayUrl, initialCoords, frameVisible, onChange}` —
але у view-only гілці (`!frameVisible`, рядок 2625) читала `userRotation`
і `bakedUserRotationRef.current` напряму. Обидві змінні живуть у scope
батьківського `PreviewPopup` (рядки 2059, 2113). Класичний dangling
reference — вирізали код з parent у child компонент без передачі залежностей.

Чому крах тільки при re-open ПІСЛЯ ✓ Готово:
- 1-й відкритий: `cropApplied=false` → `frameVisible=true` → гілка
  `!frameVisible` НЕ виконується → dangling references мовчать
- Після ✓ Готово: `cropApplied=true` → `frameVisible=false` → при re-open
  view-only гілка виконується → читання undefined → ReferenceError

**Фікс:** передати `userRotation` і `bakedUserRotationRef` як props у `CropperHost`.
`CropperHost` експортовано (`export function`) для regression-тесту.

**Regression test:** `tests/unit/cropperHost.test.jsx`, 7 кейсів — view-only
рендер не падає для всіх 4×4 комбінацій user/baked rotations, CSS transform
коректний, delta-логіка нормалізована у [-180, 180].

**Коміт:** `b330e8b`.

---

## Поточний стан системи

### Тести: 1505 зелені (113 файлів)

```bash
npm test
# Test Files  113 passed (113)
#      Tests  1505 passed (1505)
```

Нові тести цієї сесії:
- `tests/unit/driveService.test.js` (+6) — NFC+trim find logic
- `tests/unit/cropperHost.test.jsx` (+7) — userRotation regression

### Деплой

GitHub Pages auto-deploy на push у `main` через `.github/workflows/deploy.yml`
(test → build → deploy). Останній успішний run — `b330e8b` (через ~3 хв
після push). Перевірка:

```bash
curl -s "https://api.github.com/repos/vadymlevyt/registry/actions/runs?per_page=1" \
  | python3 -c "import sys,json; r=json.load(sys.stdin)['workflow_runs'][0]; print(r['head_sha'][:7], r['status'], r['conclusion'])"
```

### Що працює (підтверджено адвокатом цієї сесії)

- **Брановський (65 стор., civil) DP нарізка:** 18/28 ≈ 65% точність, 02_ОБРОБЛЕНІ
  заповнена нормально (.txt + .layout.json без size overflow як було раніше).
- **Smart Drive кнопки** задеплоєні (`df38548`+`a9136c7`), адвокат бачить
  кнопку «Перестворити» у блоці «Сховище» (підтвердив після `df38548`).
- **CropperHost crash fix** задеплоєний (`b330e8b`), але адвокат ще не
  перевірив на планшеті.

### Що НЕ працює / не підтверджено

- **Нестеренко (273 стор., crim) DP нарізка:** на свіжому прогоні після
  всіх правок дало 1 документ замість 26+ (1.3%), 02_ОБРОБЛЕНІ порожня.
  Адвокат **не перевірив** після створення нової папки через
  «Перестворити» — може бути:
  - **Гіпотеза:** stale `storage.driveFolderId` → writeArtifact падав
    на 404 → swallowed catch → 02_ОБРОБЛЕНІ виглядала порожньою.
    Перестворити → нова жива папка → запис нормально → 02_ОБРОБЛЕНІ
    повинна заповнитись.
  - **Окрема проблема:** 1 vs 26 — це **недетермінованість AI Triage**
    на 273 стор. з тонким адаптивним дайджестом (>100 стор. → 3+2 рядки
    head/tail, 400+200 символів — Triage гадає без тіла документів).
    Це baseline-проблема Phase A, не вирішена цією сесією.
- **Race condition `findOrCreateFolder`** (два паралельні виклики на ту
  саму назву одночасно) — теоретична, NFC+trim фікс не покриває.

---

## Що залишається відкритим (для майбутніх сесій)

### Висока пріоритетність

**1. Нарізка великого тому (273 стор. Нестеренко) — структурна проблема Phase A.**

Корінь: адаптивна щільність паспорта `pageMarkers.js` для томів >100 стор.
дає скудний контекст (3+2 рядки head/tail, 400+200 символів). На коротких
юридичних документах (постанова 1-2 стор., вимога 1 стор., протокол 3-5 стор.)
Triage не бачить тіла → гадає → склеює сусідні або повертає 1 великий план.

Три можливі шляхи (НЕ повторювати ФД-серію — вона провалилася):

- **A) Прибрати/розширити адаптивну щільність** у `pageMarkers.js` для
  100-300 стор. 5-10 рядків змін. Низький ризик. Тест на реальному
  Нестеренку.
- **B) Повернути тільки D2 (table-coverage + ЯКІР) без T1/T2/D3.**
  Найменш ризикова частина revert'нутої серії. Сигнали меж які
  допомагають Triage. Без `tocDetector` що false-positive давав.
- **C) UI ручної корекції плану** — propose→confirm з кнопками
  «об'єднати з попереднім», «розділити тут». Більший TASK, не торкає
  core нарізки.

Рекомендація: спочатку перевірити чи фікс stale storage (smart кнопка
«Перестворити») вже вирішив 02_ОБРОБЛЕНІ. Потім адвокат вирішує A/B/C
для якості Triage.

**2. Перевірити CropperHost crash fix на планшеті.**

Repro той самий: модалка матеріалів → тапнути thumb → cropper popup →
обрізати → ✓ Готово → тапнути той самий thumb знову. До фіксу crash,
після — має нормально відкритись з cropped виглядом.

### Середня пріоритетність

**3. Race condition `findOrCreateFolder`.**

Якщо два паралельні виклики на ту саму назву одночасно — обидва find
повернуть null (на цей момент папки немає), обидва зроблять create →
два дублі. NFC+trim фікс це не покриває.

Рішення: lock per name (in-memory Map<name, Promise>) або транзакційна
обгортка. Не критично поки нема repro на проді.

**4. Source maps у production build.**

Зараз stack trace на проді мінфікований (`vre`, `ZA`, `Y8`). Якщо
наступний crash з'явиться — буде важко локалізувати без source maps.
Фікс: 1 рядок у `vite.config.js`: `build: { sourcemap: true }` (або
`'hidden'` щоб не публікувати .map файли поряд).

### Низька пріоритетність

**5. Tracking_debt оновлення.**

Додати свіжі знахідки після ФД revert:
- #24 race condition `findOrCreateFolder` (теоретичне)
- #25 недетермінованість AI Triage 1/35 на 273 стор. (структурна)
- #26 stale `storage.driveFolderId` після ручних змін на Drive
  (UX вирішено smart кнопкою, але можна додатково auto-detect і
  пропонувати notification)

Це чистий docs, без коду.

---

## Що НЕ робити

- **НЕ повторювати ФД-серію** (tocDetector + збагачений дайджест + новий
  промпт) як єдиний пакет. ФД-T1/T2 (tocDetector) дав регрес —
  false-positive на томах без реєстру. Перед повторною спробою — окрема
  діагностика того false-positive.
- **НЕ робити hard reset до `dd4569d`** — Phase A baseline. Це втратить
  Court Sync MVP і всі цієї сесії фікси. Безпечніше `git revert <hash>`
  окремих комітів.
- **НЕ використовувати hex кольори** у CaseDossier (тест
  `tests/integration/responsive.test.jsx` блокує). Тільки CSS variables
  (`var(--color-danger)`, `var(--color-success)`, etc.).
- **НЕ міняти `findOrCreateFolder`** на пошук через `q=name='...'` з кирилицею
  (CLAUDE.md правило #8 — кирилиця в q= ненадійна).
- **НЕ чіпати Court Sync файли** (`src/components/CourtSync/`, `src/services/ecits/*`)
  у цій сесії — паралельна сесія може там працювати.
- **НЕ робити `git push --force`** на main (CLAUDE.md правило безпеки git).
- **НЕ міняти `splitDocumentsV3.js` persist логіку** — вона ідентична
  baseline `dd4569d`, працює.

---

## Файли для старту в новій сесії

Read у такому порядку:

1. `/CLAUDE.md` — архітектура (обов'язково)
2. `/DEVELOPMENT_PHILOSOPHY.md` — філософія (обов'язково)
3. `/docs/consultations/handoff_2026-05-23_dp_v2_revert_session.md` — цей файл
4. `/ARCHITECTURE_HISTORY.md` — хронологія TASK'ів (для контексту)
5. `/tracking_debt.md` — відкриті борги

Для конкретних модулів:

- DP-pipeline: `/src/services/documentPipeline/`, `/src/services/ocrService.js`,
  `/src/services/documentBoundary/` (tocDetector.js видалений revert'ом)
- CaseDossier: `/src/components/CaseDossier/index.jsx` (рядки 444-520 — стан;
  532-580 — folder status useEffect; 2064-2120 — Сховище блок; 2641-2680 —
  chip Drive)
- ImageMergePanel: `/src/components/CaseDossier/ImageMergePanel.jsx`
  (PreviewPopup рядки 2051+; CropperHost рядки 2601+)
- Drive helpers: `/src/services/driveService.js` (findOrCreateFolder 35-69
  з NFC+trim; createCaseStructure 78-95)

---

## Швидкі команди для верифікації

```bash
# Поточний стан
git log --oneline -10
git status

# Перевірка що DP-pipeline ідентичний baseline 8c555c5
git diff 8c555c5..HEAD --stat -- src/services/documentPipeline/ \
  src/services/ocrService.js src/contexts/DocumentPipelineContext.jsx \
  src/services/documentBoundary/
# (має бути порожньо)

# Тести
npm test
# Очікувано: 1505+ passed

# Стан останнього deploy
curl -s "https://api.github.com/repos/vadymlevyt/registry/actions/runs?per_page=1" \
  | python3 -c "import sys,json; r=json.load(sys.stdin)['workflow_runs'][0]; print(r['head_sha'][:7], r['status'], r['conclusion'])"

# Safety tag
git tag | grep backup
# backup-pre-fd-revert
```

---

## Перше повідомлення адвокату у новій сесії

«Я прочитав CLAUDE.md + DEVELOPMENT_PHILOSOPHY + handoff від попередньої
сесії. Поточний HEAD `b330e8b`. ФД-серія revert'нута, Court Sync MVP
збережений, smart Drive кнопки і CropperHost crash fix задеплоєні.

Бачу два невирішених питання:

1. **Перевірити CropperHost crash fix на планшеті** — простий smoke
   test модалки матеріалів справи: відкрити thumb → обрізати → ✓ Готово →
   знов тапнути → має нормально відкритись без crash.

2. **Нарізка великого тому Нестеренка** — після фіксу stale storage
   через «Перестворити» треба новий прогон DP щоб довести: чи
   02_ОБРОБЛЕНІ заповниться, і скільки документів нарізало (1 vs 26).
   Якщо 02_ОБРОБЛЕНІ заповнена і знов 1 документ — структурна
   недетермінованість Triage, окремий TASK (шляхи A/B/C у handoff'у).

Що першим?»

---

**Кінець handoff.**
