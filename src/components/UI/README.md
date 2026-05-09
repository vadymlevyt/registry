# UI Components

Базові універсальні компоненти Legal BMS. Використовуються у всіх модулях. Усі компоненти черпають кольори/розміри/радіуси з `src/styles/tokens.css` — НЕ хардкодять. Якщо потрібен новий вигляд — додай новий проп або новий variant, не клади inline-стилі поверх компонента.

## Імпорт

```javascript
import { Button, Input, Select, Modal, Card } from '../UI';
// або з абсолютного шляху:
import { Button } from '@/components/UI';
```

Іконки — окремо через `@/components/UI/icons.js`:

```javascript
import { ChevronDown, Trash2, Star, ICON_SIZE } from '../UI/icons';
<Trash2 size={ICON_SIZE.sm} />
```

## Компоненти

### Button

Універсальна кнопка з 4 варіантами і 3 розмірами.

| Prop | Тип | Default | Опис |
|------|-----|---------|------|
| `variant` | `'primary' \| 'secondary' \| 'ghost' \| 'danger'` | `primary` | Вид кнопки |
| `size` | `'sm' \| 'md' \| 'lg'` | `md` | Розмір |
| `icon` | ReactNode | — | Іконка ліворуч від тексту |
| `iconRight` | ReactNode | — | Іконка праворуч |
| `loading` | boolean | `false` | Spinner + блокує клік |
| `disabled` | boolean | `false` | — |
| `fullWidth` | boolean | `false` | width: 100% |
| `type` | `'button' \| 'submit'` | `button` | Типи form-button (default `button` щоб не сабмітити випадково) |
| `onClick` | function | — | — |
| `className` | string | — | Додатковий клас (мерджиться з `ui-button*`) |

```jsx
<Button variant="primary" onClick={handleSave}>Зберегти</Button>

<Button variant="danger" icon={<Trash2 size={14} />} onClick={handleDelete}>
  Видалити
</Button>

<Button variant="ghost" size="sm" loading={saving}>...</Button>
```

### Input

Універсальне поле введення (text/number/date/email/search) або textarea (через `multiline`).

| Prop | Тип | Default | Опис |
|------|-----|---------|------|
| `type` | `'text' \| 'number' \| 'date' \| 'email' \| 'search'` | `text` | — |
| `value` | string | — | Контрольоване значення |
| `onChange` | `(value: string) => void` | — | Отримує **string**, не event |
| `placeholder`, `disabled`, `autoFocus` | — | — | — |
| `label` | string | — | Підпис над полем |
| `error` | string | — | Червона рамка + повідомлення під полем |
| `hint` | string | — | Підказка під полем (приховується якщо є `error`) |
| `icon` | ReactNode | — | Ліворуч від поля |
| `multiline` | boolean | `false` | Рендериться як `<textarea>` |
| `rows` | number | `4` | Рядків для textarea |

```jsx
<Input
  label="Email клієнта"
  type="email"
  value={email}
  onChange={setEmail}
  placeholder="example@gmail.com"
  error={emailError}
/>

<Input multiline rows={6} value={notes} onChange={setNotes} />
```

### Select

Native `<select>` обгорнутий стилізованою wrapper-обгорткою.

| Prop | Тип | Default | Опис |
|------|-----|---------|------|
| `value` | string | — | — |
| `onChange` | `(value: string) => void` | — | Отримує **string** |
| `options` | `[{value, label, disabled?}]` | `[]` | — |
| `placeholder` | string | — | Disabled `<option value="">` зверху |
| `label`, `error`, `hint`, `disabled` | — | — | Аналогічно Input |

```jsx
<Select
  label="Категорія"
  value={category}
  onChange={setCategory}
  options={[
    { value: 'pleading', label: 'Заява по суті' },
    { value: 'motion',   label: 'Клопотання' },
    { value: 'evidence', label: 'Докази' },
  ]}
  placeholder="Оберіть тип"
/>
```

### Modal

Фірмова модалка. Замінює `window.alert/confirm/prompt`. Сама не керує власним станом — `isOpen` контролюється зовні.

