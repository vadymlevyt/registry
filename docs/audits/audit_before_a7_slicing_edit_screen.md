# AUDIT (before) — A7: екран редагування плану нарізки

**Дата:** 2026-06-23
**Тип:** read-only знімок перед спекою A7 (за філософією AUDIT→REVIEW→CLEANUP→AUDIT→РОЗШИРЕННЯ).
**Скоуп:** що в коді вже є для «екрана редагування нарізки + справжній CONFIRM-гейт», чого бракує,
і де гачки для двох дати-винятків (рішення власника: винятки ВХОДЯТЬ в A7).
**Метод:** читання коду (`documentPipeline.js`, `stages/confirmBoundaries.js`, `stages/triageStage.js`,
`stages/splitDocumentsV3.js`, `DocumentProcessorV2/index.jsx`, `DocumentViewer/*`, `CaseDossier/index.jsx`,
`UI/DatePicker.jsx`). **Нічого не виправлено** — лише фіксація стану.

---

## 1. ПОТОЧНИЙ ПОТІК (як є)

Диригент `src/services/documentPipeline.js`, `DEFAULT_STAGE_ORDER`:
`INTAKE → DETECT_BOUNDARIES → EXTRACT → CONFIRM → PERSIST → EMIT` (`:90-97`).

- **DETECT_BOUNDARIES** = `triageStage` (override) → пропонує `ctx.reconstructionPlan`
  `{ documents:[{documentId,name,type,route,fragments[],open}], unusedPages[] }`. **Лише пропонує**, нічого не ріже.
- **CONFIRM** = `confirmBoundaries` → `autoConfirm` дефолт **true** (`confirmBoundaries.js:22`):
  `true` → план `confirmed`, PERSIST ріже; `false` → план лишається `proposed`, PERSIST **нічого не ріже**
  (НЕ fatal — просто без нарізки, чекає UI «DP-4»).
- **PERSIST** = `splitDocumentsV3` → ріже+upload+`createDocument`+`add_document`.
- Усе це — **ОДИН наскрізний `pipeline.run`** (через `streamingExecutor`). Результат показується **ПІСЛЯ
  persist** у Зоні 3 (`DocumentProcessorV2:1107+`), де `result.documents` — **уже створені** документи.

**Висновок:** CONFIRM сьогодні **прохідний** не тому, що гейта нема, а тому, що `autoConfirm:true` і
**немає UI**, який запустив би `autoConfirm:false`, показав proposed-план і дав його редагувати ДО виконання.

---

## 2. ЩО ВЖЕ Є (перевикористовне для A7)

- **Модель плану готова до редагування:** `reconstructionPlan.documents[]` = `{documentId, name, type,
  route, fragments[], open}` — це і є модель дерева вузлів. `triageStage` її вже будує і нормалізує
  (`normalizePlan`), має dedup перекритих діапазонів (`resolveOverlaps`).
- **Механізм гейта існує:** `confirmBoundaries` з `autoConfirm:false` лишає план `proposed`;
  `splitDocumentsV3` без `confirmed` не ріже. Тобто «справжній гейт» — це **під'єднати UI до вже
  наявної гілки `autoConfirm:false`**, а не будувати гейт з нуля.
- **Диригент має диспозицію `halt`** (`documentPipeline.js:179`) — свідомий штатний стоп стадії
  (не fatal). Кандидат-механізм «спинитись після propose».
- **Кнопки «Розділити»/«Об'єднати з…» вже є в UI** (`DocumentProcessorV2:1152-1153`), але **`disabled`**
  з підказкою «DP-6». Тобто місце під drag/split/merge у Зоні 3 заброньоване.
- **Канонічний `DatePicker` готовий** (`UI/DatePicker.jsx`): `value:'YYYY-MM-DD'`, `onChange:(iso)=>void`
  (+ хелпери `toISODate/parseISODate/formatDateDisplay`). Уже спільний (склейка/модалка/досьє).
- **У вʼювері є `onUpdate(documentId, fields)`** (`CaseDossier:2309-2315`) — оновлює документ. Тобто
  плумбінг для inline-правки **вже прокладений** (виняток (i) сідає на нього).

---

## 3. ЧОГО БРАКУЄ (обсяг A7)

1. **Двофазний запуск.** Зараз `pipeline.run` іде наскрізь (propose→…→persist) в одному виклику.
   A7 потребує: **Фаза 1** — дійти до proposed-плану і **спинитись** (віддати план у UI); **Фаза 2** —
   після правок + «Виконати» — виконати CONFIRM→PERSIST→EMIT з **відредагованим** планом. Це
   **найважча частина** (диригент і `streamingExecutor` зараз наскрізні).
