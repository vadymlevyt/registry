# Звіт: TASK Billing Foundation v2 — completed

**Дата завершення:** 2026-05-05
**schemaVersion:** 4
**settingsVersion:** "4.0_billing_foundation"
**Гілка:** main
**Залежності виконані:**
- ✅ SaaS Foundation v1 (4f719fc)
- ✅ SaaS Foundation v1.1 Patch and Extension (94faf6c)

---

## 1. Виконано — підсумок

| Фаза | Дій | Результат |
|---|---|---|
| 0 | Діагностика | `diagnostic_billing_foundation.md` (вже був готовий) |
| 1 | Інфраструктура + імпорт legacy | 6 нових сервісів, міграція v3→v4, імпорт `levytskyi_timelog` |
| 2 | Інструментація 25 точок | Dashboard 5, CaseDossier 6, QuickInput 3, Notebook 2, DocumentProcessor 5, App.jsx 4 |
| 3 | Master timer + субтаймери | `masterTimer.js` state machine + Page Visibility + Idle Detection + BroadcastChannel |
| 4 | Стандарти + двофазна модель | `timeStandards.js` (ієрархія user→tenant→system), `confirm_event`, `add_travel` ACTIONS |
| 5 | Місячна ротація | `timeEntriesArchiver.js` — `_archives/time_entries_YYYY-MM.json` на Drive |
| 6 | Query API | `timeEntriesQuery.js` — `getTimeEntries`, `getSummary`, об'єднання активних і архівних |
| 7 | SaaS + ai_usage інтеграція | 10 точок паралельного логування, `recalculateCurrent.hoursBilled`, `TIME_ENTRY_ACTIONS` |
| 8 | Документація + commit | `report_billing_foundation.md`, доповнення `recommended_task_claude_md_audit.md` |

---

## 2. Створені файли (нові)

```
src/services/activityTracker.js          (~350 рядків)
src/services/masterTimer.js              (~280 рядків)
src/services/timeStandards.js            (~180 рядків)
src/services/smartReturnHandler.js       (~140 рядків)
src/services/timeEntriesArchiver.js      (~145 рядків)
src/services/timeEntriesQuery.js         (~155 рядків)
report_billing_foundation.md             (цей файл)
```

## 3. Модифіковані файли

```
src/services/migrationService.js     — v3→v4, importLegacyTimeLog, master_timer_state, billing_meta, time_entries
src/services/tenantService.js         — settings.timeStandards (null дефолт; mig fills)
src/services/permissionService.js     — TIME_ENTRY_ACTIONS, canViewTimeEntries, canEditTimeEntry
src/services/auditLogService.js       — +4 AUDIT_ACTIONS (time_entries_archived, time_entry_edited, _deleted, time_standards_changed)
src/services/subscriptionService.js   — recalculateCurrent(tenant, aiUsage, cases, timeEntries) → hoursBilled
src/services/driveService.js          — backupRegistryDataPreBilling, backupLegacyTimelogPreImport
src/services/ocr/claudeVision.js      — activityTracker.report('agent_call') паралельно logAiUsageViaSink

src/App.jsx                            — стани timeEntries/masterTimerState/billingMeta, persistence,
                                         executeAction hook, ACTIONS (confirm_event, add_travel,
                                         update_time_entry, split_time_entry, ...), legacy import,
                                         місячна архівація на старті, нові PERMISSIONS

src/components/Dashboard/index.jsx     — 5 точок інструментації + agent_call
src/components/CaseDossier/index.jsx   — 6 точок інструментації + agent_call (2 шт: context, chat)
src/components/Notebook/index.jsx      — 2 точки (note_created, note_edited)
src/components/DocumentProcessor/index.jsx — 5 точок + agent_call (3 шт: parse, chat-1, chat-2)

recommended_task_claude_md_audit.md    — додано розділ Billing Foundation v2
```

---

## 4. ASCII-карта системи ДО / ПІСЛЯ

