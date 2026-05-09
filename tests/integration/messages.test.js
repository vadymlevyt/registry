import { describe, it, expect } from 'vitest';
import { messages } from '../../src/services/messages.js';

// Список технічного жаргону який НЕ повинен зʼявлятись у текстах для адвоката.
const FORBIDDEN_JARGON = [
  /HTTP\s*\d{3}/,
  /\bcode\s+\d/i,
  /failed to fetch/i,
  /system error/i,
  /JSON\.?parse/i,
  /undefined is not/i,
  /\bnull\s+pointer/i,
  /stack trace/i,
];

// Збираємо всі шаблони повідомлень для перевірки.
function collectAllMessages() {
  const out = [];
  for (const [groupName, group] of Object.entries(messages)) {
    for (const [key, factory] of Object.entries(group)) {
      // Викликаємо з різними варіантами параметрів щоб зловити обидва
      // позиційні та обʼєктні signatures. try/catch — щоб одне падіння не
      // обірвало збір.
      const variants = [
        () => factory(),
        () => factory('test_value'),
        () => factory('test', 'second'),
        () => factory({ count: 3, fromCache: 1, failed: 0 }),
      ];
      for (const v of variants) {
        try {
          const sample = v();
          if (sample && typeof sample === 'object' && (sample.title || sample.description)) {
            out.push({ path: `${groupName}.${key}`, msg: sample });
          }
        } catch {
          // різні signatures — пропускаємо неваліднi комбінації
        }
      }
    }
  }
  return out;
}

describe('messages dictionary', () => {
  const all = collectAllMessages();

  it('містить непорожні title у кожному повідомленні', () => {
    for (const { path, msg } of all) {
      expect(msg.title, `${path} → title порожній`).toBeTruthy();
      expect(typeof msg.title).toBe('string');
    }
  });

  it('variant — валідний (success/error/warning/info)', () => {
    const valid = ['success', 'error', 'warning', 'info'];
    for (const { path, msg } of all) {
      if (msg.variant !== undefined) {
        expect(valid).toContain(msg.variant);
      }
    }
  });

  it('description — string або null', () => {
    for (const { path, msg } of all) {
      if (msg.description !== undefined && msg.description !== null) {
        expect(typeof msg.description, `${path} → description not string`).toBe('string');
      }
    }
  });

  it('action — обʼєкт з label (string) якщо є', () => {
    for (const { path, msg } of all) {
      if (msg.action) {
        expect(msg.action, `${path} → action invalid`).toHaveProperty('label');
        expect(typeof msg.action.label).toBe('string');
      }
    }
  });

  it('жодного технічного жаргону у текстах', () => {
    for (const { path, msg } of all) {
      const fullText = `${msg.title || ''} ${msg.description || ''}`;
      for (const pattern of FORBIDDEN_JARGON) {
        expect(pattern.test(fullText), `${path} містить заборонений жаргон: ${pattern}`).toBe(false);
      }
    }
  });

  it('параметри підставляються у description', () => {
    const { description } = messages.drive.saveFailed('позов.pdf');
    expect(description).toMatch(/позов\.pdf/);
  });

  it('messages.context.created формує українську плюралізацію', () => {
    const one = messages.context.created({ count: 1, fromCache: 0, failed: 0 });
    const few = messages.context.created({ count: 3, fromCache: 0, failed: 0 });
    const many = messages.context.created({ count: 5, fromCache: 0, failed: 0 });
    expect(one.description).toMatch(/документ /);
    expect(few.description).toMatch(/документи /);
    expect(many.description).toMatch(/документів /);
  });

  it('messages.documents.deleted підтримує всі 3 mode (full/registry_only/archive)', () => {
    const full = messages.documents.deleted('full');
    const reg = messages.documents.deleted('registry_only');
    const arch = messages.documents.deleted('archive');
    expect(full.description).toMatch(/Drive/);
    expect(reg.description).toMatch(/архівна/i);
    expect(arch.description).toMatch(/архів/i);
  });

  it('messages.proceedings.deleted коректно показує плюралізацію документів', () => {
    const zero = messages.proceedings.deleted('Апеляція', 0);
    const some = messages.proceedings.deleted('Апеляція', 5);
    expect(zero.description).toBeNull();
    expect(some.description).toMatch(/5/);
    expect(some.description).toMatch(/документ/i);
  });
});
