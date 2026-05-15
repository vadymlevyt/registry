# TASK 0.3.4 — Naming Cleanup: document.addedBy semantic refactor

**Дата:** 2026-05-14
**Schema version:** 6 → 6.5
**Schema label:** `'6.5_addedby_cleanup'`
**Тип:** precision cleanup перед TASK 0.3.5 (canonical schema bump v7 для ЄСІТС)
**Час виконання:** 4-6 годин Claude Code

---

## КОНТЕКСТ І МЕТА

Перед TASK 0.3.5 (canonical schema bump v7 для прийому даних з ЄСІТС-кабінету і інших каналів) виявлено зіткнення двох таксономій у схемі документа:

```
document.addedBy: ['lawyer_via_dp', 'lawyer_manual', 'agent', 'ecits', 'migration']
document.source:  ['manual_upload', 'ecits', 'telegram', 'email', null]
```

Обидва поля містять значення `'ecits'`, що порушує **правило #11 DEVELOPMENT_PHILOSOPHY.md** ("одне ім'я = один сенс"). Через 3-4 тижні після старту live-синхронізації з ЄСІТС буде багато документів де `addedBy === 'ecits'` AND `source === 'ecits'`. Агенти і UI не матимуть однозначного шляху перевірки "документ з ЄСІТС".

Цей TASK розділяє відповідальності двох полів:
- `addedBy` — **ХТО/ЩО** зробило акт додавання запису в систему (actor)
- `source` — **ЗВІДКИ** прийшов файл (канал походження)

`source` в цьому TASK **НЕ ЧІПАЄМО** — його enum розширення/нормалізація включена в TASK 0.3.5 (там буде `manual_upload → manual`, `ecits → court_sync` + додавання `metadata_extractor`, `unknown`).

Це **точкова чистка** перед розширенням. Принцип DELTA: "впорядкувати перед розширенням".

---

## SEMANTIC CLARITY CHECK

**ПЕРЕД (зіткнення):**
```
addedBy === 'ecits' AND source === 'ecits'  ← обидва кажуть "ecits"
агент не знає де перевіряти "документ з ЄСІТС"
```

**ПІСЛЯ:**
```
addedBy === 'system' AND source === 'ecits'
→ "система додала автоматично, файл з ЄСІТС-каналу"

addedBy === 'user' AND source === 'manual_upload'
→ "користувач додав вручну, файл завантажив локально"

addedBy === 'agent' AND source === 'telegram'
→ "агент обробив, файл прийшов з Telegram"
```

Кожна комбінація читається без двозначності. Правило #11 виконано.

---

## ЩО ТРЕБА ЗРОБИТИ

### 1. Schema version bump

У `src/services/migrationService.js`:
- `CURRENT_SCHEMA_VERSION = 6.5` (number)
- `MIGRATION_VERSION = '6.5_addedby_cleanup'`
- Створити функцію `migrateToVersion6_5(registry)` за патерном `migrateToVersion6`

**Note:** number 6.5 потрібен щоб порівняння `< 6.5` працювало правильно у App.jsx EFFECT-A. Це допустимий формат, всі попередні версії — цілі числа, тут одиничне виключення для точкового cleanup.

### 2. Enum зміна у documentSchema.js

У `src/schemas/documentSchema.js` змінити поле `addedBy`:

**ПЕРЕД:**
```js
addedBy: {
  type: 'string',
  enum: ['lawyer_via_dp', 'lawyer_manual', 'agent', 'ecits', 'migration'],
  default: 'lawyer_manual',
  description: 'Хто/як додано'
}
```

**ПІСЛЯ:**
```js
addedBy: {
  type: 'string',
  enum: ['user', 'agent', 'system'],
  default: 'user',
  description: 'ХТО/ЩО зробило акт додавання запису. user = адвокат чи помічник вручну. agent = AI-агент (QI, dossier, document processor, etc). system = системна дія (міграція, автоматична синхронізація з зовнішніх каналів). Не плутати з document.source — там канал ПОХОДЖЕННЯ файлу, не actor.'
}
```

