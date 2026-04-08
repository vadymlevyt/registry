# TASK.md — Нарізка PDF: читання пакетами + агент + pdf-lib
Дата: 08.04.2026

## МЕТА

Реалізувати повний флоу нарізки PDF на окремі документи:
1. Завантажив файл → pdfjs рендерить сторінки
2. Claude читає пакетами і визначає межі документів
3. Агент показує структуру в чаті досьє і приймає команди
4. pdf-lib нарізає після підтвердження
5. Файли записуються на Drive в 02_ОБРОБЛЕНІ

---

## КРОК 0 — ПРОЧИТАТИ LESSONS.md
```bash
cat LESSONS.md
```

---

## КРОК 1 — ДІАГНОСТИКА

```bash
# Поточний стан Document Processor
grep -n "pdfjs\|PDFDocument\|split\|splitPoints\|analyzeFile\|handleConfirm" src/components/DocumentProcessor/index.jsx | head -30

# Чи встановлений pdf-lib
grep "pdf-lib" package.json

# Чи встановлений pdfjs-dist
grep "pdfjs-dist" package.json
```

---

## КРОК 2 — ВСТАНОВИТИ ЗАЛЕЖНОСТІ ЯКЩО НЕМАЄ

```bash
npm list pdf-lib 2>/dev/null || npm install pdf-lib
npm list pdfjs-dist 2>/dev/null || npm install pdfjs-dist
```

---

## КРОК 3 — ФУНКЦІЯ РЕНДЕРИНГУ СТОРІНОК ЧЕРЕЗ PDFJS

```jsx
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

// Рендерити сторінки PDF в base64 зображення
async function renderPagesToImages(arrayBuffer, pageNumbers) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const images = [];

  for (const pageNum of pageNumbers) {
    if (pageNum > pdf.numPages) break;

    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.2 }); // достатня якість для читання

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: canvas.getContext('2d'),
      viewport,
    }).promise;

    const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    images.push({ pageNum, base64 });
  }

  return images;
}
```

---

## КРОК 4 — ФУНКЦІЯ АНАЛІЗУ МЕЖ ДОКУМЕНТІВ

Читати PDF пакетами по 10 сторінок і знаходити межі:

```jsx
async function analyzePDFBoundaries(arrayBuffer, totalPages, apiKey, caseContext) {
  const BATCH_SIZE = 10;
  const allBoundaries = [];

  for (let start = 1; start <= totalPages; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, totalPages);
    const pageNumbers = Array.from({ length: end - start + 1 }, (_, i) => start + i);

    const images = await renderPagesToImages(arrayBuffer, pageNumbers);

    const content = [
      ...images.map(img => ({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: img.base64 }
      })),
      {
        type: 'text',
        text: `Це сторінки ${start}-${end} з ${totalPages} PDF файлу судової справи.
${caseContext ? `Контекст справи: ${caseContext}` : ''}

Визнач де починаються нові документи на цих сторінках.
Шукай: нові заголовки, печатки, підписи, нову нумерацію, зміну типу документа.

Поверни ТІЛЬКИ JSON:
{
  "boundaries": [
    {
      "page": 1,
      "isNewDocument": true,
      "documentType": "Титульна сторінка судової справи",
      "confidence": 0.95
    }
  ]
}

Якщо на цих сторінках немає нових документів — поверни {"boundaries": []}`
      }
    ];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content }]
      })
    });

    const data = await response.json();
    const text = data.content[0].text;

    try {
      const clean = text.replace(/```json|```/g, '').trim();
      const result = JSON.parse(clean);
      allBoundaries.push(...(result.boundaries || []));
    } catch (e) {
      console.warn('Пакет', start, '-', end, ': помилка парсингу', e);
    }
  }

  return allBoundaries;
}
```

---

## КРОК 5 — ФОРМУВАННЯ SPLIT POINTS З МЕЖ

```jsx
function boundariesToSplitPoints(boundaries, totalPages) {
  // Відфільтрувати тільки нові документи з достатньою впевненістю
  const newDocs = boundaries
    .filter(b => b.isNewDocument && b.confidence > 0.7)
    .sort((a, b) => a.page - b.page);

  // Якщо першою сторінкою немає — додати
  if (newDocs.length === 0 || newDocs[0].page !== 1) {
    newDocs.unshift({ page: 1, documentType: 'Документ 1', confidence: 1 });
  }

  // Сформувати split_points з початком і кінцем кожного документа
  return newDocs.map((doc, i) => ({
    name: doc.documentType,
    startPage: doc.page,
    endPage: i + 1 < newDocs.length ? newDocs[i + 1].page - 1 : totalPages,
    confidence: doc.confidence,
  }));
}
```

