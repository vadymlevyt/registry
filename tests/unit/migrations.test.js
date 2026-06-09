// Юніт-тести міграції v4 → v5 канонічної схеми документів + v6 → v6.5 (addedBy cleanup).
import { describe, it, expect, vi } from 'vitest';
import {
  migrateRegistryV4toV5,
  splitDocumentV4toV5,
} from '../../src/services/migrations/v4ToV5.js';
import { migrateToVersion6_5, migrateToVersion8, migrateToVersion9, migrateToVersion10, migrateToVersion11, migrateToVersion12, ensureCaseSaasAndEcitsFields, buildDefaultEcitsState, CURRENT_SCHEMA_VERSION, MIGRATION_VERSION } from '../../src/services/migrationService.js';
import { validateDocument } from '../../src/services/documentFactory.js';

describe('v4ToV5 migration', () => {
  describe('splitDocumentV4toV5', () => {
    it('повертає canonical (валідний) і extended', () => {
      const old = { id: 'doc_1', name: 'Test', size: 100, driveId: 'd1' };
      const { canonical, extended } = splitDocumentV4toV5(old);
      expect(validateDocument(canonical).valid).toBe(true);
      expect(extended).toBeNull(); // тут жодних extended-полів
    });

    it("converts number id у string у форматі canonical", () => {
      const old = { id: 12345, name: 'X' };
      const { canonical } = splitDocumentV4toV5(old);
      expect(typeof canonical.id).toBe('string');
      expect(canonical.id).toBe('12345');
    });

    it('legacy author "opp" → canonical "opponent"', () => {
      const old = { id: 'd', name: 'X', author: 'opp' };
      const { canonical } = splitDocumentV4toV5(old);
      expect(canonical.author).toBe('opponent');
    });

    it('тег "key" → isKey: true і прибирається з tags', () => {
      const old = { id: 'd', name: 'X', tags: ['key', 'urgent'] };
      const { canonical, extended } = splitDocumentV4toV5(old);
      expect(canonical.isKey).toBe(true);
      expect(extended.tags).toEqual(['urgent']);
    });

    it('тег "ключовий" → isKey: true (українська legacy)', () => {
      const old = { id: 'd', name: 'X', tags: ['ключовий'] };
      const { canonical } = splitDocumentV4toV5(old);
      expect(canonical.isKey).toBe(true);
    });

    it('scanned: true → documentNature: scanned', () => {
      const old = { id: 'd', name: 'X', scanned: true };
      const { canonical } = splitDocumentV4toV5(old);
      expect(canonical.documentNature).toBe('scanned');
    });

    it('legacy date (text "березень 2023") → customFields.legacyDateText, canonical.date=null', () => {
      const old = { id: 'd', name: 'X', date: 'березень 2023' };
      const { canonical, extended } = splitDocumentV4toV5(old);
      expect(canonical.date).toBeNull();
      expect(extended.customFields.legacyDateText).toBe('березень 2023');
    });

    it('ISO date зберігається в canonical.date', () => {
      const old = { id: 'd', name: 'X', date: '2024-03-15' };
      const { canonical, extended } = splitDocumentV4toV5(old);
      expect(canonical.date).toBe('2024-03-15');
      expect(extended).toBeNull();
    });

    it('невідомі поля → extended.customFields', () => {
      const old = { id: 'd', name: 'X', someUnknownField: 'value', anotherOne: 42 };
      const { extended } = splitDocumentV4toV5(old);
      expect(extended.customFields.someUnknownField).toBe('value');
      expect(extended.customFields.anotherOne).toBe(42);
    });

    it("addedBy за замовчуванням 'system' (TASK 0.3.4 — migration legacy → system)", () => {
      const old = { id: 'd', name: 'X' };
      const { canonical } = splitDocumentV4toV5(old);
      // v4ToV5 передає 'system' як default; createDocument нормалізує legacy
      // 'migration' теж → 'system' (через ADDEDBY_LEGACY_MAP).
      expect(canonical.addedBy).toBe('system');
    });

    it('extended.notes / annotations / processingHistory зберігаються', () => {
      const old = {
        id: 'd', name: 'X',
        notes: 'мої замітки',
        annotations: [{ x: 1 }],
        processingHistory: [{ event: 'ocr' }],
      };
      const { extended } = splitDocumentV4toV5(old);
      expect(extended.notes).toBe('мої замітки');
      expect(extended.annotations).toEqual([{ x: 1 }]);
      expect(extended.processingHistory).toEqual([{ event: 'ocr' }]);
    });
  });

  describe('migrateRegistryV4toV5', () => {
    it('schemaVersion: 4 → 5 + settingsVersion оновлюється', () => {
      const reg = {
        schemaVersion: 4,
        cases: [{ id: 'c1', documents: [{ id: 'd', name: 'X' }] }],
      };
      const result = migrateRegistryV4toV5(reg);
      expect(result.didMigrate).toBe(true);
      expect(result.fromVersion).toBe(4);
      expect(result.toVersion).toBe(5);
      expect(result.registry.schemaVersion).toBe(5);
      expect(result.registry.settingsVersion).toBe('5.0_canonical_documents');
    });

    it('ідемпотентна — повторний запуск з v5 не змінює реєстр', () => {
      const reg = {
        schemaVersion: 5,
        settingsVersion: '5.0_canonical_documents',
        cases: [],
      };
      const result = migrateRegistryV4toV5(reg);
      expect(result.didMigrate).toBe(false);
    });

    it('документи всіх справ переводяться на canonical', () => {
      const reg = {
        schemaVersion: 4,
        cases: [
          { id: 'c1', documents: [{ id: 'd1', name: 'A' }, { id: 'd2', name: 'B' }] },
          { id: 'c2', documents: [{ id: 'd3', name: 'C' }] },
        ],
      };
      const { registry } = migrateRegistryV4toV5(reg);
      expect(registry.cases[0].documents.every(d => validateDocument(d).valid)).toBe(true);
      expect(registry.cases[1].documents.every(d => validateDocument(d).valid)).toBe(true);
    });

    it('extendedByCase містить мапу caseId → { docId → extended }', () => {
      const reg = {
        schemaVersion: 4,
        cases: [{
          id: 'c1',
          documents: [{ id: 'd1', name: 'X', tags: ['urgent'], notes: 'note' }],
        }],
      };
      const { extendedByCase } = migrateRegistryV4toV5(reg);
      expect(extendedByCase.c1).toBeDefined();
      expect(extendedByCase.c1.d1).toBeDefined();
      expect(extendedByCase.c1.d1.tags).toEqual(['urgent']);
      expect(extendedByCase.c1.d1.notes).toBe('note');
    });

    it('реєстр без cases не падає', () => {
      const reg = { schemaVersion: 4 };
      expect(() => migrateRegistryV4toV5(reg)).not.toThrow();
    });

    it('cases без documents — справа лишається без змін', () => {
      const reg = {
        schemaVersion: 4,
        cases: [{ id: 'c1', name: 'Без доків' }],
      };
      const { registry } = migrateRegistryV4toV5(reg);
      expect(registry.cases[0].id).toBe('c1');
    });
  });
});

