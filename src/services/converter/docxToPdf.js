// ── DOCX → PDF ───────────────────────────────────────────────────────────────
// Конвертує DOCX файл у PDF Blob через mammoth (DOCX → HTML) + html2pdf.js
// (HTML → PDF).
//
// Pipeline:
//   1. Прочитати file як ArrayBuffer
//   2. mammoth.convertToHtml({ arrayBuffer }) → HTML
//   3. Створити прихований контейнер у DOM з HTML і A4 стилями
//      (Times New Roman 12pt, поля 2см/3см/2см/2см — стандарт ділового документа)
//   4. html2pdf.js → Blob('application/pdf')
//   5. Cleanup DOM
//
// Контракт результату:
//   { pdfBlob: Blob, warnings: string[] }
//
// Feature flag CONVERT_DOCX_TO_PDF керується у converterService.js. Якщо false —
// converterService повертає passthrough і ця функція не викликається.
//
// Якість конвертації: html2pdf.js не зберігає Word нумерацію списків,
// складні таблиці, виносні знаки. Для нормальних позовів/ухвал результат
// прийнятний. Якщо адвокат натрапить на проблемний DOCX — feature flag
// швидко відкочує до Viewer через DocxRenderer.

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

export async function docxToPdf(file, context = {}) {
  const warnings = [];

  // 1. ArrayBuffer
  const arrayBuffer = await readAsArrayBuffer(file);

  // 2. mammoth → HTML
  const mammothModule = await import('mammoth');
  const mammoth = mammothModule.default || mammothModule;

  let html = '';
  let mammothMessages = [];
  try {
    const result = await mammoth.convertToHtml({ arrayBuffer });
    html = result?.value || '';
    mammothMessages = result?.messages || [];
  } catch (e) {
    throw new Error(`mammoth конвертація провалилася: ${e?.message || e}`);
  }

  if (!html || html.trim().length === 0) {
    throw new Error('DOCX порожній або не вдалося витягти контент');
  }

  // mammoth warnings (numbering, styles) — переносимо у наш результат
  for (const msg of mammothMessages) {
    if (msg?.type === 'warning' && msg?.message) {
      warnings.push(`mammoth: ${msg.message}`);
    }
  }

  // 3. Контейнер у DOM
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
    // 4. html2pdf — динамічний імпорт
    const html2pdfModule = await import('html2pdf.js');
    const html2pdf = html2pdfModule.default || html2pdfModule;

    const pdfBlob = await html2pdf()
      .from(container)
      .set(HTML2PDF_OPTIONS)
      .outputPdf('blob');

    if (!(pdfBlob instanceof Blob) || pdfBlob.size === 0) {
      throw new Error('html2pdf повернув порожній PDF');
    }

    return { pdfBlob, warnings };
  } finally {
    // 5. Cleanup
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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
