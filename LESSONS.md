# LESSONS.md — Інституційна пам'ять розробки
# Legal BMS | АБ Левицького

## ЯК КОРИСТУВАТИСЬ

ВАЖЛИВО: цей файл — довідник при діагностиці, НЕ інструкція до дії.
НЕ змінювати код на основі записів без явного завдання в TASK.md.

КОЛИ звертатись:
- Перша спроба вирішити проблему не дала результату
- Бачиш схожий симптом але не знаєш причину
- Збираєшся робити merge або переписувати великий блок коду
- Щось "злетіло" після попереднього фіксу

КОЛИ НЕ звертатись:
- Прості зміни стилів
- Новий функціонал з нуля
- Очевидні правки одного поля

ЯК ПОПОВНЮЄТЬСЯ:
- Тільки за явною командою в TASK.md
- НЕ дописувати самостійно

---

## УРОКИ

### [2026-04-08] CaseDossier — правильна flex структура
**Компонент:** src/components/CaseDossier/index.jsx
**Кореневий:** position:fixed, zIndex:100, overflow:hidden
**Шапка:** flexShrink:0, zIndex:200, position:relative
**Робочий рядок:** flex:1, overflow:hidden, minHeight:0 (КРИТИЧНО)
**Панелі (контент/агент/QI):** position:relative (НЕ absolute)
**Розділювач:** position:relative, zIndex:10
**Агент і QI рендеряться як flex siblings — НЕ як overlay**
**Модалки:** zIndex:300 (вище шапки з 200)

---

### [2026-04-08] Після resizable panels зникають кнопки і QI
**Компонент:** src/components/CaseDossier/index.jsx
**Симптом:** Кнопки шапки зникають або ховаються при скролі. QI не видно. Агент на всіх вкладках.
**Причина:** Resizable panels змінюють stacking context. position:relative або transform на контейнері перекриває елементи вище.
**Правило:** Кореневий контейнер: position:fixed, overflow:hidden. Шапка: position:sticky, zIndex:100. Resizable контейнер: zIndex:1.
**Після будь-яких змін layout — перевіряти чекліст:**
1. Кнопка "← Реєстр" видима
2. Кнопка "Сховати агента" видима і працює
3. QI відкривається і видно
4. Вкладки переключаються
5. На не-overview вкладках агент закритий

---

### [2026-04-07] Агент досьє не передає історію в API
**Компонент:** src/components/CaseDossier/index.jsx
**Симптом:** Агент каже "не пам'ятаю попередніх розмов" — переписка візуально є але в API не передається
**Причина:** У fetch до api.anthropic.com в messages[] — тільки поточне повідомлення
**Рішення:**
```js
const historyForAPI = agentMessages
  .filter(m => m.role === 'user' || m.role === 'assistant')
  .slice(-10)
  .map(m => ({ role: m.role, content: m.content }));
const firstUserIdx = historyForAPI.findIndex(m => m.role === 'user');
const cleanHistory = firstUserIdx >= 0 ? historyForAPI.slice(firstUserIdx) : [];
messages: [...cleanHistory, { role: 'user', content: userMessage }]
```
**Правило:** API вимагає першим role:'user'. Перевіряти при будь-яких змінах fetch.
**Діагностика:** grep -B5 -A30 "fetch.*anthropic" src/components/CaseDossier/index.jsx

---

### [2026-04-06] Merge конфлікт — два варіанти коду в одному файлі
**Симптом:** Дублікати змінних, мертвий код після return, blank page
**Діагностика:** grep -n "<<<<<<\|>>>>>>\|=======" src/components/CaseDossier/index.jsx
**Правило:** Ніколи не залишати обидва варіанти. Вибрати один. Перевіряти після кожного merge.

---

### [2026-04-05] textarea в QI виштовхує кнопки за екран
**Компонент:** QI в src/App.jsx
**Симптом:** Кнопки ховаються за межі екрану на планшеті
**Правило:** textarea ЗАВЖДИ height:120px фіксована. НЕ flex:1, НЕ min-height. Кнопки поза scrollable div з flexShrink:0.

---

### [2026-04-05] Апостроф в українському тексті ламає JS
**Симптом:** Blank page без помилок
**Правило:** Весь україномовний текст — подвійні лапки або шаблонні рядки. Ніколи одинарні.

---

### [2026-04-05] Haiku плутається в чат-командах
**Правило:** Haiku — тільки аналіз документів і JSON. Sonnet — всі чат-команди і розмови з агентом. Не змішувати.
