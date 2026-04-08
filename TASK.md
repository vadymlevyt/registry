# TASK.md — Архітектурний рефакторинг: QI виноситься в App.jsx
Дата: 08.04.2026

## СУТЬ ПРОБЛЕМИ

QI зараз вбудований всередину CaseDossier — це неправильна архітектура.
QI має жити в App.jsx на тому ж рівні що і на Дашборді.
CaseDossier не знає про QI і не містить його.

## ПРАВИЛЬНА АРХІТЕКТУРА

```
App.jsx:
┌──────────────────────────────────────────────────┐
│  Верхнє меню (завжди, на всіх сторінках)         │
├────────────────────────────────┬─────────────────┤
│  Поточний вид:                 │   QI sidebar    │
│  - Дашборд                     │   (керується    │
│  - Реєстр справ                │   з App.jsx,    │
│  - CaseDossier                 │   якщо showQI)  │
│    └─ контент + агент досьє    │                 │
└────────────────────────────────┴─────────────────┘
```

QI — глобальний sidebar в App.jsx.
При відкритті QI — весь поточний вид (включно з досьє) зсувається вліво.
CaseDossier всередині себе має тільки: контент зліва + агент досьє справа.

---

## КРОК 0 — ПРОЧИТАТИ LESSONS.md

```bash
cat LESSONS.md
```

---

## КРОК 1 — ДІАГНОСТИКА

### 1А. Як QI зараз реалізований в App.jsx
```bash
grep -n "showQI\|QuickInput\|Quick Input\|qiWidth\|setShowQI" src/App.jsx | head -40
```

### 1Б. Чи є QI в CaseDossier
```bash
grep -n "showQI\|QuickInput\|Quick Input\|qiWidth" src/components/CaseDossier/index.jsx | head -20
```

### 1В. Як виглядає головний layout в App.jsx (return)
```bash
grep -n "return\|<div\|flexDirection\|display.*flex\|position.*fixed" src/App.jsx | head -50
```

### 1Г. Де рендериться верхнє меню в App.jsx
```bash
grep -n "Дашборд\|nav\|menu\|header\|АБ Левицького\|topBar\|navbar" src/App.jsx | head -20
```

СТОП після діагностики — показати результати.

---

## КРОК 2 — РЕФАКТОРИНГ

### 2А. Видалити QI з CaseDossier

В src/components/CaseDossier/index.jsx:
- Видалити весь код пов'язаний з QI (showQI state, QI панель, кнопку QI в шапці)
- Кнопка "Сховати QI" / "QI" — прибрати з шапки досьє
- CaseDossier більше не знає про QI

### 2Б. Перевірити що QI вже є в App.jsx

QI в App.jsx має бути реалізований як глобальний sidebar — так само як на Дашборді.
Якщо вже є — переконатись що він працює і для стану коли відкрите досьє.

Якщо QI в App.jsx керується через showQI state — він має відображатись поверх
будь-якого поточного виду включно з CaseDossier.

### 2В. Головний layout App.jsx