---

## КРОК 6 — НАРІЗКА ЧЕРЕЗ PDF-LIB

```jsx
import { PDFDocument } from 'pdf-lib';

async function splitPDF(arrayBuffer, splitPoints) {
  const srcDoc = await PDFDocument.load(arrayBuffer);
  const results = [];

  for (const part of splitPoints) {
    const newDoc = await PDFDocument.create();

    const pageIndices = Array.from(
      { length: part.endPage - part.startPage + 1 },
      (_, i) => part.startPage - 1 + i // 0-indexed
    );

    const pages = await newDoc.copyPages(srcDoc, pageIndices);
    pages.forEach(p => newDoc.addPage(p));

    // Стиснення
    const bytes = await newDoc.save({ useObjectStreams: true });

    results.push({
      name: part.name,
      startPage: part.startPage,
      endPage: part.endPage,
      pageCount: pageIndices.length,
      data: bytes,
      sizeMB: (bytes.byteLength / 1024 / 1024).toFixed(2),
    });
  }

  return results;
}
```

---

## КРОК 7 — ІНТЕГРАЦІЯ В DOCUMENT PROCESSOR

### State:
```jsx
const [pdfArrayBuffer, setPdfArrayBuffer] = useState(null);
const [totalPages, setTotalPages] = useState(0);
const [analyzingBoundaries, setAnalyzingBoundaries] = useState(false);
const [splitPoints, setSplitPoints] = useState([]);
const [splitResults, setSplitResults] = useState([]);
const [analysisProgress, setAnalysisProgress] = useState(0);
```

### При завантаженні файлу:
```jsx
const handleFileLoad = async (file) => {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  setPdfArrayBuffer(buffer);
  setTotalPages(pdf.numPages);

  // Повідомити агента
  addAgentMessage(`📄 Завантажено: ${file.name} (${pdf.numPages} сторінок)\n\nЩо зробити?\n• Написати "нарізати" — я визначу межі документів автоматично\n• Або опишіть що є в файлі і як нарізати`);
};
```

### Команда "нарізати" в чаті агента:
```jsx
// В обробнику повідомлень агента — якщо команда на нарізку:
if (userMessage.toLowerCase().includes('нарізати') || userMessage.toLowerCase().includes('розріж')) {
  await handleAnalyzeBoundaries(userMessage);
  return;
}

const handleAnalyzeBoundaries = async (userHint) => {
  if (!pdfArrayBuffer) {
    addAgentMessage('❌ Спочатку завантажте PDF файл');
    return;
  }

  setAnalyzingBoundaries(true);
  addAgentMessage(`🔍 Аналізую ${totalPages} сторінок пакетами по 10...\n(~${Math.ceil(totalPages/10)} запитів до API)`);

  try {
    const caseContext = userHint + (caseData ? ` Справа: ${caseData.name}` : '');
    const boundaries = await analyzePDFBoundaries(
      pdfArrayBuffer,
      totalPages,
      apiKey,
      caseContext
    );

    const points = boundariesToSplitPoints(boundaries, totalPages);
    setSplitPoints(points);

    // Показати структуру деревом в чаті
    const tree = points.map((p, i) =>
      `${i+1}. 📄 ${p.name}\n   Сторінки: ${p.startPage}-${p.endPage} (${p.endPage - p.startPage + 1} стор.)`
    ).join('\n\n');

    addAgentMessage(`Знайдено ${points.length} документів:\n\n${tree}\n\nПідтвердити нарізку? Або скажіть що змінити.`);

  } catch (e) {
    addAgentMessage(`❌ Помилка аналізу: ${e.message}`);
  } finally {
    setAnalyzingBoundaries(false);
  }
};
```

