# TASK.md — Багфікси раунд 2
# Дата: 07.04.2026
# Гілка: main

## КРИТИЧНЕ ПРАВИЛО
Після успішного npm run build — ЗАВЖДИ без запитань:
```bash
git add -A && git commit -m "fix: agent memory API, main menu active, QI proportions, responsive layout" && git push origin main
```

---

## КОНТЕКСТ

Файли для редагування:
- src/components/CaseDossier/index.jsx
- src/App.jsx

Попередній коміт виправив: QI sidebar справа, кнопка "← Реєстр", toggle агента, нотатки [object Object], підказка "Закріпіть нотатку".
Залишились 4 проблеми.

---

## БАГ A — Агент досьє НЕ пам'ятає переписку між сесіями

### Симптом (підтверджений скріншотом ПОВТОРНО)
Переписка візуально зберігається і показується при повторному відкритті.
Але агент каже: "я не зможу пам'ятати цю розмову якщо закриєте чат".
Значить agentHistory НЕ передається в API як messages[].
Цей баг НЕ був виправлений попереднім комітом.

### Діагностика — ОБОВ'ЯЗКОВО ВИКОНАТИ
```bash
grep -n "messages" src/components/CaseDossier/index.jsx | head -15
grep -B5 -A30 "fetch.*anthropic\|api\.anthropic" src/components/CaseDossier/index.jsx
```

Подивитись що саме передається в body.messages при fetch.
Якщо там тільки одне повідомлення { role: 'user', content: ... } — це і є причина.

### Рішення

Знайти fetch до api.anthropic.com в CaseDossier. Знайти де формується масив messages.
ДОДАТИ збережену історію ПЕРЕД поточним повідомленням:

```jsx
// ПЕРЕД fetch — підготувати історію з agentMessages:
const historyForAPI = agentMessages
  .filter(m => m.role === 'user' || m.role === 'assistant')
  .slice(-10)
  .map(m => ({ role: m.role, content: m.content }));

// API Anthropic вимагає щоб першим елементом був role: 'user'
// Якщо історія починається з assistant — обрізати до першого user
const firstUserIdx = historyForAPI.findIndex(m => m.role === 'user');
const cleanHistory = firstUserIdx >= 0 ? historyForAPI.slice(firstUserIdx) : [];

// В fetch body замінити messages на:
messages: [
  ...cleanHistory,
  { role: 'user', content: userMessage }
]
```

### Перевірка
Після фіксу — відкрити досьє, написати агенту "Мене звати Вадим, запам'ятай".
Закрити досьє. Відкрити знову. Написати "Як мене звати?".
Агент має відповісти "Вадим".

---

## БАГ B — Головне меню неактивне в досьє

### Симптом (підтверджений скріншотом)
Коли відкрите досьє, пункти головного меню (Дашборд, Справи, Книжка, Нова справа, Аналіз системи) — заблоковані/неактивні. Можна вийти тільки через "← Реєстр" або оновити сторінку.

### Як має працювати
Головне меню ЗАВЖДИ активне незалежно від того що відкрито.
Натиснув "Дашборд" з досьє → досьє закривається → відкривається дашборд.
Натиснув "Книжка" → досьє закривається → відкривається книжка.
Будь-який пункт меню — закриває досьє і переходить.

### Діагностика
```bash
grep -n "currentView\|setCurrentView\|dossierCase\|setDossierCase\|nav.*click\|menu.*click\|disabled\|pointer-events" src/App.jsx | head -25
```

Подивитись чи навігація в головному меню перевіряє dossierCase і блокується.

### Рішення

В App.jsx — знайти обробники кліку по пунктах меню (Дашборд, Справи, тощо).
При натисканні будь-якого пункту меню — ЗАВЖДИ:
1. Закрити досьє: setDossierCase(null)
2. Перейти до обраного view: setCurrentView('dashboard') тощо

```jsx
// Приклад обробника пункту меню:
function navigateTo(view) {
  setDossierCase(null);   // закрити досьє якщо відкрите
  setShowQI(false);       // закрити QI якщо відкритий
  setCurrentView(view);
}
```

НЕ додавати disabled або pointer-events:none на меню коли досьє відкрите.
НЕ перевіряти dossierCase перед навігацією.

Якщо меню має стиль з opacity або pointer-events коли dossierCase !== null — ВИДАЛИТИ цю умову.

---

## БАГ C — QI sidebar занадто широкий

### Симптом (підтверджений скріншотом)
QI займає приблизно 50% ширини. Занадто багато.

### Як має працювати
Пропорція: QI = 1/3 екрана, решта = 2/3 екрана.
В ландшафтному режимі (горизонтально) — QI справа, 1/3 ширини.

### Діагностика
```bash
grep -n "showQI\|qi.*width\|qi.*sidebar\|width.*420\|width.*50" src/App.jsx | head -15
```

