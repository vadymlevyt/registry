// ── MIGRATION SERVICE ────────────────────────────────────────────────────────
// Міграція registry_data.json між версіями схеми.
//
// schemaVersion 1 (неявна) — Drive містить голий масив cases[].
// schemaVersion 2 — об'єкт { schemaVersion, tenants, users, auditLog,
//                            structuralUnits, cases, settingsVersion }.
// schemaVersion 3 — додано ai_usage[], caseAccess[],
//                   tenant.storage, tenant.modelPreferences, tenant.subscription.{limits,current,alerts},
//                   case.team[i].permissions з дефолтами по ролі.
//                   Всі case.id — string ('case_<original_id>'),
//                   документи всередині справ — string без префікса.
// schemaVersion 4 — додано time_entries[] (місячна ротація на верхньому рівні),
//                   master_timer_state{} (стан таймера між сесіями),
//                   billing_meta{} (службові метадані ротації),
//                   tenant.settings.timeStandards (стандарти часу за судами/категоріями).
//                   case.timeLog[] лишається deprecated порожнім (legacy).
// schemaVersion 5 — canonical document schema (18 легких + 6 важких полів).
//                   Окремий ланцюг — migrations/v4ToV5.js, оркеструється в App.jsx.
// schemaVersion 6 — users[].isFounder (глобальна позначка власника продукту).
//                   Окремий крок — migrateToVersion6 нижче, оркеструється в App.jsx
//                   після migrateRegistryV4toV5.
// schemaVersion 6.5 — addedBy semantic cleanup (TASK 0.3.4).
//                   Розщеплення document.addedBy і document.source як двох незалежних
//                   полів (правило #11). Old enum lawyer_via_dp/lawyer_manual/agent/
//                   ecits/migration → new enum user/agent/system. Точкова чистка
//                   перед TASK 0.3.5 (canonical schema bump v7 для ЄСІТС).
//                   Number 6.5 (а не 7) — точкова чистка не претендує на повний bump.
//                   Окремий крок — migrateToVersion6_5 нижче.
// schemaVersion 7   — canonical schema для ЄСІТС-інтеграції (TASK 0.3.5).
//                   Розширення document.source enum (manual_upload→manual,
//                   ecits→court_sync, додано metadata_extractor/unknown).
//                   Нові поля документа: sourceConfidence, extractedAt,
//                   ecitsSource, movementCard, alternativeSources.
//                   Нові поля справи: ecitsState (з syncMetrics), parties[],
//                   processParticipants[]. proceeding.composition.
//                   Нові поля hearing: source, sourceConfidence, extractedAt,
//                   ecitsContext, assignedTo, attendedBy.
//                   user.ecitsCabinetIdentifier для multi-user dedupe.
//                   Окремий крок — migrateToVersion7 нижче.
// schemaVersion 8   — time_entry.source → time_entry.captureMethod (TASK 2).
//                   Перейменування ПОЛЯ (не значень): "source" у системі тепер
//                   завжди означає "канал походження"; спосіб фіксації часу —
//                   окреме ім'я captureMethod (правило #11). Архіви не чіпає
//                   (lazy-on-load нормалізація у timeEntriesArchiver).
//                   Окремий крок — migrateToVersion8 нижче.
// schemaVersion 9   — case.origin enum (TASK 0.4 Court Sync MVP).
//                   ЄДИНИЙ сенс поля: канал створення справи в Legal BMS.
//                   enum: 'manual' (адвокат вручну через UI/QI/агента) |
//                   'ecits_import' (автоімпорт з ЄСІТС через Court Sync) |
//                   'telegram_import' | 'email_import' (майбутні канали).
//                   Default 'manual'. Існуючі справи отримують 'manual' —
//                   до bump'а всі справи створювались вручну.
//                   case.origin — аналог document.source на рівні справи.
//                   НЕ плутати з case.team[].addedBy (хто додав у команду) —
//                   різний сенс (правило #11).
//                   Окремий крок — migrateToVersion9 нижче.
//
// migrateRegistry піднімає до BASE_CHAIN_VERSION=4. Подальші кроки — окремі
// функції/файли. Експорт CURRENT_SCHEMA_VERSION/MIGRATION_VERSION відображає
// найвищу досяжну версію після повного ланцюга.
//
// caseAccess[] — поки порожня заглушка для майбутнього SaaS-масштабу.
//   Очікувана схема запису (активується в TASK Multi-user Activation):
//     {
//       caseId: 'case_4',
//       userId: 'vadym',
//       tenantId: 'ab_levytskyi',
//       caseRole: 'lead',
//       addedAt: '2024-03-01T00:00:00Z',
//       expiresAt: null,
//       permissionsHash: '<sha256 of team.permissions>'
//     }

import { DEFAULT_TENANT, DEFAULT_USER } from './tenantService.js';
import { DEFAULT_TENANT_TIME_STANDARDS } from './timeStandards.js';
import { MODULES } from './moduleNames.js';
import { ensureEntitlements } from './entitlementsService.js';

// Найвища досяжна версія після повного ланцюга міграцій (migrateRegistry →
// migrateRegistryV4toV5 → migrateToVersion6 → migrateToVersion6_5 →
// migrateToVersion7 → migrateToVersion8). Використовується App.jsx для запису
// нової версії registry і тестами як "це остаточний таргет системи".
export const CURRENT_SCHEMA_VERSION = 9;
export const MIGRATION_VERSION = '9.0_case_origin';

