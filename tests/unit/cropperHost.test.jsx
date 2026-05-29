// @vitest-environment jsdom
//
// Regression: CropperHost у view-only гілці (frameVisible=false) колись
// падав з `userRotation is not defined` бо обидві змінні (userRotation,
// bakedUserRotationRef) були dangling references на scope батьківського
// PreviewPopup. Проявлялось при re-open попапа після ✓ Готово (cropApplied=true
// → frameVisible=false → виконується view-only гілка з CSS-rotation delta).
//
// Тепер обидві передаються як props. Тест перевіряє що рендер не падає і
// CSS-transform коректно обчислюється для типових кутів адвоката (0/90/180/270).

import { describe, it, expect, vi } from 'vitest';
import { useRef } from 'react';
import { render } from '@testing-library/react';

// Mock react-advanced-cropper щоб тест не намагався завантажити реальну
// бібліотеку у jsdom. У view-only гілці (frameVisible=false) Cropper
// не рендериться, тому mock тривіальний.
vi.mock('react-advanced-cropper', () => ({
  Cropper: () => null,
}));
vi.mock('react-advanced-cropper/dist/style.css', () => ({}));

import { CropperHost } from '../../src/components/ImageEditor/CropperHost.jsx';

// Wrapper щоб надати bakedUserRotationRef як ref (CropperHost очікує ref-об'єкт
// з .current, не голе число).
function HostWithBakedRef({ userRotation, bakedRotation, frameVisible = false }) {
  const cropperRef = useRef(null);
  const bakedRef = useRef(bakedRotation);
  return (
    <CropperHost
      cropperRef={cropperRef}
      displayUrl="data:image/png;base64,iVBOR"
      initialCoords={null}
      frameVisible={frameVisible}
      userRotation={userRotation}
      bakedUserRotationRef={bakedRef}
      onChange={() => {}}
    />
  );
}

describe('CropperHost — view-only гілка (regression userRotation crash)', () => {
  it('не падає коли frameVisible=false і userRotation=0', () => {
    expect(() => render(<HostWithBakedRef userRotation={0} bakedRotation={0} />)).not.toThrow();
  });

  it('не падає коли frameVisible=false і userRotation=90', () => {
    expect(() => render(<HostWithBakedRef userRotation={90} bakedRotation={0} />)).not.toThrow();
  });

  it('не падає для всіх 4 cardinal userRotation проти різних baked', () => {
    for (const u of [0, 90, 180, 270]) {
      for (const b of [0, 90, 180, 270]) {
        expect(() => render(<HostWithBakedRef userRotation={u} bakedRotation={b} />)).not.toThrow();
      }
    }
  });

  it('CSS transform містить rotate(N deg) у view-only', () => {
    const { container } = render(<HostWithBakedRef userRotation={90} bakedRotation={0} />);
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('style')).toMatch(/rotate\(.*deg\)/);
  });

  it('rotation delta = (userRotation - baked) у нормалізованому [-180,180]', () => {
    // 270 - 0 = 270; нормалізація → 270 > 180 → -90
    const { container } = render(<HostWithBakedRef userRotation={270} bakedRotation={0} />);
    const img = container.querySelector('img');
    expect(img.getAttribute('style')).toContain('rotate(-90deg)');
  });

  it('user=0, baked=90 → delta=270>180 → -90', () => {
    const { container } = render(<HostWithBakedRef userRotation={0} bakedRotation={90} />);
    const img = container.querySelector('img');
    expect(img.getAttribute('style')).toContain('rotate(-90deg)');
  });

  it('user==baked → нуль обертання', () => {
    const { container } = render(<HostWithBakedRef userRotation={180} bakedRotation={180} />);
    const img = container.querySelector('img');
    expect(img.getAttribute('style')).toContain('rotate(0deg)');
  });
});
