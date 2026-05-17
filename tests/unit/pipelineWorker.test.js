// DP-3 — pipelineWorker OPS (чистий CPU) + workerClient in-process fallback.
// Той самий handleMessage що й реальний Worker → біт-у-біт результат.
import { describe, it, expect } from 'vitest';
import { handleMessage, OPS } from '../../src/workers/pipelineWorker.js';
import { createWorkerClient } from '../../src/services/documentPipeline/workerClient.js';
import { makePdfBytes, toArrayBuffer } from '../_pdfFixture.js';

describe('pipelineWorker OPS — реальний pdf-lib', () => {
  it('pdfInfo повертає pageCount', async () => {
    const ab = toArrayBuffer(await makePdfBytes(7));
    const { result } = await handleMessage('pdfInfo', { buffer: ab });
    expect(result.pageCount).toBe(7);
  });

  it('splitPdf ріже діапазон сторінок', async () => {
    const ab = toArrayBuffer(await makePdfBytes(10));
    const { result } = await handleMessage('splitPdf', {
      buffer: ab, ranges: [{ name: 'a', type: 'doc', startPage: 2, endPage: 5 }],
    });
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].pageCount).toBe(4);
    const info = await handleMessage('pdfInfo', { buffer: result.parts[0].buffer });
    expect(info.result.pageCount).toBe(4);
  });

  it('mergePdf склеює кілька PDF (документ розкиданий по файлах)', async () => {
    const a = toArrayBuffer(await makePdfBytes(3));
    const b = toArrayBuffer(await makePdfBytes(2));
    const { result } = await handleMessage('mergePdf', { buffers: [a, b] });
    const info = await handleMessage('pdfInfo', { buffer: result.buffer });
    expect(info.result.pageCount).toBe(5);
  });

  it('mergePdf одного буфера — passthrough', async () => {
    const a = toArrayBuffer(await makePdfBytes(4));
    const { result } = await handleMessage('mergePdf', { buffers: [a] });
    expect((await handleMessage('pdfInfo', { buffer: result.buffer })).result.pageCount).toBe(4);
  });

  it('compressPdf re-save (не кидає; повертає буфер)', async () => {
    const ab = toArrayBuffer(await makePdfBytes(3));
    const { result } = await handleMessage('compressPdf', { buffer: ab });
    expect(result.buffer.byteLength).toBeGreaterThan(0);
  });

  it('mergeText сортує по startPage і склеює', async () => {
    const { result } = await handleMessage('mergeText', {
      chunks: [{ startPage: 5, text: 'B' }, { startPage: 1, text: 'A' }],
    });
    expect(result.text).toBe('A\n\n--- Page break ---\n\nB');
  });

  it('parseJson парсить', async () => {
    const { result } = await handleMessage('parseJson', { text: '{"a":1}' });
    expect(result.value).toEqual({ a: 1 });
  });

  it('невідома операція кидає', async () => {
    await expect(handleMessage('nope', {})).rejects.toThrow(/невідома операція/);
  });

  it('OPS — повний реєстр', () => {
    expect(Object.keys(OPS).sort()).toEqual(['compressPdf', 'mergePdf', 'mergeText', 'parseJson', 'pdfInfo', 'splitPdf']);
  });
});

describe('workerClient — in-process fallback (тест/Safari без Worker)', () => {
  it('forceInProcess → той самий результат що handleMessage', async () => {
    const wc = createWorkerClient({ forceInProcess: true });
    expect(wc.isInProcess()).toBe(true);
    const ab = toArrayBuffer(await makePdfBytes(6));
    const r = await wc.runInWorker('pdfInfo', { buffer: ab }, [ab]);
    expect(r.pageCount).toBe(6);
  });

  it('createWorker override маршрутизує постмесседж і резолвить по id', async () => {
    // Псевдо-Worker: ехо через handleMessage.
    function FakeWorker() {
      this.onmessage = null;
      this.postMessage = async ({ id, op, payload }) => {
        try {
          const { result } = await handleMessage(op, payload);
          this.onmessage?.({ data: { id, ok: true, result } });
        } catch (e) {
          this.onmessage?.({ data: { id, ok: false, error: { message: e.message } } });
        }
      };
      this.terminate = () => {};
    }
    const wc = createWorkerClient({ createWorker: () => new FakeWorker() });
    expect(wc.isInProcess()).toBe(false);
    const r = await wc.runInWorker('parseJson', { text: '{"x":2}' });
    expect(r.value).toEqual({ x: 2 });
    wc.dispose();
  });
});
