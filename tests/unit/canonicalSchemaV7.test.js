// ── CANONICAL SCHEMA V7 TESTS — TASK 0.3.5 ──────────────────────────────────
// Тести для canonical schema v7 (ЄСІТС-інтеграція):
//   • Schema version і label
//   • migrateToVersion7 — source enum migration, нові поля, ідемпотентність
//   • sourcePolicy — canOverwrite, hashData, alternativeSources
//   • caseSchema і hearingSchema — описова валідація
//   • eventBusTopics — нові топіки
//
// ACTIONS (mark_synced_from_ecits, update_case_ecits_state, 6 edit-ACTIONS)
// тестуються через _actionsHarness.js в інтеграційних тестах окремо.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  MIGRATION_VERSION,
  migrateToVersion7,
  buildEmptyRegistry,
} from '../../src/services/migrationService.js';
import {
  SOURCE_PRIORITY,
  canOverwrite,
  hashData,
  buildAlternativeSourceRecord,
} from '../../src/services/sourcePolicy.js';
import {
  CANONICAL_CASE_FIELDS,
  CANONICAL_PROCEEDING_FIELDS,
  CURRENT_CASE_SCHEMA_VERSION,
  DEPRECATED_CASE_FIELDS,
  DEPRECATED_PROCEEDING_FIELDS,
  hasMinimumCaseFields,
  hasMinimumProceedingFields,
} from '../../src/schemas/caseSchema.js';
import {
  CANONICAL_HEARING_FIELDS,
  CURRENT_HEARING_SCHEMA_VERSION,
  hasMinimumHearingFields,
  isSystemSourced,
} from '../../src/schemas/hearingSchema.js';
import {
  ECITS_SYNC_COMPLETED,
  ECITS_CASE_STATE_UPDATED,
  CASE_PARTIES_UPDATED,
  CASE_TEAM_UPDATED,
  CASE_PROCESS_PARTICIPANTS_UPDATED,
  PROCEEDING_COMPOSITION_UPDATED,
  DOCUMENT_MOVEMENT_CARD_UPDATED,
  DOCUMENT_ALTERNATIVE_SOURCE_ADDED,
  V7_EDIT_TOPICS,
  ECITS_TOPICS,
  DOCUMENT_INGESTED,
  DOCUMENT_BATCH_PROCESSED,
  DOCUMENT_TOPICS,
} from '../../src/services/eventBusTopics.js';
import { DEFAULT_USER } from '../../src/services/tenantService.js';

// ── Schema version і label ──────────────────────────────────────────────────

// Найвища досяжна версія після повного ланцюга. TASK 2 підняв таргет 7 → 8
// (time_entry.source → captureMethod). v7-крок далі тестується нижче окремо.
describe('Schema version і label (повний ланцюг, таргет після TASK 2)', () => {
  it('CURRENT_SCHEMA_VERSION === 8', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(8);
  });

  it("MIGRATION_VERSION === '8.0_time_entry_capture_method'", () => {
    expect(MIGRATION_VERSION).toBe('8.0_time_entry_capture_method');
  });

  it('buildEmptyRegistry створює одразу v8', () => {
    const reg = buildEmptyRegistry();
    expect(reg.schemaVersion).toBe(8);
    expect(reg.settingsVersion).toBe('8.0_time_entry_capture_method');
  });
});

// ── DEFAULT_USER має ecitsCabinetIdentifier ────────────────────────────────

describe('DEFAULT_USER має ecitsCabinetIdentifier (multi-user readiness)', () => {
  it('поле присутнє і default null', () => {
    expect(DEFAULT_USER).toHaveProperty('ecitsCabinetIdentifier');
    expect(DEFAULT_USER.ecitsCabinetIdentifier).toBeNull();
  });
});

// ── migrateToVersion7 ──────────────────────────────────────────────────────

