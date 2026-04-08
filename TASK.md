# TASK.md — PDF нарізка через document block (один запит)
Дата: 08.04.2026

## СУТЬ

Замість pdfjs + пакети зображень — відправляти PDF напряму як document block.
Anthropic читає весь PDF в одному запиті. Дешевше і точніше.

Офіційний формат (docs.anthropic.com/en/docs/build-with-claude/pdf-support):
```json
{
  "type": "document",
  "source": {
    "type": "base64",
    "media_type": "application/pdf",
    "data": "<base64>"
  }
}
```

---

## КРОК 0 — ПРОЧИТАТИ LESSONS.md
```bash
cat LESSONS.md
```

---

## КРОК 1 — ДІАГНОСТИКА

```bash
# Знайти поточну логіку аналізу PDF
grep -n "analyzePDF\|pdfjs\|renderPage\|document.*block\|split_points\|splitPoints\|boundaries" src/components/DocumentProcessor/index.jsx | head -30

# Знайти де відправляється запит до API
grep -n "fetch.*anthropic\|api\.anthropic\|messages.*content" src/components/DocumentProcessor/index.jsx | head -20
```

Показати результати перед змінами.

---

## КРОК 2 — ЗАМІНИТИ АНАЛІЗ НА DOCUMENT BLOCK

Знайти функцію що аналізує PDF і замінити на:

```jsx
async function analyzePDFWithDocumentBlock(file, apiKey, userHint) {
  // Крок 1: конвертувати файл в base64
  const arrayBuffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  const base64 = btoa(binary);

  // Крок 2: відправити як document block — один запит
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64,
            }
          },
          {
            type: 'text',
            text: `Це PDF файл судової справи. ${userHint ? `Контекст: ${userHint}` : ''}

Прочитай весь документ і визнач де починається кожен окремий документ.
Шукай: нові заголовки, печатки, підписи, нову нумерацію сторінок, зміну типу документа.

Поверни ТІЛЬКИ JSON без жодного тексту до або після:
{
  "totalPages": 65,
  "documents": [
    {
      "name": "Титульна сторінка судової справи",
      "startPage": 1,
      "endPage": 1,
      "type": "court_cover"
    },
    {
      "name": "Позовна заява Брановської Л.Б.",
      "startPage": 2,
      "endPage": 8,
      "type": "pleading"
    }
  ]
}

Типи документів (type):
- court_cover: титульна сторінка справи
- pleading: позовна заява, відзив, заперечення
- court_act: ухвала, рішення, постанова суду
- evidence: докази, додатки, довідки
- certificate: свідоцтво, витяг з реєстру
- contract: договір, угода
- other: інше

ВАЖЛИВО: визначай межі тільки на основі реального вмісту. Не вигадуй документи яких немає.`
          }
        ]
      }]
    })
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.message);
  }

  const text = data.content[0].text;

  // Парсити JSON
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    throw new Error('Не вдалось розпізнати структуру документа: ' + text.substring(0, 200));
  }
}
```

---

## КРОК 3 — ВИПРАВИТИ НАРІЗКУ PDF-LIB

Поточна помилка: `Cannot read properties of undefined (reading 'node')`
Це помилка при завантаженні pdf-lib. Виправити імпорт:

```bash
# Перевірити як імпортується pdf-lib
grep -n "pdf-lib\|PDFDocument\|import.*pdf" src/components/DocumentProcessor/index.jsx | head -10
```

Правильний імпорт:
```jsx
import { PDFDocument } from 'pdf-lib';
```

Або якщо dynamic import:
```jsx
const { PDFDocument } = await import('pdf-lib');
```

Функція нарізки (виправлена):
```jsx
async function splitPDFByDocuments(file, documents) {
  const arrayBuffer = await file.arrayBuffer();
  const { PDFDocument } = await import('pdf-lib');
  const srcDoc = await PDFDocument.load(arrayBuffer);
  const totalPages = srcDoc.getPageCount();
  const results = [];

  for (const doc of documents) {
    const startIdx = doc.startPage - 1; // 0-indexed
    const endIdx = Math.min(doc.endPage - 1, totalPages - 1);

    if (startIdx > totalPages - 1) continue;

    const newDoc = await PDFDocument.create();
    const pageIndices = [];
    for (let i = startIdx; i <= endIdx; i++) {
      pageIndices.push(i);
    }

    const pages = await newDoc.copyPages(srcDoc, pageIndices);
    pages.forEach(p => newDoc.addPage(p));

    const bytes = await newDoc.save({ useObjectStreams: true });

    results.push({
      ...doc,
      pageCount: pageIndices.length,
      data: bytes,
      sizeMB: (bytes.byteLength / 1024 / 1024).toFixed(2),
    });
  }

  return results;
}
```

---

## КРОК 4 — ІНТЕГРАЦІЯ В DOCUMENT PROCESSOR

### При завантаженні файлу — зберегти файл в state:
```jsx
const [uploadedFile, setUploadedFile] = useState(null);

// В handleDrop або handleFileSelect:
setUploadedFile(file);
addAgentMessage(`📄 Завантажено: ${file.name} (${(file.size/1024/1024).toFixed(1)} МБ)\n\nНапишіть "нарізати" або опишіть що є у файлі.`);
```

