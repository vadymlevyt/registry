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
  dossierAgent: 'claude-sonnet-4-6',
  qiAgent: 'claude-sonnet-4-6',
  qiParserDocument: 'claude-haiku-4-5-20251001',
  qiParserImage: 'claude-haiku-4-5-20251001',
  dashboardAgent: 'claude-sonnet-4-6',
  documentProcessor: 'claude-sonnet-4-6',
  documentParserVision: 'claude-sonnet-4-6',
  caseContextGenerator: 'claude-sonnet-4-6',
  deepAnalysis: 'claude-opus-4-8',

  // imageSorter — семантичне сортування кількох зображень в один документ
  // (TASK B: склейка фото у PDF з виявленням підмінених сторінок).
  // Готова точка ієрархії user → tenant → system. Поки не використовується.
  imageSorter: 'claude-sonnet-4-6',

  // imageDocumentGrouper — AI-агент межі ДОКУМЕНТІВ між фото у DP image-merge
  // сценарії (TASK 1B image_merge_unify). Адвокат фотографує N сторінок =
  // M документів (паспорт + договір + квитанція); grouper пропонує які фото
  // складають один документ. Тільки межі — порядок сторінок в межах документа
  // лишається за imageSortingAgent (інший намір, правило #11).
  // Haiku — структурна задача, дешевша і швидша за Sonnet, §4.1 DP візії
  // (cheap-before-expensive: межі документів — pattern matching, не глибокий
  // reasoning).
  imageDocumentGrouper: 'claude-haiku-4-5-20251001',

  // textCleaner — очистка сирого OCR-тексту сканованого документа у читабельний
  // Markdown (TASK 3.1 cleanTextService, КРОК 2 AI-поліш). Haiku — задача
  // форматування, не глибокий reasoning; дешева і швидка (cheap-before-expensive).
  // Консервативний промпт (НЕ міняє юридичний зміст). Готова точка ієрархії
  // user → tenant → system.
  textCleaner: 'claude-haiku-4-5-20251001',

  // textDigest — модель для Конспекту (clean_text v2, режим 'digest'). ОКРЕМИЙ
  // ключ від textCleaner (Чистий) — режими резолвлять модель НЕЗАЛЕЖНО (per-mode
  // шов). Зараз Haiku; кандидат на Sonnet (структурна/творча задача — де інтелект
  // цінний), що вмикається СУТО конфігом modelPreferences.textDigest, без коду.
  textDigest: 'claude-haiku-4-5-20251001',

  // metadataExtractor — режим «без OCR» (TASK 4 етап D): Claude Vision читає
  // перші 1-2 сторінки документа і пропонує метадані (date/category/author/
  // name/gist), БЕЗ повного OCR і артефактів у 02. Haiku 4.5 (зір) — дешева
  // структурна задача (cheap-before-expensive). Усі поля — ПРОПОЗИЦІЇ, адвокат
  // править. Готова точка ієрархії user → tenant → system.
  metadataExtractor: 'claude-haiku-4-5-20251001',
};

const FALLBACK_MODEL = 'claude-sonnet-4-6';

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

// ROLE_LABELS — людські назви ролей агентів для UI Налаштувань / ModelPicker.
// Ключі = ключі SYSTEM_DEFAULTS. Один сенс: відображувана назва ролі (НЕ модель,
// НЕ дефолт; правило #11).
export const ROLE_LABELS = {
  qiAgent: 'Quick Input — чат-команди',
  dashboardAgent: 'Дашборд — чат',
  dossierAgent: 'Досьє справи — чат',
  documentProcessor: 'Обробка документів',
  documentParserVision: 'Розпізнавання документів (зір)',
  caseContextGenerator: 'Генератор контексту справи',
  deepAnalysis: 'Глибокий аналіз',
  imageSorter: 'Сортування зображень',
  imageDocumentGrouper: 'Межі документів (фото)',
  qiParserDocument: 'QI — парсер документів',
  qiParserImage: 'QI — парсер зображень',
  textCleaner: 'Очистка тексту — Чистий',
  textDigest: 'Очистка тексту — Конспект',
  metadataExtractor: 'Метадані без OCR',
};

// withModelPreference / withoutModelPreference — ЧИСТІ immutable-хелпери: повертають
// НОВИЙ tenant-об'єкт з оновленим modelPreferences, не мутуючи вхідний. App.jsx
// бере результат і прокидає його І в setTenants (→ Drive), І в setActiveTenant
// (→ читання resolveModel) — щоб запис і читання дивилися в одне джерело (§4.6).
// «Clear» = виставити null (resolveModel трактує falsy як «нема override» → падає
// у SYSTEM_DEFAULTS); форма узгоджена з DEFAULT_TENANT.modelPreferences (ключі з null).
export function withModelPreference(tenant, agentType, modelId) {
  const base = tenant || {};
  return {
    ...base,
    modelPreferences: { ...(base.modelPreferences || {}), [agentType]: modelId },
  };
}

export function withoutModelPreference(tenant, agentType) {
  const base = tenant || {};
  return {
    ...base,
    modelPreferences: { ...(base.modelPreferences || {}), [agentType]: null },
  };
}
