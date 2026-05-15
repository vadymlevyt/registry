# TASK 0.3.5 — Canonical Schema Bump v7 для ЄСІТС-інтеграції

**Дата:** 2026-05-14
**Schema version:** 6.5 → 7
**Schema label:** `'7.0_ecits_canonical'`
**Тип:** інфраструктурний — підготовка канонічної схеми системи до прийому структурованих даних з ЄСІТС-кабінету та інших каналів
**Час виконання:** 3-4 дні Claude Code

---

## КОНТЕКСТ

Це підготовчий TASK перед TASK 0.4 (синхронізація засідань через Claude for Chrome). Закладає **канонічну схему системи** для прийому ЄСІТС-даних і дзеркального AI-first доступу.

Передумова — TASK 0.3.4 (addedBy cleanup) виконано: `document.addedBy` має чіткі 3 значення `'user' | 'agent' | 'system'`. Зіткнення таксономій з `document.source` усунене.

### Принциповий підхід

Обидва канали (ЄСІТС через Claude for Chrome і Metadata Extractor для не-ЄСІТС каналів) пишуть у **ТУ САМУ канонічну схему** через **ТІ САМІ ACTIONS**. Споживачі даних (картка справи, дашборд, білінг, агент досьє) не розрізняють джерело — працюють зі стабільною схемою. Source-мітка зберігається для аудиту і пріоритетизації при конфліктах.

Цей TASK не реалізовує жодної логіки синхронізації — тільки готує канонічну схему. Перший продакшн-сценарій (синхронізація засідань) робиться окремо в TASK 0.4.

### Виконані рішення з audit_review_task_0_3_5_draft.md

| Блокер/Ризик | Рішення |
|---|---|
| B1 — case.team semantics | Варіант A: зберігаємо існуюче `team[]`, додаємо `processParticipants[]` |
| B2 — source enum migration | Варіант A: повна міграція `manual_upload→manual`, `ecits→court_sync` |
| B3 — addedBy vs source | **Вже вирішено TASK 0.3.4** |
| B4 — PERMISSIONS structure | Варіант B: масиви строк, `metadata_extractor_agent: []` як disabled |
| R1 — AI-first ACTIONS | Варіант A: додаємо 6 edit-ACTIONS у цьому TASK |
| R2 — parties vs client | Документуємо як denormalized, окремий backfill TASK потім |
| R3 — activityTracker hook | Виключаємо системні ACTIONS з білінгу |
| R4 — INITIAL_CASES і migrateCase | Не зачіпаємо team semantics |
| R5 — Default 'manual' міграція | Явна логіка перейменування source enum |
| R6 — ecitsState dead data | Tracking debt задокументовано |
| N1-N15 | Враховані по відповідних розділах |

---

## SEMANTIC CLARITY CHECK

ЕСІТС-канал, Metadata Extractor канал, manual канал — усі пишуть в одну схему. Розрізнення через source-поле, не через окремі структури:

```
// ЄСІТС-синхронізація:
hearing = { source: 'court_sync', sourceConfidence: 'high', ecitsContext: {...}, ... }

// Metadata Extractor (майбутнє):
hearing = { source: 'metadata_extractor', sourceConfidence: 'medium', ecitsContext: null, ... }

// Адвокат вручну:
hearing = { source: 'manual', sourceConfidence: 'high', ecitsContext: null, ... }
```

Жодного перекриття таксономій. Жодного дублювання структур. Правило #11 виконано.

---

## ЩО ТРЕБА ЗРОБИТИ

### 1. Schema version bump v6.5 → v7

У `migrationService.js`:
- `CURRENT_SCHEMA_VERSION = 7`
- `MIGRATION_VERSION = '7.0_ecits_canonical'`
- `labelForVersion(7) → '7.0_ecits_canonical'`
- Створити функцію `migrateToVersion7(registry)` за патерном `migrateToVersion6_5`

### 2. Розширення documentSchema.js

Додати канонічні поля до документа (приблизно після поля `source` яке вже є з TASK 0.2):

#### 2.1. Розширення enum `source`

**ПЕРЕД (поточний з TASK 0.2):**
```js
source: {
  type: 'string',
  enum: ['manual_upload', 'ecits', 'telegram', 'email', null],
  default: null
}
```

**ПІСЛЯ:**
```js
source: {
  type: 'string',
  enum: ['manual', 'court_sync', 'metadata_extractor', 'telegram', 'email', 'unknown', null],
  default: 'manual',
  description: 'Канал ПОХОДЖЕННЯ файлу. НЕ плутати з document.addedBy (actor). manual = завантажено локально. court_sync = синхронізовано з ЄСІТС-кабінету. metadata_extractor = парсинг файлу не-ЄСІТС каналу (резервний). telegram/email = відповідні канали. unknown = невідоме походження.'
}
```

#### 2.2. Нові поля документа

```js
sourceConfidence: {
  type: 'string',
  enum: ['high', 'medium', 'low', null],
  default: 'high',
  description: 'Впевненість у джерелі. high = адвокат підтвердив або синхронізація з офіційного джерела. medium = автоматичний парсинг з ймовірністю помилки. low = здогадка.'
},

extractedAt: {
  type: ['string', 'null'],
  format: 'date-time',
  default: null,
  description: 'Коли запис було витягнуто/створено в системі (для аудиту синхронізацій)'
},

ecitsSource: {
  type: ['object', 'null'],
  default: null,
  description: 'Деталі ЄСІТС-походження. Заповнюється тільки коли source === court_sync або metadata_extractor парсить ЄСІТС-документ. Multi-user готовність: userId фіксує через чий кабінет первинно отримано.',
  schema: {
    ecitsDocumentId: 'string',                        // ID документа в ЄСІТС (32-символьний hex)
    ecitsNotificationId: 'string | null',             // ID повідомлення з якого витягнуто
    notificationType: 'string',                       // "Судова повістка про виклик в суд" тощо
    cabinetUrl: 'string',                             // деталь в кабінеті для deep link
    receivedThroughCabinet: {
      userId: 'string',                               // userId адвоката бюро через якого первинно отримано
      cabinetIdentifier: 'string'                     // як адвокат відомий у ЄСІТС (РНОКПП або login)
    },
    receivedAlsoThroughCabinet: 'Array<{ userId, cabinetIdentifier }>'  // інші адвокати бюро які бачили той самий документ
  }
},

movementCard: {
  type: ['object', 'null'],
  default: null,
  description: 'Картка руху документа з ЄСІТС — повна таблиця доставки. Окрема структура від ecitsSource, бо інша семантика: ecitsSource = звідки/коли отримано в систему, movementCard = коли і кому документ доставлено в межах судової системи.',
  schema: {
    state: 'string',                                  // "Надійшов від АСДС"
    dnzs: 'ISO date | null',                          // дата набрання законної сили (кримінальні)
    documentDate: 'ISO date | null',
    infoDeliveryToECourt: 'ISO datetime | null',
    fileDeliveryToECourt: 'ISO datetime | null',
    deliveries: 'Array<{ participant, code, messageSentToCourtAt, deliveredToCabinetAt, emailSentAt }>',
    attachments: 'Array<{ filename, infoDeliveryAt, fileDeliveryAt }>'
  }
},

alternativeSources: {
  type: 'array',
  default: [],
  description: 'Аудит коли різні канали повернули дані про той самий документ. Перший пріоритетний (поточний source), решта — для history. Зростає при multi-source синхронізаціях.',
  schema: 'Array<{ source, sourceConfidence, receivedAt, dataHash }>'
}
```

