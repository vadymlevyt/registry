// Юніт-тести фасаду ocrService — фокус на парі .txt / .layout.json у 02_ОБРОБЛЕНІ.
// Принцип: .txt пишеться завжди коли є непорожній текст. .layout.json пишеться
// ТІЛЬКИ коли провайдер фактично повернув непорожній масив pageStructure
// (факт у відповіді, не декларація на провайдері).
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Мок-стан Drive ──────────────────────────────────────────────────────────
const driveState = {
  uploads: [], // { folderId, name, content, mimeType }
  deletes: [], // fileId
  files: new Map(),
  nextId: 1,
};

function resetDriveState() {
  driveState.uploads = [];
  driveState.deletes = [];
  driveState.files = new Map();
  driveState.nextId = 1;
}

vi.mock('../../src/services/driveAuth.js', () => ({
  driveRequest: vi.fn(async (url, opts = {}) => {
    // List folder files
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?q=')) {
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    }
    // Multipart upload
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      const form = opts.body; // FormData
      const metaBlob = form.get('metadata');
      const fileBlob = form.get('file');
      const metaText = await metaBlob.text();
      const fileText = await fileBlob.text();
      const meta = JSON.parse(metaText);
      const id = `drv_${driveState.nextId++}`;
      driveState.uploads.push({
        folderId: meta.parents?.[0] || null,
        name: meta.name,
        content: fileText,
        mimeType: fileBlob.type,
      });
      return new Response(JSON.stringify({ id, name: meta.name }), { status: 200 });
    }
    // DELETE
    const deleteMatch = url.match(/\/files\/([^?]+)$/);
    if (deleteMatch && opts.method === 'DELETE') {
      driveState.deletes.push(deleteMatch[1]);
      return new Response('', { status: 204 });
    }
    return new Response('', { status: 404 });
  }),
}));

// Мокаємо всіх трьох провайдерів — у тестах ми керуємо їх відповідями
// через `mockProviderState`, щоб перевірити поведінку ocrService під різні
// контракти результату.
const mockProviderState = {
  documentAi: { canHandle: true, result: null, error: null },
  claudeVision: { canHandle: true, result: null, error: null },
  pdfjsLocal: { canHandle: true, result: null, error: null },
};

function makeProvider(name) {
  return {
    default: {
      name,
      canHandle: () => mockProviderState[name].canHandle,
      extract: vi.fn(async () => {
        if (mockProviderState[name].error) throw mockProviderState[name].error;
        return mockProviderState[name].result;
      }),
    },
  };
}

vi.mock('../../src/services/ocr/documentAi.js', () => makeProvider('documentAi'));
vi.mock('../../src/services/ocr/claudeVision.js', () => makeProvider('claudeVision'));
vi.mock('../../src/services/ocr/pdfjsLocal.js', () => makeProvider('pdfjsLocal'));

// Імпорт ПІСЛЯ моків (vi.mock hoisting працює, але явність кращ для читача)
const { extractText } = await import('../../src/services/ocrService.js');

function fileFixture(overrides = {}) {
  return {
    id: 'drive_file_1',
    name: 'scan.pdf',
    mimeType: 'application/pdf',
    subFolders: { '02_ОБРОБЛЕНІ': 'folder_obrob' },
    ...overrides,
  };
}

beforeEach(() => {
  resetDriveState();
  mockProviderState.documentAi = { canHandle: true, result: null, error: null };
  mockProviderState.claudeVision = { canHandle: true, result: null, error: null };
  mockProviderState.pdfjsLocal = { canHandle: true, result: null, error: null };
});

