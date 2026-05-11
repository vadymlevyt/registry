Мікро-TASK fix — обробка помилок documentAi, resumable retry, опційний fallback на claudeVision через підтвердження адвоката

КОНТЕКСТ

Поточна поведінка ocrService створює дві проблеми (підтверджено тобою у попередньому уточненні):
- Жодних retry — одна спроба на чанк, перший збій = одразу fallback
- Будь-який throw з documentAi (timeout, network, 5xx, обірваний fetch, pdf-lib помилка) вважається надійним збоєм і silent fallback на claudeVision
- Це призводить до даремних витрат токенів Claude при моргнутій мережі та непередбачуваної якості (claudeVision не тестується для типових документів адвоката)

Адвокат працює на планшеті Lenovo Yoga Tab 13 з мобільним інтернетом який може моргати. Мережеві проблеми мають викликати retry того ж documentAi, не silent fallback.

ЗАВДАННЯ

1. Викинути claudeVision з default fallback ланцюжка ocrService:
   - PDF: ['pdfjsLocal', 'documentAi']
      - Зображення: ['documentAi']
         - claudeVision провайдер у коді ЗАЛИШИТИ (він використовується у Document Processor — не чіпати ті виклики)
            - Прокоментувати у providerMatrix.js чому виключений з default chain
            
            2. Класифікація помилок documentAi:
               - NETWORK (timeout, ECONNRESET, ENOTFOUND, ECONNREFUSED, обірваний fetch, 5xx) — повторювана
                  - UNSUPPORTED — файл не підтримується documentAi
                     - AUTH/QUOTA — проблема акаунту/квоти
                        - UNKNOWN — за замовчуванням як NETWORK (краще retry ніж тиха ескалація)
                        
                        3. Retry стратегія для NETWORK і UNKNOWN:
                           - 3 спроби на чанк з exponential backoff (1s, 3s, 9s)
                              - Між спробами — пауза, не блокує UI
                                 - Кожна спроба — той самий documentAi на той самий чанк
                                 
                                 4. Resumability — відновлення з точки збою:
                                    - Якщо PDF нарізаний на чанки і обробка чанку N+1 впала з NETWORK — попередньо оброблені чанки 1..N залишаються
                                       - Retry повторює тільки той чанк що впав
                                          - Якщо всі retry чанку вичерпані — попередній результат не пропадає
                                             - Зберігається інформація про опрацьовані чанки щоб Перерозпізнати продовжив з місця збою
                                             
                                             5. Toast повідомлення:
                                             
                                                При першому NETWORK збої:
                                                   - Інформаційний toast "Зʼєднання нестабільне. Повторюю спробу..."
                                                      - Оновлюється текст при кожній наступній спробі
                                                      
                                                         При успішному retry:
                                                            - "Розпізнавання продовжується..." → "Готово"
                                                            
                                                               При UNSUPPORTED:
                                                                  - Toast.error "Цей формат не підтримується для OCR. Документ збережено у форматі оригіналу."
                                                                     - Без fallback на claudeVision
                                                                        - Документ залишається у системі без .txt/.layout.json
                                                                        
                                                                           При AUTH/QUOTA:
                                                                              - Toast.error "Помилка доступу до OCR сервісу. Зверніться до адміністратора."
                                                                                 - Без fallback
                                                                                 
                                                                                 6. Опційний fallback на claudeVision через підтвердження адвоката:
                                                                                 
                                                                                    При вичерпанні всіх retry NETWORK помилок (3 спроби × всі чанки якщо нарізано) — замість простого toast.error показуємо діалог з вибором:
                                                                                    
                                                                                       "Не вдалось розпізнати документ через Document AI. Хочете спробувати через Claude Vision? Це повільніше і коштує більше, але може спрацювати при тривалих проблемах з Google API.
                                                                                          
                                                                                             Опрацьовано N з M сторінок."
                                                                                             
                                                                                                Кнопки:
                                                                                                   [Так, через Claude Vision]  [Повернутись пізніше]
                                                                                                   
                                                                                                      Якщо адвокат натискає "Так, через Claude Vision":
                                                                                                         - Викликається claudeVision на той самий файл
                                                                                                            - Якщо є інформація про опрацьовані чанки попередньої спроби documentAi — claudeVision продовжує з місця збою
                                                                                                               - Якщо ні — починає з нуля
                                                                                                                  - Toast прогресу як при documentAi
                                                                                                                  
                                                                                                                     Якщо адвокат натискає "Повернутись пізніше":
                                                                                                                        - Стан зберігається (опрацьовані чанки на Drive у тимчасовому місці або у документі реєстру)
                                                                                                                           - При наступному натисканні Перерозпізнати — повторюється спроба documentAi з місця збою
                                                                                                                              - Якщо знову не вдається — знову показується діалог з вибором
                                                                                                                              
                                                                                                                                 Це робить claudeVision активним ЯВНО за рішенням адвоката, не silent fallback. Адвокат бачить що чекає більше і платить більше — свідомий вибір.
                                                                                                                                 
                                                                                                                                 ПОЗА СКОПОМ
                                                                                                                                 
                                                                                                                                 - Document Processor — не чіпати
                                                                                                                                 - Quick Input — не чіпати  
                                                                                                                                 - pdfjsLocal → documentAi fallback при UNSUPPORTED (немає текстового шару) — залишається як зараз
                                                                                                                                 - Сам провайдер claudeVision у коді — залишається, працює коли реально потрібен
                                                                                                                                 - Складна класифікація помилок поза 4 типами (NETWORK/UNSUPPORTED/AUTH/UNKNOWN) — не ускладнюємо зараз
                                                                                                                                 
                                                                                                                                 ТЕСТУВАННЯ
                                                                                                                                 
                                                                                                                                 Додати unit-тести для:
                                                                                                                                 - Класифікації помилок (NETWORK vs UNSUPPORTED vs AUTH через різні error types)
                                                                                                                                 - Retry logic (1 спроба успішна, 2 спроби успішна, 3 спроби всі провалились)
                                                                                                                                 - Resumability — продовження з точки збою при Перерозпізнати
                                                                                                                                 - Діалогу підтвердження claudeVision (mock UI interaction)
                                                                                                                                 
                                                                                                                                 Існуючі тести 508+ мають залишитись зелені.
                                                                                                                                 
                                                                                                                                 ПЕРЕВІРКА ВІДПОВІДНОСТІ ФІЛОСОФІЇ
                                                                                                                                 
                                                                                                                                 Перед реалізацією подивись свіжими очима на цей TASK з точки зору:
                                                                                                                                 
                                                                                                                                 1. DEVELOPMENT_PHILOSOPHY.md — однозначність, прозорість, без двозначних абстракцій
                                                                                                                                 2. ACTIONS і executeAction архітектура — чи нові дії потребують реєстрації як action
                                                                                                                                 3. PERMISSIONS matrix — чи операції OCR і fallback правильно розподілені за ролями
                                                                                                                                 4. Принцип Provider Pattern і матриці здатностей — чи нова логіка не порушує контракти провайдерів
                                                                                                                                 5. Resumability через метадані — як саме зберігати інформацію про опрацьовані чанки (у документі реєстру, у тимчасовому файлі на Drive, у localStorage) — обрати найчистіший варіант
                                                                                                                                 
                                                                                                                                 Якщо бачиш конфлікти з філософією або кращий варіант реалізації — напиши коротко перед тим як писати код. Не критика заради критики — тільки реальні архітектурні моменти що варто узгодити до реалізації.
                                                                                                                                 
                                                                                                                                 Якщо все узгоджується — переходимо до реалізації без зайвих коментарів.
                                                                                                                                 
                                                                                                                                 ЗВІТ
                                                                                                                                 
                                                                                                                                 Створити report_ocr_error_handling.md з:
                                                                                                                                 
                                                                                                                                 1. Що зроблено для обробки помилок documentAi (класифікація, retry, resumability)
                                                                                                                                 2. Як прибрано claudeVision з default fallback
                                                                                                                                 3. Як працюють toast повідомлення і діалог підтвердження при різних типах помилок
                                                                                                                                 4. Приклад resumable retry (як саме зберігаються опрацьовані чанки)
                                                                                                                                 5. Як працює опційний fallback на claudeVision через підтвердження адвоката
                                                                                                                                 6. Інструкція тестування 5 сценаріїв (адвокат буде тестувати через літачок на планшеті):
                                                                                                                                    а) Розпізнавання при стабільній мережі — як було, без змін
                                                                                                                                       б) Літачок увімкнено на 5-10 сек під час обробки чанку — retry успішний, продовжує
                                                                                                                                          в) Літачок увімкнено на 30-60 сек — 3 retry вичерпані, зʼявляється діалог підтвердження
                                                                                                                                             г) Адвокат натискає "Повернутись пізніше" → виключає літачок → Перерозпізнати → продовжує з documentAi з місця збою
                                                                                                                                                д) Адвокат натискає "Так, через Claude Vision" → claudeVision обробляє з місця збою
                                                                                                                                                
                                                                                                                                                7. ПОВНА КАРТИНА використання ocrService і провайдерів у системі:
                                                                                                                                                   
                                                                                                                                                      Пройтись по всьому коду і знайти ВСІ місця які викликають ocrService.extract() або напряму викликають провайдери (documentAi, claudeVision, pdfjsLocal). Для кожного місця написати:
                                                                                                                                                         - Файл і компонент
                                                                                                                                                            - Який провайдер викликається (через ocrService чи напряму)
                                                                                                                                                               - У яких сценаріях
                                                                                                                                                                  - Чи відображається на нього цей фікс (через ocrService) чи ні (напряму)
                                                                                                                                                                     
                                                                                                                                                                        Особливо перевірити:
                                                                                                                                                                           - AddDocumentModal — як зараз
                                                                                                                                                                              - Перерозпізнати у документі — як зараз
                                                                                                                                                                                 - Document Processor — який провайдер використовує, чи через ocrService чи напряму (НЕ ЧІПАТИ, тільки задокументувати)
                                                                                                                                                                                    - Quick Input — який провайдер використовує (НЕ ЧІПАТИ, тільки задокументувати)
                                                                                                                                                                                       - Будь-які інші місця які можу не памʼятати
                                                                                                                                                                                       
                                                                                                                                                                                       8. Що НЕ зроблено і чому
                                                                                                                                                                                       
                                                                                                                                                                                       КОМІТ
                                                                                                                                                                                       
                                                                                                                                                                                       npm test (508+ зелені після змін)
                                                                                                                                                                                       npm run build (чистий)
                                                                                                                                                                                       git add -A
                                                                                                                                                                                       git commit -m "fix: documentAi error classification, resumable retry, optional Claude Vision fallback via user confirmation"
                                                                                                                                                                                       git push# Звіт: OCR Provider Matrix і Metadata Extension

