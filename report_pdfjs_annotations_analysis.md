# Аналіз — перехоплення анотацій Mozilla pdfjs у нашому Viewer

**Дата:** 2026-05-12
**Версія pdfjs:** 5.6.205
**Контекст:** Перед прийняттям рішення по DOCX/HTML конвертації — критичне питання: чи можна використати вбудований редактор анотацій pdfjs (highlight, нотатки, олівець, підкреслення) у нашому iframe-вьювері і зберігати анотації окремим JSON-шаром на Drive (без переписування PDF файлу).

Якщо анотації Mozilla реально перехоплюються — конвертація DOCX/HTML у PDF має сенс (адвокат отримає маркер і нотатки на всіх документах). Якщо ні — варіант D (revert конвертації) виграє.

---

## 1. Доступ до annotationStorage через iframe

**Так, доступний.** У `viewer.mjs:19958`:

```js
window.PDFViewerApplication = PDFViewerApplication;
```

Наш blob URL same-origin з нашою сторінкою → `iframe.contentWindow.PDFViewerApplication` доступний з parent React. Через нього:

- `app.pdfDocument.annotationStorage.setValue(key, value)` — є
- `app.pdfDocument.annotationStorage.serializable` — getter повертає `{ map, hash, transfer }` усіх анотацій
- `app.pdfDocument.annotationStorage.remove(key)`, `.size`, `.has(key)` — є
- `app.eventBus` — є

**postMessage не потрібен.** Працюємо прямо через `contentWindow` бо same-origin.

---

## 2. Чи pdfjs eventBus передає події змін анотацій

**Ні. Прямої події «анотація додана/змінена/видалена з деталями» немає.**

У eventBus є тільки мета-події:
- `annotationeditormodechanged` — режим редактора (highlight/ink/text/none)
- `annotationeditorparamschanged` — параметри (колір, товщина)
- `switchannotationeditormode`, `switchannotationeditorparams` — командні

**Але є callbacks на `annotationStorage` сам:**

```js
app.pdfDocument.annotationStorage.onSetModified = () => { ... };
app.pdfDocument.annotationStorage.onResetModified = () => { ... };
app.pdfDocument.annotationStorage.onAnnotationEditor = (typeStr) => { ... };
```

Viewer **уже використовує** `onSetModified` і `onResetModified` (line 18981–18989 у viewer.mjs). Можемо **обгорнути** ці callbacks зі збереженням оригіналу:

```js
const orig = app.pdfDocument.annotationStorage.onSetModified;
app.pdfDocument.annotationStorage.onSetModified = () => {
  orig?.();
  // наш hook — debounce + serializable + save до Drive
};
```

Callback викликається на **кожен `setValue`** (line 6817). Тобто на кожен click/draw — а не на завершення жесту. Потрібен debounce 500–2000 мс.

---

## 3. Чи pdfjs відрізняє «свіжо намальовану» і «програмно додану»

**За замовчуванням — ні.** `setValue` для обох випадків викликає `onSetModified` однаково. У коді є мітка `isClone` (line 3490) яка проставляється при clipboard paste — але це не наша мітка, ми не контролюємо її поведінку у Mozilla.

**Рішення — власний flag-блокувальник:**

```js
let isRestoring = false;
// при завантаженні з Drive:
isRestoring = true;
for (const [id, data] of savedMap) annotationStorage.setValue(id, data);
isRestoring = false;
// у callback:
if (isRestoring) return;
```

Це стандартна техніка, працює надійно. **Підтверджено для версії 5.6.205** — `setValue` синхронний, flag spans тільки restore-loop.

---

## 4. Обсяг роботи на повну інтеграцію

| Кусок | Рядків | Складність |
|-------|--------|------------|
| Чекати `PDFViewerApplication.initializedPromise`, attach hooks | ~30 | Тривіально |
| Debounce + `serializable` → JSON | ~50 | Тривіально |
| Save до Drive (новий файл `<basename>_<driveId>.annotations.json` у `02_ОБРОБЛЕНІ`) | ~30 | Тривіально |
| Load з Drive при відкритті документа | ~50 | Просто |
| **Restore через `setValue` + render на сторінці** | ~80 | **Складно** — `setValue` додає до storage, але не малює на сторінці. Для рендеру потрібен **internal API** `currentLayer.deserialize(editorData) → currentLayer.addOrRebuild(editor)` (line 3503-3506). Це **private** методи AnnotationEditorUIManager — Mozilla не дає гарантії що залишаться. |
| Flag-блокувальник feedback loop | ~20 | Тривіально |
| Тести з mock PDFViewerApplication | ~150 | Середньо |
| **Сумарно** | **~410 рядків** | + 1-2 дні дебагу |

