// ── DP · DIAGNOSTIC LOGGER (Drive-based, console-free) ──────────────────────
// Тимчасовий діагностичний логер ОДНОГО прогону Document Processor. Пише
// детальний покроковий лог на Drive у папку `_diagnostics/` — щоб адвокат міг
// діагностувати збій БЕЗ інструментів розробника браузера (планшет/телефон),
// а розробник прочитав лог прямо з Drive.
//
// ОДИН СЕНС (правило #11): «накопичити числові події одного run() у памʼяті і
// в кінці викинути їх одним JSON-файлом на Drive». НЕ телеметрія білінгу
// (ai_usage/time_entries), НЕ jobState (resume). Окрема сутність із власною
// ціллю — розслідування. Призначений до видалення після знаходження причини.
//
// КОНФІДЕНЦІЙНІСТЬ: лог пише ТІЛЬКИ числа, мітки стадій, коди/повідомлення
// помилок і ДОВЖИНИ тексту — НІКОЛИ сам текст документів. sanitize() ріже
// будь-який рядок > 200 символів до маркера `[str:N]`, щоб випадковий зміст
// документа не потрапив у лог (захист навіть від помилки на місці виклику).
//
// ЖИТТЯ ФАЙЛІВ: один run() → один файл `dp_diag_<jobId>_<ts>.json`. Кілька
// прогонів → кілька файлів (накопичуються, нічого не перезаписується). Папка
// `_diagnostics/` НЕ чиститься на успіху (на відміну від `_temp/`).

const MAX_STRING = 200;        // довші рядки ріжемо (захист від тексту документа)
const DIAG_FOLDER = '_diagnostics';

// Усереднено-безпечний зріз значень події: числа/булеві/короткі рядки — як є;
// довгі рядки → `[str:N]`; масиви/обʼєкти — поверхневий прохід (1 рівень).
function sanitizeValue(v, depth = 0) {
  if (v == null) return v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > MAX_STRING ? `[str:${v.length}]` : v;
  if (Array.isArray(v)) {
    if (depth > 1) return `[arr:${v.length}]`;
    return v.slice(0, 50).map((x) => sanitizeValue(x, depth + 1));
  }
  if (typeof v === 'object') {
    if (depth > 1) return '[obj]';
    const out = {};
    for (const k of Object.keys(v)) out[k] = sanitizeValue(v[k], depth + 1);
    return out;
  }
  return String(v).slice(0, MAX_STRING);
}

function sanitize(data) {
  const out = {};
  for (const k of Object.keys(data || {})) out[k] = sanitizeValue(data[k]);
  return out;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// No-op логер — дефолт для тестів / коли drivePort не переданий. Той самий
// контракт, нуль сайд-ефектів.
export const NOOP_DIAG = {
  log() { /* no-op */ },
  async flush() { return null; },
};

// createDiagLogger — СВІЖИЙ логер на ОДИН прогін (entries накопичуються тут).
// deps.drivePort — { getOrCreateFolder, uploadText }. enabled=false → no-op.
export function createDiagLogger({ drivePort, enabled = true, folderName = DIAG_FOLDER } = {}) {
  if (!enabled || !drivePort) return NOOP_DIAG;

  const entries = [];
  const startedAt = new Date().toISOString();

  function log(stage, data = {}) {
    try {
      entries.push({ t: new Date().toISOString(), stage, ...sanitize(data) });
    } catch { /* лог НІКОЛИ не валить обробку */ }
  }

  // Викинути накопичене одним JSON-файлом на Drive. Best-effort: помилка
  // запису не валить job (повертає null).
  async function flush(meta = {}) {
    try {
      const folder = await drivePort.getOrCreateFolder(folderName, null);
      if (!folder?.id) return null;
      const payload = JSON.stringify({
        diagVersion: 1,
        startedAt,
        finishedAt: new Date().toISOString(),
        ...sanitize(meta),
        entryCount: entries.length,
        entries,
      }, null, 2);
      const name = `dp_diag_${meta.jobId || 'job'}_${stamp()}.json`;
      const up = await drivePort.uploadText(folder.id, name, payload, 'application/json');
      return up?.id || null;
    } catch {
      return null;
    }
  }

  return { log, flush };
}
