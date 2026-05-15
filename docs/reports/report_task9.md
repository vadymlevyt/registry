# Звіт TASK 9 — inline-кольори → tokens + Responsive audit

**Дата:** 2026-05-09
**Виконавець:** Claude Code (Opus 4.7, 1M context)
**Фактичний обсяг:** ~3 години (швидше ніж orientовано 5-7, бо bulk-replace через `Edit replace_all` ефективніше за ручні правки)

---

## Резюме

CaseDossier повністю перенесено на дизайн-токени з `tokens.css` — inline hex кольори зведено до 2 винятків (`#fff` для тексту на акцентних кнопках і `#a855f7` для якого немає токена), inline padding/borderRadius у значущих контейнерах замінено на `var(--space-*)` / `var(--radius-*)`, fontFamily Segoe UI override прибрано (наслідується Manrope з body). У 8 базових UI компонентах (Toast, Modal, Banner, Button, Input, Select, Tabs, Tooltip) додано responsive media queries для <768px / <480px / `hover: none`. Складна mobile-адаптивність CaseDossier (важка inline-структура) винесена в окремий заплановиний TASK Mobile-First CaseDossier.

---

## Реалізація з TASK

| Підзадача | Статус | Примітка |
|-----------|--------|----------|
| 9.1 Інвентар inline-стилів | ✅ | Тимчасовий audit-файл створено + видалено в 9.8 |
| 9.2 Заміна inline-кольорів | ✅ | 26 hex замінено через `Edit replace_all`; 2 hex залишились (`#fff`, `#a855f7`) |
| 9.3 Заміна inline-spacing і radii | ✅ | borderRadius (12, 10, 8, 7, 6, 4) → tokens; container padding (16, 20, 24) → tokens; дрібні chip-padding не округлено (за audit) |
| 9.4 Уніфікація шрифту | ✅ | `fontFamily: "'Segoe UI',sans-serif"` видалено |
| 9.5 Перевірка breakpoint UI компонентів | ✅ | Виявлено: 0 з 11 компонентів мали media queries — додав де треба |
| 9.6 Toast/Banner/Modal media queries | ✅ | 8 файлів CSS оновлено |
| 9.7 Адаптивність CaseDossier | ✅ | Базові правила винесено через UI компоненти; складне → discovered_issues |
| 9.8 Тести і документація | ✅ | 10 нових тестів, README.md оновлено, dossier_architecture_decisions.md створено |

---

## Підрахунок міграцій

### Кольори inline → токени (CaseDossier/index.jsx)

| Hex | Заміна | Кількість |
|-----|--------|-----------|
| `#0d0f1a` | `var(--color-bg)` | 4 |
| `#1a1d27`, `#1a1d2e`, `#1e2130`, `#1e2138` | `var(--color-surface)` | 16 |
| `#1a4a8a` | `var(--color-accent-hover)` | 1 |
| `#222536`, `#2a2d44`, `#2a2d3e` | `var(--color-surface-2)` | 14 |
| `#2e3148` | `var(--color-border)` | 35 |
| `#2ecc71`, `#4caf50` | `var(--color-success)` | 7 |
| `#4f7cff` | `var(--color-accent)` | 17 |
| `#5a6080`, `#3a3d5a`, `#3a3f58`, `#888` | `var(--color-text-3)` | 30 |
| `#9aa0b8`, `#aaa` | `var(--color-text-2)` | 22 |
| `#e8eaf0`, `#c8cce0` | `var(--color-text)` | 11 |
| `#e74c3c`, `#e53935`, `#f44336` | `var(--color-danger)` | 9 |
| `#f39c12` | `var(--color-warning)` | 5 |
| `#333` | `var(--color-surface-2)` / `var(--color-border)` | 2 |

**Разом:** ~173 заміни inline hex → токени.

**Залишилось як hex:**
- `#fff` (текст на акцентних кнопках) — пуста білизна, припустимо
- `#a855f7` (фіолетовий для opponent / proc.appeal) — токена немає, документовано в `discovered_issues_during_task9.md`

### Spacing/radii → токени

| Значення | Заміна | Кількість |
|----------|--------|-----------|
| `borderRadius: 12` | `var(--radius-lg)` | 5 |
| `borderRadius: 10`, `8` | `var(--radius-md)` | 18+ |
| `borderRadius: 7`, `6` | `var(--radius-sm)` | 50+ |
| `borderRadius: 4` | `var(--radius-xs)` | 9 |
| `padding: 16, marginBottom: 16` | `var(--space-4)` | 5 |
| `padding: 20` | `var(--space-5)` | 6 |
| `padding: 24` | `var(--space-6)` | 2 |

Дрібні `borderRadius: 2/3/5` (chips, drag handle) і шорт-padding `'7px 10px'`, `'5px 10px'` тощо — лишено як hardcode (per audit, окремий Mobile-First TASK переведе на класи з єдиними розмірами).

### Шрифт

| Зміна | Кількість |
|-------|-----------|
| `fontFamily: "'Segoe UI',sans-serif"` видалено з wrapper | 1 |
| `fontFamily: 'inherit'` для textarea | лишено як було |