// ── TASK 0.3.4: migrateToVersion6_5 (addedBy semantic cleanup) ───────────────
describe('migrateToVersion6_5 (v6 → v6.5 addedBy cleanup)', () => {
  it('schemaVersion: 6 → 6.5 + settingsVersion оновлюється', () => {
    const reg = { schemaVersion: 6, cases: [] };
    const res = migrateToVersion6_5(reg);
    expect(res.didMigrate).toBe(true);
    expect(res.fromVersion).toBe(6);
    expect(res.toVersion).toBe(6.5);
    expect(res.registry.schemaVersion).toBe(6.5);
    expect(res.registry.settingsVersion).toBe('6.5_addedby_cleanup');
  });

  it('ідемпотентна — повторний запуск з v6.5 не змінює реєстр', () => {
    const reg = {
      schemaVersion: 6.5,
      settingsVersion: '6.5_addedby_cleanup',
      cases: [],
    };
    const res = migrateToVersion6_5(reg);
    expect(res.didMigrate).toBe(false);
    expect(res.registry).toBe(reg);
  });

  it("lawyer_via_dp / lawyer_manual → 'user'", () => {
    const reg = {
      schemaVersion: 6,
      cases: [{
        id: 'c1',
        documents: [
          { id: 'd1', name: 'A', addedBy: 'lawyer_via_dp' },
          { id: 'd2', name: 'B', addedBy: 'lawyer_manual' },
        ],
      }],
    };
    const { registry, stats } = migrateToVersion6_5(reg);
    expect(registry.cases[0].documents[0].addedBy).toBe('user');
    expect(registry.cases[0].documents[1].addedBy).toBe('user');
    expect(stats.lawyer_via_dp).toBe(1);
    expect(stats.lawyer_manual).toBe(1);
  });

  it("ecits / migration → 'system'", () => {
    const reg = {
      schemaVersion: 6,
      cases: [{
        id: 'c1',
        documents: [
          { id: 'd1', name: 'A', addedBy: 'ecits' },
          { id: 'd2', name: 'B', addedBy: 'migration' },
        ],
      }],
    };
    const { registry, stats } = migrateToVersion6_5(reg);
    expect(registry.cases[0].documents[0].addedBy).toBe('system');
    expect(registry.cases[0].documents[1].addedBy).toBe('system');
    expect(stats.ecits).toBe(1);
    expect(stats.migration).toBe(1);
  });

  it("agent → agent (без зміни)", () => {
    const reg = {
      schemaVersion: 6,
      cases: [{ id: 'c1', documents: [{ id: 'd1', name: 'A', addedBy: 'agent' }] }],
    };
    const { registry, stats } = migrateToVersion6_5(reg);
    expect(registry.cases[0].documents[0].addedBy).toBe('agent');
    expect(stats.agent_unchanged).toBe(1);
  });

  it("null/undefined → 'user'", () => {
    const reg = {
      schemaVersion: 6,
      cases: [{
        id: 'c1',
        documents: [
          { id: 'd1', name: 'A', addedBy: null },
          { id: 'd2', name: 'B' /* undefined */ },
        ],
      }],
    };
    const { registry, stats } = migrateToVersion6_5(reg);
    expect(registry.cases[0].documents[0].addedBy).toBe('user');
    expect(registry.cases[0].documents[1].addedBy).toBe('user');
    expect(stats.nullToUser).toBe(2);
  });

  it("невідоме значення → 'user' з warning", () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = {
      schemaVersion: 6,
      cases: [{ id: 'c1', documents: [{ id: 'd1', name: 'A', addedBy: 'mystery_value' }] }],
    };
    const { registry, stats } = migrateToVersion6_5(reg);
    expect(registry.cases[0].documents[0].addedBy).toBe('user');
    expect(stats.unknownToUser).toBe(1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('mystery_value'));
    spy.mockRestore();
  });

  it("ідемпотентність на рівні значень: user/system/agent вже мігровані → unchanged", () => {
    const reg = {
      schemaVersion: 6,
      cases: [{
        id: 'c1',
        documents: [
          { id: 'd1', name: 'A', addedBy: 'user' },
          { id: 'd2', name: 'B', addedBy: 'system' },
          { id: 'd3', name: 'C', addedBy: 'agent' },
        ],
      }],
    };
    const { registry, stats } = migrateToVersion6_5(reg);
    expect(registry.cases[0].documents[0].addedBy).toBe('user');
    expect(registry.cases[0].documents[1].addedBy).toBe('system');
    expect(registry.cases[0].documents[2].addedBy).toBe('agent');
    expect(stats.user_unchanged + stats.system_unchanged + stats.agent_unchanged).toBe(3);
  });

  it("реєстр без cases не падає", () => {
    expect(() => migrateToVersion6_5({ schemaVersion: 6 })).not.toThrow();
  });

  it("case без documents — пропускається без шкоди", () => {
    const reg = { schemaVersion: 6, cases: [{ id: 'c1', name: 'no docs' }] };
    const { registry } = migrateToVersion6_5(reg);
    expect(registry.cases[0].id).toBe('c1');
  });

  it("додає lastMigration з from/to/at", () => {
    const reg = { schemaVersion: 6, cases: [] };
    const { registry } = migrateToVersion6_5(reg);
    expect(registry.lastMigration.from).toBe(6);
    expect(registry.lastMigration.to).toBe(6.5);
    expect(typeof registry.lastMigration.at).toBe('string');
  });
});

