# TASK: Notebook — підключення спільного банку нотаток

Work directly on main branch. Do not create separate branches.

---

## Концепція (прочитай перед виконанням)

Notebook — агрегатор. Він нічого не зберігає сам.
Він читає нотатки з двох джерел і показує єдиним списком.

**Джерело 1 — справи (Drive):**
`cases[].notes` — масив нотаток всередині кожної справи.
Категорія: `case`. Критичні дані — живуть з справою в registry_data.json.

**Джерело 2 — localStorage:**
- `levytskyi_notes` — general нотатки (особисті, без прив'язки)
- `levytskyi_system_notes` — нотатки модуля "Аналіз системи"
- `levytskyi_content_ideas` — ідеї Content Hub (майбутнє, може бути порожнім)

Фільтр "По справах" — показує тільки з `cases[].notes`.
Фільтр "Ідеї" — показує з `levytskyi_content_ideas`.
Фільтр "Система" — показує з `levytskyi_system_notes`.
Фільтр "Загальні" — показує з `levytskyi_notes`.
Фільтр "Всі" — все разом, сортування за датою.

---

## Крок 1 — Перевір поточну структуру даних

Відкрий App.jsx і знайди:
- як виглядає об'єкт справи `cases[]` — чи є в ньому поле `notes`
- якщо `notes` є — який формат: рядок чи масив об'єктів
- як Notebook отримує props (що передається зараз)

Відкрий src/components/Notebook/index.jsx і знайди:
- де зараз читаються нотатки
- як побудована функція агрегації нотаток

---

## Крок 2 — Забезпечити поле notes в кожній справі

В App.jsx знайди місце де завантажуються справи з Drive.
При завантаженні — переконатись що кожна справа має поле `notes` як масив:

```js
cases = cases.map(c => ({
  ...c,
  notes: Array.isArray(c.notes) ? c.notes : []
}));
```

Якщо `notes` в справі — рядок (стара версія), конвертувати:
```js
notes: typeof c.notes === 'string' && c.notes
  ? [{ id: Date.now(), text: c.notes, category: 'case', source: 'manual', ts: new Date().toISOString() }]
  : Array.isArray(c.notes) ? c.notes : []
```

---

## Крок 3 — Оновити функцію агрегації в Notebook/index.jsx

Замінити або додати функцію `getAllNotes()` яка збирає нотатки з усіх джерел:

```js
function getAllNotes(cases) {
  // Джерело 1: нотатки зі справ
  const caseNotes = [];
  (cases || []).forEach(c => {
    (c.notes || []).forEach(n => {
      caseNotes.push({
        ...n,
        category: 'case',
        caseId: c.id,
        caseName: c.name || c.client || 'Справа',
      });
    });
  });

  // Джерело 2: localStorage
  const readLS = (key) => {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); }
    catch { return []; }
  };

  const generalNotes = readLS('levytskyi_notes').map(n => ({ ...n, category: n.category || 'general' }));
  const systemNotes = readLS('levytskyi_system_notes').map(n => ({ ...n, category: 'system' }));
  const contentNotes = readLS('levytskyi_content_ideas').map(n => ({ ...n, category: 'content' }));

  // Об'єднати і відсортувати за датою (нові зверху)
  return [...caseNotes, ...generalNotes, ...systemNotes, ...contentNotes]
    .sort((a, b) => new Date(b.ts || b.createdAt || 0) - new Date(a.ts || a.createdAt || 0));
}
```

---

## Крок 4 — Оновити відображення по справах в сайдбарі

В сайдбарі "По справах" — показувати унікальні справи з яких є нотатки.
Лічильник — кількість нотаток по цій справі.

```js
const casesWithNotes = {};
allNotes.filter(n => n.category === 'case' && n.caseName).forEach(n => {
  casesWithNotes[n.caseName] = (casesWithNotes[n.caseName] || 0) + 1;
});
```

---

## Крок 5 — Додавання нотатки

Кнопка "+ Нотатка" при активному фільтрі "По справах" або конкретній справі:
- показує select для вибору справи (з props.cases)
- після збереження — додає нотатку в `cases[caseId].notes[]`
- викликає функцію оновлення справи яка вже є в App.jsx (ту саму що використовується в картках)
- зберігає на Drive через існуючий механізм sync

При активному фільтрі general/system/content — зберігати в відповідний localStorage ключ.

---

## Крок 6 — Build і деплой

```bash
npm run build
git add -A
git commit -m "Notebook: aggregate notes from cases and localStorage"
git push origin main
```

Переконайся що build пройшов без помилок перед push.

---

## Перевірка після виконання (для адвоката):

1. Відкрити vadymlevyt.github.io/registry/ — система відкривається нормально
2. Перейти в Книжку → вкладка Нотатки → фільтр "Всі" — показує нотатки
3. Фільтр "По справах" — показує нотатки з карток справ (не 0)
4. В сайдбарі "По справах" — видно назви справ з лічильниками
5. Клікнути на конкретну справу в сайдбарі — показує тільки її нотатки
6. Кнопка "+ Нотатка" → вибрати справу → зберегти → нотатка з'явилась
7. Перейти в картку цієї справи — нотатка там теж є (спільні дані)
8. Фільтр "Загальні" — показує нотатки без прив'язки до справ
9. Решта системи (Дашборд, Справи) — працює як раніше