### 3. Оновити documentFactory.js

У `src/services/documentFactory.js`:

- Default `addedBy` для нових документів — `'user'` (якщо не передано)
- Якщо передано старе значення `'lawyer_via_dp'` або `'lawyer_manual'` — нормалізувати на `'user'`
- Якщо передано `'ecits'` або `'migration'` — нормалізувати на `'system'`
- Якщо передано `'agent'` — лишити як є
- Невалідне значення — fallback на `'user'` з warning у console:
  ```
  [documentFactory] Unknown addedBy value '<X>', falling back to 'user'
  ```

Це **зворотна сумісність** — якщо десь у коді ще залишилось передавання старого значення (мав знайти всі точки, але safety net), документ створиться правильно.

### 4. Міграція існуючих документів

`migrateToVersion6_5(registry)`:

Для кожного документа у `cases[].documents[]`:

```js
function migrateAddedBy(oldValue) {
  if (oldValue === 'lawyer_via_dp') return 'user';
  if (oldValue === 'lawyer_manual') return 'user';
  if (oldValue === 'agent') return 'agent';
  if (oldValue === 'ecits') return 'system';
  if (oldValue === 'migration') return 'system';
  if (oldValue === undefined || oldValue === null) return 'user';
  // невідоме значення (не повинно бути, але safety) — fallback
  console.warn(`[TASK 0.3.4] Unknown addedBy value: ${oldValue}, defaulting to 'user'`);
  return 'user';
}
```

**Бекап перед міграцією:**
- Створити нову функцію `backupRegistryDataPreV6_5(registry)` у `driveService.js`
- Бекап пишеться в `_backups/registry_data_backup_pre_v6_5_<timestamp>.json` на Drive
- Прапор `levytskyi_pre_v6_5_backup_done` у localStorage (одноразовість)

**Console output під час міграції:**
```
[TASK 0.3.4] Starting addedBy cleanup migration v6 → v6.5...
[TASK 0.3.4] Backed up registry to: <path>
[TASK 0.3.4] Migrated N documents addedBy:
  lawyer_via_dp → user: A
  lawyer_manual → user: B
  agent → agent (no change): C
  ecits → system: D
  migration → system: E
  (other/null → user): F
[TASK 0.3.4] Migration v6 → v6.5 done
```

### 5. Оновити App.jsx EFFECT-A

У `App.jsx` (приблизно рядки 3970-4070, ланцюг міграцій) додати після `migrateToVersion6`:

```js
if ((registry.schemaVersion || 1) < 6.5) {
  // pre_v6_5 backup
  try {
    const flag = localStorage.getItem('levytskyi_pre_v6_5_backup_done');
    if (!flag) {
      await backupRegistryDataPreV6_5(registry);
      localStorage.setItem('levytskyi_pre_v6_5_backup_done', '1');
    }
  } catch (e) {
    console.warn('[TASK 0.3.4] Pre-v6.5 backup failed:', e);
    // не блокер — міграція продовжується
  }
  
  // міграція
  const v6_5 = migrateToVersion6_5(registry);
  if (v6_5.didMigrate) {
    registry = v6_5.registry;
    didMigrate = true;
    fromVersion = Math.min(fromVersion, 6);
    toVersion = 6.5;
  }
}
```

Порядок викликів у EFFECT-A:
1. `migrateRegistry(raw)` → v4
2. `migrateRegistryV4toV5(registry)` → v5
3. `migrateToVersion6(registry)` → v6
4. **NEW:** `migrateToVersion6_5(registry)` → v6.5

### 6. Точки використання в коді — оновлення

Знайти всі місця де передається `addedBy` зі старим значенням:

**Очікувані точки (на основі попереднього аудиту):**
- `App.jsx` — INITIAL_CASES seed (можливо передає `lawyer_manual` або `lawyer_via_dp`)
- `DocumentProcessor/index.jsx` — handleConfirm, handleSplit (можливо передає `lawyer_via_dp`)
- `CaseDossier/index.jsx` — модалка "+ Новий документ" (можливо передає `lawyer_manual`)
- `migrationService.js` — інші міграції які створюють документи (передають `migration`)

