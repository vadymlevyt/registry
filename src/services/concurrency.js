// ── CONCURRENCY HELPER ──────────────────────────────────────────────────────
// Один сенс (правило #11): "запустити N async-тасків з обмеженням M
// одночасних у польоті, повернути результати у вхідному порядку".
//
// Чому не голий Promise.all: на 25+ Drive-uploads без ліміту браузер штрафує
// (~6 паралельних HTTP per host), мобільна WiFi на планшеті адвоката
// «висне». concurrency=5 тримає трубу повною без перевантаження.
//
// Контракт:
//   - результат task-функції зберігається на позиції myIdx
//   - якщо task кинув — позиція містить { __error: e } (caller сам розрізняє
//     fatal vs file_skipped у своєму домені; concurrency не знає семантику)
//   - onProgress(done,total) викликається після завершення КОЖНОГО таска
//   - порожній items → порожній результат (НЕ throw)
//
// Реальний кейс: splitDocumentsV3 PERSIST на Брановського (25 нарізаних) —
// 25 послідовних uploadFile+persistDocument+writeText02+writeLayout02
// ~100 Drive-операцій → ~60-100 сек з ліміту 5 замість ~300-400 сек серіально.
export async function runWithConcurrency(items, taskFn, concurrency, onProgress) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, items.length));
  const results = new Array(items.length);
  let cursor = 0;
  let done = 0;
  async function worker() {
    while (true) {
      const myIdx = cursor++;
      if (myIdx >= items.length) return;
      try {
        results[myIdx] = await taskFn(items[myIdx], myIdx);
      } catch (e) {
        results[myIdx] = { __error: e };
      }
      done++;
      if (typeof onProgress === 'function') {
        try { onProgress(done, items.length); } catch { /* ізольовано */ }
      }
    }
  }
  const workers = Array.from({ length: limit }, () => worker());
  await Promise.all(workers);
  return results;
}
