// ── ECITS SERVICE ────────────────────────────────────────────────────────────
// Фасад модуля «Електронний суд» (ЄСІТС).
//
// Реальна інтеграція з cabinet.court.gov.ua робитиметься через Computer Use
// (Claude for Chrome або власне розширення) — окремі майбутні TASK. На цьому
// етапі (TASK 0.2 — інфраструктурний скелет) усі методи повертають mock-дані.
//
// TASK 0.3 додав інфраструктуру recon (розвідки) через офіційне розширення
// Claude for Chrome: реєстр сценаріїв, історія запусків, експорт артефактів.
//
// SaaS-готовність: налаштування модуля живуть у
// tenant.settings.moduleIntegration.ecits — переноситься між tenant'ами разом
// з усім tenant-конфігом, не потребує окремої міграції. Recon-історія —
// tenant.recon_history[], розширення без schema bump.
//
// Billing: коли запрацюють реальні сценарії — кожен виклик triggerSync
// інструментуватиметься через activityTracker.report з категорією system.
// Зараз заглушки не торкаються білінгу. Recon виконується через підписку
// Claude for Chrome адвоката — наша сторона не списує AI-токени.

import { getCurrentTenant } from './tenantService.js';
import { RECON_SCENARIOS, RECON_ECITS_BASIC_V1 } from './recon/scenarios/ecitsBasic.js';

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

// ── RECONNAISSANCE (TASK 0.3) ────────────────────────────────────────────────
// Інфраструктура read-only розвідки кабінету ЄСІТС через офіційне розширення
// Claude for Chrome. Артефакти зберігаються на Google Drive у
// _research/ecits/<reconId>/, історія запусків — у localStorage поточної
// сесії і паралельно мігрує до tenant.recon_history[] при наступному
// записі реєстру (поле додано в DEFAULT_TENANT без schema bump).

const RECON_HISTORY_STORAGE_KEY = 'levytskyi_recon_history';
const MAX_RECON_HISTORY_ENTRIES = 200;

// Внутрішнє читання історії з localStorage (з graceful fallback в browser-less
// середовищах типу Vitest node environment, де localStorage недоступний).
function readReconHistoryFromStorage() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(RECON_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeReconHistoryToStorage(list) {
  try {
    if (typeof localStorage === 'undefined') return;
    const trimmed = list.slice(0, MAX_RECON_HISTORY_ENTRIES);
    localStorage.setItem(RECON_HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[ecitsService] writeReconHistoryToStorage failed:', err);
  }
}

function formatTimestampForFolder(date = new Date()) {
  // YYYY-MM-DD_HH-MM формат: безпечне ім'я папки і читабельне для адвоката.
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${y}-${m}-${d}_${hh}-${mm}`;
}

/**
 * Повертає всі доступні recon-сценарії. Поки що один — RECON_ecits_basic_v1.
 * Майбутні сценарії (наприклад RECON_competitors_*) додаватимуться в
 * src/services/recon/scenarios/.
 * @returns {Array} frozen scenarios list
 */
export function getReconScenarios() {
  return RECON_SCENARIOS;
}

/**
 * Знайти сценарій за id.
 * @param {string} scenarioId
 * @returns {object|null}
 */
export function getReconScenarioById(scenarioId) {
  return RECON_SCENARIOS.find((s) => s.id === scenarioId) || null;
}

/**
 * Повертає історію recon-запусків у спадному порядку за startedAt (новіші
 * перші). Джерело — localStorage; коли App.jsx запише реєстр, ця історія
 * мігрує у tenant.recon_history[].
 * @returns {Array}
 */
export function getReconHistory() {
  const list = readReconHistoryFromStorage();
  return [...list].sort((a, b) => {
    const aTs = a?.startedAt || '';
    const bTs = b?.startedAt || '';
    return bTs.localeCompare(aTs);
  });
}

/**
 * Створити запис про новий recon-запуск. Не запускає сам recon — це лише
 * реєстрація у локальній історії з заздалегідь сформованим reconId і
 * targetFolder, щоб UI міг показати куди дивитись на Drive.
 *
 * @param {string} scenarioId
 * @param {{ now?: Date }} [options]
 * @returns {{ reconId: string, scenarioId: string, startedAt: string, targetFolder: string, status: 'in_progress' }}
 */
export function registerReconRun(scenarioId, options = {}) {
  const scenario = getReconScenarioById(scenarioId);
  if (!scenario) {
    throw new Error(`registerReconRun: unknown scenarioId '${scenarioId}'`);
  }
  const now = options.now instanceof Date ? options.now : new Date();
  const folderStamp = formatTimestampForFolder(now);
  const reconId = `ecits_${folderStamp}`;
  const targetFolder = `${scenario.targetFolderRoot}/${folderStamp}`;
  const record = {
    reconId,
    scenarioId,
    startedAt: now.toISOString(),
    completedAt: null,
    targetFolder,
    status: 'in_progress',
    summary: null,
  };
  const current = readReconHistoryFromStorage();
  writeReconHistoryToStorage([record, ...current]);
  return record;
}

/**
 * Позначити recon-запис завершеним. status: 'completed' | 'failed' | 'abandoned'.
 *
 * @param {string} reconId
 * @param {{ status?: 'completed'|'failed'|'abandoned', summary?: string|null, now?: Date }} [patch]
 * @returns {object|null} updated record or null if not found
 */
export function markReconCompleted(reconId, patch = {}) {
  const list = readReconHistoryFromStorage();
  const idx = list.findIndex((r) => r?.reconId === reconId);
  if (idx === -1) return null;
  const now = patch.now instanceof Date ? patch.now : new Date();
  const updated = {
    ...list[idx],
    status: patch.status || 'completed',
    summary: patch.summary ?? list[idx].summary ?? null,
    completedAt: now.toISOString(),
  };
  list[idx] = updated;
  writeReconHistoryToStorage(list);
  return updated;
}

/**
 * Перевірити з'єднання з провайдером виконання (Claude for Chrome).
 *
 * Технічно зі сторінки Legal BMS ми не можемо детектувати присутність
 * розширення Claude for Chrome — воно не експонує контент через window-API.
 * Адвокат підтверджує вручну в UI Setup-кроку.
 *
 * @returns {Promise<{ detected: boolean, reason: string, provider: string }>}
 */
export async function testProviderConnection() {
  return {
    detected: false,
    reason: 'Manual verification required',
    provider: 'claudeForChrome',
  };
}

/**
 * Сформувати очікуваний шлях ZIP-архіву для аналізу. Реальний експорт
 * (збір файлів з Drive у ZIP) робиться у DriveService/окремому утиліті
 * наступного TASK — тут лише шлях, щоб UI показав куди дивитись.
 *
 * Зараз функція повертає очікуваний path; запис ZIP не виконується,
 * адвокат скачує артефакти безпосередньо через посилання на папку.
 *
 * @param {string} reconId
 * @returns {{ reconId: string, targetFolder: string|null, exportPath: string|null }}
 */
export function exportReconForAnalysis(reconId) {
  const list = readReconHistoryFromStorage();
  const record = list.find((r) => r?.reconId === reconId);
  if (!record) {
    return { reconId, targetFolder: null, exportPath: null };
  }
  return {
    reconId,
    targetFolder: record.targetFolder,
    exportPath: `${record.targetFolder}/export_for_analysis.zip`,
  };
}

// Експорт ключа localStorage для тестів та можливого debug-екрану.
export const __RECON_HISTORY_STORAGE_KEY = RECON_HISTORY_STORAGE_KEY;
export { RECON_ECITS_BASIC_V1 };
