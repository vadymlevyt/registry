// ── ВОРОТА ВХОДУ НАРІЗКИ (TASK A1 · Частина A) ───────────────────────────────
// Перевіряємо контракт sliceInputGate: пускати лише сканований PDF (без
// текстового шару), усе інше — завернути. peekPdf ін'єктується (детермінізм,
// нуль pdfjs у node-тесті). Доказ «pipeline.run не викликається» — allow:false
// → startProcessing завертає до pipeline.run (компонентний тест нижче в DP UI).
import { describe, it, expect, vi } from 'vitest';
import { sliceInputGate, __test } from '../../src/components/DocumentProcessorV2/sliceInputGate.js';

const rawOf = (bytes = 8) => ({ arrayBuffer: async () => new ArrayBuffer(bytes) });
const pdf = (name = 'скан.pdf', extra = {}) => ({ name, mime: 'application/pdf', raw: rawOf(), ...extra });

describe('sliceInputGate — ворота «лише сканований PDF»', () => {
  it('lone .docx у нарізці → завернуто (non_pdf), peek не торкається', async () => {
    const peekPdf = vi.fn();
    const v = await sliceInputGate(
      [{ name: 'договір.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', raw: rawOf() }],
      { peekPdf },
    );
    expect(v.allow).toBe(false);
    expect(v.reason).toBe('non_pdf');
    expect(v.message).toBe(__test.MSG_NON_PDF);
    expect(peekPdf).not.toHaveBeenCalled();
  });

  it('PDF + DOCX (без фото) → завернуто (non_pdf) на синхронній перевірці', async () => {
    const peekPdf = vi.fn(async () => ({ avgChars: 5 }));
    const v = await sliceInputGate(
      [pdf('том.pdf'), { name: 'додаток.docx', mime: '', raw: rawOf() }],
      { peekPdf },
    );
    expect(v.allow).toBe(false);
    expect(v.reason).toBe('non_pdf');
    // синхронна перевірка типу зрізає ДО будь-якого peek
    expect(peekPdf).not.toHaveBeenCalled();
  });

  it('цифровий PDF (текстовий шар, avgChars ≥ поріг) → завернуто (digital_pdf)', async () => {
    const peekPdf = vi.fn(async () => ({ avgChars: 1200, pageCount: 10 }));
    const v = await sliceInputGate([pdf('цифровий.pdf')], { peekPdf });
    expect(v.allow).toBe(false);
    expect(v.reason).toBe('digital_pdf');
    expect(v.message).toBe(__test.MSG_DIGITAL_PDF);
    expect(peekPdf).toHaveBeenCalledTimes(1);
  });

  it('сканований PDF (avgChars < поріг) → проходить (allow)', async () => {
    const peekPdf = vi.fn(async () => ({ avgChars: 12, pageCount: 40 }));
    const v = await sliceInputGate([pdf('скан.pdf'), pdf('скан2.pdf')], { peekPdf });
    expect(v.allow).toBe(true);
    expect(v.reason).toBe('ok');
    expect(peekPdf).toHaveBeenCalledTimes(2);
  });

  it('avgChars рівно на порозі → цифровий (>=)', async () => {
    const peekPdf = vi.fn(async () => ({ avgChars: __test.TEXT_LAYER_AVG_CHARS }));
    const v = await sliceInputGate([pdf()], { peekPdf });
    expect(v.allow).toBe(false);
    expect(v.reason).toBe('digital_pdf');
  });

  it('peek кинув (битий PDF) → FAIL-OPEN, пускаємо', async () => {
    const peekPdf = vi.fn(async () => { throw new Error('Invalid PDF structure'); });
    const v = await sliceInputGate([pdf('битий.pdf')], { peekPdf });
    expect(v.allow).toBe(true);
    expect(v.reason).toBe('ok');
  });

  it('401 Drive під час підкачки → drive_auth (friendly), НЕ проходить', async () => {
    const driveRequest = vi.fn(async () => ({ status: 401, ok: false }));
    const peekPdf = vi.fn();
    const v = await sliceInputGate(
      [{ name: 'хмара.pdf', mime: 'application/pdf', raw: null, driveId: 'drv1' }],
      { driveRequest, peekPdf },
    );
    expect(v.allow).toBe(false);
    expect(v.reason).toBe('drive_auth');
    expect(v.message).toBe(__test.MSG_DRIVE_AUTH);
    expect(peekPdf).not.toHaveBeenCalled();
  });

  it('403 Drive теж → drive_auth', async () => {
    const driveRequest = vi.fn(async () => ({ status: 403, ok: false }));
    const v = await sliceInputGate(
      [{ name: 'хмара.pdf', mime: 'application/pdf', driveId: 'drv1' }],
      { driveRequest },
    );
    expect(v.reason).toBe('drive_auth');
  });

  it('Drive 500 (не auth) → FAIL-OPEN для файлу, пускаємо', async () => {
    const driveRequest = vi.fn(async () => ({ status: 500, ok: false }));
    const peekPdf = vi.fn();
    const v = await sliceInputGate(
      [{ name: 'хмара.pdf', mime: 'application/pdf', driveId: 'drv1' }],
      { driveRequest, peekPdf },
    );
    expect(v.allow).toBe(true);
    expect(v.reason).toBe('ok');
  });

  it('Drive-source: байти беруться через driveRequest(alt=media), потім peek', async () => {
    const driveRequest = vi.fn(async () => ({ status: 200, ok: true, arrayBuffer: async () => new ArrayBuffer(16) }));
    const peekPdf = vi.fn(async () => ({ avgChars: 5 }));
    const v = await sliceInputGate(
      [{ name: 'хмара.pdf', mime: 'application/pdf', driveId: 'drv1' }],
      { driveRequest, peekPdf },
    );
    expect(v.allow).toBe(true);
    expect(driveRequest).toHaveBeenCalledTimes(1);
    expect(String(driveRequest.mock.calls[0][0])).toContain('alt=media');
    expect(peekPdf).toHaveBeenCalledTimes(1);
  });

  it('device-файл: байти з raw, driveRequest не торкається', async () => {
    const driveRequest = vi.fn();
    const peekPdf = vi.fn(async () => ({ avgChars: 5 }));
    const v = await sliceInputGate([pdf('local.pdf')], { driveRequest, peekPdf });
    expect(v.allow).toBe(true);
    expect(driveRequest).not.toHaveBeenCalled();
  });

  it('порожній список → проходить (немає чого завертати)', async () => {
    const v = await sliceInputGate([], { peekPdf: vi.fn() });
    expect(v.allow).toBe(true);
  });

  it('перший цифровий зупиняє ще до peek наступних', async () => {
    let calls = 0;
    const peekPdf = vi.fn(async () => { calls += 1; return { avgChars: 1000 }; });
    const v = await sliceInputGate([pdf('a.pdf'), pdf('b.pdf')], { peekPdf });
    expect(v.reason).toBe('digital_pdf');
    expect(calls).toBe(1);
  });
});
