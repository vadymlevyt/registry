// ── CASE CANONICAL SCHEMA ────────────────────────────────────────────────────
// Канонічна форма справи (case) — TASK 0.3.5 v7.
//
// Описова схема (не factory). Case-об'єкти створюються через ACTIONS у App.jsx
// (create_case, update_case_field тощо), а цей файл служить:
//   • Документація канонічної форми для агентів і нових розробників
//   • Тестовий референс — перевіряти що ACTIONS повертають структуру з усіма полями
//   • Реєстр deprecated denormalized полів (client, judges) — щоб майбутні
//     backfill TASK'и знали що зачищати
//
// Ієрархія схем:
//   • caseSchema (цей файл) — справа з усіма полями (legacy + SaaS + ЄСІТС)
//   • documentSchema — документ всередині справи (cases[].documents[])
//   • hearingSchema — засідання (cases[].hearings[])
//
// SaaS-готовність: всі нові v7-поля (parties, processParticipants, ecitsState)
// несуть source-мітку для розрізнення каналу походження. Multi-user готовність
// через userId у processParticipants[].userId і ecitsState.lastSyncedBy.

export const CANONICAL_CASE_FIELDS = {
  // ── Legacy (вже існують у системі) ─────────────────────────────────────
  id: { type: 'string', required: true, description: 'case_<n> або case_<timestamp>' },
  name: { type: 'string', required: true, description: 'Коротка назва справи (прізвище клієнта чи короткий опис)' },
  client: {
    type: 'string',
    required: false,
    deprecated: true,
    description: 'DEPRECATED denormalized summary. Real source: parties[]. Залишається для UI рендерингу до окремого backfill TASK. UI продовжує читати c.client.'
  },
  category: {
    type: 'string',
    enum: ['civil', 'criminal', 'admin', 'commercial', 'administrative_offense', null],
    required: false,
    nullable: true,
    description: "null = категорія не визначена (потребує уточнення). " +
      "'admin' (legacy ім'я для адмінсуду) = envelope 'administrative'. " +
      "'administrative_offense' (адмінправопорушення) ≠ 'admin' — інша юрисдикція (правило #11). " +
      "'military' прибрано (TASK case_ui_and_result_polish §3): військові справи " +
      "юридично адміністративні — мігруються military→admin у normalizeCases.",
  },
  status: { type: 'string', enum: ['active', 'paused', 'closed'], required: true },

  // ── NEW v12 — Процесуальна роль адвоката у справі (TASK v12 §1) ──────────
  // Top-level (а не в ecitsState) бо стабільний атрибут справи, застосовний
  // і до ручних справ. ecitsState — для transient sync-стану (правило #11).
  advocateRole: {
    type: 'string',
    required: false,
    nullable: true,
    description: 'Головна процесуальна роль адвоката у справі. ' +
      "Дозволені значення: ADVOCATE_ROLE_VALUES у scenarioProcessor.js. " +
      'Може бути null коли не визначено (нова справа без імпорту).',
  },
  advocateRoles: {
    type: 'array',
    required: false,
    default: [],
    description: 'Повний набір ролей адвоката у справі (може мати кілька). ' +
      'Перший елемент === advocateRole. ' +
      'Для legacy-справ і коли advocateRole=null — порожній масив.',
  },
  court: { type: 'string', required: false },
  case_no: { type: 'string', required: false },
  judge: {
    type: 'string',
    required: false,
    deprecated: true,
    description: 'DEPRECATED denormalized text. Real source: proceedings[].composition. Backfill потім.'
  },
  next_action: { type: 'string', required: false },

  // Вкладені сутності (мають окремі схеми)
  hearings: { type: 'array', description: 'Засідання справи. Структура — hearingSchema.js.' },
  deadlines: { type: 'array', description: 'Дедлайни справи. Структура: { id, name, date, createdBy }.' },
  notes: { type: 'array', description: 'Нотатки справи. Bucket-структура у localStorage окремо для не-case.' },
  documents: { type: 'array', description: 'Документи справи. Структура — documentSchema.js (canonical 28 полів v7).' },
  proceedings: { type: 'array', description: 'Провадження. Структура — CANONICAL_PROCEEDING_FIELDS нижче.' },

  storage: { type: 'object', description: '{ driveFolderId, subFolders: { "01_ОРИГІНАЛИ": id, ... } }' },
  agentHistory: { type: 'array', description: '3-tier cache: Drive → localStorage → registry. Slice 50.' },
  pinnedNoteIds: { type: 'array' },
  timeLog: { type: 'array', deprecated: true, description: 'DEPRECATED since v4. Use top-level time_entries[].' },

  // ── SaaS Foundation v2/v3 ──────────────────────────────────────────────
  tenantId: { type: 'string', required: true, description: 'Власність організації' },
  ownerId: { type: 'string', required: true, description: 'Провідний адвокат (ownerUserId з tenantService)' },
  createdAt: { type: 'string', format: 'datetime' },
  updatedAt: { type: 'string', format: 'datetime' },
  shareType: { type: 'string', enum: ['private', 'internal', 'external'] },
  externalAccess: { type: 'array', description: '[{ userId, validUntil, ... }] для тимчасового доступу' },

  team: {
    type: 'array',
    required: true,
    description: 'INTERNAL bureau team з permissions. Семантика: хто з бюро має доступ до справи. NOT процесуальні учасники — для них окреме поле processParticipants[]. Зберігає SaaS Foundation v3 структуру.',
    elementSchema: {
      userId: 'string (required)',
      caseRole: 'lead | owner | co-lead | support | external',
      addedAt: 'ISO datetime',
      addedBy: 'userId',
      permissions: '{ canEdit, canDelete, canShare, canAddTeam, canViewBilling, canEditBilling, canRunAI } (всі boolean)',
    },
  },

  lastProcessingContext: {
    type: 'object',
    required: false,
    description: 'Контекст останньої обробки документів через DocumentProcessor. { processedAt, documentsCount, summary }.'
  },

  // ── NEW v7 — ЄСІТС-готовність ──────────────────────────────────────────

  ecitsState: {
    type: 'object',
    required: false,
    description: 'Стан синхронізації з ЄСІТС-кабінетом. Multi-user готовність через lastSyncedBy. Default при міграції — { syncStatus: "never", решта null/0 }.',
    schema: {
      caseId: 'string | null (ID справи в ЄСІТС, 32-hex)',
      filedAt: 'ISO date | null (дата надходження до суду)',
      court: 'string | null (повна назва суду з кабінету, може відрізнятись від case.court)',
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
        lastDurationMs: 'number | null',
      },
      // NEW v12 (TASK v12 §4) — знімок дат документів зі списку кабінету ЄСІТС.
      // Провенанс: це показ кабінету, НЕ власні case.documents[] Legal BMS.
      // lastDocumentDate — сигнал активності. Top-level імена у самій справі
      // дублювали б сенс із case.documents[] (правило #11) — тому тримаємо тут.
      firstDocumentDate: 'ISO date (yyyy-mm-dd) | null',
      lastDocumentDate: 'ISO date (yyyy-mm-dd) | null',
      _lastSource: 'string (internal: source останнього оновлення для canOverwrite logic)',
    },
  },

  parties: {
    type: 'array',
    required: false,
    default: [],
    description: 'Процесуальні сторони справи (структуровано). Не плутати з team[] (internal bureau) і processParticipants[] (всі учасники процесу). Default [] при міграції — заповнюється потім з parsing або вручну.',
    elementSchema: {
      role: 'plaintiff | defendant | third_party | accused | victim | legal_representative',
      fullName: 'string',
      code: 'string | null (РНОКПП або ЄДРПОУ)',
      position: 'number (порядковий номер у списку, 1-based)',
      source: "'manual' | 'court_sync' | 'metadata_extractor' | 'unknown'",
      sourceConfidence: 'high | medium | low | null',
      extractedAt: 'ISO datetime | null',
    },
  },

  processParticipants: {
    type: 'array',
    required: false,
    default: [],
    description: 'Усі процесуальні учасники справи: захисники (включно з зовнішніми), прокурор, суддя, секретар. На відміну від team[] не несе permissions — це read-only довідка про склад процесу. Multi-user готовність через userId (null для зовнішніх).',
    elementSchema: {
      role: 'lawyer | prosecutor | judge | secretary | legal_representative',
      caseRole: 'defender | plaintiff_rep | defendant_rep | third_party_rep | general | null',
      fullName: 'string',
      userId: 'string | null (null для зовнішніх, userId для адвокатів бюро)',
      isOurLawyer: 'boolean (shortcut для UI)',
      representsParty: 'string | null (ПІБ кого захищає/представляє)',
      source: "'manual' | 'court_sync' | 'metadata_extractor' | 'unknown'",
      sourceConfidence: 'high | medium | low | null',
      extractedAt: 'ISO datetime | null',
    },
  },
};

