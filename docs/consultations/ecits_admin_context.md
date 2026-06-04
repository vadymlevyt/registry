# ЄСІТС — Контекст адмін-сесії (живий файл)

**Призначення:** надійна пам'ять адмін-сесії модуля ЄСІТС. Будь-яка нова
сесія (адмін чи виконавець) читає цей файл і одразу «в темі». Файл живий —
оновлюється при кожному рішенні/завершеному TASK. НЕ покладатися на контекст
окремої сесії (контейнер ефемерний, довгі діалоги стискаються).

**Створено:** 2026-05-27
**Останнє оновлення:** 2026-05-27
**Поточний schemaVersion:** 9 · **settingsVersion:** `9.0_case_origin`

---

## 0. Роль адмін-сесії і воркфлоу

Адмін-сесія ЄСІТС: пише спеки, валідує їх з кодом, координує виконавців,
веде обговорення з адвокатом, дає пропозиції й інформацію для рішень, планує
роботу. **Сама код у проді не пише** (крім дрібних правок документації).

**Узгоджений воркфлоу (2026-05-27):**

```
1. Адмін пише спеку → docs/tasks/TASK_<id>_<slug>.md
2. Адмін показує спеку адвокату → затвердження (одне речення «ок»)
3. ОКРЕМА сесія-виконавець бере затверджену спеку і реалізує
4. Адмін звіряє результат з кодом (read-only), пише звіт/нотатку
```

Адмін **не** реалізує сам, навіть дрібне — це робить виконавець за спекою.
Виняток: оновлення живих довідників і документації (цей файл, звіти, спеки).

**Доменний експерт — адвокат.** Його уточнення з предметної області (право,
ЄСІТС, судовий процес) мають пріоритет над моїми припущеннями. Реальний кейс:
я хибно вважав `case_no` ненадійним — адвокат виправив (див. §3).

---

## 1. Поточний стан модуля ЄСІТС

**Що працює (Court Sync MVP, TASK 0.4, schemaVersion 9):**
- Модуль «Електронний суд» (іконка Scale) — `src/components/CourtSync/`.
- 3 активні вкладки: `OverviewTab` (статистика + історія синхронізацій з
  `tenant.ecits_scenario_history`), `ImportTab` (copy prompt → Claude for
  Chrome → paste JSON → Обробити), `SettingsTab` (`ecitsCabinetIdentifier`,
  інформативне).
- Заглушки: `Журнал`, `Розбіжності` (наступні TASK). `Розвідник` — лише
  для founder (`isCurrentUserFounder()`).
- Сценарій імпорту: `src/services/ecits/scenarioProcessor.js` (envelope →
  ACTIONS), `promptBuilder.js`, `safety.js`.
- 4 архітектурні закладки (повне ДНК для майбутнього власного розширення):
  `extensionBridge.js`, `hashRouter.js`, `tenant.subscription.entitlements`
  (+`entitlementsService.js`, `tariffMatrix.js`), спільний `scenarioProcessor`.
- ACTIONS ЄСІТС у `actionsRegistry.js`: `mark_synced_from_ecits`,
  `update_case_ecits_state` + 6 edit-ACTIONS (parties, processParticipants,
  composition, movementCard, alternativeSources, team).
- PERMISSIONS: `court_sync_agent` (enabled, 12 дій вкл. `create_case`);
  `metadata_extractor_agent` (DISABLED, порожній allowlist — НЕ активувати).

**Схема (канонічна):**
- `case.origin` enum v9: `manual`|`ecits_import`|`telegram_import`|`email_import`.
- `case.ecitsState` (з `syncMetrics`), `parties[]`, `processParticipants[]`.
- `hearing.source`='court_sync' для імпортованих засідань.
- Дедуплікація **наразі в коді** — за `ecitsState.caseId` (32-hex). **Рішення
  §3 змінює це на `case_no`** — ще не реалізовано.

---

## 2. Відкритий баг (з діагностики 2026-05-27)

**BUG-1 — read-after-write через заморожений снапшот.** Деталі й посилання на
рядки — у `docs/diagnostics/report_diagnostic_ecits_state.md`.

Суть: `getCases: () => cases` (`App.jsx`, `ImportTab.jsx`) повертає заморожений
immutable-снапшот рендеру; записи йдуть через `setCases(prev=>…)` у живий стан.
Усередині одного прогону імпорту читання не бачить записів. Симптом:
`update_case_ecits_state failed: Справу case_XXX не знайдено`. Тести маскують
дефект (мутабельний масив + fake-хендлер з безумовним success).

Наслідки сьогодні: переважно косметичні (UI per-case ecitsState не читає; дедуп
тримається на ключі, проставленому при створенні). Але: (1) фейкові помилки
лякають в ResultCard; (2) латентний ризик дублів усередині одного прогону на
envelope зі спорідненими записами.

**Лагодити треба незалежно від вибору ключа дедупу.**

---

## 3. Зафіксовані рішення

