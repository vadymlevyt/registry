// Інтеграційні тести естафетного тригера «DP → генератор контексту» (§4.1 TASK).
//
// Симулюємо стейт-машину CaseDossier (pendingContextRegen / isCreatingContext /
// caseData.documents) рівно тими самими ЧИСТИМИ вирішувачами, що й продакшн
// (contextRelay.derivePendingRegen / shouldStartContextRegen). Тобто тут НЕ
// дублюється логіка рішень — симулюється лише React-glue (setState + ре-запуск
// ефекту), щоб відтворити гонку стейт-пропагації, яку лікує TASK.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  derivePendingRegen,
  shouldStartContextRegen,
} from '../../src/components/CaseDossier/services/contextRelay.js';

const docs = (...ids) => ids.map((id) => ({ id, driveId: `drive_${id}` }));

// Deferred-гейт: тримає generateCaseContext «у польоті», щоб перевірити guard
// від подвійного запуску під час обробки (обробка реально триває 10+ хв).
function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

// RelaySim — вірна копія wiring'у index.jsx (3.2 слухач, 3.3 ефект, фініш-clear),
// побудована поверх справжніх чистих вирішувачів. Жодної власної логіки рішень.
class RelaySim {
  constructor({ caseId, documents, generate }) {
    this.caseId = caseId;
    this.documents = documents;
    this.generate = generate;        // async ({ documents, expectedDocIds }) => result
    this.pending = null;             // pendingContextRegen
    this.isCreatingContext = false;
    this.running = null;             // promise поточного забігу генератора
  }

  // 3.2 — слухач події DOCUMENT_BATCH_PROCESSED: лише ставить паличку.
  onEvent(payload) {
    const pending = derivePendingRegen(payload, this.caseId);
    if (!pending) return;
    this.pending = pending;
    this.runEffect();
  }

  // setCases-ре-рендер: документи приземлились у метадані → ефект перезапускається.
  landDocuments(newDocuments) {
    this.documents = newDocuments;
    this.runEffect();
  }

  // 3.3 — ефект на caseData.documents / pendingContextRegen / isCreatingContext.
  runEffect() {
    if (!shouldStartContextRegen({
      pendingContextRegen: this.pending,
      caseId: this.caseId,
      documents: this.documents,
      isCreatingContext: this.isCreatingContext,
    })) return;
    this.running = this.runDpContextRegen(this.pending);
  }

  // 3.x — генератор: isCreatingContext=true синхронно (як setState до await),
  // на фініші (finally) знімає паличку незалежно від успіху/помилки.
  async runDpContextRegen(pending) {
    this.isCreatingContext = true;     // синхронно, до першого await
    try {
      return await this.generate({ documents: this.documents, expectedDocIds: pending.expectedDocIds });
    } finally {
      this.pending = null;
      this.isCreatingContext = false;
    }
  }
}

