# Звіт TASK 3 — Tool Use Foundation для агента досьє

**Дата:** 2026-05-08
**Виконавець:** Claude Code (Opus 4.7, 1M context)
**Статус:** Завершено. 254/254 sanity-тестів зелені, білд чистий.

---

## Резюме TASK 3

Закладено інфраструктуру нативного Anthropic Tool Use, яка з цього моменту обслуговує агент досьє і буде переюзовувана наступними модулями (Document Processor v2, Canvas, ЄСІТС). Створено два нові сервіси: `toolDefinitions.js` (реєстр 20 tools для dossier_agent) і `toolUseRunner.js` (raнер з multi-turn, retry, ai_usage логуванням, дружніми помилками). Агент досьє переведено з ACTION_JSON-парсингу на нативні tool_use блоки. Системний промпт агента переписано під Tool Use семантику. ACTION_JSON-парсинг видалено повністю.

---

## Реалізація з TASK

| Підзадача | Статус | Розташування |
|-----------|--------|--------------|
| 3.1 toolDefinitions.js — 20 tools для dossier_agent | ✓ | `src/services/toolDefinitions.js:1-481` |
| 3.2 toolUseRunner.js — runToolUse + runMultiTurnConversation + callAPIWithRetry | ✓ | `src/services/toolUseRunner.js:1-330` |
| 3.3 Інтеграція з агентом досьє | ✓ | `src/components/CaseDossier/index.jsx:1287-1374` (sendAgentMessage), `:603-633` (system prompt) |
| 3.4 Edge cases (A/B/C/D) | ✓ | Покрито у тестах basic Test 5/6, multiturn Test 2/3/6, integration Test 2 |
| 3.5 Token counting + ai_usage per-turn | ✓ | `toolUseRunner.js:201-219` (logAiUsage у runMultiTurnConversation); MODEL_PRICING вже існував у `aiUsageService.js` |
| 3.6 callAPIWithRetry — exponential backoff + дружні повідомлення | ✓ | `toolUseRunner.js:248-330` |
| 3.7 4 файли тестів (basic/multiturn/tooldefs/integration) | ✓ | `scripts/sanity_test_task3_*.mjs`, 254/254 pass |

---

## Створені файли

| Файл | Призначення |
|------|-------------|
| `src/services/toolDefinitions.js` | Anthropic Tool Use definitions для агентів. 20 індивідуальних tool-констант + DOSSIER_AGENT_TOOLS реєстр + DOCUMENT_PROCESSOR_AGENT_TOOLS заглушка + getToolsForAgent() утиліта. |
| `src/services/toolUseRunner.js` | Універсальний раннер. `runToolUse()` обробляє один API turn. `runMultiTurnConversation()` керує циклом до фінального тексту або maxTurns. `callAPIWithRetry()` — обгортка fetch з exponential backoff і дружніми помилками. |
| `scripts/sanity_test_task3_basic.mjs` | 33 тести базового runToolUse: text-only, single tool, multi tool, success-fail, exception, паралельні з помилкою, caseId injection. |
| `scripts/sanity_test_task3_multiturn.mjs` | 32 тести: 2 турна, maxTurns truncation, мережева помилка у середині, 3 паралельні tools, ai_usage per-turn, Edge case A. |
| `scripts/sanity_test_task3_tooldefs.mjs` | 118 тестів: required fields, enum sync зі схемою, синхронізація з PERMISSIONS.dossier_agent у App.jsx, відсутність дублікатів, descriminating descriptions. |
| `scripts/sanity_test_task3_integration.mjs` | 71 тест: end-to-end add_hearing з валідними/невалідними параметрами (Edge case C), JSON-серіалізація tools, multi-action в одній репліці. |
| `report_task3.md` | Цей звіт. |

---

## Змінені файли

- **`src/components/CaseDossier/index.jsx`**
  - Імпорти (`:12-13`): додано `runMultiTurnConversation`, `callAPIWithRetry`, `DOSSIER_AGENT_TOOLS`.
  - Системний промпт агента (`:603-633`): прибрана секція "ACTION_JSON формат" (5 прикладів), замінена на "## РЕЖИМ ВИКОНАННЯ (Tool Use)" з принципами виклику tools (datetime формат, перепити-якщо-кілька, null для невідомих параметрів, видалення через UI).
  - sendAgentMessage (`:1287-1374`): повна переписка. Поточна реалізація: будує initialMessages з історії, викликає `runMultiTurnConversation` з callAPIWithRetry-обгорткою, логує totalToolCalls/turns/truncated у activityTracker, виводить fallback-повідомлення для error/empty.
  - parseAndExecuteDossierAction — ВИДАЛЕНО повністю (29 рядків ACTION_JSON парсингу через depth counter).

---

## Відхилення від TASK з обґрунтуванням

