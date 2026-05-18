# TASK — Smart Triage (DP v2 «кинь усе, DP сам розбереться»)

**Дата спеку:** 18.05.2026 · **Автор спеку:** Claude (сесія діагностики DP-4)
**Реалізація:** ОКРЕМА нова сесія. Цей файл — самодостатній handoff.
**Базова специфікація:** `docs/consultations/consultation_dp_triage_architecture.md`
**ревізія 1.1** (у `main`). Цей TASK = операційний план її реалізації; при
розбіжності перемагає здоровий глузд + інституційні обмеження нижче, не
буква консультації.

**Передумова (стан `main` на старті реалізації):**
- Крок 1 (revert-partial DP-4 BUGFIX) **зроблено** — commit `4c9937f` у `main`:
  Provider більше не форсує `shouldReconstruct: >=1`; стадія на дефолті `>1`.
- Тести 1252/1252 зелені. DP зараз single-file НЕ нарізає (passthrough) —
  це навмисно; коректну нарізку повертає САМЕ цей TASK.

**Зафіксовані рішення адвоката (не переобговорювати):**
1. Цільова архітектура — **Варіант 1 Smart Triage** (consultation §6).
2. `fragment_reconstruct` (один документ у кількох PDF) — норма
   **«AI пропонує, адвокат підтверджує»** (не повний автомат). ОК.
3. **Вартісна модель обов'язкова** (consultation §4 рев.1.1): text-first зі
   структури Document AI + Haiku; vision — лише вузький fallback.
4. propose→confirm UI у Зоні 3: адвокат **бачить план обробки, виправляє
   нарізку/склейку/обрізку, потім приймає**.

---

## 1. Місія (що означає «готово»)

Адвокат кидає в DP **будь-який набір** (фото з телефону / великий скан-PDF /
ZIP з суду / кілька PDF-фрагментів одного документа / .p7s — разом або по
черзі), **один вхід, без режимів і кнопок**. DP сам дивиться у вміст,
показує адвокату **план обробки** (що з кожним зробить), адвокат за потреби
править, приймає — на виході `01_ОРИГІНАЛИ/`: **один PDF = один логічний
документ**; службове (.p7s/обкладинки) окремо. Реальний приймальний кейс —
справа Брановського: один 65-стор. скан-PDF з кількома документами →
коректно нарізаний.

---

## 2. ІНСТИТУЦІЙНІ ОБМЕЖЕННЯ — ЧИТАТИ ПЕРШИМИ (тут ламались попередні TASK)

Це не стиль — це причини зломів DP-3/DP-4 на реальних справах. Порушення
будь-якого = TASK провалений навіть із зеленими тестами.

1. **Provider→executor→стадія мусить бути покритий тестом із РЕАЛЬНИМИ
   ін'єктованими deps.** Корінь зламу DP-4: стадії були зелені ізольовано
   (власні stageDeps у тесті), а Provider реально НЕ ін'єктував `detectSingle`
   → ланцюг тихо падав у passthrough, жоден тест не ловив. **Кожен новий
   маршрут МУСИТЬ мати інтеграційний тест, що ганяє справжній
   `DocumentPipelineProvider`-injected stageOverride через executor, не лише
   стадію в ізоляції.** Це головна нова тест-вимога TASK.
2. **`fetch` без timeout = вічне зависання всього pipeline.**
   `src/services/toolUseRunner.js:352` — `await fetch(apiUrl,…)` у retry-циклі
   без `AbortController`. Обов'язково додати timeout-signal; `AbortError`
   має падати у вже наявний `catch (networkErr)` (транзитивний → retry).
3. **Жодних жорстких count-гейтів** (`files>1`/`>=1`) як логіки маршруту.
   Маршрут вирішує AI Triage. Детермінована сітка — ЛИШЕ для абсолютно
   однозначних дешевих випадків (.p7s, ZIP-розпак, явний 1-стор. фото),
   **невидима пре-фільтрація, не «режим», не кнопка**.
