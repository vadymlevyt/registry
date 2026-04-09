# TASK.md — Два баги: нотатки + контекстний файл
Дата: 09.04.2026

## КРОК 0 — ПРОЧИТАТИ LESSONS.md
```bash
cat LESSONS.md
```

---

## БАГ 1 — НОТАТКИ: ПРИКРІПЛЕННЯ

### Симптоми:
- В записній книжці показує неправильно які прикріплені
- В досьє прикріплення відображається тільки після F5
- Кнопки прикріплення сірі/неактивні
- Потрібно мати можливість прикріпити КІЛЬКА нотаток до одного досьє

### Діагностика:
```bash
grep -n "pinNote\|pinnedNoteIds\|pinned\|setPinned\|handlePin" src/components/CaseDossier/index.jsx | head -20
grep -n "pinNote\|pinnedNoteIds\|pinned\|handlePin" src/components/Notebook/index.jsx | head -20
grep -n "pinNote\|pinnedNoteIds\|pinNote" src/App.jsx | head -20
```

### Що перевірити:

1. Функція `pinNote` в App.jsx — чи оновлює стан React одразу:
```js
// Має бути так:
const pinNote = (noteId, caseId) => {
  setCases(prev => prev.map(c =>
    c.id === caseId
      ? { ...c, pinnedNoteIds: [...(c.pinnedNoteIds || []), noteId] }
      : c
  ));
  // + зберегти на Drive
};

const unpinNote = (noteId, caseId) => {
  setCases(prev => prev.map(c =>
    c.id === caseId
      ? { ...c, pinnedNoteIds: (c.pinnedNoteIds || []).filter(id => id !== noteId) }
      : c
  ));
};
```

2. Кнопка прикріплення в Notebook — чи передається caseId:
```bash
grep -n "pinNote\|caseId\|onClick.*pin" src/components/Notebook/index.jsx | head -20
```
Якщо нотатка типу "case" — кнопка має бути активна і передавати caseId.
Якщо нотатка типу "general" — кнопка неактивна (не можна прикріпити до справи).

3. Відображення в Notebook — чи перечитує pinnedNoteIds після pin:
```jsx
// В Notebook — кнопка прикріплення:
const isPinned = caseData?.pinnedNoteIds?.includes(note.id);

<button
  onClick={() => isPinned
    ? onUnpinNote(note.id, note.caseId)
    : onPinNote(note.id, note.caseId)
  }
  style={{ opacity: note.caseId ? 1 : 0.3, cursor: note.caseId ? 'pointer' : 'default' }}
  title={note.caseId ? (isPinned ? 'Відкріпити' : 'Прикріпити') : 'Лише нотатки справ можна прикріпити'}
>
  📌
</button>
```

4. В CaseDossier — перевірити чи props оновлюються без F5:
```bash
grep -n "pinnedNoteIds\|pinned\|notes" src/components/CaseDossier/index.jsx | head -20
```
Якщо компонент читає pinnedNoteIds з props.caseData — має оновлюватись автоматично при зміні стану в App.jsx.

### Фікс кнопки (якщо сіра):
Кнопка прикріплення має бути активна для всіх нотаток типу "case".
Для "general", "content", "system", "records" — кнопка прихована або disabled.

### Кілька нотаток:
pinnedNoteIds[] — масив, тому кілька нотаток підтримуються автоматично.
Перевірити що немає обмеження "якщо вже є pinned — не додавати".

---

## БАГ 2 — КОНТЕКСТНИЙ ФАЙЛ: НЕ ЗНАХОДИТЬ PDF

### Симптом:
Пише "Немає PDF файлів у папці справи" але в 02_ОБРОБЛЕНІ є 27 нарізаних PDF.

### Діагностика:
```bash
grep -n "createCaseContext\|02_ОБРОБЛЕНІ\|listFiles\|driveFolderId\|getSubfolder" src/components/CaseDossier/index.jsx | head -30
grep -n "createCaseContext\|listDriveFiles\|getFilesIn" src/services/driveService.js | head -20
```

### Найімовірніша причина:
Функція шукає файли напряму в driveFolderId (корінь папки справи),
а не в підпапці 02_ОБРОБЛЕНІ.

### Алгоритм пошуку файлів (правильний):

