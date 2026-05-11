# TASK 0.2 — Інфраструктура модуля «Електронний суд»

**Дата:** 2026-05-11
**Статус:** виконано
**SchemaVersion:** 6 (без зміни)

---

## Перелік змінених/створених файлів

### Створено

- `src/components/CourtSync/index.jsx` — компонент модуля з підвкладками ЄСІТС і Розвідник.
- `src/services/eventBus.js` — pub/sub (subscribe / publish / clear / subscriberCount).
- `src/services/eventBusTopics.js` — константи топіків ЄСІТС.
- `src/services/ecitsService.js` — фасад EcitsAPI (всі методи — заглушки).
- `src/constants/documentSources.js` — константи каналів надходження + isValidDocumentSource.
- `tests/unit/courtSyncInfrastructure.test.js` — 27 юніт-тестів інфраструктури.
- `report_task_0_2_court_sync_infrastructure.md` — цей файл.

### Змінено

- `src/App.jsx` — імпорти Scale/ICON_SIZE, lazy-load CourtSync, нова nav-кнопка між «Книжкою» і «Новою справою», новий tab=='courtsync' рендер.
- `src/schemas/documentSchema.js` — додано nullable поле `source` (21-ше канонічне поле) з enum.
- `src/services/documentFactory.js` — createDocument проставляє `source: metadata.source ?? null`.
- `src/services/tenantService.js` — `DEFAULT_TENANT.settings.moduleIntegration.ecits` з усіма дефолтами.
- `src/services/migrationService.js` — `ensureModuleIntegration()` приклеює дефолти ecits до існуючих tenant'ів без bump'у schemaVersion.
- `src/services/driveService.js` — `getOrCreateResearchFolder(type, name)` для lazy-create `_research/ecits/` і `_research/competitors/`.
- `tests/unit/documentSchema.test.js` — оновлено очікувану кількість канонічних полів з 20 на 21.
- `CLAUDE.md` — додано розділ «МОДУЛЬ ЕЛЕКТРОННИЙ СУД» (≤30 рядків).

---

## Як виглядає нова вкладка

Топ-навігація додає одну кнопку після «📓 Книжка»:

```
📊 Дашборд │ 📁 Справи (N) │ 📓 Книжка │ ⚖ Електронний суд │ ➕ Нова справа │ 🔍 Аналіз системи
```

«Електронний суд» — це єдина кнопка в навігації що НЕ використовує емодзі: іконка `Scale` з lucide-react (терези правосуддя) + текст «Електронний суд», обгорнуті в `<span style="display:inline-flex;gap:6">` через готовий `<Scale size={ICON_SIZE.sm} />`.

При активній вкладці контент розкладається так:

```
[Терези] Електронний суд
         Синхронізація з кабінетом ЄСІТС
─────────────────────────────────────────
[ЄСІТС] [Розвідник]            ← тільки для founder. Для не-founder ряд відсутній
─────────────────────────────────────────
[Огляд] [Журнал] [Налаштування] [Розбіжності]
─────────────────────────────────────────

      Огляд
      У розробці. Тут буде статус останньої
      синхронізації, нові надходження та підсумок по справах.
```

Перемикач секцій (ЄСІТС/Розвідник) рендериться **тільки коли `isCurrentUserFounder() === true`**. Для не-founder це звичайний модуль ЄСІТС без видимого перемикача — Розвідник просто не існує в UI.

## Підтвердження founder-gating

Концептуально: компонент `CourtSync` на старті бере `const founder = isCurrentUserFounder()`.
- `founder === true`: рендериться перемикач секцій + може бути показана секція 'scout' з підвкладкою «Інструменти».
- `founder === false`: блок перемикача обгорнутий `{founder && (...)}` — не рендериться взагалі. Блок 'scout' також обгорнутий `{founder && section === 'scout' && (...)}` — не рендериться. Стейт `section` ініціалізується значенням `'ecits'`, тому за відсутності перемикача користувач завжди бачить ЄСІТС.

Юніт-тести покривають предикат і його три кейси (founder=true / false / undefined).

---

## Результати тестів

```
$ npx vitest run

Test Files  42 passed (42)
Tests       558 passed (558)
Duration    ~33s
```

