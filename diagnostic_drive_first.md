# diagnostic_drive_first.md

**Дата діагностики:** 2026-05-06
**Привід:** перезапис 156 КБ `registry_data.json` на iMac Chrome файлами 43–66 КБ
**Тип:** діагностика без змін у код

---

## 1. ПОТОЧНА АРХІТЕКТУРА — ПОТІК ДАНИХ ПРИ СТАРТІ

### 1.1 Послідовність на cold-start

```
Браузер → React render App
  │
  ├─ useState init (СИНХРОННО, до першого рендеру)
  │    ├─ cases    ← localStorage('levytskyi_cases')        || INITIAL_CASES (20 справ)
  │    ├─ tenants  ← localStorage('levytskyi_tenants')      || [DEFAULT_TENANT]
  │    ├─ users    ← localStorage('levytskyi_users')        || [DEFAULT_USER]
  │    ├─ auditLog ← localStorage('levytskyi_audit_log')    || []
  │    ├─ ai_usage ← localStorage('levytskyi_ai_usage')     || []
  │    ├─ time_entries ← localStorage('levytskyi_time_entries') || []
  │    ├─ master_timer_state ← localStorage(…)              || empty
  │    ├─ billing_meta ← localStorage(…)                    || empty (поточний місяць)
  │    └─ driveConnected ← !!localStorage('levytskyi_drive_token') (ТІЛЬКИ ПРИСУТНІСТЬ)
  │
  ├─ Перший render — UI малюється з ВЖЕ ВСТАНОВЛЕНОГО state
  │
  └─ після paint, useEffects у порядку оголошення:
       │
       ├─ EFFECT-A "Load from Drive on mount" (App.jsx:3670)
       │     if (!driveConnected) return;  ← ранній вихід
       │     const token = driveService.getToken(); if (!token) return;
       │     (async IIFE — повертається синхронно, працює у фоні):
       │        raw = await driveService.readRegistry(token)   // GET registry_data.json
       │        { registry, didMigrate } = migrateRegistry(raw)
       │        if (registry.cases.length > 0) setCases(...)   ← ! length-guard
       │        ...
       │
       └─ EFFECT-B "Auto-save to localStorage and Drive" (App.jsx:3865)
             // СИНХРОННО, БЕЗ AWAIT:
             localStorage.setItem('levytskyi_cases', …)
             …усі ключі…
             if (driveConnected) {
                const registry = { schemaVersion:4, …усі state… }
                driveService.writeRegistry(token, registry)  ← MAY OVERWRITE DRIVE
             }
```

**Ключовий факт:** EFFECT-A і EFFECT-B обоє запускаються при першому mount. EFFECT-A робить асинхронну роботу (`await readRegistry`); EFFECT-B запускається синхронно ВСЛІД, не чекає на A. Це і є перший race.

### 1.2 Що потрапляє в `cases[]` у різних сценаріях

| Сценарій | localStorage | Drive | `cases` після mount, до завершення EFFECT-A | `cases` після завершення EFFECT-A |
|---|---|---|---|---|
| Новий пристрій, Drive не підключений | порожньо | (ігнорується) | INITIAL_CASES (20 шт) | INITIAL_CASES (EFFECT-A early-return) |
| Свіжий токен, Drive має 156 КБ | старий snapshot | 156 КБ | старий snapshot | повний (з Drive) |
| Токен живий, Drive порожній (raw=null) | має дані | відсутній | localStorage | **localStorage** (length-guard блокує `setCases([])`) |
| Токен ПРОТУХ (401), silent refresh ОК | має дані | 156 КБ | localStorage | повний (з Drive) |
| Токен ПРОТУХ (401), silent refresh FAIL | має дані | 156 КБ | localStorage | **localStorage** (raw=null від 401, length-guard блокує) |
| Хто залив 0-байтовий файл як registry_data.json | будь-що | 0 байт або битий JSON | localStorage | **localStorage** (catch або length-guard) |

У всіх сценаріях коли Drive не дав даних — `cases[]` лишається тим, що було в `useState`-init (localStorage або INITIAL_CASES). EFFECT-B при цьому **все одно** запише цей state на Drive якщо `driveConnected=true` і токен існує.

