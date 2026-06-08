// Юніт-тести сервісу addFiles — окремий самодостатній сценарій «просто додати»
// (TASK 4 rework). Перевіряють КОНТРАКТ: один цикл на будь-яку комбінацію
// файлів, batch-стійкість (один впав — решта додається), DI (convert/upload/
// factory/persist), passthrough Drive-source, події ingested+batch, ocrMode як
// прапор (addFiles сам OCR НЕ робить — це пост-крок консюмера).
import { describe, it, expect, vi } from 'vitest';
import {
  createAddFiles,
  defaultAddFilesMetadata,
  OCR_MODE,
  DEFAULT_OCR_MODE,
} from '../../src/services/addFiles/addFilesService.js';

function makeDeps(over = {}) {
  const published = [];
  let docSeq = 0;
  return {
    deps: {
      convertToPdf: vi.fn(async () => ({
        pdfBlob: { size: 10 }, originalBlob: null, pdfName: 'd', originalName: 'd.pdf',
        originalMime: 'application/pdf', extractedText: null, warnings: [],
        converter: 'passthrough', durationMs: 1,
      })),
      uploadFile: vi.fn(async () => `drive_${++docSeq}`),
      createDocument: vi.fn((m) => ({ id: `doc_${docSeq || 1}`, name: m.name || 'd', source: m.source || 'manual', ...m })),
      persistDocument: vi.fn(async () => ({ success: true })),
      eventBus: { publish: (t, p) => published.push({ t, p }) },
      topics: { DOCUMENT_INGESTED: 'document.ingested', DOCUMENT_BATCH_PROCESSED: 'document.batch_processed' },
      getActor: () => ({ userId: 'u1', tenantId: 't1' }),
      ...over,
    },
    published,
  };
}

function baseInput(filesOver) {
  return {
    caseId: 'case_1',
    caseData: { id: 'case_1' },
    files: filesOver || [{ fileId: 'doc', raw: { name: 'a.pdf', size: 5, type: 'application/pdf' } }],
  };
}

describe('addFiles — фабрика і валідація deps', () => {
  it('кидає якщо немає обовʼязкових deps', () => {
    expect(() => createAddFiles({})).toThrow(/convertToPdf/);
    expect(() => createAddFiles({ convertToPdf: () => {} })).toThrow(/uploadFile/);
    expect(() => createAddFiles({ convertToPdf: () => {}, uploadFile: () => {} })).toThrow(/createDocument/);
    expect(() => createAddFiles({ convertToPdf: () => {}, uploadFile: () => {}, createDocument: () => {} })).toThrow(/persistDocument/);
  });

  it('DEFAULT_OCR_MODE = full (OCR за дефолтом завжди)', () => {
    expect(DEFAULT_OCR_MODE).toBe(OCR_MODE.FULL);
  });
});

describe('addFiles — intake', () => {
  it('порожній caseId → NO_CASE, нічого не персиститься', async () => {
    const { deps } = makeDeps();
    const res = await createAddFiles(deps).addFiles({ files: [{ fileId: 'x', raw: {} }] });
    expect(res.ok).toBe(false);
    expect(res.errors[0].code).toBe('NO_CASE');
    expect(deps.persistDocument).not.toHaveBeenCalled();
  });

  it('порожній files[] → NO_FILES', async () => {
    const { deps } = makeDeps();
    const res = await createAddFiles(deps).addFiles({ caseId: 'c', caseData: {}, files: [] });
    expect(res.ok).toBe(false);
    expect(res.errors[0].code).toBe('NO_FILES');
  });
});

describe('addFiles — один файл (щасливий шлях)', () => {
  it('convert+upload викликані, документ персиститься, події ingested+batch', async () => {
    const { deps, published } = makeDeps();
    const res = await createAddFiles(deps).addFiles(baseInput(), { ocrMode: 'full' });
    expect(res.ok).toBe(true);
    expect(res.documents).toHaveLength(1);
    expect(deps.convertToPdf).toHaveBeenCalledTimes(1);
    expect(deps.uploadFile).toHaveBeenCalledTimes(1);
    expect(deps.persistDocument).toHaveBeenCalledWith({ caseId: 'case_1', document: expect.objectContaining({ id: 'doc_1' }) });
    expect(published.map((e) => e.t)).toEqual(['document.ingested', 'document.batch_processed']);
    expect(published[0].p).toMatchObject({ tenantId: 't1', userId: 'u1', caseId: 'case_1' });
    expect(res.files[0].driveId).toBe('drive_1');
    expect(res.ocrMode).toBe('full');
  });

  it('ocrMode за замовчуванням full; addFiles сам OCR НЕ робить (немає OCR-deps)', async () => {
    const { deps } = makeDeps();
    const res = await createAddFiles(deps).addFiles(baseInput());
    expect(res.ocrMode).toBe('full');
    // У deps немає жодного OCR-колбека — і не потрібно: OCR це пост-крок консюмера.
    expect(res.ok).toBe(true);
  });
});

