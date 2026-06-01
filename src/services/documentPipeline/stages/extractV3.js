// ── DP-3 STAGE · EXTRACT V3 (постобробка тексту: формат) ────────────────────
// Підключається через deps.stageOverrides[STAGE.EXTRACT] у streaming-шляху.
// Диригент НЕ змінюється.
//
// ⚠ АРХІТЕКТУРНЕ РІШЕННЯ (експертна автономія, пояснено у звіті §12):
// Заморожений порядок стадій DP-1 ставить `extract` ПІСЛЯ
// `detectBoundaries`. Але §4.4 вимагає OCR ДО реконструкції (AI бачить
// нормалізований текст пакета). Це нерозв'язно якщо `extract` = «зробити
// OCR» (він після detect). Тому потоковий chunk-OCR (RAM-bounded) виконує
// streamingExecutor ДО pipeline і кладе уніфікований текст у
// files[].extractedText. Стадія `extract` (ця) = СЕМАНТИЧНА ПОСТОБРОБКА
// тексту що вже є.
//
// TASK 3.1 (нова філософія): очистка тексту для читання — це НЕ крок ДО
// нарізки. Вона підключена ОСТАННІМ кроком (post-persist) у splitDocumentsV3,
// на вже роз'єднаних ФІНАЛЬНИХ документах (через cleanTextService.cleanDocument).
// Тому ця стадія БІЛЬШЕ НЕ чистить текст: лишає сирий OCR-текст з формою
// 'txt'. Стара in-memory гілка `cleanForReading`+`cleanText` прибрана — вона
// була мертвою (MD ніколи не персиститься: writeProcessedArtifacts завжди
// пише format:'txt'; почищений MD відкидався при нарізці).
//
// Gated: нема жодного тексту → passthrough (поведінка DP-1 не регресує).

// Текст файла: потоковий OCR приходить через ін'єктований getStreamedText
// (makeContext диригента не переносить extractedText у streaming-шляху);
// fallback — item.extractedText (DOCX/HTML конвертер, не-streaming).
function rawText(item, getStreamedText) {
  const streamed = typeof getStreamedText === 'function' ? getStreamedText(item.fileId) : '';
  return streamed || item.extractedText || '';
}
function hasText(item, getStreamedText) {
  const t = rawText(item, getStreamedText);
  return !!(t && String(t).trim());
}

// stageDeps:
//   getStreamedText / getStreamedLayout — потокові аксесори OCR (streaming-шлях).
// Очистка тексту тут НЕ виконується (див. шапку — пост-крок у splitDocumentsV3).
export function createExtractV3(stageDeps = {}) {
  const getStreamedText = stageDeps.getStreamedText;

  return async function extractV3(ctx) {
    const anyText = ctx.files.some((f) => !f.skipped && hasText(f, getStreamedText));
    if (!anyText) return { ok: true };                     // нема на чому — passthrough

    const files = [];
    for (const item of ctx.files) {
      if (item.skipped || !hasText(item, getStreamedText)) { files.push(item); continue; }

      // Сирий OCR-текст, форма завжди 'txt'. Очистка → пост-крок (3.1).
      const text = String(rawText(item, getStreamedText));

      const streamedLayout = typeof stageDeps.getStreamedLayout === 'function'
        ? stageDeps.getStreamedLayout(item.fileId) : null;
      files.push({
        ...item,
        processedText: text,
        textFormat: 'txt',
        layoutJson: streamedLayout || item.layoutJson || item.mergeLayoutJson || null,
      });
    }

    return { ok: true, ctx: { ...ctx, files } };
  };
}
