# Аудит дій і обробників в App.jsx

## Таблиця дій по модулях

### App.jsx (основний модуль)
| Назва в коді | Що робить | Параметри | В якому модулі живе |
|--------------|-----------|-----------|---------------------|
| addCase | Додає нову справу до реєстру | form (об'єкт з даними справи) | App.jsx |
| saveCaseEdit | Зберігає зміни після редагування справи | form (оновлені дані справи) | App.jsx |
| updateCase | Оновлює окреме поле справи | caseId, field, value | App.jsx |
| closeCase | Змінює статус справи на 'closed' | id (ідентифікатор справи) | App.jsx |
| restoreCase | Змінює статус справи на 'active' | id (ідентифікатор справи) | App.jsx |
| deleteCasePermanently | Видаляє справу назавжди, включаючи папку в Drive | caseItem (об'єкт справи) | App.jsx |
| addCalendarEvent | Додає подію до календаря | event (об'єкт події) | App.jsx |
| updateCalendarEvent | Оновлює подію календаря | eventId, updates | App.jsx |
| deleteCalendarEvent | Видаляє подію календаря | eventId | App.jsx |
| addNote | Додає нотатку | note (об'єкт нотатки) | App.jsx |
| deleteNote | Видаляє нотатку | noteId | App.jsx |
| updateNote | Оновлює нотатку | noteId, changes | App.jsx |
| pinNote | Прикріпляє/відкріпляє нотатку до справи | noteId, caseId | App.jsx |

### CaseDossier (модуль досьє справи)
| Назва в коді | Що робить | Параметри | В якому модулі живе |
|--------------|-----------|-----------|---------------------|
| handleAddProc | Додає нове провадження до справи | proc (об'єкт провадження) | CaseDossier/index.jsx |
| handleEditProc | Редагує провадження | procId, updates | CaseDossier/index.jsx |
| handleDeleteProc | Видаляє провадження | procId | CaseDossier/index.jsx |
| handleAddDoc | Додає документ до справи | doc (об'єкт документа) | CaseDossier/index.jsx |
| handleEditDoc | Редагує документ | docId, updates | CaseDossier/index.jsx |
| handleDeleteDoc | Видаляє документ | docId | CaseDossier/index.jsx |
| handleSaveIdea | Зберігає ідею для контенту | ideaText | CaseDossier/index.jsx |

### Dashboard (модуль панелі управління)
| Назва в коді | Що робить | Параметри | В якому модулі живе |
|--------------|-----------|-----------|---------------------|
| handleEventAdd | Додає подію до календаря | event | Dashboard/index.jsx |
| handleEventUpdate | Оновлює подію календаря | eventId, updates | Dashboard/index.jsx |
| handleEventDelete | Видаляє подію календаря | eventId | Dashboard/index.jsx |
| handleSlotDrag | Обробляє перетягування слотів часу | slotDrag контекст | Dashboard/index.jsx |

### DocumentProcessor (модуль обробки документів)
| Назва в коді | Що робить | Параметри | В якому модулі живе |
|--------------|-----------|-----------|---------------------|
| processDocument | Обробляє завантажений документ | file, context | DocumentProcessor/index.jsx |
| extractText | Витягує текст з документа | file | DocumentProcessor/index.jsx |
| analyzeWithAI | Аналізує документ за допомогою AI | text, context | DocumentProcessor/index.jsx |

### QuickInput (швидкий ввід)
| Назва в коді | Що робить | Параметри | В якому модулі живе |
|--------------|-----------|-----------|---------------------|
| executeAction | Виконує дію на основі аналізу документа | action, params | QuickInput (в App.jsx) |
| updateCaseDate | Оновлює дату засідання справи | caseName, date, time | QuickInput |
| updateDeadline | Встановлює дедлайн справи | caseName, date, type | QuickInput |
| createCase | Створює нову справу | caseData | QuickInput |
| saveNote | Зберігає нотатку | text, caseId | QuickInput |

## Питання 1 — Закриття і видалення справи (модуль Досьє)

В досьє є кнопка "Закрити" — при натисканні справа переходить в закриті справи. Звідти її можна або видалити або відновити.

**Закрити справу:**
- Функція: `closeCase(id)` в App.jsx
- Обробник: Викликається з `CaseModal` при натисканні кнопки "📦 Закрити справу"
- Що робить: Змінює поле `status` справи з 'active'/'paused' на 'closed'
- Код: `setCases(prev => prev.map(c => c.id === id ? { ...c, status: 'closed' } : c))`

**Видалити справу назавжди:**
- Функція: `deleteCasePermanently(caseItem)` в App.jsx
- Обробник: Викликається з `CaseModal` при натисканні кнопки "🗑 Видалити назавжди" (тільки для closed справ)
- Що робить: Видаляє справу з масиву cases, видаляє папку в Google Drive якщо є driveFolderId
- Код: Видаляє з localStorage та Drive, встановлює selected=null, dossierCase=null

**Відновити справу:**
- Функція: `restoreCase(id)` в App.jsx
- Обробник: Викликається з `CaseModal` при натисканні кнопки "↩ Відновити" (тільки для closed справ)
- Що робить: Змінює поле `status` справи з 'closed' на 'active'
- Код: `setCases(prev => prev.map(c => c.id === id ? { ...c, status: 'active' } : c))`

## Питання 2 — Дати засідань (всі модулі)

Дати засідань організовані як **масив об'єктів** в полі `hearings` кожної справи.

**Структура даних:**
```javascript
hearings: [
  {
    id: string,      // унікальний ідентифікатор
    date: string,    // YYYY-MM-DD
    time: string,    // HH:MM
    court: string,   // назва суду
    status: string,  // 'scheduled', 'completed', 'cancelled'
    notes: string    // нотатки
  }
]
```

**Збереження:**
- Зберігається в полі `hearings` об'єкта справи
- Масив може бути порожнім або містити кілька засідань
- Для відображення використовується найближче майбутнє засідання

**Зміна дат:**
- Через `updateCase(caseId, 'hearings', newHearingsArray)` в App.jsx
- Через QuickInput: `updateCaseDate` action
- В Dashboard: drag & drop в календарі
- В CaseDossier: редагування через форми

**Відображення в реєстрі справ:**
- Використовується функція `getNextHearing(c)` яка знаходить найближче заплановане засідання
- Відображається в `CaseCard` як "Засідання: [дата]"
- Відображається в календарі як події

**Розбіжності між модулями:**
- **App.jsx**: Використовує `getNextHearing` для відображення найближчого засідання
- **Dashboard**: Показує всі події календаря, включаючи засідання як окремі події
- **CaseDossier**: Показує всі засідання справи в списку, з можливістю редагування
- **Calendar**: Показує засідання як події на календарі, з фільтрацією по датах

Всі модулі працюють з тим самим масивом `hearings`, але відображають по-різному залежно від контексту.

## Питання 3 — Дублювання

**Дублювання обробки дат засідань:**
- Функція `getNextHearing(c)` реалізована в App.jsx (рядки 164-170)
- Аналогічна логіка вибору найближчого засідання дублюється в `getHearingDate(c)` і `getHearingTime(c)` (рядки 172-179)
- В Dashboard/index.jsx є своя логіка фільтрації подій по часу в `SlotsColumn`

**Дублювання обробки нотаток:**
- `saveNoteToStorage` в App.jsx (рядки 703-722) дублює логіку збереження нотаток
- Аналогічна логіка є в `addNote`, `updateNote`, `deleteNote` в App.jsx

**Дублювання роботи з календарем:**
- `addCalendarEvent`, `updateCalendarEvent`, `deleteCalendarEvent` в App.jsx
- Аналогічні функції `handleEventAdd`, `handleEventUpdate`, `handleEventDelete` в Dashboard/index.jsx

**Дублювання обробки документів:**
- Логіка витягу тексту з файлів реалізована в QuickInput (App.jsx) і в DocumentProcessor/index.jsx
- Аналіз документів з AI дублюється між QuickInput і DocumentProcessor

Найбільш критичне дублювання - це обробка дат засідань, де одна і та сама логіка вибору найближчого засідання реалізована в кількох місцях без централізації.
