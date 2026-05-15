# Діагностика — кнопка "Перерозпізнати" не клікається на iPad

**Дата:** 2026-05-09
**Контекст:** TEMP блок driveId у Footer показав, що `document.driveId` для всіх 4 тестованих документів реальний рядок. Гіпотеза "selectedDoc snapshot з null" (з `diagnostic_perereoznaty_button.md`) **спростована**.

---

## Що стало точно відомим

### driveId присутній у момент рендера Footer

TEMP `<small>` блок поряд з кнопкою показав реальні Drive ID для:
- Рішення суду
- Адвокатський запит
- Витяг з ЄДР
- РНОКПП

`document.driveId` = реальний рядок → `hasDrive = !!document.driveId` = `true` → `disabled={!hasDrive}` = `false`.

**Кнопка НЕ disabled** на рівні React props.

### Код-чейн доведено робочим автоматизованим тестом

`tests/integration/documentViewer-workflow.test.jsx:69-89`:
```js
it('Перерозпізнати викликає onReprocess з документом', () => {
  const onReprocess = vi.fn();
  // ... render Viewer with onReprocess prop ...
  fireEvent.click(screen.getByRole('button', { name: /Перерозпізнати/ }));
  expect(onReprocess).toHaveBeenCalledWith(document);
});
```

Тест зелений у всіх 422 тестах. Це означає: у jsdom-середовищі симульований клік по кнопці Перерозпізнати ПРАВИЛЬНО викликає `onReprocess(document)`.

**Висновок:** код-чейн `handleReprocess → onReprocess && onReprocess(document)` працює як треба.

### Що НЕ є причиною

- ❌ Снапшот з `driveId=null` (TEMP блок спростував)
- ❌ `onReprocess === undefined` (тест доводить що prop приходить і викликається)
- ❌ Опечатка в назві prop (grep по `onReprocess` усюди — однакові регістр і написання)
- ❌ Відсутність `onReprocess` у destructure Footer (рядок 20 `DocumentViewerFooter.jsx`)
- ❌ Зайва обгортка з `e.stopPropagation()` (між `<footer>` і `<button>` — нічого, кнопка прямий child)
- ❌ Конкуруюче `disabled` (єдине — `disabled={!hasDrive}`, ніяких aria-disabled, tabIndex=-1)
- ❌ CSS `pointer-events: none` на Footer чи Button (грепнув `.document-viewer__footer`, `.ui-button`, `Button.css` — нема такого)
- ❌ Неправильна передача через `effectiveDoc` (для всіх 4 docs `documentNature` truthy → `effectiveDoc = document` пряме посилання)

---

## Чому ймовірно баг є БРАУЗЕРНИМ (iPad-специфічним)

Якщо тест зелений, але на реальному пристрої не працює — справа в умовах виконання, які тест не моделює:

1. **iOS Safari touch event delivery.** jsdom симулює `click` через `fireEvent`. Реальний браузер на iPad спочатку отримує `touchstart`/`touchend`, а потім синтезує `click`. Між ними може бути:
   - Затримка 300ms (зазвичай прибрана `touch-action: manipulation`, але `<button>` без явного `touch-action` може мати її)
   - Скасування `click` якщо палець зрушив (scroll detection)
   - Перехоплення сторонньою js-обробкою
2. **Накладений елемент тільки на iPad-розкладці.** Тест не рендерить весь App.jsx з агентом, з `materials-layout`, з overlay-панелями. На реальному пристрої поверх Reprocess міг бути:
   - Stuck **persistent toast** з попередньої спроби (toast container `position: fixed; bottom: 24px; right: 24px; max-width: 420px` — на iPad portrait він НАКЛАДАЄТЬСЯ на праву частину Footer; **Перерозпізнати — найправіша кнопка**)
   - Виноска `materials-collapse-toggle` (`position: absolute; z-index: 12`)
   - Резайз-смуга агентної панелі (`zIndex: 10`)
   - Drive iframe який на iOS може перехоплювати touch у нестандартних місцях