4. **Диригент заморожений.** `src/services/documentPipeline.js`: `STAGE`
   (Object.freeze, 9 стадій) і `DEFAULT_STAGE_ORDER` (Object.freeze):
   `intake→convert→detectBoundaries→classify→extract→proposeMetadata→
   confirm→persist→emit`. **НЕ додавати стадій, НЕ міняти порядок.**
   Розширення ТІЛЬКИ через `deps.stageOverrides[ім'я]` (OCP). Triage лягає
   у override `detectBoundaries`; презентація плану — у наявну
   `proposeMetadata`; гейт — у наявну `confirm`; диспетч виконання — у
   override `persist`.
5. **Без зміни схеми.** `route` — транзитне поле плану в `ctx`
   (`reconstructionPlan.documents[i].route`), **НЕ** поле канонічної схеми
   документа. **НЕ** bump `schemaVersion`, **НЕ** міграція, **НЕ** бекап.
   Якщо здається що треба міграція — ти розширюєш не те.
6. **Один сенс на поле/прапор (CLAUDE.md #11).** `route` — тільки «що
   зробити з артефактом у цьому job». `addedBy` (хто додав) і `source`
   (звідки файл, enum v7) — НЕ плутати, НЕ розширювати.
7. **Створення документа — лише `documentFactory.createDocument()`**;
   модифікації даних — лише через `executeAction` (async, await якщо
   читаєш `.success`). Конвертація — лише `converterService.convertToPdf`.
8. **CLAUDE.md тверді правила:** #4 кожна async-гілка у try/catch (blank
   page = непійманий JS); #5 україномовний текст у подвійних лапках/
   шаблонах (апостроф ламає рядок в одинарних); #2 якщо UI має textarea —
   фіксована `height:120px`.
9. **Без емодзі в UI/коді.** Тільки наявні design-токени.

---

## 3. Цільова архітектура (стисло — деталі в consultation §4 рев.1.1)

Не дублюю консультацію. Суть мапінгу на ЗАМОРОЖЕНИЙ диригент:

```
кинули все
→ INTAKE (override unpack — ВЖЕ Є: ZIP розпак, .p7s→ctx.signatures[], sidecar)
→ CONVERT (ВЖЕ Є: не-PDF→PDF; зображення→1-стор.PDF з міткою "image")
→ [streaming chunk-OCR — ВЖЕ Є: дає text + pageStructure/.layout.json]
→ DETECT_BOUNDARIES (override = ★ SMART TRIAGE — НОВЕ ЯДРО):
     будує per-артефакт структурний паспорт (text-first, §6),
     AI повертає ЄДИНИЙ план; кожен documents[i] має .route
→ CLASSIFY (ВЖЕ Є) → EXTRACT (ВЖЕ Є)
→ PROPOSE_METADATA (override — рендер-контракт плану для UI, §7)
→ CONFIRM (ВЖЕ Є: autoConfirm:false → план proposed, split не ріже,
     доки адвокат не підтвердив; §7)
→ PERSIST (override splitDocumentsV3 — ДИСПЕТЧ за .route, §5)
→ EMIT (ВЖЕ Є)
```

Формат плану (наявний, розширюємо `.route`):
`{documents:[{documentId,name,type,route,fragments:[{fileId,startPage,
endPage}],open,...}], unusedPages:[{fileId?,startPage,endPage,reason}],
confirmed,confirmedAt}`.

---

## 4. ~85% будівельних блоків ІСНУЄ — переюз, не переписування

(Повний інвентар із шляхами — consultation §2.) Ключове: `unpack.js`,
`converterService`, `documentBoundary/detectBoundaries`+`prompt.js`
(single-PDF нарізка — промпт-снапшот, НЕ дрейфувати без рішення),
`multiFileReconstructor` (фрагменти), `sortation/*`
(imageSortingAgent+orientationCorrector+cropHelper+edgeDetection+
imageRenderer) + `CaseDossier/ImageMergePanel.jsx` (UI правки фото —
переюзати для review image-маршруту, не винаходити), `streamingExecutor`,
`classifyV2`, `extractV3`, `confirmBoundaries`, `splitDocumentsV3`,
`jobState.js` (resume-інфра), диригент.

