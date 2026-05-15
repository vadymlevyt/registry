// ── COMPRESSION SERVICE ──────────────────────────────────────────────────────
// Стиснення PDF через pdf-lib. Трансплантовано дослівно з історичного
// DocumentProcessor (compressPDF, src/components/DocumentProcessor/index.jsx
// :143-151) у TASK 1 salvage-and-decommission. Стара оболонка видалена;
// pre-deletion код доступний через git tag pre-dp-v2-old-dp-removal.
//
// Чиста функція: без React, без UI, без мережі. Найкраще-зусильне стиснення —
// при будь-якій помилці парсингу повертає вхід незмінним (не кидає).

import { PDFDocument } from 'pdf-lib';

/**
 * Стиснути PDF re-save'ом з object streams.
 * @param {ArrayBuffer|Uint8Array} arrayBuffer — вхідний PDF
 * @returns {Promise<Uint8Array|ArrayBuffer|Uint8Array>} стиснений PDF,
 *          або вхід незмінним при помилці парсингу (catch-гілка legacy).
 */
export async function compressPdf(arrayBuffer) {
  try {
    const doc = await PDFDocument.load(arrayBuffer, { updateMetadata: false });
    const compressed = await doc.save({ useObjectStreams: true });
    return compressed;
  } catch {
    return arrayBuffer;
  }
}
