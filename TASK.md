# TASK.md — LESSONS урок + рамка матеріалів + Document Processor v1
Дата: 08.04.2026

## СЕРЕДОВИЩЕ
Репо: github.com/vadymlevyt/registry
Компонент досьє: src/components/CaseDossier/index.jsx
Новий компонент: src/components/DocumentProcessor/index.jsx
Деплой: git add -A && git commit -m "..." && git push origin main

---

## КРОК 0 — ПРОЧИТАТИ LESSONS.md

```bash
cat LESSONS.md
```

---

## ЧАСТИНА 1 — ДОПИСАТИ УРОК В LESSONS.md

Дописати в кінець секції УРОКИ:

```
### [2026-04-08] Реєстр і досьє — батько і дитина, не паралельні сторінки
**Архітектурний принцип:**
Реєстр (список) і Досьє (розгорнута картка) — НЕ паралельні види.
Досьє — це розгорнута картка справи. Батько і дитина.
Коли дитина (досьє) відкрита — батько (реєстр) не рендерується.

**Правило в коді App.jsx:**
НЕПРАВИЛЬНО:
  <Registry ... />
  {dossierCase && <CaseDossier ... />}

ПРАВИЛЬНО:
  {dossierCase
    ? <CaseDossier ... />
    : currentView === 'registry' && <Registry ... />
  }

**Загальне правило:**
Будь-які два повноекранні види — завжди взаємовиключні через тернарний оператор.
```

---

## ЧАСТИНА 2 — РУХОМА РАМКА В МАТЕРІАЛАХ

**Компонент:** src/components/CaseDossier/index.jsx, вкладка Матеріали

**Симптом:** Ліва панель (дерево/список документів) має фіксовану ширину.

**Рішення:** Додати resizable межу між лівою панеллю (дерево) і правою (viewer).

Початкова ширина лівої панелі: 280px
Мінімум: 200px
Максимум: 50% ширини контейнера

```jsx
// State в CaseDossier
const [materialsTreeWidth, setMaterialsTreeWidth] = useState(280);

// Розділювач між деревом і viewer
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
  onMouseDown={(e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = materialsTreeWidth;
    const container = e.currentTarget.parentElement;
    const maxWidth = container.offsetWidth * 0.5;

    const onMove = (e) => {
      const delta = e.clientX - startX;
      const newWidth = Math.max(200, Math.min(maxWidth, startWidth + delta));
      setMaterialsTreeWidth(newWidth);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }}
  onTouchStart={(e) => {
    const startX = e.touches[0].clientX;
    const startWidth = materialsTreeWidth;
    const container = e.currentTarget.parentElement;
    const maxWidth = container.offsetWidth * 0.5;

    const onMove = (e) => {
      const delta = e.touches[0].clientX - startX;
      const newWidth = Math.max(200, Math.min(maxWidth, startWidth + delta));
      setMaterialsTreeWidth(newWidth);
    };
    const onUp = () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  }}
>
  <div style={{ width: 4, height: 40, borderRadius: 2, background: '#3a3d5a', pointerEvents: 'none' }} />
</div>
```

Ліва панель отримує: `width: materialsTreeWidth, flexShrink: 0`
Права панель (viewer): `flex: 1, minWidth: 0, overflowY: 'auto'`

---

## ЧАСТИНА 3 — DOCUMENT PROCESSOR v1

### Архітектура

Новий незалежний компонент: src/components/DocumentProcessor/index.jsx

Підключається як вкладка "🔧 Робота з документами" в CaseDossier.
Той самий компонент підключається у вкладці "Нова справа".
Може бути підключений куди завгодно — не залежить від батьківського контексту.

Отримує через props:
- caseData (опційно) — якщо є контекст конкретної справи
- cases[] — всі справи (для визначення до якої справи відносяться файли)
- onCreateCase — функція створення нової справи
- onNavigateToDossier(caseId) — перехід в досьє конкретної справи
- apiKey — Claude API ключ

### Інтерфейс компонента

Три зони:

**Зона 1 — Drop зона (зверху)**
```
┌─────────────────────────────────────────┐
│  ⬇ Перетягніть файли або натисніть      │
│  PDF, JPEG, PNG, HEIC, DOCX, XLSX,      │
│  PPTX, ZIP, MD, TXT, Google Doc         │
│  [Вибрати файли] [З Google Drive]       │
└─────────────────────────────────────────┘
```

**Зона 2 — Черга файлів (посередині)**
Список завантажених файлів з іконкою формату, назвою, розміром.
Статус кожного: очікує / обробляється / готово / помилка
Прогрес-бар для поточного файлу.

**Зона 3 — Чат з агентом (знизу)**
Агент коментує що робить в реальному часі.
Показує структуру деревом (текстово в чаті).
Поле вводу для команд.
Кнопки: [✓ Підтвердити структуру] [✎ Редагувати] [✕ Скасувати]

### Логіка обробки

**Крок 1 — Прийом файлів**
- Drag & drop або вибір через input
- ZIP: розпаковувати автоматично, .p7s/.asic зберігати в 01_ОРИГІНАЛИ
- Показати список всіх файлів в черзі

**Крок 2 — Визначення контексту**

Агент аналізує файли і визначає:

А) Файли належать поточній справі → повідомляє "Визначив X документів по справі [назва]"

Б) Файли належать ІНШІЙ існуючій справі → повідомляє:
"Ці матеріали схожі на справу [Корева]. Перейти туди з цими файлами?"
При підтвердженні → перехід в досьє Корева, файли передаються туди

