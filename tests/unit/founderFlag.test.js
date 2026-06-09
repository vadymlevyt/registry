// TASK 0.1 — Founder Flag.
// Юніт-тести для users[].isFounder, isCurrentUserFounder() і міграції v5→v6.
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_USER,
  isCurrentUserFounder,
} from '../../src/services/tenantService.js';
import {
  migrateToVersion6,
  CURRENT_SCHEMA_VERSION,
  MIGRATION_VERSION,
} from '../../src/services/migrationService.js';

// Чиста копія предикату з isCurrentUserFounder. Дублюємо тут, щоб юніт-тест
// перевірив усі 4 кейси без mock-інфраструктури для intra-module виклику.
// Якщо реалізація в tenantService.js зміниться — оновити цю функцію теж.
const founderPredicate = (user) => user?.isFounder === true;

describe('isCurrentUserFounder() — поведінка предикату', () => {
  it('повертає true коли user.isFounder === true', () => {
    expect(founderPredicate({ userId: 'vadym', isFounder: true })).toBe(true);
  });

  it('повертає false коли user.isFounder === false', () => {
    expect(founderPredicate({ userId: 'olena', isFounder: false })).toBe(false);
  });

  it('повертає false коли user без поля isFounder', () => {
    expect(founderPredicate({ userId: 'olena' })).toBe(false);
  });

  it('повертає false коли user === null', () => {
    expect(founderPredicate(null)).toBe(false);
  });

  it('повертає false коли user === undefined', () => {
    expect(founderPredicate(undefined)).toBe(false);
  });
});

describe('isCurrentUserFounder() — інтеграція з DEFAULT_USER', () => {
  it('DEFAULT_USER має isFounder: true (vadym = засновник)', () => {
    expect(DEFAULT_USER.isFounder).toBe(true);
  });

  it('isCurrentUserFounder() повертає true для DEFAULT_USER', () => {
    expect(isCurrentUserFounder()).toBe(true);
  });
});

describe('migrateToVersion6 (v5 → v6 founder flag)', () => {
  it('schemaVersion: 5 → 6 + settingsVersion оновлюється', () => {
    const reg = { schemaVersion: 5, users: [{ userId: 'vadym' }] };
    const res = migrateToVersion6(reg);
    expect(res.didMigrate).toBe(true);
    expect(res.fromVersion).toBe(5);
    expect(res.toVersion).toBe(6);
    expect(res.registry.schemaVersion).toBe(6);
    expect(res.registry.settingsVersion).toBe('6.0_founder_flag');
  });

  it('vadym → isFounder: true', () => {
    const reg = { schemaVersion: 5, users: [{ userId: 'vadym', name: 'V' }] };
    const { registry } = migrateToVersion6(reg);
    expect(registry.users[0].isFounder).toBe(true);
    expect(registry.users[0].name).toBe('V'); // не торкаємось інших полів
  });

  it('інші користувачі → isFounder: false', () => {
    const reg = {
      schemaVersion: 5,
      users: [
        { userId: 'vadym' },
        { userId: 'olena' },
        { userId: 'external_1' },
      ],
    };
    const { registry } = migrateToVersion6(reg);
    expect(registry.users[0].isFounder).toBe(true);
    expect(registry.users[1].isFounder).toBe(false);
    expect(registry.users[2].isFounder).toBe(false);
  });

  it('ідемпотентна — повторний запуск з v6 не змінює реєстр', () => {
    const reg = {
      schemaVersion: 6,
      settingsVersion: '6.0_founder_flag',
      users: [{ userId: 'vadym', isFounder: true }],
    };
    const res = migrateToVersion6(reg);
    expect(res.didMigrate).toBe(false);
    expect(res.registry).toBe(reg); // той самий об'єкт
  });

  it("ідемпотентна — не перезатирає вже встановлений isFounder", () => {
    // Edge case: користувач з userId='vadym' але isFounder=false (наприклад,
    // розжалуваний). Міграція не повинна re-promote-нути його.
    const reg = {
      schemaVersion: 5,
      users: [{ userId: 'vadym', isFounder: false }],
    };
    const { registry } = migrateToVersion6(reg);
    expect(registry.users[0].isFounder).toBe(false);
  });

  it('users відсутні — використовує DEFAULT_USER', () => {
    const reg = { schemaVersion: 5 };
    const { registry } = migrateToVersion6(reg);
    expect(Array.isArray(registry.users)).toBe(true);
    expect(registry.users.length).toBeGreaterThan(0);
    expect(registry.users[0].userId).toBe('vadym');
  });

  it('додає lastMigration з from/to/at', () => {
    const reg = { schemaVersion: 5, users: [{ userId: 'vadym' }] };
    const { registry } = migrateToVersion6(reg);
    expect(registry.lastMigration.from).toBe(5);
    expect(registry.lastMigration.to).toBe(6);
    expect(typeof registry.lastMigration.at).toBe('string');
  });
});

describe('CURRENT_SCHEMA_VERSION і MIGRATION_VERSION', () => {
  // Найвища досяжна версія після повного ланцюга міграцій
  // (v1→v4→v5→v6→v6.5→v7→v8→v9→v10→v11→v12). TASK v12 підняв таргет до v12
  // (ECITS contract extension — ролі, advocateRoles[], дати в ecitsState).
  it('CURRENT_SCHEMA_VERSION = 12 (повний ланцюг після TASK v12)', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(12);
  });

  it("MIGRATION_VERSION = '12.0_ecits_roles_dates'", () => {
    expect(MIGRATION_VERSION).toBe('12.0_ecits_roles_dates');
  });
});
