// ── DP-3 · JOB PROGRESS STORE ───────────────────────────────────────────────
// Спостережуваний стан активних jobs для UI (JobProgressTopbar). Топбар
// зʼявляється ТІЛЬКИ коли є активні jobs і зникає коли список порожній —
// тому стор сам є джерелом «показувати чи ні».
//
// Гібрид синхронізації (встановлене рішення §4):
//   • push від streamingExecutor (кожні ~500мс поки вкладка активна) —
//     миттєвий шлях, реальний драйвер прогресу.
//   • poll Drive job_state кожні 5с — FALLBACK для resume і коли executor не
//     сповістив (вкладка була неактивна). Вмикається ЛИШЕ коли є активні
//     jobs, інакше зупинено (нуль фонового Drive-трафіку без потреби).
//   У майбутньому SaaS push-канал = SSE/WebSocket через цей самий store
//   (Provider Pattern — один адаптер, UI не чіпається).
//
// Це валідний transient-UI стор поза App.jsx SSOT (як eventBus): він НЕ
// тримає доменних даних (cases/notes) — лише ефемерний прогрес обробки,
// який зникає по завершенні. App.jsx лишається єдиним джерелом cases[].
//
// Чистий модуль-сінглтон спостерігача (як eventBus). Polling вмикається
// явним attachDrivePolling — без нього стор просто push-only (тести).

const jobs = new Map();             // jobId → snapshot
const listeners = new Set();
let pollTimer = null;
let pollCtx = null;                 // { loadState, intervalMs }

function snapshot() {
  return Array.from(jobs.values());
}

function emit() {
  const snap = snapshot();
  for (const fn of listeners) {
    try { fn(snap); } catch { /* підписник ізольований */ }
  }
}

// Один сенс: підписатися на зміни (повертає unsubscribe). Одразу віддає
// поточний знімок — підписник не чекає першого push.
export function subscribe(fn) {
  listeners.add(fn);
  try { fn(snapshot()); } catch { /* noop */ }
  return () => listeners.delete(fn);
}

export function getActiveJobs() {
  return snapshot();
}

export function hasActiveJobs() {
  return jobs.size > 0;
}

// startJob — зареєструвати job (топбар зʼявляється). Ідемпотентно.
export function startJob({ jobId, caseId, title, total = 0 }) {
  if (!jobId) return;
  jobs.set(jobId, {
    jobId, caseId: caseId || null,
    title: title || 'Обробка документів',
    done: 0, total, ratio: 0,
    etaMs: null, stage: null,
    status: 'running', updatedAt: Date.now(),
  });
  emit();
}

// updateJob — push прогресу від executor. Часткове злиття (merge patch).
export function updateJob(jobId, patch = {}) {
  const cur = jobs.get(jobId);
  if (!cur) return;
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  if (next.total > 0) next.ratio = Math.min(1, (next.done || 0) / next.total);
  jobs.set(jobId, next);
  emit();
}

// finishJob — позначити завершеним і прибрати (топбар зникне якщо це
// останній). graceMs — коротка затримка щоб UI встиг показати 100%.
export function finishJob(jobId, { status = 'done', graceMs = 0 } = {}) {
  const cur = jobs.get(jobId);
  if (cur) { jobs.set(jobId, { ...cur, status, ratio: 1, updatedAt: Date.now() }); emit(); }
  const drop = () => { jobs.delete(jobId); emit(); };
  if (graceMs > 0 && typeof setTimeout === 'function') setTimeout(drop, graceMs);
  else drop();
}

export function removeJob(jobId) {
  if (jobs.delete(jobId)) emit();
}

// ── Drive poll fallback ─────────────────────────────────────────────────────
// attachDrivePolling({ loadState, list, intervalMs }) — вмикає 5с-poll лише
// поки є активні jobs. loadState(caseId,jobId)→state | list()→[{caseId,jobId}].
// Зупиняється сам коли jobs.size === 0 (нуль трафіку без потреби).
export function attachDrivePolling({ loadState, intervalMs = 5000 } = {}) {
  pollCtx = { loadState, intervalMs };
  ensurePolling();
}

function ensurePolling() {
  if (!pollCtx || typeof setInterval !== 'function') return;
  if (jobs.size === 0) { stopPolling(); return; }
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (jobs.size === 0) { stopPolling(); return; }
    if (typeof pollCtx.loadState !== 'function') return;
    for (const j of snapshot()) {
      try {
        const st = await pollCtx.loadState(j.caseId, j.jobId);
        if (!st) continue;
        const total = Array.isArray(st.chunks) ? st.chunks.length : j.total;
        const done = Array.isArray(st.chunks) ? st.chunks.filter(c => c.status === 'done').length : j.done;
        // Poll лише ДОганяє якщо push відстав (не відкочує назад).
        if (done >= (j.done || 0)) updateJob(j.jobId, { done, total, stage: st.stoppedAt || j.stage });
      } catch { /* poll ізольований */ }
    }
  }, pollCtx.intervalMs);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// Тригер переоцінки polling після зовнішніх змін (executor викликає після
// start/finish). Експортовано щоб executor керував без знання таймера.
export function reconcilePolling() {
  ensurePolling();
}

// Лише для тестів — повне очищення.
export function _resetForTests() {
  jobs.clear();
  listeners.clear();
  stopPolling();
  pollCtx = null;
}