**Підсумок:** 5 нових полів документа. Усі nullable з безпечними дефолтами для міграції.

### 3. Створення нових файлів схем — caseSchema і hearingSchema

**Аудит виявив:** `caseSchema.js` і `hearingSchema.js` не існують як файли. Case і hearing — implicit shape через `migrateCase` у `migrationService.js`.

**Рішення:** створюємо ці файли як **тонкі описові** модулі для документації канонічної форми. Не factory (бо ACTIONS вже створюють їх через свою логіку), а **довідкова схема** для тестів і агентів.

#### 3.1. Створити `src/schemas/caseSchema.js`

Документує канонічну форму справи з повним набором полів (legacy + SaaS + ЄСІТС). Експортує константи з описом полів, валідаторами, та хелперами:

```js
export const CANONICAL_CASE_FIELDS = {
  // Legacy fields (вже існують у системі)
  id: { type: 'string', description: 'case_<n> або case_<timestamp>' },
  name: { type: 'string' },
  client: { type: 'string', description: 'DEPRECATED denormalized summary. Real source: parties[]. Залишається для UI рендерингу до backfill TASK.' },
  category: { type: 'string', enum: ['civil', 'criminal', 'military', 'admin'] },
  status: { type: 'string', enum: ['active', 'paused', 'closed'] },
  court: { type: 'string' },
  case_no: { type: 'string' },
  judge: { type: 'string', description: 'DEPRECATED denormalized text. Real source: proceedings[].composition. Backfill потім.' },
  next_action: { type: 'string' },
  hearings: { type: 'array' },        // окрема схема hearingSchema
  deadlines: { type: 'array' },
  notes: { type: 'array' },
  documents: { type: 'array' },       // окрема схема documentSchema
  proceedings: { type: 'array' },     // розширена нижче
  storage: { type: 'object' },
  agentHistory: { type: 'array' },
  pinnedNoteIds: { type: 'array' },
  
  // SaaS Foundation v2/v3 (вже існують)
  tenantId: { type: 'string' },
  ownerId: { type: 'string' },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
  shareType: { type: 'string', enum: ['private', 'internal', 'external'] },
  externalAccess: { type: 'array' },
  team: {
    type: 'array',
    description: 'Internal bureau team з permissions. Семантика: хто з бюро має доступ до справи. NOT процесуальні учасники — для них окреме поле processParticipants[].',
    elementSchema: '{ userId, caseRole, addedAt, addedBy, permissions: {...} }'
  },
  
  // NEW v7 — ЄСІТС-готовність
  ecitsState: {
    type: 'object',
    description: 'Стан синхронізації з ЄСІТС-кабінетом. Multi-user готовність через lastSyncedBy.',
    schema: {
      caseId: 'string | null',         // ID справи в ЄСІТС (32-hex)
      filedAt: 'ISO date | null',      // дата надходження до суду
      court: 'string | null',          // повна назва суду з кабінету (може відрізнятись від case.court)
      lastSyncedAt: 'ISO datetime | null',
      lastSyncedBy: 'userId | null',
      syncStatus: 'never | syncing | synced | partial | failed',
      failureReason: 'string | null',
      syncMetrics: {
        totalSyncs: 'number (default 0)',
        successfulSyncs: 'number',
        failedSyncs: 'number',
        documentsExtracted: 'number',
        hearingsExtracted: 'number',
        lastDurationMs: 'number | null'
      }
    }
  },
  
  parties: {
    type: 'array',
    description: 'Процесуальні сторони справи. Структуровано. Не плутати з team[] (internal bureau).',
    elementSchema: {
      role: 'plaintiff | defendant | third_party | accused | victim | legal_representative',
      fullName: 'string',
      code: 'string | null',           // РНОКПП або ЄДРПОУ
      position: 'number',              // порядковий номер у списку
      source: "'manual' | 'court_sync' | 'metadata_extractor' | 'unknown'",
      sourceConfidence: 'high | medium | low | null',
      extractedAt: 'ISO datetime | null'
    }
  },
  
  processParticipants: {
    type: 'array',
    description: 'Усі процесуальні учасники справи: захисники (включно з зовнішніми), прокурор, суддя, секретар. На відміну від team[] не несе permissions — це read-only довідка про склад процесу.',
    elementSchema: {
      role: 'lawyer | prosecutor | judge | secretary | legal_representative',
      caseRole: 'defender | plaintiff_rep | defendant_rep | third_party_rep | general | null',
      fullName: 'string',
      userId: 'string | null',          // null для зовнішніх (опонент, прокурор, суддя), userId для адвокатів бюро
      isOurLawyer: 'boolean',           // shortcut для UI
      representsParty: 'string | null', // ПІБ кого захищає/представляє
      source: "'manual' | 'court_sync' | 'metadata_extractor' | 'unknown'",
      sourceConfidence: 'high | medium | low | null',
      extractedAt: 'ISO datetime | null'
    }
  }
};

// proceedings[] — розширення існуючого:
export const CANONICAL_PROCEEDING_FIELDS = {
  id: { type: 'string' },
  type: { type: 'string' },             // existing
  title: { type: 'string' },
  court: { type: 'string' },
  status: { type: 'string' },
  parentProcId: { type: 'string | null' },
  parentEventId: { type: 'string | null' },
  caseNumber: { type: 'string' },       // existing
  dateOpened: { type: 'string' },       // existing
  judges: { 
    type: 'string',
    description: 'DEPRECATED denormalized text. Real source: composition. Backfill потім.'
  },
  description: { type: 'string' },
  color: { type: 'string' },
  
  // NEW v7
  composition: {
    type: 'object | null',
    description: 'Склад суду в провадженні. Заповнюється з ЄСІТС.',
    schema: {
      presiding: '{ fullName, userId: null } | null',
      reporter: '{ fullName, userId: null } | null',
      members: 'Array<{ fullName, userId: null }>'
    }
  }
};

export const CURRENT_CASE_SCHEMA_VERSION = 7;

// Валідація — спрощено, не повна
export function isCanonicalCase(obj) { /* перевірити основні поля */ }
```