З них новий файл `courtSyncInfrastructure.test.js` додав 27 тестів, що покривають:
- eventBus.subscribe/publish/unsubscribe/clear/subscriberCount + error-isolation handlers
- eventBusTopics — всі 4 константи + frozen ECITS_TOPICS
- ecitsService — всі 5 методів повертають очікувані структури
- DEFAULT_ECITS_SETTINGS — frozen + правильні дефолти
- DEFAULT_TENANT.settings.moduleIntegration.ecits — структура присутня з усіма полями
- document.source: nullable за замовченням, валідний при передачі, відхиляється при поганому значенні
- DOCUMENT_SOURCES + DOCUMENT_SOURCE_LABELS + isValidDocumentSource
- founder-gating: predicate behaviour для true/false/undefined
- buildEmptyRegistry створює tenant з moduleIntegration.ecits

Існуючий тест `documentSchema.test.js` оновлено (20 → 21 поле) — інших регресій немає.

---

## Vite build

```
$ npm run build
vite v6.4.1 building for production...
✓ 2382 modules transformed.
✓ built in 15.98s
```

Білд чистий (без помилок), лише попередження про chunk size — не пов'язане з цим TASK.

---

## Іконки використані з існуючого набору (lucide-react)

- `Scale` — терези правосуддя для табу «Електронний суд» в навігації та заголовка модуля.
- `Search` — підвкладка «Розвідник» (увагу, не потрапляє в UI для не-founder).

Розміри — через стандартний `ICON_SIZE.sm` / `ICON_SIZE.lg` з `components/UI/icons.js`.

---

## Дизайн-питання які потребують уточнення

Жодних. Усі елементи модуля вкладаються в існуючі design-токени (`var(--color-*)`, `var(--text-*)`, `var(--font-heading)`). Layout-розкладка — flex з gap. Жодних власних `--*` змінних не додавалось.

Єдина свідома стилістична деталь — кнопки підвкладок повторюють пресет з CaseDossier (inline-стилі з `border-bottom: 2px solid var(--color-text-2)` для активного стану). Це навмисна узгодженість з існуючим UX вкладок, не нова стилістика.

---

## Знайдені побічні баги

Жодних. Файл `bugs_found_during_task_0_2.md` не створено.

---

## SAAS / BILLING / AI USAGE — підтвердження вимог

- **SAAS:** Розвідник захищений через `isCurrentUserFounder()` (точка розширення для майбутнього перемикача Practice/Founder); ecits settings tenant-scoped в `tenant.settings.moduleIntegration.ecits`; document.source — універсальне для всіх майбутніх каналів; eventBus — глобальний наразі, готовий до per-tenant ізоляції без зміни API.
- **BILLING:** не торкається. Заглушки не викликають activityTracker. При реальній RPA-інтеграції — додамо в ecitsService.triggerSync.
- **AI USAGE:** не торкається. Заглушки не викликають Anthropic API. При реальній інтеграції з Computer Use — логування через logAiUsageViaSink аналогічно claudeVision.

---

## Acceptance criteria — перевірка

- [x] Вкладка «Електронний суд» з'явилася в основній навігації з іконкою терезів з існуючого набору
- [x] Чотири підвкладки ЄСІТС (Огляд / Журнал / Налаштування / Розбіжності) рендеряться як заглушки
- [x] Підвкладка Розвідник з'являється тільки коли `isCurrentUserFounder() === true`
- [x] Дизайн модуля використовує тільки існуючі CSS-класи/токени, без власних стилів окрім layout-розкладки
- [x] Жодних емодзі в інтерфейсі модуля
- [x] eventBus з трьома методами (subscribe/publish/clear) працює — тести зелені
- [x] `eventBusTopics.js` експортує константи топіків
- [x] `ecitsService.js` з заглушковими методами існує
- [x] `tenant.settings.moduleIntegration.ecits` створюється з дефолтами
- [x] `document.source` поле додано в documentSchema.js з допустимими значеннями в documentSources.js
- [x] Lazy-loading папок `_research/` працює (getOrCreateResearchFolder створює тільки при виклику)
- [x] Тести зелені (558/558, з них 27 нові)
- [x] CLAUDE.md оновлено (≤30 нових рядків — фактично 25)
- [x] Vite build чистий
- [x] Існуючий функціонал не зламано — всі попередні 531 тести проходять без змін
