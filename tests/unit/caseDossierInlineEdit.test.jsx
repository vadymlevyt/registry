// @vitest-environment jsdom
// caseDossierInlineEdit.test.jsx — TASK case_ui_and_result_polish §1.
// Корінь бага: inline-edit назви/клієнта був лише у CaseModal, а клік по
// справі відкриває CaseDossier, де назва була звичайним текстом. Тут
// перевіряємо що у CaseDossier назва і клієнт редагуються кліком і
// зберігаються через executeAction('qi_agent','update_case_field',…)
// (ця дія сама ставить nameSource:'manual'). Працює для БУДЬ-ЯКОЇ справи.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Глушимо важкі I/O-залежності CaseDossier — нам потрібен лише рендер шапки
// і поведінка inline-edit, не Drive/OCR/контекст.
vi.mock('../../src/services/driveService.js', () => ({
  createCaseStructure: vi.fn(), getDriveFiles: vi.fn(async () => []),
  readDriveFile: vi.fn(async () => null), readDriveFileBytes: vi.fn(async () => null),
  createDriveFile: vi.fn(async () => null), updateDriveFile: vi.fn(async () => null),
  uploadFileToCaseFolder: vi.fn(async () => null),
}));
vi.mock('../../src/services/driveAuth.js', () => ({
  driveRequest: vi.fn(async () => { throw new Error('no drive in test'); }),
  forceConsentRefresh: vi.fn(),
}));
vi.mock('../../src/components/CaseDossier/services/contextGenerator.js', () => ({
  generateCaseContext: vi.fn(async () => null),
}));

import CaseDossier from '../../src/components/CaseDossier/index.jsx';

function makeCase(overrides = {}) {
  return {
    id: 'case_test_1',
    name: '[ЄСІТС] Манолюк (560/5543/24)',
    client: 'Манолюк',
    category: 'admin',
    status: 'active',
    court: 'Рівненський окружний адмінсуд',
    case_no: '560/5543/24',
    hearings: [], deadlines: [], notes: [], documents: [], proceedings: [],
    storage: {},
    ...overrides,
  };
}

function renderDossier(caseData, onExecuteAction) {
  return render(
    <CaseDossier
      caseData={caseData}
      cases={[caseData]}
      updateCase={vi.fn()}
      onClose={vi.fn()}
      onSaveIdea={vi.fn()}
      onCloseCase={vi.fn()}
      onDeleteCase={vi.fn()}
      notes={[]}
      onAddNote={vi.fn()}
      onUpdateNote={vi.fn()}
      onDeleteNote={vi.fn()}
      onPinNote={vi.fn()}
      driveConnected={false}
      onExecuteAction={onExecuteAction}
      setAiUsage={vi.fn()}
    />,
  );
}

describe('CaseDossier — inline-edit назви/клієнта (§1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('клік по назві → input → Enter зберігає через update_case_field', () => {
    const exec = vi.fn(() => ({ success: true }));
    renderDossier(makeCase(), exec);

    fireEvent.click(screen.getByRole('button', { name: 'Назва справи' }));
    const input = screen.getByLabelText('Назва справи');
    fireEvent.change(input, { target: { value: 'Манолюк В.О.' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(exec).toHaveBeenCalledWith('qi_agent', 'update_case_field', {
      caseId: 'case_test_1', field: 'name', value: 'Манолюк В.О.',
    });
  });

  it('клік по клієнту → input → Enter зберігає client через update_case_field', () => {
    const exec = vi.fn(() => ({ success: true }));
    renderDossier(makeCase(), exec);

    fireEvent.click(screen.getByRole('button', { name: 'Клієнт справи' }));
    const input = screen.getByLabelText('Клієнт справи');
    fireEvent.change(input, { target: { value: 'Манолюк Василь Олександрович' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(exec).toHaveBeenCalledWith('qi_agent', 'update_case_field', {
      caseId: 'case_test_1', field: 'client', value: 'Манолюк Василь Олександрович',
    });
  });

  it('порожня назва НЕ зберігається (allowEmpty=false)', () => {
    const exec = vi.fn(() => ({ success: true }));
    renderDossier(makeCase(), exec);

    fireEvent.click(screen.getByRole('button', { name: 'Назва справи' }));
    const input = screen.getByLabelText('Назва справи');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(exec).not.toHaveBeenCalled();
  });

  it('працює для заведеної вручну справи (назва без [ЄСІТС])', () => {
    const exec = vi.fn(() => ({ success: true }));
    renderDossier(makeCase({ name: 'Брановський', client: 'Брановський П.І.' }), exec);

    fireEvent.click(screen.getByRole('button', { name: 'Назва справи' }));
    const input = screen.getByLabelText('Назва справи');
    fireEvent.change(input, { target: { value: 'Брановський (апеляція)' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(exec).toHaveBeenCalledWith('qi_agent', 'update_case_field', {
      caseId: 'case_test_1', field: 'name', value: 'Брановський (апеляція)',
    });
  });
});
