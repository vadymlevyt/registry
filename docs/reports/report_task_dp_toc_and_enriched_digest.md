# Звіт — TASK ToC + Enriched Digest

**Дата:** 2026-05-22
**Гілка:** `claude/toc-parser-enriched-digest-ccuCK` (запушена на origin, **НЕ** FF-нута в `main` — чекає на STOP #2)
**Базова спека:** `docs/tasks/TASK_dp_toc_and_enriched_digest.md`
**Діагностика-baseline:** `docs/diagnostics/diagnostic_dp_large_volume_test.md`
**Батьківські TASK:** `TASK_smart_triage.md`, `TASK_smart_triage_passport_scale_and_text.md`

## Підсумок

Дві гілки реалізовано і покрито Provider-integration тестами:

- **Гілка A — ToC детектор:** новий `src/services/documentBoundary/tocDetector.js`
  двокроковим Haiku-flow знаходить і парсить табличний реєстр на перших
  ~5 сторінках тома. Якщо знайдено — детермінований план обходить AI
  Triage. Інакше — fallback на AI Triage з збагаченим дайджестом.
- **Гілка B — Збагачений compactDigest:** 11 нових сигналів у
  `src/services/documentPipeline/pageMarkers.js` (5 D1 базових + 4 ФД-D2 +
  4 ФД-D2.5), переглянутий промпт Triage (`triagePrompt.js` ФД-D3) з
  категоріями СИЛЬНІ/СИЛЬНІ-АНТИ/ДОРАДЧІ/МЕТА.
- **Захист B1:** STRIPPED_LAYOUT_FIELDS розширено на `symbols`,
  `detected_barcodes`, `transforms` (ФД-D2.6).

Тести: **1479/1479 зелені** (+87 нових проти baseline 1392). Гілка
готова до тестування адвокатом на планшеті (STOP #2).

## Фази і коміти

| Фаза | Коміт | Що зроблено | Тести |
|------|-------|-------------|-------|
| ФД-D2.6 | `5ffc9fc` | STRIPPED_LAYOUT_FIELDS += symbols, detected_barcodes, transforms; регрес-страж dp-layout-size.test.js (≤100KB/стор., економія ≥8×) | +4 (1 unit + 3 integration) |
| ФД-T1 | `51ea758` | `tocDetector.js` — двокроковий Haiku-flow (detect+parse), валідація+offset, graceful fallback `{isToc:false,reason}`, малі томи (<10) пре-фільтр | +28 unit |
| ФД-T2 | `0d3c165` | `tocDetect` ін'єкція у `createTriageStage`; preconditions (single PDF + pageCount>=10 з layout); Provider обгортка `aiTocDetect`; pageCount береться з layout.pages.length (workaround makeContext) | +9 unit + **5 Provider-integration** |
| ФД-D2 | `8f1ed8d` | `tableCoverage`+`taблиця-домінює:XX%`; UA_DOC_HEADERS (20 слів) + `ЯКІР-ДОКУМЕНТА` як СИЛЬНИЙ; `detectDocumentPageNumber` («1 з 9», «1/9», «Page 1 of 9», «-1-») + `док-стор:N/M`, `ПОЧАТОК-ДОКУМЕНТА`, `КІНЕЦЬ-ДОКУМЕНТА`. Unicode-фікс `домінює` (ю U+044E). | +17 unit |
| ФД-D2.5 | `bd3263e` | `semanticContinuity` (prev.tail vs next.head) → `продовження-абзацу` СИЛЬНИЙ-АНТИ і `можливий-абзацний-розрив` ДОРАДЧИЙ; `defectsChanged` → `дефекти-зміна`; `avgParagraphConfidence` <0.7 → `OCR-низька:0.XX` (МЕТА) | +12 unit |
| ФД-D3 | `135b86c` | `triagePrompt.js` оновлено категоріями СИЛЬНІ/СИЛЬНІ-АНТИ/ДОРАДЧІ/МЕТА; українські патерни (короткі документи в крим./адмін. — норма); `documentBoundary/prompt.js` snapshot НЕ зачеплено | +8 unit |
| ФД-I | `6ab7132` | `dp-enriched-digest.test.js` (25-doc Provider-INT + збагачений паспорт); `dp-branovsky-quality.test.js` (24-doc regression + ≥20 ЯКОРІВ/ПОЧАТКІВ/КІНЦІВ у паспорті) | +4 Provider-integration |
| ФД-Z | (цей коміт) | Звіт + ARCHITECTURE_HISTORY.md + закрито борги #19 і #21 у tracking_debt.md | — |

**Сума:** 7 функціональних комітів + ФД-Z. Перевірено правилом #1
CLAUDE.md: гілка `claude/*`, FF у main — тільки після підтвердження
адвоката ПЕРЕД push.

## Гілка A — ToC детектор

### Архітектура (препроцесор у triageStage, не нова стадія — обмеження №4)

```
files.length===1 + не image + layout.pages.length>=10
  → tocDetect({fileId, layoutJson, totalPages, caseId})
       ├── Крок 1 Haiku detect (перші ~5 стор. → isRegistry, registryPages, firstDocumentPage)
       ├── Крок 2 Haiku parse (registryPages → items[{n,name,startLeaf,endLeaf}])
       ├── Крок 3 validate (overlap, range_overflow, coverage ±5%, offset)
       └── ok → план route='slice' confirmed:true source:'toc_detector'
isToc:true  → BYPASS AI Triage, повертаємо план з реєстру
isToc:false → FALLBACK на AI Triage з збагаченим дайджестом
```

### Контракт tocDetector

```js
detectTableOfContents({ fileId, layoutJson, totalPages, caseId, apiKey, aiUsageSink, callAPI })
  → { isToc: true,  plan: { documents, unusedPages, confirmed:true, source:'toc_detector' } }
  → { isToc: false, reason: 'no_api_key'|'no_layout'|'too_small'|'no_registry_detected'|
                            'detect_invalid_json'|'parse_*'|'invalid_*'|'transport:*' }
```

Усі помилки → graceful `{isToc:false, reason}` без throw. createTriageStage
бачить це як «реєстру нема» → AI Triage.

### Offset логіка (зміщення нумерації)

| firstDocumentPage | registryPages | offset | приклад |
|-------------------|---------------|--------|---------|
| `4` | `[1,2,3]` | `3` | реєстр 1-3, документ № 1 з аркуша 1 → фіз. стор. 4 |
| `null` | `[1,2,3]` | `3` (max) | fallback: реєстр на початку, перший документ одразу після |
| `1` | `[1]` | `0` | реєстр-сторінка не «з'їдає» нумерацію документів |

Валідація:
- items непустий
- startLeaf, endLeaf — числа
- start >= 1
- end >= start
- endPage <= totalPages
- немає overlap між сусідніми items
- покриття (itemPages + registryPages.length) ≈ totalPages, tolerance = max(1, 5% totalPages)

### Білінг §12

Дві операції — окремі точки інструментації:
- `logAiUsageViaSink({agentType:'document_parser', model:Haiku, ..., context.operation:'toc_detect'})`
- `logAiUsageViaSink({agentType:'document_parser', model:Haiku, ..., context.operation:'toc_parse'})`
- `activityTracker.report('agent_call', {module:DOCUMENT_PROCESSOR, metadata.operation:'toc_detect'|'toc_parse'})`

Чистий ефект: коли реєстр знайдено — 2 Haiku замість 1 Triage; коли не
знайдено — 1 Haiku (detect) + 1 Triage. Haiku ~1/3 ціни Sonnet (нам
запропонували claude-haiku-4-5-20251001). Не дублюємо поля між `ai_usage[]`
і `time_entries[]` (правило з CLAUDE.md).

### Provider-integration тест (обмеження №1)

`tests/integration/dp-toc-detector.test.js` — 5 тестів через СПРАВЖНІЙ
`createDocumentPipeline` + `createTriageStage({triage: realTriage, tocDetect: realTocDetect, ...})`
+ стабований global fetch:

1. **30-doc реєстр** → план з 30 documents у persist, callLog ['toc_detect', 'toc_parse'] (БЕЗ triage).
2. **Реєстру нема** → callLog ['toc_detect', 'triage'] → план з AI Triage.
3. **Малий том (<10 стор.)** → ToC пропускається через precondition, callLog ['triage'].
4. **Overlap у parse** → tocDetector повертає isToc:false → fallback на AI Triage.
5. **Decisions містять source 'toc_detector'** + message «Реєстр матеріалів».

## Гілка B — Збагачений compactDigest

### 11 нових сигналів (з категоризацією для промпта)

| Категорія | Тег | Триггер |
|-----------|-----|---------|
| СИЛЬНІ | `ПОЧАТОК-ДОКУМЕНТА` | внутрішня нумерація current==1 |
| СИЛЬНІ | `КІНЕЦЬ-ДОКУМЕНТА` | внутрішня нумерація current==total |
| СИЛЬНІ | `СКИДАННЯ-НУМЕРАЦІЇ` | футер-№ впав vs prev (наявний, не новий) |
| СИЛЬНІ | `ЯКІР-ДОКУМЕНТА` | heading містить слово з UA_DOC_HEADERS |
| СИЛЬНІ-АНТИ | `продовження-абзацу` | prev tail без крапки + next head з малої літери |
| ДОРАДЧИЙ | `печатка/підпис:stamp,signature` | visualElements[].type (D1) |
| ДОРАДЧИЙ | `стрибок-якості:Δ0.XX` | abs(qualityScore - prev) ≥ 0.25 (D1) |
| ДОРАДЧИЙ | `дефекти-зміна` | detectedDefects[] set ≠ prev set |
| ДОРАДЧИЙ | `розріджена` | ≤2 blocks + ≤200 chars _text (D1) |
| ДОРАДЧИЙ | `зміна-формату` | dimension format tag ≠ prev (D1) |
| ДОРАДЧИЙ | `зміна-орієнтації` | orientation ≠ prev (D1) |
| ДОРАДЧИЙ | `зміна-мови:uk→en` | detectedLanguages[0] ≠ prev (D1) |
| ДОРАДЧИЙ | `док-стор:N/M` | внутрішня нумерація з total |
| ДОРАДЧИЙ | `таблиця-домінює:XX%` | sum(tables[].boundingPoly area) ≥40% |
| ДОРАДЧИЙ | `можливий-абзацний-розрив` | prev tail з крапкою + next head з ВЕЛИКОЇ |
| МЕТА | `OCR-низька:0.XX` | avg paragraph.layout.confidence <0.7 |

UA_DOC_HEADERS (20 слів, шорт-список): ПОСТАНОВА, УХВАЛА, РІШЕННЯ, ВИРОК,
ВИСНОВОК, ПРОТОКОЛ, АКТ, ЗАЯВА, ПОЗОВНА, ДОВІДКА, СВІДОЦТВО, ДЕКЛАРАЦІЯ,
ДОГОВІР, ОРДЕР, КЛОПОТАННЯ, СКАРГА, ВИМОГА, ПОВІДОМЛЕННЯ, ВИТЯГ, ЛИСТ.

### Промпт Triage (ФД-D3)

`triagePrompt.js` оновлено інструкціями про сукупність сигналів. AI
зважує сигнали РАЗОМ; жоден сам не вирішує (крім СИЛЬНИХ і СИЛЬНІ-АНТИ
де одного достатньо).

Українські патерни:
- Короткі документи в крим./адмін. справах (вимоги 1-2 стор., постанови
  1-3, протоколи 2-5, довідки 1) — НЕ зливати в один.
- СИЛЬНИЙ сигнал між короткими = майже точно межа.
- СИЛЬНИЙ-АНТИ ("продовження-абзацу") = майже точно НЕ межа.

`documentBoundary/prompt.js` snapshot (старий single-PDF slice) **НЕ
зачеплено** (обмеження №2 §13 батьківського TASK).

### Provider-integration тест якісної поведінки (обмеження №1)

`tests/integration/dp-enriched-digest.test.js` (2 тести) — критичний
страж від Phase B-style регресії:

1. **25-doc реалістичний план через справжній Provider** → ВСІ 25
   documents створені у persist (assert `captured.plan.documents.length === 25`,
   `res.documents.length === 25`, всі `route === 'slice'`). Це той тип
   тесту, якого НЕ було для Phase B P1: Phase B зламала branch A (slice)
   у passthrough, але тести concurrency-ліміту були зелені — якщо знову
   зламається, цей assert червоний.
2. **Triage prompt містить збагачений паспорт** — assert що до AI йде
   паспорт з ЯКІР-ДОКУМЕНТА, ПОЧАТОК-ДОКУМЕНТА, заголовок:"ПОСТАНОВА",
   док-стор:1/4 + інструкція "зважуй РАЗОМ" + "СИЛЬНІ-АНТИ".

`tests/integration/dp-branovsky-quality.test.js` (2 regression тести)
— страж від pipeline-регресії на 65-сторінковому томі з 24 документами:

1. **mock-Брановський 24 doc-план через Provider** → ВСІ 24 документи
   у persist, точність ≥85% (з baseline diagnostic). Реальна точність
   — окремий тест на планшеті адвоката.
2. **Паспорт містить ЯКОРІ/ПОЧАТКИ/КІНЦІ** для кожного нового документа
   — assert ≥20 з 24 кожного типу сигналу (страж що сигнали правильно
   генеруються по всьому тому).

## Захист B1 — розширення STRIPPED_LAYOUT_FIELDS (ФД-D2.6)

3 нові поля Document AI у стрипі: `symbols`, `detected_barcodes`,
`transforms`. Усі важкі (per-glyph деталі / баркоди / трансформ-матриці),
жодне не споживається ні Triage, ні очисткою, ні в'юером.

Регрес-страж `tests/integration/dp-layout-size.test.js`: реалістичний
layout з усіма важкими полями (image 80KB base64 + 800 tokens + 3000
symbols + 3 barcodes + 6 transforms + 40 paragraphs + 8 blocks + tables
+ visualElements + dimension) → записаний `.layout.json` ≤100KB/стор.,
економія vs raw JSON.stringify ≥8×.

## Узгодженість з інституційними обмеженнями

| Обмеження | Стан |
|-----------|------|
| **№1** Provider-integration тест якісної поведінки | ✅ dp-toc-detector (5), dp-enriched-digest (2), dp-branovsky-quality (2). Phase B-стиль регресії неможлива тихо. |
| **№2** prompt.js snapshot не дрейфує | ✅ `git diff main src/services/documentBoundary/prompt.js` пусто. |
| **№4** Диригент заморожений | ✅ ToC препроцесор УСЕРЕДИНІ `triageStage`, не нова стадія. `DEFAULT_STAGE_ORDER` незмінний. |
| **№5** Без зміни схеми | ✅ ToC plan транзитний у `ctx.reconstructionPlan`, не персиститься. Без bump schemaVersion/міграції/бекапу. |
| **№11** Один сенс на ім'я | ✅ `tocDetector` (читати готовий план з тома), `таблиця-домінює` (частка площі), `ЯКІР-ДОКУМЕНТА` (новий документ за заголовком), `продовження-абзацу` (анти-межа з евристики адвоката), `STRIPPED_LAYOUT_FIELDS` (важкі поля, не споживаються ніким). |
| **№7** metadata_extractor_agent disabled | ✅ Не активований. |
| **№10** SAAS + BILLING IMPLICATIONS | див. нижче |

## SAAS IMPLICATIONS

- Жодної нової сутності зі станом. `tocDetector` — чиста функція; ToC
  plan транзитний у `ctx`, не tenant-scoped.
- `tocDetect` AI-виклик через `resolveModel('qiParserDocument')` —
  успадковує tenant-роль через звичайний шлях toolUseRunner.
- Без нових PERMISSIONS — детектор працює усередині наявного
  `document_processor_agent` allowlist.

## BILLING IMPLICATIONS

- **Нові AI-виклики (Haiku):**
  - На томах з реєстром: 2 Haiku (`toc_detect` + `toc_parse`) замість
    1 Triage. Чистий ефект: ~+1 Haiku-виклик (~1-2¢), але результат
    deterministic.
  - На томах без реєстру: 1 Haiku (`toc_detect:false`) + 1 Triage. Чистий
    ефект: +1 зайвий Haiku (~1¢), але збагачений дайджест компенсує
    якістю нарізки.
- **Інструментація:** `logAiUsage` + `activityTracker.report('agent_call',
  {module:DOCUMENT_PROCESSOR, operation:'toc_detect'|'toc_parse'|'triage'})`.
  Розрізняємо `operation` для прозорості токенів у звітах.
- НЕ дублювати поля між `ai_usage[]` і `time_entries[]` (CLAUDE.md).
- Усі телеметрія-виклики у try/catch (не валити job через білінг).

## AI USAGE IMPLICATIONS

- Модель: `claude-haiku-4-5-20251001` (поточний default через
  `resolveModel('qiParserDocument')`). Не міняємо.
- Точки: `toc_detect`, `toc_parse` (нові), `triage` (наявна).
- Tool Use через `toolUseRunner.callAPIWithRetry`, не JSON ACTIONS.

## Метрики (mock + baseline)

| Метрика | Baseline (diagnostic) | Mock тест | Очікувано на реальному прогоні |
|---------|----------------------|-----------|-------------------------------|
| Брановський 65 стор. (без реєстру) — точність | ~85-93% | 100% (24/24) | ≥85% (паритет з baseline або кращим) |
| Нестеренко 273 стор. (з реєстром) — точність | **~35% (26/74)** | 30/30 (100%) коли реєстр знайдено | ≥80% (ціль) або ~100% якщо реєстр повний |
| Тестів | 1392/1392 | 1479/1479 | — |
| Розмір .layout.json | ≤100KB/стор. (B1) | ≤100KB/стор. (страж укріплено) | без змін |

## STOP #2 — обов'язково перед FF у main

Гілка `claude/toc-parser-enriched-digest-ccuCK` запушена; чистий FF у
main можливий ТІЛЬКИ після підтвердження адвоката, що на реальному
прогоні на планшеті:

- **Брановський 65 стор.** → точність ≥85% (паритет з baseline або
  краще), час ≤6 хв. Перемикач Скан/Текст показується, документи в
  реєстрі.
- **Нестеренко Том 1 273 стор.** → точність ≥80%, реєстр знайдено,
  ≥59/74 документів (ідеально — точно 74 з реєстру). Час ≤22 хв. У
  decisions має бути `source:'toc_detector'` і повідомлення «Реєстр
  матеріалів у томі: N документів за описом справи».

Якщо ОБИДВА томи проходять — адвокат підтверджує, FF push у `main`,
GitHub Actions деплоїть на Pages. Якщо хоча б один регресував — гілка
лишається на origin, окрема діагностика.

## Закрито борги

- **#19** — Збагачений дайджест паспорта меж D1 + сильні сигнали D2/D2.5
  (комiти 8f1ed8d, bd3263e, 135b86c).
- **#21** — Детектор реєстру/опису матеріалів справи (коміти 51ea758,
  0d3c165).

Обидва — позначені закресленням у tracking_debt.md.

## Файли змін (висота гілки)

```
src/services/ocrService.js                                   — ФД-D2.6 STRIPPED_LAYOUT_FIELDS +3
src/services/documentBoundary/tocDetector.js                 — ФД-T1 новий сервіс
src/services/documentBoundary/triagePrompt.js                — ФД-D3 промпт оновлено
src/services/documentPipeline/pageMarkers.js                 — ФД-D2 + ФД-D2.5 нові сигнали і хелпери
src/services/documentPipeline/stages/triageStage.js          — ФД-T2 інтеграція tocDetect
src/contexts/DocumentPipelineContext.jsx                     — ФД-T2 ін'єкція aiTocDetect
tests/unit/ocrService.test.js                                — +1 ФД-D2.6 (symbols/transforms strip)
tests/unit/tocDetector.test.js                               — +28 ФД-T1
tests/unit/triageStage.test.js                               — +9 ФД-T2
tests/unit/pageMarkers.test.js                               — +29 ФД-D2 + ФД-D2.5
tests/unit/triagePrompt.test.js                              — +8 ФД-D3
tests/integration/dp-layout-size.test.js                     — новий регрес-страж ФД-D2.6
tests/integration/dp-toc-detector.test.js                    — новий 5 Provider-integration ФД-T2
tests/integration/dp-enriched-digest.test.js                 — новий 2 Provider-INT ФД-I (25-doc)
tests/integration/dp-branovsky-quality.test.js               — новий 2 regression ФД-I
ARCHITECTURE_HISTORY.md                                      — секція «TASK ToC + Enriched Digest»
tracking_debt.md                                             — закриті #19, #21
docs/reports/report_task_dp_toc_and_enriched_digest.md       — цей звіт
```