### Обробка команди нарізки:
```jsx
// В обробнику повідомлень агента:
const isSlitCommand = msg.toLowerCase().includes('нарізати') ||
  msg.toLowerCase().includes('розріж') ||
  msg.toLowerCase().includes('визнач документи');

if (isSplitCommand && uploadedFile) {
  addAgentMessage('🔍 Читаю весь PDF... (може зайняти 30-60 секунд)');

  try {
    const result = await analyzePDFWithDocumentBlock(uploadedFile, apiKey, msg);

    setSplitPoints(result.documents);

    // Показати структуру деревом
    const tree = result.documents.map((d, i) =>
      `${i+1}. 📄 ${d.name}\n   Сторінки: ${d.startPage}-${d.endPage} (${d.endPage - d.startPage + 1} стор.)`
    ).join('\n\n');

    addAgentMessage(
      `Знайдено ${result.documents.length} документів у ${result.totalPages} сторінках:\n\n${tree}\n\n` +
      `Підтвердити нарізку? Або скажіть що змінити:\n` +
      `• "з'єднай 2 і 3"\n` +
      `• "сторінка 12 це продовження позовної"\n` +
      `• "підтвердити"`
    );

  } catch (e) {
    addAgentMessage(`❌ Помилка: ${e.message}`);
  }
  return;
}
```

### Обробка підтвердження:
```jsx
const isConfirm = msg.toLowerCase().includes('підтвердити') ||
  msg.toLowerCase().includes('так') ||
  msg.toLowerCase().includes('нарізай');

if (isConfirm && splitPoints.length > 0 && uploadedFile) {
  addAgentMessage('✂️ Нарізаю PDF...');

  try {
    const results = await splitPDFByDocuments(uploadedFile, splitPoints);

    // Зберегти на Drive
    const token = localStorage.getItem('levytskyi_drive_token');
    const folderId = caseData?.storage?.driveFolderId;

    if (token && folderId) {
      addAgentMessage('☁️ Записую на Drive в 02_ОБРОБЛЕНІ...');

      // Знайти папку 02_ОБРОБЛЕНІ
      const subRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
          `'${folderId}' in parents and name='02_ОБРОБЛЕНІ' and mimeType='application/vnd.google-apps.folder' and trashed=false`
        )}&fields=files(id)`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const subData = await subRes.json();
      const targetFolderId = subData.files?.[0]?.id || folderId;

      for (const result of results) {
        const safeName = result.name.replace(/[/\\:*?"<>|]/g, '_');
        const fileName = `${safeName}.pdf`;
        const blob = new Blob([result.data], { type: 'application/pdf' });

        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify({
          name: fileName,
          parents: [targetFolderId],
        })], { type: 'application/json' }));
        form.append('file', blob);

        await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
          { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }
        );
      }

      // Оновити Матеріали
      const newDocs = results.map(r => ({
        id: `doc_${Date.now()}_${Math.random().toString(36).substr(2,6)}`,
        name: r.name,
        type: r.type,
        pageCount: r.pageCount,
        folder: '02_ОБРОБЛЕНІ',
        status: 'ready',
        addedAt: new Date().toISOString(),
      }));

      updateCase(caseData.id, 'documents', [
        ...(caseData.documents || []),
        ...newDocs,
      ]);

      const summary = results.map(r =>
        `✅ ${r.name} — ${r.pageCount} стор., ${r.sizeMB} МБ`
      ).join('\n');

      addAgentMessage(`Готово! ${results.length} документів збережено:\n\n${summary}\n\n📁 Drive: 02_ОБРОБЛЕНІ\n📋 Вкладка Матеріали оновлена`);

    } else {
      addAgentMessage('✅ Нарізано але Drive не підключено.\nПідключіть Drive в блоці Сховище щоб зберегти файли.');
    }

  } catch (e) {
    addAgentMessage(`❌ Помилка нарізки: ${e.message}`);
  }
  return;
}
```

---

## КРОК 5 — КОНТЕКСТ ДЛЯ АГЕНТА ДОСЬЄ

На вкладці "Робота з документами" агент досьє має отримувати додатковий контекст:

```jsx
// В system prompt агента коли активна вкладка docProcessing:
const docContext = uploadedFile
  ? `\n\nЗавантажений файл: ${uploadedFile.name} (${(uploadedFile.size/1024/1024).toFixed(1)} МБ)${
      splitPoints.length > 0
        ? `\nВизначена структура (${splitPoints.length} документів):\n` +
          splitPoints.map((d,i) => `${i+1}. ${d.name} (стор. ${d.startPage}-${d.endPage})`).join('\n')
        : '\nСтруктуру ще не визначено — напиши "нарізати"'
    }`
  : '\n\nФайлів не завантажено.';
```

---

## ПОРЯДОК ВИКОНАННЯ

1. Діагностика (показати результати grep)
2. Замінити аналіз на analyzePDFWithDocumentBlock
3. Виправити імпорт pdf-lib і функцію splitPDFByDocuments
4. Зберегти uploadedFile в state
5. Додати обробники команд нарізки і підтвердження
6. Передати контекст завантаженого файлу агенту досьє

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "feat: PDF split via document block - single request, accurate boundaries" && git push origin main
```

---

## ЧЕКЛІСТ ПІСЛЯ ДЕПЛОЮ

- [ ] Завантажив PDF → агент повідомляє розмір і чекає команди
- [ ] Написав "нарізати" → один запит до API → агент показує список документів з реальними сторінками
- [ ] Структура відповідає реальному вмісту (не вигадана)
- [ ] Написав "підтвердити" → pdf-lib нарізає без помилки
- [ ] Файли з'являються на Drive в 02_ОБРОБЛЕНІ
- [ ] Вкладка Матеріали оновлюється

---

## ПІСЛЯ ВИКОНАННЯ — ДОПИСАТИ В LESSONS.md

```
### [2026-04-08] PDF аналіз — document block замість pdfjs рендерингу
Один запит з document block дешевше і точніше ніж пакети зображень.
base64: btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
Формат: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 }}
pdf-lib: використовувати dynamic import: const { PDFDocument } = await import('pdf-lib')
Помилка 'Cannot read properties of undefined (reading node)' = неправильний імпорт pdf-lib
```
