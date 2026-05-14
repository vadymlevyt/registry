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

// Найвища досяжна версія після повного ланцюга міграцій (migrateRegistry →
// migrateRegistryV4toV5 → migrateToVersion6 → migrateToVersion6_5). Використовується
// App.jsx для запису нової версії registry і тестами як "це остаточний таргет системи".
// Number 6.5 — точкова чистка addedBy enum перед v7 (TASK 0.3.4 → TASK 0.3.5).
export const CURRENT_SCHEMA_VERSION = 6.5;
export const MIGRATION_VERSION = '6.5_addedby_cleanup';

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
    subscription: {
      ...(t.subscription || {}),
      plan: t.subscription?.plan || DEFAULT_TENANT.subscription.plan,
      status: t.subscription?.status || DEFAULT_TENANT.subscription.status,
      limits: t.subscription?.limits || { ...DEFAULT_TENANT.subscription.limits },
      current: t.subscription?.current || { ...DEFAULT_TENANT.subscription.current },
      alerts: t.subscription?.alerts || { ...DEFAULT_TENANT.subscription.alerts },
    },
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
      source: 'legacy_import',
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

// Експорт для testів і ручних викликів.
export { migrateTenant, ensureTeamPermissions, ROLE_PERMISSION_DEFAULTS };
