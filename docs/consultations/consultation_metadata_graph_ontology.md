# Метадані → Граф → Онтологія: інвентаризація і класифікація

**Тип:** консультація / архітектурна нотатка (адмін-сесія)
**Дата:** 2026-06-08
**Призначення:** інвентаризувати ВСІ метадані системи, класифікувати сутності
(вузли), що вже промальовуються, показати зв'язки (ребра) і чесно відмітити —
**що вже графопридатне, а що ні**. Орієнтир для майбутнього шару графа/онтології.
Це не TASK — це карта території.

> Джерела з коду: `src/schemas/documentSchema.js` (документ), `src/services/migrationService.js`
> (`migrateCase`, `ensureCaseSaasAndEcitsFields`, `buildDefaultEcitsState`), CLAUDE.md
> (розділи СТРУКТУРА ДАНИХ, КАНОНІЧНИЙ СТАН). Зчитано з коду, не з пам'яті.

---

## 0. Головна теза

Контент (текст) — для людини. **Метадані — для системи**: структуровані факти,
на які машина ДІЄ (правила, дедлайни, контекст для AI, хронологія, перевірка
прогалин). Частина полів — **атрибути** (описують сутність), частина —
**зв'язки** (ребра між сутностями). Саме зв'язки-через-посилання роблять метадані
**графопридатними** — насінням майбутнього графа знань і онтології.

**Шкала зрілості поля:**
- 🟢 **EDGE-ID** — посилання на сутність через стабільний ID → готове ребро графа.
- 🟡 **EDGE-WEAK** — зв'язок є, але через вільний текст/inline-об'єкт без стабільного
  ID → сутність не зв'язується між справами (потребує нормалізації).
- 🔵 **CLASS** — enum-тип (членство в класі: «це судовий акт») → в онтології стає типом.
- ⚪ **ATTR** — описовий атрибут (дата, розмір) → не ребро, але корисний для дій/фільтра.

---

## 1. ІНВЕНТАРИЗАЦІЯ СУТНОСТЕЙ (вузли, що промальовуються)

| # | Сутність | Ключ | Де визначено | Статус як вузол |
|---|----------|------|--------------|-----------------|
| 1 | **Tenant** (організація) | `tenantId` | tenants[] | 🟢 first-class |
| 2 | **User** (адвокат/помічник) | `userId` | users[] | 🟢 first-class |
| 3 | **Case** (справа) | `id` (`case_*`) | cases[] | 🟢 first-class |
| 4 | **Proceeding** (провадження) | `proceedings[].id` | case.proceedings[] | 🟢 first-class |
| 5 | **Document** (документ) | `id` (`doc_*`) | case.documents[] | 🟢 first-class |
| 6 | **Hearing** (засідання) | `id` | case.hearings[] | 🟢 first-class (в межах справи) |
| 7 | **Deadline** (строк) | `id` | case.deadlines[] | 🟢 first-class (в межах справи) |
| 8 | **Note** (нотатка) | `id` | case.notes[] / localStorage | 🟢 first-class (в межах справи) |
| 9 | **TimeEntry** (облік часу) | `id` (`te_*`) | time_entries[] | 🟢 first-class, багато ребер |
| 10 | **Party / Person** (сторона/особа) | — | case.parties[], processParticipants[] | 🟡 **промальовується, БЕЗ стабільного ID** |
| 11 | **Court** (суд) | — | case.court (рядок), hearing.court | 🟡 **кандидат, поки вільний текст** |
| 12 | **Client** (клієнт) | — | case.client (рядок) | 🟡 **кандидат, поки вільний текст** (борг) |
| 13 | **Judge** (суддя) | — | case.judge / judges (рядок) | 🟡 **кандидат, поки вільний текст** (борг) |
| — | AI usage | `usage_*` | ai_usage[] | ⚙️ операційна телеметрія, НЕ доменний вузол |

