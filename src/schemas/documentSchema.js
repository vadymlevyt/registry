// ── DOCUMENT CANONICAL SCHEMA ────────────────────────────────────────────────
// Канонічна схема документа для Phase 1.5 (Канон даних і ACTIONS).
//
// Розділення:
//   • 18 ЛЕГКИХ полів (CANONICAL_DOCUMENT_FIELDS) — у cases[].documents[]
//     в registry_data.json. Завантажуються разом з реєстром.
//   • 6 ВАЖКИХ полів (EXTENDED_DOCUMENT_FIELDS) — у .metadata/documents_extended.json
//     папки кожної справи. Lazy-load коли потрібно.
//
// Принцип Single Source of Truth: для кожної справи — лише ці два файли.
// Жодних паралельних documents_index.json.
//
// Документ потребує перегляду (маркер ⚠) якщо хоча б одне з критичних полів
// (procId, category, author) дорівнює null.

export const CANONICAL_DOCUMENT_FIELDS = {
  // ── Ідентифікація ─────────────────────────────────────────────────────────
  id: { type: 'string', required: true, description: 'doc_<ts>_<rand>' },
  name: { type: 'string', required: true, description: 'Людська назва документа' },
  originalName: { type: 'string', required: false, description: "Оригінальне ім'я файлу як прийшло" },

  // ── Класифікація ──────────────────────────────────────────────────────────
  // category і author — required АЛЕ nullable. null → маркер ⚠.
  category: {
    type: 'string',
    required: true,
    nullable: true,
    enum: ['pleading', 'motion', 'court_act', 'evidence', 'contract', 'correspondence', 'identification', 'other', null],
    description: 'Тип документа. null = маркер ⚠'
  },
  author: {
    type: 'string',
    required: true,
    nullable: true,
    // Канонічне значення — 'opponent' (узгоджено з UI AUTHOR_LABELS і seed-даними).
    // Legacy 'opp' (з TASK 1.1) конвертується у 'opponent' міграцією v4→v5.
    enum: ['ours', 'opponent', 'court', 'third_party', null],
    description: 'Хто автор. null = маркер ⚠'
  },
  documentNature: {
    type: 'string',
    required: true,
    enum: ['searchable', 'scanned'],
    description: 'searchable = є текстовий шар, scanned = тільки зображення'
  },
  namingStatus: {
    type: 'string',
    required: true,
    enum: ['auto', 'manual', 'pending'],
    description: 'auto = згенеровано системою, manual = адвокат перейменував, pending = очікує'
  },
  isKey: { type: 'boolean', required: true, default: false, description: 'Ключовий документ ⭐' },

  // ── Зв'язки ───────────────────────────────────────────────────────────────
  procId: {
    type: 'string',
    required: true,
    nullable: true,
    description: 'ID провадження. null = маркер ⚠. Посилається на case.proceedings[].id'
  },

  // ── Drive ─────────────────────────────────────────────────────────────────
  // driveId required+nullable: запис мусить мати поле, але voно може бути null
  // (storage failure, seed-документи INITIAL_CASES без файлу).
  driveId: { type: 'string', required: true, nullable: true, description: 'Google Drive file ID' },
  driveUrl: { type: 'string', required: false, description: 'Прямий URL на Drive' },
  folder: {
    type: 'string',
    required: true,
    enum: ['00_INBOX_СПРАВИ', '01_ОРИГІНАЛИ', '02_ОБРОБЛЕНІ', '03_ФРАГМЕНТИ', '04_ПОЗИЦІЯ', '05_ЗОВНІШНІ'],
    description: 'У якій підпапці справи лежить'
  },

  // ── Розмір і формат ───────────────────────────────────────────────────────
  pageCount: { type: 'number', required: false, description: 'Кількість сторінок' },
  size: { type: 'number', required: true, description: 'Розмір файлу в байтах' },
  icon: { type: 'string', required: true, default: '📄', description: 'Емодзі іконка типу документа' },

  // ── Дати ──────────────────────────────────────────────────────────────────
  date: { type: 'string', required: false, format: 'date', description: 'Дата документа (не створення запису). YYYY-MM-DD' },
  addedAt: { type: 'string', required: true, format: 'datetime', description: 'ISO timestamp коли додано в систему' },
  updatedAt: { type: 'string', required: true, format: 'datetime', description: 'ISO timestamp останнього оновлення' },

  // ── Аудит для SaaS ────────────────────────────────────────────────────────
  // На етапі ембріона зберігається роль/джерело. У майбутньому SaaS-розгортанні
  // може стати userId або { userId, role } — структуру вже закладено.
  addedBy: {
    type: 'string',
    required: true,
    enum: ['lawyer_via_dp', 'lawyer_manual', 'agent', 'ecits', 'migration'],
    description: 'Хто додав документ'
  },

  // ── Стан ──────────────────────────────────────────────────────────────────
  status: {
    type: 'string',
    required: true,
    enum: ['active', 'archived'],
    default: 'active'
  }
};

// Важкі поля живуть у .metadata/documents_extended.json і завантажуються лише
// коли потрібно (відкриття вкладки документа, режим Текст у Viewer тощо).
export const EXTENDED_DOCUMENT_FIELDS = {
  documentId: { type: 'string', required: true, description: "Зв'язок з canonical id" },
  tags: { type: 'array', items: 'string', default: [] },
  notes: { type: 'string', default: '' },
  annotations: {
    type: 'array',
    items: 'object',
    description: 'Анотації документа (працюють у режимі Текст у Viewer)',
    default: []
  },
  processingHistory: {
    type: 'array',
    items: 'object',
    description: 'Історія обробки: events створення, OCR, нарізки, ручних правок',
    default: []
  },
  extractedTextSummary: {
    type: 'string',
    description: '200-500 символів короткого змісту для tooltip превью',
    default: ''
  },
  customFields: { type: 'object', default: {} }
};

// Поля, відсутність значення яких породжує маркер ⚠ у списку документів.
export const CRITICAL_FIELDS_FOR_WARNING = ['procId', 'category', 'author'];

// Поточна версія схеми реєстру. Інкрементується разом з міграцією.
// Файл-сусід src/services/migrationService.js зберігає окремий CURRENT_SCHEMA_VERSION
// для базового ланцюга v1→v4. Міграція v4→v5 додається окремим файлом
// src/services/migrations/v4ToV5.js і викликається в App.jsx послідовно
// після migrateRegistry().
export const CURRENT_SCHEMA_VERSION = 5;
