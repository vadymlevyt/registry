# TASK 10.1 — Фікси Viewer + колапсування панелей + фірмова модалка додавання документа

**Дата формування:** 09.05.2026
**Фаза:** 1.6 — UI Reform (TASK 10 продовження)
**Виконавець:** Claude Code (Opus 4.7, 1M context)
**Орієнтовний обсяг:** 4-6 годин
**Передумови:** TASK 1-10 завершені і закомічені

---

## ВАЖЛИВО — ПРИНЦИП ВИКОНАННЯ

**Ти, я (адвокат) і Claude (асистент в адмін-чаті) — троє працюємо над цим.** Кожен бачить ситуацію по-різному:

- **Адвокат** бачить кінцевий результат на сайті, працює з системою щодня, відчуває де болить
- **Я (Claude в адмін-чаті)** проектую TASK як орієнтир, але можу не знати деталей реального коду. Мої описи — направляюча, не специфікація
- **Ти (Claude Code)** бачиш реальний код, реальні залежності, реальні обмеження

**Тому твоя робота не "виконати дослівно те що написано", а зрозуміти кінцеву мету і досягти її**. Якщо в моїх описах щось не сходиться з реальністю коду — ти краще знаєш як зробити правильно. Поясни в звіті відхилення і їх обґрунтування.

**Кінцева мета цього TASK** — щоб адвокат міг відкрити документ і реально з ним працювати: бачити PDF, перемикати Скан/Текст для сканованих, легко керувати простором (звужувати/розширювати панелі), і додавати нові документи через фірмову модалку без android-нативних елементів.

**Творчо, виважено, охайно.** Якщо знайдеш проблему якої я не передбачив — фіксуй разом з основною. Якщо знайдеш просте рішення кращого ніж я описав — використовуй його.

**Тести разом з кодом.** Кожна виправлена логіка повинна мати тест де можливо.

---

## АДАПТИВНІСТЬ

Адвокат працює переважно з планшета Lenovo Yoga Tab 13 (2160×1350) у landscape. Колапсування панелей особливо важливе для планшета — простір обмежений, треба вміти швидко розкривати/складати області інтерфейсу.

Цільові breakpoint'и:
- ≥1280px — повний layout (ліва панель + viewer + права панель)
- 768-1279px — колапсувати ліву за замовчуванням, виклик за стрілочкою
- <768px — повноекранний viewer, панелі як bottom drawer

Усе нове додавай із media queries з самого початку.

---

## КОНТЕКСТ — ТРИ ПРОБЛЕМИ ВИЯВЛЕНІ ПІСЛЯ TASK 10

### Проблема 1 — Документи не рендеряться у Viewer

**Симптоми (адвокат тестував):**

Сценарій А (справа Кісельова, документ 701_1413_25 кисельова ухвала.pdf, 44 КБ scanned):
- Шапка з кнопками 🔧 ✕ показується
- Метарядок (Судовий акт · Суд · 0 Б) показується (хоча 0 Б замість 44 КБ — окрема проблема, схоже size не зчитався з канонічної схеми)
- В тілі — empty state "Текст для цього документа ще не розпізнано" з кнопкою "Розпізнати зараз"
- Натиск на "Розпізнати зараз" → внизу тост "Розпізнавання..." → потім "Текст розпізнано" зелений
- АЛЕ на екрані нічого не змінюється — текст не з'являється

Сценарій Б (справа Брановський, додав сканований PDF з папки Drive):
- Той самий emptу state
- В папці 02_ОБРОБЛЕНІ є копія цього документа з обробкою
- Empty state не зникає

**Імовірні причини:**

1. **PDF.js логіка не працює.** ScanContent компонент у DocumentViewerContent.jsx створено в TASK 10, але реальна логіка рендерингу PDF могла бути не перенесена коректно зі старого Viewer'а в CaseDossier. Подивись через `git log src/components/CaseDossier/index.jsx` і знайди як рендерився PDF до TASK 10. Цей код працював на 19 справах — використовуй його як референс.

2. **`documentNature` не визначено.** На старих документах поле undefined → fallback на 'searchable' → одразу text mode → empty state поки тексту немає. Перемикача Скан/Текст немає бо документ не визначений як scanned. Потрібно автовизначення.

