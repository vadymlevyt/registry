// DP-3 — генератор реальних PDF-байтів для тестів pdf-lib шляхів
// (worker/chunkManager/split). Не мок: справжній pdf-lib документ.
import { PDFDocument } from 'pdf-lib';

export async function makePdfBytes(pageCount = 10) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const p = doc.addPage([200, 200]);
    p.drawText(`page ${i + 1}`, { x: 20, y: 100, size: 12 });
  }
  return doc.save({ useObjectStreams: true }); // Uint8Array
}

export function toArrayBuffer(u8) {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}
