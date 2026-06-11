// represented-parties.test.js — TASK represented_parties_and_manual_edit E2E
// Перевіряє повний flow на РЕАЛЬНОМУ createActions (через _actionsTestSetup):
//   A. CREATE: справа зі списком представлених сторін → назва/client зі списку,
//      nameSource:'auto', representedPartiesFullNames top-level.
//   B. UPDATE: існуюча автогенерована справа освіжається новим списком
//      (приймальні кейси Бабенки/Махді); ручна (nameSource:'manual') — святе.
//   C. Ручне редагування: update_case_field(name|client) → nameSource:'manual'
//      → наступний імпорт НЕ перезаписує.
//   + PERMISSIONS (court_sync_agent ↔ update_case_identity ↔ update_case_field)
//   + білінг (court_sync identity-оновлення не нараховується).

import { describe, it, expect } from 'vitest';
import { createHarness } from './_actionsTestSetup.js';
import { submitScenarioResult } from '../../src/services/ecits/scenarioProcessor.js';
import { ensureCaseSaasAndEcitsFields } from '../../src/services/migrationService.js';

function makeEnvelope(cases) {
  return {
    envelopeVersion: 1,
    scenarioId: 'ecits_import_cases_and_hearings',
    scenarioVersion: 1,
    producedAt: '2026-06-11T10:00:00.000Z',
    producedBy: { provider: 'claude_for_chrome', providerVersion: 'test' },
    data: {
      ecitsAdvocate: { fullName: 'Левицький В.А.', cabinetIdentifier: null },
      stats: { totalCasesInCabinet: cases.length, filtered: cases.length, withHearings2026: 0 },
      cases,
      warnings: [],
      skipped: [],
    },
  };
}

describe('A. CREATE зі списком представлених сторін', () => {
  it('representedParties[] → назва "[ЄСІТС] А, Б (no)", client join, nameSource auto, fullNames top-level', async () => {
    const h = createHarness();
    const res = await submitScenarioResult(makeEnvelope([{
      case_no: '757/9362/25',
      court: 'Подільський суд',
      category: 'civil',
      representedParties: ['Бабенко О.І.', 'Бабенко П.П.'],
      representedPartiesFullNames: ['Бабенко Олена Іванівна', 'Бабенко Петро Петрович'],
      hearings: [],
    }]), { executeAction: h.executeAction, getCases: h.getCases });

    expect(res.casesCreated).toBe(1);
    expect(res.errors).toHaveLength(0);
    const c = h.getCases()[0];
    expect(c.name).toBe('[ЄСІТС] Бабенко О.І., Бабенко П.П. (757/9362/25)');
    expect(c.client).toBe('Бабенко О.І., Бабенко П.П.');
    expect(c.nameSource).toBe('auto');
    expect(c.representedPartiesFullNames).toEqual(['Бабенко Олена Іванівна', 'Бабенко Петро Петрович']);
    // canonical parties[] НЕ чіпаємо (окремий backfill TASK)
    expect(c.parties).toEqual([]);
  });

  it('старий envelope (лише primaryParty) → поведінка як раніше + nameSource auto', async () => {
    const h = createHarness();
    await submitScenarioResult(makeEnvelope([{
      case_no: '450/2275/25',
      primaryParty: 'Бабенко О.І.',
      hearings: [],
    }]), { executeAction: h.executeAction, getCases: h.getCases });
    const c = h.getCases()[0];
    expect(c.name).toBe('[ЄСІТС] Бабенко О.І. (450/2275/25)');
    expect(c.client).toBe('Бабенко О.І.');
    expect(c.nameSource).toBe('auto');
    expect('representedPartiesFullNames' in c).toBe(false);
  });
});

