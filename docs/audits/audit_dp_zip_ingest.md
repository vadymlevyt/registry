# АУДИТ DP · СЦЕНАРІЙ 4 — РОЗПАКУВАННЯ ZIP (ЄСІТС-інгест)

**Дата:** 2026-06-15
**Тип:** read-only діагностика (PART 1 повного аудиту DP, TASK_dp_full_audit.md §3.1.4)
**Скоуп:** фронт-крок розпакування ZIP перед add-files — розпак, відкидання підписів
`.p7s`/`.sig`, маршрутизація вмісту, межа «архіви лише в DP».
**Методологія (§1.2-bis):** кожне твердження звірене з кодом `file:line`. Де код суперечить
документації/спеці — істина в коді, розбіжність окремим рядком. Жодного висновку без `file:line`.

**Гілка:** `claude/dp-full-audit-findings`. Жодного рядка коду не змінено.

---

## 1. Ключові файли в обсязі

| Файл | Роль | Статус |
|------|------|--------|
| `src/services/addFiles/unpackArchivesFrontStep.js` (159 рядків) | **ЖИВИЙ** фронт-крок розпаку | в проді |
| `src/services/documentPipeline/stages/unpack.js` (326 рядків) | джерело предикатів + **ОСИРОТІЛИЙ** stage `createIntakeWithUnpack` | змішаний |
| `src/components/DocumentProcessorV2/index.jsx` | точка виклику в `startProcessing` | в проді |
| `src/services/addFiles/addFilesService.js` | куди вливається розпакований вміст | в проді |
| `src/components/CaseDossier/index.jsx` | модалка-guard (межа «архіви лише в DP») | в проді |
| `src/services/ecitsService.js` | zip-згадка — **НЕРЕЛЕВАНТНА** (див. §6) | — |

---

## 2. КАРТА ПОТОКУ ZIP-РОЗПАКУ — від вводу до результату

Простими словами: адвокат кидає ZIP з ЄСІТС у Document Processor, вмикає тумблер «Просто
додати файли», тисне «Розпочати обробку». ZIP розгортається у складові файли, КЕП-підписи
відкидаються, решта віддається в `addFiles` плоским списком — кожен файл далі йде своїм
шляхом (PDF→як є, DOCX/HTML→PDF, фото→PDF).

