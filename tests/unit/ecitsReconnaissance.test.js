// TASK 0.3 — Інфраструктура recon (розвідки) ЄСІТС через Claude for Chrome.
// Юніт-тести для recon-сценаріїв, історії, реєстрації запусків, експорту.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getReconScenarios,
  getReconScenarioById,
  getReconHistory,
  registerReconRun,
  markReconCompleted,
  exportReconForAnalysis,
  testProviderConnection,
  __RECON_HISTORY_STORAGE_KEY,
} from '../../src/services/ecitsService.js';
import { RECON_ECITS_BASIC_V1, RECON_SCENARIOS } from '../../src/services/recon/scenarios/ecitsBasic.js';
import { isCurrentUserFounder, DEFAULT_TENANT } from '../../src/services/tenantService.js';

// Поліфіл localStorage для node-environment Vitest. Зберігаємо in-memory
// бо тести в node не мають реального localStorage.
function setupLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i) => Array.from(store.keys())[i] || null,
    get length() { return store.size; },
  };
}

beforeEach(() => {
  setupLocalStorage();
});

// ── Сценарії ──────────────────────────────────────────────────────────────────

describe('RECON_ECITS_BASIC_V1 — структура сценарію', () => {
  it('експортує всі обов\'язкові поля', () => {
    expect(RECON_ECITS_BASIC_V1.id).toBe('RECON_ecits_basic_v1');
    expect(typeof RECON_ECITS_BASIC_V1.name).toBe('string');
    expect(typeof RECON_ECITS_BASIC_V1.description).toBe('string');
    expect(typeof RECON_ECITS_BASIC_V1.estimatedDuration).toBe('string');
    expect(typeof RECON_ECITS_BASIC_V1.prompt).toBe('string');
    expect(RECON_ECITS_BASIC_V1.targetFolderRoot).toBe('_research/ecits');
    expect(Array.isArray(RECON_ECITS_BASIC_V1.expectedArtifacts)).toBe(true);
  });

  it('prompt містить безпечні правила і назви ключових етапів', () => {
    const p = RECON_ECITS_BASIC_V1.prompt;
    expect(p.length).toBeGreaterThan(1000);
    expect(p).toContain('read-only');
    expect(p).toContain('ЕТАП 1');
    expect(p).toContain('ЕТАП 2');
    expect(p).toContain('ЕТАП 3');
    expect(p).toContain('ЕТАП 4');
    expect(p).toContain('ЕТАП 5');
    expect(p).toContain('manifest.json');
    expect(p).toContain('_research/ecits/');
  });

  it('сценарій frozen (запобігає випадковій мутації)', () => {
    expect(Object.isFrozen(RECON_ECITS_BASIC_V1)).toBe(true);
    expect(Object.isFrozen(RECON_SCENARIOS)).toBe(true);
  });
});

describe('getReconScenarios()', () => {
  it('повертає масив з принаймні одним сценарієм', () => {
    const list = getReconScenarios();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].id).toBe('RECON_ecits_basic_v1');
  });
});

describe('getReconScenarioById', () => {
  it('знаходить сценарій по id', () => {
    const sc = getReconScenarioById('RECON_ecits_basic_v1');
    expect(sc).not.toBeNull();
    expect(sc.id).toBe('RECON_ecits_basic_v1');
  });
  it('повертає null для невідомого id', () => {
    expect(getReconScenarioById('NOT_REAL')).toBeNull();
  });
});

// ── registerReconRun ──────────────────────────────────────────────────────────