---

## 5. Маршрути плану + виконавці (всі вже існують) + сітка безпеки

| route | Що означає | Виконавець у PERSIST-диспетчі |
|---|---|---|
| `add_as_is` | готовий single-doc PDF (типово е-суд) | passthrough → upload 01_ОРИГІНАЛИ |
| `slice` | один PDF з багатьма документами | `documentBoundary.detectBoundaries` — **text-first паспорт** (§6) |
| `image_merge` | група фото = сторінки 1 документа | `imageSortingAgent`+`orientationCorrector`+`cropHelper`+`imageRenderer` |
| `fragment_reconstruct` | 1 документ у кількох PDF | `reconstructAcrossFiles` (openTails) — **завжди propose+confirm** (рішення №2) |
| `signature_sidecar` | .p7s/.sig | **ВЖЕ зроблено** в `unpack` (`ctx.signatures[]`) |
| `to_fragments` | обкладинка/штамп/порожнє | → `03_ФРАГМЕНТИ` (вже є в splitDocumentsV3) |
| `discard` | сміття | відкинути + `decision` |

**Детермінована сітка безпеки (невидима, БЕЗ AI, для однозначного):**
.p7s/.sig → `signature_sidecar`; ZIP → unpack (вже); рівно 1 файл-image
1 сторінка без сусідів → `image_merge` тривіальний (1 фото = 1 PDF). Усе
решта — рішення AI Triage. Сітка економить токени і додає робастності;
вона НЕ замінює Triage і НЕ є «режимом».

---

## 6. Вартісна модель — ОБОВ'ЯЗКОВА (рішення №3, consultation §4 рев.1.1)

**Факт коду:** `ocr/documentAi.js:209-211` повертає `pageStructure` = весь
оригінальний об'єкт сторінки Document AI (paragraphs, blocks з bbox,
`layout.orientation`, `dimension`, tables, formFields, мови, якість).
`ocrService.js:139` `STRIPPED_LAYOUT_FIELDS=['image','tokens']` — при
серіалізації в `.layout.json` викидаються **рівно ці 2**; **уся структурна
метадані персистується** (доступна і на resume).

`image` (per-page PNG) = саме те, за що платиться Claude Vision. Document AI
**уже** зробив візуальну роботу на боці Google і ми зберігаємо результат.

**Вимога реалізації:**
- Triage і `slice` отримують **per-page структурний паспорт** зібраний зі
  збереженого `pageStructure`/`.layout.json`: текст сторінки + дайджест
  геометрії першого/останнього блоку (короткий центрований заголовок?
  футер з номером?) + `orientation` + `dimension` + прапори tables/
  formFields + детект скидання нумерації. **З явними маркерами сторінок**
  (`=== СТОРІНКА N ===`) — замінює наявний `slice(0,50000)` без сторінок.
- Передавати Клоду **як `text`-блок**. Image-блок (Document Block / фото) —
  **лише вузький fallback** на сторінки де Document AI повернув ~нуль і
  тексту, і структури (справжнє фото/чистий скан без шару).
- Triage/slice — на **Haiku** (структурна задача): звірити/виставити
  `resolveModel('documentProcessor')`; якщо тягне Sonnet — узгодити ключ/
  agentType так щоб ці виклики йшли Haiku. Це важіль «б»/«в» consultation §6.

Очікуваний ефект: на текстовому PDF е-суду зникає ~1.5-2К image-токенів/
стор. (типово 5-15× дешевше) + Haiku ~1/3 ціни Sonnet.

---

## 7. propose→confirm UI у Зоні 3 (рішення №4) — контракт

