# Звіт TASK 6 — Решта базових UI компонентів (Chip, Toggle, Tabs, Tooltip)

**Дата:** 2026-05-08
**Виконавець:** Claude Code (Opus 4.7, 1M context)
**Статус:** Завершено. 277/277 тестів зелені, повний прогон 16.2с, білд чистий.

---

## Резюме TASK 6

Доробив решту 4 базових UI компонентів які знадобляться для повноцінної міграції CaseDossier і інших модулів. Тепер у `src/components/UI/` повний набір з 9 компонентів: 5 з TASK 5 (Button, Input, Select, Modal, Card) + 4 нових (Chip, Toggle, Tabs, Tooltip). Усі будуються виключно на CSS-змінних з `tokens.css`, БЕЗ inline-кольорів. 44 нових юніт-тести (загалом 277 у системі). README.md розширено повними prop-таблицями для всіх 9 компонентів.

На сайті візуально нічого не змінилося — це фундамент. Поступова міграція існуючих модулів на нові компоненти — окремі TASK Фази 1.6.

---

## Реалізація з TASK

| Підзадача | Статус | Розташування |
|-----------|--------|--------------|
| 6.1 Chip (6 variants × 2 sizes + removable + proceeding-color) | ✓ | `src/components/UI/Chip.jsx` + `.css` |
| 6.2 Toggle (2 sizes + label + description + disabled) | ✓ | `src/components/UI/Toggle.jsx` + `.css` |
| 6.3 Tabs (default/pills + icon + badge + disabled + fullWidth + ARIA) | ✓ | `src/components/UI/Tabs.jsx` + `.css` |
| 6.4 Tooltip (4 placements + delay + focus support + cleanup) | ✓ | `src/components/UI/Tooltip.jsx` + `.css` |
| 6.5 4 файли тестів + index.js + README.md | ✓ | 44 тести, `index.js`, `README.md` оновлено |

---

## Створені файли

| Файл | Призначення |
|------|-------------|
| `src/components/UI/Chip.jsx` + `.css` | Тег / фільтр / статус. 6 variants. Removable з × кнопкою. Proceeding варіант з кастомним кольором через CSS-змінну `--chip-color`. |
| `src/components/UI/Toggle.jsx` + `.css` | Switch увімк/вимк. Native checkbox під капотом + custom track/thumb. label + description для опцій. |
| `src/components/UI/Tabs.jsx` + `.css` | Горизонтальні вкладки. variant=default (підкреслення) / pills. ARIA `role="tablist"` / `role="tab"` / `aria-selected`. Підтримка badge і icon. |
| `src/components/UI/Tooltip.jsx` + `.css` | Wrapper з hover/focus тригером. 4 позиції. Cleanup timera при unmount. Animation fade-in. |
| `tests/unit/Chip.test.jsx` | 15 тестів (variants з it.each, sizes, removable, stopPropagation, proceeding color). |
| `tests/unit/Toggle.test.jsx` | 8 тестів (label/description, checked toggle обох напрямків, disabled, sizes). |
| `tests/unit/Tabs.test.jsx` | 12 тестів (рендер, badge, ARIA, active state, click, disabled, variants, fullWidth, icon, role attrs). |
| `tests/unit/Tooltip.test.jsx` | 9 тестів (через `vi.useFakeTimers` + `act` — show after delay, hide on leave, focus a11y, blur, disabled, cleanup на early leave). |

## Змінені файли

- `src/components/UI/index.js` — додано re-export 4 нових компонентів. 9 експортів загалом.
- `src/components/UI/README.md` — додано prop-таблиці і приклади для Chip / Toggle / Tabs / Tooltip перед секцією "Іконки".

---

## Покриття тестами

| Компонент | Тестів |
|-----------|--------|
| Chip | 15 |
| Toggle | 8 |
| Tabs | 12 |
| Tooltip | 9 |
| **TASK 6 разом** | **44** |
| **+ TASK 5 (UI)** | 53 |
| **+ TASK 1-4 (services)** | 180 |
| **Загалом** | **277** |

