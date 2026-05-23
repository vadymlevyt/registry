// entitlementsService.test.js — TASK 0.4

import { describe, it, expect } from 'vitest';
import {
  canUseModule,
  ensureEntitlements,
  buildDefaultEntitlements,
  getForExtension,
} from '../../src/services/entitlementsService.js';

describe('buildDefaultEntitlements', () => {
  it('містить ecits з enabled+import_cases_and_hearings', () => {
    const d = buildDefaultEntitlements();
    expect(d.ecits.enabled).toBe(true);
    expect(d.ecits.scenarios.import_cases_and_hearings).toBe(true);
    expect(d.ecits.trialMode).toBe(false);
    expect(d.ecits.expiresAt).toBeNull();
  });
  it('включає documents і canvas', () => {
    const d = buildDefaultEntitlements();
    expect(d.documents.enabled).toBe(true);
    expect(d.canvas.enabled).toBe(true);
  });
});

describe('ensureEntitlements', () => {
  it('додає entitlements якщо їх нема', () => {
    const out = ensureEntitlements({ plan: 'self_hosted' });
    expect(out.entitlements).toBeDefined();
    expect(out.entitlements.ecits.enabled).toBe(true);
  });
  it('лишає існуючі entitlements незмінними (ідемпотентність)', () => {
    const existing = { ecits: { enabled: false } };
    const out = ensureEntitlements({ plan: 'x', entitlements: existing });
    expect(out.entitlements).toBe(existing);
  });
  it('обробляє null/undefined subscription', () => {
    expect(ensureEntitlements(null).entitlements).toBeDefined();
    expect(ensureEntitlements(undefined).entitlements).toBeDefined();
  });
});

describe('canUseModule — entitlements path', () => {
  it('дозволяє ecits.import_cases_and_hearings для self_hosted дефолту', () => {
    const tenant = { subscription: { entitlements: buildDefaultEntitlements() } };
    const r = canUseModule(tenant, 'ecits', 'import_cases_and_hearings');
    expect(r.allowed).toBe(true);
    expect(r.source).toBe('entitlements');
  });
  it('забороняє модуль якщо enabled=false', () => {
    const tenant = { subscription: { entitlements: { ecits: { enabled: false } } } };
    const r = canUseModule(tenant, 'ecits');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/disabled/);
  });
  it('забороняє конкретний сценарій якщо false у scenarios', () => {
    const tenant = { subscription: { entitlements: { ecits: { enabled: true, scenarios: { other_scn: false } } } } };
    const r = canUseModule(tenant, 'ecits', 'other_scn');
    expect(r.allowed).toBe(false);
  });
  it('забороняє якщо expiresAt у минулому', () => {
    const tenant = { subscription: { entitlements: { ecits: { enabled: true, expiresAt: '2020-01-01T00:00:00Z' } } } };
    const r = canUseModule(tenant, 'ecits');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/expired/);
  });
  it('забороняє якщо remainingUsages <= 0', () => {
    const tenant = { subscription: { entitlements: { ecits: { enabled: true, remainingUsages: 0 } } } };
    const r = canUseModule(tenant, 'ecits');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/quota/);
  });
});

describe('canUseModule — tariff fallback', () => {
  it('читає з TARIFF_MATRIX коли entitlements відсутні', () => {
    const tenant = { subscription: { plan: 'self_hosted' } };
    const r = canUseModule(tenant, 'ecits', 'import_cases_and_hearings');
    expect(r.allowed).toBe(true);
    expect(r.source).toBe('tariff');
  });
  it('повертає fallback коли і entitlements і plan відсутні', () => {
    const r = canUseModule({}, 'ecits');
    expect(r.allowed).toBe(true);
    expect(r.source).toBe('fallback');
  });
});

describe('canUseModule — edge cases', () => {
  it('повертає false для відсутнього moduleId', () => {
    const r = canUseModule({}, null);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/moduleId/);
  });
});

describe('getForExtension', () => {
  it('повертає зріз без sensitive полів', () => {
    const tenant = { subscription: { entitlements: buildDefaultEntitlements() } };
    const out = getForExtension(tenant);
    expect(out.ecits.enabled).toBe(true);
    expect(out.ecits.trialMode).toBe(false);
    // Не повинні бути присутні випадкові sensitive поля
    expect(out.ecits.remainingUsages).toBeUndefined();
  });
  it('fallback на дефолтні якщо tenant=null', () => {
    const out = getForExtension(null);
    expect(out.ecits).toBeDefined();
    expect(out.ecits.enabled).toBe(true);
  });
});
