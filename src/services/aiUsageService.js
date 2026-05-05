// ── AI USAGE SERVICE ─────────────────────────────────────────────────────────
// Пасивний облік використання Anthropic API: токени, моделі, вартість.
// Кожен виклик API → один запис у ai_usage[]. LIFO-ротація 50 000.
//
// Інтеграція: точки виклику передають setAiUsage (React setter) у logAiUsage.
// Для не-React точок (claudeVision.js, analyzePDFWithDocumentBlock) — sink
// передається через options.aiUsageSink callback.

import { getCurrentTenant, getCurrentUser } from './tenantService.js';

// pricing as of 2026-05-04, verify quarterly
export const MODEL_PRICING = {
  'claude-haiku-4-5-20251001': { input: 0.80,  output: 4.00 },
  'claude-sonnet-4-20250514':  { input: 3.00,  output: 15.00 },
  'claude-opus-4-7':           { input: 15.00, output: 75.00 },
  default:                     { input: 0,     output: 0 },
};

export const MAX_AI_USAGE_ENTRIES = 50000;

export function calculateCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
  const cost = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  return Number(cost.toFixed(6));
}

function makeId() {
  return `usage_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function buildUsageEntry({ agentType, model, inputTokens, outputTokens, context }) {
  const tenant = getCurrentTenant();
  const user = getCurrentUser();
  const inT = Number.isFinite(inputTokens) ? inputTokens : 0;
  const outT = Number.isFinite(outputTokens) ? outputTokens : 0;
  return {
    id: makeId(),
    tenantId: tenant?.tenantId || null,
    userId: user?.userId || null,
    timestamp: new Date().toISOString(),
    agentType: agentType || 'other',
    model: model || 'unknown',
    inputTokens: inT,
    outputTokens: outT,
    totalTokens: inT + outT,
    estimatedCostUSD: calculateCost(model, inT, outT),
    context: {
      caseId: context?.caseId || null,
      module: context?.module || null,
      operation: context?.operation || 'other',
    },
  };
}

// Викликається з React-компонентів — передається setAiUsage (React setter).
export function logAiUsage(params, setAiUsage) {
  if (typeof setAiUsage !== 'function') {
    console.warn('logAiUsage: sink не є функцією, запис пропущено');
    return null;
  }
  try {
    const entry = buildUsageEntry(params);
    setAiUsage(prev => {
      const next = Array.isArray(prev) ? [...prev, entry] : [entry];
      return next.length > MAX_AI_USAGE_ENTRIES
        ? next.slice(next.length - MAX_AI_USAGE_ENTRIES)
        : next;
    });
    return entry;
  } catch (e) {
    console.warn('logAiUsage error:', e);
    return null;
  }
}

// Хелпер для не-React точок — приймає sink-callback (наприклад, бінд до setAiUsage
// з зовнішнього компонента) і викликає його з готовим entry.
export function logAiUsageViaSink(params, sink) {
  if (typeof sink !== 'function') return null;
  try {
    const entry = buildUsageEntry(params);
    sink(entry);
    return entry;
  } catch (e) {
    console.warn('logAiUsageViaSink error:', e);
    return null;
  }
}

// ── Аналітичні хелпери ─────────────────────────────────────────────────────
// Без UI зараз — готові до використання у звітах і ai_usage panel.

function withinPeriod(entry, fromDate, toDate) {
  if (!entry?.timestamp) return false;
  const t = new Date(entry.timestamp);
  if (fromDate && t < new Date(fromDate)) return false;
  if (toDate && t > new Date(toDate)) return false;
  return true;
}

export function getUsageByPeriod(aiUsage, fromDate, toDate) {
  if (!Array.isArray(aiUsage)) return [];
  return aiUsage.filter(e => withinPeriod(e, fromDate, toDate));
}

export function getUsageByModel(aiUsage, fromDate, toDate) {
  const filtered = getUsageByPeriod(aiUsage, fromDate, toDate);
  const acc = {};
  for (const e of filtered) {
    const key = e.model || 'unknown';
    acc[key] = acc[key] || { tokens: 0, cost: 0, count: 0 };
    acc[key].tokens += e.totalTokens || 0;
    acc[key].cost += e.estimatedCostUSD || 0;
    acc[key].count += 1;
  }
  return acc;
}

export function getUsageByCase(aiUsage, caseId, fromDate, toDate) {
  return getUsageByPeriod(aiUsage, fromDate, toDate)
    .filter(e => e.context?.caseId === caseId);
}

export function getUsageByUser(aiUsage, userId, fromDate, toDate) {
  return getUsageByPeriod(aiUsage, fromDate, toDate)
    .filter(e => e.userId === userId);
}

export function getTotalCost(aiUsage, fromDate, toDate) {
  return getUsageByPeriod(aiUsage, fromDate, toDate)
    .reduce((s, e) => s + (e.estimatedCostUSD || 0), 0);
}