**Bundle:** +0 КБ (pdfjs уже завантажений).

---

## 5. Альтернативи маркера/нотаток (без перехоплення pdfjs editor)

Розставлено за зростанням складності:

### A) Просто текстова нотатка до документа (~півдня)

Поле «коментар до документа» у CaseDossier під вьювером. Без графічних маркерів. Зберігається у `cases[].documents[].notes` (legacy поле що вже існує) або в `documents_extended.json`. Працює для будь-якого формату (PDF, DOCX, HTML).

### B) Цитати-references (~2-3 дні)

Адвокат виділяє текст у Viewer → кнопка «Зберегти як цитату» → зберігається `{ documentId, text, caseId, comment }`. Без координат — прив'язка до **тексту**, не до пікселя. Працює з усіма форматами, переживає перерозпізнавання документа. Окремий список цитат у досьє.

### C) MarkerJS або fabric.js overlay (~3-4 дні, +150 КБ)

Власний canvas-шар поверх iframe з готовою бібліотекою draw/highlight/text-tools. Не використовує pdfjs editor взагалі. Працює з ЛЮБИМ рендером (PDF iframe, DocxRenderer, HtmlRenderer — всюди). Контрольований API, без ризику internal pdfjs.

### D) Гібрид: pdfjs editor + наш save layer (~410 рядків + ризик)

Як описано вище. Найбільш «нативно». Найбільший ризик регресій при оновленні pdfjs.

---

## Ризики гібридного варіанту D

1. **Internal API** (`#addEditorToLayer`, `layer.deserialize`, `layer.addOrRebuild`) — приватні. Mozilla може зламати у наступних версіях. Pdfjs релізить кожні 1-2 місяці. У минулому інтерфейс анотацій вже мінявся (pdfjs 4.x → 5.x — серйозні зміни).

2. **Анотації pdfjs зберігають координати на сторінці у points** — при будь-якій зміні документа (наприклад заміна на нову версію PDF) координати «попливуть».

3. **Mozilla pdfjs анотації прив'язані до PDF-структури**, не до тексту. Якщо OCR перерозпізнає документ — анотації на тому ж місці, але тексту може там не бути.

---

## Висновок для рішення по DOCX/HTML

**Перехоплення анотацій Mozilla pdfjs у нашій версії — реально, але:**

1. **Не «безкоштовно».** ~410 рядків коду + покладання на internal API (`layer.deserialize`, `layer.addOrRebuild`) які приватні. Кожен апдейт pdfjs може зламати restore-частину (Mozilla змінювала анотації між 4.x → 5.x).

2. **Працює тільки для PDF.** DOCX/HTML через DocxRenderer/HtmlRenderer pdfjs не використовують. Якщо обрати варіант D (revert) — анотацій на DOCX/HTML не буде.

3. **Альтернатива «цитати-references» (варіант B вище) дає те саме функціонально**, але працює **для всіх форматів** і **не залежить від internal pdfjs**.

**Тобто питання не «PDF дає маркер, інші ні» — це справді так _якщо обираємо pdfjs editor_.** Питання насправді: «pdfjs editor проти власної реалізації цитат». Якщо адвокат точно хоче саме _візуальний highlight на координатах_ (як у Acrobat) — pdfjs editor виграє, варіант B revert невигідний. Якщо «знайти цитату пізніше + коментар» достатньо — варіант B зрівнює.

**Для прийняття рішення по DOCX/HTML додатково спитати:**
- Чи адвокат уже намалював highlight у Drive PDF Viewer (де він зберігається в самому PDF файлі) і хоче таке ж у нашому Viewer?
- Чи його реальна потреба — «знайти важливі шматки тексту пізніше» (це варіант B), або «візуально позначити для презентації клієнту/суду» (це варіант D-гібрид)?

---

## Що адвокат вирішує

1. Якщо обрати **варіант B (цитати-references)** як систему анотацій — тоді DOCX/HTML конвертація НЕ потрібна → можна йти варіантом D (revert конвертації) із попереднього звіту.

2. Якщо обрати **варіант D-гібрид (pdfjs editor + наш save layer)** як систему анотацій — тоді конвертація DOCX/HTML у PDF МАЄ сенс, бо тільки через pdfjs editor працює маркер.

3. Якщо обрати **варіант C (canvas overlay поверх iframe)** — теж не потребує конвертації DOCX/HTML, працює над DocxRenderer/HtmlRenderer однаково з PDF.

Рішення по DOCX/HTML конвертації **залежить від рішення по системі анотацій**, не навпаки.

---

**Кінець звіту**
