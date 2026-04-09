# TASK.md — Кнопка 📌 з Notebook + діагностика контексту
Дата: 09.04.2026

## КРОК 0 — ПРОЧИТАТИ LESSONS.md
```bash
cat LESSONS.md
```

---

## КРОК 1 — ПРОЧИТАТИ КОД NOTEBOOK І CASEDOSSIER

```bash
# Знайти ПОВНИЙ код кнопки прикріплення в Notebook
grep -n -B 2 -A 20 "isPinned\|rotate.*deg\|📌\|pinNote\|unpinNote" src/components/Notebook/index.jsx | head -80

# Знайти як реалізована кнопка в CaseDossier зараз
grep -n -B 2 -A 20 "isPinned\|rotate.*deg\|📌\|pinNote\|unpinNote" src/components/CaseDossier/index.jsx | head -80
```

Показати обидва результати повністю.

---

## БАГ 1 — КНОПКА 📌 В CASEDOSSIER

### Задача:
НЕ намагатись виправити — скопіювати КОД ПОВНІСТЮ з Notebook в CaseDossier.

Після читання коду Notebook:
1. Знайти в CaseDossier де рендериться кнопка 📌
2. Замінити її код на точну копію з Notebook
3. Перевірити що `isPinned` читається з `caseData.pinnedNoteIds` (props), не з локального state

Якщо в Notebook кнопка виглядає так:
```jsx
const isPinned = (activeCaseData?.pinnedNoteIds || []).includes(note.id);

<button
  onClick={() => isPinned
    ? onUnpinNote(note.id, note.caseId)
    : onPinNote(note.id, note.caseId)
  }
  style={{
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 16,
    transform: isPinned ? 'rotate(-45deg)' : 'rotate(0deg)',
    transition: 'transform 0.2s ease, color 0.2s ease',
    color: isPinned ? '#e53935' : '#666',
    padding: '2px 4px',
  }}
  title={isPinned ? 'Відкріпити' : 'Прикріпити до справи'}
>
  📌
</button>
```

То в CaseDossier має бути ТОЧНО ТАК САМО але з `caseData.pinnedNoteIds`:
```jsx
const isPinned = (caseData?.pinnedNoteIds || []).includes(note.id);
```

---

## БАГ 2 — КОНТЕКСТ: ДІАГНОСТИКА + ФІКС

### Задача:
Додати console.log щоб побачити що Drive повертає, потім виправити.

### Додати логування в findPDFsForContext:

```js
const findPDFsForContext = async (caseFolderId, token) => {
  console.log('findPDFsForContext: folderId =', caseFolderId);

  // Отримати підпапки
  const subRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?` +
    `q=${encodeURIComponent(
      `'${caseFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    )}&fields=files(id,name)&pageSize=20`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const subData = await subRes.json();
  const folders = subData.files || [];
  console.log('Підпапки знайдено:', folders.map(f => f.name));

  const processed = folders.find(f => f.name === '02_ОБРОБЛЕНІ');
  const originals = folders.find(f => f.name === '01_ОРИГІНАЛИ');
  console.log('02_ОБРОБЛЕНІ:', processed?.id || 'НЕ ЗНАЙДЕНО');
  console.log('01_ОРИГІНАЛИ:', originals?.id || 'НЕ ЗНАЙДЕНО');

  // Отримати файли БЕЗ фільтра mimeType (крім папок)
  const getFiles = async (fid) => {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?` +
      `q=${encodeURIComponent(
        `'${fid}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'`
      )}&fields=files(id,name,size,mimeType)&pageSize=100&orderBy=name`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    console.log(`Файли в папці ${fid}:`, (data.files || []).map(f => `${f.name} (${f.mimeType})`));
    return data.files || [];
  };

  if (processed) {
    const files = await getFiles(processed.id);
    if (files.length > 0) return { files, source: '02_ОБРОБЛЕНІ', warn: false };
  }

  if (originals) {
    const files = await getFiles(originals.id);
    if (files.length > 0) return { files, source: '01_ОРИГІНАЛИ', warn: true };
  }

  console.log('Файли не знайдено в жодній підпапці');
  return { files: [], source: null };
};
```

### Після деплою:
1. Відкрити DevTools (F12) → Console
2. Натиснути "Створити контекст" в досьє Брановського
3. Подивитись що виводить console.log
4. Надіслати скрін консолі — це покаже де проблема

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "fix: copy pin button from Notebook to Dossier, add context diagnostics" && git push origin main
```

## ЧЕКЛІСТ

- [ ] Кнопка 📌 в досьє перевертається і стає червоною одразу при прикріпленні
- [ ] Кнопка повертається в сірий і розвертається при відкріпленні
- [ ] В консолі видно що findPDFsForContext знаходить підпапки і файли

## ДОПИСАТИ В LESSONS.md

```
### [2026-04-09] Копіювати робочий компонент замість виправляти
Якщо кнопка вже працює в Notebook — скопіювати код в CaseDossier.
Не намагатись виправити — скопіювати точно.
isPinned читається з props.caseData.pinnedNoteIds — не з локального state.

### [2026-04-09] Drive пошук файлів — додавати console.log для діагностики
Якщо Drive не знаходить файли — логувати кожен крок:
folderId, знайдені підпапки, файли в кожній підпапці.
```