3. **Текст з 02_ОБРОБЛЕНІ не завантажується.** Або шукає в неправильній папці, або не нормалізує імена з NFC, або не оновлюється після reprocess. У 02_ОБРОБЛЕНІ за документом може лежати .md, .txt, або інший формат — треба перевірити що саме там і шукати правильно.

4. **Reprocess не оновлює UI.** Після завершення розпізнавання текст з'являється на Drive у 02_ОБРОБЛЕНІ, але DocumentViewerContent не перевантажує його. useEffect не реагує на завершення reprocess.

**Що зробити:**

Спочатку **діагностика**: відкрий справу Кісельова, документ ухвала.pdf, подивись у браузерному DevTools console — які помилки JS, які запити Drive API не вдаються. Можливо PDF.js завантажується але рендериться не там, або blob URL не створюється.

Потім **виправлення**:

- Знайти і **перенести PDF.js логіку зі старого Viewer'а** (через git log або grep по pdfjsLib, getDocument). Робота, яка працювала, треба перенести 1-в-1 у новий компонент.
- Додати **автовизначення documentNature** для старих документів. Алгоритм:
  - Якщо `documentNature` визначено — використати як є
  - Якщо undefined і файл .pdf — спробувати pdfjs.getPage(1).getTextContent(). Якщо текст порожній/менше 50 символів → 'scanned'. Інакше → 'searchable'
  - Якщо undefined і файл .png/.jpg/.heic → 'scanned'
  - Якщо undefined і файл .docx/.txt/.md → 'searchable'
  - Викликати `update_document(caseId, documentId, { documentNature: 'scanned' | 'searchable' })` щоб зберегти результат
  - Логіку винеси в окрему функцію `detectDocumentNature(document, blob)` у `src/services/`
- Виправити **завантаження тексту з 02_ОБРОБЛЕНІ**:
  - Шукати з NFC normalization імен (українські символи)
  - Шукати .md, потім .txt, потім .json (можливо там OCR результат)
  - Логувати в console.error деталі помилки
- Зробити **оновлення тексту після reprocess**:
  - При reprocess success у CaseDossier викликати `update_document` з полем `lastOcrAt: new Date().toISOString()`
  - В TextContent useEffect залежить від `document.lastOcrAt`
  - Зміна поля → re-render → перезавантаження тексту
- Виправити **size: 0 Б** — перевірити чому не зчитується. Можливо canonical schema поле називається інакше (`fileSize`?) або не заповнене на старих документах.

---

### Проблема 2 — Панелі не колапсуються

**Симптоми:**

На планшеті landscape з Дерево/Реєстр панеллю (~280px) + viewer + панель агента (~380px) — viewer стиснутий у вузьку центральну смугу. Особливо погано на портреті планшета і коли відкритий агент.

**Що адвокат хоче:**

1. **Кнопка-стрілочка ◀ на правому краю лівої панелі** — клік звужує панель до тонкої смужки (16-24px) з кнопкою ▶ для розширення назад. Стан в localStorage.

2. **Кнопка-стрілочка ▶ на лівому краю панелі агента** — аналогічно, ховає панель вправо.

3. **Автоматичне колапсування лівої при відкритті агента** — коли адвокат натискає "Агент" у шапці справи → відкривається права панель + ліва автоматично ховається. Якщо адвокат закриває агента — ліва повертається в попередній стан.

4. **Розширення дерева** — у вкладці Дерево (а не Реєстр) — додаткова кнопка "Розширити" біля заголовка. Клік розширює ліву панель до 50% ширини щоб побачити велике розгалужене дерево. Повторний клік повертає до стандартної ширини.

**Технічна реалізація:**

В CaseDossier додати state:
- `leftPanelCollapsed` (boolean) — стан колапсу лівої
- `agentPanelCollapsed` (boolean) — стан колапсу правої
- `treeExpanded` (boolean) — режим розширеного дерева (тільки для активної вкладки Дерево)

При зміні станів — зберігати в localStorage:
- `materials_left_panel_collapsed`
- `materials_agent_panel_collapsed`
- `materials_tree_expanded`

При відкритті агента (`onClick` кнопки Агент у шапці) — автоматично:
```javascript
const handleOpenAgent = () => {
  setAgentPanelCollapsed(false);
  setLeftPanelCollapsed(true);  // авто-ховання лівої
};
```