**Механізм уже є:** `createConfirmBoundaries({autoConfirm:false})` лишає
план `proposed` (confirmed:false) — `splitDocumentsV3` нічого не ріже доки
не `confirmed:true`. TASK: прогнати реальний цикл «показати → правити →
прийняти», не вигадувати новий гейт.

**Хост:** `src/components/DocumentProcessorV2/index.jsx` Зона 3 (вже
споживає `result.documents/decisions/errors/unusedPages`). Переюзати
наявні: `ImageMergePanel.jsx` (порядок/поворот/обрізка фото),
`ProgressFullScreen` (Зона 4). Не плодити нові повноекранні модалки
(баг DP-4 — дублювання Topbar/FullScreen; тримати один контролюючий стан).

**Що адвокат БАЧИТЬ (на документ плану):** ім'я, `route`, тип, джерело
(які файли/сторінки → `fragments`), для `slice` — межі (startPage/endPage
кожного виділеного документа), для `image_merge` — порядок+поворот+
кроп-прев'ю, `unusedPages` з причиною, службове (.p7s) — окремим списком
«не документи».

**Що адвокат МОЖЕ ПРАВИТИ перед «Прийняти»:**
- межі нарізки (`slice`): зсунути start/end, розбити/злити сусідні
  документи плану;
- `image_merge`: переупорядкувати, докрутити поворот, поправити кроп
  (через ImageMergePanel);
- маршрут: перепризначити документ (напр. `slice`→`add_as_is`, або
  виділене → `to_fragments`/`discard`);
- редагувати `name`/`type`.

**«Прийняти»** → план стає `confirmed:true` → PERSIST виконує маршрути.
**До** «Прийняти» — нічого на Drive у 01_ОРИГІНАЛИ (ідемпотентність:
повторний showtime не плодить дублів — використати наявний дедуп
splitDocumentsV3 exact/variant).

`fragment_reconstruct` — **завжди** через цей цикл (рішення №2): план
показується, адвокат підтверджує зведення фрагментів перед склейкою.

---

## 8. Супутні фікси (входять у TASK, не окремо)

1. **fetch timeout** — `toolUseRunner.js:352`: `AbortController` +
   розумний timeout; abort → наявний `catch(networkErr)` → retry. Без
   цього будь-який AI-виклик вішає весь job (корінь зависання DP-4).
2. **Resume у UI** — інфра є (`jobState.js`: `job_state.json` у `_temp`,
   `createJobStateStore`, crash-safe). Бракує: `DocumentPipelineProvider`
   при mount сканує Drive на незавершені job_state і пропонує
   «Продовжити обробку?» (не авто-стартувати мовчки).
3. **Маркери сторінок** — частина §6 (паспорт із `=== СТОРІНКА N ===`),
   прибирає безсторінковий `slice(0,50000)`.

---

## 9. Фази (кожна самодостатня; STOP-точки явні)

Реалізатор може зупинятись на межі фази (зелені тести, осмислений стан).

- **Ф0 — Білдер структурного паспорта** (чиста функція зі
  `pageStructure`/`.layout.json` → per-page паспорт із маркерами). Юніт-
  тести. Розблоковує і Triage, і дешевий slice. *STOP-точка.*
- **Ф1 — Супутні фікси** (fetch timeout + маркери в наявний slice-промпт).
  Малий, негайна цінність (single-PDF slice стає дешевим і не вішається),
  незалежний від Triage. *STOP-точка.*
- **Ф2 — Smart Triage ядро** (override `detectBoundaries`: паспорт →
  AI-план з `.route`; Haiku; детермінована сітка). Стадія + Provider-
  інтеграційний тест (обмеження №1). *STOP-точка.*
- **Ф3 — PERSIST-диспетч** (override `persist`: маршрутизація
  add_as_is/slice/image_merge/fragment_reconstruct/to_fragments/discard на
  наявні виконавці). Інтеграційні тести сценаріїв A–D. *STOP-точка.*