// Таргет, який встановлює саме migrateRegistry (базовий ланцюг v1→v4).
// Документи з v4 на v5 переводяться окремим файлом migrations/v4ToV5.js,
// founder flag з v5 на v6 — функцією migrateToVersion6 нижче.
export const BASE_CHAIN_VERSION = 4;
export const BASE_CHAIN_LABEL = '4.0_billing_foundation';

// Дефолти permissions за caseRole. canRunAI важливий для майбутніх тарифних обмежень.
const ROLE_PERMISSION_DEFAULTS = {
  owner:    { canEdit: true,  canDelete: true,  canShare: true,  canAddTeam: true,  canViewBilling: true,  canEditBilling: true,  canRunAI: true },
  lead:     { canEdit: true,  canDelete: true,  canShare: true,  canAddTeam: true,  canViewBilling: false, canEditBilling: false, canRunAI: true },
  'co-lead':{ canEdit: true,  canDelete: false, canShare: true,  canAddTeam: false, canViewBilling: false, canEditBilling: false, canRunAI: true },
  support:  { canEdit: true,  canDelete: false, canShare: false, canAddTeam: false, canViewBilling: false, canEditBilling: false, canRunAI: true },
  external: { canEdit: false, canDelete: false, canShare: false, canAddTeam: false, canViewBilling: true,  canEditBilling: false, canRunAI: false },
};

function ensureTeamPermissions(member) {
  if (!member || typeof member !== 'object') return member;
  if (member.permissions && typeof member.permissions === 'object') {
    // Доповнити відсутні поля з дефолтів ролі (на випадок розширення схеми).
    const defaults = ROLE_PERMISSION_DEFAULTS[member.caseRole] || ROLE_PERMISSION_DEFAULTS.support;
    return { ...member, permissions: { ...defaults, ...member.permissions } };
  }
  const role = member.caseRole || 'support';
  return { ...member, permissions: { ...(ROLE_PERMISSION_DEFAULTS[role] || ROLE_PERMISSION_DEFAULTS.support) } };
}

function normalizeCaseId(c) {
  if (!c || typeof c !== 'object') return c;
  if (c.id == null) return c;
  if (typeof c.id === 'number') {
    return { ...c, id: `case_${c.id}` };
  }
  return c;
}

function normalizeDocumentIds(c) {
  if (!c || !Array.isArray(c.documents)) return c;
  return {
    ...c,
    documents: c.documents.map(d => {
      if (!d || typeof d !== 'object') return d;
      if (typeof d.id === 'number') return { ...d, id: String(d.id) };
      return d;
    }),
  };
}

function migrateCase(c) {
  if (!c || typeof c !== 'object') return null;
  let out = { ...c };

  // 0. id: number → 'case_<n>', documents id: number → string
  out = normalizeCaseId(out);
  out = normalizeDocumentIds(out);

  // 1. SaaS поля v2
  if (!out.tenantId) out.tenantId = DEFAULT_TENANT.tenantId;
  if (!out.ownerId) out.ownerId = DEFAULT_USER.userId;
  if (!Array.isArray(out.team) || out.team.length === 0) {
    out.team = [{
      userId: DEFAULT_USER.userId,
      caseRole: 'lead',
      addedAt: out.createdAt || new Date().toISOString(),
      addedBy: DEFAULT_USER.userId,
    }];
  }
  if (!out.shareType) out.shareType = 'internal';
  if (!Array.isArray(out.externalAccess)) out.externalAccess = [];

  // 2. team[i].permissions — дефолти по ролі (v3)
  out.team = out.team.map(ensureTeamPermissions);

  // 3. Вкладені сутності — лише createdBy. tenantId успадковується від справи.
  if (Array.isArray(out.hearings)) {
    out.hearings = out.hearings.map(h =>
      h && typeof h === 'object' && !h.createdBy
        ? { ...h, createdBy: DEFAULT_USER.userId }
        : h
    );
  }
  if (Array.isArray(out.deadlines)) {
    out.deadlines = out.deadlines.map(d =>
      d && typeof d === 'object' && !d.createdBy
        ? { ...d, createdBy: DEFAULT_USER.userId }
        : d
    );
  }
  if (Array.isArray(out.notes)) {
    out.notes = out.notes.map(n =>
      n && typeof n === 'object' && !n.createdBy
        ? { ...n, createdBy: DEFAULT_USER.userId }
        : n
    );
  }
  if (Array.isArray(out.timeLog)) {
    out.timeLog = out.timeLog.map(t =>
      t && typeof t === 'object' && !t.createdBy
        ? { ...t, createdBy: t.userId || DEFAULT_USER.userId }
        : t
    );
  }
  return out;
}

