# Metadata Extractor — основний канал для не-ЄСІТС джерел

## Призначення

Системний шар який витягує структуровані дані (сторони, реквізити, дати, метадані документів) з усіх каналів окрім офіційного ЄСІТС-кабінету.

**Це не fallback.** Це **основний канал** для більшості життєвого циклу справи — від першої консультації клієнта до останньої постанови. Court Sync — спеціалізований канал для вузького періоду коли справа у ЄСІТС.

## Чому це основний канал

Адвокат працює зі справою набагато ширше ніж триває її електронна частина у ЄСІТС:

ДО ЄСІТС:
- Консультації з клієнтом (голос, текст)
- Збір доказів (фото, скани, паперові копії)
- Документи з ДРАЦСу, реєстрів нерухомості
- Договори, нотаріальні документи
- Досудові заяви, претензії, відповіді
- У кримінальних — досудове розслідування взагалі поза ЄСІТС

ПАРАЛЕЛЬНО з ЄСІТС:
- Клієнт надсилає документи через Telegram/Viber
- Опонент через email
- Свідки скидають через WhatsApp
- Документи від колег-адвокатів
- Документи з інших органів (поліція, прокуратура, ДВС)

САМО-ГЕНЕРОВАНІ:
- Голосові нотатки після зустрічі
- Ручне введення фактів
- Записи зі засідань

## Зони відповідальності

**Court Sync** — спеціалізований, primary для свого вузького скоупу (ЄСІТС-кабінет).

**Metadata Extractor** — універсальний, primary для свого широкого скоупу (всі інші канали).

Обидва пишуть у ту саму канонічну схему через ті самі ACTIONS (з різним `source`). Споживачі даних не розрізняють.

## Стан зараз (травень 2026)

Це папка-ембріон. Інфраструктура закладена в TASK 0.3.5:
- Канонічна схема з source-полями (`document.source`, `parties[i].source`, `processParticipants[i].source`, `hearing.source`)
- Generic ACTIONS приймають `source` як параметр (`add_hearing`, `update_parties`, `update_process_participants`, `update_proceeding_composition`, `update_document_movement_card`, `update_alternative_sources`)
- PERMISSIONS роль `metadata_extractor_agent` defined але enabled:false (порожній allowlist)
- Source policy і canOverwrite (`src/services/sourcePolicy.js`)

Реальна реалізація — окремий стратегічний TASK у майбутньому. Тригери для активації:
- Адвокат регулярно отримує документи поза кабінетом
- Активне використання з планшета/телефону без Chrome
- Перехід Legal BMS до SaaS
- ЄСІТС зміна UI ламає Court Sync → потрібен fallback
- Архівна міграція великого обсягу старих справ

## Пріоритетизація джерел при конфлікті

З `src/services/sourcePolicy.js`:

1. `manual` (priority 100) — адвокат вручну, не перезаписується
2. `court_sync` (priority 80) — primary для ЄСІТС
3. `metadata_extractor` (priority 60) — primary для не-ЄСІТС, не перезаписує court_sync
4. `telegram`, `email` (priority 50) — прямі канали
5. `unknown` (priority 10) — невідомо

`canOverwrite(existingSource, newSource)` повертає true якщо новий має вищий пріоритет.

## Контракт даних (для майбутньої реалізації)

Усі канали Metadata Extractor пишуть у канонічну схему через ті самі ACTIONS що Court Sync:

| ACTION | Призначення |
|---|---|
| `add_hearing({ source: 'metadata_extractor', ... })` | Hearing з парсингу |
| `update_hearing({ source: 'metadata_extractor', ... })` | Оновити існуюче засідання |
| `update_parties({ source: 'metadata_extractor', ... })` | Сторони з парсингу документа |
| `update_process_participants({ source: 'metadata_extractor', ... })` | Учасники процесу |
| `update_proceeding_composition({ source: 'metadata_extractor', ... })` | Склад суду |
| `update_document_movement_card({ source: 'metadata_extractor', ... })` | Картка руху з парсингу |
| `update_alternative_sources` | Аудит multi-source синхронізації |
| `update_case_ecits_state({ source: 'metadata_extractor', ... })` | Інформація про стан в ЄСІТС з не-ЄСІТС каналу |

Кожен запис має source-мітку для аудиту і пріоритетизації.

## Майбутні ACTIONS (НЕ в TASK 0.3.5)

Відкладено до окремих TASK:
- `add_timeline_event` — TASK 0.7 (Хронологія в досьє)
- `update_case_dnzs` — після DP v2 (парсинг довідки про набрання законної сили)
