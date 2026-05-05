// ── PERMISSION SERVICE ───────────────────────────────────────────────────────
// Перевірки прав доступу.
// Активація v1.1: реальна tenant ізоляція + bureau_owner override + team membership.
// caseRole permissions поки не використовуються — для майбутньої гранулярності.
// v4 Billing Foundation — додано TIME_ENTRY_ACTIONS, canViewTimeEntries.

import { getCurrentUser } from './tenantService.js';

// v4: дії над time_entries для майбутніх SaaS-ролей. Поки використовується
// лише canViewTimeEntries (для запитів getTimeEntries з фронтенду).
export const TIME_ENTRY_ACTIONS = [
  'view_own_time_entries',
  'view_all_time_entries',
  'edit_time_entries',
  'delete_time_entries',
  'export_time_entries',
];

export function checkTenantAccess(userId, tenantId) {
  if (!userId || !tenantId) return false;
  const u = getCurrentUser();
  if (!u || u.userId !== userId) return false;
  return u.tenantId === tenantId;
}

export function checkRolePermission(globalRole, action) {
  if (!globalRole || !action) return false;
  // bureau_owner може все. У SaaS — повноцінна таблиця ROLE_ACTIONS.
  if (globalRole === 'bureau_owner') return true;
  // Поки немає матриці — не блокуємо інших, але ця заглушка прибереться
  // окремо коли підключаємо ROLE_ACTIONS у Multi-user Activation TASK.
  return true;
}

// Сигнатура (userId, caseObj) — узгоджено в SaaS Foundation v1.1 діагностиці.
export function checkCaseAccess(userId, caseObj) {
  if (!caseObj || !userId) return false;
  const u = getCurrentUser();
  if (!u || u.userId !== userId) return false;

  // 1. Tenant isolation
  if (caseObj.tenantId && caseObj.tenantId !== u.tenantId) return false;

  // 2. Bureau owner — повний доступ до всіх справ свого tenant
  if (u.globalRole === 'bureau_owner') return true;

  // 3. Owner справи
  if (caseObj.ownerId === userId) return true;

  // 4. Team membership
  if (Array.isArray(caseObj.team) && caseObj.team.some(m => m && m.userId === userId)) {
    return true;
  }

  // 5. External access (з обмеженням за часом)
  if (Array.isArray(caseObj.externalAccess)) {
    const now = new Date();
    if (caseObj.externalAccess.some(ext =>
      ext && ext.userId === userId &&
      ext.validUntil && new Date(ext.validUntil) > now
    )) {
      return true;
    }
  }

  return false;
}

// v4: огляд time_entries. У solo-режимі — bureau_owner бачить все,
// інші — лише свої. Активніша матриця підключиться в Multi-user Activation.
export function canViewTimeEntries(userId, targetUserId, tenantId) {
  if (!userId || !tenantId) return false;
  const u = getCurrentUser();
  if (!u || u.userId !== userId) return false;
  if (u.tenantId !== tenantId) return false;
  if (u.globalRole === 'bureau_owner') return true;
  return userId === targetUserId;
}

// v4: редагування — тільки автор або bureau_owner.
export function canEditTimeEntry(userId, entry) {
  if (!userId || !entry) return false;
  const u = getCurrentUser();
  if (!u || u.userId !== userId) return false;
  if (u.tenantId !== entry.tenantId) return false;
  if (u.globalRole === 'bureau_owner') return true;
  return entry.userId === userId;
}
