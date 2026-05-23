// ── ECITS SCENARIO PROCESSOR ─────────────────────────────────────────────────
// Обробка результату ЄСІТС-сценарію (envelope з Claude for Chrome або з
// майбутнього власного розширення). Один сенс (правило #11): "взяти envelope,
// розкласти його у виклики ACTIONS, повернути підсумок".
//
// НЕ парсить дані (це робить агент-збирач). НЕ малює UI (це робить
// ImportTab.jsx). НЕ перевіряє права (це робить executeAction через
// PERMISSIONS). Тільки оркестрація.
//
// Архітектурний патерн: dependency injection. executeAction живе в render
// closure factory `createActions(deps)` у App.jsx, тож scenarioProcessor
// НЕ імпортує його напряму — отримує через deps. Це дозволяє тестам
// підставляти ізольований executeAction.
//
// Кроки обробки envelope:
//   1. validateEnvelope() — формальна валідація форми
//   2. Для кожної ecitsCase:
//      a) Пошук існуючої справи за ecitsState.caseId
//      b) Якщо існує → update_case_ecits_state + add_hearing для нових засідань
//      c) Якщо нова → create_case з origin='ecits_import', потім add_hearing'и
//   3. Запис у tenant.ecits_scenario_history (через appendScenarioHistoryEntry deps)
//   4. Повертаємо { casesCreated, casesUpdated, hearingsAdded, skipped, errors }
//
// Білінг: create_case з origin='ecits_import' автоматично виключається з
// білінгу в actionsRegistry.js (TASK 0.4 hook). add_hearing з source='court_sync'
// теж не нараховується (R5 fix). Тут не потрібна додаткова логіка.

import { canOverwrite } from '../sourcePolicy.js';

/**
 * Формальна валідація envelope. Кидає Error при критичній невідповідності
 * (відсутній envelopeVersion/scenarioId/data), повертає void при OK.
 *
 * @param {object} envelope
 */
export function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('envelope must be an object');
  }
  if (envelope.envelopeVersion !== 1) {
    throw new Error(`unsupported envelopeVersion: ${envelope.envelopeVersion}`);
  }
  if (envelope.scenarioId !== 'ecits_import_cases_and_hearings') {
    throw new Error(`unsupported scenarioId: ${envelope.scenarioId}`);
  }
  if (!envelope.data || typeof envelope.data !== 'object') {
    throw new Error('envelope.data is missing');
  }
  if (!Array.isArray(envelope.data.cases)) {
    throw new Error('envelope.data.cases must be an array');
  }
}

/**
 * Будує object для виклику create_case з ecits-кейса.
 * Внутрішня — експортується для тестів.
 */
export function buildCreateCaseParams(ecitsCase) {
  const nowIso = new Date().toISOString();
  const ecitsState = {
    caseId: ecitsCase.ecitsCaseId,
    filedAt: null,
    court: ecitsCase.court || null,
    lastSyncedAt: nowIso,
    lastSyncedBy: null,
    syncStatus: 'synced',
    failureReason: null,
    syncMetrics: {
      totalSyncs: 1,
      successfulSyncs: 1,
      failedSyncs: 0,
      documentsExtracted: 0,
      hearingsExtracted: Array.isArray(ecitsCase.hearings) ? ecitsCase.hearings.length : 0,
      lastDurationMs: null,
    },
    _lastSource: 'court_sync',
  };
  // primaryParty — для денормалізованого client field (UI legacy). Backfill
  // структурованих parties[] — у tracking_debt і наступному TASK.
  const fields = {
    name: ecitsCase.primaryParty
      ? `[ЄСІТС] ${ecitsCase.primaryParty} (${ecitsCase.case_no})`
      : `[ЄСІТС] ${ecitsCase.case_no}`,
    client: ecitsCase.primaryParty || null,
    case_no: ecitsCase.case_no || null,
    court: ecitsCase.court || null,
    category: ecitsCase.category || null,
    status: 'active',
    origin: 'ecits_import',
    ecitsState,
  };
  return fields;
}

