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

export const CURRENT_SCHEMA_VERSION = 4;
export const MIGRATION_VERSION = '4.0_billing_foundation';

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
    },
  };
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

  // Випадок 2: вже об'єкт з schemaVersion >= CURRENT — ідемпотентно (з підтягуванням нових полів)
  if (!Array.isArray(raw) && typeof raw === 'object' && (raw.schemaVersion || 0) >= CURRENT_SCHEMA_VERSION) {
    const safe = {
      schemaVersion: raw.schemaVersion,
      settingsVersion: raw.settingsVersion || MIGRATION_VERSION,
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
      toVersion: CURRENT_SCHEMA_VERSION,
      originalRaw: raw,
    };
  }

  // Випадок 3: голий масив cases[] (schemaVersion 1)
  if (Array.isArray(raw)) {
    const cases = raw.map(migrateCase).filter(Boolean);
    return {
      registry: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        settingsVersion: MIGRATION_VERSION,
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
      toVersion: CURRENT_SCHEMA_VERSION,
      originalRaw: raw,
    };
  }

  // Випадок 4: об'єкт з schemaVersion < CURRENT (2 або 3) — мігруємо до v4
  const cases = Array.isArray(raw?.cases) ? raw.cases.map(migrateCase).filter(Boolean) : [];
  const tenants = Array.isArray(raw?.tenants) && raw.tenants.length > 0
    ? raw.tenants.map(migrateTenant) : [migrateTenant(DEFAULT_TENANT)];
  return {
    registry: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      settingsVersion: MIGRATION_VERSION,
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
    toVersion: CURRENT_SCHEMA_VERSION,
    originalRaw: raw,
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
      module: 'legacy',
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
