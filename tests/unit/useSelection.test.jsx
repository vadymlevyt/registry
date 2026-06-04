// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSelection } from '../../src/components/UI/useSelection.js';

describe('useSelection (TASK bulk_delete_unify)', () => {
  it('початковий стан — порожній вибір', () => {
    const { result } = renderHook(() => useSelection(['a', 'b', 'c']));
    expect(result.current.count).toBe(0);
    expect(result.current.allSelected).toBe(false);
    expect(result.current.someSelected).toBe(false);
  });

  it('toggle додає і прибирає id', () => {
    const { result } = renderHook(() => useSelection(['a', 'b', 'c']));
    act(() => result.current.toggle('a'));
    expect(result.current.isSelected('a')).toBe(true);
    expect(result.current.count).toBe(1);
    act(() => result.current.toggle('a'));
    expect(result.current.isSelected('a')).toBe(false);
  });

  it('toggle з явним value виставляє стан', () => {
    const { result } = renderHook(() => useSelection(['a', 'b']));
    act(() => result.current.toggle('a', true));
    act(() => result.current.toggle('a', true)); // повторно true — лишається true
    expect(result.current.count).toBe(1);
    act(() => result.current.toggle('a', false));
    expect(result.current.isSelected('a')).toBe(false);
  });

  it('selectAll обирає всі, clear знімає', () => {
    const { result } = renderHook(() => useSelection(['a', 'b', 'c']));
    act(() => result.current.selectAll());
    expect(result.current.count).toBe(3);
    expect(result.current.allSelected).toBe(true);
    expect(result.current.someSelected).toBe(false);
    act(() => result.current.clear());
    expect(result.current.count).toBe(0);
  });

  it('someSelected (indeterminate) коли обрана частина', () => {
    const { result } = renderHook(() => useSelection(['a', 'b', 'c']));
    act(() => result.current.toggle('a'));
    expect(result.current.someSelected).toBe(true);
    expect(result.current.allSelected).toBe(false);
  });

  it('синхронізація: зник id зі списку → виходить із вибору', () => {
    let ids = ['a', 'b', 'c'];
    const { result, rerender } = renderHook(({ allIds }) => useSelection(allIds), {
      initialProps: { allIds: ids },
    });
    act(() => result.current.selectAll());
    expect(result.current.count).toBe(3);
    // Видаляємо 'b' зі списку (фільтр/видалення).
    ids = ['a', 'c'];
    rerender({ allIds: ids });
    expect(result.current.count).toBe(2);
    expect(result.current.isSelected('b')).toBe(false);
    expect(result.current.isSelected('a')).toBe(true);
    expect(result.current.allSelected).toBe(true); // 2 з 2 — знову всі
  });

  it('той самий вміст списку (новий масив-літерал) не скидає вибір', () => {
    const { result, rerender } = renderHook(({ allIds }) => useSelection(allIds), {
      initialProps: { allIds: ['a', 'b'] },
    });
    act(() => result.current.toggle('a'));
    expect(result.current.count).toBe(1);
    rerender({ allIds: ['a', 'b'] }); // інший масив, той самий вміст
    expect(result.current.count).toBe(1);
    expect(result.current.isSelected('a')).toBe(true);
  });
});