В) Файли — нова справа → повідомляє:
"Це схоже на нову справу. Як продовжити?
• Створити нову справу і перейти в неї
• Продовжити тут"
Якщо "створити нову" → створює справу → після завершення обробки → автоматичний перехід в нове досьє

**Крок 3 — Обробка файлів**

Порогова логіка:
- До 20 файлів: обробка в реальному часі з прогресом
- Більше 20: фонова обробка пакетами по 10-15 файлів

Операції (в такому порядку):
1. Розпакування ZIP
2. Конвертація в PDF (JPEG/PNG/HEIC → PDF, DOCX/XLSX → PDF)
3. Нарізка: агент читає зміст і визначає межі окремих документів
4. Склейка: агент визначає що частини одного документа і з'єднує в правильній послідовності
5. Стиснення: максимальне без втрати читабельності для людини і AI

**Крок 4 — Структура і класифікація**

Агент аналізує оброблені документи і пропонує структуру в чаті:
```
📁 Справа Брановський 450/2275/25
├── 📁 01_ОРИГІНАЛИ/ (зберігаються незмінно)
│   ├── scan_001.jpg
│   └── docs.zip
├── 📁 02_ОБРОБЛЕНІ/
│   ├── 📁 Основне провадження/
│   │   ├── Позовна_заява_2023-03.pdf
│   │   ├── Відзив_2023-05.pdf
│   │   └── Ухвала_2023-07.pdf
│   └── 📁 Апеляція/
│       ├── Апеляційна_скарга_2024-01.pdf
│       └── Постанова_апел_суду_2024-06.pdf
└── 📁 03_ФРАГМЕНТИ/ (нерозпізнані частини)
    └── unknown_pages_3-7.pdf
```

Агент пояснює в чаті логіку кожного рішення.
Можна змінити будь-який елемент через чат або клікнувши на нього.

**Крок 5 — Підтвердження і виконання**

Кнопка [✓ Підтвердити структуру]:
- Створює папки на Google Drive (стандартна структура справи)
- Переміщує файли по папках
- Оновлює вкладку Матеріали в досьє
- Оновлює case_context.json

Після завершення:
- Якщо це поточна справа → залишається в досьє, вкладка Матеріали оновлена
- Якщо нова справа → автоматичний перехід в нове досьє

### Технічний стек

```
pdf-lib — нарізка і склейка PDF (вже є в package.json або додати)
browser-image-compression — стиснення зображень перед конвертацією
heic2any — конвертація HEIC (вже є)
JSZip — розпакування ZIP
Claude Vision API — читання сканів і фото
Claude API (Sonnet) — аналіз, класифікація, структурування
```

### Модель даних документа

```js
{
  id: string,
  originalName: string,
  originalFormat: string,
  processedName: string,       // перейменований за шаблоном
  processedPath: string,       // шлях в структурі справи
  driveId: string | null,
  category: 'pleading' | 'motion' | 'court_act' | 'evidence' | 'correspondence' | 'other',
  proceeding: 'main' | 'appeal' | 'cassation' | 'unknown',
  date: string | null,
  author: 'ours' | 'opponent' | 'court' | 'unknown',
  pageCount: number,
  compressed: boolean,
  originalPreserved: boolean,   // завжди true для 01_ОРИГІНАЛИ
  status: 'pending' | 'processing' | 'done' | 'error',
  agentNote: string,            // коментар агента про цей документ
}
```

### System prompt агента Document Processor

```
Ти — агент обробки документів для адвокатського бюро Левицького.
Твоя задача: прийняти сирі файли, обробити їх і організувати в чітку структуру.

Поточний контекст: {caseContext або "нова справа"}
Всі справи системи: {cases[] короткий список}

Правила:
1. ЗАВЖДИ зберігай оригінали в 01_ОРИГІНАЛИ — ніколи не видаляй і не змінюй
2. Визначай чи файли належать поточній справі, іншій існуючій або новій
3. Якщо файли не по цій справі — ОБОВ'ЯЗКОВО повідом і запропонуй перейти
4. Показуй структуру деревом в чаті перед виконанням
5. Пояснюй кожне рішення коротко
6. Якщо не впевнений — клади в 03_ФРАГМЕНТИ і повідом
7. Після підтвердження — виконуй точно те що погоджено

Формат структури в чаті — ASCII дерево з іконками папок і файлів.
Мова: українська.
```

---

## ПОРЯДОК ВИКОНАННЯ

1. Дописати урок в LESSONS.md
2. Рухома рамка в Матеріалах
3. Створити src/components/DocumentProcessor/index.jsx
4. Підключити як вкладку в CaseDossier (між Матеріали і Позиція)
5. Перевірити що компонент отримує правильні props

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "feat: document processor v1 + resizable materials panel" && git push origin main
```

## ЧЕКЛІСТ ПІСЛЯ ДЕПЛОЮ

- [ ] Урок в LESSONS.md дописано
- [ ] В Матеріалах ліва панель тягнеться до 50% ширини
- [ ] Вкладка "🔧 Робота з документами" з'явилась в досьє
- [ ] Drag & drop файлів працює
- [ ] Агент реагує на завантажені файли в чаті
- [ ] Агент визначає контекст (ця справа / інша / нова)
- [ ] Агент показує структуру деревом в чаті
- [ ] Кнопки Підтвердити / Редагувати / Скасувати присутні
