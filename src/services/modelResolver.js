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

  // imageSorter — семантичне сортування кількох зображень в один документ
  // (TASK B: склейка фото у PDF з виявленням підмінених сторінок).
  // Готова точка ієрархії user → tenant → system. Поки не використовується.
  imageSorter: 'claude-sonnet-4-20250514',

  // imageDocumentGrouper — AI-агент межі ДОКУМЕНТІВ між фото у DP image-merge
  // сценарії (TASK 1B image_merge_unify). Адвокат фотографує N сторінок =
  // M документів (паспорт + договір + квитанція); grouper пропонує які фото
  // складають один документ. Тільки межі — порядок сторінок в межах документа
  // лишається за imageSortingAgent (інший намір, правило #11).
  // Haiku — структурна задача, дешевша і швидша за Sonnet, §4.1 DP візії
  // (cheap-before-expensive: межі документів — pattern matching, не глибокий
  // reasoning).
  imageDocumentGrouper: 'claude-haiku-4-5-20251001',
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
