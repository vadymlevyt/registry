# Рекомендований TASK: Аудит CLAUDE.md

**Створено:** 2026-05-04 під час TASK SaaS Foundation v1
**Виконавець:** Claude Code Opus 4.7 (1M context)
**Контекст:** Q1 від адвоката — оновлення CLAUDE.md винесено в окрему задачу.

---

## Ціль

Привести CLAUDE.md у відповідність до фактичного стану системи. Вирівняти текст з кодом — щоб майбутні Claude Code сесії мали правдивий контекст.

## Виявлені застарілі розділи

### 1. Стек і архітектура (рядок 5)

**Зараз написано:**
```
Стек: React 18 + Babel CDN, один файл index.html (~3100 рядків).
```

**Реальність:**
- Vite 6 + React 18 + ES modules
- `index.html` — 15 рядків (тільки `<div id="root">` + `<script type="module">`)
- `src/App.jsx` — **4391 рядок** (після SaaS Foundation — ~4500)
- `src/components/{Dashboard, CaseDossier, DocumentProcessor, Notebook}` — окремі файли по 700-2700 рядків
- `src/services/{driveAuth, driveService, ocrService, ocr/, tenantService, permissionService, auditLogService, migrationService}`

**Пропоновано:**
```
Стек: React 18 + Vite 6 + ES modules.
Структура:
  - index.html — entry-point (мінімальний)
  - src/App.jsx — головний компонент і state-orchestrator
  - src/components/<Module>/index.jsx — модулі (Dashboard, CaseDossier, Notebook, DocumentProcessor)
  - src/services/ — бізнес-сервіси (Drive, permissions, migration, OCR)
Хостинг: GitHub Pages — https://vadymlevyt.github.io/registry/
Білд: npm run build (Vite → dist/)
```

### 2. Розділ «ПІСЛЯ VITE (не зараз)» (рядки 107-112)

**Зараз:**
```
## ПІСЛЯ VITE (не зараз)
- Блокнот — src/components/Notebook/
- Календар — src/components/Calendar/
- Досьє справи — src/components/CaseDossier/
- Google Picker API для Drive файлів
- Семантична перевірка дублів документів
```

**Реальність:**
- Notebook — **уже** в `src/components/Notebook/`
- CaseDossier — **уже** в `src/components/CaseDossier/`
- Календар — **окремого модуля немає**, реалізовано всередині Dashboard
- Google Picker API — не реалізовано
- Семантична перевірка дублів — не реалізовано

**Пропоновано:** видалити маркер «не зараз» (Vite уже виконано); перейменувати в «ВІДКЛАДЕНО НА МАЙБУТНЄ» і лишити тільки те що ще не зроблено: Google Picker API, семантична перевірка дублів. Календар — окремим пунктом «винесення з Dashboard».

### 3. Розділ «ПОТОЧНИЙ СТАН» (рядки 164-166)

**Зараз:**
```
Фаза 1 завершена. Фаза 2 в процесі.
Наступний крок: перехід на Vite (потрібен десктоп).
```

