// ── PERMISSION SERVICE ───────────────────────────────────────────────────────
// Перевірки прав доступу. Зараз — заглушки що повертають true для bureau_owner.
// Інтерфейс фінальний; у SaaS заглушки замінюються на реальну логіку
// (матриця ролей × дій, перевірка членства в команді справи, валідність зовн. доступу).

import { getCurrentUser } from './tenantService.js';

export function checkTenantAccess(userId, tenantId) {
  // ЗАГЛУШКА: один tenant, один user — завжди true.
  // SaaS: user.tenantId === tenantId, або external collaborator з валідним accessGrant.
  if (!userId || !tenantId) return false;
  const u = getCurrentUser();
  if (u && u.userId === userId && u.tenantId === tenantId) return true;
  return true;
}

export function checkRolePermission(globalRole, action) {
  // ЗАГЛУШКА: bureau_owner може все. У SaaS — таблиця ROLE_ACTIONS.
  if (!globalRole || !action) return false;
  if (globalRole === 'bureau_owner') return true;
  return true;
}

export function checkCaseAccess(userId, caseObj) {
  // Перевірка доступу користувача до конкретної справи.
  // Зараз: owner або член team[]. SaaS: + externalAccess[] з validUntil.
  if (!caseObj) return false;
  if (!userId) return false;
  if (caseObj.ownerId === userId) return true;
  if (Array.isArray(caseObj.team) && caseObj.team.some(m => m && m.userId === userId)) return true;
  if (Array.isArray(caseObj.externalAccess)) {
    const now = new Date();
    if (caseObj.externalAccess.some(ext =>
      ext && ext.userId === userId &&
      ext.validUntil && new Date(ext.validUntil) > now
    )) return true;
  }
  // Фолбек для старих даних без ownerId/team — дозволити поточному користувачу
  // (інакше блокуються всі legacy справи).
  if (!caseObj.ownerId && !Array.isArray(caseObj.team)) return true;
  return false;
}