```
ДО (v3, після SaaS Foundation v1.1):
─────────────────────────────────────────────────────────
registry_data.json
├─ schemaVersion: 3
├─ settingsVersion: '3.0_patch_and_extension'
├─ tenants[]
├─ users[]
├─ auditLog[]
├─ structuralUnits[]
├─ ai_usage[]
├─ caseAccess[]
└─ cases[]

services/
├─ aiUsageService.js
├─ modelResolver.js
├─ subscriptionService.js
├─ permissionService.js (active)
├─ tenantService.js
├─ migrationService.js
├─ auditLogService.js
└─ driveService.js

localStorage:
├─ levytskyi_timelog          ← legacy (не в Drive)
└─ levytskyi_action_log_cleaned_v1_1


ПІСЛЯ (v4, після Billing Foundation):
─────────────────────────────────────────────────────────
registry_data.json
├─ schemaVersion: 4
├─ settingsVersion: '4.0_billing_foundation'
├─ tenants[]              (+ settings.timeStandards)
├─ users[]
├─ auditLog[]             (+ time_entries_archived та інші)
├─ structuralUnits[]
├─ ai_usage[]
├─ caseAccess[]
├─ cases[]                (case.timeLog[] — DEPRECATED, лишається пустим)
├─ time_entries[]         ← НОВЕ (місячна ротація)
├─ master_timer_state{}   ← НОВЕ
└─ billing_meta{}         ← НОВЕ

services/ (нові):
├─ activityTracker.js
├─ masterTimer.js
├─ timeStandards.js
├─ smartReturnHandler.js
├─ timeEntriesArchiver.js
└─ timeEntriesQuery.js

Drive:
├─ _backups/                                 (як було)
│   └─ registry_data_backup_pre_billing_<ts>.json   ← НОВЕ
│   └─ levytskyi_timelog_<ts>.json                  ← НОВЕ (одноразово при імпорті)
└─ _archives/                                ← НОВА папка
    ├─ time_entries_2026-04.json (на 1.06)
    ├─ time_entries_2026-05.json (на 1.07)
    └─ ...

localStorage:
├─ levytskyi_timelog                         ← видаляється після імпорту
├─ levytskyi_billing_backup_done_v4         ← новий прапор
├─ levytskyi_timelog_imported_v4            ← новий прапор
├─ levytskyi_time_entries
├─ levytskyi_master_timer_state
└─ levytskyi_billing_meta
```

---

## 5. Карта 25 точок інструментації

```
App.jsx (4)
├─ app_launched              — useEffect mount
├─ module_navigation         — onClick на nav-tab
├─ case_created              — addCase
└─ case_closed / case_restored — closeCase / restoreCase

Dashboard (5)
├─ session start/end         — useEffect mount/unmount (admin)
├─ hearing_viewed            — openModalEditHearing
├─ event_drag_create         — openModalWithRange
├─ agent_message_dashboard   — handleAgentSend
└─ hearing_status_changed    — автоматично через executeAction(update_hearing)

CaseDossier (6)
├─ session start/end         — useEffect [caseData.id] (case_work)
├─ case_opened               — useEffect (один раз)
├─ dossier_tab_switched      — useEffect [activeTab]
├─ document_viewed           — useEffect [selectedDoc.id]
├─ context_regenerated       — handleCreateContext
└─ agent_message_dossier     — sendAgentMessage

QuickInput (3)
├─ qi_document_uploaded      — handleFile
├─ qi_voice_input            — startVoice (recognition.start())
└─ qi_action_executed        — sendChat

Notebook (2)
├─ note_created              — handleAddNote
└─ note_edited               — handleEditNote

DocumentProcessor (5)
├─ docproc_batch_started     — addFiles
├─ docproc_ocr_processed     — analyzeFiles (after AI)
├─ docproc_split_proposed    — handleAnalyzeBoundaries
├─ docproc_split_confirmed   — handleConfirm (split branch)
└─ docproc_batch_completed   — handleConfirm (classify branch)

ВСЬОГО: 25 точок ✅
```

---

## 6. Карта 10 точок паралельного логування `agent_call`

```
1. App.jsx:1330  → QI image parser     (qi_agent, parse_document, kind:image)
2. App.jsx:1460  → QI text parser      (qi_agent, parse_document, kind:text)
3. App.jsx:1740  → QI sendChat         (qi_agent, chat)
4. Dashboard:1525 → handleAgentSend    (dashboard_agent, chat)
5. CaseDossier:891 → handleCreateContext (case_context_generator, generate_context)
6. CaseDossier:1345 → sendAgentMessage  (dossier_agent, chat)
7. DocumentProcessor:248 → analyzePDFWithDocumentBlock (document_parser, parse_document) — via Sink
8. DocumentProcessor:451 → analyzeFiles (document_parser, chat, kind:analyze)
9. DocumentProcessor:622 → sendChat     (document_parser, chat, kind:followup)
10. claudeVision.js:165 → OCR via Sink  (document_parser, parse_document, kind:ocr_vision)
```

