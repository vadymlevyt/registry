// ── DRIVE DOCUMENT SERVICE ───────────────────────────────────────────────────
// Функції для роботи з папками і файлами на Google Drive
// Окремо від основного driveService в App.jsx (який працює тільки з registry_data.json)

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

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
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

  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
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

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }
  );

  return res.json();
}

export async function listFolderFiles(folderId, token) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType,size,modifiedTime)`,
    { headers: { Authorization: `Bearer ${token}` } }
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
