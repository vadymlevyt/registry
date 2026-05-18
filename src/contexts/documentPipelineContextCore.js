// ── DP-4 · DOCUMENT PIPELINE CONTEXT (lightweight core) ─────────────────────
// Лише React-контекст і хук-споживач. БЕЗ важких імпортів (streamingExecutor →
// ocrService → pdfjs/DOMMatrix). Споживачі контексту (JobProgressTopbar,
// GlobalProgressScreen) імпортують ЗВІДСИ, тому не тягнуть весь executor-ланцюг
// (інакше юніт-тести цих UI-компонентів падали б на DOMMatrix у jsdom).
// Provider (важка частина) живе у DocumentPipelineContext.jsx і реекспортує ці.
import { createContext, useContext } from 'react';

export const DocumentPipelineContext = createContext(null);

export function useDocumentPipeline() {
  return useContext(DocumentPipelineContext);
}