**Висновок по вузлах:** 9 сутностей уже **first-class** (мають стабільний ID).
3 ключові юридичні сутності — **Party, Court, Judge/Client** — поки **вільний
текст**, тому НЕ зв'язуються між справами. Це головний розрив до графа.

---

## 2. ІНВЕНТАРИЗАЦІЯ МЕТАДАНИХ — ДОКУМЕНТ

Легкі поля (`documentSchema.js`), класифіковані:

| Поле | Клас | Що це / куди веде ребро |
|------|------|--------------------------|
| `id` | 🟢 EDGE-ID | сам вузол Document |
| `procId` | 🟢 EDGE-ID | Document → **Proceeding** (належить) |
| `addedBy` | 🔵 CLASS | actor: user/agent/system |
| `source` | 🔵 CLASS | канал: manual/court_sync/metadata_extractor/telegram/email |
| `author` | 🔵 CLASS / 🟡 | **роль** автора (ours/opponent/court/third_party) — зв'язок до РОЛІ, не до конкретної Party |
| `category` | 🔵 CLASS | тип документа (судовий акт/позов/...) — клас в онтології |
| `documentNature` | 🔵 CLASS | searchable/scanned |
| `namingStatus`, `status`, `textFormat` | 🔵 CLASS | стани lifecycle/формату |
| `isKey` | ⚪ ATTR (важливий!) | прапор «ядровий» — керує участю в контексті AI |
| `name`, `originalName`, `icon` | ⚪ ATTR | людська ідентифікація |
| `date` | ⚪ ATTR (ключовий для хронології) | дата документа → стрічка руху |
| `addedAt`, `updatedAt`, `extractedAt`, `cleanedAt` | ⚪ ATTR | часові мітки |
| `pageCount`, `size` | ⚪ ATTR | обсяг (бюджет контексту §7.3) |
| `driveId`, `driveUrl`, `originalDriveId`, `folder` | ⚪ ATTR (storage) | посилання на файл у сховищі (не доменне ребро) |
| `originalMime` | ⚪ ATTR | тип оригіналу |
| `sourceConfidence` | ⚪ ATTR | довіра до джерела |
| `variants` | ⚪ ATTR | стан AI-очистки |
| `ecitsSource` | 🟢 EDGE-ID (частково) | → **User** (receivedThroughCabinet.userId), ЄСІТС-ідентифікатори |
| `movementCard` | 🟡 EDGE-WEAK | доставки → учасникам (deliveries[]) — структуровано, але учасники без ID |
| `alternativeSources` | 🟡 EDGE-WEAK | provenance: той самий документ з інших каналів |

Важкі (extended): `tags` (🔵 вільна класифікація), `annotations`, `notes`,
`processingHistory`, `extractedTextSummary`, `attentionNotes`, `customFields` — переважно ⚪ ATTR.

---

## 3. ІНВЕНТАРИЗАЦІЯ МЕТАДАНИХ — СПРАВА

