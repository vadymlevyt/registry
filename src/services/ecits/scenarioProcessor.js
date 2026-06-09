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
//   1. normalizeEnvelope() — толерантна нормалізація (TASK v12 §11):
//      обгортка `data` якщо її нема, warnings/skipped→рядки, дефолти версій
//   2. validateEnvelope() — строга валідація форми, чіткі повідомлення
//   3. Партиціонування cases на auto / deferred (likelyNotMine===true) (§3)
//   4. Для кожної auto-ecitsCase:
//      a) Пошук існуючої справи за нормалізованим case_no (caseNoKey.js).
//         НЕ за ecitsCaseId (per-proceeding ідентифікатор кабінету не годиться
//         як ключ справи — адвокат, діагностика 2026-05-27).
//      b) Якщо існує → update_case_ecits_state + add_hearing для нових засідань.
//         Жодного перезапису name/client/category — це поля адвоката.
//      c) Якщо нова → create_case з origin='ecits_import', потім add_hearing'и.
//   5. Запис у tenant.ecits_scenario_history (через appendScenarioHistoryEntry deps)
//   6. Повертаємо { casesCreated, casesUpdated, hearingsAdded, skipped, errors,
//                  warnings, pendingReview, scenarioRunId }
//   7. processDeferredCases — окремий експорт: ImportTab опціонально дає
//      адвокату вибрати з pendingReview і прогнати їх тим самим processCase.
//
// Білінг: create_case з origin='ecits_import' автоматично виключається з
// білінгу в actionsRegistry.js (TASK 0.4 hook). add_hearing з source='court_sync'
// теж не нараховується (R5 fix). Тут не потрібна додаткова логіка.

import { canOverwrite } from '../sourcePolicy.js';
import { normalizeCaseNoKey } from './caseNoKey.js';

// ── Контракт-константи (експортуються для тестів і extension-розширення) ────
export const ENVELOPE_VERSION = 1;
export const SCENARIO_ID = 'ecits_import_cases_and_hearings';
export const SCENARIO_VERSION = 1;

/**
 * Канонічний словник процесуальних ролей адвоката (TASK v12 §1).
 * Зберігається у case.advocateRole / case.advocateRoles (top-level).
 * Невідомі значення з envelope не валять імпорт — додаються у warnings.
 */
export const ADVOCATE_ROLE_VALUES = Object.freeze([
  'plaintiff_rep',
  'defendant_rep',
  'third_party_rep',
  'applicant_rep',
  'victim_rep',
  'appellant_rep',
  'interested_party_rep',
  'defender',
  'appellant',
  'advocate',
  'representative_unspecified',
]);

/**
 * Дозволені значення category у envelope (контракт екстрактора, TASK v12 §2).
 * НЕ те саме що case-словник: envelope використовує юридично точну назву
 * `administrative`, яка у case-моделі legacy-зведена до `admin` (один сенс,
 * два імена — правило #11).
 */
export const ENVELOPE_CATEGORY_VALUES = Object.freeze([
  'civil',
  'criminal',
  'administrative',
  'commercial',
  'administrative_offense',
  null,
]);

/**
 * Мапа envelope-категорії → case-категорія. Один сенс на значення.
 *  - `administrative` (адмінсуд) → `admin` (legacy ім'я того самого сенсу).
 *  - `administrative_offense` (адмінправопорушення) → лишається як є (≠ admin).
 *  - невідоме → null (заводимо з warning).
 */
export const ENVELOPE_TO_CASE_CATEGORY = Object.freeze({
  civil: 'civil',
  criminal: 'criminal',
  administrative: 'admin',
  commercial: 'commercial',
  administrative_offense: 'administrative_offense',
});

/**
 * Будує порожній валідний каркас envelope (golden-fixture, тести, дзеркало
 * для Track A розширення).
 */
