# AUDIT — Playwright Feasibility для Document Processor (§5 + §3.5-F)

**Дата:** 2026-06-15
**TASK:** `docs/tasks/TASK_dp_full_audit.md` — PART 1, WAVE 2, workstream §5.
**Тип:** read-only оцінка + план. **НЕ встановлює** Playwright, НЕ ставить пакети, НЕ міняє код.
**Гілка:** `claude/dp-full-audit-findings`.
**Артефакт:** єдиний `.md` (цей файл).

> **Скоуп (тверда межа §5 / §8).** Цей звіт ТІЛЬКИ **оцінює здійсненність** e2e-тестування DP
> через Playwright і **планує** сценарії. Він НЕ встановлює `@playwright/test`, не створює
> `playwright.config`, не пише жодного e2e-тесту. Усе нижче — рекомендація для майбутньої
> окремої спеки. Кожне твердження про стан репо підкріплене `file:line` (§1.2-bis).

---

## 1. Заголовок і ground truth (доказова база)

### 1.1 Playwright НЕ встановлений — доказ

| Перевірка | Результат | Доказ |
|-----------|-----------|-------|
| `@playwright/test` у `package.json` | **відсутній** | `package.json` `devDependencies` (рядки 22-31): лише `@testing-library/*`, `@vitejs/plugin-react`, `@vitest/ui`, `jsdom`, `vite`, `vitest`. Жодного `playwright`. |
| `playwright.config.*` | **немає** | `ls playwright.config.*` → exit 1 (файл відсутній) |
| `e2e/` тека | **немає** | `ls -d e2e` → exit 1 |
| `node_modules/@playwright` | **не встановлено** | `ls -d node_modules/@playwright` → exit 1 |
| `node_modules/playwright*` | **не встановлено** | `ls node_modules/playwright* -d` → нічого |
| `playwright` у `node_modules/@vitest/browser-playwright` | **не встановлено** | `ls -d node_modules/@vitest/browser-playwright` → не існує |
| згадки `playwright` у репо (поза node_modules) | **лише в `package-lock.json`** | `grep -rli playwright` (без node_modules) → тільки `package-lock.json` |

**Важливий нюанс (truth-in-code).** Єдина згадка «playwright» у репо — `package-lock.json:3825,3845`:
`@vitest/browser-playwright: "4.1.5"` фігурує у `peerDependencies` / `peerDependenciesMeta`
**самого пакета `vitest`** і помічений `"optional": true`. Це **транзитивний опційний peer**
Vitest-у, **НЕ пряма залежність проекту** і **НЕ встановлений** (`ls node_modules/@vitest/browser-playwright`
→ відсутній). Тобто заявленого спекою стану («Playwright у репо не встановлений, нема конфіга,
нема node_modules, нема e2e-теки» — TASK §5) **підтверджено повністю**; ця згадка в lock-файлі —
не слід попередньої сесії, а штатний опційний peer transitive-залежності.

### 1.2 Поточний тест-стек — лише Vitest (доказ)

- `package.json:9-11` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`, `"test:ui": "vitest --ui"`.
  **Жодного `e2e`/`playwright` скрипта.**
- Конфіг — `vitest.config.js`: `environment: 'node'` (дефолт), `include: ['tests/**/*.test.{js,mjs,jsx}']`,
  `pool: 'threads'`, `setupFiles: ['tests/setup.js']`. Per-file `// @vitest-environment jsdom`
  для `.jsx`-тестів (коментар у конфізі). Тобто **двосередовищний Vitest**: node для сервісів,
  jsdom для React-компонентів.
- `tests/setup.js` — підключає `@testing-library/jest-dom` matchers; **жодного браузера**, лише jsdom.

### 1.3 Як завантажується застосунок (проти чого біг би Playwright)

- **Entry:** `index.html` — `<div id="root">` + `<script type="module" src="/src/main.jsx">`.
- **Зовнішні `<script>` у `<head>`:** `https://accounts.google.com/gsi/client` (Google Identity
  Services, для OAuth) + Google Fonts. Тобто навіть «голий» рендер тягне GIS з мережі.