Структура App.jsx має бути:
```jsx
<div style={{
  position: 'fixed',
  top: 0, left: 0, right: 0, bottom: 0,
  display: 'flex',
  flexDirection: 'column',
  background: '#0d0f1a',
  overflow: 'hidden',
}}>
  {/* Верхнє меню — ЗАВЖДИ зверху */}
  <div style={{ flexShrink: 0, zIndex: 200 }}>
    {/* АБ Левицького + навігація */}
  </div>

  {/* Робочий рядок */}
  <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

    {/* Поточний вид — займає весь простір що лишився */}
    <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
      {currentView === 'dashboard' && <Dashboard ... />}
      {currentView === 'registry' && <Registry ... />}
      {dossierCase && <CaseDossier ... />}
    </div>

    {/* Universal Panel — з'являється справа якщо showUniversalPanel */}
    {/* Дві вкладки: [⚡ QI] і [🤖 Агент] — переключення без втрати контексту */}
    {showUniversalPanel && (
      <>
        {/* розділювач */}
        <div style={{ width: 8, cursor: 'col-resize', ... }} onMouseDown={handleQIResize} />
        {/* Universal Panel */}
        <div style={{ width: qiWidth, minWidth: 280, maxWidth: 480, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>

          {/* Вкладки */}
          <div style={{ flexShrink: 0, display: 'flex', borderBottom: '1px solid #2a2d3e' }}>
            <button onClick={() => setUniversalTab('qi')}
              style={{ flex: 1, opacity: universalTab === 'qi' ? 1 : 0.5 }}>
              ⚡ QI
            </button>
            <button onClick={() => setUniversalTab('agent')}
              style={{ flex: 1, opacity: universalTab === 'agent' ? 1 : 0.5 }}>
              🤖 Агент
            </button>
          </div>

          {/* Вміст вкладки */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {universalTab === 'qi' && <QuickInputPanel ... />}
            {universalTab === 'agent' && <MainAgentPanel ... />}
          </div>

        </div>
      </>
    )}
    {/* State: showUniversalPanel, universalTab: 'qi'|'agent', qiWidth */}
    {/* MainAgentPanel — поки порожній placeholder, реалізація пізніше */}

  </div>
</div>
```

### 2Г. CaseDossier — тільки свій контент і агент

CaseDossier всередині має:
```jsx
<div style={{
  position: 'absolute',  // або просто flex child — НЕ fixed
  top: 0, left: 0, right: 0, bottom: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}}>
  {/* Шапка досьє */}
  <div style={{ flexShrink: 0, zIndex: 10 }}>
    ← Реєстр | вкладки | кнопка Агент
    {/* НЕ має кнопки QI */}
  </div>

  {/* Робочий рядок досьє */}
  <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

    {/* Контент вкладки */}
    <div style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'materials' && <MaterialsTab />}
      ...
    </div>

    {/* Агент досьє — якщо showAgent */}
    {showAgent && (
      <>
        <div style={{ width: 8, cursor: 'col-resize' }} onMouseDown={handleAgentResize} />
        <div style={{ width: agentWidth, minWidth: 260, maxWidth: 500, flexShrink: 0 }}>
          <AgentPanel ... />
        </div>
      </>
    )}

  </div>
</div>
```

ВАЖЛИВО: CaseDossier НЕ має position:fixed. Він живе всередині flex контейнера App.jsx.
position:fixed має тільки App.jsx кореневий контейнер.

### 2Д. Прибрати кнопку QI з верхнього хедера

Знайти і видалити кнопку "Quick Input" з верхнього меню App.jsx:
```bash
grep -n "Quick Input\|quickInput\|showQI" src/App.jsx | head -20
```
Залишити тільки круглу плаваючу кнопку ⚡ внизу праворуч.
Вона відкриває/закриває Universal Panel.

### 2Е. Кругла кнопка ⚡ — єдина точка входу

Кнопка що відкриває/закриває QI — у верхньому меню App.jsx (як зараз на інших сторінках).
Не в шапці досьє.

---

## КРОК 3 — ВЕРХНЄ МЕНЮ

Верхнє меню (АБ Левицького + Дашборд/Справи/Книжка/Нова справа/Аналіз системи) —
має бути видиме на ВСІХ сторінках включно з досьє.

Перевірити: чи не перекривається верхнє меню коли відкрите досьє.
Якщо досьє зараз має position:fixed з top:0 — воно перекриває меню.
Після рефакторингу (CaseDossier без position:fixed) — меню має бути видиме завжди.

---

## КРОК 4 — РУХОМА МЕЖА QI

Рухома межа між QI і основним контентом — в App.jsx.
При перетягуванні — змінює qiWidth в App.jsx state.
Це впливає на весь поточний вид включно з досьє.

