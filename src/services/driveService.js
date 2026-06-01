// ── DRIVE DOCUMENT SERVICE ───────────────────────────────────────────────────
// Функції для роботи з папками і файлами на Google Drive
// Окремо від основного driveService в App.jsx (який працює тільки з registry_data.json)
//
// УВАГА: всі запити до Drive йдуть через driveRequest — він автоматично
// оновлює токен на 401 і повторює запит. Параметр token залишено для
// зворотної сумісності сигнатур, але фактично не використовується —
// актуальний токен читається з localStorage всередині driveRequest.
import { driveRequest } from "./driveAuth.js";

const CASE_FOLDER_STRUCTURE = [
  "01_ОРИГІНАЛИ",
  "02_ОБРОБЛЕНІ",
  "03_ФРАГМЕНТИ",
  "04_ПОЗИЦІЯ",
  "05_ЗОВНІШНІ",
];

const CATEGORY_FOLDER_MAP = {
  pleading: "02_ОБРОБЛЕНІ",
  court_act: "02_ОБРОБЛЕНІ",
  evidence: "02_ОБРОБЛЕНІ",
  correspondence: "02_ОБРОБЛЕНІ",
  motion: "02_ОБРОБЛЕНІ",
  contract: "02_ОБРОБЛЕНІ",
  fragment: "03_ФРАГМЕНТИ",
  position: "04_ПОЗИЦІЯ",
  original: "01_ОРИГІНАЛИ",
};

export function getFolderForDocument(category) {
  return CATEGORY_FOLDER_MAP[category] || "02_ОБРОБЛЕНІ";
}

export async function findOrCreateFolder(name, parentId, token) {
  // CLAUDE.md правило #8 — кирилиця в q= filter Drive API ненадійна, а імена
  // папок справи (01_АКТИВНІ_СПРАВИ, 01_ОРИГІНАЛИ … 05_ЗОВНІШНІ, імена
  // клієнтів) — переважно кириличні. Тому q= формуємо тільки за parent +
  // mimeType + trashed, а потрібну папку знаходимо у JavaScript за точним
  // ім'ям. Той самий патерн застосовано в ocrService.listFolderFilesByName
  // і driveService.deleteOcrCacheForDocument (рядки 381-388).
  const query = parentId
    ? `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    : `'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const searchRes = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1000`
  );
  const searchData = await searchRes.json();

  // NFC-нормалізація + trim перед порівнянням. Без цього `f.name === name`
  // повертає false на візуально ідентичних рядках і findOrCreateFolder
  // створює дублікат папки.
  //
  // Реальні джерела розбіжності спостережені у проді на справі Нестеренка
  // (2026-05-23 — дві папки на Drive з однаковим іменем):
  //   1. Trailing/leading whitespace — '«Нестеренко » vs «Нестеренко»' (часто
  //      коли ім'я копіюється з UI з зайвим пробілом).
  //   2. NFC vs NFD форми Unicode (актуально для латиниці з diacritics, для
  //      precomposed кирилиці зазвичай нерелевантно — але normalize безпечно
  //      і дешево, тому застосовуємо превентивно).
  //   3. Race condition (два паралельні findOrCreateFolder для того ж імені
  //      одночасно) — НЕ покривається цим фіксом, потребує транзакційного
  //      підходу і виходить за scope.
  //
  // Той самий патерн (NFC normalize) уже у ensureSubFolders (CaseDossier:755).
  const target = name.normalize('NFC').trim();
  const match = (searchData.files || []).find(
    (f) => f.name.normalize('NFC').trim() === target
  );
  if (match) {
    return match;
  }

  const metadata = {
    name,
    mimeType: "application/vnd.google-apps.folder",
    ...(parentId && { parents: [parentId] }),
  };

  const createRes = await driveRequest("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });

  return createRes.json();
}

