// ── DP-3 STAGE · EXTRACT V3 (постобробка тексту: clean + формат) ────────────
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
// тексту що вже є: очистка OCR-сміття (печатки/штампи) через Haiku +
// вибір формату збереження TXT/MD. Це «sub-стадія існуючого імені» —
// дозволено §8.
//
// Один сенс (правило #11):
//   • options.cleanForReading=true  → текст чиститься через ін'єктований
//     cleaner (Haiku), формат = 'md'.
//   • false/немає cleaner           → текст лишається як є, формат = 'txt'.
// Запис у 02_ОБРОБЛЕНІ робить splitDocumentsV3 (там фінальні документи
// отримують driveId). Ця стадія лише готує text+format у ctx.
//
// Gated: нема жодного тексту і нема cleaner → passthrough (поведінка DP-1
// не регресує; single-file AddDocumentModal цю стадію не вмикає взагалі —
// його post-persist OCR лишається у CaseDossier, рішення DP-1 §4).

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
//   cleanText(text, {fileName}) → string — ін'єктований Haiku-очисник.
//   cleanForReading: boolean — перемикач «Очистити для читання» (config).
export function createExtractV3(stageDeps = {}) {
  const cleanForReading = stageDeps.cleanForReading === true;
  const getStreamedText = stageDeps.getStreamedText;

  return async function extractV3(ctx) {
    const anyText = ctx.files.some((f) => !f.skipped && hasText(f, getStreamedText));
    if (!anyText) return { ok: true };                     // нема на чому — passthrough

    const decisions = [];
    const files = [];
    for (const item of ctx.files) {
      if (item.skipped || !hasText(item, getStreamedText)) { files.push(item); continue; }

      let text = String(rawText(item, getStreamedText));
      let textFormat = 'txt';

      if (cleanForReading && typeof stageDeps.cleanText === 'function') {
        try {
          const cleaned = await stageDeps.cleanText(text, { fileName: item.name });
          if (cleaned && String(cleaned).trim()) {
            text = String(cleaned);
            textFormat = 'md';
          }
        } catch (err) {
          // Очистка не критична — лишаємо сирий OCR-текст, попереджаємо.
          decisions.push({
            type: 'text_clean_failed',
            fileId: item.fileId,
            fileName: item.name,
            message: `Очистка тексту "${item.name}" не вдалась — збережено сирий OCR: ${err?.message || err}`,
          });
        }
      }

      const streamedLayout = typeof stageDeps.getStreamedLayout === 'function'
        ? stageDeps.getStreamedLayout(item.fileId) : null;
      files.push({
        ...item,
        processedText: text,
        textFormat,
        layoutJson: streamedLayout || item.layoutJson || item.mergeLayoutJson || null,
      });
    }

    return {
      ok: true,
      ctx: { ...ctx, files },
      ...(decisions.length > 0 ? { decisions } : {}),
    };
  };
}
