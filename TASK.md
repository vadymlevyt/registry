# TASK.md — Два фікси: pinNote + контекст сканованих PDF
Дата: 09.04.2026

## КРОК 0 — ПРОЧИТАТИ LESSONS.md
```bash
cat LESSONS.md
```

---

## КРОК 1 — ДІАГНОСТИКА

```bash
# Знайти pinNote в App.jsx — чи оновлює setCases
grep -n -A 15 "const pinNote\|pinNote =" src/App.jsx | head -40

# Знайти як шукає файли для контексту
grep -n -A 20 "findPDFs\|getContextSource\|mimeType.*pdf\|application/pdf" src/components/CaseDossier/index.jsx | head -50
```

Показати результати перед змінами.

---

## БАГ 1 — pinNote НЕ ОНОВЛЮЄ REACT STATE

### Причина:
pinNote зберігає на Drive але не викликає setCases.
Тому компонент не перерендерюється — потрібне F5.

### Фікс в App.jsx:

```js
const pinNote = (noteId, caseId) => {
  // 1. Оновити React state ОДРАЗУ
  setCases(prev => prev.map(c =>
    c.id === caseId
      ? {
          ...c,
          pinnedNoteIds: [...new Set([...(c.pinnedNoteIds || []), noteId])]
        }
      : c
  ));
  // 2. Зберегти на Drive (async, без await — не блокувати UI)
  saveToD rive();
};

const unpinNote = (noteId, caseId) => {
  // 1. Оновити React state ОДРАЗУ
  setCases(prev => prev.map(c =>
    c.id === caseId
      ? {
          ...c,
          pinnedNoteIds: (c.pinnedNoteIds || []).filter(id => id !== noteId)
        }
      : c
  ));
  // 2. Зберегти на Drive
  saveToDrive();
};
```

### Перевірити що CaseDossier читає pinnedNoteIds з props:

```bash
grep -n "pinnedNoteIds\|localPinned\|useState.*pin" src/components/CaseDossier/index.jsx | head -10
```

Якщо є `const [pinnedNoteIds, setPinnedNoteIds] = useState(...)` —
видалити локальний state і читати напряму з `caseData.pinnedNoteIds`.

---

## БАГ 2 — КОНТЕКСТ НЕ ЗНАХОДИТЬ СКАНОВАНІ PDF

### Причина:
Drive API query `mimeType='application/pdf'` може не знаходити
скановані PDF якщо вони завантажені з іншим MIME type.

### Фікс — шукати ВСІ файли без фільтра по mimeType:

```js
const findPDFsForContext = async (caseFolderId, token) => {
  // Отримати підпапки без фільтра по назві
  const subRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?` +
    `q=${encodeURIComponent(
      `'${caseFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    )}&fields=files(id,name)&pageSize=20`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const subData = await subRes.json();
  const folders = subData.files || [];

  // Знайти папки в JS (не в query — кирилиця ненадійна)
  const processed = folders.find(f => f.name === '02_ОБРОБЛЕНІ');
  const originals = folders.find(f => f.name === '01_ОРИГІНАЛИ');

  // Функція отримати файли з папки — БЕЗ фільтра по mimeType
  const getFilesFromFolder = async (folderId) => {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?` +
      `q=${encodeURIComponent(
        `'${folderId}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'`
      )}&fields=files(id,name,size,mimeType)&pageSize=100&orderBy=name`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    return data.files || [];
  };

  // Спробувати 02_ОБРОБЛЕНІ
  if (processed) {
    const files = await getFilesFromFolder(processed.id);
    if (files.length > 0) {
      return { files, source: '02_ОБРОБЛЕНІ', warn: false };
    }
  }

  // Спробувати 01_ОРИГІНАЛИ
  if (originals) {
    const files = await getFilesFromFolder(originals.id);
    if (files.length > 0) {
      return { files, source: '01_ОРИГІНАЛИ', warn: true };
    }
  }

  return { files: [], source: null };
};
```

### При завантаженні файлу для Claude — підтримувати різні MIME types:

```js
// При конвертації файлу в base64 для document block:
const getMediaType = (file) => {
  // Скановані PDF з Drive можуть мати різні MIME types
  if (file.mimeType === 'application/pdf') return 'application/pdf';
  if (file.mimeType?.includes('pdf')) return 'application/pdf';
  // За замовчуванням — PDF (Claude впорається)
  return 'application/pdf';
};
```

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "fix: pinNote updates React state instantly, context finds scanned PDFs" && git push origin main
```

## ЧЕКЛІСТ

- [ ] Прикріпив нотатку → 📌 одразу стає червоним і перевертається без F5
- [ ] Відкріпив → одразу повертається в сірий стан
- [ ] "Створити контекст" → знаходить PDF в 02_ОБРОБЛЕНІ (навіть скановані)
- [ ] Показує кількість знайдених файлів

## ДОПИСАТИ В LESSONS.md

```
### [2026-04-09] pinNote — setCases має бути СИНХРОННИМ
pinNote оновлює setCases ОДРАЗУ, Drive зберігає async без await.
Якщо setCases не викликається — компонент не перерендерюється.

### [2026-04-09] Drive — шукати файли БЕЗ фільтра mimeType
Скановані PDF можуть мати різний MIME type на Drive.
Фільтр: trashed=false and mimeType != folder
Потім фільтрувати по розширенню .pdf в JS якщо потрібно.
```
