# TASK: Notebook — фікси після першого тестування

Work directly on main branch. Do not create separate branches.

---

## Крок 1 — Перевір поточний стан

Перед змінами прочитай:
- src/components/Notebook/index.jsx — як зараз реалізовано відображення і видалення нотаток
- App.jsx — як реалізована дія `save_note` в sendChat (обробник ACTION_JSON)

---

## Крок 2 — QI save_note: додавати нову картку, не перезаписувати

Знайди в App.jsx обробник дії `save_note` (всередині sendChat або handleChatAction).

Поточна логіка швидше за все перезаписує або замінює нотатку.
Змінити на: **завжди додавати новий запис** в масив нотаток справи.

Якщо є `caseId` — додати в `cases[caseId].notes[]`:
```js
const newNote = {
  id: Date.now(),
  text: action.text || action.note || '',
  category: 'case',
  source: 'chat',
  ts: new Date().toISOString(),
};
// Знайти справу і додати нотатку в її масив notes
const updatedCases = cases.map(c =>
  c.id === targetCase.id
    ? { ...c, notes: [...(c.notes || []), newNote] }
    : c
);
setCases(updatedCases);
// Зберегти на Drive через існуючий механізм sync
```

Якщо немає `caseId` (загальна нотатка) — додати в localStorage `levytskyi_notes`:
```js
const general = JSON.parse(localStorage.getItem('levytskyi_notes') || '[]');
general.unshift({ id: Date.now(), text: action.text || '', category: 'general', source: 'chat', ts: new Date().toISOString() });
localStorage.setItem('levytskyi_notes', JSON.stringify(general));
```

---

## Крок 3 — Редагування нотаток в Notebook

В кожній картці нотатки додати кнопку ✏️ (редагувати).

При натисканні — текст нотатки стає редагованим textarea:
- textarea з поточним текстом
- кнопки: ✓ Зберегти / ✕ Скасувати

При збереженні:
- якщо `category === 'case'` — оновити в `cases[caseId].notes[]` через props.updateCase або аналогічну функцію
- якщо інша категорія — оновити в відповідному localStorage ключі

textarea для редагування: фіксована висота 120px (правило системи).

---

## Крок 4 — Підтвердження перед видаленням нотаток зі справ

Знайди функцію видалення нотатки в Notebook/index.jsx.

Для нотаток з `category === 'case'` — перед видаленням показати підтвердження:
```js
if (note.category === 'case') {
  const confirmed = window.confirm(`Видалити нотатку по справі ${note.caseName}?`);
  if (!confirmed) return;
}
```

Для інших категорій (general, system, content) — видаляти без підтвердження.

---

## Крок 5 — Мікрофон "Надиктувати" у вкладці Записи

Знайди кнопку "Надиктувати" в редакторі Записів (вкладка ✏️ Записи).

Перевір чи використовується Web Speech API. Якщо реалізація неповна — замінити на:

```js
function startDictation(onResult) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert('Ваш браузер не підтримує розпізнавання мови. Використовуйте Chrome.');
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = 'uk-UA';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    onResult(transcript);
  };
  recognition.onerror = (e) => {
    if (e.error === 'not-allowed') {
      alert('Дозвольте доступ до мікрофона в налаштуваннях браузера.');
    }
  };
  recognition.start();
}
```

При натисканні "Надиктувати":
- кнопка міняє вигляд: ⏹ Стоп (червона)
- після розпізнавання — текст **додається** до існуючого тексту запису (не замінює):
```js
setCurrentText(prev => prev + (prev ? ' ' : '') + transcript);
```
- кнопка повертається в стан 🎤 Надиктувати

---

## Крок 6 — Build і деплой

```bash
npm run build
git add -A
git commit -m "Notebook: edit notes, confirm delete, fix dictation, QI appends notes"
git push origin main
```

Переконайся що build пройшов без помилок перед push.

---

## Перевірка після виконання (для адвоката):

1. Система відкривається нормально — не синій екран
2. QI: написати "Додай нотатку по справі Рубан — клієнт передзвонив" → нова окрема картка з'явилась, стара не зникла
3. Notebook: навести на нотатку → з'явилась кнопка ✏️ → натиснути → текст став редагованим → змінити → Зберегти → текст оновився
4. Видалення нотатки зі справи → з'явилось питання "Видалити нотатку по справі X?" → підтвердити → видалилась
5. Вкладка Записи → "+ Новий запис" → написати текст → натиснути "Надиктувати" → продиктувати слово → текст додався до існуючого (не замінив)
6. Решта системи (Дашборд, Справи, QI) — працює як раніше
