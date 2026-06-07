// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BulkActionBar } from '../../src/components/UI/BulkActionBar.jsx';

/**
 * Контракт стабільної висоти бара.
 *
 * Раніше блок дій рендерився умовно (selectedCount > 0). На mobile через
 * width:100% він переносився на другий рядок — висота бара змінювалась
 * при першому виділенні, список матеріалів нижче (flex:1; overflowY:auto
 * у Реєстрі CaseDossier) перераховував висоту, і webkit на планшеті
 * глючив reflow → список схлопувався до видимого remount'у вкладки.
 *
 * Фікс: контейнер .bulk-action-bar__actions завжди в DOM, при count=0
 * — modifier --empty (visibility:hidden + pointer-events:none).
 * Висота бара лишається тою самою → flex:1 не перераховує → бага немає.
 */
describe('BulkActionBar — стабільна висота бара (fix-registry-select-blank)', () => {
  it('контейнер дій присутній у DOM навіть коли selectedCount = 0', () => {
    const { container } = render(
      <BulkActionBar
        total={5}
        selectedCount={0}
        allSelected={false}
        someSelected={false}
        onToggleSelectAll={() => {}}
      >
        <button type="button">Архівувати обрані</button>
      </BulkActionBar>
    );

    const actions = container.querySelector('.bulk-action-bar__actions');
    expect(actions).toBeInTheDocument();
    expect(actions.className).toMatch(/bulk-action-bar__actions--empty/);
    expect(actions.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('button')).toBeInTheDocument();
  });

  it('при selectedCount > 0 — без модифікатора --empty, aria-hidden=false', () => {
    const { container } = render(
      <BulkActionBar
        total={5}
        selectedCount={2}
        allSelected={false}
        someSelected={true}
        onToggleSelectAll={() => {}}
      >
        <button type="button">Архівувати обрані</button>
      </BulkActionBar>
    );

    const actions = container.querySelector('.bulk-action-bar__actions');
    expect(actions).toBeInTheDocument();
    expect(actions.className).not.toMatch(/bulk-action-bar__actions--empty/);
    expect(actions.getAttribute('aria-hidden')).toBe('false');
  });

  it('структура DOM не змінюється між count=0 і count>0 (стабільна висота)', () => {
    const { container: c0 } = render(
      <BulkActionBar total={3} selectedCount={0} allSelected={false} someSelected={false} onToggleSelectAll={() => {}}>
        <button type="button">Дія</button>
      </BulkActionBar>
    );
    const { container: c1 } = render(
      <BulkActionBar total={3} selectedCount={1} allSelected={false} someSelected={true} onToggleSelectAll={() => {}}>
        <button type="button">Дія</button>
      </BulkActionBar>
    );

    expect(c0.querySelector('.bulk-action-bar__actions')).toBeInTheDocument();
    expect(c1.querySelector('.bulk-action-bar__actions')).toBeInTheDocument();
    expect(c0.querySelectorAll('.bulk-action-bar > *').length).toBe(
      c1.querySelectorAll('.bulk-action-bar > *').length
    );
  });
});