`npm test` — **16.2 секунди** (jsdom setup ~6с на 9 .jsx файлах, прийнятно).

---

## Відхилення від TASK з обґрунтуванням

1. **Tooltip — без бібліотеки positioning (як floating-ui)**. TASK явно дозволив залишитись на CSS-positioning для початку. Якщо знадобляться edge cases (collision detection, viewport flip) — окремий TASK.

2. **Chip variants через it.each у тестах** — стиль трохи відрізняється від інших тестових файлів (де кожен variant — окремий `it`). Обрав it.each бо для 5 варіантів формальна перевірка одинакова, рядкові тести стають читабельнішими.

3. **Tooltip-тести використовують `vi.useFakeTimers` + `act`** — щоб контролювати delay setTimeout. Це стандартна практика, але треба пам'ятати що `useFakeTimers` діє в межах `beforeEach/afterEach` блоків (інакше вплине на інші тести).

4. **Toggle через `<label>` + native `<input type="checkbox">`** — accessibility з коробки (можна tab focus, space toggle). Custom UI намальований через CSS поверх непомітного нативного input.

5. **Без CSS Modules / styled-components** — той самий аргумент як у TASK 5: тримаємось простоти, .css файли + BEM-style класи.

---

## Знахідки

Окремий `discovered_issues_during_task6.md` не створював — нічого критичного. Дрібниці:

- `lucide-react` `<X>` іконку в Chip використовуємо як ReactNode без обгортки. Працює.
- `vi.useFakeTimers` з jsdom environment працює коректно. Якщо в майбутніх тестах треба буде real timers — викликати `vi.useRealTimers()` явно у `afterEach`.

---

## Білд + push

- `npm test` — ✓ 277/277 за 16.2с.
- `npm run build` — ✓ чистий, **2 003 KB** JS / ~622 KB gzip / 9.3с (зростання +5 KB після додавання 4 компонентів — мінімальне).
- Git коміт + push — наступним кроком.

---

## Пояснення в термінал для адвоката

Я доробив решту базових елементів інтерфейсу які знадобляться для повноцінного оновлення досьє. Тепер у нас **повний набір "будівельних блоків"** — 9 елементів: кнопки, поля вводу, списки, модальні вікна, картки (з минулого TASK) і тепер ще:

- **Чіпси** (Chip) — маленькі позначки тегів і фільтрів. 6 кольорових варіантів — нейтральні для тегів, синій для активних фільтрів, зелений для статусу "active", червоний для помилок, плюс спеціальний варіант для проваджень з кольором з палітри. Можна додати × кнопку для прибирання фільтра.
- **Перемикачі** (Toggle) — для увімкнення/вимкнення опцій. У документ-процесорі будуть перемикачі для налаштувань обробки. Стандартний switch-стиль як на iPhone.
- **Вкладки** (Tabs) — для перемикання між Оглядом / Матеріалами / Роботою з документами / Канвою у досьє. Підтримують лічильники (наприклад "Матеріали (24)") і іконки.
- **Підказки** (Tooltip) — текст при наведенні на елемент. Допоможе пояснити що означає маркер ⚠ біля документа, які метадані у нього, що робить кнопка.

**На сайті візуально ще нічого не змінилось** — це фундамент. У наступних TASK почнемо переписувати реальні шматки досьє на ці нові елементи, і ти побачиш зміни.

**Перевірки:** 277 зелених (44 нових для TASK 6 + 233 які вже були). Прогон 16.2 секунди. Якщо хтось у майбутньому випадково зламає чіпс чи вкладку — деплой не пройде.

**Що тобі робити:** нічого. Це підготовча робота. Після наступного push GitHub Actions автоматично запустить усі 277 перевірок і задеплоїть на сайт якщо все зелене.

Деталі — в `report_task6.md` (повна prop-документація, відхилення, тести). Завантаж файл в адмін-чат щоб переглянути.
