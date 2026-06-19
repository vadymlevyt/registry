// DP-2 — стадія unpack (override intake). Перевіряє: валідація intake
// збережена, ZIP розпаковка, RAR/7z детект-без-розпаковки, фільтр .p7s/.sig,
// читання metadataSidecar, passthrough не-архіву (no-regression DP-1).
import { describe, it, expect, vi } from 'vitest';
import {
  createIntakeWithUnpack,
  isArchive,
  archiveKind,
  isSignatureFile,
  isSidecarFile,
  parseSidecarBytes,
} from '../../src/services/documentPipeline/stages/unpack.js';

const enc = (obj) => new TextEncoder().encode(JSON.stringify(obj));
const U8 = (n = 3) => new Uint8Array(Array.from({ length: n }, (_, i) => i + 1));

// Легкий file-шим — детермінований readBytes без залежності від jsdom Blob.
const makeFile = ({ name, data, type }) => ({ name, size: data.length, type, _bytes: data, arrayBuffer: async () => data });

function ctx(files, over = {}) {
  return {
    job: { caseId: 'case_1', jobId: 'j1' },
    files: files.map((f, i) => ({
      fileId: `f${i}`, raw: f.raw ?? null, name: f.name ?? null,
      type: f.type ?? null, size: f.size ?? 0, skipped: !!f.skipped,
      warnings: [], metadataTemplate: {},
    })),
    documents: [], decisions: [], errors: [], events: [],
    ...over,
  };
}

describe('unpack — чисті предикати (один сенс кожен)', () => {
  it('isArchive за розширенням і MIME', () => {
    expect(isArchive('a.zip', null)).toBe(true);
    expect(isArchive('a.RAR', null)).toBe(true);
    expect(isArchive('x', 'application/x-7z-compressed')).toBe(true);
    expect(isArchive('doc.pdf', 'application/pdf')).toBe(false);
  });
  it('archiveKind розрізняє zip/rar/7z', () => {
    expect(archiveKind('a.zip')).toBe('zip');
    expect(archiveKind('a.rar')).toBe('rar');
    expect(archiveKind('a.7z')).toBe('7z');
    expect(archiveKind('a.pdf')).toBeNull();
  });
  it('isSignatureFile / isSidecarFile', () => {
    expect(isSignatureFile('doc.pdf.p7s')).toBe(true);
    expect(isSignatureFile('x.sig')).toBe(true);
    expect(isSignatureFile('x.pdf')).toBe(false);
    // Хвіст-лічильник ЄСІТС (.N) для багатопідписних документів — теж підпис.
    expect(isSignatureFile('X.html.p7s.2')).toBe(true);
    expect(isSignatureFile('X.sig.1')).toBe(true);
    expect(isSignatureFile('X.p7s')).toBe(true);
    // Справжній документ із p7s НЕ в кінці імені — не підпис.
    expect(isSignatureFile('звіт.p7s.pdf')).toBe(false);
    expect(isSignatureFile('doc.pdf')).toBe(false);
    expect(isSidecarFile('metadataSidecar.json')).toBe(true);
    expect(isSidecarFile('sub/metadataSidecar.JSON')).toBe(true);
    expect(isSidecarFile('other.json')).toBe(false);
  });
  it('parseSidecarBytes валідує JSON-обʼєкт', () => {
    expect(parseSidecarBytes(enc({ source: 'court_sync' })).valid).toBe(true);
    expect(parseSidecarBytes(enc([1, 2])).valid).toBe(false);
    expect(parseSidecarBytes(enc({ source: 5 })).valid).toBe(false);
    expect(parseSidecarBytes(new Uint8Array([123, 0])).valid).toBe(false);
  });
});

describe('unpack — валідація intake збережена (no-regression)', () => {
  it('NO_CASE коли немає caseId', async () => {
    const stage = createIntakeWithUnpack();
    const r = await stage({ job: {}, files: [{ name: 'a.pdf' }] });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('NO_CASE');
    expect(r.error.fatal).toBe(true);
  });
  it('NO_FILES коли порожній files', async () => {
    const stage = createIntakeWithUnpack();
    const r = await stage({ job: { caseId: 'c' }, files: [] });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('NO_FILES');
  });
});

describe('unpack — passthrough не-архіву (поведінка DP-1)', () => {
  it('PDF проходить незмінним, unzip НЕ викликається', async () => {
    const unzipArchive = vi.fn();
    const stage = createIntakeWithUnpack({ unzipArchive });
    const c = ctx([{ name: 'doc.pdf', type: 'application/pdf', raw: { _bytes: U8() } }]);
    const r = await stage(c);
    expect(r.ok).toBe(true);
    expect(r.ctx.files).toHaveLength(1);
    expect(r.ctx.files[0].name).toBe('doc.pdf');
    expect(unzipArchive).not.toHaveBeenCalled();
    expect(r.decisions).toBeUndefined();
  });
});

