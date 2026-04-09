# TASK.md — Точний фікс: кнопка 📌 в досьє + контекст
Дата: 09.04.2026

## КРОК 0 — ПРОЧИТАТИ LESSONS.md
```bash
cat LESSONS.md
```

---

## КРОК 1 — ПРОЧИТАТИ КОД

```bash
# Знайти ТОЧНИЙ код кнопки в Notebook — копіювати звідси
grep -n -B 3 -A 25 "rotate\|isPinned" src/components/Notebook/index.jsx | head -60

# Знайти ТОЧНИЙ код кнопки в CaseDossier — замінити це
grep -n -B 3 -A 25 "rotate\|isPinned\|📌" src/components/CaseDossier/index.jsx | head -60

# Знайти де визначається isPinned в CaseDossier
grep -n "isPinned\|pinnedNoteIds\|includes.*note" src/components/CaseDossier/index.jsx | head -20
```

---

## БАГ 1 — КНОПКА 📌: ТОЧНА ВИМОГА

Поточна поведінка (НЕПРАВИЛЬНО):
- Кнопка постійно червона незалежно від стану
- В досьє перевертається тільки після F5

Потрібна поведінка (ПРАВИЛЬНО):
- НЕ прикріплена → кнопка СІРА (#666), не перевернута (rotate 0deg)
- Прикріплена → кнопка ЧЕРВОНА (#e53935), перевернута (rotate -45deg)
- Перехід відбувається ОДРАЗУ без F5

### Причина проблеми:

isPinned в CaseDossier швидше за все визначається НЕПРАВИЛЬНО.
Наприклад так (НЕПРАВИЛЬНО — завжди true або завжди false):
```jsx
const isPinned = true; // або
const isPinned = note.pinned; // старе поле якого немає
```

Має бути ПРАВИЛЬНО — читати з props:
```jsx
const isPinned = (caseData?.pinnedNoteIds || []).includes(note.id);
```

### Фікс кнопки — скопіювати з Notebook і адаптувати:

```jsx
// В CaseDossier — для кожної нотатки note:

const isPinned = (caseData?.pinnedNoteIds || []).includes(note.id);

<button
  onClick={() => {
    if (isPinned) {
      onUnpinNote(note.id, caseData.id);
    } else {
      onPinNote(note.id, caseData.id);
    }
  }}
  title={isPinned ? 'Відкріпити' : 'Прикріпити до справи'}
  style={{
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 16,
    padding: '2px 4px',
    color: isPinned ? '#e53935' : '#666',
    transform: isPinned ? 'rotate(-45deg)' : 'rotate(0deg)',
    transition: 'transform 0.2s ease, color 0.2s ease',
    display: 'inline-block',
  }}
>
  📌
</button>
```

ВАЖЛИВО: `isPinned` має обчислюватись кожного рендеру з `caseData.pinnedNoteIds`.
Якщо `caseData` приходить як props з App.jsx і App.jsx оновлює setCases при pinNote —
компонент автоматично перерендериться і кнопка зміниться без F5.

Якщо є локальний useState для pinnedNoteIds — ВИДАЛИТИ його.

---

## БАГ 2 — КОНТЕКСТ: ЗНАЙТИ ЧОМУ НЕ БАЧИТЬ ФАЙЛИ

### Замість console.log — додати повідомлення прямо в UI:

```js
const handleCreateCaseContext = async () => {
  const token = localStorage.getItem('levytskyi_drive_token');
  const folderId = caseData?.storage?.driveFolderId;

  if (!token || !folderId) {
    showMsg('❌ Немає folderId. Перевірте блок Сховище.');
    return;
  }

  // Показати folderId щоб перевірити
  showMsg(`🔍 Шукаю в папці: ${caseData.storage.driveFolderName} (${folderId})`);

  // Отримати підпапки
  const subRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?` +
    `q=${encodeURIComponent(
      `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    )}&fields=files(id,name)&pageSize=20`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const subData = await subRes.json();
  const folders = subData.files || [];

  // Показати що знайшло
  const folderNames = folders.map(f => f.name).join(', ') || 'жодної підпапки';
  showMsg(`📁 Підпапки: ${folderNames}`);

  const processed = folders.find(f => f.name === '02_ОБРОБЛЕНІ');
  const originals = folders.find(f => f.name === '01_ОРИГІНАЛИ');

  if (!processed && !originals) {
    showMsg(`❌ Не знайдено 02_ОБРОБЛЕНІ і 01_ОРИГІНАЛИ серед: ${folderNames}`);
    return;
  }

  // Отримати файли з 02_ОБРОБЛЕНІ
  const getFiles = async (fid, name) => {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?` +
      `q=${encodeURIComponent(
        `'${fid}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'`
      )}&fields=files(id,name,size,mimeType)&pageSize=100`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    const files = data.files || [];
    showMsg(`📄 В папці ${name}: ${files.length} файлів`);
    return files;
  };

  let sourceFiles = [];
  let sourceName = '';

  if (processed) {
    sourceFiles = await getFiles(processed.id, '02_ОБРОБЛЕНІ');
    sourceName = '02_ОБРОБЛЕНІ';
  }

  if (sourceFiles.length === 0 && originals) {
    sourceFiles = await getFiles(originals.id, '01_ОРИГІНАЛИ');
    sourceName = '01_ОРИГІНАЛИ';
  }

  if (sourceFiles.length === 0) {
    showMsg('❌ Файлів не знайдено. Нарізайте документи у вкладці "Робота з документами"');
    return;
  }

  showMsg(`✅ Знайдено ${sourceFiles.length} файлів в ${sourceName}. Починаю читання...`);

  // Далі — відправити в Claude
};
```

Тепер замість "PDF не знайдено" система покаже:
- Яку папку шукає (назва і ID)
- Які підпапки знайшла
- Скільки файлів в кожній підпапці
- Де зупинилась

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "fix: pin button color and rotation in dossier, context shows diagnostic messages" && git push origin main
```

## ЧЕКЛІСТ

- [ ] Нотатка НЕ прикріплена → кнопка сіра, пряма
- [ ] Натиснув прикріпити → кнопка ОДРАЗУ червона і перевернута (без F5)
- [ ] Натиснув відкріпити → кнопка ОДРАЗУ сіра і пряма (без F5)
- [ ] "Створити контекст" → показує назву папки де шукає
- [ ] Показує список підпапок що знайшов
- [ ] Показує кількість файлів в кожній підпапці

## ДОПИСАТИ В LESSONS.md

```
### [2026-04-09] isPinned — завжди обчислювати з props, не з локального state
const isPinned = (caseData?.pinnedNoteIds || []).includes(note.id);
Якщо є локальний useState для pinnedNoteIds — видалити.
Тільки тоді кнопка реагує одразу без F5.

### [2026-04-09] Діагностика Drive — показувати повідомлення в UI
Замість console.log — showMsg() на кожному кроці.
Тоді видно де зупиняється без DevTools.
```