describe('addFiles — Drive-source passthrough', () => {
  it('convert/upload НЕ викликаються, driveId зберігається', async () => {
    const { deps } = makeDeps();
    const res = await createAddFiles(deps).addFiles(baseInput([
      { fileId: 'doc', raw: null, isDriveSource: true, driveId: 'drive_picked', type: 'application/pdf', name: 'x.pdf' },
    ]));
    expect(deps.convertToPdf).not.toHaveBeenCalled();
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(res.files[0].driveId).toBe('drive_picked');
    expect(res.ok).toBe(true);
  });
});

describe('addFiles — метадані', () => {
  it('buildDocumentMetadata в options має пріоритет → у createDocument', async () => {
    const build = vi.fn(() => ({ name: 'Custom', documentNature: 'searchable', source: 'manual' }));
    const { deps } = makeDeps();
    await createAddFiles(deps).addFiles(baseInput(), { buildDocumentMetadata: build });
    expect(build).toHaveBeenCalledTimes(1);
    expect(deps.createDocument).toHaveBeenCalledWith(expect.objectContaining({ name: 'Custom' }));
  });

  it('defaultAddFilesMetadata: назва з імені файлу, класифікація null', () => {
    const m = defaultAddFilesMetadata({
      item: { name: 'Позов вих 12.pdf', type: 'application/pdf', size: 100 },
      driveId: 'd1', originalDriveId: null, uploadedFile: { size: 80 },
      conversion: null, job: { addedBy: 'user', source: 'manual' },
    });
    expect(m.name).toBe('Позов вих 12');
    expect(m.category).toBeNull();
    expect(m.author).toBeNull();
    expect(m.folder).toBe('01_ОРИГІНАЛИ');
    expect(m.namingStatus).toBe('auto');
    expect(m.driveId).toBe('d1');
    expect(m.source).toBe('manual');
  });

  it('defaultAddFilesMetadata: DOCX/HTML конвертер → nature searchable', () => {
    const m = defaultAddFilesMetadata({
      item: { name: 'договір.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      driveId: 'd', conversion: { converter: 'docxToPdf', originalMime: 'application/vnd...' }, job: {},
    });
    expect(m.documentNature).toBe('searchable');
  });
});

describe('addFiles — помилки одного файлу', () => {
  it('CONVERT_FAILED: документ не створюється, persist не кликали', async () => {
    const { deps } = makeDeps({ convertToPdf: vi.fn(async () => { throw new Error('bad docx'); }) });
    const res = await createAddFiles(deps).addFiles(baseInput([{ fileId: 'doc', raw: { name: 'x.docx', size: 1, type: 'application/docx' } }]));
    expect(res.ok).toBe(false);
    expect(res.documents).toHaveLength(0);
    expect(res.errors[0]).toMatchObject({ code: 'CONVERT_FAILED', fileId: 'doc' });
    expect(deps.persistDocument).not.toHaveBeenCalled();
  });

  it('UPLOAD_FAILED: помилка завантаження → per-file error', async () => {
    const { deps } = makeDeps({ uploadFile: vi.fn(async () => { throw new Error('drive 401'); }) });
    const res = await createAddFiles(deps).addFiles(baseInput());
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatchObject({ code: 'UPLOAD_FAILED' });
  });

  it('PERSIST_FAILED: success:false → per-file error', async () => {
    const { deps } = makeDeps({ persistDocument: vi.fn(async () => ({ success: false, error: 'дублікат' })) });
    const res = await createAddFiles(deps).addFiles(baseInput());
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatchObject({ code: 'PERSIST_FAILED', message: 'дублікат' });
  });
});

describe('addFiles — batch-стійкість (комбо)', () => {
  it('3 файли, середній падає на convert → 2 додано, 1 помилка, інші персиститься', async () => {
    const convertToPdf = vi.fn(async (raw) => {
      if (raw.name === 'bad.docx') throw new Error('convert boom');
      return {
        pdfBlob: { size: 10 }, originalBlob: null, pdfName: raw.name, originalName: raw.name,
        originalMime: 'application/pdf', extractedText: null, warnings: [], converter: 'passthrough',
      };
    });
    const { deps } = makeDeps({ convertToPdf });
    const res = await createAddFiles(deps).addFiles(baseInput([
      { fileId: 'f1', raw: { name: 'a.pdf', size: 5, type: 'application/pdf' } },
      { fileId: 'f2', raw: { name: 'bad.docx', size: 5, type: 'application/docx' } },
      { fileId: 'f3', raw: { name: 'c.pdf', size: 5, type: 'application/pdf' } },
    ]));
    expect(res.ok).toBe(true);
    expect(res.documents).toHaveLength(2);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatchObject({ code: 'CONVERT_FAILED', fileId: 'f2' });
    expect(deps.persistDocument).toHaveBeenCalledTimes(2);
  });

  it('усі падають → ok:false', async () => {
    const { deps } = makeDeps({ uploadFile: vi.fn(async () => { throw new Error('net'); }) });
    const res = await createAddFiles(deps).addFiles(baseInput([
      { fileId: 'f1', raw: { name: 'a.pdf', size: 5, type: 'application/pdf' } },
      { fileId: 'f2', raw: { name: 'b.pdf', size: 5, type: 'application/pdf' } },
    ]));
    expect(res.ok).toBe(false);
    expect(res.documents).toHaveLength(0);
    expect(res.errors).toHaveLength(2);
  });
});

describe('addFiles — DOCX оригінал поряд + merge артефакти', () => {
  it('conversion.originalBlob → другий upload, originalDriveId у результаті', async () => {
    const { deps } = makeDeps({
      convertToPdf: vi.fn(async () => ({
        pdfBlob: { size: 10 }, originalBlob: { size: 20 }, pdfName: 'd', originalName: 'd.docx',
        originalMime: 'application/vnd...', extractedText: 'текст', warnings: [], converter: 'docxToPdf',
      })),
    });
    const res = await createAddFiles(deps).addFiles(baseInput([{ fileId: 'doc', raw: { name: 'd.docx', size: 5, type: 'application/docx' } }]));
    expect(deps.uploadFile).toHaveBeenCalledTimes(2);            // PDF + оригінал .docx
    expect(res.files[0].originalDriveId).toBeTruthy();
    expect(res.files[0].extractedText).toBe('текст');
  });

  it('збій upload оригіналу → ORIGINAL_UPLOAD_FAILED warning, документ усе одно створено', async () => {
    let call = 0;
    const { deps } = makeDeps({
      uploadFile: vi.fn(async () => { call += 1; if (call === 2) throw new Error('orig fail'); return `drive_${call}`; }),
      convertToPdf: vi.fn(async () => ({
        pdfBlob: { size: 10 }, originalBlob: { size: 20 }, pdfName: 'd', originalName: 'd.docx',
        originalMime: 'application/vnd...', extractedText: null, warnings: [], converter: 'docxToPdf',
      })),
    });
    const res = await createAddFiles(deps).addFiles(baseInput([{ fileId: 'doc', raw: { name: 'd.docx', size: 5, type: 'application/docx' } }]));
    expect(res.ok).toBe(true);
    expect(res.files[0].warnings).toContain('ORIGINAL_UPLOAD_FAILED');
    expect(res.files[0].originalDriveId).toBeNull();
  });

  it('mergeArtifacts → extractedText/mergeLayoutJson у результаті', async () => {
    const { deps } = makeDeps();
    const res = await createAddFiles(deps).addFiles(baseInput([{
      fileId: 'doc', raw: { name: 'merged.pdf', size: 5, type: 'application/pdf' },
      mergeArtifacts: { extractedText: 'склеєний текст', layoutJson: '{"pages":[]}' },
    }]));
    expect(res.files[0].extractedText).toBe('склеєний текст');
    expect(res.files[0].mergeLayoutJson).toBe('{"pages":[]}');
  });
});

describe('addFiles — події', () => {
  it('updateCaseContext:true потрапляє у batch payload', async () => {
    const { deps, published } = makeDeps();
    await createAddFiles(deps).addFiles(baseInput(), { updateCaseContext: true });
    const batch = published.find((e) => e.t === 'document.batch_processed');
    expect(batch.p.updateCaseContext).toBe(true);
  });

  it('без eventBus — не кидає (deps опційні)', async () => {
    const { deps } = makeDeps({ eventBus: undefined, topics: undefined });
    const res = await createAddFiles(deps).addFiles(baseInput());
    expect(res.ok).toBe(true);
  });
});