- **Dev-сервер:** Vite (`package.json:6` `"dev": "vite"`; `vite.config.js` `base: '/registry/'`).
  Playwright бив би проти `vite preview`/`vite dev` локально (або проти білда в `dist/`).
- **Прод:** GitHub Pages `https://vadymlevyt.github.io/registry/` (CLAUDE.md). Real-e2e проти
  прод-URL технічно можливий, але вимагає реального логіну адвоката (його OAuth + ключ).

### 1.4 Три зовнішні залежності DP (визначають мокабельність)

| Залежність | Звідки кличеться | Як читається ключ/токен | Доказ |
|-----------|------------------|--------------------------|-------|
| **Anthropic API** | браузер `fetch('https://api.anthropic.com/...')` через `toolUseRunner.js` / `callAgent.js` / `cleanTextService.js` / `claudeVision.js` | `x-api-key` з `localStorage('claude_api_key')` | `toolUseRunner.js:363,577` (`'x-api-key': apiKey`); ключ — `App.jsx:1108,3253` `localStorage.getItem('claude_api_key')`; `claudeVision.js:148` теж `localStorage.getItem('claude_api_key')` |
| **Google Document AI (OCR)** | браузер `fetch` на `europe-west2-documentai.googleapis.com/.../2cc453e438078154:process` | `Authorization: Bearer <Drive-OAuth токен>` (`driveRequest` додає, scope cloud-platform) | `ocr/documentAi.js:43` (endpoint), `:7` коментар «driveRequest вже додає Authorization: Bearer» |
| **Google Drive (OAuth + REST)** | браузер; токен від GIS `window.google.accounts.oauth2.initTokenClient` | `localStorage('levytskyi_drive_token')`; refresh через `oauth2.googleapis.com/token` | `driveAuth.js:9` (clientId), `:17` `localStorage.getItem(TOKEN_KEY)`, `:30-38` GIS token client, `:60` refresh fetch; `App.jsx:2950-2952` `levytskyi_drive_token` |

**Висновок про мокабельність:** усі три залежності — **HTTP(S) із браузера** (fetch). Жодного
WebSocket чи нативного gRPC. Drive-токен і Anthropic-ключ читаються з `localStorage` — їх можна
**засіяти через Playwright `addInitScript`/`localStorage`**, не торкаючись реальної мережі. GIS
(`accounts.google.com/gsi/client`) — єдиний скрипт, що тягнеться з `<head>` ще до взаємодії; його
теж можна заглушити (`page.route` на GIS або stub `window.google`). Це робить **mocked-e2e
здійсненним** (див. §3.1).

### 1.5 Де живе DP у дереві (проти чого навігує тест)

- `DocumentProcessorV2` НЕ рендериться напряму в App як вкладка верхнього рівня. Він рендериться
  **всередині досьє справи**: `CaseDossier/index.jsx:32` (`import DocumentProcessorV2`), `:2449`
  (`<DocumentProcessorV2 ...>`). Тобто Playwright-сценарій мусить: відкрити справу → вкладку
  документів → DP. CaseDossier обгорнутий у `ErrorBoundary` (`App.jsx:5556-5583` — той самий
  «стільниковий» boundary з CLAUDE.md; рендер DP лежить у цій вітці).
- **Жодного `data-testid` у DP-компонентах** (`grep data-testid src/components/DocumentProcessorV2/`
  → порожньо; testid є лише в `CourtSync/ImportTab.jsx`). Наслідок: Playwright-локатори спиратимуться
  на текст/роль/aria — крихкіше. Додавання testid'ів — окрема дрібна підготовча робота (НЕ в цьому TASK).

---

## 2. Поточний стан тестування — Vitest-only, e2e-прогалина

### 2.1 Що покрито сьогодні (Vitest)

DP має **щільне** unit + integration покриття у Vitest (≈30 DP-релевантних файлів):