1. **MODEL_PRICING і calculateCost — вже існували в `aiUsageService.js`** із pricing 0.80/4.00 для haiku, 3.00/15.00 для sonnet, 15.00/75.00 для opus. TASK пропонував 0.25/1.25 для haiku — старі значення, не оновлюю pricing файл, бо це окремий TASK перевірки тарифів. Існуюча `calculateCost` коректна.

2. **`logAiUsage` per-turn — інтегровано прямо в `runMultiTurnConversation`**, не як окремий хук. Простіше і явніше — runner сам знає коли турн закінчився. Тест 5 multiturn перевіряє, що це працює.

3. **`callAPIWithRetry` — окрема функція в `toolUseRunner.js`**, а не у TASK 3.6 у CaseDossier. Логіка універсальна (буде використовуватись DP v2 тощо), тому її місце в інфраструктурному файлі. Експортується.

4. **CREATE_CASE_TOOL — додано** хоча у TASK явно перелічений не був. Перевірка показала, що `create_case` дозволено dossier_agent у PERMISSIONS, тож відсутність tool — це баг синхронізації. Тест tooldefs цей кейс зловив.

5. **batch_update — НЕ перетворено на tool**. Це композитна дія агрегації; модель отримує природний механізм паралельних tool_use блоків (Anthropic нативно підтримує). batch_update лишається доступним через executeAction, але не як окремий tool — модель просто викликає декілька tools в одному content[].

6. **delete_document, delete_proceeding — свідомо ВІДСУТНІ у DOSSIER_AGENT_TOOLS** (UI-only через _fromUI з TASK 2). Системний промпт явно говорить агенту: «якщо адвокат просить видалити — поясни що це треба зробити в інтерфейсі».

7. **Hearings/deadlines time_entry_* tools — НЕ додано у DOSSIER_AGENT_TOOLS**, хоча PERMISSIONS їх включає. Час/білінг — не зона досьє-чату. Якщо адвокат хоче редагувати time_entry через чат — окремий TASK Billing UI v1.

8. **`add_time_entry`, `confirm_event`, `add_travel`, `cancel_travel`, `start/end/update_external_work`, `track_session_*`, `assign_offline_period`, `split_time_entry`, `update_time_entry`, `cancel_time_entry`** — теж не у tools. Це служба часу — не зона текстового чату агента. Тест tooldefs підтверджує, що це навмисно (filter у Test «У DOSSIER_AGENT_TOOLS є tool для кожного нетаймового дозволеного ACTION»).

9. **Системний промпт — мінімально оновлено**, не переписано з нуля. Ядро (історія, дані справи, контекст) залишено. Замінено лише блок "## РЕЖИМ ВИКОНАННЯ" — щоб не порушувати існуючу поведінку розуміння справи.

---

## Знахідки

Окремий файл `discovered_issues_during_task3.md` не створював — серйозних архітектурних знахідок немає. Дрібниці:

- **agent_history тримає `assistant`-повідомлення з `content` як рядок**, тоді як Anthropic API очікує `content` як масив блоків (для tool_use multi-turn). Зараз це не проблема, бо в історії перетворюємо на текст для відправки. Але якщо колись захочемо передавати **повну** історію (з усіма tool_use блоками) — буде потрібна міграція схеми. Для поточного TASK достатньо текстового slice -10.
- **PERMISSIONS.dossier_agent дозволяє `update_processing_context`**, але цей tool — службовий між DP і Dossier-агентом, не для прямого виклику з чату. Поки що залишив його доступним (TASK 3.1 явно це вимагав), але описав в description як "не для прямого виклику з розмови з адвокатом".
- **Bundle JS зріс на 22 KB** (1972 → 1994 KB) через додавання toolDefinitions + toolUseRunner. Це очікувано і прийнятно.

---

## Sanity-tests результати

| Файл | pass | fail |
|------|------|------|
| `sanity_test_task3_basic.mjs` | 33 | 0 |
| `sanity_test_task3_multiturn.mjs` | 32 | 0 |
| `sanity_test_task3_tooldefs.mjs` | 118 | 0 |
| `sanity_test_task3_integration.mjs` | 71 | 0 |
| **Сумарно** | **254** | **0** |

Запуск:
```bash
node scripts/sanity_test_task3_basic.mjs
node scripts/sanity_test_task3_multiturn.mjs
node scripts/sanity_test_task3_tooldefs.mjs
node scripts/sanity_test_task3_integration.mjs
```

### Покриття edge cases з TASK 3.4

- **A. Tool падає у середині multi-turn** → Edge case A покрито у `multiturn:Test 6` і `integration:Test 2`. Перевірено: модель отримує `is_error: true tool_result`, у наступному турні відповідає текстом «не вдалось — уточни?». Перший tool збережено.
- **B. Мережева помилка у середині multi-turn** → `multiturn:Test 3`. Перевірено: винятки прокидуються наверх, перший tool збережений, UI отримує `err.userMessage`.
- **C. Невалідні параметри від моделі** → `integration:Test 2`. Перевірено: realistic executeAction відмовляє з `success:false`, модель адаптується у наступному турні (передає валідну дату).
- **D. Залипання моделі** → `multiturn:Test 2`. Перевірено: maxTurns=5 → API викликається 5 разів, повертається `truncated:true`, finalText містить `⚠`.

