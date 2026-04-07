# TASK.md — CaseDossier багфікси + UI покращення
Дата: 07.04.2026

## СЕРЕДОВИЩЕ
Репо: github.com/vadymlevyt/registry
Компонент: src/components/CaseDossier/index.jsx
Деплой: git add -A && git commit -m "..." && git push origin main
Перевірка після деплою: git log --oneline -3

---

## ОБОВ'ЯЗКОВО ПЕРЕД ПОЧАТКОМ

Прочитати поточний стан компонента:
```bash
wc -l src/components/CaseDossier/index.jsx
```

---

## БАГ 1 — АГЕНТ НЕ ПАМ'ЯТАЄ ПЕРЕПИСКУ (КРИТИЧНИЙ)

**Симптом:** Агент каже "не пам'ятаю жодної розмови яка була до цієї сесії".
Переписка візуально зберігається і показується — але в API не передається.

**ОБОВ'ЯЗКОВА ДІАГНОСТИКА СПОЧАТКУ:**
```bash
grep -B5 -A30 "fetch.*anthropic\|api\.anthropic" src/components/CaseDossier/index.jsx
```
Знайти де формується масив `messages:` у fetch до api.anthropic.com.
Показати що там зараз. Тільки після цього вносити зміни.

**Що потрібно зробити:**
Знайти fetch до api.anthropic.com. Знайти масив messages[]. Замінити на:

```jsx
const historyForAPI = agentMessages
  .filter(m => m.role === 'user' || m.role === 'assistant')
  .slice(-10)
  .map(m => ({ role: m.role, content: m.content }));

const firstUserIdx = historyForAPI.findIndex(m => m.role === 'user');
const cleanHistory = firstUserIdx >= 0 ? historyForAPI.slice(firstUserIdx) : [];

// У fetch body:
messages: [
  ...cleanHistory,
  { role: 'user', content: userMessage }
]
```

**Тест після виправлення:**
1. Відкрити досьє будь-якої справи
2. Написати агенту: "Мене звати Вадим"
3. Закрити досьє (← Реєстр)
4. Відкрити те саме досьє знову
5. Написати: "Як мене звати?"
6. Агент має відповісти "Вадим"

---

## БАГ 2 — QI ЗАНАДТО ШИРОКИЙ

**Симптом:** QI sidebar займає ~50% ширини замість 1/3.

**Рішення:** Знайти стилі QI sidebar і встановити:
```jsx
width: '33.33%',
maxWidth: 480,
minWidth: 320,
```

---

## БАГ 3 — РЕЄСТР ПРОСТУПАЄ ПІД ДОСЬЄ

**Симптом:** Коли відкрите досьє — внизу екрану видно карточки справ з реєстру.

**Рішення:** Знайти кореневий контейнер CaseDossier і встановити:
```jsx
position: 'fixed',
top: 0,
left: 0,
right: 0,
bottom: 0,
background: '#0d0f1a',
zIndex: 50,
overflow: 'auto',
```

---

## БАГ 4 — ДОДАВАННЯ ПРОВАДЖЕННЯ БЕЗ ОНОВЛЕННЯ СТОРІНКИ

**Симптом:** Після додавання нового провадження воно з'являється в UI тільки після F5.

**Причина:** Локальний стан проваджень не оновлюється після збереження через updateCase().

**Рішення:**
Знайти функцію що додає провадження (щось на кшталт handleAddProceeding або addProceeding).

Після виклику updateCase() — додати примусове оновлення локального стану проваджень:

```jsx
// Після updateCase(caseId, 'proceedings', newProceedings):
setLocalProceedings(newProceedings); // або setCase({...case, proceedings: newProceedings})
```

Якщо компонент бере proceedings напряму з props.caseData — переконатись що App.jsx оновлює об'єкт справи реактивно і компонент отримує нові props без перезавантаження.

**Тест:**
1. Відкрити досьє
2. Натиснути "+ Додати провадження"
3. Заповнити і зберегти
4. Нове провадження має з'явитись ОДРАЗУ без F5

---

## ПОКРАЩЕННЯ 1 — ПОЛЕ ЧАТУ АГЕНТА ОДРАЗУ ПІД РУКОЮ

**Проблема:** Коли відкриваєш агента досьє — треба скролити щоб дістатись до поля вводу.

**Рішення:** Панель агента має бути flex колонкою де:
- Заголовок + кнопки управління — фіксована висота зверху
- Переписка (messages) — flex: 1, overflow-y: auto (займає весь простір що лишився)
- Поле вводу (textarea + кнопка надіслати) — фіксовано ЗНИЗУ панелі, flexShrink: 0

```jsx
// Структура панелі агента:
<div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
  {/* Заголовок */}
  <div style={{ flexShrink: 0 }}> ... кнопки, заголовок ... </div>
  
  {/* Переписка */}
  <div style={{ flex: 1, overflowY: 'auto' }}> ... messages ... </div>
  
  {/* Поле вводу — ЗАВЖДИ ВНИЗУ */}
  <div style={{ flexShrink: 0, padding: '8px', borderTop: '1px solid #2a2d3e' }}>
    <textarea ... />
    <button ...>→</button>
  </div>
</div>
```

Аналогічно для QI sidebar.

---

## ПОКРАЩЕННЯ 2 — ГОЛОСОВИЙ ВВІД В АГЕНТ ДОСЬЄ

**Рішення:** Додати кнопку 🎤 поруч з полем вводу агента досьє.
Використати той самий механізм що вже реалізований в QI (isRecordingRef, Web Speech API, uk-UA).
Кнопки × і ✓ при активному записі — як в QI.

---

## ПОКРАЩЕННЯ 3 — РУХОМІ МЕЖІ (RESIZABLE PANELS)

Три рухомі межі:

### 3А — Між QI sidebar і основним контентом досьє
### 3Б — Між агентом досьє і контентом досьє  
### 3В — Між деревом матеріалів і viewer'ом (вкладка Матеріали)

**Реалізація для кожної межі:**

```jsx
// Компонент-розділювач
<div
  style={{
    width: 8,           // або height: 8 для горизонтального
    background: '#1e2130',
    cursor: 'col-resize',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
  }}
  onMouseDown={handleResizeStart}
  onTouchStart={handleResizeTouchStart}
>
  {/* Потовщення-ручка по центру */}
  <div style={{
    width: 4,
    height: 40,
    borderRadius: 2,
    background: '#3a3d5a',
  }} />
</div>
```

**Логіка drag для mouse і touch:**
```jsx
const handleResizeStart = (e) => {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = currentPanelWidth;
  
  const onMove = (e) => {
    const delta = e.clientX - startX;
    const newWidth = Math.max(200, Math.min(600, startWidth + delta));
    setPanelWidth(newWidth);
  };
  
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
};

// Touch аналог — через e.touches[0].clientX
```

**Початкові розміри:**
- QI: 33% (min 280, max 480)
- Агент досьє: 35% (min 280, max 500)
- Дерево матеріалів: 280px (min 200, max 400)

---

## ПОРЯДОК ВИКОНАННЯ

1. Баг 1 (агент пам'ять) — СПОЧАТКУ grep діагностика
2. Баг 2 (QI ширина)
3. Баг 3 (реєстр проступає)
4. Баг 4 (провадження без F5)
5. Покращення 1 (поле вводу знизу)
6. Покращення 2 (голос в агенті)
7. Покращення 3 (рухомі межі)

## ДЕПЛОЙ

```bash
git add -A && git commit -m "fix: dossier bugfixes + resizable panels + agent UX" && git push origin main
```

Перевірити: git log --oneline -3
