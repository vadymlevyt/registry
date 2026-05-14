// ── SOURCE POLICY ────────────────────────────────────────────────────────────
// Пріоритетизація джерел даних при конфлікті — TASK 0.3.5 v7.
//
// Принцип: дані з різних каналів (manual, court_sync, metadata_extractor,
// telegram, email, unknown) пишуться в одну канонічну схему через одні ACTIONS.
// source-мітка дозволяє розрізняти і не перезаписувати дані з вищим пріоритетом.
//
// Правила пріоритету (від найвищого до найнижчого):
//   1. manual (100)              — адвокат вручну, не перезаписується автоматично
//   2. court_sync (80)           — primary канал з ЄСІТС
//   3. metadata_extractor (60)   — primary для не-ЄСІТС, не перезаписує court_sync
//   4. telegram, email (50)      — прямі канали з месенджерів
//   5. unknown (10)              — невідомо, найнижчий пріоритет
//
// SaaS-готовність: у майбутньому SaaS може стати tenant-scoped — у різних
// tenants може бути своя політика (наприклад, державні адвокати можуть
// заборонити перезапис ecits-полів вручну). Зараз — статична константа.
//
// Принцип однозначності (правило #11): єдиний сенс canOverwrite — "чи новий
// source має право перезаписати існуючий". Не плутати з validation чи
// permissions — це окремі шари.

export const SOURCE_PRIORITY = Object.freeze({
  manual: 100,
  court_sync: 80,
  metadata_extractor: 60,
  telegram: 50,
  email: 50,
  unknown: 10,
});

/**
 * Чи новий source має право перезаписати існуючий.
 *
 * @param {string|null|undefined} existingSource — поточний source існуючих даних
 * @param {string|null|undefined} newSource — source даних що хочуть записати
 * @returns {boolean} true якщо перезапис дозволений (newSource має вищий пріоритет)
 *
 * @example
 *   canOverwrite('court_sync', 'manual') === true   // адвокат перезаписує ЄСІТС
 *   canOverwrite('manual', 'court_sync') === false  // ЄСІТС не перезаписує manual
 *   canOverwrite('unknown', 'metadata_extractor') === true  // 60 > 10
 *   canOverwrite(null, 'court_sync') === true       // нема existing — пишемо
 */
export function canOverwrite(existingSource, newSource) {
  // Якщо немає existing source — завжди дозволяємо перший запис
  if (existingSource === null || existingSource === undefined) return true;
  const existing = SOURCE_PRIORITY[existingSource] ?? 0;
  const incoming = SOURCE_PRIORITY[newSource] ?? 0;
  return incoming > existing;
}

/**
 * Створити запис alternativeSource — для аудиту коли перезапис не дозволений
 * але дані з іншого каналу прийшли. Зберігається в document.alternativeSources[].
 *
 * @param {string} source — канал звідки прийшли альтернативні дані
 * @param {string|null} sourceConfidence — впевненість
 * @param {object} data — самі дані (для hash)
 * @returns {{source, sourceConfidence, receivedAt, dataHash}}
 */
export function buildAlternativeSourceRecord(source, sourceConfidence, data) {
  return {
    source,
    sourceConfidence: sourceConfidence ?? null,
    receivedAt: new Date().toISOString(),
    dataHash: hashData(data),
  };
}

/**
 * Простий не-криптографічний хеш для аудиту. Дозволяє виявити чи альтернативний
 * source повернув ті самі дані що й primary, без зберігання повного дублю.
 *
 * @param {*} data — будь-які дані що серіалізуються JSON.stringify
 * @returns {string} hex hash
 */
export function hashData(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0; // 32-bit integer
  }
  return (hash >>> 0).toString(16); // unsigned hex
}
