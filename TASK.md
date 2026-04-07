# TASK.md — Багфікси досьє і системи
# Дата: 07.04.2026
# Гілка: main

## КРИТИЧНЕ ПРАВИЛО
Після успішного npm run build — ЗАВЖДИ без запитань:
```bash
git add -A && git commit -m "fix: dossier bugfixes — QI overlay, back button, agent toggle, notes pin" && git push origin main
```

---

## КОНТЕКСТ

Файл: src/components/CaseDossier/index.jsx
Файл: src/App.jsx
Файл: src/components/Notebook/index.jsx (якщо існує)

Компонент CaseDossier — overlay поверх реєстру.
Props: caseData, cases, updateCase, onClose, onSaveIdea, onCloseCase, onDelete...
Agent state: agentOpen (useState true), agentMessages (з caseData.agentHistory).

---

## БАГ 1 — QI поверх досьє показує реєстр замість досьє

### Симптом
При відкритті Quick Input з вкладки Огляд досьє — під QI з'являється реєстр справ. Досьє зникає.

### Діагностика
```bash
grep -n "dossierCase\|setDossierCase\|showQI\|setShowQI\|openQI\|handleOpenQI" src/App.jsx | head -20
grep -n "z-index\|zIndex.*100\|zIndex.*50\|zIndex.*999" src/App.jsx src/components/CaseDossier/index.jsx | head -20
```

### Причина (ймовірна)
setDossierCase(null) викликається при відкритті QI, або dossierCase скидається побічно.
Або z-index конфлікт: QI і досьє на одному рівні.

### Рішення
1. Знайти де dossierCase скидається і переконатись що відкриття QI НЕ скидає dossierCase
2. z-index ієрархія (ЖОРСТКЕ ПРАВИЛО):
   - Реєстр / Dashboard / Notebook: z-index НЕ задавати (нормальний потік)
   - CaseDossier overlay: z-index: 50
   - QI overlay: z-index: 1000
   - QI floating кнопка: z-index: 999
3. QI має відкриватись ПОВЕРХ досьє, досьє стискається або залишається під ним
4. При закритті QI — досьє все ще має бути відкрите

### Перевірка
Переконатись що в коді відкриття QI (setShowQI(true) або аналог) НІДЕ не стоїть setDossierCase(null).
Якщо стоїть — ВИДАЛИТИ.

---

## БАГ 2 — Кнопка "← Реєстр" зникла

### Симптом
В шапці досьє немає кнопки повернення в реєстр.

### Діагностика
```bash
grep -n "onClose\|← Реєстр\|Реєстр\|Назад\|header\|dossier-header" src/components/CaseDossier/index.jsx | head -15
```

### Рішення
Знайти шапку досьє (header div) і додати кнопку "← Реєстр" на початку:

```jsx
<button
  onClick={onClose}
  style={{
    background: 'none', border: 'none', color: '#9aa0b8',
    cursor: 'pointer', fontSize: 14, padding: '6px 12px',
    display: 'flex', alignItems: 'center', gap: 6
  }}
>
  ← Реєстр
</button>
```

Кнопка має бути ПЕРШИМ елементом в шапці, зліва.

---

## БАГ 3 — Кнопка "🤖 Агент" toggle

### Симптом
Перевірити чи кнопка toggle працює після коміту 263c87c.

### Діагностика
```bash
grep -n "agentOpen\|setAgentOpen\|Агент\|Сховати" src/components/CaseDossier/index.jsx | head -15
```

### Що має бути
1. Кнопка "🤖 Агент" / "🤖 Сховати агента" в шапці досьє
2. Натиснув → панель агента зникає, вміст займає весь екран
3. Натиснув ще раз → панель повертається
4. Працює на ВСІХ вкладках (Огляд, Матеріали, тощо)

### Якщо не працює
Додати кнопку toggle в шапку (поряд з "← Реєстр"):