function migrateTenant(t) {
  if (!t || typeof t !== 'object') return DEFAULT_TENANT;
  const settings = (t.settings && typeof t.settings === 'object') ? t.settings : {};
  return {
    ...t,
    storage: t.storage || {
      provider: 'drive_legacy',
      quotaGB: null,
      usedBytes: null,
    },
    modelPreferences: t.modelPreferences || { ...DEFAULT_TENANT.modelPreferences },
    // TASK 0.4 — entitlements нормалізується через окремий сервіс. Існуючі
    // tenants без entitlements отримують дефолти self_hosted (повний доступ).
    subscription: ensureEntitlements({
      ...(t.subscription || {}),
      plan: t.subscription?.plan || DEFAULT_TENANT.subscription.plan,
      status: t.subscription?.status || DEFAULT_TENANT.subscription.status,
      limits: t.subscription?.limits || { ...DEFAULT_TENANT.subscription.limits },
      current: t.subscription?.current || { ...DEFAULT_TENANT.subscription.current },
      alerts: t.subscription?.alerts || { ...DEFAULT_TENANT.subscription.alerts },
    }),
    // TASK 0.4 — журнал виконань сценаріїв ЄСІТС. Розширення без schema bump.
    ecits_scenario_history: Array.isArray(t.ecits_scenario_history) ? t.ecits_scenario_history : [],
    settings: {
      ...settings,
      // v4: timeStandards — ієрархія user→tenant→system. Тут — tenant дефолти.
      timeStandards: settings.timeStandards || { ...DEFAULT_TENANT_TIME_STANDARDS },
      // TASK 0.2: моduleIntegration — налаштування інтеграцій з зовнішніми
      // системами. Додавання nullable полів з дефолтами, без schema bump.
      moduleIntegration: ensureModuleIntegration(settings.moduleIntegration),
    },
  };
}

// Дефолти налаштувань модуля «Електронний суд». Дублюються в ecitsService.js
// (DEFAULT_ECITS_SETTINGS) — це навмисно: tenant-секція є шейпом структури,
// сервісний дефолт — fallback коли структура порожня. Якщо одне зміниться —
// синхронізувати вручну.
const DEFAULT_ECITS_SETTINGS_FOR_TENANT = {
  autoSync: false,
  syncIntervalMinutes: null,
  casesToSync: 'all',
  autoProcessIncoming: false,
  detectDeadlinesOnReceive: false,
  executionProvider: 'claudeForChrome',
};

function ensureModuleIntegration(existing) {
  const base = (existing && typeof existing === 'object') ? existing : {};
  return {
    ...base,
    ecits: { ...DEFAULT_ECITS_SETTINGS_FOR_TENANT, ...(base.ecits || {}) },
  };
}

// Повертає settingsVersion-label який відповідає переданій version. Для рідкісного
// випадку коли registry на Drive має schemaVersion але втратив settingsVersion.
function labelForVersion(version) {
  if (version >= 9) return '9.0_case_origin';
  if (version >= 8) return '8.0_time_entry_capture_method';
  if (version >= 7) return '7.0_ecits_canonical';
  if (version >= 6.5) return '6.5_addedby_cleanup';
  if (version >= 6) return '6.0_founder_flag';
  if (version >= 5) return '5.0_canonical_documents';
  return '4.0_billing_foundation';
}

function buildEmptyMasterTimerState() {
  return {
    isActive: false,
    isPaused: false,
    state: 'stopped',
    startedAt: null,
    pausedAt: null,
    totalSecondsToday: 0,
    lastActivityAt: null,
    activeCaseId: null,
    activeCategory: null,
    lastIdleCheck: null,
  };
}

function buildEmptyBillingMeta() {
  return {
    currentMonthStart: new Date(Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      1, 0, 0, 0
    )).toISOString(),
    lastArchiveCreated: null,
    totalEntriesAllTime: 0,
    currentMonthEntries: 0,
    archiveFiles: [],
  };
}

export function buildEmptyRegistry() {
  // Порожній реєстр одразу будується на найвищій версії повного ланцюга —
  // нові установки не потребують міграції.
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settingsVersion: MIGRATION_VERSION,
    tenants: [migrateTenant(DEFAULT_TENANT)],
    users: [DEFAULT_USER],
    auditLog: [],
    structuralUnits: [],
    ai_usage: [],
    caseAccess: [],
    cases: [],
    // v4 Billing Foundation
    time_entries: [],
    master_timer_state: buildEmptyMasterTimerState(),
    billing_meta: buildEmptyBillingMeta(),
  };
}

