# HANDOFF / KICKOFF — Консолідація знань перед серверним переходом

**Дата:** 2026-06-27
**Тип:** kickoff для майбутньої сесії-жнив. **НЕ самі жнива** — це їх **карта**: метод + курований список «що читати детально», щоб сесія-жнив не вичитувала ~290 файлів, а пішла прямо по зерну.
**Що робить сесія-споживач:** читає список §2, витягує живе зерно, **складає один форвард майстер-план** переходу (міграція → рефактор → допил-vs-наново → нові модулі), вкладає принципи в наявні живі доки. Плюс — другий прохід по чатах, які власник підкладе (§3).
**Як зроблено цей список:** інвентар усіх `.md` (257 у `docs/` + 6 канонічних у корені + 62 у `tasks/`) → класифікація за папкою/іменем + два суб-агенти-скімери на ~25 неоднозначних. Багато ключових прочитано наживо в сесії-першоджерелі.

---

## 1. МЕТОД (рубрика + фільтр + 3 шари виходу)

**Рубрика:**
- 🟢 **HARVEST** — читати детально: бачення/ідеї/відкриті питання/нові модулі/серверне, ще живе.
- 🟡 **PARTIAL** — НЕ читати цілком, витягти **лише названий принцип** (нижче вказано який).
- ⚪ **CANONICAL** — це вже поточний стан (доми, куди зерно лягає), не джерело жнив.
- 🔴 **SKIP** — історія (завершені таски, вирішені баги, аудити зробленого).

**Фільтр відбору — «як система мислить ЗАРАЗ»:** кожну ідею перепрочитати крізь **серверну модель**. Багато старого писалось під клієнт+Drive → класифікувати: *жива / витіснена сервером / потребує переформулювання*. Приклад витісненого: розділи зберігання Canvas v1.5 (Drive-файли, три рівні) — на сервері це рядки в БД.

**3 шари на виході (НЕ один мега-файл):**
1. *Доктрина/принципи* (стабільне) → дім `DEVELOPMENT_PHILOSOPHY.md`.
2. *Форвард майстер-план* (міграція + порядок робіт) → **новий артефакт**, який виробляє сесія-жнив (можливо як ROADMAP-наступник).
3. *Беклог ідей/боргів* (живе, дрейфує) → `tracking_debt.md` + «паркінг ідей».

---

## 2. КУРОВАНИЙ СПИСОК (репо) — ЩО ЧИТАТИ

### 2.1 🟢 HARVEST — читати детально (згруповано за темою)

**A. Сервер / дата-модель / ідентичність**
- `docs/audits/audit_dp_server_migration_readiness.md` — 16 browser-bound блокерів (B1-B16), DI-порти, порядок переїзду. **Хребет міграції.**
- `docs/consultations/consultation_metadata_graph_ontology.md` — сутності/ребра/граф = по суті реляційна схема сервера; що first-class, що ще вільний текст.
- `docs/consultations/handoff_2026-06-23_metadata_a5_decisions_and_deferral.md` — A5→серверна ера (прецедент «джерело тексту→БД=rework» + параметри серверної спеки метаданих).
- `docs/consultations/discussion_dp_v2_philosophy_response.md` — strangler fig vs big-bang; seams vs speculative generality; conflict-detection (релевантно серверній ідентичності документів).

**B. Білінг / CRM (новий модуль — підготовка вже збирається)**
- `docs/consultations/recommended_activity_event_billing_architecture.md` — архітектура подій активності → білінг.
- `docs/tasks/TASK_ai_cost_analysis_and_forecast.md` — модель $/токен, ранжування агентів за вартістю → вхід для tariff matrix і `subscription.limits`.
- `docs/tasks/TASK_file_tools_compression_doctrine.md` — доктрина стиснення + **SaaS storage-quota foundation** + насіння TASK #39/#40/#41.

**C. Multi-user (серверна ера)**
- `docs/consultations/multiuser_saas_activation_notes.md` — активація мульти-юзера (Олена-помічниця), ролі/доступ.

**D. Розширення / ЄСІТС (паралельний скоуп)**
- `docs/CONTEXT_for_extension_session.md` — контекст extension-сесії.
- `docs/consultations/extension_architecture_recommendations.md` — Track B (власне Chrome-розширення).
- `docs/consultations/ecits_admin_context.md` — ЄСІТС адмін-контекст.

**E. Дизайн / рефакторинг**
- `docs/consultations/handoff_2026-06-27_ui_design_unification_state_and_plan.md` — стан дизайну + 3-рівневий план (парний цьому handoff).
- `docs/consultations/consultation_large_files_refactoring_roadmap.md` — рефактор великих файлів (Вісь C; післясерверний).
- `docs/consultations/consultation_ui_debt_consolidation_plan.md` — план консолідації UI-боргу.

