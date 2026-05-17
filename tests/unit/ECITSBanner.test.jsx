// @vitest-environment jsdom
// DP-4 — 3 точки індикації ЄСІТС рендеряться ЛИШЕ коли ecitsPending[caseId]>0
// (нуль hardcoded). Дані з DocumentPipelineContext (fake value — тестовий seam).
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../src/services/ocrService.js', () => ({
  extractText: vi.fn(async () => ({ text: '', pageStructure: null })),
  localizeOcrError: () => 'помилка',
  writeExtractedTextArtifact: vi.fn(async () => true),
  writeLayoutArtifact: vi.fn(async () => true),
  getCachedText: vi.fn(async () => null),
  hasOcrSupport: () => true,
  extractTextBatch: vi.fn(async () => []),
}));
import { render, screen } from '@testing-library/react';
import { DocumentPipelineContext } from '../../src/contexts/DocumentPipelineContext.jsx';
import { ECITSBanner } from '../../src/components/ECITSBanner/index.jsx';
import { ECITSRegistryBadge } from '../../src/components/ECITSBanner/RegistryBadge.jsx';
import { ECITSDashboardSection } from '../../src/components/ECITSBanner/DashboardSection.jsx';

const wrap = (ui, ecitsPending) => render(
  <DocumentPipelineContext.Provider value={{ ecitsPending }}>
    {ui}
  </DocumentPipelineContext.Provider>,
);

describe('ECITS UI — 3 точки', () => {
  it('Банер: 0 → нічого; >0 → текст з лічильником', () => {
    const { container, rerender } = wrap(<ECITSBanner caseId="c1" />, {});
    expect(container.firstChild).toBeNull();
    rerender(
      <DocumentPipelineContext.Provider value={{ ecitsPending: { c1: 4 } }}>
        <ECITSBanner caseId="c1" />
      </DocumentPipelineContext.Provider>,
    );
    expect(screen.getByText(/В INBOX 4 нових файлів/)).toBeInTheDocument();
  });

  it('Бейдж реєстру: 0 → null; >0 → показує число', () => {
    const { container } = wrap(<ECITSRegistryBadge caseId="c2" />, { c1: 1 });
    expect(container.firstChild).toBeNull();
    wrap(<ECITSRegistryBadge caseId="c1" />, { c1: 7 });
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('Секція дашборду: список лише справ з INBOX', () => {
    const cases = [{ id: 'c1', name: 'Справа А' }, { id: 'c2', name: 'Справа Б' }];
    const onOpenCase = vi.fn();
    wrap(<ECITSDashboardSection cases={cases} onOpenCase={onOpenCase} />, { c2: 3 });
    expect(screen.getByText(/Нові надходження з ЄСІТС/)).toBeInTheDocument();
    expect(screen.getByText('Справа Б')).toBeInTheDocument();
    expect(screen.queryByText('Справа А')).not.toBeInTheDocument();
  });

  it('Секція дашборду: жодної справи з INBOX → null', () => {
    const { container } = wrap(
      <ECITSDashboardSection cases={[{ id: 'c1', name: 'А' }]} onOpenCase={() => {}} />, {},
    );
    expect(container.firstChild).toBeNull();
  });
});