```jsx
<button
  onClick={() => setAgentOpen(prev => !prev)}
  style={{
    background: agentOpen ? '#4f7cff' : 'transparent',
    color: agentOpen ? '#fff' : '#9aa0b8',
    border: '1px solid',
    borderColor: agentOpen ? '#4f7cff' : '#2e3148',
    padding: '4px 12px', borderRadius: 6,
    cursor: 'pointer', fontSize: 12, fontWeight: 500
  }}
>
  {agentOpen ? "🤖 Сховати агента" : "🤖 Агент"}
</button>
```

Панель агента рендериться тільки коли agentOpen === true.
Без агента — контент займає 100% ширини.

---

## БАГ 4 — Пам'ять агента між сесіями

### Симптом
Перевірити чи працює після коміту 263c87c.

### Діагностика
```bash
grep -n "agentHistory\|agentMessages\|updateCase.*agent\|Нова розмова\|Очистити" src/components/CaseDossier/index.jsx | head -15
```

### Що має бути
1. При відкритті досьє — завантажуються повідомлення з caseData.agentHistory
2. Після кожної пари user/assistant — зберігається через updateCase(id, 'agentHistory', ...)
3. Кнопка "Нова розмова" — confirm → очищає state + agentHistory в справі
4. Дати між повідомленнями різних днів

### Якщо не працює — імплементація вже є в TASK.md попереднього чату (кроки 3.1-3.5), перевірити що:
- agentMessages ініціалізується з caseData.agentHistory (рядок 44-46 — ОК)
- Після відповіді API зберігається updateCase(caseData.id, 'agentHistory', trimmed)
- Останні 10 повідомлень передаються в API як messages[]

---

## БАГ 5 — QI кнопка накладається на панель агента

### Симптом
Перевірити чи працює drag після коміту 263c87c.

### Діагностика
```bash
grep -n "qiBtnPos\|qiDrag\|draggable\|drag.*qi\|qi.*drag\|fab.*position\|floating" src/App.jsx | head -15
```

### Що має бути
1. Floating кнопка ⚡ QI можна перетягнути по екрану (mouse + touch)
2. Клік без переміщення — відкриває QI
3. Якщо перетягнув далеко — це drag, не клік

### Якщо не працює — реалізація вже є в попередньому TASK.md (крок 2).

---

## БАГ 6 — Закріплені нотатки не відображаються

### Симптом
В блоці інформації на вкладці Огляд досьє є поле "Нотатки до справи".
Воно має показувати текст закріплених нотаток.
Якщо нічого не закріплено — поле редагується вручну.
Окремий синій блок "📌 ЗАКРІПЛЕНІ НОТАТКИ" треба ВИДАЛИТИ (якщо є).

### Діагностика
```bash
grep -n "pinnedNote\|pinned\|📌\|ЗАКРІПЛЕНІ\|case\.notes\|caseData\.notes" src/components/CaseDossier/index.jsx | head -15
```

### Контекст коду
Рядок 69-70: caseNotes вже відсортовані, pinnedNote вже знаходиться:
```jsx
const caseNotes = (notesProp || []).slice().sort(...)
const pinnedNote = caseNotes.find(n => n.pinned) || caseNotes[0];
```

### Рішення
1. Знайти поле "Нотатки до справи" в секції інформації (вкладка Огляд)
2. Якщо є закріплена нотатка (pinnedNote && pinnedNote.pinned) → показати її текст (тільки для читання):

