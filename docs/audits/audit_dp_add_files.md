# AUDIT — DP СЦЕНАРІЙ 3: «ПРОСТО ДОДАТИ» файли (add-files service)

**Дата:** 2026-06-15
**Тип:** read-only аудит, частина 1 повного аудиту DP (`docs/tasks/TASK_dp_full_audit.md`)
**Скоуп:** per-file додавання БЕЗ нарізки (add-files сервіс) — гілка `skipPdfSlicing`
DocumentProcessorV2 + модалка «+ Додати документ» (спільне ядро).
**Метод (§1.2-bis):** кожне твердження звірене з кодом `file:line`. Де код суперечить
CLAUDE.md / карті §2 — істина в коді, розбіжність окремим рядком.

---

## 1. Що це за шлях

«Просто додати» — **окремий самодостатній сервіс** `createAddFiles(deps)`
(`src/services/addFiles/addFilesService.js`), свідомо **відв'язаний** від нарізки/склейки
(коментар-маніфест `addFilesService.js:1-39`). Один цикл по файлах, «кожен файл своїм
шляхом» досягається тим, що кроки труби (convert/compress/upload) самі маршрутизують за
типом — жодних доменних `if(зображення)…else if(скан)` у файлі (`addFilesService.js:12-26`).
Два споживачі ділять той самий код: модалка single-add і DP-тумблер «Просто додати файли».

Цей аудит — про **DP-гілку**. Вхідна точка: `DocumentProcessorV2.startProcessing`
(`DocumentProcessorV2/index.jsx:702`), маршрут `useAddAsIs = settings.skipPdfSlicing === true`
(`index.jsx:726`). Тумблер `skipPdfSlicing` визначений у `DEFAULT_SETTINGS`
(`index.jsx:64`); `skipOcr` — `index.jsx:68`.

---

## 2. КАРТА ПОТОКУ «ПРОСТО ДОДАТИ» (ввід → результат), по станціях

```
0. ВВІД / РОУТЕР
   startProcessing (index.jsx:702). Двері:
     • all-image + toggle OFF → image-merge editor (НЕ цей шлях)  [index.jsx:718]
     • skipPdfSlicing ON      → ЗАВЖДИ addFiles, будь-який тип    [index.jsx:726]
     • toggle OFF + фото+PDF мікс → toast-завернути               [index.jsx:727-733]
        ↓ (гілка useAddAsIs)
1. buildAddAsIsInput (index.jsx:319)
   материалізує кожен selected/INBOX у raw File; фото → downscale ≤2400px.
        ↓
2. ZIP front-step (index.jsx:746-774)  ← окремий сценарій 4, перед addFiles
        ↓
3. pipeline.addFiles(input, {ocrMode, compress, updateCaseContext})  [index.jsx:781]
   = addFilesRun (DocumentPipelineContext.jsx:344) → createAddFiles(deps) → svc.addFiles
        ↓  (для КОЖНОГО файлу: addOneFile, addFilesService.js:117)
   3a. CONVERT      convertToPdf (addFilesService.js:135)
   3b. COMPRESS     deps.compressFile, опційно (addFilesService.js:169)
   3c. UPLOAD(01)   deps.uploadFile → uploadFileToCaseFolder (addFilesService.js:180)
   3d. createDocument (addFilesService.js:211)
   3e. PERSIST      executeAction add_documents (addFilesService.js:217)
        ↓
4. OCR пост-крок (ТІЛЬКИ ocrMode='full')  ocrEnrichAddAsIs (DocumentPipelineContext.jsx:384-390)
        ↓
5. РЕЗУЛЬТАТ  documents[] + files[] + errors[]; toast; loadInbox (index.jsx:800-806)
```

### Станції — вирок по-шляхово (для add-files)

