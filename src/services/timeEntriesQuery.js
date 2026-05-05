// ── TIME ENTRIES QUERY ───────────────────────────────────────────────────────
// API запитів до time_entries[] з можливістю об'єднання активних і архівних.
//
// Принцип:
// - Поточний місяць — у registry.time_entries (in-memory).
// - Попередні місяці — у _archives/time_entries_YYYY-MM.json на Drive.
// - Запит сам обчислює які архіви треба підвантажити (по dateFrom/dateTo)
//   і паралельно їх читає через loadArchive().
//
// UI поки немає — викликається лише з агентів і майбутніх звітів.

import { loadArchive } from './timeEntriesArchiver.js';

function startOfMonthDate(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

function endOfMonthDate(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0, 23, 59, 59));
}

function* monthRange(fromDate, toDate) {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (cursor <= to) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    yield `${y}-${m}`;
    cursor = new Date(Date.UTC(y, cursor.getUTCMonth() + 1, 1));
  }
}

function currentYYYYMM() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function applyFilters(entries, query) {
  let out = Array.isArray(entries) ? [...entries] : [];
  const {
    dateFrom, dateTo, caseId, userId, tenantId,
    category, billable, parentEventId, parentEventType,
    status, type,
  } = query || {};
  if (dateFrom) {
    const f = new Date(dateFrom);
    out = out.filter(e => e?.startTime && new Date(e.startTime) >= f);
  }
  if (dateTo) {
    const t = new Date(dateTo);
    out = out.filter(e => e?.startTime && new Date(e.startTime) <= t);
  }
  if (caseId) out = out.filter(e => String(e?.caseId) === String(caseId));
  if (userId) out = out.filter(e => e?.userId === userId);
  if (tenantId) out = out.filter(e => e?.tenantId === tenantId);
  if (category) out = out.filter(e => e?.category === category);
  if (billable !== undefined) out = out.filter(e => Boolean(e?.billable) === Boolean(billable));
  if (parentEventId) out = out.filter(e => e?.parentEventId === parentEventId);
  if (parentEventType) out = out.filter(e => e?.parentEventType === parentEventType);
  if (status) out = out.filter(e => e?.status === status);
  if (type) out = out.filter(e => e?.type === type);
  return out;
}

function groupBy(entries, key) {
  const acc = {};
  for (const e of entries) {
    const k = e?.[key] ?? '_null';
    acc[k] = acc[k] || [];
    acc[k].push(e);
  }
  return acc;
}

// Основна функція. options:
//   activeEntries — масив поточного місяця (з App state)
//   token         — Drive token (для підвантаження архівів)
//   query.groupBy — 'caseId' | 'category' | 'userId' | 'date'
export async function getTimeEntries(options = {}) {
  const { activeEntries = [], token = null, query = {} } = options;
  const { dateFrom, dateTo, groupBy: gb } = query;

  // Визначаємо які місяці потрібно підняти з архіву.
  let archives = [];
  if (dateFrom) {
    const fromMonth = new Date(dateFrom).toISOString().slice(0, 7);
    const toMonth = dateTo ? new Date(dateTo).toISOString().slice(0, 7) : currentYYYYMM();
    const monthsNeeded = [];
    for (const m of monthRange(dateFrom, dateTo || new Date())) monthsNeeded.push(m);
    const cur = currentYYYYMM();
    const archiveMonths = monthsNeeded.filter(m => m !== cur);
    if (archiveMonths.length > 0 && token) {
      const results = await Promise.all(
        archiveMonths.map(yyyymm => loadArchive(token, yyyymm))
      );
      for (const r of results) {
        if (r?.success && Array.isArray(r.entries)) archives.push(...r.entries);
      }
    }
  }

  let combined = [...archives, ...activeEntries];
  combined = applyFilters(combined, query);
  // Стабільне сортування за startTime.
  combined.sort((a, b) => new Date(a.startTime || 0) - new Date(b.startTime || 0));

  if (gb) {
    const key = gb === 'date'
      ? null
      : gb;
    if (gb === 'date') {
      const acc = {};
      for (const e of combined) {
        const day = (e.startTime || '').slice(0, 10);
        acc[day] = acc[day] || [];
        acc[day].push(e);
      }
      return acc;
    }
    return groupBy(combined, key);
  }
  return combined;
}

// Підрахунок підсумків.
export async function getSummary(options = {}) {
  const entries = await getTimeEntries(options);
  const list = Array.isArray(entries) ? entries : Object.values(entries).flat();
  const totalDuration = list.reduce((s, e) => s + (e?.duration || 0), 0);
  const billableDuration = list
    .filter(e => e?.billable)
    .reduce((s, e) => s + (e?.duration || 0), 0);
  const byCategory = {};
  const byCase = {};
  const byUser = {};
  for (const e of list) {
    if (!e) continue;
    byCategory[e.category || '_null'] = (byCategory[e.category || '_null'] || 0) + (e.duration || 0);
    byCase[e.caseId || '_null'] = (byCase[e.caseId || '_null'] || 0) + (e.duration || 0);
    byUser[e.userId || '_null'] = (byUser[e.userId || '_null'] || 0) + (e.duration || 0);
  }
  const sorted = list.length > 0
    ? { from: list[0].startTime, to: list[list.length - 1].startTime }
    : { from: null, to: null };
  return {
    totalEntries: list.length,
    totalDuration,
    billableDuration,
    byCategory,
    byCase,
    byUser,
    dateRange: sorted,
  };
}

export const _internals = { applyFilters, groupBy, monthRange, currentYYYYMM };
