# Звіт мікро-TASK 5.2-fix3

**Дата:** 2026-05-10
**Гілка:** main
**Тести:** 481 passed (38 test files), без нових
**Build:** чистий

---

## 1. DOCX — один сувій (CSS до/після)

### До

```css
.docx-page {
  background: white !important;
  max-width: 794px;
  width: 100%;
  margin: 0 auto;
  padding: 60px 80px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  min-height: 1123px;     /* ← обрізало довгий контент */
  box-sizing: border-box;
  color: black !important;
}
```

Корінь проблеми: `min-height: 1123px` (A4 висота при 96 DPI) гарантував мінімум A4-аркуш для коротких документів. Але для довших — аркуш не розширювався далі цієї висоти, бо `min-height` не керує верхньою межею. Контент перевищував висоту аркуша і виходив на сірий фон батька.

### Після

```css
.docx-page {
  background: white !important;
  max-width: 794px;
  width: 100%;
  margin: 0 auto;
  padding: 60px 80px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  box-sizing: border-box;
  color: black !important;
}
```

Прибрано `min-height`. Тепер аркуш росте під весь контент: короткий документ = малий аркуш, позовна заява з таблицею і додатками = довгий сувій. Сірий фон навколо — від батька `.document-viewer__content--docx { background: #e8e8ec }`.

Не розділяємо на окремі сторінки A4 — це поза скопом і вимагає JS-вимірювань висоти. Один довгий аркуш достатньо для адвокатської роботи.

---

## 2. PDF — Android touch helpers off

### Точні правила і причина кожного

#### `.pdf-page` (контейнер сторінки)

```css
-webkit-touch-callout: none;
```
Раніше було `default`. Викликало системне меню Chrome Android («Поділитись/Друк/Viber») при long-tap на елементи з зображенням-подібною роллю. canvas трактується як image, тож callout: default → системне меню. Тепер `none` блокує цю поведінку — long-tap викликає тільки native text selection через textLayer що зверху.

```css
-webkit-tap-highlight-color: transparent;
```
Прибирає сірий highlight-прямокутник що мерехтить при будь-якому тапі на Chrome Android. Для PDF viewer це лише шум — виділення відбувається через native ::selection.

```css
text-size-adjust: none;
-webkit-text-size-adjust: none;
```
Блокує авто-перерахунок шрифту під ширину екрана (Mobile Safari/Chrome робить це для веб-сторінок). Якщо браузер автоматично збільшував би шрифт span'ів textLayer — span'и зміщувались би відносно canvas, бо canvas рендериться у фіксованому масштабі. Це і провокувало стрибки виділення.

```css
touch-action: pan-y;
```
Залишено з 5.2-fix2. Дозволяє вертикальний скрол сторінки одночасно з виділенням — pinch-zoom і horizontal pan заблоковано.

#### `.pdf-page__canvas`

```css
pointer-events: none;       /* з 5.2-fix2 */
-webkit-touch-callout: none;
-webkit-user-select: none;
user-select: none;
-webkit-user-drag: none;
```

`-webkit-user-drag: none` — додано в цьому фіксі. Без нього на Android long-press canvas міг ініціювати drag-and-drop image gesture (з системним меню «зберегти зображення»). Тепер canvas повністю інертний на touch — усі gestures проходять у textLayer.

#### `.pdf-page__text-layer` (textLayer overlay)

```css
user-select: text;
-webkit-user-select: text;
-webkit-user-modify: read-only;     /* НОВЕ */
cursor: text;
line-height: 1.15;                  /* НОВЕ — для проблеми 3 */
```

`-webkit-user-modify: read-only` — важливе. Magnifier-лінза в Chrome Android з'являється при long-tap на contenteditable елементах (input, textarea, contenteditable=true). Якщо браузер не впевнений у редагованості елемента — теж може показати лінзу як precaution. `read-only` явно повідомляє «це не редаговане поле, magnifier не потрібен». На текст selection toolbar це не впливає — він лишається.

#### `index.html` — `<meta name="format-detection">`

```html
<meta name="format-detection" content="telephone=no, email=no, address=no" />
```

Блокує авто-конвертацію телефонних номерів, email і адрес у tap-able лінки на iOS Safari і Chrome Android. У судовому документі телефон чи email — це звичайний текст, не лінк. Без цього long-tap на номер викликав «Подзвонити/Зберегти контакт» замість виділення.

---

## 3. Зміщення виділення — обраний варіант

### Аналіз

`pdfjsLib.TextLayer` (новий API 5.x) позиціонує span'и за **baseline** тексту. `font-size` span'а = висота літери від baseline до vertex (top). Хвостики літер `р, у, д, ц, щ, ф` спускаються нижче baseline — у box span'а вони НЕ потрапляють. ::selection покриває box span'а → нижня частина літер залишається відкритою.

