// ── MIGRATION v4 → v5: Canonical Document Schema ─────────────────────────────
// Phase 1.5 — перший крок Канону даних. Розгортає документи у канонічну форму
// (18 легких полів) і виносить важкі поля в окрему мапу для запису у
// .metadata/documents_extended.json кожної справи.
//
// Стратегія:
// • Кожен документ → splitDocumentV4toV5 → { canonical, extended | null }
// • canonical підставляється в реєстр.
// • extended (якщо не порожній) збирається в `extendedByCase[caseId]`
//   і повертається окремо. Реальний запис у .metadata/* робить App.jsx
//   через documentsExtended.saveExtendedForCase — це окрема мережева операція
//   на Drive, тому не змішуємо її з трансформацією registry.
//
// Ідемпотентність: якщо registry вже має schemaVersion >= 5 — пропускаємо.

import { createDocument } from '../documentFactory.js';
import { CURRENT_SCHEMA_VERSION } from '../../schemas/documentSchema.js';

const MIGRATION_VERSION_V5 = '5.0_canonical_documents';

// Поля, які точно належать canonical/extended. Усі інші ловимо в extended.customFields,
// щоб ніколи не втрачати legacy-дані.
const CANONICAL_FIELDS = new Set([
  'id', 'name', 'originalName',
  'category', 'author', 'documentNature', 'namingStatus', 'isKey',
  'procId',
  'driveId', 'driveUrl', 'folder',
  'pageCount', 'size', 'icon',
  'date', 'addedAt', 'updatedAt',
  'addedBy', 'status',
]);

const EXTENDED_FIELDS = new Set([
  'documentId', 'tags', 'notes', 'annotations',
  'processingHistory', 'extractedTextSummary', 'customFields',
]);

// legacy-поля, які ми свідомо абсорбуємо в інші місця або відкидаємо як runtime-сміття.
const LEGACY_FIELDS_ABSORBED = new Set([
  'createdAt',     // → addedAt (якщо addedAt відсутнє)
  'scanned',       // → documentNature
  'summary',       // → extractedTextSummary
  // runtime-метадані DocumentProcessor/CaseDossier які не повинні зберігатись
  // у документі реєстру:
  'savedLocally', 'originalSize', 'data', 'type',
]);

/**
 * Мігрувати весь registry v4 → v5.
 *
 * @param {Object} registryData — повний об'єкт registry_data.json (вже після
 *                                migrateRegistry → schemaVersion 4).
 * @returns {{
 *   registry: Object,            // оновлений registry зі schemaVersion 5
 *   extendedByCase: Object,      // caseId → { documentId → extended fields }
 *   didMigrate: boolean,         // true якщо була реальна міграція
 *   fromVersion: number,
 *   toVersion: number
 * }}
 */
export function migrateRegistryV4toV5(registryData) {
  const fromVersion = registryData?.schemaVersion || 1;

  if (fromVersion >= CURRENT_SCHEMA_VERSION) {
    return {
      registry: registryData,
      extendedByCase: {},
      didMigrate: false,
      fromVersion,
      toVersion: fromVersion,
    };
  }

  if (fromVersion < 4) {
    // migrateRegistry мав підняти до v4 раніше; відмовляємось мовчки
    // йти далі — це ознака помилки orchestration в App.jsx.
    throw new Error(`migrateRegistryV4toV5: expected schemaVersion>=4, got ${fromVersion}`);
  }

  const extendedByCase = {};
  const cases = Array.isArray(registryData.cases) ? registryData.cases : [];

  const migratedCases = cases.map(caseItem => {
    if (!caseItem || typeof caseItem !== 'object') return caseItem;
    if (!Array.isArray(caseItem.documents)) return caseItem;

    const caseExtended = {};
    const migratedDocs = caseItem.documents.map(oldDoc => {
      if (!oldDoc || typeof oldDoc !== 'object') return oldDoc;
      const { canonical, extended } = splitDocumentV4toV5(oldDoc);
      if (extended) {
        caseExtended[canonical.id] = extended;
      }
      return canonical;
    });

    if (Object.keys(caseExtended).length > 0) {
      extendedByCase[caseItem.id] = caseExtended;
    }

    return { ...caseItem, documents: migratedDocs };
  });

  const registry = {
    ...registryData,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settingsVersion: MIGRATION_VERSION_V5,
    cases: migratedCases,
    lastMigration: {
      from: fromVersion,
      to: CURRENT_SCHEMA_VERSION,
      at: new Date().toISOString(),
    },
  };

  return {
    registry,
    extendedByCase,
    didMigrate: true,
    fromVersion,
    toVersion: CURRENT_SCHEMA_VERSION,
  };
}

