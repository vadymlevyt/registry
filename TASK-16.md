# TASK.md — save_note фікси + UI покращення QI
# Legal BMS | АБ Левицького
# Дата: 03.05.2026

---

## КРОК 0 — ПРОЧИТАТИ LESSONS.md

```bash
cat LESSONS.md
```

---

## КОНТЕКСТ

Три баги з нотатками в QI (жовті — важливі):
- Баг Н-1: нотатка зберігається порожньою — текст не передається
- Баг Н-2: дублює нотатки при повторному натисканні кнопки
- Баг Н-3: "Invalid Date Invalid Date" в Книжці

Причина: chat-handler для save_note не реалізований.
Кнопка "Зберегти нотатку" бере текст з порожнього textarea.
Агент каже "✅ Додано" але реального збереження через executeAction немає.

Два UI покращення (зелені — розвиток):
- Прибрати кнопку "Нотатка" зліва від "Аналізувати" — не потрібна
- Додати кнопку "Додати нотатку" в картку результату Haiku
  поруч з "Оновити засідання"

---

## БЛОК А — ЖОВТІ ФІКСИ (save_note)

### А1 — Додати chat-handler для save_note в sendChat

Знайти початок каскаду if-блоків в sendChat:

```bash
grep -n "action === 'batch_update'\|action === 'delete_deadline'\|action === 'save_note'" src/App.jsx | head -10
```

Якщо блоку save_note немає — додати ПЕРЕД існуючим каскадом:

```javascript
// SAVE_NOTE
if (action === 'save_note') {
  const caseId = actionResult.case_id ||
    (actionResult.case_name
      ? cases.find(c =>
          c.name.toLowerCase().includes(
            (actionResult.case_name || '').toLowerCase()
          )
        )?.id
      : null);

  const noteText = actionResult.text || actionResult.content || '';

  if (!noteText.trim()) {
    addMessage('assistant', 'Текст нотатки порожній. Уточніть що записати.');
    return;
  }

  await onExecuteAction('qi_agent', 'add_note', {
    caseId: caseId || null,
    text: noteText,
    date: actionResult.date || null,
    time: actionResult.time || null,
    category: caseId ? 'case' : 'general',
  });

  addMessage('assistant',
    'Нотатку збережено' +
    (actionResult.case_name ? ' до справи "' + actionResult.case_name + '"' : '') +
    (actionResult.date ? ' на ' + actionResult.date : '') + '.'
  );
  return;
}
```

### А2 — Додати поле ts в ACTIONS.add_note

Знайти де створюється об'єкт нотатки:

```bash
grep -n "add_note\|createdAt\|updatedAt" src/App.jsx | head -20
```

Знайти об'єкт нотатки і додати поле ts поруч з createdAt:

```javascript
ts: new Date().toISOString(),
```

### А3 — Оновити SONNET_CHAT_PROMPT

Знайти SONNET_CHAT_PROMPT:

```bash
grep -n "SONNET_CHAT_PROMPT" src/App.jsx | head -3
```

Знайти список available_action_ids і переконатись що save_note є.
Додати приклад після існуючих прикладів ACTION_JSON:

```
Для збереження нотатки:
ACTION_JSON: {
  "recommended_actions": ["save_note"],
  "action": "save_note",
  "case_name": "Конах",
  "text": "підготувати документи до засідання 12 травня",
  "date": "2026-05-12",
  "time": "11:00"
}
Поле text ОБОВ'ЯЗКОВЕ — повний текст нотатки.
Якщо нотатка без прив'язки до справи — не вказуй case_name.
НЕ генеруй save_note без поля text.
```

### А4 — Прибрати кнопку "Зберегти нотатку" з recommended_actions

Знайти де рендеруються кнопки recommended_actions:

```bash
grep -n "save_note\|Зберегти нотатку\|QI_ACTION_LABELS" src/App.jsx | head -20
```

Якщо є окрема кнопка "Зберегти нотатку" що викликає saveAsNote або
saveNoteToStorage напряму — видалити або перенаправити через executeAction.
Має залишитись тільки один шлях збереження — через chat-handler.

---

## БЛОК Б — ЗЕЛЕНІ ФІКСИ (UI)

### Б1 — Прибрати кнопку "Нотатка" зліва від "Аналізувати"

Знайти кнопку:

```bash
grep -n "Нотатка\|noteBtn\|note-btn" src/App.jsx | grep -i "button\|btn\|onClick" | head -10
```

