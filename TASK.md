# TASK.md — Два баги: перевірка структури + нарізка після підтвердження
Дата: 08.04.2026

## КРОК 0 — ПРОЧИТАТИ LESSONS.md
```bash
cat LESSONS.md
```

---

## КРОК 1 — ДІАГНОСТИКА

```bash
# Баг 1: перевірка структури папок
grep -n "checkFolderStatus\|structureStatus\|REQUIRED\|01_ОРИГІНАЛИ\|no_structure" src/components/CaseDossier/index.jsx | head -20

# Баг 2: нарізка після підтвердження
grep -n "uploadedFile\|splitPoints\|handleConfirm\|Підтвердити нарізку\|splitPDF" src/components/DocumentProcessor/index.jsx | head -30

# Перевірити чи зберігається uploadedFile в state
grep -n "setUploadedFile\|useState.*File\|useState.*null" src/components/DocumentProcessor/index.jsx | head -10
```

Показати результати.

---

## БАГ 1 — СХОВИЩЕ: ПЕРЕВІРКА СТРУКТУРИ

### Проблема:
checkFolderStatus перевіряє підпапки але не знаходить їх.
Можлива причина: назви підпапок на Drive мають кирилицю — запит може їх не знаходити через encoding.

### Фікс — додати логування і перевірити що повертає API:

```jsx
const checkFolderStatus = async (folderId, token) => {
  try {
    // Перевірити чи існує папка
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,trashed`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (res.status === 404) return { state: 'deleted' };

    const file = await res.json();
    if (file.trashed) return { state: 'trashed' };

    // Отримати ВСІ підпапки (без фільтра по назві)
    const subRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
      )}&fields=files(id,name)&pageSize=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const subData = await subRes.json();
    const existingNames = (subData.files || []).map(f => f.name);

    console.log('Папки в', file.name, ':', existingNames); // для діагностики

    // Перевірити чи є хоча б одна з обов'язкових
    const REQUIRED = ['01_ОРИГІНАЛИ', '02_ОБРОБЛЕНІ', '03_ФРАГМЕНТИ', '04_ПОЗИЦІЯ'];
    const missing = REQUIRED.filter(n => !existingNames.includes(n));

    return {
      state: missing.length === 0 ? 'ok' : 'no_structure',
      missing,
      existing: existingNames, // для діагностики
    };

  } catch (e) {
    console.error('checkFolderStatus error:', e);
    return { state: 'error', error: e.message };
  }
};
```

### Фікс handleCreateDriveStructure — перевірити storageState перед дією:

```jsx
const handleCreateDriveStructure = async () => {
  const token = localStorage.getItem('levytskyi_drive_token');
  if (!token) { showMsg('❌ Підключіть Google Drive'); return; }

  // Знайти правильний folderId
  const targetFolderId = storageState?.driveFolderId;

  if (!targetFolderId) {
    // Немає папки — створити нову в 01_АКТИВНІ_СПРАВИ
    setCreatingStructure(true);
    try {
      const caseName = `${caseData.name}_${caseData.case_no || caseData.id}`.replace(/[/\s]+/g, '_');
      const { caseFolderId, caseFolderName } = await createCaseStructure(caseName, token);
      const storageData = {
        driveFolderId: caseFolderId,
        driveFolderName: caseFolderName,
        localFolderPath: null,
        lastSyncAt: new Date().toISOString(),
      };
      updateCase(caseData.id, 'storage', storageData);
      setStorageState(storageData);
      setStructureStatus({ state: 'ok', missing: [] });
      showMsg('✅ Структуру створено: ' + caseFolderName);
    } catch (e) {
      showMsg('❌ Помилка: ' + e.message);
    } finally {
      setCreatingStructure(false);
    }
    return;
  }

  // Папка є — створити підпапки всередині
  setCreatingStructure(true);
  try {
    const SUBFOLDERS = ['01_ОРИГІНАЛИ', '02_ОБРОБЛЕНІ', '03_ФРАГМЕНТИ', '04_ПОЗИЦІЯ', '05_ЗОВНІШНІ'];
    for (const name of SUBFOLDERS) {
      await findOrCreateFolder(name, targetFolderId, token);
    }
    setStructureStatus({ state: 'ok', missing: [] });
    showMsg('✅ Структуру створено');
  } catch (e) {
    showMsg('❌ Помилка: ' + e.message);
  } finally {
    setCreatingStructure(false);
  }
};
```

---

## БАГ 2 — НАРІЗКА ПІСЛЯ ПІДТВЕРДЖЕННЯ

### Діагностика:
```bash
# Знайти handleConfirm і кнопку підтвердження
grep -n "handleConfirm\|Підтвердити нарізку\|onClick.*підтвердити\|splitPDF\|uploadedFile" src/components/DocumentProcessor/index.jsx | head -20
```

### Можливі причини:
1. `uploadedFile` не зберігається в state при завантаженні файлу
2. `splitPoints` скидається при ре-рендері
3. `handleConfirm` не знаходить `uploadedFile` бо замикання (closure) на старе значення

### Фікс — використати useRef для надійного зберігання:

```jsx
// Додати refs поруч зі state
const uploadedFileRef = useRef(null);
const splitPointsRef = useRef([]);

