# Звіт: обробка помилок Document AI, resumable retry, опційний Claude Vision

**Дата:** 2026-05-11
**Гілка:** main
**Тести:** 531 зелений (+23 нових)
**Білд:** чистий

---

## 1. Що зроблено для обробки помилок documentAi

### Класифікація помилок (4 типи)

У `src/services/ocr/documentAi.js` додано експортовану функцію `classifyError(e, httpStatus)` яка перетворює будь-яку помилку на один з 4 кодів:

| Код | Тригери | Поведінка |
|-----|---------|-----------|
| **AUTH** | HTTP 401/403; явний `e.code='AUTH'` | Без retry, без fallback — токен Drive протух |
| **QUOTA** | HTTP 429; явний `e.code='QUOTA'` | Без retry — ліміт Document AI |
| **UNSUPPORTED** | HTTP 400 від Document AI; ZIP-PDF (ЄСІТС); >20MB; pdf-lib load fail | Без retry — повторна спроба не змінить вердикт |
| **NETWORK** | 5xx, `AbortError`, `failed to fetch`, `load failed`, `ECONNRESET`, `ENOTFOUND`, `ECONNREFUSED`, `timeout`, явний `code='TIMEOUT'`/`'UNKNOWN'`, дефолт | Retry 3 рази з backoff |

Принципово: **UNKNOWN мапиться у NETWORK** — філософія DELTA + краще зайвий retry ніж тиха ескалація на claudeVision при моргнутій мережі планшета.

### Retry стратегія

3 спроби на чанк з exponential backoff: **1s, 3s, 9s** (worst-case 13 секунд між першою і останньою спробою + 3×timeout). Реалізовано у внутрішньому `executeWithRetry(fn, { onRetry, signal })`.

NETWORK і UNKNOWN — повторюються. AUTH / QUOTA / UNSUPPORTED — кидаються негайно.

### Resumability

При нарізці великого PDF на чанки по 15 сторінок:

```
ResumeState = {
  driveId, totalPages,
  processedRanges: [{ startPage, endPage }],     // 1-based inclusive
  textChunks: [{ startPage, endPage, text }],
  pageStructureAll: [...],                        // з глобальним pageNumber
  lastFailedRange: { startPage, endPage } | null,
  lastError: { code, message } | null,
  provider: 'documentAi',
  savedAt: timestamp,
}
```

Зберігається у новому модулі `src/services/ocr/resumeStore.js` — **in-memory Map** keyed by `driveId`. Свідомо без persistence на Drive/localStorage (DELTA, не псує реєстр, не вимагає міграцій). Якщо адвокат закрив вкладку — наступний раз з нуля; Document AI повторне розпізнавання дешеве.

На кожному успішному чанку — state записується у мапу. На вичерпанні retry для NETWORK — state лишається, кидається `Error { code:'NETWORK', partial:true, processedPages, totalPages, lastFailedRange }`. На AUTH/QUOTA/UNSUPPORTED — state очищується (повтор не допоможе). На повному успіху — state очищується, текст склеюється з усіх чанків.

---

## 2. Як прибрано claudeVision з default fallback

У `src/services/ocr/providerMatrix.js`:

```diff
- chain: ['pdfjsLocal', 'documentAi', 'claudeVision'],   // PDF
+ chain: ['pdfjsLocal', 'documentAi'],
- chain: ['documentAi', 'claudeVision'],                  // image
+ chain: ['documentAi'],
```

claudeVision **залишається зареєстрованим** у `ocrService.js` providers map. Доступний:
- через `options.forceProvider='claudeVision'` — для UI діалогу підтвердження адвоката;
- через legacy use cases (Document Processor викликає `analyzePDFWithDocumentBlock` напряму через Anthropic API, не через `ocrService` — він і не торкається наших змін).

Додано test guard `tests/unit/ocrProviderMatrix.test.js` що жоден default chain не містить `claudeVision` — щоб майбутні зміни не повернули silent fallback.

У `ocrService.js` додано явні умови `break` для трьох кодів які НЕ каскадують:
- AUTH/QUOTA — як було;
- NETWORK з `partial=true` — Document AI вичерпав retry, не дублюємо роботу на наступному провайдері;
- NETWORK без partial — атомарний провайдер не зміг навіть стартувати, наступний теж не зможе.

---

## 3. Toast повідомлення і діалог підтвердження

Узагальнено в інлайн-helper `runOcrWithRetryUI({ file, doc, caseId, onExecuteAction, silentSuccess })` у `CaseDossier/index.jsx`. Викликається з:
- onReprocess (рекордера документа);
- AddDocumentModal OCR pipeline (після успішного add_document).

### Сценарії