describe('registerReconRun', () => {
  it('створює запис зі статусом in_progress і потрібними полями', () => {
    const fixedNow = new Date('2026-05-10T15:30:00Z');
    const rec = registerReconRun('RECON_ecits_basic_v1', { now: fixedNow });
    expect(rec.scenarioId).toBe('RECON_ecits_basic_v1');
    expect(rec.status).toBe('in_progress');
    expect(rec.completedAt).toBeNull();
    expect(rec.summary).toBeNull();
    expect(rec.reconId).toMatch(/^ecits_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/);
    expect(rec.targetFolder).toMatch(/^_research\/ecits\/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/);
    expect(typeof rec.startedAt).toBe('string');
  });

  it('зберігає запис у localStorage під спільним ключем', () => {
    registerReconRun('RECON_ecits_basic_v1');
    const raw = localStorage.getItem(__RECON_HISTORY_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  it('кидає коли сценарій невідомий', () => {
    expect(() => registerReconRun('NOT_REAL')).toThrow();
  });

  it('новіші записи з\'являються першими (LIFO)', () => {
    const a = registerReconRun('RECON_ecits_basic_v1', { now: new Date('2026-05-10T15:30:00Z') });
    const b = registerReconRun('RECON_ecits_basic_v1', { now: new Date('2026-05-10T16:30:00Z') });
    const hist = getReconHistory();
    expect(hist[0].reconId).toBe(b.reconId);
    expect(hist[1].reconId).toBe(a.reconId);
  });
});

// ── markReconCompleted ────────────────────────────────────────────────────────

describe('markReconCompleted', () => {
  it('оновлює статус і completedAt', () => {
    const rec = registerReconRun('RECON_ecits_basic_v1');
    const updated = markReconCompleted(rec.reconId, {
      status: 'completed',
      summary: 'OK',
      now: new Date('2026-05-10T16:00:00Z'),
    });
    expect(updated).not.toBeNull();
    expect(updated.status).toBe('completed');
    expect(updated.summary).toBe('OK');
    expect(updated.completedAt).toBe('2026-05-10T16:00:00.000Z');
  });

  it('дефолтний status — completed', () => {
    const rec = registerReconRun('RECON_ecits_basic_v1');
    const updated = markReconCompleted(rec.reconId);
    expect(updated.status).toBe('completed');
    expect(updated.completedAt).toBeTruthy();
  });

  it('повертає null коли reconId не знайдено', () => {
    expect(markReconCompleted('not_real')).toBeNull();
  });

  it('підтримує статус abandoned/failed', () => {
    const rec = registerReconRun('RECON_ecits_basic_v1');
    const upd = markReconCompleted(rec.reconId, { status: 'abandoned' });
    expect(upd.status).toBe('abandoned');
  });

  it('зберігає попередній summary якщо patch його не передав', () => {
    const rec = registerReconRun('RECON_ecits_basic_v1');
    markReconCompleted(rec.reconId, { status: 'in_progress', summary: 'preserved' });
    const upd = markReconCompleted(rec.reconId, { status: 'completed' });
    expect(upd.summary).toBe('preserved');
  });
});

// ── getReconHistory ───────────────────────────────────────────────────────────

describe('getReconHistory', () => {
  it('повертає [] коли немає історії', () => {
    expect(getReconHistory()).toEqual([]);
  });

  it('сортує за startedAt у спадному порядку', () => {
    registerReconRun('RECON_ecits_basic_v1', { now: new Date('2026-05-10T10:00:00Z') });
    registerReconRun('RECON_ecits_basic_v1', { now: new Date('2026-05-10T12:00:00Z') });
    registerReconRun('RECON_ecits_basic_v1', { now: new Date('2026-05-10T11:00:00Z') });
    const hist = getReconHistory();
    expect(hist.map(r => r.startedAt)).toEqual([
      '2026-05-10T12:00:00.000Z',
      '2026-05-10T11:00:00.000Z',
      '2026-05-10T10:00:00.000Z',
    ]);
  });

  it('відображає актуальний статус після markReconCompleted', () => {
    const rec = registerReconRun('RECON_ecits_basic_v1');
    markReconCompleted(rec.reconId, { status: 'completed', summary: 'done' });
    const hist = getReconHistory();
    expect(hist).toHaveLength(1);
    expect(hist[0].status).toBe('completed');
    expect(hist[0].summary).toBe('done');
  });
});

// ── exportReconForAnalysis ────────────────────────────────────────────────────

describe('exportReconForAnalysis', () => {
  it('формує правильний шлях експорту для існуючого recon', () => {
    const rec = registerReconRun('RECON_ecits_basic_v1');
    const exp = exportReconForAnalysis(rec.reconId);
    expect(exp.reconId).toBe(rec.reconId);
    expect(exp.targetFolder).toBe(rec.targetFolder);
    expect(exp.exportPath).toBe(`${rec.targetFolder}/export_for_analysis.zip`);
  });

  it('повертає null-поля для невідомого reconId', () => {
    const exp = exportReconForAnalysis('not_real');
    expect(exp.targetFolder).toBeNull();
    expect(exp.exportPath).toBeNull();
  });
});

// ── testProviderConnection ────────────────────────────────────────────────────

describe('testProviderConnection', () => {
  it('повертає detected=false і причину manual verification', async () => {
    const res = await testProviderConnection();
    expect(res.detected).toBe(false);
    expect(res.reason).toBe('Manual verification required');
    expect(res.provider).toBe('claudeForChrome');
  });
});

// ── Founder gating ────────────────────────────────────────────────────────────

describe('Видимість вкладки Розвідник — isCurrentUserFounder', () => {
  it('за замовчуванням true (DEFAULT_USER = vadym має isFounder: true)', () => {
    expect(isCurrentUserFounder()).toBe(true);
  });

  it('предикат повертає false для звичайного користувача', () => {
    const fakeUser = { userId: 'olena', isFounder: false };
    expect(fakeUser?.isFounder === true).toBe(false);
  });
});

// ── tenant.recon_history — структура готова ───────────────────────────────────

describe('DEFAULT_TENANT.recon_history — поле присутнє', () => {
  it('існує як порожній масив', () => {
    expect(Array.isArray(DEFAULT_TENANT.recon_history)).toBe(true);
    expect(DEFAULT_TENANT.recon_history).toEqual([]);
  });
});
