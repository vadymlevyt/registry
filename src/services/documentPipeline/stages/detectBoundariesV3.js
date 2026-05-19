// ── DP-3 STAGE · DETECT BOUNDARIES V3 (multi-file реконструкція) ─────────────
// Підключається через deps.stageOverrides[STAGE.DETECT_BOUNDARIES] у
// streaming-шляху (streamingExecutor). Диригент documentPipeline.js НЕ
// змінюється. Розширює DP-2 detectBoundariesV2 з одного файла на ПАКЕТ.
//
// Універсальна логіка (§4.4): після convert+extract усе — {text}. Реальний
// формат входу неважливий. Один шлях на будь-який мікс PDF/DOCX/HEIC/ZIP.
//
// Поведінка:
//   • пакет (files>1)            → reconstructAcrossFiles (multi-turn
//                                  накопичення відкритих хвостів) → план.
//   • один файл (files==1)       → делегуємо одно-файловий детектор
//                                  (ін'єктований detectSingle = DP-2 V2
//                                  поведінка) → нормалізуємо у ТОЙ САМИЙ
//                                  план. Single-file НЕ регресує.
//   • нема тексту / транспорту   → passthrough (як DP-2: ingest не блокуємо).
//
// propose-only: пише ctx.reconstructionPlan + ctx.unusedPages + decisions[].
// Реальний split — splitDocumentsV3 ПІСЛЯ confirm. AI-помилка НЕ фатальна.

import { reconstructAcrossFiles } from '../../documentBoundary/multiFileReconstructor.js';
import { buildPagedText } from '../pageMarkers.js';

// Текст файла. У streaming-шляху makeContext диригента НЕ переносить
// extractedText, а convert обнуляє його для Drive-source — тому потоковий
// OCR-текст приходить через ін'єктований getStreamedText (executor володіє
// ним). Fallback — item.extractedText (DOCX/HTML конвертер, не-streaming).
function textOf(item, getStreamedText) {
  const streamed = typeof getStreamedText === 'function' ? getStreamedText(item.fileId) : '';
  return (streamed || item.extractedText || item.ocrText || '').toString();
}

// Текст для ПОШУКУ МЕЖ: посторінково-маркований (=== СТОРІНКА N ===) зі
// збереженого OCR-layout коли він повний; інакше — plain OCR-текст (на
// resume layout може бути неповним). НЕ обрізається (50K-truncation у
// buildReconstructionPrompt прибрано — AI бачить усю справу).
function boundaryTextOf(item, getStreamedText, getStreamedLayout) {
  const layout = typeof getStreamedLayout === 'function' ? getStreamedLayout(item.fileId) : null;
  const paged = buildPagedText(layout, item.pageCount || null);
  return paged || textOf(item, getStreamedText);
}

// Нормалізувати одно-файловий результат детектора (DP-2 формат
// {totalPages,documents:[{name,startPage,endPage,type}]}) у DP-3 план.
function singleToPlan(fileId, detected) {
  const docs = Array.isArray(detected?.documents) ? detected.documents : [];
  return {
    documents: docs.map((d, i) => ({
      documentId: `doc_${i + 1}`,
      name: d.name || null,
      type: d.type || null,
      category: null,
      fragments: [{ fileId, startPage: d.startPage, endPage: d.endPage }],
    })),
    unusedPages: [],
    openTails: [],
    fileCount: 1,
  };
}

