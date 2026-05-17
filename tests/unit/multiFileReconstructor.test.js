// DP-3 — multiFileReconstructor: multi-turn накопичення «відкритих хвостів».
import { describe, it, expect, vi } from 'vitest';
import {
  reconstructAcrossFiles, mergeFileResult, buildReconstructionPrompt,
} from '../../src/services/documentBoundary/multiFileReconstructor.js';

describe('multiFileReconstructor — mergeFileResult (чисте накопичення)', () => {
  it('новий відкритий документ додається у відкриті хвости', () => {
    const r = mergeFileResult({
      plan: [], openTails: [], fileId: 'f1',
      fileResult: { documents: [{ documentId: 'd1', name: 'Позов', type: 'pleading', startPage: 1, endPage: 8, open: true }], unusedPages: [] },
    });
    expect(r.plan).toHaveLength(1);
    expect(r.plan[0].fragments).toEqual([{ fileId: 'f1', startPage: 1, endPage: 8 }]);
    expect(r.openTails).toHaveLength(1);
  });

  it('continuesFromTail дописує фрагмент у наявний документ і закриває хвіст', () => {
    const start = mergeFileResult({
      plan: [], openTails: [], fileId: 'f1',
      fileResult: { documents: [{ documentId: 'd1', name: 'Позов', startPage: 1, endPage: 5, open: true }] },
    });
    const cont = mergeFileResult({
      plan: start.plan, openTails: start.openTails, fileId: 'f2',
      fileResult: { documents: [{ documentId: 'x', continuesFromTail: 'd1', startPage: 1, endPage: 3, open: false }] },
    });
    expect(cont.plan).toHaveLength(1);
    expect(cont.plan[0].fragments).toEqual([
      { fileId: 'f1', startPage: 1, endPage: 5 },
      { fileId: 'f2', startPage: 1, endPage: 3 },
    ]);
    expect(cont.openTails).toHaveLength(0); // хвіст закрито
  });

  it('unusedPages збираються з причиною', () => {
    const r = mergeFileResult({
      plan: [], openTails: [], fileId: 'f1',
      fileResult: { documents: [], unusedPages: [{ startPage: 2, endPage: 2, reason: 'порожня' }] },
    });
    expect(r.unusedPages).toEqual([{ fileId: 'f1', startPage: 2, endPage: 2, reason: 'порожня' }]);
  });
});

describe('multiFileReconstructor — reconstructAcrossFiles (multi-turn)', () => {
  it('універсально: будь-який мікс файлів — одна логіка, AI бачить лише текст', async () => {
    const calls = [];
    const analyzeFile = vi.fn(async ({ fileId, openTails }) => {
      calls.push({ fileId, openTailIds: openTails.map((t) => t.documentId) });
      if (fileId === 'pdf1') return { documents: [{ documentId: 'd1', name: 'Договір', type: 'contract', startPage: 1, endPage: 4, open: true }], unusedPages: [] };
      if (fileId === 'heic2') return { documents: [{ documentId: 'x', continuesFromTail: 'd1', startPage: 1, endPage: 1, open: false }], unusedPages: [{ startPage: 2, endPage: 2, reason: 'фото невідомого' }] };
      return { documents: [], unusedPages: [] };
    });
    const res = await reconstructAcrossFiles({
      files: [
        { fileId: 'pdf1', name: 'a.pdf', text: 'договір ...' },
        { fileId: 'heic2', name: 'b.heic', text: 'продовження ...' },
      ],
      analyzeFile,
    });
    expect(res.documents).toHaveLength(1);
    expect(res.documents[0].fragments).toHaveLength(2); // розкидано по 2 файлах
    expect(res.unusedPages).toHaveLength(1);
    expect(calls[1].openTailIds).toContain('d1'); // 2-й виклик бачив хвіст 1-го
  });

  it('помилка AI на файлі — НЕ фатально (файл → unusedPages-кандидат)', async () => {
    const analyzeFile = vi.fn(async ({ fileId }) => {
      if (fileId === 'bad') throw new Error('AI 500');
      return { documents: [{ documentId: 'd1', startPage: 1, endPage: 2, open: false }] };
    });
    const res = await reconstructAcrossFiles({
      files: [{ fileId: 'ok', name: 'a', text: 't', pageCount: 2 }, { fileId: 'bad', name: 'b', text: 't', pageCount: 3 }],
      analyzeFile,
    });
    expect(res.documents).toHaveLength(1);
    expect(res.unusedPages.some((u) => u.fileId === 'bad' && /реконструкція не вдалась/.test(u.reason))).toBe(true);
  });

  it('кидає якщо analyzeFile транспорт не передано', async () => {
    await expect(reconstructAcrossFiles({ files: [] })).rejects.toThrow(/analyzeFile/);
  });
});

describe('multiFileReconstructor — buildReconstructionPrompt', () => {
  it('включає відкриті хвости і userHint', () => {
    const p = buildReconstructionPrompt({ fileName: 'a.pdf', text: 'x', openTails: [{ documentId: 't1', name: 'Позов', type: 'pleading', fileId: 'f1' }], userHint: 'цивільна' });
    expect(p).toContain('a.pdf');
    expect(p).toContain('Позов');
    expect(p).toContain('Контекст: цивільна');
  });
});
