// DP-3 — datasetCollector: gated toggle, append у _datasets/.
import { describe, it, expect, vi } from 'vitest';
import { createDatasetCollector, DATASET_FILE } from '../../src/services/datasetCollector.js';
import { createMemDrivePort } from '../_memDrivePort.js';

const plan = {
  documents: [{ documentId: 'd1', name: 'Позов', type: 'pleading', category: 'pleading', fragments: [{ fileId: 'f1', startPage: 1, endPage: 4 }] }],
  unusedPages: [{ fileId: 'f1', startPage: 5, endPage: 5, reason: 'порожня' }],
};

describe('datasetCollector', () => {
  it('toggle false → no-op (нічого не пише)', async () => {
    const port = createMemDrivePort();
    const c = createDatasetCollector({ getEnabled: () => false, drivePort: port });
    const r = await c.collect({ caseId: 'c1', jobId: 'j1', plan, files: [] });
    expect(r.written).toBe(false);
    expect(port._allNames()).not.toContain(DATASET_FILE);
  });

  it('toggle true → append приклад у _datasets/splitter_training_data.json', async () => {
    const port = createMemDrivePort();
    const c = createDatasetCollector({ getEnabled: () => true, drivePort: port });
    await c.collect({ caseId: 'c1', jobId: 'j1', plan, files: [{ fileId: 'f1', name: 'a.pdf', processedText: 'txt', layoutJson: { pages: [] } }] });
    const r2 = await c.collect({ caseId: 'c1', jobId: 'j2', plan, files: [] });
    expect(r2.written).toBe(true);
    expect(r2.exampleCount).toBe(2); // append, не перезапис
    expect(port._countFilesNamed(DATASET_FILE)).toBe(1); // стара версія прибрана
  });

  it('thumbnails лише коли renderThumbnail ін\'єктовано (canvas — браузер)', async () => {
    const port = createMemDrivePort();
    const renderThumbnail = vi.fn(async () => new Uint8Array([255, 216, 255])); // jpeg-ish
    const c = createDatasetCollector({
      getEnabled: () => true, drivePort: port, renderThumbnail,
    });
    const r = await c.collect({
      caseId: 'c1', jobId: 'j1', plan,
      files: [], thumbnailSources: { f1: new Uint8Array([1, 2, 3]) },
    });
    expect(r.written).toBe(true);
    expect(r.thumbnails).toBe(2); // first + last
    expect(renderThumbnail).toHaveBeenCalledTimes(2);
  });

  it('не кидає назовні (датасет — побічна користь)', async () => {
    const c = createDatasetCollector({ getEnabled: () => true, drivePort: null });
    const r = await c.collect({ caseId: 'c1', jobId: 'j1', plan });
    expect(r.written).toBe(false);
  });
});
