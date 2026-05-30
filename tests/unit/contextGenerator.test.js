// Юніт-тести спільного сервісу contextGenerator.
// TASK 2 (винос) + TASK DP context fixes (#7 джерело=реєстр, #6 дата+час).
// Перевіряють КОНТРАКТ:
//   • #7 джерело документів = caseData.documents (канонічний SSOT), НЕ folder-scan
//     → лік = documents.length, нуль .layout.json/folder-артефактів;
//   • текст береться через ocrService (кеш/OCR) — text-layer PDF без .txt не губиться;
//   • документ без driveId → пропущено з warning у stats.skipped;
//   • C7 — AI usage логування (logAiUsage + activityTracker) збережено;
//   • #6 — у системний промпт підставляється дата+час генерації;
//   • структуровані коди розвилок (NO_FILES / AUTH / NO_API_KEY / EMPTY / SAVE_FAILED).
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

// Канонічний реєстр справи: 3 реальні документи (SSOT). Жодних folder-артефактів
// (.layout.json, копії 01/02) — їх більше не існує у джерелі генерації (#7).
const CASE = {
  id: 'case_ctx_1',
  name: 'Брановський',
  case_no: '760/1234/25',
  category: 'civil',
  client: 'Брановський І.І.',
  storage: { driveFolderId: 'folder_root' },
  pinnedNoteIds: [],
  documents: [
    { id: 'doc_1', driveId: 'drive_1', name: 'Позовна заява', documentNature: 'searchable' },
    { id: 'doc_2', driveId: 'drive_2', name: 'Ухвала суду', documentNature: 'scanned' },
    { id: 'doc_3', driveId: 'drive_3', name: 'Висновок експертизи', documentNature: 'scanned' },
  ],
};

function makeDeps(over = {}) {
  const aiUsageEntries = [];
  const aiUsageSink = vi.fn((updater) => {
    const next = typeof updater === 'function' ? updater(aiUsageEntries.slice()) : updater;
    aiUsageEntries.length = 0;
    aiUsageEntries.push(...(Array.isArray(next) ? next : []));
  });

  // driveRequest тепер обслуговує ЛИШЕ архівацію (copy/delete) — folder-scan
  // джерела документів більше немає (#7).
  const driveRequest = over.driveRequest || vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));

  const fetchCalls = [];
  const fetchImpl = over.fetchImpl || vi.fn(async (url, opts) => {
    fetchCalls.push({ url, opts, body: opts?.body ? JSON.parse(opts.body) : null });
    return {
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '# Справа Брановський №760/1234/25\nнарис...' }],
        usage: { input_tokens: 123, output_tokens: 456 },
      }),
    };
  });

  return {
    caseData: over.caseData || CASE,
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
    fetchImpl,
    _fetchCalls: fetchCalls,
    _aiUsageEntries: aiUsageEntries,
    ...over,
  };
}

describe('contextGenerator — #7 джерело = реєстр cases[].documents (SSOT)', () => {
  it('лік = caseData.documents.length, OCR кличеться рівно по документах реєстру', async () => {
    const deps = makeDeps();
    const res = await generateCaseContext(deps);

    expect(res.saved).toBe(true);
    expect(res.stats).toEqual({ count: 3, fromCache: 0, failed: 0, skipped: 0 });

    expect(deps.ocrService.extractTextBatch).toHaveBeenCalledOnce();
    const passed = deps.ocrService.extractTextBatch.mock.calls[0][0];
    // рівно 3 документи реєстру, по driveId — жодних folder-артефактів
    expect(passed).toHaveLength(3);
    expect(passed.map(f => f.id).sort()).toEqual(['drive_1', 'drive_2', 'drive_3']);
    expect(passed.map(f => f.name)).toEqual(['Позовна заява', 'Ухвала суду', 'Висновок експертизи']);
    // нуль .layout.json / .txt / case_context.md серед джерела
    expect(passed.some(f => /\.layout\.json$|\.txt$|case_context\.md/.test(f.name))).toBe(false);
  });

  it('text-layer документ не губиться: текст береться через ocrService навіть без .txt-кешу', async () => {
    // OCR повертає свіжий текст (fromCache:false) для searchable-PDF без .txt —
    // саме те що дає pdfjsLocal на text-layer. Документ присутній у нарисі.
    const ocrService = {
      extractTextBatch: vi.fn(async (files) => files.map(f => ({
        file: f,
        result: { text: `повний текст ${f.name}`, provider: 'pdfjsLocal', fromCache: false },
      }))),
      localizeOcrError: (c) => `err:${c}`,
    };
    const deps = makeDeps({ ocrService });
    const res = await generateCaseContext(deps);
    expect(res.saved).toBe(true);
    expect(res.stats.count).toBe(3);
    // у тіло AI пішли всі 3 документи (текст у user-content)
    const body = deps._fetchCalls[0].body;
    const userText = JSON.stringify(body.messages[0].content);
    expect(userText).toContain('Позовна заява');
    expect(userText).toContain('Висновок експертизи');
  });

  it('документ без driveId → пропущено з warning, рахується у stats.skipped', async () => {
    const caseData = {
      ...CASE,
      documents: [
        { id: 'doc_1', driveId: 'drive_1', name: 'Позов' },
        { id: 'doc_2', driveId: null, name: 'Без файлу' },     // ще не вивантажено на Drive
      ],
    };
    const deps = makeDeps({ caseData });
    const res = await generateCaseContext(deps);
    expect(res.saved).toBe(true);
    expect(res.stats.count).toBe(1);
    expect(res.stats.skipped).toBe(1);
    const passed = deps.ocrService.extractTextBatch.mock.calls[0][0];
    expect(passed).toHaveLength(1);
    expect(passed[0].id).toBe('drive_1');
  });

  it('порожній реєстр (нема документів з driveId) → NO_FILES', async () => {
    const deps = makeDeps({ caseData: { ...CASE, documents: [] } });
    const res = await generateCaseContext(deps);
    expect(res).toEqual({ saved: false, error: { code: 'NO_FILES' } });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });
});