// stageDeps:
//   analyzeFile({fileId,fileName,text,openTails,userHint}) → {documents,
//     unusedPages} — AI-хід реконструкції (поверх toolUseRunner; ін'єкт).
//   detectSingle({arrayBuffer|text,...}) → {totalPages,documents} — одно-
//     файловий детектор DP-2 (опц.; якщо нема — single-file passthrough).
//   shouldReconstruct(ctx) — override gate (default: >1 не-skipped файл).
//   readArrayBuffer(item) — для detectSingle на PDF (опц.).
//   getStreamedLayout(fileId) — per-page OCR-layout для посторінкових
//     маркерів межевого тексту (опц.; нема → plain текст).
export function createDetectBoundariesV3(stageDeps = {}) {
  const shouldReconstruct = stageDeps.shouldReconstruct
    || ((ctx) => ctx.files.filter((f) => !f.skipped).length > 1);
  const getStreamedText = stageDeps.getStreamedText;
  const getStreamedLayout = stageDeps.getStreamedLayout;

  return async function detectBoundariesV3(ctx) {
    const live = ctx.files.filter((f) => !f.skipped);
    if (live.length === 0) return { ok: true };

    // ── Пакет: multi-file реконструкція ──────────────────────────────────
    if (shouldReconstruct(ctx) && typeof stageDeps.analyzeFile === 'function') {
      const files = live.map((f) => ({
        fileId: f.fileId,
        name: f.name,
        text: boundaryTextOf(f, getStreamedText, getStreamedLayout),
        pageCount: f.pageCount || null,
      }));
      const userHint = ctx.metadataSidecar?.source === 'court_sync'
        ? buildUserHint(ctx) : '';
      let plan;
      try {
        plan = await reconstructAcrossFiles({ files, analyzeFile: stageDeps.analyzeFile, userHint });
      } catch (err) {
        // НЕ фатально — пакет ingest-иться як окремі файли (адвокат у DP-4).
        return {
          ok: true,
          ctx: { ...ctx, files: ctx.files.map((f) => ({ ...f, warnings: [...(f.warnings || []), `reconstruct: ${err?.message || err}`] })) },
        };
      }
      const decisions = [{
        type: 'document_boundaries',
        scope: 'multi_file',
        documentCount: plan.documents.length,
        proposals: plan.documents.map((d) => ({ documentId: d.documentId, name: d.name, type: d.type, fragments: d.fragments })),
        unusedPages: plan.unusedPages,
        message: `Пакет із ${files.length} файлів реконструйовано у ${plan.documents.length} логічних документів. Підтвердьте перед нарізкою.`,
      }];
      return {
        ok: true,
        ctx: { ...ctx, reconstructionPlan: plan, unusedPages: plan.unusedPages },
        decisions,
      };
    }

    // ── Один файл: делегуємо DP-2-детектор, нормалізуємо у план ───────────
    if (live.length === 1 && typeof stageDeps.detectSingle === 'function') {
      const item = live[0];
      let arrayBuffer = null;
      if (typeof stageDeps.readArrayBuffer === 'function') {
        try { arrayBuffer = await stageDeps.readArrayBuffer(item); } catch { /* нема байтів — text-only */ }
      }
      let detected;
      try {
        detected = await stageDeps.detectSingle({
          arrayBuffer,
          text: textOf(item, getStreamedText),
          apiKey: typeof stageDeps.getApiKey === 'function' ? stageDeps.getApiKey() : null,
          caseId: ctx.job.caseId,
          aiUsageSink: stageDeps.aiUsageSink,
        });
      } catch (err) {
        return {
          ok: true,
          ctx: { ...ctx, files: ctx.files.map((f) => (f.fileId === item.fileId ? { ...f, warnings: [...(f.warnings || []), `boundary detect: ${err?.message || err}`] } : f)) },
        };
      }
      const docs = Array.isArray(detected?.documents) ? detected.documents : [];
      if (docs.length <= 1) return { ok: true };          // не склейка — passthrough (DP-1)
      const plan = singleToPlan(item.fileId, detected);
      return {
        ok: true,
        ctx: { ...ctx, reconstructionPlan: plan, unusedPages: [] },
        decisions: [{
          type: 'document_boundaries',
          scope: 'single_file',
          fileId: item.fileId,
          fileName: item.name,
          totalPages: detected.totalPages ?? null,
          proposals: plan.documents,
          message: `Файл "${item.name}" схоже містить ${plan.documents.length} документів. Підтвердьте межі.`,
        }],
      };
    }

    return { ok: true };                                  // нема транспорту → passthrough
  };
}

function buildUserHint(ctx) {
  const ec = ctx.metadataSidecar?.ecitsContext || {};
  const bits = [];
  if (ec.caseType) bits.push(`тип справи: ${ec.caseType}`);
  if (ec.notificationType) bits.push(`тип повідомлення: ${ec.notificationType}`);
  if (ec.court) bits.push(`суд: ${ec.court}`);
  return bits.join('; ');
}
