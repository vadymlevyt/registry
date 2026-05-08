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
