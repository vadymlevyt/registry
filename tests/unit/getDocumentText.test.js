// TASK 4 §7.1 — getDocumentText (єдина точка ВІРНОГО тексту) + getCleanOrRawText
// (Текст-таб): scanned → layout (page._text); searchable → текстовий шар PDF
// (pdfjsLocal extractTextLayer, БЕЗ OCR). `.txt` прибрано як джерело повністю.
// + suffix-storage writeMarkdownArtifact (.clean.md / .digest.md).
// In-memory Drive-мок (list повертає всі файли папки — ocrService фільтрує по
// name; read віддає вміст; upload додає файл). pdfjsLocal.extract керується
// через pdfjsState (текстовий шар PDF / UNSUPPORTED для скана без шару).

import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = { files: [], nextId: 1 };   // { id, name, content }
const pdfjsState = { text: null, error: null };   // керує extractTextLayer

vi.mock('../../src/services/driveAuth.js', () => ({
  driveRequest: vi.fn(async (url, opts = {}) => {
    // list folder files
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?q=')) {
      return new Response(JSON.stringify({ files: store.files.map((f) => ({ id: f.id, name: f.name })) }), { status: 200 });
    }
    // multipart upload
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      const form = opts.body;
      const meta = JSON.parse(await form.get('metadata').text());
      const content = await form.get('file').text();
      const id = `drv_${store.nextId++}`;
      // upsert by name (writeArtifact видаляє існуючий перед записом, але мок
      // delete не чистить — тому просто перезаписуємо по імені для read-back).
      store.files = store.files.filter((f) => f.name !== meta.name);
      store.files.push({ id, name: meta.name, content });
      return new Response(JSON.stringify({ id, name: meta.name }), { status: 200 });
    }
    // read media
    const readMatch = url.match(/\/files\/([^?]+)\?alt=media/);
    if (readMatch) {
      const f = store.files.find((x) => x.id === readMatch[1]);
      return f ? new Response(f.content, { status: 200 }) : new Response('', { status: 404 });
    }
    // delete (no-op for store)
    return new Response('', { status: 204 });
  }),
}));

vi.mock('../../src/services/ocr/documentAi.js', () => ({ default: { name: 'documentAi', canHandle: () => false, extract: vi.fn() } }));
vi.mock('../../src/services/ocr/claudeVision.js', () => ({ default: { name: 'claudeVision', canHandle: () => false, extract: vi.fn() } }));
vi.mock('../../src/services/ocr/pdfjsLocal.js', () => ({
  default: {
    name: 'pdfjsLocal',
    canHandle: () => false,
    extract: vi.fn(async () => {
      if (pdfjsState.error) throw pdfjsState.error;
      return { text: pdfjsState.text || '', pageCount: pdfjsState.text ? 1 : 0, warnings: [] };
    }),
  },
}));

const {
  getDocumentText, getCleanOrRawText, getVariantMarkdown, writeMarkdownArtifact,
} = await import('../../src/services/ocrService.js');

const SUB = { '02_ОБРОБЛЕНІ': 'folder02' };
const caseData = { storage: { subFolders: SUB } };
// basename для doc.name='Скан.pdf', driveId='drv_1' → 'Скан_drv_1'
const scannedDoc = { id: 'doc_1', name: 'Скан.pdf', driveId: 'drv_1', documentNature: 'scanned' };
const searchableDoc = { id: 'doc_2', name: 'Скан.pdf', driveId: 'drv_1', documentNature: 'searchable' };
const UNSUPPORTED = () => Object.assign(new Error('PDF без текстового шару (скан)'), { code: 'UNSUPPORTED' });

function seedLayout(text) {
  store.files.push({ id: `L${store.nextId++}`, name: 'Скан_drv_1.layout.json', content: JSON.stringify({ schemaVersion: 1, pages: text.map((t) => ({ _text: t })) }) });
}
function seedTxt(content) {
  store.files.push({ id: `T${store.nextId++}`, name: 'Скан_drv_1.txt', content });
}
function seedMd(suffix, content) {
  store.files.push({ id: `M${store.nextId++}`, name: `Скан_drv_1.${suffix}`, content });
}

beforeEach(() => { store.files = []; store.nextId = 1; pdfjsState.text = null; pdfjsState.error = null; });

describe('getDocumentText — ВІРНИЙ текст (layout → текстовий шар PDF), НІКОЛИ не дайджест', () => {
  it('scanned з layout → з\'єднаний page._text (вірний шар)', async () => {
    seedLayout(['Сторінка перша.', 'Сторінка друга.']);
    seedMd('digest.md', '# Конспект (переказ)');   // дайджест ПРИСУТНІЙ — але НЕ повертаємо
    const t = await getDocumentText(scannedDoc, caseData);
    expect(t).toContain('Сторінка перша.');
    expect(t).toContain('Сторінка друга.');
    expect(t).not.toContain('Конспект');           // вірне джерело, не переказ
  });

  it('searchable без layout → текстовий шар PDF (extractTextLayer), БЕЗ .txt', async () => {
    pdfjsState.text = 'текст із текстового шару PDF';
    const t = await getDocumentText(searchableDoc, caseData);
    expect(t).toBe('текст із текстового шару PDF');
  });

  it('старий скан лише з .txt (без layout, без текстового шару) → "" — .txt НЕ джерело', async () => {
    seedTxt('старий сирий OCR .txt');     // .txt присутній на Drive — але НЕ читаємо
    pdfjsState.error = UNSUPPORTED();      // скан → текстового шару нема
    const t = await getDocumentText(scannedDoc, caseData);
    expect(t).toBe('');
  });

  it('ні layout, ні текстового шару → ""', async () => {
    const t = await getDocumentText(scannedDoc, caseData);   // pdfjs повертає ''
    expect(t).toBe('');
  });

  it('нема subFolders, нема текстового шару → ""', async () => {
    pdfjsState.error = UNSUPPORTED();
    const t = await getDocumentText(scannedDoc, { storage: {} });
    expect(t).toBe('');
  });
});

