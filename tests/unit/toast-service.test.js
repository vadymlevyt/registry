import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast, subscribeToToasts } from '../../src/services/toast.js';

describe('toast service', () => {
  let received;
  let unsubscribe;

  beforeEach(() => {
    toast.clear();
    received = [];
    if (unsubscribe) unsubscribe();
    unsubscribe = subscribeToToasts((event) => received.push(event));
  });

  it('toast.success генерує event з variant=success', () => {
    toast.success('OK');
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('add');
    expect(received[0].message.variant).toBe('success');
    expect(received[0].message.title).toBe('OK');
  });

  it('toast.error → variant=error, дефолтна тривалість більша', () => {
    toast.error('Помилка');
    expect(received[0].message.variant).toBe('error');
    expect(received[0].message.duration).toBeGreaterThan(3500);
  });

  it.each([
    ['warning', 'warning'],
    ['info', 'info'],
  ])('toast.%s генерує variant=%s', (method, expected) => {
    toast[method]('X');
    expect(received[0].message.variant).toBe(expected);
  });

  it('кожен виклик повертає унікальний id', () => {
    const a = toast.info('A');
    const b = toast.info('B');
    expect(a).not.toBe(b);
  });

  it('description передається у message', () => {
    toast.error('T', { description: 'D' });
    expect(received[0].message.description).toBe('D');
  });

  it('action передається у message', () => {
    const onClick = vi.fn();
    toast.error('T', { action: { label: 'Retry', onClick } });
    expect(received[0].message.action.label).toBe('Retry');
    expect(received[0].message.action.onClick).toBe(onClick);
  });

  it('persistent: true → message.persistent=true', () => {
    toast.info('Прогрес', { persistent: true });
    expect(received[0].message.persistent).toBe(true);
  });

  it('toast.dismiss(id) генерує dismiss event', () => {
    const id = toast.info('X');
    received.length = 0;
    toast.dismiss(id);
    expect(received[0].type).toBe('dismiss');
    expect(received[0].id).toBe(id);
  });

  it('toast.update(id, patch) генерує update event (прогрес на місці)', () => {
    const id = toast.info('Стиснення: 0 / 10 стор.', { persistent: true });
    received.length = 0;
    toast.update(id, { title: 'Стиснення: 5 / 10 стор.' });
    expect(received[0].type).toBe('update');
    expect(received[0].id).toBe(id);
    expect(received[0].patch.title).toBe('Стиснення: 5 / 10 стор.');
  });

  it('toast.update(null) — no-op (без event)', () => {
    toast.update(null, { title: 'x' });
    expect(received).toHaveLength(0);
  });

  it('toast.show з готового message-обʼєкта', () => {
    const msg = { variant: 'warning', title: 'T', description: 'D' };
    toast.show(msg);
    expect(received[0].message.variant).toBe('warning');
    expect(received[0].message.title).toBe('T');
  });

  it('toast.show з action — потребує onAction', () => {
    const msg = { variant: 'error', title: 'T', action: { label: 'Retry' } };
    const onAction = vi.fn();
    toast.show(msg, { onAction });
    expect(received[0].message.action.label).toBe('Retry');
    expect(received[0].message.action.onClick).toBe(onAction);
  });

  it('toast.show без onAction — action ігнорується', () => {
    const msg = { variant: 'error', title: 'T', action: { label: 'X' } };
    toast.show(msg);
    expect(received[0].message.action).toBeNull();
  });

  it('toast.clear генерує clear event', () => {
    toast.info('X');
    received.length = 0;
    toast.clear();
    expect(received[0].type).toBe('clear');
  });

  it('subscribeToToasts повертає unsubscribe функцію', () => {
    const fn = vi.fn();
    const off = subscribeToToasts(fn);
    toast.info('X');
    expect(fn).toHaveBeenCalled();
    off();
    fn.mockClear();
    toast.info('Y');
    expect(fn).not.toHaveBeenCalled();
  });

  it('show з порожнім title і description повертає null', () => {
    const id = toast.info();
    expect(id).toBeNull();
  });
});
