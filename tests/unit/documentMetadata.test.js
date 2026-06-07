// TASK 4 · етап D — enrichDocumentWithVisionMetadata (спільний оркестратор
// «без OCR»). DI: extractMetadata/setExtended/executeAction інжектуються →
// без мережі/Drive. Перевіряємо: пропозиції лише у порожні поля, name лише при
// namingStatus='auto', gist→extended, НІКОЛИ lastOcrAt, best-effort на збоях,
// і що НІЯКИХ артефактів у 02 не пишеться (функція їх просто не вміє).
import { describe, it, expect, vi } from 'vitest';

// Мокаємо OCR-провайдери (тягнуть pdfjs/DOM) — orchestrator-у потрібен лише
// claudeVision.canHandle через ocrService.canVisionMetadata; extractMetadata
// інжектуємо у виклик. documentAi/pdfjsLocal мокаємо щоб ocrService не тягнув pdfjs.
vi.mock('../../src/services/ocr/claudeVision.js', () => ({
  default: {
    name: 'claudeVision',
    canHandle: (file) => file?.mimeType === 'application/pdf' || file?.mimeType?.startsWith('image/'),
    extract: vi.fn(),
    extractMetadata: vi.fn(),
  },
}));
vi.mock('../../src/services/ocr/documentAi.js', () => ({
  default: { name: 'documentAi', canHandle: () => false, extract: vi.fn() },
}));
vi.mock('../../src/services/ocr/pdfjsLocal.js', () => ({
  default: { name: 'pdfjsLocal', canHandle: () => false, extract: vi.fn() },
}));

import { enrichDocumentWithVisionMetadata } from '../../src/services/documentMetadata.js';

const PDF = { id: 'drive1', name: 'a.pdf', mimeType: 'application/pdf', subFolders: {} };

function deps({ meta, doc } = {}) {
  const executeAction = vi.fn(async () => ({ success: true }));
  const setExtended = vi.fn(async () => {});
  const extractMetadata = vi.fn(async () => ({
    date: '2026-01-02', category: 'motion', author: 'court',
    name: 'Ухвала суду', gist: 'Суд призначив засідання.', ...meta,
  }));
  const document = {
    id: 'doc1', namingStatus: 'auto',
    date: null, category: null, author: null, name: 'a',
    ...doc,
  };
  return { executeAction, setExtended, extractMetadata, document };
}

describe('enrichDocumentWithVisionMetadata', () => {
  it('заповнює порожні поля + name(auto) + gist у extended; НІКОЛИ lastOcrAt', async () => {
    const { executeAction, setExtended, extractMetadata, document } = deps();
    const res = await enrichDocumentWithVisionMetadata({
      ocrFile: PDF, doc: document, caseId: 'c1', caseData: { id: 'c1' },
      executeAction, agentId: 'document_processor_agent', extractMetadata, setExtended,
    });
    expect(res.ok).toBe(true);
    expect(executeAction).toHaveBeenCalledTimes(1);
    const [agentId, action, params] = executeAction.mock.calls[0];
    expect(agentId).toBe('document_processor_agent');
    expect(action).toBe('update_document');
    expect(params.fields).toEqual({
      date: '2026-01-02', category: 'motion', author: 'court', name: 'Ухвала суду',
    });
    expect(params.fields).not.toHaveProperty('lastOcrAt'); // повного OCR не було
    expect(setExtended).toHaveBeenCalledWith('c1', { id: 'c1' }, 'doc1', {
      extractedTextSummary: 'Суд призначив засідання.',
    });
  });

  it('НЕ затирає поля що адвокат уже задав; name лишає при namingStatus=manual', async () => {
    const { executeAction, setExtended, extractMetadata } = deps();
    await enrichDocumentWithVisionMetadata({
      ocrFile: PDF,
      doc: { id: 'doc1', namingStatus: 'manual', date: '2025-12-01', category: 'pleading', author: 'ours', name: 'Мій позов' },
      caseId: 'c1', caseData: { id: 'c1' },
      executeAction, agentId: 'dossier_agent', extractMetadata, setExtended,
    });
    // Усі канонічні поля вже заповнені/manual → update_document взагалі не кличемо.
    expect(executeAction).not.toHaveBeenCalled();
    // gist все одно йде в extended.
    expect(setExtended).toHaveBeenCalledTimes(1);
  });

  it('частковий fill: порожня дата заповнюється, наявна категорія — ні', async () => {
    const { executeAction, setExtended, extractMetadata } = deps();
    await enrichDocumentWithVisionMetadata({
      ocrFile: PDF,
      doc: { id: 'doc1', namingStatus: 'manual', date: null, category: 'evidence', author: null, name: 'Доказ' },
      caseId: 'c1', caseData: { id: 'c1' }, executeAction, extractMetadata, setExtended,
    });
    const params = executeAction.mock.calls[0][2];
    expect(params.fields).toEqual({ date: '2026-01-02', author: 'court' });
    expect(params.fields).not.toHaveProperty('category'); // вже задано — не чіпаємо
    expect(params.fields).not.toHaveProperty('name');      // manual — не чіпаємо
  });

  it('непідтримуваний тип (XLSX) → ok:false, нічого не кличе', async () => {
    const { executeAction, setExtended, extractMetadata } = deps();
    const res = await enrichDocumentWithVisionMetadata({
      ocrFile: { id: 'd', name: 'x.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      doc: { id: 'doc1', namingStatus: 'auto' }, caseId: 'c1', caseData: { id: 'c1' },
      executeAction, extractMetadata, setExtended,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('unsupported');
    expect(extractMetadata).not.toHaveBeenCalled();
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('збій extract → ok:false (best-effort), без update/extended', async () => {
    const executeAction = vi.fn(async () => ({ success: true }));
    const setExtended = vi.fn(async () => {});
    const extractMetadata = vi.fn(async () => { const e = new Error('rate'); e.code = 'QUOTA'; throw e; });
    const res = await enrichDocumentWithVisionMetadata({
      ocrFile: PDF, doc: { id: 'doc1', namingStatus: 'auto' }, caseId: 'c1', caseData: { id: 'c1' },
      executeAction, extractMetadata, setExtended,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('QUOTA');
    expect(executeAction).not.toHaveBeenCalled();
    expect(setExtended).not.toHaveBeenCalled();
  });

  it('без executeAction / без doc → ok:false no_target', async () => {
    const r1 = await enrichDocumentWithVisionMetadata({ ocrFile: PDF, doc: { id: 'd' }, caseId: 'c1' });
    expect(r1.ok).toBe(false);
    expect(r1.error).toBe('no_target');
    const r2 = await enrichDocumentWithVisionMetadata({ ocrFile: PDF, executeAction: vi.fn() });
    expect(r2.ok).toBe(false);
  });
});
