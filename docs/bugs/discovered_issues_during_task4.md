# Discovered issues during TASK 4

**Дата:** 2026-05-08

## 1. ACTIONS і PERMISSIONS закриті в App.jsx — потрібен ActionsRegistry refactor

**Контекст:** TASK 4.3 запропонував "Варіант A: винести в окремий файл `src/services/actionsRegistry.js`" як кращий архітектурний шлях. Я обрав прагматичний — повторити логіку у `tests/integration/_actionsHarness.js`, бо переніс 38 ACTIONS це самостійний refactor (~600 рядків закриттів на cases/setCases/setNotes/setTimeEntries/getCurrentUser/activityTracker/тощо).

**Проблема harness-підходу:** при зміні ACTIONS у App.jsx треба синхронно оновлювати harness. Це джерело тихих регресій — тести проходитимуть на harness, а реальний код може поводитись інакше.

**Рекомендований TASK:** ActionsRegistry refactor (1-2 дні роботи)
- Створити `src/services/actionsRegistry.js` з `createActions(deps)` factory.
- App.jsx викликає `useMemo(() => createActions({ cases, setCases, ... }), [cases])` — отримує ACTIONS об'єкт.
- PERMISSIONS і UI_ONLY_ACTIONS — також у цей файл.
- executeAction теж factory (`makeExecuteAction({ ACTIONS, PERMISSIONS, UI_ONLY_ACTIONS, ... })`).
- Тести імпортують `createActions` напряму з мок-deps, harness видаляється.

**Поточний статус:** harness робочий, тести зелені, але існує ризик дрейфу. Зафіксовано як TODO у CLAUDE.md розділ Тестування.

## 2. CANONICAL_DOCUMENT_FIELDS реально 20 полів, не 18

CLAUDE.md і TASK 1 кажуть "18 канонічних легких полів". Реальний імпортований об'єкт має 20:
```
id, name, originalName, category, author, documentNature, namingStatus, isKey,
procId, driveId, driveUrl, folder, pageCount, size, icon, date,
addedAt, updatedAt, addedBy, status
```

TASK 1 при реалізації розділив назви/опційні поля інакше. CLAUDE.md формулювання "18 + 6" — застаріле. Виправити при наступному CLAUDE.md audit (тест `documentSchema.test.js` ловить регресію — фіксує саме 20).

## 3. EXTENDED_DOCUMENT_FIELDS — 7 полів (не 6)

Аналогічно: documentId + tags + notes + annotations + processingHistory + extractedTextSummary + customFields = 7. CLAUDE.md каже "6". Тест ловить.

## 4. callAPIWithRetry — рекомендую додати hint про вище в backoff

Не критично. Зараз `initialDelayMs=1500, maxDelayMs=20000, maxRetries=5`, з jitter сумарно ~24с до повідомлення. Для Tier 1 акаунтів Anthropic при сильному навантаженні може бути замало — але це з реальних метрик буде видно. Поки не правити.

## 5. Vitest 4.x deprecated `poolOptions.threads`

При першому запуску показав:
```
DEPRECATED  `test.poolOptions` was removed in Vitest 4. All previous `poolOptions` are now top-level options.
```
Виправлено: `pool: 'threads'`, `maxWorkers: 4`, `minWorkers: 1` — на топ-рівні. Якщо у майбутньому оновимо Vitest до 5.x — перевірити чи API не змінився.