#### 3.2. Створити `src/schemas/hearingSchema.js`

```js
export const CANONICAL_HEARING_FIELDS = {
  // Legacy (існують)
  id: { type: 'string' },
  date: { type: 'string' },              // ISO date
  time: { type: 'string' },              // HH:MM
  duration: { type: 'number | null' },
  status: { type: 'string' },            // 'scheduled' | 'held' | 'postponed' тощо
  type: { type: 'string | null' },
  court: { type: 'string | null' },
  notes: { type: 'string | null' },
  
  // SaaS (createdBy існує)
  createdBy: { type: 'string' },         // userId
  
  // NEW v7
  source: {
    type: 'string',
    enum: ['manual', 'court_sync', 'metadata_extractor', 'unknown'],
    default: 'manual',
    description: 'Канал з якого отримано інформацію про засідання.'
  },
  sourceConfidence: {
    type: 'string',
    enum: ['high', 'medium', 'low', null],
    default: 'high'
  },
  extractedAt: {
    type: 'string | null',
    default: null
  },
  ecitsContext: {
    type: 'object | null',
    default: null,
    description: 'Заповнюється коли source === court_sync або metadata_extractor.',
    schema: {
      ecitsNotificationId: 'string',
      notificationDocumentType: 'string',          // "Внесення дат слухання", "Судова повістка"
      notifiedAt: 'ISO datetime',                  // коли повідомлено про засідання
      deliveredToCabinetAt: 'ISO datetime | null', // коли в кабінет
      emailSentAt: 'ISO datetime | null',
      cabinetUrl: 'string | null'
    }
  },
  assignedTo: {
    type: 'string | null',
    default: null,
    description: 'Multi-user готовність: userId адвоката бюро відповідального за це засідання. Default null поки multi-user не активований.'
  },
  attendedBy: {
    type: 'array',
    default: [],
    description: 'Multi-user готовність: масив userId адвокатів бюро що були присутні. Заповнюється агентом досьє або вручну.',
    elementType: 'string'
  }
};

export const CURRENT_HEARING_SCHEMA_VERSION = 7;
```

### 4. Створення src/services/sourcePolicy.js

```js
/**
 * sourcePolicy.js — пріоритетизація джерел даних при конфлікті.
 * 
 * Принцип: дані з різних каналів пишуться в одну схему через одні ACTIONS.
 * source-мітка дозволяє розрізняти і не перезаписувати дані з вищим пріоритетом.
 * 
 * У майбутньому SaaS — може стати tenant-scoped (різні tenants можуть мати
 * свою політику). Зараз — статична константа.
 */

export const SOURCE_PRIORITY = Object.freeze({
  manual: 100,                  // адвокат руками — найвищий, не перезаписується
  court_sync: 80,               // primary ЄСІТС канал
  metadata_extractor: 60,       // fallback парсинг не-ЄСІТС
  telegram: 50,                 // прямий канал з месенджера
  email: 50,                    // прямий канал з email
  unknown: 10                   // невідомо
});

/**
 * Чи новий source має право перезаписати існуючий.
 * 
 * @param {string} existingSource — поточний source існуючих даних
 * @param {string} newSource — source даних що хочуть записати
 * @returns {boolean} — true якщо перезапис дозволений
 */
export function canOverwrite(existingSource, newSource) {
  const existing = SOURCE_PRIORITY[existingSource] ?? 0;
  const incoming = SOURCE_PRIORITY[newSource] ?? 0;
  return incoming > existing;
}

/**
 * Якщо перезапис не дозволений — додаємо запис до alternativeSources для аудиту.
 */
export function buildAlternativeSourceRecord(source, sourceConfidence, data) {
  return {
    source,
    sourceConfidence,
    receivedAt: new Date().toISOString(),
    dataHash: hashData(data)
  };
}

function hashData(data) {
  // простий хеш для аудиту, не криптографічний
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(16);
}
```

### 5. Розширення ACTIONS registry

#### 5.1. Розширити add_hearing і update_hearing (backward compatible)

Існуючі сигнатури зберігаються. Додати **необов'язкові параметри**:

```js
add_hearing({
  caseId,
  date,
  time,
  duration,
  status,
  type,
  court,
  notes,
  // NEW v7 (всі опційні):
  source,                     // default 'manual'
  sourceConfidence,           // default 'high'
  ecitsContext,               // default null
  assignedTo,                 // default null
  attendedBy                  // default []
})
```

Логіка обробки нових полів:

```js
// у handler add_hearing:
const hearing = {
  ...existingFields,
  source: params.source ?? 'manual',
  sourceConfidence: params.sourceConfidence ?? (params.source ? 'high' : 'high'),
  extractedAt: params.source && params.source !== 'manual' ? new Date().toISOString() : null,
  ecitsContext: params.ecitsContext ?? null,
  assignedTo: params.assignedTo ?? null,
  attendedBy: params.attendedBy ?? []
};

if (!params.source) {
  console.warn(`[ACTION add_hearing] called without explicit source, falling back to 'manual'`);
}
```

Те саме для `update_hearing` — приймає опційні нові поля.

#### 5.2. Новий ACTION: mark_synced_from_ecits

**Призначення:** позначає що справа була синхронізована з ЄСІТС, оновлює metrics.

**Сигнатура:**
```js
mark_synced_from_ecits({
  caseId,                     // обов'язково
  status,                     // 'synced' | 'partial' | 'failed' — default 'synced'
  failureReason,              // string | null — default null
  durationMs,                 // number | null — для metrics
  documentsCount,             // number — скільки документів витягнуто
  hearingsCount               // number — скільки засідань
})
```

**Логіка:**
```js
mark_synced_from_ecits: {
  handler: (params, state) => {
    const userId = getCurrentUserId();
    const tenantId = getCurrentTenantId();
    const timestamp = new Date().toISOString();
    
    state.setCases(prev => prev.map(c => {
      if (c.id !== params.caseId) return c;
      const currentMetrics = c.ecitsState?.syncMetrics || {
        totalSyncs: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        documentsExtracted: 0,
        hearingsExtracted: 0,
        lastDurationMs: null
      };
      return {
        ...c,
        ecitsState: {
          ...c.ecitsState,
          lastSyncedAt: timestamp,
          lastSyncedBy: userId,
          syncStatus: params.status ?? 'synced',
          failureReason: params.failureReason ?? null,
          syncMetrics: {
            totalSyncs: currentMetrics.totalSyncs + 1,
            successfulSyncs: currentMetrics.successfulSyncs + (params.status === 'synced' ? 1 : 0),
            failedSyncs: currentMetrics.failedSyncs + (params.status === 'failed' ? 1 : 0),
            documentsExtracted: currentMetrics.documentsExtracted + (params.documentsCount ?? 0),
            hearingsExtracted: currentMetrics.hearingsExtracted + (params.hearingsCount ?? 0),
            lastDurationMs: params.durationMs ?? null
          }
        }
      };
    }));
    
    // eventBus публікація з tenantId для SaaS-multi-tenant майбутнього
    eventBus.publish('ecits.sync_completed', {
      caseId: params.caseId,
      tenantId,
      userId,
      timestamp,
      status: params.status ?? 'synced'
    });
    
    return { success: true };
  },
  audit: false                  // не пишемо в auditLog бо це системна дія, не критична
}
```

