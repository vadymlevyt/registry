# Звіт — DP layout-leak + speed fixes (Phase A завершено)

**Дата:** 2026-05-20
**Спека:** `docs/tasks/TASK_dp_layout_leak_and_speed_fixes.md`
**Гілка реалізації:** `claude/smart-triage-implementation-yFm9o`
**Коміти:** `2af822f` (B1) · `8bc53b9` (B2) · `345f034` (B3)
**Стан:** Фаза A завершена і запушена в `main`. Фаза B (P1-P4) — окрема сесія.

---

## 1. Корінь — знайдено з реальних даних адвоката

Форензичний аналіз файла `.layout.json` зі справи Брановського (надісланий
адвокатом після тесту на планшеті 17:14-17:28):

| Поле | Розмір | % | Має бути |
|---|---|---|---|
| `image` (base64-PNG render сторінки) | 11.6 МБ | 80.7% | **викинуто** |
| `tokens` (per-letter координати) | 2.4 МБ | 16.4% | **викинуто** |
| Корисне (text, blocks, paragraphs, dimension) | ~400 КБ | ~3% | зберігається |
| **TOTAL** | **14 МБ** | 100% | очікувано ~400 КБ |

**Точка обходу strip:** `src/contexts/DocumentPipelineContext.jsx:219-227`:

```js
writeLayout02: async ({ caseData, driveId, name, layoutJson }) => {
  try {
    await ocrService.writeLayoutArtifact(
      { id: driveId, name, subFolders: caseData?.storage?.subFolders },
      typeof layoutJson === 'string' ? layoutJson : JSON.stringify(layoutJson),  // ← БАГ
    );
  } catch { /* layout кеш не критичний */ }
}
```

`JSON.stringify(layoutJson)` перетворював об'єкт на string ПЕРЕД викликом
`writeLayoutArtifact`. А `writeLayoutArtifact` (ocrService.js:196-206)
очікує об'єкт для проходу `for (const f of STRIPPED_LAYOUT_FIELDS) delete page[f]`.
На string ця логіка ніколи не запрацювала. Поля `image`/`tokens` йшли в
Drive як є.

**Магнітуда на Брановському (25 нарізаних документів):**
- Очікувано: 25 × ~400 КБ = ~10 МБ серіальних Drive uploads
- Реально: 25 × ~14 МБ = **~350 МБ серіальних Drive uploads**
- На планшеті WiFi (~5-10 МБ/с): **5-15 хв** чистого мережевого I/O
- catch ковтав помилки → pipeline «висить на 100% майже готово» без видимої причини

---

## 2. Реалізовані фікси

### B1 — Layout-strip leak (КОРНЕВИЙ)

**Файли:**
- `src/services/ocrService.js`: `writeLayoutArtifact` тепер приймає ТІЛЬКИ
  об'єкт і САМА робить strip + serialize. String-вхід відхиляється з
  warning у консоль (захист від регресії).
- `src/contexts/DocumentPipelineContext.jsx:219-227`: прибрано
  `JSON.stringify` перед `writeLayoutArtifact` — передається об'єкт.
- `src/components/CaseDossier/index.jsx:3025-3037`: парсить
  `mergeLayoutJson` string у об'єкт перед передачею в writeLayoutArtifact
  (інша точка виклику з тим самим anti-pattern).

**Тести:**
- Unit: `ocrService.writeLayoutArtifact` з object → uploaded blob НЕ містить
  `"image"` чи `"tokens"`, розмір пропорційний корисним полям.
- Unit: `ocrService.writeLayoutArtifact` зі string → warning + reject.
- Integration: Provider-DP run на mock 5-page scan → жоден з written blobs
  не має image/tokens (інспекція mock `drivePort.uploadText` args).

### B2 — `documentNature='scanned'` на нарізаних документах

**Файл:** `src/services/documentPipeline/stages/splitDocumentsV3.js`

Нова чиста функція `inferDocumentNatureFromSource(sourceFile)`:
- Якщо `sourceFile.layoutJson.pages` непорожній (OCR відбувся) → `'scanned'`.
- Якщо `sourceFile.documentNature` явно `'searchable'` → пробросити.
- Інакше → null (fallback на `detectNature` у factory).

Виставлюється в `metadataTemplate.documentNature` при формуванні meta для
`createDocument`. Пріоритети: explicit metadataTemplate > layout signal >
null fallback.

**Корінь зниклого перемикача Скан/Текст у в'юері:** раніше нарізаний документ
не мав `documentNature='scanned'`, бо `splitDocumentsV3` не передавав це
поле, а `detectNature` для PDF mime повертав null або 'searchable'. В'юер
показує перемикач лише для `documentNature === 'scanned'`.

**Тести:**
- Unit: `inferDocumentNatureFromSource` — табличні випадки.
- Unit: `createDocument` з різними metadata → правильний documentNature.
- Integration: Provider-DP run на mock scan → всі sliced docs мають `'scanned'`.

### B3 — image_merge не валить pipeline

**Файл:** `src/services/documentPipeline/stages/splitDocumentsV3.js:266-280`

Throw усередині image_merge маршруту тепер обгорнуто try/catch:
```js
try {
  // image_merge: композиція через mergeImagesToPdf
} catch (err) {
  decisions.push({
    type: 'image_merge_failed',
    documentName: doc.name,
    message: String(err?.message || err),
  });
  continue;  // більше НЕ {fatal:true}
}
```

Інші документи pipeline зберігаються нормально. Помилка з'являється у
Зоні «Потребує уваги» з конкретним документом.

