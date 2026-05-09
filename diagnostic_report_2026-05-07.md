# ДІАГНОСТИЧНИЙ ЗВІТ — Legal BMS — 2026-05-07

**Версія:** 1.0
**Виконавець:** Claude Code (Opus 4.7) у GitHub Codespaces
**Метод:** статичний аналіз кодової бази через 5 паралельних read-only агентів
**Скоп:** /workspaces/registry (репо v3, гілка main, schemaVersion 4, settingsVersion "4.0_billing_foundation")

---

## ВИКОНАВЧЕ РЕЗЮМЕ

Система Legal BMS у поточному стані — **монолітний React/Vite SPA з державою-оркестратором у `src/App.jsx` (5757 рядків)** і чотирма великими модулями-нащадками (`Dashboard` 2705, `CaseDossier` 2489, `DocumentProcessor` 1203, `Notebook` 800). Архітектурний шар сервісів (16 файлів у `src/services/`) реалізує SaaS Foundation v3 і Billing Foundation v4 згідно з CLAUDE.md v5.0: всі необхідні структури даних (`tenants[]`, `users[]`, `auditLog[]`, `time_entries[]`, `ai_usage[]`, `cases[].team[]`) створені і пишуться, проте **жодного UI цих даних не існує** — це чистий фундамент для майбутніх фаз. `executeAction` асинхронний, з 5-етапною перевіркою (allowlist → tenant → role → case → action), 30 ACTIONS, ~42 точок інструментації `activityTracker.report` (більше за заявлені 25 у CLAUDE.md), 10 точок логування `ai_usage`.

Архітектурні **прогалини щодо Document Processor v2 і Canvas-конструктора** — істотні: `document_processor_agent` відсутній у `PERMISSIONS`; ACTIONS `add_document/update_document/delete_document/update_processing_context/add_documents` **не існують**, попри згадку в CLAUDE.md і `permissionService.js`; `lastProcessingContext` як службове повідомлення між Document Processor і Dossier Agent **не реалізовано**. DocumentProcessor пише документи **напряму через `setCases`/`updateCase`**, обходячи `executeAction` — порушення архітектурного правила. Структура `cases[].documents[]` має чотири різні набори полів у залежності від точки створення; `documentNature/searchable/scanned/namingStatus/isKey` (як окремі поля) не існують — `key` тримається у `tags: ['key']`. Tool Use не розпочато — всі агенти на ACTIONS-JSON pattern.

Інфраструктурно — **OCR Provider Pattern з `pdfjsLocal → documentAi → claudeVision` chain** працює стабільно; Document AI виклик через bearer-токен користувача (`cloud-platform` scope), нативна нарізка PDF на чанки 15 сторінок/20 МБ. Drive OAuth — silent refresh через GIS (`browser-OAuth refresh_token` неможливий), authentication через `localStorage`; на 401 `driveRequest` робить one-shot refresh+retry. Bundle ~1.95 MB JS + 1.24 MB pdf.worker без code splitting (тільки `Notebook` через `React.lazy`); тестів немає; README немає; CI/CD — простий GitHub Pages deploy без lint/тестів. Режим розробки — single-branch (`main`), 32 експериментальних `claude/*` гілки merged.

---

## КЛЮЧОВІ ВИЯВЛЕННЯ І РИЗИКИ

1. **`destroy_case` декларовано в `permissionService.js`/CLAUDE.md, але відсутнє в `ACTIONS`** (`App.jsx:4558-5165`) — видалення тільки через UI-only `deleteCasePermanently` (`App.jsx:4508-4554`). При цьому функція шукає `caseItem.driveFolderId` на верхньому рівні, а реальне поле — `caseItem.storage.driveFolderId`. **Для нових справ Drive-папка фактично НЕ видаляється** (`App.jsx:4524-4527`).
2. **Document Processor обходить `executeAction`** — пише `documents[]` через `updateCase` напряму (`DocumentProcessor/index.jsx:827, 965-968`). Жодних `add_document/update_processing_context` в ACTIONS немає (grep підтвердив 0 збігів). `document_processor_agent` відсутній у `PERMISSIONS` (`App.jsx:5168-5209`).
3. **Чотири точки створення документа з різними наборами полів** — INITIAL_CASES, модалка "+ Новий документ", `handleConfirm` (DP classify), `handleSplit` (DP split) — узгодженості схеми немає. `handleSplit` створює запис без `category/author/procId/driveId/tags` (`DocumentProcessor/index.jsx:955-963`).
4. **Кнопки `Копіювати/Завантажити/🤖 Аналіз` у Viewer мертві** — без `onClick` handler (`CaseDossier/index.jsx:2147-2151`); реальні кнопки `Відкрити в Drive`/`Завантажити` живуть під iframe (`2163-2174`).
5. **Папка справи на Drive НЕ створюється автоматично при `addCase`** (`App.jsx:4296-4312`). Користувач має натиснути окрему кнопку "📁 Створити структуру на Drive" у вкладці Огляд.
6. **agent_history реалізовано тільки для досьє-агента** (3-tier: Drive → localStorage → `cases[].agentHistory`); Dashboard і QI агенти історію не персистять.
7. **Контекст-менеджер відсутній** — кожен виклик до Anthropic API hardcode'ить `max_tokens` (від 500 до 16000) і slice по кількості повідомлень. Немає token-counting, retry, summarize, truncate за токенами.
8. **`lastProcessingContext` НЕ реалізовано** — grep по всьому src/ дав 0 збігів. Document Processor і Dossier agent не передають контекст один одному через службові повідомлення.
9. **Виявлено порушення CLAUDE.md правила №8** (заборона кирилиці в `q=` Drive API): `findOrCreateFolder` (`driveService.js:37-43`) використовує кирилицю в `name='${name}'` для пошуку `01_АКТИВНІ_СПРАВИ`/`00_INBOX`/`_backups` тощо. Правильний патерн застосовано лише у `ensureSubFolders` (`CaseDossier/index.jsx:665-672`).
10. **Реальна кількість ACTIONS — 30** (CLAUDE.md заявляє "19+"). Реальна кількість точок `activityTracker.report` — ~32 базових + 10 `agent_call` (CLAUDE.md заявляє "25 + 10"). `case_restored` не у списку 25.
11. **Bundle без code splitting** — 1.95 MB JS у одному файлі. Vite config мінімальний, без `manualChunks`. React.lazy використано тільки для Notebook (17 KB chunk).
12. **Drive 401 — silent refresh реалізовано через GIS, refresh_token flow — заглушка** (browser OAuth не дає refresh token). На повний failure UI показує `Сесія Google Drive завершилась. Перепідключіть Drive.` (`App.jsx:3878-3881`).
13. **Markdown/code-blocks в чаті агента не рендеряться** — `<div whiteSpace:pre-wrap>` з `msg.content` (`CaseDossier:1416`); жодних markdown-бібліотек у `package.json`.
14. **Tool Use як архітектура не розпочатий** — всі агенти на ACTIONS-JSON pattern; `toolUseRunner.js`/`toolDefinitions.js` (заплановано в CLAUDE.md) не існують.
15. **Кодування ЄСІТС HTML (Windows-1251) повноцінно реалізовано** в `pdfjsLocal` (`pdfjsLocal.js:77-121` — детекція charset з фолбеком).

---

## СТАН ГОТОВНОСТІ ДО ФАЗ ROAD MAP

| Фаза | Готовність | Що готово | Що бракує |
|------|-----------|-----------|-----------|
| **Фаза 1 — Фундамент даних** | ~70% | Tenant/User/Audit/Permissions; Time entries/AI usage; Migration v3→v4; OCR Provider Pattern; Drive auto-folders | Уніфікація схеми `cases[].documents[]`, `documentNature/namingStatus/isKey` як поля схеми; UI керування Status="paused"; узгодження `case.driveFolderId` ↔ `case.storage.driveFolderId` |
| **Фаза 2 — Document Processor v2** | ~25% | Базовий Sonnet+pdf-lib pipeline; кешування OCR в 02_ОБРОБЛЕНІ; локальна нарізка PDF | Tool Use інфраструктура; `document_processor_agent` у PERMISSIONS; ACTIONS для документів; службове повідомлення `lastProcessingContext` у agent_history; команди типу "з'єднай 2 і 3" не парсяться явно |
| **Фаза 3 — Canvas-конструктор** | 0% | — | Вкладка Шаблони — placeholder; Tool Use потрібний; жодного коду |
| **Фаза 4 — Multi-user Activation** | ~50% | `team[]`/`shareType`/`externalAccess[]` поля присутні; `permissionService` ready; SaaS заглушки активні | UI керування командою; `caseAccess[]` денормалізований індекс; реальна `checkRolePermission` (зараз returns true для всіх); UI invite/share |
| **Фаза 5 — ЄСІТС RPA** | 0% | Кодування Windows-1251 в pdfjsLocal | — |
| **Фаза 6 — Telegram бот** | 0% | — | — |
| **Фаза 7 — Billing UI v1** | ~15% | Time_entries collection; AI_usage collection; subscriptionService.recalculateCurrent | UI; категорії "experimental — review after 1 month"; смарт return handler; перевірки лімітів |

---

# РОЗДІЛ 1 — АРХІТЕКТУРНІ ПИТАННЯ ЗАГАЛЬНОСИСТЕМНОГО ЗНАЧЕННЯ

## 1.1 Event bus / pubsub

**Запитано:** Чи існує централізований механізм подій (event bus, pubsub, observer pattern)? Як модулі взаємодіють зараз?

**Виявлено:**

Централізованого event bus / pubsub-механізму в кодовій базі **немає**. Жодного класу/модуля з іменами `Bus`, `EventBus`, `PubSub`, `Subscriber` не знайдено.

Існує **обмежений локальний механізм підписки** в `src/services/activityTracker.js:36-79` — приватний об'єкт `_hooks` з 5 каналами (`onSessionStart`, `onSessionEnd`, `onSubtimerStart`, `onSubtimerEnd`, `onReport`) і функціями `on(eventName, fn)` / `emit(eventName, payload)`. Зовнішніх підписників (CaseDossier/Dashboard/QI) на ці канали немає.

**Browser-DOM події використовуються як єдиний крос-модульний канал:**
- `src/services/driveAuth.js:85, 111-113` — `window.dispatchEvent(new CustomEvent('drive-token-refreshed', { detail: { token } }))`.
- `src/components/CaseDossier/index.jsx:501-502` — єдиний підписник: `window.addEventListener('drive-token-refreshed', onRefresh)`.

**masterTimer використовує BroadcastChannel** для крос-tab синхронізації (`src/services/masterTimer.js:25` — `'legalbms_master_timer'`); fallback на `storage` event і Idle Detector (`:236-252`).

**Як модулі зараз взаємодіють:**
- Усе через `App.jsx` як state-orchestrator. Спільний state (`cases`, `notes`, `calendarEvents`, `auditLog`, `aiUsage`, `timeEntries`) живе там.
- Дочірні компоненти отримують **колбеки через props**: `onExecuteAction={executeAction}` (`App.jsx:5575, 5663, 5710`), `setAiUsage`, `updateCase`, `onAddNote`, `onUpdateNote`.
- **Жодних refs між компонентами** для прямих викликів — модель строго unidirectional.
- Сервіси (activityTracker, masterTimer) отримують `setTimeEntries` як `sink` через `configure({ sink, patchSink })` — модель **callback injection**.

**Висновок:** event bus як абстракція **відсутній**. Локальні підписки тільки в activityTracker; одна точка крос-модульного псевдо-bus через `CustomEvent`. Для майбутніх модулів (Tool Use runner, Canvas, ЄСІТС RPA) — фундаментом event bus може стати або розширення `activityTracker.on/emit` патерну, або новий `eventBus.js` сервіс.

**Релевантні файли:**
- `/workspaces/registry/src/services/activityTracker.js:36-79`
- `/workspaces/registry/src/services/driveAuth.js:78-126`
- `/workspaces/registry/src/services/masterTimer.js:25, 222-252`
- `/workspaces/registry/src/components/CaseDossier/index.jsx:491-502`
- `/workspaces/registry/src/App.jsx` (5575, 5663, 5710 — props injection)

---

## 1.2 Структура agent_history.json

**Запитано:** Де зберігається історія розмов для кожного агента, яка структура, скільки повідомлень, як оновлюється, як завантажується в API.

**Виявлено:**

`agent_history` **реалізовано тільки для досьє-агента**. Dashboard-агент і QI-агент історію не персистять.

**Досьє-агент — 3-tier cache:**
1. **`cases[i].agentHistory`** у registry — fallback (`CaseDossier/index.jsx:433`: `useState(() => caseData.agentHistory || [])`); ініціалізація `agentHistory: []` при `create_case` (`App.jsx:4570`).
2. **`localStorage[agent_history_<caseId>]`** — швидкий кеш, slice `-50` (`CaseDossier/index.jsx:559`).
3. **`agent_history.json`** на Drive у папці справи — головна персистентна копія, slice `-50` (`CaseDossier/index.jsx:557-577`).

**Завантаження** — `CaseDossier/index.jsx:469-554`: каскад Drive → localStorage → caseData.agentHistory.

**Структура повідомлення:** `{ role: 'user'|'assistant', content: string, ts: ISO_string }` (без полів `tenantId`, `userId`, `tokenCount`).

**Зберігання:** slice `-50` у всіх трьох рівнях. Запис — append + slice + перезапис JSON-файлу повністю (`CaseDossier/index.jsx:1356-1361`).

**Передача в API:** **тільки останні 10 повідомлень** для економії токенів (`CaseDossier/index.jsx:1300-1304`):
```js
const historyForAPI = agentMessages
  .filter(m => m.role === 'user' || m.role === 'assistant')
  .slice(-10)
  .map(m => ({ role: m.role, content: m.content }));
```
Перевірка що `messages[0].role === 'user'` (вимога Anthropic API) — рядки 1306-1308.

**Dashboard-агент:** persisted history НЕ існує. Локальний state `chatHistory` живе тільки в пам'яті процесу (`Dashboard/index.jsx:1461-1487`). На refresh — історія втрачається.

**QI-агент:** persisted history НЕ існує. `conversationHistory` — локальний state з slice `-9` (`App.jsx:1700-1704`). При закритті панелі — повний скид (`App.jsx:1288`).

**Формування `messages` array у викликах /v1/messages:**
- Досьє-чат: `[...cleanHistory, { role: 'user', content: userMsg }]` (`CaseDossier:1323`)
- Dashboard-чат: `safeHistory` (`Dashboard:1502`)
- QI-чат: `newHistory` (`App.jsx:1719`)
- QI-парсер тексту: одне повідомлення (`App.jsx:1440`)
- QI-парсер зображень: одне з image+text content (`App.jsx:1304-1310`)
- CaseContext generator: одне (`CaseDossier:875`)
- DocumentProcessor PDF block: одне з document+text (`DocumentProcessor:175-225`)
- claudeVision OCR: одне з масивом images (`claudeVision.js:130`)

**Висновок:** 3-tier cache для досьє — валідна патерна (документована в CLAUDE.md). Dashboard і QI без персистенції — потенційно загублена контекстуальна тяглість при refresh. Для майбутніх Tool Use агентів (DP v2, Canvas) — потрібно вирішити, чи ділити агент-історію між модулями (важлива дизайн-точка).

**Релевантні файли:**
- `/workspaces/registry/src/components/CaseDossier/index.jsx:404-577, 1286-1373`
- `/workspaces/registry/src/components/Dashboard/index.jsx:1453-1548`
- `/workspaces/registry/src/App.jsx:1679-1745, 4570`

---

## 1.3 Контекст-менеджер і обробка переповнення

**Запитано:** Чи є логіка контролю розміру контексту, обробки error, fallback, summarization?

**Виявлено:**

Централізованого context-manager **немає**. Кожен виклик жорстко зашиває свій `max_tokens` і свою стратегію trimming.

**`max_tokens` (хардкод-константи):**
- `App.jsx:1302` — QI image parser: `1024`
- `App.jsx:1438` — QI text parser: `1024`
- `App.jsx:1720` — QI chat: `2048`
- `Dashboard:1500` — Dashboard agent: `500`
- `CaseDossier:873` — case context generator: `16000`
- `CaseDossier:1321` — dossier chat: `4000`
- `DocumentProcessor:174, 434, 609` — `2000`/`2048`
- `claudeVision.js:16, 129` — `MAX_TOKENS = 8192`

**Контроль розміру контексту (input):** Тільки **slice по кількості повідомлень**:
- Досьє: `slice(-10)` для API, `-50` персистенція.
- QI: `slice(-9)`.
- Dashboard: `slice(-10)`.
- ai_usage: `MAX_AI_USAGE_ENTRIES = 50000` LIFO (`aiUsageService.js:19`).

