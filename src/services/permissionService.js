// ── PERMISSION SERVICE ───────────────────────────────────────────────────────
// Перевірки прав доступу.
// Активація v1.1: реальна tenant ізоляція + bureau_owner override + team membership.
// caseRole permissions поки не використовуються — для майбутньої гранулярності.

import { getCurrentUser } from './tenantService.js';

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
