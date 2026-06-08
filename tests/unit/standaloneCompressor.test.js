// DP-3 — standaloneCompressor: поза pipeline/Worker, провайдер-цілі.
// TASK 4 E: рушій РЕАЛЬНИЙ downscale (render→JPEG→pdf-lib) — браузерний (canvas),
// у Node не виконується, тож ін'єктуємо детермінований стаб compressEngine.
// Реальний обсяг стиснення перевіряє адвокат на пристрої (не юніт-тест).
import { describe, it, expect, vi } from 'vitest';
import { createStandaloneCompressor } from '../../src/services/standaloneCompressor.js';
import { createMemDrivePort } from '../_memDrivePort.js';
import { makePdfBytes, toArrayBuffer } from '../_pdfFixture.js';

function fileFrom(bytes, name = 'a.pdf') {
  const ab = toArrayBuffer(bytes);
  return { name, arrayBuffer: async () => ab };
}

// Стаб рушія: «стискає» (повертає половину байтів), як scanned PDF.
function stubEngine(halve = true) {
  return vi.fn(async (ab) => {
    const inBytes = ab.byteLength ?? ab.length ?? 0;
    const bytes = new Uint8Array(Math.max(1, halve ? Math.floor(inBytes / 2) : inBytes));
    return { bytes, compressed: true, skipped: false, inBytes, outBytes: bytes.byteLength };
  });
}

describe('standaloneCompressor', () => {
  it('compressOne стискає (не кидає) і звітує before/after через ін\'єктований рушій', async () => {
    const compressEngine = stubEngine();
    const c = createStandaloneCompressor({ compressEngine });
    const r = await c.compressOne(fileFrom(await makePdfBytes(5)));
    expect(r.before).toBeGreaterThan(0);
    expect(r.after).toBeGreaterThan(0);
    expect(r.after).toBeLessThan(r.before);          // стаб ділить навпіл
    expect(r.compressed).toBe(true);
    expect(r.bytes).toBeInstanceOf(Uint8Array);
    expect(compressEngine).toHaveBeenCalledTimes(1);
  });

  it('searchable → pass-through (skipped, не кидає)', async () => {
    const compressEngine = vi.fn(async (ab) => {
      const inBytes = ab.byteLength ?? 0;
      return { bytes: new Uint8Array(inBytes), compressed: false, skipped: true, reason: 'searchable', inBytes, outBytes: inBytes };
    });
    const c = createStandaloneCompressor({ compressEngine, saveLocal: async () => {} });
    const out = await c.compress([fileFrom(await makePdfBytes(2))], { target: 'download' });
    expect(out.reports[0].skipped).toBe(true);
    expect(out.reports[0].reason).toBe('searchable');
  });

  it('target drive → у вказану папку через drivePort', async () => {
    const port = createMemDrivePort();
    const c = createStandaloneCompressor({ compressEngine: stubEngine(), drivePort: port });
    const folder = await port.getOrCreateFolder('05_ЗОВНІШНІ', null);
    const out = await c.compress([fileFrom(await makePdfBytes(3))], { target: 'drive', options: { folderId: folder.id } });
    expect(out.reports[0].saved).toBe(true);
    expect(out.reports[0].driveId).toBeTruthy();
  });

  it('target download → ін\'єктований saveLocal', async () => {
    const saveLocal = vi.fn(async () => {});
    const c = createStandaloneCompressor({ compressEngine: stubEngine(), saveLocal });
    const out = await c.compress([fileFrom(await makePdfBytes(2))], { target: 'download' });
    expect(saveLocal).toHaveBeenCalledTimes(1);
    expect(out.reports[0].saved).toBe(true);
  });

  it('email/messenger — ЗАГЛУШКИ (not_implemented, не кидає)', async () => {
    const c = createStandaloneCompressor({ compressEngine: stubEngine() });
    const e = await c.compress([fileFrom(await makePdfBytes(2))], { target: 'email' });
    expect(e.reports[0]).toMatchObject({ saved: false, reason: 'not_implemented', stub: true });
    const m = await c.compress([fileFrom(await makePdfBytes(2))], { target: 'messenger' });
    expect(m.reports[0].stub).toBe(true);
  });
});