**Тести:**
- Unit: mock image bytes що падають на createImageBitmap → graceful failure.
- Integration: 3 image docs (2 valid + 1 invalid) → pipeline ok:true,
  decisions містить image_merge_failed, 2 valid створені, 1 invalid — у
  decisions.

---

## 3. Тести

**1392 / 1392 зелені** (було 1374, додано 18 нових: 11 unit + 7 integration).

Кожен баг покрито Provider-integration тестом через справжній
`DocumentPipelineProvider`-injected executor (інституційне обмеження
батьківського `TASK_smart_triage.md` §2.1: стадії в ізоляції зеленими
були при DP-4, але реальний Provider тихо падав у passthrough).

---

## 4. Підтверджено на реальних даних (Брановський, планшет, два прогони)

| Метрика | До | Після | Множник |
|---|---|---|---|
| Розмір `.layout.json` / стор. | ~1800 КБ | ~37 КБ | ×48 |
| Розмір файлу на 8 стор. | 14 МБ | 300 КБ | ×47 |
| Зависання «100% майже готово» | 5-15 хв | ~10 сек | — |
| End-to-end на 65 стор. → 25 docs | ~15-50 хв | **5-6 хв** | ×3-10 |
| Якість нарізки (оцінка адвоката) | — | 85-90% | — |

Прогін 1: модалка показала 25 документів планується, в реєстр потрапило 24 —
один пішов у `image_merge_failed` decision (паспорт громадянина України Брановського,
ймовірно HEIC або PDF image-only). B3 спрацював як задумано — не валить інші.

Прогін 2: 23 розпізнало, додало 19-21. Кілька документів об'єднано (Triage
квалітет — окреме питання, відкладено в борг #19). Паспорт пропущено
(дуже погана якість зображення). Адвокат: «межі документів краще визначило
ніж першого разу… в цілому 85-90%».

Швидкість: «19:15 старт → 19:21 завершення = ~5-6 хв, зависання на 100%
~10 сек максимум» — мета досягнута.

---

## 5. Поза обсягом → `tracking_debt.md`

Додано три записи:

- **#17 HEIC→JPEG передобробка** перед image_merge — тригер: ≥2 повторних
  `image_merge_failed` на HEIC/PDF image-only на різних справах.
- **#18 Подвійна риска прогрес-бару** у `GlobalProgressScreen.jsx` —
  візуальний side-effect, UI cosmetic; тригер: наступне суттєве
  редагування файла АБО окремий UI-cleanup TASK.
- **#19 Збагачений дайджест паспорта (D1)** — печатка/підпис/стрибок
  якості/розрідженість/дельта формату/мова; тригер: якщо після Фази B
  і ФД-4 propose→confirm UI якість нарізки лишається <90%.

---

## 6. Phase B — НЕ розпочата (окрема сесія)

Спека P1-P4 у тому самому файлі `docs/tasks/TASK_dp_layout_leak_and_speed_fixes.md`:

- **P1** — Паралелізувати PERSIST Drive uploads через `Promise.all` з
  обмеженим concurrency (5-10). `splitDocumentsV3.js:207, 320, 421`.
  Очікуваний виграш: ~3-5× на PERSIST на 25 документах.
- **P2** — Дебаунс registry-save useEffect (`App.jsx:4314-4382`).
  Очікуваний виграш: ~10-15 сек економії на DP-прогін (150-200 fires →
  3-5 saves).
- **P3** — Explicit timeout (60 сек) на всі Drive API через
  AbortController. Прибирає невидимі багатогодинні зависання при
  мережевих проблемах.
- **P4** — Throttle `jobState.json` save до ≤1/10 сек у normal режимі.
  Очікуваний виграш: ~10-15 сек.

Для майбутніх 200-250-стор. томів з очисткою тексту і стисненням
(додаткові важкі операції) кожен виграш матиме мультиплікативний ефект.

---

## 7. Git

Push у `main`: чистий fast-forward `30003b9..345f034`. Доковий частина
цього TASK (спека `30003b9`) була зроблена окремо раніше; ФД-1.1 коміт
`af79086` (адаптивна щільність паспорта) — паралельна гілка, була
змержена в main між коміттами цього TASK; rebase зроблено акуратно,
без force, без конфлікту.

CI прогнала test→build→deploy. Live на `vadymlevyt.github.io/registry/`.

---

## 8. Уроки

1. **Анти-pattern «JSON.stringify перед wrapper що приймає об'єкт»** —
   обходить будь-яку логіку strip/transform всередині wrapper'а. Шукати
   аналогічні випадки в інших точках Provider DI.
2. **Catch що ковтає «не критичну» помилку** — небезпечний коли «не
   критична» помилка щоразу штрафує час або обсяг. Має бути або
   видимий warning (`console.warn`), або decision у UI, або обмежений
   retry. «Молчазний» catch не повинен бути дефолтом.
3. **Форензичний аналіз реального файла адвоката** виявив корінь, який
   статичний аудит коду пропустив (бо STRIPPED_LAYOUT_FIELDS виглядав
   правильним — потрібно було перевірити що strip-функція РЕАЛЬНО
   викликається на даних які проходять через writeLayout02).
4. **B1 один сам — головний виграш.** B2, B3, P1-P4 — інкрементальні.
   У майбутньому пріоритезувати фікси за реальною магнітудою (тут ×48 на
   розмірі = ×30 на часі), не за алфавітом.

---

**Кінець звіту Фази A.** Phase B — окрема сесія за тією самою спекою.
