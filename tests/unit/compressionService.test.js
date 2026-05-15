// Паритет-тести compressionService (TASK 1 salvage).
// Поведінка має дорівнювати legacy compressPDF (DocumentProcessor:143-151):
// валідний PDF → стиснений валідний; пошкоджений → вхід незмінним (catch).
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { compressPdf } from '../../src/services/compressionService.js';

async function makePdf(pages = 3) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  // useObjectStreams:false — менш компактний вхід, щоб стиснення мало запас
  return doc.save({ useObjectStreams: false });
}

describe('compressionService.compressPdf', () => {
  it('валідний PDF → вихід валідний, сторінки збережено, не більший за вхід', async () => {
    const input = await makePdf(5);
    const out = await compressPdf(input);
    expect(out).toBeInstanceOf(Uint8Array);
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(5);
    expect(out.byteLength).toBeLessThanOrEqual(input.byteLength);
  });

  it('пошкоджений buffer → повертає вхід незмінним (catch-гілка legacy)', async () => {
    const bad = new Uint8Array([1, 2, 3, 4, 5]);
    const out = await compressPdf(bad);
    expect(out).toBe(bad);
  });

  it('ідемпотентність: повторний compress не зростає, сторінки збережено', async () => {
    const input = await makePdf(4);
    const once = await compressPdf(input);
    const twice = await compressPdf(once);
    expect(twice.byteLength).toBeLessThanOrEqual(once.byteLength);
    const reloaded = await PDFDocument.load(twice);
    expect(reloaded.getPageCount()).toBe(4);
  });
});
