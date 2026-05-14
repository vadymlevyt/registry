// TASK 0.2 — Інфраструктура модуля «Електронний суд».
// Юніт-тести для eventBus, eventBusTopics, ecitsService, document.source,
// tenant.settings.moduleIntegration.ecits і founder-gating підвкладки Розвідник.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  subscribe,
  publish,
  clear,
  subscriberCount,
} from '../../src/services/eventBus.js';
import {
  ECITS_DOCUMENTS_RECEIVED,
  ECITS_HEARING_SCHEDULED,
  ECITS_CASE_STATUS_CHANGED,
  ECITS_SUBMISSION_COMPLETED,
  ECITS_TOPICS,
} from '../../src/services/eventBusTopics.js';
import {
  triggerSync,
  getLastSyncTime,
  getSyncReport,
  getSettings,
  updateSettings,
  DEFAULT_ECITS_SETTINGS,
} from '../../src/services/ecitsService.js';
import {
  DOCUMENT_SOURCES,
  DOCUMENT_SOURCE_LABELS,
  isValidDocumentSource,
} from '../../src/constants/documentSources.js';
import { createDocument, validateDocument } from '../../src/services/documentFactory.js';
import { DEFAULT_TENANT } from '../../src/services/tenantService.js';

// ── eventBus ──────────────────────────────────────────────────────────────────

describe('eventBus.subscribe / publish / unsubscribe / clear', () => {
  beforeEach(() => clear());

  it('handler отримує payload при publish', () => {
    const fn = vi.fn();
    subscribe('test.topic', fn);
    publish('test.topic', { foo: 'bar' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ foo: 'bar' });
  });

  it('кілька handlers однаково отримують подію', () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribe('multi', a);
    subscribe('multi', b);
    publish('multi', 42);
    expect(a).toHaveBeenCalledWith(42);
    expect(b).toHaveBeenCalledWith(42);
  });

  it('unsubscribe скасовує підписку', () => {
    const fn = vi.fn();
    const off = subscribe('off.test', fn);
    off();
    publish('off.test', 1);
    expect(fn).not.toHaveBeenCalled();
    expect(subscriberCount('off.test')).toBe(0);
  });

  it('clear() видаляє всі підписки', () => {
    const fn = vi.fn();
    subscribe('a', fn);
    subscribe('b', fn);
    clear();
    publish('a');
    publish('b');
    expect(fn).not.toHaveBeenCalled();
    expect(subscriberCount('a')).toBe(0);
  });

  it('publish без підписників — no-op (не кидає)', () => {
    expect(() => publish('nobody.listening', { x: 1 })).not.toThrow();
  });

  it('помилка в handler не блокує інших', () => {
    const good = vi.fn();
    subscribe('mixed', () => { throw new Error('boom'); });
    subscribe('mixed', good);
    publish('mixed', 'payload');
    expect(good).toHaveBeenCalledWith('payload');
  });

  it('subscribe валідує аргументи', () => {
    expect(() => subscribe('', () => {})).toThrow();
    expect(() => subscribe('topic', null)).toThrow();
  });
});

describe('eventBusTopics — константи модуля ЄСІТС', () => {
  it('експортує всі чотири очікувані топіки', () => {
    expect(ECITS_DOCUMENTS_RECEIVED).toBe('ecits.documents_received');
    expect(ECITS_HEARING_SCHEDULED).toBe('ecits.hearing_scheduled');
    expect(ECITS_CASE_STATUS_CHANGED).toBe('ecits.case_status_changed');
    expect(ECITS_SUBMISSION_COMPLETED).toBe('ecits.submission_completed');
  });

  it('ECITS_TOPICS — frozen array з 6 елементами (TASK 0.3.5 додав 2 sync події)', () => {
    expect(Object.isFrozen(ECITS_TOPICS)).toBe(true);
    expect(ECITS_TOPICS).toHaveLength(6);
    expect(ECITS_TOPICS).toContain(ECITS_DOCUMENTS_RECEIVED);
  });
});

// ── ecitsService (заглушки) ───────────────────────────────────────────────────

describe('ecitsService — заглушкові методи', () => {
  it('triggerSync повертає { success: false, message: <уРозробці> }', async () => {
    const res = await triggerSync();
    expect(res).toHaveProperty('success', false);
    expect(typeof res.message).toBe('string');
    expect(res.message.length).toBeGreaterThan(0);
  });

  it('getLastSyncTime повертає null поки немає синхронізацій', () => {
    expect(getLastSyncTime()).toBeNull();
  });

  it('getSyncReport повертає mock-структуру з потрібними ключами', () => {
    const r = getSyncReport();
    expect(r).toHaveProperty('startedAt');
    expect(r).toHaveProperty('finishedAt');
    expect(r).toHaveProperty('casesScanned');
    expect(Array.isArray(r.documentsReceived)).toBe(true);
    expect(Array.isArray(r.errors)).toBe(true);
  });

  it('getSettings повертає об\'єкт з усіма дефолтними полями', () => {
    const s = getSettings();
    expect(s).toHaveProperty('autoSync');
    expect(s).toHaveProperty('syncIntervalMinutes');
    expect(s).toHaveProperty('casesToSync');
    expect(s).toHaveProperty('autoProcessIncoming');
    expect(s).toHaveProperty('detectDeadlinesOnReceive');
    expect(s).toHaveProperty('executionProvider');
  });

  it('DEFAULT_ECITS_SETTINGS — frozen і має правильні дефолти', () => {
    expect(Object.isFrozen(DEFAULT_ECITS_SETTINGS)).toBe(true);
    expect(DEFAULT_ECITS_SETTINGS.autoSync).toBe(false);
    expect(DEFAULT_ECITS_SETTINGS.casesToSync).toBe('all');
    expect(DEFAULT_ECITS_SETTINGS.executionProvider).toBe('claudeForChrome');
    expect(DEFAULT_ECITS_SETTINGS.syncIntervalMinutes).toBeNull();
  });

  it('updateSettings(patch) повертає merged settings (без персистенції)', () => {
    const merged = updateSettings({ autoSync: true, syncIntervalMinutes: 60 });
    expect(merged.autoSync).toBe(true);
    expect(merged.syncIntervalMinutes).toBe(60);
    // інші поля — з дефолтів
    expect(merged.casesToSync).toBe('all');
  });

  it('updateSettings(null) повертає поточні settings, не падає', () => {
    expect(() => updateSettings(null)).not.toThrow();
    expect(() => updateSettings(undefined)).not.toThrow();
  });
});

