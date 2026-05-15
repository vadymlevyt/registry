# Діагностика перед TASK SaaS Foundation v1.1

**Дата:** 2026-05-05
**TASK:** SaaS Foundation v1.1 — Patch and Extension
**Статус:** ⏸ ОЧІКУЄ ЗГОДИ АДВОКАТА — впровадження не починалось.

---

## 1. Поточний стан після SaaS Foundation v1

### schemaVersion
- `CURRENT_SCHEMA_VERSION = 2` (`src/services/migrationService.js:10`)
- `MIGRATION_VERSION = '2.0_saas_foundation'` (там же:11)
- В App.jsx імпортується і використовується для запису registry (`App.jsx:3592-3593`)

### DEFAULT_TENANT (`src/services/tenantService.js:8-45`)

**Уже є:**
- `tenantId`, `type='bureau'`, `name`, `edrpou`, `registrationDate`, `ownerUserId`
- `addresses` (kyiv, kostopil), `contacts`, `bankDetails`
- `subscription = { plan: 'self_hosted', validUntil: null, features: ['all'] }`
- `settings.documentStandard`
- `createdAt`, `updatedAt`

**ВІДСУТНЄ (треба додати):**
- `storage` — `{ provider, quotaGB, usedBytes }`
- `modelPreferences` — 6 агентів з null
- `subscription.limits` + `subscription.current` + `subscription.alerts`

### DEFAULT_USER (`src/services/tenantService.js:47-67`)

Уже містить: `userId`, `tenantId='ab_levytskyi'`, `globalRole='bureau_owner'`, `name`, `rnokpp`, `advokatLicense`, `email/phone`, `active=true`. Все ОК для v1.1.

### permissionService.js — стан заглушок

| Функція | Стан | Що робить зараз |
|---|---|---|
| `checkTenantAccess` | напівактивна | Виконує перевірку `u.userId === userId && u.tenantId === tenantId`, але має fallback `return true` в кінці — ефективно завжди true |
| `checkRolePermission` | заглушка | `bureau_owner → true`, інші ролі → теж true (через `return true` в кінці) |
| `checkCaseAccess` | **уже активна** | Перевіряє `ownerId === userId`, `team[].userId`, `externalAccess[]` з validUntil; fallback на legacy справи без ownerId |

⚠️ `checkCaseAccess` уже реально працює — TASK Б4/В5 вимагатиме лише уточнень. Сигнатура `checkCaseAccess(userId, caseObj)` приймає **об'єкт справи**, а не `caseId`. У TASK V5 пропонується `checkCaseAccess(userId, caseId)` з внутрішнім lookup — це **зміна сигнатури**, потягне за собою `App.jsx:4396` та інші callers.

### auditLogService.js (`src/services/auditLogService.js:7-14`)

```
AUDIT_ACTIONS = [
  'create_case', 'close_case', 'restore_case', 'destroy_case',
  'delete_hearing', 'delete_deadline'
]
```

Є `shouldAudit`, `buildAuditEntry`, `writeAuditLog`, `updateAuditLogStatus`. LIFO 10 000. Структура запису повна: id, tenantId, userId, userRoleAtTime, action, targetType, targetId, timestamp, status, details, context.

### migrationService.js — поточна функція `migrateCase`

Гарантує: `tenantId`, `ownerId`, `team` (з `lead` для DEFAULT_USER), `shareType='internal'`, `externalAccess[]`. Для вкладених `hearings/deadlines/notes/timeLog` додає `createdBy`. **Не додає** `team[i].permissions`, не торкається `id` типу.

`buildEmptyRegistry()` повертає об'єкт з полями: `schemaVersion, settingsVersion, tenants, users, auditLog, structuralUnits, cases`. **Без** `ai_usage[]`, **без** `caseAccess[]`.

---

## 2. Усі точки виклику Anthropic API

10 точок (TASK очікував 5–7 — реально більше через окремі case_context generator і Vision OCR):

