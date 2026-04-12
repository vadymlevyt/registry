# TASK — Агент досьє: персистентна пам'ять + case_context.md
# Legal BMS | АБ Левицького
# Дата: 13.04.2026
# Чат: Модифікація модуля системи Досьє

---

## КРОК 0 — ДІАГНОСТИКА ПЕРЕД ЗМІНАМИ

```bash
cat LESSONS.md
git log --oneline -5
grep -n "agentMessages\|agentHistory\|agent_history\|chatHistory" src/components/CaseDossier/index.jsx | head -30
grep -n "case_context\|caseContext\|loadContext" src/components/CaseDossier/index.jsx | head -20
```

---

## ПРОБЛЕМА 1 — Персистентна пам'ять агента

### Симптом
Агент пам'ятає переписку поки досьє відкрите (сесійна пам'ять).
Після закриття і повторного відкриття — нічого не пам'ятає.
`agent_history.json` на Drive не реалізований — `agentMessages` живе тільки в useState.

### Архітектура рішення

Два файли на Drive в папці справи:
```
Брановський_450/2275/25/
├── agent_history.json   ← останні 20 повідомлень
└── case_context.md      ← контекст справи (Проблема 2)
```

Формат `agent_history.json`:
```json
{
  "caseId": "case_001",
  "caseName": "Нестеренко",
  "updatedAt": "2026-04-13T00:19:00",
  "messages": [
    {
      "role": "user",
      "content": "Яка наша позиція по закриттю провадження?",
      "ts": "2026-04-13T00:10:00"
    },
    {
      "role": "assistant",
      "content": "Наша позиція базується на...",
      "ts": "2026-04-13T00:10:05"
    }
  ]
}
```

### Що реалізувати

**А) При відкритті досьє — завантажити історію:**

```js
// В CaseDossier, при монтуванні або при зміні caseData
const loadAgentHistory = async (caseData) => {
  if (!caseData?.storage?.driveFolderId) return [];
  try {
    // Знайти agent_history.json в папці справи
    const folderId = caseData.storage.driveFolderId;
    const files = await searchDriveFiles(folderId, 'agent_history.json');
    if (!files.length) return [];
    const content = await readDriveFile(files[0].id);
    const history = JSON.parse(content);
    return history.messages || [];
  } catch (e) {
    console.log('agent_history.json не знайдено — починаємо з нуля');
    return [];
  }
};
```

**Б) Після кожного повідомлення — зберегти:**

Зберігати НЕ після кожного символу — тільки після завершення відповіді агента.
Зберігати максимум 20 останніх повідомлень (10 обмінів).

```js
const saveAgentHistory = async (caseData, messages) => {
  if (!caseData?.storage?.driveFolderId) return;
  const last20 = messages.slice(-20);
  const history = {
    caseId: caseData.id,
    caseName: caseData.name,
    updatedAt: new Date().toISOString(),
    messages: last20
  };
  try {
    const folderId = caseData.storage.driveFolderId;
    // Знайти існуючий файл або створити новий
    const existing = await searchDriveFiles(folderId, 'agent_history.json');
    if (existing.length) {
      await updateDriveFile(existing[0].id, JSON.stringify(history, null, 2));
    } else {
      await createDriveFile(folderId, 'agent_history.json', JSON.stringify(history, null, 2));
    }
  } catch (e) {
    console.error('Помилка збереження agent_history:', e);
    // НЕ показувати помилку користувачу — тихий fallback
  }
};
```

**В) Передавати історію в API запит:**

```js
// При формуванні запиту до Claude API
const messages = [
  ...agentMessages  // вже містить завантажену історію
];
```

### Fallback якщо Drive недоступний
- Завантажити не вдалось → починати з порожньої історії, не показувати помилку
- Зберегти не вдалось → тихий fail, сесійна пам'ять залишається

### UX
- Ніяких індикаторів завантаження для агента — все в фоні
- При першому повідомленні після завантаження — агент вже "знає" контекст
- Кнопка "+ Нова розмова" → очищає і useState і agent_history.json

