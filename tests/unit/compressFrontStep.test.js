// Юніт-тести фронт-кроку стиснення (TASK 4 rework · Стадія B/C). Перевіряють:
// стискаємо ЛИШЕ PDF; не-PDF проходить як є; рушій-пропуск → оригінал; збій →
// оригінал (best-effort); масовий варіант мапить по файлах.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Рушій (pdf.js + canvas) у Node не виконується — мокаємо compressPdfBuffer.
const compressPdfBuffer = vi.fn();
vi.mock('../../src/services/compression/imageCompressor.js', () => ({
  compressPdfBuffer: (...a) => compressPdfBuffer(...a),
  DEFAULT_COMPRESSION_PRESET: 'medium',
}));

const { maybeCompressFileForAdd, compressFilesFrontStep } = await import('../../src/services/compression/compressFrontStep.js');

function pdfFile(name = 'a.pdf') {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'application/pdf' });
}

beforeEach(() => { compressPdfBuffer.mockReset(); });

describe('maybeCompressFileForAdd', () => {
  it('не-PDF (DOCX) повертається як є, рушій не кликали', async () => {
    const f = new File([new Uint8Array([1])], 'd.docx', { type: 'application/vnd...' });
    const out = await maybeCompressFileForAdd(f);
    expect(out).toBe(f);
    expect(compressPdfBuffer).not.toHaveBeenCalled();
  });

  it('PDF + рушій стиснув → новий File зі стисненими байтами', async () => {
    compressPdfBuffer.mockResolvedValue({ bytes: new Uint8Array([9, 9]), compressed: true, outBytes: 2 });
    const out = await maybeCompressFileForAdd(pdfFile('scan.pdf'));
    expect(compressPdfBuffer).toHaveBeenCalledTimes(1);
    expect(out).toBeInstanceOf(File);
    expect(out.name).toBe('scan.pdf');
    expect(out.type).toBe('application/pdf');
    expect(out.size).toBe(2);
  });

  it('PDF але рушій пропустив (searchable, skipped) → оригінал', async () => {
    const f = pdfFile('text.pdf');
    compressPdfBuffer.mockResolvedValue({ skipped: true, reason: 'searchable', compressed: false });
    const out = await maybeCompressFileForAdd(f);
    expect(out).toBe(f);
  });

  it('збій рушія → оригінал (best-effort, документ усе одно додається)', async () => {
    const f = pdfFile('boom.pdf');
    compressPdfBuffer.mockRejectedValue(new Error('canvas недоступний'));
    const out = await maybeCompressFileForAdd(f);
    expect(out).toBe(f);
  });

  it('передає пресет у рушій', async () => {
    compressPdfBuffer.mockResolvedValue({ bytes: new Uint8Array([1]), compressed: true });
    await maybeCompressFileForAdd(pdfFile(), { preset: 'strong' });
    expect(compressPdfBuffer).toHaveBeenCalledWith(expect.anything(), { preset: 'strong' });
  });
});

describe('compressFilesFrontStep', () => {
  it('мапить по файлах: PDF стискає, не-PDF лишає', async () => {
    compressPdfBuffer.mockResolvedValue({ bytes: new Uint8Array([7]), compressed: true, outBytes: 1 });
    const docx = new File([new Uint8Array([1])], 'd.docx', { type: 'application/docx' });
    const out = await compressFilesFrontStep([pdfFile('a.pdf'), docx]);
    expect(out).toHaveLength(2);
    expect(out[0]).toBeInstanceOf(File);
    expect(out[0].size).toBe(1);
    expect(out[1]).toBe(docx);
    expect(compressPdfBuffer).toHaveBeenCalledTimes(1);
  });

  it('onProgress кликається на кожен файл', async () => {
    compressPdfBuffer.mockResolvedValue({ skipped: true });
    const seen = [];
    await compressFilesFrontStep([pdfFile('a.pdf'), pdfFile('b.pdf')], { onProgress: (p) => seen.push(p) });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ stage: 'compress', index: 0, total: 2 });
  });
});
