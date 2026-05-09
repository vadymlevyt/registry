# TASK 9 — Заміна inline-кольорів CaseDossier на CSS-змінні + Responsive audit

**Дата формування:** 09.05.2026
**Фаза:** 1.6 — UI Reform (п'ятий TASK)
**Виконавець:** Claude Code (Opus 4.7, 1M context)
**Орієнтовний обсяг:** 5-7 годин
**Передумови:** TASK 1-8 завершені і закомічені

---

## ПРИНЦИПИ ВИКОНАННЯ

**Творчо, виважено, охайно.** Цей TASK складається з двох частин — поступова міграція стилів і responsive audit. Обидві потребують методичної роботи без поспіху.

**Перевіряй перед змінами.** TASK 1-8 значно змінили структуру коду. Перед редагуванням — `view` файлу, `grep` точок зміни.

**Тести разом з кодом.** Якщо виникне візуальна регресія — оновлюй тест де можливо. Чисто візуальні зміни не покриваються Vitest, але логіку перевіряй.

**SaaS-готовність.** CSS-змінні — основа майбутньої темізації для тенанта. Будь акуратний з порядком імпортів CSS щоб перевизначення працювало.

**Без тимчасових рішень.** Якщо знаходиш inline-стиль який не вписується в токени — обговори в `discovered_issues_during_task9.md`, не лиши `// TODO`.

---

## КОНТЕКСТ

### Поточний стан (з діагностики + досвід TASK 5-8)

**Успіхи попередніх TASK:**
- `tokens.css` створено з повною палітрою (TASK 5)
- 9 базових компонентів (Button, Input, Select, Chip, Card, Modal, Tabs, Toggle, Tooltip) — всі на токенах
- Toast / Banner / SystemModal / messages.js — на токенах
- Emoji в CaseDossier мігровано на lucide (TASK 7)
- Повідомлення мігровано на toast/banner (TASK 8)

**Що залишилось:**
- **Inline-стилі CaseDossier** — багато місць досі з хардкодом кольорів і pixels
- App.css — старі CSS-змінні які конфліктують з tokens.css

**Розбіжності з діагностики:**
| Призначення | App.css (старе) | tokens.css (нове) | CaseDossier inline (хаос) |
|-------------|-----------------|---------------------|----------------------------|
| фон | `--bg #0f1117` | `--color-bg #0f1117` | `#0d0f1a` (інший!) |
| surface | `--surface #191c27` | `--color-surface #191c27` | `#1a1d27` (інший!) |
| border | `--border #2d3250` | `--color-border #2d3250` | `#2e3148` (інший!) |
| green | `--green #3dd68c` | `--color-success #22c55e` | `#2ecc71` (інший!) |
| red | `--red #ff4f6a` | `--color-danger #ef4444` | `#e74c3c` (інший!) |

**Шрифт:** глобально Manrope, але CaseDossier рендериться з `fontFamily: "'Segoe UI',sans-serif"` — обходить Manrope.

**Spacing:** в CaseDossier inline `padding: 6px, 7px, 8px, 10px, 12px` — без узгодженості з токенами.

### Адаптивність — поточний стан

З контекстного файлу і memory: **адвокат працює переважно з планшета Lenovo Yoga Tab 13** (2160×1350) у landscape. Іноді в portrait. Іноді на iMac (десктоп).

В попередніх TASK я **не прописав explicit responsive вимоги** — це мій недогляд. Зараз треба перевірити що уже зроблено (Toast, Banner, Modal, базові компоненти) і виправити проблеми якщо є.

### Що з цього випливає

TASK 9 розбивається на 8 підзадач:

**Частина 1 — Inline-кольори CaseDossier:**
- **9.1** Інвентар inline-стилів
- **9.2** Заміна inline-кольорів на CSS-змінні
- **9.3** Заміна inline-spacing і radii на токени
- **9.4** Уніфікація шрифту (видалити Segoe UI override)

**Частина 2 — Responsive audit:**
- **9.5** Перевірка breakpoint'ів усіх UI компонентів TASK 5-8
- **9.6** Адаптивність Toast / Banner / Modal на мобільному
- **9.7** Адаптивність CaseDossier на мобільному (хоча primary use-case — планшет)
- **9.8** Тести і документація

---

## ЧАСТИНА 1 — INLINE СТИЛІ → ТОКЕНИ

### TASK 9.1 — Інвентар inline-стилів

#### Знайти всі inline стилі

```bash
# Inline кольори (хекс)
grep -n "color:\s*['\"]#" src/components/CaseDossier/index.jsx
grep -n "background:\s*['\"]#\|backgroundColor:\s*['\"]#" src/components/CaseDossier/index.jsx
grep -n "borderColor:\s*['\"]#\|border:\s*['\"]" src/components/CaseDossier/index.jsx

# Inline padding/margin
grep -n "padding:\s*['\"]\|margin:\s*['\"]" src/components/CaseDossier/index.jsx

# Inline fontFamily
grep -n "fontFamily:" src/components/CaseDossier/index.jsx

# Inline borderRadius
grep -n "borderRadius:" src/components/CaseDossier/index.jsx
```

#### Створи тимчасовий audit-файл

`_temp_inline_styles_audit.md` — таблиця:

```markdown
## CaseDossier inline styles inventory

### Кольори (категорія А)
| Рядок | Контекст | Значення | Заміна |
|-------|----------|----------|--------|
| 142 | header background | '#0d0f1a' | var(--color-bg) |
| 178 | card border | '#2e3148' | var(--color-border) |
| 234 | success text | '#2ecc71' | var(--color-success) |

### Spacing (категорія Б)
| Рядок | Контекст | Значення | Заміна |
|-------|----------|----------|--------|
| 245 | tab padding | '8px 12px' | var(--space-2) var(--space-3) |
| 312 | gap | '6px' | var(--space-2) (8px — найближчий) |

### Border radius (категорія В)
| Рядок | Контекст | Значення | Заміна |
|-------|----------|----------|--------|
| 167 | card | '12px' | var(--radius-lg) |
| 198 | chip | '4px' | var(--radius-xs) |

### Шрифт (категорія Г)
| Рядок | Контекст | Значення | Дія |
|-------|----------|----------|-----|
| 89 | wrapper fontFamily | "'Segoe UI',sans-serif" | ВИДАЛИТИ (наслідується від body) |

### Залишити inline (поза scope)
| Рядок | Причина |
|-------|---------|
| 1234 | dynamic color from data (provider color) — НЕ токен |
| 1567 | пропорційний width 33% — не значення з токенів |
```

#### Критерії приймання TASK 9.1

- Інвентар повний
- Кожен inline-стиль класифікований
- Сумнівні випадки винесено в окремий розділ

---

### TASK 9.2 — Заміна inline-кольорів

#### Принцип

Кожен hex колір з категорії А → відповідна CSS-змінна з tokens.css.

**Mapping:**
- Темні фони (`#0d0f1a`, `#0f1117`) → `var(--color-bg)`
- Surface (`#1a1d27`, `#191c27`) → `var(--color-surface)`
- Picked-up surface (`#222638`) → `var(--color-surface-2)`
- Бордюри (`#2e3148`, `#2d3250`) → `var(--color-border)`
- Текст основний (`#e8eaf0`) → `var(--color-text)`
- Текст другорядний (`#a8b3cf`, `#8b90a7`) → `var(--color-text-2)`
- Текст приглушений (`#6b7693`, `#555a73`) → `var(--color-text-3)`
- Акцент (`#3b82f6`, `#4f7cff`) → `var(--color-accent)`
- Успіх (`#22c55e`, `#2ecc71`, `#3dd68c`) → `var(--color-success)`
- Помилка (`#ef4444`, `#e74c3c`, `#ff4f6a`) → `var(--color-danger)`
- Попередження (`#f59e0b`, `#ffd166`, `#ff8c42`) → `var(--color-warning)`
- Золотий (`#e6b450`) → `var(--color-gold)`

#### Замінювати акуратно

Inline-style в JSX:
```jsx
// Було:
<div style={{ background: '#1a1d27', color: '#e8eaf0' }}>

// Стало:
<div style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
```

Альтернативний шлях — винести в CSS клас. Але це більше роботи. Простий перехід на var() — мінімальний ризик регресії.

#### Якщо є кольори яких немає в tokens.css

Не додавай нові токени без обговорення. Зафіксуй у `discovered_issues_during_task9.md`:

```markdown
## Кольори без відповідного токена

- `#5f6678` (рядок 234) — використовується для disabled state. Можливо потрібен `--color-disabled` токен.
- `#ff8c42` (рядок 567) — особливий помаранчевий, відрізняється від `--color-warning`. 
  Перевірити: чи це випадкова варіація, чи свідомий вибір?
```

#### Критерії приймання TASK 9.2

- Усі inline hex кольори замінено на var(--color-*)
- Сумнівні випадки в discovered_issues
- Білд чистий, на сайті візуально нічого критично не зламано

---

### TASK 9.3 — Заміна inline-spacing і radii

#### Принцип

**Spacing шкала з tokens.css:**
- 4px → `var(--space-1)`
- 8px → `var(--space-2)`
- 12px → `var(--space-3)`
- 16px → `var(--space-4)`
- 20px → `var(--space-5)`
- 24px → `var(--space-6)`
- 32px → `var(--space-8)`
- 40px → `var(--space-10)`

**Якщо знаходиш не-стандартні значення** (`6px`, `7px`, `10px`, `14px`):
- 6-7px → округлити до 8px (`--space-2`)
- 10px → округлити до 8px (`--space-2`) або 12px (`--space-3`) залежно від контексту
- 14px → округлити до 16px (`--space-4`)

**Чи завжди округлювати?** Якщо різниця 1-2px суттєва (наприклад точне вирівнювання з іконкою) — лиши хардкод, поясни в коментарі. Якщо випадкова варіація — округлюй.

**Border radius:**
- 4px → `var(--radius-xs)` (chips)
- 6px → `var(--radius-sm)` (buttons, inputs)
- 8px → `var(--radius-md)` (cards)
- 12px → `var(--radius-lg)` (modals)

#### Критерії приймання TASK 9.3

- Більшість spacing/radius замінено на токени
- Не-стандартні значення округлено або обґрунтовано
- Візуально все на місці

---

### TASK 9.4 — Уніфікація шрифту

#### Знайти і прибрати Segoe UI override

```bash
grep -n "fontFamily:" src/components/CaseDossier/index.jsx
```

Замінити:
```jsx
// Було:
<div style={{ fontFamily: "'Segoe UI', sans-serif" }}>

// Стало (видалити повністю — наслідується від body):
<div>

// Або якщо потрібен явний шрифт:
<div style={{ fontFamily: 'var(--font-body)' }}>
```

#### Критерії приймання TASK 9.4

- Жодного `fontFamily: 'Segoe UI'` не залишилось
- Шрифт CaseDossier — Manrope (наслідується від body)
- Заголовки — Unbounded (через CSS клас або var(--font-heading))

---

## ЧАСТИНА 2 — RESPONSIVE AUDIT

### TASK 9.5 — Breakpoint'и UI компонентів

#### Цільові breakpoint'и

З memory і контексту:
- **≥1280px** — повний layout (десктоп / планшет landscape) — primary use case
- **768-1279px** — компактний (планшет portrait, малий десктоп)
- **<768px** — мобільний (телефон)

#### Що перевірити в кожному компоненті

**Button** — touch-friendly:
- min-height 44px на mobile (Apple HIG, Google Material)
- Якщо зараз 28-32px — на mobile збільшити через media query

**Input/Select/Modal** — те саме, плюс:
- Modal на <768px → full-screen або 95vw width
- Input font-size ≥16px на iOS (інакше zoom при focus)

**Toast** — на <768px:
- Bottom-right → bottom (повна ширина з відступами 16px)
- Max-width 100% мінус padding

**Tooltip** — на touch пристроях:
- Long-press показ
- Або просто не показувати на touch (focus замість hover)

#### Як перевіряти

Не маєш реального пристрою — використовуй CSS testing:

```javascript
// tests/integration/responsive.test.jsx (можна додати або скіпнути)
import { render } from '@testing-library/react';

// Mock window.matchMedia для різних розмірів
function setViewport(width) {
  Object.defineProperty(window, 'innerWidth', { value: width });
  window.dispatchEvent(new Event('resize'));
}

it('Modal на mobile має full-width', () => {
  setViewport(375);
  const { container } = render(<Modal isOpen={true}>...</Modal>);
  // перевірити CSS computed styles
});
```

Або простіше — статичний CSS analysis: переконатись що в CSS компонентів є media queries для мобільного.

#### Критерії приймання TASK 9.5

- В кожному UI компоненті (Button, Input, Select, Chip, Card, Modal, Tabs, Toggle, Tooltip, Toast, Banner) перевірено наявність responsive логіки
- Якщо немає — додано media queries
- Виявлені проблеми в `discovered_issues_during_task9.md` якщо потребують більшого refactor

---

### TASK 9.6 — Toast / Banner / Modal на мобільному

#### Toast adaptations

```css
/* Toast.css — додати */
@media (max-width: 768px) {
  .ui-toast-container {
    bottom: var(--space-4);
    right: var(--space-4);
    left: var(--space-4);
    max-width: none;
  }
  
  .ui-toast {
    width: 100%;
  }
}
```

#### Modal adaptations

```css
/* Modal.css — додати */
@media (max-width: 768px) {
  .ui-modal {
    width: 95vw !important;
    max-height: 95vh;
  }
  
  .ui-modal--sm,
  .ui-modal--md,
  .ui-modal--lg {
    width: 95vw;
  }
  
  .ui-modal-backdrop {
    padding: var(--space-2);
  }
}
```

#### Banner

Banner займає width свого parent, тому проблем менше. Перевірити що actions на мобільному не виходять за рамки:

```css
@media (max-width: 480px) {
  .ui-banner__actions {
    flex-direction: column;
  }
  
  .ui-banner__actions > * {
    width: 100%;
  }
}
```

#### Критерії приймання TASK 9.6

- Toast на mobile — full-width знизу
- Modal на mobile — 95vw
- Banner actions wrappable
- Усі media queries додано в існуючі CSS файли (НЕ нові файли)

---

### TASK 9.7 — Адаптивність CaseDossier

#### Цільові точки в CaseDossier

**Не основний use case** — primary planшет landscape (1280+ px). Але треба перевірити що portrait planшету і мобільний не повністю зламані.

**Перевірити:**

1. **Хедер справи (шапка)** — на портреті може не вміщатись назва справи + кнопки. Розв'язання: 
   - Кнопки в overflow меню `⋯` на <1024px
   - Або вертикальний layout

2. **Вкладки (Огляд/Матеріали/Робота з документами)** — горизонтальний скрол на мобільному:
   ```css
   @media (max-width: 768px) {
     .case-dossier__tabs {
       overflow-x: auto;
       white-space: nowrap;
     }
   }
   ```

3. **Бічна панель агента** — на мобільному має бути bottom drawer або повноекранний overlay, не side panel:
   ```css
   @media (max-width: 768px) {
     .case-dossier__agent-panel {
       position: fixed;
       inset: 0;
       /* або bottom drawer */
     }
   }
   ```

4. **Реєстр документів двоколонковий (список + viewer)** — на портреті:
   - Один з двох columns активний
   - Перемикач між списком і viewer
   - Або viewer як модалка коли документ вибрано

5. **Drag-n-drop зона** — на touch пристроях drag може не працювати:
   - Додати кнопку "Завантажити файли" як fallback
   - Або повідомлення "На мобільному використовуйте кнопку завантаження"

#### Якщо знайдено серйозну проблему що потребує більшого refactor

Не виправляй у TASK 9 — фіксуй в `discovered_issues_during_task9.md`:

```markdown
## CaseDossier мобільна адаптивність — потребує окремого TASK

- Реєстр двоколонковий (список + viewer) повністю не працює на портреті — потрібен повний redesign mobile layout
- Бічна панель агента — потрібен drawer pattern, не media query
- Estimated 6-8 годин окремого TASK Mobile-First CaseDossier
```

#### Критерії приймання TASK 9.7

- Базові responsive фікси додано (overflow tabs, full-width modals)
- Складні випадки винесено в discovered_issues для окремого TASK Mobile-First

---

### TASK 9.8 — Тести і документація

#### Додати тести

**`tests/integration/responsive.test.jsx`** — мінімальний:
- Modal на 375px viewport має 95vw
- Toast container на 375px займає full-width
- Banner actions на 375px стають вертикальними

Test setup:
```javascript
function setViewport(width) {
  // ...
}
```

#### Оновити документацію

В `src/components/UI/README.md` додати секцію:

```markdown
## Адаптивність

Усі компоненти UI мають базову responsive поведінку:

- **<768px** — мобільні breakpoint'и (Modal full-width, Toast bottom)
- **<1024px** — планшет portrait (Tabs scrollable)
- **≥1024px** — повний layout

При додаванні нових компонентів дотримуйся:
- Touch-friendly targets (мин 44px height на mobile)
- Font-size ≥16px на input для iOS no-zoom
- Уникай fixed pixels — використовуй rem/em або CSS-змінні
```

В `dossier_architecture_decisions.md` додати правило:

```markdown
## Адаптивність — обов'язкова частина TASK

Кожен новий TASK з UI зміною має включати розділ "Адаптивність":
- Які breakpoint'и зачіпаються
- Що зміниться на mobile/планшеті
- Як перевірено

Primary use case — планшет landscape (Lenovo Yoga Tab 13, 2160×1350).
Secondary — десктоп. Мобільний — обмежено.
```

#### Видалити тимчасовий audit-файл

Після завершення міграції видали `_temp_inline_styles_audit.md`.

#### Критерії приймання TASK 9.8

- 1-2 файли тестів responsive додано
- README.md UI оновлено з адаптивністю
- dossier_architecture_decisions.md оновлено з правилом
- audit-файл видалено

---

## SAAS IMPLICATIONS

CSS-змінні — основа майбутньої темізації для тенанта. Коли будемо робити SaaS і кожне бюро зможе налаштувати свої кольори — `tokens-override.css` для тенанта перевизначить токени, а CaseDossier (вже на токенах) автоматично адаптується.

Адаптивність — дозволяє продавати продукт для адвокатів які працюють з різних пристроїв (і збільшує цільовий ринок).

---

## BILLING IMPLICATIONS

Не зачіпає прямо.

---

## КОМІТ І ПУШ

```bash
git commit -m "refactor: TASK 9 — migrate CaseDossier inline colors/spacing/fonts to tokens.css + responsive audit + media queries for Toast/Modal/Banner"
git push origin main
```

---

## ОЧІКУВАНІ АРТЕФАКТИ ВИКОНАННЯ

Створи файл звіту `report_task9.md` у корені репо.

### Структура звіту

**Резюме TASK 9** — один абзац

**Реалізація з TASK** — таблиця 9.1-9.8

**Підрахунок міграцій** — окремі таблиці для:
- Кольорів inline → токени
- Spacing/radii → токени
- Шрифт → видалено override
- Responsive фіксів додано

**Створені файли** — тести responsive, audit-файли (тимчасові видалені)

**Змінені файли** — CaseDossier/index.jsx, Toast.css, Modal.css, Banner.css, README.md, dossier_architecture_decisions.md

**Знахідки** — discovered_issues_during_task9.md з пунктами:
- Кольори без відповідного токена
- Сумнівні spacing значення
- Mobile-First CaseDossier потребує окремого TASK (якщо знайдено)

**Тести і білд**

### Пояснення в термінал для адвоката

Стиль як родичу. Без термінів "CSS-змінна", "media query", "viewport".

Приклад тону:

> Я зробив дві речі:
>
> **Перше — узгодив візуальний стиль досьє з рештою системи.** Раніше в досьє були свої кольори, шрифти, відступи — місцями трохи інші ніж в інших модулях. Тепер всюди однаково. На сайті ти можеш побачити дрібні візуальні зміни (трохи інший відтінок зеленого, трохи більший відступ десь) — це нормально, тепер все відповідає єдиному стилю.
>
> **Друге — перевірив як інтерфейс виглядає на різних розмірах екрану.** Ти переважно працюєш на планшеті в горизонтальному положенні — це primary use case і там все добре. Я також додав адаптацію для:
> - Планшета у вертикальному положенні (вкладки прокручуються горизонтально якщо не вміщаються)
> - Мобільного телефону (модалки розгортаються на повний екран, повідомлення знизу займають повну ширину)
>
> Знайшов що деякі складні елементи досьє (двоколонковий реєстр документів, бічна панель агента) на мобільному будуть погано виглядати — це потребує окремого великого редизайну, я зафіксував у плані як майбутній TASK.
>
> Чи все працює: тести зелені, білд чистий.
>
> Що тобі зробити: зайди на сайт після деплою. На планшеті landscape все має виглядати як раніше або трохи кращим. Якщо повернеш планшет в portrait — побачиш адаптацію. Деталі в `report_task9.md`.

---

## ВЛАСНА АНАЛІТИКА І ТВОРЧЕ ВИКОНАННЯ

Це найбільший TASK Фази 1.6 — складається з двох великих частин. Працюй методично, не поспішай.

Якщо в процесі знайдеш:
- App.css має дублюючі CSS-змінні з tokens.css (--bg vs --color-bg) → НЕ видаляй App.css, лиши обидва живими. Окремий TASK App.css cleanup пізніше.
- Якісь стилі CaseDossier ламаються при заміні → відкат конкретної заміни, поясни в discovered_issues
- Складні responsive проблеми CaseDossier → не вирішуй у TASK 9, фіксуй для окремого Mobile-First TASK

**Критерій якості:** після TASK 9 CaseDossier візуально консистентний з рештою системи. На планшеті landscape виглядає як раніше або краще. На мобільному — обмежено працює (без повного redesign), але не зламано критично.

Не вважай TASK дзвоном з небес. Адаптуйся.

---

**Кінець TASK 9.**