```jsx
{/* Нотатки до справи */}
<div style={{ marginBottom: 12 }}>
  <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 4 }}>Нотатки до справи</div>
  {caseNotes.filter(n => n.pinned).length > 0 ? (
    <div style={{
      background: '#1a1d2e', borderRadius: 6, padding: '8px 10px',
      fontSize: 12, color: '#c8cce0', lineHeight: 1.6,
      borderLeft: '3px solid #4f7cff'
    }}>
      {caseNotes.filter(n => n.pinned).map((note, i) => (
        <div key={note.id || i} style={{ marginBottom: i < caseNotes.filter(n => n.pinned).length - 1 ? 8 : 0 }}>
          <div style={{ fontSize: 10, color: '#5a6080', marginBottom: 2 }}>
            📌 {note.ts ? new Date(note.ts).toLocaleDateString('uk-UA') : ''}
          </div>
          <div>{note.text}</div>
        </div>
      ))}
    </div>
  ) : (
    <textarea
      value={caseData.notes || ''}
      onChange={e => updateCase && updateCase(caseData.id, 'notes', e.target.value)}
      placeholder="Вільні нотатки по справі..."
      style={{
        width: '100%', minHeight: 60, background: '#1a1d2e',
        border: '1px solid #2e3148', borderRadius: 6,
        color: '#e8eaf0', padding: '8px 10px', fontSize: 12,
        resize: 'vertical'
      }}
    />
  )}
</div>
```

3. Якщо є окремий синій блок "📌 ЗАКРІПЛЕНІ НОТАТКИ" як окрема секція — ВИДАЛИТИ його.

---

## БАГ 8 — 📌 кнопка відсутня в Записній книжці

### Симптом
Кнопка закріплення нотатки є тільки в Досьє, а в Notebook відсутня.

### Діагностика
```bash
grep -n "pinned\|📌\|pinNote\|onPinNote" src/components/Notebook/index.jsx | head -10
```

### Рішення
1. Перевірити чи Notebook отримує props: onPinNote або pinNote
2. Якщо ні — додати prop в App.jsx де рендериться Notebook:

```jsx
// В App.jsx знайти <Notebook і додати:
onPinNote={(noteId) => {
  const updated = notes.map(n =>
    n.id === noteId ? { ...n, pinned: !n.pinned } : n
  );
  setNotes(updated);
  // зберегти в Drive якщо потрібно
}}
```

3. В Notebook — додати кнопку 📌 на кожній картці нотатки:

```jsx
<button
  onClick={() => onPinNote && onPinNote(note.id)}
  style={{
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 14, opacity: note.pinned ? 1 : 0.3,
    padding: '2px 4px'
  }}
  title={note.pinned ? "Відкріпити" : "Закріпити"}
>
  📌
</button>
```

---

## ПОРЯДОК ВИКОНАННЯ

1. **БАГ 1** — QI overlay (найкритичніший, ламає UX)
2. **БАГ 2** — кнопка "← Реєстр" (базова навігація)
3. **БАГ 3** — перевірити toggle агента
4. **БАГ 4** — перевірити пам'ять агента
5. **БАГ 5** — перевірити drag QI
6. **БАГ 6** — закріплені нотатки
7. **БАГ 8** — 📌 в Notebook

Баги 3, 4, 5 можуть вже працювати після коміту 263c87c — СПОЧАТКУ перевірити діагностикою, фіксити тільки якщо зламані.

---

## ЗБІРКА І ДЕПЛОЙ

```bash
npm run build 2>&1 | tail -5
git add -A && git commit -m "fix: dossier bugfixes — QI overlay, back button, agent toggle, notes pin" && git push origin main
```

---

## КРИТЕРІЇ ЗАВЕРШЕННЯ

- [ ] QI відкривається поверх досьє, досьє НЕ зникає
- [ ] При закритті QI досьє все ще відкрите
- [ ] Кнопка "← Реєстр" є в шапці досьє зліва
- [ ] Кнопка "🤖 Агент" toggle працює на всіх вкладках
- [ ] Після закриття і відкриття досьє — повідомлення агента збережені
- [ ] Кнопка "Нова розмова" очищає з підтвердженням
- [ ] Дати між повідомленнями різних сесій
- [ ] QI кнопка ⚡ можна перетягнути по екрану
- [ ] Закріплені нотатки показуються в полі "Нотатки до справи"
- [ ] Окремий блок "📌 ЗАКРІПЛЕНІ НОТАТКИ" видалений (якщо був)
- [ ] 📌 кнопка є на нотатках в Записній книжці
- [ ] npm run build без помилок
- [ ] git push origin main виконано
