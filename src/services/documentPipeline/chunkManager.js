// ── DP-3 · CHUNK MANAGER ────────────────────────────────────────────────────
// Нарізка великого PDF на блоки сторінок і їх життя на Drive (`_temp/`), а не
// в RAM. В будь-який момент у пам'яті — байти ОДНОГО chunk, не всього файла.
// Це і є фундамент масштабованості: 250-сторінковий том на планшеті.
//
// Розподіл відповідальності (правило #11, один сенс на функцію):
//   • planChunks       — РОЗРАХУВАТИ діапазони сторінок (memory-aware), нічого
//                        не ріже, не пише. Чистий план.
//   • materializeChunk — вирізати ОДИН chunk у Worker (чистий CPU) і одразу
//                        покласти на Drive _temp; повертає лише driveId
//                        (байти не тримаються — RAM звільнено).
//   • readChunkBytes   — підняти байти одного chunk з Drive назад у RAM.
//
// Heavy pdf-lib (pdfInfo/splitPdf) — у Worker через ін'єктований workerClient;
// Drive I/O — через ін'єктований drivePort (у Worker токена немає). chunkManager
// сам нічого не імпортує зі стану/Drive — все через deps (фабрика, як решта DP).

import { adviseChunkPages } from './memoryMonitor.js';

// deps:
//   runInWorker(op, payload, transfer?) — workerClient.runInWorker
//   drivePort.uploadBytes(folderId, name, bytes, mime?) → { id }
//   drivePort.readBytes(fileId) → ArrayBuffer
//   jobFolderId(caseId, jobId) → folderId (_temp/<caseId>_<jobId>/) — спільна
//     з jobState папка (createJobStateStore._jobFolderId)
//   perf — performance-стаб для memoryMonitor (опц.)
export function createChunkManager(deps = {}) {
  const { runInWorker, drivePort, jobFolderId } = deps;
  if (typeof runInWorker !== 'function') throw new Error('createChunkManager: runInWorker обовʼязковий');
  if (!drivePort) throw new Error('createChunkManager: drivePort обовʼязковий');
  if (typeof jobFolderId !== 'function') throw new Error('createChunkManager: jobFolderId обовʼязковий');

  // Порахувати сторінки (у Worker) і скласти memory-aware план діапазонів.
  // forceChunkPages — override (resume: тримаємось плану що вже на Drive).
  async function planChunks({ buffer, fileSizeBytes = 0, forceChunkPages = null }) {
    const ab = toArrayBuffer(buffer);
    // НЕ transfer-имо джерело: той самий buffer переюзається для кожного
    // chunk (materializeChunk). Transfer детачить його у реальному Worker →
    // другий chunk впав би. Структурне копіювання входу безпечне; нуль-копія
    // важлива лише на ВИХОДІ (великий результат) — це робить сам worker.
    const { pageCount } = await runInWorker('pdfInfo', { buffer: ab });
    const per = forceChunkPages && forceChunkPages > 0
      ? forceChunkPages
      : adviseChunkPages({ totalPages: pageCount, fileSizeBytes, perf: deps.perf });
    const chunks = [];
    for (let start = 1, idx = 0; start <= pageCount; start += per, idx++) {
      const end = Math.min(start + per - 1, pageCount);
      chunks.push({ index: idx, startPage: start, endPage: end });
    }
    return { pageCount, chunkPages: per, chunks };
  }

  // Вирізати один chunk і одразу зберегти на Drive _temp. Повертає
  // { driveId, name, sizeBytes } — БАЙТИ НЕ ПОВЕРТАЮТЬСЯ (RAM звільнено;
  // caller занулює свій buffer після останнього chunk файла).
  async function materializeChunk({ caseId, jobId, fileId, buffer, chunk }) {
    const ab = toArrayBuffer(buffer);
    const ranges = [{
      name: `chunk_${fileId}_${pad(chunk.index)}`,
      type: 'chunk',
      startPage: chunk.startPage,
      endPage: chunk.endPage,
    }];
    const { parts } = await runInWorker('splitPdf', { buffer: ab, ranges });
    const part = parts && parts[0];
    if (!part) throw new Error(`chunkManager: порожній chunk ${chunk.index} для ${fileId}`);
    const folderId = await jobFolderId(caseId, jobId);
    const name = `chunk_${fileId}_${pad(chunk.index)}.pdf`;
    const uploaded = await drivePort.uploadBytes(
      folderId, name, new Uint8Array(part.buffer), 'application/pdf',
    );
    return { driveId: uploaded.id, name, sizeBytes: part.buffer.byteLength };
  }

  // Підняти байти chunk з Drive назад у RAM (перед обробкою). Caller
  // зобовʼязаний занулити повернений ArrayBuffer одразу після chunk.
  async function readChunkBytes(driveId) {
    return drivePort.readBytes(driveId);
  }

  return { planChunks, materializeChunk, readChunkBytes };
}

function pad(n) {
  return String(n).padStart(3, '0');
}

// Нормалізувати вхід до ArrayBuffer (приймаємо File/Blob уже як ArrayBuffer
// від caller'а; Uint8Array → underlying buffer slice).
function toArrayBuffer(b) {
  if (b instanceof ArrayBuffer) return b;
  if (b && b.buffer instanceof ArrayBuffer) {
    return b.buffer.slice(b.byteOffset || 0, (b.byteOffset || 0) + b.byteLength);
  }
  return b;
}
