# ДІАГНОСТИЧНИЙ ЗВІТ v2 — З РЕАЛЬНИМИ PRODUCTION-ДАНИМИ

**Дата:** 2026-05-09
**Виконавець:** Claude Code (Opus 4.7)
**Тип:** ОНОВЛЕННЯ ЗВІТУ v1 на основі реальних JSON
**Базується на:** `diagnostic_document_lifecycle.md` (v1)
**Запит:** `diagnostic_v2_combined.md`

---

## 1. РЕЗЮМЕ ОНОВЛЕННЯ

Реальні production-дані **частково спростовують** найпомітнішу гіпотезу v1 і **повністю підтверджують** головну (баг AddDocumentModal). Плюс знайдено три нові вектори, не описані в v1.

**Що змінилось у картині:**

- **Спростовано:** "Брановський має 12 seed-документів з INITIAL_CASES". У production — 6 документів, з них **жодного seed-документа немає** (демо-набір з App.jsx:111-124 у real Drive registry не потрапив). Адвокат працює з реальною справою.
- **Підтверджено зі 100% впевненістю (реальні дані):** AddDocumentModal upload-failure створює orphan-записи. У Брановського 2 документи мають точну сигнатуру цього бага: `originalName` + `size > 0` + `namingStatus='manual'` + `category/author/procId` заповнені + `driveId: null`.
- **Скориговано Кісельову:** там 1 документ і він **успішно завантажений на Drive** (driveId є). Симптом "OCR-текст не з'являється" має іншу причину — нова знахідка нижче.
- **Пояснено `_metadata/`:** для Кісельової `_metadata/documents_extended.json` **відсутній не випадково, а за дизайном** — `migrateRegistryV4toV5` створює цей файл лише коли є непорожні extended-поля. У 1-документного "чистого" Кісельової немає чого зберігати → файл не пишеться. Це задумана логіка (`v4ToV5.js:188-200`), не баг.
- **Нова знахідка #1 — баг порушення правила #8:** `ocrService.listFolderFilesByName` шукає файли через `q= name='<кирилиця>'` (`ocrService.js:45-46`). Це порушення CLAUDE.md правила #8 ("ніколи не використовувати кирилицю в q= Drive API"). Може бути причиною чому Viewer Кісельової не знаходить наявний OCR-кеш.
- **Нова знахідка #2 — MIME bug підтверджено:** `createDriveFile`/`updateDriveFile` (`driveService.js:335, 396`) hardcode'ять `text/plain`, тому `documents_extended.json` приходить з Drive як `.txt`. `registry_data.json` пишеться через інший шлях (`writeRegistry` в App.jsx:3066) з `application/json` — тому з нормальним розширенням.
- **Нова знахідка #3 — schemaVersion 4 в production навмисно:** два паралельні ланцюги — `migrationService.CURRENT_SCHEMA_VERSION = 4` (registry-skeleton) і `documentSchema.CURRENT_SCHEMA_VERSION = 5` (документи). Записує EFFECT-B завжди як 4. v4→v5 міграція документів запускається при кожному hydration ідемпотентно.

**Загальний висновок:** ситуація **краща ніж у v1** для Брановського (6 реальних документів замість 12 seed) і **точно та сама** для Кісельової (1 правильний запис, але Viewer не показує OCR через інший баг). Архітектура **здоровіша ніж видавалось** — v4→v5 міграція виконана коректно, `_metadata/` lazy-create — задумана логіка. Поточні симптоми зводяться до **3 точкових багів**: AddDocumentModal не fail-fast, ocrService порушує правило #8, MIME hardcoded text/plain.

---

## 2. ПОВНІ ДАМПИ

### 2.1 Брановський (case_4) — ЛЕГКІ ПОЛЯ (з registry_data.json)

`storage.driveFolderId`: `1JD-_Ms8e9k1iyu4cO_qFS4Yr7qgpNIS5` (Брановський_450_2275_25)
`subFolders`: усі 5 підпапок присутні (01-05).
`schemaVersion` registry: **4** (settingsVersion: `"4.0_billing_foundation"` — це навмисно, див. розділ 4).