export function buildEnvelopeSkeleton() {
  return {
    envelopeVersion: ENVELOPE_VERSION,
    scenarioId: SCENARIO_ID,
    scenarioVersion: SCENARIO_VERSION,
    producedAt: null,
    producedBy: { provider: 'claude_for_chrome', providerVersion: null },
    data: {
      ecitsAdvocate: { fullName: null, cabinetIdentifier: null },
      stats: { totalCasesInCabinet: 0, filtered: 0, withHearings2026: 0 },
      cases: [],
      warnings: [],
      skipped: [],
    },
  };
}

// ── normalizeEnvelope ───────────────────────────────────────────────────────
// Толерантна обгортка над "майже правильним" envelope (TASK v12 §11). Кожна
// безпечна коерція пише рядок у `warnings`, щоб адвокат бачив що підправили.
// НЕ валідатор. НЕ кидає винятків (validateEnvelope буде наступним кроком).

function coerceWarningsToStrings(warningsRaw) {
  if (!Array.isArray(warningsRaw)) return [];
  return warningsRaw.map((w) => {
    if (w == null) return '';
    if (typeof w === 'string') return w;
    // Об'єкт-форма {case_no, message} — найпоширеніше джерело React #31.
    if (typeof w === 'object') {
      if (typeof w.message === 'string') {
        return w.case_no ? `${w.case_no}: ${w.message}` : w.message;
      }
      try { return JSON.stringify(w); } catch { return String(w); }
    }
    return String(w);
  });
}

function coerceSkippedItems(skippedRaw) {
  if (!Array.isArray(skippedRaw)) return [];
  return skippedRaw.map((s) => {
    if (s == null) return { case_no: null, reason: '' };
    if (typeof s === 'string') return { case_no: null, reason: s };
    if (typeof s === 'object') {
      return {
        case_no: typeof s.case_no === 'string' ? s.case_no : null,
        reason: typeof s.reason === 'string' ? s.reason : (s.message ? String(s.message) : ''),
      };
    }
    return { case_no: null, reason: String(s) };
  });
}

/**
 * Безпечні коерції форми envelope. Кожна правка → запис у normalizationWarnings.
 *
 * @param {*} raw — потенційно неповний об'єкт envelope.
 * @returns {{ envelope: object, normalizationWarnings: string[] }}
 */
export function normalizeEnvelope(raw) {
  const normalizationWarnings = [];

  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    // Нічого корисного не отримали — повертаємо як є, validateEnvelope кине.
    return { envelope: raw, normalizationWarnings };
  }

  let env = { ...raw };

  // 1. Якщо немає data, але cases — масив на top-level → обгорнути.
  if (!env.data || typeof env.data !== 'object') {
    if (Array.isArray(env.cases)) {
      const { cases, warnings, skipped, ecitsAdvocate, stats, ...rest } = env;
      env = {
        ...rest,
        data: {
          cases,
          warnings: Array.isArray(warnings) ? warnings : [],
          skipped: Array.isArray(skipped) ? skipped : [],
          ...(ecitsAdvocate && typeof ecitsAdvocate === 'object' ? { ecitsAdvocate } : {}),
          ...(stats && typeof stats === 'object' ? { stats } : {}),
        },
      };
      normalizationWarnings.push('envelope без data-обгортки — top-level cases[] обгорнуто у data');
    }
  }

  // 2. Дефолти версій / scenarioId.
  if (env.envelopeVersion == null) {
    env.envelopeVersion = ENVELOPE_VERSION;
    normalizationWarnings.push(`envelopeVersion відсутній — підставлено дефолт ${ENVELOPE_VERSION}`);
  }
  if (env.scenarioId == null || env.scenarioId === '') {
    env.scenarioId = SCENARIO_ID;
    normalizationWarnings.push(`scenarioId відсутній — підставлено дефолт '${SCENARIO_ID}'`);
  }
  if (env.scenarioVersion == null) {
    env.scenarioVersion = SCENARIO_VERSION;
    normalizationWarnings.push(`scenarioVersion відсутній — підставлено дефолт ${SCENARIO_VERSION}`);
  }

  // 3. Гарантувати data + масиви всередині.
  if (!env.data || typeof env.data !== 'object') {
    env.data = { cases: [], warnings: [], skipped: [] };
    normalizationWarnings.push('envelope.data відсутній — підставлено порожню структуру');
  } else {
    env.data = { ...env.data };
    if (!Array.isArray(env.data.cases)) {
      env.data.cases = [];
      normalizationWarnings.push('envelope.data.cases відсутній — підставлено []');
    }
  }

  // 4. warnings → рядки (усуває React error #31).
  const rawWarnings = Array.isArray(env.data.warnings) ? env.data.warnings : [];
  const hadObjectWarnings = rawWarnings.some((w) => w != null && typeof w === 'object');
  env.data.warnings = coerceWarningsToStrings(rawWarnings);
  if (hadObjectWarnings) {
    normalizationWarnings.push('envelope.data.warnings містив об\'єкти — приведено до рядків');
  }

  // 5. skipped → { case_no, reason: string }.
  const rawSkipped = Array.isArray(env.data.skipped) ? env.data.skipped : [];
  const hadNonObjectSkipped = rawSkipped.some(
    (s) => s != null && typeof s !== 'object' && typeof s !== 'string'
  );
  env.data.skipped = coerceSkippedItems(rawSkipped);
  if (hadNonObjectSkipped) {
    normalizationWarnings.push('envelope.data.skipped містив нестандартні елементи — нормалізовано');
  }

  return { envelope: env, normalizationWarnings };
}

