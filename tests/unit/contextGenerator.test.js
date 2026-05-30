// Юніт-тести спільного сервісу contextGenerator (TASK 2 context_generator_unify).
// Перевіряють КОНТРАКТ виносу:
//   • повна генерація нарису (mock Drive/OCR/AI) + збереження на Drive;
//   • C7 — AI usage логування (logAiUsage + activityTracker) збережено при виносі;
//   • джерело тексту: беремо самі документи (НЕ лише .txt) → extractTextBatch;
//     text-layer PDF без .txt НЕ випадає (рішення адвоката, наслідок 1C);
//   • структуровані коди розвилок (NO_FILES / AUTH / NO_API_KEY / EMPTY / SAVE_FAILED)
//     замість toast/systemConfirm — UI лишається у компоненті (#11).
import { describe, it, expect, vi } from 'vitest';

// Сервіс статично імпортує реальний ocrService (дефолтний DI-шов), а той тягне
// OCR-провайдери з pdfjs/DOMMatrix, якого немає у Node-середовищі. Мокаємо лише
// тяжкі сторонні провайдери (стандартний патерн dp-layout-persist) — сам сервіс
// у тестах OCR не кличе (інжектимо стаб через deps.ocrService).
function makeProvider(name) {
  return { default: { name, canHandle: () => false, extract: vi.fn(async () => null) } };
}
vi.mock('../../src/services/ocr/documentAi.js', () => makeProvider('documentAi'));
vi.mock('../../src/services/ocr/claudeVision.js', () => makeProvider('claudeVision'));
vi.mock('../../src/services/ocr/pdfjsLocal.js', () => makeProvider('pdfjsLocal'));

import { generateCaseContext } from '../../src/components/CaseDossier/services/contextGenerator.js';

const CASE = {
  id: 'case_ctx_1',
  name: 'Брановський',
  case_no: '760/1234/25',
  category: 'civil',
  client: 'Брановський І.І.',
  storage: { driveFolderId: 'folder_root' },
  pinnedNoteIds: [],
};

// Стандартний набір DI-стабів. driveRequest віддає список файлів для
// collectFromFolder і ковтає copy/delete. Тести перевизначають точково.
function makeDeps(over = {}) {
  const aiUsageEntries = [];
  const aiUsageSink = vi.fn((updater) => {
    const next = typeof updater === 'function' ? updater(aiUsageEntries.slice()) : updater;
    aiUsageEntries.length = 0;
    aiUsageEntries.push(...(Array.isArray(next) ? next : []));
  });

  // driveRequest: розрізняємо за URL. Список файлів у підпапці → 1 PDF (без .txt),
  // 1 .txt-кеш, agent_history.json, case_context.md (останні три — мають відсіятись).
  const folderFiles = over.folderFiles || [
    { id: 'f_pdf', name: 'Позов.pdf', size: 1000, mimeType: 'application/pdf' },
    { id: 'f_txt', name: 'Позов.txt', size: 50, mimeType: 'text/plain' },
    { id: 'f_hist', name: 'agent_history.json', size: 10, mimeType: 'application/json' },
    { id: 'f_ctx', name: 'case_context.md', size: 10, mimeType: 'text/markdown' },
  ];
  const driveRequest = over.driveRequest || vi.fn(async (url) => {
    // Лістинг підпапки: q закодований (encodeURIComponent → пробіли %20), але
    // id підпапки (orig_id/proc_id) лишається літерально. 01_ОРИГІНАЛИ повертає
    // файли, 02_ОБРОБЛЕНІ — порожньо.
    if (typeof url === 'string' && url.includes('orig_id')) {
      return { ok: true, status: 200, json: async () => ({ files: folderFiles }) };
    }
    if (typeof url === 'string' && url.includes('proc_id')) {
      return { ok: true, status: 200, json: async () => ({ files: [] }) };
    }
    // copy / delete
    return { ok: true, status: 200, json: async () => ({}) };
  });

  return {
    caseData: CASE,
    notes: [],
    folderId: 'folder_root',
    subFolders: { '01_ОРИГІНАЛИ': 'orig_id', '02_ОБРОБЛЕНІ': 'proc_id' },
    token: 'tok',
    apiKey: 'sk-test',
    onProgress: vi.fn(),
    aiUsageSink,
    driveRequest,
    ocrService: over.ocrService || {
      extractTextBatch: vi.fn(async (files) => files.map(f => ({
        file: f,
        result: { text: `текст ${f.name}`, provider: 'documentAi', fromCache: false },
      }))),
      localizeOcrError: (c) => `err:${c}`,
    },
    resolveModel: vi.fn(() => 'claude-sonnet-test'),
    listFolderFiles: over.listFolderFiles || vi.fn(async () => []),
    findOrCreateFolder: vi.fn(async () => ({ id: 'archive_id' })),
    uploadFileToDrive: over.uploadFileToDrive || vi.fn(async () => ({ id: 'uploaded_ctx' })),
    logAiUsage: vi.fn(),
    activityTracker: { report: vi.fn() },
    fetchImpl: over.fetchImpl || vi.fn(async () => ({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '# Справа Брановський №760/1234/25\nнарис...' }],
        usage: { input_tokens: 123, output_tokens: 456 },
      }),
    })),
    _aiUsageEntries: aiUsageEntries,
    ...over,
  };
}

