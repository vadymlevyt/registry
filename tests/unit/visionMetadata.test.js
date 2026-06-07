// TASK 4 · етап D — parseMetadataJson (claudeVision «без OCR»). Чиста функція:
// витяг JSON з відповіді моделі (depth-counter) + нормалізація enum/порожніх.
import { describe, it, expect } from 'vitest';
import { parseMetadataJson } from '../../src/services/ocr/visionMetadataParse.js';

describe('parseMetadataJson', () => {
  it('валідний JSON → нормалізовані поля', () => {
    const out = parseMetadataJson(JSON.stringify({
      date: '2026-01-15', category: 'motion', author: 'court',
      name: 'Ухвала суду', gist: 'Суд призначив засідання.',
    }));
    expect(out).toEqual({
      date: '2026-01-15', category: 'motion', author: 'court',
      name: 'Ухвала суду', gist: 'Суд призначив засідання.',
    });
  });

  it('JSON у обгортці тексту → витягується depth-counter-ом', () => {
    const text = 'Ось результат:\n```json\n{ "date": null, "category": "court_act", "author": "opponent", "name": "Апеляційна скарга", "gist": "Опонент оскаржує рішення." }\n```\nдякую';
    const out = parseMetadataJson(text);
    expect(out.category).toBe('court_act');
    expect(out.author).toBe('opponent');
    expect(out.name).toBe('Апеляційна скарга');
    expect(out.date).toBeNull();
  });

  it('невалідний enum category/author → null', () => {
    const out = parseMetadataJson(JSON.stringify({
      date: '2026-01-15', category: 'судовий акт', author: 'я', name: 'Х', gist: 'Y',
    }));
    expect(out.category).toBeNull();
    expect(out.author).toBeNull();
    expect(out.name).toBe('Х');
  });

  it('рядки "null" і порожні → null', () => {
    const out = parseMetadataJson(JSON.stringify({
      date: 'null', category: '', author: '   ', name: 'null', gist: 'Опис',
    }));
    expect(out.date).toBeNull();
    expect(out.category).toBeNull();
    expect(out.author).toBeNull();
    expect(out.name).toBeNull();
    expect(out.gist).toBe('Опис');
  });

  it('сміття / без JSON → усі null', () => {
    for (const t of ['', null, undefined, 'без жодного json', '{ зламаний']) {
      expect(parseMetadataJson(t)).toEqual({
        date: null, category: null, author: null, name: null, gist: null,
      });
    }
  });
});