```js
const getContextFiles = async (caseFolderId, token) => {
  // Крок 1: знайти підпапку 02_ОБРОБЛЕНІ
  const subRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?` +
    `q=${encodeURIComponent(
      `'${caseFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    )}&fields=files(id,name)&pageSize=20`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const subData = await subRes.json();
  const folders = subData.files || [];

  // Знайти 02_ОБРОБЛЕНІ в JS (не в query — кирилиця ненадійна)
  const processedFolder = folders.find(f => f.name === '02_ОБРОБЛЕНІ');

  // Крок 2: якщо є 02_ОБРОБЛЕНІ — шукати PDF там
  let targetFolderId = processedFolder?.id || null;

  // Крок 3: якщо 02_ОБРОБЛЕНІ порожня — спробувати 01_ОРИГІНАЛИ
  if (targetFolderId) {
    const pdfRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?` +
      `q=${encodeURIComponent(
        `'${targetFolderId}' in parents and mimeType='application/pdf' and trashed=false`
      )}&fields=files(id,name,size)&pageSize=100`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const pdfData = await pdfRes.json();
    const pdfs = pdfData.files || [];

    if (pdfs.length > 0) return { files: pdfs, source: '02_ОБРОБЛЕНІ' };
  }

  // Крок 4: спробувати 01_ОРИГІНАЛИ
  const originalsFolder = folders.find(f => f.name === '01_ОРИГІНАЛИ');
  if (originalsFolder) {
    const origRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?` +
      `q=${encodeURIComponent(
        `'${originalsFolder.id}' in parents and mimeType='application/pdf' and trashed=false`
      )}&fields=files(id,name,size)&pageSize=100`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const origData = await origRes.json();
    const origPdfs = origData.files || [];

    if (origPdfs.length > 0) {
      return { files: origPdfs, source: '01_ОРИГІНАЛИ', warning: true };
    }
  }

  return { files: [], source: null };
};
```

### Після отримання файлів — завантажити і відправити в Claude:

```js
const createContextFile = async () => {
  const token = localStorage.getItem('levytskyi_drive_token');
  const folderId = caseData.storage?.driveFolderId;
  if (!token || !folderId) { showMsg('❌ Підключіть Drive'); return; }

  showMsg('🔍 Шукаю документи...');
  const { files, source, warning } = await getContextFiles(folderId, token);

  if (files.length === 0) {
    showMsg('❌ Немає PDF файлів. Спочатку нарізайте документи.');
    return;
  }

  if (warning) {
    showMsg(`⚠️ Читаю з 01_ОРИГІНАЛИ (${files.length} файлів). Рекомендую спочатку нарізати.`);
  } else {
    showMsg(`📄 Знайдено ${files.length} файлів в ${source}`);
  }

  // Завантажити файли і відправити в Claude
  showMsg('📥 Завантажую файли...');
  // ... далі document blocks
};
```

---

## ПОРЯДОК ВИКОНАННЯ

1. Діагностика (показати результати grep)
2. Фікс pinNote/unpinNote в App.jsx
3. Фікс відображення в Notebook
4. Фікс кнопок прикріплення
5. Фікс getContextFiles — шукати в підпапках

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "fix: note pinning realtime update, context file finds PDFs in subfolders" && git push origin main
```

## ЧЕКЛІСТ

- [ ] Прикріпив нотатку в досьє → одразу відображається без F5
- [ ] Прикріпив нотатку → в Notebook показує 📌 одразу
- [ ] Можна прикріпити кілька нотаток до однієї справи
- [ ] Кнопки прикріплення активні для нотаток типу "case"
- [ ] "Створити контекст" → знаходить PDF в 02_ОБРОБЛЕНІ
- [ ] Якщо 02_ОБРОБЛЕНІ порожня → шукає в 01_ОРИГІНАЛИ + попереджає

## ДОПИСАТИ В LESSONS.md

```
### [2026-04-09] Drive підпапки — шукати в JS не в query
Кирилиця в q= ненадійна. Отримати всі підпапки без фільтра,
знайти потрібну в JS: folders.find(f => f.name === '02_ОБРОБЛЕНІ')

### [2026-04-09] pinNote — оновлення стану без F5
pinnedNoteIds[] оновлюється через setCases в App.jsx.
Компонент автоматично перерендериться якщо отримує caseData через props.
```
