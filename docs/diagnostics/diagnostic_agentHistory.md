# Діагностика agentHistory — три джерела чи борг?

Дата: 2026-05-05
Статус: read-only investigation, без змін у коді.

---

## 1. Карта місць де зачіпається agentHistory

### A. `case.agentHistory` (поле об'єкта справи в `registry_data.json` / `localStorage 'levytskyi_cases'`)

| Файл | Рядок | Що робить |
|---|---|---|
| `src/App.jsx` | 3273–3276 | `normalizeCases()` — гарантує `agentHistory: []` при завантаженні. Коментар каже «тимчасово, поки немає agent_history.json» — **застарілий**, файл уже є. |
| `src/App.jsx` | 3985 | `ACTIONS.create_case` — додає `agentHistory: []` при створенні справи. |
| `src/components/CaseDossier/index.jsx` | 429 | `useState(() => caseData.agentHistory \|\| [])` — використовує як **початковий стан** до того як спрацює useEffect. |
| `src/components/CaseDossier/index.jsx` | 510, 512, 518, 521, 526 | `loadAgentHistory()` — повертає `caseData.agentHistory` як fallback коли Drive недоступний / без folderId / без токена / немає файлу / помилка. |
| `src/components/CaseDossier/index.jsx` | 1278, 1290, 1299 | `updateCase(caseData.id, 'agentHistory', updated)` — пише в спільний state `cases[]`, що далі через автосинк потрапляє в `registry_data.json`. Slice **`-50`**. |

### B. `localStorage 'agent_history_<caseId>'`

| Файл | Рядок | Що робить |
|---|---|---|
| `src/components/CaseDossier/index.jsx` | 533 | `saveAgentHistory()` — пише slice **`-20`** перед спробою Drive. |
| `src/components/CaseDossier/index.jsx` | 446–454 | mount effect — читає **тільки якщо** Drive повернув порожньо. |

### C. `agent_history.json` на Google Drive (у папці справи)

| Файл | Рядок | Що робить |
|---|---|---|
| `src/components/CaseDossier/index.jsx` | 506–528 | `loadAgentHistory()` — основне читання. |
| `src/components/CaseDossier/index.jsx` | 530–551 | `saveAgentHistory()` — `JSON.stringify(history.slice(-50), null, 2)`, через `updateDriveFile`/`createDriveFile`. |
| `src/components/CaseDossier/index.jsx` | 716–727 | `cleanup` пропускає `agent_history.json` при чистці папки (захищений файл). |
| `src/services/driveAuth.js` | 6 | Коментар згадує `agent_history` як файл що читає CaseDossier після refresh токена. |
| `src/components/CaseDossier/index.jsx` | 466–477 | useEffect на `'drive-token-refreshed'` — перечитує історію після silent-refresh. |

### D. Окремий чат Dashboard (НЕ той самий agentHistory)

| Файл | Рядок | Що робить |
|---|---|---|
| `src/components/Dashboard/index.jsx` | 1011 | `chatHistory` — **ефемерний** state агента дашборду. **Не персистується нікуди.** Slice `-10` для API контексту. |
| `src/components/DocumentProcessor/index.jsx` | 271, 386, 416, 517, 552 | `chatHistoryRef` — ефемерний ref, для буферу всередині сесії аналізу документа. Не персистується. |

> **Це інші модулі.** Питання діагностики — про agent у досьє справи. Dashboard / DocumentProcessor мають власні буфери в пам'яті, які до registry_data.json / Drive не доходять.

---

## 2. Відповіді на питання

### а) Чи це справді буфер 20 останніх повідомлень для чату агента?

**Так — за задумом, але реалізація плаваюча.** Це буфер історії розмови з агентом досьє справи (`<CaseDossier>`), щоб після перевідкриття вкладки/іншого пристрою чат продовжувався. Але **розмір зрізу не консистентний**:

- React state і `case.agentHistory`: `slice(-50)` (рядки 1277, 1289, 1298)
- Drive `agent_history.json`: `slice(-50)` (рядок 540)
- localStorage `agent_history_<id>`: `slice(-20)` (рядок 533)
- API-контекст для Sonnet: `slice(-10)` (рядок 1251)

Тобто буфер **50**, не 20. localStorage урізаний до 20 — ймовірно стара цифра з пам'яті.

### б) Як розподіляється функціональність

- **`case.agentHistory`** — поле в об'єкті справи. Йде в `registry_data.json` через спільний state `cases[]`. Виконує дві ролі:
  1. **Початковий стан** компонента до того як завантажиться Drive (рядок 429) — щоб UI відразу мав щось показати.
  2. **Останній fallback** у `loadAgentHistory` коли Drive недоступний (рядки 510, 512, 518, 526).
- **`localStorage 'agent_history_<id>'`** — швидкий локальний кеш. Читається **тільки якщо Drive повернув порожнечу** (рядки 444–454). Активний — пишеться в кожному save.
- **`agent_history.json` на Drive** — головна персистентна копія. Читається першою на маунті, перечитується після `drive-token-refreshed`.

Каскад читання: **Drive → localStorage → `case.agentHistory`** (через initial state).
Каскад запису: пишеться в **усі три** одночасно.

### в) Чи є дублювання запису

**Так, повне дублювання.** На кожне нове повідомлення (рядки 1276–1280, 1288–1292, 1296–1302) виконується:
1. `setAgentMessages(...)` — React state
2. `updateCase(caseId, 'agentHistory', updated)` — оновлює `cases[]` → `registry_data.json` (locally + Drive sync)
3. `saveAgentHistory(updated)` — пише в localStorage (`-20`) + у Drive `agent_history.json` (`-50`)