describe('getCleanOrRawText — Текст-таб (digest .md → вірний текст)', () => {
  it('є .digest.md → format md (Конспект)', async () => {
    seedLayout(['вірний шар']);
    seedMd('digest.md', '# Конспект');
    const r = await getCleanOrRawText({ id: 'drv_1', name: 'Скан.pdf', subFolders: SUB });
    expect(r).toEqual({ text: '# Конспект', format: 'md' });
  });

  it('legacy .md (без суфікса) читається як digest', async () => {
    seedMd('md', '# Legacy дайджест');
    const r = await getCleanOrRawText({ id: 'drv_1', name: 'Скан.pdf', subFolders: SUB });
    expect(r).toEqual({ text: '# Legacy дайджест', format: 'md' });
  });

  it('нема .md, але є layout → вірний текст (format txt) — скан без .txt', async () => {
    seedLayout(['layout текст без txt']);
    const r = await getCleanOrRawText({ id: 'drv_1', name: 'Скан.pdf', subFolders: SUB });
    expect(r.format).toBe('txt');
    expect(r.text).toContain('layout текст без txt');
  });

  it('нема .md/.layout → текстовий шар PDF (extractTextLayer), format txt', async () => {
    pdfjsState.text = 'текст із PDF шару';
    const r = await getCleanOrRawText({ id: 'drv_1', name: 'Скан.pdf', subFolders: SUB });
    expect(r).toEqual({ text: 'текст із PDF шару', format: 'txt' });
  });

  it('нема .md/.layout, є лише старий .txt без текстового шару → null (.txt НЕ джерело)', async () => {
    seedTxt('старий txt');                 // .txt присутній — але НЕ читаємо
    pdfjsState.error = UNSUPPORTED();
    const r = await getCleanOrRawText({ id: 'drv_1', name: 'Скан.pdf', subFolders: SUB });
    expect(r).toBeNull();
  });
});

describe('writeMarkdownArtifact — suffix-storage за mode', () => {
  it("mode 'digest' (default) → <base>_<id>.digest.md", async () => {
    await writeMarkdownArtifact({ id: 'drv_1', name: 'Скан.pdf', subFolders: SUB }, '# d');
    expect(store.files.some((f) => f.name === 'Скан_drv_1.digest.md')).toBe(true);
  });

  it("mode 'clean' → <base>_<id>.clean.md", async () => {
    await writeMarkdownArtifact({ id: 'drv_1', name: 'Скан.pdf', subFolders: SUB }, '# c', 'clean');
    expect(store.files.some((f) => f.name === 'Скан_drv_1.clean.md')).toBe(true);
  });

  it('обидва варіанти співіснують (не затирають один одного)', async () => {
    await writeMarkdownArtifact({ id: 'drv_1', name: 'Скан.pdf', subFolders: SUB }, '# d', 'digest');
    await writeMarkdownArtifact({ id: 'drv_1', name: 'Скан.pdf', subFolders: SUB }, '# c', 'clean');
    expect(store.files.some((f) => f.name === 'Скан_drv_1.digest.md')).toBe(true);
    expect(store.files.some((f) => f.name === 'Скан_drv_1.clean.md')).toBe(true);
  });
});

// V2-B — getVariantMarkdown: читач AI-варіанта за РЕЖИМОМ (в'ювер, вкладки).
describe('getVariantMarkdown — варіант за режимом (V2-B)', () => {
  const file = { id: 'drv_1', name: 'Скан.pdf', subFolders: SUB };

  it("mode 'clean' → читає <base>_<id>.clean.md", async () => {
    seedMd('clean.md', '# Чистий дослівний');
    seedMd('digest.md', '# Конспект переказ');
    const t = await getVariantMarkdown(file, 'clean');
    expect(t).toBe('# Чистий дослівний');   // саме clean, не digest
  });

  it("mode 'digest' → читає <base>_<id>.digest.md", async () => {
    seedMd('clean.md', '# Чистий дослівний');
    seedMd('digest.md', '# Конспект переказ');
    const t = await getVariantMarkdown(file, 'digest');
    expect(t).toBe('# Конспект переказ');
  });

  it("mode 'digest' → legacy <base>_<id>.md теж читається як digest", async () => {
    seedMd('md', '# Legacy дайджест');
    const t = await getVariantMarkdown(file, 'digest');
    expect(t).toBe('# Legacy дайджест');
  });

  it("mode 'clean' БЕЗ .clean.md (є лише legacy .md) → null (legacy ≠ Чистий)", async () => {
    seedMd('md', '# Legacy дайджест');
    const t = await getVariantMarkdown(file, 'clean');
    expect(t).toBeNull();
  });

  it('варіант не згенеровано → null', async () => {
    const t = await getVariantMarkdown(file, 'clean');
    expect(t).toBeNull();
  });
});