describe('B. UPDATE існуючої справи (приймальні кейси)', () => {
  it('Бабенки: "[ЄСІТС] 757/9362/25-ц" (без імені, без nameSource) → з іменами', async () => {
    const h = createHarness({ initialCases: [{
      id: 'case_babenko',
      name: '[ЄСІТС] 757/9362/25-ц',
      client: null,
      case_no: '757/9362/25-ц',
      hearings: [],
    }] });
    const res = await submitScenarioResult(makeEnvelope([{
      case_no: '757/9362/25',
      representedParties: ['Бабенко О.І.', 'Бабенко П.П.'],
      hearings: [],
    }]), { executeAction: h.executeAction, getCases: h.getCases });

    expect(res.casesCreated).toBe(0);
    expect(res.casesUpdated).toBe(1);
    expect(res.errors).toHaveLength(0);
    const c = h.getCases()[0];
    expect(c.name).toBe('[ЄСІТС] Бабенко О.І., Бабенко П.П. (757/9362/25)');
    expect(c.client).toBe('Бабенко О.І., Бабенко П.П.');
    expect(c.nameSource).toBe('auto');   // court_sync НЕ перемикає на manual
  });

  it('Махді: "[ЄСІТС] Пироженко Є.В. (363/4635/25)" → Махді А.С.', async () => {
    const h = createHarness({ initialCases: [{
      id: 'case_mahdi',
      name: '[ЄСІТС] Пироженко Є.В. (363/4635/25)',
      client: 'Пироженко Є.В.',
      case_no: '363/4635/25',
      hearings: [],
    }] });
    await submitScenarioResult(makeEnvelope([{
      case_no: '363/4635/25',
      representedParties: ['Махді А.С.'],
      hearings: [],
    }]), { executeAction: h.executeAction, getCases: h.getCases });
    const c = h.getCases()[0];
    expect(c.name).toBe('[ЄСІТС] Махді А.С. (363/4635/25)');
    expect(c.client).toBe('Махді А.С.');
  });

  it('existing nameSource=manual → name/client НЕ чіпаються (лише ecitsState)', async () => {
    const h = createHarness({ initialCases: [{
      id: 'case_manual',
      name: '[ЄСІТС] Моя ручна назва (1/1/25)',
      nameSource: 'manual',
      client: 'Мій клієнт',
      case_no: '1/1/25',
      hearings: [],
    }] });
    const res = await submitScenarioResult(makeEnvelope([{
      case_no: '1/1/25',
      representedParties: ['Інший І.І.'],
      hearings: [],
    }]), { executeAction: h.executeAction, getCases: h.getCases });
    expect(res.casesUpdated).toBe(1); // ecitsState оновлено
    const c = h.getCases()[0];
    expect(c.name).toBe('[ЄСІТС] Моя ручна назва (1/1/25)');
    expect(c.client).toBe('Мій клієнт');
    expect(c.nameSource).toBe('manual');
    expect(c.ecitsState?.syncStatus).toBe('synced');
  });

  it('existing без nameSource і без префікса → виводиться manual, НЕ чіпається', async () => {
    const h = createHarness({ initialCases: [{
      id: 'case_legacy_manual',
      name: 'Іваненко проти ТОВ',
      client: 'Іваненко І.І.',
      case_no: '2/2/25',
      hearings: [],
    }] });
    await submitScenarioResult(makeEnvelope([{
      case_no: '2/2/25',
      representedParties: ['Хтось Х.Х.'],
      hearings: [],
    }]), { executeAction: h.executeAction, getCases: h.getCases });
    const c = h.getCases()[0];
    expect(c.name).toBe('Іваненко проти ТОВ');
    expect(c.client).toBe('Іваненко І.І.');
  });

  it('старий envelope БЕЗ representedParties → існуюча auto-справа без змін', async () => {
    const h = createHarness({ initialCases: [{
      id: 'case_old_env',
      name: '[ЄСІТС] 450/2275/25',
      client: null,
      case_no: '450/2275/25',
      hearings: [],
    }] });
    await submitScenarioResult(makeEnvelope([{
      case_no: '450/2275/25',
      primaryParty: 'Бабенко О.І.',
      hearings: [],
    }]), { executeAction: h.executeAction, getCases: h.getCases });
    const c = h.getCases()[0];
    expect(c.name).toBe('[ЄСІТС] 450/2275/25');
    expect(c.client).toBeNull();
  });

  it('білінг: identity-оновлення з source=court_sync НЕ нараховується', async () => {
    const h = createHarness({ initialCases: [{
      id: 'case_bill',
      name: '[ЄСІТС] 3/3/25',
      client: null,
      case_no: '3/3/25',
      hearings: [],
    }] });
    await submitScenarioResult(makeEnvelope([{
      case_no: '3/3/25',
      representedParties: ['Сторона С.С.'],
      hearings: [],
    }]), { executeAction: h.executeAction, getCases: h.getCases });
    expect(h.getCases()[0].name).toBe('[ЄСІТС] Сторона С.С. (3/3/25)');
    const identityReports = h.getTrackerCalls().filter(t => t.action === 'update_case_identity');
    expect(identityReports).toHaveLength(0);
  });
});

