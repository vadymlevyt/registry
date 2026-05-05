// ── TIME ENTRIES ARCHIVER ────────────────────────────────────────────────────
// Місячна ротація time_entries[] → _archives/time_entries_YYYY-MM.json на Drive.
//
// Принципи:
// - Активний registry_data.json тримає тільки записи поточного місяця.
// - На 1 число місяця попередній місяць виноситься в архів.
// - Кеш завантажених архівів — у пам'яті, очищається на reload.
// - Якщо Drive недоступний — пропускаємо архівацію без помилки.

import { findOrCreateFolder, uploadFileToDrive, getDriveFiles, readDriveFile } from './driveService.js';
import { driveRequest } from './driveAuth.js';

const ARCHIVE_FOLDER_NAME = '_archives';
const _archiveCache = new Map();

function formatYYYYMM(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function shouldArchive(billingMeta) {
  try {
    const now = new Date();
    if (!billingMeta || !billingMeta.lastArchiveCreated) return true;
    const last = new Date(billingMeta.lastArchiveCreated);
    return now.getMonth() !== last.getMonth() || now.getFullYear() !== last.getFullYear();
  } catch {
    return false;
  }
}

// Розділяє масив time_entries на ті, що залишаються (поточний місяць) і ті, що в архів (попередній).
export function splitForArchive(timeEntries, referenceDate = new Date()) {
  if (!Array.isArray(timeEntries)) return { keep: [], archive: [], yyyymm: null };
  const ref = new Date(referenceDate);
  const previousMonth = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
  const previousMonthEnd = new Date(ref.getFullYear(), ref.getMonth(), 0, 23, 59, 59);
  const keep = [];
  const archive = [];
  for (const entry of timeEntries) {
    if (!entry?.startTime) { keep.push(entry); continue; }
    const t = new Date(entry.startTime);
    if (t >= previousMonth && t <= previousMonthEnd) {
      archive.push(entry);
    } else {
      keep.push(entry);
    }
  }
  return { keep, archive, yyyymm: formatYYYYMM(previousMonth) };
}

// Завантажує архів попереднього місяця на Drive.
export async function uploadArchive(token, yyyymm, entries) {
  try {
    const folder = await findOrCreateFolder(ARCHIVE_FOLDER_NAME, null, token);
    const fileName = `time_entries_${yyyymm}.json`;
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
    const result = await uploadFileToDrive(fileName, blob, folder.id, token);
    _archiveCache.set(yyyymm, entries);
    return { success: true, fileName, fileId: result?.id || null, archivePath: `${ARCHIVE_FOLDER_NAME}/${fileName}` };
  } catch (e) {
    console.error('uploadArchive failed:', e);
    return { success: false, error: e.message };
  }
}

// Завантажує архів за yyyymm. Кешується в пам'яті.
export async function loadArchive(token, yyyymm) {
  if (_archiveCache.has(yyyymm)) {
    return { success: true, entries: _archiveCache.get(yyyymm), fromCache: true };
  }
  try {
    const folder = await findOrCreateFolder(ARCHIVE_FOLDER_NAME, null, token);
    const files = await getDriveFiles(folder.id, token);
    const target = files.find(f => f.name === `time_entries_${yyyymm}.json`);
    if (!target) {
      return { success: true, entries: [], fromCache: false };
    }
    const content = await readDriveFile(target.id, token);
    const entries = JSON.parse(content);
    _archiveCache.set(yyyymm, entries);
    return { success: true, entries, fromCache: false };
  } catch (e) {
    console.error(`loadArchive ${yyyymm} failed:`, e);
    return { success: false, error: e.message, entries: [] };
  }
}

export async function listArchives(token) {
  try {
    const folder = await findOrCreateFolder(ARCHIVE_FOLDER_NAME, null, token);
    const files = await getDriveFiles(folder.id, token);
    return files
      .filter(f => /^time_entries_\d{4}-\d{2}\.json$/.test(f.name))
      .map(f => ({
        name: f.name,
        yyyymm: f.name.replace(/^time_entries_(\d{4}-\d{2})\.json$/, '$1'),
        modifiedTime: f.modifiedTime,
        id: f.id,
      }))
      .sort((a, b) => b.yyyymm.localeCompare(a.yyyymm));
  } catch (e) {
    console.error('listArchives failed:', e);
    return [];
  }
}

// Повний цикл: розділити, завантажити архів, повернути { keep, billingMetaUpdate }.
// НЕ модифікує state самостійно — викликач робить setTimeEntries(keep) і
// setBillingMeta(prev => ({ ...prev, ...billingMetaUpdate })).
export async function checkAndArchive(token, timeEntries, billingMeta) {
  try {
    if (!shouldArchive(billingMeta)) return { archived: false };
    const { keep, archive, yyyymm } = splitForArchive(timeEntries);
    if (archive.length === 0) {
      return {
        archived: true,
        keep: timeEntries,
        billingMetaUpdate: { lastArchiveCreated: new Date().toISOString() },
        yyyymm,
        archivedCount: 0,
      };
    }
    if (!token) {
      // Drive не доступний — поки не чіпаємо.
      return { archived: false, reason: 'no_drive_token' };
    }
    const upload = await uploadArchive(token, yyyymm, archive);
    if (!upload.success) {
      return { archived: false, reason: 'upload_failed', error: upload.error };
    }
    return {
      archived: true,
      keep,
      yyyymm,
      archivePath: upload.archivePath,
      archivedCount: archive.length,
      billingMetaUpdate: {
        lastArchiveCreated: new Date().toISOString(),
        archiveFiles: (billingMeta?.archiveFiles || [])
          .filter(p => p !== upload.archivePath)
          .concat([upload.archivePath]),
      },
    };
  } catch (e) {
    console.error('checkAndArchive failed:', e);
    return { archived: false, error: e.message };
  }
}

export function clearCache() {
  _archiveCache.clear();
}

export const _internals = { ARCHIVE_FOLDER_NAME, formatYYYYMM };
