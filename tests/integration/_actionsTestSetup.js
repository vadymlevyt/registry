// Тонкий тестовий адаптер над РЕАЛЬНИМ createActions (src/services/actionsRegistry.js).
//
// Замінює видалений _actionsHarness.js, який ВРУЧНУ дублював логіку ACTIONS
// (tracking_debt #3). Тут — НУЛЬ логіки ACTIONS/PERMISSIONS/executeAction:
// лише конструювання ін'єктованих deps поверх ізольованого in-memory стану,
// щоб кожен інтеграційний тест ганяв справжній код, а не ручну копію.
//
// API сумісний зі старим harness (createHarness({initialCases}) → executeAction,
// getCases, getDeletedDriveIds, …), тож існуючі тести лишаються без зміни асертів.
//
// Permission-перевірки ін'єктовано пропускними (() => true) — це ТОЧНО та
// поведінка, яку мав старий harness (він не мав tenant/role/case-access кроків
// зовсім). App.jsx натомість ін'єктує реальні permissionService-заглушки —
// поведінка App не змінюється. eventBus/activityTracker/Drive-сайд-ефекти —
// no-op/recorder стаби (старий harness теж не реплікував eventBus/billing).
import { createActions } from '../../src/services/actionsRegistry.js';

export function createHarness({ initialCases = [] } = {}) {
  let cases = JSON.parse(JSON.stringify(initialCases));
  let notes = { cases: [], general: [], content: [], system: [], records: [] };
  let timeEntries = [];
  const auditLog = [];
  // Старий harness реєстрував видалені driveId (delete_document mode='full'
  // каскадно видаляє driveId + originalDriveId). Реальний delete_document
  // викликає deleteDriveFile(id) послідовно — recorder пушить кожен непорожній
  // id у тому самому порядку (driveId, потім originalDriveId).
  const deletedDriveIds = [];

  const setCases = (u) => { cases = typeof u === 'function' ? u(cases) : u; };
  const setNotes = (u) => { notes = typeof u === 'function' ? u(notes) : u; };
  const setTimeEntries = (u) => { timeEntries = typeof u === 'function' ? u(timeEntries) : u; };

  const noopTracker = {
    report() {},
    startSession() { return null; },
    endSession() { return null; },
    startSubtimer() { return null; },
    endSubtimer() { return null; },
    updateSubtimer() { return false; },
    assignOfflinePeriod() { return null; },
  };

  const { executeAction } = createActions({
    getCases: () => cases,
    setCases,
    setNotes,
    setTimeEntries,
    saveNotesToLS: () => {},
    writeAudit: (params) => { auditLog.push(params); return { id: `audit_${auditLog.length}` }; },
    checkTenantAccess: () => true,
    checkRolePermission: () => true,
    checkCaseAccess: () => true,
    activityTracker: noopTracker,
    eventBus: { publish() {} },
    deleteDriveFile: async (id) => { if (id) deletedDriveIds.push(id); },
    deleteOcrCacheForDocument: async () => {},
    deleteExtendedForDocument: async () => {},
  });

  return {
    executeAction,
    getCases: () => cases,
    getNotes: () => notes,
    getTimeEntries: () => timeEntries,
    getAuditLog: () => auditLog,
    getDeletedDriveIds: () => [...deletedDriveIds],
  };
}
