# TASK.md — Document Processor: реальні дії після підтвердження
Дата: 08.04.2026

## ПРОБЛЕМА

Document Processor аналізує і показує структуру — але після "Підтвердити структуру"
нічого не відбувається. Пише "функція буде в наступній версії".
Треба реалізувати реальне виконання в браузері.

---

## КРОК 0 — ПРОЧИТАТИ LESSONS.md

```bash
cat LESSONS.md
```

---

## КРОК 1 — ДІАГНОСТИКА

```bash
grep -n "Підтвердити\|confirmStructure\|handleConfirm\|наступній версії" src/components/DocumentProcessor/index.jsx | head -20
grep -n "processedFiles\|documents\|structure" src/components/DocumentProcessor/index.jsx | head -30
```

Показати результати перед змінами.

---

## КРОК 2 — ВИКОНАННЯ ПІСЛЯ ПІДТВЕРДЖЕННЯ

Після "Підтвердити структуру" — зберегти документи в об'єкті справи:

```jsx
const newDocuments = confirmedStructure.map(item => ({
  id: Date.now() + Math.random(),
  name: item.processedName,
  originalName: item.originalName,
  category: item.category,
  proceeding: item.proceeding,
  date: item.date || null,
  author: item.author || 'unknown',
  folder: item.folder,
  size: item.size,
  pageCount: item.pageCount || null,
  status: 'ready',
  addedAt: new Date().toISOString(),
}));

const existingDocs = caseData.documents || [];
updateCase(caseData.id, 'documents', [...existingDocs, ...newDocuments]);
addAgentMessage('✅ Документи збережено. Вкладка Матеріали оновлена.');
```

---

## КРОК 3 — НАРІЗКА PDF

Встановити pdf-lib:
```bash
grep "pdf-lib" package.json || npm install pdf-lib
```

Функція нарізки:
```jsx
import { PDFDocument } from 'pdf-lib';

async function splitPDF(fileArrayBuffer, splitPoints) {
  const srcDoc = await PDFDocument.load(fileArrayBuffer);
  const results = [];
  for (const part of splitPoints) {
    const newDoc = await PDFDocument.create();
    const pageIndices = Array.from(
      { length: part.end - part.start + 1 },
      (_, i) => part.start + i
    );
    const pages = await newDoc.copyPages(srcDoc, pageIndices);
    pages.forEach(p => newDoc.addPage(p));
    const bytes = await newDoc.save();
    results.push({ name: part.name, data: bytes, pageCount: pages.length });
  }
  return results;
}
```

Агент визначає точки нарізки через Vision і повертає JSON:
```json
{"action": "split", "split_points": [
  {"start": 0, "end": 1, "name": "Позовна_заява_2023-03", "type": "pleading"},
  {"start": 2, "end": 8, "name": "Додаток_1_Договір", "type": "evidence"}
]}
```

Показує деревом в чаті → підтвердження → нарізає.

Додати в system prompt агента:
```
Коли отримуєш PDF більше 5 сторінок:
1. Прочитай перші сторінки через Vision
2. Визнач чи це один документ чи кілька склеєних
3. Якщо кілька — знайди межі за заголовками і змістом
4. Поверни JSON: {"action":"split","split_points":[...]}
5. Покажи нарізку деревом в чаті
6. Запитай підтвердження ПЕРЕД нарізкою
```

---

## КРОК 4 — СТИСНЕННЯ

```jsx
async function compressPDF(arrayBuffer) {
  const doc = await PDFDocument.load(arrayBuffer, { updateMetadata: false });
  const compressed = await doc.save({ useObjectStreams: true });
  return compressed;
}
```

Стиснення — автоматично після нарізки/склейки без окремого підтвердження.
Показувати: "22.3 МБ → 4.1 МБ (-82%)"

---

## КРОК 5 — ОНОВЛЕННЯ МАТЕРІАЛІВ

```bash
grep -n "documents\|MaterialsTab" src/components/CaseDossier/index.jsx | head -20
```

Вкладка Матеріали має відображати caseData.documents[]:
- Список згрупований по folder
- Іконки: 📄 процесуальні, 📋 докази, ⚖️ рішення, 📨 листування
- Назва, дата, кількість сторінок

---

## КРОК 6 — ПРИБРАТИ "НАСТУПНА ВЕРСІЯ"

```bash
grep -n "наступній версії\|next version\|буде доступна" src/components/DocumentProcessor/index.jsx
```

Замінити на реальні дії або:
"Збережено локально. Для Drive — підключіть Google Drive в налаштуваннях."

---

## ПОРЯДОК

1. Діагностика
2. Збереження в documents[] після підтвердження
3. pdf-lib нарізка
4. Стиснення
5. Оновлення Матеріалів
6. Прибрати "наступна версія"

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "feat: document processor - real actions, PDF split and compress" && git push origin main
```

## ЧЕКЛІСТ

- [ ] Підтвердив → документи з'явились у Матеріалах
- [ ] Великий PDF → агент показав точки нарізки деревом
- [ ] Підтвердив нарізку → PDF розрізаний на окремі файли
- [ ] Показує розмір до/після: "22.3 МБ → 4.1 МБ"
- [ ] Жодного "буде в наступній версії"

---

## ПІСЛЯ ВИКОНАННЯ — ДОПИСАТИ В LESSONS.md

```
### [2026-04-08] Document Processor — реальні дії
Після підтвердження структури — updateCase() з новими documents[].
Матеріали оновлюються автоматично через props.
pdf-lib для нарізки і стиснення — npm install pdf-lib.
Стиснення завжди після будь-якої операції — без підтвердження.
Ніколи не писати "буде в наступній версії".
```