| # | Станція | Файл:рядок | Вирок | Нотатка |
|---|---------|-----------|-------|---------|
| 0 | Роутер `startProcessing` | index.jsx:702-734 | ✅ жива | `skipPdfSlicing` → ЗАВЖДИ addFiles |
| 1 | `buildAddAsIsInput` | index.jsx:319-383 | ✅ жива | материалізація + downscale фото |
| 2 | ZIP front-step | index.jsx:746-774 | ✅ жива (сценарій 4) | unpackArchivesFrontStep |
| 3a | CONVERT (`convertToPdf`) | addFilesService.js:135 | ✅ ЖИВА на цьому шляху | passthrough для Drive-source (135-152) |
| 3b | COMPRESS | addFilesService.js:169-175 | ✅ жива (опційна) | best-effort, scanned-guard у рушії |
| 3c | UPLOAD(01) | addFilesService.js:180 | ✅ жива | спільна точка заливки |
| 3d | createDocument | addFilesService.js:211 | ✅ жива | єдина фабрика |
| 3e | PERSIST | addFilesService.js:217 | ✅ жива | через executeAction (audit/billing/perms) |
| 3f | originalBlob upload (DOCX поряд) | addFilesService.js:191-203 | ✅ жива | best-effort warning |
| 4 | OCR пост-крок | DocumentPipelineContext.jsx:384-390 | ✅ жива при full / ❌ none | пише `.layout.json` у 02 |
| — | Vision-метадані (skipOcr) | — | ❌ МЕРТВА | `metadataEnrichAddAsIs` БІЛЬШЕ НЕ кличеться (див. §6) |

**КРИТИЧНО — §3.5-A підтверджено:** `convertStage`/`convertToPdf` на цьому шляху **ЖИВА**
(`addFilesService.js:135`), на відміну від стрім-нарізки (де файли вже PDF у tmp і convert
passthrough). Гіпотеза спеки §3.5-A підтверджена кодом.

### Деталі станцій

**3a CONVERT (`addFilesService.js:129-152`).** Три під-гілки:
- Drive-source (`item.isDriveSource && item.driveId`) → **passthrough**, нічого не
  конвертуємо (`addFilesService.js:131-132`). АЛЕ: `buildAddAsIsInput` материалізує
  Drive-файли у raw File (`index.jsx:326-334`) і НЕ ставить `isDriveSource` —
  отже у DP-гілці Drive-файли йдуть через `item.raw` (повна конвертація), passthrough тут
  активний лише для модалки-пікера. ⚠ Розбіжність коментаря з реальним вживанням у DP.
- `item.raw` → `await deps.convertToPdf(item.raw, conversionContext)` (`addFilesService.js:135`).
- ні raw ні driveId → метадані-only документ (`addFilesService.js:153`).

**Читання байтів ПЕРЕД upload (правило):** `uploadFileToCaseFolder`
(`driveService.js:753`) матеріалізує `file._bytes || new Uint8Array(await file.arrayBuffer())`
**перед** multipart (`driveService.js:761-763`); MIME = реальний `file.type`, НЕ хардкод
(`driveService.js:766`). ✅ Спільна точка заливки, один шлях на систему
(`DocumentPipelineContext.jsx:122-128` — `uploadToOriginals` тонкий аліас).

**Куди заливається:** folder `'01_ОРИГІНАЛИ'` (дефолт `uploadFileToCaseFolder`
`driveService.js:753`; метадані `folder:'01_ОРИГІНАЛИ'` `addFilesService.js:83`). **НЕ**
00_INBOX — INBOX лише джерело вводу, не призначення.

**3d createDocument (addFilesService.js:205-211).** Builder ін'єктований: модалка → форма
(`buildDocumentMetadata`), DP → `defaultAddFilesMetadata` (`addFilesService.js:59-90`,
дефолт `addFilesService.js:207-209`). У DP: `name`=ім'я файлу без розширення
(`addFilesService.js:69`); `category/author/procId/date = null` → маркер «потребує
перегляду» (`addFilesService.js:71-74`); `documentNature` виводиться
(`addFilesService.js:64-68`).