```jsx
const [qiWidth, setQiWidth] = useState(380);

const handleQIResize = (e) => {
  e.preventDefault();
  const startX = e.clientX || e.touches?.[0]?.clientX;
  const startWidth = qiWidth;

  const onMove = (e) => {
    const x = e.clientX || e.touches?.[0]?.clientX;
    const delta = startX - x;  // QI справа — тягнемо вліво щоб розширити
    const newWidth = Math.max(280, Math.min(480, startWidth + delta));
    setQiWidth(newWidth);
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onUp);
};
```

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "refactor: QI moved to App.jsx, CaseDossier without fixed position" && git push origin main
```

---

## ЧЕКЛІСТ ПІСЛЯ ДЕПЛОЮ

- [ ] Верхнє меню видиме на всіх сторінках (включно з досьє)
- [ ] Відкрив досьє — шапка досьє видима (← Реєстр, вкладки, кнопка Агент)
- [ ] Натиснув кнопку панелі у верхньому меню — Universal Panel з'явився справа і відтіснив досьє вліво
- [ ] Вкладки [⚡ QI] і [🤖 Агент] переключаються без втрати контексту
- [ ] Рухома межа між Universal Panel і основним контентом працює
- [ ] Всередині досьє рухома межа між контентом і агентом досьє
- [ ] При закритті QI — досьє розширюється назад
- [ ] Кнопка "Агент" в шапці досьє — ховає/показує агент досьє
- [ ] Реєстр справ НЕ проступає під досьє

---

## ДОДАТИ В LESSONS.md — АРХІТЕКТУРНИЙ ПРИНЦИП (одразу, не після виконання)

Дописати на початок секції УРОКИ в LESSONS.md:

```
### [АРХІТЕКТУРНИЙ ПРИНЦИП] Universal Panel — найвищий пріоритет інтерфейсу

Це фундаментальний принцип для ВСІХ модулів системи.

Universal Panel (QI + Головний агент) — єдиний глобальний сайдбар.
Живе ТІЛЬКИ в App.jsx. Жоден модуль не містить його і не знає про нього.

ТОЧКА ВХОДУ: одна кругла кнопка ⚡ внизу праворуч (плаваюча, завжди видима).
Кнопка QI у верхньому хедері — ПРИБРАТИ. Залишити тільки круглу кнопку.

ПОВЕДІНКА при відкритті:
- Весь поточний вид (Дашборд / Реєстр / Досьє / будь-який модуль) поступається
  місцем як єдине ціле — зсувається вліво
- Модуль не знає що відбулось — він просто отримав менше ширини
- Universal Panel з'являється справа з рухомою межею

ВКЛАДКИ всередині панелі:
- [⚡ QI] — аналіз документів, введення даних
- [🤖 Агент] — головний агент (поки placeholder)
- Переключення без втрати контексту кожної вкладки

НОВИЙ МОДУЛЬ — чекліст:
□ Модуль НЕ містить QI і НЕ містить Universal Panel
□ Модуль НЕ має position:fixed (тільки App.jsx має fixed)
□ Модуль — flex child в App.jsx, займає весь простір що лишився після Universal Panel
□ Власні панелі модуля (агент, sidebar) — тільки всередині модуля, flex siblings
□ Рухома межа між власними панелями — тільки всередині модуля
```

## ПІСЛЯ ВИКОНАННЯ — ДОПИСАТИ В LESSONS.md

```
### [2026-04-08] Universal Panel — глобальний сайдбар з двома вкладками
Universal Panel (QI + Головний агент) належить App.jsx — не будь-якому модулю.
Дві вкладки: [⚡ QI] і [🤖 Агент] — переключення без втрати контексту.
State в App.jsx: showUniversalPanel, universalTab: 'qi'|'agent', panelWidth.
CaseDossier і Дашборд не знають про Universal Panel — він рівнем вище.
При відкритті — весь поточний вид зсувається вліво.
CaseDossier НЕ має position:fixed — він flex child в App.jsx.
position:fixed має тільки кореневий контейнер App.jsx.
```
