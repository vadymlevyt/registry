# Звіт — TASK V2-C: підсвітки уваги (тільки Чистий) + прибрати Огляд-кнопку

**Дата:** 2026-06-03
**Фаза:** остання в `clean_text v2`. Parent: `docs/tasks/TASK_clean_text_v2.md`. Спека: `docs/tasks/TASK_clean_text_v2C_highlights.md`.
**Гілка:** `claude/clean-text-v2c-highlights-QqxVa` (база — свіжий `origin/main`, V2-A1/A2/B у проді).
**schemaVersion:** без bump (`variants` з V2-A2; `attentionNotes` — extended, без bump).

---

## Рішення адвоката (перед кодом)

1. **Делімітер міток — `==`** (`==фраза==`). Перевірено: не конфліктує з GFM-таблицями (`|`), кодом (`` ` ``), жирним (`**`); стандартний highlight-синтаксис.
2. **attentionNotes — пласке поле, парність за порядком.** Панель читає `extended.attentionNotes`, пара до `==`-мітки за ПОРЯДКОМ (1↔1). «Зняти всі» → `[]`. Per-mode розділення не робимо (рідкісний крайовий випадок «Конспект перетер Чистий» — поза скоупом; чип/панель лише в Чистому).

---

## Що зроблено

### V2-C.1 — інлайн-мітки в Чистому промті (тільки `clean`)
- `cleanTextService.buildVerbatimPrompt`: нове правило 9 — AI обгортає підозрілу/посунуту фразу `==фраза==` **дослівно** (позначка, не зміна слів) І дублює короткий фрагмент + причину в `attentionNotes`; **порядок міток у тексті = порядок записів** у `attentionNotes`. JSON-форма нотатки змінена на `{ note }` (без `page`).
- `buildDigestPrompt` (Конспект): додано явну заборону інлайн-міток (правило 7 «НЕ став ==…==»); форма нотатки теж `{ note }`.
- `polishToMarkdown` parse: `page` прибрано глобально (форма `{ note }`) — прив'язка за порядком замість ненадійного номера сторінки (пачкування перебазовує номери).

### V2-C.2 — рендер міток (`MarkdownRenderer`)
- `inline()`: `==x==` → `<mark class="attention" data-mark="N">x</mark>` на **вже екранованому** тексті (XSS-safe, як `**`/`*`). `N` — порядковий лічильник (module-scoped, скидається на старті кожного `markdownToHtml`, синхронний рендер → безпечно), 1-based.
- Колір — **design-токен** `--attention-bg` (жовтий, `tokens.css`), `--attention-bg-pulse` для пульсу. Жодного hex у компонентах.

### V2-C.3 — чип + панель у в'ювері (ЛИШЕ `mode==='clean'`)
- `DocumentViewerContent`/`VariantContent`: чип «N поміток» рендериться лише коли `mode==='clean'` і `markCount>0` (count з `==` у `.clean.md`). Для scan/exact/digest чипа немає.
- Панель (`CleanHighlights`): перемикач «Підсвічувати в тексті» (CSS-клас `--marks-hidden` на wrapper, миттєво, нічого не зберігаємо) + список пунктів ↔ `data-mark` за порядком (причини з `extended.attentionNotes`) + клік-навігація (`scrollIntoView` smooth + клас `is-pulse`) + «Зняти всі назавжди».
- **«Зняти всі назавжди»:** стрип `==` з тексту → `onRemoveAllMarks` (re-save `.clean.md` через `ocrService.writeMarkdownArtifact` + очистити `extended.attentionNotes` = `[]`) → локально показуємо стрипнутий текст (markCount→0 → чип зникає). Чистий-варіант лишається (`variants.clean`).
- Спільні хелпери `attentionMarks.js` (`countMarks`/`stripMarks`/`scrollToMark`) — переюзні (борг #47 дорощує per-mark).

### V2-C.4 — прибрано Огляд-кнопку «Очистити тексти»
- Видалено: кнопку у CaseDossier (Огляд-блок), `handleCleanAllTexts`, стан `cleanRunning`/`cleanProgress`/`cleanResult`, компоненти `CleanResultCard`/`CleanMetric`, хелпер `pluralizeDocs`, імпорт і файл `src/components/CaseDossier/services/cleanTextCycle.js` (+ тест `tests/unit/cleanTextCycle.test.js`). Звірено grep — більше ніким не вживалось.
- Додано шви підсвіток: `docFileRef`, `handleLoadAttentionNotes`, `handleRemoveAllMarks` + прокидання `onLoadAttentionNotes`/`onRemoveAllMarks` у `DocumentViewer`.

### V2-C.5 — політика місць
- Без нового коду: Огляд/Реєстр = тільки Точний (масовий AI прибрано); реєстр-AI не додавали (гейт на сервер, борг #45).

---

## Дотик до файлів

**Код:**
- `src/services/cleanTextService.js` — промти Чистий/Конспект + parse `{note}`.
- `src/components/DocumentViewer/MarkdownRenderer.jsx` — рендер `==мітки==` з лічильником.
- `src/components/DocumentViewer/attentionMarks.js` — **новий** спільний хелпер.
- `src/components/DocumentViewer/DocumentViewerContent.jsx` — `CleanHighlights` + стан панелі.
- `src/components/DocumentViewer/index.jsx` — прокидання двох пропів.
- `src/components/CaseDossier/index.jsx` — прибрано Огляд-очистку; додано шви підсвіток.
- `src/styles/tokens.css` — `--attention-bg`, `--attention-bg-pulse`.
- `src/components/DocumentViewer/DocumentViewer.css` — стилі `<mark>`, пульс, чип/панель.

**Видалено:** `src/components/CaseDossier/services/cleanTextCycle.js`, `tests/unit/cleanTextCycle.test.js`.

**Тести (нові/оновлені):**
- `tests/unit/MarkdownRenderer.test.js` — **новий**: `==x==`→`<mark data-mark=N>` за порядком; екранування; скид лічильника; мітка у таблиці.
- `tests/unit/attentionMarks.test.js` — **новий**: count/strip/scroll (пульс на N-й мітці).
- `tests/unit/CleanHighlights.test.jsx` — **новий**: чип лише в `clean` (не digest); панель/список/навігація; перемикач показу; «зняти всі» (стрип + чип зник).
- `tests/integration/overview-no-mass-clean.test.js` — **новий**: Огляд без кнопки/handler/cycle; файл циклу видалено; шви підсвіток присутні.
- `tests/unit/cleanTextService.test.js` — оновлено: `{note}` без `page`; clean-промт має інструкцію мітки + порядок; digest без міток.
- `tests/integration/clean-text-dp.test.js` — оновлено форму нотатки на `{note}`.

---

## Перевірки

- `npm test` — **1892 passed (150 файлів)**, зелено.
- `npm run build` — **success** (Vite, без помилок).

---

## Жорсткі межі (дотримано)

- Підсвітки — ВИКЛЮЧНО Чистий (`mode==='clean'`): чип/панель гейтнуто; Конспект промт без міток; Точний/Скан не проходять через `VariantContent`.
- Per-mark редагування / агент — НЕ робили (борг #47). Стрімінг — НЕ тут (V2-B2). Реєстр-масовий AI — НЕ додавали (гейт на сервер).
- `page` у нотатці прибрано (прив'язка за порядком). `.txt`-політику / схему / долі артефактів НЕ чіпали.
- Стилі — лише design-токени / спільні класи, без CSS-островів і hex у компонентах.

---

## Перевірка адвокатом (план)

1. Згенерувати **Чистий** на скані → жовті підсвітки на сумнівних/посунутих місцях.
2. Режим Чистий → чип «N поміток» → панель: клік по пункту → скрол+пульс; перемикач показу вимк/увімк.
3. Перемкнути на **Точний/Конспект/Скан** → чипа немає.
4. «Зняти всі назавжди» → підсвітки і чип зникли (текст лишився, Чистий-варіант на місці).
5. **Огляд** → кнопки «Очистити тексти» немає.

**Це КОД → фолд у `main` лише після підтвердження адвоката (CI + деплой GitHub Pages).**