- **Ф4 — propose→confirm UI Зона 3** (рендер плану, правки, «Прийняти» →
  confirmed; resume у UI). Складний мікс end-to-end (наскільки можливо без
  живого Drive/AI — простежити код-шлях + юніти, як робив DP-4).
- **Ф5 — Звіт** `docs/reports/report_task_smart_triage.md` + оновити
  `ARCHITECTURE_HISTORY.md`, за потреби `LESSONS.md` / `tracking_debt.md`.

Рекомендований порядок Ф1→Ф0→Ф2→Ф3→Ф4 (Ф1 дає негайну користь і знімає
зависання навіть якщо TASK потім призупинять).

---

## 10. Тестування (gate деплою)

- **НОВА ГОЛОВНА ВИМОГА (обмеження №1):** для КОЖНОГО маршруту —
  інтеграційний тест через справжній `DocumentPipelineProvider`-injected
  stageOverride + executor, не лише стадія ізольовано. Саме брак цього
  пропустив злам DP-4.
- Юніти: білдер паспорта; Triage-парсинг плану/route; детермінована сітка;
  fetch-timeout (abort→retry); resume-scan.
- Інтеграційні: A (фото→1 PDF), B (великий PDF→N), C/D (ZIP міксти),
  складний мікс (всі маршрути за 1 прохід), propose→confirm (proposed не
  ріже; після confirmed — ріже; правки застосовуються).
- `npm test` повністю зелений ДО коміту. CI `test→build→deploy` блокує
  деплой на red. Снапшот `documentBoundary/prompt.js` не дрейфувати без
  свідомого рішення.

---

## 11. SAAS IMPLICATIONS (CLAUDE.md #10)

- Жодної нової сутності з власним станом → `tenantId` не додається;
  `route`/план — транзитні в `ctx`, не персистяться у схему, не
  tenant-scoped.
- Якщо Triage оформлюється окремою agent-роллю в `PERMISSIONS` — лише
  allowlist наявних дій (read/аналіз + існуючі ACTIONS персисту через
  splitDocumentsV3). НЕ активувати `metadata_extractor_agent` (порожній
  allowlist — лишається disabled). НЕ додавати UI керування ролями.
- Resume/job_state per-case, успадковує tenant справи; не вводити
  крос-tenant видимість job.

## 12. BILLING IMPLICATIONS (CLAUDE.md #10)

- Triage AI-виклик = новий інструментований виклик: `logAiUsageViaSink`
  (`ai_usage[]`, токени, для оператора SaaS) + `activityTracker.report
  ('agent_call', {module:DOCUMENT_PROCESSOR, operation:'triage'})`
  (`time_entries[]`, час адвоката) — за патерном наявного
  `analyzeViaToolUse` (document_parser). **НЕ дублювати поля** між
  `ai_usage[]` і `time_entries[]`.
- Вартісна модель §6 — пряма білінг-оптимізація (Haiku + нуль image-
  токенів): очікувано різке падіння `estimatedCostUSD` на job. Зафіксувати
  baseline у звіті Ф5.
- Усі телеметрія-виклики у try/catch (не валити job через білінг).

---

## 13. ПОЗА ОБСЯГОМ — НЕ РОБИТИ (проти over-engineering)

- НЕ bump schemaVersion, НЕ міграція, НЕ бекап (route — транзит).
- НЕ нова стадія диригента, НЕ зміна `DEFAULT_STAGE_ORDER`.
- НЕ Document Block per-page як основний шлях (тільки вузький vision-
  fallback на сторінки без структури).
- НЕ відроджувати TASK B (склейка фото) поза переюзом наявних `sortation/*`.
- НЕ нові «режими»/кнопки/перемикачі; НЕ UI ролей/білінгу; НЕ
  `metadata_extractor_agent`.
- НЕ чіпати `case.timeLog[]`, `case.team[]` семантику, `addedBy`/`source`
  enum.
