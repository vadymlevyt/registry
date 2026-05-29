# TASK 1 — image_merge_unify (Перший фронт, Фаза 1)

**Дата:** 2026-05-29
**Тип:** широкий фронт — продуктова функція DP + винос у спільне + закриття хаосу (три осі одночасно)
**Гілка розробки:** окрема `claude/*` гілка сесії-виконавця (harness видасть)
**Базові документи:**
- `docs/consultations/consultation_combined_roadmap_dp_and_refactoring.md` v3 — §2 Фаза 1, TASK_1
- `docs/consultations/consultation_dp_product_vision.md` — §4.1 (Cheap before Expensive, Toggle, три ітерації)
- `docs/consultations/dp_reuse_and_canonical_patterns_discussion.md` — Rule of Three, спільне місце
- `docs/diagnostics/diagnostic_dpv2_call_trace_and_chaos.md` — C2, C7
**schemaVersion:** без bump (немає зміни структури registry_data.json)
**Орієнтовний час:** 3-5 днів. Найбільший TASK першого фронту. Розбито на три під-TASK'и.

---

## МЕТА — навіщо це все (читати першим)

Адвокат фотографує матеріали телефоном: 10 фото = насправді 3 документи (паспорт
4 фото + договір 5 фото + квитанція 1 фото). Зараз у Document Processor він може
закинути ці фото, але DP або зіб'є все в один том (через AI Triage), або обробить
непередбачувано. **Інтерактивної склейки N документів у DP немає** — вона є тільки
в окремій модалці `ImageMergePanel`, і та вміє лише **один документ за раз**.

Цей TASK дає адвокату в DP повний сценарій з **Ітерації 1** продуктової візії для
image-merge: **закинув фото → AI пропонує групи → адвокат править (перетягує фото
між групами, обертає, обрізає, прибирає дублі) → «Виконати» → N окремих PDF у
справі**. Це перший сценарій, який доходить до повноти «адвокат-диригент» з §4
візії — бо для image-merge правка плану реалістична вже зараз (на відміну від
нарізки великих томів, де правка плану — Фаза 5).

Робимо це **трьома осями одночасно** (стратегія «широким фронтом»), не трьома
окремими роботами:

```
ВІСЬ A — ПРОДУКТОВА      ВІСЬ B — ХАОС            ВІСЬ C — РЕФАКТОРИНГ
N-документна склейка     deterministicRoute       винос reusable у спільне
фото в DP + Toggle       (skip Triage для фото),  components/ImageEditor/ +
«Просто додати файли»     C7 (логування AI),       services/imageDocument/
+ .txt для text-PDF      C2 (винос клієнтів)      (Rule of Three: DP — третій)
```

Кожен під-TASK нижче зачіпає кілька осей. Жоден не «cleanup без видимої користі» і
жоден не «функція поверх хаосу».

---

## PHILOSOPHY CHECK

Сім принципів. Релевантні:
- **AI-first / дублювання інтерфейсів** — групування фото доступне через UI (Зона 3
  DP) і закладається точка для агента (DOC_PROCESSOR_TOOLS — майбутнє, не зараз).
  Адвокат бачить план до виконання і править його — людина-диригент (§4 візії).
- **Cheap before Expensive** — маршрутизація «всі файли — фото → image_merge»
  детермінована (MIME-перевірка, нуль токенів). AI (Haiku) підключається ВСЕРЕДИНІ
  сценарію для групування і сортування, не НАД ним.
- **Здоровий організм / Rule of Three** — reusable частини виносяться у спільне
  місце саме тепер, коли зʼявився третій реальний споживач (DP). Не превентивно.
- **Додавати, не переписувати** — `ImageMergePanel` (модалка) лишається робочою;
  компоненти переїжджають у `ImageEditor/`, модалка оновлює лише імпорти.
