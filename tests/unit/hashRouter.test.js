// @vitest-environment jsdom
// hashRouter.test.js — TASK 0.4

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as router from '../../src/services/hashRouter.js';

beforeEach(() => {
  router.__resetForTests();
  // jsdom: скинути hash між тестами
  if (typeof window !== 'undefined') {
    window.location.hash = '';
  }
});

describe('hashRouter.parseHash', () => {
  it('повертає null module для hash без префікса #/', () => {
    expect(router.parseHash('#section')).toEqual({ module: null, entityId: null, view: null, raw: '#section' });
    expect(router.parseHash('')).toEqual({ module: null, entityId: null, view: null, raw: '' });
  });
  it('розбирає #/court-sync', () => {
    expect(router.parseHash('#/court-sync')).toEqual({
      module: 'court-sync', entityId: null, view: null, raw: '#/court-sync',
    });
  });
  it('розбирає #/court-sync/import', () => {
    expect(router.parseHash('#/court-sync/import')).toEqual({
      module: 'court-sync', entityId: 'import', view: null, raw: '#/court-sync/import',
    });
  });
  it('розбирає #/case/case_123/documents (3-рівневий)', () => {
    expect(router.parseHash('#/case/case_123/documents')).toEqual({
      module: 'case', entityId: 'case_123', view: 'documents', raw: '#/case/case_123/documents',
    });
  });
});

describe('hashRouter.registerRoute + start', () => {
  it('викликає onEnter коли hash збігається', () => {
    const onEnter = vi.fn();
    router.registerRoute('court-sync', { onEnter });
    window.location.hash = '#/court-sync/import';
    router.start();
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onEnter.mock.calls[0][0]).toMatchObject({ module: 'court-sync', entityId: 'import' });
  });

  it('викликає onLeave старого модуля коли переходимо в інший', () => {
    const csEnter = vi.fn();
    const csLeave = vi.fn();
    const docEnter = vi.fn();
    router.registerRoute('court-sync', { onEnter: csEnter, onLeave: csLeave });
    router.registerRoute('documents', { onEnter: docEnter });
    window.location.hash = '#/court-sync';
    router.start();
    expect(csEnter).toHaveBeenCalledTimes(1);

    window.location.hash = '#/documents';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(csLeave).toHaveBeenCalledTimes(1);
    expect(docEnter).toHaveBeenCalledTimes(1);
  });

  it('subscribe отримує події всіх роутів', () => {
    const listener = vi.fn();
    router.subscribe(listener);
    router.start();
    window.location.hash = '#/court-sync/import';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls[listener.mock.calls.length - 1][0].module).toBe('court-sync');
  });

  it('registerRoute після start() з тим самим hash викликає onEnter одразу', () => {
    window.location.hash = '#/court-sync';
    router.start();
    const onEnter = vi.fn();
    router.registerRoute('court-sync', { onEnter });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('navigate() оновлює hash', () => {
    router.start();
    router.navigate('court-sync/settings');
    expect(window.location.hash).toBe('#/court-sync/settings');
  });

  it('getCurrentRoute() повертає поточний роут', () => {
    router.start();
    window.location.hash = '#/court-sync/import';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(router.getCurrentRoute()).toMatchObject({ module: 'court-sync', entityId: 'import' });
  });

  it('ігнорує hash без префікса #/', () => {
    const onEnter = vi.fn();
    router.registerRoute('court-sync', { onEnter });
    window.location.hash = '#section';
    router.start();
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('обгортає винятки з onEnter і не падає', () => {
    const onEnter = vi.fn(() => { throw new Error('boom'); });
    router.registerRoute('court-sync', { onEnter });
    window.location.hash = '#/court-sync';
    expect(() => router.start()).not.toThrow();
  });
});