/**
 * Розділити старий v4 документ на canonical (легкі поля) і extended (важкі).
 * Невідомі поля потрапляють у extended.customFields (нічого не втрачаємо).
 */
export function splitDocumentV4toV5(oldDoc) {
  const isKeyFromTags = Array.isArray(oldDoc.tags) &&
    (oldDoc.tags.includes('key') || oldDoc.tags.includes('ключовий'));

  // Author normalization: 'opp' (legacy/TASK 1.1) → 'opponent' (canonical).
  const normalizedAuthor = oldDoc.author === 'opp' ? 'opponent' : (oldDoc.author ?? null);

  const canonical = createDocument({
    id: typeof oldDoc.id === 'number' ? String(oldDoc.id) : oldDoc.id,
    name: oldDoc.name,
    originalName: oldDoc.originalName || null,
    category: oldDoc.category ?? null,
    author: normalizedAuthor,
    documentNature: oldDoc.documentNature || (oldDoc.scanned ? 'scanned' : 'searchable'),
    namingStatus: oldDoc.namingStatus || 'manual',
    isKey: oldDoc.isKey === true || isKeyFromTags,
    procId: oldDoc.procId ?? null,
    driveId: oldDoc.driveId ?? null,
    driveUrl: oldDoc.driveUrl ?? null,
    folder: oldDoc.folder || '01_ОРИГІНАЛИ',
    pageCount: typeof oldDoc.pageCount === 'number' ? oldDoc.pageCount : null,
    size: typeof oldDoc.size === 'number' ? oldDoc.size : 0,
    icon: oldDoc.icon,
    date: looksLikeIsoDate(oldDoc.date) ? oldDoc.date : null,
    addedAt: oldDoc.addedAt || oldDoc.createdAt || new Date().toISOString(),
    updatedAt: oldDoc.updatedAt || oldDoc.addedAt || oldDoc.createdAt || new Date().toISOString(),
    addedBy: oldDoc.addedBy || 'migration',
    status: oldDoc.status === 'archived' ? 'archived' : 'active',
  });

  // Витягуємо важкі поля.
  const remainingTags = Array.isArray(oldDoc.tags)
    ? oldDoc.tags.filter(t => t !== 'key' && t !== 'ключовий')
    : [];

  const extended = {
    documentId: canonical.id,
    tags: remainingTags,
    notes: typeof oldDoc.notes === 'string' ? oldDoc.notes : '',
    annotations: Array.isArray(oldDoc.annotations) ? oldDoc.annotations : [],
    processingHistory: Array.isArray(oldDoc.processingHistory) ? oldDoc.processingHistory : [],
    extractedTextSummary: oldDoc.extractedTextSummary || oldDoc.summary || '',
    customFields: {},
  };

  // Все, що не canonical, не extended і не свідомо absorbed — у customFields.
  // legacy "date" як текст ("березень 2023") теж зберігаємо тут, щоб UI міг
  // показати оригінал поки не пройдемо нормалізацію дат окремим TASK.
  for (const [key, value] of Object.entries(oldDoc)) {
    if (CANONICAL_FIELDS.has(key)) continue;
    if (EXTENDED_FIELDS.has(key)) continue;
    if (LEGACY_FIELDS_ABSORBED.has(key)) continue;
    extended.customFields[key] = value;
  }
  // Спеціальний випадок: legacy date як текст — в customFields.
  if (oldDoc.date && !looksLikeIsoDate(oldDoc.date)) {
    extended.customFields.legacyDateText = oldDoc.date;
  }

  // Якщо в extended нічого осмисленого — повертаємо null,
  // щоб не записувати порожні файли.
  const hasContent =
    extended.tags.length > 0 ||
    extended.notes ||
    extended.annotations.length > 0 ||
    extended.processingHistory.length > 0 ||
    extended.extractedTextSummary ||
    Object.keys(extended.customFields).length > 0;

  return {
    canonical,
    extended: hasContent ? extended : null,
  };
}

function looksLikeIsoDate(value) {
  if (typeof value !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}/.test(value);
}
