// ── AUDIT LOG SERVICE ────────────────────────────────────────────────────────
// Журнал критичних дій. Зараз пише в локальний state auditLog[] через сеттер.
// У SaaS — додатково на бекенд для незалежного непохитного логу.

import { getCurrentUser } from './tenantService.js';

export const AUDIT_ACTIONS = [
  'create_case',
  'close_case',
  'restore_case',
  'destroy_case',
  'delete_hearing',
  'delete_deadline',
  // v4 Billing Foundation — критичні дії над time_entries.
  'time_entries_archived',
  'time_entry_edited',
  'time_entry_deleted',
  'time_standards_changed',
];

export function shouldAudit(action) {
  return AUDIT_ACTIONS.includes(action);
}

function makeId() {
  return `log_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export function buildAuditEntry(params) {
  const u = getCurrentUser();
  return {
    id: makeId(),
    tenantId: params.tenantId || u.tenantId,
    userId: params.userId || u.userId,
    userRoleAtTime: params.userRoleAtTime || u.globalRole,
    action: params.action,
    targetType: params.targetType || null,
    targetId: params.targetId || null,
    timestamp: new Date().toISOString(),
    status: params.status || 'done',
    details: params.details || {},
    context: params.context || {},
  };
}

export function writeAuditLog(setAuditLog, params) {
  if (typeof setAuditLog !== 'function') {
    console.warn('writeAuditLog: setAuditLog не є функцією, запис пропущено');
    return null;
  }
  const entry = buildAuditEntry(params);
  setAuditLog(prev => {
    const next = Array.isArray(prev) ? [...prev, entry] : [entry];
    return next.length > 10000 ? next.slice(next.length - 10000) : next;
  });
  return entry;
}

export function updateAuditLogStatus(setAuditLog, entryId, newStatus, extraDetails = null) {
  if (typeof setAuditLog !== 'function' || !entryId) return;
  setAuditLog(prev => {
    if (!Array.isArray(prev)) return prev;
    return prev.map(e => {
      if (e.id !== entryId) return e;
      const merged = { ...e, status: newStatus };
      if (extraDetails) {
        merged.details = { ...(e.details || {}), ...extraDetails };
      }
      return merged;
    });
  });
}