| # | Файл:рядок | Модель (поточна) | agentType (план) | module | operation |
|---|---|---|---|---|---|
| 1 | `src/App.jsx:1281` | `claude-haiku-4-5-20251001` | `qi_agent` | `QI` | `parse_document` (image) |
| 2 | `src/App.jsx:1401` | `claude-haiku-4-5-20251001` | `qi_agent` | `QI` | `parse_document` (text) |
| 3 | `src/App.jsx:1662` | `claude-sonnet-4-20250514` | `qi_agent` (chat) | `QI` | `chat` (sendChat в Universal Panel) |
| 4 | `src/components/Dashboard/index.jsx:1477` | `claude-sonnet-4-20250514` | `dashboard_agent` | `Dashboard` | `chat` |
| 5 | `src/components/CaseDossier/index.jsx:829` | `claude-sonnet-4-20250514` | `case_context_generator` | `Dossier` | `generate_context` (16k tokens, найбільший виклик) |
| 6 | `src/components/CaseDossier/index.jsx:1258` | `claude-sonnet-4-20250514` | `dossier_agent` | `Dossier` | `chat` |
| 7 | `src/components/DocumentProcessor/index.jsx:159` | `claude-sonnet-4-20250514` | `document_parser` | `DocumentProcessor` | `parse_document` (PDF document block) |
| 8 | `src/components/DocumentProcessor/index.jsx:392` | `claude-sonnet-4-20250514` | `document_parser` | `DocumentProcessor` | `chat` (initial structure) |
| 9 | `src/components/DocumentProcessor/index.jsx:531` | `claude-sonnet-4-20250514` | `document_parser` | `DocumentProcessor` | `chat` (followup) |
| 10 | `src/services/ocr/claudeVision.js:115` | `claude-sonnet-4-20250514` (const `MODEL`) | `document_parser` (vision) | `DocumentProcessor` | `parse_document` (PNG-сторінки) |