describe('migrateToVersion7 (v6.5 → v7)', () => {
  it('schemaVersion: 6.5 → 7 + settingsVersion оновлюється', () => {
    const reg = { schemaVersion: 6.5, cases: [], users: [{ userId: 'vadym' }] };
    const res = migrateToVersion7(reg);
    expect(res.didMigrate).toBe(true);
    expect(res.fromVersion).toBe(6.5);
    expect(res.toVersion).toBe(7);
    expect(res.registry.schemaVersion).toBe(7);
    expect(res.registry.settingsVersion).toBe('7.0_ecits_canonical');
  });

  it('ідемпотентна — повторний запуск з v7 не змінює реєстр', () => {
    const reg = {
      schemaVersion: 7,
      settingsVersion: '7.0_ecits_canonical',
      cases: [],
      users: [{ userId: 'vadym', ecitsCabinetIdentifier: null }],
    };
    const res = migrateToVersion7(reg);
    expect(res.didMigrate).toBe(false);
  });

  describe('source enum migration', () => {
    it("'manual_upload' → 'manual'", () => {
      const reg = {
        schemaVersion: 6.5,
        cases: [{ id: 'c1', documents: [{ id: 'd1', source: 'manual_upload' }] }],
      };
      const { registry, stats } = migrateToVersion7(reg);
      expect(registry.cases[0].documents[0].source).toBe('manual');
      expect(stats.manual_upload_to_manual).toBe(1);
    });

    it("'ecits' → 'court_sync'", () => {
      const reg = {
        schemaVersion: 6.5,
        cases: [{ id: 'c1', documents: [{ id: 'd1', source: 'ecits' }] }],
      };
      const { registry, stats } = migrateToVersion7(reg);
      expect(registry.cases[0].documents[0].source).toBe('court_sync');
      expect(stats.ecits_to_court_sync).toBe(1);
    });

    it("null/undefined → 'manual'", () => {
      const reg = {
        schemaVersion: 6.5,
        cases: [{
          id: 'c1',
          documents: [
            { id: 'd1', source: null },
            { id: 'd2' /* undefined source */ },
          ],
        }],
      };
      const { registry, stats } = migrateToVersion7(reg);
      expect(registry.cases[0].documents[0].source).toBe('manual');
      expect(registry.cases[0].documents[1].source).toBe('manual');
      expect(stats.null_to_manual).toBe(2);
    });

    it("telegram / email — зберігаються", () => {
      const reg = {
        schemaVersion: 6.5,
        cases: [{
          id: 'c1',
          documents: [
            { id: 'd1', source: 'telegram' },
            { id: 'd2', source: 'email' },
          ],
        }],
      };
      const { registry, stats } = migrateToVersion7(reg);
      expect(registry.cases[0].documents[0].source).toBe('telegram');
      expect(registry.cases[0].documents[1].source).toBe('email');
      expect(stats.keep_telegram).toBe(1);
      expect(stats.keep_email).toBe(1);
    });

    it("невідоме значення → 'unknown' з warning", () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const reg = {
        schemaVersion: 6.5,
        cases: [{ id: 'c1', documents: [{ id: 'd1', source: 'mystery_channel' }] }],
      };
      const { registry, stats } = migrateToVersion7(reg);
      expect(registry.cases[0].documents[0].source).toBe('unknown');
      expect(stats.unknown_other).toBe(1);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('mystery_channel'));
      spy.mockRestore();
    });
  });

  describe('нові поля з безпечними дефолтами', () => {
    it('document отримує sourceConfidence/extractedAt/ecitsSource/movementCard/alternativeSources', () => {
      const reg = {
        schemaVersion: 6.5,
        cases: [{ id: 'c1', documents: [{ id: 'd1', source: 'manual' }] }],
      };
      const { registry } = migrateToVersion7(reg);
      const doc = registry.cases[0].documents[0];
      expect(doc.sourceConfidence).toBe('high');
      expect(doc.extractedAt).toBeNull();
      expect(doc.ecitsSource).toBeNull();
      expect(doc.movementCard).toBeNull();
      expect(doc.alternativeSources).toEqual([]);
    });

    it('case отримує ecitsState з default never', () => {
      const reg = { schemaVersion: 6.5, cases: [{ id: 'c1' }] };
      const { registry } = migrateToVersion7(reg);
      const c = registry.cases[0];
      expect(c.ecitsState).toBeDefined();
      expect(c.ecitsState.syncStatus).toBe('never');
      expect(c.ecitsState.lastSyncedAt).toBeNull();
      expect(c.ecitsState.lastSyncedBy).toBeNull();
      expect(c.ecitsState.syncMetrics.totalSyncs).toBe(0);
    });

    it('case отримує parties: [] і processParticipants: []', () => {
      const reg = { schemaVersion: 6.5, cases: [{ id: 'c1' }] };
      const { registry } = migrateToVersion7(reg);
      expect(registry.cases[0].parties).toEqual([]);
      expect(registry.cases[0].processParticipants).toEqual([]);
    });

    it('proceeding отримує composition: null', () => {
      const reg = {
        schemaVersion: 6.5,
        cases: [{
          id: 'c1',
          proceedings: [{ id: 'p1', type: 'first', title: 'Main' }],
        }],
      };
      const { registry } = migrateToVersion7(reg);
      expect(registry.cases[0].proceedings[0].composition).toBeNull();
    });

    it('hearing отримує source/sourceConfidence/extractedAt/ecitsContext/assignedTo/attendedBy', () => {
      const reg = {
        schemaVersion: 6.5,
        cases: [{
          id: 'c1',
          hearings: [{ id: 'h1', date: '2026-06-01', time: '10:00' }],
        }],
      };
      const { registry } = migrateToVersion7(reg);
      const h = registry.cases[0].hearings[0];
      expect(h.source).toBe('manual');
      expect(h.sourceConfidence).toBe('high');
      expect(h.extractedAt).toBeNull();
      expect(h.ecitsContext).toBeNull();
      expect(h.assignedTo).toBeNull();
      expect(h.attendedBy).toEqual([]);
    });

    it('user отримує ecitsCabinetIdentifier: null', () => {
      const reg = {
        schemaVersion: 6.5,
        cases: [],
        users: [{ userId: 'olena' }, { userId: 'vadym' }],
      };
      const { registry } = migrateToVersion7(reg);
      expect(registry.users[0].ecitsCabinetIdentifier).toBeNull();
      expect(registry.users[1].ecitsCabinetIdentifier).toBeNull();
    });

    it("ідемпотентність: ecitsCabinetIdentifier що вже є — не перезаписується", () => {
      const reg = {
        schemaVersion: 6.5,
        cases: [],
        users: [{ userId: 'vadym', ecitsCabinetIdentifier: 'vadym_login' }],
      };
      const { registry } = migrateToVersion7(reg);
      expect(registry.users[0].ecitsCabinetIdentifier).toBe('vadym_login');
    });

    it("ідемпотентність: proceeding.composition що вже є — не перезаписується", () => {
      const composition = { presiding: { fullName: 'Іванов І.І.', userId: null }, reporter: null, members: [] };
      const reg = {
        schemaVersion: 6.5,
        cases: [{
          id: 'c1',
          proceedings: [{ id: 'p1', type: 'first', title: 'Main', composition }],
        }],
      };
      const { registry } = migrateToVersion7(reg);
      expect(registry.cases[0].proceedings[0].composition).toEqual(composition);
    });
  });

  it('lastMigration with from/to/at', () => {
    const reg = { schemaVersion: 6.5, cases: [], users: [{ userId: 'vadym' }] };
    const { registry } = migrateToVersion7(reg);
    expect(registry.lastMigration.from).toBe(6.5);
    expect(registry.lastMigration.to).toBe(7);
    expect(typeof registry.lastMigration.at).toBe('string');
  });

  it("реєстр без cases / без users не падає", () => {
    expect(() => migrateToVersion7({ schemaVersion: 6.5 })).not.toThrow();
  });
});