export async function createCaseStructure(caseName, token) {
  // 1. Кореневу папку активних справ
  const rootFolder = await findOrCreateFolder("01_АКТИВНІ_СПРАВИ", null, token);

  // 2. Глобальний INBOX на рівні Drive (не підпапка справи)
  await findOrCreateFolder("00_INBOX", null, token);

  // 3. Папку справи
  const caseFolder = await findOrCreateFolder(caseName, rootFolder.id, token);

  // 4. Підпапки
  const subFolders = {};
  for (const folderName of CASE_FOLDER_STRUCTURE) {
    const folder = await findOrCreateFolder(folderName, caseFolder.id, token);
    subFolders[folderName] = folder.id;
  }

  return { caseFolderId: caseFolder.id, caseFolderName: caseName, subFolders };
}

// TASK 0.2 — lazy-loading папок розвідки. Папки _research/ecits/ і
// _research/competitors/ створюються тільки коли реально кладеться перший
// артефакт. Не викликати при відкритті модуля.
//
// type: 'ecits' | 'competitors' — тільки латиниця, безпечно для q= Drive API.
// name (опційно) — додатковий рівень всередині (наприклад tenantId або
// конкретний кейс розвідки). null = повернути сам _research/<type>/.
export async function getOrCreateResearchFolder(type, name = null) {
  if (type !== 'ecits' && type !== 'competitors') {
    throw new Error(`getOrCreateResearchFolder: invalid type '${type}'`);
  }
  const root = await findOrCreateFolder('_research', null);
  const typeFolder = await findOrCreateFolder(type, root.id);
  if (!name) return typeFolder;
  const subFolder = await findOrCreateFolder(name, typeFolder.id);
  return subFolder;
}

export async function uploadFileToDrive(fileName, fileBlob, parentFolderId, token) {
  const metadata = {
    name: fileName,
    parents: [parentFolderId],
  };

  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" })
  );
  form.append("file", fileBlob);

  const res = await driveRequest(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      body: form,
    }
  );

  return res.json();
}