**Дія:** замінити всі такі передавання на нові значення:
- `lawyer_via_dp`, `lawyer_manual` → `'user'`
- `ecits` → `'system'`
- `migration` → `'system'`
- `agent` → лишити як є

**Note:** `documentFactory.createDocument()` нормалізує старі значення (з пункту 3), тому якщо десь забули — system не зламається, але треба зачистити для уніфікації.

### 7. Тести — оновлення

**Існуючі тести які зламаються:**

`tests/unit/documentSchema.test.js` (приблизно):
```js
// Було:
expect(canonicalDocument.addedBy.enum).toEqual([
  'lawyer_via_dp', 'lawyer_manual', 'agent', 'ecits', 'migration'
]);

// Стає:
expect(canonicalDocument.addedBy.enum).toEqual(['user', 'agent', 'system']);
```

`tests/unit/documentFactory.test.js` (приблизно):
```js
// Було:
expect(doc.addedBy).toBe('lawyer_manual');

// Стає:
expect(doc.addedBy).toBe('user');
```

`tests/unit/migrations.test.js`:
- Додати новий test case: міграція v6 → v6.5
- Перевірити: всі legacy values переводяться правильно
- Перевірити: ідемпотентність (повторний запуск не ламає)
- Перевірити: невалідне значення → fallback з warning

**Інтеграційний harness `tests/integration/_actionsHarness.js`:**
- Якщо створює документи з `addedBy` — оновити старі значення на нові

### 8. CLAUDE.md — оновлення

У CLAUDE.md оновити:

**Поточний schemaVersion і settingsVersion (рядки 5-6):**
```
Поточний schemaVersion: 6.5
Поточний settingsVersion: "6.5_addedby_cleanup"
```

**У розділі "СТРУКТУРА ДАНИХ → Справа (Case) → documents":**

Знайти рядок `addedBy, status` у переліку 18 канонічних полів і додати коментар:
```js
addedBy,     // 'user' | 'agent' | 'system' — actor що зробив акт додавання
             // НЕ плутати з document.source (канал походження файлу)
status
```

**Додати новий короткий розділ "ADDEDBY VS SOURCE — DISAMBIGUATION"** (10-15 рядків):
```
## ADDEDBY VS SOURCE — DISAMBIGUATION

Два паралельні поля документа відповідають на РІЗНІ питання:

document.addedBy — ХТО/ЩО зробило акт додавання запису в систему:
  - 'user' — адвокат чи помічник вручну (через UI або модалку)
  - 'agent' — AI-агент (QI, Dossier, DocumentProcessor)
  - 'system' — системна дія (міграція, автосинхронізація)

document.source — ЗВІДКИ прийшов файл (канал походження):
  - 'manual_upload' — завантажено локально
  - 'ecits' — з ЄСІТС-кабінету (буде нормалізовано на 'court_sync' у v7)
  - 'telegram' — з Telegram
  - 'email' — з email
  - null — невідомо

Приклад:
  Документ з ЄСІТС через автосинхронізацію →
    { addedBy: 'system', source: 'ecits' }
  Адвокат вручну завантажив скан →
    { addedBy: 'user', source: 'manual_upload' }
  Агент обробив документ з Telegram →
    { addedBy: 'agent', source: 'telegram' }
```

### 9. Git commit і push

Після виконання всіх змін:
```bash
git add -A
git commit -m "TASK 0.3.4: addedBy semantic cleanup (v6 → v6.5)"
git push origin main
```

---

## ACCEPTANCE CRITERIA