2. **Екран редагування плану (pre-execution):** дерево вузлів; **drag обʼєднати/розділити**;
   перейменування; зміна `type`; (виняток (ii)) поле **дати** на вузол через `DatePicker`. Зараз Зона 3 —
   лише **пост-persist** перегляд готових документів (drag-кнопки `disabled`).
3. **Справжній гейт:** «Виконати» = єдина точка, після якої щось ріжеться/пишеться. Під'єднати UI до
   `autoConfirm:false` + передати назад відредагований план.
4. **Виняток (ii) — дата в propose:** `triagePrompt` зараз віддає лише `name/type/route/fragments`
   (`triagePrompt.js:73`); додати `date` у вихід промпта → у `normalizePlan` → у `splitDocumentsV3`
   `defaultBuildMetadata`/`buildMeta` → `createDocument`. Поле `date` у схемі вже є; merge навіть
   передає `g.date` (зараз завжди null).
5. **Виняток (i) — панель «Деталі» вʼювера зараз ЗАГЛУШКА:** `CaseDossier:2316` →
   `onOpenDetails={() => toast.info('Панель деталей у розробці')}`. Зробити inline-правку
   `date/author/category` (через `DatePicker` + наявний `onUpdate`; бажано через ACTION `update_document`
   заради аудиту/білінгу — зараз `onUpdate` пише локально через `updateCase`).

---

## 4. ГОЛОВНА АРХІТЕКТУРНА РОЗВИЛКА (для спеки)

**Де тримати proposed-план між Фазою 1 і Фазою 2** і **де саме спиняти диригента**:
- Точка стопу: після `DETECT_BOUNDARIES` (propose) план уже є, але в `DEFAULT_STAGE_ORDER` далі йде
  **EXTRACT** перед CONFIRM — треба зрозуміти, що `extractV3` робить у streaming-шляху (OCR уже стався в
  `streamingExecutor`), щоб обрати точку паузи (після DETECT_BOUNDARIES чи після EXTRACT).
- Тривкість плану: у межах **живого прогону** план у памʼяті (RAM) — достатньо, якщо екран не переживає
  навігацію (а він і так не переживає — **борг #42**). Якщо потрібна тривкість через паузу/перехід —
  це серверна історія (узгоджено: довговічність → сервер).
- Механізм: `halt`-диспозиція + повторний виклик у Фазі 2 з відредагованим планом, АБО розщеплення
  `streamingExecutor.run` на `proposeOnly`/`executePlan`. Рішення — у спеці.

---

## 5. ЗНАХІДКИ / РИЗИКИ (read-only, не виправляти тут)

- **R1.** «Дерево проваджень» у Зоні 3 — плейсхолдер «після DP-6» (`DocumentProcessorV2:1129-1132`);
  поточне «дерево» = плоский список. A7 замінює це справжнім деревом плану (pre-execution).
- **R2.** `onUpdate` вʼювера пише локально через `updateCase` (`CaseDossier:2313`), **повз** `executeAction
  update_document` → без аудиту/білінг-інструментації. Для inline-правки (виняток i) варто йти через ACTION
  (правило архіваріуса). Зафіксувати рішення у спеці.
- **R3.** Двофазність зачіпає `streamingExecutor` (наскрізний `run` з OCR-стрімом) — найделікатніша зона
  DP. Будь-яка зміна тут потребує повного прогону тестів DP (нарізка/resume/артефакти).
- **R4.** Дата з AI (виняток ii) — недетермінована; на екрані має бути **правима** (рек. `stale`/manual як
  у параметрах A5), щоб помилкову авто-дату адвокат поправив до «Виконати».

---

## 6. КОД-ОРІЄНТИРИ
- Диригент: `src/services/documentPipeline.js` (`STAGE`, `DEFAULT_STAGE_ORDER`, `halt`-диспозиція).
- Стадії: `stages/triageStage.js` (propose), `stages/confirmBoundaries.js` (гейт, `autoConfirm`),
  `stages/splitDocumentsV3.js` (persist + `defaultBuildMetadata`), `stages/extractV3.js` (точка паузи?).
- Виконавець: `documentPipeline/streamingExecutor.js` (наскрізний `run` — кандидат на розщеплення).
- UI: `components/DocumentProcessorV2/index.jsx` (Зона 3 `:1107+`, drag-кнопки `disabled` `:1152`).
- Промпт: `services/documentBoundary/triagePrompt.js` (додати `date` у вихід — `:73`).
- Вʼювер: `components/DocumentViewer/DocumentViewerHeader.jsx` (Wrench «Деталі»),
  `CaseDossier/index.jsx:2305-2318` (`onUpdate` є; `onOpenDetails` — заглушка).
- Дата-UI: `components/UI/DatePicker.jsx`.

---

**Наступний крок:** з цього AUDIT — спека A7 (двофазний потік + екран редагування + справжній гейт +
два дати-винятки), з SAAS/BILLING секціями і тестами. Спершу — REVIEW знахідок з власником.
