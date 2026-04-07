# TASK.md — Фікс z-index після resizable panels + LESSONS.md
Дата: 08.04.2026

## СЕРЕДОВИЩЕ
Репо: github.com/vadymlevyt/registry
Деплой: git add -A && git commit -m "..." && git push origin main
Перевірка: git log --oneline -3

---

## ОБОВ'ЯЗКОВО ПЕРЕД ПОЧАТКОМ — ПРОЧИТАТИ LESSONS.md

```bash
cat LESSONS.md
```

---

## ДІАГНОСТИКА СПОЧАТКУ

```bash
# 1. Останні коміти
git log --oneline -5

# 2. z-index в CaseDossier
grep -n "zIndex\|z-index\|position" src/components/CaseDossier/index.jsx | head -40

# 3. z-index в App.jsx
grep -n "zIndex\|z-index\|position.*fixed\|position.*absolute" src/App.jsx | head -40
```

Показати результати перед змінами.

---

## БАГ 1 — КНОПКИ ДОСЬЄ ХОВАЮТЬСЯ ЗА ШАРАМИ

**Симптом:** Кнопка "← Реєстр", "Сховати агента", вкладки — зникли або з'являються тільки при скролі.

**Причина:** Resizable panels додали position:relative або transform що створило новий stacking context і перекрив шапку.

**Рішення:**

Кореневий контейнер CaseDossier:
```jsx
{
  position: 'fixed',
  top: 0, left: 0, right: 0, bottom: 0,
  zIndex: 50,
  background: '#0d0f1a',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}
```

Шапка (заголовок + кнопки + вкладки):
```jsx
{
  position: 'sticky',
  top: 0,
  zIndex: 100,
  background: '#0d0f1a',
  flexShrink: 0,
}
```

Resizable контейнер (flex row з панелями):
```jsx
{
  flex: 1,
  display: 'flex',
  overflow: 'hidden',
  position: 'relative',
  zIndex: 1,
}
```

---

## БАГ 2 — QI НЕ ВИДНО ПІСЛЯ ВІДКРИТТЯ

**Симптом:** Клавіатура з'являється але QI не видно — ніби під контентом.

**Рішення:**

QI sidebar:
```jsx
{
  width: qiWidth,
  minWidth: 280,
  maxWidth: 480,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  borderLeft: '1px solid #2a2d3e',
  // НЕ position:absolute, НЕ transform
}
```

---

## БАГ 3 — АГЕНТ ВІДКРИТИЙ НА ВСІХ ВКЛАДКАХ, КНОПКА TOGGLE ЗНИКЛА

**Діагностика:**
```bash
grep -n "showAgent\|setShowAgent\|Сховати агента" src/components/CaseDossier/index.jsx
```

**Відновити якщо зникло:**
```jsx
const [showAgent, setShowAgent] = useState(activeTab === 'overview');

useEffect(() => {
  setShowAgent(activeTab === 'overview');
}, [activeTab]);

// Кнопка
<button onClick={() => setShowAgent(!showAgent)}>
  {showAgent ? '🤖 Сховати агента' : '🤖 Показати агента'}
</button>

// Рендер агента тільки якщо showAgent
{showAgent && <AgentPanel ... />}
```

---

## БАГ 4 — РОЗДІЛЮВАЧ ПЕРЕКРИВАЄ КОНТЕНТ

**Рішення:**
```jsx
<div style={{
  width: 8,
  flexShrink: 0,
  background: '#1a1d2e',
  cursor: 'col-resize',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 2,
  position: 'relative',
}} onMouseDown={handleResizeStart} onTouchStart={handleResizeTouchStart}>
  <div style={{
    width: 4, height: 40,
    borderRadius: 2,
    background: '#3a3d5a',
    pointerEvents: 'none',
  }} />
</div>
```

---

## ПОРЯДОК ВИКОНАННЯ

1. Діагностика grep (показати результати)
2. Фікс кореневого контейнера
3. Фікс шапки
4. Фікс QI sidebar
5. Відновити toggle агента
6. Перевірити розділювачі
7. Створити LESSONS.md
8. Оновити CLAUDE.md

---

## СТВОРИТИ ФАЙЛ LESSONS.md В КОРЕНІ РЕПО

```markdown
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
```

---

## ОНОВИТИ CLAUDE.md — ДОДАТИ СЕКЦІЮ

Додати після секції "КРИТИЧНЕ ПРАВИЛО №1":

```markdown
## LESSONS.md — ІНСТИТУЦІЙНА ПАМ'ЯТЬ

Файл LESSONS.md в корені репо містить уроки з попередніх сесій.

Звертатись ТІЛЬКИ коли:
- Перша спроба не дала результату
- Бачиш схожий симптом але не знаєш причину
- Збираєшся робити merge або переписувати великий блок
- Щось зникло після попереднього фіксу

Читати: cat LESSONS.md
НЕ змінювати код на основі LESSONS.md без явного завдання в TASK.md.
```

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "fix: dossier z-index after resizable panels, add LESSONS.md" && git push origin main
```

## ЧЕКЛІСТ ПІСЛЯ ДЕПЛОЮ

- [ ] Кнопка "← Реєстр" видима
- [ ] Кнопка "Сховати агента" видима і працює
- [ ] QI відкривається і видно повністю
- [ ] Вкладки переключаються
- [ ] На Матеріалах/Позиції агент закритий за замовчуванням
- [ ] Рухомі межі працюють
- [ ] LESSONS.md є в репо (cat LESSONS.md)
- [ ] CLAUDE.md оновлено