- [ ] `CURRENT_SCHEMA_VERSION = 6.5`, `MIGRATION_VERSION = '6.5_addedby_cleanup'` у migrationService.js
- [ ] `migrateToVersion6_5(registry)` функція створена за патерном `migrateToVersion6`
- [ ] `documentSchema.js` enum `addedBy` змінено на `['user', 'agent', 'system']`
- [ ] `documentFactory.js` нормалізує старі значення на нові з fallback на `'user'`
- [ ] Backup `pre_v6_5` створюється на Drive перед першою міграцією
- [ ] localStorage прапор `levytskyi_pre_v6_5_backup_done` запобігає повторному backup
- [ ] `App.jsx` EFFECT-A викликає `migrateToVersion6_5` після `migrateToVersion6`
- [ ] Всі точки створення документів передають нові значення (`user`/`agent`/`system`)
- [ ] Console.log звітує кількість мігрованих документів по кожному типу
- [ ] `documentSchema.test.js` оновлено — новий enum, тест зелений
- [ ] `documentFactory.test.js` оновлено — нові default values, тест зелений
- [ ] `migrations.test.js` має новий test case для v6 → v6.5 (legacy values, ідемпотентність, fallback)
- [ ] `_actionsHarness.js` оновлено якщо створює документи з `addedBy`
- [ ] CLAUDE.md оновлено — schemaVersion 6.5, новий розділ "ADDEDBY VS SOURCE"
- [ ] Vite build success без нових warnings
- [ ] Всі попередні тести залишаються зеленими після оновлення
- [ ] Git commit + push успішний

---

## ЩО НЕ РОБИТИ

- НЕ чіпати поле `document.source` (це частина TASK 0.3.5)
- НЕ чіпати інші enum'и в системі
- НЕ створювати новий ACTION (поле `addedBy` не редагується через UI чи агента — це internal)
- НЕ перейменовувати поле `addedBy` (нові значення прозорі, перейменування зайве)
- НЕ робити schema bump повним числом (6 → 7) — це частина TASK 0.3.5
- НЕ зачіпати `case.team[]`, `proceeding.judges`, `case.client` (інші TASK)

---

## SAAS IMPLICATIONS

Зміна не зачіпає multi-tenant архітектуру. Нові значення `user/agent/system` зберігаються per-document, як і раніше. У SaaS-майбутньому:
- `addedBy: 'user'` поєднується з `createdBy: userId` для визначення конкретного користувача
- `addedBy: 'agent'` поєднується з `aiUsage.agentType` для відстеження якого саме агента
- `addedBy: 'system'` означає системну дію (для аудиту і per-tenant аналітики)

Per-tenant аналітика стає **точнішою** після cleanup — можна порахувати "скільки документів агенти створили в tenant X", не плутаючи з ручним додаванням.

---

## BILLING IMPLICATIONS

Зміна не зачіпає білінг. Поле `addedBy` не використовується для розрахунку time_entries. activityTracker працює через інші сигнали.

---

## AI USAGE IMPLICATIONS

Зміна не зачіпає AI usage telemetry. `ai_usage[]` пишеться через інші сигнали при виклику моделей. Однак для майбутньої аналітики `addedBy: 'agent'` дає чіткіший фільтр "документи створені AI" для оператора SaaS.

---

## SEMANTIC CLARITY CHECK (РЕЗУЛЬТАТ)

Після цього TASK:
- ✅ `addedBy` має чіткі 3 значення без перекриття з `source`
- ✅ Кожна комбінація `addedBy + source` читається однозначно
- ✅ Правило #11 DEVELOPMENT_PHILOSOPHY.md виконано
- ✅ Підготовлено ґрунт для TASK 0.3.5 (canonical schema bump v7)

---

## ЗВІТ ПІСЛЯ ВИКОНАННЯ

Створити `report_task_0_3_4_addedby_cleanup.md` з:
- Перелік змінених файлів
- Console.log виводу міграції (кількість документів кожного типу)
- Список оновлених тестів
- Підтвердження що всі тести зелені
- Підтвердження що git push успішний (вивід `git log -1`)
- Будь-які побічні знахідки (якщо знайдені — у `bugs_found_during_task_0_3_4.md`)

---

**Кінець TASK 0.3.4.**

**Після виконання — повертаємось до TASK 0.3.5 (canonical schema bump v7) на чистій базі.**