#### 5.3. Новий ACTION: update_case_ecits_state

**Призначення:** оновлює поля ecitsState (caseId, filedAt, court тощо) коли Court Sync дізнається про справу більше.

**Сигнатура:**
```js
update_case_ecits_state({
  caseId,                     // обов'язково
  patch,                      // Partial<case.ecitsState>
  source                      // обов'язково — для аудиту
})
```

**Логіка (з використанням canOverwrite):**
```js
update_case_ecits_state: {
  handler: (params, state) => {
    if (!params.source) {
      return { success: false, error: 'source parameter required' };
    }
    
    state.setCases(prev => prev.map(c => {
      if (c.id !== params.caseId) return c;
      
      const existingState = c.ecitsState || {};
      const merged = {};
      
      // Per-field source check через canOverwrite
      // Для simplicity у v7 — на рівні всього об'єкта ecitsState один source
      // (поглиблений per-field source map — окремий TASK у майбутньому)
      const existingSource = existingState._lastSource ?? 'unknown';
      
      if (canOverwrite(existingSource, params.source)) {
        // дозволено перезаписувати
        Object.assign(merged, params.patch);
      } else {
        // не перезаписуємо, але логуємо як alternativeSource
        console.log(`[ACTION update_case_ecits_state] source '${params.source}' has lower priority than '${existingSource}', skipping overwrite for case ${params.caseId}`);
      }
      
      return {
        ...c,
        ecitsState: {
          ...existingState,
          ...merged,
          _lastSource: params.source                  // tracking
        }
      };
    }));
    
    eventBus.publish('ecits.case_state_updated', {
      caseId: params.caseId,
      tenantId: getCurrentTenantId(),
      userId: getCurrentUserId(),
      fieldsChanged: Object.keys(params.patch),
      source: params.source,
      timestamp: new Date().toISOString()
    });
    
    return { success: true };
  },
  audit: false
}
```

#### 5.4. Шість нових edit-ACTIONS для AI-first дзеркала

**R1 вирішено Варіантом A — додаємо ACTIONS щоб поля не були мертві.**

```js
// 1. update_parties — replace-all для масиву сторін
update_parties({
  caseId,
  parties,                    // Array<party>
  source                      // обов'язково
}) {
  // Замінює case.parties[] цілковито.
  // Кожен party автоматично отримує source, sourceConfidence, extractedAt.
}

// 2. update_team — replace-all для internal bureau team (зберігає семантику SaaS v3)
update_team({
  caseId,
  team                        // Array<{ userId, caseRole, addedAt, addedBy, permissions }>
}) {
  // Внутрішня команда. НЕ переписує processParticipants.
  // permissions залишається обов'язковим полем кожного учасника.
}

// 3. update_process_participants — replace-all для процесуальних учасників
update_process_participants({
  caseId,
  participants,               // Array<participant>
  source                      // обов'язково
}) {
  // Сторонні учасники процесу: захисники-опоненти, прокурор, суддя, секретар.
  // НЕ переписує team[].
}

// 4. update_proceeding_composition
update_proceeding_composition({
  caseId,
  proceedingId,
  composition,                // { presiding, reporter, members }
  source                      // обов'язково
}) {
  // Оновлює склад суду конкретного провадження.
}

// 5. update_document_movement_card
update_document_movement_card({
  caseId,
  documentId,
  movementCard,               // повна структура
  source                      // обов'язково
}) {
  // Записує картку руху документа.
}

// 6. update_alternative_sources
update_alternative_sources({
  caseId,
  documentId,
  alternativeSource           // { source, sourceConfidence, receivedAt, dataHash }
}) {
  // Додає запис до document.alternativeSources[] коли multi-source синхронізація знаходить той самий документ через інший канал.
}
```

Усі 6 ACTIONS:
- Перевіряють `params.source` як обов'язковий (окрім `update_team` — там не потрібний бо internal)
- Через `executeAction` стандартним pipeline
- Не пишуть в auditLog (`audit: false`) — це системні дії
- **R3:** виключаємо з activityTracker-hook (див. п.7)

#### 5.5. ACTIONS які НЕ робимо зараз

Відкладено до відповідних TASK'ів:
- `add_timeline_event` — TASK 0.7 (Хронологія в досьє)
- `update_case_dnzs` — після DP v2 (парсинг довідки)

### 6. Розширення PERMISSIONS — Варіант B (масиви строк)

Зберігаємо існуючий формат `{agentId: ['action1', 'action2']}`. **Без зміни структури executeAction.**

Додати дві нові ролі:

```js
PERMISSIONS.court_sync_agent = [
  'add_hearing',
  'update_hearing',
  'mark_synced_from_ecits',
  'update_case_ecits_state',
  'update_parties',
  'update_team',                          // зазначити: не використовується для court_sync (бо bureau team — це internal), але дозволено для майбутнього case management
  'update_process_participants',
  'update_proceeding_composition',
  'update_document_movement_card',
  'update_alternative_sources'
  // ЗАБОРОНЕНО (через відсутність у списку): destroy_case, add_document, update_document, delete_document
];

PERMISSIONS.metadata_extractor_agent = [
  // ПОРОЖНІЙ allowlist = disabled
  // Активувати окремим TASK коли реальний парсер буде готовий
];
```

Документувати у CLAUDE.md: `metadata_extractor_agent` — defined але порожній (disabled). Активація — окремим TASK після проектування MVP Metadata Extractor.

### 7. Виключення нових ACTIONS з activityTracker-hook (R3)

У `App.jsx` рядок ~5857 (executeAction post-processing) знайти список виключень з activityTracker:

```js
// ПЕРЕД (поточний):
if (result && (result.success || result.successCount) &&
    !['track_session_start', 'track_session_end', 'batch_update'].includes(action)) {
  activityTracker.report(action, { ... });
}
```

**Винести список у константу** і додати нові системні ACTIONS:

```js
// В початку App.jsx або окремий constants файл:
const SYSTEM_ACTIONS_NO_BILLING = new Set([
  'track_session_start',
  'track_session_end',
  'batch_update',
  // NEW v7 — системні дії, не робота адвоката:
  'mark_synced_from_ecits',
  'update_case_ecits_state',
  // нові edit-ACTIONS — нараховуємо тільки якщо source === 'manual':
  // (логіка ускладниться — див. нижче)
]);

// Логіка в executeAction post-processing:
if (result?.success && !SYSTEM_ACTIONS_NO_BILLING.has(action)) {
  // Edit-ACTIONS системного source не нараховуються
  if (isEditAction(action) && params.source && params.source !== 'manual') {
    // НЕ нараховуємо — це автосинхронізація, не робота адвоката
  } else {
    activityTracker.report(action, { ... });
  }
}

function isEditAction(action) {
  return [
    'update_parties', 'update_team', 'update_process_participants',
    'update_proceeding_composition', 'update_document_movement_card',
    'update_alternative_sources'
  ].includes(action);
}
```

**Принцип:** edit-ACTIONS викликані з source `manual` (адвокат через UI/агента) — нараховуються в білінг. Викликані з `court_sync` або `metadata_extractor` — НЕ нараховуються (системна дія).

### 8. eventBus події з tenantId payload (N15)

Усі нові ACTIONS публікують події через існуючий eventBus. **Обов'язково в payload — tenantId** для SaaS multi-tenant майбутнього:

```js
// mark_synced_from_ecits:
eventBus.publish('ecits.sync_completed', {
  caseId,
  tenantId: getCurrentTenantId(),
  userId,
  timestamp,
  status
});

// update_case_ecits_state:
eventBus.publish('ecits.case_state_updated', {
  caseId,
  tenantId: getCurrentTenantId(),
  userId,
  fieldsChanged,
  source,
  timestamp
});

// 6 edit-ACTIONS — публікують відповідну подію з tenantId і source у payload:
eventBus.publish('case.parties_updated', { caseId, tenantId, userId, source, timestamp });
eventBus.publish('case.team_updated', { caseId, tenantId, userId, timestamp });
eventBus.publish('case.process_participants_updated', { caseId, tenantId, userId, source, timestamp });
eventBus.publish('proceeding.composition_updated', { caseId, proceedingId, tenantId, userId, source, timestamp });
eventBus.publish('document.movement_card_updated', { caseId, documentId, tenantId, userId, source, timestamp });
eventBus.publish('document.alternative_source_added', { caseId, documentId, tenantId, userId, source, timestamp });
```

Зараз ніхто не підписаний — це закладка для майбутнього (Dashboard Activity Feed, Billing analytics, Notifications).

### 9. DEFAULT_USER додавання поля ecitsCabinetIdentifier (N12)

У `tenantService.js` додати:

```js
export const DEFAULT_USER = {
  // existing fields:
  userId, fullName, email, tenantId, globalRole, ...
  
  // NEW v7:
  ecitsCabinetIdentifier: null    // як адвокат відомий у ЄСІТС (РНОКПП, email або login)
                                  // Заповнюється вручну в Налаштуваннях, потрібний для multi-user
                                  // dedupe у Court Sync. Default null поки не активовано.
};
```

Міграція v7 додає це поле всім існуючим users[]:

```js
// у migrateToVersion7:
registry.users = (registry.users || []).map(u => ({
  ...u,
  ecitsCabinetIdentifier: u.ecitsCabinetIdentifier ?? null
}));
```

### 10. Папка-ембріон src/services/metadataExtractor

Створити `src/services/metadataExtractor/README.md` з повним описом (60-80 рядків):

```markdown
# Metadata Extractor — основний канал для не-ЄСІТС джерел

## Призначення

Системний шар який витягує структуровані дані (сторони, реквізити, дати, метадані документів) з усіх каналів окрім офіційного ЄСІТС-кабінету.

**Це не fallback.** Це **основний канал** для більшості життєвого циклу справи — від першої консультації клієнта до останньої постанови. Court Sync — спеціалізований канал для вузького періоду коли справа у ЄСІТС.

## Чому це основний канал

Адвокат працює зі справою набагато ширше ніж триває її електронна частина у ЄСІТС:

ДО ЄСІТС:
- Консультації з клієнтом (голос, текст)
- Збір доказів (фото, скани, паперові копії)
- Документи з ДРАЦСу, реєстрів нерухомості
- Договори, нотаріальні документи
- Досудові заяви, претензії, відповіді
- У кримінальних — досудове розслідування взагалі поза ЄСІТС

ПАРАЛЕЛЬНО з ЄСІТС:
- Клієнт надсилає документи через Telegram/Viber
- Опонент через email
- Свідки скидають через WhatsApp
- Документи від колег-адвокатів
- Документи з інших органів (поліція, прокуратура, ДВС)

САМО-ГЕНЕРОВАНІ:
- Голосові нотатки після зустрічі
- Ручне введення фактів
- Записи зі засідань

## Зони відповідальності

**Court Sync** — спеціалізований, primary для свого вузького скоупу (ЄСІТС-кабінет).

**Metadata Extractor** — універсальний, primary для свого широкого скоупу (всі інші канали).

Обидва пишуть у ту саму канонічну схему через ті самі ACTIONS (з різним `source`). Споживачі даних не розрізняють.

## Стан зараз (травень 2026)

Це папка-ембріон. Інфраструктура закладена в TASK 0.3.5:
- Канонічна схема з source-полями
- Generic ACTIONS приймають source як параметр
- PERMISSIONS роль `metadata_extractor_agent` defined але enabled:false (порожній allowlist)
- Source policy і canOverwrite

Реальна реалізація — окремий стратегічний TASK у майбутньому. Тригери для активації:
- Адвокат регулярно отримує документи поза кабінетом
- Активне використання з планшета/телефону без Chrome
- Перехід Legal BMS до SaaS
- ЄСІТС зміна UI ламає Court Sync → потрібен fallback
- Архівна міграція великого обсягу старих справ

## Пріоритетизація джерел при конфлікті

З `src/services/sourcePolicy.js`:
1. `manual` (priority 100) — адвокат вручну, не перезаписується
2. `court_sync` (priority 80) — primary для ЄСІТС
3. `metadata_extractor` (priority 60) — primary для не-ЄСІТС, не перезаписує court_sync
4. `telegram`, `email` (priority 50)
5. `unknown` (priority 10)
```

### 11. Міграція v6.5 → v7 — повна логіка

`migrateToVersion7(registry)`:

