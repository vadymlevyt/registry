// @vitest-environment jsdom
//
// #11 (друга хвиля image-merge фіксів) — РЕГРЕС: обрізка/поворот з попапа
// нестабільні, інколи чорний екран / сире-перевернуте фото.
//
// КОРІНЬ (підтверджено адвокатом+радником): ефект `displayUrl` у PreviewPopup
// ревокує свій per-run `createdUrl` у cleanup. Натиск ↻ (handleRotateInPopup)
// ставить `popupRotationLockRef=true`, ефект перезапускається, але рано
// виходить (lock) — НЕ створює новий blob і НЕ міняє displayUrl. При цьому
// cleanup попереднього запуску вже ревокнув createdUrl, на який displayUrl
// досі вказує → <img>/cropper тримає мертвий blob URL → чорний/сире.
//
// Цей тест — детермінований сторож: після ↻ (lock-гілка) активний displayUrl
// НЕ має бути ревокований. До фіксу — падає (URL ревокнуто). Без fake DOM
// таймінгу: ревокація відбувається синхронно у commit'і re-render'а.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// computeRenderedBlob — мок (не лізти у Canvas). Завжди повертає НОВИЙ blob,
// щоб PreviewPopup створив об'єктний URL через createObjectURL.
vi.mock('../../src/services/sortation/imageRenderer.js', () => ({
  computeRenderedBlob: vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' })),
  userRotationCssDelta: () => 0,
}));

// react-advanced-cropper — CropperHost лінькувато його імпортує на mount навіть
// у view-only гілці; мокаємо щоб не тягнути реальну бібліотеку у jsdom.
vi.mock('react-advanced-cropper', () => ({ Cropper: () => null }));
vi.mock('react-advanced-cropper/dist/style.css', () => ({}));

import { PreviewPopup } from '../../src/components/ImageEditor/PreviewPopup.jsx';

let urlSeq;
let created;
let revoked;

beforeEach(() => {
  urlSeq = 0;
  created = [];
  revoked = [];
  global.URL.createObjectURL = vi.fn(() => {
    const u = `blob:obj-${urlSeq++}`;
    created.push(u);
    return u;
  });
  global.URL.revokeObjectURL = vi.fn((u) => { revoked.push(u); });
});

// Harness тримає userRotation у стані; ↻ (onRotate) інкрементує його — рівно
// як батько (PreviewView/DpImageMergeEditor) реагує на поворот у попапі.
function Harness() {
  const [userRotation, setUserRotation] = useState(0);
  return (
    <PreviewPopup
      origIdx={0}
      url="blob:thumb-0"
      sourceBlob={new File([new Uint8Array(16)], 'a.jpg', { type: 'image/jpeg' })}
      autoRotation={0}
      userRotation={userRotation}
      position={0}
      total={1}
      warning={null}
      duplicateInfo={null}
      isUncertain={false}
      cropProposal={null}
      cropOverride={null}
      cropDisabled={false}
      cropApplied={false}
      processedEntry={null}
      onClose={() => {}}
      onPrev={() => {}}
      onNext={() => {}}
      onRotate={() => setUserRotation((r) => r + 90)}
      onCropOverride={() => {}}
      onToggleCropDisabled={() => {}}
      onRemove={() => {}}
      onProcessedBlobSave={() => {}}
    />
  );
}

describe('#11 PreviewPopup — поворот (↻ lock) не ревокує активний displayUrl', () => {
  it('після ↻ активний displayUrl лишається живим (не ревокнутий)', async () => {
    render(<Harness />);

    // Чекаємо поки ефект displayUrl згенерує об'єктний URL (cropProposal/
    // cropOverride немає → frameVisible=false → view-only <img>).
    const img = await screen.findByAltText('Перегляд сторінки');
    await waitFor(() => expect(img.getAttribute('src')).toMatch(/^blob:obj-/));
    const urlBefore = img.getAttribute('src');

    // ↻ — lock-гілка (cropperRef null у view-only): lock=true + onRotate().
    fireEvent.click(screen.getByText('Повернути'));

    // displayUrl у lock-гілці не змінюється...
    const imgAfter = screen.getByAltText('Перегляд сторінки');
    expect(imgAfter.getAttribute('src')).toBe(urlBefore);

    // ...і КРИТИЧНО: цей ще-показаний URL не має бути ревокований.
    // До фіксу cleanup попереднього запуску ревокує його → падає.
    expect(revoked).not.toContain(urlBefore);
  });
});
