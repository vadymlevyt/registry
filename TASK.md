# TASK.md — Закрити і видалити справу
# Дата: 07.04.2026
# Гілка: main

## МЕТА

Реалізувати двоетапне видалення справи:
1. Закрити справу -> статус "closed" -> відображається у вкладці "Закриті"
2. З вкладки "Закриті" -> видалити назавжди -> видалення з реєстру + папка Drive

---

## КРОК 0 — ДІАГНОСТИКА

```bash
grep -n "status.*closed\|filterStatus\|Закрит" src/App.jsx | head -20
grep -n "deleteCase\|delete.*case\|drive.*delete" src/App.jsx | head -20
grep -n "driveConnected\|drive_token\|gapi\|deleteFile\|deleteFolder" src/App.jsx | head -20
```

Зрозуміти:
- Як зараз реалізована фільтрація по статусах (active/paused/closed)
- Чи є вже функція видалення справи
- Як підключений Drive API і чи є функції для видалення файлів/папок

---

## КРОК 1 — КНОПКА "ЗАКРИТИ СПРАВУ"

Кнопка "Закрити справу" в двох місцях:
- В картці справи в реєстрі (в меню дій або три крапки)
- В шапці досьє поряд зі статусом

Знайти де рендеряться дії по справі:
```bash
grep -n "handleEdit\|handleDelete\|onEdit\|onDel\|case.*action" src/App.jsx | head -20
```

Додати функцію закриття:
```jsx
function closeCase(caseId) {
  setCases(prev => prev.map(c =>
    c.id === caseId ? { ...c, status: 'closed' } : c
  ));
  saveToDrive();
}
```

Підтвердження — одне просте вікно:
```jsx
if (window.confirm('Закрити справу? Вона перейде в архів. Видалити можна буде звідти.')) {
  closeCase(caseId);
}
```

---

## КРОК 2 — ВІДОБРАЖЕННЯ ЗАКРИТИХ СПРАВ

Перевірити чи є вкладка "Закриті" у фільтрах статусів:
```bash
grep -n "filterStatus\|Закрит\|closed" src/App.jsx | head -20
```

Якщо вкладка є — переконатись що закриті справи там відображаються.
Якщо немає — додати кнопку фільтра поруч з існуючими.

В закритих справах показувати червону кнопку — тільки для status === 'closed':
```jsx
{c.status === 'closed' && (
  <button
    onClick={() => handleDeleteCase(c)}
    style={{
      color: '#e74c3c',
      background: 'rgba(231,76,60,.1)',
      border: '1px solid rgba(231,76,60,.3)',
      padding: '4px 10px', borderRadius: 6,
      cursor: 'pointer', fontSize: 11
    }}
  >
    Видалити назавжди
  </button>
)}
```

Для активних і призупинених справ цю кнопку НЕ показувати.

---

## КРОК 3 — ФУНКЦІЯ ВИДАЛЕННЯ НАЗАВЖДИ

Подвійне підтвердження — бо операція незворотна:
```jsx
async function handleDeleteCase(caseItem) {
  const first = window.confirm(
    `Видалити справу "${caseItem.name}"?\n\nСправа буде видалена з реєстру.`
  );
  if (!first) return;

  const second = window.confirm(
    `УВАГА! Незворотна операція!\n\n` +
    `Буде видалено справу "${caseItem.name}" з реєстру\n` +
    `та папку справи на Google Drive з усіма файлами.\n\n` +
    `Це неможливо скасувати. Продовжити?`
  );
  if (!second) return;

  await deleteCasePermanently(caseItem);
}

async function deleteCasePermanently(caseItem) {
  try {
    // 1. Видалити папку на Drive якщо є
    if (caseItem.driveFolderId && driveConnected) {
      await deleteDriveFolder(caseItem.driveFolderId);
    } else if (!caseItem.driveFolderId) {
      console.log('driveFolderId not found, skipping Drive deletion');
    }

    // 2. Видалити з масиву справ
    setCases(prev => prev.filter(c => c.id !== caseItem.id));

    // 3. Зберегти оновлений реєстр
    saveToDrive();

    // 4. Якщо відкрите досьє цієї справи — закрити
    if (dossierCase?.id === caseItem.id) {
      setDossierCase(null);
    }

    alert(`Справу "${caseItem.name}" видалено.`);
  } catch (err) {
    console.error('Помилка видалення:', err);
    alert('Помилка при видаленні. Спробуйте ще раз.');
  }
}
```

Функція видалення папки Drive:
```jsx
async function deleteDriveFolder(folderId) {
  const token = localStorage.getItem('levytskyi_drive_token');
  if (!token || !folderId) return;

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${folderId}`,
    {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );

  // 204 = успішно видалено (переміщено в кошик Drive)
  if (!response.ok && response.status !== 204) {
    throw new Error(`Drive API error: ${response.status}`);
  }
}
```

---

## КРОК 4 — ПЕРЕВІРИТИ driveFolderId

```bash
grep -n "driveFolderId\|driveFolder\|folderLink" src/App.jsx | head -10
```

Якщо поля немає в справах — для існуючих справ воно буде null.
В такому випадку deleteCasePermanently просто пропускає видалення папки Drive
і виводить попередження: "Папку Drive не знайдено — видалено тільки з реєстру."

---

## КРОК 5 — ЗБІРКА І ДЕПЛОЙ

```bash
npm run build
git add -A && git commit -m "feat: close case and permanent delete with Drive folder removal" && git push origin main
```

---

## КРИТЕРІЇ ЗАВЕРШЕННЯ

- [ ] Кнопка "Закрити справу" є в картці або меню дій
- [ ] Після закриття справа переходить в статус closed
- [ ] Закрита справа відображається у вкладці "Закриті"
- [ ] Тільки закриті справи мають кнопку "Видалити назавжди"
- [ ] Активні і призупинені — цієї кнопки не мають
- [ ] При натисканні — два вікна підтвердження
- [ ] Після підтвердження справа зникає з реєстру
- [ ] Якщо відкрите досьє цієї справи — воно закривається
- [ ] npm run build без помилок

---

## ЯКЩО ЩОСЬ НЕ ТАК

driveFolderId null: пропустити Drive видалення, показати попередження.
Drive 403: токен протух, запустити переавторизацію.
Blank page: перевірити рядки з confirm — апострофи замінити на подвійні лапки.