**4 Текст / OCR — що означає «без OCR».** addFiles САМ OCR не робить
(`addFilesService.js:21-24` — пост-крок консюмера). Консюмер `addFilesRun`:
- `ocrMode='full'` → для кожного доданого документа `ocrEnrichAddAsIs`
  (`DocumentPipelineContext.jsx:384-390`). Усередині: DOCX/HTML з `extractedText` →
  return без OCR (текст уже в searchable PDF, `DocumentPipelineContext.jsx:299-301`);
  скан/фото-PDF → `ocrService.extractText` (`DocumentPipelineContext.jsx:321`), що
  **пише `.layout.json` у 02_ОБРОБЛЕНІ** коли провайдер дав pageStructure (Document AI)
  (`ocrService.js:527-534`). Після — `update_document` з `documentNature`/`lastOcrAt`
  (`DocumentPipelineContext.jsx:323-328`).
- `ocrMode='none'` («без OCR») → **нічого**: OCR не запускається, артефактів у 02 немає,
  лише 01 + базові метадані (`DocumentPipelineContext.jsx:342-343`, `addFilesService.js:43-49`).
  **«без OCR» = без Vision і без Document AI, без жодного AI** — підтверджено (§6).

---

## 3. Станції диригента — на цьому шляху

Add-files **не проходить через диригента DocumentPipelineContext-стадій** (CONVERT/EXTRACT/
CLASSIFY/TRIAGE/SPLIT/PERSIST стадії стрім-нарізки). Це **окрема труба** (`addFilesService.js:1-10`).
Тому стадії диригента нарізки тут — **N/A (шлях їх не торкає)**. Єдині «станції» add-files —
це 6 кроків `addOneFile` (§2, всі ЖИВІ). Стадія `convertStage` стрім-труби тут не
викликається; замість неї живе пряма convert-станція `addOneFile` крок 1
(`addFilesService.js:135`) — **той самий фасад `convertToPdf`, інший виклик-сайт**.

Це сам по собі знахідка для §3.4 (полювання на зайве): `convertStage.js` стрім-труби і
прямий виклик у `addFilesService` — два сайти одного фасаду; перевірити при крос-аудиті чи
`convertStage` десь живий взагалі (винесено у `audit_dp_leanness_inventory.md` / scenario 1).

---

## 4. §3.5-D — Гранулярність контролю + готовність до «важеля»

**ocrMode / compression — на ВЕСЬ батч, НЕ по документу.** Передаються як `options` всього
прогону: `pipeline.addFiles(input, { ocrMode: settings.skipOcr?'none':'full',
compress: settings.compressAll===true })` (`index.jsx:781-785`). Усередині — один `ctx.compress`
на весь цикл (`addFilesService.js:323`), один `ocrMode` на результат (`addFilesService.js:296`).
**Немає per-document контролю** OCR/стиснення на цьому шляху.