describe('contextGenerator — #6 дата+час у нарисі', () => {
  it('системний промпт містить «Сьогодні:» з датою І часом (YYYY-MM-DD HH:MM)', async () => {
    const deps = makeDeps();
    await generateCaseContext(deps);
    const sys = deps._fetchCalls[0].body.system;
    expect(sys).toMatch(/Сьогодні:\s*\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    // шапка інструктує писати дату І час у Створено/Оновлено
    expect(sys).toContain('Створено: [ISO дата і час');
  });
});

describe('contextGenerator — щасливий шлях (збереження, C7, архів)', () => {
  it('зберігає case_context.md у корінь справи', async () => {
    const deps = makeDeps();
    const res = await generateCaseContext(deps);
    expect(res.saved).toBe(true);
    expect(res.contextText).toContain('# Справа Брановський');
    expect(deps.uploadFileToDrive).toHaveBeenCalledOnce();
    const [name, , folderId] = deps.uploadFileToDrive.mock.calls[0];
    expect(name).toBe('case_context.md');
    expect(folderId).toBe('folder_root');
  });

  it('C7: logAiUsage (case_context_generator) + activityTracker.report', async () => {
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
    expect(sink).toBe(deps.aiUsageSink);
    expect(deps.activityTracker.report).toHaveBeenCalledWith(
      'agent_call',
      expect.objectContaining({
        caseId: 'case_ctx_1',
        metadata: { agentType: 'case_context_generator', operation: 'generate_context' },
      }),
    );
  });

  it('#2 архівує існуючий case_context.md перед перезаписом (спільний сервіс — обидва шляхи)', async () => {
    const listFolderFiles = vi.fn(async () => [{ id: 'old_ctx', name: 'case_context.md' }]);
    const deps = makeDeps({ listFolderFiles });
    await generateCaseContext(deps);
    expect(deps.findOrCreateFolder).toHaveBeenCalledWith('archive', 'folder_root', 'tok');
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
    const caseData = {
      ...CASE,
      documents: [
        { id: 'd1', driveId: 'a', name: 'a' },
        { id: 'd2', driveId: 'b', name: 'b' },
      ],
    };
    const deps = makeDeps({ ocrService, caseData });
    const res = await generateCaseContext(deps);
    expect(res.saved).toBe(true);
    expect(res.stats).toEqual({ count: 2, fromCache: 1, failed: 1, skipped: 0 });
  });
});

describe('contextGenerator — структуровані розвилки (UI у компоненті)', () => {
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
    expect(deps.ocrService.extractTextBatch).toHaveBeenCalledOnce();
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
    expect(res.contextText).toContain('# Справа');
  });

  it('AI HTTP-помилка — кидає (компонент ловить у свій catch)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' }));
    const deps = makeDeps({ fetchImpl });
    await expect(generateCaseContext(deps)).rejects.toThrow(/API 500/);
  });
});
