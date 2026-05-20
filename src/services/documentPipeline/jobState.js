// ── DP-3 · JOB STATE (RESUME INFRASTRUCTURE) ────────────────────────────────
// Розширення патерну resumeStore (ocr/) з одного OCR-виклику на ВЕСЬ pipeline.
// `job_state.json` живе у `_temp/<caseId>_<jobId>/` на Drive і дозволяє
// продовжити обробку з останнього успішного chunk після збою / перезавантаження
// вкладки / переповнення Drive.
//
// Чому Drive, а не in-memory (як ocr/resumeStore): OCR-чанк дешево
// перерозпізнати, а streaming тому 250-сторінкового → 30-файлового пакета
// коштує годин роботи і реальних Document AI грошей. Втратити це через
// reload вкладки на планшеті — неприйнятно (це і є use case DP-3).
//
// Crash-safety без atomic rename (Drive його не має): кожен save пише НОВИЙ
// `job_state.json`, ПОТІМ видаляє попередні. Якщо впали посеред save —
// старий стан лишився цілим. load бере найсвіжіший, прибирає дублі.
//
// `_temp/` — латиниця в корені Drive (як `_backups`/`_research`): caseId
// (`case_123`) і jobId (латиниця) безпечні для q= (CLAUDE.md правило #8 —
// нуль кирилиці у фільтрі).
//
// Чистий сервіс: Drive-порт ін'єктується (фабрика, як createActions). Тести
// підставляють in-memory, App — реальний driveService.

export const JOB_STATE_FILE = 'job_state.json';
export const TEMP_ROOT = '_temp';

export const JOB_STATUS = Object.freeze({
  RUNNING: 'running',
  STOPPED: 'stopped',     // перерване (збій/скасування) — resumable
  DONE: 'done',
});

// Початковий стан job. Один сенс: знімок «що зроблено, що лишилось».
export function makeInitialJobState({ jobId, caseId, files = [] }) {
  const now = new Date().toISOString();
  return {
    jobId,
    caseId,
    createdAt: now,
    updatedAt: now,
    status: JOB_STATUS.RUNNING,
    // Файли пакета і їх прогрес. originalDriveId — копія в 01_ОРИГІНАЛИ
    // (файл уже на Drive, RAM звільнено).
    files: files.map((f) => ({
      fileId: f.fileId,
      name: f.name || null,
      originalDriveId: f.originalDriveId || null,
      totalPages: f.totalPages ?? null,
      totalChunks: f.totalChunks ?? null,
      status: 'pending',                 // pending | chunking | processing | done
    })),
    // Плоский список chunks по всіх файлах. driveId — chunk-байти у _temp.
    chunks: [],                          // [{fileId,index,startPage,endPage,driveId,status,textDriveId?}]
    cursor: { fileIndex: 0, chunkIndex: 0 },
    documents: [],                       // персистовані id (для скасування «зберегти N»)
    decisions: [],
    reconstructionPlan: null,
    unusedPages: [],
    chunkDurationsMs: [],                // історія для ETA
    stoppedAt: null,                     // ім'я стадії де став
    error: null,
  };
}

// Скільки chunk'ів оброблено / всього — для ETA і прогрес-бару.
export function jobProgress(state) {
  if (!state || !Array.isArray(state.chunks)) return { done: 0, total: 0, ratio: 0 };
  const total = state.chunks.length;
  const done = state.chunks.filter((c) => c.status === 'done').length;
  return { done, total, ratio: total > 0 ? done / total : 0 };
}

// ETA у мс на основі історії оброблених chunks поточного job. null якщо ще
// нема жодного виміру (нечесно показувати число з порожньої історії).
export function estimateRemainingMs(state) {
  if (!state) return null;
  const durs = Array.isArray(state.chunkDurationsMs) ? state.chunkDurationsMs : [];
  if (durs.length === 0) return null;
  const { done, total } = jobProgress(state);
  const remaining = Math.max(0, total - done);
  if (remaining === 0) return 0;
  const avg = durs.reduce((s, d) => s + d, 0) / durs.length;
  return Math.round(avg * remaining);
}

// P4 (Фаза B, 20.05.2026) — throttle saveState (один сенс, правило #11):
// "у normal-режимі не частіше ніж раз на N мс; saveStateImmediate і
// flushPendingSave — окремі гілки для критичних подій (init/terminal/error)".
// Дефолт 10_000 мс = 10 с (P4 acceptance: ≤1 upload/10 сек).
//
// Корінь: ~120 saveState/DP run × ~100-200мс Drive write = ~12-24 сек
// прихованої роботи. Більшість — per-chunk OCR completion (L139 у
// streamingExecutor). Per-chunk прогрес НЕ критичний для resume (resume
// бачить ≤ JOBSTATE_THROTTLE_MS давніший стан — прийнятно).
export const JOBSTATE_THROTTLE_MS = 10_000;

