# TASK.md — Діагностика і фікс: структура папок + нарізка
Дата: 08.04.2026

## КРОК 0 — ПРОЧИТАТИ LESSONS.md
```bash
cat LESSONS.md
```

---

## КРОК 1 — ПОКАЗАТИ ВЕСЬ ПОТОЧНИЙ КОД

```bash
# Показати checkFolderStatus повністю
grep -n -A 40 "checkFolderStatus" src/components/CaseDossier/index.jsx | head -60

# Показати handleCreateDriveStructure повністю  
grep -n -A 40 "handleCreateDriveStructure" src/components/CaseDossier/index.jsx | head -60

# Показати handleConfirm в DocumentProcessor повністю
grep -n -A 50 "handleConfirm" src/components/DocumentProcessor/index.jsx | head -80

# Показати де зберігається uploadedFile
grep -n "uploadedFile\|setUploadedFile\|uploadedFileRef" src/components/DocumentProcessor/index.jsx | head -20
```

Показати ВСІ результати перед будь-якими змінами.

---

## КРОК 2 — ЗАМІНИТИ checkFolderStatus

Замінити існуючу функцію повністю на просту і надійну:

```jsx
const checkFolderStatus = async (folderId, token) => {
  try {
    // 1. Перевірити чи папка існує
    const fileRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,trashed`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (fileRes.status === 404) {
      return { state: 'deleted' };
    }

    const fileData = await fileRes.json();
    if (fileData.error) {
      return { state: 'deleted' };
    }
    if (fileData.trashed) {
      return { state: 'trashed' };
    }

    // 2. Отримати підпапки БЕЗ фільтра по назві
    const subRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?` +
      `q=${encodeURIComponent(`'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)}` +
      `&fields=files(id,name)&pageSize=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const subData = await subRes.json();
    const folders = subData.files || [];
    const names = folders.map(f => f.name);

    // 3. Перевірити наявність обов'язкових підпапок
    const REQUIRED = ['01_ОРИГІНАЛИ', '02_ОБРОБЛЕНІ', '03_ФРАГМЕНТИ', '04_ПОЗИЦІЯ'];
    const missing = REQUIRED.filter(r => !names.includes(r));

    return {
      state: missing.length === 0 ? 'ok' : 'no_structure',
      missing,
      found: names,
    };

  } catch (e) {
    return { state: 'error', error: e.message };
  }
};
```

---

## КРОК 3 — ЗАМІНИТИ handleCreateDriveStructure

Замінити повністю на просту і надійну версію:

```jsx
const handleCreateDriveStructure = async () => {
  const token = localStorage.getItem('levytskyi_drive_token');
  if (!token) {
    showMsg('❌ Підключіть Google Drive');
    return;
  }

  setCreatingStructure(true);
  showMsg('⏳ Створюю структуру...');

  try {
    const SUBFOLDERS = [
      '01_ОРИГІНАЛИ',
      '02_ОБРОБЛЕНІ',
      '03_ФРАГМЕНТИ',
      '04_ПОЗИЦІЯ',
      '05_ЗОВНІШНІ',
    ];

    let targetFolderId = storageState?.driveFolderId;

    if (!targetFolderId) {
      // Створити нову папку справи в 01_АКТИВНІ_СПРАВИ
      const caseName = `${caseData.name}_${caseData.case_no || caseData.id}`
        .replace(/[/\s]+/g, '_')
        .replace(/[\\:*?"<>|]/g, '');

      const { caseFolderId, caseFolderName } = await createCaseStructure(caseName, token);
      targetFolderId = caseFolderId;

      const newStorage = {
        driveFolderId: caseFolderId,
        driveFolderName: caseFolderName,
        localFolderPath: null,
        lastSyncAt: new Date().toISOString(),
      };
      updateCase(caseData.id, 'storage', newStorage);
      setStorageState(newStorage);
    } else {
      // Створити підпапки в існуючій папці
      for (const name of SUBFOLDERS) {
        // Перевірити чи підпапка вже є
        const checkRes = await fetch(
          `https://www.googleapis.com/drive/v3/files?` +
          `q=${encodeURIComponent(`'${targetFolderId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)}` +
          `&fields=files(id,name)`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const checkData = await checkRes.json();

        if (!checkData.files || checkData.files.length === 0) {
          // Створити підпапку
          await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name,
              mimeType: 'application/vnd.google-apps.folder',
              parents: [targetFolderId],
            }),
          });
        }
      }
    }

    // Оновити статус
    setStructureStatus({ state: 'ok', missing: [] });
    showMsg('✅ Структуру створено');

    // Оновити driveFolderName якщо є тільки ID
    if (storageState?.driveFolderId && !storageState?.driveFolderName) {
      const nameRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${storageState.driveFolderId}?fields=name`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const nameData = await nameRes.json();
      if (nameData.name) {
        const updated = { ...storageState, driveFolderName: nameData.name };
        setStorageState(updated);
        updateCase(caseData.id, 'storage', updated);
      }
    }

  } catch (e) {
    showMsg('❌ Помилка: ' + e.message);
  } finally {
    setCreatingStructure(false);
  }
};
```

---

## КРОК 4 — ФІКС НАРІЗКИ

Після діагностики (Крок 1) знайти де проблема в handleConfirm.

Найімовірніше uploadedFile або splitPoints не передаються правильно.

Додати перевірки на початку handleConfirm:

```jsx
const handleConfirm = async () => {
  // Діагностика — показати що є
  console.log('handleConfirm called');
  console.log('uploadedFile:', uploadedFile?.name);
  console.log('splitPoints:', splitPoints?.length);

  // Перевірки
  if (!uploadedFile) {
    addAgentMessage('❌ Файл не завантажено. Перезавантажте файл і спробуйте знову.');
    return;
  }

  if (!splitPoints || splitPoints.length === 0) {
    addAgentMessage('❌ Структуру не визначено. Напишіть "нарізати" в полі команди.');
    return;
  }

  addAgentMessage(`✂️ Нарізаю ${splitPoints.length} документів...`);

  try {
    // Завантажити pdf-lib
    const { PDFDocument } = await import('pdf-lib');

    // Читати файл
    const arrayBuffer = await uploadedFile.arrayBuffer();
    const srcDoc = await PDFDocument.load(arrayBuffer);
    const totalPages = srcDoc.getPageCount();

    addAgentMessage(`📄 Всього сторінок: ${totalPages}`);

    const results = [];

    for (const doc of splitPoints) {
      const startIdx = Math.max(0, doc.startPage - 1);
      const endIdx = Math.min(doc.endPage - 1, totalPages - 1);

      if (startIdx > totalPages - 1) {
        addAgentMessage(`⚠️ Пропускаю "${doc.name}" — сторінка ${doc.startPage} не існує`);
        continue;
      }

      const newDoc = await PDFDocument.create();
      const indices = [];
      for (let i = startIdx; i <= endIdx; i++) indices.push(i);

      const pages = await newDoc.copyPages(srcDoc, indices);
      pages.forEach(p => newDoc.addPage(p));

      const bytes = await newDoc.save({ useObjectStreams: true });
      results.push({
        name: doc.name,
        type: doc.type || 'other',
        startPage: doc.startPage,
        endPage: doc.endPage,
        pageCount: indices.length,
        data: bytes,
        sizeMB: (bytes.byteLength / 1024 / 1024).toFixed(2),
      });
    }

    addAgentMessage(`✅ Нарізано ${results.length} документів`);

    // Записати на Drive
    const token = localStorage.getItem('levytskyi_drive_token');
    const folderId = caseData?.storage?.driveFolderId;

    if (token && folderId) {
      addAgentMessage('☁️ Записую на Drive...');

      // Знайти 02_ОБРОБЛЕНІ
      const subRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?` +
        `q=${encodeURIComponent(`'${folderId}' in parents and name='02_ОБРОБЛЕНІ' and mimeType='application/vnd.google-apps.folder' and trashed=false`)}` +
        `&fields=files(id)`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const subData = await subRes.json();
      const targetFolderId = subData.files?.[0]?.id || folderId;

      for (const result of results) {
        const safeName = result.name.replace(/[/\\:*?"<>|]/g, '_');
        const blob = new Blob([result.data], { type: 'application/pdf' });
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify({
          name: `${safeName}.pdf`,
          parents: [targetFolderId],
        })], { type: 'application/json' }));
        form.append('file', blob);

        await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
          { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }
        );
      }

      // Оновити Матеріали
      const newDocs = results.map((r, i) => ({
        id: `doc_${Date.now()}_${i}`,
        name: r.name,
        type: r.type,
        pageCount: r.pageCount,
        folder: '02_ОБРОБЛЕНІ',
        status: 'ready',
        addedAt: new Date().toISOString(),
      }));

      updateCase(caseData.id, 'documents', [
        ...(caseData.documents || []),
        ...newDocs,
      ]);

      const summary = results.map(r =>
        `✅ ${r.name} (${r.pageCount} стор., ${r.sizeMB} МБ)`
      ).join('\n');

      addAgentMessage(`Готово!\n\n${summary}\n\n📁 Збережено в 02_ОБРОБЛЕНІ\n📋 Матеріали оновлено`);

    } else {
      const summary = results.map(r => `✅ ${r.name} (${r.pageCount} стор.)`).join('\n');
      addAgentMessage(`Нарізано:\n\n${summary}\n\n⚠️ Drive не підключено — файли тільки в пам'яті`);
    }

  } catch (e) {
    addAgentMessage(`❌ Помилка нарізки: ${e.message}\n\nStack: ${e.stack?.substring(0, 200)}`);
  }
};
```

---

## КРОК 5 — ПЕРЕВІРИТИ ЩО uploadedFile ЗБЕРІГАЄТЬСЯ

```bash
# Знайти де встановлюється uploadedFile
grep -n "setUploadedFile\|uploadedFile\s*=" src/components/DocumentProcessor/index.jsx | head -20
```

Якщо `setUploadedFile` викликається тільки в одному місці при завантаженні —
переконатись що воно не скидається при аналізі.

Якщо скидається — зберігати в useRef:
```jsx
const fileRef = useRef(null);

// При завантаженні:
setUploadedFile(file);
fileRef.current = file;

// В handleConfirm:
const file = fileRef.current || uploadedFile;
```

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "fix: folder structure check without name filter, split confirmation debug" && git push origin main
```

## ЧЕКЛІСТ

- [ ] Папка Манолюк з підпапками → система показує "✅ Структура папок є"
- [ ] Папка без підпапок → "⚠️ Немає структури" + кнопка Створити
- [ ] Кнопка Створити → підпапки з'являються на Drive → статус "✅"
- [ ] Завантажив PDF → написав "нарізати" → отримав список
- [ ] "Підтвердити нарізку" → файли записались на Drive
- [ ] Матеріали оновились

## ПІСЛЯ ВИКОНАННЯ — ДОПИСАТИ В LESSONS.md

```
### [2026-04-08] Drive підпапки — не фільтрувати по назві в запиті
Запит з name filter в q= ненадійний для кирилиці.
Правильно: отримати всі підпапки без фільтра, порівняти назви в JS.
q="'folderId' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
потім: const missing = REQUIRED.filter(r => !names.includes(r))

### [2026-04-08] handleConfirm — uploadedFile може бути null при виклику
Додати console.log на початку для діагностики.
Зберігати в useRef додатково до useState.
```
