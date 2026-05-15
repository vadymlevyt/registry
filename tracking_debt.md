# tracking_debt.md — Реєстр свідомо відкладеного

Живий реєстр рішень «свідомо НЕ робимо зараз». Механізм золотої середини
(DEVELOPMENT_PHILOSOPHY.md, розділ «ПРИНЦИП ЗДОРОВОГО ОРГАНІЗМУ»): чистимо/будуємо
тільки те, що активується поточним TASK; решта — сюди, з **явним тригером**.

**Правило входу:** запис без конкретного тригера (подія, не «колись») — невалідний.
Це не борг, а забування. Тригер має бути перевіряємим.

| # | Що відкладено | Чому свідомо не робимо зараз | Явний тригер активації | Джерело / посилання |
|---|---------------|------------------------------|------------------------|---------------------|
| 1 | Backfill denormalized `case.client` (string) і `proceeding.judges` (string) із `parties[]` / `composition` | v7 ввів канонічні `parties[]`/`composition`; UI ще читає старі summary-поля. Переписувати UI зараз — поза обсягом інфраструктурного v7. | Коли реальний канал (Court Sync) почне писати `parties[]`/`composition` і UI треба показувати дані з них → окремий backfill TASK (читає parties → генерує summary, UI не змінюється до того). | ARCHITECTURE_HISTORY.md § «Canonical Schema v7 → Tracking debt»; `report_task_0_3_5_canonical_schema_v7.md` |
| 2 | Перевірка повноти консолідованого дайджесту після виносу історії | Винос CLAUDE.md → ARCHITECTURE_HISTORY.md зробив дайджест ручним консолідатом 8 версійних секцій; ризик — пропущена активна константа/enum при наступній зміні схеми. | При наступному schema bump (v7→v8+): перед редагуванням дайджесту звірити його enum/ACTIONS/PERMISSIONS з кодом і з ARCHITECTURE_HISTORY.md, переконатися що нічого активного не загубилось. | Цей TASK (розвантаження CLAUDE.md, 2026-05-15) |
| 3 | ActionsRegistry refactor — винос ACTIONS/PERMISSIONS з App.jsx у `src/services/actionsRegistry.js` (factory з deps injection) | ACTIONS/PERMISSIONS закриті в App.jsx; `tests/integration/_actionsHarness.js` дублює мінімум логіки вручну. Рефактор зараз — поза обсягом поточних TASK. | Коли синхронізація harness↔App.jsx стане джерелом регресій АБО почнеться TASK що масово змінює ACTIONS → винести в `createActions(deps)`, видалити harness. | CLAUDE.md § ТЕСТУВАННЯ |
| 4 | Косметичні текстові згадки видаленого `DocumentProcessor` у коментарях/рядках: `documentFactory.js:3,200`, `toolDefinitions.js:55`, `migrations/v4ToV5.js:43`, `caseSchema.js:78` (опис `lastProcessingContext`). | Старий компонент видалено (TASK 1), але посилання в коментарях/описах лишились. Масово правити зараз — поза scope (не функціональні, не ламають, ризик зачепити зайве). | Коли кожен із цих файлів наступного разу редагується по суті — прибрати/уточнити згадку в тому ж коміті. | TASK 1 salvage-and-decommission (2026-05-15) |
| 5 | Розбіжність clamp-логіки нарізки: legacy мав два майже-дублікати — `splitPDFByDocuments` (`startIdx = doc.startPage - 1`) і inline у `handleSplit` (`Math.max(0, doc.startPage - 1)`). Трансплантовано перший дослівно (`documentBoundary/splitPdf.js`); другий зник разом зі старим DP. | Salvage-TASK переносить дослівно, не зливає дві сутності тихо (правило #11). Захист від негативного startIdx — рішення архітектури DP v2, не salvage. | Коли DP v2 підключатиме `documentBoundary` — свідомо обрати канонічний clamp (ймовірно `Math.max(0, …)`) і покрити тестом. | TASK 1; `docs/reports/report_task_1_salvage_and_decommission.md`; pre-deletion код — git tag `pre-dp-v2-old-dp-removal` (на remote — SHA `b3b847f`) |
| 6 | Doc-drift: задокументований у CLAUDE.md/спеках перелік значень `time_entry` capture-method (`timer\|manual\|agent\|import\|legacy`) ≠ фактичні значення в коді (`instrumentation`, `manual_assign`, `manual`, `legacy_import`, + те що передає caller через `context.captureMethod`). | TASK 2 — це rename ПОЛЯ, не нормалізація значень; правити документований enum = окремий doc-TASK (CLAUDE.md заборонено чіпати в TASK 2). Перелік значень не валідується міграцією свідомо (валідація проти хибного enum зіпсувала б легітимні значення). | Окремий doc-sync TASK для CLAUDE.md (синхронізація задокументованих enum зі станом коду) — там виправити перелік. | TASK 2; `docs/reports/report_task_2_time_entry_capture_method.md` |

---

Поповнюється з кожним TASK (аудити, cleanup'и, виноси). Закритий запис —
видаляється з таблиці після того, як тригер спрацював і борг сплачено
(слід лишається в git-історії та у відповідному `report_*.md`).