**Жодних обчислень `tokenCount`, `inputTokens.estimate()`, summarize/compaction.** Жодних `truncate(content)`. Великі PDF просто шлються `base64` як є.

**Обробка API error:**
Усі fetch-и до Anthropic у `try/catch`, **без retry**:
- `CaseDossier/index.jsx:1326-1372` — на `!response.ok` пише `⚠️ Помилка ${status}` як assistant-повідомлення; на network error — `⚠️ Мережева помилка: ${err.message}`.
- `App.jsx:1313-1318, 1444-1450` (QI) — `setErrorCategory('llm_failed')`.
- `Dashboard:1506-1511` — `❌ API помилка ${status}`.
- `DocumentProcessor:228-231` — `throw`.
- `claudeVision.js:138-148` — класифікація AUTH/QUOTA/UNKNOWN, `throw makeError`.

**Fallback:** Тільки в OCR-провайдер-патерні (`ocrService.js`) — Document AI → Claude Vision → pdfjs (між **різними провайдерами**). Усередині конкретного API-виклику — fallback'у немає.

**Retry / backoff для Drive:** Існує **на рівні токена** — `driveRequest` (`driveAuth.js:130-148`) на 401 викликає `refreshDriveToken()` і повторює запит **один раз**. Жодного retry на 5xx / network errors / rate limit.

**Висновок:** контекст-менеджер **відсутній** — це системний борг для майбутнього при складніших агентах (Tool Use, Canvas з великими шаблонами, аналіз 100+ документів).

**Релевантні файли:**
- `/workspaces/registry/src/App.jsx:1290-1450, 1706-1745`
- `/workspaces/registry/src/components/CaseDossier/index.jsx:861-905, 1310-1372`
- `/workspaces/registry/src/components/Dashboard/index.jsx:1474-1548`
- `/workspaces/registry/src/services/ocr/claudeVision.js:115-170`
- `/workspaces/registry/src/services/driveAuth.js:130-148`

---

## 1.4 Permissions і ролі агентів

**Запитано:** Структура permissions, як перевіряється повноваження перед executeAction, defensive guard на критичні дії.

**Виявлено:**

**Структура `PERMISSIONS`** — `App.jsx:5168-5209` (3 агенти, без `document_processor_agent`):
- `qi_agent` — повний набір (~26 actions): create_case, close_case, restore_case, update_case_field, deadlines/hearings/notes, time_entries, confirm_event, add_travel, batch_update тощо.
- `dashboard_agent` — обмежений (9 actions): add_hearing, update_hearing, delete_hearing, add_note, update_note, delete_note, confirm_event, add_travel, batch_update.
- `dossier_agent` — повний (як qi_agent + track_session_*) **БЕЗ batch_update**.

**Виявлено критичне:** `document_processor_agent` у `PERMISSIONS` **відсутній**. ACTIONS `add_document`, `update_document`, `delete_document`, `update_processing_context`, `add_documents` теж відсутні (grep — 0 збігів). DocumentProcessor пише документи через прямі `setCases`/`updateCase`.

**executeAction перевіряє allowlist** (`App.jsx:5222-5226`):
```js
const allowed = PERMISSIONS[agentId] || [];
if (!allowed.includes(action)) {
  console.warn(`executeAction BLOCKED: ${agentId} → ${action}`);
  return { success: false, error: `Немає повноважень: ${action}` };
}
```

**`checkTenantAccess` реалізовано** — `permissionService.js:19-24` — реальна перевірка `u.userId === userId && u.tenantId === tenantId`. Викликається у `App.jsx:5234`.

**`checkRolePermission` — заглушка** — `permissionService.js:26-33`: для `bureau_owner` і всіх інших ролей повертає `true` (коментар: `Поки немає матриці — не блокуємо інших`). Викликається у `App.jsx:5240`.

**`checkCaseAccess` реалізовано** — `permissionService.js:36-67`: 5-рівнева перевірка (tenant isolation → bureau_owner → ownerId → team → externalAccess з `validUntil`). Викликається у `App.jsx:5246-5251`.

**Гард на `destroy_case`:**
1. `destroy_case` **відсутній у `ACTIONS`** (`App.jsx:4558-5165`).
2. `destroy_case` **відсутній у будь-якому `PERMISSIONS[agentId]`** (явний коментар `App.jsx:5208`: `// destroy_case, delete_time_entry — жоден агент. Тільки UI.`).
3. UI-only функція — `deleteCasePermanently` (`App.jsx:4508-4554`). AuditLog ДО видалення (`status: 'pending'`), після успіху → `'done'`, на помилку → `'failed'`. Двоступеневе `systemConfirm`.