**ПЕРСИСТЕНТНЕ поле «рівень участі в контексті» (full/digest/exclude) — ВІДСУТНЄ.**
Канонічна схема має ЛИШЕ `isKey: boolean` (`documentSchema.js:52`) — бінарний прапорець
«ключовий ⭐», НЕ триступеневий рівень участі. Немає поля типу `contextLevel`/`participation`
(grep по `documentSchema.js` — лише `isKey`). Тобто §7.3-«важіль» (ДВА ортогональні
значення: стан розпізнавання + рівень участі, правило #11) **ще не закладений**:
- стан розпізнавання — частково є (`documentNature` scanned/searchable + `lastOcrAt`,
  пишеться в `ocrEnrichAddAsIs` `DocumentPipelineContext.jsx:323-324`);
- рівень участі в контексті — **немає персистентного поля взагалі**; нині це лише
  `isKey` (бінарний) + рантайм-інференс у contextGenerator.

**Готовність до A7 (екран правки):** низька. addFiles віддає багатий per-file результат
(`addFilesService.js:231-243`: document, driveId, conversion, extractedText, warnings) —
сирий матеріал для екрану є, але **немає persisted-поля рівня участі**, яке екран міг би
редагувати. A7 доведеться спершу bump-нути схему (нове поле + міграція, правило #6/#11).

---

## 5. ФОРМАТИ — claim vs реальність (звірка converterService)

`convertToPdf` (`converterService.js:148-269`) — кожна гілка перевірена:

| Формат | Гілка | Реальність | Вирок |
|--------|-------|-----------|-------|
| PDF | `isPdf` :154-167 | passthrough, `converter:'passthrough'` | ✅ працює |
| HTML | `isHtml` :170-185 | `htmlToPdf.js` (145 рядків, реальний рендер) | ✅ працює |
| DOCX (.docx) | `isDocx` :188-218 | `docxToPdf.js` (218 рядків) | ✅ працює |
| зображення (jpg/png/webp/gif/bmp/tiff) | `isImage` :221-254 | `imageToPdf.js` (213 рядків, Canvas+jsPDF) | ✅ працює |
| HEIC/HEIF | через isImage→imageToPdf | `heicToJpeg.js` pre-step | ✅ працює |
| **усе інше** | :257-268 | **passthrough + warning** | ⚠ заливається як є |

**РОЗБІЖНІСТЬ З CLAUDE.md (окремий рядок):** CLAUDE.md описує `docxToPdf.js` як
«mammoth + html2pdf». **Код використовує pdf-lib**, НЕ html2pdf:
`docxToPdf.js:28` імпортує `htmlToPdfViaPdfLib` з `pdfLibHtmlRenderer.js`
(`docxToPdf.js:3,15,18`). Результат — **searchable PDF з текстовим шаром** (drawText),
тому `extractedText` є і OCR на нього не запускається (`DocumentPipelineContext.jsx:295-301`).
CLAUDE.md «mammoth→html2pdf» — застаріле.

**ДІРА `.doc`-як-PDF (підтверджено `file:line`):** старий бінарний `.doc`
(`application/msword`, OLE-сигнатура) **СВІДОМО НЕ** у `MIME_DOCX` (`converterService.js:73-75`,
коментар :70-72). `.doc` → гілка «усе інше» passthrough (`converterService.js:257-268`):
заливається в 01 як є, Drive показує прев'ю .doc. Документ **створюється** (НЕ
CONVERT_FAILED — це не помилка, а passthrough). АЛЕ: `documentNature` для .doc виведеться
з `inferNatureFromFile` (`addFilesService.js:64-68`), OCR на .doc-passthrough у full-режимі
не дасть тексту (Document AI не читає .doc) → `getDocumentText` поверне '' (немає layout,
немає текстового шару). Тобто **.doc додається, але стає «німим» документом без
видобувного тексту** — окрема знахідка, не злам, але деградація.

**PDF+DOCX мікс:** на add-files шляху проблеми НЕМАЄ — кожен файл конвертується своїм
шляхом одним циклом (`addFilesService.js:12-26`), DOCX→PDF, PDF→passthrough. Діра
PDF+DOCX (§3.5-B) стосується ЛИШЕ стрім-нарізки (toggle OFF), де роутер не має воріт для
не-PDF — це поза цим звітом (сценарій 1 / роутер).

**`originalBlob`:** лише DOCX зберігає оригінал поряд (`converterService.js:210`
`originalBlob: file`); HTML/зображення — `null` (:178,:246). addFiles заливає його як
`originalDriveId` (`addFilesService.js:191-203`), best-effort.

---

## 6. AI-точки на цьому шляху

**ЖОДНОЇ AI-точки в add-files — підтверджено.**
- addFiles ядро AI не кличе (`addFilesService.js` — нема жодного fetch/callAgent/Vision).
- `ocrMode='full'` пост-крок викликає **Document AI** через `ocrService.extractText`
  (`DocumentPipelineContext.jsx:321`) — це OCR-провайдер, не AI-агент; інструментується у
  самому ocrService, не тут.
- `ocrMode='none'` — нічого.
- **Vision-метадані ЛІКВІДОВАНО:** `metadataEnrichAddAsIs` / `extractMetadata` /
  `enrichDocumentWithVisionMetadata` **НЕ викликаються ніде** в add-files — лише згадані в
  коментарях (`DocumentPipelineContext.jsx:308,343`). Тобто claim CLAUDE.md / `index.jsx:68`
  («Vision читає 1-2 стор. → пропонує метадані» для skipOcr) — **МЕРТВИЙ опис**: skipOcr
  не запускає Vision взагалі. ⚠ Розбіжність коментаря `index.jsx:66-68` з реальністю
  (рішення власника прибрати metadataEnrich — `DocumentPipelineContext.jsx:343`).
- Конвертація DOCX/HTML/image — детермінована, 0 токенів (mammoth/pdf-lib/Canvas).

Інструментація `document_converted` (`activityTracker.report`) — у фасаді converterService
(`converterService.js:344-364`), одна точка, не дублюється; passthrough НЕ репортується
(:344). ai_usage у add-files не пишеться (немає AI-агента) — коректно.

---

## 7. Зовнішні залежності + режими відмови

| Залежність | Де | Відмова | Поведінка |
|-----------|-----|---------|-----------|
| convertToPdf | addFilesService.js:135 | throw | per-file `CONVERT_FAILED`, документ НЕ створюється, на Drive нічого (:136-141) |
| uploadFile (Drive) | addFilesService.js:180 | throw | per-file `UPLOAD_FAILED` (:181-187) |
| originalBlob upload | addFilesService.js:199 | throw | warning `ORIGINAL_UPLOAD_FAILED`, документ ВСЕ ОДНО створюється (:200-202) |
| compressFile | addFilesService.js:171 | throw | best-effort: console.warn, нестиснений файл (:172-174) |
| persistDocument | addFilesService.js:217 | throw/success:false | per-file `PERSIST_FAILED` (:218-229) |
| OCR пост-крок | DocumentPipelineContext.jsx:321 | throw | best-effort: console.warn, документ уже доданий (:330-334,387-388) |
| Drive материалізація (buildAddAsIs) | index.jsx:328 | `Drive HTTP {status}` | throw → catch у startProcessing :814, toast.error |

**Batch-стійкість:** один файл провалився → решта додається; `ok = documents.length > 0`
(`addFilesService.js:341-358`). Для одного файлу `ok:false` = той файл не додано.

**Модалка лишається відкрита при помилці?** Це DP-гілка (не модалка): при помилці
`startProcessing` ловить у try/catch (`index.jsx:814-816`), `toast.error`, `setRunning(false)`
у finally (:817), результат показується у вкладці attention (:807-812). Файли НЕ
скидаються при помилці (skidання лише на success :804). ✅ Правило #4 (blank page) дотримане
— весь async у try/catch.

**401 Drive:** не обробляється спеціально в add-files — throw з `driveRequest`/upload
підніметься як `UPLOAD_FAILED`/`CONVERT_FAILED`. Дружнього «перепідключіть Drive»
(правило #8) на цьому шляху НЕ видно — generic error message. ⚠ Прогалина.

**INBOX-конфлікт:** `startProcessing` блокує і показує `InboxConflictModal` коли є нові
файли і INBOX непорожній (`index.jsx:704-708`, resolve :824-831).

---

## 8. Канонічна схема

- **createDocument скрізь?** Так — `addFilesService.js:211` єдина точка; deps.createDocument
  ін'єктований (`DocumentPipelineContext.jsx:370` → `documentFactory.createDocument`). ✅
- **addedBy:** DP передає `addedBy:'user'` (`index.jsx:373`, `buildAddAsIsInput`), job
  успадковує (`addFilesService.js:84,311`), `createDocument` нормалізує
  (`documentFactory.js:74` normalizeAddedBy). ✅
- **source:** DP передає `source:'manual'` (`index.jsx:372`), успадковується job→metadata
  (`addFilesService.js:88-89`), нормалізується (`documentFactory.js:90`). Комбінація
  `{addedBy:'user', source:'manual'}` — канонічна (CLAUDE.md disambiguation). ✅
- **ECITS-шлях:** коли add-files викликається з ecitsInboxWatcher — `source:'court_sync'`,
  `addedBy:'system'` (`DocumentPipelineContext.jsx:438-439`) — теж канонічно (хоча це
  `run`, не addFiles; для повноти).
- **PERSIST через executeAction:** `add_documents` через `document_processor_agent`
  (`DocumentPipelineContext.jsx:373`) — штатний шар audit/billing/permissions. Жодного
  обходу. ✅
- **folder:** `01_ОРИГІНАЛИ` (`addFilesService.js:83`). ✅

---

## 9. Покриття тестами

| Тест | Що покриває |
|------|-------------|
| `tests/unit/addFiles.test.js` (299 рядків, ~30 it) | фабрика/deps-валідація, intake (NO_CASE/NO_FILES), щасливий шлях (convert+upload+persist+події), Drive passthrough, метадані (default+форма), per-file помилки (CONVERT/UPLOAD/PERSIST_FAILED), batch-стійкість, DOCX originalBlob, mergeArtifacts, події, стиснення (5 кейсів) |
| `tests/integration/dp4-add-as-is.test.jsx` | DP-гілка skipPdfSlicing наскрізно (UI→executor) |
| `tests/integration/dp4-zip-ingest.test.jsx` | ZIP front-step (сценарій 4) |
| `tests/unit/AddDocumentModal.test.jsx` | модалка single-add (інший консюмер того ж ядра) |

**Сильне юніт-покриття ядра** addFiles. **Прогалини:**
- OCR пост-крок (`ocrEnrichAddAsIs`) — покритий лише моками (реальний Document AI на
  add-as-is наскрізно НЕ тестований) → кандидат на Playwright e2e (§3.5-F, клас #20).
- `.doc`-passthrough → «німий документ без тексту» — НЕ тестований.
- Реальна конвертація (mammoth/pdf-lib/Canvas) — браузерні залежності, юніти мокають
  converterService; реальна якість DOCX/HEIC→PDF лише ручною перевіркою.
- 401 Drive friendly-handling на add-files — не тестований (бо не реалізований).

---

## 10. Прогалини / відкриті питання

1. **Vision-метадані для skipOcr — мертвий опис.** Коментар `index.jsx:66-68` обіцяє
   «Vision читає 1-2 стор. → метадані», але `metadataEnrichAddAsIs` прибрано
   (`DocumentPipelineContext.jsx:343`). skipOcr = БЕЗ жодного AI. → виправити коментар/спеку.
2. **`.doc` → німий документ.** Passthrough у 01 без видобувного тексту (Document AI .doc
   не читає, текстового шару нема). Не злам, але деградація — потребує рішення (відхиляти?
   конвертувати через інший шлях? warning адвокату?).
3. **CLAUDE.md «docxToPdf mammoth→html2pdf» застаріле** — реально pdf-lib
   (`pdfLibHtmlRenderer.js`), searchable PDF. → оновити CLAUDE.md TASK A розділ.
4. **Немає персистентного поля «рівень участі в контексті»** (§3.5-D / §7.3). Лише `isKey`
   бінарний. A7 (екран правки) і «важіль» вимагатимуть bump схеми + міграцію.
5. **Гранулярність — лише батч.** ocrMode/compress на весь прогін, не per-document.
   Для A7 потрібен per-document контроль.
6. **401 Drive — generic error**, без friendly «перепідключіть Drive» (правило #8) на
   add-files шляху.
7. **Drive-source passthrough у CONVERT (addFilesService.js:131) у DP-гілці не активується**
   — `buildAddAsIsInput` материалізує Drive у raw File (`index.jsx:326-334`), отже Drive-файли
   у DP йдуть повну конвертацію, а passthrough-гілка — лише для модалки-пікера. Коментар
   `addFilesService.js:130-131` («пікер») відповідає, але DP-flow читач може сплутати.

**Серверна міграція (блокери, для крос-аудиту):** конвертери browser-only (Canvas/jsPDF/
mammoth у клієнті — `imageToPdf.js`, `docxToPdf.js`); compressFrontStep browser-only
(`imageCompressor` canvas); downscale browser-only (`index.jsx:339`); Drive-OAuth з клієнта
(`uploadFileToCaseFolder`); Document AI з клієнта (OCR пост-крок). Усі — кандидати на
переїзд на сервер під SaaS. Деталі — `audit_dp_server_migration_readiness.md`.