/**
 * Формальна валідація envelope. Кидає Error з підказкою при критичній
 * невідповідності, повертає void при OK. Викликається ПІСЛЯ normalizeEnvelope —
 * тут вже не потрібно догадуватись про форму.
 *
 * @param {object} envelope
 */
export function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error(
      "envelope має бути об'єктом виду { envelopeVersion, scenarioId, data: { cases } }"
    );
  }
  if (envelope.envelopeVersion !== ENVELOPE_VERSION) {
    throw new Error(
      `envelopeVersion=${envelope.envelopeVersion} не підтримується (очікується ${ENVELOPE_VERSION})`
    );
  }
  if (envelope.scenarioId !== SCENARIO_ID) {
    throw new Error(
      `scenarioId='${envelope.scenarioId}' не підтримується (очікується '${SCENARIO_ID}')`
    );
  }
  if (!envelope.data || typeof envelope.data !== 'object') {
    throw new Error(
      "envelope.data відсутній — очікується { envelopeVersion, scenarioId, data: { cases } }"
    );
  }
  if (!Array.isArray(envelope.data.cases)) {
    throw new Error('envelope.data.cases має бути масивом');
  }
}

// ── Нормалізатори per-case полів (експортуються для тестів) ─────────────────

/**
 * Витягає advocateRoles[] і головну advocateRole з ecitsCase (TASK v12 §1).
 * Невідомі значення лишаються як є (не валять імпорт), а вирівнювання
 * проти ADVOCATE_ROLE_VALUES повертає список unknownRoles для warnings.
 */
export function resolveAdvocateRoles(ecitsCase) {
  const incomingArr = Array.isArray(ecitsCase?.advocateRoles)
    ? ecitsCase.advocateRoles.filter((v) => typeof v === 'string' && v.length > 0)
    : [];
  const incomingSingle = typeof ecitsCase?.advocateRole === 'string' && ecitsCase.advocateRole.length > 0
    ? ecitsCase.advocateRole
    : null;

  const advocateRoles = incomingArr.length
    ? incomingArr
    : (incomingSingle ? [incomingSingle] : []);
  const advocateRole = advocateRoles[0] ?? incomingSingle ?? null;

  const unknownRoles = advocateRoles.filter((r) => !ADVOCATE_ROLE_VALUES.includes(r));
  return { advocateRole, advocateRoles, unknownRoles };
}

/**
 * Мапить envelope-category → case-category (TASK v12 §2).
 *  - відомі: за ENVELOPE_TO_CASE_CATEGORY.
 *  - null / undefined / порожній рядок → null без warning (легітимний стан).
 *  - інше (невідоме непорожнє) → null + warning з case_no.
 */
