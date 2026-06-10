// ecits-existence-check-race.test.js — TASK ecits_existence_check_fix
//
// Регресія гонки: update_case_ecits_state і mark_synced_from_ecits раніше
// виставляли прапор `found` ВСЕРЕДИНІ async setCases-updater'а, а читали
// синхронно одразу після setCases. У реальному React updater спрацьовував
// після батча → found ще false → дія повертала «Справу X не знайдено»
// хоча справа була у getCases().
//
// Тут стабуємо setCases як DEFERRED: updater НЕ виконується синхронно
// (зберігається у чергу). Цього достатньо щоб старий код впав, а
// виправлений (сінхронна перевірка існування через getCases().find() ДО
// setCases) повернув success.
//
// Жодних додаткових assertions про побічні ефекти setCases — це б
// перевело тест у спостереження за оновленням state. Тут перевіряємо
// саме контракт: повертає коректне success/error на основі снапшоту
// getCases на момент виклику.

import { describe, it, expect } from 'vitest';
import { createActions } from '../../src/services/actionsRegistry.js';

function makeDeferredHarness({ initialCases = [] } = {}) {
  const cases = JSON.parse(JSON.stringify(initialCases));
  // setCases-апдейтери накопичуються, але НЕ виконуються — імітація React-батча,
  // через який зчитування прапора `found` одразу після setCases давало false.
  const pendingUpdaters = [];
  const setCases = (updater) => {
    if (typeof updater === 'function') {
      pendingUpdaters.push(updater);
    }
    // НІЧОГО не міняємо в cases синхронно — це і є суть гонки.
  };

  const { executeAction } = createActions({
    getCases: () => cases,
    setCases,
    setNotes: () => {},
    setTimeEntries: () => {},
    saveNotesToLS: () => {},
    writeAudit: () => ({ id: 'audit_1' }),
    checkTenantAccess: () => true,
    checkRolePermission: () => true,
    checkCaseAccess: () => true,
    activityTracker: {
      report: () => {}, startSession: () => null, endSession: () => null,
      startSubtimer: () => null, endSubtimer: () => null,
      updateSubtimer: () => false, assignOfflinePeriod: () => null,
    },
    eventBus: { publish: () => {} },
    deleteDriveFile: async () => {},
    deleteOcrCacheForDocument: async () => {},
    deleteExtendedForDocument: async () => {},
    deleteDocumentsArtifactsBatch: async () => ({ deletedCount: 0, failedCount: 0 }),
    deleteExtendedForDocuments: async () => 0,
    clearResume: () => {},
  });

  return { executeAction, getPendingUpdaterCount: () => pendingUpdaters.length };
}

const INITIAL_CASE = {
  id: 'case_existing',
  tenantId: 'ab_levytskyi',
  ownerId: 'vadym',
  name: 'Existing case',
  hearings: [],
  ecitsState: {},
};

describe('ECITS existence check race — update_case_ecits_state', () => {
  it('повертає success коли справа існує у getCases (DEFERRED setCases, raw old code б упав)', async () => {
    const h = makeDeferredHarness({ initialCases: [INITIAL_CASE] });
    const result = await h.executeAction('court_sync_agent', 'update_case_ecits_state', {
      caseId: 'case_existing',
      patch: { syncStatus: 'syncing' },
      source: 'court_sync',
    });
    expect(result.success).toBe(true);
    // Patch ушлось у чергу setCases — pendingUpdaters лишається 1.
    expect(h.getPendingUpdaterCount()).toBe(1);
  });

  it('повертає error коли справи з таким caseId НЕ існує у getCases', async () => {
    const h = makeDeferredHarness({ initialCases: [INITIAL_CASE] });
    const result = await h.executeAction('court_sync_agent', 'update_case_ecits_state', {
      caseId: 'case_does_not_exist',
      patch: { syncStatus: 'syncing' },
      source: 'court_sync',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/не знайдено/);
    // setCases НЕ викликався — не повинно нічого додатись у чергу.
    expect(h.getPendingUpdaterCount()).toBe(0);
  });

  it('повертає success з overwriteSkipped коли source має нижчий пріоритет', async () => {
    // Існуючий _lastSource='manual' (priority 100); court_sync (80) не перезапише.
    const seeded = {
      ...INITIAL_CASE,
      ecitsState: { _lastSource: 'manual', syncStatus: 'synced' },
    };
    const h = makeDeferredHarness({ initialCases: [seeded] });
    const result = await h.executeAction('court_sync_agent', 'update_case_ecits_state', {
      caseId: 'case_existing',
      patch: { syncStatus: 'syncing' },
      source: 'court_sync',
    });
    expect(result.success).toBe(true);
    expect(result.overwriteSkipped).toBe(true);
    // setCases НЕ викликається коли перезапис пропущено — стара поведінка
    // зберігалась через `return c`, новий код пропускає setCases цілком.
    expect(h.getPendingUpdaterCount()).toBe(0);
  });
});

describe('ECITS existence check race — mark_synced_from_ecits', () => {
  it('повертає success коли справа існує у getCases (DEFERRED setCases)', async () => {
    const h = makeDeferredHarness({ initialCases: [INITIAL_CASE] });
    const result = await h.executeAction('court_sync_agent', 'mark_synced_from_ecits', {
      caseId: 'case_existing',
      status: 'synced',
      documentsCount: 0,
      hearingsCount: 1,
    });
    expect(result.success).toBe(true);
    expect(result.syncedAt).toBeTruthy();
    expect(h.getPendingUpdaterCount()).toBe(1);
  });

  it('повертає error коли справи з таким caseId НЕ існує у getCases', async () => {
    const h = makeDeferredHarness({ initialCases: [INITIAL_CASE] });
    const result = await h.executeAction('court_sync_agent', 'mark_synced_from_ecits', {
      caseId: 'case_missing',
      status: 'synced',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/не знайдено/);
    expect(h.getPendingUpdaterCount()).toBe(0);
  });
});
