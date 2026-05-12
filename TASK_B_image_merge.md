# TASK B — склейка кількох зображень у один PDF з агентом семантичного сортування

## КОНТЕКСТ

Це продовження TASK A. AddDocumentModal вже має:
- Дві кнопки на старті: "📄 Додати файл" і "🖼 Склеїти зображення"
- "Склеїти зображення" зараз показує плейсхолдер "Доступно у наступній версії"
- Цей TASK реалізує повноцінну склейку

Адвокат у роботі часто має кілька фото або сканів одного документа (сторінки рішення суду сфотографовані на телефон або скани в окремих файлах). Треба з'єднати у один PDF з правильним порядком сторінок.

Сценарій використання:
1. Адвокат натискає "🖼 Склеїти зображення"
2. Вибирає 2-50 зображень (з пристрою або Drive)
3. Система OCR'ить кожне один раз, агент визначає правильний порядок, корегує орієнтацію
4. Адвокат бачить превʼю з можливістю перепорядкувати або видалити
5. Натискає "Створити PDF" → отримує склеєний документ

## ЩО ВХОДИТЬ У TASK B

### 1. Multi-select у Drive File Picker
- Додати проп selectionMode ('single' | 'multi-images')
- Якщо 'multi-images' — checkbox біля файлів, фільтрація mimeType image/*, кнопка "Обрати N зображень"
- Якщо 'single' (за замовчуванням) — поведінка як зараз

### 2. Multi-select з пристрою
- `<input type="file" accept="image/*" multiple>`
- Адвокат вибирає кілька файлів

### 3. OCR pipeline для кожного зображення
- HEIC попередньо через heic2any → JPEG
- Через ocrService.extractText → отримуємо text + pageStructure
- Збираємо результати у масив у памʼяті

### 4. Семантичне сортування агентом (Sonnet)
- Створити src/services/sortation/imageSortingAgent.js
- Простий JSON output, НЕ tool use
- Промпт отримує: тексти і метадані всіх зображень
- Агент аналізує:
  * Колонтитули (Справа №X — на сторінках одного документа)
  * Номери сторінок (стор. 1, стор. 2, Page 1 of 5)
  * Реквізити які повторюються
  * Тематика тексту
  * Імена сторін
- Повертає JSON:
  ```json
  {
    "order": [2, 0, 1, 3],
    "warnings": [
      {"index": 4, "reason": "Сторінка з іншого документа: інша тематика"}
    ],
    "missing": "Можливо відсутня сторінка 3"
  }
  ```
- Якщо одне зображення → агент НЕ викликається

### 5. Корекція орієнтації
- Створити src/services/sortation/orientationCorrector.js
- Document AI повертає orientation у pageStructure (0/90/180/270)
- Якщо orientation != 0 → обертаємо через Canvas API перед склейкою
- Якщо orientation = 0 → нічого не робимо

### 6. Превʼю після агента
- Зображення у порядку який визначив агент
- Підозрілі (з warnings) позначаються червоною рамкою з поясненням
- Drag-and-drop для зміни порядку вручну
- Кнопка "Видалити" біля кожного зображення
- Кнопка "Видалити всі підозрілі" гуртом

### 7. Склейка у фінальному порядку
- jsPDF.addPage() для кожного зображення
- Орієнтація відповідно до зображення (landscape/portrait)
- Якість JPEG ~0.92
- Один PDF на виході

### 8. UX і прогрес
- Прогрес-бар з фазами: "OCR... Сортування... Корекція орієнтації... Створення PDF... Upload..."
- При 50+ зображеннях — попередження "Великий обсяг, обробка займе ~2 хвилини, продовжити?"
- Toast про результат

### 9. Поле "Назва документа" обовʼязкове (як у одиночному файлі)

### 10. Запис у реєстр
- driveId — фінальний PDF
- originalDriveId — null (оригінали зображень не зберігаються)
- documentNature — 'scanned'
- originalMime — null

## КРИТИЧНО — ОДИН OCR НА ЗОБРАЖЕННЯ, НЕ ДВА

Pipeline ВИКОНУЄ OCR через ocrService.extractText лише ОДИН раз для кожного зображення на старті.

Результати OCR (text + pageStructure) використовуються для ВСЬОГО:
1. Семантичне сортування агентом (бере text і pageStructure з памʼяті)
2. Orientation correction (бере pageStructure.orientation з памʼяті)
3. Створення .txt у 02_ОБРОБЛЕНІ — обʼєднуємо тексти у правильному порядку
4. Створення .layout.json у 02_ОБРОБЛЕНІ — обʼєднуємо pageStructure у правильному порядку з оновленими pageNumber

НЕ запускати повторний OCR на фінальному склеєному PDF. Це зайва витрата Document AI токенів і часу.

Адвокат явно попередив про цей ризик — це порушення принципу Розумної економії з DEVELOPMENT_PHILOSOPHY.md.

Послідовність pipeline:
1. OCR кожне зображення (один раз кожне) → масив `{file, text, pageStructure}`
2. Якщо більше 1 зображення → агент сортує
3. Корекція orientation з памʼяті (НЕ повторний OCR)
4. Склейка у PDF через jsPDF у правильному порядку
5. Запис PDF у 01_ОРИГІНАЛИ
6. Обʼєднання text у правильному порядку → .txt у 02_ОБРОБЛЕНІ
7. Обʼєднання pageStructure у правильному порядку з оновленими pageNumber → .layout.json у 02_ОБРОБЛЕНІ
8. Запис у реєстр

Тести мають перевірити що ocrService.extractText викликається N разів для N зображень, не N+1.

## АРХІТЕКТУРА

Створити нові файли у src/services/sortation/:
- imageSortingAgent.js — агент сортування через Sonnet з JSON output
- orientationCorrector.js — обертання через Canvas API

Розширити існуючі:
- src/services/converter/converterService.js — функція mergeImagesToPdf
- src/components/AddDocumentModal/ — UI для multi-select і превʼю
- src/components/DriveFilePicker/ — режим multi-images

## ПРИНЦИП DRY — використовувати існуючі сервіси

Використовувати існуючі сервіси, не дублювати:
- ocrService.extractText для OCR кожного зображення
- imageToPdf для конвертації окремого зображення (база для склейки)
- heicToJpeg для HEIC → JPEG
- jsPDF для склейки у фінальний PDF
- activityTracker для білінгу
- modelResolver для вибору моделі агента
- writeExtractedTextArtifact для запису .txt
- driveService для роботи з Drive

imageSortingAgent — НОВИЙ сервіс.
orientationCorrector — НОВИЙ сервіс.

Якщо побачиш що частина логіки дублюється з існуючим — використовуй існуюче.

## ЕМБРІОН З ПОВНИМ ДНК

### SAAS IMPLICATIONS:
- tenantId/userId у документі що створюється
- audit log: imageSortingAgent виклик з context {caseId, imageCount}
- permissions — операція доступна тільки lawyer/owner/admin

### BILLING IMPLICATIONS:
- activityTracker.report('images_merged', {count, caseId})
- logAiUsage для imageSortingAgent виклику
- resolveModel('image_sorter') у SYSTEM_DEFAULTS (Sonnet за замовчуванням)
- Якщо одне зображення → агент не викликається → ai_usage запис не створюється

## ПРИНЦИП РОЗУМНОЇ ЕКОНОМІЇ

- Не викликати агента якщо одне зображення (нема що сортувати)
- Не зберігати base64 зображень у logs (тільки кількість, MIME)
- Не запускати orientation correction якщо orientation = 0 (нічого робити)
- Один OCR на зображення, результат використовується для всіх кроків

## ПОЗА СКОПОМ

- Розпаковка ZIP файлів (для модуля ЄСІТС)
- AI Очищення тексту після склейки
- Розподіл документів по провадженнях через AI
- Серверна конвертація через LibreOffice
- Пакетна обробка декількох документів одночасно (це Document Processor v2)

## ЗВОРОТНИЙ ЗВ'ЯЗОК ПЕРЕД РЕАЛІЗАЦІЄЮ

Перед початком подивись:
1. report_pdf_conversion_task_a.md — що зроблено у TASK A (особливо imageToPdf.js і heicToJpeg.js — вони використовуються у склейці)
2. Поточний код у:
   - src/components/AddDocumentModal/ (UI з двома кнопками і плейсхолдером для склейки)
   - src/components/DriveFilePicker/ (для розширення на multi-select)
   - src/services/converter/imageToPdf.js (одиночна конвертація — основа для склейки)
   - src/services/converter/heicToJpeg.js (вже працює)
   - src/services/ocrService.js (для OCR кожного зображення)
   - src/services/modelResolver/ (resolveModel для image_sorter)
   - src/services/activityTracker/ (для білінг точок)
3. git log останніх комітів щоб зрозуміти що зроблено у попередній сесії

Якщо бачиш конфлікти з філософією, кращий варіант реалізації або проблеми у плані — напиши коротко перед тим як писати код. Не критика заради критики — тільки те що варто узгодити до реалізації.

## ІНКРЕМЕНТАЛЬНІ КОМІТИ

Коміт 1: Multi-select у Drive File Picker (новий режим)
Коміт 2: orientationCorrector через Canvas API + тести
Коміт 3: imageSortingAgent з Sonnet JSON output + тести
Коміт 4: Pipeline multi-image у AddDocumentModal без UI (OCR + сортування + склейка)
Коміт 5: UI превʼю з drag-and-drop і warnings
Коміт 6: Прогрес-бар з фазами і попередження для 50+ зображень
Коміт 7: Snapshot тести для всього pipeline + інтеграційні тести

Кожен коміт пушити одразу через git push. Якщо робота переривається — попередні частини збережуться на GitHub.

## ЗВІТ

Створити report_image_merge_task_b.md з:
1. Що зроблено у Multi-select Drive picker
2. Як працює orientationCorrector
3. Як працює imageSortingAgent (приклад промпту і JSON output)
4. UI превʼю з drag-and-drop
5. Прогрес-бар з фазами
6. SAAS і BILLING IMPLICATIONS
7. Список комітів
8. Підтвердження що pipeline робить ОДИН OCR на зображення (з посиланням на тест)
9. Інструкція тестування для адвоката:
   а) Склейка 3-5 фото одного документа з пристрою
   б) Multi-select з Drive
   в) HEIC з iPhone
   г) Виявлення підмінених сторінок (4 фото одного документа + 1 чужий скріншот)
   д) Корекція орієнтації (фото повернуте на 90/180/270)
10. Що НЕ зроблено і чому

## ФІНАЛЬНИЙ КОМІТ

Після всіх інкрементальних:
```
npm test (всі тести зелені)
npm run build (чистий)
```