export async function listFolderFiles(folderId, token) {
  const q = `'${folderId}' in parents and trashed=false`;
  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=100`
  );
  const data = await res.json();
  return data.files || [];
}

// ── LOCAL FILE SYSTEM (Desktop only) ─────────────────────────────────────────

export function isDesktop() {
  return (
    window.showDirectoryPicker !== undefined &&
    !/Android|iPhone|iPad/i.test(navigator.userAgent)
  );
}

export async function selectLocalFolder() {
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    return dirHandle;
  } catch (e) {
    if (e.name === "AbortError") return null;
    throw e;
  }
}

// ── BACKUP ──────────────────────────────────────────────────────────────────
// Бекап перед SaaS Foundation міграцією — фіксованим іменем, поза ротацією.
// Ім'я: registry_data_backup_pre_saas_<timestamp>.json
// Викликається ОДИН РАЗ перед першою міграцією масиву → об'єкту.
export async function backupRegistryDataPreSaas(token, payload) {
  try {
    const backupFolder = await findOrCreateFolder('_backups', null, token);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `registry_data_backup_pre_saas_${ts}.json`;
    await uploadFileToDrive(
      fileName,
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      backupFolder.id,
      token
    );
    return { success: true, fileName };
  } catch (err) {
    console.error('Pre-SaaS backup failed:', err);
    return { success: false, error: err.message };
  }
}

// Бекап перед SaaS Foundation v1.1 міграцією v2 → v3, поза ротацією.
export async function backupRegistryDataPreV3(token, payload) {
  try {
    const backupFolder = await findOrCreateFolder('_backups', null, token);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `registry_data_backup_pre_v3_${ts}.json`;
    await uploadFileToDrive(
      fileName,
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      backupFolder.id,
      token
    );
    return { success: true, fileName };
  } catch (err) {
    console.error('Pre-v3 backup failed:', err);
    return { success: false, error: err.message };
  }
}

// Бекап перед TASK 0.3.5 міграцією v6.5 → v7 (canonical schema for ECITS), поза ротацією.
export async function backupRegistryDataPreV7(token, payload) {
  try {
    const backupFolder = await findOrCreateFolder('_backups', null, token);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `registry_data_backup_pre_v7_${ts}.json`;
    await uploadFileToDrive(
      fileName,
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      backupFolder.id,
      token
    );
    return { success: true, fileName };
  } catch (err) {
    console.error('Pre-v7 backup failed:', err);
    return { success: false, error: err.message };
  }
}

// Бекап перед TASK 2 міграцією v7 → v8 (time_entry.source → captureMethod), поза ротацією.
export async function backupRegistryDataPreV8(token, payload) {
  try {
    const backupFolder = await findOrCreateFolder('_backups', null, token);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `registry_data_backup_pre_v8_${ts}.json`;
    await uploadFileToDrive(
      fileName,
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      backupFolder.id,
      token
    );
    return { success: true, fileName };
  } catch (err) {
    console.error('Pre-v8 backup failed:', err);
    return { success: false, error: err.message };
  }
}

// Бекап перед TASK 0.4 міграцією v8 → v9 (case.origin enum), поза ротацією.
export async function backupRegistryDataPreV9(token, payload) {
  try {
    const backupFolder = await findOrCreateFolder('_backups', null, token);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `registry_data_backup_pre_v9_${ts}.json`;
    await uploadFileToDrive(
      fileName,
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      backupFolder.id,
      token
    );
    return { success: true, fileName };
  } catch (err) {
    console.error('Pre-v9 backup failed:', err);
    return { success: false, error: err.message };
  }
}

// Бекап перед TASK 3.1 міграцією v9 → v10 (document.textFormat/cleanedAt), поза ротацією.
export async function backupRegistryDataPreV10(token, payload) {
  try {
    const backupFolder = await findOrCreateFolder('_backups', null, token);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `registry_data_backup_pre_v10_${ts}.json`;
    await uploadFileToDrive(
      fileName,
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      backupFolder.id,
      token
    );
    return { success: true, fileName };
  } catch (err) {
    console.error('Pre-v10 backup failed:', err);
    return { success: false, error: err.message };
  }
}

// Бекап перед TASK 0.3.4 міграцією v6 → v6.5 (addedBy semantic cleanup), поза ротацією.
export async function backupRegistryDataPreV6_5(token, payload) {
  try {
    const backupFolder = await findOrCreateFolder('_backups', null, token);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `registry_data_backup_pre_v6_5_${ts}.json`;
    await uploadFileToDrive(
      fileName,
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      backupFolder.id,
      token
    );
    return { success: true, fileName };
  } catch (err) {
    console.error('Pre-v6.5 backup failed:', err);
    return { success: false, error: err.message };
  }
}

// Бекап перед TASK 0.1 міграцією v5 → v6 (founder flag), поза ротацією.
export async function backupRegistryDataPreV6(token, payload) {
  try {
    const backupFolder = await findOrCreateFolder('_backups', null, token);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `registry_data_backup_pre_v6_${ts}.json`;
    await uploadFileToDrive(
      fileName,
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      backupFolder.id,
      token
    );
    return { success: true, fileName };
  } catch (err) {
    console.error('Pre-v6 backup failed:', err);
    return { success: false, error: err.message };
  }
}

// Бекап перед Phase 1.5 міграцією v4 → v5 (canonical document schema), поза ротацією.
export async function backupRegistryDataPreV5(token, payload) {
  try {
    const backupFolder = await findOrCreateFolder('_backups', null, token);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `registry_data_backup_pre_v5_${ts}.json`;
    await uploadFileToDrive(
      fileName,
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      backupFolder.id,
      token
    );
    return { success: true, fileName };
  } catch (err) {
    console.error('Pre-v5 backup failed:', err);
    return { success: false, error: err.message };
  }
}

// Бекап перед Billing Foundation v2 міграцією v3 → v4, поза ротацією.
export async function backupRegistryDataPreBilling(token, payload) {
  try {
    const backupFolder = await findOrCreateFolder('_backups', null, token);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `registry_data_backup_pre_billing_${ts}.json`;
    await uploadFileToDrive(
      fileName,
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      backupFolder.id,
      token
    );
    return { success: true, fileName };
  } catch (err) {
    console.error('Pre-billing backup failed:', err);
    return { success: false, error: err.message };
  }
}

// Одноразовий бекап levytskyi_timelog перед імпортом у time_entries[] (v4).
export async function backupLegacyTimelogPreImport(token, payload) {
  try {
    const backupFolder = await findOrCreateFolder('_backups', null, token);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `levytskyi_timelog_${ts}.json`;
    await uploadFileToDrive(
      fileName,
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      backupFolder.id,
      token
    );
    return { success: true, fileName };
  } catch (err) {
    console.error('Legacy timelog backup failed:', err);
    return { success: false, error: err.message };
  }
}

// Одноразовий бекап levytskyi_action_log перед видаленням у SaaS Foundation v1.1.
export async function backupActionLogPreCleanup(token, payload) {
  try {
    const backupFolder = await findOrCreateFolder('_backups', null, token);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `levytskyi_action_log_${ts}.json`;
    await uploadFileToDrive(
      fileName,
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      backupFolder.id,
      token
    );
    return { success: true, fileName };
  } catch (err) {
    console.error('Action log backup failed:', err);
    return { success: false, error: err.message };
  }
}

// Зберегти резервну копію registry_data.json в _backups/ на Drive
export async function backupRegistryData(token, casesData) {
  try {
    // Знайти або створити _backups папку
    const backupFolder = await findOrCreateFolder("_backups", null, token);

    // Ім'я файлу з датою
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `registry_data_${ts}.json`;

    // Завантажити бекап
    await uploadFileToDrive(
      fileName,
      new Blob([JSON.stringify(casesData, null, 2)], { type: 'application/json' }),
      backupFolder.id,
      token
    );

    // Очистити старі бекапи (залишити останні 7)
    const files = await listFolderFiles(backupFolder.id, token);
    const backups = files
      .filter(f => f.name.startsWith('registry_data_'))
      .sort((a, b) => (b.modifiedTime || b.name).localeCompare(a.modifiedTime || a.name));

    if (backups.length > 7) {
      for (const old of backups.slice(7)) {
        await driveRequest(`https://www.googleapis.com/drive/v3/files/${old.id}`, {
          method: 'DELETE',
        }).catch(() => {});
      }
    }

    return { success: true, fileName };
  } catch (err) {
    console.error('Backup failed:', err);
    return { success: false, error: err.message };
  }
}