```js
export function migrateToVersion7(registry) {
  if ((registry.schemaVersion || 1) >= 7) {
    return { registry, didMigrate: false };
  }
  
  console.log('[TASK 0.3.5] Starting v6.5 → v7 migration: canonical schema for ECITS...');
  
  const stats = {
    documentsUpdated: 0,
    casesUpdated: 0,
    hearingsUpdated: 0,
    sourceRenamed: {
      manual_upload_to_manual: 0,
      ecits_to_court_sync: 0,
      keep_telegram: 0,
      keep_email: 0,
      null_to_manual: 0,
      unknown_other: 0
    }
  };
  
  // 1. Documents: source enum migration + новi поля
  registry.cases = (registry.cases || []).map(c => {
    const updatedDocs = (c.documents || []).map(doc => {
      // R5 — явна логіка міграції source
      let newSource = doc.source;
      if (doc.source === 'manual_upload') {
        newSource = 'manual';
        stats.sourceRenamed.manual_upload_to_manual++;
      } else if (doc.source === 'ecits') {
        newSource = 'court_sync';
        stats.sourceRenamed.ecits_to_court_sync++;
      } else if (doc.source === 'telegram') {
        stats.sourceRenamed.keep_telegram++;
      } else if (doc.source === 'email') {
        stats.sourceRenamed.keep_email++;
      } else if (doc.source === null || doc.source === undefined) {
        newSource = 'manual';
        stats.sourceRenamed.null_to_manual++;
      } else if (doc.source) {
        // невідоме значення — fallback на 'unknown'
        console.warn(`[TASK 0.3.5] Unknown document source '${doc.source}' on doc ${doc.id}, setting to 'unknown'`);
        newSource = 'unknown';
        stats.sourceRenamed.unknown_other++;
      }
      
      stats.documentsUpdated++;
      
      return {
        ...doc,
        source: newSource,
        sourceConfidence: doc.sourceConfidence ?? 'high',
        extractedAt: doc.extractedAt ?? null,
        ecitsSource: doc.ecitsSource ?? null,
        movementCard: doc.movementCard ?? null,
        alternativeSources: doc.alternativeSources ?? []
      };
    });
    
    // 2. Cases: нові поля
    stats.casesUpdated++;
    return {
      ...c,
      documents: updatedDocs,
      ecitsState: c.ecitsState ?? {
        caseId: null,
        filedAt: null,
        court: null,
        lastSyncedAt: null,
        lastSyncedBy: null,
        syncStatus: 'never',
        failureReason: null,
        syncMetrics: {
          totalSyncs: 0,
          successfulSyncs: 0,
          failedSyncs: 0,
          documentsExtracted: 0,
          hearingsExtracted: 0,
          lastDurationMs: null
        }
      },
      parties: c.parties ?? [],
      processParticipants: c.processParticipants ?? [],
      proceedings: (c.proceedings || []).map(p => ({
        ...p,
        composition: p.composition ?? null
      })),
      // 3. Hearings: новi поля
      hearings: (c.hearings || []).map(h => {
        stats.hearingsUpdated++;
        return {
          ...h,
          source: h.source ?? 'manual',
          sourceConfidence: h.sourceConfidence ?? 'high',
          extractedAt: h.extractedAt ?? null,
          ecitsContext: h.ecitsContext ?? null,
          assignedTo: h.assignedTo ?? null,
          attendedBy: h.attendedBy ?? []
        };
      })
    };
  });
  
  // 4. Users: ecitsCabinetIdentifier
  registry.users = (registry.users || []).map(u => ({
    ...u,
    ecitsCabinetIdentifier: u.ecitsCabinetIdentifier ?? null
  }));
  
  // 5. Bump version
  registry.schemaVersion = 7;
  registry.settingsVersion = '7.0_ecits_canonical';
  
  console.log(`[TASK 0.3.5] Migration done:
  Documents updated: ${stats.documentsUpdated}
  Source enum migration:
    manual_upload → manual: ${stats.sourceRenamed.manual_upload_to_manual}
    ecits → court_sync: ${stats.sourceRenamed.ecits_to_court_sync}
    null/undefined → manual: ${stats.sourceRenamed.null_to_manual}
    telegram kept: ${stats.sourceRenamed.keep_telegram}
    email kept: ${stats.sourceRenamed.keep_email}
    unknown → 'unknown' (fallback): ${stats.sourceRenamed.unknown_other}
  Cases updated: ${stats.casesUpdated}
  Hearings updated: ${stats.hearingsUpdated}
  Users updated: ${registry.users.length}
[TASK 0.3.5] Migration v6.5 → v7 done.`);
  
  return { registry, didMigrate: true, stats };
}
```

**Backup:**
- Створити `backupRegistryDataPreV7(registry)` у `driveService.js` за патерном `backupRegistryDataPreV6_5`
- Файл: `_backups/registry_data_backup_pre_v7_<timestamp>.json`
- Прапор: `levytskyi_pre_v7_backup_done` у localStorage

### 12. App.jsx EFFECT-A — оновити ланцюг міграцій

Додати після `migrateToVersion6_5`:

```js
// EFFECT-A migration chain:
// 1. migrateRegistry(raw) → v4
// 2. migrateRegistryV4toV5(registry) → v5
// 3. migrateToVersion6(registry) → v6
// 4. migrateToVersion6_5(registry) → v6.5
// 5. NEW: migrateToVersion7(registry) → v7

if ((registry.schemaVersion || 1) < 7) {
  try {
    const flag = localStorage.getItem('levytskyi_pre_v7_backup_done');
    if (!flag) {
      await backupRegistryDataPreV7(registry);
      localStorage.setItem('levytskyi_pre_v7_backup_done', '1');
    }
  } catch (e) {
    console.warn('[TASK 0.3.5] Pre-v7 backup failed:', e);
  }
  
  const v7 = migrateToVersion7(registry);
  if (v7.didMigrate) {
    registry = v7.registry;
    didMigrate = true;
    fromVersion = Math.min(fromVersion, 6.5);
    toVersion = 7;
  }
}

// Також у splashRestoreFromBackup — додати виклик migrateToVersion7
```

### 13. Тести

**Існуючі тести які зламаються — оновити:**

| Тест | Файл | Що оновити |
|---|---|---|
| `documentSchema.test.js:19` | toHaveLength(23) | → toHaveLength(28) — 23 існуючих + 5 нових |
| `documentFactory.test.js:98-101` | enum source очікувань | → нові значення |
| `courtSyncInfrastructure.test.js:212-227` | DOCUMENT_SOURCES перелік | → нові значення |
| `founderFlag.test.js:124-129` | CURRENT_SCHEMA_VERSION = 6.5 | → 7, label `'7.0_ecits_canonical'` |
| `migrations.test.js` | toVersion очікування | → 7 |
| `_actionsHarness.js` | додати нові ACTIONS | mark_synced_from_ecits, update_case_ecits_state, 6 edit-ACTIONS |

**Новий тестовий файл `tests/unit/canonicalSchemaV7.test.js`:**