describe('unpack — ZIP розпаковка + sidecar + підписи', () => {
  it('ZIP → файли підставлені, sidecar у ctx, підпис у signatures[]', async () => {
    const unzipArchive = vi.fn(async () => ([
      { name: 'pozov.pdf', data: U8(5) },
      { name: 'pozov.pdf.p7s', data: U8(2) },
      { name: 'uhvala.pdf', data: U8(4) },
      { name: 'metadataSidecar.json', data: enc({ source: 'court_sync', ecitsContext: { caseType: 'civil' } }) },
      { name: 'sub/', data: new Uint8Array() },
    ]));
    const stage = createIntakeWithUnpack({ unzipArchive, makeFile });
    const c = ctx([{ name: 'arc.zip', type: 'application/zip', raw: { _bytes: U8() } }]);
    const r = await stage(c);

    expect(r.ok).toBe(true);
    expect(unzipArchive).toHaveBeenCalledTimes(1);
    // 2 справжні документи (pdf×2), sidecar+підпис відфільтровані.
    expect(r.ctx.files.map(f => f.name).sort()).toEqual(['pozov.pdf', 'uhvala.pdf']);
    expect(r.ctx.metadataSidecar).toMatchObject({ source: 'court_sync' });
    expect(r.ctx.signatures).toHaveLength(1);
    expect(r.ctx.signatures[0].name).toBe('pozov.pdf.p7s');
    // Підпис привʼязаний до основного файлу.
    const pozov = r.ctx.files.find(f => f.name === 'pozov.pdf');
    expect(r.ctx.signatures[0].linkedToFileId).toBe(pozov.fileId);
    const types = r.decisions.map(d => d.type);
    expect(types).toContain('archive_unpacked');
    expect(types).toContain('metadata_sidecar_loaded');
    expect(types).toContain('kep_signatures_detected');
  });

  it('порожній архів → NO_FILES fatal', async () => {
    const unzipArchive = vi.fn(async () => ([{ name: 'sig.p7s', data: U8() }]));
    const stage = createIntakeWithUnpack({ unzipArchive, makeFile });
    const r = await stage(ctx([{ name: 'a.zip', type: 'application/zip', raw: { _bytes: U8() } }]));
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('NO_FILES');
    expect(r.error.fatal).toBe(true);
  });

  it('невалідний sidecar → decision metadata_sidecar_invalid, ctx.metadataSidecar лишається null', async () => {
    const unzipArchive = vi.fn(async () => ([
      { name: 'doc.pdf', data: U8() },
      { name: 'metadataSidecar.json', data: new Uint8Array([1, 2, 3]) },
    ]));
    const stage = createIntakeWithUnpack({ unzipArchive, makeFile });
    const r = await stage(ctx([{ name: 'a.zip', type: 'application/zip', raw: { _bytes: U8() } }]));
    expect(r.ok).toBe(true);
    expect(r.ctx.metadataSidecar).toBeNull();
    expect(r.decisions.map(d => d.type)).toContain('metadata_sidecar_invalid');
  });

  it('UNPACK_FAILED → file_skipped коли розпаковка кинула', async () => {
    const unzipArchive = vi.fn(async () => { throw new Error('corrupt'); });
    const stage = createIntakeWithUnpack({ unzipArchive, makeFile });
    const r = await stage(ctx([{ name: 'a.zip', type: 'application/zip', raw: { _bytes: U8() } }]));
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('UNPACK_FAILED');
    expect(r.error.file_skipped).toBe(true);
  });
});

describe('unpack — RAR/7z свідомо не розпаковуються', () => {
  it('RAR → збережено як оригінал + warning + decision', async () => {
    const unzipArchive = vi.fn();
    const stage = createIntakeWithUnpack({ unzipArchive });
    const r = await stage(ctx([{ name: 'arc.rar', type: 'application/vnd.rar', raw: { _bytes: U8() } }]));
    expect(r.ok).toBe(true);
    expect(unzipArchive).not.toHaveBeenCalled();
    expect(r.ctx.files).toHaveLength(1);
    expect(r.ctx.files[0].warnings[0]).toMatch(/RAR/);
    expect(r.decisions[0]).toMatchObject({ type: 'archive_not_unpacked', kind: 'rar' });
  });
});