- **Unit (сервіси, node-env):** `splitDocumentsV3.test.js`, `splitDocumentsV3-routes.test.js`,
  `splitDocumentsV3-documentNature.test.js`, `dp3Stages.test.js`, `triageStage.test.js`,
  `analyzeTriageViaToolUse.test.js`, `triagePrompt.test.js`, `chunkManager.test.js`,
  `addFiles.test.js`, `unpack.test.js`, `unpackArchivesFrontStep.test.js`,
  `multiImageToPdf.test.js`, `imageDocumentGrouper.test.js`, `imageSortingAgent.test.js`,
  `converterService.test.js`, `documentAi.test.js`, `ocrService.test.js`, `callAgent.test.js`,
  `jobProgressStore.test.js`, `jobState.test.js`, `pipelineWorker.test.js`,
  `streamingExecutor.test.js`, `memoryMonitor.test.js` тощо.
- **Unit (UI-компоненти, jsdom):** `DocumentProcessorV2.test.jsx`, `ProcessingProgress.test.jsx`,
  `JobProgressTopbar.test.jsx`, `DpImageMergeEditor.test.jsx`, `ScanTextToggle.test.jsx`,
  `ingestOptionsToggles.test.jsx`.
- **Integration (`createActions` + workflow, jsdom/node):** `document-processor.test.js`,
  `dp2-stages.test.js`, `dp3-streaming.test.js`, `dp-triage.test.js`, `dp-text-slice.test.js`,
  `dp-layout-persist.test.js`, `dp-persist-routes.test.js`, `dp-stage-progress.test.js`,
  `dp-document-nature.test.js`, `dp-context-*.test.js`, `dp4-ui.test.jsx`, `dp4-add-as-is.test.jsx`,
  `dp4-zip-ingest.test.jsx`, `dp4-ui-triage-whole-volume.test.jsx`, `dp4-ui-executor-threw.test.jsx`,
  `dp-image-merge-*.test.{js,jsx}`, `triage_degenerate_plan.test.js`, `clean-text-dp.test.js`.

### 2.2 Природа покриття — і де e2e-прогалина

**Усі ці тести працюють у Vitest (node/jsdom) і МОКАЮТЬ зовнішні залежності.** Жоден не запускає
реальний браузер, реальний Vite-сервер, реальний Drive/Document AI/Anthropic. Конкретні докази
мок-природи (з сусідніх звітів цього аудиту):

- `dp-image-merge-context-event.test.jsx:15-56` мокає навіть сам `DpImageMergeEditor`
  (`audit_dp_image_merge.md §10`).
- `analyzeTriageViaToolUse.test.js` мокає `global fetch` (`audit_dp_slicing.md:242`).
- `dp4-zip-ingest.test.jsx` мокає `fflate` + `addFiles` (`audit_dp_zip_ingest.md:236`).

**E2e-прогалина (що Vitest принципово НЕ покриває):**

1. **Браузерні бінарні шляхи** — pdf-lib split/merge у Web Worker, Canvas→jsPDF, mammoth,
   html2pdf, heic2any, **fflate-розпак реальних байтів**. У Vitest вони або мокаються, або
   біжать у jsdom (де немає реального Canvas/Worker).
2. **Реальна мережа до 3 провайдерів** — Drive REST, Document AI `:process`, Anthropic
   `/v1/messages`. Реальні коди відповіді (401, 429, частковий JSON) ніколи не проходять.
3. **Наскрізна оркестрація UI→Drive→реєстр** — клік «Обробити» → реальний прогрес → реальні
   файли в 01/02/03 → документи у справі. Vitest перевіряє стадії ізольовано, не повний акорд.
