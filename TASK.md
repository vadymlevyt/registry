# TASK.md — Багфікси досьє і системи
# Дата: 07.04.2026
# Гілка: main

## КРИТИЧНЕ ПРАВИЛО
Після успішного npm run build — ЗАВЖДИ без запитань:
```bash
git add -A && git commit -m "fix: dossier bugfixes batch — QI sidebar, back button, agent toggle, notes system, agent memory API" && git push origin main
```

---

## КОНТЕКСТ

Файли для редагування:
- src/components/CaseDossier/index.jsx
- src/App.jsx
- src/components/Notebook/index.jsx (якщо існує)

CaseDossier — overlay поверх реєстру.
Props: caseData, cases, updateCase, onClose, onSaveIdea, onCloseCase, onDelete...
Agent state: agentOpen (useState true), agentMessages (з caseData.agentHistory).
Notes: notesProp передається з App.jsx, caseNotes фільтруються по caseId.

---

## БАГ 1 — QI має відкриватись СПРАВА як sidebar, а не знизу

### Симптом (підтверджений скріншотом)
Зараз QI відкривається ЗНИЗУ екрана. Під ним проступають картки справ з реєстру. Досьє зникає.

### Як має працювати
QI — це sidebar СПРАВА. Коли він відкривається:
- QI займає праву частину екрана
- Все що було (досьє з агентом, або реєстр, або дашборд) СТИСКУЄТЬСЯ ВЛІВО
- Вміст під QI НЕ зникає, НЕ підміняється — просто стає вужчим
- Закрив QI — все розтягується назад на повну ширину

```
БЕЗ QI:
┌──────────────────────────────┬──────────────────┐
│    Досьє (інформація)        │   Агент досьє    │
└──────────────────────────────┴──────────────────┘

З QI (натиснули Quick Input):
┌──────────────────┬──────────┬──────────────────┐
│  Досьє (стисн.)  │ Агент    │   Quick Input     │
│                  │ (стисн.) │   sidebar         │
└──────────────────┴──────────┴──────────────────┘
```

Те саме з реєстру: QI справа, картки справ стискуються вліво.

### Діагностика
```bash
grep -n "showQI\|setShowQI\|QuickInput\|qi-panel\|qi-overlay\|qiOpen" src/App.jsx | head -25
grep -n "position.*fixed\|position.*absolute\|bottom.*0\|top.*0" src/App.jsx | grep -i "qi\|quick" | head -10
```

### Рішення

1. QI НЕ є overlay з position:fixed на весь екран. QI — це sidebar справа.

2. Архітектура layout в App.jsx:

```jsx
<div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
  {/* Основний контент — стискується коли QI відкритий */}
  <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
    {/* Тут реєстр, або досьє, або дашборд, або notebook */}
  </div>

  {/* QI sidebar — з'являється справа */}
  {showQI && (
    <div style={{
      width: 420, minWidth: 360, maxWidth: '50vw',
      borderLeft: '1px solid #2e3148',
      display: 'flex', flexDirection: 'column',
      background: '#141625', flexShrink: 0
    }}>
      {/* Quick Input content */}
    </div>
  )}
</div>
```

3. z-index НЕ потрібен для QI — він в нормальному потоці як flex sibling.
   CaseDossier як overlay: position: fixed, z-index: 50. QI sidebar має бути ПОВЕРХ досьє або поруч — залежно від реалізації.

4. Кнопка Quick Input в шапці (вже є) — toggle: відкрити/закрити sidebar.

5. ПЕРЕКОНАТИСЬ що відкриття QI НЕ скидає dossierCase, НЕ змінює currentView. Знайти всі місця де setShowQI(true) і перевірити що поряд НЕМАЄ setDossierCase(null).

---

## БАГ 2 — Кнопка "← Реєстр" зникла

### Симптом (підтверджений)
В шапці досьє немає кнопки повернення в реєстр.

### Діагностика
```bash
grep -n "onClose\|← Реєстр\|Реєстр\|Назад\|dossier-header" src/components/CaseDossier/index.jsx | head -15
```

### Рішення
Знайти шапку досьє (div з вкладками Огляд/Матеріали/Позиція/Шаблони).
Додати кнопку "← Реєстр" ПЕРШИМ елементом зліва, ПЕРЕД вкладками:

```jsx
<button
  onClick={onClose}
  style={{
    background: 'none', border: 'none', color: '#9aa0b8',
    cursor: 'pointer', fontSize: 14, padding: '6px 12px',
    marginRight: 16, whiteSpace: 'nowrap'
  }}
>
  ← Реєстр
</button>
```

---

## БАГ 3 — Кнопка "🤖 Агент" toggle відсутня