**F. Контекст-генератор / OCR (відкриті напрями)**
- `docs/consultations/consultation_selective_context_generator_direction.md` — селективний контекст (відкритий напрям; той самий files→БД rework, що A5).
- `docs/consultations/handoff_2026-06-04_artifacts_reorg_context_ocr.md` — «три-в-одному» (відмова від .txt / керований OCR / селективний контекст), один важіль.
- `docs/consultations/consultation_sliding_window_triage_server_feature.md` — sliding window як **серверна** фіча великих томів.
- `docs/consultations/admin_review_2026-06-09_reconcile_roadmap7.md` — «один важіль = 2 ортогональні поля» (rule #11); контекст-участь як **персистентне поле схеми**; 4 відкриті продуктові рішення.

**G. Ідеї (майбутні фічі)**
- `docs/consultations/ideas_photo_ingestion_workflow.md` — фото/Telegram-інгест.
- `docs/consultations/ideas_mermaid_diagram_generation.md` — генерація діаграм.

**H. DP-forward (продакшн під сервер)**
- `docs/tasks/TASK_dp_full_audit.md` — DP під «продакшн/SaaS/серверна архітектура»; доктрина «map-before-roads», «архітектурна присутність ≠ робоча функція».
- `docs/consultations/consultation_dp_product_vision.md` — продуктове бачення DP.

### 2.2 🟡 PARTIAL — витягти ЛИШЕ названий принцип (не читати цілком)
- `docs/tasks/TASK_dp_v2_honest_state_audit.md` — «1400 зелених тестів, реальна катастрофа на проді» (клас бага); чесна карта стану перед плануванням.
- `docs/tasks/HANDOFF_task4_rework_add_files_standalone.md` — «окремий самодостатній сценарій, інша труба»; «слухай алгоритм, не абстрагуй передчасно».
- `docs/tasks/TASK_represented_parties_and_manual_edit.md` — «ручне святе» (захист ручної правки); `nameSource` auto-vs-manual (rule #11).
- `docs/tasks/TASK_ecits_contract_extension_v12.md` — адитивний/backward-compat envelope; top-level роль для майбутніх ручних справ.
- `docs/tasks/TASK_0_4_2_decision_point.md` — «точка рішення адвоката» (звести всі неоднозначності в один список); Track B напрям.
- `docs/consultations/admin_context_compression_wiring.md` — scanned-only-guard (єдиний детектор скан↔інше); pdf-lib sliceability constraint.
- `docs/consultations/consultation_dp_flow_observations.md` — вимога: Phase-5 gate обходить тумблер «просто додати»; compress-before-OCR-на-вході.
- `docs/consultations/handoff_2026-06-22_metadata_a5_a7_extraction_point.md` — «метадані = атрибут вузла плану, не файлу»; **посторінковий layout НЕ персистентний — відкрита прогалина**.
- `docs/consultations/handoff_2026-06-22_admin_session_roadmap_a5_a7.md` — фронти A5/A6/A7 під SaaS/серверну лінзу (значною мірою витіснено handoff'ом 06-23).
- **Спот-чек (агент не читав цілком):** `docs/tasks/TASK_smart_triage.md` §2 (8 інституційних обмежень / «зелене-але-зламане» — наскрізна доктрина, цитується іншими); `docs/tasks/TASK_3_clean_text.md` + `TASK_clean_text_v2.md` (доктрина режимів digest/clean).

### 2.3 ⚪ CANONICAL — доми (НЕ джерело жнив; зерно ЛЯГАЄ сюди)
`CLAUDE.md`, `DEVELOPMENT_PHILOSOPHY.md`, `ARCHITECTURE_HISTORY.md`, `LESSONS.md`, `tracking_debt.md`, `dossier_architecture_decisions.md` (корінь) + `docs/ROADMAP.md`.

### 2.4 🔴 SKIP гуртом (історія — НЕ читати)
- Усе `docs/reports/*`, `docs/diagnostics/*`, `docs/bugs/*`, `docs/mermaid/*`.
- Усе `docs/audits/*` **окрім** `audit_dp_server_migration_readiness.md` (у HARVEST).
- Усе `docs/tasks/*` **окрім** перелічених у 2.1H/2.2 (специфікації завершеної роботи).
- Підтверджені SKIP-консультації: `dp_reuse_and_canonical_patterns_discussion`, `handoff_2026-06-15_admin_session_dp_specs_and_b1`, `handoff_2026-05-28_dp_strategy`, `consultation_clean_text_design`, `consultation_dp_triage_architecture`, `consultation_dp_flow_observations`*(*але див. PARTIAL — там одна вимога)*, `consultation_pdf_html_approach`, `consultation_pdf_selection_v2`, `consultation_combined_roadmap_dp_and_refactoring` (витіснений ROADMAP v2), `manual_test_add_files_zip`, `handoff_2026-05-31_clean_text_task3`, `handoff_2026-05-31_laneB_ui_debts` (борги вже в tracking_debt), `questions_task_b_image_merge`, `recommended_task_claude_md_audit`.

---

## 3. ЗОВНІШНІ ДЖЕРЕЛА (чати) — другий прохід
Файли зі **сторонніх Claude-чатів** (старі роадмапи, ідеї) **не в репо** і недоступні асистенту з основної сесії. Власник кладе їх **архівами (.zip)** у `docs/_harvest_inbox/` — **НЕ розпаковуючи вручну**; сесія-жнив витягує їх однією командою у scratch. Повна процедура (екстракція → триаж → вкладення зерна → **прибирання папки**) — у `docs/_harvest_inbox/README.md`. Далі — **та сама рубрика §1**, доповнює список §2. Папка **тимчасова**: після жнив видаляється (сирі чат-дампи в постійному репо не лишаються). Очікувано ~9 архівів × до ~20 `.md`.

---

## 4. ЗАСІВ ЦІЄЇ СЕСІЇ (готові висновки — занести в майстер-план)

- **Серверна лінза** (наскрізний критерій): кожна робота — *переживає / розчиняється / переробляється* на сервері. CSS/UI, бізнес-логіка, block-модель — переживають; шар даних, оркестрація App.jsx, важкий compute, секрети — розчиняються/переробляються.
- **Триаж роадмапу now/defer** (узгоджено): DP — готовий до сервера, **не допилювати**; A5/A6/селективний контекст/Вісь-C-рефактор/Canvas-сховище — на сервер; B2 (звести AI-виклики через `callAgent`) і дизайн Рівень 0 — можна зараз. Деталі — в історії сесії-першоджерела.
- **Напрям стеку** (з нуля, не з репо): **PostgreSQL + один TS-бекенд + worker для важких джоб + керований auth**; платформа — Supabase (менше сервісів) або Neon+окреме. Окремий compute-шар обовʼязковий (serverless не тягне 20-хв OCR). Портативність через стандартний Postgres + власний TS-репо.
- **Порядок міграції** (фазами): Фаза 1 (Auth + проксі секретів — закриває B1/B2/B3, робить систему продаваною) → Фаза 2 (Postgres + RLS) → **тоді** Canvas/Multi-user/Billing UI паралельно з Фазами 3-4 (важкий DP-compute). Canvas зав'язаний лише на хребет (Фази 1-2), не на DP-compute.
- **Нові модулі ще не розпочаті:** **Canvas** (серверна дата-модель уже накидана: `canvas_documents/_versions/_shares/_attached/_sessions` + RLS під `team[].permissions`; ізоляція за замовчуванням, явний шар) і **Billing/CRM** (підготовка вже збирається — звести в логіку+інтерфейс).

---

## 5. ЦІЛЬОВА СТРУКТУРА МАЙСТЕР-ПЛАНУ (що виробляє сесія-жнив)
Один форвард-документ із розділами: (1) Порядок серверної міграції (фази, блокери); (2) Рефакторинг — що зчіплюємо з міграцією, що після; (3) Допилюємо-vs-робимо-наново — поіменно по фічах із вердиктом серверної лінзи; (4) Нові модулі — Canvas, Billing/CRM: коли і в якому порядку; (5) Паралельні гілки — ЄСІТС/Court Sync, дизайн. Кожен пункт — з вердиктом *зараз / на сервері / enabling* і одним реченням чому.

---

## 6. ПОВʼЯЗАНІ КАНОНІЧНІ ДОКИ
`docs/ROADMAP.md`, `tracking_debt.md`, `ARCHITECTURE_HISTORY.md`, `DEVELOPMENT_PHILOSOPHY.md`; парні handoff'и: `handoff_2026-06-27_ui_design_unification_state_and_plan.md` (дизайн), `handoff_2026-06-23_metadata_a5_decisions_and_deferral.md` (прецедент деферу).

---

**Кінець kickoff.** Сесія-жнив: почати з §2.1 (HARVEST) + §4 (засів), §2.2 — лише по названому принципу, §2.4 — не відкривати. Метрики/склад файлів звірено по `main` 2026-06-27.
