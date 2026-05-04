// ── MIGRATION SERVICE ────────────────────────────────────────────────────────
// Міграція registry_data.json між версіями схеми.
//
// schemaVersion: 1 (неявна) — Drive містить голий масив cases[].
// schemaVersion: 2 — об'єкт { schemaVersion, tenants, users, auditLog,
//                              structuralUnits, cases, settingsVersion }.

import { DEFAULT_TENANT, DEFAULT_USER } from './tenantService.js';

export const CURRENT_SCHEMA_VERSION = 2;
export const MIGRATION_VERSION = '2.0_saas_foundation';

function migrateCase(c) {
  if (!c || typeof c !== 'object') return null;
  const out = { ...c };
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

  // Вкладені сутності — лише createdBy. tenantId успадковується від справи.
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

export function buildEmptyRegistry() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settingsVersion: MIGRATION_VERSION,
    tenants: [DEFAULT_TENANT],
    users: [DEFAULT_USER],
    auditLog: [],
    structuralUnits: [],
    cases: [],
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

  // Випадок 2: вже об'єкт з schemaVersion >= 2 — ідемпотентно
  if (!Array.isArray(raw) && typeof raw === 'object' && raw.schemaVersion >= CURRENT_SCHEMA_VERSION) {
    const safe = {
      schemaVersion: raw.schemaVersion,
      settingsVersion: raw.settingsVersion || MIGRATION_VERSION,
      tenants: Array.isArray(raw.tenants) && raw.tenants.length > 0 ? raw.tenants : [DEFAULT_TENANT],
      users: Array.isArray(raw.users) && raw.users.length > 0 ? raw.users : [DEFAULT_USER],
      auditLog: Array.isArray(raw.auditLog) ? raw.auditLog : [],
      structuralUnits: Array.isArray(raw.structuralUnits) ? raw.structuralUnits : [],
      cases: Array.isArray(raw.cases) ? raw.cases.map(migrateCase).filter(Boolean) : [],
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
        tenants: [DEFAULT_TENANT],
        users: [DEFAULT_USER],
        auditLog: [],
        structuralUnits: [],
        cases,
      },
      didMigrate: true,
      fromVersion: 1,
      toVersion: CURRENT_SCHEMA_VERSION,
      originalRaw: raw,
    };
  }

  // Випадок 4: щось дивне (об'єкт без schemaVersion або зі старою) — пробуємо знайти cases
  const cases = Array.isArray(raw?.cases) ? raw.cases.map(migrateCase).filter(Boolean) : [];
  return {
    registry: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      settingsVersion: MIGRATION_VERSION,
      tenants: Array.isArray(raw?.tenants) && raw.tenants.length > 0 ? raw.tenants : [DEFAULT_TENANT],
      users: Array.isArray(raw?.users) && raw.users.length > 0 ? raw.users : [DEFAULT_USER],
      auditLog: Array.isArray(raw?.auditLog) ? raw.auditLog : [],
      structuralUnits: Array.isArray(raw?.structuralUnits) ? raw.structuralUnits : [],
      cases,
    },
    didMigrate: true,
    fromVersion: raw?.schemaVersion || 1,
    toVersion: CURRENT_SCHEMA_VERSION,
    originalRaw: raw,
  };
}

// Доступний для нормалізації нових справ зсередини App.jsx
export function ensureCaseSaasFields(c) {
  return migrateCase(c);
}
