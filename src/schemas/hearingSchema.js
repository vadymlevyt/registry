// ── HEARING CANONICAL SCHEMA ─────────────────────────────────────────────────
// Канонічна форма засідання (hearing) — TASK 0.3.5 v7.
//
// Описова схема (не factory). Hearings створюються через ACTION add_hearing
// у App.jsx, цей файл служить документацією і референсом для тестів.
//
// Розширено в v7 полями source/sourceConfidence/extractedAt/ecitsContext
// (для синхронізації з ЄСІТС) і assignedTo/attendedBy (multi-user готовність).

export const CANONICAL_HEARING_FIELDS = {
  // ── Legacy (вже існують) ─────────────────────────────────────────────
  id: { type: 'string', required: true, description: 'hrg_<ts>_<rand>' },
  date: { type: 'string', required: true, format: 'date', description: 'YYYY-MM-DD' },
  time: { type: 'string', required: true, description: 'HH:MM (UA timezone)' },
  duration: { type: 'number', required: false, default: 120, description: 'Тривалість у хвилинах' },
  status: {
    type: 'string',
    required: true,
    enum: ['scheduled', 'held', 'postponed', 'cancelled', 'completed'],
    default: 'scheduled',
  },
  type: { type: 'string', required: false, nullable: true, description: 'preparatory | main | appeal etc.' },
  court: { type: 'string', required: false, nullable: true },
  notes: { type: 'string', required: false, nullable: true },

  // SaaS Foundation — createdBy існує з v2/v3
  createdBy: { type: 'string', required: false, description: 'userId автора запису' },

  // ── NEW v7 ──────────────────────────────────────────────────────────

  source: {
    type: 'string',
    required: false,
    enum: ['manual', 'court_sync', 'metadata_extractor', 'unknown'],
    default: 'manual',
    description: 'Канал з якого отримано інформацію про засідання. manual = адвокат вручну. court_sync = з ЄСІТС-кабінету. metadata_extractor = парсинг не-ЄСІТС. unknown = невідомо (fallback).',
  },

  sourceConfidence: {
    type: 'string',
    required: false,
    nullable: true,
    enum: ['high', 'medium', 'low', null],
    default: 'high',
    description: 'Впевненість у даних про засідання.',
  },

  extractedAt: {
    type: 'string',
    required: false,
    nullable: true,
    format: 'datetime',
    default: null,
    description: 'Коли запис витягнуто. null для manual, заповнюється для синхронізацій.',
  },

  ecitsContext: {
    type: 'object',
    required: false,
    nullable: true,
    default: null,
    description: 'Деталі повідомлення з ЄСІТС яке містило інформацію про засідання. Заповнюється коли source === court_sync або metadata_extractor парсить ЄСІТС-документ.',
    schema: {
      ecitsNotificationId: 'string',
      notificationDocumentType: 'string ("Внесення дат слухання", "Судова повістка про виклик в суд" тощо)',
      notifiedAt: 'ISO datetime (коли повідомлено про засідання)',
      deliveredToCabinetAt: 'ISO datetime | null',
      emailSentAt: 'ISO datetime | null',
      cabinetUrl: 'string | null',
    },
  },

  assignedTo: {
    type: 'string',
    required: false,
    nullable: true,
    default: null,
    description: 'Multi-user готовність: userId адвоката бюро відповідального за це засідання. Default null поки multi-user не активований. При активації може бути заповнено вручну або через автологіку.',
  },

  attendedBy: {
    type: 'array',
    required: false,
    default: [],
    description: 'Multi-user готовність: масив userId адвокатів бюро що були присутні на засіданні. Заповнюється агентом досьє при підтвердженні засідання або вручну.',
    elementType: 'string (userId)',
  },
};

// Поточна версія схеми hearing (узгоджена з registry-схемою v7).
export const CURRENT_HEARING_SCHEMA_VERSION = 7;

/**
 * Перевірка чи об'єкт має обов'язкові canonical-поля.
 */
export function hasMinimumHearingFields(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return typeof obj.id === 'string' &&
         typeof obj.date === 'string' &&
         typeof obj.time === 'string';
}

/**
 * Чи hearing з системного джерела (court_sync чи metadata_extractor).
 * Зручний хелпер для UI/білінгу — system-sourced дії не нараховуються в time_entries.
 */
export function isSystemSourced(hearing) {
  return hearing?.source === 'court_sync' || hearing?.source === 'metadata_extractor';
}
