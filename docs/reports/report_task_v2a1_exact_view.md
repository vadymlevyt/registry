# Report — TASK V2-A1: режим «Точний» у в'ювері (clean_text v2, перша безпечна фаза)

**Дата:** 2026-06-02
**Гілка:** `claude/exact-view-document-viewer-ELORL`
**Parent:** `docs/tasks/TASK_clean_text_v2.md` · **Спека:** `docs/tasks/TASK_clean_text_v2A1_exact_view.md`
**schemaVersion:** без bump. **AI:** жодного. **Білінг:** жодного.

---

## ЩО ЗРОБЛЕНО

Додано у `DocumentViewer` третій режим перегляду **«Точний»** — **тільки** для
сканованих документів, що мають `.layout.json`. Текст збирається **на льоту**
з layout детермінованим конденсатором (КРОК 1 `cleanTextService.layoutToMarkdownDraft`,
0 токенів AI) і рендериться через наявний `MarkdownRenderer`. **Нічого не зберігається**
на Drive — обчислення щоразу (дешево, детерміновано).

Перемикач тепер: **Скан / Точний / Текст**. «Скан» і «Текст» — **без змін**
(«Текст» і далі через `getCleanOrRawText`: `.md`→`.txt`). «Точний» стоїть поряд —
саме для **порівняння** Точний (layout) ↔ Текст (`.txt`) перед рішенням про V2-A2.

### Як підключено (тонке доповнення, нічого не видалено)

| Файл | Зміна |
|------|-------|
| `src/components/DocumentViewer/useExactLayout.js` | **новий хук**: `getCachedLayout(file)` → `layoutToMarkdownDraft(layout)`. Одна точка для (а) доступності опції (`status==='ready'`) і (б) markdown. `enabled` вмикає пробу лише для scanned з перемикачем. status: `idle`/`loading`/`ready`/`unavailable`. |
| `ScanTextToggle.jsx` | опція **«Точний»** (icon `AlignLeft`) між Скан і Текст, за пропом `showExact` (default false — старі виклики незмінні). |
| `DocumentViewerHeader.jsx` | прокидає `showExact` у toggle. |
| `index.jsx` | викликає `useExactLayout({ enabled: showModeToggle })`; `showExact={exactReady}`; `mode==='exact'` без готового layout → відкат на `'scan'`. |
| `DocumentViewerContent.jsx` | гілка `mode==='exact'` → `ExactContent` (рендер markdown; спінер `loading`; акуратне повідомлення `unavailable` — не валить в'ювер). |

### Поведінка на межах
- **searchable / inline-renderable** → `enabled=false`, **жодного Drive-виклику**, опції «Точний» немає.
- **scanned без layout (null) / порожній конденсат** → `status='unavailable'` → опція **прихована**, Скан/Текст працюють.
- **помилка `getCachedLayout` (напр. 401)** → catch → `unavailable` → опція прихована, **в'ювер не падає**.
- **проба під час loading** → опція з'являється лише коли `ready`; `ExactContent` має захисний спінер на випадок зміни документа з вибраним exact.

---

## ЩО **НЕ** ЗАЧЕПЛЕНО (git diff підтверджує)

7 файлів змінено + 2 нові — **всі у `src/components/DocumentViewer/` та `tests/`**:

```
src/components/DocumentViewer/DocumentViewerContent.jsx
src/components/DocumentViewer/DocumentViewerHeader.jsx
src/components/DocumentViewer/ScanTextToggle.jsx
src/components/DocumentViewer/index.jsx
src/components/DocumentViewer/useExactLayout.js        (новий)
tests/unit/ScanTextToggle.test.jsx
tests/unit/DocumentViewer.test.jsx                     (+1 mock рядок)
tests/integration/documentViewer-workflow.test.jsx     (+1 mock рядок)
tests/unit/DocumentViewerExact.test.jsx                (новий)
```

**НЕ торкнуто** (жорсткі межі V2-A1):
- ❌ `.txt`-створення — `cleanTextService.js`, `ocrService.js` (write-шляхи `writeExtractedTextArtifact`/`writeArtifact`/`archiveRawTxt`) **не змінені**. `getCachedLayout` — лише **читач** (вже існував з 3.1).
- ❌ DP-пайплайн — `splitDocumentsV3`, `extractV3`, `streamingExecutor` **не змінені**.
- ❌ `layoutToMarkdownDraft` — лише **викликається**, логіка не змінена.
- ❌ Схема — `documentSchema.js`, `migrationService.js` **не змінені**, без bump.
- ❌ AI-режими (Чистий/Конспект), зберігання варіантів — наступні фази.

---

## ЯК ПЕРЕВІРИТИ

- `npm test` → **1838 passed (145 files)**, зелено.
- `npm run build` → **success** (Vite, 17.9s).
- Нові/оновлені тести:
  - `tests/unit/ScanTextToggle.test.jsx` — опція прихована за замовч.; `showExact` показує; `mode=exact` активний; клік → `onChange('exact')`.
  - `tests/unit/DocumentViewerExact.test.jsx` — scanned+layout → опція є, клік рендерить текст з layout, `getCachedLayout` викликано з file-контрактом; searchable → проба не запускається, опції нема; null layout → опція прихована; помилка → опція прихована, в'ювер живий.
  - `layoutToMarkdownDraft` сам покритий тестами 3.1 — не дублювали.

---

## GIT CONFIRM

Код → за правилом №1 CLAUDE.md фолд у `main` **тільки після підтвердження адвоката**
(push у main тригерить CI + деплой). Перед зведенням — `git fetch origin main`, лише FF,
лише при зелених тестах.

---

## ПЕРЕВІРКА АДВОКАТОМ (рішення про V2-A2)

1. Відкрити сканований документ (позовну Брановського) → перемкнути **Скан / Точний / Текст**.
2. Порівняти **«Точний» (layout)** ↔ **«Текст» (`.txt`)**: чи Точний збирає абзаци/заголовки
   так само добре або краще, нічого не губиться/не плутається.
3. **Рішення:** Точний достатньо добрий → зелене на **V2-A2** (прибрати `.txt` для Document-AI-сканів).
   Якщо ні → `.txt` лишається, доопрацювати конденсатор окремо.

**Кінець report V2-A1.**
