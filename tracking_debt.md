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

---

Поповнюється з кожним TASK (аудити, cleanup'и, виноси). Закритий запис —
видаляється з таблиці після того, як тригер спрацював і борг сплачено
(слід лишається в git-історії та у відповідному `report_*.md`).
