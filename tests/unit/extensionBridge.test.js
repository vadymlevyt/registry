// @vitest-environment jsdom
// extensionBridge.test.js — TASK 0.4

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as bridge from '../../src/services/extensionBridge.js';

beforeEach(() => {
  bridge.__resetForTests();
});

describe('extensionBridge', () => {
  it('не публікує window.LegalBMS до enable()', () => {
    expect(globalThis.window?.LegalBMS).toBeUndefined();
    expect(bridge.isEnabled()).toBe(false);
  });

  it('публікує window.LegalBMS після enable() з API_LEVEL і version', () => {
    bridge.configure({
      submitScenarioResult: vi.fn(),
      eventBus: { subscribe: vi.fn() },
      getEntitlementsForExtension: () => ({}),
    });
    bridge.enable();
    expect(bridge.isEnabled()).toBe(true);
    expect(globalThis.window.LegalBMS).toBeDefined();
    expect(globalThis.window.LegalBMS.apiLevel).toBe(bridge.__API_LEVEL);
    expect(globalThis.window.LegalBMS.version).toBe(bridge.__VERSION);
    expect(globalThis.window.LegalBMS.isReady).toBe(true);
  });

  it('whenReady() резолвиться після enable()', async () => {
    const promise = bridge.configure({ submitScenarioResult: vi.fn(), eventBus: { subscribe: vi.fn() }, getEntitlementsForExtension: () => ({}) });
    bridge.enable();
    await expect(globalThis.window.LegalBMS.whenReady()).resolves.toBeUndefined();
  });

  it('submitScenarioResult прокидає transport: extension в deps', async () => {
    const stub = vi.fn(async () => ({ casesCreated: 1 }));
    bridge.configure({ submitScenarioResult: stub, eventBus: { subscribe: vi.fn() }, getEntitlementsForExtension: () => ({}) });
    bridge.enable();
    await globalThis.window.LegalBMS.submitScenarioResult({ envelope: 1 });
    expect(stub).toHaveBeenCalledWith({ envelope: 1 }, { transport: 'extension' });
  });

  it('on(event, handler) делегує eventBus.subscribe', () => {
    const unsub = vi.fn();
    const subscribe = vi.fn(() => unsub);
    bridge.configure({ submitScenarioResult: vi.fn(), eventBus: { subscribe }, getEntitlementsForExtension: () => ({}) });
    bridge.enable();
    const handler = vi.fn();
    const off = globalThis.window.LegalBMS.on('ecits.sync_completed', handler);
    expect(subscribe).toHaveBeenCalledWith('ecits.sync_completed', handler);
    expect(off).toBe(unsub);
  });

  it('getEntitlements() повертає те що дають deps', () => {
    bridge.configure({
      submitScenarioResult: vi.fn(),
      eventBus: { subscribe: vi.fn() },
      getEntitlementsForExtension: () => ({ ecits: { enabled: true } }),
    });
    bridge.enable();
    expect(globalThis.window.LegalBMS.getEntitlements()).toEqual({ ecits: { enabled: true } });
  });

  it('enable() ідемпотентна — повторний виклик не міняє window.LegalBMS', () => {
    bridge.configure({ submitScenarioResult: vi.fn(), eventBus: { subscribe: vi.fn() }, getEntitlementsForExtension: () => ({}) });
    bridge.enable();
    const ref1 = globalThis.window.LegalBMS;
    bridge.enable();
    expect(globalThis.window.LegalBMS).toBe(ref1);
  });

  it('кидає коли submitScenarioResult викликано до configure()', async () => {
    bridge.enable();
    await expect(globalThis.window.LegalBMS.submitScenarioResult({})).rejects.toThrow(/not configured/);
  });

  it('кидає коли getEntitlements() викликано до configure()', () => {
    bridge.enable();
    expect(() => globalThis.window.LegalBMS.getEntitlements()).toThrow(/not configured/);
  });

  it('диспатчить legalbms:ready DOM event', () => {
    const handler = vi.fn();
    document.addEventListener('legalbms:ready', handler);
    bridge.configure({ submitScenarioResult: vi.fn(), eventBus: { subscribe: vi.fn() }, getEntitlementsForExtension: () => ({}) });
    bridge.enable();
    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].detail.apiLevel).toBe(bridge.__API_LEVEL);
    document.removeEventListener('legalbms:ready', handler);
  });

  it('__resetForTests прибирає window.LegalBMS і дозволяє повторну ініціалізацію', () => {
    bridge.configure({ submitScenarioResult: vi.fn(), eventBus: { subscribe: vi.fn() }, getEntitlementsForExtension: () => ({}) });
    bridge.enable();
    expect(globalThis.window.LegalBMS).toBeDefined();
    bridge.__resetForTests();
    expect(globalThis.window.LegalBMS).toBeUndefined();
    expect(bridge.isEnabled()).toBe(false);
  });
});
