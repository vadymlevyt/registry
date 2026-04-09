# TASK.md — Діагностика: folderId + кнопка 📌
Дата: 09.04.2026

## КРОК 0 — ПРОЧИТАТИ LESSONS.md
```bash
cat LESSONS.md
```

---

## КРОК 1 — ПОВНА ДІАГНОСТИКА

```bash
# 1. Як CaseDossier отримує caseData і storage
grep -n "props\|caseData\|storage\|driveFolderId" src/components/CaseDossier/index.jsx | head -20

# 2. Як передається caseData в CaseDossier з App.jsx
grep -n "CaseDossier\|selectedCase\|activeCas" src/App.jsx | head -20

# 3. Звідки береться folderId для контексту
grep -n "folderId\|driveFolderId\|storage\." src/components/CaseDossier/index.jsx | head -20

# 4. Як організовані нотатки в CaseDossier — локальний state чи props
grep -n "useState.*note\|setNotes\|localNotes\|caseNotes\|notes.*case" src/components/CaseDossier/index.jsx | head -20

# 5. Як pinNote передається в CaseDossier
grep -n "onPinNote\|onUnpinNote\|pinNote\|unpinNote" src/components/CaseDossier/index.jsx | head -20
grep -n "onPinNote\|onUnpinNote\|pinNote\|unpinNote" src/App.jsx | head -20
```

Показати ВСІ результати перед будь-якими змінами.

---

## БАГ 1 — КОНТЕКСТ: ЖОДНОЇ ПІДПАПКИ

Система пише "жодної підпапки" — значить запит до Drive повертає порожній масив.

Причини:
1. `folderId` який передається — це не ID папки справи а щось інше
2. Токен не має доступу до цієї папки
3. Папка не в Drive або в кошику

### Додати більше діагностики в UI:

```js
const handleCreateCaseContext = async () => {
  const token = localStorage.getItem('levytskyi_drive_token');
  const folderId = caseData?.storage?.driveFolderId;

  // Показати що є в storage
  showMsg(`Storage: ${JSON.stringify(caseData?.storage)}`);

  if (!token) { showMsg('❌ Немає токена Drive'); return; }
  if (!folderId) { showMsg('❌ Немає folderId в storage'); return; }

  showMsg(`🔍 folderId = ${folderId}`);

  // Перевірити чи папка існує
  const checkRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,trashed`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const checkData = await checkRes.json();
  showMsg(`Папка: ${JSON.stringify(checkData)}`);

  if (checkData.error) {
    showMsg(`❌ Помилка доступу: ${checkData.error.message}`);
    return;
  }
  if (checkData.trashed) {
    showMsg('❌ Папка в кошику');
    return;
  }

  // Тепер шукати підпапки
  const subRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?` +
    `q=${encodeURIComponent(
      `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    )}&fields=files(id,name)&pageSize=20`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const subData = await subRes.json();
  const folders = subData.files || [];
  showMsg(`Підпапки (${folders.length}): ${folders.map(f=>f.name).join(', ') || 'жодної'}`);

  // Також перевірити scope токена
  const aboutRes = await fetch(
    'https://www.googleapis.com/drive/v3/about?fields=user',
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const aboutData = await aboutRes.json();
  showMsg(`Drive user: ${aboutData.user?.emailAddress}`);
};
```

Після деплою натиснути "Створити контекст" і скинути скрін з повідомленнями.
Побачимо: правильний folderId, чи існує папка, чи є підпапки, який юзер в Drive.

---

## БАГ 2 — КНОПКА 📌: АРХІТЕКТУРНА ПРОБЛЕМА

Проблема в тому що CaseDossier, скоріш за все, має локальний стейт
для нотаток або для caseData який НЕ оновлюється коли App.jsx викликає setCases.

### Після діагностики (Крок 1) — знайти де розрив:

Якщо нотатки в локальному state:
```js
// Проблема — localNotes не оновлюється при pinNote в App.jsx
const [localNotes, setLocalNotes] = useState(caseData.notes || []);
```

Рішення — читати нотатки напряму з props.caseData кожного рендеру:
```js
// Правильно — завжди актуально
const caseNotes = (notes?.cases || []).filter(n => n.caseId === caseData.id);
const isPinned = (caseData?.pinnedNoteIds || []).includes(note.id);
```

Якщо caseData в локальному state:
```js
// Проблема — localCase не оновлюється
const [localCase, setLocalCase] = useState(caseData);
```

Рішення — НЕ копіювати caseData в локальний state.
Передавати caseData як props і читати звідти напряму.

### Перевірити props CaseDossier в App.jsx:

```bash
grep -n -A 10 "<CaseDossier" src/App.jsx | head -30
```

onPinNote і onUnpinNote мають передаватись як props і викликати setCases в App.jsx.

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "diag: show storage info and folder check for context, investigate pin state" && git push origin main
```

## ЧЕКЛІСТ

- [ ] Натиснув "Створити контекст" → бачу storage JSON в повідомленні
- [ ] Бачу folderId
- [ ] Бачу чи папка існує на Drive
- [ ] Бачу список підпапок
- [ ] Скинути скрін з цими повідомленнями → зрозуміємо де проблема

## ДОПИСАТИ В LESSONS.md

```
### [2026-04-09] Діагностика Drive — показувати storage і перевіряти папку
Якщо підпапки не знаходяться — спочатку перевірити чи правильний folderId.
GET /files/{folderId}?fields=id,name,trashed — перевірити що папка існує.
Потім шукати підпапки.
```
