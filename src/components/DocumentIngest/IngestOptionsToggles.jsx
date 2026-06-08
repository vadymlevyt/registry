// ── TASK 4 (rework) · Стадія B · СПІЛЬНІ ТУМБЛЕРИ ДОДАВАННЯ ──────────────────
// Канонічні тумблери опцій додавання файлів — ОДИН текст, ОДНА поведінка і в
// модалці «+ Додати документ», і в Document Processor (DP-тумблери). Повної
// уніфікації UI між модалкою (один файл, форма) і DP (список багатьох файлів)
// не буде — спільне те, що СПРАВДІ спільне: дві опції обробки.
//
//   • «Без розпізнавання тексту» (ocrMode none) — опція швидкого додавання:
//     розпізнавання не запускається, артефактів немає, лише базові метадані +
//     файл видно у переглядачі. OCR за дефолтом УВІМК — це опт-ін вимкнення.
//   • «Стиснути файли» — фронт-крок: зменшує скани/фото перед додаванням
//     (рушій розумний — текстові файли проходять як є). Default OFF.
//
// Віджет — спільний UI/Toggle; тут лише канонічний текст і збірка. Стан
// (checked) і обробник лишаються у консюмера (модалка / DP) — компонент
// stateless.

import { Toggle } from '../UI';

// Канонічний текст опцій — єдине джерело копірайту для обох споживачів.
export const INGEST_TOGGLE_COPY = Object.freeze({
  noOcr: Object.freeze({
    label: 'Без розпізнавання тексту',
    description: 'Швидко: файл просто зберігається і його видно у переглядачі. Розпізнати текст — пізніше.',
  }),
  compress: Object.freeze({
    label: 'Стиснути файли',
    description: 'Зменшує розмір сканів і фото перед додаванням. Текстові файли не змінюються.',
  }),
});

// OcrToggle — «Без розпізнавання тексту». checked=true → ocrMode 'none'.
export function OcrToggle({ checked, onChange, disabled = false }) {
  return (
    <Toggle
      label={INGEST_TOGGLE_COPY.noOcr.label}
      description={INGEST_TOGGLE_COPY.noOcr.description}
      checked={checked}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

// CompressToggle — «Стиснути файли». checked=true → фронт-крок стиснення.
export function CompressToggle({ checked, onChange, disabled = false }) {
  return (
    <Toggle
      label={INGEST_TOGGLE_COPY.compress.label}
      description={INGEST_TOGGLE_COPY.compress.description}
      checked={checked}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
