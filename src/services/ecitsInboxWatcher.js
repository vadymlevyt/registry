// ── ECITS INBOX WATCHER ─────────────────────────────────────────────────────
// Тригер обробки нових файлів з ЄСІТС-каналу (папка 00_INBOX_СПРАВИ справи).
// Слухає eventBus.ECITS_DOCUMENTS_RECEIVED (інфра-топік TASK 0.2 — publisher
// зʼявиться коли активують Court Sync RPA; зараз подія не летить, watcher
// behavior-neutral, як emit-стадія DP-1 без підписників).
//
// Два режими (tenant.settings.ecitsAutoProcess, дефолт 'manual'):
//   • 'auto'   — запускає pipeline у фоні (fire-and-forget; deps.runPipeline).
//   • 'manual' — пише lastProcessingContext («є нові файли в INBOX, N шт.»)
//                через executeAction і публікує ECITS_INBOX_PENDING для
//                UI-індикатора у досьє (реальний UI — DP-4).
//
// Фабрика з DI (як createActions/createDocumentPipeline) — НЕ глобальний
// сінглтон. Не вмонтований у App.jsx у DP-2: це точка розширення, активується
// у DP-4 разом із publisher'ом Court Sync і UI-індикатором.

function summarizeManual(count) {
  const n = Number(count) || 0;
  return `Є нові файли в INBOX, ${n} шт.`;
}

// deps:
//   eventBus            — { subscribe(topic,h)→unsub, publish(topic,payload) }
//   topics              — { ECITS_DOCUMENTS_RECEIVED, ECITS_INBOX_PENDING }
//   getEcitsAutoProcess() → 'auto' | 'manual' (дефолт 'manual' якщо нема поля)
//   executeAction(agentId,action,params) — для manual-режиму (update_processing_context)
//   runPipeline(payload)  — для auto-режиму (будує createDocumentPipeline з
//                           DP-2 stageOverrides і ганяє 00_INBOX-файли)
//   getActor()          — { tenantId, userId } (SaaS payload)
//   onError(err,context)— опційний хук діагностики
export function createEcitsInboxWatcher(deps = {}) {
  const {
    eventBus,
    topics = {},
    getEcitsAutoProcess,
    executeAction,
    runPipeline,
    getActor,
    onError,
  } = deps;

  let unsubscribe = null;

  function resolveMode() {
    const m = typeof getEcitsAutoProcess === 'function' ? getEcitsAutoProcess() : null;
    return m === 'auto' ? 'auto' : 'manual';      // невідоме/відсутнє → manual (дефолт)
  }

  function reportError(err, context) {
    try { if (typeof onError === 'function') onError(err, context); } catch { /* ізольовано */ }
  }

  async function handleAuto(payload) {
    if (typeof runPipeline !== 'function') return;
    try {
      await runPipeline(payload);                 // фон: помилка не валить watcher
    } catch (err) {
      reportError(err, { mode: 'auto', payload });
    }
  }

  async function handleManual(payload) {
    const actor = (typeof getActor === 'function' && getActor()) || {};
    const count = payload?.count ?? payload?.documentsCount
      ?? (Array.isArray(payload?.files) ? payload.files.length : 0);
    const caseId = payload?.caseId;

    if (caseId && typeof executeAction === 'function') {
      try {
        await executeAction('document_processor_agent', 'update_processing_context', {
          caseId,
          context: {
            processedAt: new Date().toISOString(),
            documentsCount: count,
            summary: summarizeManual(count),
          },
        });
      } catch (err) {
        reportError(err, { mode: 'manual', step: 'update_processing_context', payload });
      }
    }

    if (eventBus && typeof eventBus.publish === 'function' && topics.ECITS_INBOX_PENDING) {
      try {
        eventBus.publish(topics.ECITS_INBOX_PENDING, {
          caseId: caseId ?? null,
          count,
          tenantId: actor.tenantId ?? null,
          userId: actor.userId ?? null,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        reportError(err, { mode: 'manual', step: 'publish', payload });
      }
    }
  }

  async function handleEvent(payload) {
    const mode = resolveMode();
    if (mode === 'auto') return handleAuto(payload);
    return handleManual(payload);
  }

  return {
    // Підписатись на ЄСІТС-надходження. Ідемпотентно (повторний start no-op).
    start() {
      if (unsubscribe) return;
      if (!eventBus || typeof eventBus.subscribe !== 'function' || !topics.ECITS_DOCUMENTS_RECEIVED) {
        return;
      }
      unsubscribe = eventBus.subscribe(topics.ECITS_DOCUMENTS_RECEIVED, (payload) => {
        // eventBus.publish ловить винятки підписників, але handleEvent async —
        // обгортаємо щоб rejected-проміс не «висів».
        Promise.resolve(handleEvent(payload)).catch(err => reportError(err, { payload }));
      });
    },
    stop() {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    },
    // Прямий виклик (для тестів/майбутнього ручного тригера з UI DP-4).
    handleEvent,
    resolveMode,
  };
}
