// ── ECITS SERVICE ────────────────────────────────────────────────────────────
// Фасад модуля «Електронний суд» (ЄСІТС).
//
// Реальна інтеграція з cabinet.court.gov.ua робитиметься через Computer Use
// (Claude for Chrome або власне розширення) — окремі майбутні TASK. На цьому
// етапі (TASK 0.2 — інфраструктурний скелет) усі методи повертають mock-дані.
//
// SaaS-готовність: налаштування модуля живуть у
// tenant.settings.moduleIntegration.ecits — переноситься між tenant'ами разом
// з усім tenant-конфігом, не потребує окремої міграції.
//
// Billing: коли запрацюють реальні сценарії — кожен виклик triggerSync
// інструментуватиметься через activityTracker.report з категорією system.
// Зараз заглушки не торкаються білінгу.

import { getCurrentTenant } from './tenantService.js';

// Дефолти налаштувань ЄСІТС. Використовуються коли в tenant'і поля немає.
// Залишається на місці оголошення один сенс: початковий стан, з якого
// адвокат починає налаштовувати модуль (autoSync вимкнено, нічого не
// синхронізується автоматично).
export const DEFAULT_ECITS_SETTINGS = Object.freeze({
  autoSync: false,
  syncIntervalMinutes: null,
  casesToSync: 'all',          // 'all' | 'active' | array of caseIds
  autoProcessIncoming: false,
  detectDeadlinesOnReceive: false,
  executionProvider: 'claudeForChrome',  // 'claudeForChrome' | 'embedded'
});

/**
 * Запустити синхронізацію з кабінетом ЄСІТС.
 *
 * TODO (наступний TASK — ECITS RPA integration v1): викликати
 * computerUseRunner з планом сценарію login → fetch_inbox → categorize.
 * Інструментувати через activityTracker.report('ecits_sync', {...}) і
 * logAiUsage для виклику Claude Vision.
 *
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function triggerSync() {
  return {
    success: false,
    message: 'Інтеграція з кабінетом ЄСІТС у розробці. Кнопка покаже реальний результат у майбутньому TASK.',
  };
}

/**
 * Час останньої успішної синхронізації для рядка статусу.
 *
 * TODO: читати з tenant.settings.moduleIntegration.ecits._lastSyncAt
 * після того як triggerSync почне реально працювати.
 *
 * @returns {string|null} ISO datetime
 */
export function getLastSyncTime() {
  return null;
}

/**
 * Звіт по останній синхронізації для вкладки «Журнал».
 *
 * TODO: при реальній інтеграції повертатиме структуру з полями:
 * { startedAt, finishedAt, casesScanned, documentsReceived[], errors[] }.
 *
 * @returns {object} mock-звіт
 */
export function getSyncReport() {
  return {
    startedAt: null,
    finishedAt: null,
    casesScanned: 0,
    documentsReceived: [],
    errors: [],
    note: 'Синхронізації ще не виконувались. Заглушка модуля.',
  };
}

/**
 * Поточні налаштування модуля ЄСІТС для активного tenant'а.
 * Якщо tenant.settings.moduleIntegration.ecits відсутні — повертає дефолти.
 *
 * @returns {object} ecits settings
 */
export function getSettings() {
  const tenant = getCurrentTenant();
  const fromTenant = tenant?.settings?.moduleIntegration?.ecits;
  if (fromTenant && typeof fromTenant === 'object') {
    return { ...DEFAULT_ECITS_SETTINGS, ...fromTenant };
  }
  return { ...DEFAULT_ECITS_SETTINGS };
}

/**
 * Часткове оновлення налаштувань.
 *
 * TODO: реальне збереження в registry_data.json через executeAction
 * 'update_tenant_settings' (буде додано окремим TASK). Зараз — тільки
 * валідація patch'а і повернення майбутнього стану для UI-preview.
 *
 * @param {object} patch
 * @returns {object} merged settings (не персистяться зараз)
 */
export function updateSettings(patch) {
  if (!patch || typeof patch !== 'object') {
    return getSettings();
  }
  return { ...getSettings(), ...patch };
}
