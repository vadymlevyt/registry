// B2 (20.05.2026) — splitDocumentsV3 виставляє documentNature='scanned' на
// нарізаних документах, якщо джерело пройшло OCR (має непорожній layoutJson).
//
// Корінь: createDocument(meta) без явного documentNature падає у
// detectNature(metadata), яка для PDF-розширення повертає 'searchable'
// (documentFactory.js:199-201). DocumentViewer показує перемикач Скан/Текст
// ЛИШЕ для documentNature==='scanned' → на всіх нарізаних з 65-стор. скана
// перемикач зникав, текст з OCR не доступний для копіювання.
//
// Один сенс (правило #11): "якщо джерело потребувало OCR (є layoutJson) —
// нарізаний документ теж scanned; інакше — let detectNature вирішує".
// metadataTemplate.documentNature з convert-стадії (DOCX→PDF) має пріоритет
// (явне завжди над автодетектом).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSplitDocumentsV3 } from '../../src/services/documentPipeline/stages/splitDocumentsV3.js';
import { createWorkerClient } from '../../src/services/documentPipeline/workerClient.js';
import { createMemDrivePort } from '../_memDrivePort.js';
import { makePdfBytes } from '../_pdfFixture.js';

const wc = createWorkerClient({ forceInProcess: true });

async function seedSource(port, fileId, pages) {
  const folder = await port.getOrCreateFolder('_temp', null);
  const bytes = await makePdfBytes(pages);
  const up = await port.uploadBytes(folder.id, `orig_${fileId}.pdf`, bytes, 'application/pdf');
  return up.id;
}

function baseCtx(port, { plan, files }) {
  return {
    job: {
      caseId: 'c1', jobId: 'j1', addedBy: 'user', source: 'manual',
      caseData: { id: 'c1', storage: { subFolders: {} } },
    },
    files, documents: [], decisions: [], events: [],
    reconstructionPlan: plan, unusedPages: [],
  };
}