| Поле | Клас | Що це / куди веде ребро |
|------|------|--------------------------|
| `id` | 🟢 EDGE-ID | сам вузол Case |
| `tenantId` | 🟢 EDGE-ID | Case → **Tenant** (належить) |
| `ownerId` | 🟢 EDGE-ID | Case → **User** (власник) |
| `team[].userId` (+caseRole, permissions) | 🟢 EDGE-ID | Case ↔ **User** (член команди, з роллю) |
| `externalAccess[].userId` | 🟢 EDGE-ID | Case ↔ **User** (зовнішній доступ) |
| `proceedings[].id` | 🟢 EDGE-ID | вузли Proceeding |
| `proceedings[].composition` | 🟡 EDGE-WEAK | склад суду (presiding/reporter/members) — особи без ID |
| `documents[]`, `hearings[]`, `deadlines[]`, `notes[]` | 🟢 EDGE-ID | Case → дочірні вузли (має) |
| `pinnedNoteIds[]` | 🟢 EDGE-ID | Case → Note (закріплено) |
| `parties[]` | 🟡 EDGE-WEAK | сторони справи — структуровано, БЕЗ глобального ID особи |
| `processParticipants[]` | 🟡 EDGE-WEAK | учасники процесу — те саме |
| `ecitsState` | ⚪ ATTR/state | стан ЄСІТС-синхронізації (+ caseId-ref у ЄСІТС) |
| `origin` | 🔵 CLASS | manual/ecits_import/telegram_import/email_import |
| `shareType` | 🔵 CLASS | private/internal/external |
| `category`, `status` | 🔵 CLASS | категорія/стан справи |
| `name`, `case_no`, `next_action` | ⚪ ATTR | ідентифікація/підказка |
| `court` | 🟡 EDGE-WEAK | → **Court** як вільний текст (не вузол) |
| `client` | 🟡 EDGE-WEAK | → **Client** як вільний текст (борг) |
| `judge` / `judges` | 🟡 EDGE-WEAK | → **Judge** як вільний текст (борг) |
| `createdAt`, `updatedAt` | ⚪ ATTR | часові мітки |
| `storage{}` | ⚪ ATTR | папки на Drive |
| `agentHistory[]`, `timeLog[]` (deprecated) | ⚪ ATTR | історія/legacy |

Вкладені сутності (hearing/deadline/note) несуть `createdBy` (🟢 → User) і
**успадковують** `tenantId` від справи (не дублюють — правило).

**Hearing (v7) додатково:** `assignedTo` (🟢 → User), `attendedBy[]` (🟢 → User),
`court` (🟡), `source`/`sourceConfidence`/`extractedAt` (CLASS/ATTR), `ecitsContext`.

