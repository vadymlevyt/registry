// ── DOCUMENT METADATA — режим «без OCR» (TASK 4 етап D) ──────────────────────
// Спільний оркестратор Vision-метаданих для шляху ДОДАВАННЯ: Claude Vision читає
// перші 1-2 сторінки → пропонує { date, category, author, name, gist }, які
// лягають у НАЯВНІ канонічні поля документа (без bump схеми) + gist у extended
// extractedTextSummary. Файл лишається ТІЛЬКИ в 01_ОРИГІНАЛИ — артефактів у 02
// НЕ створюється (нічого не пишемо на Drive тут).
//
// Споживачі (ОДИН код, правило #11 / Rule of Three):
//   • модалка single-add (CaseDossier onSubmit, deferOcr=true → власний пост-крок);
//   • DP «просто додати» (runAddAsIs, ocrMode='none').
//
// Принцип ПРОПОЗИЦІЇ (спека D, недетермінованість): усі AI-поля — лише підказки,
// адвокат править. Тому НЕ затираємо те, що адвокат уже задав:
//   • date/category/author — пишемо лише якщо поточне порожнє (null);
//   • name — лише якщо namingStatus==='auto' (автоназва з файлу), не 'manual';
//   • gist — завжди в extended (нова інформація, не канонічне поле).
// НЕ ставимо lastOcrAt — повного OCR не було (рівень OCR лишається «не розпізнано»,
// виводиться зі стану: scanned без layout + lastOcrAt==null; без bump схеми).

import * as ocrService from './ocrService.js';
import { setExtendedForDocument } from './documentsExtended.js';

// enrichDocumentWithVisionMetadata — extract (Vision 1-2 стор.) + apply
// (update_document лише порожні поля + name якщо auto; gist → extended).
// DI-шви (extractMetadata/setExtended) — для юніт-тесту без мережі/Drive.
// Best-effort: на збій повертає { ok:false, error } — caller не валить додавання.
export async function enrichDocumentWithVisionMetadata({
  ocrFile,
  doc,
  caseId,
  caseData,
  executeAction,
  agentId = 'document_processor_agent',
  extractMetadata = ocrService.extractMetadata,
  setExtended = setExtendedForDocument,
  options = {},
} = {}) {
  if (!ocrFile?.id || !doc?.id || typeof executeAction !== 'function') {
    return { ok: false, error: 'no_target' };
  }
  // Тип без Vision-підтримки (XLSX/PPTX/passthrough) — нема що читати, тихо вийти.
  if (!ocrService.canVisionMetadata(ocrFile)) {
    return { ok: false, error: 'unsupported' };
  }

  let meta;
  try {
    meta = await extractMetadata(ocrFile, { caseId, ...options });
  } catch (e) {
    return { ok: false, error: e?.code || e?.message || 'extract_failed', meta: null };
  }

  // Канонічні поля — лише пропозиції у порожні слоти (не затираємо адвоката).
  const fields = {};
  if (meta?.date && !doc.date) fields.date = meta.date;
  if (meta?.category && !doc.category) fields.category = meta.category;
  if (meta?.author && !doc.author) fields.author = meta.author;
  if (meta?.name && doc.namingStatus === 'auto') fields.name = meta.name;

  if (Object.keys(fields).length > 0) {
    try {
      await executeAction(agentId, 'update_document', {
        caseId, documentId: doc.id, fields,
      });
    } catch (e) {
      // Поля не критичні — gist нижче ще спробуємо; повертаємо partial.
      console.warn('[documentMetadata] update_document failed:', e?.message || e);
    }
  }

  // gist → extended extractedTextSummary (НЕ юр-зміст, НЕ вижимка-для-контексту).
  if (meta?.gist) {
    try {
      await setExtended(caseId, caseData, doc.id, { extractedTextSummary: meta.gist });
    } catch (e) {
      console.warn('[documentMetadata] setExtended gist failed:', e?.message || e);
    }
  }

  return { ok: true, meta, appliedFields: fields };
}