describe('contextGenerator.generateCaseContext — щасливий шлях', () => {
  it('повна генерація: збирає документи, OCR, AI, зберігає, повертає saved:true', async () => {
    const deps = makeDeps();
    const res = await generateCaseContext(deps);

    expect(res.saved).toBe(true);
    expect(res.contextText).toContain('# Справа Брановський');
    expect(res.stats).toEqual({ count: 1, fromCache: 0, failed: 0 });
    expect(deps.uploadFileToDrive).toHaveBeenCalledOnce();
    // upload іде у корінь справи з канонічним імʼям
    const [name, , folderId] = deps.uploadFileToDrive.mock.calls[0];
    expect(name).toBe('case_context.md');
    expect(folderId).toBe('folder_root');
  });

  it('джерело тексту: бере документи (PDF без .txt), .txt/agent_history/case_context відсіюються', async () => {
    const deps = makeDeps();
    await generateCaseContext(deps);

    expect(deps.ocrService.extractTextBatch).toHaveBeenCalledOnce();
    const passedFiles = deps.ocrService.extractTextBatch.mock.calls[0][0];
    const names = passedFiles.map(f => f.name);
    // text-layer PDF (без .txt) ПОТРАПЛЯЄ в OCR-набір
    expect(names).toContain('Позов.pdf');
    // службові/кеш — відсіяні
    expect(names).not.toContain('Позов.txt');
    expect(names).not.toContain('agent_history.json');
    expect(names).not.toContain('case_context.md');
  });

  it('C7: логує AI usage (logAiUsage case_context_generator) + activityTracker.report', async () => {
    const deps = makeDeps();
    await generateCaseContext(deps);

    expect(deps.logAiUsage).toHaveBeenCalledOnce();
    const [entry, sink] = deps.logAiUsage.mock.calls[0];
    expect(entry).toMatchObject({
      agentType: 'case_context_generator',
      model: 'claude-sonnet-test',
      inputTokens: 123,
      outputTokens: 456,
      context: { caseId: 'case_ctx_1', operation: 'generate_context' },
    });
    expect(sink).toBe(deps.aiUsageSink);    // той самий sink, без дублювання шляху

    expect(deps.activityTracker.report).toHaveBeenCalledWith(
      'agent_call',
      expect.objectContaining({
        caseId: 'case_ctx_1',
        metadata: { agentType: 'case_context_generator', operation: 'generate_context' },
      }),
    );
  });

  it('архівує існуючий case_context.md перед перезаписом', async () => {
    const listFolderFiles = vi.fn(async () => [{ id: 'old_ctx', name: 'case_context.md' }]);
    const deps = makeDeps({ listFolderFiles });
    await generateCaseContext(deps);

    expect(deps.findOrCreateFolder).toHaveBeenCalledWith('archive', 'folder_root', 'tok');
    // copy + delete старого через driveRequest
    const urls = deps.driveRequest.mock.calls.map(c => c[0]);
    expect(urls.some(u => u.includes('/copy'))).toBe(true);
    expect(urls.some(u => u.includes('old_ctx') && !u.includes('/copy'))).toBe(true);
  });

  it('OCR fromCache і помилки рахуються у stats (failed→плейсхолдер, не випадає)', async () => {
    const ocrService = {
      extractTextBatch: vi.fn(async (files) => files.map((f, i) => i === 0
        ? { file: f, result: { text: 'кеш', provider: 'documentAi', fromCache: true } }
        : { file: f, error: { code: 'NETWORK', message: 'fail' } })),
      localizeOcrError: (c) => `err:${c}`,
    };
    const folderFiles = [
      { id: 'a', name: 'a.pdf', mimeType: 'application/pdf' },
      { id: 'b', name: 'b.pdf', mimeType: 'application/pdf' },
    ];
    const deps = makeDeps({ ocrService, folderFiles });
    const res = await generateCaseContext(deps);
    expect(res.saved).toBe(true);
    expect(res.stats).toEqual({ count: 2, fromCache: 1, failed: 1 });
  });
});

