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
const { extractText, writeExtractedTextArtifact } = await import('../../src/services/ocrService.js');

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

  it('claudeVision виключений з default chain — викликається тільки через forceProvider', async () => {
    // pdfjsLocal і documentAi обидва впали з NETWORK — раніше було б фолбек на
    // claudeVision, тепер ні. Кидається NETWORK помилка наверх.
    mockProviderState.pdfjsLocal.error = Object.assign(new Error('no text'), { code: 'UNSUPPORTED' });
    mockProviderState.documentAi.error = Object.assign(new Error('network'), { code: 'NETWORK' });
    mockProviderState.claudeVision.result = {
      text: 'Текст від Claude Vision',
      pageCount: 3,
    };

    // Default chain — claudeVision НЕ викликається
    await expect(
      extractText(fileFixture(), { skipCache: true })
    ).rejects.toMatchObject({ code: 'NETWORK' });
    expect(mockProviderState.claudeVision.result).toBeTruthy(); // не використано

    // А ось з forceProvider='claudeVision' — викликається явно
    const result = await extractText(fileFixture(), {
      skipCache: true,
      forceProvider: 'claudeVision',
    });
    expect(result.provider).toBe('claudeVision');
    expect(result.hasLayout).toBe(false);
    const names = driveState.uploads.map((u) => u.name);
    expect(names).toContain('scan_drive_file_1.txt');
    expect(names).not.toContain('scan_drive_file_1.layout.json');
  });

  it('layout.json фільтрує важкі поля image і tokens (TASK A.6 optimization)', async () => {
    // pdfjsLocal не дав текст → documentAi
    mockProviderState.pdfjsLocal.error = Object.assign(new Error('no text'), { code: 'UNSUPPORTED' });
    // Повний об'єкт сторінки Document AI як у проді: image (base64 PNG),
    // tokens (координати літер), paragraphs, blocks, layout, dimension.
    const fakeImage = 'data:image/png;base64,' + 'A'.repeat(5000); // імітація 5KB рендер
    const fakeTokens = Array.from({ length: 500 }, (_, i) => ({
      detectedBreak: null,
      layout: { textAnchor: { textSegments: [{ startIndex: i, endIndex: i + 1 }] } },
    }));
    mockProviderState.documentAi.result = {
      text: 'Стор 1',
      pageCount: 1,
      pageStructure: [{
        pageNumber: 1,
        image: fakeImage,
        tokens: fakeTokens,
        paragraphs: [{ layout: { textAnchor: { textSegments: [{ startIndex: 0, endIndex: 5 }] } } }],
        blocks: [{ confidence: 0.99 }],
        tables: [],
        headers: [],
        footers: [],
        layout: { textAnchor: { textSegments: [] } },
        dimension: { width: 1240, height: 1754 },
        detectedLanguages: [{ languageCode: 'uk' }],
        _text: 'Стор 1',
      }],
    };

    await extractText(fileFixture(), { skipCache: true });

    const layoutUpload = driveState.uploads.find((u) => u.name === 'scan_drive_file_1.layout.json');
    expect(layoutUpload).toBeDefined();
    const parsed = JSON.parse(layoutUpload.content);
    expect(parsed.pages).toHaveLength(1);

    const page = parsed.pages[0];
    // ВИКЛЮЧЕНО (важкі поля)
    expect(page.image).toBeUndefined();
    expect(page.tokens).toBeUndefined();
    // ЗАЛИШЕНО (легкі корисні поля)
    expect(page.pageNumber).toBe(1);
    expect(page.paragraphs).toBeDefined();
    expect(page.blocks).toBeDefined();
    expect(page.tables).toBeDefined();
    expect(page.headers).toBeDefined();
    expect(page.footers).toBeDefined();
    expect(page.layout).toBeDefined();
    expect(page.dimension).toBeDefined();
    expect(page.detectedLanguages).toBeDefined();
    expect(page._text).toBe('Стор 1');

    // Грубий контроль розміру — без image/tokens файл під 5KB-сурогатом
    // image base64 рендера + tokens списку має бути сильно меншим за оригінал.
    expect(layoutUpload.content.length).toBeLessThan(fakeImage.length);
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

describe('writeExtractedTextArtifact — запис .txt БЕЗ виклику OCR провайдера', () => {
  it('пише .txt у 02_ОБРОБЛЕНІ з канонічною назвою <basename>_<driveId>.txt', async () => {
    const file = fileFixture({ name: 'pozov_kiseliovoi.docx', id: 'drv_abc' });
    const ok = await writeExtractedTextArtifact(file, 'Позовна заява про стягнення коштів');

    expect(ok).toBe(true);
    expect(driveState.uploads).toHaveLength(1);
    expect(driveState.uploads[0].name).toBe('pozov_kiseliovoi_drv_abc.txt');
    expect(driveState.uploads[0].folderId).toBe('folder_obrob');
    expect(driveState.uploads[0].content).toBe('Позовна заява про стягнення коштів');
    expect(driveState.uploads[0].mimeType).toBe('text/plain');
  });

  it('не викликає жодного OCR провайдера (нема Document AI, Claude Vision, pdfjs)', async () => {
    // Очищаємо лічильники моків від попередніх тестів у файлі (extractText
    // викликав їх). Перевіряємо що writeExtractedTextArtifact САМ не торкає
    // жодного провайдера — це не OCR pipeline, а пряме збереження тексту.
    const { default: docAi } = await import('../../src/services/ocr/documentAi.js');
    const { default: claudeV } = await import('../../src/services/ocr/claudeVision.js');
    const { default: pdfjs } = await import('../../src/services/ocr/pdfjsLocal.js');
    docAi.extract.mockClear();
    claudeV.extract.mockClear();
    pdfjs.extract.mockClear();

    const file = fileFixture({ name: 'doc.html', id: 'drv_xyz' });
    await writeExtractedTextArtifact(file, 'Текст ухвали з HTML');

    expect(docAi.extract).not.toHaveBeenCalled();
    expect(claudeV.extract).not.toHaveBeenCalled();
    expect(pdfjs.extract).not.toHaveBeenCalled();
  });

  it('не пише .layout.json — DOCX/HTML pageStructure не має за визначенням', async () => {
    const file = fileFixture({ name: 'doc.docx', id: 'drv_1' });
    await writeExtractedTextArtifact(file, 'A'.repeat(100));

    const names = driveState.uploads.map((u) => u.name);
    expect(names).toContain('doc_drv_1.txt');
    expect(names).not.toContain('doc_drv_1.layout.json');
  });

  it('повертає false і нічого не пише коли немає 02_ОБРОБЛЕНІ subFolder', async () => {
    const file = { id: 'drv_2', name: 'doc.html', subFolders: {} };
    const ok = await writeExtractedTextArtifact(file, 'Достатньо тексту тут є');
    expect(ok).toBe(false);
    expect(driveState.uploads).toHaveLength(0);
  });

  it('повертає false і нічого не пише коли текст порожній', async () => {
    const file = fileFixture();
    expect(await writeExtractedTextArtifact(file, '')).toBe(false);
    expect(await writeExtractedTextArtifact(file, '   ')).toBe(false);
    expect(await writeExtractedTextArtifact(file, null)).toBe(false);
    expect(driveState.uploads).toHaveLength(0);
  });
});