- **Однозначність (#11)** — новий тумблер і нова стадія групування отримують одне
  ім'я = один сенс (див. SEMANTIC CLARITY CHECK).
- **Тести разом з кодом** — кожен під-TASK закінчується зеленим `npm test`.

---

## ЕКСПЕРТНА АВТОНОМІЯ

Ти бачиш реальний код напряму — рядки і сигнатури в цьому файлі звірені на момент
написання, але можуть зсунутися. **Не довіряй номерам рядків наосліп — перечитай
файл перед зміною.**

Де можна вирішувати самостійно (і фіксувати у звіті):
- Точні імена внутрішніх функцій/файлів, структура CSS, дрібні UI-рішення.
- Розбиття великих компонентів на менші всередині `ImageEditor/` якщо так чистіше.
- Чи робити grouping-агента окремим файлом vs розширення `imageSortingAgent.js`
  (рекомендація — окремий файл, бо інша відповідальність — див. #11).

Де **НЕ можна** самостійно — узгодь питанням до адвоката ПЕРЕД реалізацією:
- Зміна публічного контракту `ImageMergePanel` (props/onSubmit) — модалка має лишитись
  behavior-preserving.
- Будь-яка зміна схеми документа / registry_data.json / ACTIONS-контракту.
- Зміна дефолтів існуючих тумблерів Зони 2.

Знахідки «по дорозі» (баги, борг) — НЕ виправляти в цьому TASK, занести у
`docs/bugs/bugs_found_during_image_merge_unify.md` і `tracking_debt.md`.

---

## SEMANTIC CLARITY CHECK (#11)

Дві нові сутності-імені — кожна одне речення про єдиний сенс, на місці оголошення:

**Тумблер `skipPdfSlicing`** (Зона 2, ключ у `settings`):
> `skipPdfSlicing` — пропустити AI-нарізку (Triage) для PDF: кожен PDF стає одним
> документом (route `add_as_is`). НЕ вимикає OCR, .txt, метадані, класифікацію.

UI-лейбл — «Просто додати файли» (мова адвоката), технічний ключ — `skipPdfSlicing`
(мова коду). Не називати `justAddFiles` / `simpleMode` — вони не кажуть ЩО саме
пропускається. Default `false` (Triage перевіряє всі PDF — поточна поведінка).

**Стадія/агент `imageDocumentGrouper`** (групування фото у N документів):
> `imageDocumentGrouper` — AI-агент (Haiku), що з масиву розпізнаних фото повертає
> групи `[{pages:[...], type}]` — пропозицію які фото складають окремий документ.
> Відповідає ТІЛЬКИ за межі між документами. Порядок сторінок усередині — інша
> відповідальність (`imageSortingAgent`), дублі — інша (`imageSortingAgent` dedup).

Не нашаровувати групування на `imageSortingAgent` (той сортує/дедупить В МЕЖАХ
одного документа — інший намір). Нове ім'я, не розширення.

**Маршрут `image_merge`** — НЕ розширюється новим сенсом. Він уже означає «зібрати
фото у PDF». Multi-document — це N документів кожен з route `image_merge`, не новий
route. Plan просто містить N документів замість одного.

---

## ПОТОЧНИЙ СТАН (звірено з кодом)

| Що | Файл:рядок | Стан |
|---|---|---|
| Тривіальний image-route | `triageStage.js:59-77` | лише **1 фото / 1 стор.** → image_merge без AI. N фото → AI Triage |
| image_merge виконання | `splitDocumentsV3.js:253-282` | `mergeImagesToPdf({images,docName})` per документ |
| merge implementation | `DocumentPipelineContext.jsx:208-211` | lazy `renderImageMergeToPdf` (worker) |
| DP UI | `DocumentProcessorV2/index.jsx` | 3 зони, **немає** image-merge editing, **немає** toggle skipPdfSlicing |
| DP тумблери | `index.jsx:30-39` | 8 тумблерів, жодного skipPdfSlicing |
| .txt для text-PDF | `splitDocumentsV3.js` (writeProcessedArtifacts) | пишеться лише коли є `layoutJson.pages` (OCR-скан). text-layer PDF — **НЕ пишеться** |
| ImageMergePanel | `ImageMergePanel/index.jsx` (forwardRef) | модель «1 батч = 1 документ»; onSubmit → `add_document` single (`CaseDossier/index.jsx:2954`) |
| pdfRebuild | `ImageMergePanel/pdfRebuild.js` | **чиста** функція `rebuildFromOcrResults({...})`, готова до reuse |
| reusable компоненти | `ImageMergePanel/{PreviewPopup,CropperHost,Thumbnail,grid/,geometry}.js` | живуть у папці модалки |
| спільні папки | `components/ImageEditor/`, `services/imageDocument/` | **НЕ існують** |
| AI usage логування | `imageSortingAgent` Sonnet-виклик | метриться лише агреговано через `convertImagesToPdf`→`images_merged`; окремо grouping/sort не логуються (діра C7) |
| PERMISSIONS | `actionsRegistry.js:1628-1633` | `document_processor_agent`: add_documents, update_processing_context, update_document_source, batch_update |

**Baseline тестів (2026-05-28):** `118 files / 1581 tests passed`.

---

## ПІД-TASK 1A — Винос reusable у спільне місце (ВІСЬ C + B/C2)

**Behavior-preserving для модалки.** Жодної зміни UI/логіки/контракту `ImageMergePanel`.

### Що зробити

1. Створити `src/components/ImageEditor/` і перенести з `ImageMergePanel/`:
   - `PreviewPopup.jsx`, `CropperHost.jsx` (зберегти named export), `Thumbnail.jsx`,
     `ContextMenu.jsx`, `geometry.js`, `grid/{SortableGrid,DndGrid,SortableItem}.jsx`.
   - Спільні константи → `ImageEditor/constants.js`: `MAX_IMAGES_WARN`, `PHASES`,
     `isImageFile`. **`CATEGORY_OPTIONS`/`AUTHOR_OPTIONS`** — їх канонічний дім —
     `schemas/documentSchema.js`, але **в цьому TASK НЕ чіпати** (інакше scope creep
     і ризик на класифікацію в кількох місцях): лишити в `ImageEditor/constants.js`,
     **занести борг** у `tracking_debt.md` («CATEGORY_OPTIONS/AUTHOR_OPTIONS → consolidate
     into documentSchema.js; trigger: окремий backfill TASK класифікації»).
2. Створити `src/services/imageDocument/` і перенести:
   - `pdfRebuild.js` (чиста функція — ідеальна для сервісного шару).
   - Якщо `geometry.js` використовується pdfRebuild як логіка (не React) — лишити
     копію геометрії там де споживається; рекомендація: `geometry` — це чиста
     математика → доречніше `services/imageDocument/geometry.js`, а `ImageEditor`
     імпортує звідти. Вирішити за фактичними залежностями (експертна автономія).
3. `ImageMergePanel/index.jsx` і `PreviewView.jsx` — оновити імпорти на спільне
   місце (`../../ImageEditor/...`, `../../../services/imageDocument/...`). Залишити в
   `ImageMergePanel/` лише специфічне для модалки (оркестрація «1 документ»).
4. Оновити шляхи в тестах: `tests/unit/cropperHost.test.jsx`,
   `tests/unit/ImageMergePanel.test.jsx`, `tests/unit/imageMergeRenderer.test.js`,
   `tests/integration/multiImageToPdf.test.js` — лише шляхи імпортів, не логіку.

### Принцип розташування (з dp_reuse §Частина 2)
Брати-рівноправні споживачі (`ImageMergePanel`, DP) тягнуть з **третього місця**
(services + ImageEditor). DP **НЕ** імпортує з нутрощів модалки — це залежність вбік
(coupling), заборонена. Код живе там де **сенс**, не де зручно поточному viewer'у.

### Acceptance 1A
- [ ] `components/ImageEditor/` і `services/imageDocument/` створені, файли перенесені
- [ ] `ImageMergePanel` модалка працює ідентично (адвокат не бачить різниці)
- [ ] DP **ще не** використовує ImageEditor (це 1B) — але імпорт-шлях готовий
- [ ] `CropperHost` лишається named export; тести на нього оновлено на новий шлях
- [ ] `npm test` = 1581 passed (без зміни числа — лише шляхи)
- [ ] `npm run build` success
- [ ] борг CATEGORY/AUTHOR_OPTIONS занесено в `tracking_debt.md`

---

## ПІД-TASK 1B — N-документна склейка фото в DP (ВІСЬ A — головна функція)

Це **серце TASK'у**. DP отримує інтерактивний image-merge: AI пропонує групи →
адвокат править → виконує → N PDF.

### Новий сервіс — `imageDocumentGrouper`
- Файл: `src/services/sortation/imageDocumentGrouper.js` (поряд з `imageSortingAgent`).
- Вхід: масив розпізнаних фото (ocrResults + thumbnails/мета).
- Вихід: `{ groups: [{ documentId, pages: [imgIndex...], type, suggestedName }], warnings }`.
- Модель: **Haiku** через `resolveModel('imageDocumentGrouper')` — додати agentType у
  `modelResolver.SYSTEM_DEFAULTS` (за §4.1 візії: групування фото → Haiku).
- **AI usage логування обовʼязкове** (закриває C7 для нового агента):
  `logAiUsageViaSink({...})` + `activityTracker.report('agent_call', {...})` з
  context `{caseId, module:'document_processor', operation:'image_document_grouping'}`.
- Тільки межі між документами. Порядок усередині й дублі — `imageSortingAgent`
  (не дублювати відповідальність, #11).

### Маршрут виконання — пауза для правки плану
Поточний DP має `autoConfirm:true` (`index.jsx:196`) — план виконується одразу.
Для image-merge потрібна **пауза**: pipeline доходить до пропозиції груп і **чекає**
підтвердження адвоката, тоді виконує.

Рекомендований підхід (узгодити при реалізації):
- Не переписувати весь pipeline на async-confirm (це Фаза 5 для нарізки). Для
  image-merge зробити **окремий під-флоу в DP UI**: коли `deterministicRoute`
  визначив «всі файли — фото» (1C), DP сам викликає grouping + рендер прев'ю у Зоні 3,
  а PERSIST через `executeAction('add_documents', ...)` виконується **тільки після
  кнопки «Виконати»**. Тобто image-merge editing живе на рівні DP-компонента
  (reuse ImageEditor), а не всередині лінійного диригента.
- Це лягає в §6.1 візії «розділити propose і execute», але **локально для image-merge**,
  без переробки CONFIRM-стадії для нарізки (та лишається Фаза 5).

### DP UI (Зона 3, reuse ImageEditor з 1A)
- N груп = N візуально розділених `SortableGrid` (по одному на документ).
- `Thumbnail` для кожного фото (HEIC-aware, badges повороту/дублю/crop).
- Перетягування фото **між** групами (стан `Map<imgIndex,{docId,...}>` — нова
  орекстрація «1 батч = N документів», адаптація моделей `userRotation`/`cropOverrides`
  з ImageMergePanel).
- Тап по фото → `PreviewPopup` (crop/rotate/випрямлення) — reuse.
- Кнопки: додати/видалити групу, перейменувати документ, тип (CATEGORY_OPTIONS).
- «Виконати» → для кожної групи `rebuildFromOcrResults` (services/imageDocument) з
  власним `orderedIndices` → PDF → `createDocument` → `add_documents`.

### Створення документів
- Через існуючий шлях: `createDocument()` (documentFactory) + `executeAction(
  'document_processor_agent', 'add_documents', {caseId, documents})`. PERMISSIONS уже
  дозволяють (`actionsRegistry.js:1629`). `addedBy:'user'`, `source:'manual'`.
- `.txt`/layout у 02_ОБРОБЛЕНІ — як у поточному image_merge route.

### Acceptance 1B
- [ ] `imageDocumentGrouper.js` створено, повертає групи, **логує AI usage** (C7)
- [ ] `resolveModel('imageDocumentGrouper')` → Haiku, agentType у SYSTEM_DEFAULTS
- [ ] DP: закинув N фото → бачить N запропонованих груп у Зоні 3
- [ ] drag фото між групами, crop/rotate/dedup, rename, type — працюють (reuse ImageEditor)
- [ ] «Виконати» створює N окремих PDF у справі (через add_documents)
- [ ] PERSIST для image-merge відбувається ТІЛЬКИ після «Виконати» (не autoConfirm)
- [ ] нарізка PDF (інші маршрути) — поведінка НЕ змінена (autoConfirm лишається)
- [ ] нові тести: `tests/unit/imageDocumentGrouper.test.js` (групування + логування usage),
      DP N-doc flow інтеграційний тест
- [ ] `npm test` зелений (число зросте на нові тести), `npm run build` success

---

## ПІД-TASK 1C — deterministicRoute + Toggle + .txt для text-PDF (ВІСЬ A + B)

### 1C.1 — deterministicRoute «всі файли — фото → image_merge без Triage»
- Розширити логіку маршрутизації так, щоб коли **всі** живі файли — зображення
  (не лише 1), Triage-аналіз меж PDF **пропускався**, route одразу веде в image-merge
  сценарій (де далі працює `imageDocumentGrouper` — cheap-Haiku ВСЕРЕДИНІ, не дорогий
  PDF-Triage НАД).
- Поточний `trivialImagePlan` (`triageStage.js:59-77`) — кандидат на розширення на N
  файлів, АЛЕ: семантика змінюється з «1 фото passthrough» на «N фото → grouping».
  Рекомендація (#11): **не** перевантажувати `trivialImagePlan`; додати окрему
  детерміновану перевірку `allImagesRoute(live)` яка веде у новий image-merge під-флоу
  DP (1B), а `trivialImagePlan` лишити для справді тривіального single-image legacy
  шляху або злити свідомо з документуванням. Вирішити при реалізації, зафіксувати у звіті.
- Принцип «Cheap before Expensive» (§4.1 візії): економимо дороге AI-рішення про межі
  PDF, не саму обробку.

### 1C.2 — Toggle «Просто додати файли» (`skipPdfSlicing`)
- Додати в `DEFAULT_SETTINGS` (`index.jsx:30-39`): `skipPdfSlicing: false` з
  one-line коментарем сенсу (див. SEMANTIC CLARITY CHECK).
- UI: тумблер у Зоні 2, група «ОРГАНІЗАЦІЯ», лейбл «Просто додати файли», description
  «кожен PDF — окремий документ, без AI-нарізки».
- Прокинути в `options` (`startProcessing`, `index.jsx:193-198`) → у Triage-стадію.
- Поведінка: ON → для PDF Triage-нарізка пропускається, кожен PDF = 1 документ
  (route `add_as_is`). OCR + .txt + метадані + класифікація **лишаються**.
- OFF (default) → поточна поведінка (Triage перевіряє всі PDF).
- НЕ впливає на image-merge шлях (фото йдуть своїм маршрутом 1C.1/1B).

### 1C.3 — .txt у 02_ОБРОБЛЕНІ для text-layer PDF
- Зараз `.txt` пишеться лише коли є `layoutJson.pages` від OCR (скан). Text-layer
  (searchable) PDF тексту не отримує .txt.
- Виправити шлях запису артефактів (`splitDocumentsV3.js` `writeProcessedArtifacts`/
  `sliceProcessedArtifacts`) так, щоб коли є непорожній витягнутий текст (з text-layer,
  не лише з OCR layout) — `.txt` теж писався у 02_ОБРОБЛЕНІ.
- Узгодити з документною природою: `documentNature='searchable'` для text-layer
  (без виклику Document AI — це гілка вже існує в TASK A конвертації).
- НЕ генерувати `.layout.json` для text-layer (його немає) — лише `.txt`.

### Acceptance 1C
- [ ] всі файли — фото → AI Triage НЕ викликається (перевірити логом/тестом)
- [ ] `skipPdfSlicing` тумблер у Зоні 2, default false, one-line коментар сенсу
- [ ] ON → кожен PDF = 1 документ (add_as_is), OCR/.txt/метадані лишаються
- [ ] OFF → поведінка ідентична поточній
- [ ] text-layer PDF отримує `.txt` у 02_ОБРОБЛЕНІ; `.layout.json` НЕ пишеться для нього
- [ ] нові тести: routing (all-images skip triage), skipPdfSlicing ON/OFF, txt для text-PDF
- [ ] `npm test` зелений, `npm run build` success

---

## РЕКОМЕНДОВАНИЙ ПОРЯДОК ВИКОНАННЯ

`1A → 1C → 1B`. Обґрунтування:
1. **1A** (винос) — behavior-preserving фундамент, низький ризик, розблоковує reuse для 1B.
2. **1C** (route+toggle+txt) — менший, дає швидку Cheap-before-Expensive перемогу і
   видимий тумблер; не залежить від великого UI.
3. **1B** (N-doc UI) — найбільший, спирається на ImageEditor (1A) і deterministicRoute (1C).

Можна окремими комітами/PR в межах однієї гілки. Між під-TASK'ами — зелений `npm test`.

---

## SAAS IMPLICATIONS

- **Поля сутностей:** нових полів немає. Документи створюються через `createDocument()`
  (повна SaaS-схема вже: tenantId, ownerId, addedBy, source, createdAt — успадковуються).
- **Permissions:** нових ACTIONS немає. `add_documents` уже в allowlist
  `document_processor_agent`. `imageDocumentGrouper` — AI-агент аналізу, не ACTION
  (не змінює дані, лише пропонує) — дозволу не потребує.
- **Tenant isolation:** документи прив'язані до `caseData` (вже tenant-scoped через
  справу). Без змін.
- **Multi-user:** групування — pre-persist пропозиція, не зачіпає team/доступ.

## BILLING IMPLICATIONS

- **Точки інструментації:** новий AI-виклик `imageDocumentGrouper` → `activityTracker.
  report('agent_call', {...})` (час) + `logAiUsageViaSink` (токени) — паралельно, НЕ
  дублювати поля між `time_entries[]` і `ai_usage[]`.
- **Категорії часу:** `case_work` (billable, factor 1.0) — це робота адвоката над
  матеріалами справи. Грунтується на існуючій DP-інструментації.
- **Master timer:** без змін (DP уже інструментований).
- **Тули з білінговими ефектами:** немає нових ACTIONS; `add_documents` — існуючий.
- **CRM-зріз:** створені документи з'являються в матеріалах справи як зараз.

## AI USAGE IMPLICATIONS

- **Точки виклику AI:** новий `imageDocumentGrouper` (Haiku). Існуючі `imageSortingAgent`
  (Sonnet), `edgeDetection` (без AI) — без змін у цьому TASK.
- **resolveModel:** новий agentType `imageDocumentGrouper` → Haiku у `SYSTEM_DEFAULTS`.
- **logAiUsage context:** `{caseId, module:'document_processor', operation:
  'image_document_grouping'}`. **Закриває C7** для нового агента (логування з народження).
- **Tool Use vs JSON:** цей TASK — звичайний JSON-промпт-агент (як `imageSortingAgent`),
  НЕ tool use. Tool use migration — окрема Фаза 3 (TASK не зачіпає C1).

---

## ЩО НЕ РОБИТИ (out of scope)

- ❌ Переробляти CONFIRM-стадію диригента для **нарізки** PDF — це Фаза 5
  (`TASK_dp_zone3_slice_plan_editing`). Тут пауза-для-правки лише для image-merge,
  локально на рівні DP-компонента.
- ❌ Міняти публічний контракт `ImageMergePanel` (модалка) — лише імпорти.
- ❌ Уніфікувати AddDocumentModal з DP pipeline (C4) — це Фаза 4.
- ❌ Зводити дублікат `DrivePicker` — це TASK 4.
- ❌ Чіпати `contextGenerator` / `cleanText` винос — це TASK 2 / TASK 3.
- ❌ Виносити `CATEGORY_OPTIONS`/`AUTHOR_OPTIONS` у documentSchema.js — лише борг.
- ❌ Tool use migration (C1), strip image/tokens (C3), мертвий persistStage (C5),
  структура _temp (C6), статичний import (C8) — інші фази.
- ❌ Bump schemaVersion / зміна структури registry_data.json.
- ❌ Виправляти «попутні» баги — у `bugs_found_during_image_merge_unify.md`.
- ❌ Кирилиця в `q=` Drive API (правило #8) — для нових Drive-запитів якщо будуть.

---

## ТЕСТИ — критерій

- 1A: число тестів **без змін** (1581) — лише шляхи імпортів.
- 1B/1C: число **зростає** (нові unit + integration). Кожен новий сервіс/маршрут/
  тумблер покритий (правило «тести разом з кодом»).
- Жоден існуючий тест не падає на жодному під-TASK.
- CI блокує деплой при red — `npm test` зелений перед кожним push.

---

## ЗВІТ ПІСЛЯ ВИКОНАННЯ

`docs/reports/report_task_image_merge_unify.md`:
1. Що зроблено по кожній осі (A/B/C) і кожному під-TASK (1A/1B/1C).
2. Фінальна структура `ImageEditor/` + `imageDocument/` (дерево файлів).
3. Рішення прийняті в межах експертної автономії (grouper окремий файл? trivialImagePlan
   розширено чи окрема allImagesRoute? geometry куди?).
4. Числа тестів до/після, підтвердження зелені + build.
5. Побічні знахідки → `bugs_found_during_image_merge_unify.md` / `tracking_debt.md`.
6. Скріншот/опис нового DP image-merge flow для перевірки адвокатом.
7. Git commit confirmation.

Оновити `ARCHITECTURE_HISTORY.md` (запис про TASK 1) і позначити ✓ Фазу 1/TASK_1 у
`consultation_combined_roadmap_dp_and_refactoring.md`.

---

## ПЕРЕВІРКА АДВОКАТОМ (після merge + deploy)

1. Справа → «Робота з документами» (DP).
2. Закинути 6-10 фото з телефону (HEIC/JPEG) що складають 2-3 документи.
3. Перевірити: AI запропонував групи; Triage НЕ ганявся (швидко).
4. Перетягнути фото між групами, обернути, обрізати, перейменувати, обрати тип.
5. «Виконати» → у матеріалах з'явились N окремих PDF з .txt.
6. Окремо: закинути кілька готових PDF, увімкнути «Просто додати файли» →
   кожен PDF = 1 документ, без нарізки; text-layer PDF має .txt.
7. Перевірити що **модалка** «Склеїти зображення» (старий шлях) працює як раніше.

Якщо щось зламано — `git revert`, повідомити з описом.

---

## ГОТОВНІСТЬ

- [x] Реальний код звірено (triageStage, splitDocumentsV3, DP index, ImageMergePanel, pdfRebuild, actionsRegistry)
- [x] Три осі присутні в кожному під-TASK
- [x] #11 перевірено для нових імен (skipPdfSlicing, imageDocumentGrouper)
- [x] Baseline тестів: 1581 passed
- [ ] Затвердження адвоката → передача сесії-виконавцю

**Кінець TASK 1 (image_merge_unify).**
