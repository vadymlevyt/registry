// ── CLEAN TEXT · DRIVE ADAPTER ──────────────────────────────────────────────
// TASK 3.1. Реалізація Drive-швів ядра `cleanTextService.cleanDocument` поверх
// `ocrService` + оновлення метаданих (registry через `executeAction
// update_document` + extended `attentionNotes` через `documentsExtended`).
//
// ОДНЕ місце з'єднання ядра з Drive — перевикористовується ДВОМА споживачами:
//   • DP пост-крок (3.1) — `splitDocumentsV3` після фіналізації документів;
//   • кнопки ретроактивної очистки (3.2) — Огляд / Viewer (стануть тонкими).
// Тому шви тут, а не inline у споживачі (Rule of Three / #11).

import * as defaultOcrService from './ocrService.js';
import * as defaultDocumentsExtended from './documentsExtended.js';

// file-об'єкт для ocrService-швів: id=driveId, name (NFC), subFolders справи.
function fileFor(document, caseData) {
  const rawName = document?.originalName || document?.name || '';
  const name = typeof rawName.normalize === 'function' ? rawName.normalize('NFC') : rawName;
  return { id: document?.driveId, name, subFolders: caseData?.storage?.subFolders };
}

/**
 * buildCleanDocumentDriveDeps — зібрати Drive-шви для `cleanDocument`.
 * @param {object} opts
 *   executeAction — архіваріус (для update_document; registry textFormat/cleanedAt/variants)
 *   agentId       — agentId для executeAction (в'ювер/3.2: 'dossier_agent')
 *   ocrService / documentsExtended — DI (дефолти реальні; тести стабують)
 * @returns {{ fetchLayout, fetchRawText, saveMarkdown, updateDocumentMeta }}
 *
 * V2-A2: `.layout`/`.txt` ЗБЕРІГАЮТЬСЯ (layout = джерело Точного/повтору; .txt =
 * вірний текст для no-layout) → шви moveRawTxtToArchive/deleteLayout прибрано.
 * `saveMarkdown` пише за суфіксом режиму (<base>_<id>.<mode>.md).
 */
export function buildCleanDocumentDriveDeps({
  executeAction,
  agentId,
  ocrService = defaultOcrService,
  documentsExtended = defaultDocumentsExtended,
} = {}) {
  return {
    fetchLayout: (document, caseData) => ocrService.getCachedLayout(fileFor(document, caseData)),
    fetchRawText: (document, caseData) => ocrService.getCachedText(fileFor(document, caseData)),
    saveMarkdown: (document, caseData, markdown, mode) => ocrService.writeMarkdownArtifact(fileFor(document, caseData), markdown, mode),
    updateDocumentMeta: async (document, caseData, meta) => {
      const caseId = caseData?.id || null;
      const documentId = document?.id || null;
      // registry: textFormat + cleanedAt + variants через архіваріус (allowlist
      // update_document). variants трекає який AI-варіант згенеровано:
      // зливаємо наявні з {[mode]: cleanedAt} (інший режим лишається як був).
      if (typeof executeAction === 'function' && caseId && documentId) {
        const mode = meta?.mode === 'clean' ? 'clean' : 'digest';
        const cleanedAt = meta?.cleanedAt ?? null;
        const prevVariants = (document && typeof document.variants === 'object' && document.variants)
          ? document.variants : { clean: null, digest: null };
        const variants = { clean: prevVariants.clean ?? null, digest: prevVariants.digest ?? null, [mode]: cleanedAt };
        try {
          await executeAction(agentId, 'update_document', {
            caseId,
            documentId,
            fields: { textFormat: meta?.textFormat || 'md', cleanedAt, variants },
          });
        } catch { /* мета-апдейт не валить очистку (артефакти вже на Drive) */ }
      }
      // extended: attentionNotes (важке поле, documents_extended.json).
      if (caseId && documentId && Array.isArray(meta?.attentionNotes) && meta.attentionNotes.length > 0) {
        try {
          await documentsExtended.setExtendedForDocument(caseId, caseData, documentId, {
            attentionNotes: meta.attentionNotes,
          });
        } catch { /* extended не критичний */ }
      }
    },
  };
}
