// @vitest-environment jsdom
//
// Спільний хук usePreviewUrls (модалка + DP, борг #33). Перевіряємо канонічну
// поведінку (винесену з DP-версії):
//   • генерує baked-blob URL лише для targets (auto-rotation != 0 / processedBlob
//     / applied crop), не для proposal-only;
//   • викликає computeRenderedBlob з applyUserRotation:false / applyCrop:true /
//     includeProposalRect:false;
//   • на unmount revoke'ає створені URL (без leak).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockComputeRenderedBlob = vi.fn();
vi.mock('../../src/services/sortation/imageRenderer.js', () => ({
  computeRenderedBlob: (...args) => mockComputeRenderedBlob(...args),
  userRotationCssDelta: () => 0,
}));

let urlSeq = 0;
const created = [];
const revoked = [];

beforeEach(() => {
  mockComputeRenderedBlob.mockReset();
  mockComputeRenderedBlob.mockImplementation(async () => new Blob(['baked'], { type: 'image/jpeg' }));
  urlSeq = 0;
  created.length = 0;
  revoked.length = 0;
  global.URL.createObjectURL = vi.fn(() => { const u = `blob:fake-${urlSeq++}`; created.push(u); return u; });
  global.URL.revokeObjectURL = vi.fn((u) => { revoked.push(u); });
});

async function importHook() {
  const mod = await import('../../src/components/ImageEditor/hooks/usePreviewUrls.js');
  return mod.usePreviewUrls;
}

function files(n) {
  return Array.from({ length: n }, (_, i) => new File([new Uint8Array(10)], `IMG_${i}.jpg`, { type: 'image/jpeg' }));
}

function baseArgs(realFiles, overrides = {}) {
  return {
    realFiles,
    detectedOrientations: realFiles.map(() => 0),
    userRotation: new Map(),
    processedBlobs: new Map(),
    cropOverrides: new Map(),
    cropProposals: new Map(),
    cropDisabled: new Set(),
    cropAppliedSet: new Set(),
    ...overrides,
  };
}

describe('usePreviewUrls', () => {
  it('усі auto-orientation = 0, без crop → computeRenderedBlob НЕ викликається, previewUrls порожній', async () => {
    const usePreviewUrls = await importHook();
    const { result } = renderHook(() => usePreviewUrls(baseArgs(files(2))));
    await new Promise((r) => setTimeout(r, 20));
    expect(mockComputeRenderedBlob).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);
  });

  it('auto-orientation != 0 → генерує URL з правильними прапорами', async () => {
    const usePreviewUrls = await importHook();
    const rf = files(2);
    const { result } = renderHook(() =>
      usePreviewUrls(baseArgs(rf, { detectedOrientations: [90, 0] })),
    );
    await waitFor(() => expect(result.current.has(0)).toBe(true));
    expect(result.current.has(1)).toBe(false); // idx 1 — auto 0, не target
    expect(mockComputeRenderedBlob).toHaveBeenCalledWith(
      expect.objectContaining({ idx: 0 }),
      { applyUserRotation: false, applyCrop: true, includeProposalRect: false },
    );
  });

  it('proposal-only (без applied) → НЕ target', async () => {
    const usePreviewUrls = await importHook();
    const rf = files(1);
    const { result } = renderHook(() =>
      usePreviewUrls(baseArgs(rf, { cropProposals: new Map([[0, { x: 0 }]]) })),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(mockComputeRenderedBlob).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);
  });

  it('applied crop → target', async () => {
    const usePreviewUrls = await importHook();
    const rf = files(1);
    const { result } = renderHook(() =>
      usePreviewUrls(baseArgs(rf, {
        cropOverrides: new Map([[0, { x: 0 }]]),
        cropAppliedSet: new Set([0]),
      })),
    );
    await waitFor(() => expect(result.current.has(0)).toBe(true));
  });

  it('unmount → revoke створених URL (без leak)', async () => {
    const usePreviewUrls = await importHook();
    const rf = files(1);
    const { result, unmount } = renderHook(() =>
      usePreviewUrls(baseArgs(rf, { detectedOrientations: [90] })),
    );
    await waitFor(() => expect(result.current.has(0)).toBe(true));
    const url = result.current.get(0);
    unmount();
    expect(revoked).toContain(url);
  });
});
