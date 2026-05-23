// ── ENTITLEMENTS SERVICE ─────────────────────────────────────────────────────
// Перевірка чи tenant'у дозволено використовувати конкретний модуль/сценарій.
// Один сенс (правило #11): "є/нема дозволу на функцію" — НЕ ліцензія, НЕ
// білінг, НЕ rate-limit (це окремі шари).
//
// Tenant зберігає entitlements у `tenant.subscription.entitlements`. Це
// додано поряд з legacy `tenant.subscription.features` (`['all']`) — старе
// поле помічене як deprecated, але НЕ видаляється (правило ДНК-додавання).
// Якщо entitlements відсутні (старий tenant до bump'а) — fallback на
// TARIFF_MATRIX за `subscription.plan`.
//
// SaaS-готовність: усі майбутні модулі (Canvas, AI Provider, Storage)
// підключаються через entitlements без зміни сервісу. Trial-режим, експіратор
// і remainingUsages — у структурі, активуються коли білінг піде в продакшн.
//
// MVP TASK 0.4: ecits.import_cases_and_hearings — єдиний сценарій що
// перевіряється з UI; решта модулів — пасивні дефолти.

import { getPlan } from './tariffMatrix.js';

/**
 * Канонічний дефолт entitlements для self_hosted плану. Використовується
 * у `ensureEntitlements` (з migrateTenant) і коли tenant не має поля взагалі.
 *
 * trialMode: false       — повний (не trial) доступ
 * expiresAt: null        — без терміну дії
 * remainingUsages: null  — без обмеження кількості
 */
export function buildDefaultEntitlements() {
  return {
    ecits: {
      enabled: true,
      scenarios: { import_cases_and_hearings: true },
      trialMode: false,
      expiresAt: null,
      remainingUsages: null,
    },
    documents: { enabled: true },
    canvas: { enabled: true },
  };
}

/**
 * Нормалізує entitlements структуру у tenant.subscription. Викликається з
 * migrateTenant. Ідемпотентна — повторне виконання нічого не змінює.
 *
 * @param {object} subscription
 * @returns {object} subscription з гарантованим полем entitlements
 */
export function ensureEntitlements(subscription) {
  const sub = (subscription && typeof subscription === 'object') ? subscription : {};
  if (sub.entitlements && typeof sub.entitlements === 'object') {
    return sub;
  }
  return { ...sub, entitlements: buildDefaultEntitlements() };
}

/**
 * Перевіряє чи tenant може використати модуль / сценарій. Повертає
 * `{ allowed, reason }` — `reason` пояснює відмову (для UI повідомлення).
 *
 * Логіка:
 *   1. Якщо tenant.subscription.entitlements є — читаємо з нього.
 *   2. Інакше fallback на TARIFF_MATRIX за planId.
 *   3. trialMode + expiresAt в минулому → expired.
 *   4. remainingUsages <= 0 → quota_exhausted.
 *
 * @param {object} tenant
 * @param {string} moduleId       'ecits' | 'documents' | 'canvas' | ...
 * @param {string} [scenarioId]   optional sub-scenario
 * @returns {{ allowed: boolean, reason?: string, source: 'entitlements'|'tariff'|'fallback' }}
 */
export function canUseModule(tenant, moduleId, scenarioId) {
  if (!moduleId) return { allowed: false, reason: 'moduleId required', source: 'fallback' };

  const entitlements = tenant?.subscription?.entitlements;
  if (entitlements && typeof entitlements === 'object') {
    const mod = entitlements[moduleId];
    if (!mod) return { allowed: false, reason: `module '${moduleId}' not in entitlements`, source: 'entitlements' };
    if (mod.enabled === false) return { allowed: false, reason: `module '${moduleId}' disabled`, source: 'entitlements' };

    if (mod.expiresAt) {
      const expiresMs = Date.parse(mod.expiresAt);
      if (!Number.isNaN(expiresMs) && expiresMs < Date.now()) {
        return { allowed: false, reason: `module '${moduleId}' expired`, source: 'entitlements' };
      }
    }
    if (typeof mod.remainingUsages === 'number' && mod.remainingUsages <= 0) {
      return { allowed: false, reason: `module '${moduleId}' quota exhausted`, source: 'entitlements' };
    }
    if (scenarioId && mod.scenarios && mod.scenarios[scenarioId] === false) {
      return { allowed: false, reason: `scenario '${scenarioId}' disabled in '${moduleId}'`, source: 'entitlements' };
    }
    return { allowed: true, source: 'entitlements' };
  }

  // Fallback: tariffMatrix за planId
  const planId = tenant?.subscription?.plan;
  const plan = planId ? getPlan(planId) : null;
  if (plan) {
    const mod = plan.modules?.[moduleId];
    if (!mod || mod.enabled === false) {
      return { allowed: false, reason: `module '${moduleId}' not in plan '${planId}'`, source: 'tariff' };
    }
    if (scenarioId && mod.scenarios && mod.scenarios[scenarioId] === false) {
      return { allowed: false, reason: `scenario '${scenarioId}' disabled in plan '${planId}'`, source: 'tariff' };
    }
    return { allowed: true, source: 'tariff' };
  }

  // Останній fallback: дефолтні entitlements (self_hosted)
  const defaults = buildDefaultEntitlements();
  const mod = defaults[moduleId];
  if (!mod || mod.enabled === false) {
    return { allowed: false, reason: `module '${moduleId}' not in defaults`, source: 'fallback' };
  }
  if (scenarioId && mod.scenarios && mod.scenarios[scenarioId] === false) {
    return { allowed: false, reason: `scenario '${scenarioId}' disabled in defaults`, source: 'fallback' };
  }
  return { allowed: true, source: 'fallback' };
}

/**
 * Спрощений зріз entitlements для window.LegalBMS API (extension handshake).
 * Не повертає sensitive дані (тільки прапори і назви модулів). Розширення
 * вирішує що показувати користувачу на основі цього зрізу.
 *
 * @param {object|null} tenant
 * @returns {object}
 */
export function getForExtension(tenant) {
  const entitlements = tenant?.subscription?.entitlements || buildDefaultEntitlements();
  const out = {};
  for (const [moduleId, mod] of Object.entries(entitlements)) {
    out[moduleId] = {
      enabled: mod?.enabled !== false,
      scenarios: mod?.scenarios ? { ...mod.scenarios } : null,
      trialMode: !!mod?.trialMode,
      expiresAt: mod?.expiresAt || null,
    };
  }
  return out;
}