/**
 * Будує params для add_hearing.
 */
export function buildAddHearingParams(caseId, hearing) {
  return {
    caseId,
    date: hearing.date,
    time: hearing.time,
    duration: 120,                  // дефолт; адвокат коригуватиме
    type: null,
    source: 'court_sync',
    sourceConfidence: 'high',
    ecitsContext: {
      ecitsNotificationId: null,
      notificationDocumentType: hearing.noticeType || null,
      notifiedAt: null,
      deliveredToCabinetAt: null,
      emailSentAt: null,
      cabinetUrl: hearing.cabinetUrl || null,
    },
  };
}

/**
 * Перевіряє чи hearing вже є у справі (за датою і часом).
 * Якщо є — додавати не треба (дедуплікація між синхронізаціями).
 */
function hearingExists(existingCase, hearing) {
  if (!existingCase || !Array.isArray(existingCase.hearings)) return false;
  return existingCase.hearings.some(
    (h) => h && h.date === hearing.date && h.time === hearing.time,
  );
}

/**
 * Обробка однієї справи з envelope. Повертає інкременти для result.
 *
 * deps: { executeAction, agentId, getTenant }
 */
async function processCase(ecitsCase, deps, scenarioRunId, getCases) {
  const { executeAction, agentId } = deps;
  const inc = { casesCreated: 0, casesUpdated: 0, hearingsAdded: 0, skipped: 0, errors: [] };

  if (!ecitsCase.ecitsCaseId) {
    inc.skipped++;
    inc.errors.push({ case_no: ecitsCase.case_no, message: 'missing ecitsCaseId' });
    return inc;
  }

  // 1. Пошук існуючої справи за ecitsCaseId
  const existing = getCases().find((c) => c?.ecitsState?.caseId === ecitsCase.ecitsCaseId);

  let caseId;
  if (existing) {
    // Update existing — оновити ecitsState (інкрементує syncMetrics)
    caseId = existing.id;
    const patchResult = await executeAction(agentId, 'update_case_ecits_state', {
      caseId,
      patch: {
        lastSyncedAt: new Date().toISOString(),
        syncStatus: 'synced',
        failureReason: null,
      },
      source: 'court_sync',
    });
    if (patchResult?.success) {
      inc.casesUpdated++;
    } else {
      inc.errors.push({ case_no: ecitsCase.case_no, message: `update_case_ecits_state failed: ${patchResult?.error || 'unknown'}` });
    }
  } else {
    // Create new
    const createParams = buildCreateCaseParams(ecitsCase);
    const createResult = await executeAction(agentId, 'create_case', createParams);
    if (createResult?.success) {
      caseId = createResult.caseId;
      inc.casesCreated++;
    } else if (createResult?.error === 'duplicate_ecits_case' && createResult.existingCaseId) {
      // Гонка: справа з'явилась між пошуком і create_case. Прив'язуємось до неї.
      caseId = createResult.existingCaseId;
      inc.casesUpdated++;
    } else {
      inc.skipped++;
      inc.errors.push({ case_no: ecitsCase.case_no, message: `create_case failed: ${createResult?.error || 'unknown'}` });
      return inc;
    }
  }

  // 2. Додати засідання що ще не існують
  const targetCase = getCases().find((c) => c.id === caseId);
  const hearings = Array.isArray(ecitsCase.hearings) ? ecitsCase.hearings : [];
  for (const hearing of hearings) {
    if (!hearing.date || !hearing.time) {
      inc.errors.push({ case_no: ecitsCase.case_no, message: `hearing skipped: missing date/time` });
      continue;
    }
    if (hearingExists(targetCase, hearing)) {
      continue; // вже є, не дублюємо
    }
    const hr = await executeAction(agentId, 'add_hearing', buildAddHearingParams(caseId, hearing));
    if (hr?.success) {
      inc.hearingsAdded++;
    } else {
      inc.errors.push({ case_no: ecitsCase.case_no, message: `add_hearing failed: ${hr?.error || 'unknown'}` });
    }
  }

  return inc;
}