```js
describe('Canonical Schema v7', () => {
  // Schema version
  test('CURRENT_SCHEMA_VERSION is 7', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(7);
  });
  
  test('MIGRATION_VERSION is 7.0_ecits_canonical', () => {
    expect(MIGRATION_VERSION).toBe('7.0_ecits_canonical');
  });
  
  // Migration
  describe('migrateToVersion7', () => {
    test('migrates document source: manual_upload → manual', () => { ... });
    test('migrates document source: ecits → court_sync', () => { ... });
    test('preserves telegram, email source values', () => { ... });
    test('null source → manual', () => { ... });
    test('unknown source → unknown with warning', () => { ... });
    test('adds new document fields with defaults', () => { ... });
    test('adds case.ecitsState with default never status', () => { ... });
    test('adds case.parties[] empty array', () => { ... });
    test('adds case.processParticipants[] empty array', () => { ... });
    test('adds proceeding.composition null', () => { ... });
    test('adds hearing source/ecitsContext/assignedTo/attendedBy defaults', () => { ... });
    test('adds user.ecitsCabinetIdentifier null', () => { ... });
    test('idempotent — running twice does not duplicate', () => { ... });
  });
  
  // ACTIONS
  describe('add_hearing with source', () => {
    test('accepts source parameter and stores it', () => { ... });
    test('default source is manual when not provided', () => { ... });
    test('warns when source not explicitly provided', () => { ... });
    test('extractedAt set when source !== manual', () => { ... });
  });
  
  describe('mark_synced_from_ecits', () => {
    test('updates lastSyncedAt and lastSyncedBy', () => { ... });
    test('increments syncMetrics.totalSyncs', () => { ... });
    test('increments successfulSyncs on status=synced', () => { ... });
    test('increments failedSyncs on status=failed', () => { ... });
    test('publishes ecits.sync_completed with tenantId', () => { ... });
  });
  
  describe('update_case_ecits_state', () => {
    test('merges patch into ecitsState', () => { ... });
    test('respects canOverwrite — does not overwrite manual', () => { ... });
    test('publishes ecits.case_state_updated', () => { ... });
    test('requires source parameter', () => { ... });
  });
  
  describe('6 edit-ACTIONS', () => {
    test('update_parties replaces array', () => { ... });
    test('update_team preserves SaaS v3 permissions structure', () => { ... });
    test('update_process_participants does NOT touch team', () => { ... });
    test('update_proceeding_composition updates target proceeding', () => { ... });
    test('update_document_movement_card writes movement card', () => { ... });
    test('update_alternative_sources appends to array', () => { ... });
    test('all 6 ACTIONS require source parameter (except update_team)', () => { ... });
  });
  
  // PERMISSIONS
  describe('PERMISSIONS roles', () => {
    test('court_sync_agent has all new ACTIONS', () => { ... });
    test('court_sync_agent cannot destroy_case', () => { ... });
    test('court_sync_agent cannot add/update/delete_document', () => { ... });
    test('metadata_extractor_agent has empty allowlist (disabled)', () => { ... });
  });
  
  // sourcePolicy
  describe('sourcePolicy.canOverwrite', () => {
    test('court_sync can overwrite metadata_extractor', () => { ... });
    test('metadata_extractor cannot overwrite court_sync', () => { ... });
    test('manual cannot be overwritten by anything', () => { ... });
    test('unknown source has lowest priority', () => { ... });
  });
  
  // activityTracker exclusion
  describe('Billing hook exclusions', () => {
    test('mark_synced_from_ecits not reported to activityTracker', () => { ... });
    test('update_case_ecits_state not reported to activityTracker', () => { ... });
    test('update_parties with source=manual IS reported', () => { ... });
    test('update_parties with source=court_sync NOT reported', () => { ... });
  });
});
```

Орієнтовно **40-50 нових тестів**. Усі мають бути зеленими перед push.

### 14. CLAUDE.md — оновлення

**Не більше 70-80 рядків нового матеріалу.** Структура:

#### 14.1. Шапка
- schemaVersion 7
- settingsVersion '7.0_ecits_canonical'

#### 14.2. Правило #6 — оновити ланцюг
- v1→v4→v5→v6→v6.5→v7

#### 14.3. У "СТРУКТУРА ДАНИХ → Справа (Case)"
Додати у блок case нові поля з коротким описом (5-7 рядків):
```
ecitsState,           // стан синхронізації з ЄСІТС
parties[],            // процесуальні сторони (структуровано)
processParticipants[], // учасники процесу (захисники-опоненти, прокурор, суддя)
team[],               // ВЖЕ існує — internal bureau team з permissions
```

Додати у блок documents нові поля:
```
source,               // канал походження ('manual', 'court_sync', 'metadata_extractor', ...)
sourceConfidence,
extractedAt,
ecitsSource,          // деталі ЄСІТС-походження
movementCard,         // картка руху документа
alternativeSources    // аудит multi-source
```

Додати у блок proceedings:
```
composition           // склад суду {presiding, reporter, members}
```

#### 14.4. Новий розділ "SCHEMA V7 — ЄСІТС-CANONICAL"
20-30 рядків. Підрозділи:
- Принцип: обидва канали в одну схему
- ADDEDBY VS SOURCE — посилання на TASK 0.3.4 розділ
- Source policy і пріоритетизація
- Дві нові ролі PERMISSIONS
- Tracking debt: deprecated denormalized fields (client, judges) — backfill в окремому TASK

#### 14.5. Новий розділ "AI-FIRST DZERKALO"
Перелік 6 нових edit-ACTIONS і яких полів торкаються — щоб майбутні TASK'и не дублювали.

### 15. Git commit і push

```bash
git add -A
git commit -m "TASK 0.3.5: canonical schema v7 for ECITS integration"
git push origin main
```

---

## ACCEPTANCE CRITERIA

### Schema
- [ ] `CURRENT_SCHEMA_VERSION = 7`, `MIGRATION_VERSION = '7.0_ecits_canonical'`
- [ ] `migrateToVersion7(registry)` функція створена
- [ ] `src/schemas/caseSchema.js` створено
- [ ] `src/schemas/hearingSchema.js` створено
- [ ] `documentSchema.js` розширено 5 новими полями
- [ ] `src/services/sourcePolicy.js` створено з canOverwrite

### ACTIONS
- [ ] `add_hearing` і `update_hearing` приймають source, sourceConfidence, ecitsContext, assignedTo, attendedBy (backward compatible)
- [ ] `mark_synced_from_ecits` працює і інкрементує syncMetrics
- [ ] `update_case_ecits_state` мерджить patch з canOverwrite
- [ ] 6 edit-ACTIONS реалізовано (update_parties, update_team, update_process_participants, update_proceeding_composition, update_document_movement_card, update_alternative_sources)
- [ ] Кожен ACTION публікує відповідну подію у eventBus з tenantId

