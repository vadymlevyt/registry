# Canvas — серверна дата-модель (Postgres + RLS)

**Дата:** 2026-06-27
**Тип:** keeper — серверна архітектура зберігання/доступу Canvas. **Переформульовує розділи
зберігання v1.5 під серверну еру** (Postgres замість Drive-файлів) і фіксує модель ізоляції/шару.
**Парні візії:** `canvas_context_model_v1_5.md` (мульти-таб, контекст, прив'язані документи,
зберігання — писалось під клієнт+Drive), `context_canvas_constructor_v1.md` (базова візія v1.0).
**Статус:** архітектурне рішення сесії 2026-06-27; уточнюється при TASK Canvas на сервері.

---

## 0. Стратегічне переформулювання (чому Canvas — серверний)

Візія v1.5 проектувала зберігання Canvas під **клієнт+Drive**: тіло кожного документа окремим
файлом `/cases/{caseId}/canvas/{docId}.json` + легкий `_index.json`, три рівні персистентності,
`canvasContextManager`, що вантажить/вивантажує тіла з Drive. Через серверну лінзу
(**переживає / розчиняється**):

- **Розчиняється** (сервер замінює): усе сховище-обвʼязка v1.5 — `_index.json`, lazy load/unload
  тіл, «джерело правди у файлі, індекс — похідна», контекст-менеджер над Drive-файлами. У БД це
  **рядок + запит**, безкоштовно.
- **Переживає** (шар А, портативне): block-модель документа, тули (ACTIONS), редактор за фасадом
  `editorService`, експорт block-JSON → `.docx`/PDF. Це зберігається як специфікація.

Тому Canvas **будувати на сервері**, не на поточному стеку. Додатковий аргумент: поточний стек
не має контролю конкурентності (last-write-wins, без локів) — а спільне редагування Canvas
цього потребує (нижче — це **фіча**, не ядро). Прецедент деферу — A5-метадані
(`handoff_2026-06-23_metadata_a5_decisions_and_deferral.md`): «джерело даних → БД = rework».

---

## 1. Модель доступу (уточнення власника)

**За замовчуванням кожен документ Canvas ізольований у власника.** Спільне редагування — **опційна
фіча, не ядро**: власник свідомо **ділиться конкретним документом** з обраними користувачами свого
тенанта; тоді документ стає доступний їм і може правитись спільно.

Це підручниковий **RLS**: видно там, де `owner_id = ти` (ізоляція) АБО є рядок явного шару; усе в
межах `tenant_id`.

---

## 2. Таблиці (5 основних)

```sql
-- 1. Документ Канви (заголовок + жива робоча копія тіла)
create table canvas_documents (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  case_id           uuid,                        -- null = шаблон/акт рівня тенанту (рішення §7)
  owner_id          uuid not null,               -- ЯКІР ІЗОЛЯЦІЇ
  title             text,
  doc_type          text,                        -- klopotannya | vidziv | akt ...
  category          text,
  status            text default 'draft',        -- draft | final | archived
  is_template       boolean default false,       -- §21.19 v1.5 — шаблон = документ із прапором
  template_scope    text,                        -- null | 'case' | 'tenant'
  body              jsonb not null default '[]', -- масив блоків (жива копія; до неї біндиться редактор)
  document_settings jsonb,                        -- шрифт/поля/інтервал (TNR 14, 3/2/2/2…)
  current_version   int default 1,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- 2. Версії (§14 v1.0 — снапшот на КОЖНУ значущу правку, не на кожну клавішу)
create table canvas_document_versions (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references canvas_documents(id) on delete cascade,
  version_no     int not null,
  body           jsonb not null,                 -- снапшот блоків
  author_type    text not null,                  -- 'user' | 'agent'
  author_id      uuid,
  action         text,                           -- instantiate | manual_edit | update_block | apply_to_selection
  changed_blocks jsonb,                           -- ['motivational', ...] — для дифф-візуалізації
  created_at     timestamptz default now(),
  unique (document_id, version_no)
);

-- 3. ЯВНИЙ шар документа (серце моделі ізоляції)
create table canvas_document_shares (
  document_id      uuid not null references canvas_documents(id) on delete cascade,
  grantee_user_id  uuid not null,
  permission       text not null default 'edit', -- 'view' | 'comment' | 'edit'
  granted_by       uuid not null,
  created_at       timestamptz default now(),
  primary key (document_id, grantee_user_id)
);

-- 4. Прив'язані в'юер-документи (§21.11 v1.5 — ребро на документ справи)
create table canvas_attached_documents (
  canvas_document_id uuid not null references canvas_documents(id) on delete cascade,
  source_document_id uuid not null,              -- → documents(id) тієї ж справи (01_ОРИГІНАЛИ)
  order_index        int default 0,
  is_last_active     boolean default false,      -- «останній активний у в'юері»
  attached_at        timestamptz default now(),
  primary key (canvas_document_id, source_document_id)
);

-- 5. Сесія Канви по справі (§21.13 рівень 2 — ПЕР-ЮЗЕР робочий стіл)
create table canvas_sessions (
  user_id       uuid not null,
  case_id       uuid not null,
  open_tab_ids  jsonb default '[]',              -- впорядкований список id відкритих вкладок
  active_tab_id uuid,
  updated_at    timestamptz default now(),
  primary key (user_id, case_id)
);
```

**Рішення body-as-jsonb:** тіло = масив блоків у `jsonb`-колонці `canvas_documents.body` (жива копія,
до неї біндиться редактор). Снапшот у `canvas_document_versions` пишеться **на значущу правку**
(агент/тул/commit ручної правки), НЕ на кожну клавішу. `update_block` = `jsonb_set(body, '{<blockId>}', …)`.