// Приймає raw payload з Drive (масив АБО об'єкт) або null,
// повертає { registry, didMigrate, fromVersion, toVersion, originalRaw }.
export function migrateRegistry(raw) {
  // Випадок 1: на Drive нічого нема
  if (raw == null) {
    return {
      registry: buildEmptyRegistry(),
      didMigrate: false,
      fromVersion: null,
      toVersion: CURRENT_SCHEMA_VERSION,
      originalRaw: null,
    };
  }

  // Випадок 2: вже об'єкт з schemaVersion >= BASE_CHAIN_VERSION — ідемпотентно
  // (підтягуємо нові поля, але не торкаємось schemaVersion: подальші ланцюги
  // v4→v5 і v5→v6 розберуться самі).
  if (!Array.isArray(raw) && typeof raw === 'object' && (raw.schemaVersion || 0) >= BASE_CHAIN_VERSION) {
    const safe = {
      schemaVersion: raw.schemaVersion,
      settingsVersion: raw.settingsVersion || labelForVersion(raw.schemaVersion),
      tenants: Array.isArray(raw.tenants) && raw.tenants.length > 0
        ? raw.tenants.map(migrateTenant) : [migrateTenant(DEFAULT_TENANT)],
      users: Array.isArray(raw.users) && raw.users.length > 0 ? raw.users : [DEFAULT_USER],
      auditLog: Array.isArray(raw.auditLog) ? raw.auditLog : [],
      structuralUnits: Array.isArray(raw.structuralUnits) ? raw.structuralUnits : [],
      ai_usage: Array.isArray(raw.ai_usage) ? raw.ai_usage : [],
      caseAccess: Array.isArray(raw.caseAccess) ? raw.caseAccess : [],
      cases: Array.isArray(raw.cases) ? raw.cases.map(migrateCase).filter(Boolean) : [],
      time_entries: Array.isArray(raw.time_entries) ? raw.time_entries : [],
      master_timer_state: (raw.master_timer_state && typeof raw.master_timer_state === 'object')
        ? { ...buildEmptyMasterTimerState(), ...raw.master_timer_state }
        : buildEmptyMasterTimerState(),
      billing_meta: (raw.billing_meta && typeof raw.billing_meta === 'object')
        ? { ...buildEmptyBillingMeta(), ...raw.billing_meta }
        : buildEmptyBillingMeta(),
    };
    return {
      registry: safe,
      didMigrate: false,
      fromVersion: raw.schemaVersion,
      toVersion: raw.schemaVersion,
      originalRaw: raw,
    };
  }

  // Випадок 3: голий масив cases[] (schemaVersion 1) — піднімаємо лише до базового v4
  if (Array.isArray(raw)) {
    const cases = raw.map(migrateCase).filter(Boolean);
    return {
      registry: {
        schemaVersion: BASE_CHAIN_VERSION,
        settingsVersion: BASE_CHAIN_LABEL,
        tenants: [migrateTenant(DEFAULT_TENANT)],
        users: [DEFAULT_USER],
        auditLog: [],
        structuralUnits: [],
        ai_usage: [],
        caseAccess: [],
        cases,
        time_entries: [],
        master_timer_state: buildEmptyMasterTimerState(),
        billing_meta: buildEmptyBillingMeta(),
      },
      didMigrate: true,
      fromVersion: 1,
      toVersion: BASE_CHAIN_VERSION,
      originalRaw: raw,
    };
  }

  // Випадок 4: об'єкт з schemaVersion < BASE_CHAIN_VERSION (2 або 3) — мігруємо до v4
  const cases = Array.isArray(raw?.cases) ? raw.cases.map(migrateCase).filter(Boolean) : [];
  const tenants = Array.isArray(raw?.tenants) && raw.tenants.length > 0
    ? raw.tenants.map(migrateTenant) : [migrateTenant(DEFAULT_TENANT)];
  return {
    registry: {
      schemaVersion: BASE_CHAIN_VERSION,
      settingsVersion: BASE_CHAIN_LABEL,
      tenants,
      users: Array.isArray(raw?.users) && raw.users.length > 0 ? raw.users : [DEFAULT_USER],
      auditLog: Array.isArray(raw?.auditLog) ? raw.auditLog : [],
      structuralUnits: Array.isArray(raw?.structuralUnits) ? raw.structuralUnits : [],
      ai_usage: Array.isArray(raw?.ai_usage) ? raw.ai_usage : [],
      caseAccess: Array.isArray(raw?.caseAccess) ? raw.caseAccess : [],
      cases,
      time_entries: Array.isArray(raw?.time_entries) ? raw.time_entries : [],
      master_timer_state: (raw?.master_timer_state && typeof raw.master_timer_state === 'object')
        ? { ...buildEmptyMasterTimerState(), ...raw.master_timer_state }
        : buildEmptyMasterTimerState(),
      billing_meta: (raw?.billing_meta && typeof raw.billing_meta === 'object')
        ? { ...buildEmptyBillingMeta(), ...raw.billing_meta }
        : buildEmptyBillingMeta(),
    },
    didMigrate: true,
    fromVersion: raw?.schemaVersion || 1,
    toVersion: BASE_CHAIN_VERSION,
    originalRaw: raw,
  };
}

// ── v5 → v6: founder flag ────────────────────────────────────────────────────
// Проставляє users[].isFounder (true тільки для userId='vadym', false для інших).
// Ідемпотентна: повторний запуск з v6 повертає didMigrate=false і нічого не змінює.
// Викликається з App.jsx EFFECT-A послідовно після migrateRegistryV4toV5.
const FOUNDER_USER_ID = 'vadym';

export function migrateToVersion6(registry) {
  const fromVersion = registry?.schemaVersion || 1;

  if (fromVersion >= 6) {
    return {
      registry,
      didMigrate: false,
      fromVersion,
      toVersion: fromVersion,
    };
  }

  const usersIn = Array.isArray(registry?.users) && registry.users.length > 0
    ? registry.users
    : [DEFAULT_USER];

  const usersOut = usersIn.map(u => {
    if (!u || typeof u !== 'object') return u;
    if (typeof u.isFounder === 'boolean') return u; // вже мігровано — не торкаємось
    return { ...u, isFounder: u.userId === FOUNDER_USER_ID };
  });

  return {
    registry: {
      ...registry,
      schemaVersion: 6,
      // v6 крок ставить v6-label, не таргет повного ланцюга. Подальший крок
      // migrateToVersion6_5 перепише settingsVersion на '6.5_addedby_cleanup'.
      // (До TASK 0.3.4 цей крок ставив MIGRATION_VERSION константу — тоді вона
      // дорівнювала '6.0_founder_flag'. Після bump до 6.5 константа описує
      // ВЕСЬ ланцюг, тому тут — явне значення для свого рівня.)
      settingsVersion: '6.0_founder_flag',
      users: usersOut,
      lastMigration: {
        from: fromVersion,
        to: 6,
        at: new Date().toISOString(),
      },
    },
    didMigrate: true,
    fromVersion,
    toVersion: 6,
  };
}

