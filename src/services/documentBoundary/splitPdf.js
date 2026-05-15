// ── DOCUMENT BOUNDARY · SPLIT ────────────────────────────────────────────────
// Механіка нарізки PDF за діапазонами сторінок. Трансплантовано ДОСЛІВНО з
// історичного DocumentProcessor (splitPDFByDocuments,
// src/components/DocumentProcessor/index.jsx:108-141) у TASK 1.
//
// Єдина адаптація проти legacy: приймає arrayBuffer напряму (не File) —
// сервіс чистий, робота з File — відповідальність caller'а (майбутній DP v2).
// Алгоритм (legacy рядки 110-140) — байт-у-байт без змін семантики.
//
// Примітка: legacy мав ДВА майже-дублікати цієї логіки (splitPDFByDocuments
// :108-141 і inline у handleSplit :880-914) з розбіжністю в обчисленні
// startIdx (handleSplit мав Math.max(0, ...)). Перенесено саме :108-141
// дослівно; розбіжність зафіксована як побічна знахідка для DP v2, НЕ
// злита тихо (правило #11 — не зливати дві сутності мовчки).

import { PDFDocument } from 'pdf-lib';

/**
 * Розрізати склеєний PDF на окремі документи за діапазонами сторінок.
 * @param {ArrayBuffer|Uint8Array} arrayBuffer — вихідний склеєний PDF
 * @param {Array<{name:string,type:string,startPage:number,endPage:number}>} documents
 *        — діапазони (1-based, як повертає detectBoundaries)
 * @returns {Promise<Array<{name:string,type:string,pageCount:number,data:Uint8Array,sizeMB:string}>>}
 */
export async function splitPdf(arrayBuffer, documents) {
  const srcDoc = await PDFDocument.load(arrayBuffer);
  const totalPages = srcDoc.getPageCount();
  const results = [];

  for (const doc of documents) {
    const startIdx = doc.startPage - 1;
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
      name: doc.name,
      type: doc.type,
      pageCount: pageIndices.length,
      data: bytes,
      sizeMB: (bytes.byteLength / 1024 / 1024).toFixed(2),
    });
  }

  return results;
}
