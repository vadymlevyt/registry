// ── SUBSCRIPTION SERVICE ─────────────────────────────────────────────────────
// Перерахунок поточних метрик у tenant.subscription.current.
// Поки limits = null — перевірок немає, заглушка для майбутніх тарифних планів.
// v4 Billing Foundation: додано hoursBilled з time_entries (для звітів адвокату).

export function recalculateCurrent(tenant, aiUsage, cases, timeEntries) {
  if (!tenant || !tenant.subscription || !tenant.subscription.current) return null;

  const current = tenant.subscription.current;
  const periodStart = new Date(current.periodStart);
  const periodEnd = new Date(current.periodEnd);

  const periodEntries = (Array.isArray(aiUsage) ? aiUsage : []).filter(e => {
    if (!e || e.tenantId !== tenant.tenantId) return false;
    const t = new Date(e.timestamp);
    return t >= periodStart && t <= periodEnd;
  });

  const tokensUsed = periodEntries.reduce((s, e) => s + (e.totalTokens || 0), 0);
  const costUsedUSD = periodEntries.reduce((s, e) => s + (e.estimatedCostUSD || 0), 0);

  const tenantCases = (Array.isArray(cases) ? cases : []).filter(c =>
    c && c.tenantId === tenant.tenantId
  );
  const casesActiveCount = tenantCases.filter(c => c.status === 'active').length;

  // v4: hoursBilled з time_entries[]. duration зберігається в секундах.
  const periodTimeEntries = (Array.isArray(timeEntries) ? timeEntries : []).filter(e => {
    if (!e || e.tenantId !== tenant.tenantId) return false;
    const t = e.startTime ? new Date(e.startTime) : null;
    if (!t) return false;
    return t >= periodStart && t <= periodEnd;
  });
  const billableSeconds = periodTimeEntries
    .filter(e => e.billable && e.status !== 'cancelled')
    .reduce((s, e) => s + (Number(e.duration) || 0), 0);
  const hoursBilled = Number((billableSeconds / 3600).toFixed(2));

  return {
    ...current,
    tokensUsed,
    costUsedUSD: Number(costUsedUSD.toFixed(6)),
    casesActiveCount,
    hoursBilled,
  };
}

// Перевірка лімітів. Повертає { ok, exceeded: [...] }.
// Зараз limits переважно null — фактично повертає ok:true.
export function checkLimits(tenant) {
  if (!tenant?.subscription?.limits || !tenant?.subscription?.current) {
    return { ok: true, exceeded: [] };
  }
  const limits = tenant.subscription.limits;
  const current = tenant.subscription.current;
  const exceeded = [];

  if (limits.aiTokensPerMonth != null && current.tokensUsed > limits.aiTokensPerMonth) {
    exceeded.push('aiTokensPerMonth');
  }
  if (limits.aiCostPerMonth != null && current.costUsedUSD > limits.aiCostPerMonth) {
    exceeded.push('aiCostPerMonth');
  }
  if (limits.storageGB != null && current.storageUsedGB > limits.storageGB) {
    exceeded.push('storageGB');
  }
  if (limits.teamMembers != null && current.teamMembersCount > limits.teamMembers) {
    exceeded.push('teamMembers');
  }
  if (limits.casesActive != null && current.casesActiveCount > limits.casesActive) {
    exceeded.push('casesActive');
  }
  return { ok: exceeded.length === 0, exceeded };
}