4. **Blank-page guard (правило #4)** — чи НЕ падає модуль у білий екран при re/reject у async.
   jsdom-тести ловлять винятки, але не «білий екран справжнього застосунку».

Саме ці 4 — домен e2e (Playwright). Vitest їх архітектурно не дістає.

---

## 3. Дві стежки (§5.2)

### 3.1 Mocked e2e — Playwright перехоплює мережу

**Ідея.** Запустити реальний застосунок (Vite preview / dist) у реальному Chromium під
Playwright, але **перехопити весь вихідний HTTP** через `page.route()` і віддати **канонічні
відповіді** Drive / Document AI / Anthropic. Ключі/токени — засіяти у `localStorage`
(`claude_api_key`, `levytskyi_drive_token`) через `addInitScript`, GIS-скрипт заглушити
(`page.route('**/gsi/client', ...)` + `window.google` stub). Реальних секретів НЕ треба.

**Що це покриває (саме сильна сторона):**

- **Рендер модуля DP** у реальному браузері (всередині CaseDossier, через `ErrorBoundary`).
- **Ворота вибору сценарію** (`startProcessing`, `index.jsx:702-734`): all-images→merge;
  `skipPdfSlicing`→add-files; мікс фото+PDF→toast-завернути; **діра PDF+DOCX** (toggle OFF,
  без фото — проривається на slice; `index.jsx:727`) — точно відтворювана e2e.
- **Обидва режими тумблера** `skipPdfSlicing` on/off (`index.jsx:726`).
- **Drag-n-drop** — `onDrop` (`index.jsx:228-231`, `:929`); Playwright `dispatchEvent('drop'...)`
  з `DataTransfer`.
- **Прогрес / cancel / resume UI** — повноекранний прогрес (`pipeline.expandProgress`,
  `index.jsx:737`), cancel-гілка (`res.cancelled` → `setCancelInfo`, `:796-797`).
- **Обробка помилок + blank-page guard** — мок Drive 401 → перевірити, що DP показує toast
  (generic, §3.2-крос §5.4), а НЕ білий екран; `ErrorBoundary` тримає решту застосунку.
- **Вигляд результату** — `setResult` + `resultTab='tree'`, toast «Оброблено: N документів»
  (`index.jsx:800-803`); документи з'являються у справі.

**Що НЕ покриває (важлива межа):** мок Document AI повертає **синтетичний** layout/text →
**реальна OCR-якість і реальний chunk-розмір на реальному томі НЕ перевіряються** (це домен
real-e2e). Реальний fflate/pdf-lib/Canvas **виконуються по-справжньому** (мережа не потрібна для
байтових операцій) — тобто mocked-e2e таки покриває браузерні бінарні шляхи з §2.2-п.1, **окрім
тих частин, що вимагають відповіді провайдера** (OCR-постобробка тексту).

**Здійсненність у пісочниці.** **Висока для самого механізму.** `page.route()` перехоплює fetch
**до виходу в мережу** — мережева політика середовища тут не блокер для перехоплених запитів.
Єдина мережева залежність — **завантаження самого Chromium-бінарника** при `npx playwright install`
(одноразово, ~100-150 МБ) і тягнення GIS/Google-fonts при першому рендері (теж мокабельні через
`route`). Тобто: якщо середовище дозволяє разово стягнути Chromium — далі mocked-прогон
**самодостатній і офлайновий**. Це треба підтвердити в спеці встановлення (не в цьому TASK).

**Потрібні канонічні фікстури (golden):**

1. **Drive REST** — `files.list` (підпапки справи 01-05/.metadata), `files.create` (повертає
   `id`/`webViewLink`), `files.get?alt=media` (байти chunk'а), upload-resumable відповіді.
   Латиниця в `q=` (правило #8) — фікстури мусять відображати реальний пошук JS-фільтром.
2. **Document AI `:process`** — канонічний JSON з `pages[].layout`/`tokens`/`paragraphs` для
   ≥2 шаблонів: малий searchable та scanned з геометрією (вже є частковий матеріал у
   `tests/setup/_pdfFixture.js`, `tests/fixtures/`).
3. **Anthropic `/v1/messages`** — канонічна Triage-відповідь (валідний tool_use-план), а також
   degenerate-план (1 документ=100%, `triageStage.isDegeneratePlan`) і no-key/error для fallback.
4. **PDF/фото байт-фікстури** — реальні маленькі PDF + JPEG/HEIC, щоб pdf-lib/Canvas/heic2any
   виконались по-справжньому (частина вже є: `tests/setup/_pdfFixture.js`, `tests/fixtures/`).
5. **ZIP-фікстура** — реальний `.zip` з `.pdf` + `.p7s` (для fflate-розпаку і відкидання підписів).

### 3.2 Real e2e — справжні OAuth + ключі + мережа

**Ідея.** Повний прогін проти прод-білда (або `vite preview`) з **реальним** OAuth-логіном
адвоката, реальним `claude_api_key`, реальним Drive/Document AI/Anthropic, на **реальному томі**.

**Що дає (унікально):** реальна OCR-якість Document AI на справжньому судовому скані; реальний
adaptive chunk-розмір на великому томі; реальні коди 401/429/timeout від провайдерів; реальна
durability/resume на справжньому Drive; реальна вартість токенів.

**Чому це окрема майбутня спека, не зараз:**

- **Секрети.** Потрібен живий Anthropic-ключ + OAuth-consent адвоката (`driveAuth.js:9`
  clientId прив'язаний до конкретного Google-проекту; refresh-токен `:57`). Це **реальні гроші**
  (Anthropic + Document AI білінг) і **реальний Drive адвоката** — e2e писав би в його My Drive.
- **GIS-логін інтерактивний.** `initTokenClient` (`driveAuth.js:31`) відкриває Google-consent —
  не headless-friendly без service-account обхідного шляху (а його нема — клієнтський OAuth).
- **Мережева політика пісочниці** — вихід на `api.anthropic.com` / `*.googleapis.com` /
  `accounts.google.com` може бути заблокований; навіть якщо ні — небажано бити реальні платні API
  з CI.
- **Недетермінізм.** Реальна модель/OCR не дають стабільного golden — flaky-тести.

**Вирок real-e2e:** **окрема майбутня спека**, запускати **вручну / нечасто** (smoke на реальному
томі перед мажорним релізом DP), на ізольованому тестовому Drive-акаунті й бюджетному ключі, **поза
основним CI**. НЕ блокер деплою. Пріоритет нижчий за mocked-e2e.

---

## 4. §3.5-F «Перевірено лише моками» — ТОП-пріоритет для e2e (клас #20 / DP-4)

Клас багів #20 / DP-4: **юніт-тести зелені, реальний Provider — катастрофа.** Нижче — поведінки
DP, які сусідні звіти цього аудиту прямо позначили як **перевірені ТІЛЬКИ моками** і ніколи
наскрізно через реальний провайдер. **Це первинна черга Playwright** (переважно mocked-track;
де треба реальний OCR/Drive — позначено real-track).

| # | Поведінка (mock-only) | Доказ `file:line` | Трек | Пріоритет |
|---|----------------------|-------------------|------|-----------|
| F-1 | **OCR пост-крок на «add-as-is»** (`ocrEnrichAddAsIs`) — реальний Document AI на add-as-is наскрізно НЕ тестований | `audit_dp_add_files.md:282-283` | mocked (структура) + real (якість) | **ВИСОКИЙ** |
| F-2 | **Реальна конвертація** mammoth/pdf-lib/Canvas (DOCX/HTML/image→PDF) — юніти мокають браузерні залежності | `audit_dp_add_files.md:285` | **mocked** (байти реальні) | **ВИСОКИЙ** |
| F-3 | **Реальний fflate байт-розпак ZIP** — мок ≠ продакшн, «найбільший ризик регресу» | `audit_dp_zip_ingest.md:236,261` | **mocked** (байти реальні) | **ВИСОКИЙ** |
| F-4 | **Наскрізний `handleImageMergeSubmit`** (rebuild→upload→add_documents) — реальний Drive/OCR ніде наскрізно; тести мокають усі важкі частини | `audit_dp_image_merge.md:216-219` | mocked + real | **ВИСОКИЙ** |
| F-5 | **Уся OCR-якість + adaptive chunk-розмір на реальних томах** — лише моки | `audit_dp_slicing.md:247-248` | **real** (якість) | СЕРЕДНІЙ (real-only) |
| F-6 | **Наскрізна склейка з реальним фото** (image-merge rebuild) — лише `__test__` юніти | `audit_dp_image_merge.md:221` | mocked + real | СЕРЕДНІЙ |
| F-7 | **401-Drive friendly-handling** — у жодному з 4 сценаріїв немає «перепідключіть Drive»; 401 = generic toast/`EXECUTOR_THREW` (правило #8 не застосоване в DP); ніколи не проганялось через реальний 401 | `diagnostic_dp_crosscutting.md:212-218`, `:378`; `audit_dp_slicing.md §6`; `index.jsx:434` | **mocked** (мок 401 через route) | **ВИСОКИЙ** (легко мокнути) |
| F-8 | **Triage-passthrough тихо валить 02** (нема ключа/throw/0 docs → fallback persist БЕЗ layout; адвокат бачить «оброблено») — перевірено лише моком | `diagnostic_dp_crosscutting.md:226`, `:373` (п.6) | **mocked** (мок no-key/error Anthropic) | **ВИСОКИЙ** |
| F-9 | **Діра роутера PDF+DOCX** (toggle OFF, без фото → DOCX проривається на slice, що чекає лише PDF → ймовірний крах «No PDF header») — підтверджено кодом, але не e2e | `index.jsx:727`; `diagnostic_dp_crosscutting.md §7.1`, `:373` (п.4) | **mocked** | **ВИСОКИЙ** |
| F-10 | **Діра роутера INBOX-фото** (фото з 00_INBOX не йдуть у склейку → у нарізку → крах для чистих фото) | `index.jsx:396`; `diagnostic_dp_crosscutting.md §7.2`, `:373` (п.5) | mocked | СЕРЕДНІЙ |

**Висновок §4:** ТОП-пріоритет для першого Playwright-набору (усе **mocked-track**, дешево, без
секретів): **F-2, F-3, F-7, F-8, F-9** — вони відтворювані синтетичним фікстуром і ловлять
найнебезпечніші класи (реальний байт-розпак, реальна конвертація, тиха втрата layout, крах
роутера, відсутній friendly-401). **F-5 (OCR-якість)** — єдиний суто real-track, чекає окремої
real-e2e спеки.

---

## 5. Перелік сценаріїв Playwright (§5.3) — максимум покриття DP

Кожен сценарій → трек (M=mocked / R=real). Селектори: через текст/роль (testid'ів нема — §1.5).
Передумова всіх: відкрити справу → вкладку документів → DP (`CaseDossier:2449`).

| # | Сценарій | Що перевіряє | `file:line` якоря | Трек |
|---|----------|--------------|-------------------|------|
| P-1 | **Рендер модуля DP** | DP монтується у реальному браузері без помилок (ErrorBoundary не спрацював) | `CaseDossier:2449`, `App.jsx:5556` | **M** |
| P-2 | **Ворота: all-images + toggle OFF → image-merge** | `isAllImagesInput()` веде у склейку | `index.jsx:391-397,718-720` | **M** |
| P-3 | **Ворота: toggle ON «Просто додати»** | завжди add-files, ніколи нарізка (будь-який тип) | `index.jsx:722-726,780-785` | **M** |
| P-4 | **Ворота: мікс фото+PDF (toggle OFF) → toast-завернути** | warning «увімкніть Просто додати», обробки нема | `index.jsx:727-733` | **M** |
| P-5 | **ДІРА PDF+DOCX (toggle OFF, без фото)** | DOCX проривається на slice → очікуваний збій/крах; зафіксувати поведінку | `index.jsx:727` (умова лише `hasAnyImage&&hasAnyNonImage`); §7.1 крос | **M** (F-9) |
| P-6 | **Тумблер skipPdfSlicing on/off** | обидва шляхи (`buildAddAsIsInput` vs `buildRunInput`) | `index.jsx:726,739` | **M** |
| P-7 | **Drag-n-drop файлів у дроп-зону** | `onDrop`→`addDeviceFiles`; файли з'являються у `selected` | `index.jsx:228-231,927-929` | **M** |
| P-8 | **Прогрес повноекранний** | `expandProgress` → оверлей видно під час run | `index.jsx:737`; `ProcessingProgress.jsx` | **M** |
| P-9 | **Cancel під час прогону** | `res.cancelled`→`setCancelInfo`, readyCount показано | `index.jsx:796-797` | **M** |
| P-10 | **Resume після збою** | tmp лишається, повторний run підхоплює (нарізка) | карта §2 крок 10; `jobState.js` | **R** (реальний tmp) / частково M |
| P-11 | **Помилка обробки → attention-таб** | `res.ok=false`→`resultTab='attention'`, toast error | `index.jsx:807-812` | **M** |
| P-12 | **Blank-page guard (правило #4)** | reject у async (мок Drive 500) → toast, НЕ білий екран; ErrorBoundary тримає | `index.jsx:814-815`; `App.jsx:5556` | **M** (F-7/F-8) |
| P-13 | **401 Drive** | мок 401 → зараз generic toast (фіксує прогалину friendly «перепідключіть Drive») | `diagnostic_dp_crosscutting.md:212-218`; `index.jsx:434` | **M** (F-7) |
| P-14 | **Triage no-key/error → passthrough** | мок Anthropic-помилки → persist БЕЗ layout, але «оброблено» (фіксує тихий збій 02) | `diagnostic_dp_crosscutting.md:226`; `index.jsx:738-813` | **M** (F-8) |
| P-15 | **Результат: документи у справі** | `setResult`+`tree`, toast «Оброблено: N», документи видно у досьє | `index.jsx:800-806` | **M** |
| P-16 | **ZIP-інгест (add-as-is)** | реальний fflate розпак, `.p7s` відкинуто, toast «Розпаковано N… підписів відкинуто» | `index.jsx:746-774` | **M** (F-3; байти реальні) |
| P-17 | **Конвертація DOCX/HTML/image→PDF (add-as-is)** | mammoth/Canvas/heic реально; PDF у 01, текст у 02 | `audit_dp_add_files.md §…`; `converterService` | **M** (F-2; байти реальні) |
| P-18 | **Склейка фото наскрізно** | rebuild→upload→add_documents; M=мок Drive/OCR, R=реальні | `index.jsx:574-670`; `audit_dp_image_merge.md:216` | **M** + **R** (F-4/F-6) |
| P-19 | **Реальний том OCR-якість/chunk** | Document AI на справжньому скані; adaptive chunk | `audit_dp_slicing.md:247` | **R** (F-5; окрема real-спека) |
| P-20 | **INBOX-фото діра** | фото з 00_INBOX не йдуть у склейку | `index.jsx:396` | **M** (F-10) |

**Розподіл:** **17 сценаріїв — mocked-track** (без секретів, дешево, у CI), **3 — real-track**
(P-10 частково, P-18-R, P-19 — окрема real-спека, поза CI).

---

## 6. Рекомендація

### 6.1 Чи додавати Playwright

**ТАК — додати mocked-e2e Playwright як окрему наступну спеку (НЕ в цьому аудиті), real-e2e —
ще пізніша окрема спека.** Обґрунтування:

1. **Реальна прогалина існує і вона небезпечна.** Vitest архітектурно не дістає 4 класи (§2.2):
   браузерні бінарні шляхи, реальну мережу провайдерів, наскрізну оркестрацію, blank-page guard.
   Саме там живе клас #20/DP-4 («моки зелені — прод горить»), і §3.5-F його прямо називає
   пріоритетом. F-2/F-3/F-7/F-8/F-9 — реальні діри, які тільки e2e ловить.
2. **Mocked-track дешевий і самодостатній.** `page.route()` перехоплює до мережі; ключі/токени —
   `localStorage`-сід; GIS — stub. Єдиний мережевий борг — разове стягнення Chromium. Жодних
   секретів, жодних грошей на API, детермінований (golden-фікстури), придатний для CI.
3. **Інфраструктура вже майже готова.** Vite preview/dist існує; багато golden-матеріалу вже є
   (`tests/setup/_pdfFixture.js`, `tests/fixtures/ecits_envelope*.json`, Document AI/Anthropic
   моки в unit-тестах) — їх можна підняти до e2e-фікстур.

### 6.2 Орієнтовний кошт (для майбутньої спеки, не зобов'язання)

| Робота | Обсяг |
|--------|-------|
| `@playwright/test` devDep + `playwright.config.js` (`webServer: vite preview`, `baseURL /registry/`) + `npm run e2e` скрипт | мала |
| `addInitScript`-хелпер: сід `claude_api_key` + `levytskyi_drive_token`, GIS-stub | мала |
| `page.route`-моки 3 провайдерів + golden-фікстури (Drive/DocAI/Anthropic JSON, PDF/JPEG/ZIP байти) | **середня-велика** (головна стаття) |
| `data-testid` у ключових DP-вузлах (дроп-зона, тумблери, кнопка «Обробити», прогрес, result-таби) — крихкість селекторів інакше | мала-середня |
| 17 mocked-сценаріїв (§5) | середня |
| CI-інтеграція: окремий job `e2e` ПІСЛЯ `test`, перед `deploy` (або nightly, щоб не сповільнювати кожен push) | мала |

**Ризик-нота для CI:** Playwright + Chromium сповільнює пайплайн і додає flaky-поверхню. Рекомендація —
**окремий e2e-job, не блокуючий деплой на старті** (advisory), з підняттям до блокуючого після
стабілізації golden-набору. Real-e2e — **поза CI взагалі** (manual smoke).

### 6.3 Підсумкова рекомендація

- **Mocked-e2e Playwright — ТАК, окрема наступна спека.** Старт з ТОП-5 §4 (F-2/F-3/F-7/F-8/F-9)
  + P-1/P-3/P-15 (рендер/тумблер/результат). Devdep+config+`npm run e2e`+route-моки+golden.
- **Real-e2e — ТАК, але окрема пізніша спека**, manual/nightly, ізольований тестовий Drive +
  бюджетний ключ, поза основним CI; покриває лише те, що mocked не може (F-5 OCR-якість, реальні
  коди провайдерів, реальна durability).
- **Цей TASK — нічого не встановлює** (§5 «Playwright НЕ встановлює — лише оцінює і планує»). ✔

---

## 7. Прогалини / ризики

1. **Мережа пісочниці під Chromium-install не підтверджена тут** (read-only, пакети не ставимо).
   Спека встановлення мусить перевірити, що `npx playwright install chromium` проходить у CI/
   Codespaces. Якщо стягнення Chromium заблоковане — mocked-e2e теж блокується (route не рятує
   від відсутності бінарника). **Єдиний справжній блокер mocked-track.**
2. **Відсутність `data-testid` у DP** (§1.5) → селектори на текст/роль крихкі (укр. тексти,
   toast'и). Без testid'ів e2e-набір ламкий при будь-якій зміні копірайту. Підготовча робота.
3. **GIS-stub нетривіальний** — `window.google.accounts.oauth2.initTokenClient` має кілька
   викликів (`driveAuth.js:31,104`); stub мусить покрити token + refresh-шлях, інакше DP не
   «під'єднається до Drive» навіть з засіяним токеном. Залежить від того, наскільки DP перевіряє
   `window.google` vs лише `localStorage('levytskyi_drive_token')` (`App.jsx:2950`). Уточнити в спеці.
4. **Golden-фікстури DocumentAI/Anthropic мусять лишатись синхронними** з реальним контрактом —
   ризик дрейфу (мок застаріває, прод міняється). Періодичний real-smoke (real-track) — страховка.
5. **Real-e2e пише в реальний Drive адвоката** — без ізольованого тестового акаунта це небезпечно
   (засмічення My Drive, реальний білінг). Спека real-e2e мусить вимагати окремий tenant/Drive.
6. **`@vitest/browser-playwright` (опційний peer)** — теоретична альтернатива (Vitest Browser Mode
   на Playwright-провайдері) замість окремого `@playwright/test`. НЕ оцінено детально тут;
   потенційно дешевша інтеграція (переюз Vitest-конфіга), але менш зрілий e2e-DSL. Розглянути у спеці.
7. **P-19/F-5 (OCR-якість)** принципово недетермінований → не golden-able; лишається ручним
   smoke-судженням адвоката, не автотестом.

---

**Кінець — audit_dp_playwright_feasibility.md.** Read-only; жодного рядка коду не змінено;
Playwright НЕ встановлений (§8). Наступний крок — окрема спека встановлення mocked-e2e (ТОП-5 §4).
