# TASK.md — Підключення CaseDossier в App.jsx
# Дата: 06.04.2026
# Гілка: main

## МЕТА
Компонент src/components/CaseDossier/index.jsx вже існує але не підключений.
Треба зробити так щоб клік на справу в реєстрі відкривав досьє.

---

## КРОК 1 — ДІАГНОСТИКА

```bash
grep -n "dossierCase\|CaseDossier\|setDossierCase" src/App.jsx | head -20
```

Якщо нічого не знайдено — компонент не підключений взагалі. Йдемо далі.

```bash
grep -n "import.*from" src/App.jsx | head -20
```

```bash
grep -n "onClick.*case\|case.*onClick\|openCase\|selectedCase\|caseClick\|handleCase" src/App.jsx | head -20
```

Це покаже де зараз обробляється клік на справу.

---

## КРОК 2 — ДОДАТИ ІМПОРТ

На початку src/App.jsx після існуючих імпортів додати:

```jsx
import CaseDossier from './components/CaseDossier';
```

---

## КРОК 3 — ДОДАТИ STATE

Знайти блок з useState в компоненті App і додати:

```jsx
const [dossierCase, setDossierCase] = useState(null);
const [ideas, setIdeas] = useState([]);
```

---

## КРОК 4 — ДОДАТИ updateCase ЯКЩО НЕМАЄ

```bash
grep -n "function updateCase\|updateCase" src/App.jsx | head -5
```

Якщо немає — додати поруч з іншими функціями:

```jsx
function updateCase(caseId, field, value) {
  setCases(prev => prev.map(c => c.id === caseId ? { ...c, [field]: value } : c));
}
```

---

## КРОК 5 — ЗНАЙТИ ДЕ РЕНДЕРЯТЬСЯ КАРТКИ СПРАВ

```bash
grep -n "caseItem\|case\.name\|\.map.*case\|cases\.map" src/App.jsx | head -20
```

Знайти місце де рендерується список справ і де є клік на картку.
Замінити або доповнити обробник кліку:

```jsx
onClick={() => setDossierCase(caseItem)}
```

де `caseItem` — це об'єкт справи в циклі `.map()`. Назва змінної може бути інша — `case`, `c`, `item` тощо. Використати ту що є в коді.

ВАЖЛИВО: якщо зараз клік відкриває якусь існуючу картку або модалку — НЕ видаляти цю логіку, а додати `setDossierCase` поруч. Або замінити якщо це просто `alert` або порожня функція.

---

## КРОК 6 — ДОДАТИ ErrorBoundary ЯКЩО НЕМАЄ

```bash
grep -n "ErrorBoundary" src/App.jsx | head -5
```

Якщо немає — додати перед `function App()` або `export default function App()`:

```jsx
class ErrorBoundary extends React.Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return (
      <div style={{ padding: 20, color: "#e74c3c", fontSize: 13 }}>
        ⚠️ Модуль тимчасово недоступний
        <button onClick={() => this.setState({ hasError: false })}>Спробувати знову</button>
      </div>
    );
    return this.props.children;
  }
}
```

---

## КРОК 7 — ДОДАТИ РЕНДЕР ДОСЬЄ

Знайти кінець return в компоненті App (перед останньою закриваючою дужкою JSX) і додати:

```jsx
{dossierCase && (
  <ErrorBoundary>
    <CaseDossier
      caseData={dossierCase}
      cases={cases}
      updateCase={updateCase}
      onClose={() => setDossierCase(null)}
      onSaveIdea={idea => setIdeas(prev => [...prev, idea])}
    />
  </ErrorBoundary>
)}
```

---

## КРОК 8 — ТЕСТОВІ ДАНІ БРАНОВСЬКОГО

```bash
grep -n "Брановськ\|Branovsk\|initialCases\|defaultCases" src/App.jsx | head -10
```

Знайти об'єкт справи Брановського і додати поля якщо їх немає:

```js
agentHistory: [],
proceedings: [
  {
    id: "proc_main",
    type: "first",
    title: "Основне провадження",
    court: "Пустомитівський районний суд Львівської обл.",
    status: "paused",
    parentProcId: null,
    parentEventId: null
  },
  {
    id: "proc_appeal_1",
    type: "appeal",
    title: "Апеляція: ухвала 03.2024",
    court: "Київський апеляційний суд",
    status: "active",
    parentProcId: "proc_main",
    parentEventId: "event_4"
  }
],
documents: [
  { id: 1, procId: "proc_main", name: "Позовна заява", icon: "📄", date: "березень 2023", category: "pleading", author: "ours", tags: ["key"], notes: "" },
  { id: 2, procId: "proc_main", name: "Ухвала про відкриття провадження", icon: "📋", date: "березень 2023", category: "court_act", author: "court", tags: [], notes: "" },
  { id: 3, procId: "proc_main", name: "Протокол підготовчого засідання", icon: "📋", date: "грудень 2023", category: "court_act", author: "court", tags: [], notes: "" },
  { id: 4, procId: "proc_main", name: "Зустрічна позовна заява", icon: "📄", date: "лютий 2024", category: "pleading", author: "opponent", tags: [], notes: "" },
  { id: 5, procId: "proc_main", name: "Клопотання про поновлення строку", icon: "📄", date: "лютий 2024", category: "motion", author: "opponent", tags: [], notes: "" },
  { id: 6, procId: "proc_main", name: "Ухвала про відмову у прийнятті зустрічного позову", icon: "📋", date: "березень 2024", category: "court_act", author: "court", tags: ["key"], notes: "" },
  { id: 7, procId: "proc_main", name: "Ухвала про зупинення провадження", icon: "📋", date: "квітень 2024", category: "court_act", author: "court", tags: [], notes: "" },
  { id: 8, procId: "proc_appeal_1", name: "Апеляційна скарга на ухвалу", icon: "📤", date: "квітень 2024", category: "pleading", author: "opponent", tags: ["key"], notes: "" },
  { id: 9, procId: "proc_appeal_1", name: "Квитанція про сплату судового збору", icon: "🧾", date: "квітень 2024", category: "other", author: "opponent", tags: [], notes: "" },
  { id: 10, procId: "proc_appeal_1", name: "Відзив на апеляційну скаргу", icon: "📩", date: "травень 2024", category: "pleading", author: "ours", tags: ["key"], notes: "" },
  { id: 11, procId: "proc_appeal_1", name: "Заперечення на відзив", icon: "↩️", date: "червень 2024", category: "pleading", author: "opponent", tags: [], notes: "⚠️ Лікарняний лист — перевірити автентичність" },
  { id: 12, procId: "proc_appeal_1", name: "Відповідь на заперечення", icon: "↪️", date: "липень 2024", category: "pleading", author: "ours", tags: [], notes: "" }
]
```

---

## КРОК 9 — ЗБІРКА І ДЕПЛОЙ

```bash
npm run build
git add -A && git commit -m "Connect CaseDossier to App.jsx: click case opens dossier" && git push origin main
```

---

## КРИТЕРІЇ ЗАВЕРШЕННЯ

- [ ] Клік на справу в реєстрі → відкривається CaseDossier overlay
- [ ] "← Реєстр" → повертає назад в реєстр
- [ ] Вкладки Огляд / Матеріали / Позиція / Шаблони видно
- [ ] Справа Брановський має вкладку Матеріали з документами
- [ ] `npm run build` без помилок

---

## ЯКЩО ЩОСЬ НЕ ТАК

**Досьє не відкривається після кліку:** перевірити чи `setDossierCase` викликається в onClick картки справи — додати `console.log("click", caseItem)` тимчасово.

**Blank page після деплою:** перевірити GitHub Actions логи — скоріш за все синтаксична помилка.

**"React is not defined" при ErrorBoundary:** на початку файлу має бути `import React from 'react'` або замінити `React.Component` на просто клас без React prefix якщо використовується інший підхід.

**updateCase не знайдено:** перевірити як називається функція зміни полів справи в поточному коді — можливо вона вже є під іншою назвою.
