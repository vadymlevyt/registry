Глибший трейс закінчений. Чейн коду чистий — нічого не "відрізає" driveId по дорозі. Проблема не в Footer і не в DocumentViewer, а в тому, **який doc-об'єкт зберігається в `selectedDoc` state**.

## Точний трейс driveId від реєстру до Footer

**1. Footer (DocumentViewerFooter.jsx:15–23)**
```js
export function DocumentViewerFooter({ document, ... }) {
  const isScanned = document.documentNature === 'scanned';
  const hasDrive = !!document.driveId;        // ← єдина формула
```
Деструкт прийменника `document` з пропсів. Жодних трансформацій. `hasDrive = !!document.driveId`.

**2. DocumentViewer/index.jsx — пробрасування**
```js
// рядки 86–88
const effectiveDoc = document?.documentNature
  ? document                                    // ← пряме посилання
  : { ...document, documentNature: effectiveNature };  // ← spread зберігає ВСІ поля
```
Для РНОКПП `documentNature='scanned'` truthy → **`effectiveDoc = document` (та сама посилка, без зрізу)**. driveId 100% на місці.
```jsx
// рядок 110
<DocumentViewerFooter document={effectiveDoc} ... />
```

**3. CaseDossier — selectedDoc**
```jsx
// рядок 2337
<div key={doc.id} onClick={() => setSelectedDoc(doc)} ...>
```
- `doc` — об'єкт з `filteredDocs.map(...)`, де `filteredDocs` походить з `caseData.documents`.
- `setSelectedDoc(doc)` зберігає **знімок** доки на момент кліка.
- `selectedDoc` — **незалежний React state**, він НЕ синхронізується автоматично коли `cases[]` оновлюється.

Передача в DocumentViewer:
```jsx
// рядок 2414
<DocumentViewer document={selectedDoc} ... />
```

## Точна причина

Якщо `disabled` справді встановлено браузером → `hasDrive = false` → `selectedDoc.driveId` falsy на момент рендера Footer. **Хоча в файлі реєстру driveId є**.

Конкретний механізм як `selectedDoc` міг отримати `driveId=null`:

> На момент кліку на список документів `caseData.documents[i].driveId` БУВ `null`/відсутній. Користувач клікнув — `setSelectedDoc(doc-with-null)`. Згодом цей же `i`-й елемент в `caseData.documents` отримав `driveId="1kdram..."` (Drive sync завершився, чи був перезавантажений з диска). Але **`selectedDoc` залишився старим знімком з null**.

Це не баг micro-TASK 4 — це **давня архітектурна вада selectedDoc-snapshot pattern**. micro-TASK 4 її не зачіпав ні в чому: фікс update_document (App.jsx:5307) і додавання корекції в onReprocess (CaseDossier:2466) обидва не торкаються `driveId`, `selectedDoc`, чи рендеру Viewer.

## Що ще могло привести до `driveId=null` в `selectedDoc` саме для РНОКПП #2

Перевірив три кандидати:

1. **AddDocumentModal pipeline** (CaseDossier:2811) при додаванні зберігає `driveId` отриманий від `uploadFileLocal` ДО виклику `add_document`. Якщо upload провалився, `add_document` все одно відпрацьовує з `driveId=null` (CaseDossier:2814–2822 catch без throw). Потім, якщо адвокат вручну скоригував `driveId` через інший шлях — `selectedDoc` лишається з null.

2. **onUpdate (рядок 2417–2423)** — викликається auto-fill useEffect у DocumentViewer для доків БЕЗ documentNature. Для РНОКПП='scanned' цей useEffect early returns (рядок 64). Не зачіпає РНОКПП.

3. **Drive sync useEffect** (App.jsx) при перезавантаженні реєстру з диска перезаписує `cases[]`. selectedDoc від цього не оновлюється (нема ефекта що його синхронізує).

## Що очікую побачити у console.log в Footer

Якщо додати `console.log('[Footer]', { driveId: document.driveId, name: document.name, mimeType: document.mimeType, fullDoc: document })` перед рядком 23:

- `document.driveId` → `null` або `undefined` (підтвердить діагноз)
- `document.name` → `"РНОКПП"` (підтвердить що це той самий документ що адвокат бачить)
- `fullDoc` → можна порівняти з тим що в реєстрі. Якщо driveId реально null у `fullDoc`, то state поломаний.

## Де треба поправити (на майбутнє, після підтвердження діагнозу)

**Не у Footer**, не в DocumentViewer, не в Footer disabled-логіці. **У CaseDossier — переробити `selectedDoc` зі snapshot на ID-based lookup:**

```jsx
// замість
const [selectedDoc, setSelectedDoc] = useState(null);
// зробити
const [selectedDocId, setSelectedDocId] = useState(null);
const selectedDoc = selectedDocId
  ? (caseData.documents || []).find(d => d.id === selectedDocId)
  : null;
```

Тоді selectedDoc завжди читає АКТУАЛЬНУ версію документа з cases[]. Як тільки driveId оновиться в реєстрі — Footer одразу побачить.

Це не локальний фікс — змінює архітектурний паттерн, тому потребує окремого мікро-TASK з обережним прогоном (бо `setSelectedDoc(...)` викликається у багатьох місцях).

## Альтернативний короткий шлях для адвоката зараз (без коду)

Закрити Viewer (хрестик) → відкрити РНОКПП знову з реєстру. Якщо при новому кліку driveId уже актуальний у `caseData.documents`, новий `selectedDoc` буде з правильним driveId і кнопка одразу стане активна.

Не виправляю — чекаю від адвоката або (а) console.log/DevTools підтвердження що `selectedDoc.driveId` справді null, або (б) рішення про окремий мікро-TASK на ID-based selectedDoc.