| Подія | Toast |
|-------|-------|
| Старт | `info "Розпізнавання..." (persistent)` |
| NETWORK retry 2/3 | dismiss попередній; (внутрішньо: trackingaccepts retry counter) |
| Успіх після retry | `success "Розпізнавання продовжується... Готово"` |
| Успіх стандартно (cacheWritten) | `success "Текст розпізнано і збережено"` |
| Успіх (cache не записано) | `warning "Текст розпізнано, але не вдалось зберегти кеш на Drive"` |
| UNSUPPORTED | `error "Цей формат не підтримується для OCR" — "Документ збережено у форматі оригіналу."` |
| AUTH | `error "Помилка доступу до OCR сервісу" — "Зверніться до адміністратора."` |
| QUOTA | `error "Вичерпано ліміт Document AI" — "Спробуйте за хвилину."` |
| **NETWORK exhausted** | **systemConfirm з вибором (див. нижче)** |
| Адвокат обрав «пізніше» | `info "Стан збережено. Натисніть «Перерозпізнати» коли мережа покращиться" — "Опрацьовано N з M сторінок."` |
| Claude Vision запущено | `info "Розпізнавання через Claude Vision..." (persistent)` |
| Claude Vision також впав | `error "Claude Vision також не зміг розпізнати"` + локалізована причина |

### Діалог підтвердження

При `code === 'NETWORK'` (вичерпані 3 retry на чанку):

```
┌─ Документ AI недоступний ──────────────────────────────────┐
│                                                             │
│  Не вдалось розпізнати документ через Document AI. Хочете  │
│  спробувати через Claude Vision? Це повільніше і коштує    │
│  більше, але може спрацювати при тривалих проблемах з      │
│  Google API.                                                │
│                                                             │
│  Опрацьовано 15 з 45 сторінок.                              │
│                                                             │
│        [ OK (Так, через Claude Vision) ]   [ Скасувати ]    │
└─────────────────────────────────────────────────────────────┘
```

(Поточний `systemConfirm` має дві кнопки OK/Скасувати — заголовок і текст несуть смисл «Так» / «Повернутись пізніше»; роздільні підписи кнопок — окремий мікро-TASK для SystemModal якщо знадобиться.)

---

## 4. Приклад resumable retry

PDF `позов_45стор.pdf` на 45 сторінок → 3 чанки (1-15, 16-30, 31-45).

**Спроба 1 (мережа моргає на чанку 2):**
```
chunk1 (1-15)   →  Document AI 200 OK → state.processedRanges=[{1,15}]
chunk2 (16-30)  →  3× fetch failed (1s, 3s, 9s backoff)
                →  state.lastFailedRange={16,30}, lastError={NETWORK}
                →  throw Error { code:'NETWORK', partial:true, processedPages:15, totalPages:45 }
```

resumeStore у пам'яті:
```js
Map { 'drive_file_123' → {
  totalPages: 45,
  processedRanges: [{ startPage:1, endPage:15 }],
  textChunks: [{ startPage:1, endPage:15, text:'<15 сторінок тексту>' }],
  pageStructureAll: [...15 сторінок...],
  lastFailedRange: { startPage:16, endPage:30 },
} }
```

UI показує діалог. Адвокат тисне «Повернутись пізніше».

**Спроба 2 (адвокат вимкнув літачок і натиснув Перерозпізнати):**
```
chunk1 (1-15)   →  пропускаємо (isRangeProcessed=true)
chunk2 (16-30)  →  Document AI 200 OK → state.processedRanges=[{1,15},{16,30}]
chunk3 (31-45)  →  Document AI 200 OK
                →  склейка sorted by startPage → text + pageStructure
                →  clearResume('drive_file_123')
                →  cacheWritten / layoutWritten на Drive
```

Document AI повторно НЕ обробляв перші 15 сторінок — економія часу і токенів.

---

## 5. Опційний fallback на claudeVision через підтвердження

Коли адвокат у діалозі обрав «Так, через Claude Vision»:

```js
ocrService.extractText(file, {
  skipCache: true,
  forceProvider: 'claudeVision',
});
```

всередині `extractText`:
- читає resumeStore.getResume(driveId);
- якщо знайдено state з `provider='documentAi'` і `lastFailedRange` — передає у claudeVision `options.startPage = lastFailedRange.startPage`;
- claudeVision у новому коді (`src/services/ocr/claudeVision.js`) шанує startPage — рендерить тільки сторінки `startPage..numPages` через canvas;
- ocrService склеює результат: `mergedTextPrefix` (з documentAi textChunks) + результат claudeVision;
- pageStructure: збирає вже наявні з documentAi (Claude Vision поки не повертає);
- пише `.txt` і `.layout.json` на Drive як завжди;
- clearResume(driveId).

