// @vitest-environment jsdom
// DP-4 — DocumentProcessorV2: 4 зони, 8 перемикачів, дисклеймер датасету,
// кнопка «Розпочати» вимкнена без файлів. Контекст — fake value (seam).
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
import { render, screen } from '@testing-library/react';
import { DocumentPipelineContext } from '../../src/contexts/DocumentPipelineContext.jsx';
import DocumentProcessorV2 from '../../src/components/DocumentProcessorV2/index.jsx';
import * as store from '../../src/services/documentPipeline/jobProgressStore.js';

const CTX = { run: vi.fn(), ingestFiles: vi.fn(), cancel: vi.fn(), resume: vi.fn(), keepPartial: vi.fn(), discardAll: vi.fn(), ecitsPending: {} };
const CASE = { id: 'case_t', name: 'Тест', storage: { subFolders: {} } };

function renderDP() {
  return render(
    <DocumentPipelineContext.Provider value={CTX}>
      <DocumentProcessorV2 caseData={CASE} onExecuteAction={vi.fn()} driveConnected={false} />
    </DocumentPipelineContext.Provider>,
  );
}

describe('DocumentProcessorV2', () => {
  beforeEach(() => store._resetForTests());

  it('header: назва + 2 швидкі функції', () => {
    renderDP();
    expect(screen.getByText('Робота з документами')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Розпізнати текст/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Стиснути файл/ })).toBeInTheDocument();
  });

  it('4 зони присутні', () => {
    renderDP();
    expect(screen.getByText(/Зона 1 · Вхідна/)).toBeInTheDocument();
    expect(screen.getByText(/Зона 2 · Налаштування/)).toBeInTheDocument();
    expect(screen.getByText(/Зона 3 · Аналіз і результат/)).toBeInTheDocument();
  });

  it('робочі перемикачі обробки присутні (A2 Частина 1 прибрала 5 мертвих)', () => {
    renderDP();
    for (const lbl of [
      'Нарізати том на документи',
      'Без розпізнавання тексту',
      'Стиснути всі файли пакета',
      'Оновити case_context.md',
    ]) {
      expect(screen.getByText(lbl)).toBeInTheDocument();
    }
    // «Очистити для читання» прибрано (V2-A2) — DP більше не чистить текст.
    expect(screen.queryByText('Очистити для читання')).not.toBeInTheDocument();
    // A2 Частина 1 — 5 мертвих тумблерів (без backing-логіки) прибрано з UI.
    for (const dead of [
      'Розкласти по провадженнях',
      'Перевірка цілісності перед обробкою',
      'Згенерувати короткий зміст',
      'Запропонувати дедлайни з документів',
      'Заповнити картку справи з документів',
    ]) {
      expect(screen.queryByText(dead)).not.toBeInTheDocument();
    }
  });

  it('дисклеймер датасету присутній', () => {
    renderDP();
    expect(screen.getByText(/Технічної анонімізації не виконується/)).toBeInTheDocument();
  });

  it('«Розпочати» вимкнена коли немає файлів', () => {
    renderDP();
    const btn = screen.getByRole('button', { name: /Розпочати обробку/ });
    expect(btn).toBeDisabled();
  });
});
