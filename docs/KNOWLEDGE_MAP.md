# KNOWLEDGE_MAP — карта durable-знань репо (де і що шукати)

**Дата:** 2026-06-27
**Призначення:** постійний **навігаційний індекс** keeper-файлів за темами. Коли дійде черга до
теми (Canvas, білінг, селективний контекст, розширення, дизайн, сервер…) — заглянь сюди й
одразу знай, які файли читати, **не перечитуючи й не грепаючи весь репо**.
**Що це НЕ:** не список «прочитати раз і забути» (то — `handoff_2026-06-27_knowledge_harvest_kickoff.md`).
Тут — файли, що **лишаються** як довідка, бо стосуються запланованого / того, що розширюватиметься.
**Дисципліна:** додав keeper-доку по темі — впиши рядок сюди (як у ROADMAP/tracking_debt).

Легенда статусу: **⚪ CANONICAL** (жива правда, завжди актуальне) · **🟢 KEEPER** (візія/план/консультація
запланованого — лишається) · **⚠ GAP** (знання є, але ще не збережене в репо).

---

## 0. Завжди актуальне — канонічний стан (читати першими) ⚪
| Файл | Що там |
|------|--------|
| `CLAUDE.md` | Архітектура, правила #1-11, канонічний контракт системи (схеми, ACTIONS, PERMISSIONS). |
| `DEVELOPMENT_PHILOSOPHY.md` | Принципи, «ембріон з повним ДНК», філософія білінгу, стандарти TASK. |
| `ARCHITECTURE_HISTORY.md` | Хронологія TASK'ів — чому кожне рішення таке. |
| `LESSONS.md` | Інституційні уроки (звертатись при повторній проблемі/merge). |
| `tracking_debt.md` | Свідомо відкладене з **тригерами** активації (#1-#83). |
| `docs/ROADMAP.md` | Жива дорожня карта (три осі A/B/C) — стан «що зроблено / попереду». |
| `dossier_architecture_decisions.md` | Рішення по архітектурі досьє. |

---

## 1. Серверна міграція / готовність 🟢
| Файл | Що там |
|------|--------|
| `docs/audits/audit_dp_server_migration_readiness.md` | 16 browser-bound блокерів (B1-B16, 3 безпекові-критичні); DI-порти = актив міграції; порядок переїзду. **Головний файл теми.** |
| `docs/consultations/handoff_2026-06-23_metadata_a5_decisions_and_deferral.md` | Прецедент «джерело тексту → БД = rework»; чому клієнтська передбудова = подвійна робота. |
> Висновки ЦІЄЇ сесії (серверна лінза «переживає/розчиняється»; напрям стеку Postgres+TS+worker+managed auth; порядок фаз; дата-модель Canvas) — засіяні в `handoff_2026-06-27_knowledge_harvest_kickoff.md` §4. **Варто винести в окремий keeper при плануванні сервера.**

## 2. Дата-модель / метадані / граф знань 🟢
| Файл | Що там |
|------|--------|
| `docs/consultations/consultation_metadata_graph_ontology.md` | Сутності/ребра; що first-class (стабільний ID), що ще вільний текст (Party/Court/Judge); насіння реляційної схеми сервера. |
| `docs/consultations/handoff_2026-06-22_metadata_a5_a7_extraction_point.md` | «Метадані = атрибут вузла плану, не файлу»; **посторінковий layout НЕ персистентний — відкрита прогалина**. |

## 3. Canvas (модуль — НЕ будувався) ⚠ GAP
Візія Canvas і серверна дата-модель **ще не збережені в репо як keeper'и**:
- Візія v1.5 + v1.0 — у **завантажених файлах** цієї сесії та в зіпі (`context_canvas_constructor_v1.md`), не в репо.
- **Серверна дата-модель Canvas** (таблиці `canvas_documents/_versions/_shares/_attached/_sessions` + RLS під `team[].permissions`, ізоляція за замовчуванням + явний шар) — вироблена в ЦІЙ сесії, живе лише в чаті.
> **Дія:** зберегти обидва в `docs/` (напр. `docs/consultations/canvas_*`) — інакше карта вказує в порожнечу.

## 4. Селективний контекст-генератор (планується / розширюється) 🟢
| Файл | Що там |
|------|--------|
| `docs/consultations/consultation_selective_context_generator_direction.md` | Напрям: екран вибору документів для `case_context`; повний/вижимка/не включати; бюджет по сторінках. **Головний файл теми.** |
| `docs/consultations/handoff_2026-06-04_artifacts_reorg_context_ocr.md` | «Три-в-одному» (відмова від .txt / керований OCR / селективний контекст), один важіль. |
| `docs/consultations/admin_review_2026-06-09_reconcile_roadmap7.md` | «Один важіль = 2 ортогональні поля» (rule #11); контекст-участь як **персистентне поле схеми** (можливо v12+), звірити з `isKey`. |

## 5. Білінг / CRM (модуль — підготовка збирається) 🟢
| Файл | Що там |
|------|--------|
| `docs/consultations/recommended_activity_event_billing_architecture.md` | Архітектура подій активності → білінг. |
| `docs/tasks/TASK_ai_cost_analysis_and_forecast.md` | Модель $/токен, ранжування агентів → вхід для tariff matrix і `subscription.limits`. |
> Продуктова візія Billing/CRM (`context_billing_crm_v1…v1_5`, `ROADMAP_billing_crm`) — у **зіпах** (`_harvest_inbox/`); після жнив — RETAIN сюди.

## 6. Multi-user activation 🟢
| `docs/consultations/multiuser_saas_activation_notes.md` | Активація мульти-юзера (Олена-помічниця), ролі/доступ (потребує Auth+RLS сервера). |

## 7. Розширення / ЄСІТС / Court Sync 🟢
| Файл | Що там |
|------|--------|
| `docs/CONTEXT_for_extension_session.md` | Контекст extension-сесії. |
| `docs/consultations/extension_architecture_recommendations.md` | Track B — власне Chrome-розширення. |
| `docs/consultations/ecits_admin_context.md` | ЄСІТС адмін-контекст. |
> Продовження Court Sync (Журнал/Розбіжності/синхронізація документів) — у `ROADMAP.md` (паралельна гілка).

## 8. Дизайн / UI / рефакторинг 🟢
| Файл | Що там |
|------|--------|
| `docs/consultations/handoff_2026-06-27_ui_design_unification_state_and_plan.md` | Стан дизайну + 3-рівневий план; **два конкуруючі набори токенів** (App.css ↔ tokens.css). **Головний файл теми.** |
| `docs/consultations/consultation_large_files_refactoring_roadmap.md` | Рефактор великих файлів (CaseDossier/Dashboard/App.jsx), Вісь C. |
| `docs/consultations/consultation_ui_debt_consolidation_plan.md` | План консолідації UI-боргу. |

## 9. DP — візія/аудит під сервер (сам DP готовий) 🟢
| Файл | Що там |
|------|--------|
| `docs/tasks/TASK_dp_full_audit.md` | DP під «продакшн/SaaS/серверна архітектура»; доктрина «map-before-roads». |
| `docs/consultations/consultation_dp_product_vision.md` | Продуктове бачення DP. |

## 10. Серверні фічі великих томів 🟢
| `docs/consultations/consultation_sliding_window_triage_server_feature.md` | Sliding window тріажу — оформлено як **серверна** фіча. |

## 11. Ідеї (майбутні фічі) 🟢
| Файл | Що там |
|------|--------|
| `docs/consultations/ideas_photo_ingestion_workflow.md` | Фото/Telegram-інгест. |
| `docs/consultations/ideas_mermaid_diagram_generation.md` | Генерація діаграм. |

## 12. Жнива знань (мета — як обробити накопичене) 🟢
| Файл | Що там |
|------|--------|
| `docs/consultations/handoff_2026-06-27_knowledge_harvest_kickoff.md` | Метод жнив + курований список читання + засів висновків сесії. |
| `docs/_harvest_inbox/README.md` | Процедура обробки zip-архівів чатів (тимчасова папка). |

---

## Принципи-ядра (PARTIAL — не файл цілком, а одне зерно)
Перелік у `handoff_2026-06-27_knowledge_harvest_kickoff.md` §2.2 (напр. «ручне святе», «зелене-але-зламане»,
scanned-only-guard, «точка рішення адвоката»). Не дублюю тут — коли витягнуться в жнивах, ляжуть у `DEVELOPMENT_PHILOSOPHY.md`.

## Зв'язок карти з іншими артефактами
- **KNOWLEDGE_MAP (цей файл)** — *де що лежить* (постійний індекс keeper'ів за темами).
- **kickoff жнив** — *як обробити* накопичене (одноразовий процес).
- **майстер-план** (виробить сесія-жнив) — *що і в якому порядку робимо* (форвард-план).
Keeper-файли з цієї карти **переживають** жнива (не видаляються); видаляються лише сирі дампи `_harvest_inbox/`.