---

## ПРОБЛЕМА 2 — Агент не бачить case_context.md

### Симптом
Кнопка "Створити структуру на Drive" / "Створити контекст" є в інтерфейсі.
Файл `case_context.md` зберігається на Drive.
Але при розмові агент НЕ отримує його вміст — не знає що там написано.

### Архітектура рішення

`case_context.md` — це Рівень 2 пам'яті агента (за архітектурою TASK v3).
Завантажується при відкритті досьє, передається в system prompt агента.

**А) При відкритті досьє — завантажити case_context.md:**

```js
const loadCaseContext = async (caseData) => {
  if (!caseData?.storage?.driveFolderId) return null;
  try {
    const folderId = caseData.storage.driveFolderId;
    const files = await searchDriveFiles(folderId, 'case_context.md');
    if (!files.length) return null;
    const content = await readDriveFile(files[0].id);
    return content; // текст MD файлу
  } catch (e) {
    return null;
  }
};
```

**Б) Додати в system prompt агента:**

```js
const buildAgentSystemPrompt = (caseData, caseContext) => {
  let prompt = `Ти — агент досьє справи "${caseData.name}".
Знаєш справу:
- Суд: ${caseData.court}
- Номер: ${caseData.case_no}
- Категорія: ${caseData.category}
- Статус: ${caseData.status}
- Провадження: ${JSON.stringify(caseData.proceedings || [])}
- Документів: ${(caseData.documents || []).length}`;

  if (caseContext) {
    prompt += `\n\n## КОНТЕКСТ СПРАВИ\n${caseContext}`;
  } else {
    prompt += `\n\nКонтекстний файл справи відсутній.`;
  }

  prompt += `\n\nМожеш редагувати дані справи через ACTION_JSON.
Зміни тільки цю справу. Не вигадуй факти яких немає в контексті.`;

  return prompt;
};
```

**В) Індикатор в UI:**
Якщо `caseContext !== null` → показати маленький індикатор біля агента: "📄 Контекст завантажено"
Якщо `caseContext === null` → нічого не показувати (не лякати)

---

## ПОРЯДОК ВИКОНАННЯ

1. Спочатку `loadCaseContext` + system prompt — простіше і критичніше
2. Потім `loadAgentHistory` при відкритті
3. Потім `saveAgentHistory` після відповіді агента
4. Протестувати: відкрити досьє → запитати агента → закрити → відкрити → знову запитати

---

## ПЕРЕВІРКА ПІСЛЯ ВИКОНАННЯ

**Тест 1 — case_context.md:**
- Відкрити досьє справи де є case_context.md на Drive
- Запитати агента: "Що ти знаєш про цю справу?"
- Очікування: агент цитує факти з case_context.md

**Тест 2 — персистентна пам'ять:**
- Відкрити досьє → написати агенту щось конкретне (напр. "запам'ятай — засідання важливе")
- Закрити досьє → відкрити знову
- Запитати: "про що ми говорили?"
- Очікування: агент відтворює попередню переписку

**Тест 3 — fallback:**
- Відкрити досьє справи БЕЗ папки на Drive
- Агент має запуститись без помилок
- Просто починає з порожньої історії

---

## КРИТИЧНІ ПРАВИЛА

1. Завжди гілка main
2. Не показувати помилки Drive користувачу — тихий fallback
3. Зберігати максимум 20 повідомлень (не розбухати)
4. system prompt будувати в одній функції `buildAgentSystemPrompt`
5. Drive — НІКОЛИ не фільтрувати по кирилиці в query
   ```js
   // НЕПРАВИЛЬНО:
   searchFiles(`name = 'agent_history.json' and '${folderId}' in parents`)
   // ПРАВИЛЬНО — отримати всі файли папки і знайти в JS:
   const files = await getDriveFiles(folderId);
   const target = files.find(f => f.name === 'agent_history.json');
   ```