// ── v6 → v6.5: addedBy semantic cleanup (TASK 0.3.4) ────────────────────────
// Розщеплення document.addedBy і document.source як двох незалежних полів
// (правило #11). Old enum lawyer_via_dp/lawyer_manual/agent/ecits/migration →
// new enum user/agent/system. Точкова чистка перед TASK 0.3.5 (v7 для ЄСІТС).
//
// Ідемпотентна: повторний запуск з v6.5+ повертає didMigrate=false і нічого
// не змінює. Викликається з App.jsx EFFECT-A послідовно після migrateToVersion6.
//
// Невідомі значення addedBy → fallback 'user' з warning. Це safety net,
// у нормальній міграції всі legacy values покриті ADDEDBY_LEGACY_MAP.
const ADDEDBY_LEGACY_MAP = {
  lawyer_via_dp: 'user',
  lawyer_manual: 'user',
  agent: 'agent',
  ecits: 'system',
  migration: 'system',
  user: 'user',     // ідемпотентність: вже мігроване не чіпаємо
  system: 'system',
};

function migrateAddedByValue(oldValue, stats) {
  if (oldValue === undefined || oldValue === null) {
    stats.nullToUser++;
    return 'user';
  }
  const mapped = ADDEDBY_LEGACY_MAP[oldValue];
  if (mapped) {
    if (oldValue !== mapped) stats[oldValue] = (stats[oldValue] || 0) + 1;
    else stats[`${oldValue}_unchanged`] = (stats[`${oldValue}_unchanged`] || 0) + 1;
    return mapped;
  }
  // eslint-disable-next-line no-console
  console.warn(`[TASK 0.3.4] Unknown addedBy value '${oldValue}', defaulting to 'user'`);
  stats.unknownToUser++;
  return 'user';
}

export function migrateToVersion6_5(registry) {
  const fromVersion = registry?.schemaVersion || 1;

  if (fromVersion >= 6.5) {
    return {
      registry,
      didMigrate: false,
      fromVersion,
      toVersion: fromVersion,
      stats: null,
    };
  }

  const stats = {
    lawyer_via_dp: 0,
    lawyer_manual: 0,
    agent_unchanged: 0,
    ecits: 0,
    migration: 0,
    user_unchanged: 0,
    system_unchanged: 0,
    nullToUser: 0,
    unknownToUser: 0,
    totalDocs: 0,
  };

  const cases = Array.isArray(registry?.cases) ? registry.cases : [];
  const migratedCases = cases.map(caseItem => {
    if (!caseItem || typeof caseItem !== 'object') return caseItem;
    if (!Array.isArray(caseItem.documents)) return caseItem;
    const migratedDocs = caseItem.documents.map(doc => {
      if (!doc || typeof doc !== 'object') return doc;
      stats.totalDocs++;
      const newValue = migrateAddedByValue(doc.addedBy, stats);
      if (newValue === doc.addedBy) return doc;
      return { ...doc, addedBy: newValue, updatedAt: new Date().toISOString() };
    });
    return { ...caseItem, documents: migratedDocs };
  });

  // eslint-disable-next-line no-console
  console.log(
    `[TASK 0.3.4] Migrated ${stats.totalDocs} documents addedBy:\n` +
    `  lawyer_via_dp → user: ${stats.lawyer_via_dp}\n` +
    `  lawyer_manual → user: ${stats.lawyer_manual}\n` +
    `  agent → agent (no change): ${stats.agent_unchanged}\n` +
    `  ecits → system: ${stats.ecits}\n` +
    `  migration → system: ${stats.migration}\n` +
    `  user → user (idempotent): ${stats.user_unchanged}\n` +
    `  system → system (idempotent): ${stats.system_unchanged}\n` +
    `  null/undefined → user: ${stats.nullToUser}\n` +
    `  unknown → user (fallback): ${stats.unknownToUser}`
  );

  return {
    registry: {
      ...registry,
      schemaVersion: 6.5,
      settingsVersion: '6.5_addedby_cleanup',
      cases: migratedCases,
      lastMigration: {
        from: fromVersion,
        to: 6.5,
        at: new Date().toISOString(),
      },
    },
    didMigrate: true,
    fromVersion,
    toVersion: 6.5,
    stats,
  };
}

// ── v6.5 → v7: canonical schema for ECITS integration (TASK 0.3.5) ──────────
// Розширює канонічну схему системи для прийому даних з ЄСІТС-кабінету і
// інших каналів (Telegram, email, ручне введення, парсинг). Обидва канали
// (Court Sync і Metadata Extractor) пишуть в одну схему через одні ACTIONS.
//
// Зміни:
// • document.source enum: manual_upload→manual, ecits→court_sync, +metadata_extractor, +unknown
// • document: +sourceConfidence, +extractedAt, +ecitsSource, +movementCard, +alternativeSources
// • case: +ecitsState (з syncMetrics), +parties[], +processParticipants[]
// • proceeding: +composition
// • hearing: +source, +sourceConfidence, +extractedAt, +ecitsContext, +assignedTo, +attendedBy[]
// • user: +ecitsCabinetIdentifier
//
// Ідемпотентна: повторний запуск з v7+ повертає didMigrate=false.
// Викликається з App.jsx EFFECT-A послідовно після migrateToVersion6_5.