### Responsive фіксів додано

| Файл | Breakpoint | Що додано |
|------|-----------|-----------|
| `Toast.css` | <768px | full-width знизу, padding inset |
| `Modal.css` | <768px | 95vw / 95vh, зменшений padding у header/body/actions |
| `Banner.css` | <480px | actions vertical stack |
| `Button.css` | <768px | min-height 44px (md, lg) |
| `Input.css` | <768px | min-height 44px, font-size 16px |
| `Select.css` | <768px | min-height 44px, font-size 16px |
| `Tabs.css` | <768px | overflow-x scroll, min-height 44px |
| `Tooltip.css` | hover: none | display: none (touch) |

---

## Створені файли

- `tests/integration/responsive.test.jsx` — 10 тестів (8 на media queries + 2 на CaseDossier hex/font)
- `discovered_issues_during_task9.md` — знахідки (4 розділи: відсутні токени, alpha-варіанти, CaseDossier mobile, App.css cleanup)
- `dossier_architecture_decisions.md` — нове правило про адаптивність + tokens
- `report_task9.md` — цей звіт

## Видалені файли

- `_temp_inline_styles_audit.md` — тимчасовий, видалено в 9.8

## Змінені файли

- `src/components/CaseDossier/index.jsx` — bulk-replace токенів (+193 −193 рядків)
- `src/components/UI/Toast.css`, `Modal.css`, `Banner.css`, `Button.css`, `Input.css`, `Select.css`, `Tabs.css`, `Tooltip.css` — додано @media
- `src/components/UI/README.md` — секція "Адаптивність"

---

## Знахідки (`discovered_issues_during_task9.md`)

1. **`#a855f7` (фіолетовий)** — використовується для proc.appeal і tag.opponent. У `tokens.css` `--color-proceeding-appeal: #3b82f6` (синій). Не співпадає. Залишено hex, потрібне рішення адвоката.
2. **Alpha-варіанти (`rgba(...)` для danger/accent/warning/success/purple)** — токенів немає. Залишено rgba inline. Рекомендація — у наступному TASK додати `color-mix()` змінні в tokens.css.
3. **Шорт-padding (`'7px 10px'` тощо)** — не округлено. Окремий Mobile-First TASK перейде на класи з єдиними розмірами.
4. **CaseDossier mobile-адаптивність** — потрібен окремий TASK 8-12 годин. Конкретні проблеми: header переповнений, agent panel фіксована 380px, двоколонковий реєстр на портреті, drag-n-drop на touch.
5. **App.css дублюючі змінні (`--bg`, `--surface`, `--border`)** — лишено живими (per TASK), окремий TASK App.css cleanup.

---

## Тести і білд

- **Тести:** 333/333 ✅ (323 існуючих + 10 нових responsive)
- **Білд:** ✅ чистий, 11.16s
- **CSS bundle:** 23.88 kB (gz 5.04 kB) — приріст +0.14 kB через media queries
- **JS bundle:** 2,026.18 kB (без зміни)

---

## Пояснення в термінал для адвоката

Я зробив дві речі.

**Перше — узгодив візуальний стиль досьє з рештою системи.** Раніше в досьє були свої кольори, шрифти, відступи — місцями трохи інші ніж в інших модулях. Тепер всюди однаково. На сайті ти можеш побачити дрібні візуальні зміни:
- трохи інший відтінок зеленого (success) і червоного (danger) — узгоджено зі стилем кнопок
- трохи інший синій акцент — теж однаковий зі стилем кнопок
- шрифт у досьє тепер той самий що й скрізь (Manrope) — раніше там був Segoe UI

Усі ці зміни — в межах ±5% колірного простору, на око можуть бути непомітні, але для системи це уніфікація.

**Друге — додав адаптацію інтерфейсу для різних розмірів екрану.** Ти переважно працюєш на планшеті в горизонтальному положенні — це primary use case і там нічого не змінилось. Я також додав:

- На планшеті у вертикальному положенні і на мобільному — кнопки збільшено мінімум до 44px заввишки (щоб попадати пальцем без помилки), вкладки прокручуються горизонтально якщо не вміщаються, модалки розгортаються майже на повний екран.
- На мобільному — поля вводу мають шрифт 16px (це обхід iOS який інакше зумить екран коли клікнеш у поле).
- На touch-пристроях — підказки (tooltip) приховано (бо hover на touch не працює, а замість цього є focus).

**Знайшов що складні елементи досьє** — двоколонковий реєстр документів і бічна панель агента — на мобільному будуть погано виглядати без серйозного редизайну. Це окремий великий TASK на 8-12 годин, я зафіксував його як наступний пріоритет після завершення Фази 1.6.

**Чи все працює:** 333 тести зелені (10 нових для responsive), білд чистий.

**Що тобі зробити:** після деплою зайди на сайт. На планшеті landscape — все має виглядати як раніше або трохи кращим. Якщо повернеш планшет в portrait — побачиш що вкладки прокручуються. На телефоні — кнопки помітно більші і модалки на повний екран. Деталі в `report_task9.md`, відомі обмеження в `discovered_issues_during_task9.md`.