---

## 2. ЗНАЙДЕНІ ВРАЗЛИВОСТІ

### V1. `driveConnected` базується ТІЛЬКИ на присутності токена, не на його валідності
**Файл:** `src/App.jsx:3596`, `src/App.jsx:2877`
```js
isConnected() { return !!localStorage.getItem('levytskyi_drive_token'); }
const [driveConnected, setDriveConnected] = useState(() => driveService.isConnected());
```
Просрочений токен — `driveConnected = true`. Якщо silent refresh не спрацює, всі читання повертають null/401, але запис теж не блокується, бо стан "підключено".

### V2. EFFECT-B (auto-save) пише в Drive БЕЗ перевірки що EFFECT-A (load) встиг прочитати
**Файл:** `src/App.jsx:3865-3912`
EFFECT-B запускається на першому рендері незалежно від того, чи завершився EFFECT-A. Якщо `cases` у `useState`-init = INITIAL_CASES (бо localStorage був порожній), і `driveConnected=true` (бо token у localStorage є, хай і протух) — EFFECT-B спробує записати INITIAL_CASES на Drive ще до того, як EFFECT-A прочитає реальні 156 КБ.

Немає прапора `driveLoadCompleted`/`hydrated`, який блокував би запис до завершення завантаження.

### V3. Жодних write-guards перед перезаписом Drive
**Файл:** `src/App.jsx:2923-2943`, `src/App.jsx:3907`
```js
async writeRegistry(token, registry) {
  const body = JSON.stringify(registry);
  const id = await this._findFileId(token);
  if (id)  PATCH …media…  else POST multipart створює НОВИЙ файл
}
```
Не перевіряється:
- розмір нового payload відносно файлу на Drive
- кількість справ (`registry.cases.length`) відносно того, що вже на Drive
- `schemaVersion`/`settingsVersion`
- `updatedAt` / mtime
- наявність будь-якого "fingerprint" попереднього прочитаного стану

EFFECT-B пише завжди, тільки на 4xx статусах оновлюється `driveSyncStatus='error'`.

### V4. Length-guard на READ маскує проблему замість сигналізувати про неї
**Файл:** `src/App.jsx:3751-3753`
```js
if (Array.isArray(registry.cases) && registry.cases.length > 0) {
  setCases(normalizeCases(registry.cases));
}
```
Якщо Drive повернув `null` (404, 401, мережа), `migrateRegistry(null)` повертає **порожній** registry (`cases: []`). Length-guard `> 0` не викликає `setCases`. Це **не є захистом** — це навпаки: state лишається з INITIAL_CASES, і EFFECT-B тут же запише INITIAL_CASES на Drive як "правду".

Аналогічно немає branch'а `else { показати помилку / заблокувати запис }`.

### V5. Пошук файлу — за **точною назвою**, без fallback
**Файл:** `src/App.jsx:2898-2906`
```js
async _findFileId(token) {
  if (this._fileId) return this._fileId;
  const res = await driveRequest(
    `…/files?q=name='${DRIVE_FILE_NAME}'+and+trashed=false&fields=files(id)`
  );
  const data = await res.json();
  if (data.files && data.files.length > 0) { this._fileId = data.files[0].id; }
  return this._fileId || null;
}
```
- Пошук тільки за `name='registry_data.json'`. `registry_data.json"` (з кінцевою лапкою) не знайдеться. `registry_data .json`, `Registry_data.json` — теж.
- Без `parents=...` — шукає у всьому Drive. Якщо файлів з такою назвою кілька (наприклад, у різних папках), повертається `files[0]`, порядок недетермінований.
- Не використовується `pageSize`, `orderBy`, `appProperties`/`spaces=appDataFolder`.
- `_fileId` кешується в module-singleton (`driveService._fileId`). Якщо файл був видалений/перейменований під час сесії, у пам'яті лишиться попередній id; писати будемо вже не туди.