**Р-1. Дедуплікація — за номером справи `case_no`, не за ЄСІТС-кодом.**
(Уточнення адвоката, 2026-05-27.)
- Номер справи `суд / порядковий / рік[-літера]` (напр. `363/2241/24`, `-ц`=
  цивільна) — унікальний, постійний, завжди є в е-суді. **Усі провадження**
  (апеляція, касація, оскарження ухвал) живуть під **одним** номером справи.
- Отже `case_no` = ключ розрізнення справ (один номер = одна справа).
- 32-hex `ecitsState.caseId` = **посилання на провадження/картку в кабінеті**,
  НЕ ключ дедупу. Лишити як адресу джерела (для документів/картки руху/складу
  суду конкретного провадження).
- **Засторога:** `case_no` перед порівнянням НОРМАЛІЗУВАТИ (пробіли, суфікс
  `-ц`/регістр, розділювачі). Без нормалізації дедуп ненадійний.

**Р-2. ecitsState НЕ прибирати.** Лишається носієм посилання на джерело і
sync-метаданих. Просто перестає бути ключем дедупу. (Відхилено «Варіант A»
зі звіту.)

**Р-3. Воркфлоу адмін↔виконавець** — див. §0.

---

## 4. Відкриті питання для адвоката (потребують рішення ПЕРЕД фікс-TASK)

- **П-1.** ЄСІТС 32-hex код — він per-case чи per-proceeding? Якщо на кожне
  провадження свій код — `ecitsState.caseId` має переїхати на рівень
  `proceeding`, а не `case`. Підтвердити по тому, як кабінет перелічує «мої
  справи» (одна картка на справу чи на провадження).
- **П-2.** Точні правила нормалізації `case_no`: чи суфікс `-ц`/`-к`/`-а`
  частина ключа, чи відкидається? Регістр? Пробіли/нерозривні пробіли?
- **П-3.** Засідання без часу (`missing date/time`, кейс Нестеренка): пропускати
  (як зараз), ставити дефолтний час із позначкою «потребує уточнення», чи
  створювати засідання тільки з датою?

---

## 5. Черга робіт (план)

| ID | Назва | Стан | Залежить від |
|----|-------|------|--------------|
| FIX-1 | read-after-write (живий стан) + дедуп по нормалізованому `case_no` | спека не написана | П-2 (нормалізація). П-1 бажано |
| DEBT-1 | scenarioProcessor не викликає `mark_synced_from_ecits` → `syncMetrics` мертвий | у tracking_debt | — |
| ? | ЄСІТС-код на рівень `proceeding` (якщо П-1 = per-proceeding) | очікує П-1 | П-1 |

Наступний крок адмін-сесії: отримати від адвоката відповіді на П-1/П-2/П-3,
тоді написати спеку FIX-1 у `docs/tasks/`.

---

## 6. Межі MVP і заборони (з CLAUDE.md)

MVP TASK 0.4 свідомо НЕ робить: matching з тестовими справами; ручний merge;
dismissedMatches/syncDisabled; soft delete; синхронізацію документів з ЄСІТС
(чекає DP v2); парсинг складу суду/сторін/картки руху; автоматизацію передачі
JSON; активацію `metadata_extractor_agent`.

Заборони (вибірка релевантного): НЕ активувати `metadata_extractor_agent`; НЕ
використовувати `update_case_ecits_state.patch` для не-`ecitsState` полів; НЕ
міняти семантику `case.team[]` (≠ processParticipants); НЕ плутати `case.origin`
з `case.team[].addedBy`; НЕ кирилиця в `q=` Drive API; НЕ обходити
`executeAction`; нові поля схеми — тільки з bump schemaVersion + ідемпотентною
міграцією.

---

## 7. Карта коду (орієнтир, не контракт — рядки зсуваються)

- Оркестрація імпорту: `src/services/ecits/scenarioProcessor.js`
- Промпт: `src/services/ecits/promptBuilder.js` · Безпека: `src/services/ecits/safety.js`
- ACTIONS + PERMISSIONS: `src/services/actionsRegistry.js` (ЄСІТС-група ~1192+;
  `court_sync_agent` allowlist ~1642)
- Дефолти/міграції справи: `src/services/migrationService.js`
  (`buildDefaultEcitsState`, `ensureCaseSaasAndEcitsFields`, `migrateToVersion7/9`)
- Заморожений getCases (BUG-1): `src/App.jsx` (~4802, ~4827),
  `src/components/CourtSync/ImportTab.jsx` (~64-72)
- UI: `src/components/CourtSync/` (OverviewTab, ImportTab, SettingsTab, index)
- Закладки: `extensionBridge.js`, `hashRouter.js`, `entitlementsService.js`,
  `tariffMatrix.js`, `eventBus.js`+`eventBusTopics.js`
- Тести: `tests/unit/scenarioProcessor.test.js` (маскує BUG-1),
  `tests/integration/court-sync-mvp.test.js`, `tests/unit/promptBuilder.test.js`
- Повна діагностика: `docs/diagnostics/report_diagnostic_ecits_state.md`