describe('splitDocumentsV3 B2 — documentNature на нарізаних', () => {
  let port;
  beforeEach(() => { port = createMemDrivePort(); });

  it('джерело з layoutJson (OCR відбувся) → нарізані документи documentNature="scanned"', async () => {
    const d = await seedSource(port, 'big', 6);
    const created = [];
    const stage = createSplitDocumentsV3({
      runInWorker: wc.runInWorker, drivePort: port,
      uploadFile: async () => 'final_drive',
      createDocument: (m) => ({ id: `doc_${m.name}`, ...m }),
      persistDocument: async ({ document }) => { created.push(document); return { success: true }; },
    });
    const layoutJson = { schemaVersion: 1, pages: Array.from({ length: 6 }, (_, i) => ({ _text: `p${i + 1}` })) };
    const res = await stage(baseCtx(port, {
      plan: {
        confirmed: true,
        documents: [
          { documentId: 'd1', name: 'Позов', type: 'pleading', route: 'slice', fragments: [{ fileId: 'big', startPage: 1, endPage: 3 }] },
          { documentId: 'd2', name: 'Квитанція', type: 'court_act', route: 'slice', fragments: [{ fileId: 'big', startPage: 4, endPage: 4 }] },
        ],
      },
      files: [{ fileId: 'big', driveId: d, skipped: false, layoutJson, pageCount: 6, metadataTemplate: {} }],
    }));
    expect(res.ok).toBe(true);
    expect(created).toHaveLength(2);
    expect(created[0].documentNature).toBe('scanned');
    expect(created[1].documentNature).toBe('scanned');
  });

  it('джерело з порожнім layoutJson (pages:[]) → fallback на detectNature', async () => {
    // pages:[] означає що OCR не повернув структури. Fallback на
    // detectNature → для .pdf повертає 'searchable' (це не наш кейс
    // основний, але contract має бути чистий).
    const d = await seedSource(port, 'f', 2);
    const created = [];
    const stage = createSplitDocumentsV3({
      runInWorker: wc.runInWorker, drivePort: port,
      uploadFile: async () => 'final_drive',
      createDocument: (m) => ({ id: `doc_${m.name}`, ...m, documentNature: m.documentNature || 'searchable' }),
      persistDocument: async ({ document }) => { created.push(document); return { success: true }; },
    });
    const res = await stage(baseCtx(port, {
      plan: { confirmed: true, documents: [{ documentId: 'd1', name: 'Док', route: 'slice', fragments: [{ fileId: 'f', startPage: 1, endPage: 2 }] }] },
      files: [{ fileId: 'f', driveId: d, skipped: false, layoutJson: { schemaVersion: 1, pages: [] }, pageCount: 2, metadataTemplate: {} }],
    }));
    expect(res.ok).toBe(true);
    // documentNature НЕ виставлене splitDocumentsV3 → залежить від
    // createDocument (тут стуб дає 'searchable'). Real createDocument
    // зробив би те саме через detectNature.
    expect(created[0].documentNature).toBe('searchable');
  });

  it('явний metadataTemplate.documentNature="searchable" → пробрасується (DOCX/HTML)', async () => {
    const d = await seedSource(port, 'f', 2);
    const created = [];
    const stage = createSplitDocumentsV3({
      runInWorker: wc.runInWorker, drivePort: port,
      uploadFile: async () => 'final_drive',
      createDocument: (m) => ({ id: `doc_${m.name}`, ...m }),
      persistDocument: async ({ document }) => { created.push(document); return { success: true }; },
    });
    const res = await stage(baseCtx(port, {
      plan: { confirmed: true, documents: [{ documentId: 'd1', name: 'X', route: 'add_as_is', fragments: [{ fileId: 'f', startPage: 1, endPage: 2 }] }] },
      // metadataTemplate явно несе documentNature='searchable' (з convert
      // стадії на DOCX/HTML). Це сильніший сигнал ніж layoutJson — caller
      // знає краще, ми не перетираємо.
      files: [{
        fileId: 'f', driveId: d, skipped: false,
        layoutJson: { schemaVersion: 1, pages: [{ _text: 'p1' }] },
        pageCount: 2, metadataTemplate: { documentNature: 'searchable' },
      }],
    }));
    expect(res.ok).toBe(true);
    expect(created[0].documentNature).toBe('searchable');
  });

  it('multi-fragment (fragment_reconstruct з двох scanned файлів) → "scanned"', async () => {
    const a = await seedSource(port, 'f0', 3);
    const b = await seedSource(port, 'f1', 2);
    const created = [];
    const stage = createSplitDocumentsV3({
      runInWorker: wc.runInWorker, drivePort: port,
      uploadFile: async () => 'drv',
      createDocument: (m) => ({ id: `doc_${m.name}`, ...m }),
      persistDocument: async ({ document }) => { created.push(document); return { success: true }; },
    });
    const res = await stage(baseCtx(port, {
      plan: {
        confirmed: true,
        documents: [{
          documentId: 'd1', name: 'Експертиза', type: 'evidence', route: 'fragment_reconstruct',
          fragments: [{ fileId: 'f0', startPage: 1, endPage: 3 }, { fileId: 'f1', startPage: 1, endPage: 2 }],
        }],
      },
      files: [
        { fileId: 'f0', driveId: a, skipped: false, layoutJson: { schemaVersion: 1, pages: [{ _text: 'A' }, { _text: 'A' }, { _text: 'A' }] }, pageCount: 3, metadataTemplate: {} },
        { fileId: 'f1', driveId: b, skipped: false, layoutJson: { schemaVersion: 1, pages: [{ _text: 'B' }, { _text: 'B' }] }, pageCount: 2, metadataTemplate: {} },
      ],
    }));
    expect(res.ok).toBe(true);
    expect(created[0].documentNature).toBe('scanned');
  });
});