// Маппінг legacy source values → canonical v7.
// Невідоме значення → 'unknown' з warning у консоль.
const SOURCE_MIGRATION_MAP = {
  manual_upload: 'manual',
  ecits: 'court_sync',
  manual: 'manual',
  court_sync: 'court_sync',
  metadata_extractor: 'metadata_extractor',
  telegram: 'telegram',
  email: 'email',
  unknown: 'unknown',
};

function migrateDocumentSource(oldSource, stats) {
  if (oldSource === undefined || oldSource === null) {
    stats.null_to_manual++;
    return 'manual';
  }
  const mapped = SOURCE_MIGRATION_MAP[oldSource];
  if (mapped) {
    if (oldSource === 'manual_upload' && mapped === 'manual') {
      stats.manual_upload_to_manual++;
    } else if (oldSource === 'ecits' && mapped === 'court_sync') {
      stats.ecits_to_court_sync++;
    } else if (oldSource === 'telegram') {
      stats.keep_telegram++;
    } else if (oldSource === 'email') {
      stats.keep_email++;
    } else {
      stats[`${oldSource}_unchanged`] = (stats[`${oldSource}_unchanged`] || 0) + 1;
    }
    return mapped;
  }
  // eslint-disable-next-line no-console
  console.warn(`[TASK 0.3.5] Unknown document source '${oldSource}', setting to 'unknown'`);
  stats.unknown_other++;
  return 'unknown';
}

function buildDefaultEcitsState() {
  return {
    caseId: null,
    filedAt: null,
    court: null,
    lastSyncedAt: null,
    lastSyncedBy: null,
    syncStatus: 'never',
    failureReason: null,
    syncMetrics: {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      documentsExtracted: 0,
      hearingsExtracted: 0,
      lastDurationMs: null,
    },
  };
}

export function migrateToVersion7(registry) {
  const fromVersion = registry?.schemaVersion || 1;

  if (fromVersion >= 7) {
    return {
      registry,
      didMigrate: false,
      fromVersion,
      toVersion: fromVersion,
      stats: null,
    };
  }

  // eslint-disable-next-line no-console
  console.log('[TASK 0.3.5] Starting v6.5 → v7 migration: canonical schema for ECITS...');

  const stats = {
    documentsUpdated: 0,
    casesUpdated: 0,
    hearingsUpdated: 0,
    proceedingsUpdated: 0,
    usersUpdated: 0,
    // Source enum migration breakdown
    manual_upload_to_manual: 0,
    ecits_to_court_sync: 0,
    keep_telegram: 0,
    keep_email: 0,
    null_to_manual: 0,
    unknown_other: 0,
  };

  const cases = Array.isArray(registry?.cases) ? registry.cases : [];

  const migratedCases = cases.map(caseItem => {
    if (!caseItem || typeof caseItem !== 'object') return caseItem;

    // 1. Documents — source enum migration + 5 нових полів
    const updatedDocs = Array.isArray(caseItem.documents)
      ? caseItem.documents.map(doc => {
          if (!doc || typeof doc !== 'object') return doc;
          stats.documentsUpdated++;
          return {
            ...doc,
            source: migrateDocumentSource(doc.source, stats),
            sourceConfidence: doc.sourceConfidence ?? 'high',
            extractedAt: doc.extractedAt ?? null,
            ecitsSource: doc.ecitsSource ?? null,
            movementCard: doc.movementCard ?? null,
            alternativeSources: Array.isArray(doc.alternativeSources) ? doc.alternativeSources : [],
          };
        })
      : caseItem.documents;

    // 2. Proceedings — додати composition
    const updatedProceedings = Array.isArray(caseItem.proceedings)
      ? caseItem.proceedings.map(p => {
          if (!p || typeof p !== 'object') return p;
          if (p.composition !== undefined) return p; // ідемпотентність
          stats.proceedingsUpdated++;
          return { ...p, composition: null };
        })
      : caseItem.proceedings;

    // 3. Hearings — додати v7 поля
    const updatedHearings = Array.isArray(caseItem.hearings)
      ? caseItem.hearings.map(h => {
          if (!h || typeof h !== 'object') return h;
          stats.hearingsUpdated++;
          return {
            ...h,
            source: h.source ?? 'manual',
            sourceConfidence: h.sourceConfidence ?? 'high',
            extractedAt: h.extractedAt ?? null,
            ecitsContext: h.ecitsContext ?? null,
            assignedTo: h.assignedTo ?? null,
            attendedBy: Array.isArray(h.attendedBy) ? h.attendedBy : [],
          };
        })
      : caseItem.hearings;

    stats.casesUpdated++;
    return {
      ...caseItem,
      documents: updatedDocs,
      proceedings: updatedProceedings,
      hearings: updatedHearings,
      // 4. Case-level v7 поля (НЕ чіпаємо team[] — Варіант A з review)
      ecitsState: caseItem.ecitsState ?? buildDefaultEcitsState(),
      parties: Array.isArray(caseItem.parties) ? caseItem.parties : [],
      processParticipants: Array.isArray(caseItem.processParticipants) ? caseItem.processParticipants : [],
    };
  });

  // 5. Users — додати ecitsCabinetIdentifier
  const usersIn = Array.isArray(registry?.users) && registry.users.length > 0
    ? registry.users
    : [DEFAULT_USER];
  const usersOut = usersIn.map(u => {
    if (!u || typeof u !== 'object') return u;
    if ('ecitsCabinetIdentifier' in u) return u; // ідемпотентність
    stats.usersUpdated++;
    return { ...u, ecitsCabinetIdentifier: null };
  });

  // eslint-disable-next-line no-console
  console.log(
    `[TASK 0.3.5] Migration done:\n` +
    `  Documents updated: ${stats.documentsUpdated}\n` +
    `  Source enum migration:\n` +
    `    manual_upload → manual: ${stats.manual_upload_to_manual}\n` +
    `    ecits → court_sync: ${stats.ecits_to_court_sync}\n` +
    `    null/undefined → manual: ${stats.null_to_manual}\n` +
    `    telegram kept: ${stats.keep_telegram}\n` +
    `    email kept: ${stats.keep_email}\n` +
    `    unknown → 'unknown' (fallback): ${stats.unknown_other}\n` +
    `  Cases updated: ${stats.casesUpdated}\n` +
    `  Hearings updated: ${stats.hearingsUpdated}\n` +
    `  Proceedings updated: ${stats.proceedingsUpdated}\n` +
    `  Users updated: ${stats.usersUpdated}\n` +
    `[TASK 0.3.5] Migration v6.5 → v7 done.`
  );

  return {
    registry: {
      ...registry,
      schemaVersion: 7,
      settingsVersion: '7.0_ecits_canonical',
      cases: migratedCases,
      users: usersOut,
      lastMigration: {
        from: fromVersion,
        to: 7,
        at: new Date().toISOString(),
      },
    },
    didMigrate: true,
    fromVersion,
    toVersion: 7,
    stats,
  };
}