### V6. Якщо файл не знайдено — створюється новий, **без перевірки `_backups/`**
**Файл:** `src/App.jsx:2932-2942`
```js
if (id) { …PATCH… } else {
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name: DRIVE_FILE_NAME, … })], …));
  form.append('file', new Blob([body], …));
  // POST multipart → СТВОРИТЬ НОВИЙ FILE на root Drive
  ...
}
```
Жодної перевірки `_backups/` чи `registry_data_backup_*` перед створенням. Якщо адвокат випадково перейменував чи видалив `registry_data.json` — система мовчки створює новий і починає писати в нього. Старі бекапи лежать поруч, нікому не потрібні.

### V7. `readRegistry` повертає `null` на будь-яку HTTP-помилку
**Файл:** `src/App.jsx:2912-2920`
```js
async readRegistry(token) {
  const id = await this._findFileId(token);
  if (!id) return null;
  const res = await driveRequest(`…/files/${id}?alt=media`);
  if (!res.ok) return null;
  return await res.json();
}
```
`null` означає одне з:
- файлу нема
- 401/403/404
- 500/мережа
- битий JSON (`res.json()` кине, але далі немає try/catch — або пройде через async catch у викликача)

Викликач (EFFECT-A) не розрізняє "файлу нема" від "файл є але читати не вдалося". Обидва веде до однакового результату — порожній registry, length-guard, state лишається стартовим.

### V8. Немає onboarding/splash-екрану
- Якщо `driveConnected=false` (нема токена) — система **повноцінно завантажується з INITIAL_CASES**, дозволяє роботу.
- Користувач може створити справу/ноту локально, потім підключити Drive, побачити промпт "На Drive знайдено N справ. Завантажити і замінити?" (App.jsx:3057-3062). Якщо натисне "Скасувати" — локальні дані залишаються і EFFECT-B пише ЇХ на Drive поверх існуючих.
- Немає блокування UI до явного підключення Drive і успішного завантаження.

### V9. localStorage змішує дані з конфігурацією
**Файл:** `src/App.jsx:3865-3877` + інші місця
```
levytskyi_cases               ← ДАНІ
levytskyi_calendar_events     ← ДАНІ
levytskyi_notes               ← ДАНІ (у legacy також 'levytskyi_system_notes', 'levytskyi_content_ideas')
levytskyi_tenants             ← ДАНІ (SaaS)
levytskyi_users               ← ДАНІ
levytskyi_audit_log           ← ДАНІ
levytskyi_structural_units    ← ДАНІ
levytskyi_ai_usage            ← ДАНІ
levytskyi_case_access         ← ДАНІ (поки заглушка)
levytskyi_time_entries        ← ДАНІ (Billing)
levytskyi_master_timer_state  ← ДАНІ (Billing)
levytskyi_billing_meta        ← ДАНІ (Billing)
levytskyi_timelog             ← LEGACY ДАНІ (видаляється після імпорту)
levytskyi_action_log          ← LEGACY ДАНІ (видаляється після backup)
                              ─────────
levytskyi_drive_token         ← КОНФІГ (OAuth access_token)
google_refresh_token          ← КОНФІГ (refresh, наразі не використовується)
claude_api_key                ← КОНФІГ
levytskyi_pre_saas_backup_done            ← ПРАПОР міграції
levytskyi_pre_v3_backup_done              ← ПРАПОР міграції
levytskyi_billing_backup_done_v4          ← ПРАПОР міграції
levytskyi_action_log_cleaned_v1_1         ← ПРАПОР міграції
levytskyi_timelog_imported_v4             ← ПРАПОР міграції
levytskyi_last_backup                     ← ПРАПОР раз/добу
                              ─────────
levytskyi_usage               ← ТЕЛЕМЕТРІЯ (UsageLog)
levytskyi_ideas               ← ТЕЛЕМЕТРІЯ (AnalysisPanel)
```

Архітектурна біда: **дані завантажуються з localStorage в state ще ДО першої спроби читання Drive**, і це робить localStorage першоджерелом у всіх "холодних" і "поганих" сценаріях. Drive перетворюється з "джерела правди" на "опційне дзеркало".