- НЕ дрейф `prompt.js` снапшота без явного рішення в цьому TASK.
- НЕ генерувати зайві audit/diagnostic .md «для процесу» — лише звіт Ф5 +
  оновлення живих довідників. (Урок: попередні TASK плодили доковий шум.)

---

## 14. Acceptance criteria (бінарний чек-лист)

- [ ] Один вхід DP приймає будь-який мікс; адвокат не обирає режим.
- [ ] Справа Брановського (1×65-стор. скан-PDF) → коректно нарізана на
      логічні документи у 01_ОРИГІНАЛИ, в'юер без 404.
- [ ] Сценарії A–D + складний мікс проходять одним шляхом (тести).
- [ ] propose→confirm: до «Прийняти» — нічого в 01_ОРИГІНАЛИ; правки
      нарізки/склейки/обрізки застосовуються; після — ріже за планом.
- [ ] `fragment_reconstruct` завжди через propose+confirm.
- [ ] Вартісна модель: Triage/slice text-first зі структури + Haiku;
      image-блок лише на сторінки без шару (перевірити в тесті/звіті).
- [ ] fetch має timeout; abort → retry; job не вішається.
- [ ] Resume: Provider при mount пропонує продовжити незавершений job.
- [ ] Кожен маршрут має Provider-integration тест (обмеження №1).
- [ ] `npm test` повністю зелений; диригент/схема не змінені.
- [ ] Звіт Ф5 + ARCHITECTURE_HISTORY.md оновлені.

---

## 15. HANDOFF — старт нової сесії

**Прочитати в порядку:** CLAUDE.md → DEVELOPMENT_PHILOSOPHY.md →
`docs/consultations/consultation_dp_triage_architecture.md` (рев.1.1, ПОВНА
архітектура+вартісна модель) → цей файл (§2 обмеження — критично) →
`docs/diagnostics/diagnostic_dp4_root_cause.md` +
`docs/diagnostics/diagnostic_dp4_bugfix.md` (як саме ламалось).

**Карта коду (де що живе):**
- Диригент/STAGE/порядок: `src/services/documentPipeline.js`
- Stage-overrides Provider ін'єктує: `src/contexts/DocumentPipelineContext.jsx`
- Стадії: `src/services/documentPipeline/stages/*` (detectBoundariesV3,
  confirmBoundaries, splitDocumentsV3, classifyV2, extractV3, unpack)
- Single-PDF нарізка: `src/services/documentBoundary/*` (detectBoundaries,
  analyzeViaToolUse, prompt.js, multiFileReconstructor)
- OCR/структура: `src/services/ocr/documentAi.js` (:209-211),
  `src/services/ocrService.js` (:139 STRIPPED_LAYOUT_FIELDS)
- Фото: `src/services/sortation/*`, `src/components/CaseDossier/ImageMergePanel.jsx`
- Resume: `src/services/documentPipeline/jobState.js`
- AI-транспорт/timeout: `src/services/toolUseRunner.js` (:352 fetch)
- UI Зона 3: `src/components/DocumentProcessorV2/index.jsx` (Зона 3 ~:247+)
- Конвертація: `src/services/converter/converterService.js`
- Документ-фабрика: `src/services/documentFactory.js` (createDocument)

**Git:** працювати на гілці `claude/*` (harness видасть). Коміти на гілці.
Зведення коду адвокату ПЕРЕД будь-яким FF у `main` (push у main тригерить
CI+деплой Pages) — тільки FF, тільки при зелених тестах, тільки після
короткого підтвердження адвоката (CLAUDE.md правило №1).

**Команди:** білд `npm run build`; тести `npm test` (повний),
`npm run test:watch` (розробка).

**Реальний end-to-end** на живому Drive/AI у пісочниці недоступний (як у
DP-4) — прийнятно простежити код-шлях + покрити юнітами/інтеграційними з
моками; це явно зазначити у звіті Ф5.

---

**Кінець TASK_smart_triage.md.** Реалізація — окрема сесія за цим файлом.