export async function saveFileLocally(dirHandle, relativePath, fileBlob) {
  const parts = relativePath.split("/");
  let currentDir = dirHandle;

  for (let i = 0; i < parts.length - 1; i++) {
    currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true });
  }

  const fileName = parts[parts.length - 1];
  const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(fileBlob);
  await writable.close();
}

// ── Нові функції для читання файлів ──────────────────────────────────────────

export async function getDriveFiles(folderId, token) {
  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      `'${folderId}' in parents and trashed=false`
    )}&fields=files(id,name,mimeType,modifiedTime)&pageSize=100`
  );
  const data = await res.json();
  return data.files || [];
}

export async function readDriveFile(fileId, token) {
  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  );
  if (!res.ok) throw new Error(`Failed to read file: ${res.status}`);
  return await res.text();
}

export async function createDriveFile(folderId, fileName, content, token) {
  const metadata = {
    name: fileName,
    parents: [folderId],
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([content], { type: 'text/plain' }));

  const res = await driveRequest('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Failed to create file: ${data.error?.message || res.status}`);
  return data;
}

// Видалити файл з Drive за ID. Обгорнуто try/catch на боці виклику —
// тут пробрасуємо помилки, щоб caller міг розрізнити "не знайшли" і "не змогли".
export async function deleteDriveFile(fileId) {
  if (!fileId) throw new Error('deleteDriveFile: fileId is required');
  const res = await driveRequest(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
  });
  // 204 No Content → ok. 404 → файл вже видалено вручну, теж ок.
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    const t = await res.text().catch(() => '');
    throw new Error(`deleteDriveFile ${res.status}: ${t.slice(0, 200)}`);
  }
  return true;
}