**Реальність:** Vite уже на main (з commit'у в районі квітня 2026). SaaS Foundation v1 — щойно завершено цим TASK.

**Пропоновано:**
```
## ПОТОЧНИЙ СТАН
- Vite migration: ✅ завершено
- Модульна структура (Dashboard/CaseDossier/Notebook/DocumentProcessor): ✅ завершено
- SaaS Foundation v1 (tenants/users/auditLog/permissions): ✅ 2026-05-04
- Наступне: tool use підготовка / Canvas / CRM-білінг (TASK черга)
```

### 4. Розділ «СТРУКТУРА ДАНИХ» (рядки 91-105)

**Зараз:** опис дуже стислий, але не охоплює реальну форму справи. Поля типу `hearing_date`/`hearing_time` — вже мігровані в `hearings[]`.

**Пропоновано:** замінити на більш точну схему (як зараз у `normalizeCases`):

```
### Справа (Case)
{
  id, name, client, category, status, court, case_no, judge, next_action,
  userId, createdAt, updatedAt,
  hearings: [{ id, date, time, duration, status, type, court?, notes? }],
  deadlines: [{ id, name, date }],
  notes: [{ id, text, category, ... }],
  pinnedNoteIds: [],
  timeLog: [],
  agentHistory: [],
  // SaaS v2:
  tenantId, ownerId, team[], shareType, externalAccess[]
}

### Notes (поза справою)
localStorage 'levytskyi_notes' — bucket-об'єкт:
  { cases: [], general: [], content: [], system: [], records: [] }
SaaS v2: кожна нота має tenantId, createdBy.

### Drive sync
registry_data.json v2 — об'єкт {schemaVersion, tenants, users, auditLog, structuralUnits, cases}
```

### 5. Розділ «AGENT HISTORY — ПРАВИЛО» (рядки 150-156)

**Зараз:** «Зараз: agentHistory: [] — порожній масив... В майбутньому: окремий файл agent_history.json».

**Реальність:** **3 паралельних джерела** одночасно:
1. `cases[i].agentHistory` (registry_data.json)
2. `localStorage.agent_history_<caseId>` (CaseDossier:446)
3. `agent_history.json` на Drive (CaseDossier:517)

Це архітектурний борг. Зафіксовано в `bugs_found_during_saas_foundation.md`. Окрема TASK буде вирішувати що робити.

**Пропоновано:** оновити розділ — згадати про 3 джерела і відсилка до bug-файлу. Не міняти код у межах audit-задачі.

### 6. Розділ «Дії в sendChat» (рядки 72-77)

**Зараз:**
```
Дії в sendChat — обробники є для:
update_case_date, update_deadline, update_case_field,
update_case_status, delete_case, create_case, save_note
```

**Реальність:** sendChat (App.jsx:~1700-2200) має обробники набагато ширше — створює засідання, дедлайни, додає/видаляє/оновлює нотатки/засідання/дедлайни через `executeAction`. Назви дій з QI промпта — не повний перелік.

**Пропоновано:** замінити на посилання: «реєстр дій див. `ACTIONS` в App.jsx + `PERMISSIONS` (qi_agent), 19 дій. Промпти: `HAIKU_SYSTEM_PROMPT` (parser) і `SONNET_CHAT_PROMPT` (chat)».

### 7. КРИТИЧНІ ПРАВИЛА — додати №6 і №7

**Пропоновано додати:**

#### КРИТИЧНЕ ПРАВИЛО №6 — schemaVersion registry_data.json
- Поточна версія: `schemaVersion: 2`.
- При зміні структури — інкрементувати, додати міграцію в `migrationService.js`.
- Міграція має бути ідемпотентною (повторні запуски не ламають дані).
- Перед першою міграцією — обов'язковий бекап `registry_data_backup_pre_<name>_<ts>.json` у `_backups/` поза ротацією.

#### КРИТИЧНЕ ПРАВИЛО №7 — executeAction async
- `executeAction` — **async**. Усі callers що читають `.success`/`.error` — мусять `await`.
- Fire-and-forget виклики (без читання результату) безпечні.
- Перед merge будь-яких змін — перевірити що нові callers не читають Promise як sync-об'єкт.

---

## Скоуп майбутнього TASK

1. Замінити рядок 5 (стек) на пропозицію з пункту 1 цього файлу.
2. Видалити/переробити «ПІСЛЯ VITE» (пункт 2).
3. Оновити «ПОТОЧНИЙ СТАН» (пункт 3).
4. Перепідготувати «СТРУКТУРА ДАНИХ» (пункт 4).
5. Уточнити «AGENT HISTORY — ПРАВИЛО» (пункт 5).
6. Замінити «Дії в sendChat» (пункт 6).
7. Додати критичні правила №6 і №7 (пункт 7).
8. (Опціонально) додати посилання на ключові файли через `path:line`.

**Орієнтовно:** 30 хв роботи Claude Code.

---

## Приоритет

**Низький.** Не блокує жоден інший TASK. Корисно зробити перед наступним великим епіком (Tool Use / Canvas / CRM) — щоб Claude Code мав свіжий контекст.