// ── TASK 2: migrateToVersion8 (time_entry.source → captureMethod) ────────────
describe('migrateToVersion8 (v7 → v8 time_entry.source → captureMethod)', () => {
  it('перейменовує source → captureMethod, прибирає source, інші поля цілі', () => {
    const reg = {
      schemaVersion: 7,
      time_entries: [
        { id: 'te_1', duration: 60, source: 'instrumentation', caseId: 'case_1' },
        { id: 'te_2', duration: 30, source: 'manual_assign' },
      ],
    };
    const { registry, didMigrate, stats } = migrateToVersion8(reg);
    expect(didMigrate).toBe(true);
    expect(registry.schemaVersion).toBe(8);
    expect(registry.settingsVersion).toBe('8.0_time_entry_capture_method');
    const [a, b] = registry.time_entries;
    expect(a.captureMethod).toBe('instrumentation');
    expect('source' in a).toBe(false);
    expect(a.duration).toBe(60);
    expect(a.caseId).toBe('case_1');
    expect(b.captureMethod).toBe('manual_assign');
    expect(stats.renamed).toBe(2);
    expect(registry.lastMigration).toMatchObject({ from: 7, to: 8 });
  });

  it('ідемпотентна на рівні registry: v8 → didMigrate false', () => {
    const reg = { schemaVersion: 8, time_entries: [{ id: 'te_1', captureMethod: 'manual' }] };
    const res = migrateToVersion8(reg);
    expect(res.didMigrate).toBe(false);
    expect(res.stats).toBeNull();
    expect(res.registry).toBe(reg);
  });

  it('ідемпотентна на рівні запису: вже captureMethod — не чіпає, stray source прибирає', () => {
    const reg = {
      schemaVersion: 7,
      time_entries: [
        { id: 'te_1', captureMethod: 'timer' },
        { id: 'te_2', captureMethod: 'manual', source: 'manual' },
      ],
    };
    const { registry, stats } = migrateToVersion8(reg);
    expect(registry.time_entries[0].captureMethod).toBe('timer');
    expect('source' in registry.time_entries[1]).toBe(false);
    expect(registry.time_entries[1].captureMethod).toBe('manual');
    expect(stats.alreadyCaptureMethod).toBe(2);
    expect(stats.renamed).toBe(0);
  });

  it('registry без time_entries не падає, version бампиться', () => {
    const reg = { schemaVersion: 7, cases: [] };
    const { registry, didMigrate, stats } = migrateToVersion8(reg);
    expect(didMigrate).toBe(true);
    expect(registry.schemaVersion).toBe(8);
    expect(registry.time_entries).toBeUndefined();
    expect(stats.total).toBe(0);
  });

  it('запис без source і без captureMethod лишається як є (noField)', () => {
    const reg = { schemaVersion: 7, time_entries: [{ id: 'te_x', duration: 10 }] };
    const { registry, stats } = migrateToVersion8(reg);
    expect(registry.time_entries[0]).toEqual({ id: 'te_x', duration: 10 });
    expect(stats.noField).toBe(1);
  });
});