### Рішення

Знайти div QI sidebar і змінити ширину:

```jsx
{showQI && (
  <div style={{
    width: '33.33%',          // 1/3 екрана
    maxWidth: 480,            // не більше 480px
    minWidth: 320,            // не менше 320px
    borderLeft: '1px solid #2e3148',
    display: 'flex', flexDirection: 'column',
    background: '#141625', flexShrink: 0,
    height: '100%', overflow: 'hidden'
  }}>
    {/* QI content */}
  </div>
)}
```

---

## БАГ D — Планшет: при повороті QI переїжджає вниз

### Як має працювати

**Ландшафт (горизонтально):** QI справа, основний контент зліва. flex-direction: row. Пропорція 2/3 + 1/3.

**Портрет (вертикально):** QI знизу, основний контент зверху. flex-direction: column. Пропорція 2/3 висоти зверху + 1/3 висоти знизу.

### Рішення

Використати CSS media query через matchMedia або CSS в App.css:

**Варіант А — через CSS (рекомендований):**

В src/App.css додати:

```css
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
  flex-direction: row;
}

.app-main-content {
  flex: 1;
  overflow: auto;
  min-width: 0;
  min-height: 0;
}

.qi-sidebar {
  width: 33.33%;
  max-width: 480px;
  min-width: 320px;
  border-left: 1px solid #2e3148;
  display: flex;
  flex-direction: column;
  background: #141625;
  flex-shrink: 0;
  height: 100%;
  overflow: hidden;
}

/* Портретний режим — QI знизу */
@media (orientation: portrait) {
  .app-layout {
    flex-direction: column;
  }

  .qi-sidebar {
    width: 100%;
    max-width: none;
    min-width: none;
    height: 33.33vh;
    max-height: 400px;
    min-height: 250px;
    border-left: none;
    border-top: 1px solid #2e3148;
  }

  .app-main-content {
    flex: 1;
    min-height: 0;
  }
}
```

**Варіант Б — через JS (якщо CSS складно застосувати):**

```jsx
const [isPortrait, setIsPortrait] = useState(
  window.matchMedia('(orientation: portrait)').matches
);

useEffect(() => {
  const mq = window.matchMedia('(orientation: portrait)');
  const handler = (e) => setIsPortrait(e.matches);
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}, []);

// Layout:
<div style={{
  display: 'flex',
  flexDirection: isPortrait ? 'column' : 'row',
  height: '100vh', overflow: 'hidden'
}}>
  <div style={{ flex: 1, overflow: 'auto', minWidth: 0, minHeight: 0 }}>
    {/* основний контент */}
  </div>
  {showQI && (
    <div style={{
      ...(isPortrait
        ? { width: '100%', height: '33.33vh', maxHeight: 400, minHeight: 250,
            borderTop: '1px solid #2e3148' }
        : { width: '33.33%', maxWidth: 480, minWidth: 320, height: '100%',
            borderLeft: '1px solid #2e3148' }
      ),
      display: 'flex', flexDirection: 'column',
      background: '#141625', flexShrink: 0, overflow: 'hidden'
    }}>
      {/* QI content */}
    </div>
  )}
</div>
```

Обрати ОДИН варіант (А або Б). Якщо в App.jsx вже є inline styles для layout — краще Б. Якщо є CSS класи — краще А.

---

## ПОРЯДОК ВИКОНАННЯ

1. **БАГ A** — агент пам'ять в API (найкритичніший — двічі не виправлений)
2. **БАГ B** — головне меню активне
3. **БАГ C** — QI ширина 1/3
4. **БАГ D** — responsive portrait/landscape

---

## ЗБІРКА І ДЕПЛОЙ

```bash
npm run build 2>&1 | tail -5
git add -A && git commit -m "fix: agent memory API, main menu active, QI proportions, responsive layout" && git push origin main
```

---

## КРИТЕРІЇ ЗАВЕРШЕННЯ

- [ ] Агент РЕАЛЬНО пам'ятає переписку між сесіями (перевірити: сказати ім'я → закрити → відкрити → запитати)
- [ ] agentMessages передається в API fetch як messages[] (перевірити grep по коду)
- [ ] Головне меню (Дашборд/Справи/Книжка/Нова справа/Аналіз) активне коли досьє відкрите
- [ ] Натиснув пункт меню з досьє → досьє закривається → перехід до модуля
- [ ] QI sidebar = 1/3 ширини екрана (не 50%)
- [ ] В портретному режимі (планшет вертикально) QI внизу, 1/3 висоти
- [ ] В ландшафтному режимі QI справа, 1/3 ширини
- [ ] При повороті планшета layout переключається автоматично
- [ ] npm run build без помилок
- [ ] git push origin main виконано
