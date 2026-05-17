// @vitest-environment jsdom
// DP-4 — DocumentPipelineProvider: інстанціює executor (без сайд-ефектів при
// монтуванні), віддає run/cancel/keepPartial/discardAll, а подія
// ECITS_INBOX_PENDING (ecitsInboxWatcher manual-режим) оновлює ecitsPending.
import { describe, it, expect, vi } from 'vitest';
// ocrService тягне pdfjs (DOMMatrix відсутній у jsdom) — мокаємо як інші
// тести (pattern multiImageToPdf.test.js). DP-4 wiring не залежить від OCR.
vi.mock('../../src/services/ocrService.js', () => ({
  extractText: vi.fn(async () => ({ text: '', pageStructure: null })),
  localizeOcrError: () => 'помилка',
  writeExtractedTextArtifact: vi.fn(async () => true),
  writeLayoutArtifact: vi.fn(async () => true),
  getCachedText: vi.fn(async () => null),
  hasOcrSupport: () => true,
  extractTextBatch: vi.fn(async () => []),
}));
import { render, screen, act } from '@testing-library/react';
import {
  DocumentPipelineProvider, useDocumentPipeline,
} from '../../src/contexts/DocumentPipelineContext.jsx';
import * as eventBus from '../../src/services/eventBus.js';
import { ECITS_INBOX_PENDING } from '../../src/services/eventBusTopics.js';

function Probe() {
  const p = useDocumentPipeline();
  return (
    <div>
      <span data-testid="api">{['run', 'cancel', 'resume', 'keepPartial', 'discardAll']
        .every((k) => typeof p[k] === 'function') ? 'ok' : 'no'}</span>
      <span data-testid="pending">{JSON.stringify(p.ecitsPending)}</span>
    </div>
  );
}

describe('DocumentPipelineProvider', () => {
  it('монтується без сайд-ефектів і віддає повний API', () => {
    render(
      <DocumentPipelineProvider executeAction={vi.fn(async () => ({ success: true }))}>
        <Probe />
      </DocumentPipelineProvider>,
    );
    expect(screen.getByTestId('api').textContent).toBe('ok');
    expect(screen.getByTestId('pending').textContent).toBe('{}');
  });

  it('ECITS_INBOX_PENDING оновлює ecitsPending по caseId', () => {
    render(
      <DocumentPipelineProvider executeAction={vi.fn(async () => ({ success: true }))}>
        <Probe />
      </DocumentPipelineProvider>,
    );
    act(() => {
      eventBus.publish(ECITS_INBOX_PENDING, { caseId: 'case_42', count: 5 });
    });
    expect(JSON.parse(screen.getByTestId('pending').textContent)).toEqual({ case_42: 5 });
  });
});