describe('migrateToVersion9 — case.origin enum (TASK 0.4)', () => {
  it('таргет повного ланцюга піднято до v12 (TASK v12) — v9 проміжний', () => {
    // Глобальний таргет тепер v12 (ECITS contract extension). v9 (case.origin)
    // — проміжний крок ланцюга; його власні інваріанти перевіряються нижче.
    expect(CURRENT_SCHEMA_VERSION).toBe(12);
    expect(MIGRATION_VERSION).toBe('12.0_ecits_roles_dates');
  });

  it('існуючі справи (v8) отримують origin: "manual"', () => {
    const reg = {
      schemaVersion: 8,
      cases: [
        { id: 'case_1', name: 'A' },
        { id: 'case_2', name: 'B' },
      ],
    };
    const { registry, didMigrate, toVersion, stats } = migrateToVersion9(reg);
    expect(didMigrate).toBe(true);
    expect(toVersion).toBe(9);
    expect(registry.schemaVersion).toBe(9);
    expect(registry.settingsVersion).toBe('9.0_case_origin');
    expect(registry.cases[0].origin).toBe('manual');
    expect(registry.cases[1].origin).toBe('manual');
    expect(stats.originAdded).toBe(2);
    expect(stats.originAlreadySet).toBe(0);
  });

  it('ідемпотентна: з v9 повертає didMigrate=false і нічого не змінює', () => {
    const reg = { schemaVersion: 9, cases: [{ id: 'c', origin: 'manual' }] };
    const { didMigrate, registry } = migrateToVersion9(reg);
    expect(didMigrate).toBe(false);
    expect(registry).toBe(reg);
  });

  it('не перезаписує origin якщо вже встановлено валідне значення', () => {
    const reg = {
      schemaVersion: 8,
      cases: [
        { id: 'c1', origin: 'ecits_import' },
        { id: 'c2', origin: 'manual' },
        { id: 'c3' /* немає origin */ },
      ],
    };
    const { registry, stats } = migrateToVersion9(reg);
    expect(registry.cases[0].origin).toBe('ecits_import');
    expect(registry.cases[1].origin).toBe('manual');
    expect(registry.cases[2].origin).toBe('manual');
    expect(stats.originAlreadySet).toBe(2);
    expect(stats.originAdded).toBe(1);
  });

  it('фіксує lastMigration { from, to, at }', () => {
    const { registry } = migrateToVersion9({ schemaVersion: 8, cases: [] });
    expect(registry.lastMigration.from).toBe(8);
    expect(registry.lastMigration.to).toBe(9);
    expect(typeof registry.lastMigration.at).toBe('string');
  });
});

