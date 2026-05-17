// DP-3 — standaloneCompressor: поза pipeline/Worker, провайдер-цілі.
import { describe, it, expect, vi } from 'vitest';
import { createStandaloneCompressor } from '../../src/services/standaloneCompressor.js';
import { createMemDrivePort } from '../_memDrivePort.js';
import { makePdfBytes, toArrayBuffer } from '../_pdfFixture.js';

function fileFrom(bytes, name = 'a.pdf') {
  const ab = toArrayBuffer(bytes);
  return { name, arrayBuffer: async () => ab };
}

describe('standaloneCompressor', () => {
  it('compressOne стискає (не кидає) і звітує before/after', async () => {
    const c = createStandaloneCompressor({});
    const r = await c.compressOne(fileFrom(await makePdfBytes(5)));
    expect(r.before).toBeGreaterThan(0);
    expect(r.after).toBeGreaterThan(0);
    expect(r.bytes).toBeInstanceOf(Uint8Array);
  });

  it('target drive → у вказану папку через drivePort', async () => {
    const port = createMemDrivePort();
    const c = createStandaloneCompressor({ drivePort: port });
    const folder = await port.getOrCreateFolder('05_ЗОВНІШНІ', null);
    const out = await c.compress([fileFrom(await makePdfBytes(3))], { target: 'drive', options: { folderId: folder.id } });
    expect(out.reports[0].saved).toBe(true);
    expect(out.reports[0].driveId).toBeTruthy();
  });

  it('target download → ін\'єктований saveLocal', async () => {
    const saveLocal = vi.fn(async () => {});
    const c = createStandaloneCompressor({ saveLocal });
    const out = await c.compress([fileFrom(await makePdfBytes(2))], { target: 'download' });
    expect(saveLocal).toHaveBeenCalledTimes(1);
    expect(out.reports[0].saved).toBe(true);
  });

  it('email/messenger — ЗАГЛУШКИ (not_implemented, не кидає)', async () => {
    const c = createStandaloneCompressor({});
    const e = await c.compress([fileFrom(await makePdfBytes(2))], { target: 'email' });
    expect(e.reports[0]).toMatchObject({ saved: false, reason: 'not_implemented', stub: true });
    const m = await c.compress([fileFrom(await makePdfBytes(2))], { target: 'messenger' });
    expect(m.reports[0].stub).toBe(true);
  });
});