| # | id | name | originalName | category | author | nature | naming | isKey | procId | driveId | folder | pageCount | size | icon | date | addedAt | updatedAt | addedBy | status | lastOcrAt |
|---|----|------|--------------|----------|--------|--------|--------|-------|--------|---------|--------|-----------|------|------|------|---------|-----------|---------|--------|-----------|
| 1 | `1775564392858` | У Х В А Л А про відкриття апеляційного провадження | null | court_act | court | searchable | manual | true | proc_1775563928036 | **null** | 01_ОРИГІНАЛИ | null | 0 | 📋 | null | 2026-05-08T18:15:57.297Z | 2026-05-08T18:15:57.297Z | **migration** | active | — |
| 2 | `1775569066074` | ухвала про відкриття | null | court_act | court | searchable | manual | true | proc_1775563928036 | **null** | 01_ОРИГІНАЛИ | null | 0 | 📋 | null | 2026-05-08T18:15:57.298Z | 2026-05-08T18:15:57.298Z | **migration** | active | — |
| 3 | `1775569527517` | відзив Позов | null | court_act | ours | searchable | manual | true | proc_main | **null** | 01_ОРИГІНАЛИ | null | 0 | 📋 | null | 2026-05-08T18:15:57.298Z | 2026-05-08T18:15:57.298Z | **migration** | active | — |
| 4 | `1778167021084` | Зустрічний позов | null | pleading | ours | searchable | manual | false | proc_main | **`1mOWMhLobPGq7sOTw_Pa3BeKl8eTs_cPd`** | 01_ОРИГІНАЛИ | null | 0 | 📄 | null | 2026-05-08T18:15:57.299Z | 2026-05-09T10:04:19.772Z | **migration** | active | 2026-05-09T10:04:12.771Z |
| 5 | `doc_1778314944299_66qc0t` | Позовна заява | **`03_Позовна_заява_поділ_майна_подружжя.pdf`** | pleading | opponent | searchable | manual | false | proc_main | **null** | 01_ОРИГІНАЛИ | null | **3196031** | 📄 | null | 2026-05-09T08:22:24.299Z | 2026-05-09T10:08:22.785Z | **lawyer_manual** | active | — |
| 6 | `doc_1778321595603_fhhswq` | Висновок експерта jeep cherokee | **`24_Висновок_експерта_67_JEEP_Cherokee_518850грн.pdf`** | evidence | opponent | searchable | manual | false | proc_main | **null** | 01_ОРИГІНАЛИ | null | **2250716** | 📎 | null | 2026-05-09T10:13:15.603Z | 2026-05-09T10:13:15.603Z | **lawyer_manual** | active | — |