describe('DP context relay — естафетний тригер (§4.1)', () => {
  let gate;
  let generate;

  beforeEach(() => {
    gate = deferred();
    generate = vi.fn(async () => { await gate.promise; return { saved: true, stats: {} }; });
  });

  it('1. Непорожня справа: гонка усунена — генерація чекає, тоді бачить N+M один раз', async () => {
    const existing = docs('e1', 'e2');                      // N = 2
    const sim = new RelaySim({ caseId: 'case_1', documents: existing, generate });

    // Подія приходить ДО оновлення caseData.documents (як у проді: publish синхронно).
    sim.onEvent({
      caseId: 'case_1', updateCaseContext: true, documentIds: ['n1', 'n2'],  // M = 2
    });
    // Паличка стоїть, але документи ще старі → генерація НЕ стартувала (race avoided).
    expect(generate).not.toHaveBeenCalled();
    expect(sim.pending).not.toBeNull();

    // Метадані оновились (N+M = 4) → генерація стартує.
    sim.landDocuments(docs('e1', 'e2', 'n1', 'n2'));
    expect(generate).toHaveBeenCalledTimes(1);
    // Генератор бачить ПОВНИЙ набір N+M, а не старий N.
    const seen = generate.mock.calls[0][0].documents.map((d) => d.id);
    expect(seen).toEqual(['e1', 'e2', 'n1', 'n2']);

    // Зайві ре-рендери поки генерація біжить → другої генерації немає.
    sim.landDocuments(docs('e1', 'e2', 'n1', 'n2'));
    expect(generate).toHaveBeenCalledTimes(1);

    // Фініш → паличка знята.
    gate.resolve();
    await sim.running;
    expect(sim.pending).toBeNull();
    expect(sim.isCreatingContext).toBe(false);
  });

  it('2. Падіння DP: publish не відбувається → паличка не ставиться, генерації нема', async () => {
    const sim = new RelaySim({ caseId: 'case_1', documents: docs('e1'), generate });
    // add_documents повернув {success:false} → DP не публікує подію взагалі.
    // Симулюємо це відсутністю onEvent; навіть якщо документи зміняться:
    sim.landDocuments(docs('e1', 'maybe'));
    expect(sim.pending).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it('3. Тумблер вимкнено: подія з updateCaseContext:false → паличка не ставиться', async () => {
    const sim = new RelaySim({ caseId: 'case_1', documents: docs('e1'), generate });
    sim.onEvent({ caseId: 'case_1', updateCaseContext: false, documentIds: ['n1'] });
    expect(sim.pending).toBeNull();
    sim.landDocuments(docs('e1', 'n1'));
    expect(generate).not.toHaveBeenCalled();
  });

  it('4. Чужа справа: payload.caseId !== caseData.id → ігнор', async () => {
    const sim = new RelaySim({ caseId: 'case_1', documents: docs('e1'), generate });
    sim.onEvent({ caseId: 'case_OTHER', updateCaseContext: true, documentIds: ['n1'] });
    expect(sim.pending).toBeNull();
    sim.landDocuments(docs('e1', 'n1'));
    expect(generate).not.toHaveBeenCalled();
  });

  it('5. Без дублювання: ре-рендери після старту не запускають другу генерацію', async () => {
    const sim = new RelaySim({ caseId: 'case_1', documents: docs('e1'), generate });
    sim.onEvent({ caseId: 'case_1', updateCaseContext: true, documentIds: ['n1'] });
    sim.landDocuments(docs('e1', 'n1'));               // старт #1
    expect(generate).toHaveBeenCalledTimes(1);
    // Кілька зайвих ре-рендерів поки генерація в польоті.
    sim.landDocuments(docs('e1', 'n1'));
    sim.landDocuments(docs('e1', 'n1'));
    expect(generate).toHaveBeenCalledTimes(1);
    gate.resolve();
    await sim.running;
  });

  it('6. Ручне додавання через модалку (без події) → нарис не тригериться', async () => {
    const sim = new RelaySim({ caseId: 'case_1', documents: docs('e1'), generate });
    // Жодного DOCUMENT_BATCH_PROCESSED — просто змінились документи (ручне +Додати).
    sim.landDocuments(docs('e1', 'manual'));
    sim.landDocuments(docs('e1'));                    // видалення
    expect(sim.pending).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it('фініш знімає паличку навіть при ПОМИЛЦІ генерації', async () => {
    const boom = vi.fn(async () => { throw new Error('NO_API_KEY'); });
    const sim = new RelaySim({ caseId: 'case_1', documents: docs('e1'), generate: boom });
    sim.onEvent({ caseId: 'case_1', updateCaseContext: true, documentIds: ['n1'] });
    sim.landDocuments(docs('e1', 'n1'));
    await expect(sim.running).rejects.toThrow('NO_API_KEY');
    expect(sim.pending).toBeNull();
    expect(sim.isCreatingContext).toBe(false);
  });

  it('нова подія перезатирає сталу паличку (self-heal)', async () => {
    const sim = new RelaySim({ caseId: 'case_1', documents: docs('e1'), generate });
    sim.onEvent({ caseId: 'case_1', updateCaseContext: true, documentIds: ['n1'] });
    expect(sim.pending.expectedDocIds).toEqual(['n1']);
    // Другий DP-забіг з іншим набором — паличка оновлюється.
    sim.onEvent({ caseId: 'case_1', updateCaseContext: true, documentIds: ['n2', 'n3'] });
    expect(sim.pending.expectedDocIds).toEqual(['n2', 'n3']);
    expect(generate).not.toHaveBeenCalled();
  });
});
