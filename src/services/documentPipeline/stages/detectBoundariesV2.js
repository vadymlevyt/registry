// ── DP-2 STAGE · DETECT BOUNDARIES (базова реалізація) ──────────────────────
// Підключається через deps.stageOverrides[STAGE.DETECT_BOUNDARIES]. Диригент
// НЕ змінюється. Працює поверх salvage TASK 1 (documentBoundary/) — той самий
// контракт propose→confirm: ця стадія лише ПРОПОНУЄ межі (decisions[]),
// нічого не ріже. Реальний split — splitByBoundaries ПІСЛЯ confirm (зараз
// confirm заглушка auto-pass; UI підтвердження — DP-4).
//
// Обсяг DP-2 (свідоме обмеження): працює коли AI бачить ОДИН файл з кількома
// документами всередині. Повна семантична реконструкція з кількох файлів —
// DP-3, тут НЕ робиться (кожен файл аналізується незалежно).
//
// Gated: за замовчуванням passthrough (нуль AI-витрат на звичайному
// одно-документному додаванні — поведінка DP-1 не регресує). Запускається
// лише коли є сигнал «це може бути склейка»: stageDeps.shouldDetect(ctx) або
// ecitsContext/sidecar натякає на кілька документів. Помилка AI — НЕ фатальна
// (ingestion не блокується; додається warning, ok:true).

import { categoryFromBoundaryType } from './classifyV2.js';

function defaultShouldDetect(ctx) {
  const sc = ctx.metadataSidecar;
  if (!sc) return false;
  if (sc.expectsMultipleDocuments === true) return true;
  if (Array.isArray(sc.documents) && sc.documents.length > 1) return true;
  return false;
}

function isPdf(item) {
  const t = String(item.type || item.uploadedFile?.type || '').toLowerCase();
  const n = String(item.name || '').toLowerCase();
  return t === 'application/pdf' || /\.pdf$/.test(n) || item.converterType === 'passthrough';
}

async function readArrayBuffer(item) {
  const src = item.uploadedFile || item.raw;
  if (!src) return null;
  if (src._bytes) return src._bytes.buffer || src._bytes;
  if (typeof src.arrayBuffer === 'function') {
    try { return await src.arrayBuffer(); } catch { return null; }
  }
  return null;
}

// Підказка для моделі з ЄСІТС-контексту — менше токенів, вища впевненість.
function buildUserHint(ctx) {
  const sc = ctx.metadataSidecar;
  if (!sc || sc.source !== 'court_sync') return '';
  const ec = sc.ecitsContext || {};
  const bits = [];
  if (ec.caseType) bits.push(`тип справи: ${ec.caseType}`);
  if (ec.notificationType) bits.push(`тип повідомлення: ${ec.notificationType}`);
  if (ec.court) bits.push(`суд: ${ec.court}`);
  return bits.join('; ');
}

// Фабрика стадії (DI). stageDeps:
//   detectBoundaries({arrayBuffer,apiKey,userHint,caseId,aiUsageSink}) — обов'язково
//     для активної гілки (фасад documentBoundary.detectBoundaries, ін'єктований
//     для тестопридатності/без мережі).
//   getApiKey() — Anthropic ключ.
//   shouldDetect(ctx) — override gate (default: sidecar натякає на кілька).
//   aiUsageSink — sink для білінг-телеметрії не-React точок.
export function createDetectBoundariesV2(stageDeps = {}) {
  const shouldDetect = stageDeps.shouldDetect || defaultShouldDetect;

  return async function detectBoundariesV2(ctx) {
    if (!shouldDetect(ctx)) {
      return { ok: true };                        // passthrough — поведінка DP-1
    }
    if (typeof stageDeps.detectBoundaries !== 'function') {
      return { ok: true };                        // немає транспорту — не блокуємо
    }

    const apiKey = typeof stageDeps.getApiKey === 'function' ? stageDeps.getApiKey() : null;
    const userHint = buildUserHint(ctx);
    const decisions = [];
    const files = [];

    for (const item of ctx.files) {
      if (item.skipped || !isPdf(item)) { files.push(item); continue; }

      const arrayBuffer = await readArrayBuffer(item);
      if (!arrayBuffer) { files.push(item); continue; }

      let result;
      try {
        result = await stageDeps.detectBoundaries({
          arrayBuffer,
          apiKey,
          userHint,
          caseId: ctx.job.caseId,
          aiUsageSink: stageDeps.aiUsageSink,
        });
      } catch (err) {
        // НЕ фатально: межі не визначились — документ усе одно ingest-иться
        // як один файл, адвокат за потреби заріже вручну (DP-4).
        files.push({ ...item, warnings: [...(item.warnings || []), `boundary detect: ${err?.message || err}`] });
        continue;
      }

      const proposals = Array.isArray(result?.documents) ? result.documents : [];
      // Один файл = один документ → нема що пропонувати (не склейка).
      if (proposals.length <= 1) {
        files.push({ ...item, boundaryProposals: proposals });
        continue;
      }

      const enriched = proposals.map(p => ({
        name: p.name,
        startPage: p.startPage,
        endPage: p.endPage,
        type: p.type,
        category: categoryFromBoundaryType(p.type),
      }));
      files.push({ ...item, boundaryProposals: enriched });
      decisions.push({
        type: 'document_boundaries',
        fileId: item.fileId,
        fileName: item.name,
        totalPages: result.totalPages ?? null,
        proposals: enriched,
        message: `Файл "${item.name}" схоже містить ${enriched.length} документів. Підтвердьте межі перед нарізкою.`,
      });
    }

    return {
      ok: true,
      ctx: { ...ctx, files },
      ...(decisions.length > 0 ? { decisions } : {}),
    };
  };
}