Якщо resumeStore порожній — claudeVision просто обробляє весь файл з 1-ї сторінки. (Це той самий шлях що використовувався раніше, коли claudeVision був у default chain — тільки тепер ВИКЛЮЧНО за явним вибором.)

---

## 6. Інструкція тестування 5 сценаріїв (літачок на планшеті)

### Сценарій (а) — Стабільна мережа

1. Відкрити справу з документом.
2. У Viewer натиснути «Перерозпізнати».
3. Очікувано: toast «Розпізнавання...» → toast «Текст розпізнано і збережено».
4. Виміряти: не довше ніж раніше до фіксу.

### Сценарій (б) — Короткочасний літачок (5-10 секунд)

1. Завантажити PDF на 5-15 сторінок (один чанк).
2. Натиснути «Перерозпізнати».
3. Через 1-2 сек включити літачок.
4. Через 5-10 сек вимкнути літачок.
5. Очікувано: документAi кидає AbortError → retry через 1s → можливо ще раз через 3s → успіх. Toast «Розпізнавання продовжується... Готово».

### Сценарій (в) — Тривалий літачок (30-60 секунд)

1. Завантажити PDF на 30-45 сторінок (2-3 чанки).
2. «Перерозпізнати» → дочекатись поки оброблюється чанк 2.
3. Включити літачок і ТРИМАТИ.
4. Очікувано: 3 retry × backoff (1+3+9s ≈ 13s) → кидається NETWORK partial → з'являється діалог:
   ```
   Не вдалось розпізнати документ через Document AI. Хочете
   спробувати через Claude Vision? ...
   Опрацьовано 15 з 45 сторінок.
   ```

### Сценарій (г) — «Повернутись пізніше»

1. Продовжити з (в): натиснути «Скасувати» (= повернутись пізніше).
2. Очікувано: toast «Стан збережено. Натисніть Перерозпізнати коли мережа покращиться».
3. Вимкнути літачок.
4. Знову натиснути «Перерозпізнати» на тому ж документі.
5. Очікувано: чанк 1 пропущено, обробка починається з 16-ї сторінки. Toast «Розпізнавання продовжується... Готово».
6. Виміряти: загальний час менший ніж повторне з нуля.

**Важливо:** state переживає лише поки React state живий. Якщо адвокат **закрив вкладку** перед «Повернутись пізніше», наступний раз почне з 1-ї сторінки. Це чесне обмеження — задокументовано вище.

### Сценарій (д) — «Так, через Claude Vision»

1. Продовжити з (в): натиснути OK (= Так).
2. Очікувано: toast «Розпізнавання через Claude Vision...» (persistent).
3. Claude Vision рендерить сторінки 16-45 через canvas, шле в Anthropic API.
4. Очікувано: `success "Текст розпізнано і збережено"`. Текст у `.txt` містить і documentAi-частину (1-15), і Claude Vision-частину (16-45).
5. Перевірити: `ai_usage` має новий запис з `agentType='document_parser'`, model claude-sonnet-4.

### Edge case — повторне розпізнавання після успіху

Після успішного завершення resumeStore очищується. Наступне «Перерозпізнати» — з нуля (як було раніше з `skipCache: true`).

---

## 7. Повна карта використання OCR і провайдерів у системі

| # | Файл | Виклик | Провайдер | Сценарій | Зачіпає TASK |
|---|------|--------|-----------|----------|--------------|
| 1 | `CaseDossier/index.jsx:997` | `ocrService.extractTextBatch` | через ocrService — pdfjsLocal → documentAi | Context generation (collect texts from 01_ОРИГІНАЛИ/02_ОБРОБЛЕНІ) | ✅ Так — батч тепер теж має retry per file; помилки NETWORK не silent-fallback |
| 2 | `CaseDossier/index.jsx:2451` (через `runOcrWithRetryUI`) | `ocrService.extractText({skipCache:true})` | через ocrService — pdfjsLocal → documentAi | **Reprocess документа** (Viewer кнопка «Перерозпізнати») | ✅ Так — основна точка фіксу. Діалог підтвердження тут. |
| 3 | `CaseDossier/index.jsx:3018` (через `runOcrWithRetryUI`) | `ocrService.extractText` | через ocrService — pdfjsLocal → documentAi | AddDocumentModal — OCR pipeline після add_document | ✅ Так — той самий діалог через спільний helper |
| 4 | `CaseDossier/index.jsx:2906` | `ocrService.hasOcrSupport` | — | guard перед OCR pipeline у AddDocumentModal | ❌ Тільки matrix lookup |
| 5 | `DocumentViewer/DocumentViewerFooter.jsx:6` | `getCachedText` | — | Читання вже-розпізнаного `.txt` з 02_ОБРОБЛЕНІ | ❌ Тільки кеш, без OCR |
| 6 | `DocumentViewer/DocumentViewerContent.jsx:5` | `getCachedText`, `localizeOcrError` | — | Render тексту в Viewer | ❌ Тільки кеш + локалізація |
| 7 | `DocumentProcessor/index.jsx:155` (`analyzePDFWithDocumentBlock`) | direct `fetch` на `api.anthropic.com` з `document_block` source type | direct Anthropic API, **НЕ через ocrService** | Визначення меж документів у PDF Брановського | ❌ НЕ ЧІПАЄМО — це не OCR, це boundary detector через Claude |
| 8 | `App.jsx:1302` (`analyzeImageWithVision`) | direct `fetch` на `api.anthropic.com` з `image` source type | direct Anthropic API | Quick Input — аналіз скріншоту/фото через Claude (повертає JSON для створення справи) | ❌ НЕ ЧІПАЄМО — не OCR pipeline, інший use case |
| 9 | `App.jsx:1462`, `App.jsx:1742` | direct `fetch` на `api.anthropic.com` | direct Anthropic API | QI текстовий аналіз (інші режими) | ❌ НЕ ЧІПАЄМО |
| 10 | `src/services/ocr/claudeVision.js` (як провайдер у мапі) | викликається ocrService при `forceProvider='claudeVision'` | Anthropic API через провайдер | Тепер ТІЛЬКИ за явним вибором адвоката в діалозі | ✅ Так — додано `options.startPage` для resume з місця збою |

