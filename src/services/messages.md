# Стандартні повідомлення системи (`messages.js`)

## Призначення

Централізоване місце для текстів повідомлень користувачу. Замість inline-рядків — використовуй `messages.<категорія>.<подія>`.

Це готує систему до:
- **Локалізації** (один файл перекладається замість сотень рядків).
- **Редактури тонів** (один раз змінив фразу — зміна всюди).
- **Узгодженості** (схожі ситуації мають схоже формулювання).

## Принципи

1. **Без технічного жаргону.** Замість «HTTP 429» → «Забагато запитів».
2. **Структура повідомлення:** `title` (3-5 слів) + опційний `description` (1-2 речення) + опційний `action` (кнопка вирішення).
3. **Українська мова.** Всі тексти українською.
4. **Параметризовані функції** для динамічних значень (filename, caseName).
5. **variant** — `success` / `error` / `warning` / `info` — впливає на колір toast/banner.

## Як використовувати

### З toast

```javascript
import { toast } from '@/services/toast.js';
import { messages } from '@/services/messages.js';

// Найпростіше — toast.show з готового шаблону:
toast.show(messages.drive.saveFailed(filename), {
  onAction: () => retry(filename),
});

// Або точково:
toast.error(messages.api.networkError().title, {
  description: messages.api.networkError().description,
});
```

### З Banner

```jsx
import { Banner } from '@/components/UI';
import { messages } from '@/services/messages.js';

const m = messages.drive.notConnected();
return (
  <Banner
    variant={m.variant}
    title={m.title}
    description={m.description}
    actions={[{ label: m.action.label, onClick: connectDrive }]}
  />
);
```

## Як додавати нові повідомлення

1. Знайди відповідну категорію (`drive`, `api`, `documents`, ...) або додай нову.
2. Назви ключ за дією: `saveFailed`, `tokenExpired`, `deleteWarning`.
3. Якщо параметри — функція з аргументами:
   ```javascript
   uploadFailed: (filename) => ({
     variant: 'error',
     title: filename ? `Не вдалось додати «${filename}»` : 'Не вдалось додати файл',
     description: 'Перевірте розмір і формат.',
   })
   ```
4. Без параметрів — теж функція (для уніфікації API):
   ```javascript
   saved: () => ({ variant: 'success', title: 'Збережено' })
   ```
5. Перевір що тест `tests/integration/messages.test.js` зелений — він перевіряє відсутність технічного жаргону і коректність структури.

## Технічні деталі — НЕ для адвоката

`err.message`, HTTP-коди, stack traces — **НЕ потрапляють** у `title` чи `description`. Вони йдуть у `console.error` для розробника. Адвокат бачить дружню фразу з пропозицією дії; розробник у devtools бачить техдеталі.

Приклад правильного pattern:

```javascript
try {
  await saveToDrive(data);
  toast.show(messages.drive.saved());
} catch (err) {
  console.error('[Save] Drive failed:', err);  // → devtools
  toast.show(messages.drive.saveFailed(filename), { onAction: retry });  // → адвокат
}
```
