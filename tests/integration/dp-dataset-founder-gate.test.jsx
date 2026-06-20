// @vitest-environment jsdom
// A2 Частина 3 — секція датасету «ВЛАСНА МОДЕЛЬ НАРІЗКИ» видима ЛИШЕ founder.
// Збирач (datasetCollector) не зачеплений — ховаємо тільки UI-секцію.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/ocrService.js', () => ({
  extractText: vi.fn(async () => ({ text: '', pageStructure: null })),
  localizeOcrError: () => 'помилка',
  writeExtractedTextArtifact: vi.fn(async () => true),
  writeLayoutArtifact: vi.fn(async () => true),
  getCachedText: vi.fn(async () => null),
  hasOcrSupport: () => true,
  extractTextBatch: vi.fn(async () => []),
}));

// Контролюємо founder-флаг; решта tenantService — справжня.
const founderFlag = { value: true };
vi.mock('../../src/services/tenantService.js', async (importActual) => {
  const actual = await importActual();
  return { ...actual, isCurrentUserFounder: () => founderFlag.value };
});

import { render, screen } from '@testing-library/react';
import { DocumentPipelineContext } from '../../src/contexts/DocumentPipelineContext.jsx';
import DocumentProcessorV2 from '../../src/components/DocumentProcessorV2/index.jsx';
import * as store from '../../src/services/documentPipeline/jobProgressStore.js';

const CASE = { id: 'case_gate', name: 'Справа gate', storage: { subFolders: {} } };

function renderDp() {
  const ctx = { run: vi.fn(), ingestFiles: vi.fn(), addFiles: vi.fn(), cancel: vi.fn(), resume: vi.fn(), keepPartial: vi.fn(), discardAll: vi.fn(), ecitsPending: {} };
  return render(
    <DocumentPipelineContext.Provider value={ctx}>
      <DocumentProcessorV2 caseData={CASE} onExecuteAction={vi.fn()} driveConnected={false} />
    </DocumentPipelineContext.Provider>,
  );
}

describe('A2 Частина 3 — founder-gate секції датасету нарізки', () => {
  beforeEach(() => store._resetForTests());

  it('founder бачить секцію «ВЛАСНА МОДЕЛЬ НАРІЗКИ»', () => {
    founderFlag.value = true;
    renderDp();
    expect(screen.getByText('ВЛАСНА МОДЕЛЬ НАРІЗКИ')).toBeInTheDocument();
  });

  it('не-founder НЕ бачить секцію датасету', () => {
    founderFlag.value = false;
    renderDp();
    expect(screen.queryByText('ВЛАСНА МОДЕЛЬ НАРІЗКИ')).not.toBeInTheDocument();
  });
});