**Дата:** 2026-05-11
**Тип:** мікро-TASK
**Гілка:** main

## 1. Що зроблено

OcrService розширено на матрицю провайдерів і збереження структурних метаданих:

- Новий файл `src/services/ocr/providerMatrix.js` — джерело правди для матриці замовника (який провайдер обробляє який тип файлу) і матриці виконавця (що повертає провайдер).
- `documentAi` тепер повертає `pageStructure` — масив сторінок з повною структурою API (paragraphs, blocks, tables, headers, footers, layout, dimension). Кожна сторінка додатково має `_text` — витягнутий через `textAnchor.textSegments` текст сторінки, що робить layout.json самодостатнім.
- `pdfjsLocal` і `claudeVision` — без `pageStructure` (за дизайном). pdfjs займається тільки витягом текстового шару; claudeVision видає plain text (структурний промпт — окремий TASK коли провайдер реально стане основним).
- Усі провайдери перейменували поле `pages: number` → `pageCount: number`. Це усуває двозначність з новим `pageStructure: Array` (принцип однозначності з DEVELOPMENT_PHILOSOPHY.md).
- OcrService при кожному успішному виклику пише `.txt` як раніше; додатково пише `.layout.json` тільки якщо відповідь провайдера фактично містить непорожній `pageStructure`. Без проміжної декларації — факт у відповіді.
- `driveService.deleteOcrCacheForDocument` тепер видаляє пару `.txt` + `.layout.json` як одне ціле. Гарантує що після «Розпізнати зараз» не лишається сирітський layout зі старим текстом.