---

## Білд + push

- **`npm run build`** — ✓ чистий. Bundle 1 994 KB JS / 619 KB gzip / 9.92s.
- **Sanity-tests** — ✓ 254/254 pass.
- **Git коміт + push** — буде виконано наступним кроком.

---

## Архітектурні відмітки на майбутнє

**Паттерн інфраструктури готовий до переюзу.**

Коли DP v2 мігруватиме на Tool Use:
- Заповнить `DOCUMENT_PROCESSOR_AGENT_TOOLS` (зараз `[]`) — це add_documents, update_processing_context, можливо нові DP-специфічні (split_pdf, classify_documents, propose_naming).
- Скористається тим самим `runMultiTurnConversation` — без жодних змін у runner.
- Передасть `agentId: 'document_processor_agent'` у context — executeAction використає правильний PERMISSIONS allowlist.
- ai_usage автоматично писатиметься з правильним agentType.

Коли з'явиться Canvas-конструктор документів:
- Той самий runner. Нові tools у toolDefinitions.js (canvas_insert_text, canvas_apply_template тощо).
- callAPIWithRetry лишається тим самим.

Це і є сенс TASK 3 — закласти один раз, переюзовувати скрізь.

---

## Рекомендації для CLAUDE.md (на майбутній CLAUDE.md Audit)

Додам секцію в `recommended_task_claude_md_audit.md`. Ключові пункти:

- Розділ "TOOL USE СТРАТЕГІЯ" застарів — Tool Use уже **реалізовано для агента досьє**, не "плановано". Файли `toolUseRunner.js` і `toolDefinitions.js` існують у `src/services/`.
- Розділ "Структура файлів" → додати ці два файли.
- Опис `agent_history` — уточнити, що для досьє з'явились optional поля у assistant-message: `toolCalls` (число) і `truncated` (boolean).
- ACTION_JSON-патерн більше **не використовується** агентом досьє. Він залишається для QI і Dashboard агентів.
- Поточна цифра ACTIONS — 38; усе ще валідна (TASK 3 не додав ACTIONS, лише обгорнув існуючі у tool definitions).

---

## Пояснення в термінал для адвоката

Я заклав основу для нового способу спілкування агента-помічника із системою. Тепер коли ти пишеш агенту в досьє «додай засідання на 15 травня о 10 ранку», агент не пише про це текстом, який система намагається вгадати, а напряму викликає правильну дію через структурований механізм.

Що змінилось:
- **Агент досьє перейшов на новий механізм.** Він тепер може виконувати кілька дій підряд в одній відповіді — наприклад «додай засідання, постав дедлайн, закріпи нотатку про тактику» — і робити їх разом.
- **Інші агенти (Quick Input, Дашборд) працюють як раніше** — вони стабільні, не чіпаємо.
- **Кожен виклик детально логується** (скільки токенів, скільки дій, скільки коштує) — у майбутньому це буде в білінг-звітах. Логи пишуться окремо для кожного «турна» розмови, не тільки в кінці.
- **Помилки стали дружніми.** Якщо інтернет пропав — побачиш «Не вдалось зв'язатись з агентом, перевірте інтернет». Якщо API ключ протерміновано — «Перевірте API ключ Claude в налаштуваннях». Немає більше технічних повідомлень типу «HTTP 429».
- **Захист від залипання.** Якщо агент якимось чином залипне (наприклад в нескінченному циклі викликів) — система зупиниться через 10 кроків і скаже тобі «спробуйте інакше».

Чи все працює:
Так. **254 з 254 автоматичних перевірок зелені** (4 файли тестів — basic, multi-turn, перевірка tools, інтеграційний). Білд чистий.

Що тобі зробити:
Через 2-3 хвилини після push — зайди на сайт. Відкрий справу Кісельової або Брановського. Відкрий бічну панель агента (іконка 🤖). Спробуй щось попросити:
- «Додай засідання на наступний понеділок о 10 ранку»
- «Постав дедлайн "подати клопотання" на через 2 тижні»
- «Закріпи цю нотатку як ключову» (якщо нотатка є)

Агент має:
1. Виконати дію (засідання з'явиться у списку, дедлайн — у дедлайнах).
2. Відповісти текстом-підтвердженням.

Якщо адвокат попросить «видали все засідання» — агент має пояснити, що видалення робиться через інтерфейс (це правильна поведінка, видалення винесено з зони відповідальності агента).

Повний технічний звіт — у файлі `report_task3.md` в корені репо. Завантаж його в адмін-чат щоб подивитись усі деталі реалізації, перелік файлів і покриття тестів.