// ── TASK 2: time_entry.source → time_entry.captureMethod (v7 → v8) ──────────
// Перейменування ПОЛЯ, не значень. document/hearing/parties.source = канал
// походження; time_entry.source = спосіб фіксації — інший сенс. Після цього
// кроку слово "source" у системі однозначне (правило #11). Ідемпотентна.
// Архівні файли НЕ чіпає — стара ротація читається через lazy-on-load
// нормалізацію в timeEntriesArchiver.normalizeArchivedTimeEntries.
// Викликається з App.jsx EFFECT-A послідовно після migrateToVersion7.
export function migrateToVersion8(registry) {
  const fromVersion = registry?.schemaVersion || 1;

  if (fromVersion >= 8) {
    return { registry, didMigrate: false, fromVersion, toVersion: fromVersion, stats: null };
  }

  const stats = { total: 0, renamed: 0, alreadyCaptureMethod: 0, noField: 0 };

  const hasEntries = Array.isArray(registry?.time_entries);
  const entriesIn = hasEntries ? registry.time_entries : [];
  const migratedEntries = entriesIn.map(e => {
    if (!e || typeof e !== 'object') return e;
    stats.total++;
    if ('captureMethod' in e) {
      stats.alreadyCaptureMethod++;
      // Ідемпотентність: прибрати дублюючий legacy 'source' якщо лишився.
      if ('source' in e) {
        const { source: _legacy, ...rest } = e;
        return rest;
      }
      return e;
    }
    if ('source' in e) {
      const { source, ...rest } = e;
      stats.renamed++;
      return { ...rest, captureMethod: source };
    }
    stats.noField++;
    return e;
  });

  // eslint-disable-next-line no-console
  console.log(
    `[TASK 2] Migration v${fromVersion} → v8 (time_entry.source → captureMethod):\n` +
    `  total time_entries: ${stats.total}\n` +
    `  renamed source→captureMethod: ${stats.renamed}\n` +
    `  already captureMethod (idempotent): ${stats.alreadyCaptureMethod}\n` +
    `  no field (left as is): ${stats.noField}\n` +
    `[TASK 2] Migration v${fromVersion} → v8 done.`
  );

  return {
    registry: {
      ...registry,
      schemaVersion: 8,
      settingsVersion: '8.0_time_entry_capture_method',
      time_entries: hasEntries ? migratedEntries : registry?.time_entries,
      lastMigration: { from: fromVersion, to: 8, at: new Date().toISOString() },
    },
    didMigrate: true,
    fromVersion,
    toVersion: 8,
    stats,
  };
}

// ── v8 → v9: case.origin enum (TASK 0.4 Court Sync MVP) ─────────────────────
// Додає case.origin усім існуючим справам зі значенням 'manual' (до bump'а
// всі справи створювались вручну — не було автоімпорту). Нові ЄСІТС-канали
// (Court Sync, майбутні Telegram/Email) пишуть інші значення enum.
//
// case.origin enum: 'manual' | 'ecits_import' | 'telegram_import' | 'email_import'
// Аналог document.source на рівні справи. Один сенс — канал створення.
//
// Ідемпотентна: повторний запуск з v9+ повертає didMigrate=false. Запуск з
// v8 на справі що вже має origin (з якоїсь причини) — лишає її як є.
// Викликається з App.jsx EFFECT-A послідовно після migrateToVersion8.
export const CASE_ORIGIN_VALUES = Object.freeze([
  'manual',
  'ecits_import',
  'telegram_import',
  'email_import',
]);