/**
 * Головна функція. Обробляє envelope через executeAction (DI).
 *
 * @param {object} envelope        envelope з Claude for Chrome
 * @param {object} deps
 *   - executeAction(agentId, action, params, [userId])  — async
 *   - agentId?: string                                  — default 'court_sync_agent'
 *   - transport?: 'manual_paste'|'extension'            — default 'manual_paste'
 *   - getCases?: () => Array                            — для дедуплікації; якщо нема — порожній масив
 *   - getTenant?: () => object                          — для history append; може бути null
 *   - appendScenarioHistoryEntry?: (entry) => void      — записує у tenant.ecits_scenario_history
 *   - onProgress?: (msg) => void                        — UI progress callback
 * @returns {Promise<{ casesCreated, casesUpdated, hearingsAdded, skipped, errors, warnings, scenarioRunId }>}
 */
export async function submitScenarioResult(envelope, deps) {
  if (!deps || typeof deps.executeAction !== 'function') {
    throw new Error('submitScenarioResult: deps.executeAction is required');
  }
  validateEnvelope(envelope);

  const {
    executeAction,
    agentId = 'court_sync_agent',
    transport = 'manual_paste',
    getCases = () => [],
    getTenant = () => null,
    appendScenarioHistoryEntry,
    onProgress,
  } = deps;

  const scenarioRunId = `scn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();
  const tenant = getTenant();

  const result = {
    scenarioRunId,
    casesCreated: 0,
    casesUpdated: 0,
    hearingsAdded: 0,
    skipped: 0,
    errors: [],
    warnings: Array.isArray(envelope.data?.warnings) ? [...envelope.data.warnings] : [],
  };

  let status = 'completed';
  try {
    const total = envelope.data.cases.length;
    let idx = 0;
    for (const ecitsCase of envelope.data.cases) {
      idx++;
      if (typeof onProgress === 'function') {
        try { onProgress(`Обробка ${idx}/${total}: ${ecitsCase.case_no || ecitsCase.ecitsCaseId || '?'}`); } catch {}
      }
      try {
        const inc = await processCase(ecitsCase, { executeAction, agentId }, scenarioRunId, getCases);
        result.casesCreated += inc.casesCreated;
        result.casesUpdated += inc.casesUpdated;
        result.hearingsAdded += inc.hearingsAdded;
        result.skipped += inc.skipped;
        if (inc.errors.length) result.errors.push(...inc.errors);
      } catch (e) {
        result.errors.push({ case_no: ecitsCase.case_no, message: e.message });
      }
    }
  } catch (err) {
    status = 'failed';
    result.errors.push({ case_no: null, message: `scenario fatal: ${err.message}` });
  }

  const completedAt = new Date().toISOString();
  const historyEntry = {
    scenarioRunId,
    scenarioId: envelope.scenarioId,
    scenarioVersion: envelope.scenarioVersion,
    transport,
    startedAt,
    completedAt,
    status,
    tenantId: tenant?.tenantId || null,
    userId: null,
    result: {
      casesCreated: result.casesCreated,
      casesUpdated: result.casesUpdated,
      hearingsAdded: result.hearingsAdded,
      skipped: result.skipped,
    },
    errors: result.errors.slice(0, 20), // cap у журналі
  };

  if (typeof appendScenarioHistoryEntry === 'function') {
    try { appendScenarioHistoryEntry(historyEntry); } catch (e) {
      console.warn('[scenarioProcessor] appendScenarioHistoryEntry failed:', e);
    }
  }

  // Silence unused import warning — canOverwrite зарезервовано для майбутньої
  // логіки конфлікту source-priority при оновленні existing case.
  void canOverwrite;

  return result;
}