### V10. Кеш `_fileId` ніколи не інвалідуються
**Файл:** `src/App.jsx:2875, 2880, 2898-2906`
`driveService._fileId` обнуляється тільки в `clearToken()` (логаут). Якщо в сесії файл видалили/перейменували/створили — id у кеші вже неактуальний, наступні писання впадуть у 404 або потраплять не туди.

---

## 3. МОЖЛИВІ СЦЕНАРІЇ ІНЦИДЕНТУ

З огляду на симптоми (Drive не підключений, API ключ відсутній на iMac, на Drive перезаписалися 156 КБ → 43-66 КБ при кожному hard reload), найбільш імовірно одне з нижче.

### 3.1 INITIAL_CASES записався поверх Drive

20 справ INITIAL_CASES з `mkHearing` → серіалізований об'єкт `{ schemaVersion:4, tenants, users, …, cases: [20 шт] }` важить ~40-65 КБ. **Це збігається з 43-66 КБ.**

Сценарій:
1. На iMac давно не заходили. localStorage `levytskyi_cases` був або порожнім, або зі старим snapshot.
2. localStorage `levytskyi_drive_token` міг бути присутнім (від попереднього входу) але вже мертвий.
3. Hard reload → `useState`-init: `cases = INITIAL_CASES` (бо `levytskyi_cases` був порожнім або не парсився).
4. `driveConnected = true` (токен у localStorage є).
5. EFFECT-A стартує читати Drive. silent refresh або:
   - відпрацював, але EFFECT-B встиг запустити запис РАНІШЕ ніж readRegistry повернувся (race);
   - або не відпрацював (мовчазний fail), readRegistry повернув null (V7), length-guard заблокував `setCases` (V4).
6. EFFECT-B запустився ВЖЕ в межах того ж тіку: `driveConnected=true`, токен (свіжий або старий) є — POST/PATCH у Drive з payload, що містить INITIAL_CASES → 43-66 КБ.
7. Drive перезаписаний.
8. На наступному reload: `cases` у localStorage вже зберіг INITIAL_CASES (EFFECT-B пише в localStorage завжди). Drive теж 43-66 КБ. Death spiral.

Ключове: **навіть якщо Drive READ зрештою спрацював і повернув свіжі 156 КБ, локальний WRITE міг встигнути перезаписати їх до того.** EFFECT-A асинхронний, EFFECT-B синхронний; в одному mount EFFECT-B виконує запит до Drive раніше за EFFECT-A.

### 3.2 Файл під назвою `registry_data.json"` (з лапкою)

Описане користувачем: при відновленні з бекапу файл отримав ім'я з кінцевою лапкою. Це підтверджує V5: `_findFileId` шукає за **точним** `name='registry_data.json'`, лапка наприкінці робить імена різними. Drive повертає 0 файлів → `_findFileId` повертає null → `writeRegistry` йде по гілці "немає id" → POST multipart → **створюється новий, чистий `registry_data.json`** (V6). Старий 156 КБ файл живе поруч, але система його ігнорує.

Це **другий механізм** того ж результату: на Drive раптом виникає новий малий файл і всі наступні читання/писання йдуть проти нього.

### 3.3 Свідоме INITIAL_CASES → "Скинути дані" з Sandbox

`src/App.jsx:5030-5031` має кнопку, яка робить:
```js
localStorage.removeItem('levytskyi_cases');
setCases(normalizeCases(INITIAL_CASES));
```
Якщо випадково натиснуто (sandbox-розділ), або якщо аналогічна логіка спрацювала автоматично — отримуємо той самий 43-66 КБ payload. Це малоймовірно, але треба згадати.

### 3.4 Drive token живий, Drive файл існує, але є **другий** `registry_data.json`

V5 не фільтрує по `'<root>' in parents`. Якщо колись створювалися копії registry_data.json у бекапах/папках — `files[0]` міг повернути не той. Тоді:
- EFFECT-A прочитав маленький "не той" → `setCases` з малими даними.
- EFFECT-B зберіг вже 156-байтний state знову, але вже у "не той" id.

З огляду на те, що сам користувач казав про "лапку в назві" — імовірніше це сценарій 3.2.

### Що скоріше за все сталося насправді