describe('ensureCaseSaasAndEcitsFields — R1 fix (TASK 0.4)', () => {
  it('додає ecitsState, parties[], processParticipants[], origin до нової справи', () => {
    const c = ensureCaseSaasAndEcitsFields({ id: 'case_new', name: 'X' });
    expect(c.ecitsState).toBeDefined();
    expect(c.ecitsState.syncStatus).toBe('never');
    expect(c.ecitsState.syncMetrics).toBeDefined();
    expect(Array.isArray(c.parties)).toBe(true);
    expect(Array.isArray(c.processParticipants)).toBe(true);
    expect(c.origin).toBe('manual');
  });

  it('зберігає передане origin', () => {
    const c = ensureCaseSaasAndEcitsFields({ id: 'c', origin: 'ecits_import' });
    expect(c.origin).toBe('ecits_import');
  });

  it('відкидає невалідне origin і ставить "manual"', () => {
    const c = ensureCaseSaasAndEcitsFields({ id: 'c', origin: 'malicious_value' });
    expect(c.origin).toBe('manual');
  });

  it('зберігає передане ecitsState (доповнюючи v12 датами, якщо їх немає)', () => {
    const ec = { caseId: 'hex', syncStatus: 'synced' };
    const c = ensureCaseSaasAndEcitsFields({ id: 'c', ecitsState: ec });
    // TASK v12: коли вхідний ecitsState не має нових дат, ensureCaseSaasAndEcitsFields
    // повертає новий об'єкт із null-дефолтами поверх переданих полів.
    expect(c.ecitsState).toMatchObject({ caseId: 'hex', syncStatus: 'synced' });
    expect(c.ecitsState.firstDocumentDate).toBeNull();
    expect(c.ecitsState.lastDocumentDate).toBeNull();
  });

  it('не перетирає вже виставлені v12 дати у переданому ecitsState', () => {
    const ec = {
      caseId: 'hex',
      syncStatus: 'synced',
      firstDocumentDate: '2025-01-15',
      lastDocumentDate: '2026-05-30',
    };
    const c = ensureCaseSaasAndEcitsFields({ id: 'c', ecitsState: ec });
    expect(c.ecitsState).toBe(ec);
  });

  it('додає SaaS поля (tenantId, ownerId, team, shareType)', () => {
    const c = ensureCaseSaasAndEcitsFields({ id: 'c', name: 'X' });
    expect(c.tenantId).toBeTruthy();
    expect(c.ownerId).toBeTruthy();
    expect(Array.isArray(c.team)).toBe(true);
    expect(c.shareType).toBeTruthy();
  });
});

