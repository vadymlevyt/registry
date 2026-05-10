# Архітектурна консультація — Android gesture area / safe-area-inset

**Дата:** 2026-05-09
**Контекст:** Адвокат знайшов що Reprocess не клікалась бо потрапляла в зону системних жестів Android. Підняття system nav вирішило симптом, але не корінь.

---

## 1. Чи погоджуюсь з діагнозом

**Так, повністю.** Це класичний симптом ігнорування **safe-area** браузерним viewport'ом. Перевірив:

- `tests/integration/documentViewer-workflow.test.jsx:69` — fireEvent.click через jsdom фіксує onReprocess. Код-чейн чистий.
- TEMP блок підтвердив driveId реальний → button НЕ disabled.
- Кнопка фізично рендерилась у нижньому правому куті viewport.

Залишається єдине пояснення — **події не доходили до браузера**. Android gesture navigation резервує **smk 16-32px знизу** для swipe-up до головного екрану і swipe-bok між апами. Ці пікселі **формально частина viewport** (без `viewport-fit=cover` і `safe-area-inset` env-змінних), але touch'і там перехоплюються системою.

Чому "стабільно мертва" саме Reprocess: вона **найправіша** в Footer, тобто в **нижньому правому** куті — найгірша позиція для жестового overlap (нижня частина indicator + правий край swipe-back).

**Це не баг коду.** Це відсутність обліку safe-area у CSS і viewport meta.

---

## 2. Правильне довгострокове рішення

### Корінь — у двох місцях:

**A) `index.html` рядок 5:**
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
```
**Бракує `viewport-fit=cover`.** Без нього `env(safe-area-inset-*)` повертає **0 на iOS** (на Android — обмежено). Це найважливіший пропуск — будь-який інший safe-area код без цього флага марний.

**B) `App.css:32`:**
```css
.app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
```
`100vh` на мобільних — це **large viewport** (включає область системних барів). Тому Footer виносить свою зону аж до самого низу екрану.

Сучасна заміна: `100dvh` (dynamic — підлаштовується коли URL bar / system nav з'являються/зникають) або `100svh` (small — статично менше). Підтримка: iOS Safari 15.4+ (2022), Android Chrome 108+ (2022), всі сучасні браузери. Фолбек через `@supports`.

### Рекомендований підхід — три шари

**Шар 1: viewport meta** (одна правка, ефект скрізь)
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover" />
```

**Шар 2: токен у tokens.css**
```css
:root {
  --safe-area-top:    env(safe-area-inset-top, 0px);
  --safe-area-right:  env(safe-area-inset-right, 0px);
  --safe-area-bottom: env(safe-area-inset-bottom, 0px);
  --safe-area-left:   env(safe-area-inset-left, 0px);
}
```

**Шар 3: точкові правки на bottom-anchored елементах:**
```css
.document-viewer__footer {
  padding-bottom: calc(var(--space-2) + var(--safe-area-bottom));
}
```

Або через `margin-bottom`, або через `padding-bottom` — обидва працюють. `padding` краще для збереження background до самого краю.

### Чому не варіант B (просто margin/padding) і не C (sticky з резервом)

- **Просто margin/padding** без env() — не адаптивно. Жест-зона на iPhone 13 Pro = 34px, на pixel 7 = 24px, на старому Android = 0px. Твердий margin або обріже useful UI на старих пристроях, або не врятує на нових.
- **Sticky з резервом** — те саме, плюс sticky має відомий клас issues з overflow-контейнерами і не буде розв'язувати проблему якщо jest-зона глибша за резерв.

`env(safe-area-inset-*)` — стандартний WebKit/W3C-blessed підхід, працює і на iOS notch, і на Android gesture, і на майбутніх foldable / round screens.

---

## 3. Окремий мікро-TASK чи частина mobile-first рефакторингу?

**Окремий мікро-TASK зараз.** Аргументи:

- Скоуп малий: одна правка `viewport-fit=cover` + один токен у tokens.css + 3-5 точкових `padding-bottom` правок.
- Фікс справжнього бага який щойно зловили в production.
- Адвокат тестує систему щодня — кожен зайвий день це його втрачений жест.
- **НЕ блокує** майбутній mobile-first рефакторинг — той працюватиме поверх правильного safe-area фундаменту, а не змагатиметься з ним.

Якщо забрати в великий рефакторинг — buggy UX продовжить мучити користувача місяці поки рефакторинг не приземлиться.

**Розмір майбутнього mTASK:** ~1-2 години роботи + тести.

---

## 4. Що знайдено в поточному CSS Footer

**Безпосередньо у `DocumentViewer.css`:**
```css
.document-viewer__footer {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-4);
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .document-viewer__footer {
    justify-content: space-around;
    gap: 0;
  }
  .document-viewer__footer .ui-button { min-height: 44px; }
}
```

