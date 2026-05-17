// DP-3 — chunkManager: memory-aware план + матеріалізація chunk у _temp.
import { describe, it, expect } from 'vitest';
import { createChunkManager } from '../../src/services/documentPipeline/chunkManager.js';
import { createWorkerClient } from '../../src/services/documentPipeline/workerClient.js';
import { createJobStateStore } from '../../src/services/documentPipeline/jobState.js';
import { createMemDrivePort } from '../_memDrivePort.js';
import { makePdfBytes, toArrayBuffer } from '../_pdfFixture.js';

function build() {
  const port = createMemDrivePort();
  const store = createJobStateStore(port);
  const wc = createWorkerClient({ forceInProcess: true });
  const cm = createChunkManager({ runInWorker: wc.runInWorker, drivePort: port, jobFolderId: store._jobFolderId, perf: {} });
  return { port, cm };
}

describe('chunkManager', () => {
  it('planChunks ділить сторінки memory-aware у межах', async () => {
    const { cm } = build();
    const ab = toArrayBuffer(await makePdfBytes(50));
    const { pageCount, chunkPages, chunks } = await cm.planChunks({ buffer: ab, fileSizeBytes: 1e6 });
    expect(pageCount).toBe(50);
    expect(chunkPages).toBeGreaterThanOrEqual(5);
    // діапазони суцільні, без пропусків
    expect(chunks[0].startPage).toBe(1);
    expect(chunks[chunks.length - 1].endPage).toBe(50);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startPage).toBe(chunks[i - 1].endPage + 1);
    }
  });

  it('forceChunkPages override (resume тримається плану з Drive)', async () => {
    const { cm } = build();
    const ab = toArrayBuffer(await makePdfBytes(20));
    const { chunks } = await cm.planChunks({ buffer: ab, fileSizeBytes: 1e6, forceChunkPages: 10 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ startPage: 1, endPage: 10 });
  });

  it('materializeChunk кладе chunk у _temp і повертає driveId (RAM звільнено)', async () => {
    const { port, cm } = build();
    const ab = toArrayBuffer(await makePdfBytes(12));
    const { chunks } = await cm.planChunks({ buffer: ab, fileSizeBytes: 1e6, forceChunkPages: 5 });
    const m = await cm.materializeChunk({ caseId: 'c1', jobId: 'j1', fileId: 'f0', buffer: ab, chunk: chunks[0] });
    expect(m.driveId).toBeTruthy();
    expect(m.name).toBe('chunk_f0_000.pdf');
    const bytes = await cm.readChunkBytes(m.driveId);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(port._countFilesNamed('chunk_f0_000.pdf')).toBe(1);
  });
});
