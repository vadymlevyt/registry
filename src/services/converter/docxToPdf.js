// ── DOCX → PDF ───────────────────────────────────────────────────────────────
// Конвертує DOCX файл у PDF Blob через mammoth + html2pdf.js і одночасно
// витягує сирий текст через mammoth.extractRawText.
//
// Pipeline:
//   1. Прочитати file як ArrayBuffer
//   2. validateDocxSignature — перші байти ZIP (PK\x03\x04). DOCX — це ZIP.
//      Якщо ні — THROW «не є валідним DOCX».
//   3. mammoth.extractRawText({ arrayBuffer }) → plain text.
//      Якщо помилка mammoth (битий ZIP, не-DOCX вміст) — THROW з чесним
//      повідомленням адвокату.
//      Якщо текст коротший за MIN_TEXT_LENGTH — THROW «порожній або без тексту».
//   4. mammoth.convertToHtml({ arrayBuffer }) → HTML (для рендера у PDF)
//   5. A4-контейнер у DOM + html2pdf.js → Blob('application/pdf')
//   6. Cleanup DOM, повернути { pdfBlob, extractedText, warnings }
//
// Контракт результату:
//   { pdfBlob: Blob, extractedText: string, warnings: string[] }
//
// `extractedText` — сирий текст з mammoth.extractRawText. Це повний текст
// документа без HTML розмітки. CaseDossier записує його у 02_ОБРОБЛЕНІ як .txt
// БЕЗ виклику Document AI — текст у DOCX вже структурований, OCR на render-PDF
// дав би гірший результат і даремну витрату токенів.
//
// Feature flag CONVERT_DOCX_TO_PDF керується у converterService.js. Якщо false —
// converterService повертає passthrough і ця функція не викликається.

// Мінімальна довжина значущого тексту. 50 символів — це приблизно одне коротке
// речення. Менше — або порожній шаблон, або документ без текстового вмісту
// (тільки зображення/таблиці без OCR-а). У таких випадках адвокат має додавати
// файл як зображення, а не як DOCX.
const MIN_TEXT_LENGTH = 50;

const A4_CSS = `
  font-family: 'Times New Roman', Times, serif;
  font-size: 12pt;
  line-height: 1.4;
  color: #000;
  background: #fff;
  width: 210mm;
  min-height: 297mm;
  padding: 20mm 20mm 20mm 30mm;
  box-sizing: border-box;
`;

const HTML2PDF_OPTIONS = {
  margin: 0,
  image: { type: 'jpeg', quality: 0.95 },
  html2canvas: { scale: 2, useCORS: true, logging: false },
  jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
};

export async function docxToPdf(file, _context = {}) {
  const warnings = [];

  // 1. ArrayBuffer
  const arrayBuffer = await readAsArrayBuffer(file);

  // 2. ZIP-сигнатура. DOCX — це zip-архів з [Content_Types].xml + word/*.xml.
  // Якщо перші 4 байти не PK\x03\x04 — це точно не DOCX (можливо .doc, txt
  // з .docx розширенням, або пошкоджений файл).
  if (!hasDocxSignature(arrayBuffer)) {
    throw new Error('Файл не є валідним DOCX. Можливо це старий .doc формат або файл пошкоджений.');
  }

  // 3. mammoth — імпорт один раз, дві операції паралельно
  const mammothModule = await import('mammoth');
  const mammoth = mammothModule.default || mammothModule;

  let rawTextResult;
  let htmlResult;
  try {
    [rawTextResult, htmlResult] = await Promise.all([
      mammoth.extractRawText({ arrayBuffer }),
      mammoth.convertToHtml({ arrayBuffer }),
    ]);
  } catch (e) {
    // Mammoth кидає при пошкодженому ZIP, не-DOCX вмісті, нечитабельних
    // потоках. Не показуємо адвокату технічну ZIP-помилку — даємо чесне
    // повідомлення про файл.
    throw new Error(`Не вдалось прочитати DOCX. Файл може бути пошкоджений: ${e?.message || e}`);
  }

  const extractedText = (rawTextResult?.value || '').trim();
  const html = htmlResult?.value || '';
  const mammothMessages = [
    ...(rawTextResult?.messages || []),
    ...(htmlResult?.messages || []),
  ];

  if (extractedText.length < MIN_TEXT_LENGTH) {
    throw new Error(
      `DOCX не містить тексту (${extractedText.length} символів). Якщо документ — сканований, додайте його як зображення.`
    );
  }

  if (!html || html.trim().length === 0) {
    throw new Error('Не вдалось згенерувати HTML з DOCX (порожній результат mammoth).');
  }

  // mammoth warnings (numbering, styles) — переносимо у наш результат
  for (const msg of mammothMessages) {
    if (msg?.type === 'warning' && msg?.message) {
      warnings.push(`mammoth: ${msg.message}`);
    }
  }

  // 4. Контейнер у DOM
  const container = document.createElement('div');
  container.setAttribute('style', `
    position: absolute;
    top: 0;
    left: -10000px;
    opacity: 0;
    pointer-events: none;
    ${A4_CSS}
  `);
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    // 5. html2pdf — динамічний імпорт
    const html2pdfModule = await import('html2pdf.js');
    const html2pdf = html2pdfModule.default || html2pdfModule;

    const pdfBlob = await html2pdf()
      .from(container)
      .set(HTML2PDF_OPTIONS)
      .outputPdf('blob');

    if (!(pdfBlob instanceof Blob) || pdfBlob.size === 0) {
      throw new Error('html2pdf повернув порожній PDF');
    }

    return { pdfBlob, extractedText, warnings };
  } finally {
    // 6. Cleanup
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// ZIP local file header signature: 0x50 0x4B 0x03 0x04 ("PK\x03\x04").
// Усі DOCX починаються з цієї сигнатури. Інші ZIP-варіанти (порожній архів
// 0x50 0x4B 0x05 0x06, або spanning 0x50 0x4B 0x07 0x08) для DOCX не зустрічаються.
function hasDocxSignature(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength < 4) return false;
  const view = new Uint8Array(arrayBuffer, 0, 4);
  return view[0] === 0x50 && view[1] === 0x4b && view[2] === 0x03 && view[3] === 0x04;
}

function readAsArrayBuffer(file) {
  if (file instanceof ArrayBuffer) return Promise.resolve(file);
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