### Симптом (підтверджений)
Агент досьє ЗАВЖДИ відкритий на всіх вкладках. Немає кнопки щоб його сховати.

### Як має працювати
Шапка досьє:
```
[← Реєстр]  [📋 Огляд] [📁 Матеріали] [⚖️ Позиція] [📝 Шаблони]    [🤖 Агент]
```

- Кнопка "🤖 Агент" — toggle, справа в шапці
- Натиснув → панель агента зникає, вміст займає весь екран
- Натиснув ще раз → панель повертається
- Працює на ВСІХ вкладках однаково

Поведінка по вкладках:
- Огляд — агент відкритий за замовчуванням (але можна закрити кнопкою)
- Матеріали, Позиція, Шаблони — агент закритий за замовчуванням (можна відкрити кнопкою)

### Діагностика
```bash
grep -n "agentOpen\|setAgentOpen\|Агент\|Сховати" src/components/CaseDossier/index.jsx | head -15
```

### Рішення

1. Кнопка toggle в шапку (справа, після вкладок):

```jsx
<button
  onClick={() => setAgentOpen(prev => !prev)}
  style={{
    background: agentOpen ? '#4f7cff' : 'transparent',
    color: agentOpen ? '#fff' : '#9aa0b8',
    border: '1px solid',
    borderColor: agentOpen ? '#4f7cff' : '#2e3148',
    padding: '4px 12px', borderRadius: 6,
    cursor: 'pointer', fontSize: 12, fontWeight: 500,
    marginLeft: 'auto', whiteSpace: 'nowrap'
  }}
>
  {agentOpen ? "🤖 Сховати агента" : "🤖 Агент"}
</button>
```

2. useEffect при зміні вкладки:

```jsx
useEffect(() => {
  if (activeTab === 'overview') {
    setAgentOpen(true);
  } else {
    setAgentOpen(false);
  }
}, [activeTab]);
```

3. Панель агента рендериться тільки коли agentOpen === true.
   Без агента — контент займає 100% ширини.

---

## БАГ 4 — Агент не пам'ятає переписку між сесіями

### Симптом (підтверджений скріншотом)
Переписка візуально зберігається (agentHistory в даних справи — працює).
При повторному відкритті досьє повідомлення видно на екрані.
АЛЕ агент каже: "я не пам'ятаю попередню розмову".
Причина: збережена історія НЕ передається в API як messages[].

### Діагностика
```bash
grep -A 30 "fetch.*anthropic\|api\.anthropic" src/components/CaseDossier/index.jsx | head -40
grep -n "messages" src/components/CaseDossier/index.jsx | head -10
```

### Рішення
Знайти функцію відправки повідомлення агенту (fetch до api.anthropic.com).
Змінити messages[] щоб включати збережену історію:

```jsx
// Перед fetch — підготувати історію:
const historyForAPI = agentMessages
  .filter(m => m.role === 'user' || m.role === 'assistant')
  .slice(-10)
  .map(m => ({ role: m.role, content: m.content }));

// API вимагає щоб першим був role: 'user'
const firstUserIdx = historyForAPI.findIndex(m => m.role === 'user');
const cleanHistory = firstUserIdx >= 0 ? historyForAPI.slice(firstUserIdx) : [];

// Передати в API:
messages: [
  ...cleanHistory,
  { role: 'user', content: userMessage }
]
```

ВАЖЛИВО: якщо перший елемент messages має role: 'assistant' — API поверне помилку. Фільтр firstUserIdx це вирішує.

---

## БАГ 5 — "Нова розмова" — замінити браузерний confirm на модалку

### Симптом (підтверджений скріншотом)
Кнопка "Нова розмова" показує стандартний браузерний confirm().
Потрібна власна модалка в стилі системи.

### Діагностика
```bash
grep -n "confirm\|Нова розмова\|Очистити\|clearAgent" src/components/CaseDossier/index.jsx | head -10
```

### Рішення

1. Додати state:
```jsx
const [confirmClearOpen, setConfirmClearOpen] = useState(false);
```

2. Кнопка відкриває модалку замість confirm:
```jsx
<button onClick={() => setConfirmClearOpen(true)} ...>
  + Нова розмова
</button>
```

3. Модалка всередині панелі агента:

```jsx
{confirmClearOpen && (
  <div style={{
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,.6)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 10,
    borderRadius: 8
  }}>
    <div style={{
      background: '#1e2138', borderRadius: 12, padding: '20px 24px',
      maxWidth: 300, textAlign: 'center', border: '1px solid #2e3148'
    }}>
      <div style={{ fontSize: 14, color: '#e8eaf0', marginBottom: 16 }}>
        Почати нову розмову? Поточна історія буде очищена.
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button
          onClick={() => setConfirmClearOpen(false)}
          style={{
            padding: '8px 20px', borderRadius: 6, border: '1px solid #2e3148',
            background: 'transparent', color: '#9aa0b8', cursor: 'pointer', fontSize: 13
          }}
        >
          Скасувати
        </button>
        <button
          onClick={() => {
            setAgentMessages([]);
            updateCase && updateCase(caseData.id, 'agentHistory', []);
            setConfirmClearOpen(false);
          }}
          style={{
            padding: '8px 20px', borderRadius: 6, border: 'none',
            background: '#e74c3c', color: '#fff', cursor: 'pointer', fontSize: 13
          }}
        >
          Очистити
        </button>
      </div>
    </div>
  </div>
)}
```

---

## БАГ 6 — Нотатки: [object Object], закріплення, візуальне виділення

### Симптом (підтверджений скріншотами)
1. Поле "Нотатки до справи" показує `[object Object]`
2. Прикріплюється тільки одна нотатка (ексклюзивне замість toggle)
3. Не видно які нотатки закріплені
4. Текст з caseData.notes не є нотаткою в notes[] (відсутній в Записній книжці)

### АРХІТЕКТУРНЕ ПРАВИЛО — ЄДИНЕ ДЖЕРЕЛО НОТАТОК

Нотатки існують ТІЛЬКИ в масиві notes[] в App.jsx.
Поле caseData.notes — НЕ використовується для нотаток.
Створювати, редагувати, закріплювати, видаляти нотатки — однаково і в Досьє і в Записній книжці.
Досьє показує нотатки відфільтровані по caseId.
Записна книжка показує всі нотатки.

### Діагностика
```bash
grep -n "pinnedNote\|pinned\|📌\|caseData\.notes\|case\.notes\|Нотатки до справи" src/components/CaseDossier/index.jsx | head -20
grep -n "pinNote\|onPinNote\|\.pinned" src/App.jsx | head -10
```

### Рішення — крок 1: міграція caseData.notes

Якщо в якихось справах є текст в caseData.notes — при першому завантаженні перетворити в звичайну нотатку:

```jsx
// В App.jsx або CaseDossier при ініціалізації:
useEffect(() => {
  if (caseData.notes && typeof caseData.notes === 'string' && caseData.notes.trim()) {
    // Перевірити чи вже мігровано
    const alreadyExists = (notesProp || []).some(n =>
      n.caseId === caseData.id && n.text === caseData.notes
    );
    if (!alreadyExists && onAddNote) {
      onAddNote({
        text: caseData.notes,
        caseId: caseData.id,
        category: 'case',
        pinned: true, // закріпити щоб показувалась де раніше
        ts: new Date().toISOString()
      });
      // Очистити старе поле
      updateCase && updateCase(caseData.id, 'notes', '');
    }
  }
}, [caseData.id]);
```

### Рішення — крок 2: поле "Нотатки до справи" в Огляді

Замінити поточний блок:

```jsx
{/* Нотатки до справи */}
<div style={{ marginBottom: 12 }}>
  <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 4 }}>Нотатки до справи</div>
  {(() => {
    const pinned = caseNotes.filter(n => n.pinned);
    if (pinned.length > 0) {
      return (
        <div style={{
          background: '#1a1d2e', borderRadius: 6, padding: '8px 10px',
          fontSize: 12, color: '#c8cce0', lineHeight: 1.6,
          borderLeft: '3px solid #4f7cff'
        }}>
          {pinned.map((note, i) => (
            <div key={note.id || i} style={{
              marginBottom: i < pinned.length - 1 ? 8 : 0,
              paddingBottom: i < pinned.length - 1 ? 8 : 0,
              borderBottom: i < pinned.length - 1 ? '1px solid #2e3148' : 'none'
            }}>
              <div style={{ fontSize: 10, color: '#5a6080', marginBottom: 2 }}>
                📌 {note.ts ? new Date(note.ts).toLocaleDateString('uk-UA') : ''}
              </div>
              <div>{note.text}</div>
            </div>
          ))}
        </div>
      );
    }
    return (
      <div style={{
        fontSize: 12, color: '#5a6080', fontStyle: 'italic',
        padding: '8px 10px'
      }}>
        Закріпіть нотатку 📌 зі списку нижче
      </div>
    );
  })()}
</div>
```

НЕ textarea. Якщо немає закріплених — підказка. Нотатки створюються тільки через "+ Додати".

### Рішення — крок 3: pinNote — toggle, не ексклюзивне

В App.jsx змінити pinNote:

```jsx
const pinNote = (noteId) => {
  setNotes(prev => prev.map(n =>
    n.id === noteId ? { ...n, pinned: !n.pinned } : n
  ));
};
```