| # | Станція | Що робить | `file:line` | Вирок |
|---|---------|-----------|-------------|-------|
| 0 | **ВВІД + ворота сценарію** | ZIP проходить далі ТІЛЬКИ якщо увімкнено «Просто додати» (`useAddAsIs`). Нарізка/склейка ZIP не очікують. | `DocumentProcessorV2/index.jsx:726`, `746` | ✅ жива |
| 1 | **Матеріалізація сирих File** | `buildAddAsIsInput` тягне device/Drive-файли у `File`. ZIP — НЕ фото → downscale-гілка `isImageFile` його пропускає (no-op). | `DocumentProcessorV2/index.jsx:319-383`, `337` | ✅ жива |
| 2 | **Виклик фронт-кроку** | `rawFiles = input.files.map(f=>f.raw)` → `unpackArchivesFrontStep(rawFiles)`. | `DocumentProcessorV2/index.jsx:747-748` | ✅ жива |
| 3 | **Класифікація архіву** | `isArchive(name,type)` (розширення `.zip/.rar/.7z` АБО MIME-set). Не-архів → passthrough. | `unpackArchivesFrontStep.js:93`; предикат `stages/unpack.js:45-47` | ✅ жива |
| 4 | **Розрізнення zip vs rar/7z** | `archiveKind`: лише `'zip'` розпаковується; `'rar'`/`'7z'` → лишаються як один файл + `archivesKept`. | `unpackArchivesFrontStep.js:98-107`; `stages/unpack.js:50-57` | ✅ жива |
| 5 | **Читання байтів** | `readBytes(file)`: `_bytes` (тест-шим) АБО `file.arrayBuffer()`. Фейл → `archivesKept{reason:'read_failed'}`, архів лишається як є (best-effort, не падаємо). | `unpackArchivesFrontStep.js:48-55`, `110-115` | ✅ жива |
| 6 | **Розпак (fflate)** | `defaultUnzipArchive(bytes)`: lazy `import('fflate')` → `unzip()` → `[{name,data}]` без директорій. Фейл/corrupt → catch → `archivesKept{reason:'unpack_failed'}`, архів як є. | `stages/unpack.js:123-134`; виклик `unpackArchivesFrontStep.js:117-126` | ✅ жива |
| 7 | **Перелік записів + skip директорій** | `for (e of entries)`: `basename(e.name)`; порожнє ім'я (директорія) → skip. | `unpackArchivesFrontStep.js:129-131` | ✅ жива |
| 8 | **Відкидання КЕП-підписів** | `isSignatureFile(name)` = `/\.(p7s\|sig)$/i` → `report.signaturesDropped++`, `continue` (файл НЕ йде далі). Прив'язки до основного файлу НЕМА (на відміну від dormant stage). | `unpackArchivesFrontStep.js:132-137`; предикат `stages/unpack.js:60-62` | ✅ жива |
| 9 | **Конструювання File з запису** | `entryToFile(name, data, makeFile)`: браузер → `new File([data], basename, {type:guessMime})`; Node → шим `{_bytes, arrayBuffer}`. MIME вгадується за розширенням (`guessMime`). | `unpackArchivesFrontStep.js:138`; `stages/unpack.js:82-117` | ✅ жива |
| 10 | **Гачок onArchiveEntry** | Порожній no-op гачок для майбутнього HTML-метадата-екстрактора; ізольований try/catch. Default `null` — НІХТО не передає. | `unpackArchivesFrontStep.js:139-151`, `81-83` | ⚠ passthrough (claim універсальності, §5.5) |
| 11 | **Звіт** | `{ unpacked:[{archive,entryCount}], signaturesDropped, archivesKept:[…] }`. | `unpackArchivesFrontStep.js:86`, `155`, `158` | ✅ жива |
| 12 | **Перебудова input.files** | `didUnpack` (були розпаковані АБО відкинуті підписи) → `input.files = expanded.map(...)` з `fileId:'unpack_N'`. `didUnpack=false` → input НЕ чіпається (регрес-гард). | `DocumentProcessorV2/index.jsx:749-767` | ✅ жива |
| 13 | **Тости** | success «Розпаковано N файлів; M підписів відкинуто»; warning по кожному `archivesKept` (RAR/7z). | `DocumentProcessorV2/index.jsx:750-773` | ✅ жива |
| 14 | **Передача в addFiles** | `pipeline.addFiles(input, {ocrMode, compress, updateCaseContext})`. Кожен розпакований файл → per-file `convertToPdf`→upload→createDocument→persist. | `DocumentProcessorV2/index.jsx:780-785`; `addFilesService.js:117-244` | ✅ жива |
| 15 | **Межа «архіви лише в DP»** | Модалка CaseDossier «+Додати документ»: drop ZIP → `isArchive(...)` → toast «Архіви додавайте через Document Processor», документ НЕ створюється. | `CaseDossier/index.jsx:2702-2703` (імпорт `:11`) | ✅ жива (межа підтверджена) |

**Результат:** ZIP у tmp → N документів через add-files (PDF/конвертовані), КЕП-підписи
відкинуто, RAR/7z лишилися окремими файлами + warning.

---

## 3. СТАНЦІЇ ДИРИГЕНТА — вирок ПО-ШЛЯХОВО для ZIP-шляху (§3.5-A)

**Критично:** ZIP-шлях **НЕ проходить через диригента `documentPipeline.js`** (9-стадійний
DEFAULT_STAGE_ORDER). Він іде через `pipeline.addFiles` (окремий сервіс `addFilesService`,
нуль звʼязку з нарізкою — `DocumentProcessorV2/index.jsx:780-785`). Тому «станції диригента»
(INTAKE/CONVERT/OCR/TRIAGE/SPLIT…) на цьому шляху **взагалі не задіяні** — їх вирок: **мертві
на ZIP-шляху** (не виконуються). Реальні «станції» ZIP-шляху — це таблиця §2 (фронт-крок +
addFiles per-file), а не стадії диригента.

