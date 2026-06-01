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
 *   executeAction — архіваріус (для update_document; registry textFormat/cleanedAt)
 *   agentId       — agentId для executeAction (DP: 'document_processor_agent')
 *   ocrService / documentsExtended — DI (дефолти реальні; тести стабують)
 * @returns {{ fetchLayout, fetchRawText, saveMarkdown, moveRawTxtToArchive, deleteLayout, updateDocumentMeta }}
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
    saveMarkdown: (document, caseData, markdown) => ocrService.writeMarkdownArtifact(fileFor(document, caseData), markdown),
    moveRawTxtToArchive: (document, caseData) => ocrService.archiveRawTxt(fileFor(document, caseData)),
    deleteLayout: (document, caseData) => ocrService.deleteLayoutArtifact(fileFor(document, caseData)),
    updateDocumentMeta: async (document, caseData, meta) => {
      const caseId = caseData?.id || null;
      const documentId = document?.id || null;
      // registry: textFormat + cleanedAt через архіваріус (allowlist update_document).
      if (typeof executeAction === 'function' && caseId && documentId) {
        try {
          await executeAction(agentId, 'update_document', {
            caseId,
            documentId,
            fields: { textFormat: meta?.textFormat || 'md', cleanedAt: meta?.cleanedAt ?? null },
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