### Команда "підтвердити" — нарізка і запис:
```jsx
if (userMessage.toLowerCase().includes('підтвердити') || userMessage.toLowerCase().includes('так')) {
  if (splitPoints.length === 0) return;

  addAgentMessage('✂️ Нарізаю...');

  const results = await splitPDF(pdfArrayBuffer, splitPoints);
  setSplitResults(results);

  // Записати на Drive якщо є папка
  const token = localStorage.getItem('levytskyi_drive_token');
  const folderId = caseData?.storage?.driveFolderId;

  if (token && folderId) {
    addAgentMessage('☁️ Записую на Drive...');

    // Знайти папку 02_ОБРОБЛЕНІ
    const subRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and name='02_ОБРОБЛЕНІ' and mimeType='application/vnd.google-apps.folder'`)}&fields=files(id)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const subData = await subRes.json();
    const processFolderId = subData.files?.[0]?.id || folderId;

    for (const result of results) {
      const fileName = `${result.name.replace(/[/\\:*?"<>|]/g, '_')}.pdf`;
      const blob = new Blob([result.data], { type: 'application/pdf' });

      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify({
        name: fileName,
        parents: [processFolderId],
      })], { type: 'application/json' }));
      form.append('file', blob);

      await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }
      );
    }

    // Оновити Матеріали
    const newDocs = results.map(r => ({
      id: `doc_${Date.now()}_${Math.random().toString(36).substr(2,6)}`,
      name: r.name,
      pageCount: r.pageCount,
      folder: '02_ОБРОБЛЕНІ',
      status: 'ready',
      addedAt: new Date().toISOString(),
    }));

    updateCase(caseData.id, 'documents', [...(caseData.documents || []), ...newDocs]);

    const summary = results.map(r =>
      `✅ ${r.name} — ${r.pageCount} стор., ${r.sizeMB} МБ`
    ).join('\n');

    addAgentMessage(`Готово! ${results.length} документів:\n\n${summary}\n\nВкладка Матеріали оновлена.`);

  } else {
    // Без Drive — запропонувати завантажити
    addAgentMessage(`✅ Нарізано ${results.length} документів в пам'яті.\n\n⚠️ Drive не підключено — підключіть в блоці Сховище щоб зберегти.`);
  }
}
```

---

## КРОК 8 — АГЕНТ ОТРИМУЄ КОНТЕКСТ ЗАВАНТАЖЕНИХ ФАЙЛІВ

В system prompt агента досьє на вкладці "Робота з документами" додати:

```js
const docProcessorContext = pdfArrayBuffer
  ? `\n\nЗавантажений файл: ${uploadedFileName} (${totalPages} сторінок)${
      splitPoints.length > 0
        ? `\nВизначена структура:\n${splitPoints.map((p,i) => `${i+1}. ${p.name} (стор. ${p.startPage}-${p.endPage})`).join('\n')}`
        : '\nСтруктура ще не визначена.'
    }`
  : '\n\nФайлів не завантажено.';
```

---

## ПОРЯДОК ВИКОНАННЯ

1. Діагностика
2. npm install pdf-lib pdfjs-dist якщо немає
3. Додати renderPagesToImages
4. Додати analyzePDFBoundaries
5. Додати splitPDF
6. Інтегрувати в Document Processor
7. Підключити агент досьє до процесора

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "feat: PDF boundary detection + split via pdfjs and pdf-lib" && git push origin main
```

## ЧЕКЛІСТ

- [ ] Завантажив PDF → агент повідомляє кількість сторінок
- [ ] Написав "нарізати" → агент аналізує пакетами і показує структуру деревом
- [ ] Можна сказати "з'єднай 3 і 4" або "сторінка 12 це продовження позовної"
- [ ] Написав "підтвердити" → pdf-lib нарізає
- [ ] Файли записуються на Drive в 02_ОБРОБЛЕНІ
- [ ] Вкладка Матеріали оновлюється

## ПІСЛЯ ВИКОНАННЯ — ДОПИСАТИ В LESSONS.md

```
### [2026-04-08] PDF нарізка — pdfjs + Claude Vision + pdf-lib
pdfjs рендерить сторінки в base64 JPEG (scale 1.2, quality 0.8)
Пакети по 10 сторінок → Claude Vision визначає межі
boundariesToSplitPoints() — фільтрує confidence > 0.7
pdf-lib нарізає по 0-indexed сторінках
Стиснення: PDFDocument.save({ useObjectStreams: true })
Запис на Drive: multipart upload в 02_ОБРОБЛЕНІ
```
