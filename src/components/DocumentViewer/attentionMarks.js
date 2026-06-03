// ── ATTENTION MARKS (V2-C) — спільні хелпери підсвіток уваги (тільки Чистий) ──
// Парсинг/стрип інлайн-міток ==фраза== + навігація до мітки у DOM. Переюзні
// (parent §СПІЛЬНІСТЬ; борг #47 дорощує per-mark редагування/прибирання окремо).
// Делімітер == узгоджено з MarkdownRenderer (==…== → <mark data-mark="N">) і
// промтом Чистого (cleanTextService.buildVerbatimPrompt). Один сенс кожної
// функції (#11): рахую / прибираю делімітери / скролю до N-ї мітки.

// `[^=]+?` — вміст мітки не містить '=' (фраза дослівна, без вкладених ==).
const MARK_RE = /==([^=]+?)==/g;

// Скільки ==міток== у markdown-тексті — кількість для чипа «N поміток».
// Джерело істини count — самий .clean.md (parent §V2-C.3), НЕ довжина extended.
export function countMarks(md) {
  if (!md) return 0;
  const matches = String(md).match(MARK_RE);
  return matches ? matches.length : 0;
}

// Прибрати делімітери ==…== зі збереженням внутрішнього тексту ДОСЛІВНО
// («Зняти всі назавжди»: позначки зникають, жодне слово не міняється).
export function stripMarks(md) {
  return String(md || '').replace(MARK_RE, '$1');
}

// Доскролити до мітки N (1-based) у контейнері + короткий «пульс».
// Best-effort: нема контейнера/мітки → no-op (не валимо в'ювер).
export function scrollToMark(container, n) {
  if (!container || typeof container.querySelector !== 'function') return;
  const el = container.querySelector(`mark.attention[data-mark="${n}"]`);
  if (!el) return;
  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch {
    try { el.scrollIntoView(); } catch { /* JSDOM/старі браузери — пропускаємо */ }
  }
  // Перезапуск анімації при повторному кліку: знімаємо клас, форсуємо reflow.
  el.classList.remove('is-pulse');
  void el.offsetWidth;
  el.classList.add('is-pulse');
}