**Жодного env(safe-area-*) ніде в коді** — підтверджено greps по `safe-area`, `env(safe-area`, `viewport-fit`, `100dvh`, `100svh`. Ні в `tokens.css`, ні в інших CSS, ні в JSX inline-стилях. Це **повна відсутність** safe-area awareness.

**`min-height: 44px` для кнопок на mobile** є — це Apple touch target guideline. Добре. Але без safe-area padding ця висота заходить у gesture зону.

---

## 5. Інші компоненти з тим же ризиком

Грепнув всі `bottom: X`, `position: fixed`, `position: absolute` з прив'язкою до низу екрану. Кандидати:

| # | Компонент | Файл / рядок | Ризик | Що зробити |
|---|-----------|--------------|-------|-----------|
| 1 | **DocumentViewer Footer** | `DocumentViewer.css:213` | ✅ підтверджений (Reprocess) | `padding-bottom: calc(var(--space-2) + var(--safe-area-bottom))` |
| 2 | **Toast container** | `Toast.css:3` (`bottom: 24px`) і `:95` (mobile `bottom: 16px`) | ⚠️ високий — toast у нижньому правому куті, той самий gesture overlap | `bottom: calc(var(--space-6) + var(--safe-area-bottom))` |
| 3 | **Quick Input fab (⚡)** | `App.css:290` (`bottom: 24px; right: 24px; 52×52`) | ⚠️ високий — fab фізично у gesture-зоні | `bottom: calc(24px + var(--safe-area-bottom))` |
| 4 | **Quick Input draggable** | `App.jsx:6265` (inline `position: fixed`) | ⚠️ високий — позиція зберігається через qiBtnPos, юзер може поставити в gesture-зону | при drop'і clamp до `viewport.height - safe-area-bottom - btnHeight` |
| 5 | **Дві ToastContainer інстанси** | `App.jsx:6058` (early-return modal block) і `App.jsx:6286` | ⚠️ обидві наслідують Toast.css — фікс на CSS-рівні покриє |
| 6 | **App container `height: 100vh`** | `App.css:32` | ⚠️ корінь геометрії — Footer дотягується до низу екрану | `height: 100dvh` з фолбеком `@supports not (height: 100dvh) { .app { height: 100vh; } }` |
| 7 | **Modal action area** | `Modal.css:2` (modal `position: fixed`) — кнопки внизу модалок | ⚠️ середній — actions row внизу модалки на full-screen mobile може потрапляти в gesture-зону | додати safe-area-bottom до `.ui-modal__actions` або на mobile `.ui-modal` контейнер |
| 8 | **Notebook overlay** | `Notebook/index.jsx:468` (`position: 'fixed', inset: 0`) | низький, треба перевірити чи є bottom action bar усередині |
| 9 | **Dashboard slot pickers** | `Dashboard/index.jsx:2330, 2423, 2484` (`position: 'fixed', inset: 0`) | низький, full-screen overlays, треба перевірити чи містять bottom-fixed children |

**Top-anchored елементи** (`safe-area-inset-top` для iPhone notch / Dynamic Island):
- `index.html` body не має padding для notch
- CaseDossier header (zIndex: 200) — якщо app у "fullscreen" режимі (PWA), notch перекриває title

Не зачіпати у поточному обсязі — нижня жест-зона значно частіше ламає UX, ніж notch у read-only header.

### Рекомендований порядок мікро-TASK'ів

1. **mTASK A — safe-area foundation** (1.5-2 год):
   - `viewport-fit=cover` у meta
   - `--safe-area-*` токени в tokens.css
   - `100vh → 100dvh` з @supports фолбеком
   - **5 точкових правок:** Footer, Toast (1 правило для обох інстансів), QI fab, QI draggable clamp, Modal actions
   - Smoke-test на адвокатовому Android (бажано — без піднятої system nav, у дефолтному стані)
2. **mTASK B (пізніше, опційно)** — повний mobile-first рефакторинг з 4 breakpoints — буде вже на правильному фундаменті

---

## Висновок

**Діагноз адвоката правильний** — Android gesture overlap. Не код-баг.

**Корінь:** `index.html` без `viewport-fit=cover` + відсутність `env(safe-area-inset-*)` в CSS + `100vh` замість `100dvh`. Системна проблема, не локальна.

**Зачіпає мінімум 5-7 компонентів,** не лише Reprocess. Адвокат досі не помічав бо тапав у середині кнопок (де gesture-зона рідше перекриває). Reprocess спіймала бо найправіший нижній кут — найгірша геометрія.

**Рекомендую окремий mTASK на 1.5-2 години** з фіксами усіх знайдених точок одночасно. Перед рефакторингом mobile-first.