describe('contextGenerator.generateCaseContext — структуровані розвилки (UI у компоненті)', () => {
  it('NO_FILES: жодного джерельного файлу', async () => {
    const deps = makeDeps({ folderFiles: [] });
    const res = await generateCaseContext(deps);
    expect(res).toEqual({ saved: false, error: { code: 'NO_FILES' } });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('AUTH: ВСІ OCR-результати AUTH → код AUTH, без AI-виклику', async () => {
    const ocrService = {
      extractTextBatch: vi.fn(async (files) => files.map(f => ({ file: f, error: { code: 'AUTH', message: 'no scope' } }))),
      localizeOcrError: (c) => `err:${c}`,
    };
    const deps = makeDeps({ ocrService });
    const res = await generateCaseContext(deps);
    expect(res).toEqual({ saved: false, error: { code: 'AUTH' } });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('NO_API_KEY: ключ відсутній (після OCR, як inline-версія)', async () => {
    const deps = makeDeps({ apiKey: null });
    const res = await generateCaseContext(deps);
    expect(res).toEqual({ saved: false, error: { code: 'NO_API_KEY' } });
    expect(deps.ocrService.extractTextBatch).toHaveBeenCalledOnce(); // OCR відпрацював
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('EMPTY: AI повернув порожній текст', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ content: [{ text: '' }], usage: {} }) }));
    const deps = makeDeps({ fetchImpl });
    const res = await generateCaseContext(deps);
    expect(res).toEqual({ saved: false, error: { code: 'EMPTY' } });
    expect(deps.uploadFileToDrive).not.toHaveBeenCalled();
  });

  it('SAVE_FAILED: Drive не підтвердив збереження', async () => {
    const uploadFileToDrive = vi.fn(async () => ({ error: { message: 'quota' } }));
    const deps = makeDeps({ uploadFileToDrive });
    const res = await generateCaseContext(deps);
    expect(res.saved).toBe(false);
    expect(res.error).toEqual({ code: 'SAVE_FAILED', message: 'quota' });
    expect(res.contextText).toContain('# Справа');   // текст є, лише не зберігся
  });

  it('AI HTTP-помилка — кидає (компонент ловить у свій catch)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' }));
    const deps = makeDeps({ fetchImpl });
    await expect(generateCaseContext(deps)).rejects.toThrow(/API 500/);
  });
});