## 2. Файли — створено / змінено

| Файл | Дія |
|------|-----|
| `src/services/ocr/providerMatrix.js` | **new** — матриці, `selectProviderChain`, `hasAnyProvider` |
| `src/services/ocr/documentAi.js` | змінено — `pageStructure` з `_text` пер сторінку, переіндексація pageNumber для нарізаних PDF |
| `src/services/ocr/claudeVision.js` | змінено — `pages` → `pageCount`, оновлено header контракту |
| `src/services/ocr/pdfjsLocal.js` | змінено — `pages` → `pageCount`, оновлено header контракту |
| `src/services/ocrService.js` | переписано — `selectProviderChain`, парний запис `.txt` + `.layout.json`, нове поле `hasLayout` у результаті |
| `src/services/driveService.js` | змінено — `deleteOcrCacheForDocument` видаляє пару |
| `tests/unit/ocrProviderMatrix.test.js` | **new** — 14 тестів матриці |
| `tests/unit/ocrService.test.js` | **new** — 9 тестів запису артефактів |

## 3. Матриця у коді — `providerMatrix.js`

```js
// Ланцюжки фолбеку за сімейством файлів. Перший ланцюжок з true-предикатом
// виграє. Один сенс: "ось ланцюжок який треба пробувати у порядку".
const FALLBACK_CHAINS_BY_MIME = [
  {
    name: 'pdf',
    test: (file) => file?.mimeType === 'application/pdf' || /\.pdf$/i.test(file?.name),
    chain: ['pdfjsLocal', 'documentAi', 'claudeVision'],
  },
  {
    name: 'image',
    test: (file) => file?.mimeType?.startsWith('image/'),
    chain: ['documentAi', 'claudeVision'],
  },
  // google_doc, text, html — тільки pdfjsLocal
];

export function selectProviderChain(file) {
  for (const entry of FALLBACK_CHAINS_BY_MIME) {
    if (entry.test(file)) return [...entry.chain];
  }
  return [];
}
```