// ── sourcePolicy ──────────────────────────────────────────────────────────

describe('sourcePolicy.canOverwrite', () => {
  it('manual має найвищий пріоритет (100)', () => {
    expect(SOURCE_PRIORITY.manual).toBe(100);
  });

  it('court_sync (80) може перезаписати metadata_extractor (60)', () => {
    expect(canOverwrite('metadata_extractor', 'court_sync')).toBe(true);
  });

  it('metadata_extractor (60) НЕ може перезаписати court_sync (80)', () => {
    expect(canOverwrite('court_sync', 'metadata_extractor')).toBe(false);
  });

  it('manual (100) НЕ може бути перезаписаний нічим автоматично', () => {
    expect(canOverwrite('manual', 'court_sync')).toBe(false);
    expect(canOverwrite('manual', 'metadata_extractor')).toBe(false);
    expect(canOverwrite('manual', 'telegram')).toBe(false);
  });

  it('null existing — завжди дозволяємо перший запис', () => {
    expect(canOverwrite(null, 'court_sync')).toBe(true);
    expect(canOverwrite(undefined, 'manual')).toBe(true);
  });

  it('unknown (10) має найнижчий пріоритет', () => {
    expect(SOURCE_PRIORITY.unknown).toBe(10);
    expect(canOverwrite('telegram', 'unknown')).toBe(false);
  });

  it('telegram і email мають однаковий пріоритет (50, не перезаписують одне одного)', () => {
    expect(canOverwrite('telegram', 'email')).toBe(false);
    expect(canOverwrite('email', 'telegram')).toBe(false);
  });
});