НЕ скидати pinned у інших нотаток. Кілька нотаток можуть бути закріплені одночасно.

### Рішення — крок 4: візуальне виділення 📌

В секції "НОТАТКИ ПО СПРАВІ" — кнопка 📌 показує стан:

```jsx
<button
  onClick={() => onPinNote && onPinNote(note.id)}
  style={{
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 16, padding: '2px 4px',
    filter: note.pinned ? 'none' : 'grayscale(1) opacity(0.3)',
    transform: note.pinned ? 'rotate(-45deg)' : 'none',
    transition: 'all 0.2s'
  }}
  title={note.pinned ? "Відкріпити" : "Закріпити"}
>
  📌
</button>
```

Рядок закріпленої нотатки — виділити:

```jsx
<div style={{
  background: note.pinned ? 'rgba(79,124,255,0.08)' : 'transparent',
  borderLeft: note.pinned ? '2px solid #4f7cff' : '2px solid transparent',
  padding: '8px 10px', borderRadius: 4,
  transition: 'all 0.2s'
}}>
  {/* зміст нотатки */}
</div>
```

### Рішення — крок 5: редагування нотаток в Досьє

Нотатки мають редагуватись так само як в Записній книжці:
- Кнопка редагування (✏️ або клік по тексту) → inline textarea
- Зберегти / скасувати
- Зміни через загальний onUpdateNote з App.jsx

---

## БАГ 8 — 📌 і повне редагування в Записній книжці

### Діагностика
```bash
grep -n "pinned\|📌\|pinNote\|onPinNote\|onUpdateNote\|onEditNote" src/components/Notebook/index.jsx | head -10
ls src/components/Notebook/
```

### Рішення

1. В App.jsx — переконатись що Notebook отримує всі потрібні props:

```jsx
<Notebook
  // існуючі props...
  onPinNote={pinNote}
  onUpdateNote={updateNote}
/>
```

2. В Notebook — додати кнопку 📌 на кожній картці нотатки.
   Стиль точно такий як в Досьє (grayscale для незакріплених, rotate -45° для закріплених, підсвітка фону).

3. Редагування нотаток в Notebook має працювати ідентично Досьє.

---

## ПОРЯДОК ВИКОНАННЯ

1. **БАГ 1** — QI sidebar справа (найкритичніший, змінює layout)
2. **БАГ 2** — кнопка "← Реєстр"
3. **БАГ 3** — toggle агента + поведінка по вкладках
4. **БАГ 6** — нотатки: міграція caseData.notes, єдине джерело, pinned toggle, візуалізація
5. **БАГ 4** — агент пам'ять: передати history в API messages[]
6. **БАГ 5** — модалка "Нова розмова"
7. **БАГ 8** — 📌 і редагування в Notebook

---

## ЗБІРКА І ДЕПЛОЙ

```bash
npm run build 2>&1 | tail -5
git add -A && git commit -m "fix: dossier bugfixes batch — QI sidebar, back button, agent toggle, notes system, agent memory API" && git push origin main
```

---

## КРИТЕРІЇ ЗАВЕРШЕННЯ

- [ ] QI відкривається СПРАВА як sidebar
- [ ] Основний контент (досьє/реєстр) стискується вліво при відкритті QI
- [ ] Досьє НЕ зникає і реєстр НЕ проступає при відкритті QI
- [ ] Закрив QI — контент розтягується назад
- [ ] Кнопка "← Реєстр" є в шапці досьє зліва
- [ ] Кнопка "🤖 Агент" toggle є в шапці досьє справа
- [ ] На Огляді агент відкритий за замовчуванням (але можна закрити)
- [ ] На інших вкладках агент закритий за замовчуванням (можна відкрити)
- [ ] Поле "Нотатки до справи" показує ТЕКСТ закріплених нотаток (не [object Object])
- [ ] Якщо немає закріплених — підказка "Закріпіть нотатку зі списку нижче"
- [ ] НЕ textarea для вільного тексту — нотатки тільки через "+ Додати"
- [ ] Текст з caseData.notes мігрований в звичайну нотатку
- [ ] Можна закріпити КІЛЬКА нотаток одночасно (toggle)
- [ ] Закріплені нотатки виділені: яскрава 📌 з rotate(-45deg), підсвітка фону
- [ ] Незакріплені: сіра напівпрозора 📌, без підсвітки
- [ ] Нотатки створюються і редагуються однаково в Досьє і Записній книжці
- [ ] 📌 кнопка є в Записній книжці
- [ ] Агент РЕАЛЬНО пам'ятає переписку (history передається в API messages[])
- [ ] "Нова розмова" — власна модалка (НЕ браузерний confirm)
- [ ] npm run build без помилок
- [ ] git push origin main виконано
