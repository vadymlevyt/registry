# Звіт — TASK V2-B: перемикач режимів у в'ювері + генерація на вимогу

**Дата:** 2026-06-03
**Фаза:** третя у clean_text v2 (parent `TASK_clean_text_v2.md`). Спека: `TASK_clean_text_v2B_viewer.md`.
**Гілка:** `claude/clean-text-v2b-viewer-bLCZP` (база — свіжий `origin/main` після V2-A1/A2).
**schemaVersion:** без bump (`variants` з V2-A2 уже у проді).
**Стан:** код+тести зелені (`npm test` 1875 → 1889+, `npm run build` success). Чекає на підтвердження адвоката → фолд у main.

---

## ЩО ЗРОБЛЕНО

### 1. Перемикач режимів (заміна перехідного Скан/Точний/Текст)

Таб **«Текст»** прибрано. Набір вкладок рахує чиста функція `buildViewerTabs({ isScanned, exactReady, variants })` (експорт з `DocumentViewer/index.jsx`):

- **scanned:** `[ Скан ] [ Точний? ] [ Чистий ✨ ] [ Конспект ✨ ]` (Точний — лише коли зібрався layout, як V2-A1).
- **searchable:** `[ Документ ] [ Конспект ✨ ]`.

`ScanTextToggle` переписано з фіксованого Скан/Точний/Текст на **tabs-driven** (приймає масив `{ value, label, icon, ai?, badge?, ready? }`). ✨ (Sparkles) — маркер AI-режиму; badge «переказ» — на Конспекті. Стилі — лише design-токени (`ScanTextToggle.css`).

**Дефолт-таб:** scanned → **Точний** (якщо layout готовий), інакше Скан; searchable → **Документ**. На AI-режим автоматично не потрапляєш. `loadModePreference` тепер повертає `null` коли вибору ще не було → дефолт застосовується реактивно (Точний стає дефолтом щойно довантажиться layout).

### 2. Генерація на вимогу — 🔴 перемикання НЕ запускає AI

Критична вимога UX (підсилена у спеці): **перемикання вкладок завжди безпечне/безкоштовне**.

- Незгенерований AI-таб (`variants[mode]` нема) → **заглушка** «{Чистий|Конспект} ще не створено» + кнопка **«Згенерувати ✨ (~N хв)»** (`VariantContent`). AI **НЕ** стартує на перемиканні.
- Кнопка «Згенерувати» → `onGenerateVariant(document, mode)` (в CaseDossier — `handleGenerateVariant` → `executeAction('dossier_agent', 'clean_document_text', { caseId, documentId, mode })`). Поки генерується — спінер «Очищаю…» (інкрементальний стрімінг — окремо V2-B2).
- Успіх → `document.variants[mode]` оновлюється (selectedDoc merge) → таб показує `.md`.
- Помилка/деградація (`ok:false`) → toast, таб **лишається** заглушкою з кнопкою.
- Згенерований таб → миттєвий показ збереженого `.md` **без повторного AI**. Режими незалежні (можна лише Конспект, лише Чистий, обидва, жодного).

### 3. Рендер готових варіантів

Новий `ocrService.getVariantMarkdown(file, mode)` — публічний читач за режимом: `'clean'` → `<base>_<id>.clean.md`; `'digest'` → `.digest.md` (+ legacy `<base>_<id>.md`). `VariantContent` читає через нього і рендерить `MarkdownRenderer`. Конспект несе badge «⚠ переказ, не дослівно» у тілі.

Окреме ім'я (правило #11): `getVariantMarkdown` («варіант за режимом») ≠ `getCleanOrRawText` («найкращий читабельний текст») ≠ `getDocumentText` («вірний текст для агента»). Три питання — три імені.

### 4. searchable-Конспект (пом'якшення скоуп-гарда ядра)

Рішення адвоката (Q1): **digest → searchable OK; clean → scanned-only**. Гард зроблено **mode-залежним** у ОБОХ точках:

- `cleanTextService.cleanDocument` (КРОК 0): `if (mode !== 'digest' && documentNature !== 'scanned') → skipped`.
- ACTION `clean_document_text`: `wantMode==='clean' && !scanned → skipped`.

Джерело тексту searchable-Конспекту — `fetchRawText` адаптера, перемкнутий на `ocrService.getDocumentText` (layout→`.txt`, хелпер V2-A2). Чистий лишається scanned-only.

