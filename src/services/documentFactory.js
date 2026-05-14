// ── DOCUMENT FACTORY ─────────────────────────────────────────────────────────
// Єдина точка створення/валідації документа. Замінює чотири історичні точки
// (DocumentProcessor processedFiles, DocumentProcessor splitPDF, CaseDossier
// модаль "+ Додати документ", INITIAL_CASES) і виправляє несумісні формати ID
// (Date.now() без префіксу в CaseDossier vs doc_${Date.now()}_${i} в DP).
//
// Структура див. src/schemas/documentSchema.js.

import { CANONICAL_DOCUMENT_FIELDS, CRITICAL_FIELDS_FOR_WARNING } from '../schemas/documentSchema.js';

// Генератор id у стилі вже існуючих сутностей проекту
// (пор. te_legacy_${Math.random().toString(36).slice(2,8)} у migrationService.js).
// nanoid не доданий навмисно — не вводимо нову npm-залежність.
function generateDocumentId() {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `doc_${ts}_${rand}`;
}

// Нормалізація legacy значень addedBy на новий enum (TASK 0.3.4 cleanup).
// safety net для будь-якої точки коду яка ще передає старе значення.
// Невідоме значення → 'user' з warning у консоль.
const ADDEDBY_LEGACY_MAP = {
  lawyer_via_dp: 'user',
  lawyer_manual: 'user',
  agent: 'agent',
  ecits: 'system',
  migration: 'system',
  user: 'user',
  system: 'system',
};

function normalizeAddedBy(value) {
  if (value === undefined || value === null) return 'user';
  const mapped = ADDEDBY_LEGACY_MAP[value];
  if (mapped) return mapped;
  // eslint-disable-next-line no-console
  console.warn(`[documentFactory] Unknown addedBy value '${value}', falling back to 'user'`);
  return 'user';
}

// Створити валідний об'єкт документа з сирих метаданих.
// Сирі метадані можуть містити legacy-поля (tags, notes, scanned, ...) —
// ця функція їх ігнорує: важкі поля живуть у documents_extended.json.
export function createDocument(metadata = {}) {
  const now = new Date().toISOString();
  const id = metadata.id || generateDocumentId();

  return {
    id,
    name: metadata.name || metadata.originalName || 'Без назви',
    originalName: metadata.originalName || null,

    category: metadata.category ?? null,
    author: metadata.author ?? null,
    documentNature: metadata.documentNature || detectNature(metadata),
    namingStatus: metadata.namingStatus || 'pending',
    isKey: metadata.isKey === true,

    procId: metadata.procId ?? null,

    driveId: metadata.driveId || null,
    driveUrl: metadata.driveUrl || null,
    folder: metadata.folder || '01_ОРИГІНАЛИ',

    pageCount: typeof metadata.pageCount === 'number' ? metadata.pageCount : null,
    size: typeof metadata.size === 'number' ? metadata.size : 0,
    icon: metadata.icon || pickIcon(metadata),

    date: metadata.date || null,
    addedAt: metadata.addedAt || now,
    updatedAt: metadata.updatedAt || now,

    addedBy: normalizeAddedBy(metadata.addedBy),
    status: metadata.status || 'active',

    // source — канал надходження. null означає "невідомо" (старі документи
    // або точки створення які ще не передають source).
    source: metadata.source ?? null,

    // originalDriveId / originalMime — оригінал поряд з PDF (DOCX→PDF
    // конвертація). Для PDF/HTML/images null (оригінал не зберігається).
    originalDriveId: metadata.originalDriveId ?? null,
    originalMime: metadata.originalMime ?? null,
  };
}

// Перевірити що об'єкт відповідає канонічній схемі.
// Не "розумна" — рівно сверка required / type / enum / nullable.
export function validateDocument(doc) {
  const errors = [];

  for (const [fieldName, fieldDef] of Object.entries(CANONICAL_DOCUMENT_FIELDS)) {
    const value = doc?.[fieldName];

    // required + не nullable: значення мусить бути задане і не null/''
    if (fieldDef.required && !fieldDef.nullable) {
      if (value === undefined || value === null || value === '') {
        errors.push(`Поле '${fieldName}' є обов'язковим`);
        continue;
      }
    }

    // required + nullable: поле має існувати, може бути null
    if (fieldDef.required && fieldDef.nullable && value === undefined) {
      errors.push(`Поле '${fieldName}' має бути присутнім (може бути null)`);
      continue;
    }

    // Для null/undefined у nullable полях далі не валідуємо
    if (value === null || value === undefined) continue;

    // type
    if (fieldDef.type === 'string' && typeof value !== 'string') {
      errors.push(`Поле '${fieldName}' має бути string, отримано ${typeof value}`);
    }
    if (fieldDef.type === 'number' && typeof value !== 'number') {
      errors.push(`Поле '${fieldName}' має бути number, отримано ${typeof value}`);
    }
    if (fieldDef.type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`Поле '${fieldName}' має бути boolean, отримано ${typeof value}`);
    }

    // enum
    if (fieldDef.enum && !fieldDef.enum.includes(value)) {
      errors.push(`Поле '${fieldName}' має бути одним з [${fieldDef.enum.map(v => v === null ? 'null' : v).join(', ')}], отримано '${value}'`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// Чи документ потребує перегляду адвокатом (маркер ⚠ у UI).
export function needsReview(doc) {
  if (!doc) return false;
  return CRITICAL_FIELDS_FOR_WARNING.some(f => doc[f] === null || doc[f] === undefined);
}

// Список людських назв критичних полів які null — для UI tooltip.
export function getMissingCriticalFields(doc) {
  if (!doc) return [];
  const labels = { procId: 'провадження', category: 'тип', author: 'автор' };
  return CRITICAL_FIELDS_FOR_WARNING
    .filter(f => doc[f] === null || doc[f] === undefined)
    .map(f => labels[f] || f);
}

// ── Хелпери ────────────────────────────────────────────────────────────────

function detectNature(metadata) {
  if (metadata.documentNature) return metadata.documentNature;
  if (metadata.fromOCR || metadata.ocrProvider) return 'scanned';

  const ext = String(metadata.originalName || metadata.name || '')
    .toLowerCase()
    .split('.')
    .pop();
  if (['docx', 'doc', 'html', 'htm', 'txt', 'md', 'rtf'].includes(ext)) return 'searchable';

  // PDF за замовчанням — searchable. Реальне детектування текстового шару
  // робиться вище за стеком (DocumentProcessor) і передається явно.
  return 'searchable';
}

function pickIcon(metadata) {
  if (metadata.icon) return metadata.icon;
  switch (metadata.category) {
    case 'pleading': return '📋';
    case 'motion': return '📝';
    case 'court_act': return '⚖';
    case 'evidence': return '📑';
    case 'contract': return '📄';
    case 'correspondence': return '✉';
    case 'identification': return '🪪';
    default: return '📄';
  }
}