// proceedings[] — кожен елемент має нижченаведену структуру.
// Розширено в v7 полем composition.
export const CANONICAL_PROCEEDING_FIELDS = {
  id: { type: 'string', required: true },
  type: { type: 'string', required: true, description: 'first | appeal | cassation тощо. Не редагується після створення.' },
  title: { type: 'string', required: true },
  court: { type: 'string', required: false },
  status: { type: 'string', required: false, description: 'active | paused | closed' },
  parentProcId: { type: 'string', required: false, nullable: true },
  parentEventId: { type: 'string', required: false, nullable: true },
  caseNumber: { type: 'string', required: false },
  dateOpened: { type: 'string', required: false, format: 'date' },
  judges: {
    type: 'string',
    required: false,
    deprecated: true,
    description: 'DEPRECATED denormalized text. Real source: composition. Backfill потім.'
  },
  description: { type: 'string', required: false },
  color: { type: 'string', required: false },
  addedAt: { type: 'string', format: 'datetime' },
  updatedAt: { type: 'string', format: 'datetime' },

  // NEW v7
  composition: {
    type: 'object',
    required: false,
    nullable: true,
    default: null,
    description: 'Склад суду в провадженні. Заповнюється з ЄСІТС. Default null при міграції.',
    schema: {
      presiding: '{ fullName: string, userId: string | null } | null',
      reporter: '{ fullName: string, userId: string | null } | null',
      members: 'Array<{ fullName: string, userId: string | null }>',
    },
  },
};

// Поточна версія схеми case (узгоджена з registry-схемою v12 —
// розширення ролей/категорій/дат для контракту ЄСІТС-envelope, TASK v12).
export const CURRENT_CASE_SCHEMA_VERSION = 12;

// Перелік deprecated полів — для майбутнього backfill TASK
export const DEPRECATED_CASE_FIELDS = ['client', 'judge', 'timeLog'];
export const DEPRECATED_PROCEEDING_FIELDS = ['judges'];

/**
 * Перевірка чи об'єкт має обов'язкові canonical-поля. Не повна валідація —
 * для строгої сверки треба окремий validator (з міграційного контракту).
 */
export function hasMinimumCaseFields(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return typeof obj.id === 'string' &&
         typeof obj.name === 'string' &&
         typeof obj.tenantId === 'string' &&
         typeof obj.ownerId === 'string' &&
         Array.isArray(obj.team);
}

/**
 * Перевірка чи провадження валідне.
 */
export function hasMinimumProceedingFields(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return typeof obj.id === 'string' &&
         typeof obj.type === 'string' &&
         typeof obj.title === 'string';
}
