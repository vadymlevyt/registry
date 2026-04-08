# TASK.md — Три точних фікси
Дата: 08.04.2026

## КРОК 0 — ПРОЧИТАТИ LESSONS.md
```bash
cat LESSONS.md
```

---

## КРОК 1 — ДІАГНОСТИКА

```bash
# Знайти поле вводу команд в DocumentProcessor
grep -n "Команда\|агент\|textarea\|onKeyDown\|handleSend\|sendMessage\|onSubmit" src/components/DocumentProcessor/index.jsx | head -20

# Знайти handleCreateDriveStructure
grep -n -A 5 "handleCreateDriveStructure\|storageState\|driveFolderId" src/components/CaseDossier/index.jsx | head -30

# Знайти checkFolderStatus
grep -n -A 3 "checkFolderStatus\|no_structure\|structureStatus" src/components/CaseDossier/index.jsx | head -20
```

Показати результати.

---

## ФІКС 1 — ПОЛЕ ВВОДУ В DOCUMENT PROCESSOR

Поле вводу внизу не відправляє команду.

Знайти textarea або input для команд і перевірити обробник:

```bash
grep -n "Нарізати\|команд\|agentInput\|handleAgentSend\|onKeyDown" src/components/DocumentProcessor/index.jsx | head -20
```

Якщо немає onKeyDown або onClick — додати:

```jsx
// Знайти поле вводу (textarea або input) і додати:
onKeyDown={(e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleAgentCommand(agentInput);
    setAgentInput('');
  }
}}

// Знайти кнопку відправки і переконатись що вона викликає:
onClick={() => {
  if (agentInput.trim()) {
    handleAgentCommand(agentInput.trim());
    setAgentInput('');
  }
}}
```

---

## ФІКС 2 — СТРУКТУРА ПАПОК (спрощена логіка)

Замінити checkFolderStatus і handleCreateDriveStructure на просту логіку:

**Правило:** папка справи завжди в `01_АКТИВНІ_СПРАВИ`. Кнопка "Змінити" — вибір іншої папки. В будь-якій вибраній папці якщо немає підпапок — кнопка "Створити структуру".

```jsx
// checkFolderStatus — БЕЗ фільтра по назві в запиті
const checkFolderStatus = async (folderId, token) => {
  try {
    // Перевірити існування
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,trashed`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.status === 404) return { state: 'deleted' };
    const file = await res.json();
    if (file.error || file.trashed) return { state: file.trashed ? 'trashed' : 'deleted' };

    // Отримати підпапки БЕЗ фільтра по назві
    const subRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
      )}&fields=files(id,name)&pageSize=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const subData = await subRes.json();
    const names = (subData.files || []).map(f => f.name);

    const REQUIRED = ['01_ОРИГІНАЛИ', '02_ОБРОБЛЕНІ', '03_ФРАГМЕНТИ', '04_ПОЗИЦІЯ'];
    const missing = REQUIRED.filter(r => !names.includes(r));

    return { state: missing.length === 0 ? 'ok' : 'no_structure', missing };
  } catch (e) {
    return { state: 'error', error: e.message };
  }
};

// handleCreateDriveStructure — два сценарії
const handleCreateDriveStructure = async () => {
  const token = localStorage.getItem('levytskyi_drive_token');
  if (!token) { showMsg('❌ Підключіть Google Drive'); return; }

  setCreatingStructure(true);
  showMsg('⏳ Створюю...');

  try {
    const SUBFOLDERS = ['01_ОРИГІНАЛИ', '02_ОБРОБЛЕНІ', '03_ФРАГМЕНТИ', '04_ПОЗИЦІЯ', '05_ЗОВНІШНІ'];

    if (!storageState?.driveFolderId) {
      // Немає папки — створити нову в 01_АКТИВНІ_СПРАВИ
      const caseName = `${caseData.name}_${caseData.case_no || caseData.id}`.replace(/[/\s\\:*?"<>|]+/g, '_');
      const { caseFolderId, caseFolderName } = await createCaseStructure(caseName, token);
      const newStorage = { driveFolderId: caseFolderId, driveFolderName: caseFolderName, localFolderPath: null, lastSyncAt: new Date().toISOString() };
      updateCase(caseData.id, 'storage', newStorage);
      setStorageState(newStorage);
    } else {
      // Папка є — створити підпапки всередині
      const fid = storageState.driveFolderId;
      for (const name of SUBFOLDERS) {
        await fetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [fid] }),
        });
      }
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

## ФІКС 3 — НАРІЗКА: uploadedFile і splitPoints через ref

```bash
# Перевірити де зберігається uploadedFile
grep -n "setUploadedFile\|uploadedFile\|fileRef\|splitPointsRef" src/components/DocumentProcessor/index.jsx | head -20
```

Додати refs:
```jsx
const fileRef = useRef(null);
const splitPointsRef = useRef([]);

// При завантаженні файлу додати:
fileRef.current = file;

// При встановленні splitPoints додати:
splitPointsRef.current = points;

// В handleConfirm використовувати:
const file = fileRef.current || uploadedFile;
const points = splitPointsRef.current.length > 0 ? splitPointsRef.current : splitPoints;

if (!file || !points?.length) {
  addAgentMessage('❌ Файл або структура відсутні');
  return;
}
```

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "fix: doc processor input, folder structure check, split refs" && git push origin main
```

## ЧЕКЛІСТ

- [ ] Написав "Нарізати" в полі внизу → команда відправляється
- [ ] Папка з підпапками → "✅ Структура є"
- [ ] Папка без підпапок → "⚠️ Немає структури" + кнопка Створити
- [ ] Натиснув Створити → підпапки з'явились на Drive
- [ ] Підтвердив нарізку → файли записались на Drive в 02_ОБРОБЛЕНІ

## ДОПИСАТИ В LESSONS.md

```
### [2026-04-08] Drive: не фільтрувати підпапки по назві в query
Кирилиця в q= ненадійна. Отримати всі підпапки без фільтра, порівняти в JS.

### [2026-04-08] DocumentProcessor: поле вводу потребує onKeyDown Enter
Перевірити що textarea має onKeyDown і кнопка має onClick з handleAgentCommand.

### [2026-04-08] splitPoints і uploadedFile — зберігати в useRef
В async функціях closure захоплює старе значення state.
Refs завжди актуальні: fileRef.current, splitPointsRef.current
```
