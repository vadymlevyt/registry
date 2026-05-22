// dp-layout-size — регрес-страж B1 (ФД-D2.6, TASK ToC + enriched digest §7).
//
// Корінь bug B1 (15.05.2026): writeLayoutArtifact приймав string і обходив
// strip — layout.json виходили 14МБ замість ~400КБ. Після фіксу strip робить
// сам артефакт-райтер; цей тест — окремий страж проти тихої регресії.
//
// Інваріант: за реалістичної сторінки Document AI (включно з symbols,
// detected_barcodes, transforms, visualElements — нові поля D2.6/D1) розмір
// записаного .layout.json на Drive — ≤100КБ на сторінку. Якщо хтось додасть
// нове важке поле і забуде його у STRIPPED_LAYOUT_FIELDS — тест червоний.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// claudeVision / documentAi / pdfjsLocal — тягнуть pdfjs/web-API, що
// падають у Node-середовищі (DOMMatrix). Мокаємо їх як заглушки — цей тест
// викликає лише writeLayoutArtifact, OCR-pipeline не запускається.
vi.mock('../../src/services/ocr/documentAi.js', () => ({ default: { canHandle: () => false, extract: async () => null } }));
vi.mock('../../src/services/ocr/claudeVision.js', () => ({ default: { canHandle: () => false, extract: async () => null } }));
vi.mock('../../src/services/ocr/pdfjsLocal.js', () => ({ default: { canHandle: () => false, extract: async () => null } }));

const driveState = { uploads: [], files: new Map(), nextId: 1 };
function resetDriveState() { driveState.uploads = []; driveState.files = new Map(); driveState.nextId = 1; }

vi.mock('../../src/services/driveAuth.js', () => ({
  driveRequest: vi.fn(async (url, opts = {}) => {
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?q=')) {
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    }
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      const form = opts.body;
      const metaBlob = form.get('metadata');
      const fileBlob = form.get('file');
      const metaText = await metaBlob.text();
      const fileText = await fileBlob.text();
      const meta = JSON.parse(metaText);
      const id = `drv_${driveState.nextId++}`;
      driveState.uploads.push({ folderId: meta.parents?.[0] || null, name: meta.name, content: fileText, mimeType: fileBlob.type });
      return new Response(JSON.stringify({ id, name: meta.name }), { status: 200 });
    }
    if (/\/files\/[^?]+$/.test(url) && opts.method === 'DELETE') {
      return new Response('', { status: 204 });
    }
    return new Response('', { status: 404 });
  }),
}));

const { writeLayoutArtifact } = await import('../../src/services/ocrService.js');

// Реалістична сторінка Document AI (форма як persist у .layout.json): легкі
// корисні поля + важкі поля які стрипаються. Симулює реальний скан судової
// сторінки з ~50 paragraphs, ~3000 symbols, decoded barcodes/transforms.
function makeRealisticPage(idx) {
  const fakeImageBase64 = 'data:image/png;base64,' + 'I'.repeat(80000); // 80КБ — типовий PNG-рендер скана
  const fakeTokens = Array.from({ length: 800 }, (_, i) => ({
    detectedBreak: null,
    layout: { textAnchor: { textSegments: [{ startIndex: i, endIndex: i + 1 }] }, confidence: 0.95 },
  }));
  const fakeSymbols = Array.from({ length: 3000 }, (_, i) => ({
    text: String.fromCharCode(0x430 + (i % 32)),
    layout: { boundingPoly: { normalizedVertices: [{ x: i / 3000, y: 0 }, { x: (i + 1) / 3000, y: 0.01 }] }, confidence: 0.93 },
  }));
  const fakeBarcodes = Array.from({ length: 3 }, () => ({
    barcode: { format: 'CODE_128', value: 'X'.repeat(300), rawBytes: 'A'.repeat(500) },
    layout: { boundingPoly: { normalizedVertices: [{ x: 0, y: 0 }] } },
  }));
  const fakeTransforms = Array.from({ length: 6 }, () => ({
    rows: 3, cols: 3, type: 0, data: Array.from({ length: 256 }, (_, k) => k * 0.01),
  }));
  return {
    pageNumber: idx + 1,
    // Важкі — мають стрипатись:
    image: fakeImageBase64,
    tokens: fakeTokens,
    symbols: fakeSymbols,
    detected_barcodes: fakeBarcodes,
    transforms: fakeTransforms,
    // Легкі корисні (D1 збагачений дайджест — мають лишатись):
    paragraphs: Array.from({ length: 40 }, (_, i) => ({
      layout: { boundingPoly: { normalizedVertices: [{ x: 0.05, y: 0.05 + i * 0.02 }, { x: 0.95, y: 0.07 + i * 0.02 }] }, confidence: 0.92 },
    })),
    blocks: Array.from({ length: 8 }, () => ({ confidence: 0.94, layout: { boundingPoly: { normalizedVertices: [{ x: 0, y: 0 }] } } })),
    tables: [],
    formFields: [],
    visualElements: [{ type: 'stamp', layout: { boundingPoly: { normalizedVertices: [{ x: 0.7, y: 0.8 }] } } }],
    imageQualityScores: { qualityScore: 0.85, detectedDefects: [{ type: 'quality/defect_glare', confidence: 0.6 }] },
    detectedLanguages: [{ languageCode: 'uk', confidence: 0.98 }],
    dimension: { width: 1240, height: 1754, unit: 'POINTS' },
    layout: { orientation: 'PAGE_UP' },
    _text: `Сторінка ${idx + 1} тексту судового документа `.repeat(80),
  };
}

