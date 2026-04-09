# TASK.md — Фікс 📌, контекст файл, Drive токен, пам'ять агента
# Дата: 10.04.2026
# Гілка: main

## КРИТИЧНЕ ПРАВИЛО
Після успішного npm run build — ЗАВЖДИ без запитань:
```bash
git add -A && git commit -m "fix: pin icon separate from display, context file exists check, drive token refresh, agent memory in API" && git push origin main
```

---

## БАГ 1 — Кнопка 📌 (КРИТИЧНИЙ — шоста спроба)

### Кореневе розуміння проблеми

В CaseDossier є ДВА місця з 📌:

**Місце А — ІКОНКА в блоці "Нотатки до справи" (рядки ~819-829):**
Це ВІДОБРАЖЕННЯ закріплених нотаток. Тут 📌 ЗАВЖДИ яскрава і нахилена.
Це правильно — вона просто показує що нотатка закріплена.

**Місце Б — КНОПКА toggle в списку "НОТАТКИ ПО СПРАВІ" (рядки ~987-992):**
Це КНОПКА яку натискає користувач. Тут 📌 має змінюватись:
- Прикріплена → вертикальна (0deg) + яскрава (opacity 1) + червона
- Відкріплена → нахилена (-45deg) + тьмяна (opacity 0.4) + сіра

Claude Code ймовірно бере стиль з Місця А і застосовує до Місця Б — тому кнопка завжди яскрава і нахилена.

### Діагностика

```bash
# Знайти ВСІ 📌 в файлі і показати контекст кожної:
grep -n "📌" src/components/CaseDossier/index.jsx
grep -n "📌" src/components/Notebook/index.jsx

# Показати стилі кожного місця:
sed -n '815,835p' src/components/CaseDossier/index.jsx
sed -n '980,995p' src/components/CaseDossier/index.jsx
```

### Рішення

**Місце А (іконка в блоці закріплених)** — залишити як є:
```jsx
<span style={{ fontSize: 10 }}>📌</span>  // просто іконка, без rotate/opacity
```

**Місце Б (кнопка toggle)** — ПОВНІСТЮ замінити на цей код.
ВАЖЛИВО: НЕ використовувати функцію isPinned. Обчислювати inline:

```jsx
{(() => {
  const isNotePinned = (caseData.pinnedNoteIds || []).includes(String(note.id));
  return (
    <button
      onClick={() => onPinNote(note.id, caseData.id)}
      title={isNotePinned ? "Відкріпити" : "Закріпити"}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: 16,
        padding: '2px 4px',
        display: 'inline-block',
        transform: isNotePinned ? 'rotate(0deg)' : 'rotate(-45deg)',
        opacity: isNotePinned ? 1 : 0.4,
        color: isNotePinned ? '#e53935' : '#888',
        transition: 'transform 0.2s ease, opacity 0.2s ease, color 0.2s ease'
      }}
    >📌</button>
  );
})()}
```

УВАГА:
- Змінна називається `isNotePinned` (НЕ `isPinned` — щоб не конфліктувати з іншими)
- Читає `caseData.pinnedNoteIds` напряму з props (НЕ з локального state)
- #888 замість #666 для кращої видимості на темному фоні

**В Notebook** — те саме, тільки pinnedNoteIds береться з відповідного джерела.

### Тест
1. Відкрити досьє → в списку нотаток 📌 відкріплена = нахилена + тьмяна + сіра
2. Натиснути → стає вертикальна + яскрава + червона ОДРАЗУ
3. Натиснути знову → назад нахилена + тьмяна + сіра ОДРАЗУ
4. В блоці "Нотатки до справи" зверху — 📌 залишається яскравою іконкою
5. Те саме в Записній книжці

---

## БАГ 2 — Пам'ять агента в API messages[]

### Симптом
Агент каже "немає пам'яті між сесіями". Переписка показується в інтерфейсі (візуально зберігається), але агент її не бачить.

### Діагностика

```bash
# Перевірити чи agentHistory існує в даних і в нормалізації:
grep -n "agentHistory" src/components/CaseDossier/index.jsx | head -15
grep -n "agentHistory" src/App.jsx | head -10

# Головне — що передається в API:
grep -B2 -A20 "messages:" src/components/CaseDossier/index.jsx | head -30
```

### Що перевірити
Знайти fetch до api.anthropic.com в CaseDossier.
Подивитись body.messages — якщо там тільки:
```jsx
messages: [{ role: 'user', content: userMessage }]
```
То це причина — історія не включається.