describe('migrateToVersion10 — document.textFormat/cleanedAt (TASK 3.1)', () => {
  it('існуючі документи (v9) отримують textFormat="txt", cleanedAt=null', () => {
    const reg = {
      schemaVersion: 9,
      cases: [
        { id: 'case_1', documents: [{ id: 'doc_1', name: 'A' }, { id: 'doc_2', name: 'B' }] },
        { id: 'case_2', documents: [] },
      ],
    };
    const { registry, didMigrate, toVersion } = migrateToVersion10(reg);
    expect(didMigrate).toBe(true);
    expect(toVersion).toBe(10);
    expect(registry.schemaVersion).toBe(10);
    expect(registry.settingsVersion).toBe('10.0_text_format');
    for (const d of registry.cases[0].documents) {
      expect(d.textFormat).toBe('txt');
      expect(d.cleanedAt).toBeNull();
    }
  });

  it('ідемпотентна: повторний запуск з v10 → didMigrate=false, без змін', () => {
    const reg = {
      schemaVersion: 10,
      cases: [{ id: 'c', documents: [{ id: 'd', name: 'X', textFormat: 'md', cleanedAt: '2026-06-01T00:00:00Z' }] }],
    };
    const { didMigrate, registry } = migrateToVersion10(reg);
    expect(didMigrate).toBe(false);
    expect(registry.cases[0].documents[0].textFormat).toBe('md');
    expect(registry.cases[0].documents[0].cleanedAt).toBe('2026-06-01T00:00:00Z');
  });

  it('не затирає вже виставлений textFormat="md" при міграції з v9', () => {
    const reg = {
      schemaVersion: 9,
      cases: [{ id: 'c', documents: [{ id: 'd', name: 'X', textFormat: 'md', cleanedAt: '2026-05-30T10:00:00Z' }] }],
    };
    const { registry } = migrateToVersion10(reg);
    expect(registry.cases[0].documents[0].textFormat).toBe('md');
    expect(registry.cases[0].documents[0].cleanedAt).toBe('2026-05-30T10:00:00Z');
  });

  it('lastMigration.to === 10', () => {
    const { registry } = migrateToVersion10({ schemaVersion: 9, cases: [] });
    expect(registry.lastMigration.to).toBe(10);
  });

  it('stats рахує totalDocs / textFormatAdded', () => {
    const reg = { schemaVersion: 9, cases: [{ id: 'c', documents: [{ id: 'a' }, { id: 'b' }] }] };
    const { stats } = migrateToVersion10(reg);
    expect(stats.totalDocs).toBe(2);
    expect(stats.textFormatAdded).toBe(2);
  });

  it('справи без documents[] не падають', () => {
    const { registry, didMigrate } = migrateToVersion10({ schemaVersion: 9, cases: [{ id: 'c', name: 'no docs' }] });
    expect(didMigrate).toBe(true);
    expect(registry.cases[0].name).toBe('no docs');
  });
});