describe('C. Ручне редагування захищає від авто-перезапису', () => {
  it('update_case_field(name) від UI → nameSource manual → наступний імпорт НЕ перезаписав', async () => {
    const h = createHarness({ initialCases: [{
      id: 'case_protect',
      name: '[ЄСІТС] Бабенко О.І. (757/9362/25)',
      nameSource: 'auto',
      client: 'Бабенко О.І.',
      case_no: '757/9362/25',
      hearings: [],
    }] });

    // Адвокат править назву (inline-edit у CaseModal іде цим самим шляхом).
    const r = await h.executeAction('qi_agent', 'update_case_field', {
      caseId: 'case_protect', field: 'name', value: 'Бабенки — поділ майна',
    });
    expect(r.success).toBe(true);
    expect(h.getCases()[0].nameSource).toBe('manual');

    // Наступний імпорт з representedParties — назву НЕ чіпає.
    await submitScenarioResult(makeEnvelope([{
      case_no: '757/9362/25',
      representedParties: ['Бабенко О.І.', 'Бабенко П.П.'],
      hearings: [],
    }]), { executeAction: h.executeAction, getCases: h.getCases });
    expect(h.getCases()[0].name).toBe('Бабенки — поділ майна');
    expect(h.getCases()[0].nameSource).toBe('manual');
  });

  it('update_case_field(client) теж ставить manual', async () => {
    const h = createHarness({ initialCases: [{
      id: 'c1', name: '[ЄСІТС] X (1/1/25)', nameSource: 'auto', client: 'X', case_no: '1/1/25', hearings: [],
    }] });
    await h.executeAction('dossier_agent', 'update_case_field', {
      caseId: 'c1', field: 'client', value: 'Новий клієнт',
    });
    expect(h.getCases()[0].client).toBe('Новий клієнт');
    expect(h.getCases()[0].nameSource).toBe('manual');
  });

  it('update_case_field НЕ-identity поля (court) nameSource НЕ чіпає', async () => {
    const h = createHarness({ initialCases: [{
      id: 'c2', name: '[ЄСІТС] X (1/1/25)', nameSource: 'auto', client: 'X', case_no: '1/1/25', hearings: [],
    }] });
    await h.executeAction('qi_agent', 'update_case_field', {
      caseId: 'c2', field: 'court', value: 'Інший суд',
    });
    expect(h.getCases()[0].nameSource).toBe('auto');
  });
});

describe('PERMISSIONS і контракт update_case_identity', () => {
  const base = { id: 'cp', name: '[ЄСІТС] X (1/1/25)', client: 'X', case_no: '1/1/25', hearings: [] };

  it('court_sync_agent МОЖЕ update_case_identity', async () => {
    const h = createHarness({ initialCases: [base] });
    const r = await h.executeAction('court_sync_agent', 'update_case_identity', {
      caseId: 'cp', name: '[ЄСІТС] А, Б (1/1/25)', client: 'А, Б', nameSource: 'auto', source: 'court_sync',
    });
    expect(r.success).toBe(true);
    expect(h.getCases()[0].name).toBe('[ЄСІТС] А, Б (1/1/25)');
    expect(h.getCases()[0].nameSource).toBe('auto');
  });

  it('court_sync_agent НЕ може update_case_field (людська дія)', async () => {
    const h = createHarness({ initialCases: [base] });
    const r = await h.executeAction('court_sync_agent', 'update_case_field', {
      caseId: 'cp', field: 'name', value: 'Y',
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/повноважень/);
  });

  it('валідація: source обов\'язковий; nameSource лише auto|manual; порожній name відхиляється', async () => {
    const h = createHarness({ initialCases: [base] });
    const noSource = await h.executeAction('court_sync_agent', 'update_case_identity', {
      caseId: 'cp', name: 'Z',
    });
    expect(noSource.success).toBe(false);
    const badNs = await h.executeAction('court_sync_agent', 'update_case_identity', {
      caseId: 'cp', name: 'Z', nameSource: 'whatever', source: 'court_sync',
    });
    expect(badNs.success).toBe(false);
    const emptyName = await h.executeAction('court_sync_agent', 'update_case_identity', {
      caseId: 'cp', name: '   ', source: 'court_sync',
    });
    expect(emptyName.success).toBe(false);
    const missing = await h.executeAction('court_sync_agent', 'update_case_identity', {
      caseId: 'nope', name: 'Z', source: 'court_sync',
    });
    expect(missing.success).toBe(false);
  });
});

describe('ensureCaseSaasAndEcitsFields — лінивий дефолт nameSource (без schema bump)', () => {
  it('явне значення зберігається', () => {
    expect(ensureCaseSaasAndEcitsFields({ id: 'c', name: 'X', nameSource: 'auto' }).nameSource).toBe('auto');
    expect(ensureCaseSaasAndEcitsFields({ id: 'c', name: '[ЄСІТС] X', nameSource: 'manual' }).nameSource).toBe('manual');
  });
  it('без nameSource: префікс "[ЄСІТС] " → auto, інакше manual', () => {
    expect(ensureCaseSaasAndEcitsFields({ id: 'c', name: '[ЄСІТС] Бабенко О.І. (1/1/25)' }).nameSource).toBe('auto');
    expect(ensureCaseSaasAndEcitsFields({ id: 'c', name: 'Іваненко проти ТОВ' }).nameSource).toBe('manual');
    expect(ensureCaseSaasAndEcitsFields({ id: 'c' }).nameSource).toBe('manual');
  });
});