| Prop | Тип | Default | Опис |
|------|-----|---------|------|
| `isOpen` | boolean | — | Видимість |
| `onClose` | function | — | Викликається на × / backdrop / Escape |
| `title` | string | — | Заголовок |
| `size` | `'sm' \| 'md' \| 'lg'` | `md` | 400 / 600 / 900px |
| `actions` | ReactNode | — | Нижній ряд кнопок |
| `closeOnBackdrop` | boolean | `true` | — |
| `closeOnEscape` | boolean | `true` | — |

```jsx
<Modal
  isOpen={showConfirm}
  onClose={() => setShowConfirm(false)}
  title="Підтвердження видалення"
  size="sm"
  actions={
    <>
      <Button variant="ghost" onClick={() => setShowConfirm(false)}>Скасувати</Button>
      <Button variant="danger" onClick={handleDelete}>Видалити</Button>
    </>
  }
>
  Справу буде видалено остаточно. Цю дію неможливо відмінити.
</Modal>
```

### Card

Універсальний контейнер з опціональним hover-ефектом і кольоровим лівим бордюром (для маркування за провадженням).

| Prop | Тип | Default | Опис |
|------|-----|---------|------|
| `variant` | `'default' \| 'interactive'` | `default` | `interactive` додає cursor:pointer і hover |
| `onClick` | function | — | — |
| `leftBorderColor` | string (CSS color) | — | Кольоровий лівий бордюр (3px) |
| `className` | string | — | Додатковий клас |

```jsx
<Card>Простий контейнер з контентом</Card>

<Card variant="interactive" onClick={() => openDoc(doc)}>
  <div>{doc.icon} {doc.name}</div>
</Card>

<Card leftBorderColor="var(--color-proceeding-appeal)">
  Документ за апеляцією
</Card>
```

### Chip

Компактний елемент для тегів, фільтрів, статусів. Може бути клікабельним або статичним. Підтримує × кнопку для фільтрів.

| Prop | Тип | Default | Опис |
|------|-----|---------|------|
| `variant` | `'default' \| 'accent' \| 'success' \| 'warning' \| 'danger' \| 'proceeding'` | `default` | Колір/стиль |
| `size` | `'sm' \| 'md'` | `sm` | Розмір |
| `color` | string | — | Для `variant='proceeding'` — колір (CSS-змінна або hex) |
| `removable` | boolean | `false` | Показує × кнопку |
| `onRemove` | function | — | Обробник × |
| `onClick` | function | — | Робить chip клікабельним |
| `icon` | ReactNode | — | Іконка зліва |

```jsx
<Chip variant="success">active</Chip>

<Chip variant="proceeding" color="var(--color-proceeding-appeal)">Апеляція</Chip>

<Chip removable onRemove={() => removeFilter('кат:позов')}>
  кат: позов
</Chip>
```

### Toggle

Перемикач увімк/вимк (switch).

| Prop | Тип | Default | Опис |
|------|-----|---------|------|
| `checked` | boolean | `false` | — |
| `onChange` | `(newValue: boolean) => void` | — | — |
| `disabled` | boolean | `false` | — |
| `label` | string | — | Текст біля перемикача |
| `description` | string | — | Опис під label |
| `size` | `'sm' \| 'md'` | `md` | — |

```jsx
<Toggle
  checked={isVoiceEnabled}
  onChange={setIsVoiceEnabled}
  label="Голосовий ввід"
  description="Увімкнути диктування адресу справи"
/>
```

### Tabs

Горизонтальні вкладки (контрольований компонент).

| Prop | Тип | Default | Опис |
|------|-----|---------|------|
| `tabs` | `[{id, label, icon?, badge?, disabled?}]` | `[]` | Перелік |
| `activeId` | string | — | id активної вкладки |
| `onChange` | `(newId: string) => void` | — | — |
| `variant` | `'default' \| 'pills'` | `default` | Підкреслення / pill |
| `fullWidth` | boolean | `false` | Заповнити контейнер |