**Чому ланцюжок а не одиничний вибір.** Mime файлу дає тільки `application/pdf`. Властивість "searchable PDF" vs "scanned PDF" — це властивість контенту, не файлу. Вона виявляється коли `pdfjsLocal` спробував витягти текстовий шар і впав. Тому PDF починає з `pdfjsLocal` — економить виклики Document AI на searchable документах. Якщо текстового шару немає → `UNSUPPORTED` → фолбек на `documentAi`.

## 4. Як виглядає відповідь Document AI з pages

```js
{
  text: "Повний текст усього документа...",
  pageCount: 3,
  pageStructure: [
    {
      pageNumber: 1,
      dimension: { width: 612, height: 792, unit: 'POINTS' },
      layout: {
        textAnchor: { textSegments: [{ startIndex: '0', endIndex: '450' }] },
        confidence: 0.98,
        boundingPoly: { ... },
      },
      paragraphs: [
        { layout: { textAnchor: {...}, boundingPoly: {...} }, ... }
      ],
      blocks: [...],
      tables: [...],
      tokens: [...],
      _text: 'Текст сторінки 1 — витягнутий через textSegments',  // ← додано тут
    },
    { pageNumber: 2, ..., _text: 'Текст сторінки 2' },
    { pageNumber: 3, ..., _text: 'Текст сторінки 3' },
  ],
  warnings: []
}
```

`_text` витягується один раз у `extractPageText(page, chunkText)`. Споживач (`Текст-режим у Viewer`, `AI Очищення`, `семантичне сортування зображень`) має готовий текст сторінки і не возиться з offset математикою — особливо коли PDF нарізаний на чанки і textAnchor у різних сторінок посилається на текст СВОГО чанка, не глобального документа.

## 5. Як ocrService вирішує писати layout.json

Без декларативного контракту на провайдері. ФАКТ у відповіді:

```js
const hasPageStructure = Array.isArray(result.pageStructure) && result.pageStructure.length > 0;

if (result.text && result.text.trim().length > 0) {
  cacheWritten = await writeArtifact(file, `${basename}_${id}.txt`, result.text, 'text/plain');
}
if (hasPageStructure) {
  layoutWritten = await writeArtifact(
    file,
    `${basename}_${id}.layout.json`,
    serializeLayout({ provider: name, pageStructure: result.pageStructure }),
    'application/json'
  );
}
```

Один сенс на одну операцію. Принцип з DEVELOPMENT_PHILOSOPHY.md розділ «Однозначність».

## 6. Що означає «декларативний контракт» у нашому коді

Ми СВІДОМО відмовились від проміжного `providerReturnsMetadata` як константи на провайдері. Дві причини:

1. **Двозначність.** Декларація `returnsMetadata: true` означала б одночасно "ЗАВЖДИ повертає" (для documentAi) і "МОЖЕ повертати" (для claudeVision — модель може видати plain text без структури). Один прапор, два сенси на різних провайдерах — це той самий патерн що `skipCache` (читання vs запис).

