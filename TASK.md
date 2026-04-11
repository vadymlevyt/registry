# TASK.md — Точкові фікси Quick Input
# Legal BMS | АБ Левицького
# Дата: 11.04.2026
# Статус: ВИКОНАТИ

---

## КРОК 0 — ПРОЧИТАТИ LESSONS.md

```bash
cat LESSONS.md
```

---

## ФІКС 1 — update_deadline з null (рядок 1557)

**Проблема:** Обробник ігнорує порожнє значення — дедлайн неможливо очистити через агента.

**Знайти:**
```bash
grep -n "update_deadline\|deadline_date" src/App.jsx | head -20
```

**Змінити умову:**
```javascript
// Зараз (зламано):
if (matched && deadline_date) { ... }

// Треба:
if (matched && deadline_date !== undefined) { ... }
```

Тепер `null` і `""` проходять — поле очищається.

---

## ФІКС 2 — PDF Vision поріг (рядок ~895)

**Проблема:** Поріг 20 символів — занизький. Артефакти сканів (колонтитули, номери сторінок) помилково вважаються текстом.

**Знайти:**
```bash
grep -n "length > 20\|length > 50\|fullText\|extractPdfText" src/App.jsx | head -20
```

**Змінити:**
```javascript
// Зараз:
if (fullText.trim().length > 20)

// Треба:
if (fullText.trim().length > 50)
```

---

## ФІКС 3 — Видалити debug console.log (рядки 928, 929, 932, 934, 2995)

**Проблема:** Залишились тимчасові записи від діагностики. Засмічують консоль.

**Знайти:**
```bash
grep -n "readImageAsBase64 called\|FileReader onload\|base64 length\|driveConnected changed" src/App.jsx
```

**Видалити** знайдені рядки повністю.

---

## ФІКС 4 — Дублікат extractShortName (рядки 1249 і 1497)

**Проблема:** Одна і та сама функція існує двічі. При зміні логіки треба міняти в двох місцях.

**Знайти:**
```bash
grep -n "extractShortName" src/App.jsx
```

**Дія:**
1. Залишити одну реалізацію — винести на рівень модуля (до першого `const` компонента)
2. Видалити дублікат
3. Перевірити що обидва місця використання посилаються на одну функцію

---

## ФІКС 5 — try/catch для analyzeImageWithVision

**Проблема:** Виклик `analyzeImageWithVision` всередині `FileReader.onload` не захищений зовнішнім try/catch. При помилці Vision API — тиша або blank page.

**Знайти:**
```bash
grep -n "analyzeImageWithVision\|FileReader\|onload" src/App.jsx | head -20
```

**Обгорнути виклик:**
```javascript
reader.onload = async () => {
  try {
    const result = await analyzeImageWithVision(base64);
    // ... існуючий код
  } catch (err) {
    console.error('Vision API error:', err);
    setQiResult('Не вдалось обробити зображення. Спробуйте ще раз.');
  }
};
```

---

## ФІКС 6 — Прибрати save_to_drive з HAIKU_SYSTEM_PROMPT (рядок ~446)

**Проблема:** Haiku рекомендує дію `save_to_drive` але в коді вона показує `systemAlert("ще не реалізовано")`. Невідповідність між промптом і кодом.

**Знайти:**
```bash
grep -n "save_to_drive\|create_drive_folder" src/App.jsx | head -20
```

**Дія:**
1. В `HAIKU_SYSTEM_PROMPT` — видалити згадку `save_to_drive` і `create_drive_folder`
2. `systemAlert` рядки залишити — вони захищають від випадкового виклику

---

## ФІКС 7 — Прибрати navigate_calendar / navigate_week з SONNET_CHAT_PROMPT QI

**Проблема:** QI агент знає про навігацію календаря але це не його зона — це зона дашборду. Агент може запропонувати дію яку не може виконати.

**Знайти:**
```bash
grep -n "navigate_calendar\|navigate_week" src/App.jsx | head -20
```

**Дія:**
1. В `SONNET_CHAT_PROMPT` — видалити `navigate_calendar` і `navigate_week` з переліку доступних дій
2. Обробники в дашборді — не чіпати

---

## ФІКС 8 — Принцип перевірки перед дією в SONNET_CHAT_PROMPT

**Проблема:** Агент виконує команди без звірки з реєстром. При суперечливих даних — робить щось не те мовчки.

**Знайти:**
```bash
grep -n "SONNET_CHAT_PROMPT" src/App.jsx | head -5
```

**Додати на початок SONNET_CHAT_PROMPT** (після першого рядка системного промпту):

```
Перед будь-якою дією — звір те що збираєшся зробити з тим що є в реєстрі.
Якщо є суперечність між вхідними даними і реальністю — повідом адвоката одним чітким питанням і чекай відповіді.
Не вигадуй і не обирай мовчки. Незворотні дії (видалення) — завжди підтверджуй.
```

---

## ПЕРЕВІРКА ПІСЛЯ ФІКСІВ

```bash
# Перевірити що немає залишків старих рядків:
grep -n "length > 20" src/App.jsx
grep -n "readImageAsBase64 called\|FileReader onload\|base64 length" src/App.jsx
grep -n "navigate_calendar\|navigate_week" src/App.jsx
grep -n "save_to_drive" src/App.jsx

# Перевірити що extractShortName одна:
grep -n "extractShortName" src/App.jsx
```

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "fix: QI точкові фікси — deadline null, PDF поріг, промпти, try/catch" && git push origin main
```

---

## ДОПИСАТИ В LESSONS.md ПІСЛЯ ВИКОНАННЯ

```
### [2026-04-11] QI точкові фікси
- update_deadline: deadline_date !== undefined замість truthy перевірки
- PDF Vision поріг: 20 → 50 символів
- extractShortName: одна функція на рівні модуля
- SONNET_CHAT_PROMPT: прибрати navigate_calendar/week — це зона дашборду
- HAIKU_SYSTEM_PROMPT: прибрати save_to_drive — не реалізовано
- Принцип перевірки: агент звіряє з реєстром перед дією
```
