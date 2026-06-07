// ── VISION METADATA — чистий шар промту + парсингу (TASK 4 етап D) ───────────
// Без залежностей від pdfjs/DOM/мережі — щоб юніт-тестувати парсинг ізольовано
// (claudeVision.js, який тягне pdfjs, лишається для рендеру/виклику).

// METADATA_PROMPT — режим «без OCR». Просимо ТІЛЬКИ JSON. Усі поля — пропозиції
// (адвокат править); ours/opponent Vision не може знати напевно (наш↔опонент
// підтверджує адвокат, спека D). Українською у подвійних лапках (правило #5).
export const METADATA_PROMPT =
  "Ти аналізуєш перші сторінки юридичного документа. " +
  "Поверни ВИКЛЮЧНО валідний JSON без коментарів, без пояснень, без розмітки:\n" +
  "{\n" +
  '  "date": "дата документа РРРР-ММ-ДД або null якщо немає",\n' +
  '  "category": "рівно одне з: pleading|motion|court_act|evidence|contract|correspondence|identification|other",\n' +
  '  "author": "рівно одне з: ours|opponent|court|third_party",\n' +
  '  "name": "коротка назва документа з заголовка (українською)",\n' +
  '  "gist": "1-2 речення про що цей документ (українською)"\n' +
  "}";

export const META_CATEGORIES = [
  'pleading', 'motion', 'court_act', 'evidence',
  'contract', 'correspondence', 'identification', 'other',
];
export const META_AUTHORS = ['ours', 'opponent', 'court', 'third_party'];

// parseMetadataJson — витяг + нормалізація JSON-відповіді моделі. Depth-counter
// (CLAUDE.md: regex [\s\S]*? зупиняється на першій }). Невалідні enum / порожні
// рядки → null. Чиста функція, безпечна на будь-якому вході.
export function parseMetadataJson(text) {
  const empty = { date: null, category: null, author: null, name: null, gist: null };
  if (!text || typeof text !== 'string') return empty;
  const start = text.indexOf('{');
  if (start === -1) return empty;
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return empty;
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return empty;
  }
  const norm = (v) => {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s || s.toLowerCase() === 'null') return null;
    return s;
  };
  const category = norm(parsed.category);
  const author = norm(parsed.author);
  return {
    date: norm(parsed.date),
    category: META_CATEGORIES.includes(category) ? category : null,
    author: META_AUTHORS.includes(author) ? author : null,
    name: norm(parsed.name),
    gist: norm(parsed.gist),
  };
}