### Розглянуті варіанти

| Варіант | Оцінка |
|---------|--------|
| (а) `transform: translateY(1px)` на textLayer | Зсуне ВЕСЬ шар вниз — текст і виділення поза синхронізацією з canvas |
| (б) `padding-bottom` на span | ✅ Точкове розширення box span'а вниз. Не впливає на сусідів бо span'и `position: absolute` |
| (в) `line-height` > 1 на span | ✅ Збільшує line-box, ::selection покриває більше |
| (г) padding на ::selection | ::selection не приймає padding (вузький pseudo-selector) |

### Обраний — комбінація (б)+(в)

```css
.pdf-page__text-layer {
  line-height: 1.15;
}
.pdf-page__text-layer :is(span, br) {
  padding-bottom: 0.15em;
}
```

**Чому комбінація:**
- `line-height: 1.15` на textLayer наслідується span'ами через casacade (span'и не мають власного line-height у pdfjs CSS). Це збільшує line-box span'а на 15% font-size — приблизно покриває descender hight (зазвичай 12-15% для Times шрифтів).
- `padding-bottom: 0.15em` додатково розширює content area span'а на 15% font-size вниз. На absolute-positioned span'ах padding не впливає на сусідів — вони лежать поруч за координатами pdfjs.
- Текст у canvas залишається на місці (canvas рендериться окремо). Виділення тепер покриває повну висоту літер включно з хвостиками.

**Чому НЕ варіант (а):** transform translateY змінює screen-position span'ів відносно canvas. Адвокат тапає на букву на canvas → курсор виділення спускається на span який тепер на 1-2px нижче. Click target йде нижче візуальної букви — виділяється не та літера яку адвокат торкнувся.

---

## 4. Інструкція тестування

### а) Позовна заява DOCX (один сувій)

1. Відкрити позовну заяву з таблицею і додатками — документ що раніше обрізався на середині.
2. Очікування: один довгий білий аркуш від першого до останнього параграфа. Скрол униз показує безперервний білий фон (з тінню по краях) — НЕ переходить на сірий фон у середині.
3. Якщо документ короткий — аркуш короткий, з тінню. Якщо довгий — аркуш довгий, теж з тінню по всьому периметру.

### б) PDF — рішення суду (Android touch helpers off + selection alignment)

1. Відкрити будь-який PDF searchable у досьє справи.
2. **Tap-and-hold на тексті:**
   - НЕ повинно з'явитись системне меню «Поділитись/Друк/Viber» (callout: none).
   - НЕ повинна з'явитись magnifier-лінза (user-modify: read-only).
   - Повинен з'явитись native text selection toolbar (Копіювати/Виділити все/Поділитись текстом — стандартні).
3. **Drag для розширення виділення** через 2-3 рядки:
   - Виділення покриває ВСЮ висоту літер включно з хвостиками `р, у, д, ц, щ, ф` (а не лише верхню частину тексту).
   - Виділення рухається плавно, не стрибає, не вилазить за межі сторінки.
4. **Тап на телефонний номер у тексті** (якщо є в документі):
   - Не повинно відкритись «Подзвонити X / Зберегти контакт» (format-detection: telephone=no).
   - Тап працює як звичайний тап для виділення.

### в) Решта без змін

- HTML рендер (ЄСІТС, ухвали з реєстру) — без змін.
- DOCX justify/center/right alignment — як було в 5.2-fix2.
- Scanned PDF, JPG/PNG — без змін.
- Footer кнопки, AddDocumentModal — без змін.

---

## 5. Що НЕ зроблено і чому

- **Не розділяли DOCX на окремі сторінки A4.** За ТЗ — один сувій достатньо. Реалізація pagination через JS-вимірювання висоти — окремий складний TASK, поза скопом.

- **Не міняли HtmlRenderer.** За ТЗ — там вже працює правильно після 5.2-fix2. Зміни callout/user-modify актуальні тільки для PDF канви, для iframe HTML вони не потрібні (iframe має власну ізоляцію touch handling).

- **Не переходили на iframe pdfjs viewer.** Спочатку доводимо canvas+textLayer. Якщо після цього фіксу адвокат все ще скаржиться на UX — переходимо на iframe з повним viewer (окремий TASK).

- **Не додавали JS логіку для блокування long-tap event.** CSS правил вистачає. Додатковий JS-перехоплювач (`event.preventDefault` на touchstart) міг би заблокувати і native text selection — це гірше за поточний результат.

- **Не змінювали PdfRenderer.jsx.** Усі зміни — суто CSS у DocumentViewer.css і HTML meta-тег. Логіка JSX залишилась з 5.2-fix2.

- **Не додавали тестів.** Зміни — суто CSS і meta-теги, які перевіряються в браузері. Існуючі 481 тестів (включно з 28 unit тестами для htmlCharsetDetection) лишаються зеленими.
