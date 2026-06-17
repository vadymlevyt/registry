// ── ВОРОТА ВХОДУ НАРІЗКИ (TASK A1 · Частина A) ───────────────────────────────
// Перевіряємо контракт sliceInputGate: пускати лише об'ємний сканований PDF,
// усе інше — завернути. Детекція за РОЗМІРОМ файлу (метадані {name, mime, size}),
// БЕЗ pdf.js / без async-peek — чиста синхронна функція. Доказ «pipeline.run не
// викликається» — allow:false → startProcessing завертає (компонентний тест у DP UI).
import { describe, it, expect } from 'vitest';
import { sliceInputGate, __test } from '../../src/components/DocumentProcessorV2/sliceInputGate.js';

const BIG = __test.MIN_SLICE_BYTES;            // рівно поріг (1 МБ)
const pdf = (name = 'скан.pdf', size = BIG, extra = {}) =>
  ({ name, mime: 'application/pdf', size, ...extra });

describe('sliceInputGate — ворота «лише сканований PDF» (за розміром)', () => {
  it('lone .docx у нарізці → завернуто (non_pdf)', () => {
    const v = sliceInputGate([
      { name: 'договір.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: BIG },
    ]);
    expect(v.allow).toBe(false);
    expect(v.reason).toBe('non_pdf');
    expect(v.message).toBe(__test.MSG_NON_PDF);
  });

  it('PDF + DOCX (без фото) → завернуто (non_pdf)', () => {
    const v = sliceInputGate([pdf('том.pdf'), { name: 'додаток.docx', mime: '', size: BIG }]);
    expect(v.allow).toBe(false);
    expect(v.reason).toBe('non_pdf');
  });

  it('малий PDF (<1МБ) → завернуто (too_small)', () => {
    const v = sliceInputGate([pdf('малий.pdf', BIG - 1)]);
    expect(v.allow).toBe(false);
    expect(v.reason).toBe('too_small');
    expect(v.message).toBe(__test.MSG_TOO_SMALL);
  });

  it('великий PDF (≥1МБ) → проходить (allow)', () => {
    const v = sliceInputGate([pdf('великий.pdf', BIG), pdf('великий2.pdf', BIG * 5)]);
    expect(v.allow).toBe(true);
    expect(v.reason).toBe('ok');
  });

  it('розмір невідомий (0) → FAIL-OPEN allow', () => {
    const v = sliceInputGate([pdf('хмара.pdf', 0)]);
    expect(v.allow).toBe(true);
    expect(v.reason).toBe('ok');
  });

  it('розмір невідомий (undefined) → FAIL-OPEN allow', () => {
    const v = sliceInputGate([{ name: 'хмара.pdf', mime: 'application/pdf' }]);
    expect(v.allow).toBe(true);
    expect(v.reason).toBe('ok');
  });

  it('перший, що не проходить, повертає verdict (малий PDF перед великим)', () => {
    const v = sliceInputGate([pdf('a.pdf', 10), pdf('b.pdf', BIG * 2)]);
    expect(v.allow).toBe(false);
    expect(v.reason).toBe('too_small');
  });

  it('порожній список → проходить (немає чого завертати)', () => {
    const v = sliceInputGate([]);
    expect(v.allow).toBe(true);
    expect(v.reason).toBe('ok');
  });
});