---

## 3. RLS — ключова політика (та сама ізоляція)

```sql
alter table canvas_documents enable row level security;

-- ЧИТАННЯ: власник, АБО явно пошарено, АБО шаблон — усе в межах тенанту
create policy cd_select on canvas_documents for select using (
  tenant_id = app.current_tenant() and (
    owner_id = auth.uid()
    or exists (select 1 from canvas_document_shares s
               where s.document_id = id and s.grantee_user_id = auth.uid())
    or is_template = true                          -- шаблони видно тенанту (рішення §7)
  )
);

-- ЗМІНА: власник завжди; пошарений — лише якщо його grant = 'edit'
create policy cd_update on canvas_documents for update using (
  tenant_id = app.current_tenant() and (
    owner_id = auth.uid()
    or exists (select 1 from canvas_document_shares s
               where s.document_id = id and s.grantee_user_id = auth.uid()
                 and s.permission = 'edit')
  )
);

create policy cd_insert on canvas_documents for insert
  with check (tenant_id = app.current_tenant() and owner_id = auth.uid());
create policy cd_delete on canvas_documents for delete
  using (tenant_id = app.current_tenant() and owner_id = auth.uid());

-- Шарити може ЛИШЕ власник, і лише юзеру свого тенанту
create policy cds_insert on canvas_document_shares for insert with check (
  exists (select 1 from canvas_documents d
          where d.id = document_id and d.owner_id = auth.uid()
            and d.tenant_id = app.current_tenant())
  and exists (select 1 from memberships m
              where m.user_id = grantee_user_id and m.tenant_id = app.current_tenant())
);
```

`canvas_document_versions` і `canvas_attached_documents` доступ **успадковують** від батьківського
документа (політика через `exists … canvas_documents`). `canvas_sessions` — суто `user_id = auth.uid()`.

---

## 4. Звʼязок із `case.team[].permissions` (два РІЗНІ рівні)

- **Case-level** (`case.team[].permissions`, 7 булевів) — пускає в **справу** (досьє, матеріали,
  засідання). `canShare` тут може гейтити, чи юзеру взагалі *дозволено* шарити Canvas-документи;
  `canRunAI` — чи може кликати агента в Канві (точка білінгу AI).
- **Document-level** (`canvas_document_shares`) — пускає в **конкретний документ Канви**. Членство в
  команді справи **не** дає доступу до чужих документів Канви тієї справи. Лише явний шар.

Не плутати (правило #11): бути в команді справи ≠ доступ до особистих чернеток у справі.

---

## 5. Три рівні персистентності (§21.13 v1.5) → де лягають

| Рівень v1.5 | На сервері | Чому |
|---|---|---|
| L1 документ (вічно) | `canvas_documents` + `_versions` + `_attached` | транзакції + версії + локи рядка → тихого затирання немає за визначенням |
| L2 сесія Канви (робочий стіл) | `canvas_sessions` (пер-юзер) | особистий стан «які вкладки відкриті» |
| L3 видимість між вкладками (сесійна) | **НЕ таблиця** — Realtime presence / памʼять клієнта | «що зараз на столі поруч» зникає на виході — як хоче візія |

Уся механіка v1.5 (`_index.json`, lazy load/unload, «джерело у файлі, індекс похідний») **зникає**:
індекс = `SELECT`, тіло = рядок, контекст-менеджер = запити до БД (+ pgvector для холодного шару пізніше).

---

## 6. Спільне редагування — як «фіча» (не ядро)

- **Дефолт (один власник)** — single-writer, жодної проблеми.
- **Пошарений документ** — Postgres дає рядкові локи + таблиця версій ловить розбіжності →
  тихого псування немає навіть без нічого додаткового. Це покриває «спільно правити».
- **Живі курсори в реальному часі** — подальший **опційний** шар: Supabase Realtime + згодом CRDT
  над `body jsonb`. У v1 не потрібен.

---

## 7. Тули — зверху, без зміни природи

`update_block` → `UPDATE canvas_documents SET body = jsonb_set(body, '{<blockId>}', …)`, виконаний
через **той самий `executeAction`** (тепер серверний, під RLS) — та петля, що вже працює для агента
досьє (`runMultiTurnConversation` + `DOSSIER_AGENT_TOOLS` = 19 тулів). Canvas-тули (`create_canvas_tab`,
`update_block`, `apply_to_selection`, `attach_viewer_document`…) — нові записи в `toolDefinitions`/ACTIONS.
Портативний шар А.

---

## 8. Рішення для TASK Canvas (на потім)
1. **`case_id` nullable?** — чи живе документ завжди в справі, чи буває рівня тенанту (типовий акт/шаблон).
2. **Шаблони видно всьому тенанту?** — політика `is_template = true` вище це робить; приватні шаблони → `template_scope`.
3. **`bureau_owner` наскрізний нагляд** над усіма документами Канви тенанту, чи ізоляція абсолютна (дефолт власника — ізоляція).

---

## 9. Що переживає / що переписується
- **Переживає як специфікація** (з v1.0/v1.5): block-модель, тули, редактор-фасад (`editorService`,
  провайдерна модель §21.18), експорт `.docx`/PDF (планки PDF≈один-в-один / Word=структура §21.17),
  шаблони як прапорець, «усе є тул», прив'язані в'юер-документи як метадані.
- **Переписується під сервер** (розділи зберігання v1.5 21.13-21.16): персистентність, індекс,
  контекст-менеджер, три стани вкладки — у цю дата-модель.