3. **Flex-wrap кидає Reprocess за viewport.** Footer має `flex-wrap: wrap; justify-content: space-around` на mobile. На iPad 768–820px з 6 кнопками + іконками + текстом — Reprocess (остання) може опинитись на наступному рядку, обрізаному `overflow: hidden` контейнера `.document-viewer`.

### Чому саме Reprocess стабільно мертва (а інші клікаються нерегулярно)

Reprocess — **остання кнопка** в Footer (правий нижній кут). Toast-контейнер також у правому нижньому куті. **Геометричний overlap** найбільш вірогідний саме для Reprocess. Інші кнопки лівіше — overlap буває рідко (race), частіше клік проходить.

---

## Стуковий persistent toast — найбільш імовірний кандидат

Pipeline (AddDocumentModal:onSubmit, рядки 2881, 2890; onReprocess рядки 2449, 2452, 2474, 2492) показує persistent toast і dismiss його у try/catch. Якщо:
- await ocrService.extractText зависає (мережа, таймаут провайдера) — toast лишається висіти,
- браузер закрив вкладку/перевідкрив — react state зник, toast зник теж (це OK),
- АЛЕ адвокат додавав 7 документів у micro-TASK 3 testing, і кожен показував persistent toast. Якщо хоч один pipeline впав до dismiss — toast стик. Дивиться адвокат бачить його (chip унизу праворуч). Visually-маленький, не помічаєш — але `pointer-events: auto` на `.ui-toast` → перехоплює клік.

Toast.css правило:
```css
.ui-toast { pointer-events: auto; }
.ui-toast-container { pointer-events: none; }
```

Контейнер не блокує, але кожен окремий toast — блокує.

---

## Що зробити для остаточного підтвердження

Адвокат не може DevTools. Тому:

### Швидкий тест без коду

1. Перезавантажити сторінку (F5 / Pull-to-refresh) — це гарантовано прибере всі поточні toast'и (бо Toast state в React тільки в memory).
2. Не запускати ніяких pipeline (не "Перерозпізнати" нічого).
3. Відкрити РНОКПП.
4. Натиснути Перерозпізнати.

**Якщо тепер працює** — діагноз підтверджений: stuck toast перехоплював клік. Лікування — окремий мікро-TASK на покращення UX toast'ів (auto-dismiss після таймауту навіть для persistent, або краща політика dismiss).

**Якщо все ще не працює** — діагноз інший (touch event delivery на iOS), потрібен наступний крок: тимчасовий console.log + remote DevTools (Mac + Safari Develop menu → iPad → Inspect).

### Якщо потрібен console.log

Прошу окремо — додам у `handleReprocess` рядок:
```js
console.log('[Footer] handleReprocess fired, hasDrive=', hasDrive, 'onReprocess=', typeof onReprocess);
```

Адвокат підключить iPad до Mac кабелем, відкриє Safari → Develop → iPad → Inspect → Console. Якщо `[Footer] handleReprocess fired` НЕ з'являється при тапі — проблема в click delivery (touch). Якщо з'являється — проблема всередині `onReprocess` (subFolders missing або щось ще).

---

## Підсумок

| Перевірено | Результат |
|------------|-----------|
| onReprocess prop приходить у Footer | ✅ Так (тест доводить) |
| handleReprocess викликає onReprocess | ✅ Так (тест доводить) |
| document.driveId не null | ✅ Так (TEMP блок підтвердив) |
| disabled={!hasDrive} = false | ✅ Так (з реальним driveId) |
| Інші disabled / aria / tabIndex | ✅ Немає |
| CSS pointer-events: none | ✅ Немає (на Footer/Button) |
| Z-index конфлікт у Viewer | ✅ Немає видимого |
| **Stuck persistent toast — geometric overlap** | ⚠️ **НАЙБІЛЬШ ІМОВІРНА ПРИЧИНА** |
| iOS touch event delivery quirk | ⚠️ Друга гіпотеза |
| Flex-wrap overflow | ⚠️ Третя гіпотеза |

**Найдешевша перевірка:** F5 → одразу спробувати Reprocess. Якщо запрацювало — це був stuck toast.