// При завантаженні файлу — зберігати в обох
const handleFileLoad = (file) => {
  setUploadedFile(file);
  uploadedFileRef.current = file;
};

// При встановленні splitPoints — зберігати в обох
const handleSetSplitPoints = (points) => {
  setSplitPoints(points);
  splitPointsRef.current = points;
};

// В handleConfirm — читати з ref:
const handleConfirm = async () => {
  const file = uploadedFileRef.current || uploadedFile;
  const points = splitPointsRef.current.length > 0 ? splitPointsRef.current : splitPoints;

  if (!file) {
    addAgentMessage('❌ Файл не завантажено');
    return;
  }
  if (!points || points.length === 0) {
    addAgentMessage('❌ Структуру не визначено. Спочатку напишіть "нарізати"');
    return;
  }

  addAgentMessage('✂️ Нарізаю PDF...');
  // ... далі логіка нарізки
};
```

### Перевірити що кнопка "Підтвердити нарізку" викликає handleConfirm:

```bash
grep -n "Підтвердити нарізку\|handleConfirm" src/components/DocumentProcessor/index.jsx | head -10
```

Якщо кнопка викликає щось інше — виправити.

### Перевірити що pdf-lib завантажується:

```jsx
// На початку handleConfirm — перевірити доступність pdf-lib
const handleConfirm = async () => {
  try {
    const { PDFDocument } = await import('pdf-lib');
    console.log('pdf-lib завантажено OK');
  } catch (e) {
    addAgentMessage('❌ pdf-lib не завантажено: ' + e.message);
    return;
  }
  // ...
};
```

---

## КРОК 2 — КНОПКА "РЕДАГУВАТИ"

```bash
grep -n "Редагувати\|handleEdit\|onEdit" src/components/DocumentProcessor/index.jsx | head -10
```

Якщо кнопка нічого не робить — додати базову логіку:
```jsx
const handleEdit = () => {
  // Показати textarea з поточною структурою для ручного редагування
  setEditMode(true);
};
```

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "fix: folder structure detection, split confirmation with refs" && git push origin main
```

## ЧЕКЛІСТ

- [ ] Відкрив досьє з папкою що має підпапки → "✅ Структура папок є"
- [ ] Відкрив досьє з папкою без підпапок → "⚠️ Немає структури" + кнопка Створити
- [ ] Натиснув Створити → підпапки з'являються в папці на Drive
- [ ] Завантажив PDF → написав "нарізати" → отримав список
- [ ] Натиснув "Підтвердити нарізку" → pdf-lib нарізає без помилки
- [ ] Файли записуються на Drive в 02_ОБРОБЛЕНІ
- [ ] Матеріали оновлюються

## ПІСЛЯ ВИКОНАННЯ — ДОПИСАТИ В LESSONS.md

```
### [2026-04-08] useRef для збереження файлів між рендерами
uploadedFile і splitPoints зберігати в useRef додатково до useState.
В async функціях читати з ref: uploadedFileRef.current
Closure в async функціях може захопити старе значення state — ref завжди актуальний.

### [2026-04-08] Drive підпапки — отримувати без фільтра по назві
Запит без name filter: q="folderId in parents and mimeType=folder and trashed=false"
Потім фільтрувати existingNames в JS — надійніше ніж через q з кирилицею.
```