**TimeEntry:** `caseId`/`hearingId`/`documentId`/`userId`/`tenantId` — **усі 🟢 EDGE-ID**
(найбагатша на ребра сутність: прив'язує час до справи/засідання/документа/особи).

---

## 4. ГРАФ ЗВ'ЯЗКІВ (поточний стан)

```mermaid
graph TD
  Tenant -->|owns| Case
  User -->|owns ownerId| Case
  User -->|member team[]| Case
  User -.->|external access| Case
  Case -->|has proceedings| Proceeding
  Case -->|has documents| Document
  Document -->|belongs procId| Proceeding
  Case -->|has hearings| Hearing
  Case -->|has deadlines| Deadline
  Case -->|has notes| Note
  Hearing -->|assignedTo/attendedBy| User
  Document -->|authored-by role| AuthorRole["author роль: ours/opponent/court/3rd"]
  Document -->|came-from| Source["канал: manual/court_sync/..."]
  TimeEntry -->|for| Case
  TimeEntry -->|for| Hearing
  TimeEntry -->|for| Document
  TimeEntry -->|by| User

  %% слабкі/відсутні (вільний текст) — пунктиром
  Case -.->|court рядок| Court["Court ❓ не-вузол"]
  Case -.->|client рядок| Client["Client ❓ не-вузол"]
  Case -.->|judge рядок| Judge["Judge ❓ не-вузол"]
  Case -.->|parties inline| Party["Party ❓ без ID"]
  Document -.->|movementCard deliveries| Party
```

Суцільні стрілки — **готові ребра** (🟢 ID). Пунктир — **слабкі/відсутні** (🟡 вільний
текст або inline без ID): Court, Client, Judge, Party.

---

## 5. ЩО ВЖЕ ГРАФОПРИДАТНЕ (scorecard)

**🟢 Готові ребра (стабільні ID) — це вже граф:**
- Tenant→Case→Proceeding→Document (ядро ієрархії: `tenantId`, `id`, `procId`).
- User↔Case (ownerId, team[].userId, externalAccess) — з ролями і правами.
- Case→{Hearing, Deadline, Note} (+ createdBy→User, pinnedNoteIds).
- Hearing→User (assignedTo/attendedBy).
- TimeEntry→{Case,Hearing,Document,User} — найщільніший вузол ребер.
- Document→ЄСІТС-канал (source), Document→User (ecitsSource.userId).

**🟡 Слабкі / потребують нормалізації (зв'язок є, але не зв'язується між справами):**
- **Party / Person** — `parties[]`, `processParticipants[]`, `composition`, `movementCard.deliveries` — структуровано, але **без глобального реєстру осіб з ID**. Той самий опонент у двох справах — два різні inline-записи.
- **Court** — `case.court`, `hearing.court` — вільний текст. Кандидат на вузол (довідник судів).
- **Client** — `case.client` — вільний текст (борг #, denormalized summary).
- **Judge** — `case.judge`/`judges` — вільний текст (борг).
- `author` документа — зв'язок до **ролі**, не до конкретної Party.

**❌ Поки нема (потенційні майбутні вузли):**
- Реєстр **Person** (фізичні/юридичні особи) зі стабільним ID — щоб Party/Client/Judge/
  склад суду стали посиланнями. Це **головний важіль** переходу плоских метаданих у граф.
- Довідник **Court** (суди) зі стабільним ID.
- **Document↔Document** зв'язки (відповідь-на, додаток-до, оскарження-чого) — зараз нема явних.

---

## 6. ПРОГРЕСІЯ ДО ОНТОЛОГІЇ

1. **Атрибути** (зараз, переважно) — плоскі метадані на документі/справі.
2. **Граф** — поля-ID трактуємо як ребра; first-class сутності — вузли. **Уже частково
   працює** (ядро Tenant→Case→Proceeding→Document + User + TimeEntry).
3. **Онтологія** — формальні типи сутностей + типи зв'язків + правила домену
   («ухвала про відкриття ВІДКРИВАЄ провадження»; «дедлайн ПОРОДЖУЄТЬСЯ судовим актом»;
   «клопотання ОЧІКУЄ відповідь»).
4. **Міркування** — AI над графом: добудова відсутнього, прогноз кроку, реляційні
   запити, юридична логіка, виявлення прогалин.

---

## 7. ДИСЦИПЛІНА НА МАЙБУТНЄ (дешево зараз — велика віддача потім)

1. **Посилання замість вільного тексту** там, де значення — сутність. Нове поле, що
   вказує на особу/суд/документ → ID-посилання, не рядок. `procId` — еталон; `client` — антиеталон.
2. **Реєстр Person** — найбільший важіль. Коли з'явиться (навіть мінімальний: id+імена+
   ролі), Party/Client/Judge/склад суду стають ребрами — і граф «оживає» між справами.
   Це окремий пізніший TASK (ймовірно з backfill наявних рядків).
3. **Document↔Document зв'язки** — закласти при потребі (відповідь-на/додаток/оскарження),
   коли з'явиться функція, що їх читає (не превентивно — YAGNI).
4. **Поле заслуговує існувати, коли щось на нього ДІЄ** (не «чим більше, тим краще»).
   Резерв під майбутнє — nullable (ембріон з ДНК), не вимагати заповнення.
5. **Граф/онтологія — ймовірно серверна, пізня** річ (обхід/міркування важкі для браузера).
   Зараз — лише дисципліна посилань, щоб дані вже накопичувались графопридатними.

---

## 8. КОРОТКО (TL;DR)

- **Уже граф:** Tenant→Case→Proceeding→Document, User↔Case (ролі/права), Case→Hearing/
  Deadline/Note, TimeEntry→усе. Ядро ієрархії — міцне, на стабільних ID.
- **Слабке (вільний текст, не зв'язується між справами):** Party, Court, Client, Judge.
- **Головний важіль до графа:** реєстр **Person** + довідник **Court** зі стабільними ID,
  тоді сторони/суди/судді стають ребрами.
- **Дисципліна вже зараз:** нові «сутнісні» поля — посиланнями (ID), не рядками.
