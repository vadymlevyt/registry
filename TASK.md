# TASK.md — Хірургічний фікс CaseDossier layout
Дата: 08.04.2026

## СЕРЕДОВИЩЕ
Поточний коміт: 5966caf
Компонент: src/components/CaseDossier/index.jsx
Деплой: git add -A && git commit -m "..." && git push origin main

---

## КРОК 0 — ПРОЧИТАТИ LESSONS.md

```bash
cat LESSONS.md
```

---

## КРОК 1 — ДІАГНОСТИКА (не чіпати код до завершення)

### 1А. Знайти кореневий контейнер CaseDossier
```bash
grep -n "position\|zIndex\|overflow\|display.*flex\|flexDirection" src/components/CaseDossier/index.jsx | head -60
```

### 1Б. Знайти де рендериться шапка (← Реєстр, вкладки, кнопка агента)
```bash
grep -n "Реєстр\|showAgent\|setShowAgent\|activeTab\|← " src/components/CaseDossier/index.jsx | head -30
```

### 1В. Знайти де рендериться QI в досьє
```bash
grep -n "showQI\|QuickInput\|Quick Input\|setShowQI" src/components/CaseDossier/index.jsx | head -20
```

### 1Г. Знайти resizable логіку
```bash
grep -n "resize\|Resize\|handleResize\|mouseDown\|touchStart\|panelWidth\|qiWidth\|agentWidth" src/components/CaseDossier/index.jsx | head -30
```

### 1Д. Показати першу return() — структуру JSX
```bash
grep -n "return (" src/components/CaseDossier/index.jsx
```
Потім показати рядки від першого return до ~50 рядків після нього.

**СТОП. Показати результати діагностики і чекати підтвердження перед змінами.**

---

## КРОК 2 — ФІКС НА ОСНОВІ ДІАГНОСТИКИ

Після діагностики застосувати такі правила:

### Правило 1 — Кореневий контейнер
Перший div після return() в CaseDossier МАЄ бути:
```jsx
<div style={{
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 100,
  background: '#0d0f1a',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}}>
```
**overflow: hidden на кореневому** — скрол тільки всередині дочірніх контейнерів.

### Правило 2 — Шапка (← Реєстр + вкладки + кнопка агента)
```jsx
<div style={{
  flexShrink: 0,
  zIndex: 200,
  position: 'relative',
  background: '#0d0f1a',
}}>
```
zIndex: 200 — вище всього іншого в досьє.

### Правило 3 — Робочий рядок (контент + агент + QI)
```jsx
<div style={{
  flex: 1,
  display: 'flex',
  flexDirection: 'row',
  overflow: 'hidden',
  position: 'relative',
  zIndex: 1,
  minHeight: 0,  // КРИТИЧНО для flex дітей зі скролом
}}>
```

### Правило 4 — Контент досьє (ліва частина)
```jsx
<div style={{
  flex: 1,
  overflowY: 'auto',
  minWidth: 0,
}}>
```

### Правило 5 — Агент досьє
```jsx
<div style={{
  width: agentWidth,  // від resizable state, початково 35%
  minWidth: 260,
  maxWidth: 500,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  borderLeft: '1px solid #2a2d3e',
  position: 'relative',  // НЕ absolute
}}>
```

### Правило 6 — QI sidebar
```jsx
<div style={{
  width: qiWidth,  // від resizable state, початково 33%
  minWidth: 280,
  maxWidth: 480,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  borderLeft: '1px solid #2a2d3e',
  position: 'relative',  // НЕ absolute
}}>
```

### Правило 7 — Розділювач між панелями
```jsx
<div
  style={{
    width: 8,
    flexShrink: 0,
    cursor: 'col-resize',
    background: '#1a1d2e',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    zIndex: 10,
    userSelect: 'none',
    WebkitUserSelect: 'none',
  }}
  onMouseDown={handleResizeStart}
  onTouchStart={handleResizeTouchStart}
>
  <div style={{
    width: 4,
    height: 40,
    borderRadius: 2,
    background: '#3a3d5a',
    pointerEvents: 'none',
  }} />
</div>
```

### Правило 8 — Агент: поле вводу завжди внизу
Панель агента — flex колонка:
```jsx
// Переписка
<div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
  {messages...}
</div>

// Поле вводу — ЗАВЖДИ внизу
<div style={{ flexShrink: 0, padding: 8, borderTop: '1px solid #2a2d3e' }}>
  <textarea ... />
  <button>→</button>
</div>
```

---

## КРОК 3 — ПЕРЕВІРКА TOGGLE АГЕНТА

```bash
grep -n "showAgent\|setShowAgent\|Сховати\|Показати" src/components/CaseDossier/index.jsx
```

Якщо логіки немає або зламана — відновити:
```jsx
const [showAgent, setShowAgent] = useState(true);

// При зміні вкладки
useEffect(() => {
  setShowAgent(activeTab === 'overview');
}, [activeTab]);
```

Кнопка в шапці:
```jsx
<button onClick={() => setShowAgent(v => !v)}>
  {showAgent ? '🤖 Сховати агента' : '🤖 Агент'}
</button>
```

Агент рендериться тільки коли showAgent:
```jsx
{showAgent && (
  <>
    {/* розділювач */}
    {/* панель агента */}
  </>
)}
```

---

## КРОК 4 — ПЕРЕВІРКА QI

QI в досьє НЕ є окремим overlay. Це flex sibling всередині робочого рядка.
Рендериться тільки коли showQI:
```jsx
{showQI && (
  <>
    {/* розділювач */}
    {/* QI панель */}
  </>
)}
```

Кнопка QI — в шапці досьє (не плаваюча).

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "fix: dossier layout - proper stacking context and flex structure" && git push origin main
```

---

## ЧЕКЛІСТ ПІСЛЯ ДЕПЛОЮ — ПЕРЕВІРИТИ КОЖЕН ПУНКТ

- [ ] Відкрив досьє — шапка видима одразу (← Реєстр, вкладки, кнопка агента)
- [ ] Кнопка "Сховати агента" працює — агент ховається/показується
- [ ] На вкладках Матеріали/Позиція — агент закритий за замовчуванням
- [ ] Натиснув QI — з'явилась QI панель справа (не overlay, не під контентом)
- [ ] QI займає ~1/3 ширини
- [ ] Рухомі межі між панелями працюють
- [ ] Реєстр НЕ проступає під досьє
- [ ] Головне меню (Дашборд/Справи/Книжка) — активне з досьє

---

## ПІСЛЯ ВИКОНАННЯ — ДОПИСАТИ В LESSONS.md

Додати запис:
```
### [2026-04-08] CaseDossier — правильна flex структура
Кореневий: position:fixed, zIndex:100, overflow:hidden
Шапка: flexShrink:0, zIndex:200, position:relative
Робочий рядок: flex:1, overflow:hidden, minHeight:0 (КРИТИЧНО)
Панелі (контент/агент/QI): position:relative (НЕ absolute)
Розділювач: position:relative, zIndex:10
Агент і QI рендеряться як flex siblings — НЕ як overlay
```
