// TASK 3.1 — DP-консолідація: тумблер «Очистити для читання» чистить ТЕКСТ
// через СПІЛЬНЕ ядро cleanTextService (а не inline-дубль aiCleanText).
//
// Перевіряємо реальний seam: createExtractV3 (DP-стадія) + cleanText, де
// cleanText — тонка обгортка над cleanTextService.polishToMarkdown (1:1 як у
// DocumentPipelineContext). Доводимо: cleanForReading → ядро → один лог →
// billAsUserAction:false (DP — автопродовження, не окрема оплачувана дія).

import { describe, it, expect, vi } from 'vitest';
import { createExtractV3 } from '../../src/services/documentPipeline/stages/extractV3.js';
import { polishToMarkdown } from '../../src/services/cleanTextService.js';

const ctxOf = (files, over = {}) => ({
  job: { caseId: 'c1', jobId: 'j1', addedBy: 'system', source: 'manual' },
  files: files.map((f, i) => ({ fileId: f.fileId || `f${i}`, skipped: false, warnings: [], ...f })),
  documents: [], decisions: [], events: [], ...over,
});

// AI-відповідь у формі ядра (JSON {markdown, attentionNotes}).
function aiJson(markdown) {
  return { content: [{ type: 'text', text: JSON.stringify({ markdown, attentionNotes: [] }) }], usage: { input_tokens: 10, output_tokens: 20 } };
}

describe('DP-консолідація: extractV3 чистить через спільне ядро', () => {
  it('cleanForReading → ядро polishToMarkdown → processedText md; один лог; billAsUserAction false', async () => {
    const callAI = vi.fn(async () => aiJson('# Очищений документ\n\nтекст'));
    const logAiUsage = vi.fn();
    const activityTracker = { report: vi.fn() };

    // Обгортка 1:1 як у DocumentPipelineContext.aiCleanText (DP → ядро).
    const cleanText = vi.fn(async (text, { fileName } = {}) => {
      const { markdown } = await polishToMarkdown({
        draft: text, fileName, apiKey: 'k',
        billAsUserAction: false,                 // DP — автопродовження
        callAI, logAiUsage, activityTracker,
        resolveModel: () => 'claude-haiku-4-5-20251001',
      });
      return markdown || '';
    });

    const stage = createExtractV3({ cleanForReading: true, cleanText });
    const ctx = ctxOf([{ extractedText: 'сирий OCR-текст з артефактами' }]);
    const res = await stage(ctx);

    expect(res.ok).toBe(true);
    expect(res.ctx.files[0].processedText).toBe('# Очищений документ\n\nтекст');
    expect(res.ctx.files[0].textFormat).toBe('md');

    // Ядро викликане рівно раз (один шлях, без дубля).
    expect(cleanText).toHaveBeenCalledTimes(1);
    expect(callAI).toHaveBeenCalledTimes(1);
    // C7: токени логуються; activityTracker (окрема дія) — НІ (DP).
    expect(logAiUsage).toHaveBeenCalledTimes(1);
    expect(logAiUsage.mock.calls[0][0].agentType).toBe('text_cleaner');
    expect(activityTracker.report).not.toHaveBeenCalled();
  });

  it('cleanForReading=false → текст лишається сирим (txt), ядро не кличеться', async () => {
    const cleanText = vi.fn();
    const stage = createExtractV3({ cleanForReading: false, cleanText });
    const res = await stage(ctxOf([{ extractedText: 'сирий' }]));
    expect(res.ctx.files[0].processedText).toBe('сирий');
    expect(res.ctx.files[0].textFormat).toBe('txt');
    expect(cleanText).not.toHaveBeenCalled();
  });

  it('ядро кинуло (AI 429) → DP лишає сирий OCR + decision text_clean_failed (не падає)', async () => {
    const cleanText = vi.fn(async (text) => {
      // Обгортка кидає лише коли нема ключа; тут симулюємо помилку всередині
      // ядра, яку extractV3 трактує не фатально.
      throw new Error('haiku 429');
    });
    const stage = createExtractV3({ cleanForReading: true, cleanText });
    const res = await stage(ctxOf([{ name: 'A.pdf', extractedText: 'raw OCR' }]));
    expect(res.ok).toBe(true);
    expect(res.ctx.files[0].processedText).toBe('raw OCR');
    expect(res.ctx.files[0].textFormat).toBe('txt');
    expect(res.decisions.some(d => d.type === 'text_clean_failed')).toBe(true);
  });
});