---

## 7. ШАРИ АРХІТЕКТУРИ

```
ШАР 1 — Внутрішня логіка (завжди ввімкнена)
  ✅ activityTracker.js
  ✅ master_timer state machine
  ✅ time_entries[] з ротацією
  ✅ smartReturnHandler.js
  ✅ Стандарти часу (system → tenant → user)
  ✅ getTimeEntries Query API
  ✅ Інтеграція з ai_usage[] (паралельне логування)
  ✅ Двофазна модель події (hearing — confirm_event + add_travel)

ШАР 2 — Налаштування UI режиму (вибір адвоката)
  ✅ user.preferences.billing_ui_mode = "off" дефолт
  ✅ user.preferences.autoStartMasterTimer.enabled = false дефолт
  ✅ user.preferences.idleTimeoutMinutes (за замовчуванням 5)

ШАР 3 — Візуальний шар
  ⏸ Поки нічого видимого
  ⏸ Окремий TASK Billing UI v1 — через 6+ міс
```

---

## 8. Принципи варіабельності — закладено

Усі дефолти позначено як стартові точки. В коментарях коду:
```js
// experimental — review after 1 month
```

Через 1-3 місяці адвокат разом із Claude переоцінює:
- Категорії дій (зокрема client_communication billFactor 0.5)
- Стандарти часу за судами/категоріями
- Матриця варіантів для hearing (court_fault розщеплення)
- semanticGroup детектори (screen_active vs screen_passive)
- Тривалість IDLE_TIMEOUT (5 хв)
- Тижнева/місячна/квартальна ротація

---

## 9. Що НЕ зроблено (за scope)

- ❌ Видимий UI master timer (окремий TASK Billing UI v1)
- ❌ UI налаштувань категорій subtimer-ів
- ❌ UI підтвердження події (confirm_event dialog)
- ❌ UI auto-start розкладу
- ❌ Adaptive learning стандартів часу
- ❌ Telegram-бот для retroactive записів

Тимчасове керування — через ACTIONS і команди агенту:
- `confirm_event(eventId, eventType, decision)` через QI/чат
- `add_travel(parentEventId, parentEventType, direction)` через QI/чат
- `start_external_work(category, caseId, subCategory)` через QI/чат
- `assign_offline_period(from, to, category, caseId)` через QI/чат

---

## 10. Перевірка адвокатом

1. Hard reload системи (Cmd+Shift+R / iPad — очистити кеш)
2. Звичайна робота — створити справу, переглянути hearing, відкрити досьє, написати агенту
3. Перевірити в Drive:
   - `registry_data.json` має зрости (поле `time_entries[]` з'явилось)
   - Створено `_backups/registry_data_backup_pre_billing_<ts>.json`
   - Якщо був legacy — `_backups/levytskyi_timelog_<ts>.json`
4. На вибір — відкрити registry_data.json як текст і шукати:
   - `"schemaVersion": 4`
   - `"settingsVersion": "4.0_billing_foundation"`
   - `"time_entries": [...]` — масив з твоїми сьогоднішніми діями
   - `"master_timer_state": {...}`
   - `"billing_meta": {...}`

### Через 1-3 місяці
- Огляд time_entries[] — як зросла, чи доцільно міняти ротацію
- Калібрування timeStandards за реальними цифрами
- Переоцінка ACTIVITY_CATEGORIES і EVENT_VARIANT_MATRIX
- Перегляд `recommended_task_claude_md_audit.md` (Billing Foundation секція)

---

## 11. Послідовність наступних TASK

```
1. ✅ TASK SaaS Foundation v1
2. ✅ TASK SaaS Foundation v1.1 Patch and Extension
3. ✅ TASK Billing Foundation v2 (цей)
4.    TASK Tool Use Preparation
5.    TASK CLAUDE.md Audit (одним проходом v2.0+v3.0+v4.0+v5.0)
6.    TASK Travel Time Fix
7.    TASK Multi-user Activation (окремий чат)
8.    Інші модульні TASK...
N.    TASK Billing UI v1 (через 6+ міс)
N+1.  TASK Analytics Agent (через 6+ міс)
```

---

**Кінець звіту Billing Foundation v2.**

schemaVersion: 4 — закладено.
Структури і API працюють невидимо.
UI з'явиться окремим TASK через 6+ місяців.
