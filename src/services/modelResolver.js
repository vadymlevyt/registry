// ── MODEL RESOLVER ───────────────────────────────────────────────────────────
// Ієрархія вибору моделі для кожного типу агента:
//   user.preferences.modelPreferences[agentType]
//     → tenant.modelPreferences[agentType]
//       → SYSTEM_DEFAULTS[agentType]
//
// SYSTEM_DEFAULTS — те що зашите в системі. Замінюються лише через адмін-UI
// у майбутньому SaaS, не редагуються в коді на льоту.

import { getCurrentTenant, getCurrentUser } from './tenantService.js';

export const SYSTEM_DEFAULTS = {
  dossierAgent: 'claude-sonnet-4-20250514',
  qiAgent: 'claude-sonnet-4-20250514',
  qiParserDocument: 'claude-haiku-4-5-20251001',
  qiParserImage: 'claude-haiku-4-5-20251001',
  dashboardAgent: 'claude-sonnet-4-20250514',
  documentProcessor: 'claude-sonnet-4-20250514',
  documentParserVision: 'claude-sonnet-4-20250514',
  caseContextGenerator: 'claude-sonnet-4-20250514',
  deepAnalysis: 'claude-opus-4-7',
};

const FALLBACK_MODEL = 'claude-sonnet-4-20250514';

export function resolveModel(agentType) {
  const user = getCurrentUser();
  const userPref = user?.preferences?.modelPreferences?.[agentType];
  if (userPref) return userPref;

  const tenant = getCurrentTenant();
  const tenantPref = tenant?.modelPreferences?.[agentType];
  if (tenantPref) return tenantPref;

  return SYSTEM_DEFAULTS[agentType] || FALLBACK_MODEL;
}

export function getSystemDefaults() {
  return { ...SYSTEM_DEFAULTS };
}
