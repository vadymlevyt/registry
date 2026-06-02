import { describe, it, expect } from 'vitest';
import { createDiagLogger, NOOP_DIAG } from '../../src/services/documentPipeline/diagLogger.js';

// In-memory drivePort стаб: фіксує getOrCreateFolder + uploadText.
function makePort() {
  const uploaded = [];
  return {
    uploaded,
    getOrCreateFolder: async (name) => ({ id: `folder_${name}` }),
    uploadText: async (folderId, name, content, mime) => {
      uploaded.push({ folderId, name, content, mime });
      return { id: `file_${uploaded.length}` };
    },
  };
}

describe('diagLogger', () => {
  it('повертає NOOP без drivePort або коли enabled=false', async () => {
    expect(createDiagLogger({})).toBe(NOOP_DIAG);
    expect(createDiagLogger({ drivePort: makePort(), enabled: false })).toBe(NOOP_DIAG);
    // NOOP контракт безпечний
    NOOP_DIAG.log('x', { a: 1 });
    expect(await NOOP_DIAG.flush({ jobId: 'j' })).toBe(null);
  });

  it('накопичує події і flush пише ОДИН JSON-файл у _diagnostics', async () => {
    const port = makePort();
    const diag = createDiagLogger({ drivePort: port });
    diag.log('plan_chunks', { pageCount: 335, totalChunks: 14 });
    diag.log('chunk_materialized', { index: 0, sizeMB: 41.3 });
    const id = await diag.flush({ jobId: 'dpjob_1', caseId: 'case_1' });

    expect(id).toBe('file_1');
    expect(port.uploaded).toHaveLength(1);
    const up = port.uploaded[0];
    expect(up.folderId).toBe('folder__diagnostics');
    expect(up.name).toMatch(/^dp_diag_dpjob_1_.*\.json$/);
    expect(up.mime).toBe('application/json');

    const parsed = JSON.parse(up.content);
    expect(parsed.diagVersion).toBe(1);
    expect(parsed.jobId).toBe('dpjob_1');
    expect(parsed.caseId).toBe('case_1');
    expect(parsed.entryCount).toBe(2);
    expect(parsed.entries[0]).toMatchObject({ stage: 'plan_chunks', pageCount: 335, totalChunks: 14 });
    expect(parsed.entries[1]).toMatchObject({ stage: 'chunk_materialized', index: 0, sizeMB: 41.3 });
    // кожна подія має часову мітку
    expect(parsed.entries[0].t).toBeTypeOf('string');
  });

  it('конфіденційність: ріже довгі рядки до маркера [str:N], не лишає текст', async () => {
    const port = makePort();
    const diag = createDiagLogger({ drivePort: port });
    const docText = 'СЕКРЕТНИЙ ЗМІСТ ДОКУМЕНТА '.repeat(50); // > 200 символів
    diag.log('oops', { leaked: docText, shortLabel: 'ok', count: 7 });
    await diag.flush({ jobId: 'j' });

    const parsed = JSON.parse(port.uploaded[0].content);
    const e = parsed.entries[0];
    expect(e.leaked).toBe(`[str:${docText.length}]`);
    expect(e.leaked).not.toContain('СЕКРЕТНИЙ');
    expect(e.shortLabel).toBe('ok');
    expect(e.count).toBe(7);
  });

  it('flush best-effort: помилка запису не кидає (повертає null)', async () => {
    const port = {
      getOrCreateFolder: async () => { throw new Error('Drive down'); },
      uploadText: async () => ({ id: 'never' }),
    };
    const diag = createDiagLogger({ drivePort: port });
    diag.log('a', { x: 1 });
    await expect(diag.flush({ jobId: 'j' })).resolves.toBe(null);
  });

  it('log() ніколи не кидає (захист обробки)', () => {
    const diag = createDiagLogger({ drivePort: makePort() });
    // циклічна структура — JSON.stringify впав би, але log ловить усе
    const circular = {}; circular.self = circular;
    expect(() => diag.log('stage', { circular })).not.toThrow();
  });
});
