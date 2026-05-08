// ── DOCUMENTS EXTENDED SERVICE ───────────────────────────────────────────────
// Lazy-load для важких полів документа: .metadata/documents_extended.json
// у Drive-папці справи. Канонічна (легка) частина залишається у
// cases[].documents[] в registry_data.json.
//
// Принцип Single Source of Truth: для кожної справи є рівно два файли —
// registry-зріз і documents_extended.json. Жодних паралельних індексів.
//
// Cache: in-memory (Map) на час сесії. Інвалідується через invalidateCache()
// після зовнішніх змін на Drive.
//
// Drive API безпечність:
// • Імена .metadata і documents_extended.json — латиниця, тому q= безпечне.
// • Якщо колись додамо кириличні ресурси — використовувати патерн з
//   CaseDossier.ensureSubFolders (q= тільки по parent, фільтрація в JS).

import { driveRequest } from './driveAuth.js';
import {
  readDriveFile,
  createDriveFile,
  updateDriveFile,
} from './driveService.js';

const METADATA_FOLDER_NAME = '.metadata';
const EXTENDED_FILE_NAME = 'documents_extended.json';

// caseId → { extended, loadedAt }
const cache = new Map();

// ── PUBLIC API ──────────────────────────────────────────────────────────────

// Завантажити documents_extended.json для справи. Ідемпотентно: повторні
// виклики беруть з кешу.
export async function loadExtendedForCase(caseId, caseData) {
  if (!caseId) return {};
  if (cache.has(caseId)) return cache.get(caseId).extended;

  const metadataFolderId = await findMetadataFolder(caseData);
  if (!metadataFolderId) {
    return cacheAndReturn(caseId, {});
  }

  const fileId = await findExtendedFile(metadataFolderId);
  if (!fileId) {
    return cacheAndReturn(caseId, {});
  }

  try {
    const content = await readDriveFile(fileId);
    const parsed = JSON.parse(content);
    return cacheAndReturn(caseId, parsed && typeof parsed === 'object' ? parsed : {});
  } catch (err) {
    console.error('[documentsExtended] Failed to load:', err);
    return cacheAndReturn(caseId, {});
  }
}

// Зберегти повну мапу documentId → extended для справи.
export async function saveExtendedForCase(caseId, caseData, extended) {
  if (!caseId) throw new Error('saveExtendedForCase: caseId is required');
  const safe = extended && typeof extended === 'object' ? extended : {};
  const metadataFolderId = await ensureMetadataFolder(caseData);
  if (!metadataFolderId) {
    throw new Error('Cannot ensure .metadata folder (Drive folder for case is missing)');
  }

  const json = JSON.stringify(safe, null, 2);
  const existingFileId = await findExtendedFile(metadataFolderId);

  if (existingFileId) {
    await updateDriveFile(existingFileId, json);
  } else {
    await createDriveFile(metadataFolderId, EXTENDED_FILE_NAME, json);
  }

  cache.set(caseId, { extended: safe, loadedAt: new Date() });
}

// Отримати extended-поля одного документа. Якщо запису ще немає — повертаємо
// порожній шаблон.
export async function getExtendedForDocument(caseId, caseData, documentId) {
  const all = await loadExtendedForCase(caseId, caseData);
  return all[documentId] || createEmptyExtended(documentId);
}

// Оновити extended-поля одного документа (merge зверху на існуючі).
export async function setExtendedForDocument(caseId, caseData, documentId, fields) {
  const all = await loadExtendedForCase(caseId, caseData);
  const merged = {
    ...createEmptyExtended(documentId),
    ...(all[documentId] || {}),
    ...(fields || {}),
    documentId,
  };
  const next = { ...all, [documentId]: merged };
  await saveExtendedForCase(caseId, caseData, next);
  return merged;
}

// Інвалідувати кеш справи (після зовнішніх змін на Drive).
export function invalidateCache(caseId) {
  if (caseId == null) {
    cache.clear();
  } else {
    cache.delete(caseId);
  }
}

// ── INTERNAL ───────────────────────────────────────────────────────────────

function cacheAndReturn(caseId, extended) {
  cache.set(caseId, { extended, loadedAt: new Date() });
  return extended;
}

function createEmptyExtended(documentId) {
  return {
    documentId,
    tags: [],
    notes: '',
    annotations: [],
    processingHistory: [],
    extractedTextSummary: '',
    customFields: {},
  };
}

function getCaseFolderId(caseData) {
  return caseData?.storage?.driveFolderId || null;
}

// Знайти .metadata у папці справи. Повертає id або null якщо папки немає.
async function findMetadataFolder(caseData) {
  const caseFolderId = getCaseFolderId(caseData);
  if (!caseFolderId) return null;

  // .metadata — латиниця, q= безпечне.
  const q = `name='${METADATA_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and '${caseFolderId}' in parents and trashed=false`;
  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.files?.[0]?.id || null;
}

// Знайти .metadata, якщо немає — створити.
async function ensureMetadataFolder(caseData) {
  const existing = await findMetadataFolder(caseData);
  if (existing) return existing;

  const caseFolderId = getCaseFolderId(caseData);
  if (!caseFolderId) return null;

  const metadata = {
    name: METADATA_FOLDER_NAME,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [caseFolderId],
  };
  const res = await driveRequest('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });
  if (!res.ok) {
    console.error('[documentsExtended] Failed to create .metadata folder:', res.status);
    return null;
  }
  const data = await res.json();
  return data.id || null;
}

// Знайти documents_extended.json у .metadata.
async function findExtendedFile(metadataFolderId) {
  if (!metadataFolderId) return null;
  // documents_extended.json — латиниця, q= безпечне.
  const q = `name='${EXTENDED_FILE_NAME}' and '${metadataFolderId}' in parents and trashed=false`;
  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.files?.[0]?.id || null;
}
