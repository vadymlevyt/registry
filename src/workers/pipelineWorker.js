// ── DP-3 · PIPELINE WEB WORKER ──────────────────────────────────────────────
// Важкі CPU-операції у окремому потоці — UI не замерзає на 250-сторінкових
// томах і 50 МБ файлах. Координація лишається у main thread (streamingExecutor);
// Worker виконує ЛИШЕ чисту обробку байтів і повертає результат.
//
// Worker НЕ робить Drive I/O: у воркері немає localStorage / window.google,
// тож OAuth-токен driveAuth недоступний. Усе мережеве/Drive — main thread.
// Це і є межа: Worker = чистий CPU, main = координація + I/O.
//
// Логіку НЕ дублюємо — імпортуємо ті самі чисті сервіси що й main:
//   • compressionService.compressPdf  — стиснення re-save'ом (TASK 1 salvage)
//   • documentBoundary/splitPdf       — нарізка за діапазонами (TASK 1 salvage)
// Так Worker і синхронний fallback (workerClient) дають БІТ-У-БІТ той самий
// результат — один сенс на ім'я операції (правило #11).
//
// Vite збирає цей файл окремим chunk через
//   new Worker(new URL('../workers/pipelineWorker.js', import.meta.url),
//              { type: 'module' })
// з base '/registry/' — GitHub Pages віддає його як статичний хешований
// asset (перевірено: статичний хостинг сервить worker-chunk коректно).
//
// Протокол: { id, op, payload } → { id, ok, result } | { id, ok:false, error }.
// ArrayBuffer повертається transferable (нуль копіювання великих байтів).

import { PDFDocument } from 'pdf-lib';
import { compressPdf } from '../services/compressionService.js';
import { splitPdf } from '../services/documentBoundary/splitPdf.js';

// Чисті обробники операцій. Кожен приймає payload, повертає
// { result, transfer? } де transfer — масив ArrayBuffer для нуль-копії.
export const OPS = {
  // Стиснути PDF. payload: { buffer: ArrayBuffer } → { buffer: ArrayBuffer }.
  async compressPdf({ buffer }) {
    const out = await compressPdf(buffer);
    const ab = out instanceof Uint8Array
      ? out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
      : out;
    return { result: { buffer: ab }, transfer: [ab] };
  },

  // Нарізати PDF за діапазонами. payload: { buffer, ranges:[{name,type,
  // startPage,endPage}] } → { parts:[{name,type,pageCount,buffer,sizeMB}] }.
  async splitPdf({ buffer, ranges }) {
    const parts = await splitPdf(buffer, ranges || []);
    const transfer = [];
    const mapped = parts.map((p) => {
      const ab = p.data.buffer.slice(p.data.byteOffset, p.data.byteOffset + p.data.byteLength);
      transfer.push(ab);
      return { name: p.name, type: p.type, pageCount: p.pageCount, sizeMB: p.sizeMB, buffer: ab };
    });
    return { result: { parts: mapped }, transfer };
  },

  // Склеїти кілька PDF у один (документ розкиданий по N файлах пакета —
  // ядро DP-3 §4.4). payload: { buffers:[ArrayBuffer] } → { buffer }.
  async mergePdf({ buffers }) {
    const list = buffers || [];
    if (list.length === 1) {
      const only = list[0];
      return { result: { buffer: only }, transfer: [only] };
    }
    const merged = await PDFDocument.create();
    for (const buf of list) {
      const src = await PDFDocument.load(buf, { updateMetadata: false });
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }
    const saved = await merged.save({ useObjectStreams: true });
    const ab = saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength);
    return { result: { buffer: ab }, transfer: [ab] };
  },

  // Метадані PDF без завантаження всього у RAM на main thread. payload:
  // { buffer } → { pageCount }. Потрібно chunkManager'у щоб порахувати
  // діапазони сторінок ДО матеріалізації chunk'ів.
  async pdfInfo({ buffer }) {
    const doc = await PDFDocument.load(buffer, { updateMetadata: false });
    return { result: { pageCount: doc.getPageCount() } };
  },

  // Склеїти текстові chunks у фінальний текст. payload: { chunks:[{startPage,
  // text}], separator? } → { text }. Винесено у Worker бо на тисячах сторінок
  // конкатенація рядків блокує main thread.
  async mergeText({ chunks, separator }) {
    const sep = separator || '\n\n--- Page break ---\n\n';
    const sorted = [...(chunks || [])].sort((a, b) => (a.startPage || 0) - (b.startPage || 0));
    return { result: { text: sorted.map((c) => c.text || '').join(sep) } };
  },

  // Розпарсити великий JSON поза main thread. payload: { text } → { value }.
  async parseJson({ text }) {
    return { result: { value: JSON.parse(text) } };
  },
};

// Чистий диспетчер — спільний для Worker і синхронного fallback (workerClient).
export async function handleMessage(op, payload) {
  const fn = OPS[op];
  if (typeof fn !== 'function') {
    throw new Error(`pipelineWorker: невідома операція "${op}"`);
  }
  return fn(payload || {});
}

// Worker-середовище: підписка на повідомлення. У тестах (Node/jsdom) глобал
// self не воркерний — гілка не активується, експорти лишаються чистими.
if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
  self.onmessage = async (e) => {
    const { id, op, payload } = e.data || {};
    try {
      const { result, transfer } = await handleMessage(op, payload);
      self.postMessage({ id, ok: true, result }, transfer || []);
    } catch (err) {
      self.postMessage({ id, ok: false, error: { message: err?.message || String(err) } });
    }
  };
}