Тобто одне повідомлення = **3 локальні записи + 2 запити на Drive** (registry_data.json через окремий useEffect-синк + agent_history.json напряму).

### г) Мертвий/застарілий код

1. **Рядок 3273 коментар застарів:**  
   `// agentHistory — зберігати в об'єкті справи (тимчасово, поки немає agent_history.json)`  
   Файл уже існує, fallback залишився, але слово «тимчасово» вводить у оману.
2. **CLAUDE.md (секція AGENT HISTORY) прямо забороняє** те що зараз робиться:
   > «НЕ розширювати registry_data.json history-даними агента»  
   Але `updateCase(caseData.id, 'agentHistory', updated)` робить рівно це.
3. **Невідповідність slice розмірів** (`20` в localStorage vs `50` всюди) — після відкату на localStorage губляться 30 останніх повідомлень.

Класичного «мертвого» коду (пишеться але не читається) немає — кожне з джерел читається. Але є **архітектурна непослідовність**.

### д) Ризик неузгодженості / втрати даних

**Так, кілька реальних ризиків:**

1. **Race на закриття вкладки:** `setAgentMessages` синхронний, `updateCase` синхронний для cases[], але **запис registry_data.json у Drive і `saveAgentHistory` у Drive — обидва async**. Якщо адвокат закрив вкладку між отриманням відповіді і завершенням `await updateDriveFile(...)`:
   - localStorage встиг (записався першим, синхронно — рядок 533).
   - Drive не встиг.
   - Наступне відкриття: Drive віддає старе → mount effect завантажує застарілу версію → нове повідомлення «зникло» аж поки не подивиться кеш localStorage (а він читається тільки коли Drive порожній, не коли застарів).
2. **Несумісні slice:** після переходу на пристрій без Drive (offline / без токена) — отримаєте 20 останніх замість 50. Адвокат побачить «обрізану» розмову.
3. **registry_data.json + agent_history.json роз'їжджаються:** `updateCase` записує `agentHistory` у `cases[]`, який потім окремим механізмом синхронізується. `agent_history.json` синхронізується миттєво. Якщо registry sync відстає — `case.agentHistory` застарілий, але початковий state бере його ⇒ короткочасно UI може блимнути старим списком до того як прийде Drive read.

### е) Логіка ротації

**Реалізована в трьох місцях окремо**, при кожному додаванні повідомлення:

```js
// CaseDossier рядки 1277, 1289, 1298 — React state + registry
const updated = [...prev, entry].slice(-50);
updateCase(caseData.id, 'agentHistory', updated);

// CaseDossier рядок 533 — localStorage
localStorage.setItem(..., JSON.stringify((history || []).slice(-20)));

// CaseDossier рядок 540 — Drive
const content = JSON.stringify(history.slice(-50), null, 2);
```

Витіснення FIFO (найстарше виходить — сказано «LIFO» у запиті, але по коду це **FIFO**: `slice(-N)` залишає хвіст, голова відрізається). Жодного централізованого утиліта `appendAgentMessage(...)` немає — три копії однієї логіки.

---

## 3. Висновок

**Це не баг архітектури — це правильна ідея, реалізована неохайно.**

Каскад Drive → localStorage → state — легітимний паттерн (швидкий рендер, офлайн-резерв, source of truth у Drive). Він працює і потрібен.

Але є **3 справжні дрібні борги**:

| # | Що | Серйозність | Час |
|---|---|---|---|
| 1 | `case.agentHistory` пишеться в `registry_data.json`, що **прямо суперечить CLAUDE.md секція «AGENT HISTORY»** | середня | 30–60 хв |
| 2 | Невідповідність slice (`20` localStorage vs `50` Drive/state) | низька | 5 хв |
| 3 | Застарілий коментар «тимчасово, поки немає agent_history.json» (App.jsx:3273) | косметика | 2 хв |
| 4 | Дублювання логіки append/slice у трьох місцях — варто винести в `appendAgentMessage(history, entry)` | низька | 15–20 хв |
| 5 | Race-умова на закриття вкладки до завершення Drive-запису | низька, рідкісна | не вирішується тривіально, варто прийняти |

### Рекомендоване рішення (не зараз — для майбутнього TASK)

**Варіант A — мінімальний cleanup (≈30 хв):**
- Прибрати `agentHistory: []` з `normalizeCases` і `create_case`.
- Прибрати `updateCase(..., 'agentHistory', ...)` — лишити тільки `saveAgentHistory()`.
- Initial state взяти з `localStorage 'agent_history_<id>'` (миттєвий) замість `caseData.agentHistory`.
- Уніфікувати slice: 30 для localStorage та Drive (компроміс між «не роздути JSON» і «зберегти контекст»).
- Видалити застарілий коментар.

Це привело б реалізацію у відповідність із CLAUDE.md і прибрало два з трьох джерел (залишилось би localStorage як швидкий кеш + Drive як source of truth — стандартний 2-tier pattern).

**Варіант B — залишити як є.** Працює, ризики низькі. Просто оновити коментар (2 хв) і вирівняти slice до 50 (5 хв).

### Що рекомендую

**Варіант B зараз + Варіант A коли буде окремий TASK на cleanup CaseDossier.** Зараз агент пам'ятає розмову — це головне. Архітектурний борг невеликий і не блокує жодну фічу. Перетягнути в backlog (`bugs_found_during_saas_foundation.md`) як низькопріоритетний.
