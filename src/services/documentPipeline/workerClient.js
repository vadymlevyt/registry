// ── DP-3 · WORKER CLIENT (DI SEAM) ──────────────────────────────────────────
// Main-thread обгортка над pipelineWorker. Єдиний інтерфейс
// `runInWorker(op, payload, transfer)` для streamingExecutor/стадій — їм
// байдуже, виконалось у Worker чи синхронно.
//
// Дві реалізації за одним контрактом (Strategy + Provider Pattern):
//   • реальний Web Worker      — браузер з підтримкою (важкий CPU поза UI).
//   • синхронний in-process    — тести (vitest/Node) і середовища без Worker
//     (стара Safari) — той самий handleMessage, нуль розбіжності результату.
//
// Фабрика з DI (як createActions/createDocumentPipeline), НЕ глобальний
// сінглтон. Worker лінивий: інстанціюється при першому виклику, не при
// створенні клієнта (нуль вартості якщо pipeline не запускали).

import { handleMessage } from '../../workers/pipelineWorker.js';

// Чи доступний справжній Web Worker у цьому середовищі.
function workerSupported() {
  return typeof Worker !== 'undefined' && typeof window !== 'undefined';
}

// Спавн реального Worker як ES-module chunk (Vite + base '/registry/' →
// хешований asset, який GitHub Pages віддає статикою).
function spawnDefaultWorker() {
  return new Worker(new URL('../../workers/pipelineWorker.js', import.meta.url), {
    type: 'module',
  });
}

// deps (опційно):
//   createWorker() → Worker            — override спавну (тест/діагностика).
//   forceInProcess: boolean            — примусово синхронний шлях.
export function createWorkerClient(deps = {}) {
  const forceInProcess = deps.forceInProcess === true;
  const createWorker = deps.createWorker || (workerSupported() ? spawnDefaultWorker : null);

  let worker = null;
  let seq = 0;
  const pending = new Map();

  function ensureWorker() {
    if (worker || !createWorker) return worker;
    worker = createWorker();
    worker.onmessage = (e) => {
      const { id, ok, result, error } = e.data || {};
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (ok) p.resolve(result);
      else p.reject(new Error(error?.message || 'worker error'));
    };
    worker.onerror = (err) => {
      // Воркер впав цілком — відхиляємо всі очікувані, далі йдемо in-process.
      for (const p of pending.values()) p.reject(err instanceof Error ? err : new Error('worker crashed'));
      pending.clear();
      try { worker.terminate(); } catch { /* noop */ }
      worker = null;
    };
    return worker;
  }

  // Один сенс: виконати чисту CPU-операцію (compressPdf/splitPdf/mergeText/
  // parseJson) і повернути результат. transfer — ArrayBuffer[] для нуль-копії.
  async function runInWorker(op, payload, transfer = []) {
    if (forceInProcess || !createWorker) {
      const { result } = await handleMessage(op, payload);
      return result;
    }
    const w = ensureWorker();
    if (!w) {
      const { result } = await handleMessage(op, payload);
      return result;
    }
    const id = `w${++seq}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        w.postMessage({ id, op, payload }, transfer || []);
      } catch (err) {
        pending.delete(id);
        // postMessage кинув (наприклад detached buffer) — деградуємо до
        // синхронного шляху, щоб обробка не зупинилась.
        handleMessage(op, payload).then(
          ({ result }) => resolve(result),
          (e) => reject(e),
        );
      }
    });
  }

  function dispose() {
    if (worker) {
      try { worker.terminate(); } catch { /* noop */ }
      worker = null;
    }
    pending.clear();
  }

  return { runInWorker, dispose, isInProcess: () => forceInProcess || !createWorker };
}
