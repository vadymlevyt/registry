# TASK.md — Фікс кнопки 📌 + контекст токен
Дата: 09.04.2026

## КРОК 0 — ПРОЧИТАТИ LESSONS.md
```bash
cat LESSONS.md
```

---

## КРОК 1 — ДІАГНОСТИКА

```bash
# Знайти код кнопки 📌 в Notebook і CaseDossier
grep -n -A 8 "rotate\|isPinned\|transform.*pin" src/components/Notebook/index.jsx | head -40
grep -n -A 8 "rotate\|isPinned\|transform.*pin" src/components/CaseDossier/index.jsx | head -40
```

Показати результати.

---

## БАГ 1 — КНОПКА 📌: ПРАВИЛЬНА ЛОГІКА

### Як ПОВИННО працювати:
```
НЕ прикріплена → нахилена (rotate -45deg) + СІРА (#666)
Прикріплена    → вертикальна (rotate 0deg) + ЧЕРВОНА (#e53935)
```

### Поточна проблема:
Код має умову навпаки — червона коли НЕ прикріплена.

### Знайти в ОБОХ файлах (Notebook і CaseDossier) рядки де:
```
color: isPinned ? ... : ...
transform: isPinned ? ... : ...
```

### Правильний код кнопки:
```jsx
const isPinned = (caseData?.pinnedNoteIds || []).includes(note.id);
// В Notebook: (activeCaseData?.pinnedNoteIds || []).includes(note.id)

<button
  onClick={() => isPinned
    ? onUnpinNote(note.id, caseData.id)
    : onPinNote(note.id, caseData.id)
  }
  title={isPinned ? 'Відкріпити' : 'Прикріпити'}
  style={{
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 16,
    padding: '2px 4px',
    display: 'inline-block',
    // ПРАВИЛЬНО:
    // не прикріплена = нахилена + сіра
    // прикріплена = вертикальна + червона
    transform: isPinned ? 'rotate(0deg)' : 'rotate(-45deg)',
    color: isPinned ? '#e53935' : '#666',
    transition: 'transform 0.2s ease, color 0.2s ease',
  }}
>
  📌
</button>
```

### ВАЖЛИВО — виправити в ОБОХ файлах:
1. src/components/Notebook/index.jsx
2. src/components/CaseDossier/index.jsx

### ЧОМУ НЕ ОНОВЛЮЄТЬСЯ ОДРАЗУ — знайти і виправити:

```bash
# Перевірити чи є локальний state в CaseDossier
grep -n "useState.*pinned\|useState.*notes\|localCase\|setLocalCase" src/components/CaseDossier/index.jsx | head -10

# Перевірити як передається caseData в CaseDossier
grep -n -A 15 "<CaseDossier" src/App.jsx | head -20
```

Якщо CaseDossier має локальний state для caseData або notes —
це причина чому кнопка не оновлюється без F5.

Рішення:
- НЕ копіювати caseData в локальний useState
- Читати pinnedNoteIds напряму з props: `caseData.pinnedNoteIds`
- onPinNote і onUnpinNote мають викликати setCases в App.jsx
- Тоді React автоматично перерендерить CaseDossier з новим caseData

---

## БАГ 2 — КОНТЕКСТ: ТОКЕН ПРОТУХ

### Причина:
Повідомлення "Request had invalid authentication credentials" = OAuth токен протух.
Токен Drive живе ~1 годину. Це не баг коду.

### Фікс — перехоплювати 401 і просити перепідключитись:

```js
// В handleCreateCaseContext і в findPDFsForContext:
// Якщо будь-який fetch повертає 401 — показати повідомлення

const checkRes = await fetch(...);
if (checkRes.status === 401) {
  showMsg('❌ Токен Drive протух. Натисніть "Підключити Drive" знову.');
  return;
}
```

### Додати обробку 401 у всіх Drive запитах в контексті:

```js
const safeFetch = async (url, options) => {
  const res = await fetch(url, options);
  if (res.status === 401) {
    throw new Error('DRIVE_TOKEN_EXPIRED');
  }
  return res;
};

// В handleCreateCaseContext:
try {
  const { files, source } = await findPDFsForContext(folderId, token);
  // ...
} catch (e) {
  if (e.message === 'DRIVE_TOKEN_EXPIRED') {
    showMsg('❌ Токен Drive протух. Натисніть "Підключити Drive" і спробуйте знову.');
  } else {
    showMsg('❌ Помилка: ' + e.message);
  }
}
```

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "fix: pin button correct rotation and color, handle expired Drive token" && git push origin main
```

## ЧЕКЛІСТ

- [ ] НЕ прикріплена нотатка → кнопка нахилена (-45deg) і СІРА
- [ ] Натиснув прикріпити → кнопка ОДРАЗУ вертикальна (0deg) і ЧЕРВОНА
- [ ] Натиснув відкріпити → кнопка ОДРАЗУ нахилена і СІРА
- [ ] Однаково в Notebook і CaseDossier
- [ ] Кнопка перевертається ОДРАЗУ без F5 — і в Notebook і в CaseDossier
- [ ] Токен протух → чітке повідомлення "натисніть Підключити Drive"
- [ ] Після перепідключення Drive → контекст створюється

## ДОПИСАТИ В LESSONS.md

```
### [2026-04-09] Кнопка 📌 — правильна логіка
НЕ прикріплена: rotate(-45deg) + color #666 (сіра нахилена)
Прикріплена: rotate(0deg) + color #e53935 (червона вертикальна)
isPinned = (caseData?.pinnedNoteIds || []).includes(note.id)
Виправити в ОБОХ файлах: Notebook і CaseDossier.

### [2026-04-09] Drive токен — перехоплювати 401
status 401 = токен протух, не баг коду.
Показати: "Токен Drive протух. Натисніть Підключити Drive."
```