describe('migrateToVersion11 — document.variants (TASK V2-A2)', () => {
  it('існуючі документи (v10) отримують variants={clean:null,digest:null}', () => {
    const reg = {
      schemaVersion: 10,
      cases: [
        { id: 'c1', documents: [{ id: 'd1', name: 'A', textFormat: 'txt', cleanedAt: null }] },
        { id: 'c2', documents: [] },
      ],
    };
    const { registry, didMigrate, toVersion } = migrateToVersion11(reg);
    expect(didMigrate).toBe(true);
    expect(toVersion).toBe(11);
    expect(registry.schemaVersion).toBe(11);
    expect(registry.settingsVersion).toBe('11.0_text_variants');
    expect(registry.cases[0].documents[0].variants).toEqual({ clean: null, digest: null });
  });

  it('backward-compat: textFormat==="md" → variants.digest = cleanedAt', () => {
    const reg = {
      schemaVersion: 10,
      cases: [{ id: 'c', documents: [{ id: 'd', name: 'X', textFormat: 'md', cleanedAt: '2026-06-01T00:00:00Z' }] }],
    };
    const { registry, stats } = migrateToVersion11(reg);
    expect(registry.cases[0].documents[0].variants).toEqual({ clean: null, digest: '2026-06-01T00:00:00Z' });
    expect(stats.digestBackfilled).toBe(1);
  });

  it('textFormat==="md" без cleanedAt → variants.digest=null (не undefined)', () => {
    const reg = { schemaVersion: 10, cases: [{ id: 'c', documents: [{ id: 'd', name: 'X', textFormat: 'md' }] }] };
    const { registry } = migrateToVersion11(reg);
    expect(registry.cases[0].documents[0].variants).toEqual({ clean: null, digest: null });
  });

  it('ідемпотентна: повторний запуск з v11 → didMigrate=false, без змін', () => {
    const reg = {
      schemaVersion: 11,
      cases: [{ id: 'c', documents: [{ id: 'd', name: 'X', variants: { clean: null, digest: '2026-06-01T00:00:00Z' } }] }],
    };
    const { didMigrate, registry } = migrateToVersion11(reg);
    expect(didMigrate).toBe(false);
    expect(registry).toBe(reg);
  });

  it('не затирає вже виставлений variants при міграції з v10', () => {
    const existing = { clean: '2026-05-30T10:00:00Z', digest: null };
    const reg = { schemaVersion: 10, cases: [{ id: 'c', documents: [{ id: 'd', name: 'X', variants: existing }] }] };
    const { registry, stats } = migrateToVersion11(reg);
    expect(registry.cases[0].documents[0].variants).toBe(existing);
    expect(stats.variantsAlreadySet).toBe(1);
  });

  it('lastMigration.to === 11', () => {
    const { registry } = migrateToVersion11({ schemaVersion: 10, cases: [] });
    expect(registry.lastMigration.to).toBe(11);
  });

  it('справи без documents[] не падають', () => {
    const { registry, didMigrate } = migrateToVersion11({ schemaVersion: 10, cases: [{ id: 'c', name: 'no docs' }] });
    expect(didMigrate).toBe(true);
    expect(registry.cases[0].name).toBe('no docs');
  });
});