### 5. Прибрано кнопку «Очистити документ» з футера (Q2)

Footer-кнопка 3.2 (`onCleanText`) дублювала генерацію Конспекту → **прибрано** (правило #11, один шлях). Генерація живе у вкладках. ACTION `clean_document_text` лишається (його кличуть вкладки і агент досьє). Огляд-кнопку масової очистки НЕ чіпали (V2-C). Копіювати у футері тепер активне у текстових режимах (Точний/Чистий/Конспект) і копіює **вірний** текст (`getDocumentText`), ніколи не переказ.

---

## SAAS / BILLING / AI USAGE

- Генерація — той самий ACTION `clean_document_text` (`billAsUserAction:true`, `module=case_dossier`, ядро звітує `agent_call`; `SELF_BILLING_ACTIONS` не дублює). **Нуль нового білінгу.**
- Точний — без AI (як V2-A1).
- Жодних нових полів/схеми/ACTIONS — лише UI + mode-залежний гард + новий read-аксесор.

---

## ЧОГО НЕ ЗАЧЕПЛЕНО (жорсткі межі)

- ❌ Стрімінг (інкрементальний рендер) — V2-B2 (тут лише спінер-прогрес).
- ❌ Підсвітки уваги (`==`/чип/панель) — V2-C (лише для Чистого).
- ❌ Огляд-кнопка / реєстр-мультивибір / масовий AI — V2-C.
- ❌ Долі артефактів / `.txt`-політика / схема — зроблено в V2-A2, не чіпали.
- ❌ Хардкод стилів — лише токени / спільні компоненти.

---

## ТЕСТИ

| Файл | Що покриває |
|------|-------------|
| `tests/unit/ScanTextToggle.test.jsx` (переписано) | tabs-driven перемикач; «Текст» відсутній; badge; searchable-набір |
| `tests/unit/DocumentViewer.test.jsx` (+`buildViewerTabs` describe) | набір вкладок за documentNature/layout/variants; дефолт; немає `text` |
| `tests/integration/documentViewer-generate.test.jsx` (новий) | 🔴 перемикання=0 викликів AI; кнопка→`clean_document_text(mode)` spy=1; variants→показ `.md`; деградація→toast; готовий таб→миттєво без AI |
| `tests/unit/getDocumentText.test.js` (+`getVariantMarkdown` describe) | clean→`.clean.md`; digest→`.digest.md`/legacy `.md`; clean ≠ legacy; null коли нема |
| `tests/unit/cleanTextService.test.js` (адаптовано) | mode-залежний гард: clean+searchable→skipped; digest+searchable→ok; digest+scanned→ok |
| `tests/integration/clean_document_text.test.js` (адаптовано) | clean+searchable→skipped; digest+searchable→ok, ядро mode=digest |
| `tests/integration/clean-text-dp.test.js`, `DocumentViewerExact/Header/Footer`, `documentViewer-workflow` | адаптовано «Текст»→режими |

`npm test` — повністю зелений. `npm run build` — success.

---

## ФАЙЛИ

**Код:** `DocumentViewer/index.jsx` (tabs/mode/generation), `ScanTextToggle.jsx`+`.css`, `DocumentViewerContent.jsx` (VariantContent), `DocumentViewerHeader.jsx` (tabs), `DocumentViewerFooter.jsx` (прибрано clean-кнопку, copy→getDocumentText), `DocumentViewer.css` (variant-badge), `README.md`; `CaseDossier/index.jsx` (`handleGenerateVariant`, prompt); `ocrService.js` (`getVariantMarkdown`); `cleanTextService.js` + `actionsRegistry.js` (mode-залежний гард); `cleanTextDriveAdapter.js` (fetchRawText→getDocumentText).

---

## ПЕРЕВІРКА АДВОКАТОМ

1. Скан → таби `Скан/Точний/Чистий/Конспект`; Точний дефолтний, миттєвий.
2. Клік «Конспект» (не згенеровано) → **заглушка з кнопкою** (AI не стартує). Натиснув «Згенерувати» → спінер → дайджест із badge «переказ, не дослівно». Перемкнувся назад-вперед — миттєво, без повторного AI.
3. Клік «Чистий» → генерується дослівний текст.
4. Searchable документ → `Документ/Конспект`; Конспект генерується (Чистого/Точного нема).
5. «Текст» більше немає; «Очистити документ» з футера прибрано; плутанини нема.