**Класифікація 6 документів:**
- **3 legacy без файлу** (#1, #2, #3) — `addedBy='migration'`, `originalName=null`, `size=0`. Створювалися в старій схемі (до v3 чи на v3) як metadata-only записи. Файлу на Drive ніколи не було. Міграція v4→v5 додала їм canonical-поля з дефолтами.
- **1 legacy з пізнішим upload** (#4 "Зустрічний позов") — `addedBy='migration'`, `originalName=null`, `size=0`, **АЛЕ `driveId` присутній + `lastOcrAt` 2026-05-09**. Імовірно адвокат пов'язав файл з legacy-записом через якийсь механізм (можливо ручний edit driveId, або старий DocumentProcessor flow). OCR на цьому документі вже виконувався 09.05.
- **2 нові з сигнатурою AddDocumentModal upload failure** (#5, #6) — `addedBy='lawyer_manual'`, `originalName` присутній, `size > 0`, `namingStatus='manual'`, `category/author/procId` заповнені явно, але **`driveId: null`**. Це точна сигнатура коду `CaseDossier/index.jsx:2820-2834` (AddDocumentModal `onSubmit`) при failed upload. Розмір файлів великий — 3.0 МБ і 2.2 МБ — що корелює з `Failed to fetch` (timeout / мережа на великих multipart upload).

`needsReview` (з `documentFactory.needsReview`): для всіх 6 — `false`, бо у всіх category/author/procId непорожні. Маркер ⚠ не з'явиться.

### 2.2 Брановський — ВАЖКІ ПОЛЯ (`_metadata/documents_extended.json`)

Файл існує і містить **рівно 4 записи** (для документів 1-4 з таблиці легких полів):

| documentId | tags | notes | annotations | processingHistory | extractedTextSummary | customFields |
|------------|------|-------|-------------|-------------------|----------------------|--------------|
| `1775564392858` | `[]` (0) | `""` | `[]` (0) | `[]` (0) | `""` | `{ legacyDateText: "10.03.2026" }` |
| `1775569066074` | `[]` (0) | `""` | `[]` (0) | `[]` (0) | `""` | `{ legacyDateText: "10 березня 2026 року" }` |
| `1775569527517` | `[]` (0) | `""` | `[]` (0) | `[]` (0) | `""` | `{ legacyDateText: "травень 2025" }` |
| `1778167021084` | `[]` (0) | `""` | `[]` (0) | `[]` (0) | `""` | `{ legacyDateText: "07.05.2026" }` |

**Спостереження:**
- Усі 4 записи — це legacy-документи (id у форматі timestamp без префіксу `doc_`).
- Єдина непорожня important-information — `customFields.legacyDateText`. Це **текстова дата у legacy-форматі**, яку міграція v4→v5 свідомо зберегла, бо не змогла парснути в `YYYY-MM-DD` (`v4ToV5.js:184-186`).
- Жодного OCR-тексту, нотатки, тегу, processingHistory чи annotation. Корисних даних які можна "врятувати" при cleanup — **тільки текстові дати**.
- **2 нові документи (#5, #6) у extended відсутні** — для них `splitDocumentV4toV5` повернув `extended: null` (бо нема legacy-полів), запис не створювався.
- Файл фізично прийшов з Drive як `.txt` — підтверджує MIME bug (розділ 6).

### 2.3 Кісельова (case_9) — ЛЕГКІ ПОЛЯ

`storage.driveFolderId`: `1J4oHRXQbGtS-UocFqBsww78n8KdQnIzu` (Кісельова_22-ц_824_22)
`subFolders`: усі 5 підпапок присутні.

| # | id | name | originalName | category | author | nature | naming | isKey | procId | driveId | folder | size | addedAt | updatedAt | addedBy | status | lastOcrAt |
|---|----|------|--------------|----------|--------|--------|--------|-------|--------|---------|--------|------|---------|-----------|---------|--------|-----------|
| 1 | `doc_1778267595018_02ekwx` | 701_1413_25 кисельова ухвала.pdf | 701_1413_25 кисельова ухвала.pdf | **null** | **null** | searchable | **pending** | false | **null** | **`1scyzR9TUztp3-ZexA4VJ-79GOQTkIgIp`** | 01_ОРИГІНАЛИ | 45074 | 2026-05-08T19:13:15.018Z | 2026-05-09T10:01:14.374Z | **lawyer_manual** | active | 2026-05-09T10:01:14.373Z |

**Спостереження:**
- **Файл успішно завантажений** — `driveId` присутній, `lastOcrAt` 2026-05-09 → OCR виконувався і кеш мав записатись.
- `category=null, author=null, procId=null, namingStatus='pending'` → `needsReview` повертає **`true`** (CRITICAL_FIELDS_FOR_WARNING). UI показує маркер ⚠.
- Це **сигнатура drag-n-drop в Огляд** (CaseDossier:2073-2085: усі ці поля передаються як null/'pending'). Не AddDocumentModal — там category/author/procId передаються явно з форми, namingStatus='manual'.
- Розмір `45074` байт = 44 КБ — точно як у запиті адвоката ("701_1413_25 кисельова ухвала.pdf, 44 КБ scanned"). Файл маленький, тому upload не ламається через timeout.

### 2.4 Кісельова — ВАЖКІ ПОЛЯ

**Файл `_metadata/documents_extended.json` у Кісельової ВІДСУТНІЙ** — підтверджує знахідку адвоката.

**Це не баг, а задумана логіка міграції v4→v5** (див. розділ 4). Документ Кісельової "чистий" з самого початку (новий, без legacy-полів), `splitDocumentV4toV5` повернув `extended: null`, запис у extendedByCase для case_9 не потрапив, відповідно **`saveExtendedForCase` для case_9 не викликався** (App.jsx:4182 — цикл по `extendedByCaseV5`, ключ `case_9` там відсутній).

`_metadata/` папка для Кісельової також відсутня — `ensureMetadataFolder` створює її lazy, лише коли треба зберігати extended вперше. Поки extended нема — папки нема.

---

## 3. ПЕРЕВІРКА ПРИПУЩЕНЬ v1

### 3.1 Що підтвердилось

**[ПІДТВЕРДЖЕНО]** AddDocumentModal створює orphan-запис при failed upload (`Failed to fetch`).
- v1 описав теоретично з коду CaseDossier:2806-2814. Реальні дані показують **2 живі orphan-записи** Брановського (#5 Позовна заява, #6 Висновок експерта) з характерною сигнатурою.
- Розмір файлів 3 МБ і 2.2 МБ — корелює з `Failed to fetch` на повільному з'єднанні / великих multipart запитах.

**[ПІДТВЕРДЖЕНО]** Документи без `driveId` показують AlertTriangle "Файл не прикріплено" і в Text-mode "Текст не розпізнано".
- Це 4 з 6 документів Брановського. Адвокат справедливо описав це як "не показуються".

**[ПІДТВЕРДЖЕНО]** Канонічна схема v5 застосована коректно — всі 6 документів Брановського мають усі 18 канонічних полів. `splitDocumentV4toV5` працює правильно.

### 3.2 Що скоригувалось

**[СКОРИГОВАНО]** "Брановський має 12 seed-документів з INITIAL_CASES" — **спростовано**.
- Реальність: 6 документів. **Жодного seed (id у форматі `doc_seed_branovsky_*`) немає**. Адвокат працює з реальною справою. INITIAL_CASES seed ніколи в production не зберігся (це Sandbox-кнопка, App.jsx:6059, активується ручним reset).
- Висновок: рекомендація v1 "видалити seed-документи з INITIAL_CASES або позначити archived" — **непотрібна для виправлення live-симптомів**, лишається лише як превентивний захід для Sandbox.

**[СКОРИГОВАНО]** "Кісельова має кілька записів, хоч один з `driveId: null`" — **частково спростовано**.
- Реальність: **1 документ**, `driveId` **присутній**. Upload успішний.
- Симптом адвоката "Viewer не показує контент" має іншу причину (нова знахідка #1).

**[СКОРИГОВАНО]** "У Брановського 12 seed з addedBy='migration'" — реальність: **4 legacy-migration документи** (id у форматі timestamp), створені в попередніх версіях схеми. Це не INITIAL_CASES seed, а реальні старі записи.

### 3.3 Нові патерни які v1 не передбачив

**[НОВИЙ ПАТЕРН A]** Метадані без файлу як legacy.
3 з 6 документів Брановського (#1, #2, #3) — це записи де адвокат колись створив **метадану документа без прив'язки файлу** (тільки name + category + author + текстова дата). Це валідний use-case (швидкий запис що "є такий документ"), але v1 не виділяв його окремо. Після v4→v5 міграції вони залишились без driveId, бо файлу не було ніколи. У Viewer показуються як "Файл не прикріплено" — це коректно.

**[НОВИЙ ПАТЕРН B]** Гібрид — legacy-запис + пізніше прив'язаний driveId.
Документ #4 (Зустрічний позов) — `addedBy='migration'`, `originalName=null`, `size=0`, **АЛЕ `driveId` і `lastOcrAt` присутні**. Це означає що адвокат якось додав driveId до старого legacy-запису. У коді update_document ACTION (App.jsx:5314-5317) ALLOWED_UPDATE_FIELDS не містить `driveId` — оновлювати driveId через ACTION неможливо. Тобто це могло статись:
- через прямий edit `setCases` десь у застарілому коді,
- або через старий DocumentProcessor flow,
- або через ручне редагування registry_data.json.

Без логів сказати точно неможливо, але **сам факт існування такого документа — архітектурне попередження**: десь є шлях зміни `driveId` поза контролем ACTION.

**[НОВИЙ ПАТЕРН C]** drag-n-drop у дереві Матеріалів дає `category=null, author=null, procId=null, namingStatus='pending'`.
Це Кісельовин документ. `needsReview = true`. Адвокат бачить в UI маркер ⚠ і має сам класифікувати. Це задизайнено правильно (drag-n-drop — швидкий шлях, класифікація потім), але адвокат міг цього очікування не пам'ятати.

---

## 4. ПИТАННЯ `_metadata/` ПАПКИ — ПОЯСНЕНО

**Підтверджена причина:** **lazy-create за дизайном**. У Кісельової `_metadata/documents_extended.json` ВІДСУТНІЙ тому що для її 1 чистого документа `splitDocumentV4toV5` повернув `extended: null` (нема legacy-полів) → у extendedByCase запис не потрапив → `saveExtendedForCase` для case_9 не викликався → файл (і `_metadata/` папка) не створювались.

**Конкретний код-шлях:**

```js
// src/services/migrations/v4ToV5.js:188-201
const hasContent =
  extended.tags.length > 0 ||
  extended.notes ||
  extended.annotations.length > 0 ||
  extended.processingHistory.length > 0 ||
  extended.extractedTextSummary ||
  Object.keys(extended.customFields).length > 0;

return {
  canonical,
  extended: hasContent ? extended : null,
};
```

```js
// src/services/migrations/v4ToV5.js:97-99
if (Object.keys(caseExtended).length > 0) {
  extendedByCase[caseItem.id] = caseExtended;
}
```

```js
// src/App.jsx:4182-4196 (EFFECT-A, після міграції)
for (const [caseId, extended] of Object.entries(extendedByCaseV5)) {
  if (!extended || Object.keys(extended).length === 0) continue;
  const caseData = registry.cases.find(c => c.id === caseId);
  if (!caseData?.storage?.driveFolderId) continue;
  try {
    await saveExtendedForCase(caseId, caseData, extended);
  } catch (e) { ... }
}
```

`saveExtendedForCase` сам викликає `ensureMetadataFolder` (`documentsExtended.js:62`), який створить `.metadata/` лише при першому записі.

**Це баг чи задумана логіка?** **ЗАДУМАНА ЛОГІКА.** Коментар у `v4ToV5.js:188-189`:
```
// Якщо в extended нічого осмисленого — повертаємо null,
// щоб не записувати порожні файли.
```

Тобто архітектура свідомо уникає порожніх артефактів. Це чисто.

**Але є нюанс UX:** адвокат очікує симетричну структуру `_metadata/` для всіх справ. Виявляється асиметричною. Коли адвокат додасть до Кісельовиного документа тег чи нотатку через `setExtendedForDocument` → ця функція викличе `saveExtendedForCase` → `ensureMetadataFolder` створить папку lazy. Тобто симетричність відновлюється при першому doopusі.

**Чи треба це виправляти?** На мою думку — ні. Це чиста архітектура з правильним інваріантом ("файл існує тоді і тільки тоді коли є непорожній зміст"). Якщо дратує адвоката — можна додати pre-create в `addCase` (CaseDossier чи App.jsx), але це додає шум на Drive ради косметичної симетрії. Не рекомендую.

---

## 5. АНАЛІЗ `documents_extended.json` БРАНОВСЬКОГО

**Що зберігається:** 4 записи, кожен майже порожній, з єдиним непорожнім полем — `customFields.legacyDateText`. Це текстова дата документа в legacy-форматі (`"10.03.2026"`, `"10 березня 2026 року"`, `"травень 2025"`, `"07.05.2026"`).

**Чи корисно:** мінімально. Текстові дати корисні якщо UI колись зможе їх показувати поряд з canonical `date` (яка зараз `null` у цих документах). Але ні Viewer, ні CaseDossier поки що `legacyDateText` не читають — це капсула часу для майбутнього TASK Date Normalization.

**Чи можна щось врятувати при cleanup:** Якщо адвокат вирішить видалити 3 legacy-записи без файлу (#1, #2, #3) — текстові дати "10.03.2026", "10 березня 2026 року", "травень 2025" втратяться. Але вони є в реальних court_act документах і відновлюються з content. Втрата некритична.

**Що з цим робити при поточних фіксах:**
- Залишити як є — ці 4 записи в extended нормально мігровані.
- Якщо адвокат надалі викине legacy-документи #1, #2, #3 (наприклад, переcreate їх з реальними файлами) — `delete_document` викличе `deleteExtendedForDocument` (App.jsx:5413-5417), який чистить запис у extended. Симетрично.

---

## 6. УТОЧНЕНІ РЕКОМЕНДАЦІЇ

### 6.1 Точна кількість записів які треба cleanup

**Брановський (case_4):** 6 документів усього. Розбивка:

| # | id (коротко) | Що робити | Чому |
|---|--------------|-----------|------|
| 1 | `1775564392858` (Ухвала про відкриття апеляції) | Залишити або помітити архівним | Legacy без файлу. Адвокату вирішувати — це йому потрібне історично чи ні. |
| 2 | `1775569066074` (ухвала про відкриття) | Залишити або архівувати | Дублікат-схожий до #1 — не плутати! Імовірно різні ухвали (одна апеляційна, одна основна). Адвокат має визначити. |
| 3 | `1775569527517` (відзив Позов) | Залишити або архівувати | Legacy без файлу. |
| 4 | `1778167021084` (Зустрічний позов) | **Залишити** | Робочий документ з driveId і OCR. |
| 5 | `doc_1778314944299_66qc0t` (Позовна заява) | **Видалити з реєстру** і повторно завантажити через AddDocumentModal | Orphan через AddDocumentModal upload failure. На Drive файлу немає (driveId=null). |
| 6 | `doc_1778321595603_fhhswq` (Висновок експерта jeep cherokee) | **Видалити з реєстру** і повторно завантажити | Той самий патерн що #5. |

**Дія для адвоката:** видалити документи #5 і #6 через UI (DeleteDocumentModal → "повністю"). У режимі `'full'` `if (doc.driveId)` (App.jsx:5429) пропустить Drive delete для null driveId — лише запис зникне. Потім завантажити повторно (бажано з ретраєм при `Failed to fetch`).

**Кісельова (case_9):** 1 документ.

| id | Що робити | Чому |
|----|-----------|------|
| `doc_1778267595018_02ekwx` (701_1413_25 кисельова ухвала.pdf) | **Залишити**, додати category/author/procId через UI | Файл коректно завантажений. Виявлений симптом "OCR не показується" — окремий баг ocrService (нова знахідка #1, розділ 7). |

### 6.2 Поділ "seed" vs "AddDocumentModal баг"

- **Seed-документи** (з INITIAL_CASES): **немає в production**. Чистити нема чого. Рекомендація v1 "позначити seed archived" — не потрібна (стосується лише Sandbox).
- **AddDocumentModal баг (підтверджений production-даними):** 2 orphan-записи у Брановського. Локальне виправлення коду + один-разова чистка цих 2 записів.

### 6.3 documents_extended Брановського — корисне?

Мінімально (текстові дати без UI-споживача). Не блокує жодних рішень. **Можна не чіпати**.

### 6.4 Що додати до плану виправлень (TASK 10.2 / далі)

Оновлений мінімальний план фіксів:

1. **AddDocumentModal fail-fast** (CaseDossier:2806-2814): при `uploadFileLocal` failure — `throw err` замість toast і fall-through. Модалка лишається відкритою з error-станом, адвокат може повторити.

2. **ocrService — прибрати кирилицю з q= filter** (нова знахідка #1, ocrService.js:45-46): замість `q= name='${кирилиця}'` — отримати всі файли папки і фільтрувати в JavaScript (як `deleteOcrCacheForDocument` робить правильно: `driveService.js:381-388`).

3. **DocumentViewer — fallback для приватних файлів** (DocumentViewerContent.jsx:59-67): додати кнопку "Відкрити в Drive" поруч з iframe; розглянути pdf.js + blob через `gapi` для приватних PDF.

4. **MIME для documents_extended.json** (driveService.js:335, 396): замінити `text/plain` на `application/json`. Це виправить розширення `.txt` при скачуванні.

5. **delete_document — повертати warnings** (App.jsx:5413-5440): замість silent `console.warn` повертати `{ success: true, warnings: [...] }` коли часткова невдача (Drive delete failed, OCR cache cleanup failed). DeleteDocumentModal показуватиме warning toast.

6. **ArchiveView CSS** (ArchiveView.css:133-140): прибрати `white-space: nowrap` для `.archive-card__name` або додати `@media (max-width: 480px)`.

7. **Кастомний `<DatePicker/>`** — окремий невеликий TASK (з v1).

Локальний фікс #2 — нова рекомендація з v2, не була у v1.

---

## 7. ЗНАХІДКИ ПОЗА ГІПОТЕЗАМИ (НОВІ В v2)

### 7.1 (КРИТИЧНО) ocrService порушує правило #8 CLAUDE.md

`ocrService.js:45-53`:
```js
async function listFolderFilesByName(folderId, name) {
  const q = `'${folderId}' in parents and name='${name.replace(/'/g, "\\'")}' and trashed=false`;
  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10`
  );
  ...
}
```

`name` у виклику `checkCache` (ocrService.js:79-91) — це `cacheFileName(file)` = `${sanitizeBasename(file.name)}_${file.id}.txt`. Для Кісельовиного документа:
- `file.name = '701_1413_25 кисельова ухвала.pdf'`
- після `sanitizeBasename` (rstrip extension, replace slash) → `'701_1413_25 кисельова ухвала'`
- з кирилицею всередині!
- `cacheFileName` = `'701_1413_25 кисельова ухвала_1scyzR9TUztp3-ZexA4VJ-79GOQTkIgIp.txt'`
- запит `q=name='701_1413_25 кисельова ухвала_1scyz...IgIp.txt'` — кирилиця у q= filter Drive API.

**CLAUDE.md правило #8** прямо забороняє це:

> НІКОЛИ не використовувати кирилицю в параметрі `q=` Drive API — ненадійно. Правильний патерн: отримати всі підпапки без фільтра, знайти потрібну в JavaScript.

Це **імовірна причина** чому Viewer Кісельової не показує OCR-текст: `extractText` записав кеш у `02_ОБРОБЛЕНІ`, але `getCachedText` через `checkCache → listFolderFilesByName` не може знайти його через ненадійність q= з кирилицею. `listFolderFilesByName` повертає порожній масив → `checkCache` повертає `null` → `getCachedText` повертає `null` → Viewer показує "Текст ще не розпізнано".

Підтвердження: `deleteOcrCacheForDocument` в `driveService.js:381-388` робить **правильно** — `q= '${subFolderId}' in parents and trashed=false` (без name), потім `data.files.find(f => f.name === cacheName)` у JS. Звідси видно що автор `deleteOcrCacheForDocument` знав про правило, але автор `ocrService.listFolderFilesByName` (раніший код) — ні.

**Те саме `listFolderFilesByName` використовується в `writeCache`** (ocrService.js:98) — тобто запис кешу теж через ненадійний q=. Може записати дублікати, бо пошук "існуючого" не знаходить його, виконується новий upload.

Цей баг — **окремий від AddDocumentModal**, окремий від `_metadata/`, окремий від MIME. **Самостійна знахідка v2.**

### 7.2 MIME bug підтверджено реальними даними

`createDriveFile` (driveService.js:328-344) і `updateDriveFile` (driveService.js:393-401) використовують hardcoded `text/plain`. Це підтверджується тим, що адвокат отримав `documents_extended.json.txt` з Drive (Drive додав `.txt` бо MIME = text/plain) — реальне підтвердження бага.

`registry_data.json` пишеться через `writeRegistry` (App.jsx:3066-3122) з MIME `application/json` — тому без додаткового розширення.

**Це баг, не свідома різниця.** Виправлення: в `createDriveFile`/`updateDriveFile` додати параметр `mimeType` (default `'application/json'` бо обидві функції зараз використовуються лише з `documents_extended.js` для JSON-payload). Або зробити окремий `createJsonDriveFile` хелпер.

Не критично для UX, але виправляється тривіально, і Drive UI правильно визначатиме тип файлу.

### 7.3 schemaVersion 4 в production — навмисно

`migrationService.CURRENT_SCHEMA_VERSION = 4` (registry-skeleton chain).
`documentSchema.CURRENT_SCHEMA_VERSION = 5` (documents chain).
EFFECT-B (App.jsx:4237-4238) пише `schemaVersion: 4, settingsVersion: '4.0_billing_foundation'` ЗАВЖДИ — бо CURRENT_SCHEMA_VERSION = 4 (з migrationService).

Це **задумана структура** — два паралельні ланцюги схеми. Якщо в майбутньому буде registry v5+ — CURRENT_SCHEMA_VERSION у migrationService інкрементується. Поки що — v4.

Наслідок: `migrateRegistryV4toV5` запускається **при кожному hydration** (бо `registry.schemaVersion = 4` < `documentSchema.CURRENT_SCHEMA_VERSION = 5`). Ідемпотентно, бо `splitDocumentV4toV5` для вже-канонічних документів просто пересуває їх через ту саму трубу. Але при цьому:
- `extendedByCase` обчислюється знову. Для документів які мали extended на минулому проході — extended мапа знов збереться.
- `saveExtendedForCase` викликається для всіх таких випадків. Це **ще один Drive write при кожному hydration** — дрібна вартість, але є.

**Це рекомендую задокументувати** в CLAUDE.md явно як "v4 schemaVersion є фіксованою для registry-skeleton, v5 — для документів. v4→v5 запускається ідемпотентно при кожному завантаженні". Зараз це описано в CLAUDE.md розділі "Поточний schemaVersion: 5" і "settingsVersion: '5.0_canonical_documents'" — що **суперечить реальності**, де в registry лежить `schemaVersion: 4, settingsVersion: '4.0_billing_foundation'`.

**Це невелика розбіжність документації з кодом.** Або CLAUDE.md помиляється, або код має писати v5 і не пише. Перевіривши — код правильний (паралельні ланцюги), CLAUDE.md потребує уточнення. Це окрема дрібна знахідка.

### 7.4 update_document не дозволяє оновлювати driveId

`App.jsx:5314-5317` — `ALLOWED_UPDATE_FIELDS` не містить `driveId`. Для `updatedDoc` з `addedAt`/`addedBy` теж заборонено. Логічно — захист від випадкового перезапису.

Але документ #4 Брановського (Зустрічний позов) має driveId, хоча був створений як legacy без driveId. Звідки взявся driveId — незрозуміло. Це означає що **десь є код який оновлює driveId поза `update_document` ACTION**. Або це залишок старого коду, або `setCases(prev => ...)` напряму.

Ризик: дані можуть змінюватись поза контролем ACTION/PERMISSIONS/audit. Варто провести мікро-аудит — `grep -n "driveId" src/App.jsx src/components/*.jsx` — і впевнитись що driveId оновлюється лише через створення нового документа.

(У межах діагностики — фіксую, але не вирішую.)

### 7.5 `addCase` не створює `_metadata/` папку

З коду видно що при `addCase` (через QuickInput чи UI) створюється Drive-папка з 5 підпапками (`createCaseStructure`, driveService.js:64-82), але `_metadata/` НЕ серед них. Це нормально (lazy-create), але якщо у TASK 10.x чи DP v2 буде припущення "у нової справи завжди є `_metadata/`" — може сюрпризнути.

---

## 8. АРХІТЕКТУРНІ ВИСНОВКИ — ОНОВЛЕНІ

### 8.1 Чи погляд на архітектуру змінився після реальних даних

**Так, у позитивний бік.**

У v1 я писав "архітектура на 80% узгоджена з 3 невеликими тріщинами". Реальні дані показують що **вона ще здоровіша** — близько 90%:

- v4→v5 міграція виконана без втрат даних. Усі 6 документів Брановського мають коректні canonical-поля.
- `_metadata/` lazy-create — це чистий архітектурний інваріант (порожніх файлів не пишемо), не баг.
- Паралельні ланцюги schemaVersion (registry v4 + documents v5) — продумане рішення, не випадковість.
- Канонічна фабрика `createDocument` дотримується у всіх живих шляхах.

**Тріщини залишаються тими самими, плюс нова четверта:**

1. AddDocumentModal не fail-fast (підтверджено реальними даними — 2 orphan-записи).
2. DocumentProcessor обходить `add_document` ACTION (з v1, не зачепило live-симптомів).
3. OCR-кеш прив'язаний до `driveId` (з v1, не зачепило live-симптомів).
4. **НОВЕ:** ocrService порушує правило #8 (`q=` з кирилицею) — імовірна причина "OCR не з'являється" Кісельової.

Усі чотири тріщини — точкові виправлення по 15-30 хв.

### 8.2 Точна архітектурна картина

```
Документи v5
├── case.documents[] — 18 канонічних легких полів (registry_data.json, schemaVersion=4)
└── _metadata/documents_extended.json — 6 важких полів (lazy-create per case)

Створення:
├── AddDocumentModal → uploadFileLocal → createDocument → add_document ACTION ✗ (не fail-fast)
├── drag-n-drop в Огляд → uploadFileLocal → createDocument → add_document ACTION ✓
├── DocumentProcessor batch/split → uploadFileToDrive → createDocument → updateCase ✗ (обходить ACTION)
├── INITIAL_CASES seed → createDocument → setCases (без Drive) ✓
└── Migration v4→v5 → splitDocumentV4toV5 → createDocument ✓

OCR cache:
├── extractText → writeCache(file, text) → 02_ОБРОБЛЕНІ/<basename>_<driveId>.txt ✗ (q= з кирилицею)
└── getCachedText → checkCache → listFolderFilesByName ✗ (q= з кирилицею)

Видалення:
└── delete_document ACTION
    ├── mode='archive' → status='archived' (Drive не чіпається)
    ├── mode='full' → setCases filter + deleteExtendedForDocument + deleteDriveFile + deleteOcrCacheForDocument
    │                  (усе в окремих try/catch; помилки → console.warn, success: true)
    └── mode='registry_only' → setCases filter + deleteExtendedForDocument

MIME:
├── registry_data.json через writeRegistry → application/json ✓
└── documents_extended.json через createDriveFile/updateDriveFile → text/plain ✗ (Drive додає .txt)
```

### 8.3 Що мінімально треба щоб поточні документи Кісельової почали показуватись

Якщо адвокат натисне "Розпізнати зараз" на її документі через DocumentViewer — `getCachedText` поверне null (через q= bug), потім `extractText` запустить full OCR з нуля, поверне текст, і Viewer покаже його (через `setText(content)` у TextContent useEffect, до writeCache доходить чи ні — текст вже в state).

Тобто **обхід для адвоката тут і зараз:** натиснути "Розпізнати зараз" у Viewer — це буде працювати, але повторне відкриття цього самого документа знову не знайде кеш. Кожне відкриття — повний OCR з нуля.

**Постійне виправлення:** виправити `listFolderFilesByName` ocrService (нова рекомендація #2).

---

## 9. ПОЯСНЕННЯ ДЛЯ АДВОКАТА (без термінології)

Нагадую — у вас два пацієнти, Брановський і Кісельова. Реальні дані з вашого Drive дали ясну картину.

**Що насправді у ваших даних.**

У Брановського 6 документів. Розкладемо їх:
- Три (Ухвала про відкриття апеляції, ухвала про відкриття, відзив Позов) — це старі записи з попередньої версії системи. Файлу до них ніколи не було, тільки запис як про "існує такий документ". Тому Viewer чесно каже "Файл не прикріплено". Це не баг, це історія.
- Один (Зустрічний позов) — теж старий запис, але до нього потім був прив'язаний реальний файл. Файл є, OCR є. Цей працює.
- Два (Позовна заява, Висновок експерта jeep cherokee) — нові, ви додавали їх через "+ Додати документ" вчора-сьогодні. Розмір 3 МБ і 2.2 МБ. Файли НЕ залились на Drive (`Failed to fetch`), але запис у реєстрі все одно з'явився. Класичний прояв того бага про який я писав у попередньому звіті — **підтверджено вашими даними на 100%**.

У Кісельової 1 документ — 701_1413_25 кисельова ухвала.pdf. **Файл коректно завантажений, OCR виконувався**. Тобто з upload'ом усе добре. Але Viewer не показує текст. Я знайшов чому — це **новий баг, якого не було в попередньому звіті**.

**Новий баг — пошук кеша через кирилицю.**

Коли ви відкриваєте документ у Viewer, він шукає на Drive файл з OCR-текстом. Ім'я файлу містить кирилицю — "701_1413_25 кисельова ухвала_<id>.txt". Drive має правило: пошук файлів по імені з кирилицею ненадійний (CLAUDE.md це прямо пише — Правило №8). У вашій системі функція пошуку OCR-кеша це правило **порушує** — використовує кирилицю в запиті. Тому пошук "не знаходить" файл навіть коли він реально на Drive. Viewer думає "кеша немає" і показує "Текст ще не розпізнано".

**Тимчасовий обхід для вас:** натиснути "Розпізнати зараз" у Viewer — він тоді запустить OCR з нуля і покаже результат. Але кожне нове відкриття — знову з нуля. Постійне виправлення — виправити функцію пошуку кеша.

**Чому у Брановського є `_metadata/` а у Кісельової немає.**

Це **не баг, це задумана логіка**. Папка `_metadata/` створюється тільки тоді коли у справі є важкі поля документа (теги, нотатки, текстові дати у старому форматі). У Брановського 4 старих записи мали текстові дати ("10 березня 2026 року", "травень 2025"), які не вписувалися у стандартний формат — їх система зберегла у `_metadata/documents_extended.json`. У Кісельової 1 документ зовсім чистий, нема чого зберігати → файл і папка не створюються.

Коли ви додасте до документа Кісельової тег чи нотатку — папка створиться автоматично. Тобто це lazy-логіка: створюється коли треба.

**Що ще нового знайшлося.**

1. **MIME bug підтверджений вашими даними.** Файл `documents_extended.json` приходить з Drive як `.txt` саме тому що код помилково записав його з типом text/plain замість application/json. Дрібниця, але фікситься одною строкою.

2. **schemaVersion 4 у вашому registry — це нормально.** В CLAUDE.md написано про schemaVersion 5, але це стосується схеми документів. Сам registry зберігається як v4 — це навмисно, два паралельні рівні. Поки CLAUDE.md про це згадує лише побіжно, я б це підкреслив явніше — щоб майбутні розробники не плуталися.

3. **Один загадковий запис.** Документ "Зустрічний позов" був створений як legacy (без файлу), але потім отримав driveId і OCR. Через офіційні шляхи коду driveId оновлювати заборонено. Тобто десь у старому коді є шлях яким ви або агент якось додали driveId. Це не критично, але варто перевірити при наступному великому рефакторингу.

**Чи підтвердились наші підозри.**

Більшість — так. AddDocumentModal баг — підтверджено вашими 2 orphan-записами Брановського. Чотири legacy-документи — це не "12 seed", як я припускав у v1, а реальні старі записи. Кісельовин документ — успішно завантажений (відрізняється від моєї гіпотези v1 що там теж orphan), і його симптом має іншу причину.

**Що треба додати до плану виправлень.**

Минулого разу я давав 5 локальних фіксів. Зараз їх стало 7 — додалось 2 нових:

- **#2 (новий):** виправити функцію пошуку OCR-кеша щоб не використовувала кирилицю в запиті. Це прибере проблему Кісельової з невидимим OCR. 15-30 хвилин.
- **#7 (новий):** виправити MIME для `documents_extended.json` (зараз text/plain, має бути application/json). 5 хвилин, але прибере неприємне `.txt` розширення.

Все інше — як було в попередньому звіті: AddDocumentModal fail-fast, fallback для Viewer, повертати warnings при delete, ArchiveView CSS, кастомний DatePicker.

**Чесна оцінка стану системи.**

Реальні дані показали що ваша система **здоровіша ніж я писав у v1**. Канонічна схема працює, міграція виконана, `_metadata/` lazy-create — продумана архітектура. Поточні симптоми — це 4 точкові тріщини, не накопичений хаос. Кожна виправляється за 15-30 хв. Усі разом — 1-2 години роботи.

**Не треба** прискорювати Document Processor v2 заради цих симптомів. Локальні фікси досягнуть мети.

---

**Кінець звіту v2.**
