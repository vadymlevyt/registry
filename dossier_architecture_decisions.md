# Dossier Architecture Decisions

Архітектурні правила що стосуються `CaseDossier` і базових UI компонентів.

---

## Адаптивність — обов'язкова частина TASK з UI зміною

**З TASK 9 (2026-05-09):** кожен новий TASK з UI зміною має включати розділ "Адаптивність":

- Які breakpoint'и зачіпаються
- Що зміниться на mobile / планшеті / десктопі
- Як перевірено

### Цільові breakpoint'и системи

| Розмір | Контекст |
|--------|----------|
| **≥1280px** | Десктоп / планшет landscape — primary use case (Lenovo Yoga Tab 13, 2160×1350) |
| **768-1279px** | Планшет portrait, малий десктоп |
| **<768px** | Мобільний телефон — обмежений support |

### Обов'язкові responsive правила базових UI компонентів

- **Touch-friendly targets:** мін 44px висота для Button/Input/Select на <768px (Apple HIG / Google Material)
- **iOS no-zoom:** font-size ≥16px на input/select control на <768px
- **Modal:** 95vw / 95vh на <768px
- **Toast:** full-width знизу на <768px (не bottom-right)
- **Tabs:** horizontal scroll на <768px
- **Banner actions:** vertical stack на <480px
- **Tooltip:** прихований на touch (через `@media (hover: none)`)

### Не використовуй inline-стилі для responsive

CSS `@media` правила не працюють у inline-стилях. Якщо компонент потребує responsive — використовуй **CSS клас + окремий `.css` файл** (як зроблено в `src/components/UI/*.css`).

CaseDossier поки що написаний на inline-стилях — обмежує responsive можливості. Окремий TASK Mobile-First CaseDossier (8-12 годин, заплановано після TASK 9) переведе на класи + media queries.

---

## Дизайн-токени — єдине джерело правди

**З TASK 5 + TASK 9 (2026-05-09):** усі кольори, spacing, radii, шрифти беруться з `src/styles/tokens.css`.

### Заборонено

- Inline hex кольори (`color: '#3b82f6'`) — використовуй `var(--color-accent)`
- Inline numeric padding/margin для значущих контейнерів — використовуй `var(--space-*)`
- Inline numeric borderRadius — використовуй `var(--radius-*)`
- `fontFamily: "'Segoe UI', sans-serif"` (або будь-який інший override) — наслідується від body (Manrope)

### Виняток

- `#fff` (білий) для тексту на акцентних кнопках — припустимо
- Алфа-варіанти rgba (поки немає `color-mix()` змінних) — окремий TASK додасть

### Правило при додаванні нового кольору в код

Якщо потрібен колір якого немає в tokens.css:

1. Зафіксувати в `discovered_issues_during_task<N>.md`
2. НЕ створювати `--color-new-*` без обговорення
3. Адвокат вирішує: чи додавати новий токен / чи мапити на існуючий

---

## CaseDossier — поточні обмеження

- Heavily inline-styled — не підтримує `@media` рефакторинг без перебудови
- Heavy header (5+ кнопок) — не вміщається на <1024px portrait
- Двоколонковий реєстр (список + viewer) — на портреті потребує перемикача
- Drag-n-drop зона не працює на touch — потрібен fallback кнопкою

**Все вище — заплановано в Mobile-First CaseDossier TASK.**