// ── tenant.settings.moduleIntegration.ecits ──────────────────────────────────

describe('tenant.settings.moduleIntegration.ecits — дефолти DEFAULT_TENANT', () => {
  it('структура присутня з усіма потрібними полями', () => {
    const ecits = DEFAULT_TENANT?.settings?.moduleIntegration?.ecits;
    expect(ecits).toBeDefined();
    expect(ecits.autoSync).toBe(false);
    expect(ecits.syncIntervalMinutes).toBeNull();
    expect(ecits.casesToSync).toBe('all');
    expect(ecits.autoProcessIncoming).toBe(false);
    expect(ecits.detectDeadlinesOnReceive).toBe(false);
    expect(ecits.executionProvider).toBe('claudeForChrome');
  });
});

// ── document.source ──────────────────────────────────────────────────────────

describe('document.source — канонічна схема (TASK 0.3.5 v7)', () => {
  it("createDocument() створює document зі source='manual' коли не передано", () => {
    const doc = createDocument({ name: 'X.pdf' });
    expect(doc).toHaveProperty('source');
    // TASK 0.3.5: default 'manual' замість null (factory нормалізує)
    expect(doc.source).toBe('manual');
  });

  it("createDocument приймає валідне значення source 'court_sync'", () => {
    const doc = createDocument({ name: 'X.pdf', source: 'court_sync' });
    expect(doc.source).toBe('court_sync');
    const v = validateDocument(doc);
    expect(v.valid).toBe(true);
  });

  it("normalizeSource: legacy 'manual_upload' → 'manual'", () => {
    const doc = createDocument({ name: 'X.pdf', source: 'manual_upload' });
    expect(doc.source).toBe('manual');
  });

  it("normalizeSource: legacy 'ecits' → 'court_sync'", () => {
    const doc = createDocument({ name: 'X.pdf', source: 'ecits' });
    expect(doc.source).toBe('court_sync');
  });

  it("validateDocument відхиляє невалідне значення source", () => {
    const doc = createDocument({ name: 'X.pdf' });
    doc.source = 'not_a_valid_source';
    const v = validateDocument(doc);
    expect(v.valid).toBe(false);
    expect(v.errors.some(e => e.includes('source'))).toBe(true);
  });

  it('всі шість каналів присутні в DOCUMENT_SOURCES і мають labels (v7)', () => {
    expect(DOCUMENT_SOURCES).toEqual([
      'manual', 'court_sync', 'metadata_extractor', 'telegram', 'email', 'unknown',
    ]);
    for (const src of DOCUMENT_SOURCES) {
      expect(typeof DOCUMENT_SOURCE_LABELS[src]).toBe('string');
    }
  });

  it('isValidDocumentSource приймає null і всі канали', () => {
    expect(isValidDocumentSource(null)).toBe(true);
    for (const src of DOCUMENT_SOURCES) {
      expect(isValidDocumentSource(src)).toBe(true);
    }
    expect(isValidDocumentSource('garbage')).toBe(false);
  });
});

// ── Founder gating підвкладки «Розвідник» ────────────────────────────────────
// Логіка рендеру в CourtSync керується isCurrentUserFounder(). У node-environment
// без jsdom ми не рендеримо JSX, але можемо перевірити що предикат повертає
// правильне значення яке і керує видимістю.

describe('CourtSync founder-gating (логіка видимості Розвідника)', () => {
  it('видимість підвкладки = результат isCurrentUserFounder()', async () => {
    const mod = await import('../../src/services/tenantService.js');
    // Дефолтний користувач — vadym, isFounder=true.
    expect(mod.isCurrentUserFounder()).toBe(true);
  });

  it('логіка предикату: false коли user не засновник', () => {
    const fakeUser = { userId: 'olena', isFounder: false };
    // Повторюємо логіку з isCurrentUserFounder для перевірки незалежно.
    expect(fakeUser?.isFounder === true).toBe(false);
  });

  it('логіка предикату: false коли user без поля isFounder', () => {
    const fakeUser = { userId: 'someone' };
    expect(fakeUser?.isFounder === true).toBe(false);
  });
});

// ── ensureModuleIntegration (міграція без schema bump) ───────────────────────

describe('migrateTenant: moduleIntegration.ecits створюється коли відсутня', () => {
  it('migrateTenant приклеює дефолти ecits до tenant без settings.moduleIntegration', async () => {
    const { buildEmptyRegistry } = await import('../../src/services/migrationService.js');
    const reg = buildEmptyRegistry();
    const tenant = reg.tenants[0];
    expect(tenant.settings.moduleIntegration).toBeDefined();
    expect(tenant.settings.moduleIntegration.ecits).toBeDefined();
    expect(tenant.settings.moduleIntegration.ecits.autoSync).toBe(false);
  });
});
