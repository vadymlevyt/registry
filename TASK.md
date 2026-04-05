# TASK: Модуль Записна книжка

Work directly on main branch. Do not create separate branches.

---

## Крок 1 — Перевір поточний стан

Прочитай App.jsx і знайди:
- де знаходиться `notes` в стані (useState)
- де знаходяться `addNote` і `deleteNote`
- де знаходиться `saveNoteToStorage`
- як підключений Dashboard (щоб зробити аналогічно)

---

## Крок 2 — Оновити saveNoteToStorage в App.jsx

Знайди функцію `saveNoteToStorage` і заміни на нову версію з розширеними полями:

```js
function saveNoteToStorage(text, resultPayload, caseId, caseName, source, category) {
  const notes = JSON.parse(localStorage.getItem('levytskyi_notes') || '[]');
  notes.unshift({
    id: Date.now(),
    text: text || '',
    category: category || 'general',
    caseId: caseId || null,
    caseName: caseName || null,
    source: source || 'manual',
    ts: new Date().toISOString(),
  });
  if (notes.length > 500) notes.splice(500);
  localStorage.setItem('levytskyi_notes', JSON.stringify(notes));
}
```

Всі існуючі виклики `saveNoteToStorage(text, result)` залишають старий синтаксис — вони сумісні (нові параметри опціональні).

---

## Крок 3 — Додати вкладку в навігацію App.jsx

Знайди масив вкладок навігації (де є "dashboard", "cases" тощо) і додай:
```js
{ id: 'notebook', label: '📓 Книжка' }
```

---

## Крок 4 — Підключити Notebook в App.jsx

### 4а. Lazy імпорт (ОБОВ'ЯЗКОВО — захист від blank page):
```js
const Notebook = React.lazy(() => import('./components/Notebook'));
```

### 4б. ErrorBoundary клас (додати в App.jsx перед компонентом App):
```js
class ModuleErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: '#9aa0b8' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <div>Модуль тимчасово недоступний</div>
          <div style={{ fontSize: 12, marginTop: 8 }}>Решта системи працює</div>
        </div>
      );
    }
    return this.props.children;
  }
}
```

### 4в. Рендер з захистом:
```jsx
{tab === 'notebook' && (
  <ModuleErrorBoundary>
    <React.Suspense fallback={<div style={{padding:20,color:'#9aa0b8'}}>Завантаження...</div>}>
      <Notebook cases={cases} notes={notes} addNote={addNote} deleteNote={deleteNote} />
    </React.Suspense>
  </ModuleErrorBoundary>
)}
```

Якщо `notes`, `addNote`, `deleteNote` ще не існують в App.jsx — додай їх:
```js
const [notes, setNotes] = React.useState(() => {
  try { return JSON.parse(localStorage.getItem('levytskyi_notes') || '[]'); }
  catch { return []; }
});
function addNote(note) {
  const updated = [note, ...notes];
  setNotes(updated);
  localStorage.setItem('levytskyi_notes', JSON.stringify(updated));
}
function deleteNote(id) {
  const updated = notes.filter(n => n.id !== id);
  setNotes(updated);
  localStorage.setItem('levytskyi_notes', JSON.stringify(updated));
}
```

---

## Крок 5 — Створити src/components/Notebook/index.jsx

Повний компонент. Структура:

```
Notebook
├── inner tabs: [📋 Нотатки] [✏️ Записи]
│
├── Вкладка "Нотатки":
│   ├── Sidebar (200px):
│   │   ├── Пошук (input)
│   │   ├── Категорії: Всі / ⚖️ По справах / 💡 Ідеї / ⚙️ Система / 📝 Загальні
│   │   └── По справах: список унікальних caseName з нотаток
│   └── Список нотаток:
│       ├── Тулбар: назва фільтра + кнопка "+ Нотатка"
│       └── Картки: badge категорії + caseName + source + час + текст + кнопка ✕
│
└── Вкладка "Записи":
    ├── Список зліва (220px): "+ Новий запис" + список записів
    └── Редактор справа:
        ├── Header: назва (input) + 🎤 мікрофон + 🗑 видалити
        ├── textarea (flex:1, НЕ фіксована висота — це редактор, не QI)
        └── Footer: лічильник символів + кнопка "📋 В Quick Input →"
```

### Модель даних:

Нотатки читаються з props.notes.
Вільні записи — localStorage 'levytskyi_free_notes':
```js
{ id: Date.now(), title: string, text: string, createdAt: ISO, updatedAt: ISO }
```

### Мікрофон у "Записах":

Використати Web Speech API напряму (не через App.jsx):
```js
const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
recognition.lang = 'uk-UA';
recognition.onresult = (e) => {
  const transcript = e.results[0][0].transcript;
  // додати до тексту поточного запису
};
recognition.start();
```
Кнопка: 🎤 Надиктувати → при записі: ⏹ Стоп (червона)

### Автозбереження записів:
onBlur на textarea → зберегти в localStorage.

### Стиль:
Темна тема, CSS-змінні узгоджені з App.css:
```css
--bg: #0f1117
--surface: #1a1d27
--surface2: #222536
--border: #2e3148
--accent: #4f7cff
--text: #e8eaf0
--text2: #9aa0b8
--text3: #5a6080
```

### Кнопка "+ Нотатка":
Відкриває просту форму (modal або inline):
- textarea для тексту (height: 120px, фіксована)
- select для категорії (general / case / content / system)
- select для справи (якщо category === 'case') — з props.cases
- кнопки Зберегти / Скасувати

При збереженні — викликати props.addNote з об'єктом:
```js
{ id: Date.now(), text, category, caseId, caseName, source: 'manual', ts: new Date().toISOString() }
```

---

## Крок 6 — Build і деплой

```bash
npm run build
git add -A
git commit -m "Add Notebook module with ErrorBoundary protection"
git push origin main
```

Переконайся що build пройшов без помилок перед push.

---

## Перевірка після виконання (для адвоката):

1. Відкрити vadymlevyt.github.io/registry/ — система відкривається (не синій екран)
2. В навігації з'явилась вкладка 📓 Книжка
3. Клікнути "Книжка" — відкривається модуль (не порожньо, не помилка)
4. Вкладка "Нотатки" — якщо є нотатки в localStorage, вони відображаються
5. Кнопка "+ Нотатка" → заповнити → Зберегти → нотатка з'явилась в списку
6. Фільтри зліва — перемикання між категоріями працює
7. Вкладка "Записи" → "+ Новий запис" → написати текст → перейти в інший запис → текст зберігся
8. Мікрофон 🎤 → при натисканні починає запис (або показує помилку якщо немає дозволу)
9. Перейти на вкладку "Справи" — реєстр працює як раніше (модуль не поламав систему)