**Додатково:** `canViewTimeEntries(userId, targetUserId, tenantId)` і `canEditTimeEntry(userId, entry)` (`permissionService.js:71-88`) — не використовуються в UI (0 викликів grep'ом).

**Висновок:** PERMISSIONS-структура для агентів є й працює; `document_processor_agent` як агент в PERMISSIONS треба додати при впровадженні DP v2 разом з ACTIONS для документів. `checkRolePermission` залишається заглушкою — це фаза Multi-user Activation.

**Релевантні файли:**
- `/workspaces/registry/src/App.jsx:5168-5304, 4508-4554`
- `/workspaces/registry/src/services/permissionService.js`
- `/workspaces/registry/src/services/auditLogService.js:7-25`

---

## 1.5 Структура tenant.settings і модель multi-tenancy

**Запитано:** Поля tenant, як використовуються налаштування, готовність до multi-tenancy.

**Виявлено:**

Окремого `tenant.json` немає; усі дані живуть у `registry_data.json` (`App.jsx:2872`: `DRIVE_FILE_NAME = 'registry_data.json'`).

**Структура tenant** — `tenantService.js:18-95` (`DEFAULT_TENANT`):
```
tenantId: 'ab_levytskyi', type: 'bureau',
name, edrpou, registrationDate, ownerUserId,
addresses: { kyiv, kostopil },
contacts: { email, phone, website },
bankDetails: { iban, bank },
storage: { provider: 'drive_legacy', quotaGB: null, usedBytes: null },
modelPreferences: { dossierAgent, qiAgent, qiParserDocument, qiParserImage,
                    dashboardAgent, documentProcessor, documentParserVision,
                    caseContextGenerator, deepAnalysis }, // всі null
subscription: {
  plan: 'self_hosted', status: 'active', validUntil: null, features: ['all'],
  limits: { aiTokensPerMonth, aiCostPerMonth, storageGB, teamMembers, casesActive }, // null
  current: { periodStart, periodEnd, tokensUsed, costUsedUSD, storageUsedGB,
             teamMembersCount, casesActiveCount },
  alerts: { warnAt: 80, blockAt: 100 },
},
settings: {
  language: 'uk',
  documentStandard: { font, fontSize, margins, lineHeight, pageSize },
  timeStandards: null,
},
createdAt, updatedAt,
```

**`tenant.settings` поля:** `language`, `documentStandard` (font, fontSize, margins object, lineHeight, pageSize), `timeStandards` (null → дефолти з `DEFAULT_TENANT_TIME_STANDARDS` через `migrateTenant`).

**`getCurrentTenant()`** — `tenantService.js:119-122`: повертає `DEFAULT_TENANT` (заглушка). Коментар: `// ЗАГЛУШКА: завжди АБ Левицького. У SaaS — з контексту авторизації.`

**Де використовується `tenantId`:** notes (`App.jsx:4370, 4727-4728`), time_entries (`App.jsx:4839, 4848`), travel (`App.jsx:5040`), executeAction (`App.jsx:5219`), auditLog (`App.jsx:5265`), permissionService (`:23, 42, 60, 75, 85`), aiUsage (`aiUsageService.js:38`), activityTracker (`:105`).

**Persistence:** `App.jsx:4156` — `payload.tenants` (масив). State `tenants`, `users`, `auditLog`, `structuralUnits` (`App.jsx:3577-3600`).

**Висновок:** структура tenant повноцінна для майбутньої commercialization (tenants masaiv в registry, SaaS-готова), але `getCurrentTenant` повертає заглушку (DEFAULT_TENANT) — інтеграція з реальною авторизацією — фаза Multi-user Activation.

**Релевантні файли:**
- `/workspaces/registry/src/services/tenantService.js`
- `/workspaces/registry/src/services/migrationService.js:135-160`
- `/workspaces/registry/src/App.jsx:3577-3600, 4126-4197`

---

## 1.6 ACTIONS і executeAction архітектура

**Запитано:** Точний перелік ACTIONS, структура executeAction, які ACTIONS викликає кожен агент, як логуються виклики.

**Виявлено:**

**Точний перелік ACTIONS — 30 ключів** (`App.jsx:4558-5165`):

| # | Action | Рядок |
|---|--------|-------|
| 1 | `create_case` | 4560 |
| 2 | `close_case` | 4577 |
| 3 | `restore_case` | 4586 |
| 4 | `update_case_field` (allowlist полів: name, client, court, case_no, category, next_action, notes, judge, status) | 4595 |
| 5 | `add_deadline` | 4611 |
| 6 | `update_deadline` | 4621 |
| 7 | `delete_deadline` | 4636 |
| 8 | `add_hearing` | 4652 |
| 9 | `update_hearing` | 4670 |
| 10 | `delete_hearing` | 4704 |
| 11 | `add_note` | 4720 |
| 12 | `update_note` | 4755 |
| 13 | `delete_note` | 4797 |
| 14 | `pin_note` | 4816 |
| 15 | `unpin_note` | 4825 |
| 16 | `add_time_entry` | 4836 |
| 17 | `update_time_entry` | 4879 |
| 18 | `cancel_time_entry` | 4903 |
| 19 | `delete_time_entry` | 4916 |
| 20 | `split_time_entry` | 4940 |
| 21 | `assign_offline_period` | 4969 |
| 22 | `confirm_event` (generic для hearing/meeting) | 4980 |
| 23 | `add_travel` | 5029 |
| 24 | `cancel_travel` | 5077 |
| 25 | `track_session_start` | 5090 |
| 26 | `track_session_end` | 5099 |
| 27 | `start_external_work` | 5108 |
| 28 | `end_external_work` | 5117 |
| 29 | `update_external_work` | 5126 |
| 30 | `batch_update` (єдина async-явна) | 5136 |

**Виявлено:** `destroy_case` **відсутній** у ACTIONS — лише UI-only через `deleteCasePermanently`. `add_document/update_document/delete_document/update_processing_context/add_documents` — **відсутні**.

**Сигнатура executeAction** — `App.jsx:5216`:
```js
const executeAction = async (agentId, action, params, userId) => { ... }
```
**`async`**, повертає `{ success: bool, error?: string, ...result }` або (для `batch_update`) `{ success, successCount, total, results }`.

**Послідовність перевірок** (`App.jsx:5216-5304`):
1. `PERMISSIONS[agentId].includes(action)` — allowlist (5222-5226).
2. `ACTIONS[action]` exists — (5228-5231).
3. `checkTenantAccess` — (5234-5237).
4. `checkRolePermission` — (5240-5243, заглушка).
5. `checkCaseAccess` якщо `params.caseId` (5246-5252).
6. `await ACTIONS[action](params)` — (5255).
7. AuditLog для `shouldAudit(action)` (5259-5275). `AUDIT_ACTIONS` (`auditLogService.js:7-21`): `create_case, close_case, restore_case, destroy_case, delete_hearing, delete_deadline, time_entries_archived, time_entry_edited, time_entry_deleted, time_standards_changed, restore_from_backup`.
8. `activityTracker.report(action, ...)` (5279-5297). Виключення: `track_session_*`, `batch_update`.
9. На помилку — catch блок (5300-5303).

**Логування** через console: `OK`, `BLOCKED`, `UNKNOWN`, `TENANT DENIED`, `CASE DENIED`, `ERROR`.

**Висновок:** ACTIONS архітектура зріла, з guard-чейном і логуванням; критичні прогалини — відсутність ACTIONS для документів і відсутність `document_processor_agent` у PERMISSIONS.

**Релевантні файли:**
- `/workspaces/registry/src/App.jsx:4558-5304, 5168-5209`
- `/workspaces/registry/src/services/auditLogService.js:7-21`
- `/workspaces/registry/audit_actions.md` (комплементарний документ)

---

## 1.7 Інструментація і time_entries

**Запитано:** Структура time_entry, точки інструментації, категорії, semanticGroup, IDLE_TIMEOUT, закриття сесій.

**Виявлено:**

**Поля time_entry — 30 полів** (з `activityTracker.js:103-137` + `App.jsx:4846-4874`):
```
id, tenantId, userId, createdAt,
type, module, action,
caseId, hearingId, documentId,
duration, startTime, endTime,
category, subCategory,
billable, visibleToClient, billFactor,
status,
semanticGroup,
parentEventId, parentEventType, parentTimerId, subtimerSessionId, direction,
confidence, source,
originalDuration, actualDuration, confirmedDuration,
exitedVia, resumedAt,
metadata
```

**Точки виклику `activityTracker.report` — повний перелік:**

| File:Line | Event | Module |
|-----------|-------|--------|
| App.jsx:1079 | qi_document_uploaded | QI |
| App.jsx:1331 | agent_call (QI image parser) | QI |
| App.jsx:1462 | agent_call (QI text parser) | QI |
| App.jsx:1654 | qi_voice_input | QI |
| App.jsx:1683 | qi_action_executed | QI |
| App.jsx:1738 | agent_call (QI chat) | QI |
| App.jsx:3773 | app_launched | APP |
| App.jsx:4311 | case_created | ADD_FORM |
| App.jsx:4474 | case_closed | UI |
| App.jsx:4492 | case_restored | UI |
| App.jsx:5092 | startSession | (per param) |
| App.jsx:5101 | endSession | — |
| App.jsx:5110 | startSubtimer | (per param) |
| App.jsx:5119 | endSubtimer | — |
| App.jsx:5284 | hook for executeAction | EXECUTE_ACTION |
| App.jsx:5556 | module_navigation | APP |
| Dashboard:1040 | startSession | dashboard |
| Dashboard:1457 | agent_message_dashboard | DASHBOARD |
| Dashboard:1523 | agent_call (dashboard chat) | DASHBOARD |
| Dashboard:1583 | event_drag_create | DASHBOARD |
| Dashboard:1607 | hearing_viewed | DASHBOARD |
| CaseDossier:438 | startSession | case_dossier |
| CaseDossier:440 | case_opened | CASE_DOSSIER |
| CaseDossier:447 | dossier_tab_switched | CASE_DOSSIER |
| CaseDossier:453 | document_viewed | CASE_DOSSIER |
| CaseDossier:699 | context_regenerated | CASE_DOSSIER |
| CaseDossier:894 | agent_call (case context generator) | CASE_DOSSIER |
| CaseDossier:1290 | agent_message_dossier | CASE_DOSSIER |
| CaseDossier:1347 | agent_call (dossier chat) | CASE_DOSSIER |
| DocumentProcessor:247 | agent_call (document_parser) | DOCUMENT_PROCESSOR |
| DocumentProcessor:322 | docproc_batch_started | DOCUMENT_PROCESSOR |
| DocumentProcessor:454 | agent_call | DOCUMENT_PROCESSOR |
| DocumentProcessor:473 | docproc_ocr_processed | DOCUMENT_PROCESSOR |
| DocumentProcessor:527 | docproc_split_proposed | DOCUMENT_PROCESSOR |
| DocumentProcessor:626 | agent_call | DOCUMENT_PROCESSOR |
| DocumentProcessor:722 | docproc_split_confirmed/docproc_batch_completed | DOCUMENT_PROCESSOR |
| Notebook:135 | note_created | NOTEBOOK |
| Notebook:171 | note_edited | NOTEBOOK |
| claudeVision.js:163 | agent_call (OCR) | DOCUMENT_PROCESSOR |

**Загалом ~32 базових + 10 `agent_call` = ~42 точки** (CLAUDE.md заявляє 25 — фактична кількість більша).

**Категорії (`ACTIVITY_CATEGORIES` — `timeStandards.js:110-120`):**
- `case_work` — billable, visible, factor 1.0
- `hearing_attendance` / `hearing_preparation` / `travel` — billable, visible, 1.0
- `client_communication` — billable, NOT visible, 0.5
- `admin` / `system` / `break` — non-billable, 0.0
- `manual_entry` — billable, visible, 1.0

Усі позначені `// experimental — review after 1 month`.

**semanticGroup:** Поле є; значення `'screen_active' | 'screen_passive'`. Заповнюється:
- Subtimer auto-detection (`activityTracker.js:228-231`)
- `assignOfflinePeriod` дефолт `'screen_passive'` (`:308`)
- `add_travel` дефолт `'screen_passive'` (`App.jsx:5058`)

**IDLE_TIMEOUT:** `DEFAULT_IDLE_TIMEOUT_MIN = 5` (`masterTimer.js:24`); override через `user.preferences.idleTimeoutMinutes`. RECOVERY_THRESHOLD_MS = 30 хв.

**Сесії правильно закриваються:**
- `endSession` (`activityTracker.js:184-212`): обчислює `duration = (end - start) / 1000`; якщо `duration > 0` — пише `time_entry`.
- Викликається з cleanup'ів `useEffect` у Dashboard:1041 і CaseDossier:442 через `return () => activityTracker.endSession({ reason: 'unmount' })`.

**Стан "не пишемо до hydration":** `activityTracker._enabled` (`:35`). До hydration — `report` повертає `null`.

**Висновок:** інструментація щільна, реальна кількість точок істотно більша за заявлену (42 vs 25); категорії і semanticGroup впроваджені, IDLE_TIMEOUT як налаштування.

**Релевантні файли:**
- `/workspaces/registry/src/services/activityTracker.js`
- `/workspaces/registry/src/services/timeStandards.js`
- `/workspaces/registry/src/services/masterTimer.js`

---

## 1.8 ai_usage логування

**Запитано:** Структура ai_usage, точки логування, як рахується вартість, як розрізняються моделі.

**Виявлено:**

**Структура запису** — `aiUsageService.js:31-53`:
```
{
  id: 'usage_<ts>_<random>',
  tenantId, userId, timestamp,
  agentType, model,
  inputTokens, outputTokens, totalTokens,
  estimatedCostUSD,
  context: { caseId, module, operation }
}
```

**Точки логування ai_usage — 10 точок (співпадає з CLAUDE.md):**

| File:Line | agentType | resolveModel |
|-----------|-----------|--------------|
| App.jsx:1322 | qi_agent | qiParserImage |
| App.jsx:1454 | qi_agent | qiParserDocument |
| App.jsx:1729 | qi_agent | qiAgent |
| Dashboard:1515 | dashboard_agent | dashboardAgent |
| CaseDossier:886 | case_context_generator | caseContextGenerator |
| CaseDossier:1340 | dossier_agent | dossierAgent |
| DocumentProcessor:240 | document_parser | documentProcessor |
| DocumentProcessor:447 | (per call) | (per call) |
| DocumentProcessor:619 | (per call) | (per call) |
| claudeVision.js:152 | document_parser | documentParserVision |

**Розрахунок вартості** — `aiUsageService.js:21-25`:
```js
const cost = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
```

**MODEL_PRICING** (`aiUsageService.js:11-17`, коментар `pricing as of 2026-05-04, verify quarterly`):
- `claude-haiku-4-5-20251001`: $0.80 / $4.00 per 1M
- `claude-sonnet-4-20250514`: $3.00 / $15.00
- `claude-opus-4-7`: $15.00 / $75.00
- `default`: 0/0

**Розрізнення моделей** — за полем `model` у запиті, через `resolveModel(agentType)` (`modelResolver.js`).

**Ротація** — LIFO `MAX_AI_USAGE_ENTRIES = 50000` (`aiUsageService.js:19`).

**Токени** — з `data.usage.input_tokens` / `data.usage.output_tokens` Anthropic response.

**Аналітичні функції** (`aiUsageService.js:101-132`): `getUsageByPeriod/Model/Case/User`, `getTotalCost`. **Не використовуються в UI** (0 викликів grep'ом).

**Висновок:** ai_usage збирається повноцінно і покриває всі 10 викликів API. Аналітичні функції готові, але немає UI для оператора SaaS — це фаза Billing UI.

**Релевантні файли:**
- `/workspaces/registry/src/services/aiUsageService.js`
- `/workspaces/registry/src/services/modelResolver.js`

---

## 1.9 Storage layer і Drive integration

**Запитано:** Абстракція storage, OAuth токени, retry logic, структура папок.

**Виявлено:**

**driveAuth.js (148 рядків):**
- `GOOGLE_CLIENT_ID` хардкод (`:8-9`); scope: `drive` + `cloud-platform` (`:10`).
- Зберігання токену: `localStorage[levytskyi_drive_token]` (`:11, 16-22`).
- **Refresh:** `silentGisRefresh()` через GIS `initTokenClient({ prompt: '' })` без UI (`:27-50`); `refreshTokenGrant()` (класичний OAuth refresh_token) залишений як заглушка для майбутнього (`:56-76`).
- `refreshDriveToken()` — дедуплікація через `refreshInFlight` Promise; на успіх диспатчить `'drive-token-refreshed'` (`:78-95`).
- `forceConsentRefresh()` (`:100-126`): з `prompt: 'consent'` для нових scope.
- **`driveRequest(url, options)`** (`:130-148`) — єдиний wrapper. На 401 викликає `refreshDriveToken()`, повторює запит **один раз**. На 5xx / network — без retry.

**driveService.js (335 рядків):**
- Часткова абстракція; обходиться у `App.jsx`.
- Структура папки справи **створюється автоматично**: `createCaseStructure(caseName, token)` (`:64-82`) — створює `01_АКТИВНІ_СПРАВИ`, `00_INBOX`, папку справи + 5 підпапок: `01_ОРИГІНАЛИ`, `02_ОБРОБЛЕНІ`, `03_ФРАГМЕНТИ`, `04_ПОЗИЦІЯ`, `05_ЗОВНІШНІ` (`CASE_FOLDER_STRUCTURE` :11-17).
- Backup-функції (`:140-272`): `backupRegistryDataPreSaas/PreV3/PreBilling`, `backupLegacyTimelogPreImport`, `backupActionLogPreCleanup`, `backupRegistryData` (з ротацією 7 останніх).

**Прямі виклики API в компонентах:**
- `App.jsx:2874-3267` — внутрішній `driveService` об'єкт (200+ рядків) для роботи з `registry_data.json`.
- `App.jsx:4499-4502` — `deleteDriveFolder` робить `driveRequest` напряму.
- `CaseDossier`, `DocumentProcessor` імпортують функції з `driveService.js`.

**OAuth:**
- localStorage clear-text токен.
- 401 → silent refresh; UI повідомлення `Сесія Google Drive завершилась. Перепідключіть Drive.` (`App.jsx:3878-3881`).

**Retry:** Тільки на 401 (один раз). На 5xx, network, rate limit — **без retry**.

**Структура папок:** автоматично у `createCaseStructure`. Окрема функція `ensureSubFolders` (`CaseDossier/index.jsx:656-691`) "лікує" legacy справи, шукаючи існуючі підпапки за NFC-нормалізованими іменами.

**Висновок:** Drive integration робоча; абстракція часткова — internal driveService у App.jsx + зовнішній `driveService.js`. R2/S3 backend поки не передбачено.

**Релевантні файли:**
- `/workspaces/registry/src/services/driveAuth.js`
- `/workspaces/registry/src/services/driveService.js`
- `/workspaces/registry/src/App.jsx:2874-3270`

---

## 1.10 Loading скриптів, бандл, продуктивність

**Запитано:** Розмір бандлу, code splitting, лазі-завантаження.

**Виявлено:**

**Розмір з `dist/assets/`:**
- `index-DD3DEufm.js` — **1,949,685 байт** (1.95 MB) — основний bundle
- `pdf.worker.min-FHbmGBN0.mjs` — **1,244,253 байт** (1.24 MB) — PDF.js worker
- `index-CgqFTUIo.js` — **17,540 байт** (17 KB) — окремий chunk (Notebook)
- `index-xEaMr-A_.css` — 20,187 байт (20 KB)

**React.lazy** — лише один:
- `App.jsx:24`: `const Notebook = React.lazy(() => import('./components/Notebook'));`
- `App.jsx:5630-5632`: `<React.Suspense fallback={<div>Завантаження...</div>}>`

Інші компоненти (Dashboard, CaseDossier, DocumentProcessor) **імпортуються синхронно**.

**`vite.config.js` (5 рядків):**
```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: '/registry/',
  plugins: [react()],
});
```
**Без `manualChunks`, без `chunkSizeWarningLimit`.**

**Бібліотеки в node_modules:**
- `pdfjs-dist@^5.6.205` — 41 MB на диску (pdf.worker 1.24 MB + rendering API в bundle)
- `pdf-lib@^1.17.1` — 24 MB на диску
- `mammoth@^1.12.0` — 2.5 MB
- `react`, `react-dom@^18.3.1`

**Розміри JS файлів коду:** App.jsx 5757 рядків, Dashboard 2705, CaseDossier 2489, DocumentProcessor 1203, Notebook 800.

**Висновок:** Bundle монолітний, ~3.2 MB сумарно з worker'ом. Tablet (Lenovo Yoga Tab 13 з обмеженою пам'яттю) — потенційний ризик при OOM з великими PDF.

**Релевантні файли:**
- `/workspaces/registry/dist/assets/`
- `/workspaces/registry/vite.config.js`
- `/workspaces/registry/package.json`

---

# РОЗДІЛ 2 — СТАН МОДУЛЯ ДОСЬЄ

## 2.1 Структура файлів модуля досьє

**Виявлено:** Один файл `src/components/CaseDossier/index.jsx` (2489 рядків, 138 КБ). Підкомпонентів немає.

**Секції файлу:**
- `1-10`: імпорти (React, DocumentProcessor, driveService — 8 функцій, driveAuth, ocrService, SystemModal, aiUsageService, modelResolver, activityTracker, moduleNames).
- `12-46`: словники-константи (CATEGORY_LABELS, AUTHOR_LABELS, TAG_COLORS, PROC_COLORS, CASE_TYPE_LABELS, PROC_TYPE_LABELS).
- `47-332`: `CASE_CONTEXT_SYSTEM_PROMPT_V2` — 280-рядковий промпт для генератора `case_context.md`.
- `334-403`: 4 локальних хелпери (`buildCaseMetadata`, `fillSystemPrompt`, `getNotesForContext`, `formatNotesForPrompt`).
- `404-2489`: основний компонент.

**Внутрішній state:** 33 `useState`, 4 `useRef`, 11 `useEffect`. **`useMemo` / `useCallback` — відсутні.**

**Релевантні файли:** `/workspaces/registry/src/components/CaseDossier/index.jsx`

---

## 2.2 Структура case у registry_data.json

**Виявлено:** Канонічні поля задані у `INITIAL_CASES` (`App.jsx:91-131`) і доповнюються SaaS-полями в `migrationService.js:78-145`.

**Базові поля (з INITIAL_CASES):**
- `id` (string, формат `case_<n>`)
- `name`, `client`, `category` (`civil|criminal|military|admin`), `status` (`active|paused|closed`)
- `court`, `case_no`, `next_action`, `notes` (legacy string)
- `pinnedNoteIds: []`
- `hearings`: `{ id, date, time, court, notes, status }`
- `deadline` (legacy string), `deadline_type`
- `proceedings` (тільки на Брановському): `{ id, type, title, court, status, parentProcId, parentEventId }`
- `documents` (тільки на Брановському): `{ id, procId, name, icon, date, category, author, tags, notes }`

**SaaS-поля (через `ensureCaseSaasFields`):**
- `tenantId` (`ab_levytskyi`), `ownerId` (`vadym`)
- `team[]`: `[{ userId, caseRole:'lead', addedAt, addedBy, permissions }]`
- `shareType`: `'internal'`
- `externalAccess: []`
- `createdAt`, `updatedAt`

**Поля поза INITIAL_CASES:**
- `storage: { driveFolderId, driveFolderName, subFolders, localFolderPath, lastSyncAt }` — створюється кнопкою "Створити структуру"
- `agentHistory: []` (slice-50)
- `timeLog: []` (DEPRECATED)

**Поля з підпункту, які НЕ ЗНАЙДЕНО:**
- `caseNumber` — немає, є `case_no`
- `relatedCaseIds` — немає
- `driveDossierFolderId` — немає (є `storage.driveFolderId`)
- `driveContextId` — немає (контекст знаходять через `files.find(f.name === 'case_context.md')`)

**Реальні приклади:**
- Брановський (`case_4`) — єдина справа з повними `proceedings[]` і `documents[]` (12 документів).
- Кісельова (`case_9`) — короткий формат.
- Сипко (`case_16`) — `status:'paused'`, `hearings:[]`. Демонструє "Призупинену" справу.

**Релевантні файли:**
- `/workspaces/registry/src/App.jsx:91-131`
- `/workspaces/registry/src/services/migrationService.js:78-145, 366`

---

## 2.3 Структура папки справи на Drive

**Виявлено:** Канонічна структура задана в `driveService.js:11-29`:

```
01_АКТИВНІ_СПРАВИ/
├── 00_INBOX/  (рівень кореня Drive, не підпапка справи)
└── <caseName>/
    ├── 01_ОРИГІНАЛИ
    ├── 02_ОБРОБЛЕНІ
    ├── 03_ФРАГМЕНТИ
    ├── 04_ПОЗИЦІЯ
    └── 05_ЗОВНІШНІ
```

**`CATEGORY_FOLDER_MAP` (`driveService.js:19-29`):** pleading, court_act, evidence, correspondence, motion, contract → 02_ОБРОБЛЕНІ; fragment → 03; position → 04; original → 01; default → 02.

**Файли всередині папки справи:**
- `case_context.md` — згенерований через `handleCreateContext`
- `agent_history.json` — slice-50 повідомлень досьє-агента
- `archive/case_context_<ts>.md` — попередня версія контексту копіюється сюди при оновленні
- **`.metadata/documents_extended.json` — НЕ виявлено** (такого механізму немає)

**Хто створює:**
- `createCaseStructure(caseName, token)` (`driveService.js:64-82`) — викликають `handleCreateDriveStructure` (`CaseDossier:979`) і `saveFilesToStorage` (`DocumentProcessor:666`).
- `ensureSubFolders` (`CaseDossier:656-691`) — "лікує" legacy справи через NFC-нормалізацію.

**Релевантні файли:**
- `/workspaces/registry/src/services/driveService.js:11-82`
- `/workspaces/registry/src/components/CaseDossier/index.jsx:656-691, 972-995`

---

## 2.4 Створення нової справи

**Виявлено:** **Чотири точки створення:**

1. **UI форма "+ Нова справа"** (`addCase`, `App.jsx:4296-4312`):
   - `id = case_${Date.now()}`, `ensureCaseSaasFields`.
   - Пише `writeAudit({ action: 'create_case', source: 'ui_form' })` напряму (обхід executeAction).
   - `activityTracker.report('case_created', ...)`.

2. **QI agent** (`onExecuteAction('qi_agent', 'create_case', ...)`) — два місця: `App.jsx:1574-1586` і `:1913-1922`.

3. **ACTION `create_case`** (`App.jsx:4560-4575`):
   - `id = case_${Date.now()}`, `userId:'vadym'`, `hearings:[]`, `deadlines:[]`, `timeLog:[]`, `agentHistory:[]`, потім `ensureCaseSaasFields`.
   - **НЕ створює** Drive-папок, **НЕ створює** `case_context.md` чи `agent_history.json`.

4. **Dossier agent через `dossier_agent` PERMISSIONS** — є в дозволах, але активних callers не виявлено.

**Drive-папка створюється ОКРЕМО** — користувач натискає кнопку "📁 Створити структуру на Drive" (`CaseDossier:1716-1727`) → `handleCreateDriveStructure`. Без цього `storage.driveFolderId === null` і у шапці `⚠️ Без папки`.

**`case_context.md` — окрема операція** (кнопка "Створити контекст").
**`agent_history.json`** — лазі при першому повідомленні.

**Релевантні файли:**
- `/workspaces/registry/src/App.jsx:4296-4312, 4560-4575, 1574-1586`
- `/workspaces/registry/src/components/CaseDossier/index.jsx:972-995, 1716-1750`

---

## 2.5 Документи і метадані

**Виявлено:** **Чотири точки створення документа з різними наборами полів:**

**Точка A — Брановський INITIAL_CASES** (`App.jsx:101-112`):
```
{ id, procId, name, icon, date, category, author, tags, notes }
```

**Точка B — модалка "+ Новий документ" Матеріали** (`CaseDossier:2464-2476`):
```
{ id: Date.now()(number!), procId, name, icon, date, category, author, tags, driveId, driveUrl, notes }
```

**Точка C — Document Processor handleConfirm** (`DocumentProcessor:804-823`):
```
{ id: 'doc_<ts>_<i>', name, originalName, category, author, folder, date,
  pageCount, size, originalSize, icon, procId, tags:[], status:'ready',
  driveId, driveUrl, savedLocally, addedAt }
```

**Точка D — Document Processor handleSplit** (`DocumentProcessor:955-963`) — найбідніший:
```
{ id, name, type, pageCount, folder:'02_ОБРОБЛЕНІ', status:'ready', addedAt }
```
**БЕЗ** `category, author, procId, driveId, tags`. Такі документи матимуть `proc?.type` undefined у Реєстрі (мітка `[К]` за замовчуванням).

**Точка E — drag-and-drop "Перетягніть або натисніть"** (`CaseDossier:1881-1958`):
- Файл завантажується на Drive у `01_ОРИГІНАЛИ` через `uploadFileLocal`.
- **НЕ створює запис у `caseData.documents[]`** — тільки фіксує файл на Drive.

**Поля з підпункту, які НЕ ЗНАЙДЕНО:**
- `documentNature` (searchable/scanned) — **немає взагалі**.
- `namingStatus` — **немає**.
- `isKey` (окреме поле) — **немає**. Замість цього `tags: ['key']` (`CaseDossier:2009, 2068, 2436`).

**Висновок:** схема документа фрагментована між точками — критично для уніфікації перед DP v2.

**Релевантні файли:**
- `/workspaces/registry/src/App.jsx:100-113`
- `/workspaces/registry/src/components/CaseDossier/index.jsx:2464-2476`
- `/workspaces/registry/src/components/DocumentProcessor/index.jsx:804-823, 955-963`

---

## 2.6 Вкладка Огляд

**Виявлено:** Рендер у `renderOverview` (`CaseDossier:1499-1964`).

**Секції зверху донизу:**
1. **Інформація про справу** (`1504-1534`) — 4 поля inline через `contentEditable`, `onBlur` → `updateCase`.
2. **Засідання** (`1537-1604`) — список + "+ Додати" → `window.prompt(...)` → `add_hearing`.
3. **Дедлайни** (`1607-1675`) — аналогічно з `add_deadline/update_deadline/delete_deadline`.
4. **Нотатки до справи** (`1678-1710`) — pinned-нотатка з `pinnedNoteIds[]`.
5. **Сховище** (`1713-1750`) — кнопка "📁 Створити структуру на Drive" або індикатор "☁️ <ім'я>".
6. **Контекст справи** (`1753-1777`) — тільки якщо `storageState?.driveFolderId` є. Кнопка "Створити контекст".
7. **Провадження** (`1780-1800`) — рендер `proceedings.map`. Кнопка "+ Додати провадження" → `procModalOpen`.
8. **Нотатки по справі** (`1803-1879`) — повний список з ✏️/🗑/📌.
9. **Drop zone "Перетягніть або натисніть"** (`1882-1915`).
10. **Черга файлів `dropQueue[]`** (`1918-1960`) — кнопка `▶ Завантажити на Drive`.

**Кнопка "Створити контекст" — повний flow** (`CaseDossier:693-958`):
1. Перевірка існуючого `case_context.md` → підтвердження "замінити".
2. `ensureSubFolders(caseData)` для legacy справ.
3. Збір файлів з 01+02, виключаючи `.txt`, `agent_history.json`, `case_context.md`.
4. **OCR через `ocrService.extractTextBatch`** з `concurrency: 3`.
5. Якщо ВСІ файли мають AUTH помилку — пропозиція `forceConsentRefresh()`.
6. Виклик Anthropic, **модель**: `resolveModel('caseContextGenerator')` → `claude-sonnet-4-20250514`.
7. Архівація попереднього `case_context.md` у `archive/case_context_<ts>.md`.
8. Upload нового `case_context.md`.

**Кнопки з підпункту, які НЕ ЗНАЙДЕНО:**
- **"Заповнити картку"** — немає в коді.
- **"Призупинити"** — немає. Статус `paused` не змінюється з UI; задається тільки через INITIAL_CASES або `update_case_field` від агента.

**Модалка "+ Нове провадження"** (`2353-2389`) — поля `Тип` (select: appeal/cassation/first), `Назва`, `Суд`. На "Додати" — `proceedings[]` з `parentProcId: 'proc_main'`.

**Релевантні файли:**
- `/workspaces/registry/src/components/CaseDossier/index.jsx:1499-1964, 693-958, 2353-2389`

---

## 2.7 Вкладка Матеріали

**Виявлено:** Рендер у `renderMaterials` (`CaseDossier:1967-2192`).

**Дерево/Реєстр — ПЕРЕМИКАЧ, не окремі компоненти.** State `matMode: 'tree' | 'registry'`. Кнопки `1976-1980`.

**Фільтри (тільки в Реєстрі, `2024-2049`):**
1. Провадження (`docFilters.proc`): "Всі" + динамічно з `proceedings.map`.
2. Категорії (`docFilters.category`): all/pleading/motion/court_act/evidence/correspondence.
3. Автор (`docFilters.author`): all/ours/opponent/court.

Усі `flexWrap:wrap`.

**Логіка фільтрації — frontend** (`CaseDossier:1023-1028`):
```js
const filteredDocs = documents.filter(d => {
  if (docFilters.proc !== "all" && d.procId !== docFilters.proc) return false;
  if (docFilters.category !== "all" && d.category !== docFilters.category) return false;
  if (docFilters.author !== "all" && d.author !== docFilters.author) return false;
  return true;
});
```

**Мітки [П]/[А]/[К]** визначаються через **тип провадження** (`CaseDossier:2063`):
```
proc?.type === "first" ? "[П]" : proc?.type === "appeal" ? "[А]" : "[К]"
```
Якщо `procId` пустий → мітка `[К]` за замовчуванням.

**Повнотекстовий пошук — НЕ ЗНАЙДЕНО.**

**Релевантні файли:**
- `/workspaces/registry/src/components/CaseDossier/index.jsx:1967-2192, 1023-1028, 2391-2485`

---

## 2.8 Вкладка Робота з документами (Document Processor)

**Виявлено:** Окремий компонент `DocumentProcessor/index.jsx` (1203 рядки), імпортується у досьє і рендериться на `activeTab === 'docprocessor'`.

**UI структура (`render`, `1034-1202`):**
- **Зона 0** — індикатор платформи: ☁️ Google Drive / 💾 Обрати папку.
- **Зона 1 — Drop zone** з `accept = ACCEPTED_TYPES.join(",")`.
- **Зона 2 — Черга файлів** з `status: pending|processing|done|error`.
- **Зона 3 — Чат з агентом** + кнопки `Підтвердити нарізку/структуру / Редагувати / Скасувати`.

**Pipeline для одного PDF** (`addFiles` → `1`, PDF detection):
1. Файл додається у `files[]` зі статусом `pending`.
2. `[BILLING] docproc_batch_started` (`322`).
3. PDF читається `pdf-lib` `PDFDocument.load(buffer)`, отримується `numPages`.
4. Зберігається `uploadedFile`/`uploadedFileRef` + `totalPages`.
5. Агент: `"📄 ${name} (${numPages} сторінок) ... Що зробити?"`.

**OCR — НЕ викликається у DocumentProcessor.** OCR (Document AI) працює тільки у `CaseDossier` для генерації `case_context.md`. У DocumentProcessor для нарізки PDF — **`analyzePDFWithDocumentBlock`** (`174-263`):
- Весь PDF як `base64`, `type:"document"` document block у Claude.
- Модель: `resolveModel('documentProcessor')` → `claude-sonnet-4-20250514` (**Sonnet, не Haiku, не Document AI**).
- Промпт інлайн (`188-222`) просить JSON з `documents[]` зі `startPage/endPage/type`.

**PDF нарізається ЛОКАЛЬНО через `pdf-lib`** (`107-140` і `856-996`):
```js
const newDoc = await PDFDocument.create();
const pages = await newDoc.copyPages(srcDoc, indices);
pages.forEach(p => newDoc.addPage(p));
const bytes = await newDoc.save({ useObjectStreams: true });
```
**Межі знаходить Claude Sonnet, нарізає `pdf-lib` локально.**

**ACTIONS — НЕ викликає `executeAction`.** Document Processor працює без `onExecuteAction` пропу. Замість цього:
- `updateCase(caseData.id, "documents", [...existingDocs, ...newDocuments])` (`827, 965-968`).
- Прямий `driveRequest` для аплоаду на Drive у `02_ОБРОБЛЕНІ`.
- `activityTracker.report('docproc_*', ...)`.

**Обробка природних команд (`sendChat`, `554-654`):**
- `"нарізати"`/`"розріж"` → `handleAnalyzeBoundaries`.
- `"підтвердити"`/`"так"` → `handleConfirm`.
- Команди типу **"з'єднай 2 і 3"** — у тексті агент **обіцяє** їх розуміти (`540-543`), але код таких команд **НЕ перехоплює**. Вони йдуть у звичайний chat-цикл до Claude, і агент має повернути новий `ACTION_JSON` зі змінами `split_points` через `parseActionJSON` (`640-644`).

**Поведінка >20МБ:** **спецлогіки немає**. PDF цілком підвантажується у browser memory і кодується в base64. Anthropic API ліміт ~32МБ — файли близько 20-30МБ можуть впасти.

**`heic2any`** — тільки у CaseDossier (`1196`); у DocumentProcessor немає.

**Релевантні файли:**
- `/workspaces/registry/src/components/DocumentProcessor/index.jsx:1-1203`

---

## 2.9 Вкладка Позиція

**Виявлено:** Заглушка. Рендер `CaseDossier:2269-2275`:
```jsx
{["position", "templates"].includes(activeTab) && (
  <div ...>
    <div>{activeTab === "position" ? "⚖️" : "📄"}</div>
    <div>{activeTab === "position" ? "Позиція" : "Шаблони"}</div>
    <div>{"Буде реалізовано в наступній під-сесії"}</div>
  </div>
)}
```
Жодного компонента, TODO коментарів, state.

---

## 2.10 Вкладка Шаблони

**Виявлено:** Та сама заглушка що й Позиція. Спільний блок (`CaseDossier:2269-2275`).

Зв'язок з Canvas-конструктором: немає в коді. У CLAUDE.md заплановане завдання.

---

## 2.11 Viewer документа

**Виявлено:** Viewer рендериться в `renderMaterials()` (`CaseDossier:2133-2189`).

**Дві гілки виведення:**

1. **Якщо `selectedDoc.driveId`** (`2153-2176`): `<iframe src='https://drive.google.com/file/d/${driveId}/preview'>` з `style={{ width:"100%", flex:1, minHeight:400, border:"none" }}`.
   - Кнопки: `Відкрити в Drive` і `Завантажити` — обидва `<a>` посилання.

2. **Якщо `driveId` немає** (`2177-2186`): тільки заголовок, дата, `selectedDoc.notes`, плейсхолдер.

**Текстова копія для scanned** — **НЕ ЗНАЙДЕНО** в UI. Кеш OCR зберігається на Drive, але viewer його не показує.

**Кнопки `Копіювати, Завантажити, 🤖 Аналіз`** (`CaseDossier:2147-2151`):
```jsx
{["Копіювати", "Завантажити", "🤖 Аналіз"].map(btn => (
  <button key={btn} style={iconBtn}>{btn}</button>
))}
```
**ВСІ ТРИ кнопки — БЕЗ `onClick`.** Мертвий UI. Робочі кнопки (`Відкрити в Drive`/`Завантажити`) живуть **внизу** під iframe (`2163-2174`).

**Виділення тексту, анотації — НЕ ЗНАЙДЕНО.** Iframe Drive preview не передає селекшн назад.

**Релевантні файли:**
- `/workspaces/registry/src/components/CaseDossier/index.jsx:2133-2189`

---

## 2.12 Агент досьє

**Виявлено:** Реалізація — `renderAgentPanel()` (`CaseDossier:1256-1496`) і `buildAgentSystemPrompt()` (`580-634`).

**Модель:** `resolveModel('dossierAgent')` → `'claude-sonnet-4-20250514'` (`modelResolver.js:13`). **Sonnet 4.**

**Виклик API** (`CaseDossier:1310-1323`):
```
POST https://api.anthropic.com/v1/messages
model: dossierModel, max_tokens: 4000, system: systemPrompt,
messages: [...cleanHistory, { role: 'user', content: userMsg }]
```

**Завантаження контексту в системний промпт** (`buildAgentSystemPrompt`, `580-634`):
1. `caseData.name`, `court`, `case_no`, `category`, `status`, `JSON.stringify(proceedings)`, кількість документів — як plaintext (`585-592`).
2. `caseContext` (вміст `case_context.md`) — у блок `## КОНТЕКСТ СПРАВИ` (`594-598`).
3. Блок `## РЕЖИМ ВИКОНАННЯ` (`602-631`) з прикладами `ACTION_JSON`.
4. Останнім — `Hearings: ${JSON.stringify(caseData.hearings)}` і `Deadlines: ${JSON.stringify(caseData.deadlines)}` (`630-631`).

**Зберігання історії — 3-tier cache** (див. 1.2):
- `cases[i].agentHistory` (registry)
- `localStorage.agent_history_<caseId>` (slice-50)
- Drive `<caseFolder>/agent_history.json` (slice-50)

**ACTIONS JSON, не tool use** (`parseAndExecuteDossierAction`, `1257-1284`):
- Шукається `ACTION_JSON:`, потім перший `{`, **depth-counter** до закриваючої `}`.
- `JSON.parse(slice)` → `onExecuteAction('dossier_agent', action, params)`.
- Якщо парс не вдається — `console.warn`. Жодних retry, жодної tool use.

**Обробка `lastProcessingContext`** — **НЕ ЗНАЙДЕНО**. `grep -rn 'lastProcessingContext\|processing_context\|update_processing_context'` повертає 0 результатів. Document Processor і Dossier agent **не передають контекст** один одному.

**Кнопка перемикача моделі — немає.** У шапці агента (`1376-1392`) показується статичний рядок `"Sonnet · знає справу"`.

**"Завантажено N повідомлень"** (`1385-1389`) — це **довжина поточного `agentMessages` state**, тобто включає і щойно надіслані повідомлення сесії.

**Кнопка "+ Нова розмова"** (`1391`): відкриває `confirmClearOpen` модалку, при підтвердженні: `setAgentMessages([])` + `saveAgentHistory([])`.

**Передача в API:** `agentMessages.slice(-10)` (тільки останні 10).

**Релевантні файли:**
- `/workspaces/registry/src/components/CaseDossier/index.jsx:1256-1496, 580-634, 1300-1373`
- `/workspaces/registry/src/services/modelResolver.js:13`

---

## 2.13 Кнопки в шапці справи

**Виявлено:** Шапка `CaseDossier:2208-2238`.

| Кнопка | Рядок | Поведінка |
|--------|-------|-----------|
| `← Реєстр` | 2209 | `onClick={onClose}` |
| Заголовок | 2210-2215 | Не клікабельний |
| Бейдж статусу | 2217 | Не клікабельний |
| `📅 <date> о <time>` | 2218 | Бейдж найближчого scheduled hearing. Не клікабельний |
| `☁️ Drive 🔗` | 2219-2220 | `window.open('https://drive.google.com/drive/folders/${storageState.driveFolderId}', '_blank')`. Тільки якщо є `driveFolderId` |
| `⚠️ Без папки` | 2221-2222 | Інформативний бейдж |
| `📦 Закрити` | 2224-2231 | `systemConfirm` → `onCloseCase(caseData.id)` → `onClose()`. Якщо `status !== 'closed'` |
| `🗑 Видалити назавжди` | 2232-2234 | `onDeleteCase(caseData)` → 2 рівні `systemConfirm` → `deleteCasePermanently`. ТІЛЬКИ для `status === 'closed'` |
| `💡` (лампочка) | 2235 | `setIdeaOpen(true)` — модалка "Ідея для контенту" (`2305-2323`), зберігає через `onSaveIdea({ ..., type:'post' })`. **Не placeholder, реально працює** |
| `🤖 Сховати агента` / `🤖 Агент` | 2236 | Toggle `agentOpen` |

**Кнопка "Призупинити"** — **НЕ ЗНАЙДЕНО**.

**Релевантні файли:**
- `/workspaces/registry/src/components/CaseDossier/index.jsx:2208-2238`
- `/workspaces/registry/src/App.jsx:4460-4541, 4543-4555`

---

## 2.14 Стани справи

**Виявлено:** Поле `status` має 3 значення (`App.jsx:135`):
```js
const STATUS_LABELS = { active:'Активна', paused:'Призупинена', closed:'Закрита' };
```
Кольори: active=`#2ecc71`, paused=`#f39c12`, closed=`#5a6080`.

**Як стає `paused`:**
- В INITIAL_CASES (`App.jsx:126` Сипко).
- Через UI — **немає кнопки**.
- Через агентів — `update_case_field` дозволяє `status` (`App.jsx:4596-4598`). Користувач може писати "постав статус paused" агенту.

**Як стає `closed` (`closeCase`, `App.jsx:4460-4476`):**
- UI кнопка `📦 Закрити` в шапці.
- ACTION `close_case` через агентів.
- Запис у audit log напряму через `writeAudit` (UI обходить executeAction).
- `activityTracker.report('case_closed', ...)`.

**Закрита справа фільтрується з:**
- **Дашборд** (`Dashboard:741`): `cases.filter(c => c.status !== 'closed')`.
- **Календарних подій** дашборду (`Dashboard:1050`): `if (c.status === 'closed') return;`.
- **Реєстру в App** — *не* фільтрується автоматично; є tab-фільтр `Закриті` (`App.jsx:5598`).
- **Notebook** — закриті не виокремлюються.

**Як відкрити закриту назад (`restoreCase`, `App.jsx:4478-4494`):**
- ACTION `restore_case` через агентів.
- Через UI — `CaseModal` має `onRestore` (`App.jsx:5725`).

**`destroy_case` — підтвердження** (`handleDeleteCase`, `App.jsx:4543-4555`):
- **Двоступеневе** `systemConfirm`:
  1. `"Видалити справу '${caseItem.name}'? Справа буде видалена з реєстру."`
  2. `"Буде видалено справу '${caseItem.name}' з реєстру та папку справи на Google Drive з усіма файлами. Це неможливо скасувати. Продовжити?"`

**Видаляється папка на Drive (`deleteCasePermanently`, `App.jsx:4508-4541`):**
- AuditLog ДО видалення зі статусом `pending`.
- `if (caseItem.driveFolderId && driveConnected) await deleteDriveFolder(caseItem.driveFolderId)` (`4524-4525`).
- **АЛЕ:** перевіряється поле `caseItem.driveFolderId` (top-level), а реальна структура зберігає його у `caseItem.storage.driveFolderId`. Тобто для нових справ `else: console.log("driveFolderId not found, skipping Drive deletion")` (`4527`). **Папка на Drive НЕ ВИДАЛЯЄТЬСЯ для нових справ.**
- `setCases(prev => prev.filter(c => c.id !== caseItem.id))` (`4529`).
- Після успіху → `updateAudit(auditEntry.id, 'done')`.

**`destroy_case` — тільки UI**, жоден агент не має дозволу (`App.jsx:5208`).

**Релевантні файли:**
- `/workspaces/registry/src/App.jsx:4460-4555, 5208, 1970-1990`
- `/workspaces/registry/src/components/Dashboard/index.jsx:741, 1050`
- `/workspaces/registry/src/components/CaseDossier/index.jsx:2224-2234`

---

# РОЗДІЛ 3 — СТАН МОДУЛЯ ДАШБОРД

## 3.1 Архітектура Dashboard модуля

**Виявлено:** Dashboard — функціональний компонент (`Dashboard/index.jsx:1010`) з підписом `Dashboard({ cases, calendarEvents, onExecuteAction, setAiUsage })`.

State повністю локальний (UI-only): `curMonth`, `selectedDay`, `calView` ("month"|"week"), `agentInput`, `chatHistory`, `pendingSystemNote`, `agentLoading`, `isListening`, модальні поля, флаги помилок (`Dashboard:1011-1037`).

Billing-сесія: `activityTracker.startSession(null, 'dashboard', { category: 'admin' })` при mount, `endSession({ reason: 'unmount' })` при unmount (`:1039-1042`).

**Activity Feed:** `FeedItem` (`:1149`) і `FeedGroup` (`:1203`). Розбиття на групи (`:1145-1147`):
- group1 (0-1 день, urgent)
- group2 (2-7 днів, warn)
- group3 (8-30 днів, normal)

Дані — `getAllEvents()` (`:1044-1090`): `cases[].hearings` (фільтр `isValidHearing`), `cases[].deadlines`, плюс `calendarEvents`. Фільтр `c.status === 'closed'` приховує закриті, `paused` додає `isPaused: true`.

**Календар** — **власна реалізація всередині Dashboard, не окремий компонент.**
- `buildMonthGrid(year, month)` (`:930-949`)
- `getWeekDays(selectedDay)` (`:951-961`)
- JSX місяця — inline (`:1860-1899`)
- `SlotsColumn` (`:244-611`) — функція в тому ж файлі для тижневих колонок (08:00-19:00, крок 30 хв, висота 28px)

**Релевантні файли:**
- `/workspaces/registry/src/components/Dashboard/index.jsx`
- `/workspaces/registry/src/services/activityTracker.js`

---

## 3.2 Логіка накладок (3 критерії)

**Виявлено:** Ядро — `classifyDayHearings(hearings)` у `Dashboard:690-712`. Повертає `'none' | 'yellow' | 'red'`.

**Критерії в коді:**
- `total === 0` або `total === 1` → `'none'`
- `total >= 3` → `'red'` (3+ засідань на день)
- `withTime.length < 2` → `'yellow'` (два, але час лише в одному)
- Перетин слотів двох: `aStart < bEnd && aEnd > bStart` → `'red'`
- Інакше gap (`aStart >= bEnd ? aStart-bEnd : bStart-aEnd`) ≤ 120 хв → `'red'` (<2 год між засіданнями)
- Решта — `'yellow'`

**Дефолти жорстко прописані в коді, без `tenant.settings`/`user.preferences`:**
- gap-поріг `120` хв (`:709`)
- дефолтна тривалість засідання при відсутності `duration` — `120` хв (`:702-703, 725`)

**`findConflicts(cases)`** (`:714-737`) — обгортка, групує по `byDate`, повертає `[{ date, items, level }]`. У `:717` вилучені паузовані: `if (c.status !== 'active' && c.status) return`.

**Підрахунок при кліку на день:** `checkConflicts(dateStr)` (`:1096-1101`) — фільтрує `!e.isPaused`, передає в `classifyDayHearings`. Підпис рендериться в `subtitle` (`:1247-1249`): `'⚠️ накладка!'` для red, `'⚡ два засідання'` для yellow.

Та сама логіка використовується в JSON-промпті агента (`:763-766`).

**Релевантні файли:**
- `/workspaces/registry/src/components/Dashboard/index.jsx:690-737`

---

## 3.3 Drag слоти і додавання засідань через дашборд

**Виявлено:** Drag-логіка в кастомному hook `useSlotDrag(onSelect)` (`Dashboard:613-678`), що повертає `{ startDrag, updateDrag, handleTouchMove, endDrag, ... }`.

**Поведінка:**
- Mouse: `handleMouseDown` (`:293-317`) чекає 5px вертикального руху перед стартом drag, далі `document.elementFromPoint` ловить slot під курсором через `data-slot-idx`/`data-ctx`.
- Touch: long-press 600 мс (`pressTimerRef`) з прев'ю half-press на 300 мс і `navigator.vibrate(50)` (`:270-291`).
- Cross-day drag заблокований (`:629-630`).

**Після drag — `openModalWithRange(startSlotIdx, endSlotIdx, dateStr)`** (`:1580-1600`):
- `activityTracker.report('event_drag_create', ...)` (`:1583`).
- Відкриває модалку зі стартом/кінцем, `modalType='hearing'` за замовчуванням, без caseId.

**`saveEvent()`** (`:1672-1795`):
- Для `modalType === 'hearing'` — `add_hearing` або `update_hearing` (якщо `editingEvent?.hearingId`).
- Параметри: `caseId`, `date`, `time`, `duration`. Якщо `modalShowTravel` — додає дві нотатки категорії `travel` (а не нативні `add_travel`-сутності).
- Для `modalType === 'note'` — `add_note`/`update_note` з полями `text`, `date`, `time`, `duration`, `caseId`, `category: 'general'`.

**Виявлено:** `addCalendarEvent`/`updateCalendarEvent` (App.jsx:4330+) **не використовуються** Dashboard для drag-створення — все через `executeAction` ACTIONS.

**Релевантні файли:**
- `/workspaces/registry/src/components/Dashboard/index.jsx:613-678, 270-317, 1580-1600, 1672-1795`

---

## 3.4 Агент дашборду

**Виявлено:**

**Точна модель.** `resolveModel('dashboardAgent')` (`Dashboard:1489`) → `'claude-sonnet-4-20250514'` (`modelResolver.js:17`). **Sonnet, не Haiku.** Виклик:
```
src/components/Dashboard/index.jsx:1490-1504
  POST https://api.anthropic.com/v1/messages
  model: dashboardModel, max_tokens: 500,
  system: systemPrompt, messages: safeHistory
```

**Системний промпт.** Будується `buildDashboardContext(cases, calendarEvents, selectedDay)` (`:739-912`). **Не імпортує `SONNET_CHAT_PROMPT` з App.jsx — окремий, інлайн-зашитий у Dashboard промпт.** Структура:
- Header (`:768-770`) — `"Ти — календарний асистент АБ Левицького. Сьогодні: ${today}..."`.
- "ОНТОЛОГІЯ" (`:773-777`).
- "ЗАГАЛЬНИЙ ПРИНЦИП" (`:779-785`).
- "ЗАБОРОНЕНО" (`:787-793`).
- "ФОРМАТ ACTION_JSON" (`:797-841`): navigate_calendar, navigate_week, update_hearing, add_hearing, delete_hearing, add_note, update_note, delete_note.
- "ПРАВИЛА ДЛЯ НОТАТОК" (`:843-863`).
- "ПРАВИЛО УТОЧНЕНЬ ДЛЯ ЗАСІДАНЬ" (`:865-886`).
- Шар 1 даних (`:900-908`).

**Парсинг ACTION_JSON** — `parseAllActionJSON` (`:1388-1413`), **правильний depth-counter**.

**PERMISSIONS dashboard_agent** (`App.jsx:5185-5190`):
```
add_hearing, update_hearing, delete_hearing,
add_note, update_note, delete_note,
confirm_event, add_travel,
batch_update
```
**Без `update_case_field`, `add_deadline`, `pin_note`, time-entry actions.**

**Реалізація команд** — `handleDashboardAction(action)` (`:1251-1386`):
- `update_hearing`, `add_hearing`, `delete_hearing` — ✅
- `add_note`, `update_note`, `delete_note` — ✅
- `navigate_calendar` — ✅ підтримує `{year, month}` (1-12 → -1) і `direction: prev|next`.
- `navigate_week` — ✅ підтримує `{date: "YYYY-MM-DD"}` і `direction`.
- Невідома дія → `fail`.

**Голосовий ввід (Web Speech API)** (`:1557-1578`):
- `window.SpeechRecognition || window.webkitSpeechRecognition`
- `lang='uk-UA'`, `continuous=false`, `interimResults=false`
- У `onresult` встановлює `agentInput`, відразу викликає `handleAgentSend(text)` (single-shot dictation).

**"Failed to fetch":** `fetch` без try/catch для мережевих помилок впаде в catch (`:1543-1545`) → `"❌ Помилка: " + e.message`. Також `:1506-1511`: `"❌ API помилка ${status}"`.

**API ключ** — читається безпосередньо: `localStorage.getItem("claude_api_key")` (`:1475`). Якщо порожній — `"⚙️ Налаштуйте API ключ в Quick Input"` (`:1477`).

**Релевантні файли:**
- `/workspaces/registry/src/components/Dashboard/index.jsx:739-912, 1251-1386, 1388-1413, 1453-1548, 1557-1578`
- `/workspaces/registry/src/App.jsx:5185-5190`
- `/workspaces/registry/src/services/modelResolver.js:17`

---

## 3.5 Помилки агента дашборду

**Виявлено:**

**Фікс "видалив дві нотатки замість однієї".** Прямого слова про два видалення в коді не знайдено, але є архітектурні маркери виправлення:
- Системний промпт (`:837-841`) явно інструктує: для групових операцій давати **окремий ACTION_JSON блок на кожну нотатку** (приклад `delete_note × 2`).
- Парсер `parseAllActionJSON` (`:1388-1413`) коректно витягує всі блоки.
- Виконавець `delete_note` (`App.jsx:4797-4814`) фільтрує строго `n.id !== noteId` — за `noteId` видаляється тільки одна нотатка.

Окремих guard-rails (типу dedupe `noteId`) у `handleAgentResponse` (`:1415-1451`) **немає** — кожен ACTION_JSON виконується послідовно.

**API ключ** — як описано в 3.4: пряме читання з localStorage. AnalysisPanel зберігає (`App.jsx:3167`).

**Релевантні файли:**
- `/workspaces/registry/src/components/Dashboard/index.jsx:1415-1451`
- `/workspaces/registry/src/App.jsx:4797-4814, 3164-3169`

---

# РОЗДІЛ 4 — СТАН ІНШИХ ВКЛАДОК

## 4.1 Записна книжка

**Виявлено:** `Notebook/index.jsx:59-96` — **повністю реалізований** функціональний компонент з двома внутрішніми вкладками.

`innerTab: 'notes' | 'records'`:

**NotesTab** (`:99-300`) — повністю функціональний:
- Джерело: `getAllNotes(cases, notesProp)` об'єднує bucket `notesProp` (`{cases, general, content, system, records}`) і `cases[i].notes[]`, дедуплікує за `id`.
- Sidebar: пошук, категорії з `CAT_META` (`general/case/content/system`), динамічна секція "По справах" з лічильниками.
- `<NoteCard>` з кнопками edit (✏️), delete (✕), pin 📌 (тільки для `n.caseId`).
- Модалка `<AddNoteModal>` (`:446-561`).
- Billing: `note_created`, `note_edited`.

**RecordsTab** (`:579-800`) — повністю функціональний (вільні «нотатки-записи»):
- localStorage-only: `RECORDS_KEY = 'levytskyi_free_notes'`. **Не йде в registry, не синхронізується на Drive.**
- CRUD: `createRecord`, `persist` (auto-save on blur), `deleteActive`.
- **Голосовий ввід є**: `startDictation` (`:631-661`) через `window.SpeechRecognition || window.webkitSpeechRecognition`, `lang='uk-UA'`. Кнопка `:737-748`.
- Кнопка "📋 В Quick Input →" (`:780-793`) — копіює text у `navigator.clipboard.writeText`.

**Виявлено:**
- Пошук є тільки у NotesTab; у RecordsTab пошуку немає.
- Мікрофон є тільки в RecordsTab; у NotesTab діктовки немає.
- Notes bucket згідно CLAUDE.md має 5 ключів, але `LS_KEYS` (`:24-28`) лише три (`general/system/content`) і використовується як fallback.
- pin-кнопка з'являється лише якщо є `onPin` і `note.caseId`.

**Релевантні файли:**
- `/workspaces/registry/src/components/Notebook/index.jsx`
- `/workspaces/registry/src/App.jsx:4433-4434, 5628-5634`

---

## 4.2 Нова справа

**Виявлено:** Вкладка `'add'` (`App.jsx:5551`). При кліку рендериться `<AddCaseForm>`. **Це не модалка, а повна форма-панель** в основному контенті.

**Структура форми:**
- AI-чат (заглушка) (`:2702-2711`): локальний state `msgs`, евристичний відповідач `sendAi` з matches на `'клієнт'/'ситуац'/'документ'`. **Не звертається до Anthropic API.**
- Upload-zone (`:2714-2722`): дві кнопки ("📎 Завантажити файл", "☁️ Google Drive"). **Без onClick** — кнопки візуальні.
- Поля форми: name, client, category (civil/criminal/military/admin), status (active/paused/closed), court, case_no, hearing_date, hearing_time, deadline, deadline_type, next_action.

**Збереження (`addCase`):**
- `usageLog.log('case_added')`.
- `ensureCaseSaasFields({ ...form, id: \`case_${Date.now()}\` })`.
- `setCases(prev => [...prev, newCase])`.
- `writeAudit({ action: 'create_case', source: 'ui_form' })`.
- `activityTracker.report('case_created', ...)`.

**Папкова структура на Drive — НЕ створюється автоматично:**
- `App.jsx:4296-4312` (addCase) не викликає ані `createCaseStructure`, ані `findOrCreateFolder`.
- Сервіс `createCaseStructure` існує, але викликається тільки з кнопки "Створити структуру" в досьє.
- `App.jsx:1584` і `:1923` ініціалізують `storage: { driveFolderId: null, ... }`.

**Релевантні файли:**
- `/workspaces/registry/src/App.jsx:2696-2900, 4296-4312`
- `/workspaces/registry/src/services/driveService.js:11-82`

---

## 4.3 Аналіз системи

**Виявлено:** Вкладка `'analysis'` (`App.jsx:5552, 5635`) → `<AnalysisPanel>`. Заголовок `🔍 Аналіз системи`.

**Вміст** (`AnalysisPanel`, `App.jsx:3103+`):
- Чат-блок з трьома хардкод-інсайтами `WEEKLY_INSIGHTS` — ілюстративні підказки.
- `useState msgs` — локальний state чату; `send()` (`:3138-3149`) — евристична відповідь з `RESPONSES` (4 шаблонні відповіді на ключові слова). **Реального LLM-чата немає.** Ідея зберігається в `usageLog.saveIdea(input)`.
- API налаштування (`:3221-3242`): input `password` для Claude API ключа. `saveApiKey()` пише в `localStorage.setItem('claude_api_key', val)`. **Єдине місце збереження API-ключа.**
- Резервне копіювання (`:3245-3250`): `exportData` — JSON dump cases, `importData` — приймає `.json`.
- Google Drive (`:3252-3273`): `connectDrive()` через `driveService.authorize()`, далі `driveService.readCases(token)` і опційне зливання cases. `disconnectDrive()` — `driveService.clearToken()`. Індикатор `driveSyncStatus`.
- Статистика (`:3275+`).

**Чи це адмін-функція з повноваженнями?**
- Жодних викликів `checkRolePermission`/`canViewSettings` на рендер.
- Кнопка nav доступна всім.
- Імпорт `setCases(normalizeCases(driveCases))` (`:3205`) дає прямий контроль над усіма даними реєстру **без проходження через `executeAction`** — обхід архітектурного правила.

**Призначення:** налаштування (API-ключ, Drive), резервне копіювання, статистика, "канал" для збору пропозицій. Це settings-вкладка під назвою "Аналіз системи".

**Релевантні файли:**
- `/workspaces/registry/src/App.jsx:3102-3475, 5552, 5635`

---

# РОЗДІЛ 5 — STORAGE І DRIVE INTEGRATION

## 5.1 Drive OAuth і токени

**Виявлено:**

- **Сховище access token**: `localStorage[levytskyi_drive_token]` (`driveAuth.js:11`). Дублювання — `App.jsx:2884-2892` (паралельний `driveService.{isConnected,getToken,...}` теж читає/пише `localStorage`).
- **Refresh token flow**:
  - Окремий ключ `'google_refresh_token'` (`driveAuth.js:12`), але коментар (`:24-26`) явно каже: «браузерний OAuth не видає refresh_token».
  - `refreshTokenGrant()` (`:56-76`) — повний код для класичного `grant_type=refresh_token` як заглушка для майбутнього auth-code flow.
  - `silentGisRefresh()` (`:27-50`) — реально працює: `google.accounts.oauth2.initTokenClient` з `prompt: ''` дає новий access_token без UI.
  - `refreshDriveToken()` (`:78-95`) — дедуплікація через `refreshInFlight` Promise.
- **Обробка 401**:
  - **Автоматично, на рівні fetch-wrapper**: `driveRequest` (`:130-148`) ловить 401, викликає `refreshDriveToken`, повторює запит один раз.
  - **На рівні UI**: `App.jsx:3878-3881` ставить `driveStatus='auth_error'` і `'Сесія Google Drive завершилась. Перепідключіть Drive.'`
  - **Splash-екран**: `App.jsx:5430-5439` — кнопка `'🔄 Перепідключити'` → `splashReconnect()` → `driveService.clearToken()` + `forceConsentRefresh()` (з `prompt: 'consent'`).
  - `forceConsentRefresh()` також застосовується якщо ВСІ файли OCR упали з кодом AUTH (`CaseDossier:797-810`).
- **Scope**: `'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/cloud-platform'` (cloud-platform для Document AI).
- **Client ID хардкодний** (`driveAuth.js:8-9`).

**Релевантні файли:**
- `/workspaces/registry/src/services/driveAuth.js:1-148`
- `/workspaces/registry/src/App.jsx:2884-2923, 3859-3929, 5310-5400, 5430-5439`

---

## 5.2 Структура коренева папка системи

**Виявлено:**

- Системний коренем — **корінь My Drive** користувача без обгортки в одну головну папку.
- **Папки верхнього рівня (My Drive root)** з'являються з коду `createCaseStructure`:
  - `01_АКТИВНІ_СПРАВИ` (`driveService.js:66`)
  - `00_INBOX` (`:69`)
  - `_backups` (`driveService.js:142, 161, 181, 199, 218, 238`, `App.jsx:2939-2946`)
  - `registry_data.json` (`App.jsx:2872`)
- **Хардкод**: усі імена жорстко закодовані. **Жодної змінної ROOT_FOLDER чи user-config не виявлено.**
- TASK Storage Migration (зміна директорії на Drive) перерахований у CLAUDE.md як майбутній.

**Релевантні файли:**
- `/workspaces/registry/src/services/driveService.js:11-82`
- `/workspaces/registry/src/App.jsx:2872, 2937-2962`

---

## 5.3 Дзеркальні папки 01_ОРИГІНАЛИ і 02_ОБРОБЛЕНІ

**Виявлено:**

Дзеркальна логіка по парам `01 ↔ 02` **не реалізована** — це функціональний поділ:
- `01_ОРИГІНАЛИ` — оригінальні файли (PDF, JPG…), завантажуються через `uploadFileLocal` (`CaseDossier:1167-1169`).
- `02_ОБРОБЛЕНІ` — `.txt`-кеш OCR на ім'я `<basename>_<fileId>.txt` (`ocrService.js:34-43, 79-109`).

При генерації контексту збираються файли з **обох** папок паралельно (`CaseDossier:761-772`), виключаючи `agent_history.json`, `case_context.md`, `.txt` (тобто кеш) (`:754-758`).

**Sync-логіки "якщо в 01 є а в 02 нема — створити" немає.** Потік: `extractText` спершу перевіряє кеш у 02, якщо ні — викликає провайдер, і кеш записується в 02 у результаті виклику.

**Інвалідації кешу** за hash чи modifiedTime **немає** — `cacheFileName` базується тільки на `<sanitized name>_<fileId>.txt`. Якщо файл у 01 переписали з тим самим Drive id — кеш не оновиться. Якщо ім'я змінили — новий кеш створиться, старий лишиться.

`ensureSubFolders` (`CaseDossier:656-691`) тільки знаходить існуючі підпапки за NFC-нормалізованим ім'ям, без створення відсутніх.

**Релевантні файли:**
- `/workspaces/registry/src/services/ocrService.js:32-109, 156-225`
- `/workspaces/registry/src/components/CaseDossier/index.jsx:656-772, 1150-1175`

---

## 5.4 Назви файлів і кодування

**Виявлено:**

- **UTF-8 для української мови:** всі fetch до Drive API серіалізують через `JSON.stringify` (`driveService.js:58, 93`). Запити з кирилицею в `q=` — через `encodeURIComponent`.
- **CLAUDE.md правило №8** (заборона кирилиці в `q=`) **порушується** в кількох місцях:
  - `driveService.js:37-38` — `findOrCreateFolder` з кирилицею в `name='${name}'` (викликається з `01_АКТИВНІ_СПРАВИ`, `00_INBOX`, `_backups`).
  - `ocrService.js:46` — `name='${name.replace(/'/g, "\\'")}` для пошуку кешу.
  - В обхід — `ensureSubFolders` (`CaseDossier:665-672`) використовує правильний патерн (всі підпапки без фільтра + JS-пошук з NFC).
- **HTML файли з ЄСІТС (Windows-1251):** повноцінна обробка реалізована в `pdfjsLocal.js:77-121`:
  - `:85-86` — читання перших 4096 байт через `TextDecoder('latin1')` для пошуку `<meta charset>`.
  - `:88-100` — парс `csMatch[1]`, нормалізація `cp1251`/`win-1251` → `windows-1251`.
  - `:93-100` — fallback-евристика: якщо нема charset, пробуємо UTF-8; якщо replacement chars (U+FFFD) > 1% — переключаємось на windows-1251.
  - `:111-114` — DOMParser, видалення `script,style`, `innerText`.
- **Plain text файли** (`.txt`, `.md`) — `pdfjsLocal.js:67-71` — тільки UTF-8 (без авто-детекції). Якщо .txt у windows-1251 — кирилиця буде поламана.

**Релевантні файли:**
- `/workspaces/registry/src/services/ocr/pdfjsLocal.js:67-121`
- `/workspaces/registry/src/services/driveService.js:37-43, 109-112`
- `/workspaces/registry/src/components/CaseDossier/index.jsx:665-676, 712-715`

---

# РОЗДІЛ 6 — DOCUMENT AI ІНТЕГРАЦІЯ

## 6.1 Поточна реалізація Document AI

**Виявлено:**

- **Файл**: `src/services/ocr/documentAi.js` (180 рядків).
- **Endpoint** (`:13-14`):
  ```
  https://europe-west2-documentai.googleapis.com/v1/projects/73468500916/locations/europe-west2/processors/2cc453e438078154:process
  ```
  - Регіон: `europe-west2` ✅
  - Project ID: `73468500916` (numeric)
  - Processor ID: `2cc453e438078154` ✅
- **Credentials**: bearer-токен користувача через `driveRequest` (`:48-52`). Scope `cloud-platform` (`driveAuth.js:10`).
- **Ліміти** (`:15-17`):
  - `DOC_AI_PAGES_PER_REQUEST = 15`
  - `DOC_AI_MB_PER_REQUEST = 20`
  - `DOC_AI_TIMEOUT_MS = 120_000`
- **Виклик** (`postToDocAi`, `:35-87`):
  - base64 + `rawDocument:{content,mimeType}` payload.
  - `arrayBufferToBase64` (`:25-33`) обходить обмеження стека через 32 КБ чанки.
  - Коди помилок: `401/403`→`AUTH`, `429`→`QUOTA`, `400`→`UNSUPPORTED`, `!ok`→`UNKNOWN`.
- **Парсинг** (`:83-86`): `data?.document?.text || ''`, `data?.document?.pages?.length || 0`.
- **`extract()` повний потік** (`:100-179`):
  1. Завантажити байти з Drive через `?alt=media`.
  2. Перевірка ZIP-сигнатури (`PK\x03\x04`) → `UNSUPPORTED 'ZIP замаскований під PDF (ЄСІТС)'`.
  3. Розмір > 20 МБ → `UNSUPPORTED`.
  4. Image — один запит.
  5. PDF — `PDFDocument.load`, `getPageCount()`.
  6. ≤ 15 сторінок — один запит.
  7. > 15 — нарізка по 15 сторінок (`copyPages`), перевірка розміру кожного чанка, об'єднання `--- Page break ---`.

**Релевантні файли:**
- `/workspaces/registry/src/services/ocr/documentAi.js`

---

## 6.2 ocrService.js Provider Pattern

**Виявлено:**

- **Реалізовано через provider registry, не if-else** (`ocrService.js:13-23`): `Map`-реєстр + `registerProvider`. Провайдери: `documentAi`, `claudeVision`, `pdfjsLocal`. Кожен — default-export з `{ name, canHandle(file), extract(file, options) }`.
- **Вибір провайдера** (`pickProviderName`, `:113-131`):
  - `application/pdf` → **`pdfjsLocal`** (текстовий шар першим).
  - `image/*` → `documentAi`.
  - `application/vnd.google-apps.document`, `text/plain`, `text/markdown`, `text/html`, або `.txt/.md/.html/.htm` → `pdfjsLocal`.
- **Fallback chain** (`:134-149`): для PDF: `pdfjsLocal → documentAi → claudeVision`. Для image: `documentAi → claudeVision`.
- **Forced provider**: `localStorage.getItem('ocr_force_provider')` або `options.forceProvider` (`:27-30, 173-179`).
- **Виконання** (`:191-215`): цикл по chain з `try/catch`. На AUTH/QUOTA — break.
- **Контракт виходу** (`:202-209`): `{ text, pages, provider, fromCache, durationMs, warnings }`.
- **`extractTextBatch`** (`:229-274`) — concurrency-pool (default 3), AbortSignal, onProgress callback.
- **Локалізація помилок** (`:278-288`): `ERROR_MESSAGES` для AUTH/QUOTA/TIMEOUT/UNSUPPORTED/UNKNOWN.

**Релевантні файли:**
- `/workspaces/registry/src/services/ocrService.js`

---

## 6.3 Кешування OCR

**Виявлено:**

- **Розташування**: `02_ОБРОБЛЕНІ/<sanitizedBasename>_<driveFileId>.txt` (`ocrService.js:34-43`).
- **Перевірка перед OCR** (`:79-91, 158-170`):
  - Дивиться `file.subFolders?.['02_ОБРОБЛЕНІ']` — якщо немає, пропускає.
  - `listFolderFilesByName` шукає файл за точним ім'ям.
  - Якщо є — `readDriveFileText`, провайдер `'cache'`, `fromCache: true`.
- **Запис кешу** (`:93-109, 198-201`):
  - Перед записом DELETE усіх існуючих файлів з тим самим ім'ям.
  - Upload через multipart.
  - Помилки запису не падають назовні — `console.warn` (`// не падати — кеш не критичний`).
- **Інвалідація**:
  - **Hash файла НЕ перевіряється.**
  - **modifiedTime НЕ перевіряється.**
  - Кеш-ключ — `name` + `driveFileId`. Зміна вмісту з тим самим id — кеш не оновиться.
  - `options.skipCache === true` пропускає (`:158, 199`).
- **`handleCreateContext` потік** (`CaseDossier:777-794`):
  - Збирає файли з 01+02 (виключаючи технічні).
  - `extractTextBatch` з concurrency=3.
  - **Не OCR-ить заново** якщо є кеш — `extractText` сам повертає з кешу.
  - Лічильник `cacheHits` звітується в UI.

**Релевантні файли:**
- `/workspaces/registry/src/services/ocrService.js:32-109, 156-225`
- `/workspaces/registry/src/components/CaseDossier/index.jsx:777-829`

---

## 6.4 PDF chunking для великих файлів

**Виявлено:**

- `pdf-lib` встановлений: `package.json:"pdf-lib": "^1.17.1"`.
- **Логіка нарізки PDF на чанки <20 МБ** реалізована в `documentAi.js:151-175`:
  - Чанк = 15 сторінок.
  - Цикл `for (let start = 0; start < pageCount; start += 15)` — `PDFDocument.create()`, `copyPages` за індексами, `save` в Uint8Array.
  - Перевірка `chunkBytes.byteLength > 20 МБ` → `UNSUPPORTED 'Чанк сторінок ${start+1}-${end} більший за ${20} МБ'`.
  - Об'єднання через `\n\n--- Page break ---\n\n`.
- **DocumentProcessor** має власну окрему нарізку для split: `splitPDFByDocuments` (`DocumentProcessor:107-140`) — це доменна нарізка за результатом аналізу AI, не chunking.
- **TODO/FIXME для chunking** не виявлено в коді.
- **claudeVision НЕ ріже PDF на чанки** — рендерить ВСІ сторінки в PNG і відправляє разом з warning при > 20 сторінок (`claudeVision.js:69-95`).

**Релевантні файли:**
- `/workspaces/registry/src/services/ocr/documentAi.js:138-179`
- `/workspaces/registry/src/services/ocr/claudeVision.js:65-95`
- `/workspaces/registry/src/components/DocumentProcessor/index.jsx:107-140`

---

## 6.5 Помилка на 6+ великих файлах ("темний екран")

**Виявлено:**

Прямого відтворення симптому "темний екран" в коді **немає** — це зовнішній симптом з декількох потенційних причин.

**`handleCreateContext` обгорнутий у try/catch** (`CaseDossier:693-958`):
- Зовнішній `try { ... } catch (err) { console.error(...); setContextMsg(`Помилка: ${err.message}`); } finally { setContextLoading(false); setIsCreatingContext(false); }`. Помилка теоретично не повинна викликати blank — повинна показатися в `contextMsg`.

**Потенційні точки збою при 6+ великих файлах:**
1. **Concurrency=3 з великими base64**: `extractTextBatch` запускає до 3 паралельних `extractText`. Кожен PDF: arrayBuffer + base64 (~33% більше). 3 файла × 20 МБ × 1.33 = ~80 МБ JS strings одночасно — ризик OOM на mobile.
2. **Великий PDF без нарізки в extractText fallback**: якщо PDF не пройшов pdfjsLocal (немає текстового шару) і пішов на documentAi — documentAi NOT робить нарізку якщо `arrayBuffer.byteLength > 20МБ` (`:123-126`) — throw `UNSUPPORTED`. Файл пропадає з помилкою, але UI не падає.
3. **Завелике тіло запиту до Anthropic**: 6+ великих файлів = запит у сотні KB. `if (!apiRes.ok) throw` — спіймається.
4. **`canvas.toDataURL` в claudeVision**: 50+ сторінок × 2 МБ canvas — серйозне навантаження. Без проміжного звільнення canvas.

**Що зміг побачити user як "темний екран":**
- `setContextLoading(true)` ставить UI у loading-стан. Якщо JavaScript thread заблокований — UI не оновлюється.
- Якщо OOM — браузер може зависати без перехоплення в catch.

**Логування в консолі**: `console.log('[CaseDossier] OCR джерело: ...')` (`:774`), per-file логи `✅` / `❌`. Добре діагностується через DevTools.

**Відсутність захисту**: жодного `signal`/AbortController на батч-рівні в `handleCreateContext`. Користувач не може скасувати процес.

**Релевантні файли:**
- `/workspaces/registry/src/components/CaseDossier/index.jsx:693-957`
- `/workspaces/registry/src/services/ocrService.js:229-274`
- `/workspaces/registry/src/services/ocr/documentAi.js:100-179`
- `/workspaces/registry/src/services/ocr/claudeVision.js:46-172`

---

# РОЗДІЛ 7 — ІНТЕРФЕЙС ДОСЬЄ

## 7.1 Загальний layout

**Виявлено:** `CaseDossier/index.jsx:2204-2487` — кореневий return. Каркас:
```
<div pos:absolute top/left/right/bottom display:flex column>
  ШАПКА (10×16 px, borderBottom #2e3148)
  ВКЛАДКИ (padding 0×16 gap 2)
  BODY (flex:1 row, minHeight:0)
    ├ Контент вкладки (flex:1 column, overflowY:auto)
    ├ Resizer (8 px col-resize)
    └ Панель агента (width: agentWidth)
  МОДАЛКИ (overlay)
</div>
```

**Адаптивність.** Жодного `@media` у CaseDossier. Глобальні media в `App.css`: `@media (max-width: 900px/600px/500px)`. У досьє media немає взагалі.

**Yoga Tab 13 згадки.** `grep` дав лише детект Android/iPhone/iPad у `driveService.js:122`. Жодних спеціальних умов для Yoga Tab 13.

**Виявлено:**
- Шрифт-стек хардкод: `fontFamily: "'Segoe UI',sans-serif"` (`CaseDossier:2205`) — розрив з глобальним `Manrope` (`App.css:23`).
- Ширина агентської панелі: `Math.min(500, Math.max(280, Math.round(window.innerWidth * 0.35)))` (`:962`).

---

## 7.2 Шапка справи

**Виявлено:** `CaseDossier:2207-2238`. Усі стилі inline.

| Елемент | Рядок | Стиль |
|---------|-------|-------|
| `← Реєстр` | 2209 | `background:#222536, border:1px solid #2e3148, padding:5×12, borderRadius:6, fontSize:12` |
| Назва + метадані | 2211-2214 | `fontSize:15, fontWeight:700, ellipsis`; під нею `fontSize:11, color:#5a6080` |
| Бейдж статусу | 2217 | `background: ${statusColor}22, padding:3×9, borderRadius:4` |
| Дата 📅 | 2218 | IIFE: найближче scheduled hearing. Помаранчевий бейдж |
| Drive 🔗 | 2220 | `window.open(...)` |
| ⚠️ Без папки | 2222 | Інформативний |
| 📦 Закрити | 2224-2231 | `systemConfirm` flow |
| 🗑 Видалити | 2232-2234 | Тільки для closed |
| 💡 | 2235 | `setIdeaOpen(true)` |
| 🤖 Сховати агента / Агент | 2236 | `toggle agentOpen` |

**Виявлено:** усі іконки — emoji (📅, 📦, 🗑, 💡, 🤖, ☁️, ⚠️). Жодних SVG. Підсвітка через CSS `color` ненадійна.

---

## 7.3 Бічна панель агента

**Виявлено:** `renderAgentPanel()` — `CaseDossier:1256-1496`.

- **Ширина** — `agentWidth` (state, init `min(500, max(280, innerWidth*0.35))`). Resizer (`2280-2289`); межі 280-500 px.
- **Заголовок** (`1377-1392`):
  - `🤖 Агент досьє`
  - `Sonnet · знає справу` + 📄 якщо `caseContext` є
  - `📂 Завантажено N повідомлень з попередньої розмови` коли `agentMessages.length > 0`, інакше `🆕 Нова розмова`
- **+ Нова розмова** (`1391`) → `setConfirmClearOpen(true)` → підтвердження → `setAgentMessages([]); saveAgentHistory([])` (пише порожній файл на Drive).
- **Поле введення** (`1425-1456`): `<textarea rows={2}>` з `Enter` → `sendAgentMessage`, `Shift+Enter` → новий рядок. 🎤 Мікрофон + → Send.

- **Рендер повідомлень** (`1393-1424`): простий `<div whiteSpace:pre-wrap word-break:break-word>` з `msg.content`. **Markdown НЕ рендериться. Code blocks не підсвічуються.**

**Виявлено:**
- Жодних markdown/highlight бібліотек у `package.json` (нет `react-markdown`, `prism`, `highlight.js`).
- Slice `-50` при кожному повідомленні.
- API-history slice `-10` для економії токенів.

---

## 7.4 Панель табів модуля

**Виявлено:** `CaseDossier:2240-2248`. Дефініція `2196-2202`:
```js
const tabs = [
  { id: "overview", label: "📋 Огляд" },
  { id: "materials", label: "📁 Матеріали", badge: documents.length },
  { id: "docprocessor", label: "🔧 Робота з документами" },
  { id: "position", label: "⚖️ Позиція" },
  { id: "templates", label: "📄 Шаблони" }
];
```

**Бейджик біля Матеріали (3)** — `tab.badge > 0` — це `documents.length`.

**Анімація** — `transition: "all .15s"` на `border-bottom`, `color`, `font-weight`.

**Стан при переключенні.** `activeTab` — `useState("overview")`. Контент Overview/Materials живе у функціях рендеру — компонент той самий, стан зберігається. **DocumentProcessor як піддерево unmount/remount при відключенні** — будь-який внутрішній state DocumentProcessor скидається на повернення з іншого табу. **Position і Templates показують placeholder.**

Side-effect tab_switched: `useEffect` (`445-448`) пише `dossier_tab_switched`. `useEffect` (`1071-1074`): `setAgentOpen(activeTab === 'overview')` — агент сам відкривається тільки на Огляді й закривається на інших.

---

## 7.5 Огляд — детальний layout

**Виявлено:** `renderOverview()` — `CaseDossier:1499-1964`. Контейнер `flex:1 overflowY:auto padding:20`. Послідовність секцій (див. розділ 2.6).

**Виявлено:** піктограма pin кнопки (`1859-1871`): `transform: rotate(-45deg)` коли pinned, `color:'#e53935'` для pinned. Рендериться `📌` emoji — підтверджує баг 8.1.5 (emoji не реагує на `color`; стиль працює лише за рахунок `opacity` і `transform`).

---

## 7.6 Матеріали — детальний layout

**Виявлено:** Структура — див. 2.7.

- **Ліва панель** — ширина `matWidth` (init 280, межі 200-400). Header-рядки: перемикач Дерево/Реєстр, кнопка `+ Додати документ`.
- **Дерево** (`1990-2016`) — список `proceedings` з вкладеними документами. Indent `12px`. `borderLeft:3px solid PROC_COLORS[type]`. Бейдж "ключовий" якщо `tags.includes("key")`.
- **Реєстр з фільтрами** (`2018-2078`) — три ряди фільтрів **в одному стовпці**:
  1. Провадження: `Всі`, `Перша`, `Апеляція`, `Касація`.
  2. Тип: `Всі типи`, `Заява по суті`, `Клопотання`, `Судовий акт`, `Докази`, `Листування`.
  3. Автор: `Всі`, `Наш`, `Опонент`, `Суд`.
  Усі фільтри `flexWrap:wrap`.
  Картка документа: emoji icon, назва, `дата · [П/А/К]`, теги, лівий бордюр кольоровий за provadженням.
- **Resizer** (`2082-2131`) — 8 px col-resize, межі 200-400 px, max 50% контейнера.
- **Viewer (права панель)** (`2134-2189`) — Inline (не модалка).

---

## 7.7 Document Processor — детальний layout

**Виявлено:** `DocumentProcessor:1034-1202`. **3 зони + одна службова.**

- **Зона 0 — Індикатор платформи** (`1037-1050`): `Збереження:` + `☁️ Google Drive` зеленим / `💾 ${dirHandle.name}` / `⚠️ Підключіть Google Drive в налаштуваннях`.
- **Зона 1 — Drop zone** (`1052-1085`): dashed border. Підпис `"Перетягніть файли або натисніть"`, hint `"PDF, JPEG, PNG, HEIC, DOCX, XLSX, PPTX, ZIP, MD, TXT"`.
- **Зона 2 — Черга файлів** (`1087-1107`): тільки якщо `files.length > 0`, `maxHeight:160 overflowY:auto`. Format icon + name + size + status badge (`Очікує/Обробляється/Готово/Помилка`) + `×`.
- **Зона 3 — Чат з агентом** (`1109-1200`): `flex:1`. `whiteSpace:pre-wrap` — markdown знову не рендериться.
  - **Кнопки керування** (`1148-1164`): зʼявляються коли `proposedStructure` є.
    - `✂️ Підтвердити нарізку` АБО `✓ Підтвердити структуру`
    - `✎ Редагувати` → шле в чат `Запропонуй іншу структуру`
    - `✕ Скасувати`
  - **Поле "Команда агенту..."** (`1166-1199`): Інпут (не textarea), `Enter` → send.

---

## 7.8 Viewer документа — поточний стан

**Виявлено:** Inline, у правій панелі вкладки Матеріали (не модалка).

- Контейнер: `flex:1 minWidth:0` (`CaseDossier:2134`).
- Картка: `maxWidth:680, margin:0 auto, padding:24` (`2155, 2179`).
- iframe: `width:100%, flex:1, minHeight:400, border:none` (`2159`).

**PDF rendering** — через **Google Drive iframe preview**: `https://drive.google.com/file/d/${driveId}/preview`. На планшеті залежить від Drive viewer (потребує авторизації Google в Drive Viewer); рідний `pdfjs-dist` для перегляду в досьє не використовується.

**Кнопки Копіювати/Завантажити/🤖 Аналіз у хедері (`2147-2151`) — без `onClick`, мертві.** Робочі кнопки `Відкрити в Drive` / `Завантажити` живуть **внизу** (`2163-2174`).

---

## 7.9 Модалки

**Виявлено:**

- **+ Новий документ** (`CaseDossier:2391-2485`):
  - `Назва *` (autoFocus)
  - `Дата` як вільний текст ("напр. березень 2023") — **немає валідації формату**
  - `Провадження` — select з `proceedings`
  - `Тип` — select: court_act/pleading/motion/evidence/correspondence/other
  - `Від кого` — select: court/ours/opponent
  - Чекбокс `Позначити як ключовий`
  - `Файл (необов'язково)`
  - Валідація: лише `if (!newDoc.name.trim()) return;`. id = `Date.now()` (number) — баг з mixed types.

- **+ Нове провадження** (`2352-2389`): 3 поля (Тип-select, Назва, Суд). Валідація: `if (!newProc.title.trim()) return;`. id = `proc_${Date.now()}` (string).

- **Контекст справи вже існує** — НЕ окрема React-модалка, а виклик `systemConfirm` (`693:725-733`).

- **Ідея для контенту 💡** (`2304-2323`) — окрема inline-модалка.

- **Підтвердження "Очистити історію агента"** (`1457-1493`) — НЕ system-модалка, а вкладена `<div position:absolute>` всередині панелі агента (локальний overlay).

---

## 7.10 Темна тема, кольори, дизайн-система

**Виявлено:** CSS змінні (`App.css:3-21`):
```
--bg: #0f1117    --surface: #191c27    --surface2: #222638
--border: #2d3250    --accent: #4f7cff    --accent2: #7c5cfc
--red: #ff4f6a    --orange: #ff8c42    --green: #3dd68c
--yellow: #ffd166    --text: #e8eaf0    --text2: #8b90a7
--text3: #555a73
--font-head: 'Unbounded'    --font-body: 'Manrope'
--radius: 12px    --radius-sm: 8px
```

**Розрив у досьє.** CaseDossier використовує **інший набір кольорів inline**, не звертаючись до CSS-змінних:

| Призначення | App.css var | CaseDossier inline |
|-------------|-------------|--------------------|
| фон головний | `--bg #0f1117` | `#0d0f1a` |
| surface | `--surface #191c27` | `#1a1d27` |
| surface2 | `--surface2 #222638` | `#222536` |
| border | `--border #2d3250` | `#2e3148` |
| text2 | `--text2 #8b90a7` | `#9aa0b8` |
| text3 | `--text3 #555a73` | `#5a6080`, `#3a3f58` |
| accent | `--accent #4f7cff` | `#4f7cff` (збігається) |
| green | `--green #3dd68c` | `#2ecc71` |
| red | `--red #ff4f6a` | `#e74c3c` |

**Шрифт:** глобально `--font-body: 'Manrope'`, але CaseDossier рендериться з `fontFamily: "'Segoe UI',sans-serif"` (`2205`) — обходить Manrope. Підвантаження шрифтів в `index.html:9`: `Unbounded:wght@400;600;700&family=Manrope:wght@400;500;600`.

**Spacing/padding/border-radius:**
- Базові `radius:12px / radius-sm:8px`.
- В CaseDossier inline: 6, 7, 8, 10, 12 — без узгодженості з токенами.

**Іконки:** виключно emoji (📅 📋 📁 🔧 ⚖️ 📄 🤖 ☁️ 💡 📌 🌳 ✏️ 🗑️ 📦). SVG/font-icons немає.

---

# РОЗДІЛ 8 — НАКОПИЧЕНИЙ СПИСОК БАГІВ

## 8.1 Знахідки з contextual_tails_v1.md

**Виявлено:** `/workspaces/registry/contextual_tails_v1.md` **ВІДСУТНІЙ** (`ls`: `No such file or directory`). Перевірка коду на симптоми:

- **1.1.1 QI sendChat agent_call не передає caseId в context.** `App.jsx:1738` — поточний `agent_call` у QI передає `caseId: caseId`. `agent_call` у Dashboard (`Dashboard:1523`) і CaseDossier (`CaseDossier:1347`) явно передають `caseId: caseData?.id || null`. **Підстава вважати фікс присутнім — є.** Без першоджерела підтвердити неможливо.
- **1.1.2 Session events з duration:0.** `endSession` (`activityTracker.js:184-212`) фільтрує `if (duration > 0)`. Стан фіксу залежить від `endSession`/`endSubtimer`; виглядає коректно.
- **1.1.4 Dashboard agent видалив дві нотатки замість однієї.** Дивитись 3.5. Системний промпт явно інструктує на окремі ACTION_JSON блоки + парсер `parseAllActionJSON` коректно витягує всі. Захист від дубль-видалення на рівні ACTIONS — `delete_note` фільтрує строго `n.id !== noteId`.
- **1.1.5 Кнопка 📌 emoji не реагує на CSS color.** **Підтверджено в коді:** `CaseDossier:1859-1871` рендерить `📌` emoji з `style.color`. У більшості браузерів emoji не реагує на `color` — обхід через `transform:rotate(-45deg)` + `opacity:0.4` для unpinned. **Стан: фактично не виправлено, замаскувано transform-ом.**

---

## 8.2 CLAUDE.md Audit знахідки

**Виявлено:** Звірка з реальним кодом і `bugs_found_during_claude_md_audit.md`:

- **SystemModal.jsx у структурі CLAUDE.md.** У CLAUDE.md (поточна v5.0) — **НЕ згаданий**. У `src/components/SystemModal.jsx` файл **існує** (76 рядків). Знахідка №1 з `bugs_found_during_claude_md_audit.md` — підтверджується.

- **Точна кількість точок інструментації (25 чи 35).** Підрахунок:
  - **22 базових** (App: 7, Dashboard: 3, CaseDossier: 5, DocumentProcessor: 4, Notebook: 2, executeAction-hook: 1) — **менше за заявлені 25**.
  - **10 agent_call** — збігається.

  Імена базових: `app_launched`, `module_navigation`, `case_created`, `case_closed`, `case_restored`, `qi_document_uploaded`, `qi_voice_input`, `qi_action_executed`, `case_opened`, `dossier_tab_switched`, `document_viewed`, `context_regenerated`, `agent_message_dossier`, `agent_message_dashboard`, `event_drag_create`, `hearing_viewed`, `note_created`, `note_edited`, `docproc_batch_started`, `docproc_ocr_processed`, `docproc_split_proposed`, `docproc_split_confirmed | docproc_batch_completed`. Плюс executeAction рапорт.

- **Точна кількість ACTIONS (19, 30, 32?).** Точний підрахунок з `App.jsx:4558-5169`: **30 ACTIONS** (повний перелік — див. 1.6). CLAUDE.md заявляє "19+ дій" — занижено. `audit_actions.md:51` пише "~32" — теж неточно.

- **`destroy_case` НЕМАЄ в реальних ACTIONS** — попри згадки в CLAUDE.md і `permissionService.js`.

- **case_restored event у списку точок.** В CLAUDE.md перелічено для App.jsx 4 точки. Реально — `case_restored` присутній (`App.jsx:4492`). **Стан: задокументовано в `bugs_found_during_claude_md_audit.md`, не виправлено в CLAUDE.md.**

---

## 8.3 Drive токен 401

**Виявлено:** Див. 5.1. Поточний UI:

- `driveAuth.js:130-148` — `driveRequest` wrapper. На 401:
  1. `refreshDriveToken()` — silent через GIS.
  2. Fallback `refreshTokenGrant()` — dead-fallback (refresh_token не зберігається в browser-OAuth flow).
  3. Якщо silent дає токен — `dispatchEvent('drive-token-refreshed')`.
  4. Якщо обидва не вдалися — `driveRequest` повертає **оригінальний 401 response**. UI код повинен сам розпізнати.

UI-повідомлення в коді:
- `CaseDossier:707-708` — `❌ Немає токена Drive` / `❌ Немає folderId в storage`.
- `CaseDossier:718` — `❌ Не вдалося оновити токен Drive. Перевірте підключення.`
- `CaseDossier:799-805` — special case для AUTH помилок OCR: `systemConfirm('Потрібна повторна авторизація Google для використання OCR. Перепідключити?')` → `forceConsentRefresh()`.
- App-level: `Сесія Google Drive завершилась. Перепідключіть Drive.` (`App.jsx:3878-3881`).

**Висновок:** silent refresh через GIS реалізовано. Класичний `refresh_token` flow — заглушка для майбутнього.

---

## 8.4 handleCreateContext

**Виявлено:** Див. 6.1, 6.5.

- Викликає `ocrService.extractTextBatch` (`CaseDossier:784-794`).
- `ocrService` для PDF: chain `pdfjsLocal → documentAi → claudeVision`. Document AI використовується як основний для зображень/сканованих PDF, claudeVision — fallback.
- Concurrency = 3. Без rate-limiting між хвилями.
- Локальна нарізка PDF на чанки 15 сторінок робиться pdf-lib у Document AI (не Claude Vision).
- Без емпіричних логів неможливо стверджувати "падає на 6+". Архітектурно — fallback chain + cache здатна обробляти 6+. Питання — пам'ять браузера на планшеті.

---

## 8.5 lastProcessingContext

**Виявлено:** `grep "lastProcessingContext\|last_processing_context\|update_processing_context\|add_documents" /workspaces/registry/src/` — **0 збігів**.

CLAUDE.md рядок 246 згадує `add_documents, update_processing_context` як permissions для `document_processor_agent`, але:
- В App.jsx ACTIONS об'єкті ці дії **відсутні**.
- PERMISSIONS блок (`5185-5197`) **не має `document_processor_agent`**.

**Стан:** `lastProcessingContext` як службове повідомлення в `agent_history` **не реалізовано**.

---

# РОЗДІЛ 9 — НЕАРХІТЕКТУРНІ АСПЕКТИ

## 9.1 Налаштування розробки

**Версії пакетів** (з `package.json`):
```
react              ^18.3.1
react-dom          ^18.3.1
mammoth            ^1.12.0
pdf-lib            ^1.17.1
pdfjs-dist         ^5.6.205
@vitejs/plugin-react ^4.3.4
vite               ^6.0.7
```

**Anthropic SDK** — НЕ використовується. Усі виклики до `https://api.anthropic.com/v1/messages` — через нативний `fetch` з заголовком `anthropic-dangerous-direct-browser-access: true`.

**Node.js версія** — у `.github/workflows/deploy.yml`: `node-version: 20` (`actions/setup-node@v4`).

**Тести.** У `package.json` немає скриптів `test`. **Жодних unit/integration/e2e тестів.**

**CI/CD pipeline** — `.github/workflows/deploy.yml`:
- Trigger: push на `main` або `workflow_dispatch`.
- Permissions: `contents:read`, `pages:write`, `id-token:write`.
- Job `build`: `checkout@v4` → `setup-node@v4` (Node 20, npm cache) → `npm ci` → `npm run build` → `configure-pages@v5` → `upload-pages-artifact@v3` (path `dist`).
- Job `deploy`: depends on build, environment `github-pages`.
- **Немає тест-job, немає lint-job.**

**Environment variables (`import.meta.env`).** `grep` дав 1 збіг:
- `App.jsx:3794` — `if (!import.meta.env || !import.meta.env.DEV) return;` — гард для DEV-онлі логіки.

**Жодних env-змінних. Усі секрети в `localStorage`:**
- `claude_api_key`
- `levytskyi_drive_token`
- `google_refresh_token` (порожній, заглушка)
- `agent_history_<caseId>`
- `levytskyi_notes`
- `ocr_force_provider` (необов'язковий override)

`GOOGLE_CLIENT_ID` хардкод у `driveAuth.js:8-9`. Scope `drive` + `cloud-platform` — широкий.

---

## 9.2 Структура GitHub репо

**Виявлено:**
- `git branch -a`: одна локальна `main`, `origin/main`, плюс ~32 експериментальних `claude/` гілок.
- Усі активні зміни тільки на `main` (правило №1 з CLAUDE.md).

`git log --oneline -20`:
```
f1e2ddd docs: add dual-interface principle to AI-First Architecture
cabe556 docs: AI-First Architecture as primary principle
3ca0e05 fix: Drive-first hydration — захист від race condition
6ff6b91 docs: CLAUDE.md v5.0 + DEVELOPMENT_PHILOSOPHY.md
9b1ec40 fix: agent_call category and module consistency in time_entries
5a18320 feat: Billing Foundation v2 — internal time tracking infrastructure
94faf6c feat: SaaS Foundation v1.1 — patch and extension
4f719fc feat: SaaS Foundation v1 — tenants, users, audit log, permissions
…
```

**Merge-конфлікт-маркери:** `grep "<<<<<<\|>>>>>>\|======" /workspaces/registry/src` — **0 збігів**. Чисто.

**README** — ВІДСУТНІЙ. Для GitHub-репо нетипово. У корені є `index.html.backup` (167 KB) — старий артефакт.

---

## 9.3 Документація

`/workspaces/registry/*.md` — 22 файли у корені:

```
CLAUDE.md                                 (37 358 B, v5.0)
CLAUDE.md.backup-pre-v5                   (31 626 B)
DEVELOPMENT_PHILOSOPHY.md                 (31 612 B, v5.0)
DIAGNOSTIC_DASHBOARD.md                   (26 566 B)
LESSONS.md                                (26 122 B)
TASK_diagnostic_2026-05-07.md             (48 886 B, поточний TASK)
audit_actions.md                          (10 357 B)
bugs_found_during_claude_md_audit.md      (4 637 B)
bugs_found_during_saas_foundation.md      (6 839 B)
diagnostic_*.md                           (8 файлів, поточних і архівних)
recommended_task_claude_md_audit.md       (17 516 B)
report_*.md                               (4 файли)
```

Жодної папки `/docs`. Усі файли у корені — особливість CLAUDE-driven workflow з diagnostic_*/report_*/bugs_found_during_* парами.

**Стан CLAUDE.md.** Версія 5.0, schemaVersion 4. Дата: 06.05.2026. Згідно з `bugs_found_during_claude_md_audit.md` — 5 розбіжностей:
1. SystemModal.jsx не у структурі.
2. "25 точок" — фактично 22 базових.
3. ACTIONS "19+" — фактично 30.
4. case_restored не в списку точок.
5. `bugs_found_during_billing_foundation.md` згаданий, але відсутній.

`DEVELOPMENT_PHILOSOPHY.md` — інтегрований 06.05.2026. Останні три коміти — додавання AI-First архітектурного принципу.

---

## 9.4 Третьосторонні сервіси і ключі

**Anthropic API:**
- Ключ — `localStorage.claude_api_key`. Введення: `App.jsx:3161-3167`.
- Прямі fetch до `https://api.anthropic.com/v1/messages` з `anthropic-dangerous-direct-browser-access: true`.
- 10 точок викликів.
- Моделі: haiku-4-5-20251001, sonnet-4-20250514, opus-4-7.

**Google Cloud (Drive + Document AI):**
- OAuth `client_id` — хардкод `driveAuth.js:8-9`.
- Scope: `drive` + `cloud-platform`.
- Потік: GIS `requestAccessToken` → `localStorage.levytskyi_drive_token`.
- Refresh: silent через GIS; класичний `refresh_token` — заглушка.
- Document AI: processor `2cc453e438078154`, region `europe-west2`, project `73468500916` (numeric).

**Google Identity Services (GIS):**
- Підключення через CDN (`index.html:7`): `<script src="https://accounts.google.com/gsi/client" async defer>`.
- Без npm-пакета, як global `window.google.accounts.oauth2`.

**Google Fonts:**
- `index.html:8-9`: preconnect + `Unbounded` + `Manrope`.

**Інших third-party:** немає.

---

# НЕСПОДІВАНКИ (РОЗБІЖНОСТІ З ОЧІКУВАННЯМИ TASK)

1. **`document_processor_agent` згадується у CLAUDE.md (рядок 233) і `permissionService.js`, але НЕ існує у `PERMISSIONS` (App.jsx:5168-5209).** ACTIONS для документів (`add_document/update_processing_context/add_documents`) також відсутні — DocumentProcessor пише напряму через `setCases`, обходячи `executeAction`. Архітектурне правило #10 з CLAUDE.md ("не обходити executeAction") порушено.

2. **`destroy_case` декларовано в `permissionService.js`/CLAUDE.md, але відсутнє в `ACTIONS`.** Видалення тільки через UI-only `deleteCasePermanently`. Більше того, ця функція шукає `caseItem.driveFolderId` на верхньому рівні, тоді як реальне поле `caseItem.storage.driveFolderId` — **папка на Drive фактично не видаляється для нових справ.**

3. **Реальна кількість ACTIONS — 30, не "19+" як у CLAUDE.md.**

4. **Реальна кількість точок `activityTracker.report` — ~32 базових (більше за 25 у CLAUDE.md). `case_restored` присутній, але не у заявленому списку.**

5. **`lastProcessingContext` як службове повідомлення між Document Processor і Dossier Agent — НЕ реалізовано** (0 збігів grep'ом). У TASK і CLAUDE.md цей механізм описаний як заплановний.

6. **`destroy_case` не виявлений в `AUDIT_ACTIONS`.** Перевірка `auditLogService.js:7-21` — `destroy_case` ТАМ Є. Але оскільки немає ACTION — це не використовується. Pre-delete audit пишеться у `deleteCasePermanently` напряму.

7. **CaseDossier і App.css використовують різні набори кольорів** — CaseDossier inline-стилізація обходить CSS-змінні `App.css`. Колірна палітра має конкуруючі hex-коди (`#0f1117` ↔ `#0d0f1a`, `#191c27` ↔ `#1a1d27`, тощо). Шрифт-стек у CaseDossier — `'Segoe UI'` замість глобального `Manrope`.

8. **`document_processor_agent` промпт-стратегія — Sonnet з document block, не Document AI.** Тобто DP **не використовує OCR-фасад**, а робить семантичну нарізку через Anthropic API з повним PDF як base64. OCR (`Document AI`) використовується тільки в CaseDossier для генерації `case_context.md`.

9. **Markdown і code-blocks в чаті агентів НЕ рендеряться** (`<div whiteSpace:pre-wrap>`). Жодних бібліотек markdown у `package.json`.

10. **Drive іконки на справі (☁️ Drive 🔗 / ⚠️ Без папки) — у поточному коді залежать від `storageState?.driveFolderId`, а не від `caseItem.driveFolderId`** (top-level). Якщо UI запитує `caseItem.driveFolderId` (як `deleteCasePermanently`), а зберігається у `caseItem.storage.driveFolderId` — є невідповідність шляхів читання.

11. **Кнопки `Копіювати`, `Завантажити`, `🤖 Аналіз` у viewer-хедері (CaseDossier:2147-2151) — мертві без `onClick`.** Робочі кнопки (`Відкрити в Drive`, `Завантажити`) живуть під iframe.

12. **Папка справи на Drive НЕ створюється автоматично при `addCase`** (`App.jsx:4296-4312`). Це окрема дія користувача через кнопку "📁 Створити структуру на Drive". `INITIAL_CASES` (20 справ) ініціалізують `storage` як `null`. Реальні нові справи без явного натискання кнопки не мають Drive-структури.

13. **Tool Use інфраструктура (`toolUseRunner.js`/`toolDefinitions.js`) — не існує.** Згідно CLAUDE.md, Tool Use закладається ВПЕРШЕ в TASK Document Processor v2.

14. **agent_history для Dashboard і QI агентів — НЕ персистується.** Тільки in-memory state, який пропадає при refresh. Тільки досьє має 3-tier cache.

15. **CLAUDE.md правило №8 (заборона кирилиці в q= Drive API) порушено в `driveService.js:37-43`** для пошуку `01_АКТИВНІ_СПРАВИ`/`00_INBOX`/`_backups`. Правильний патерн застосовано тільки у `ensureSubFolders`.

16. **Анотації, виділення тексту, текстова копія для scanned документів у viewer — не існують.** PDF rendering — через iframe Drive preview, який не передає селекшн назад у React.

17. **Кнопки "Заповнити картку" і "Призупинити" — НЕ ІСНУЮТЬ у UI.** Хоча "Заповнити картку" згадана у роадмапі, "Призупинити" — у CLAUDE.md (статус paused). Перемикання статусу `paused` можливе тільки через агентську команду `update_case_field`.

18. **`destroy_case` написаний явно "тільки UI" в коментарі CLAUDE.md і в коді (`App.jsx:5208`), але CLAUDE.md рядок 264 наводить його у `ACTIONS` списку через `requireUI: true`.** Це конфлікт документації з реальним кодом — `requireUI` як прапор поля action не реалізовано (немає механізму).

---

# ДОДАТОК: ШВИДКА КАРТА ФАЙЛІВ

| Шар | Файл | Рядки | Призначення |
|-----|------|-------|-------------|
| Entry | `index.html` | 15 | HTML shell + GIS + Google Fonts |
| Entry | `src/main.jsx` | 112 | React mount + ErrorBoundary |
| Core | `src/App.jsx` | 5757 | State-orchestrator, ACTIONS, PERMISSIONS, executeAction, AnalysisPanel, AddCaseForm, INITIAL_CASES, internal driveService для registry_data.json |
| UI | `src/components/Dashboard/index.jsx` | 2705 | Календар, Activity Feed, drag-слоти, Dashboard agent |
| UI | `src/components/CaseDossier/index.jsx` | 2489 | 5 табів досьє, агент досьє з 3-tier cache, viewer, OCR generator |
| UI | `src/components/DocumentProcessor/index.jsx` | 1203 | PDF semantic split via Sonnet, pdf-lib local cutting, document save |
| UI | `src/components/Notebook/index.jsx` | 800 | NotesTab + RecordsTab; React.lazy chunked |
| UI | `src/components/SystemModal.jsx` | 76 | Глобальна `systemConfirm` модалка |
| Service | `src/services/driveAuth.js` | 148 | OAuth, silent refresh, driveRequest wrapper |
| Service | `src/services/driveService.js` | 335 | Drive folder structure, backups, file ops |
| Service | `src/services/ocrService.js` | 288 | Provider Pattern facade, batch concurrency |
| Service | `src/services/ocr/documentAi.js` | 180 | Document AI v1, 15-page chunking |
| Service | `src/services/ocr/claudeVision.js` | 173 | Claude Vision OCR fallback |
| Service | `src/services/ocr/pdfjsLocal.js` | 161 | Local PDF text layer + HTML/MD/TXT з charset detection |
| Service | `src/services/migrationService.js` | 371 | schemaVersion 1→4 migrations, ensureCaseSaasFields |
| Service | `src/services/activityTracker.js` | 340 | Time tracking, sessions, subtimers, hooks |
| Service | `src/services/masterTimer.js` | 356 | State machine, BroadcastChannel, IDLE_TIMEOUT |
| Service | `src/services/aiUsageService.js` | 132 | MODEL_PRICING, calculateCost, logAiUsage |
| Service | `src/services/auditLogService.js` | 74 | AUDIT_ACTIONS, writeAuditLog |
| Service | `src/services/permissionService.js` | 88 | checkTenantAccess/RolePermission/CaseAccess |
| Service | `src/services/tenantService.js` | 135 | DEFAULT_TENANT, DEFAULT_USER |
| Service | `src/services/modelResolver.js` | 40 | SYSTEM_DEFAULTS, resolveModel |
| Service | `src/services/moduleNames.js` | 37 | MODULES enum, categoryForCase |
| Service | `src/services/timeStandards.js` | 168 | ACTIVITY_CATEGORIES, EVENT_VARIANT_MATRIX |
| Service | `src/services/smartReturnHandler.js` | 150 | handleReturn (experimental) |
| Service | `src/services/timeEntriesArchiver.js` | 156 | Monthly rotation |
| Service | `src/services/timeEntriesQuery.js` | 159 | getTimeEntries API |
| Service | `src/services/subscriptionService.js` | 74 | recalculateCurrent, checkLimits |

---

**Кінець звіту.** Дата: 2026-05-07. Версія: 1.0.

Усі знахідки базуються виключно на статичному читанні коду через 5 паралельних read-only агентів (general-purpose Sonnet/Opus). Жоден файл не редагувався. Жодних рекомендацій не вносилось — лише факти з file:line посиланнями.