export function resolveCaseCategory(ecitsCase) {
  const raw = ecitsCase?.category;
  if (raw == null || raw === '') return { category: null, warning: null };
  if (typeof raw !== 'string') {
    return {
      category: null,
      warning: `${ecitsCase?.case_no || '?'}: невідома category '${String(raw)}' — записано null`,
    };
  }
  if (Object.prototype.hasOwnProperty.call(ENVELOPE_TO_CASE_CATEGORY, raw)) {
    return { category: ENVELOPE_TO_CASE_CATEGORY[raw], warning: null };
  }
  return {
    category: null,
    warning: `${ecitsCase?.case_no || '?'}: невідома category '${raw}' — записано null`,
  };
}

/**
 * Будує object для виклику create_case з ecits-кейса.
 * Внутрішня — експортується для тестів. Повертає `{ params, warnings }`,
 * бо мапи можуть породити попередження (невідома роль/категорія).
 */
export function buildCreateCaseParams(ecitsCase) {
  const nowIso = new Date().toISOString();
  const warnings = [];

  const { advocateRole, advocateRoles, unknownRoles } = resolveAdvocateRoles(ecitsCase);
  if (unknownRoles.length) {
    warnings.push(
      `${ecitsCase?.case_no || '?'}: невідомі ролі '${unknownRoles.join(", ")}' — записано як є`
    );
  }

  const { category, warning: categoryWarning } = resolveCaseCategory(ecitsCase);
  if (categoryWarning) warnings.push(categoryWarning);

  // ecitsState — контейнер sync-метаданих і провенансу. `caseId` (32-hex
  // per-proceeding) НЕ зберігаємо: він не годиться як ключ справи, і
  // зчитувачів не має (правило #11 — не вводити поле без сенсу). Envelope-
  // поле ecitsCase.ecitsCaseId приймається-але-ігнорується.
  const ecitsState = {
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
    // TASK v12 §4: top-level з envelope → ecitsState (провенанс)
    firstDocumentDate: ecitsCase.firstDocumentDate ?? null,
    lastDocumentDate: ecitsCase.lastDocumentDate ?? null,
    _lastSource: 'court_sync',
  };

  // primaryParty — для денормалізованого client field (UI legacy). Backfill
  // структурованих parties[] — у tracking_debt і наступному TASK.
  const params = {
    name: ecitsCase.primaryParty
      ? `[ЄСІТС] ${ecitsCase.primaryParty} (${ecitsCase.case_no})`
      : `[ЄСІТС] ${ecitsCase.case_no}`,
    client: ecitsCase.primaryParty || null,
    case_no: ecitsCase.case_no || null,
    court: ecitsCase.court || null,
    category,
    status: 'active',
    origin: 'ecits_import',
    advocateRole,
    advocateRoles,
    ecitsState,
  };
  return { params, warnings };
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
 * Спільна точка для авто-обробки і processDeferredCases (DRY, правило #11).
 *
 * deps: { executeAction, agentId, getCases }
 */
async function processCase(ecitsCase, deps) {
  const { executeAction, agentId, getCases } = deps;
  const inc = {
    casesCreated: 0,
    casesUpdated: 0,
    hearingsAdded: 0,
    skipped: 0,
    errors: [],
    warnings: [],
  };

  // Зміна B: гейт посилається на case_no (ключ дедупу), а не на ecitsCaseId.
  // Екстрактор не завжди має ecitsCaseId зі списку кабінету — це штатна
  // ситуація, не помилка; skipping за відсутністю ecitsCaseId блокував
  // реальний імпорт (звіт R 2026-06-09: 50 справ → 0 створено).
  const incomingKey = normalizeCaseNoKey(ecitsCase?.case_no);
  if (!incomingKey) {
    inc.skipped++;
    inc.errors.push({ case_no: ecitsCase?.case_no, message: 'missing case_no' });
    return inc;
  }

  // 1. Пошук існуючої справи за нормалізованим case_no (Зміна A).
  // Якщо знайдена — лише оновлюємо ecitsState (sync-метадані), name/client/
  // category НЕ перезаписуємо: це поля адвоката.
  const existing = getCases().find(
    (c) => normalizeCaseNoKey(c?.case_no) === incomingKey,
  );

  let caseId;
  if (existing) {
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
      inc.errors.push({
        case_no: ecitsCase.case_no,
        message: `update_case_ecits_state failed: ${patchResult?.error || 'unknown'}`,
      });
    }
  } else {
    // Create new — через спільний buildCreateCaseParams (ролі, категорія, дати)
    const { params: createParams, warnings: buildWarnings } = buildCreateCaseParams(ecitsCase);
    if (buildWarnings.length) inc.warnings.push(...buildWarnings);
    const createResult = await executeAction(agentId, 'create_case', createParams);
    if (createResult?.success) {
      caseId = createResult.caseId;
      inc.casesCreated++;
    } else if (createResult?.error === 'duplicate_case_no' && createResult.existingCaseId) {
      // Гонка: справа з тим самим case_no з'явилась між нашим пошуком і
      // create_case. Прив'язуємось до неї і освіжаємо ecitsState.
      caseId = createResult.existingCaseId;
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
        inc.errors.push({
          case_no: ecitsCase.case_no,
          message: `update_case_ecits_state failed: ${patchResult?.error || 'unknown'}`,
        });
      }
    } else {
      inc.skipped++;
      inc.errors.push({
        case_no: ecitsCase.case_no,
        message: `create_case failed: ${createResult?.error || 'unknown'}`,
      });
      return inc;
    }
  }

  // 2. Додати засідання що ще не існують
  const targetCase = getCases().find((c) => c.id === caseId);
  const hearings = Array.isArray(ecitsCase.hearings) ? ecitsCase.hearings : [];
  for (const hearing of hearings) {
    if (!hearing.date || !hearing.time) {
      inc.errors.push({
        case_no: ecitsCase.case_no,
        message: `hearing skipped: missing date/time`,
      });
      continue;
    }
    if (hearingExists(targetCase, hearing)) {
      continue; // вже є, не дублюємо
    }
    const hr = await executeAction(
      agentId,
      'add_hearing',
      buildAddHearingParams(caseId, hearing),
    );
    if (hr?.success) {
      inc.hearingsAdded++;
    } else {
      inc.errors.push({
        case_no: ecitsCase.case_no,
        message: `add_hearing failed: ${hr?.error || 'unknown'}`,
      });
    }
  }

  return inc;
}