### PERMISSIONS
- [ ] `court_sync_agent` defined з усіма потрібними ACTIONS
- [ ] `metadata_extractor_agent` defined але порожній allowlist (disabled)
- [ ] Жоден з двох не може destroy_case, add/update/delete_document

### Migration
- [ ] Backup `pre_v7` створюється на Drive перед першою міграцією
- [ ] localStorage прапор `levytskyi_pre_v7_backup_done` запобігає повторному
- [ ] App.jsx EFFECT-A викликає migrateToVersion7 після migrateToVersion6_5
- [ ] splashRestoreFromBackup теж викликає migrateToVersion7
- [ ] Source enum migration: всі documents правильно переоновлені (з console звітом)
- [ ] Всі cases отримали ecitsState з default never
- [ ] Всі users отримали ecitsCabinetIdentifier: null

### Billing
- [ ] `SYSTEM_ACTIONS_NO_BILLING` Set винесено як константу
- [ ] mark_synced_from_ecits НЕ нараховується в time_entries
- [ ] update_case_ecits_state НЕ нараховується
- [ ] Edit-ACTIONS з source !== 'manual' НЕ нараховуються
- [ ] Edit-ACTIONS з source === 'manual' нараховуються нормально

### Embryo
- [ ] Папка `src/services/metadataExtractor/` створена з README.md (60-80 рядків)

### Tests
- [ ] `tests/unit/canonicalSchemaV7.test.js` створено з 40+ тестами
- [ ] `documentSchema.test.js` оновлено (28 полів)
- [ ] `documentFactory.test.js` оновлено (нові enum)
- [ ] `courtSyncInfrastructure.test.js` оновлено (нові source values)
- [ ] `founderFlag.test.js` оновлено (version 7)
- [ ] `migrations.test.js` оновлено
- [ ] `_actionsHarness.js` має нові ACTIONS
- [ ] Усі попередні тести зелені

### Documentation
- [ ] CLAUDE.md оновлено — нова шапка, правило #6, структура даних, розділ Schema v7
- [ ] Тable "ADDEDBY VS SOURCE" посилається на TASK 0.3.4
- [ ] Tracking debt задокументований (deprecated client/judges)

### Build
- [ ] Vite build success без нових warnings (порівняно з main гілкою)
- [ ] Git commit + push успішний

---

## ЩО НЕ РОБИТИ

- НЕ створювати ACTIONS відкладені для майбутніх TASK (add_timeline_event, update_case_dnzs)
- НЕ створювати UI для нових полів (це наступні TASK'и)
- НЕ активувати `metadata_extractor_agent` (тільки defined)
- НЕ писати реальний парсер Metadata Extractor (тільки README)
- НЕ чіпати `case.team` semantics (Варіант A — додаємо processParticipants)
- НЕ перейменовувати `client` чи `judges` (denormalized, backfill потім)
- НЕ міняти формат PERMISSIONS на об'єктний (зберігаємо масиви строк)
- НЕ переписувати executeAction (зберігаємо)
- НЕ створювати нові schema-bumps окрім v7

---

## SAAS IMPLICATIONS

**Multi-tenant readiness:**
- `case.ecitsState.lastSyncedBy` — userId
- `document.ecitsSource.receivedThroughCabinet.userId` — userId
- `document.ecitsSource.receivedAlsoThroughCabinet[]` — масив userId
- `hearing.assignedTo` і `attendedBy[]` — userId
- `user.ecitsCabinetIdentifier` — як адвокат відомий у ЄСІТС

**Tenant isolation:**
- Усі нові структури зберігаються в межах `cases[]` — успадковують tenantId з parent
- eventBus події містять tenantId у payload для майбутнього per-tenant routing

**Per-tenant аналітика:**
- Source-мітка дозволяє рахувати "скільки документів через Court Sync vs інші канали"
- syncMetrics — готова статистика для tenant dashboard

**Tenant entitlements:**
- `metadata_extractor_agent` як disabled роль — точка для майбутніх tarифів (Premium tenants отримають доступ коли парсер буде готовий)

---

## BILLING IMPLICATIONS

**Точки інструментації:**
- `SYSTEM_ACTIONS_NO_BILLING` Set винесено як константа для контрольованого розширення
- mark_synced_from_ecits, update_case_ecits_state — НЕ нараховуються (системні дії)
- 6 edit-ACTIONS — нараховуються тільки якщо source === 'manual' (адвокат через UI/агента)
- Викликані з source court_sync чи metadata_extractor — НЕ нараховуються (автосинхронізація не робота адвоката)

**Категорії time_entries:**
- Жодних нових категорій. Edit-ACTIONS з manual попадають у звичайну `case_work`.

**Аналітика для tenant dashboard (майбутнє):**
- `syncMetrics.totalSyncs * estimated_time_saved_per_sync` = час зекономлений модулем ЄСІТС
- ROI argument для маркетингу: показуємо адвокату "система зекономила вам N годин цього місяця"

---

## AI USAGE IMPLICATIONS

Цей TASK не зачіпає AI usage напряму. Жоден агент не викликається в межах міграції.

Майбутнє:
- TASK 0.4 буде логувати ai_usage коли Claude for Chrome виконує синхронізацію
- TASK Metadata Extractor (майбутній) буде логувати свої AI виклики

---

## SEMANTIC CLARITY CHECK (РЕЗУЛЬТАТ)

Після виконання TASK:
- ✅ Жодного зіткнення таксономій (`addedBy` vs `source` вирішено в 0.3.4)
- ✅ Кожне поле має одне ім'я, один сенс
- ✅ Обидва канали (Court Sync, Metadata Extractor) пишуть в одну схему — споживачі не розрізняють
- ✅ Multi-user готовність (userId у ключових місцях)
- ✅ Billing готовність (виключення з activityTracker)
- ✅ AI-first дзеркало (6 edit-ACTIONS, поля не мертві)
- ✅ Tracking debt задокументований (deprecated denormalized fields)
- ✅ Правило #11 виконано

---

## ЗВІТ ПІСЛЯ ВИКОНАННЯ

Створити `report_task_0_3_5_canonical_schema_v7.md`:
- Перелік усіх змінених файлів (приблизно 15-20)
- Console.log виводу міграції (статистика)
- Список усіх нових ACTIONS зі сигнатурами
- Список нових тестів і їх кількість
- Підтвердження що всі тести зелені (npm test output)
- Підтвердження Vite build success
- Будь-які побічні знахідки (як було в TASK 0.3.4) — в окремий `bugs_found_during_task_0_3_5.md`
- Підтвердження git push (`git log -1` output)

---

**Кінець TASK 0.3.5.**

**Після виконання — приступаємо до TASK 0.4 (синхронізація засідань) на готовій канонічній схемі.**