// ── Фабрика стора (DI Drive-порт) ───────────────────────────────────────────
// drivePort:
//   getOrCreateFolder(name, parentId|null) → { id }
//   listFolder(folderId) → [{ id, name, modifiedTime }]
//   uploadText(folderId, name, content, mime?) → { id }
//   readText(fileId) → string
//   deleteFile(fileId) → void
export function createJobStateStore(drivePort, options = {}) {
  if (!drivePort) throw new Error('createJobStateStore: drivePort обовʼязковий');
  const throttleMs = Number.isFinite(options.throttleMs)
    ? Math.max(0, options.throttleMs) : JOBSTATE_THROTTLE_MS;

  // Папка _temp/<caseId>_<jobId>/. Кеш id у межах інстансу — нуль зайвих
  // Drive-lookup'ів на кожен save.
  const folderCache = new Map();
  async function jobFolderId(caseId, jobId) {
    const key = `${caseId}_${jobId}`;
    if (folderCache.has(key)) return folderCache.get(key);
    const root = await drivePort.getOrCreateFolder(TEMP_ROOT, null);
    const folder = await drivePort.getOrCreateFolder(key, root.id);
    folderCache.set(key, folder.id);
    return folder.id;
  }

  async function listStateFiles(folderId) {
    const files = await drivePort.listFolder(folderId);
    return (files || [])
      .filter((f) => f.name === JOB_STATE_FILE)
      .sort((a, b) => String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')));
  }

  // Фактичний crash-safe запис на Drive — спільний для saveState
  // (immediate) і саме-таймера throttled. Один сенс: "положити свіжий
  // JOB_STATE_FILE на Drive, прибрати попередні дублі".
  async function _writeState(state) {
    const next = { ...state, updatedAt: new Date().toISOString() };
    const folderId = await jobFolderId(next.caseId, next.jobId);
    const existing = await listStateFiles(folderId);
    await drivePort.uploadText(
      folderId, JOB_STATE_FILE, JSON.stringify(next), 'application/json',
    );
    for (const old of existing) {
      try { await drivePort.deleteFile(old.id); } catch { /* старий дубль — не критично */ }
    }
    return next;
  }

  // Стан throttle (per-store-instance, тобто per-job через createStreaming).
  let throttleTimer = null;
  let pendingState = null;
  let lastSaveAt = 0;

  function _cancelPending() {
    if (throttleTimer !== null) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    pendingState = null;
  }

  // saveState — IMMEDIATE. Контракт DP-3 збережено (тести). Скасовує
  // pending throttled (immediate перебиває старіший стан що чекав).
  async function saveState(state) {
    _cancelPending();
    lastSaveAt = Date.now();
    return _writeState(state);
  }

  // saveStateThrottled — leading-edge throttle: перший виклик у вікні
  // throttleMs — одразу; наступні в вікні — об'єднуються у відкладений
  // trailing-save з НАЙСВІЖІШИМ pendingState. Acceptance P4 (30 saves
  // у 5 сек → ≤2 uploads, останній має найсвіжіший стан) виконується.
  async function saveStateThrottled(state) {
    pendingState = state;
    const now = Date.now();
    const sinceLast = now - lastSaveAt;
    if (sinceLast >= throttleMs) {
      // Leading edge — пишемо одразу.
      if (throttleTimer !== null) { clearTimeout(throttleTimer); throttleTimer = null; }
      lastSaveAt = now;
      const s = pendingState;
      pendingState = null;
      return _writeState(s);
    }
    if (throttleTimer !== null) return;             // вже scheduled trailing
    const delay = throttleMs - sinceLast;
    throttleTimer = setTimeout(async () => {
      throttleTimer = null;
      const s = pendingState;
      pendingState = null;
      lastSaveAt = Date.now();
      try { await _writeState(s); } catch { /* throttled save — побічна, не валимо */ }
    }, delay);
  }

  // flushPendingSave — викликати ПЕРЕД terminal saveState щоб гарантувати
  // що відкладений throttled-save не перезапише terminal стан пізніше.
  // Якщо нічого pending — no-op.
  async function flushPendingSave() {
    if (throttleTimer !== null) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    if (pendingState) {
      const s = pendingState;
      pendingState = null;
      lastSaveAt = Date.now();
      return _writeState(s);
    }
  }

  // loadState — найсвіжіший стан або null. Прибирає старі дублі по дорозі.
  async function loadState(caseId, jobId) {
    const folderId = await jobFolderId(caseId, jobId);
    const files = await listStateFiles(folderId);
    if (files.length === 0) return null;
    let parsed = null;
    try {
      parsed = JSON.parse(await drivePort.readText(files[0].id));
    } catch {
      return null;                       // биткий стан — почати з нуля безпечніше
    }
    for (const dup of files.slice(1)) {
      try { await drivePort.deleteFile(dup.id); } catch { /* noop */ }
    }
    return parsed;
  }

  // clearState — після успіху (або «видалити все» при скасуванні). Видаляє
  // ВЕСЬ вміст _temp/<caseId>_<jobId>/ (job_state + chunk-байти). КРИТИЧНО:
  // скасовує throttled-timer ПЕРЕД видаленням, інакше відкладений save
  // спрацює пізніше і відновить job_state.json після clearState (leak).
  async function clearState(caseId, jobId) {
    _cancelPending();
    const folderId = await jobFolderId(caseId, jobId);
    const files = await drivePort.listFolder(folderId);
    for (const f of files || []) {
      try { await drivePort.deleteFile(f.id); } catch { /* noop */ }
    }
    folderCache.delete(`${caseId}_${jobId}`);
    return true;
  }

  // hasResumableJob — чи є незавершений job (status !== done і є chunks).
  async function hasResumableJob(caseId, jobId) {
    const st = await loadState(caseId, jobId);
    return !!(st && st.status !== JOB_STATUS.DONE);
  }

  return {
    saveState,
    saveStateThrottled,
    flushPendingSave,
    loadState,
    clearState,
    hasResumableJob,
    _jobFolderId: jobFolderId,           // для chunkManager (спільна папка _temp)
  };
}