### Рішення
Замінити messages на:
```jsx
// Підготувати історію:
const historyForAPI = agentMessages
  .filter(m => m.role === 'user' || m.role === 'assistant')
  .slice(-10)
  .map(m => ({ role: m.role, content: m.content }));

// Перший елемент ОБОВ'ЯЗКОВО role: 'user':
const firstUserIdx = historyForAPI.findIndex(m => m.role === 'user');
const cleanHistory = firstUserIdx >= 0 ? historyForAPI.slice(firstUserIdx) : [];

// В fetch body:
messages: [
  ...cleanHistory,
  { role: 'user', content: userMessage }
]
```

Також перевірити що agentHistory зберігається після відповіді:
```bash
grep -n "updateCase.*agentHistory\|agentHistory.*updateCase" src/components/CaseDossier/index.jsx | head -5
```

Якщо немає — додати збереження після кожної відповіді.

---

## БАГ 3 — Контекстний файл: перевірка існування

### Симптом
При повторному натисканні "Створити контекст" — починає створювати новий з нуля.
Має перевірити чи файл вже існує і запитати що робити.

### Рішення
В handleCreateContext ПЕРЕД аналізом документів:

```jsx
async function handleCreateContext() {
  // 1. Перевірити чи файл вже існує на Drive
  const folderId = caseData.storage?.driveFolderId;
  if (!folderId) { showMsg('Папка справи не знайдена'); return; }
  
  const token = localStorage.getItem('levytskyi_drive_token');
  
  try {
    // Пошук існуючого case_context.md
    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+name='case_context.md'+and+trashed=false&fields=files(id,name,modifiedTime)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const searchData = await searchRes.json();
    
    if (searchData.files && searchData.files.length > 0) {
      const existing = searchData.files[0];
      const modDate = new Date(existing.modifiedTime).toLocaleDateString('uk-UA');
      
      // Показати модалку замість confirm:
      const action = window.confirm(
        `Контекст справи вже існує (оновлено ${modDate}).\n\nЗамінити на новий?`
      );
      // TODO: замінити на власну модалку з 3 кнопками: Замінити / Скасувати
      
      if (!action) return;
      
      // Архівувати старий
      // ... (перемістити в archive/ або перейменувати)
    }
  } catch (e) {
    if (e.message === 'DRIVE_TOKEN_EXPIRED') {
      showMsg('❌ Токен Drive протух. Натисніть "Підключити Drive" і спробуйте знову.');
      return;
    }
    // Якщо помилка пошуку — продовжити створення
  }
  
  // 2. Далі — існуючий код аналізу документів
  // ...
}
```

---

## БАГ 4 — Drive токен: авторизація не перекидає на головну

### Симптом
1. Токен Drive протухає через ~1 годину
2. Кнопка "Підключити Drive" на сторінці "Аналіз системи" перекидає на головну сторінку
3. Має авторизувати на місці без переходу

### Діагностика
```bash
grep -n "connectDrive\|initDrive\|handleDriveAuth\|gapi\|oauth" src/App.jsx | head -15
grep -n "Підключити Drive\|Drive.*кнопка\|Drive.*connect" src/App.jsx | head -10
```

### Рішення
1. Знайти функцію авторизації Drive
2. Переконатись що після авторизації НЕ робиться setCurrentView або навігація
3. Авторизація має відкрити popup Google OAuth і після успіху — залишитись на поточній сторінці
4. Якщо зараз робиться redirect — замінити на popup flow

Мінімальний фікс — після авторизації повертатись на попередню сторінку:
```jsx
const previousView = currentView; // зберегти перед авторизацією
// ... авторизація ...
setCurrentView(previousView); // повернутись назад
```

---

## ПОРЯДОК ВИКОНАННЯ

1. БАГ 1 — 📌 кнопка (isNotePinned inline)
2. БАГ 2 — пам'ять агента (messages[] в API)
3. БАГ 3 — перевірка існування контексту
4. БАГ 4 — Drive авторизація без перекидання

---

## ЗБІРКА І ДЕПЛОЙ

```bash
npm run build 2>&1 | tail -5
git add -A && git commit -m "fix: pin icon separate from display, context file exists check, drive token refresh, agent memory in API" && git push origin main
```

---

## КРИТЕРІЇ ЗАВЕРШЕННЯ

- [ ] 📌 КНОПКА: прикріплена = вертикальна + яскрава + червона
- [ ] 📌 КНОПКА: відкріплена = нахилена + тьмяна + сіра
- [ ] 📌 ІКОНКА в блоці закріплених = завжди яскрава (не змінюється)
- [ ] Зміна кнопки ОДРАЗУ при кліку без F5
- [ ] Працює в Досьє і Записній книжці однаково
- [ ] Агент пам'ятає переписку між сесіями (тест: ім'я → закрити → відкрити → запитати)
- [ ] messages[] в API fetch включає cleanHistory
- [ ] "Створити контекст" перевіряє чи файл існує перед створенням
- [ ] Drive авторизація не перекидає на головну сторінку
- [ ] npm run build без помилок
- [ ] git push origin main виконано
