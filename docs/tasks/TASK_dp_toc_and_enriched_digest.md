# TASK — DP: детектор реєстру/опису матеріалів + збагачений дайджест паспорта

**Дата спеку:** 2026-05-20
**Статус:** готова до реалізації
**Тип:** якість нарізки (не швидкість) — fix фундаментальної проблеми на великих томах
**Батьківські TASK:** `TASK_smart_triage.md`, `TASK_smart_triage_passport_scale_and_text.md`
**Передумова:** `docs/diagnostics/diagnostic_dp_large_volume_test.md` (Phase A на 273-стор. крим. томі дав 35% точність — фундаментальний провал якості без падінь)

---

## 0. Корінь — з реальних даних адвоката

`diagnostic_dp_large_volume_test.md` показав три складові проблеми на великому томі:

1. **ФД-1.1 «адаптивна щільність» вимикає тіло тексту на томах >100 стор.** Triage отримує лише краї коротких документів — не розрізняє «продовження» від «початок нового».
2. **D1 збагачений дайджест не реалізований** (борг #19). Сигнали які Document AI ВЖЕ віддає (`visualElements`, `imageQualityScores`, к-сть blocks, дельта формату, мова) не доходять до Triage.
3. **Промпт Triage не знає про реєстр/опис матеріалів справи** — обов'язкова таблиця на перших сторінках більшості томів, з готовим планом нарізки. AI просто проходить повз.

Фактичні числа:
- Брановський (65 стор., цивільна, без реєстру) — ~93% точність
- Нестеренко Том 1 (273 стор., крим., **з реєстром**) — **~35% точність, 48 реальних документів викинуто**

Без цього фіксу великі томи невикористні. Швидкість прийнятна (20 хв), стабільність прийнятна (0 падінь), якість провальна.

---

## 1. Місія (що означає «готово»)

1. **Якщо в томі є реєстр/опис матеріалів** — детектор знаходить, парсить, використовує його як ground truth для нарізки (обходить AI Triage). Адвокат отримує точно стільки документів скільки в реєстрі, з точними назвами і діапазонами.
2. **Якщо реєстру нема або не розпарсився** — fallback на AI Triage з **збагаченим дайджестом** (5 нових дорадчих сигналів + watermark).
3. **Брановський (без реєстру)** — точність не нижча за поточну (~85-93%), переважно вища завдяки D1.
4. **Нестеренко Том 1 (з реєстром)** — точність ≥80% (≥59/74 документів) на повторному прогоні. У ідеалі — точно 74 з реєстру.

---

## 2. Інституційні обмеження (з батьківських TASK, діють тут БЕЗ змін)

- **№1 Provider-injected тест якісної поведінки** — кожен новий маршрут МУСИТЬ мати інтеграційний тест через справжній `DocumentPipelineProvider` ін'єктований executor. Phase B регресія була через відсутність такого тесту якісної поведінки 25-doc плану. Не повторюємо помилку.
- **№4 Диригент заморожений** — без нових стадій, без зміни `DEFAULT_STAGE_ORDER`. Детектор реєстру — препроцесор УСЕРЕДИНІ `triageStage`, не нова стадія.
- **№5 Без зміни схеми** — без bump schemaVersion / міграції / бекапу. Реєстр-план транзитний у `ctx`.
- **№11 Один сенс на ім'я** — нова функція/прапор з ясним single-meaning коментарем на місці.
- **Без емодзі, україномовний текст у подвійних лапках/шаблонах** (правило #5 CLAUDE.md).
- **npm test ПОВНІСТЮ зелений** перед кожним комітом.

---

## 3. ГІЛКА A — Детектор реєстру/опису матеріалів справи

### 3.1 Загальне правило (НЕ кримінально-специфічне)

В українській правовій практиці більшість томів справ починається з табличного реєстру/опису матеріалів. Зустрічається у:
- кримінальні томи (майже завжди)
- цивільні справи з великими томами (часто)
- адміністративні провадження (часто)

Заголовок реєстру варіюється: «Опис документів які містяться в томі», «Реєстр матеріалів справи», «Перелік матеріалів», «Зміст тома», «Опис вкладень», «Перелік документів». **Детектор НЕ має керуватись жорстким списком ключових слів** — він має дати AI прочитати заголовок і вирішити чи це реєстр.

### 3.2 Архітектура — препроцесор у `triageStage`

НЕ нова стадія диригента (обмеження №4). Усередині `src/services/documentPipeline/stages/triageStage.js` перед основним AI Triage додається крок:

```
1. tocDetector(layoutJson) → { isToc, headerText, tocPages, items: [{n, name, startPage, endPage}], offset }
2. Якщо isToc=true і items.length > 0:
     → нормалізуємо як plan з .route='slice'
     → пропускаємо AI Triage call
     → формуємо decisions: 'plan_from_registry' для transparency
3. Інакше → поточний Triage з D1 збагаченим дайджестом (Гілка B)
```

### 3.3 Реалізація детектора — два-кроковий AI-виклик (Haiku, дешевий)

**Файл:** `src/services/documentBoundary/tocDetector.js` (новий)

Один сенс (правило #11):
```js
// tocDetector — знайти і розпарсити табличний реєстр/опис матеріалів справи
// на перших ~5 сторінках тома. Якщо знайшов і розпарсив — повертає
// детермінований план нарізки (обходить AI Triage). Інакше — null.
// Один сенс: «прочитати готовий план нарізки з самого тома, якщо адвокат/
// канцелярія його вже склали — не вгадувати».
```

**Крок 1: детекція.** Один Haiku-виклик з content першої ~5 сторінок (можна повний `_text`, обсяг малий):

Prompt-шаблон (структурний тест, не snapshot):
```
Подивись на текст перших сторінок тома справи. Тут може бути табличний
реєстр/опис/перелік документів які містяться в томі (з номерами і
аркушами). Заголовок такого реєстру варіюється: «Опис документів», 
«Реєстр матеріалів», «Перелік», «Зміст тома», «Опис вкладень» тощо.

Поверни ТІЛЬКИ JSON:
{
  "isRegistry": true|false,
  "registryHeaderText": "точний заголовок з документа або null",
  "registryPages": [n, ...] (фізичні сторінки самого реєстру, 1-based),
  "firstDocumentPage": n (фізична сторінка ПЕРШОГО документа після реєстру)
}

Якщо реєстру нема — isRegistry:false і решта null.
```

**Крок 2: парс таблиці.** Якщо `isRegistry=true` — другий Haiku-виклик з `_text` сторінок реєстру:

```
Це сторінки реєстру/опису матеріалів. Розпарсь таблицю — для кожного
рядка: номер, назва документа, діапазон аркушів. Аркуші можуть бути
вказані як «1-5», «6», «7-12», числа можуть бути римськими.

Якщо адвокат/канцелярія використовує власну нумерацію (аркуш 1 — це
перший документ після реєстру) — це нормально, повертай як є. Поле
`offsetFromRegistry` (наступний крок) це врахує.

Поверни JSON:
{
  "items": [
    {"n": 1, "name": "Постанова про порушення кримінальної справи", "startLeaf": 1, "endLeaf": 3},
    {"n": 2, "name": "Протокол огляду місця події", "startLeaf": 4, "endLeaf": 12},
    ...
  ]
}
```

### 3.4 Коригування зміщення нумерації

Опис матеріалів сам може бути на сторінках 1-3 тома, але аркуш «1» у реєстрі = ПЕРШИЙ документ ПІСЛЯ опису = ФІЗИЧНА сторінка 4. Це **зміщення** (offset).

Детектор обчислює:
```js
const offset = firstDocumentPage - 1;  // з кроку 1
// items[i].startPage = items[i].startLeaf + offset
// items[i].endPage   = items[i].endLeaf + offset
```

Перевіряємо валідність:
1. `items` непустий і відсортований
2. Жоден `endPage > totalPages` (всі діапазони в межах тома)
3. Немає overlaps (sanity-check; якщо є — fallback на AI Triage з warning)
4. Кількість сторінок у `registryPages` + сума діапазонів `items` приблизно дорівнює `totalPages` (±5% толеранс)

Якщо валідність провалилась — **не використовуємо реєстр**, йдемо у Гілку B з warning у decisions. Краще fallback ніж зламана нарізка.

### 3.5 Контракт виходу для plan

`tocDetector` повертає (на success):
```js
{
  isToc: true,
  plan: {
    documents: [
      { documentId: 'd1', name: '...', type: 'inferred', route: 'slice',
        fragments: [{ fileId, startPage, endPage }], open: false },
      ...
    ],
    unusedPages: [{ fileId, startPage: 1, endPage: registryEndPage, reason: 'реєстр матеріалів' }],
    confirmed: true,  // bypass autoConfirm — це determistic plan
    source: 'toc_detector'  // метаінформація для decision/audit
  }
}
```

Або на failure: `null`.

### 3.6 Тести (mandatory Provider-integration)

`tests/integration/dp-toc-detector.test.js`:
- Real DocumentPipelineProvider з ін'єктованим mock Haiku який повертає валідний registry response
- 273-стор. mock layoutJson зі справжнім реєстром на стор. 1-3 і ~30 документами після
- assert: detector знайшов, plan.documents.length === 30, всі діапазони валідні і не overlap
- assert: AI Triage НЕ викликався (mock Triage спрацював би warning якщо викликали)
- assert: всі 30 документів справді створились у `cases[].documents` після persist

`tests/unit/tocDetector.test.js`:
- Парс різних форматів аркушів («1-5», «6», «7-12», «I-III»)
- Зміщення нумерації (опис 1-3, перший документ з аркуш 1 = стор. 4)
- Edge cases: реєстру нема (isRegistry:false) → повертає null
- Валідність: overlaps, выход за межі → null + warning

---

## 4. ГІЛКА B — Збагачений дайджест (D1 + watermark)

Активний для томів **без реєстру** (Гілка A повернула null). Також працює як **підстраховка** — якщо реєстр частково неправильний, краще збагачений Triage ніж голий.

### 4.1 Збагачення `compactDigest` у `pageMarkers.js`

**Файл:** `src/services/documentPipeline/pageMarkers.js` (НЕ нова функція — розширюємо `compactDigest`; це БІЛЬ контракту тієї ж функції з тим же сенсом «сукупність дорадчих сигналів меж», правило #11 не порушено бо сенс єдиний).

Додати у `tags.push(...)`:

**4.1.1 Печатка/підпис (visualElements)**

**УВАГА — слабкий у поточному стані.** Перевірено на реальному layout.json
адвоката (`diagnostic_dp_large_volume_test.md`): Document AI у скан-PDF з
планшета **взагалі не повернув `visualElements`**. Можливі причини: не
активовано feature на стороні процесора, або скан-якість недостатня для
детекції. Поки не верифікуємо що Document AI реально віддає
`visualElements` — цей сигнал має **низьку вагу** у компонуванні.

Реалізація береться ТІЛЬКИ за `.type` (string) — кілька десятків символів
у дайджест. Нічого з `layout.boundingPoly` чи інших полів `visualElement`
у дайджест не пише.

```js
const ve = Array.isArray(page?.visualElements) ? page.visualElements : [];
if (ve.length > 0) {
  // Типи з Document AI: 'stamp', 'signature', 'logo', 'photo' тощо
  const types = ve.map(v => v?.type).filter(Boolean);
  if (types.length) tags.push(`vis:${[...new Set(types)].join('+')}`);
}
```

**STRIP-СТРАЖ (критично — захист від регресії B1).** Перевірено офіційну
схему Google Document AI Document.Page (через protobuf):
- `visualElements` за специфікацією — це **`type` (string) + `layout` +
  `detected_languages`**, **БЕЗ image bytes / base64**. Легке поле (~1-2 KB
  на сторінку максимум). Безпечно зберігати.
- АЛЕ є **3 інших важких поля Page** які ми зараз НЕ стрипаємо:
  - **`symbols[]`** — per-character деталі, ще важчі ніж `tokens` (зараз
    стрипано). Не використовується ні для меж, ні для форматування. Стрипати.
  - **`detected_barcodes[]`** — деталі баркодів. Не використовується.
    Опційно стрипати (зазвичай малі, але про всяк випадок).
  - **`transforms[]`** — трансформаційні матриці застосовані до original.
    Не використовується. Стрипати.

**Розширити `STRIPPED_LAYOUT_FIELDS` у `src/services/ocrService.js`:**
```js
const STRIPPED_LAYOUT_FIELDS = [
  'image',             // base64 PNG рендер (стрипано раніше, баг B1)
  'tokens',            // per-token координати (стрипано раніше)
  'symbols',           // per-character деталі (НОВЕ — не використовуємо)
  'detected_barcodes', // НОВЕ — не використовуємо
  'transforms',        // НОВЕ — не використовуємо
];
```

**Профілактика на майбутнє:** якщо Google розширить `visualElement` ще
полем-важким (наприклад rendered crop печатки) — додати у `stripHeavyFields`
ще один прохід по `page.visualElements[i]` з `STRIPPED_VE_FIELDS = ['image']`
як placeholder. Регрес-тест: layout.json після запису має бути ≤100KB на
сторінку.

**4.1.2 Стрибок якості (imageQualityScores дельта vs попередня)**
```js
const q = Number(page?.imageQualityScores?.qualityScore);
if (Number.isFinite(q) && prevQuality != null) {
  const delta = Math.abs(q - prevQuality);
  if (delta > 0.2) tags.push(`якість-стрибок:${delta.toFixed(2)}`);
}
prevQuality = Number.isFinite(q) ? q : prevQuality;
```

**4.1.3 Розрідженість (мало blocks + короткий текст)**
```js
const blocksCount = Array.isArray(page?.blocks) ? page.blocks.length : 0;
const textLen = String(page?._text || '').trim().length;
if (blocksCount <= 3 && textLen < 200) tags.push('розріджена');
```

**4.1.4 Дельта формату/орієнтації vs попередня сторінка**
```js
if (prevFmt != null && fmt !== prevFmt) tags.push(`формат-зміна:${prevFmt}→${fmt}`);
if (prevOri != null && ori !== prevOri) tags.push(`орієнтація-зміна:${prevOri}→${ori}°`);
prevFmt = fmt;
prevOri = ori;
```

**4.1.5 Зміна мови**
```js
const lang = page?.detectedLanguages?.[0]?.languageCode || null;
if (prevLang != null && lang && lang !== prevLang) tags.push(`мова-зміна:${prevLang}→${lang}`);
prevLang = lang || prevLang;
```

### 4.2 Новий сигнал — **table-coverage** (частка сторінки під таблицями)

Document AI повертає `page.tables[].layout.boundingPoly.normalizedVertices`. Можна порахувати **сумарну частку площі сторінки** яку займають таблиці. Якщо >40% сторінки під таблицями — це з ймовірністю сторінка-реєстр/змicst (її основна функція = табличний опис).

Це **сильний сигнал для Гілки A** (детектор реєстру у §3) — він першим знаходить кандидатів сторінок-реєстру і потім Haiku-виклик підтверджує.

```js
function tableCoverage(page) {
  const tables = Array.isArray(page?.tables) ? page.tables : [];
  if (tables.length === 0) return 0;
  let total = 0;
  for (const t of tables) {
    const v = t?.layout?.boundingPoly?.normalizedVertices;
    if (!Array.isArray(v) || v.length < 4) continue;
    const xs = v.map(pt => Number(pt.x) || 0);
    const ys = v.map(pt => Number(pt.y) || 0);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    total += Math.max(0, Math.min(1, w * h));
  }
  return Math.min(1, total);  // [0..1]
}
```

У `compactDigest`:
```js
const tc = tableCoverage(page);
if (tc > 0.4) tags.push(`таблиця-домінує:${(tc * 100).toFixed(0)}%`);
```

«таблиця-домінує» — сигнал «ця сторінка переважно таблиця» — кандидат на реєстр-page. Не вирішує сам, але разом із заголовком «Опис»/«Реєстр»/«Зміст» Haiku-детектор має майже стовідсотково кваліфікувати як реєстр.

### 4.3 Новий сигнал — **якорі-заголовки української юридичної практики**

Не «жорсткий список» (це не дозволяється — обмеження). А **підсилення впевненості** наявного `headingSignal()`: якщо короткий центрований блок зверху сторінки + слово з шорт-списку → майже точно нова сторінка-початок документа.

Шорт-список (case-insensitive, перевірити підрядкове входження у `headingText.toUpperCase()`):

```js
const UA_DOC_HEADERS = [
  'ПОСТАНОВА',
  'УХВАЛА',
  'РІШЕННЯ',
  'ВИРОК',
  'ВИСНОВОК',
  'ПРОТОКОЛ',
  'АКТ',
  'ЗАЯВА',  // позовна заява, заява про
  'ПОЗОВНА',
  'ДОВІДКА',
  'СВІДОЦТВО',
  'ДЕКЛАРАЦІЯ',
  'ДОГОВІР',
  'ОРДЕР',
  'КЛОПОТАННЯ',
  'СКАРГА',
  'ВИМОГА',  // важливо для крим. справ
  'ПОВІДОМЛЕННЯ',
  'ВИТЯГ',
  'ЛИСТ',
];
```

У `compactDigest` (доповнення до наявного `headingSignal` сигналу):

```js
const heading = headingSignal(page);
if (heading) {
  tags.push(`заголовок:"${heading}"`);
  const upper = heading.toUpperCase();
  if (UA_DOC_HEADERS.some(kw => upper.includes(kw))) {
    tags.push('ЯКІР-ДОКУМЕНТА');  // СИЛЬНИЙ сигнал нового документа
  }
}
```

«ЯКІР-ДОКУМЕНТА» — **сильний** сигнал нового документа (не дорадчий). Цей шорт-список покриває ~85% типів документів у судових справах. Якщо адвокат знаходить новий тип — список редагується без зміни схеми (це звичайна константа, не enum).

### 4.4 Сигнал внутрішньої нумерації документа (1 з 9, 2 з 9)

Окремо від нумерації аркушів тома, конкретний документ часто має:
- «стор. 1 з 9» / «1/9» / «Page 1 of 9»
- «-1-» / «-2-»

Поточний `footerNumber` ловить тільки голі числа. Розширити:

```js
function detectDocumentPageNumber(page) {
  const last = lastNonEmptyLine(page?._text);
  if (!last) return null;
  // «1 з 9», «1/9», «Page 1 of 9», «1 of 9», «-1-»
  const m =
    last.match(/(\d+)\s*[з\/]\s*(\d+)/i) ||
    last.match(/page\s+(\d+)\s+of\s+(\d+)/i) ||
    last.match(/^[-—]\s*(\d+)\s*[-—]\s*$/);
  if (!m) return null;
  return { current: Number(m[1]), total: m[2] ? Number(m[2]) : null };
}
```

У `compactDigest`:
```js
const dn = detectDocumentPageNumber(page);
if (dn) {
  tags.push(`док-стор:${dn.current}${dn.total ? `/${dn.total}` : ''}`);
  if (dn.current === 1) tags.push('ПОЧАТОК-ДОКУМЕНТА');
  if (dn.total != null && dn.current === dn.total) tags.push('КІНЕЦЬ-ДОКУМЕНТА');
}
```

«ПОЧАТОК-ДОКУМЕНТА» і «КІНЕЦЬ-ДОКУМЕНТА» — **сильні** сигнали меж (не дорадчі).

### 4.5 Сигнал семантичної безперервності (евристика адвоката)

Адвокат описав свій спосіб виявлення меж: на стику двох сусідніх
сторінок дивитись **останній абзац попередньої** і **перший абзац
наступної**. Якщо текст продовжується смислово — той самий документ;
якщо ні — можлива межа.

**Реалізація — між-сторінковий сигнал**, обчислюється для пари (n, n+1):

```js
function paragraphAtY(page, anchor) {
  // anchor = 'top' (мінімальний topY) або 'bottom' (максимальний bottomY)
  const ps = Array.isArray(page?.paragraphs) ? page.paragraphs : [];
  let target = null, extreme = anchor === 'top' ? Infinity : -Infinity;
  for (const p of ps) {
    const v = p?.layout?.boundingPoly?.normalizedVertices;
    if (!Array.isArray(v) || v.length < 4) continue;
    const top = Math.min(...v.map(pt => Number(pt.y) || 0));
    const bot = Math.max(...v.map(pt => Number(pt.y) || 0));
    const key = anchor === 'top' ? top : bot;
    if (anchor === 'top' ? key < extreme : key > extreme) {
      extreme = key;
      target = p;
    }
  }
  if (!target) return null;
  // Extract text from textAnchor offsets у документі — або скористатись page._text +
  // знанням block-розташування. Для першої ітерації — взяти останнє/перше речення
  // page._text відповідно.
  return extractParagraphText(target, page);
}

function semanticContinuity(prevPage, nextPage) {
  const lastPar = paragraphAtY(prevPage, 'bottom');
  const firstPar = paragraphAtY(nextPage, 'top');
  if (!lastPar || !firstPar) return null;

  const prevEnd = lastPar.trim().slice(-1);
  const nextStart = firstPar.trim().charAt(0);
  if (!prevEnd || !nextStart) return null;

  // ПРОДОВЖЕННЯ: попередня НЕ закінчена крапкою + наступна починається з МАЛОЇ літери
  const endsSentence = /[.!?…»)]$/.test(lastPar.trim());
  const startsLower = /[a-zа-яіїєґ]/.test(nextStart) && nextStart === nextStart.toLowerCase();
  const startsUpper = /[A-ZА-ЯІЇЄҐ]/.test(nextStart) && nextStart === nextStart.toUpperCase();

  if (!endsSentence && startsLower) return 'continues';      // тримай разом
  if (endsSentence && startsUpper) return 'possible_break';  // можлива межа (дорадчий)
  return null;  // нейтрально
}
```

У compactDigest — це **сигнал між сторінками**, не на сторінці. Додаємо
тег до сторінки **n+1**:

```js
// при обході сторінок, з prevPage у замиканні
const cont = semanticContinuity(prevPage, page);
if (cont === 'continues')      tags.push('продовження-абзацу');  // СИЛЬНИЙ сигнал «не межа»
if (cont === 'possible_break') tags.push('можливий-абзацний-розрив');  // дорадчий
```

«продовження-абзацу» — **сильний сигнал ПРОТИ межі**. Triage має
поважати: якщо тут стоїть, не ставити boundary між цими сторінками
**навіть якщо інші дорадчі сигнали підказують межу**. Це той самий
експертний підхід що адвокат застосовує читаючи власні справи.

### 4.6 Сигнал стрибка дефектів сканування

Document AI повертає `image_quality_scores.detected_defects[]` з типами
`quality/defect_blurry`, `quality/defect_noise`, `quality/defect_dark`,
`quality/defect_faint`, `quality/defect_text_too_small`,
`quality/defect_document_cutoff`, `quality/defect_text_cutoff`,
`quality/defect_glare`.

Зміна **набору defects** між сусідніми сторінками — сильніший сигнал ніж
лише `qualityScore` дельта (нова сесія сканування — інша камера, інше
освітлення, інші типи дефектів).

```js
function defectSet(page) {
  const defects = page?.imageQualityScores?.detectedDefects;
  if (!Array.isArray(defects)) return new Set();
  return new Set(defects.map(d => d?.type).filter(Boolean));
}

// у compactDigest, з prev у замиканні:
const cur = defectSet(page);
if (prevDefects && (cur.size !== prevDefects.size ||
    [...cur].some(t => !prevDefects.has(t)))) {
  tags.push('дефекти-зміна');
}
prevDefects = cur;
```

«дефекти-зміна» — дорадчий сигнал, **сильніше** чистого `qualityScore`
delta. Може поєднуватись з `якість-стрибок:0.XX` коли обидва спрацьовують.

### 4.7 Сигнал OCR-якості сторінки

Document AI дає `Layout.confidence` на КОЖНОМУ елементі (Block, Paragraph,
Line). Можна взяти **середній `paragraph.layout.confidence`** як «середню
впевненість OCR на сторінці».

```js
function avgParagraphConfidence(page) {
  const ps = Array.isArray(page?.paragraphs) ? page.paragraphs : [];
  if (ps.length === 0) return null;
  const confs = ps.map(p => Number(p?.layout?.confidence)).filter(Number.isFinite);
  if (confs.length === 0) return null;
  return confs.reduce((a, b) => a + b, 0) / confs.length;
}

// у compactDigest:
const conf = avgParagraphConfidence(page);
if (conf != null && conf < 0.7) tags.push(`OCR-низька:${conf.toFixed(2)}`);
```

«OCR-низька» — НЕ сигнал межі, а **попередження Triage**: на цій сторінці
вміст ненадійний, не створюй новий короткий «документ» через слабкі
сигнали — імовірніше це шум OCR.

---

## 5. Промпт Triage — оновлення

`src/services/documentBoundary/triagePrompt.js` — додати інструкції про новi сигнали і про **сукупність** (не жорсткі гейти):

```
Сигнали меж (зважуй РАЗОМ):

СИЛЬНІ (одного достатньо для висновку про межу):
- "ПОЧАТОК-ДОКУМЕНТА" / "КІНЕЦЬ-ДОКУМЕНТА" — з внутрішньої нумерації
  «1 з N» / «N з N»
- "СКИДАННЯ-НУМЕРАЦІЇ" — за футером тома (число впало назад)
- "ЯКІР-ДОКУМЕНТА" — заголовок зверху сторінки містить типове слово
  українських юр. документів (ПОСТАНОВА, УХВАЛА, ВИСНОВОК, ПРОТОКОЛ,
  АКТ, ЗАЯВА, РІШЕННЯ, ВИРОК, ДОВІДКА, СВІДОЦТВО, ДЕКЛАРАЦІЯ, ДОГОВІР,
  ОРДЕР, КЛОПОТАННЯ, СКАРГА, ВИМОГА, ПОВІДОМЛЕННЯ, ВИТЯГ, ЛИСТ).
  Перелік невичерпний — якщо бачиш інший очевидний заголовок, кваліфікуй
  його теж як якір нового документа.

СИЛЬНІ-АНТИ (одного достатньо щоб НЕ ставити межу — поважай!):
- "продовження-абзацу" — на стику двох сторінок: попередня НЕ закінчена
  крапкою + наступна починається з малої літери. Це той самий документ,
  не ставити boundary навіть якщо дорадчі підказують межу. (Евристика
  адвоката для читання справ.)

ДОРАДЧІ (одного недостатньо, шукай комбінацію 2+):
- "vis:stamp" / "vis:signature" — печатка/підпис на сторінці. УВАГА:
  не універсальний маркер — часом печатка/підпис є на кожній сторінці
  документа (наприклад на нумерованих документах експертизи), не лише
  на останній. Поєднуй з іншими сигналами. Document AI також не завжди
  їх повертає — на скан-PDF з планшета спостерігалась повна відсутність.
- "якість-стрибок:0.XX" — різка зміна qualityScore (нова скан-сесія)
- "дефекти-зміна" — змінився набір detected_defects[] vs попередня
  (інша камера / освітлення / умови сканування). Сильніше за один лиш
  qualityScore.
- "розріджена" — мало тексту, мало блоків (обкладинка, розділювач,
  титулка нового документа)
- "формат-зміна:..." / "орієнтація-зміна:..." — зміна dimension/orientation
  vs попередня
- "мова-зміна:..." — переключення detectedLanguages[0]
- "док-стор:N/M" — внутрішня нумерація документа з його загальною
  довжиною (підказує реальну довжину поточного документа)
- "таблиця-домінує:XX%" — велика таблиця займає >40% сторінки → кандидат
  сторінки-реєстру/змicst (Гілка A)
- "можливий-абзацний-розрив" — на стику: попередня закінчена крапкою +
  наступна починається з великої літери. Слабкий — підсилюється
  іншими сигналами.

МЕТАІНФОРМАЦІЯ (НЕ сигнал межі — попередження):
- "OCR-низька:0.XX" — середня confidence paragraphs <0.7. Не довіряй
  тонким сигналам на цій сторінці, не створюй короткий "документ"
  лише через слабкі підказки на ній — це може бути шум OCR.

Українська судова практика — короткі документи бувають часто:
вимоги в кримінальних справах (1-2 стор.), постанови (1-3 стор.),
протоколи (2-5 стор.), довідки (1 стор.). НЕ зливай їх в один документ
тільки тому що сусідні. Сильний сигнал між ними = майже точно межа.
Сильний-АНТИ сигнал ("продовження-абзацу") = майже точно НЕ межа.
```

**ВАЖЛИВО:** не дрейфувати snapshot `documentBoundary/prompt.js` (старий single-PDF slice prompt) — він заморожений у батьківському TASK обмеження №2 «не дрейфувати snapshot без свідомого рішення». Цей TASK редагує `triagePrompt.js` (новий, для Triage), а `prompt.js` залишається без змін.

---

## 6. Фази

- **ФД-T1 — `tocDetector` сервіс** (чистий, з unit-тестами на mock layoutJson). Без інтеграції в pipeline ще. *STOP.*
- **ФД-T2 — Інтеграція tocDetector у `triageStage`** як препроцесор. Provider-integration тест з 30-doc реєстром. *STOP.*
- **ФД-D1 — Збагачення `compactDigest`** п'ятьма дорадчими сигналами (печатка, якість, розрідженість, дельта формату/орієнтації, мова). Unit-тести на кожен сигнал. *STOP.*
- **ФД-D2 — Table-coverage + ЯКІР-ДОКУМЕНТА + внутрішня нумерація документа.** Unit-тести. *STOP.*
- **ФД-D2.5 — Семантична безперервність (евристика адвоката) + defects-зміна + OCR-confidence.** Unit-тести на пари сторінок (continues / possible_break / neutral). *STOP.*
- **ФД-D2.6 — Розширення STRIPPED_LAYOUT_FIELDS** (symbols, detected_barcodes, transforms) + регрес-тест dp-layout-size.test.js. Один файл `ocrService.js`, ~3 рядки. *STOP.*
- **ФД-D3 — Оновлення `triagePrompt.js`** з інструкціями. Структурний тест (не snapshot). *STOP.*
- **ФД-I — Інтеграційний тест на реалістичних мок-сценаріях:**
  - Брановський-like (без реєстру): D1+watermark має дати ≥85% (поточний baseline) або вище
  - Нестеренко-like (з реєстром): Гілка A має зловити реєстр, нарізати ≥80% (ідеально 100% бо реєстр deterministic)
- **ФД-Z — Звіт** `docs/reports/report_task_dp_toc_and_enriched_digest.md` + оновити `ARCHITECTURE_HISTORY.md` + закрити борги #19 і #21 у `tracking_debt.md`.

Рекомендований порядок: T1 → D1+D2 (паралельно) → D3 → T2 → I → Z. Гілка A залежить від базового D-вузла (бо fallback з A йде у B). Phase Z — після підтвердження адвоката на ОБОХ томах (Брановський + Нестеренко).

---

## 7. Acceptance criteria (бінарний чек-лист)

### Реалізація
- [ ] `tocDetector.js` існує, повертає `{isToc, plan|null}`, всі поля валідні.
- [ ] Інтеграція в `triageStage`: якщо ToC знайдено — bypass AI Triage; інакше — D1 шлях.
- [ ] `compactDigest` несе всі 5 нових сигналів + watermark + внутрішня нумерація документа. Усі — як **дорадчі**, не жорсткі гейти.
- [ ] `triagePrompt.js` оновлено інструкціями про сукупність сигналів. Структурний тест.
- [ ] `prompt.js` (старий single-PDF slice) **не змінений** (snapshot стабільний).

### Тести
- [ ] Unit `tocDetector`: формати аркушів, зміщення, edge cases.
- [ ] Unit `compactDigest`: кожен з 7 нових сигналів окремо (visualElements, якість-стрибок, розрідженість, дельта формату, мова, table-coverage, ЯКІР-ДОКУМЕНТА, док-стор).
- [ ] Integration `dp-toc-detector.test.js`: Provider-injected, 30-doc реєстр → plan з 30 documents, AI Triage НЕ викликався.
- [ ] Integration `dp-enriched-digest.test.js`: Provider-injected, 25-doc план з реалістичними сигналами → ВСІ 25 створені (це Provider-integration якісної поведінки — обмеження №1).
- [ ] Regression `dp-branovsky-quality.test.js`: mock Брановського-like layoutJson → точність ≥85%.
- [ ] **Regression `dp-layout-size.test.js`** (страж B1): після запису mock layout.json з усіма новими сигналами розмір файлу ≤100KB/сторінка. Запобігає тихому розросту layout.json.

### Реальні дані (адвокат тестує на планшеті)
- [ ] Брановський 65 стор. → точність не нижча за 85% (бажано вища).
- [ ] Нестеренко Том 1 273 стор. → точність ≥80%, реєстр знайдено, всі (або майже всі) 74 документи в реєстрі.
- [ ] Час обробки не виріс суттєво (Брановський ≤6 хв, Нестеренко ≤22 хв).

### Документація
- [ ] Звіт ФД-Z.
- [ ] `ARCHITECTURE_HISTORY.md` оновлено.
- [ ] `tracking_debt.md` #19 закритий (борг сплачений), #21 закритий.

---

## 8. SAAS IMPLICATIONS

- Жодної нової сутності зі станом. `tocDetector` — чиста функція; ToC plan транзитний у `ctx`, не персиститься у схему. `tenantId` не зачіпається.
- `tocDetector` AI-виклик через `resolveModel('documentProcessor')` — успадковує tenant-роль через звичайний шлях toolUseRunner.
- Без нових PERMISSIONS — детектор працює усередині наявного `document_processor_agent` allowlist.

## 9. BILLING IMPLICATIONS

- **Нові AI-виклики:** 2 Haiku-виклики на томах де реєстр знайдено (детекція + парс) замість 1 виклику AI Triage. На томах БЕЗ реєстру — 1 виклик AI Triage як раніше.
- **Інструментація:** `logAiUsage` + `activityTracker.report('agent_call', {module: DOCUMENT_PROCESSOR, operation: 'toc_detect|toc_parse|triage'})`. Розрізняємо operation для прозорості токенів.
- Чистий ефект: на томах з реєстром — **2× AI-виклик** (~1-3¢ Haiku, малий), але **результат deterministic** замість евристичного. На томах без реєстру — без змін.
- НЕ дублювати поля між `ai_usage[]` і `time_entries[]`.

## 10. AI USAGE IMPLICATIONS

- Модель: `claude-haiku-4-5-20251001` (поточний default). Не міняємо.
- Точки: `toc_detect`, `toc_parse` (нові, через `resolveModel('documentProcessor')`), `triage` (наявна).
- Tool Use, не JSON ACTIONS (через `toolUseRunner.callAPIWithRetry`).
- Не активуємо `metadata_extractor_agent` (залишається disabled).

---

## 11. ПОЗА ОБСЯГОМ — НЕ РОБИТИ

- НЕ нова стадія диригента (ToC — препроцесор усередині `triageStage`).
- НЕ bump schemaVersion / міграція / бекап (ToC plan транзитний).
- НЕ дрейф snapshot `documentBoundary/prompt.js` (старий single-PDF).
- НЕ міняти моделі (Haiku як був).
- НЕ міняти компактний паспорт `buildCompactTriagePassport` як ціле — лише розширити `compactDigest` усередині (це той самий сенс «сукупність сигналів меж»).
- НЕ міняти OCR / Document AI клієнт.
- НЕ міняти PERSIST логіку (це робота для Phase B v2, інший TASK).
- НЕ повертатись до Phase B P1-P4 — це окрема дискусія.
- НЕ змінювати UI Document Processor (ФД-4 propose→confirm — окрема дискусія).
- НЕ створювати кримінально-специфічні гілки коду — реєстр загальне правило.
- НЕ використовувати жорсткі ключові слова для детекції реєстру — AI читає заголовок сам.
- **НЕ писати важкі бінарні поля у `02_ОБРОБЛЕНІ/*.layout.json`** (страж B1): зокрема не зберігати `image`/`tokens` (вже стрипано) ані будь-яке нове bin-поле з visualElements. Регрес-тест `dp-layout-size.test.js` стереже.
- НЕ використовувати watermark/marker сканера (CamScanner і подібні) як сигнал межі — водяний знак однаковий на всіх сторінках одної сесії сканування і **не несе інформації про межі**. Якщо у майбутньому з'явиться кейс де водяний знак реально допомагає (наприклад мікс сесій сканування в одному томі) — окремий запис у `tracking_debt.md`, не зараз.

---

## 12. HANDOFF — старт нової сесії

**Прочитати в порядку:**
1. `CLAUDE.md` — архітектура, тверді правила.
2. `DEVELOPMENT_PHILOSOPHY.md` — без цього TASK не починати.
3. `docs/tasks/TASK_smart_triage.md` — батьківський, §2 (8 обмежень).
4. `docs/tasks/TASK_smart_triage_passport_scale_and_text.md` — попередній фаз (компактний паспорт, D1 спека).
5. `docs/diagnostics/diagnostic_dp_large_volume_test.md` — РЕАЛЬНИЙ baseline (273 стор., 35% точність).
6. ЦЕЙ файл — спека.

**Карта коду (де реалізовувати):**
- ToC: `src/services/documentBoundary/tocDetector.js` (новий)
- ToC integration: `src/services/documentPipeline/stages/triageStage.js` (препроцесор)
- Digest enrichment: `src/services/documentPipeline/pageMarkers.js` (`compactDigest` extend)
- Prompt: `src/services/documentBoundary/triagePrompt.js`
- Тести: `tests/unit/tocDetector.test.js`, `tests/unit/pageMarkers-digest.test.js`, `tests/integration/dp-toc-detector.test.js`, `tests/integration/dp-enriched-digest.test.js`

**Git (правило №1 CLAUDE.md):** web/remote → harness видасть `claude/*` гілку. Гілкуватись від поточного main (HEAD `8c555c5` або новіший). Зміни КОДУ у main — ТІЛЬКИ FF, ТІЛЬКИ при зелених тестах, ТІЛЬКИ після підтвердження адвоката ПЕРЕД push. Кожна фаза — окремий commit.

**STOP-гейт після ФД-T2 І окремо після ФД-D3.** Дві хвилі тестування адвокатом на планшеті (з і без реєстру).

**На виході:** реалізовані фази T1+T2+D1+D2+D3+I з тестами + звіт ФД-Z + оновлені `ARCHITECTURE_HISTORY.md` і `tracking_debt.md` (закриті борги #19, #21).

---

**Кінець TASK.** Реалізація — окрема нова сесія за цим файлом.