// Видалити OCR-кеш документа з 02_ОБРОБЛЕНІ. Видаляє пару:
// `${basename}_${driveId}.txt` і `${basename}_${driveId}.layout.json` —
// якщо layout існує. Повертає true якщо хоч щось видалено.
// Парна інвалідація гарантує що не лишиться сирітський layout зі старим
// текстом після натискання "Розпізнати зараз".
export async function deleteOcrCacheForDocument(caseData, doc) {
  if (!caseData || !doc || !doc.driveId) return false;
  const subFolderId = caseData?.storage?.subFolders?.['02_ОБРОБЛЕНІ'];
  if (!subFolderId) return false;

  const sanitize = (n) => (n || '')
    .replace(/\.[^/.]+$/, '')
    .replace(/[/\\]/g, '_')
    .slice(0, 150);
  const baseName = sanitize(doc.originalName || doc.name || '');
  const textCacheName = `${baseName}_${doc.driveId}.txt`;
  const layoutCacheName = `${baseName}_${doc.driveId}.layout.json`;

  // q= по parent, фільтрація у JS — кеш-імена містять кирилицю від baseName,
  // правило #8 забороняє кирилицю у q= filter.
  const q = `'${subFolderId}' in parents and trashed=false`;
  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1000`
  );
  if (!res.ok) return false;
  const data = await res.json();
  const all = data.files || [];

  let deletedAny = false;
  for (const name of [textCacheName, layoutCacheName]) {
    const target = all.find(f => f.name === name);
    if (target) {
      try {
        await deleteDriveFile(target.id);
        deletedAny = true;
      } catch (e) {
        console.warn('[deleteOcrCacheForDocument] delete failed:', name, e.message);
      }
    }
  }
  return deletedAny;
}

// DP-3 §4.11 — вільне місце на Drive перед стартом великого пакета.
// about.get повертає storageQuota { limit, usage }. Деякі акаунти (Workspace
// pooled / unlimited) не мають limit — тоді трактуємо як «місця досить»
// (limitless: true), не блокуємо. Кидати не можна — перевірка не критична.
export async function getDriveQuota() {
  try {
    const res = await driveRequest(
      'https://www.googleapis.com/drive/v3/about?fields=storageQuota'
    );
    if (!res.ok) return null;
    const data = await res.json();
    const q = data?.storageQuota || {};
    const usage = Number(q.usage);
    const limit = q.limit != null ? Number(q.limit) : null;
    if (!Number.isFinite(usage)) return null;
    if (limit == null || !Number.isFinite(limit)) {
      return { usage, limit: null, free: Infinity, limitless: true };
    }
    return { usage, limit, free: Math.max(0, limit - usage), limitless: false };
  } catch {
    return null;
  }
}

export async function uploadBytesToDrive(folderId, fileName, bytes, mimeType = 'application/octet-stream') {
  const metadata = { name: fileName, parents: [folderId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([bytes], { type: mimeType }));
  const res = await driveRequest(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
    { method: 'POST', body: form }
  );
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`uploadBytesToDrive ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

export async function readDriveFileBytes(fileId) {
  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  );
  if (!res.ok) throw new Error(`readDriveFileBytes ${res.status}`);
  return res.arrayBuffer();
}

export async function listFolderWithModified(folderId) {
  const q = `'${folderId}' in parents and trashed=false`;
  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime,size)&pageSize=1000`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.files || [];
}

export async function updateDriveFile(fileId, content, token) {
  const res = await driveRequest(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'text/plain' },
    body: content,
  });
  if (!res.ok) throw new Error(`Failed to update file: ${res.status}`);
  return await res.json();
}