/**
 * Спільна петля: бере масив ecitsCase, ганяє processCase, агрегує у result.
 * Викликається з submitScenarioResult і processDeferredCases (DRY).
 */
async function runCases(ecitsCases, deps, result, onProgress, labelOffset = 0) {
  const total = ecitsCases.length;
  let idx = 0;
  for (const ecitsCase of ecitsCases) {
    idx++;
    if (typeof onProgress === 'function') {
      try {
        onProgress(`Обробка ${labelOffset + idx}/${labelOffset + total}: ${ecitsCase.case_no || ecitsCase.ecitsCaseId || '?'}`);
      } catch { /* ignore */ }
    }
    try {
      const inc = await processCase(ecitsCase, deps);
      result.casesCreated += inc.casesCreated;
      result.casesUpdated += inc.casesUpdated;
      result.hearingsAdded += inc.hearingsAdded;
      result.skipped += inc.skipped;
      if (inc.errors.length) result.errors.push(...inc.errors);
      if (inc.warnings.length) result.warnings.push(...inc.warnings);
    } catch (e) {
      result.errors.push({ case_no: ecitsCase?.case_no, message: e.message });
    }
  }
}

/**
 * Головна функція. Обробляє envelope через executeAction (DI).
 *
 * Партиціонує `data.cases` на:
 *   - auto = `likelyNotMine !== true` → обробляються звичайним шляхом
 *   - deferred = `likelyNotMine === true` → НЕ обробляються, повертаються
 *     повними об'єктами у `result.pendingReview` (опт-ін пікер у ImportTab).
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
 * @returns {Promise<{
 *   scenarioRunId, casesCreated, casesUpdated, hearingsAdded, skipped,
 *   errors, warnings, pendingReview
 * }>}
 */
