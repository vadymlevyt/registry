// Юніт-тести driveService — фокус на findOrCreateFolder NFC+trim нормалізацію.
//
// Контекст: на справі Нестеренка (2026-05-23) спостерігалось дві папки з
// однаковим іменем на Drive. Причини візуально ідентичних рядків які
// `f.name === name` бачить як різні:
//   1. Trailing/leading whitespace ('Нестеренко ' vs 'Нестеренко')
//   2. NFC vs NFD форми Unicode (релевантно для латиниці з diacritics).
//      Для precomposed кирилиці зазвичай не релевантно — але normalize
//      безпечно і дешево, тому застосовуємо превентивно.
//
// Race condition (два паралельні виклики findOrCreateFolder) — окрема
// проблема, не покривається цим фіксом.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockDriveRequest = vi.fn();
vi.mock('../../src/services/driveAuth.js', () => ({
  driveRequest: (...args) => mockDriveRequest(...args),
}));

const { findOrCreateFolder } = await import('../../src/services/driveService.js');

function jsonResponse(data) {
  return { json: async () => data };
}

describe('findOrCreateFolder — захист від дублів папок', () => {
  beforeEach(() => {
    mockDriveRequest.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('знаходить існуючу папку коли імена точно збігаються', async () => {
    const existing = { id: 'folder_id_1', name: 'Нестеренко' };
    mockDriveRequest.mockResolvedValueOnce(jsonResponse({ files: [existing] }));

    const res = await findOrCreateFolder('Нестеренко', 'parent_id', null);

    expect(res).toEqual(existing);
    expect(mockDriveRequest).toHaveBeenCalledTimes(1); // тільки search, без POST
  });

  it('знаходить папку коли Drive має trailing whitespace', async () => {
    // Реальний сценарій — користувач вручну перейменував папку на Drive і
    // випадково лишив зайвий пробіл. Без trim() створюється дублікат.
    const existing = { id: 'folder_id_2', name: 'Нестеренко ' };
    mockDriveRequest.mockResolvedValueOnce(jsonResponse({ files: [existing] }));

    const res = await findOrCreateFolder('Нестеренко', 'parent_id', null);

    expect(res).toEqual(existing);
    expect(mockDriveRequest).toHaveBeenCalledTimes(1);
  });

  it('знаходить папку коли search-name має leading whitespace', async () => {
    // Симетричний кейс — пробіл прийшов з UI/case.name.
    const existing = { id: 'folder_id_3', name: 'Брановський' };
    mockDriveRequest.mockResolvedValueOnce(jsonResponse({ files: [existing] }));

    const res = await findOrCreateFolder(' Брановський', 'parent_id', null);

    expect(res).toEqual(existing);
    expect(mockDriveRequest).toHaveBeenCalledTimes(1);
  });

  it('знаходить NFD-латиницю з diacritics коли search передано NFC', async () => {
    // Латиниця з diacritics реально має NFC ≠ NFD (на відміну від
    // precomposed кирилиці). Наприклад 'é' = U+00E9 (NFC) або
    // 'e' + U+0301 (NFD). Без normalize порівняння провалюється.
    const nfcName = 'café'.normalize('NFC');
    const nfdName = 'café'.normalize('NFD');
    expect(nfdName).not.toBe(nfcName); // sanity — форми справді різні

    const existing = { id: 'folder_id_4', name: nfdName };
    mockDriveRequest.mockResolvedValueOnce(jsonResponse({ files: [existing] }));

    const res = await findOrCreateFolder(nfcName, 'parent_id', null);

    expect(res).toEqual(existing);
    expect(mockDriveRequest).toHaveBeenCalledTimes(1);
  });

  it('створює нову папку коли ім\'я справді відсутнє', async () => {
    mockDriveRequest
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'other', name: 'Інша справа' }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'new_id', name: 'Нова справа' }));

    const res = await findOrCreateFolder('Нова справа', 'parent_id', null);

    expect(res.id).toBe('new_id');
    expect(mockDriveRequest).toHaveBeenCalledTimes(2);
    // Другий виклик — POST на створення
    const createCallArgs = mockDriveRequest.mock.calls[1];
    expect(createCallArgs[1]?.method).toBe('POST');
  });

  it('знаходить ASCII-назву без впливу normalize (регресія)', async () => {
    // 01_АКТИВНІ_СПРАВИ, 01_ОРИГІНАЛИ — імена з нашою конвенцією.
    // Поведінка має бути така ж як до фіксу.
    const existing = { id: 'eng_id', name: '01_АКТИВНІ_СПРАВИ' };
    mockDriveRequest.mockResolvedValueOnce(jsonResponse({ files: [existing] }));

    const res = await findOrCreateFolder('01_АКТИВНІ_СПРАВИ', null, null);

    expect(res).toEqual(existing);
    expect(mockDriveRequest).toHaveBeenCalledTimes(1);
  });
});