**Спостереження:**
- `claude-opus-4-7` ніде не викликається. У `MODEL_PRICING` він буде, але `agentType='deep_analysis'` поки не задіяний. ⚠️ Плановий `SYSTEM_DEFAULTS.deepAnalysis = 'claude-opus-4-7'` зараз без caller — треба прийняти що він заглушка для майбутніх UI кнопок.
- 9 з 10 викликів повертають `usage` (стандартний non-streaming response). Vision (#10) теж повертає. Streaming не використовується — добре для логування.
- DocumentProcessor:159 (`analyzePDFWithDocumentBlock`) — функція top-level (не useState компонента), тож `setAiUsage` доведеться передавати через параметр або через context.
- claudeVision (`src/services/ocr/claudeVision.js`) — окремий провайдер, не React-компонент. Аналогічно — потрібен callback або глобальний sink.

---

## 3. `levytskyi_action_log` — стан

**Розташування коду:**
- Декларація `logAction`: `src/App.jsx:4341-4357`
- Виклик: `src/App.jsx:4402` (всередині `executeAction`)

**Що пише:**
```js
{ ts, userId, agentId, action, caseId: params?.caseId || null }
```

**Зберігання:** `localStorage 'levytskyi_action_log'`, **max 500 записів** (slice(0, 500), unshift — нові зверху).

**Не на Drive.** Локальний для пристрою. При відкритті на іншому пристрої — починається з нуля.

**Дублювання з auditLog:**

| Аспект | levytskyi_action_log | auditLog |
|---|---|---|
| Дії | **усі** через executeAction (включно з update_*, add_note, add_hearing) | тільки 6 з AUDIT_ACTIONS |
| Поля | 5 простих | 11 повних з status/details/context |
| Зберігання | localStorage (per device) | registry_data.json + Drive |
| Розмір | 500 записів | 10 000 записів |

**Висновок:** action_log реально ширший (логує все, не тільки 6 критичних), але **бідніший за полями**. CLAUDE.md прямо каже: «`update_*`, `add_note`, ... — НЕ пишемо. Шум переважає користь.» Якщо тримати позицію CLAUDE.md — action_log просто видаляємо без merge (бо ці дії свідомо виключені з auditLog). Merge був би доречний лише для дій що збігаються з AUDIT_ACTIONS, а вони вже в auditLog.

⚠️ **Питання Q5 уточнено нижче.**

---

## 4. id mixed types — масштаб

**Кількість записів з number id:**
- `INITIAL_CASES`: **20 справ** з `id: 1..20` (App.jsx:84-122)
- Брановський (id:4) `documents[]`: **12 документів** з `id: 1..12` (App.jsx:93-104)
- Hearings всередині cases — генеруються через `mkHearing` (треба уточнити, але швидше за все теж number)

**Точки створення id:**

| Файл:рядок | Тип | Контекст |
|---|---|---|
| `App.jsx:1389` | number (`Date.now()`) | QI text-input form, додавання справи |
| `App.jsx:2587` | number (`Date.now()`) | початкова нотатка з form |
| `App.jsx:3194` | number (`Date.now()+Math.random()`) | (треба перевірити що саме) |
| `App.jsx:3717` | number (`Date.now()`) | UI addCase |
| `App.jsx:3779` | string (`Date.now().toString()`) | (треба перевірити) |
| `App.jsx:3977` | string (`case_${Date.now()}`) | ACTIONS.create_case |

**Порівняння в коді:**
- **22 точки** прямого `c.id === otherId` (без String coerce)
- **8 точок** з `String(c.id) === String(otherId)`

⚠️ **Ризик реальний:** якщо `cases[]` містить mix (старий number + новий string), то `c.id === caseId` дає silent failure при пошуку справи створеної через ACTIONS.create_case.

**Скоп міграції:** перетворити **усі** `case.id` в string `case_<value>`. Документи всередині Брановського теж переглянути (12 шт), але вони — внутрішні і доступаються через `caseObj.documents.find(d => d.id === ...)`. Якщо немає крос-посилань — можна не чіпати (але краще привести до однотипності).

**Crossreferences (caseId references):**
- `notes.cases[].caseId` — посилання на caseId (шукати в localStorage notes)
- `calendarEvents[].caseId` — посилання
- `timeLog[i].caseId` (якщо є зовнішній) — наразі timeLog всередині cases
- pinnedNoteIds — НЕ caseId, це noteIds. Не зачіпає.

⚠️ **Q4 уточнено нижче.**

---

## 5. driveService.writeCases — використання

**Стан:**
- `writeCases` оголошений у `src/App.jsx:2894` (driveService — об'єкт всередині App.jsx, **не окремий модуль**!)
- **0 callers** — `grep -n "driveService\.writeCases"` повертає порожньо.
- `readCases` (alias на readRegistry) **використовується** в `src/App.jsx:3020` (connectDrive в AnalysisPanel).

**Висновок:** `writeCases` — мертвий код. Можна видалити без замін. `readCases` залишити (тонкий wrapper над readRegistry).

⚠️ **Зауваження:** TASK A4 каже «Видалити alias writeCases з driveService.js», але driveService — це об'єкт всередині App.jsx, а не окремий файл. У `src/services/driveService.js` (259 рядків) — інший сервіс (для документів справ). **Треба узгодити термінологію в звіті** — це потягне правки в App.jsx, не в services/driveService.js.

---

## 6. Розмір `registry_data.json`

Файл локально не лежить (тільки на Google Drive). **Не можу зміряти точно** в Codespaces.

**Оцінка:**
- 20 справ × ~3 КБ (з SaaS-полями + agentHistory[]) = ~60 КБ
- auditLog (поки порожній або кілька записів) — мізер
- agentHistory всередині кожної справи (поточно до 50 повідомлень × ~500 байт = 25 КБ на справу) — **це найбільший потенційний внесок**

**Прогноз з ai_usage[]:**
- ~250 байт/запис × 50 000 (LIFO) = **~12.5 МБ** при максимумі (1 рік активної роботи).
- Поточно (рік до запуску ai_usage) — 0.

⚠️ Поточно файл, ймовірно, **до 200 КБ**. Не критично. Але при зростанні `ai_usage[]` до 12.5 МБ — Drive sync на кожен setCases стане повільним. **Питання Q-нове** нижче.

---

## 7. agentHistory slice — підтвердження

| Місце | Файл:рядок | Slice | Статус |
|---|---|---|---|
| localStorage write | `CaseDossier:533` | `slice(-20)` | ❌ треба `-50` |
| Drive write | `CaseDossier:540` | `slice(-50)` | ✅ правильно |
| React state (3 місця) | `CaseDossier:1277, 1289, 1298` | `slice(-50)` | ✅ правильно |
| Застарілий коментар | `App.jsx:3273` | — | ❌ ще на місці, треба видалити |

Підтверджено: повністю збігається з `diagnostic_agentHistory.md`.

---

## 8. Структура питань до адвоката

### Q1 — pricing моделей у MODEL_PRICING

TASK дає orientation цифри:
```
'claude-haiku-4-5-20251001':  { input: 0.80,  output: 4.00 }
'claude-sonnet-4-20250514':   { input: 3.00,  output: 15.00 }
'claude-opus-4-7':            { input: 15.00, output: 75.00 }
```

**Беремо саме ці?** Чи перевірити в Anthropic docs зараз і записати поточні? Я можу зайти на docs.anthropic.com і підтвердити.

> **Моя рекомендація:** використати цифри з TASK, додати коментар `// pricing as of 2026-05-04, verify quarterly` — оновлення цін рідкісне, верифікація щокварталу через TASK update_model_pricing.

### Q2 — точки виклику AI «не з фронтенду»

Є `src/services/ocr/claudeVision.js` (рядок 115) — це **frontend-сервіс** (не Node-скрипт), але **не React-компонент**. Логувати чи пропустити?

> **Моя рекомендація:** логувати. Він використовує API ключ адвоката, токени реальні, витрати реальні. Передавати `setAiUsage` через `options.aiUsageSink` параметр (не глобал). Аналогічно для `analyzePDFWithDocumentBlock` (top-level в DocumentProcessor).

### Q3 — додаткові поля в `case.team[i].permissions`

TASK пропонує: canEdit, canDelete, canShare, canAddTeam, canViewBilling, canEditBilling.

**Чи додавати ще?** Можливі кандидати:
- `canCreateDocument` (для DocumentProcessor)
- `canDeleteDocument`
- `canRunAI` (бо AI коштує грошей, важливо для Standard tariff)
- `canExportData`

> **Моя рекомендація:** додати `canRunAI` (важливо для білінгу й тарифних обмежень — Standard може хотіти дозволити одним членам команди використовувати AI, іншим ні). Інші — поки не треба, додамо коли потрібно (поля в JSON додавати дешево).

### Q4 — формат рядка id

TASK: «`case_<number>` чи `case_<UUID>`?»

**Поточні справи:** id 1..20. Вже є створені через ACTIONS — `case_<timestamp>` (тимчасовий, мікроскопічна вірогідність колізій між timestamp 17... і числом 20).

**Варіанти:**
- A. Старі: `case_1` ... `case_20`. Нові: `case_<Date.now()>`. Колізій не буде (Date.now() ≈ 1.78×10¹², далеко від 1-20).
- B. Старі мігрувати в `case_<UUID>`. Тоді треба міняти всі hardcoded reference (тестові посилання? ні, в коді немає). Але ламає institutional memory: «справа №4 — Брановський» — людський спосіб посилання губиться.

> **Моя рекомендація:** Варіант **A**. `case_${original_id}` зберігає людську читабельність (case_4 = Брановський). Колізій немає. Документи всередині Брановського з id 1..12 — теж конвертуємо в string `"1".."12"` (без префікса — це не case_id, а doc_id всередині справи; зміна просто з number на string).

### Q5 — levytskyi_action_log merge: переносити чи видалити

**Стан зараз:** action_log містить *усі* виклики executeAction (включно з update_*, add_note). CLAUDE.md прямо каже не записувати їх в auditLog (шум).

**Варіанти:**
- A. **Видалити без merge.** Бекап в `_backups/levytskyi_action_log_<ts>.json` для history. Семантика чиста: action_log — застарілий шум, auditLog — критичні дії.
- B. **Merge тільки тих action_log записів які є в AUDIT_ACTIONS.** Решту — викинути в бекап. Проблема: пустий результат (вже є записи в auditLog для тих самих дій).
- C. **Merge всіх в auditLog як `status: 'analytics'`** — суперечить CLAUDE.md «шум переважає користь».

> **Моя рекомендація:** Варіант **A**. Бекап повний, потім видалення коду logAction і ключа з localStorage. Якщо адвокат захоче аналітику usage — це зробить майбутній SaaS-телеметричний `ai_usage[]`, який значно ширший за area покриття.

### Q6 — структура `caseAccess[]`

TASK каже: «Тільки структура, без логіки». Адвокат запитує — чи продумати схему наперед?

**Запропонована схема (заздалегідь):**
```json
{
  "caseId": "case_4",
  "userId": "vadym",
  "tenantId": "ab_levytskyi",
  "caseRole": "lead",
  "addedAt": "2024-03-01T...",
  "expiresAt": null,
  "permissionsHash": "..."
}
```

> **Моя рекомендація:** залишити **`[]`** в реєстрі і **README/коментар у migrationService** з очікуваною схемою (приклад). Активувати в окремому TASK Multi-user Activation. Не створювати порожні записи — це лише шум.

### Q-нове — checkCaseAccess сигнатура

TASK V5 показує `checkCaseAccess(userId, caseId)` (string), але **поточна сигнатура** — `checkCaseAccess(userId, caseObj)`. Зміна сигнатури тягне:
- `App.jsx:4396` — `checkCaseAccess(effectiveUserId, caseObj)` → треба передати caseId
- Внутрішній lookup case у `permissionService.checkCaseAccess` — потребує доступу до cases[] (через імпорт або параметр)

**Варіанти:**
- A. Залишити сигнатуру `(userId, caseObj)` — caller сам шукає case і передає об'єкт. Проста, не вимагає глобалу.
- B. Перейти на `(userId, caseId, getCaseById)` — функція-провайдер як 3-й аргумент.
- C. Перейти на `(userId, caseId)` з глобальним sink (cases[] доступні через окремий getCases() — але це антипатерн в чистому permissionService).

> **Моя рекомендація:** Варіант **A** (поточний). Не міняти сигнатуру. Активація = вже зроблена, треба тільки підкрутити логіку (`bureau_owner → завжди true в межах свого tenant`, `tenant isolation для всіх інших`).

### Q-нове — розмір ai_usage[]

При 100-200 викликах/день × 365 днів = 36-73 тис. записів. Slice(-50000) обрізає на 1 рік активної роботи.

**Чи обмежити одразу до 10 000 (≈3 місяці)?** Записи старші за 3 місяці аналітично не такі цінні (місячні звіти йдуть в окремий `ai_usage_archive_<YYYY-MM>.json` коли активуємо повноцінну аналітику).

> **Моя рекомендація:** TASK каже 50 000. Залишити так. Якщо файл стане > 5 МБ — окремим TASK перенесемо в `ai_usage_log.json` на Drive (як архіви time_entries).

### Q-нове — driveService.writeCases термінологія

У TASK A4: «Видалити alias writeCases з driveService.js». Але `writeCases` — у **App.jsx:2894** (об'єкт driveService inline), не у `src/services/driveService.js`.

> **Моя рекомендація:** поправити в TASK термінологію (знати про що йдеться) і **видалити блок 2894-2913 з App.jsx**. `src/services/driveService.js` не змінюється.

---

## 9. Підсумок діагностики — оцінка ризиків TASK v1.1

| Підпункт | Ризик | Час (попередньо) | Стан готовності |
|---|---|---|---|
| А1. agentHistory slice | низький | 7 хв | повна готовність |
| А2. action_log → auditLog | низький (Q5: видалити без merge) | 15 хв (не 30, бо без merge) | потребує згоди Q5 |
| А3. id mixed types | **середній** (22 точки порівняння) | 1.5 год | потребує згоди Q4 + ретельного тестування |
| А4. writeCases cleanup | дуже низький (0 callers) | 10 хв | повна готовність + терм. поправка |
| Б1-Б2. ai_usage + service | середній (10 точок інтеграції) | 2-3 год | повна готовність + Q1, Q2 |
| Б3. tenant.storage | дуже низький | 10 хв | повна готовність |
| Б4. team.permissions | низький | 30 хв (з Q3 — +5 хв на canRunAI) | потребує згоди Q3 |
| Б5. caseAccess[] | мінімальний | 5 хв | повна готовність |
| В1. modelPreferences | мінімальний | 10 хв | повна готовність |
| В2. modelResolver | низький (10 точок інтеграції) | 30 хв | повна готовність |
| В3. subscription.limits | низький | 30 хв | повна готовність |
| В4. checkTenantAccess активація | середній (зачіпає executeAction) | 10 хв | повна готовність |
| В5. checkCaseAccess активація | **середній** (Q-нове: сигнатура) | 30 хв | потребує згоди Q-нове |
| Д1-Д3. migration + backup | середній (інкремент v3, ідемпотентність) | 1.5 год | повна готовність |
| Д4. CLAUDE.md розділ v3.0 | мінімальний | 30 хв | повна готовність |
| Д5. Smoke tests | середній (8 пунктів) | 30 хв | повна готовність |
| Д6. Звіт + commit | мінімальний | 30 хв | повна готовність |

**Очікувана сумарна тривалість:** 9-11 годин (з тестуванням, Q-сесіями, відновленням після помилок). У межах прогнозу TASK (7-10 год) з невеликим запасом.

---

## 10. Що чекаю від адвоката

1. ✅ Відповіді на **Q1-Q6** і **Q-нові** (3 додаткові питання). Коротка форма OK: «Q1: A», «Q2: A», ...
2. ✅ Команда «продовжуй» або «ні, спочатку зробимо XYZ».
3. ✅ Якщо є **Частина Г (адвокатські знахідки)** — додати в TASK перед запуском.

**Статус:** ⏸ ЧЕКАЮ. Не торкаюсь жодного коду до згоди.

---

**Кінець діагностики SaaS Foundation v1.1.**