Найпослідовніший наратив зі спостережень:
1. iMac прокинувся з мертвим токеном і порожнім/застарілим `levytskyi_cases`.
2. На першому ж reload EFFECT-B випередив EFFECT-A і записав ~50 КБ payload (state з INITIAL_CASES + порожні tenants/users/audit/time_entries) на Drive.
3. На повторних reload-ах death spiral підтримував ситуацію (localStorage вже мав INITIAL_CASES; Drive мав те саме; EFFECT-A читав і ставив state у "малий", EFFECT-B писав той самий "малий" знову).
4. Користувач відновлював файл із бекапу, але через помилку в назві (`json"`) система не знайшла свого "правильного" файлу і створила ще один порожній. Кожне нове підключення/reload додавало запис до НОВОГО, чистого `registry_data.json`, а 156 КБ копія лишалася у `_backups/` без ефекту.

Сценарії 3.1 і 3.2 не виключають один одного — вони могли поєднатися.

---

## 4. РЕКОМЕНДАЦІЇ (без реалізації)

Розставлено за пріоритетом — від "блокує повторення інциденту" до "загальна гігієна".

### R1. Drive-first hydration з блокувальним splash (КРИТИЧНО)
- Поки Drive не прочитано і `cases` не гідровано — UI не повинен дозволяти жодних мутацій (повний splash з прогресом / помилкою / кнопкою "Підключити Drive").
- Якщо токена нема → splash "Підключіть Google Drive" БЕЗ доступу до даних. Не показувати INITIAL_CASES як живі дані.
- Якщо токен протух і silent refresh не пройшов → splash "Сесія Drive протухла, перепідключіть". Не fallback на localStorage як на джерело правди.
- Прапор `hydrated: false` у App-state, фліпається в `true` ТІЛЬКИ після успішного `readRegistry`. EFFECT-B (write) робить ранній return якщо `!hydrated`.

### R2. Заборонити EFFECT-B писати в Drive до завершення EFFECT-A
- Додати state `driveLoadStatus: 'idle' | 'loading' | 'ok' | 'failed'`.
- EFFECT-B: `if (driveConnected && driveLoadStatus !== 'ok') return;` — тільки localStorage.
- На `failed` зберегти попередження користувачу і **категорично не писати на Drive** (інакше V2 повторить інцидент).

### R3. Write-guard: відмова перезаписати "значно менший" Drive
- Перед `writeRegistry` отримати `mtime` і `size` поточного файлу через `files.get?fields=size,modifiedTime`.
- Якщо нова payload меншa, скажімо, на >50% або кількість `cases` зменшилась більш ніж на одну від попереднього прочитаного значення → блокувати write і показати модалку "Виявлено втрату даних, підтвердіть перезапис".
- Альтернативно: підтримувати у state останній прочитаний `lastReadFingerprint` (хеш або `casesCount + tokensSize`) — будь-який запис з меншим fingerprint без явного destroy_case-аудиту блокується.

### R4. Перевірка `_backups/` перед створенням нового `registry_data.json`
- У `_findFileId` гілка "не знайдено" повинна спочатку зазирнути в `_backups/` і знайти найсвіжіший `registry_data_backup_*.json`.
- Якщо знайдено — НЕ створювати новий пустий файл, а показати модалку "Знайдено бекап X з Y справами, відновити?" і блокувати запис до рішення користувача.
- Підказка адвокату: "Якщо бачите цю модалку — НЕ натискайте 'Створити новий', спочатку розберіться з причиною."

### R5. Стабільний пошук файлу не за назвою, а за `appProperties` або власним `id`
- Drive API підтримує `appProperties` — приховані ключ-значення на файлі.
- При першому створенні `registry_data.json` ставити `appProperties.registryRole = 'main'`.
- `_findFileId` шукає `appProperties has { key='registryRole' and value='main' }` замість `name='registry_data.json'`.
- Це робить пошук стійким до перейменувань, у т.ч. випадкових (як `json"`).
- Альтернативно — зберігати `registryFileId` у власному localStorage ключі (як кеш) **і** на Drive у самому файлі (для відновлення).