export async function submitScenarioResult(envelope, deps) {
  if (!deps || typeof deps.executeAction !== 'function') {
    throw new Error('submitScenarioResult: deps.executeAction is required');
  }

  // TASK v12 §11 — толерантна нормалізація ПЕРЕД строгою валідацією.
  const { envelope: normalized, normalizationWarnings } = normalizeEnvelope(envelope);
  validateEnvelope(normalized);

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

  // Warnings: спочатку наші нормалізаційні, потім ті що були в envelope.
  const envelopeWarnings = Array.isArray(normalized.data?.warnings)
    ? normalized.data.warnings
    : [];

  const result = {
    scenarioRunId,
    casesCreated: 0,
    casesUpdated: 0,
    hearingsAdded: 0,
    skipped: 0,
    errors: [],
    warnings: [...normalizationWarnings, ...envelopeWarnings],
    pendingReview: [],
  };

  // TASK v12 §3 — партиціонування likelyNotMine.
  const auto = [];
  for (const ecitsCase of normalized.data.cases) {
    if (ecitsCase && ecitsCase.likelyNotMine === true) {
      result.pendingReview.push(ecitsCase);
    } else {
      auto.push(ecitsCase);
    }
  }

  let status = 'completed';
  try {
    await runCases(auto, { executeAction, agentId, getCases }, result, onProgress);
  } catch (err) {
    status = 'failed';
    result.errors.push({ case_no: null, message: `scenario fatal: ${err.message}` });
  }

  const completedAt = new Date().toISOString();
  const historyEntry = {
    scenarioRunId,
    scenarioId: normalized.scenarioId,
    scenarioVersion: normalized.scenarioVersion,
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
      pendingReviewCount: result.pendingReview.length,
    },
    errors: result.errors.slice(0, 20), // cap у журналі
  };

  if (typeof appendScenarioHistoryEntry === 'function') {
    try {
      appendScenarioHistoryEntry(historyEntry);
    } catch (e) {
      console.warn('[scenarioProcessor] appendScenarioHistoryEntry failed:', e);
    }
  }

  // Silence unused import warning — canOverwrite зарезервовано для майбутньої
  // логіки конфлікту source-priority при оновленні existing case.
  void canOverwrite;

  return result;
}

/**
 * Обробка справ, обраних адвокатом у пікері «Можливо не ваші» (TASK v12 §3).
 * Та сама `processCase`-петля, нуль повторного скрейпінгу — використовуємо
 * метадані, що вже прийшли в первинному envelope.
 *
 * @param {Array<object>} ecitsCases  обрані deferred-кейси (повна форма з envelope)
 * @param {object} deps               як у submitScenarioResult
 *   - executeAction, agentId?, getCases?, onProgress?
 * @returns {Promise<{ casesCreated, casesUpdated, hearingsAdded, skipped, errors, warnings }>}
 */
export async function processDeferredCases(ecitsCases, deps) {
  if (!deps || typeof deps.executeAction !== 'function') {
    throw new Error('processDeferredCases: deps.executeAction is required');
  }
  const {
    executeAction,
    agentId = 'court_sync_agent',
    getCases = () => [],
    onProgress,
  } = deps;

  const result = {
    casesCreated: 0,
    casesUpdated: 0,
    hearingsAdded: 0,
    skipped: 0,
    errors: [],
    warnings: [],
  };

  if (!Array.isArray(ecitsCases) || ecitsCases.length === 0) {
    return result;
  }

  await runCases(ecitsCases, { executeAction, agentId, getCases }, result, onProgress);
  return result;
}