Знайти кнопку з текстом "Нотатка" або іконкою 📝 що стоїть
поруч з кнопкою "Аналізувати" в рядку кнопок QI.
Видалити її повністю з JSX — вона не потрібна.

### Б2 — Додати кнопку "Додати нотатку" в картку результату Haiku

Знайти де рендериться картка результату після аналізу:

```bash
grep -n "Оновити дату засідання\|analysisCard\|analysisResult.*render\|hearing.*button" src/App.jsx | head -10
```

Додати кнопку поруч з "Оновити дату засідання":

```javascript
{analysisResult && onExecuteAction && (
  <button
    className="action-btn secondary"
    onClick={async () => {
      const noteText = [
        analysisResult.human_message || '',
        analysisResult.doc_type ? 'Тип документа: ' + analysisResult.doc_type : '',
        analysisResult.hearing_date ? 'Дата засідання: ' + analysisResult.hearing_date : '',
        analysisResult.hearing_time ? 'Час: ' + analysisResult.hearing_time : '',
        analysisResult.court ? 'Суд: ' + analysisResult.court : '',
        analysisResult.judge ? 'Суддя: ' + analysisResult.judge : '',
        analysisResult.case_number ? 'Номер справи: ' + analysisResult.case_number : '',
      ].filter(Boolean).join('\n');

      await onExecuteAction('qi_agent', 'add_note', {
        caseId: analysisResult.matched_case_id || null,
        text: noteText,
        date: analysisResult.hearing_date || null,
        time: analysisResult.hearing_time || null,
        category: analysisResult.matched_case_id ? 'case' : 'general',
      });

      addMessage('assistant', 'Нотатку з результатами аналізу збережено до справи.');
    }}
  >
    Додати нотатку
  </button>
)}
```

---

## ПЕРЕВІРКА ПІСЛЯ ЗМІН

```bash
grep -n "action === 'save_note'" src/App.jsx
grep -n "ts:.*Date\|ts: new" src/App.jsx | head -5
grep -n "save_note" src/App.jsx | head -10
```

---

## ТЕСТОВА МАТРИЦЯ після деплою

1. В QI чаті: "Додай нотатку по справі Конах: підготувати документи"
   → відповідає "Нотатку збережено до справи Конах"
   → нотатка з'являється одразу в Досьє і Книжці БЕЗ F5
   → текст нотатки правильний ✅

2. Повторна команда з тим самим текстом
   → НЕ дублює ✅

3. Дата нотатки в Книжці — без "Invalid Date Invalid Date" ✅

4. Кнопка "Нотатка" зліва від "Аналізувати" — зникла ✅

5. Після аналізу Haiku скріншоту або PDF —
   є кнопка "Додати нотатку" поруч з "Оновити засідання"
   При натисканні — нотатка зберігається одразу ✅

6. Дашборд save_note досі працює — не зламали ✅

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "fix: save_note chat-handler + ts поле + кнопка нотатки в картці Haiku" && git push origin main
```

---

## ДОПИСАТИ В LESSONS.md

```
### [2026-05-03] save_note фікси + UI
- save_note: chat-handler в sendChat — текст з actionResult агента
- ACTIONS.add_note: додано поле ts — виправлено Invalid Date в Notebook
- SONNET_CHAT_PROMPT: приклад save_note з обов'язковим полем text
- Прибрано кнопку Нотатка зліва від Аналізувати
- Додано кнопку Додати нотатку в картку результату Haiku
- Єдиний шлях збереження нотатки — через executeAction
```

---

## ВАЖЛИВО: Єдиний шлях збереження нотаток

Зараз є ДВА паралельних шляхи які не працюють:
1. Кнопка "Нотатка" → saveAsNote → saveNoteToStorage → пише напряму в localStorage БЕЗ setCases → не синхронізується без F5
2. Кнопка "Зберегти нотатку" → executeQiAction → бере текст з textarea (порожній) → Баг Н-1

Знайти обидва старі шляхи:

```bash
grep -n "saveAsNote\|saveNoteToStorage\|Зберегти нотатку" src/App.jsx | head -20
```

Видалити обидва старі шляхи. Залишити тільки один через onExecuteAction.
Єдиний правильний шлях — if (action === 'save_note') в sendChat
→ onExecuteAction('qi_agent', 'add_note', {...}) → setCases → синхронізація скрізь без F5.