2. **Передчасна абстракція.** Поки нікому не потрібно знати ДО виклику чи провайдер дасть структуру. ocrService дивиться у фактичну відповідь. Якщо UI у майбутньому захоче "чи буде структура" заздалегідь — додамо ОКРЕМУ сутність (capability descriptor) тоді, не зараз.

Замість декларації провайдер документує свій контракт у header-коментарі файлу — це для людини-читача, не для runtime.

## 7. Інструкція тестування

Перевірити що в `02_ОБРОБЛЕНІ` папці справи створюються правильні артефакти:

### а) Searchable PDF (з текстовим шаром)
1. Завантажити PDF з текстовим шаром у досьє (`+ Додати документ`).
2. Дочекатись "Текст розпізнано і збережено" toast.
3. Відкрити Drive → справа → `02_ОБРОБЛЕНІ`.
4. **Очікуємо:** є файл `<назва>_<driveId>.txt`. НЕМАЄ `.layout.json` (pdfjsLocal не повертає pageStructure за дизайном — це економить ресурси).

### б) Scanned PDF (без текстового шару)
1. Завантажити сканований PDF (фото судової ухвали, без OCR-шару).
2. pdfjsLocal спробує і впаде з UNSUPPORTED → фолбек на documentAi.
3. Дочекатись завершення toast.
4. **Очікуємо:** є обидва файли — `<назва>_<driveId>.txt` і `<назва>_<driveId>.layout.json`.

### в) Зображення (JPG/PNG)
1. Завантажити фото документа.
2. documentAi працює напряму (pdfjsLocal не у ланцюжку для image/*).
3. **Очікуємо:** обидва файли — `.txt` і `.layout.json`.

### г) Структура `layout.json`
Завантажити з Drive `.layout.json` і перевірити:
```json
{
  "schemaVersion": 1,
  "provider": "documentAi",
  "generatedAt": "2026-05-11T...",
  "pages": [
    {
      "pageNumber": 1,
      "dimension": { "width": ..., "height": ..., "unit": "POINTS" },
      "layout": { "textAnchor": ..., "confidence": ..., "boundingPoly": ... },
      "paragraphs": [ ... ],
      "blocks": [ ... ],
      "tables": [ ... ],
      "_text": "Текст сторінки 1..."
    }
  ]
}
```
Формат відповідає документації Document AI Document.Page (https://cloud.google.com/document-ai/docs/reference/rest/v1/Document#Page), додано тільки поле `_text`.

### д) Інвалідація пари
1. У документі правою → "Розпізнати зараз".
2. На Drive у `02_ОБРОБЛЕНІ` старі `.txt` І `.layout.json` мають зникнути одночасно.
3. Після завершення розпізнавання — обидва з'являються знов (для scanned PDF / image).

### е) DOCX / XLSX
1. Завантажити DOCX.
2. `hasOcrSupport(file)` → false, OCR pipeline пропускається без warning toast.
3. У `02_ОБРОБЛЕНІ` НЕМАЄ ні `.txt`, ні `.layout.json`. Viewer показує DOCX через mammoth (як раніше).

## 8. Що НЕ зроблено і чому

- **claudeVision pageStructure** — не додано. Зараз claudeVision це фолбек коли Document AI недоступний; для тексту досить. Якщо в майбутньому стане основним (наприклад, GDPR-режим коли заборонено лити на Google) — окремий TASK з промптом який просить структурований JSON у форматі Document AI.
- **pdfjsLocal pageStructure** — за дизайном. PDF API дає всю структуру (paragraphs, font runs), але це не OCR-задача — якщо знадобиться, окремий провайдер `pdfjsStructure`. Чим вужче відповідальність — тим простіше підтримувати.
- **Розмірна оптимізація `pageStructure`** — не зроблено. Текст-токени і символи зберігаються як приходять. Якщо розмір на Drive стане проблемою (десятки MB на 100-сторінковий PDF) — окремий TASK з обрізкою непотрібних полів.
- **AI Очищення тексту** — поза скопом (окремий TASK).
- **Семантичне сортування зображень** — поза скопом, цей TASK його фундамент.
- **Конвертація форматів у PDF** — наступний TASK після цього.

## Метрики

- Тести: **508 passed (508)** — додано 23 нових (14 providerMatrix + 9 ocrService).
- Білд: успішний.
- Файлів змінено: 6, файлів додано: 3.
