// ── DP-3 · DRIVE PORT (DEFAULT ADAPTER) ─────────────────────────────────────
// Єдиний вузький інтерфейс Drive I/O для streaming-інфраструктури (jobState,
// chunkManager, splitDocumentsV3, datasetCollector). Адаптер поверх наявного
// driveService — НЕ нова реалізація Drive, лише фасад потрібних 7 операцій
// (Provider Pattern: один порт, реалізація замінна одним файлом для SaaS
// BYOS-storage без зміни DP-3).
//
// Чому порт, а не прямі імпорти у кожному модулі: тести підставляють
// in-memory порт без мережі; майбутній tenant.storage.provider підмінить
// адаптер. DP-3-модулі імпортують лише цей контракт.

import {
  findOrCreateFolder,
  uploadBytesToDrive,
  readDriveFileBytes,
  listFolderWithModified,
  deleteDriveFile,
  getDriveQuota,
} from '../driveService.js';
import { driveRequest } from '../driveAuth.js';

async function readTextViaMedia(fileId) {
  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  );
  if (!res.ok) throw new Error(`drivePort.readText ${res.status}`);
  return res.text();
}

// Контракт порту (усі методи async):
//   getOrCreateFolder(name, parentId|null) → { id }
//   listFolder(folderId) → [{ id, name, modifiedTime, size }]
//   uploadText(folderId, name, content, mime?) → { id }
//   readText(fileId) → string
//   uploadBytes(folderId, name, bytes, mime?) → { id }
//   readBytes(fileId) → ArrayBuffer
//   deleteFile(fileId) → void
//   quota() → { usage, limit, free, limitless } | null
export function createDefaultDrivePort() {
  return {
    getOrCreateFolder: (name, parentId) => findOrCreateFolder(name, parentId || null),
    listFolder: (folderId) => listFolderWithModified(folderId),
    uploadText: (folderId, name, content, mime = 'application/json') =>
      uploadBytesToDrive(folderId, name, new TextEncoder().encode(content), mime),
    readText: (fileId) => readTextViaMedia(fileId),
    uploadBytes: (folderId, name, bytes, mime = 'application/octet-stream') =>
      uploadBytesToDrive(folderId, name, bytes, mime),
    readBytes: (fileId) => readDriveFileBytes(fileId),
    deleteFile: (fileId) => deleteDriveFile(fileId),
    quota: () => getDriveQuota(),
  };
}