**Підсумок:**
- Через `ocrService` йдуть 3 точки в CaseDossier (#1, #2, #3) — всі тепер мають retry, класифікацію, опційний Claude Vision fallback.
- `getCachedText` (#5, #6) — лише читає кеш, незалежно від pipeline.
- DocumentProcessor (#7) і Quick Input (#8, #9) використовують Claude API напряму для НЕ-OCR задач — не торкаємось.
- `claudeVision.js` тепер не каскадує автоматично; чекає явного виклику з `forceProvider`.

---

## 8. Що НЕ зроблено і чому

### а) `systemConfirm` має «OK / Скасувати», не «Так, через Claude Vision / Повернутись пізніше»
Поточний модуль `SystemModal` приймає `(message, title)` і повертає boolean. Перейменування кнопок під конкретний діалог — окремий мікро-TASK на додавання `options.okLabel`/`cancelLabel` в SystemModal. Зараз заголовок і текст несуть смисл вибору, читач розуміє.

### б) Resumability claudeVision частково
Якщо адвокат явно обрав Claude Vision і той теж впав посередині — стан НЕ зберігається (claudeVision робить ОДИН Anthropic call на весь діапазон сторінок). Resumability Claude Vision вимагає або нарізки на чанки сторінок з власним state machine, або per-page seqential обробки. Це окрема робота — інтеграцію з resumeStore я свідомо лишив тільки на documentAi (там вже була нарізка).

### в) Document Processor (#7) НЕ переведено на ocrService
Він робить специфічну роботу (boundary detection через Claude `document_block`) яка не вписується в OCR-провайдерний контракт `{ text, pageCount, pageStructure }`. Залишається як є. Якщо в майбутньому DP v2 захоче використовувати OCR для попереднього text-readout — це окремий TASK.

### г) Quick Input (#8) НЕ переведено на ocrService
Quick Input аналізує одиничне зображення/файл і отримує СТРУКТУРОВАНИЙ JSON для створення справи — це не OCR, а LLM-парсинг. Залишається через `analyzeImageWithVision`.

### д) Persistence resumeStore (IndexedDB)
DELTA: 80% сьогодні достатньо. Якщо в реальній роботі виявиться що адвокат часто закриває вкладку посеред довгої обробки — окремий TASK на IndexedDB.

### е) Toast update API (не dismiss+create)
Поточний `toast.js` не має `toast.update(id, ...)`. Прогрес показуємо через dismiss+create. Працює, але можна красивіше — окремий TASK для toast service.

---

## Тести

- **Існуючі 508+ зелені** — оновлено очікування для providerMatrix і ocrService під нову поведінку.
- **23 нових юніт-тестів** у `tests/unit/ocrDocumentAiRetry.test.js`:
  - 9 тестів для `classifyError` (всі 4 коди, edge cases)
  - 7 тестів для retry logic (успіх з 1-ї/2-ї/3-ї спроби; всі провалились; AUTH/QUOTA/UNSUPPORTED без retry)
  - 4 тести для resumable state (повний успіх; partial збереження; продовження; AUTH очищає)
  - 2 тести для resumeStore helper API
- **1 новий guard test** у providerMatrix — claudeVision НЕ у default chain.

**Підсумок: 531 passed (38+3 нових файлів).**