describe('extractText — запис .txt і .layout.json у 02_ОБРОБЛЕНІ', () => {
  it('searchable PDF: pdfjsLocal повертає текст без pageStructure → пишемо тільки .txt', async () => {
    mockProviderState.pdfjsLocal.result = {
      text: 'Це текст з searchable PDF',
      pageCount: 3,
    };

    const result = await extractText(fileFixture(), { skipCache: true });

    expect(result.provider).toBe('pdfjsLocal');
    expect(result.text).toContain('searchable PDF');
    expect(result.hasLayout).toBe(false);
    expect(result.cacheWritten).toBe(true);
    expect(result.layoutWritten).toBe(false);

    const names = driveState.uploads.map((u) => u.name);
    expect(names).toContain('scan_drive_file_1.txt');
    expect(names).not.toContain('scan_drive_file_1.layout.json');
  });

  it('scanned PDF: documentAi повертає pageStructure → пишемо .txt і .layout.json', async () => {
    mockProviderState.pdfjsLocal.error = Object.assign(new Error('no text layer'), { code: 'UNSUPPORTED' });
    mockProviderState.documentAi.result = {
      text: 'Текст зі сканованого PDF',
      pageCount: 2,
      pageStructure: [
        { pageNumber: 1, paragraphs: [{ layout: {} }], _text: 'Сторінка 1' },
        { pageNumber: 2, paragraphs: [{ layout: {} }], _text: 'Сторінка 2' },
      ],
    };

    const result = await extractText(fileFixture(), { skipCache: true });

    expect(result.provider).toBe('documentAi');
    expect(result.hasLayout).toBe(true);
    expect(result.cacheWritten).toBe(true);
    expect(result.layoutWritten).toBe(true);

    const names = driveState.uploads.map((u) => u.name);
    expect(names).toContain('scan_drive_file_1.txt');
    expect(names).toContain('scan_drive_file_1.layout.json');

    const layoutUpload = driveState.uploads.find((u) => u.name === 'scan_drive_file_1.layout.json');
    const parsed = JSON.parse(layoutUpload.content);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.provider).toBe('documentAi');
    expect(parsed.pages).toHaveLength(2);
    expect(parsed.pages[0]._text).toBe('Сторінка 1');
  });

  it('зображення: documentAi напряму (pdfjsLocal не в ланцюжку) → .txt + .layout.json', async () => {
    mockProviderState.documentAi.result = {
      text: 'Текст з картинки',
      pageCount: 1,
      pageStructure: [{ pageNumber: 1, _text: 'Текст з картинки' }],
    };

    const result = await extractText(
      fileFixture({ name: 'photo.jpg', mimeType: 'image/jpeg' }),
      { skipCache: true }
    );

    expect(result.provider).toBe('documentAi');
    expect(result.hasLayout).toBe(true);

    const names = driveState.uploads.map((u) => u.name);
    expect(names).toContain('photo_drive_file_1.txt');
    expect(names).toContain('photo_drive_file_1.layout.json');
  });

  it('claudeVision повертає text без pageStructure → тільки .txt (контракт у відповіді)', async () => {
    // Симулюємо що pdfjsLocal і documentAi обидва впали — фолбек на claudeVision
    mockProviderState.pdfjsLocal.error = Object.assign(new Error('no text'), { code: 'UNSUPPORTED' });
    mockProviderState.documentAi.error = Object.assign(new Error('docai down'), { code: 'UNSUPPORTED' });
    mockProviderState.claudeVision.result = {
      text: 'Текст від Claude Vision',
      pageCount: 3,
    };

    const result = await extractText(fileFixture(), { skipCache: true });

    expect(result.provider).toBe('claudeVision');
    expect(result.hasLayout).toBe(false);

    const names = driveState.uploads.map((u) => u.name);
    expect(names).toContain('scan_drive_file_1.txt');
    expect(names).not.toContain('scan_drive_file_1.layout.json');
  });

  it('порожній pageStructure (масив [] від провайдера) → не пишемо .layout.json', async () => {
    mockProviderState.pdfjsLocal.error = Object.assign(new Error('no text'), { code: 'UNSUPPORTED' });
    mockProviderState.documentAi.result = {
      text: 'якийсь текст',
      pageCount: 0,
      pageStructure: [],
    };

    const result = await extractText(fileFixture(), { skipCache: true });

    expect(result.hasLayout).toBe(false);
    expect(result.layoutWritten).toBe(false);

    const names = driveState.uploads.map((u) => u.name);
    expect(names).not.toContain('scan_drive_file_1.layout.json');
  });

  it('DOCX без провайдера → UNSUPPORTED, нічого не пишемо', async () => {
    await expect(
      extractText(
        fileFixture({
          name: 'contract.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        { skipCache: true }
      )
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' });

    expect(driveState.uploads).toHaveLength(0);
  });

  it('повертає pageCount як число (не плутати з pageStructure масивом)', async () => {
    mockProviderState.pdfjsLocal.result = {
      text: 'searchable text',
      pageCount: 7,
    };

    const result = await extractText(fileFixture(), { skipCache: true });
    expect(typeof result.pageCount).toBe('number');
    expect(result.pageCount).toBe(7);
  });

  it('форсований провайдер через options.forceProvider обходить ланцюжок', async () => {
    mockProviderState.documentAi.result = {
      text: 'force result',
      pageCount: 1,
      pageStructure: [{ pageNumber: 1 }],
    };

    const result = await extractText(fileFixture(), {
      skipCache: true,
      forceProvider: 'documentAi',
    });

    expect(result.provider).toBe('documentAi');
    expect(result.hasLayout).toBe(true);
  });

  it('AUTH помилка на pdfjs пропускає documentAi/claudeVision (break з циклу)', async () => {
    // pdfjsLocal — текстовий формат, ланцюжок = [pdfjsLocal] для text/plain.
    // Тут перевіряємо break логіку через PDF (повний ланцюжок).
    mockProviderState.pdfjsLocal.error = Object.assign(new Error('drive auth'), { code: 'AUTH' });
    mockProviderState.documentAi.result = {
      text: 'should not see this',
      pageCount: 1,
      pageStructure: [{ pageNumber: 1 }],
    };

    await expect(
      extractText(fileFixture(), { skipCache: true })
    ).rejects.toMatchObject({ code: 'AUTH' });

    // documentAi не викликався — ocrService зробив break на AUTH
    expect(driveState.uploads).toHaveLength(0);
  });
});