describe('migrateToVersion12 — ECITS contract extension (TASK v12)', () => {
  it('CURRENT_SCHEMA_VERSION/MIGRATION_VERSION оновлено до v12', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(12);
    expect(MIGRATION_VERSION).toBe('12.0_ecits_roles_dates');
  });

  it('усі справи отримують advocateRole=null і advocateRoles=[]', () => {
    const reg = {
      schemaVersion: 11,
      cases: [
        { id: 'c1', name: 'A', ecitsState: buildDefaultEcitsState() },
        { id: 'c2', name: 'B', ecitsState: buildDefaultEcitsState() },
      ],
    };
    const { registry, didMigrate, toVersion } = migrateToVersion12(reg);
    expect(didMigrate).toBe(true);
    expect(toVersion).toBe(12);
    expect(registry.schemaVersion).toBe(12);
    expect(registry.settingsVersion).toBe('12.0_ecits_roles_dates');
    expect(registry.cases[0].advocateRole).toBeNull();
    expect(registry.cases[0].advocateRoles).toEqual([]);
    expect(registry.cases[1].advocateRole).toBeNull();
    expect(registry.cases[1].advocateRoles).toEqual([]);
  });

  it('одиночний advocateRole → backfill у advocateRoles=[role]', () => {
    const reg = {
      schemaVersion: 11,
      cases: [{
        id: 'c', name: 'X',
        ecitsState: buildDefaultEcitsState(),
        advocateRole: 'defender',
      }],
    };
    const { registry, stats } = migrateToVersion12(reg);
    expect(registry.cases[0].advocateRole).toBe('defender');
    expect(registry.cases[0].advocateRoles).toEqual(['defender']);
    expect(stats.advocateRolesBackfilledFromSingle).toBe(1);
  });

  it('існуючі advocateRoles[] не перетираються', () => {
    const reg = {
      schemaVersion: 11,
      cases: [{
        id: 'c', name: 'X',
        ecitsState: buildDefaultEcitsState(),
        advocateRole: 'plaintiff_rep',
        advocateRoles: ['plaintiff_rep', 'advocate'],
      }],
    };
    const { registry } = migrateToVersion12(reg);
    expect(registry.cases[0].advocateRoles).toEqual(['plaintiff_rep', 'advocate']);
  });

  it('ecitsState отримує firstDocumentDate і lastDocumentDate як null', () => {
    const stateNoDates = { ...buildDefaultEcitsState() };
    delete stateNoDates.firstDocumentDate;
    delete stateNoDates.lastDocumentDate;
    const reg = {
      schemaVersion: 11,
      cases: [{ id: 'c', name: 'X', ecitsState: stateNoDates }],
    };
    const { registry, stats } = migrateToVersion12(reg);
    expect(registry.cases[0].ecitsState.firstDocumentDate).toBeNull();
    expect(registry.cases[0].ecitsState.lastDocumentDate).toBeNull();
    expect(stats.ecitsStateExtended).toBe(1);
  });

  it('існуючі ecitsState-дати не перетираються', () => {
    const reg = {
      schemaVersion: 11,
      cases: [{
        id: 'c', name: 'X',
        ecitsState: {
          ...buildDefaultEcitsState(),
          firstDocumentDate: '2025-01-15',
          lastDocumentDate: '2026-05-30',
        },
      }],
    };
    const { registry, stats } = migrateToVersion12(reg);
    expect(registry.cases[0].ecitsState.firstDocumentDate).toBe('2025-01-15');
    expect(registry.cases[0].ecitsState.lastDocumentDate).toBe('2026-05-30');
    expect(stats.ecitsStateAlreadyHasDates).toBe(1);
  });

  it('ідемпотентна: повторний запуск з v12 → didMigrate=false', () => {
    const reg = {
      schemaVersion: 12,
      cases: [{
        id: 'c', name: 'X',
        advocateRole: null,
        advocateRoles: [],
        ecitsState: buildDefaultEcitsState(),
      }],
    };
    const { didMigrate, registry } = migrateToVersion12(reg);
    expect(didMigrate).toBe(false);
    expect(registry).toBe(reg);
  });

  it('справа без ecitsState не падає (можлива у старих legacy snapshot)', () => {
    const reg = { schemaVersion: 11, cases: [{ id: 'c', name: 'no ecitsState' }] };
    const { registry, didMigrate } = migrateToVersion12(reg);
    expect(didMigrate).toBe(true);
    expect(registry.cases[0].advocateRole).toBeNull();
    expect(registry.cases[0].advocateRoles).toEqual([]);
  });

  it('lastMigration.to === 12', () => {
    const { registry } = migrateToVersion12({ schemaVersion: 11, cases: [] });
    expect(registry.lastMigration.to).toBe(12);
  });

  it('ensureCaseSaasAndEcitsFields дає v12-дефолти новій справі', () => {
    const c = { id: 'new', name: 'New' };
    const out = ensureCaseSaasAndEcitsFields(c);
    expect(out.advocateRole).toBeNull();
    expect(out.advocateRoles).toEqual([]);
    expect(out.ecitsState.firstDocumentDate).toBeNull();
    expect(out.ecitsState.lastDocumentDate).toBeNull();
  });

  it('ensureCaseSaasAndEcitsFields не перетирає виставлений advocateRoles[]', () => {
    const c = { id: 'new', name: 'New', advocateRoles: ['defender'] };
    const out = ensureCaseSaasAndEcitsFields(c);
    expect(out.advocateRoles).toEqual(['defender']);
  });

  it('ensureCaseSaasAndEcitsFields робить fallback advocateRoles=[advocateRole]', () => {
    const c = { id: 'new', name: 'New', advocateRole: 'plaintiff_rep' };
    const out = ensureCaseSaasAndEcitsFields(c);
    expect(out.advocateRole).toBe('plaintiff_rep');
    expect(out.advocateRoles).toEqual(['plaintiff_rep']);
  });
});