```jsx
<Tabs
  tabs={[
    { id: 'overview', label: 'Огляд' },
    { id: 'materials', label: 'Матеріали', badge: 24 },
    { id: 'work', label: 'Робота' },
    { id: 'canvas', label: 'Канва', disabled: true },
  ]}
  activeId={activeTab}
  onChange={setActiveTab}
/>
```

### Tooltip

Підказка при hover/focus. Wrapper-компонент.

| Prop | Тип | Default | Опис |
|------|-----|---------|------|
| `content` | string \| ReactNode | — | Текст підказки |
| `placement` | `'top' \| 'right' \| 'bottom' \| 'left'` | `top` | Позиція |
| `delay` | number | `500` | Затримка перед показом, ms |
| `disabled` | boolean | `false` | Не показувати |

```jsx
<Tooltip content="Документ потребує перегляду — невідомий тип">
  <span>⚠</span>
</Tooltip>

<Tooltip content="Видалити справу" placement="bottom" delay={300}>
  <Button variant="danger" icon={<Trash2 size={14} />} />
</Tooltip>
```

### Toast

Короткі статусні повідомлення які зʼявляються справа знизу і автоматично зникають. Викликаються імперативно через сервіс `toast`.

| Prop | Тип | Опис |
|------|-----|------|
| `variant` | `'success' \| 'error' \| 'warning' \| 'info'` | Колір/іконка |
| `title` | string | Коротко суть |
| `description` | string | Опис (опційно) |
| `action` | `{ label, onClick }` | Опційна кнопка дії (закриває toast після кліку) |
| `onDismiss` | function | Закриття × кнопкою |

**ToastContainer** — підключається на верхньому рівні App.jsx (вже зроблено). Toast'и викликаються через `toast.*` з будь-якого місця:

```javascript
import { toast } from '@/services/toast.js';

toast.success('Документ збережено');
toast.error('Не вдалось зберегти', {
  description: 'Перевірте підключення до Drive.',
  action: { label: 'Спробувати ще', onClick: () => retry() },
});

// З персистентним прогресом:
const id = toast.info('Обробка PDF...', { persistent: true });
// коли готово:
toast.dismiss(id);

// Зі словника:
import { messages } from '@/services/messages.js';
toast.show(messages.drive.saveFailed(filename), { onAction: () => retry() });
```

### Banner

Inline-попередження в межах секції. На відміну від Toast — не зникає автоматично.

| Prop | Тип | Default | Опис |
|------|-----|---------|------|
| `variant` | `'success' \| 'error' \| 'warning' \| 'info'` | `info` | — |
| `title` | string | — | Заголовок |
| `description` | string | — | Опис (опційно) |
| `actions` | `[{ label, onClick, variant? }]` | — | Кнопки дій |
| `dismissible` | boolean | `false` | Показати × кнопку |
| `onDismiss` | function | — | — |

```jsx
<Banner
  variant="warning"
  title="Drive не підключено"
  description="Підключіть Google Drive щоб зберігати документи."
  actions={[{ label: 'Підключити', onClick: connectDrive, variant: 'primary' }]}
/>
```

## Іконки (lucide-react)

Реекспорт у `icons.js` — додавай нові у міру потреби:

```jsx
import { ChevronDown, Trash2, Star, Pin, ICON_SIZE } from '../UI/icons';

<Trash2 size={ICON_SIZE.sm} color="var(--color-danger)" />
```

## Принципи

1. **Тільки CSS-змінні з `tokens.css`.** Жодних inline кольорів типу `#3b82f6` всередині компонентів.
2. **НЕ використовуй inline-стилі поверх компонентів** — додавай новий проп або новий variant.
3. **Тести обов'язкові** для кожного компонента. Перед коммітом — `npm test` зелений.
4. **SaaS-готовність:** палітру можна перевизначити через `tokens-tenant.css` після `tokens.css` — без перекомпіляції коду.
5. **Іменування CSS-класів:** BEM-style — `.ui-button`, `.ui-button--primary`, `.ui-button__icon`.