Layout через CSS Grid або Flex з динамічними ширинами і transition:
```css
.dossier-layout {
  display: grid;
  grid-template-columns: var(--left-width) 1fr var(--right-width);
  transition: grid-template-columns 0.2s ease;
}

/* Default state */
.dossier-layout {
  --left-width: 280px;
  --right-width: 380px;
}

.dossier-layout.left-collapsed {
  --left-width: 24px;
}

.dossier-layout.agent-collapsed {
  --right-width: 24px;
}

.dossier-layout.tree-expanded {
  --left-width: 50%;
}
```

**Адаптивність:**
- На <1024px ліва за замовчуванням collapsed
- На <768px ліва і права як bottom drawer

---

### Проблема 3 — Модалка додавання документа стара (native Android)

**Симптоми:**

Адвокат натискає "+ Додати документ" → відкривається модалка з полями (Тип, Провадження, Від кого, Файл). Але:
- Поле "Тип" — native HTML `<select>` яким керує Android (показує системну випадайку зі списком категорій)
- Кнопка "Вибрати файл" — native input file picker
- Загальний стиль модалки — старий, не з фірмових компонентів TASK 5-8
- Немає фірмових елементів Modal, Select, Button з UI/

**Що адвокат хоче:**

Модалка повністю на фірмових компонентах:
- Modal (з TASK 5)
- Поле Тип через Select компонент (з TASK 5) — наша випадайка з опціями, не native
- Поле Від кого через Select
- Поле Провадження через Select (опції з case.proceedings)
- Поля Назва документа, Дата — через Input
- Toggle "Позначити як ключовий" через Toggle (з TASK 6)
- Кнопки внизу через Button (Скасувати variant=secondary, Додати variant=primary)
- Завантаження файлу — через drag-n-drop зону або стилізовану кнопку

**Що зробити:**

Знайди в CaseDossier код модалки додавання документа (через grep по тексту "Додати документ" або "+ Додати"). Перепиши на фірмові компоненти.

Якщо ця модалка велика — винеси в окремий компонент `src/components/CaseDossier/AddDocumentModal.jsx`. Це покращення архітектури — CaseDossier і так перевантажений.

Структура:

```jsx
import { Modal, Input, Select, Toggle, Button } from '../UI';

export function AddDocumentModal({ isOpen, onClose, onSubmit, caseData }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState(null);
  const [author, setAuthor] = useState(null);
  const [procId, setProcId] = useState(caseData.proceedings?.[0]?.id);
  const [date, setDate] = useState('');
  const [isKey, setIsKey] = useState(false);
  const [file, setFile] = useState(null);
  
  const handleSubmit = () => {
    onSubmit({ name, category, author, procId, date, isKey, file });
  };
  
  const proceedingOptions = caseData.proceedings?.map(p => ({
    value: p.id,
    label: p.title
  })) || [];
  
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Додати документ"
      size="md"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>Скасувати</Button>
          <Button variant="primary" onClick={handleSubmit}>Додати документ</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <Input
          label="Назва документа"
          value={name}
          onChange={setName}
          placeholder="Наприклад: Позов про стягнення коштів"
        />
        
        <Select
          label="Тип документа"
          value={category}
          onChange={setCategory}
          options={CATEGORY_OPTIONS}
          placeholder="Оберіть тип"
        />
        
        <Select
          label="Від кого"
          value={author}
          onChange={setAuthor}
          options={AUTHOR_OPTIONS}
          placeholder="Оберіть автора"
        />
        
        <Select
          label="Провадження"
          value={procId}
          onChange={setProcId}
          options={proceedingOptions}
        />
        
        <Input
          label="Дата документа"
          type="date"
          value={date}
          onChange={setDate}
        />
        
        <Toggle
          label="Позначити як ключовий"
          description="Документ буде виділено зірочкою у списку"
          checked={isKey}
          onChange={setIsKey}
        />
        
        <FileUploadZone
          file={file}
          onChange={setFile}
        />
      </div>
    </Modal>
  );
}

const CATEGORY_OPTIONS = [
  { value: 'pleading', label: 'Позов' },
  { value: 'motion', label: 'Клопотання' },
  { value: 'court_act', label: 'Судовий акт' },
  { value: 'evidence', label: 'Доказ' },
  { value: 'contract', label: 'Договір' },
  { value: 'correspondence', label: 'Кореспонденція' },
  { value: 'identification', label: 'Документ особи' },
  { value: 'other', label: 'Інше' }
];

const AUTHOR_OPTIONS = [
  { value: 'ours', label: 'Наш' },
  { value: 'opponent', label: 'Опонент' },
  { value: 'court', label: 'Суд' },
  { value: 'third_party', label: 'Третя сторона' }
];
```