describe('sourcePolicy.hashData', () => {
  it('детермінований хеш для однакового input', () => {
    expect(hashData({ a: 1, b: 2 })).toBe(hashData({ a: 1, b: 2 }));
  });

  it("різні input — різні хеші", () => {
    expect(hashData({ a: 1 })).not.toBe(hashData({ a: 2 }));
  });

  it("повертає hex-рядок", () => {
    expect(typeof hashData('test')).toBe('string');
    expect(hashData('test')).toMatch(/^[0-9a-f]+$/);
  });
});

describe('sourcePolicy.buildAlternativeSourceRecord', () => {
  it('повертає запис з усіма очікуваними полями', () => {
    const rec = buildAlternativeSourceRecord('telegram', 'medium', { foo: 'bar' });
    expect(rec.source).toBe('telegram');
    expect(rec.sourceConfidence).toBe('medium');
    expect(rec.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof rec.dataHash).toBe('string');
  });

  it('null sourceConfidence — приймається', () => {
    const rec = buildAlternativeSourceRecord('unknown', null, { x: 1 });
    expect(rec.sourceConfidence).toBeNull();
  });
});

// ── caseSchema ────────────────────────────────────────────────────────────

describe('caseSchema (TASK 0.3.5 v7)', () => {
  it('експортує CANONICAL_CASE_FIELDS з ключовими новими полями', () => {
    expect(CANONICAL_CASE_FIELDS.ecitsState).toBeDefined();
    expect(CANONICAL_CASE_FIELDS.parties).toBeDefined();
    expect(CANONICAL_CASE_FIELDS.processParticipants).toBeDefined();
    expect(CANONICAL_CASE_FIELDS.team).toBeDefined();
  });

  it('CANONICAL_PROCEEDING_FIELDS має composition', () => {
    expect(CANONICAL_PROCEEDING_FIELDS.composition).toBeDefined();
  });

  it('CURRENT_CASE_SCHEMA_VERSION === 7', () => {
    expect(CURRENT_CASE_SCHEMA_VERSION).toBe(7);
  });

  it('DEPRECATED_CASE_FIELDS перелічує deprecated denormalized fields', () => {
    expect(DEPRECATED_CASE_FIELDS).toContain('client');
    expect(DEPRECATED_CASE_FIELDS).toContain('judge');
  });

  it('DEPRECATED_PROCEEDING_FIELDS перелічує judges', () => {
    expect(DEPRECATED_PROCEEDING_FIELDS).toContain('judges');
  });

  it('hasMinimumCaseFields повертає true для валідного case', () => {
    expect(hasMinimumCaseFields({
      id: 'case_1', name: 'Test', tenantId: 'ab', ownerId: 'vadym', team: [],
    })).toBe(true);
    expect(hasMinimumCaseFields({})).toBe(false);
    expect(hasMinimumCaseFields(null)).toBe(false);
  });

  it('hasMinimumProceedingFields', () => {
    expect(hasMinimumProceedingFields({ id: 'p1', type: 'first', title: 'Main' })).toBe(true);
    expect(hasMinimumProceedingFields({ id: 'p1' })).toBe(false);
  });
});

// ── hearingSchema ────────────────────────────────────────────────────────