| «Станція» | На ZIP-шляху | `file:line` |
|-----------|--------------|-------------|
| `createIntakeWithUnpack` (intake-override з розпаком) | **мертва** — НЕ підключена; ZIP розпаковує фронт-крок, не stage | `stages/unpack.js:164`; жодного prod-імпорту (§4) |
| `convertStage` (диригент) | **мертва** на ZIP-шляху (ZIP не йде в `pipeline.run`); жива конвертація — у `addFiles` через `convertToPdf` per-file | `addFilesService.js:135` |
| TRIAGE / SPLIT / OCR-стадії диригента | **мертві** на ZIP-шляху (add-files не ріже, не робить Triage) | — |

Висновок §3.5-A: на ZIP-шляху диригент відсутній цілком; конвертація/OCR живуть у `addFiles`
як пост-кроки, не як станції диригента.

---

## 4. ДВА РОЗПАКИ? (#57 осиротілий розпак) — вирок

**Так, у коді ДВІ реалізації розпаку. Одна жива, одна осиротіла.**

### 4.1 `unpackArchivesFrontStep` (`addFiles/unpackArchivesFrontStep.js:78`) — **ЖИВИЙ**

Доказ live-виклику в проді:
- `DocumentProcessorV2/index.jsx:37` (import) → `:748` (виклик у `startProcessing`).
- Предикат `isArchive` також споживає `CaseDossier/index.jsx:11,2702` (модалка-guard).
- Тести: `tests/unit/unpackArchivesFrontStep.test.js`, `tests/integration/dp4-zip-ingest.test.jsx`.

**Вирок: живий.** Це єдиний розпак у проді.

### 4.2 `createIntakeWithUnpack` (`stages/unpack.js:164`) — **ОСИРОТІЛИЙ (дрімає)**

Доказ відсутності live-виклику:
- `grep "createIntakeWithUnpack\|intakeWithUnpack"` по src/ дає **лише** означення (`stages/unpack.js:164,168`)
  і коментар-згадку «НЕ активує дрімаючий createIntakeWithUnpack» (`unpackArchivesFrontStep.js:17`).
- Усі реальні виклики — **тільки в тестах**: `tests/integration/dp2-stages.test.js:10,27`,
  `tests/unit/unpack.test.js:6,64…155`.
- `grep "stageOverrides\|STAGE.INTAKE"` по src/ — порожньо; ніхто не інжектить цей override у диригента.

Те саме для допоміжних експортів цього файлу: `isSidecarFile` (`:65`), `parseSidecarBytes`
(`:158`), уся sidecar-логіка (`:136-326`) — `grep` по src/ (без самого `unpack.js`) дає **нуль**
prod-споживачів. Sidecar-канал ЄСІТС-метаданих живе ТІЛЬКИ всередині dormant stage.

**НЕ повний дубль:** живий фронт-крок свідомо re-експортує предикати (`isArchive`/`archiveKind`/
`isSignatureFile`) і тягне `defaultUnzipArchive`/`entryToFile`/`guessMime` з `stages/unpack.js`
(`unpackArchivesFrontStep.js:28-39`) — single-source класифікації, дублювання немає. Тобто
`stages/unpack.js` **частково живий як бібліотека предикатів**, але його головна сутність —
сам stage `createIntakeWithUnpack` + sidecar + signature-linking — **осиротіла**.

**Вирок по `createIntakeWithUnpack` (+ sidecar/signature-linking логіка): дрімає-приберегти
АБО мертве-видалити** — рішення власника. Тригер для «приберегти»: коли DP-2 pipeline отримає
intake-override з sidecar-каналом ЄСІТС. Якщо такого плану нема — кандидат на видалення
(тести `dp2-stages.test.js`, `unpack.test.js` тримають, але вони тестують dormant код).
**Не можна видалити цілий файл** — предикати/`defaultUnzipArchive`/`entryToFile`/`guessMime`
живі (їх тягне фронт-крок). Видаленню підлягає лише `createIntakeWithUnpack` + sidecar-функції,
з перенесенням предикатів якщо файл скорочується. → у `tracking_debt.md` як борг #57.

---

## 5. §3.5-B ВХІДНИЙ РОУТЕР — як розпакований вміст РЕ-входить у маршрутизацію

### 5.1 Точка входу (двері `startProcessing`)