`FileUploadZone` — простий drag-n-drop або стилізована кнопка через Button + hidden input file. На мобільному — кнопка "Вибрати файл" має відкривати native picker (це нормально, тут ми не можемо обійти браузер).

**Перевірити:**
- При відкритті модалки тапнути на "Тип" → має з'явитись наша випадайка, не native Android
- На планшеті в landscape модалка не на повний екран, на мобільному — full-screen
- Усі поля валідуються (мінімум — назва обов'язкова)

---

## ЩО НЕ РОБИТИ В ЦЬОМУ TASK

- НЕ переписувати інші модалки (засідання, дедлайни, нотатки) — окремий TASK
- НЕ робити повну панель деталей документа (🔧) — це TASK 11 (inline редагування канонічних полів). У TASK 10.1 кнопка 🔧 лишається заглушкою з toast.info
- НЕ переробляти структуру всього CaseDossier — тільки точкові фікси

---

## ПРОБЛЕМА 4 — Кнопка видалення документа

**Адвокат:** "Я думаю окрема корзинка має бути від ключика — щоб зразу бачити що можна видалити".

Згоден. Видалення — окрема смислова дія, не "налаштування". Корзинка 🗑 окремо від ключика 🔧 правильно бо:
- Різна семантика (деталі vs прибрати)
- Видимість небезпечної дії (легше зробити свідомо, важче випадково)
- Менше кліків для частої операції
- Стандарт UX — видалення завжди окрема кнопка з відстанню

### Що зробити

**Розташування в шапці Viewer'а:**

Праворуч від назви документа порядок (зліва направо):
```
⭐ Ключовий   |   🔧 Деталі   🗑 Видалити   ✕ Закрити
```

З візуальним розділювачем між ⭐ і блоком кнопок-дій. Корзинка з відступом, на hover червоніє (`var(--color-danger)`).

**Іконка:** `Trash2` з lucide-react.

**Tooltip:** "Видалити документ".

### Модалка видалення з двома режимами

Логіка вже існує (з TASK 2 ACTIONS, UI_ONLY через `_fromUI`). Робимо тільки UI — фірмова Modal з вибором режиму.

**Дві опції замість трьох** (третя `registry_only` плутала адвоката, прибираємо):

```jsx
import { Modal, Button } from '../UI';
import { Trash2, Archive } from 'lucide-react';

export function DeleteDocumentModal({ isOpen, document, onClose, onDelete }) {
  const [mode, setMode] = useState('archive');  // за замовчуванням найменш руйнівний
  
  const handleSubmit = () => {
    onDelete(document.id, mode);
    onClose();
  };
  
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Видалити документ"
      size="md"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>Скасувати</Button>
          <Button 
            variant={mode === 'full' ? 'danger' : 'primary'}
            onClick={handleSubmit}
          >
            {mode === 'full' ? 'Видалити повністю' : 'Архівувати'}
          </Button>
        </>
      }
    >
      <div style={{ marginBottom: 'var(--space-4)' }}>
        Документ <strong>"{document.name}"</strong>
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <DeleteOption
          mode="archive"
          selected={mode === 'archive'}
          onSelect={() => setMode('archive')}
          icon={<Archive size={20} />}
          title="Архівувати документ"
          description="Документ зникне зі списку матеріалів справи, але потрапить в окремий список «Архів». Файл на Drive залишиться. У будь-який момент можна відкрити архів і відновити документ — він знову з'явиться у списку. Корисно якщо документ більше не актуальний, але викидати завчасно."
          variant="info"
        />
        
        <DeleteOption
          mode="full"
          selected={mode === 'full'}
          onSelect={() => setMode('full')}
          icon={<Trash2 size={20} />}
          title="Видалити повністю"
          description="Документ зникне зі списку справи І сам файл буде видалено з Drive. Після цього файл буде неможливо відновити — ні з реєстру, ні з Drive. Корисно якщо документ помилковий, дублікат, або більше не потрібен взагалі."
          variant="danger"
        />
      </div>
    </Modal>
  );
}

function DeleteOption({ selected, onSelect, icon, title, description, variant }) {
  return (
    <button
      className={`delete-option delete-option--${variant} ${selected ? 'is-selected' : ''}`}
      onClick={onSelect}
    >
      <div className="delete-option__icon">{icon}</div>
      <div className="delete-option__content">
        <div className="delete-option__title">{title}</div>
        <div className="delete-option__description">{description}</div>
      </div>
      <div className="delete-option__radio">
        {selected ? '◉' : '○'}
      </div>
    </button>
  );
}
```

CSS для `delete-option`:
- Default — bordered card, при hover виділяється
- Selected — підсвічений border-color відповідного variant (info/warning/danger)
- Радіо-індикатор справа

### Інтеграція в Viewer

В DocumentViewerHeader додати кнопку:

```jsx
<Tooltip content="Видалити документ">
  <button
    className="document-viewer__icon-button document-viewer__icon-button--danger"
    onClick={onDelete}
    aria-label="Видалити"
  >
    <Trash2 size={ICON_SIZE.md} />
  </button>
</Tooltip>
```

CSS:
```css
.document-viewer__icon-button--danger:hover {
  color: var(--color-danger);
  background: rgba(239, 68, 68, 0.08);
}
```

В DocumentViewer передати prop `onDelete`:

```jsx
<DocumentViewer
  document={selectedDoc}
  // ...
  onDelete={() => setDeleteModalOpen(true)}
/>

<DeleteDocumentModal
  isOpen={deleteModalOpen}
  document={selectedDoc}
  onClose={() => setDeleteModalOpen(false)}
  onDelete={(docId, mode) => {
    executeAction('dossier_agent', 'delete_document', {
      caseId: caseData.id,
      documentId: docId,
      mode,
      _fromUI: true  // важливо! UI-only ACTION
    });
    setSelectedDocId(null);  // закрити Viewer після видалення
  }}
/>
```

### Тести

Додати тести:
- DeleteDocumentModal рендерить дві опції
- Активний режим за замовчуванням — archive
- Submit викликає onDelete з правильним mode (archive або full)
- Кнопка submit червоніє при варіанті "повністю"

---

## ПРОБЛЕМА 5 — Доступ до архіву документів з batch-операціями

Якщо адвокат заархівує документ — треба мати спосіб **побачити архів** і **відновити документи**. Інакше архівування втрачає сенс — це фактично м'яке видалення без можливості повернути через UI.

Потрібні **три способи відновлення**:
- Один документ (через кнопку на картці)
- Кілька обраних (checkbox-ами + дія над виділенням)
- Всі архівні одразу (одна кнопка)

### UI режиму "Архів"

**У Реєстрі/Дереві матеріалів** — кнопка-toggle **"Архів"** з лічильником у правому верхньому куті списку. Іконка `Archive` з lucide.

```
┌─ Матеріали ─────────────────────────────────────────┐
│ [Дерево] [Реєстр]                  [📦 Архів (5)]   │
│                                                      │
│ + Додати документ                                    │
│                                                      │
│ ... звичайний список матеріалів ...                  │
└──────────────────────────────────────────────────────┘
```

**При кліку на "Архів"** список перемикається в режим архіву:

```
┌─ Архів матеріалів ──────────────────────────────────┐
│ ← Повернутись до матеріалів                          │
│                                                      │
│ [Відновити всі (5)]  [Видалити всі (5)]              │
│                                                      │
│ ☐ Виділити всі                                       │
│ ──────────────────────────────────────               │
│ ☐ 📄 Позов початковий          [Відновити] [🗑]      │
│ ☐ 📄 Стара версія договору     [Відновити] [🗑]      │
│ ☑ 📄 Чорновик клопотання       [Відновити] [🗑]      │
│ ☑ 📄 Зайвий лист               [Відновити] [🗑]      │
│ ☐ 📄 Дублікат позову           [Відновити] [🗑]      │
│                                                      │
│ Виділено: 2 з 5                                      │
│ [Відновити обрані (2)]  [Видалити обрані (2)]        │
└──────────────────────────────────────────────────────┘
```

**Поведінка:**

- Картки архівних документів — приглушений вигляд (opacity 0.7) з міткою "архівний"
- **Картки в архіві НЕ відкриваються у Viewer'і.** Архів — окремий простір для роботи з архівними документами, а не для перегляду їх вмісту. Якщо адвокату треба переглянути архівний документ — спочатку відновлює його, потім працює як зі звичайним.
- Кожна картка в архіві має checkbox зліва і **дві кнопки справа**:
  - **"Відновити"** — повертає документ в активний список (`update_document` з `status: 'active'`)
  - **🗑** — видаляє назавжди (модалка-підтвердження → повне видалення: реєстр + 02_ОБРОБЛЕНІ + 01_ОРИГІНАЛИ на Drive)
- Згори списку — **дві основні кнопки** для всіх:
  - **"Відновити всі (N)"** — підтвердження → batch update → exit archive mode
  - **"Видалити всі (N)"** — підтвердження "Видалити назавжди всі N документів?" → batch delete з mode: 'full'
- Якщо є виділені — внизу з'являється bottom bar з діями над виділенням:
  - **"Відновити обрані (N)"** — батч `update_document`
  - **"Видалити обрані (N)"** — підтвердження → батч `delete_document` з mode: 'full'

**Повернення в звичайний режим:**
- Кнопка "← Повернутись до матеріалів" зверху
- Або повторний клік на "Архів"
- Виділення скидається при виході

### Уточнення про "Видалити повністю"

`delete_document` з `mode: 'full'` означає **повне фізичне знищення документа з усіх місць**:

- Запис документа видаляється з `case.documents[]` у registry
- Файл видаляється з `01_ОРИГІНАЛИ` на Drive
- Текстова копія видаляється з `02_ОБРОБЛЕНІ` на Drive (.md, .txt або інший формат)
- Якщо є запис у `documentsExtended` (TASK 1) — теж видаляється
- Якщо документ був у `case.proceedings[].documentIds` (якщо така структура є) — видаляється звідти

**Один ефект — два сценарії використання:**

1. З Viewer'а активного документа: відкрив документ → корзинка 🗑 → обрав "Видалити повністю" → документ зникає звідусіль
2. З Архіву: документ був заархівований раніше → клік 🗑 на картці в архіві (або batch) → документ зникає звідусіль

В обох випадках виконується той самий ACTION з тим самим mode. Просто з різних точок UI.

### Розмежування Viewer і Архів

**Viewer** — робочий простір для **активних** документів. Адвокат відкриває документ, читає, редагує метадані, обговорює з агентом. Корзинка в шапці пропонує:
- Архівувати (тимчасово прибрати, файл лишається в системі)
- Видалити повністю (фізично знищити)

**Архів** — окремий простір для **архівних** документів. Не для перегляду вмісту, а для управління архівом:
- Відновити (повернути в активний список)
- Видалити повністю (остаточно знищити)

Якщо адвокат хоче переглянути вміст архівного документа — спочатку **відновлює** його з архіву, документ стає активним, потім відкриває у Viewer'і.

---

В CaseDossier додати state:
- `showArchived` (boolean) — режим перегляду архіву
- `selectedArchivedIds` (Set<string>) — виділені для batch операцій

Фільтрація списку:
```javascript
const visibleDocuments = caseData.documents.filter(d => 
  showArchived ? d.status === 'archived' : d.status !== 'archived'
);

const archivedCount = caseData.documents.filter(d => d.status === 'archived').length;
```

Toggle "Архів":
```jsx
<Button
  variant={showArchived ? 'primary' : 'ghost'}
  size="sm"
  icon={<Archive size={ICON_SIZE.sm} />}
  onClick={() => {
    setShowArchived(!showArchived);
    setSelectedArchivedIds(new Set());  // скинути виділення при виході
  }}
>
  Архів ({archivedCount})
</Button>
```

Кнопки batch-операцій (з'являються коли `showArchived === true`):
```jsx
{showArchived && (
  <div className="archive-controls">
    <Button
      variant="primary"
      icon={<ArchiveRestore size={ICON_SIZE.sm} />}
      onClick={() => restoreAll(archivedDocuments)}
    >
      Відновити всі ({archivedCount})
    </Button>
    
    <Checkbox
      checked={selectedArchivedIds.size === archivedCount}
      onChange={(checked) => {
        if (checked) {
          setSelectedArchivedIds(new Set(archivedDocuments.map(d => d.id)));
        } else {
          setSelectedArchivedIds(new Set());
        }
      }}
      label="Виділити всі"
    />
  </div>
)}
```

Картка документа в архіві:
```jsx
{showArchived && (
  <div className="archive-card">
    <Checkbox
      checked={selectedArchivedIds.has(doc.id)}
      onChange={(checked) => toggleSelected(doc.id, checked)}
    />
    <div className="archive-card__content">
      {/* існуючий рендер картки */}
    </div>
    <Button
      variant="secondary"
      size="sm"
      icon={<ArchiveRestore size={ICON_SIZE.sm} />}
      onClick={() => restoreDocument(doc.id)}
    >
      Відновити
    </Button>
  </div>
)}
```

Bottom bar з batch-діями (з'являється коли є виділені):
```jsx
{showArchived && selectedArchivedIds.size > 0 && (
  <div className="archive-batch-bar">
    <span>Виділено: {selectedArchivedIds.size} з {archivedCount}</span>
    <Button
      variant="primary"
      icon={<ArchiveRestore size={ICON_SIZE.sm} />}
      onClick={() => restoreSelected()}
    >
      Відновити обрані ({selectedArchivedIds.size})
    </Button>
    <Button
      variant="danger"
      icon={<Trash2 size={ICON_SIZE.sm} />}
      onClick={() => deleteSelected()}
    >
      Видалити обрані ({selectedArchivedIds.size})
    </Button>
  </div>
)}
```

### Checkbox компонент

Якщо в UI/ ще немає Checkbox компонента — створи мінімальний (схоже на Toggle але прямокутний, з ✓):

```jsx
// src/components/UI/Checkbox.jsx
import { Check } from 'lucide-react';
import './Checkbox.css';

export function Checkbox({ checked, onChange, label, disabled, ...rest }) {
  return (
    <label className={`ui-checkbox ${checked ? 'is-checked' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange?.(e.target.checked)}
        disabled={disabled}
        className="ui-checkbox__input"
      />
      <span className="ui-checkbox__box">
        {checked && <Check size={12} />}
      </span>
      {label && <span className="ui-checkbox__label">{label}</span>}
    </label>
  );
}
```

### Підтвердження для масових дій

Для "Відновити всі" і "Видалити всі/обрані" — використовувати `systemConfirm`:

```javascript
const restoreAll = async () => {
  const confirmed = await systemConfirm(
    `Відновити всі ${archivedCount} документів з архіву?`,
    { confirmLabel: 'Відновити всі', confirmVariant: 'primary' }
  );
  if (!confirmed) return;
  
  // batch update — виконати update_document для кожного
  for (const doc of archivedDocuments) {
    await executeAction('dossier_agent', 'update_document', {
      caseId: caseData.id,
      documentId: doc.id,
      fields: { status: 'active' },
      _fromUI: true
    });
  }
  
  toast.success(`${archivedCount} документів відновлено`);
  setShowArchived(false);  // вийти з режиму архіву
};
```

### Тести

- showArchived toggle перемикає список
- Лічильник правильний
- Restore (один) викликає update_document з status: 'active'
- Restore all — підтвердження → batch update → exit archive mode
- Restore selected — batch update тільки для обраних
- Delete selected/all — модалка з confirmation → batch delete з mode: 'full'
- Виділення скидається при виході з архіву
- "Виділити всі" checkbox синхронізується з реальним станом (всі/частково/нічого)

---

## ТЕСТИ

Створи тести де можливо:

1. **PDF rendering tests** — складно тестувати без реального PDF, але можна:
   - DocumentViewer з документом scanned і defined documentNature → ScanContent рендериться
   - DocumentViewer з searchable → одразу TextContent
   - DocumentViewer з undefined documentNature → triggers detection

2. **Collapsible panels tests:**
   - state колапсу зберігається в localStorage
   - Відкриття агента триггерить колапс лівої панелі
   - Перемикач tree expand змінює ширину

3. **AddDocumentModal tests:**
   - Рендер усіх полів
   - Submit викликає onSubmit з правильними даними
   - Валідація (назва обов'язкова)
   - Cancel закриває без submit

---

## ОЧІКУВАНІ АРТЕФАКТИ ВИКОНАННЯ

Створи **детальний** файл звіту `report_task10_1.md` у корені репо.

Адвокат явно просить детальний звіт — він допомагає мені (Claude в адмін-чаті) точніше планувати наступні TASK. Тому в звіті:

**1. Резюме TASK 10.1** — один абзац про вирішені проблеми

**2. Діагностика проблеми 1 (PDF rendering)**
- Що ти знайшов у git history до TASK 10 (як працювала стара логіка)
- Що було не так у TASK 10 ScanContent (заглушка / помилкова логіка / невірні props)
- Які файли і рядки виправив
- Чи працює тепер на справі Кісельова і Брановський
- documentNature autodetect — як реалізував

**3. Реалізація колапсування панелей**
- Файли змінено з діапазонами рядків
- localStorage ключі
- CSS Grid / Flex реалізація
- Як працює авто-колапс при відкритті агента

**4. AddDocumentModal**
- Розташування файлу
- Які компоненти UI використано
- Стара модалка видалена / залишена як fallback
- Як перевіряв що native Android select не використовується

**5. Створені файли** — таблиця

**6. Змінені файли** — діапазони

**7. Видалені файли**

**8. Тести і покриття**

**9. Знахідки** — discovered_issues_during_task10_1.md якщо є

**10. Білд + push**

### Пояснення в термінал для адвоката

Стиль як родичу. Без термінів "PDF.js", "useEffect", "CSS Grid".

Приблизний тон:

> Я виправив три проблеми які ти знайшов у попередньому Viewer'і:
>
> 1. **Документи нарешті рендеряться** — у попередньому TASK 10 я залишив заглушку для рендерингу PDF замість того щоб перенести робочу логіку з минулого Viewer'а. Тепер переніс правильно. На справі Кісельова і Брановський PDF документи відкриваються нормально.
>
> 2. **Панелі тепер колапсуються** — на правому краю лівої панелі є стрілочка ◀, клік ховає панель. На лівому краю агента є стрілочка ▶, клік ховає його. Коли натискаєш "Агент" у шапці — ліва панель автоматично ховається щоб дати документу більше місця. Стан запам'ятовується.
>
> 3. **Модалка додавання документа тепер фірмова** — раніше при кліку на тип документа з'являлась стандартна android-випадайка з системних елементів. Тепер всюди наші компоненти у єдиному стилі.
>
> Чи все працює: тести зелені, білд чистий.
>
> Що тобі зробити: спробуй відкрити справу Кісельова, документ ухвала.pdf — має показуватись. Спробуй кнопку "Агент" — ліва панель має сховатись автоматично. Спробуй "+ Додати документ" — побачиш фірмову модалку без android-елементів.
>
> Деталі — у `report_task10_1.md`.

---

## КОМІТ І ПУШ

```bash
git commit -m "fix: TASK 10.1 — fix PDF rendering in DocumentViewer + add collapsible panels with auto-collapse on agent open + replace native add-document modal with branded UI components"
git push origin main
```

GitHub Actions запустить тести → якщо зелено → деплой.

---

## ПРИКІНЦЕВЕ

Це TASK з трьох різних проблем — пам'ятай що головна (Проблема 1, PDF rendering) важливіша за інші дві. Якщо щось не вийде з модалкою додавання документа в обмежений час — фіксуй у `discovered_issues_during_task10_1.md` для окремого TASK, але PDF rendering має працювати після цього TASK обов'язково.

**Кінцева мета** — адвокат відкриває справу і реально працює з документами. Якщо після TASK 10.1 адвокат каже "тепер документи відкриваються і панелі гнучкі" — TASK успішний.

Не вважай TASK дзвоном з небес. Адаптуйся до реальності коду.

---

**Кінець TASK 10.1.**