export function migrateToVersion9(registry) {
  const fromVersion = registry?.schemaVersion || 1;

  if (fromVersion >= 9) {
    return { registry, didMigrate: false, fromVersion, toVersion: fromVersion, stats: null };
  }

  const stats = { totalCases: 0, originAdded: 0, originAlreadySet: 0 };
  const cases = Array.isArray(registry?.cases) ? registry.cases : [];
  const migratedCases = cases.map(c => {
    if (!c || typeof c !== 'object') return c;
    stats.totalCases++;
    if (typeof c.origin === 'string' && CASE_ORIGIN_VALUES.includes(c.origin)) {
      stats.originAlreadySet++;
      return c;
    }
    stats.originAdded++;
    return { ...c, origin: 'manual' };
  });

  // eslint-disable-next-line no-console
  console.log(
    `[TASK 0.4] Migration v${fromVersion} → v9 (case.origin):\n` +
    `  total cases: ${stats.totalCases}\n` +
    `  origin added ('manual'): ${stats.originAdded}\n` +
    `  origin already set (idempotent): ${stats.originAlreadySet}\n` +
    `[TASK 0.4] Migration v${fromVersion} → v9 done.`
  );

  return {
    registry: {
      ...registry,
      schemaVersion: 9,
      settingsVersion: '9.0_case_origin',
      cases: migratedCases,
      lastMigration: { from: fromVersion, to: 9, at: new Date().toISOString() },
    },
    didMigrate: true,
    fromVersion,
    toVersion: 9,
    stats,
  };
}

// ── Імпорт legacy levytskyi_timelog → time_entries[] ────────────────────────
// Викликається з App.jsx один раз при першому запуску v4 (з прапором).
// Поля legacy запису:
//   { id: 'tl_<ts>', userId, caseId, date, duration, description, type, source, createdAt }
// Мапування на time_entry v4: див. CLAUDE.md / TASK Billing Foundation v2.
export function importLegacyTimeLog(legacyEntries) {
  if (!Array.isArray(legacyEntries) || legacyEntries.length === 0) return [];
  const tenantId = DEFAULT_TENANT.tenantId;
  const userId = DEFAULT_USER.userId;
  return legacyEntries.map(le => {
    if (!le || typeof le !== 'object') return null;
    const date = le.date || (le.createdAt ? le.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10));
    const start = `${date}T09:00:00.000Z`;
    const durMin = Number.isFinite(le.duration) ? le.duration : 60;
    const end = new Date(new Date(start).getTime() + durMin * 60 * 1000).toISOString();
    return {
      id: le.id || `te_legacy_${Math.random().toString(36).slice(2, 8)}`,
      tenantId,
      userId: le.userId || userId,
      createdAt: le.createdAt || new Date().toISOString(),
      type: 'manual_entry',
      module: MODULES.LEGACY,
      action: 'legacy_import',
      caseId: le.caseId || null,
      hearingId: null,
      documentId: null,
      duration: durMin * 60, // зберігаємо в секундах
      startTime: start,
      endTime: end,
      category: le.caseId ? 'case_work' : 'admin',
      subCategory: le.type || null,
      billable: true,
      visibleToClient: true,
      billFactor: 1.0,
      status: 'confirmed',
      semanticGroup: null,
      parentEventId: null,
      parentEventType: null,
      parentTimerId: null,
      subtimerSessionId: null,
      direction: null,
      confidence: 'medium',
      captureMethod: 'legacy_import',
      originalDuration: durMin,
      actualDuration: null,
      confirmedDuration: durMin,
      exitedVia: null,
      resumedAt: null,
      metadata: {
        description: le.description || '',
        legacyType: le.type || null,
        legacySource: le.source || null,
      },
    };
  }).filter(Boolean);
}

// Доступний для нормалізації нових справ зсередини App.jsx
export function ensureCaseSaasFields(c) {
  return migrateCase(c);
}

// ── ensureCaseSaasAndEcitsFields — повна нормалізація для нових справ ──────
// TASK 0.4 R1 fix. `migrateCase`/`ensureCaseSaasFields` додають лише SaaS v2/v3
// поля (tenantId/ownerId/team/shareType/externalAccess). v7-поля (ecitsState,
// parties, processParticipants) додає ЛИШЕ одноразова `migrateToVersion7` —
// нові справи створені після bump'а не отримували канонічного дефолту.
// v9-поле case.origin теж потребує дефолту при створенні.
//
// Ця функція — точка нормалізації для всіх НОВИХ справ (через create_case,
// seed-набір, scenario processor). Викликається ПОВЕРХ `ensureCaseSaasFields`,
// додаючи v7+v9 дефолти. Існуючі справи з Drive проходять через `migrateCase`
// → `migrateToVersion7` → `migrateToVersion9` як і раніше; ця функція їх не
// чіпає (`??` зберігає вже виставлене значення).
//
// Один сенс (правило #11): "нормалізатор канонічного дефолту case на момент
// створення". НЕ міграція (бо нова справа не має fromVersion).
export function ensureCaseSaasAndEcitsFields(c) {
  const saas = migrateCase(c);
  if (!saas) return saas;
  return {
    ...saas,
    // v7 поля
    ecitsState: saas.ecitsState ?? buildDefaultEcitsState(),
    parties: Array.isArray(saas.parties) ? saas.parties : [],
    processParticipants: Array.isArray(saas.processParticipants) ? saas.processParticipants : [],
    // v9 поле
    origin: (typeof saas.origin === 'string' && CASE_ORIGIN_VALUES.includes(saas.origin))
      ? saas.origin
      : 'manual',
  };
}

// Експорт для testів і ручних викликів.
export { migrateTenant, ensureTeamPermissions, ROLE_PERMISSION_DEFAULTS, buildDefaultEcitsState };
