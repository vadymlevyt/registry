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
  // addedBy — ХТО/ЩО зробило акт додавання запису в систему (actor).
  // Не плутати з document.source — там канал ПОХОДЖЕННЯ файлу, не actor.
  // Розділення формалізовано в TASK 0.3.4 (правило #11 — одне ім'я, один сенс).
  addedBy: {
    type: 'string',
    required: true,
    enum: ['user', 'agent', 'system'],
    default: 'user',
    description: 'ХТО/ЩО зробило акт додавання запису. user = адвокат/помічник вручну (UI або модалка). agent = AI-агент (QI, dossier, document processor). system = системна дія (міграція, автоматична синхронізація з зовнішніх каналів).'
  },

  // ── Стан ──────────────────────────────────────────────────────────────────
  status: {
    type: 'string',
    required: true,
    enum: ['active', 'archived'],
    default: 'active'
  },

  // ── Джерело надходження ──────────────────────────────────────────────────
  // source — канал ПОХОДЖЕННЯ файлу (TASK 0.3.5 v7 — переіменовано і розширено).
  // НЕ плутати з document.addedBy (actor — хто додав запис, з TASK 0.3.4 v6.5).
  // Довідник значень — src/constants/documentSources.js.
  // Міграція v6.5→v7: 'manual_upload'→'manual', 'ecits'→'court_sync',
  // null/undefined → 'manual', невідоме → 'unknown' з warning.
  source: {
    type: 'string',
    required: false,
    nullable: true,
    enum: ['manual', 'court_sync', 'metadata_extractor', 'telegram', 'email', 'unknown', null],
    default: 'manual',
    description: 'Канал ПОХОДЖЕННЯ файлу. manual = адвокат завантажив локально. court_sync = синхронізовано з ЄСІТС-кабінету. metadata_extractor = парсинг файлу не-ЄСІТС каналу. telegram/email = відповідні канали. unknown = невідоме походження (fallback при міграції). null = старі документи до v7. НЕ плутати з document.addedBy (actor).'
  },

  // ── Впевненість у джерелі ──────────────────────────────────────────────
  // sourceConfidence — наскільки можна довіряти даним з цього source.
  // high = адвокат підтвердив або синхронізація з офіційного джерела.
  // medium = автоматичний парсинг з ймовірністю помилки.
  // low = здогадка (наприклад, OCR з неякісного скану).
  sourceConfidence: {
    type: 'string',
    required: false,
    nullable: true,
    enum: ['high', 'medium', 'low', null],
    default: 'high',
    description: 'Впевненість у source-даних. Default high для існуючих (адвокат вручну).'
  },

  // ── Час витягнення/створення ─────────────────────────────────────────
  // extractedAt — коли запис було витягнуто/створено в системі. Default null
  // для старих документів. Заповнюється для записів з source != manual.
  extractedAt: {
    type: 'string',
    required: false,
    nullable: true,
    format: 'datetime',
    default: null,
    description: 'Коли запис було витягнуто/створено в системі (ISO datetime). null для старих або manual.'
  },

  // ── Деталі ЄСІТС-походження ──────────────────────────────────────────
  // ecitsSource — заповнюється коли source === court_sync або
  // metadata_extractor парсить ЄСІТС-документ. Multi-user готовність:
  // userId фіксує через чий кабінет первинно отримано.
  // Не плутати з movementCard — там окрема семантика (рух у судовій системі).
  ecitsSource: {
    type: 'object',
    required: false,
    nullable: true,
    default: null,
    description: 'Деталі ЄСІТС-походження. Заповнюється для source court_sync. Структура: { ecitsDocumentId, ecitsNotificationId, notificationType, cabinetUrl, receivedThroughCabinet: { userId, cabinetIdentifier }, receivedAlsoThroughCabinet: [{ userId, cabinetIdentifier }] }.'
  },

  // ── Картка руху документа ────────────────────────────────────────────
  // movementCard — повна таблиця доставки документа в межах судової системи.
  // Окрема структура від ecitsSource: ecitsSource = звідки/коли в систему,
  // movementCard = коли і кому доставлено учасникам.
  movementCard: {
    type: 'object',
    required: false,
    nullable: true,
    default: null,
    description: 'Картка руху документа з ЄСІТС. Структура: { state, dnzs, documentDate, infoDeliveryToECourt, fileDeliveryToECourt, deliveries: [...], attachments: [...] }.'
  },

  // ── Аудит multi-source синхронізації ─────────────────────────────────
  // alternativeSources — коли різні канали повернули дані про той самий
  // документ. Зростає при multi-source синхронізаціях. Default [].
  alternativeSources: {
    type: 'array',
    required: false,
    default: [],
    description: 'Аудит коли різні канали повернули дані про той самий документ. Кожен елемент: { source, sourceConfidence, receivedAt, dataHash }.'
  },

  // ── Оригінал поряд з PDF ──────────────────────────────────────────────────
  // Коли документ потрапляє у систему у форматі, який конвертується у PDF для
  // відображення (DOCX), оригінал зберігається на Drive окремо. driveId завжди
  // вказує на PDF (для Viewer), originalDriveId — на оригінал (для завантаження
  // адвокатом). HTML і зображення оригінали не зберігаються — originalDriveId null.
  // Nullable, default null — додано без schema bump (за прецедентом source).
  originalDriveId: {
    type: 'string',
    required: false,
    nullable: true,
    description: 'Google Drive ID оригіналу (DOCX) поряд з PDF. null коли оригінал не зберігається.'
  },
  originalMime: {
    type: 'string',
    required: false,
    nullable: true,
    description: 'MIME-тип оригіналу до конвертації. Для PDF без конвертації — application/pdf.'
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
