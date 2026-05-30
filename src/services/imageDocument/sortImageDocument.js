// ── SORT IMAGE DOCUMENT (спільна обгортка над sortImages) ────────────────────
// Один крок «сортування сторінок + виявлення дублів для ОДНОГО логічного
// документа (батча фото)». СПІЛЬНИЙ для всіх споживачів:
//   • модалка «🖼 Склеїти зображення» (через convertImagesToPdf) — 1 батч = 1 документ;
//   • DP image-merge editor — per-group (>1 фото), кожна група = окремий документ;
//   • будь-який майбутній третій споживач.
//
// ── ЧОМУ ОБГОРТКА, А НЕ ПРЯМИЙ sortImages У КОЖНОГО ──────────────────────────
// До цього TASK модалка кликала sortImages напряму (з власним timeout/fallback
// у multiImageToPdf.js), а DP не кликав узагалі (тому в DP не було ні дублів, ні
// сортування сторінок усередині документа). Винесення у спільну функцію (правило
// «Спільний рендер UI» + Rule of Three) дає ОДИН шлях: однаковий timeout/fallback
// і ОДНЕ місце білінгового логування (C7) для всіх споживачів.
//
// ── ОДИН СЕНС (правило #11) ──────────────────────────────────────────────────
// sortImageDocument відповідає рівно на одне питання: «у якому порядку йдуть
// сторінки цього документа і які з фото — дублі тієї самої сторінки». Межі МІЖ
// документами — це окремий намір (imageDocumentGrouper), сюди не входить.
//
// ── КОНТРАКТ ─────────────────────────────────────────────────────────────────
// sortImageDocument(items, options) → Promise<SortResult|null>
//   items — фото ОДНОГО документа: Array<{index, name?, mime?, sizeBytes?,
//           ocrText?, pageStructure?, orientation?}> (той самий shape що sortImages).
//   SortResult — рівно те що повертає sortImages ({order, duplicates,
//           suggestedName, warnings, missing, model, usage, fallback?}).
//   null — коли items.length < 2 (нема що сортувати/дедупити) АБО коли виклик
//           впав/перевищив timeout (fallback): caller сам вирішує що робити
//           (модалка → identity order + warning; DP → залишає порядок групи).
//
// options:
//   apiKey, callApi (DI для тестів), caseContext — прокидаються у sortImages.
//   timeoutMs — hard timeout (default 90с, як було у multiImageToPdf).
//   billing — { caseId, module, aiUsageSink } — КОЛИ передано, логуємо C7
//             (ai_usage через sink + activityTracker.report('agent_call')).
//             Модалка НЕ передає (її білінг — images_merged у converterService,
//             поведінка лишається ІДЕНТИЧНОЮ). DP передає → нові виклики
//             народжуються з логуванням (C7, свідомо прийнято 2026-05-30).

import { sortImages } from '../sortation/imageSortingAgent.js';
import { logAiUsageViaSink } from '../aiUsageService.js';
import * as activityTracker from '../activityTracker.js';
import { MODULES, categoryForCase } from '../moduleNames.js';

const DEFAULT_SORT_TIMEOUT_MS = 90_000;

/**
 * @param {Array<object>} items — фото одного документа (≥2 для реального виклику).
 * @param {object} [options]
 * @returns {Promise<object|null>}
 */
export async function sortImageDocument(items, options = {}) {
  if (!Array.isArray(items) || items.length < 2) {
    // <2 фото — нема що сортувати чи дедупити. Caller лишає порядок як є.
    return null;
  }

  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_SORT_TIMEOUT_MS;

  // Hard timeout щоб stale Anthropic call не зависив pipeline. Якщо агент не
  // відповів за timeoutMs — fallback (повертаємо null), caller продовжує.
  let timer = null;
  let sortResult = null;
  try {
    sortResult = await Promise.race([
      sortImages(items, {
        apiKey: options.apiKey,
        callApi: options.callApi, // DI для тестів
        caseContext: options.caseContext,
      }),
      new Promise((_, rej) => {
        timer = setTimeout(
          () => rej(new Error(`sortImages timeout after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } catch (e) {
    console.warn('[sortImageDocument] sort agent failed, fallback (null):', e?.message || e);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }

  // ── Білінг (C7) — лише коли caller передав billing-контекст ────────────────
  // Паралельні структури: ai_usage[] (оператор SaaS, токени) через sink і
  // time_entries[] (адвокат, час) через activityTracker. НЕ дублювати поля.
  // Усе в try/catch — білінг не валить роботу адвоката. skipped sortResult
  // (degenerate, не повинен сюди дійти бо items≥2, але захист) — не логуємо.
  if (options.billing && sortResult && !sortResult.skipped) {
    const { caseId = null, module = MODULES.DOCUMENT_PROCESSOR, aiUsageSink } = options.billing;
    try {
      if (sortResult.usage && aiUsageSink) {
        logAiUsageViaSink({
          agentType: 'image_sorter',
          model: sortResult.model,
          inputTokens: sortResult.usage.inputTokens,
          outputTokens: sortResult.usage.outputTokens,
          context: {
            caseId,
            module,
            operation: 'image_sorting',
          },
        }, aiUsageSink);
      }
      activityTracker.report('agent_call', {
        caseId,
        module,
        category: categoryForCase(caseId),
        metadata: {
          agentType: 'image_sorter',
          operation: 'image_sorting',
        },
      });
    } catch (e) {
      console.warn('[sortImageDocument] billing log failed (non-fatal):', e?.message);
    }
  }

  return sortResult;
}