| Двері | Умова | Куди | `file:line` |
|-------|-------|------|-------------|
| all-image + toggle OFF | `isAllImagesInput() && !skipPdfSlicing` | склейка фото | `index.jsx:718` |
| «Просто додати» ON | `skipPdfSlicing===true` (`useAddAsIs`) | **add-files (сюди потрапляє ZIP)** | `index.jsx:726` |
| мікс фото+PDF, toggle OFF | `!useAddAsIs && hasAnyImage() && hasAnyNonImage()` | toast-завернути (#27) | `index.jsx:727-733` |
| інше | — | стрім-нарізка (`pipeline.run`) | `index.jsx:786-794` |

### 5.2 КЛЮЧОВЕ: ZIP заходить ТІЛЬКИ у `useAddAsIs`-гілку

Фронт-крок `unpackArchivesFrontStep` викликається **виключно всередині `if (useAddAsIs)`**
(`index.jsx:746-748`). ZIP **ніколи** не потрапляє на стрім-нарізку (slice). Наслідок:
розпакований вміст НЕ ре-входить у `startProcessing` згори (немає рекурсії в роутер) — він
напряму вливається в `pipeline.addFiles` тим самим прогоном (`index.jsx:780-785`).

### 5.3 Чи б'є розпакований мікс по дірі PDF+DOCX?

**НІ — на ZIP-шляху діра не досяжна.** Розбір:
- Відома діра (§3.5-B): завертання спрацьовує лише на суміш **З ФОТО** (`hasAnyImage() &&
  hasAnyNonImage()`, `index.jsx:727`); суміш PDF+DOCX воріт НЕ має → на **slice-шляху**
  (toggle OFF) не-PDF проїхав би на стрім-нарізку, що чекає лише PDF (`streamingExecutor.js`
  `streamFile` обробляє байти як PDF — `:303,326-328`) → ймовірний злам «No PDF header».
- **Але ZIP заходить лише при toggle ON (`useAddAsIs`)**, а в add-files гілці немає нарізки
  взагалі: кожен файл (PDF, DOCX, HTML, фото) per-file проходить `convertToPdf`
  (`addFilesService.js:135`) — DOCX/HTML→PDF, PDF passthrough, фото→PDF. Тобто розпакований
  **мікс PDF+DOCX обробляється коректно** (кожен своїм конвертером), бо ZIP-вміст ніколи не
  доходить до slice-роутера.
- Підтверджено тестом: `dp4-zip-ingest.test.jsx:138-160` — звичайний DOCX через «Просто
  додати» доходить до `addFiles` як DOCX (не зламано).

**Розбіжність зі спекою:** спека §3.5-B припускала, що розпакований мікс може «вдарити по тих
самих дірах роутера». Код показує: оскільки розпак прив'язаний до `useAddAsIs`, а add-files не
ріже — діра PDF+DOCX **НЕ застосовна до ZIP-вмісту**. Діра реальна, але лише для
**ручного** drop не-PDF при toggle OFF, не для розпакованого ZIP.

### 5.4 Дрібний шов: merge-артефакти на ZIP-шляху

Коментар у коді (`index.jsx:755-759`): при `didUnpack` перебудова `input.files` НЕ переносить
`mergeArtifacts`/`metadataTemplate` — але це безпечно, бо модалка архіви не приймає, а
DP-merge йде окремою віткою (`startImageMergeProcessing`). ZIP і merge не перетинаються. ✅

### 5.5 onArchiveEntry — claim універсальності без реалізації

`onArchiveEntry` (`unpackArchivesFrontStep.js:81-83,139-151`) — порожній гачок для майбутнього
HTML-метадата-екстрактора. Default `null`, жоден prod-caller його не передає
(`grep onArchiveEntry` → лише означення + тест `unpackArchivesFrontStep.test.js:163-194`).
**Вирок: дрімає-приберегти** (явний тригер — серверний HTML-метадата-екстрактор; spec §5 у
шапці файлу). Низький ризик: ізольований, no-op.

---

## 6. РЕАЛЬНЕ vs ДОКУМЕНТОВАНЕ — розбіжності (кожна окремим рядком)

1. **Бібліотека розпаку — `fflate`, НЕ JSZip.** Завдання згадувало «JSZip/loadAsync» —
   у коді цього немає: `grep "JSZip\|loadAsync"` по src/ порожньо; розпак через
   `import('fflate')` (`stages/unpack.js:123-124`), залежність `fflate@^0.8.3` (`package.json:19`).
2. **`ecitsService.js` zip-згадка НЕРЕЛЕВАНТНА до DP-інгесту.** Єдина zip-згадка —
   `exportReconForAnalysis` повертає рядок шляху `…/export_for_analysis.zip`
   (`ecitsService.js:280-291`); жодного розпаку/створення ZIP, це лише string для recon-UI.
3. **§3.5-B: розпакований мікс НЕ б'є по дірі PDF+DOCX** (детально §5.3) — спека припускала
   можливість, код спростовує (розпак прив'язаний до `useAddAsIs`, де нарізки немає).
4. **ДВА розпаки (#57) підтверджено** — спека (§3.2) правильно називала «осиротілий розпак»;
   живий = `unpackArchivesFrontStep`, осиротілий = `createIntakeWithUnpack` (§4).
5. **Прив'язка підпису до файлу — лише в осиротілому stage.** Живий фронт-крок підписи просто
   відкидає (`signaturesDropped++`, `:135-137`), БЕЗ `linkedToName`/`ctx.signatures[]`. Це
   узгоджено з коментарем-рішенням власника («ctx.signatures[] НЕ робимо», `:133-134`) — не баг,
   але документувати треба: живий шлях факт «підписано» не зберігає взагалі.

---

## 7. ЗОВНІШНІ ЗАЛЕЖНОСТІ + РЕЖИМИ ВІДМОВИ

| Сценарій відмови | Поведінка | `file:line` | Ризик blank-page (#4)? |
|------------------|-----------|-------------|------------------------|
| **Corrupt ZIP** | `unzipArchive` throw → catch → `archivesKept{reason:'unpack_failed'}`, архів як є, не падаємо | `unpackArchivesFrontStep.js:117-126` | ні (catch) |
| **Read fail** (немає `arrayBuffer`/`_bytes`) | `readBytes`→null → `archivesKept{reason:'read_failed'}`, архів як є | `:48-55, 110-115` | ні |
| **Порожній ZIP** (0 записів) | `entries=[]` → `report.unpacked.push({entryCount:0})`; `input.files`=[] після перебудови (якщо лише ZIP) → guard `index.jsx:775` «Немає файлів для обробки» | `:128-155`; `index.jsx:775` | ні (guard) |
| **Усі записи — підписи** | усі `continue` (signaturesDropped), `kept=0`; як порожній ZIP → guard | `:132-137`; `index.jsx:775` | ні |
| **Вкладений ZIP** (zip у zip) | внутрішній `.zip` стане звичайним File після розпаку (НЕ рекурсія) → потім `convertToPdf` (passthrough, бо невідомий тип) → залитий як є. **Один рівень розпаку**, вкладені архіви НЕ розгортаються | немає рекурсії в `:129-154`; конверт `addFilesService.js:144-148` | ні, але вкладений архів лишається сирим |
| **RAR/7z** | `archiveKind!=='zip'` → `archivesKept`, файл як є + warning-toast | `:103-107`; `index.jsx:768-773` | ні |
| **Збій fflate import** (мережа/бандл) | `import('fflate')` reject → той самий catch unpack | `stages/unpack.js:124`; catch `:117-126` | ні |
| **Drive fail при addFiles** (після розпаку) | вже в `addFiles`: UPLOAD_FAILED/PERSIST_FAILED per-file, batch-стійко (інші файли додаються) | `addFilesService.js:178-187, 215-229` | ні |
| **Весь `startProcessing` throw** | зовнішній try/catch → toast «Не вдалось запустити обробку», `finally` скидає running+тумблери | `index.jsx:738,814-821` | ні (загорнуто) |

**Сміття/осиротілі артефакти:** фронт-крок НЕ пише на Drive і НЕ створює tmp (чистий
in-memory). Tmp/Drive-сміття можливе лише downstream у `addFiles` (поза скоупом цього аудиту).
ZIP-розпак сам по собі сміття не лишає. ✅

---

## 8. КАНОНІЧНА СХЕМА + БІЛІНГ

- **Розпак НЕ створює документи.** `unpackArchivesFrontStep` повертає `{files, report}` —
  чистий список File, жодного `createDocument`/Drive/executeAction (`:78-159`). Документи
  створює downstream `addFiles` через `createDocument` (`addFilesService.js:211`) +
  `persistDocument`→executeAction `add_document` (`:217`).
- **addedBy/source для ZIP-вмісту:** `buildAddAsIsInput` задає `source:'manual'`,
  `addedBy:'user'` (`index.jsx:372-373`). **Розбіжність з очікуванням:** ЄСІТС-вміст логічно
  мав би `source:'court_sync'`, але через DP-додавання він іде як `manual`/`user` — це
  узгоджено (адвокат вручну кинув ZIP), але означає, що канал ЄСІТС у метаданих документа НЕ
  фіксується. (Sidecar-канал, що міг би це нести — у dormant stage, §4.2.)
- **AI-точка в розпаку:** НЕМАЄ. Розпак детермінований, 0 токенів, 0 викликів моделі.
  OCR/AI — пост-кроки `addFiles` (за `ocrMode`, `index.jsx:782`).
- **Білінг розпаку:** фронт-крок не інструментується (не AI, не дія адвоката окремо).
  Білінг — на рівні `addFiles`/persist (executeAction). Дубль-обліку в розпаку немає. ✅

---

## 9. ПОКРИТТЯ ТЕСТАМИ

| Тест | Що покриває | Рівень |
|------|-------------|--------|
| `tests/unit/unpackArchivesFrontStep.test.js` | re-export предикатів, не-архів passthrough, ZIP+`.p7s` відкинуто, RAR/7z, best-effort при збоях, onArchiveEntry, порожній/null вхід | unit (fflate стаб) |
| `tests/integration/dp4-zip-ingest.test.jsx` | дротування DP→фронт-крок→addFiles: ZIP розгорнуто, мікс ZIP+PDF, RAR як є, DOCX-регрес-гард | integration (fflate+addFiles моки) |
| `tests/unit/unpack.test.js`, `tests/integration/dp2-stages.test.js` | **dormant** `createIntakeWithUnpack` (sidecar, signature-linking) | тестують осиротілий код (§4.2) |

**Прогалини покриття:**
- **Реальний fflate ніколи не виконується** — обидва живі тести стабають `unzipArchive`.
  Розпак справжнього ZIP-байтстріму (corrupt/порожній/вкладений) на реальному fflate — НЕ
  покрито. Клас #20 «перевірено лише моками» (§3.5-F) → пріоритет для e2e.
- Вкладений ZIP (zip-у-zip) — поведінка «один рівень» не має явного тесту.
- Межа модалки (`CaseDossier:2702` toast) — НЕ покрита тестом (лише код).
- `read_failed`/`unpack_failed` reason → конкретний UI-toast у DP не перевірено інтеграційно.

---

## 10. ПРОГАЛИНИ / ВІДКРИТІ ПИТАННЯ

1. **#57 — рішення власника по `createIntakeWithUnpack`** (видалити vs приберегти). Sidecar-канал
   ЄСІТС-метаданих повністю dormant; якщо ЄСІТС-метадані не їдуть через DP-2 intake — це
   мертвий код (§4.2). → tracking_debt.
2. **Канал ЄСІТС не фіксується в `document.source`** — ZIP-вміст стає `source:'manual'`. Якщо
   потрібна форензика «звідки документ», sidecar/source-проброс — окремий TASK.
3. **КЕП-підпис відкидається без сліду** — `signaturesDropped` лише рахується для тоста, факт
   «документ був підписаний» ніде не зберігається (рішення власника, але майбутній юридичний
   борг — верифікація підпису).
4. **Вкладені архіви** не розгортаються (один рівень) — для глибоких ЄСІТС-пакунків може бути
   несподіванкою; явно не задокументовано в UI.
5. **Реальний fflate не покритий** — найбільший ризик регресу (мок ≠ продакшн, §9).
6. **`onArchiveEntry`** — claim універсальності без споживача (§5.5); дрімає до серверного
   HTML-екстрактора.

---

**Кінець аудиту — Сценарій 4 (ZIP-інгест).** Read-only; код не змінювався.