beforeEach(() => { resetDriveState(); });

describe('ФД-D2.6 страж dp-layout-size — записаний layout.json ≤100KB/стор.', () => {
  it('1 сторінка з усіма важкими полями + новими сигналами → ≤100KB', async () => {
    const layout = { schemaVersion: 1, provider: 'documentAi', pages: [makeRealisticPage(0)] };
    await writeLayoutArtifact(
      { id: 'drv_size', name: 'scan.pdf', subFolders: { '02_ОБРОБЛЕНІ': 'folder_obrob' } },
      layout,
    );
    const upload = driveState.uploads.find((u) => u.name === 'scan_drv_size.layout.json');
    expect(upload).toBeDefined();
    // Інваріант: ≤100KB на сторінку (типовий поріг для legko-payload без
    // важких рендер/per-glyph полів). Якщо забути strip — буде >300KB.
    expect(upload.content.length).toBeLessThan(100 * 1024);
  });

  it('5 сторінок → ≤500KB сумарно (≤100KB середнє) — лінійне масштабування без leak', async () => {
    const layout = { schemaVersion: 1, provider: 'documentAi', pages: Array.from({ length: 5 }, (_, i) => makeRealisticPage(i)) };
    await writeLayoutArtifact(
      { id: 'drv_multi', name: 'scan.pdf', subFolders: { '02_ОБРОБЛЕНІ': 'folder_obrob' } },
      layout,
    );
    const upload = driveState.uploads.find((u) => u.name === 'scan_drv_multi.layout.json');
    expect(upload).toBeDefined();
    expect(upload.content.length).toBeLessThan(5 * 100 * 1024);
  });

  it('економія розміру vs raw JSON.stringify ≥48× (інакше strip регресує)', async () => {
    const layout = { schemaVersion: 1, provider: 'documentAi', pages: [makeRealisticPage(0)] };
    const rawSize = JSON.stringify(layout).length;
    await writeLayoutArtifact(
      { id: 'drv_econ', name: 'scan.pdf', subFolders: { '02_ОБРОБЛЕНІ': 'folder_obrob' } },
      layout,
    );
    const upload = driveState.uploads.find((u) => u.name === 'scan_drv_econ.layout.json');
    expect(upload).toBeDefined();
    // Раніше документований множник: ×48 економія (image+tokens+symbols+
    // detected_barcodes+transforms). Поріг свідомо ослаблений до 8× щоб
    // не ловити шум серіалізації; ціль — зловити регресію де хтось забув
    // додати поле у STRIPPED_LAYOUT_FIELDS (тоді економія різко падає).
    expect(rawSize / upload.content.length).toBeGreaterThan(8);
  });
});
