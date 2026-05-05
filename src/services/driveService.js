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
  const query = parentId
    ? `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const searchRes = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`
  );
  const searchData = await searchRes.json();

  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0];
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

export async function updateDriveFile(fileId, content, token) {
  const res = await driveRequest(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'text/plain' },
    body: content,
  });
  if (!res.ok) throw new Error(`Failed to update file: ${res.status}`);
  return await res.json();
}