describe('hearingSchema (TASK 0.3.5 v7)', () => {
  it('має v7 поля: source, sourceConfidence, extractedAt, ecitsContext, assignedTo, attendedBy', () => {
    expect(CANONICAL_HEARING_FIELDS.source).toBeDefined();
    expect(CANONICAL_HEARING_FIELDS.sourceConfidence).toBeDefined();
    expect(CANONICAL_HEARING_FIELDS.extractedAt).toBeDefined();
    expect(CANONICAL_HEARING_FIELDS.ecitsContext).toBeDefined();
    expect(CANONICAL_HEARING_FIELDS.assignedTo).toBeDefined();
    expect(CANONICAL_HEARING_FIELDS.attendedBy).toBeDefined();
  });

  it('CURRENT_HEARING_SCHEMA_VERSION === 7', () => {
    expect(CURRENT_HEARING_SCHEMA_VERSION).toBe(7);
  });

  it('hasMinimumHearingFields', () => {
    expect(hasMinimumHearingFields({ id: 'h1', date: '2026-06-01', time: '10:00' })).toBe(true);
    expect(hasMinimumHearingFields({ id: 'h1' })).toBe(false);
  });

  it("isSystemSourced: court_sync і metadata_extractor → true", () => {
    expect(isSystemSourced({ source: 'court_sync' })).toBe(true);
    expect(isSystemSourced({ source: 'metadata_extractor' })).toBe(true);
  });

  it("isSystemSourced: manual і unknown → false", () => {
    expect(isSystemSourced({ source: 'manual' })).toBe(false);
    expect(isSystemSourced({ source: 'unknown' })).toBe(false);
  });
});

// ── eventBusTopics ───────────────────────────────────────────────────────

describe('eventBusTopics — нові v7 топіки', () => {
  it('експортує 2 sync події', () => {
    expect(ECITS_SYNC_COMPLETED).toBe('ecits.sync_completed');
    expect(ECITS_CASE_STATE_UPDATED).toBe('ecits.case_state_updated');
  });

  it('експортує 6 edit-топіків', () => {
    expect(CASE_PARTIES_UPDATED).toBe('case.parties_updated');
    expect(CASE_TEAM_UPDATED).toBe('case.team_updated');
    expect(CASE_PROCESS_PARTICIPANTS_UPDATED).toBe('case.process_participants_updated');
    expect(PROCEEDING_COMPOSITION_UPDATED).toBe('proceeding.composition_updated');
    expect(DOCUMENT_MOVEMENT_CARD_UPDATED).toBe('document.movement_card_updated');
    expect(DOCUMENT_ALTERNATIVE_SOURCE_ADDED).toBe('document.alternative_source_added');
  });

  it('V7_EDIT_TOPICS — frozen array з 6 елементами', () => {
    expect(Object.isFrozen(V7_EDIT_TOPICS)).toBe(true);
    expect(V7_EDIT_TOPICS).toHaveLength(6);
  });

  it("ECITS_TOPICS включає нові sync події (загалом 6)", () => {
    expect(ECITS_TOPICS).toHaveLength(6);
    expect(ECITS_TOPICS).toContain(ECITS_SYNC_COMPLETED);
    expect(ECITS_TOPICS).toContain(ECITS_CASE_STATE_UPDATED);
  });

  it('експортує 2 document-lifecycle топіки (TASK 3)', () => {
    expect(DOCUMENT_INGESTED).toBe('document.ingested');
    expect(DOCUMENT_BATCH_PROCESSED).toBe('document.batch_processed');
  });

  it('DOCUMENT_TOPICS — frozen array з 4 елементами', () => {
    expect(Object.isFrozen(DOCUMENT_TOPICS)).toBe(true);
    expect(DOCUMENT_TOPICS).toHaveLength(4);
    expect(DOCUMENT_TOPICS).toContain(DOCUMENT_INGESTED);
    expect(DOCUMENT_TOPICS).toContain(DOCUMENT_BATCH_PROCESSED);
    expect(DOCUMENT_TOPICS).toContain(DOCUMENT_MOVEMENT_CARD_UPDATED);
    expect(DOCUMENT_TOPICS).toContain(DOCUMENT_ALTERNATIVE_SOURCE_ADDED);
  });
});
