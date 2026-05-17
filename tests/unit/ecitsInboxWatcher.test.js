// DP-2 — ecitsInboxWatcher. Два режими (auto/manual), дефолт manual,
// ідемпотентний start, stop відписує, payload з SaaS-полями.
import { describe, it, expect, vi } from 'vitest';
import { createEcitsInboxWatcher } from '../../src/services/ecitsInboxWatcher.js';

const TOPICS = { ECITS_DOCUMENTS_RECEIVED: 'ecits.documents_received', ECITS_INBOX_PENDING: 'ecits.inbox_pending' };

function fakeBus() {
  const subs = new Map();
  return {
    subscribe(t, h) {
      if (!subs.has(t)) subs.set(t, new Set());
      subs.get(t).add(h);
      return () => subs.get(t).delete(h);
    },
    publish: vi.fn((t, p) => { for (const h of subs.get(t) || []) h(p); }),
    emit(t, p) { for (const h of subs.get(t) || []) h(p); },
    count(t) { return (subs.get(t) || new Set()).size; },
  };
}

describe('ecitsInboxWatcher — резолюція режиму', () => {
  it('дефолт manual коли getEcitsAutoProcess відсутній/невідомий', () => {
    expect(createEcitsInboxWatcher({}).resolveMode()).toBe('manual');
    expect(createEcitsInboxWatcher({ getEcitsAutoProcess: () => 'xxx' }).resolveMode()).toBe('manual');
    expect(createEcitsInboxWatcher({ getEcitsAutoProcess: () => 'auto' }).resolveMode()).toBe('auto');
  });
});

describe('ecitsInboxWatcher — manual режим', () => {
  it('пише lastProcessingContext через executeAction і публікує ECITS_INBOX_PENDING', async () => {
    const bus = fakeBus();
    const executeAction = vi.fn(async () => ({ success: true }));
    const w = createEcitsInboxWatcher({
      eventBus: bus, topics: TOPICS,
      getEcitsAutoProcess: () => 'manual',
      executeAction,
      getActor: () => ({ tenantId: 'ab', userId: 'vadym' }),
    });
    w.start();
    await w.handleEvent({ caseId: 'case_1', count: 3 });

    expect(executeAction).toHaveBeenCalledWith('document_processor_agent', 'update_processing_context', expect.objectContaining({
      caseId: 'case_1',
      context: expect.objectContaining({ documentsCount: 3, summary: 'Є нові файли в INBOX, 3 шт.' }),
    }));
    const pub = bus.publish.mock.calls.find(c => c[0] === TOPICS.ECITS_INBOX_PENDING);
    expect(pub).toBeTruthy();
    expect(pub[1]).toMatchObject({ caseId: 'case_1', count: 3, tenantId: 'ab', userId: 'vadym' });
  });

  it('count бере з files[].length якщо count не передано', async () => {
    const bus = fakeBus();
    const executeAction = vi.fn(async () => ({ success: true }));
    const w = createEcitsInboxWatcher({ eventBus: bus, topics: TOPICS, executeAction, getEcitsAutoProcess: () => 'manual' });
    await w.handleEvent({ caseId: 'c', files: [{}, {}] });
    expect(executeAction.mock.calls[0][2].context.documentsCount).toBe(2);
  });
});

describe('ecitsInboxWatcher — auto режим', () => {
  it('викликає runPipeline, executeAction НЕ зачіпається', async () => {
    const runPipeline = vi.fn(async () => ({ ok: true }));
    const executeAction = vi.fn();
    const w = createEcitsInboxWatcher({
      topics: TOPICS, getEcitsAutoProcess: () => 'auto', runPipeline, executeAction,
    });
    await w.handleEvent({ caseId: 'case_1', count: 1 });
    expect(runPipeline).toHaveBeenCalledTimes(1);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('помилка runPipeline не злітає вгору (фон) — onError отримує її', async () => {
    const onError = vi.fn();
    const w = createEcitsInboxWatcher({
      topics: TOPICS, getEcitsAutoProcess: () => 'auto',
      runPipeline: async () => { throw new Error('boom'); }, onError,
    });
    await expect(w.handleEvent({ caseId: 'c' })).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ mode: 'auto' }));
  });
});

describe('ecitsInboxWatcher — підписка', () => {
  it('start ідемпотентний; stop відписує; подія з шини обробляється', async () => {
    const bus = fakeBus();
    const executeAction = vi.fn(async () => ({ success: true }));
    const w = createEcitsInboxWatcher({ eventBus: bus, topics: TOPICS, executeAction, getEcitsAutoProcess: () => 'manual' });
    w.start();
    w.start();                                    // другий start — no-op
    expect(bus.count(TOPICS.ECITS_DOCUMENTS_RECEIVED)).toBe(1);

    bus.emit(TOPICS.ECITS_DOCUMENTS_RECEIVED, { caseId: 'c', count: 1 });
    await Promise.resolve();
    expect(executeAction).toHaveBeenCalledTimes(1);

    w.stop();
    expect(bus.count(TOPICS.ECITS_DOCUMENTS_RECEIVED)).toBe(0);
  });
});