### R6. Розрізняти "файл не існує" і "файл недоступний"
- `readRegistry` має повертати не `null`, а тип-результат: `{ status: 'ok', data }` / `{ status: 'not_found' }` / `{ status: 'auth_error' }` / `{ status: 'network_error' }` / `{ status: 'parse_error' }`.
- EFFECT-A розрізняє: `not_found` → ок, перший запуск, можна писати; `auth_error|network_error|parse_error` → блокуємо запис і показуємо помилку.
- Це закриває V7.

### R7. `driveConnected` має відображати ВАЛІДНІСТЬ, а не присутність токена
- На старті після ініціалізації — pingпити Drive (`files?pageSize=1` або `about?fields=user`).
- Тільки після успішного ping ставити `driveConnected = true`.
- Якщо ping не пройшов — `driveConnected = false`, запропонувати `forceConsentRefresh`.
- Закриває V1.

### R8. Інвалідація кешу `_fileId`
- Скидати `driveService._fileId` на 404/410 від PATCH-у (файл міг бути видалений під час сесії).
- Альтернативно — не кешувати взагалі, перевіряти на кожному write (одна додаткова `files.list` поточно).

### R9. Розділення localStorage на "дані" і "конфіг"
- Дані (`levytskyi_cases`, `levytskyi_notes`, `levytskyi_time_entries`, …) — переходять у IndexedDB або просто перейменовуються в `levytskyi_data.cache.cases` тощо.
- Конфіг (`levytskyi_drive_token`, `claude_api_key`, прапори міграцій) — лишаються в localStorage.
- При R1 (Drive-first) кеш даних у localStorage використовується **тільки для миттєвого відображення під час hydration**, але **ніколи** як джерело правди для запису на Drive.
- Це структурно унеможливлює V9.

### R10. Аудит на запис у Drive
- Кожен `writeRegistry` пише `audit` запис типу `drive_write` з полями `{ casesCount, byteSize, source: 'auto'|'manual', delta }`.
- При перезаписі з втратою (новий розмір < попередній на >X%) — окремий `drive_write_loss` запис.
- Дозволяє постфактум відновити, що саме і коли перезаписало файл.

### R11. Видалити "тихий" fallback на INITIAL_CASES
- INITIAL_CASES — це **демо-дані**, не виробничі. Жоден користувач реальної інсталяції не має побачити їх як свій state.
- Замість fallback `useState(() => INITIAL_CASES)` — `useState(() => [])` і блокувальний splash (R1) поки Drive не прочитав.
- INITIAL_CASES залишити лише в режимі sandbox/демо за явним прапором.

### R12. Race condition mount-mount
- Краще: оголосити EFFECT-A як `useEffect` що setуss `hydrationState`, EFFECT-B залежить від `hydrationState === 'ok'`.
- Перенести все ініціальне читання з localStorage у "транзитний кеш", не у state, щоб state починав життя порожнім.

---

## КОНТРОЛЬНІ ТОЧКИ КОДУ (для подальшого TASK)

| Вразливість | Файл | Рядки |
|---|---|---|
| V1 — driveConnected = присутність токена | src/App.jsx | 2877, 3596 |
| V2 — EFFECT-B пише без чекання EFFECT-A | src/App.jsx | 3865-3912 |
| V3 — без write-guards | src/App.jsx, App.jsx | 2923-2943, 3907 |
| V4 — length-guard на read маскує fail | src/App.jsx | 3751-3753 |
| V5 — пошук файлу за точною назвою | src/App.jsx | 2898-2906 |
| V6 — нема перевірки `_backups/` перед create | src/App.jsx | 2932-2942 |
| V7 — readRegistry зливає всі помилки в null | src/App.jsx | 2912-2920 |
| V8 — нема onboarding splash | src/App.jsx | 3331-3346, 3669-3861 |
| V9 — дані поряд з конфігом у localStorage | src/App.jsx | 3865-3877, 3331-3540 |
| V10 — кеш `_fileId` без інвалідуації | src/App.jsx | 2875, 2880, 2898-2906 |

---

**Кінець diagnostic_drive_first.md**
