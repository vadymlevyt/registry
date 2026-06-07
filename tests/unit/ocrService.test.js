// Юніт-тести фасаду ocrService — артефакти у 02_ОБРОБЛЕНІ.
// Принцип (TASK 4 §7.1, повна відмова від .txt): фасад НІКОЛИ не пише .txt.
// scanned (pageStructure) → .layout.json (вірний текст читається з layout);
// searchable (текст без pageStructure) → НЕ кешуємо (текст у текстовому шарі
// самого PDF, дістається на вимогу через extractTextLayer). .layout.json —
// тільки коли масив pageStructure непорожній.
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
const { extractText, writeLayoutArtifact } = await import('../../src/services/ocrService.js');

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

describe('extractText — артефакти у 02_ОБРОБЛЕНІ (TASK 4 §7.1: без .txt)', () => {
  it('searchable PDF: pdfjsLocal повертає текст без pageStructure → НЕ пишемо нічого (.txt прибрано)', async () => {
    mockProviderState.pdfjsLocal.result = {
      text: 'Це текст з searchable PDF',
      pageCount: 3,
    };

    const result = await extractText(fileFixture(), { skipCache: true });

    expect(result.provider).toBe('pdfjsLocal');
    expect(result.text).toContain('searchable PDF');
    expect(result.hasLayout).toBe(false);
    expect(result.cacheWritten).toBe(false);
    expect(result.layoutWritten).toBe(false);

    // TASK 4 §7.1: searchable текст у самому PDF → жодного артефакту в 02.
    expect(driveState.uploads).toHaveLength(0);
    const names = driveState.uploads.map((u) => u.name);
    expect(names).not.toContain('scan_drive_file_1.txt');
    expect(names).not.toContain('scan_drive_file_1.layout.json');
  });

  it('scanned PDF: documentAi повертає pageStructure → пишемо ТІЛЬКИ .layout.json, БЕЗ .txt (V2-A2)', async () => {
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
    // V2-A2: layout є → .txt НЕ пишемо (вірний текст читається з layout).
    expect(result.cacheWritten).toBe(false);
    expect(result.layoutWritten).toBe(true);
    // TASK B fix round 2: extractText тепер повертає pageStructure щоб
    // multiImageToPdf міг побудувати об'єднаний layout.json для merge сценарію.
    expect(Array.isArray(result.pageStructure)).toBe(true);
    expect(result.pageStructure).toHaveLength(2);
    expect(result.pageStructure[0]._text).toBe('Сторінка 1');

    const names = driveState.uploads.map((u) => u.name);
    expect(names).not.toContain('scan_drive_file_1.txt');
    expect(names).toContain('scan_drive_file_1.layout.json');

    const layoutUpload = driveState.uploads.find((u) => u.name === 'scan_drive_file_1.layout.json');
    const parsed = JSON.parse(layoutUpload.content);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.provider).toBe('documentAi');
    expect(parsed.pages).toHaveLength(2);
    expect(parsed.pages[0]._text).toBe('Сторінка 1');
  });

  it('searchable provider без pageStructure → pageStructure=null у результаті', async () => {
    mockProviderState.pdfjsLocal.result = {
      text: 'Це searchable PDF',
      pageCount: 1,
    };
    const result = await extractText(fileFixture(), { skipCache: true });
    expect(result.hasLayout).toBe(false);
    expect(result.pageStructure).toBe(null);
  });

  it('зображення: documentAi напряму (pdfjsLocal не в ланцюжку) → ТІЛЬКИ .layout.json, БЕЗ .txt (V2-A2)', async () => {
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
    // V2-A2: layout є → .txt НЕ пишемо.
    expect(names).not.toContain('photo_drive_file_1.txt');
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
    expect(result.cacheWritten).toBe(false);
    // TASK 4 §7.1: текст без pageStructure → .txt НЕ пишемо (нічого в 02).
    const names = driveState.uploads.map((u) => u.name);
    expect(names).not.toContain('scan_drive_file_1.txt');
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

// TASK 4 §7.1: writeExtractedTextArtifact (.txt-запис) ВИДАЛЕНО разом з усім
// .txt-машинерієм фасаду — DOC/HTML конвертуються у searchable PDF, текст живе
// в текстовому шарі PDF. Окремих .txt-тестів більше нема.

// ── B1 · writeLayoutArtifact: object-only вхід, strip image/tokens завжди ────
// Корінь bug B1 (15.05.2026): DocumentPipelineContext.writeLayout02 робив
// JSON.stringify(layoutJson) ПЕРЕД writeLayoutArtifact — strip не запрацював
// на string → 14МБ файли в 02_ОБРОБЛЕНІ замість ~400КБ. Контракт після B1:
// writeLayoutArtifact приймає лише object і САМА робить strip+serialize.
// Якщо хтось через 3 місяці поверне "приймемо й string для зворотної
// сумісності" — цей набір тестів червоний (один сенс на функцію, #11).
describe('writeLayoutArtifact — strip важких полів (B1)', () => {
  function makeFakePageStructure() {
    // Реалістична сторінка Document AI: image (~5КБ base64), tokens (500 шт.),
    // легкі корисні поля (paragraphs, blocks, dimension).
    const fakeImage = 'data:image/png;base64,' + 'A'.repeat(5000);
    const fakeTokens = Array.from({ length: 500 }, (_, i) => ({
      detectedBreak: null,
      layout: { textAnchor: { textSegments: [{ startIndex: i, endIndex: i + 1 }] } },
    }));
    return [{
      pageNumber: 1,
      image: fakeImage,
      tokens: fakeTokens,
      paragraphs: [{ layout: { textAnchor: { textSegments: [{ startIndex: 0, endIndex: 5 }] } } }],
      blocks: [{ confidence: 0.99 }],
      dimension: { width: 1240, height: 1754 },
      detectedLanguages: [{ languageCode: 'uk' }],
      _text: 'Стор 1',
    }];
  }

  it('object {pages:[]} → пише .layout.json БЕЗ полів image/tokens', async () => {
    const file = fileFixture({ name: 'scan.pdf', id: 'drv_b1' });
    const layout = { schemaVersion: 1, pages: makeFakePageStructure() };

    const ok = await writeLayoutArtifact(file, layout);
    expect(ok).toBe(true);

    const upload = driveState.uploads.find((u) => u.name === 'scan_drv_b1.layout.json');
    expect(upload).toBeDefined();
    // Контракт серіалізації: рядок НЕ містить підрядка "image" і "tokens" як
    // ключів сторінки. Просте substring-перевірка ловить регресії типу
    // «strip забули, але JSON випадково валідний» (корінь B1 саме такий).
    expect(upload.content).not.toContain('"image"');
    expect(upload.content).not.toContain('"tokens"');
    // ЗАЛИШЕНО (легкі корисні поля)
    const parsed = JSON.parse(upload.content);
    expect(parsed.pages[0].image).toBeUndefined();
    expect(parsed.pages[0].tokens).toBeUndefined();
    expect(parsed.pages[0]._text).toBe('Стор 1');
    expect(parsed.pages[0].paragraphs).toBeDefined();
    expect(parsed.pages[0].blocks).toBeDefined();
    expect(parsed.pages[0].dimension).toBeDefined();
  });

  it('розмір записаного файла значно менший за сирий JSON.stringify(layout)', async () => {
    const file = fileFixture({ name: 'scan.pdf', id: 'drv_size' });
    const layout = { schemaVersion: 1, pages: makeFakePageStructure() };
    const rawSize = JSON.stringify(layout).length;          // з image/tokens

    await writeLayoutArtifact(file, layout);
    const upload = driveState.uploads.find((u) => u.name === 'scan_drv_size.layout.json');
    expect(upload).toBeDefined();

    // Фактичний контракт: strip викидає image (~5000) + tokens (~500 × N) —
    // записаний файл має бути радикально меншим. Числовий поріг свідомо
    // ослаблений (1/3) щоб не зловити шум серіалізації; ціль — зловити
    // регресію де strip взагалі не працює.
    expect(upload.content.length).toBeLessThan(rawSize / 3);
  });

  it('null/undefined → false, нічого не пише (один сенс — "записати наявний layout")', async () => {
    const file = fileFixture({ name: 'x.pdf', id: 'drv_n' });
    expect(await writeLayoutArtifact(file, null)).toBe(false);
    expect(await writeLayoutArtifact(file, undefined)).toBe(false);
    expect(driveState.uploads).toHaveLength(0);
  });

  it('object без поля pages → пише {schemaVersion,provider,generatedAt,pages:[]} без падіння', async () => {
    const file = fileFixture({ name: 'x.pdf', id: 'drv_empty' });
    const ok = await writeLayoutArtifact(file, { schemaVersion: 1, pages: [] });
    expect(ok).toBe(true);
    const upload = driveState.uploads.find((u) => u.name === 'x_drv_empty.layout.json');
    expect(upload).toBeDefined();
    const parsed = JSON.parse(upload.content);
    expect(Array.isArray(parsed.pages)).toBe(true);
    expect(parsed.pages).toHaveLength(0);
  });

  it('object з provider → provider пробрасується у JSON', async () => {
    const file = fileFixture({ name: 'x.pdf', id: 'drv_prov' });
    await writeLayoutArtifact(file, {
      schemaVersion: 1,
      provider: 'documentAi',
      pages: makeFakePageStructure(),
    });
    const upload = driveState.uploads.find((u) => u.name === 'x_drv_prov.layout.json');
    const parsed = JSON.parse(upload.content);
    expect(parsed.provider).toBe('documentAi');
  });
});
