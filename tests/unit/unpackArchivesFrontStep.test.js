// Юніт-тести фронт-кроку розпакування архівів (ZIP-інгест ЄСІТС). Перевіряють:
// ZIP → розгортається у складові файли, підписи КЕП відкинуто; кілька ZIP →
// усі розгорнуто і злито; мікс ZIP + окремий PDF → розгорнуте + окремий разом;
// RAR/7z → НЕ розпаковано, лишено як є + warning у report; не-архів →
// passthrough; гачок `onArchiveEntry` кликається по кожному entry-документу
// (НЕ по підписам). Стаб `unzipArchive` (як у unpack.test.js) — без мережі/файлів.
import { describe, it, expect, vi } from 'vitest';
import {
  unpackArchivesFrontStep,
  isArchive,
  archiveKind,
  isSignatureFile,
} from '../../src/services/addFiles/unpackArchivesFrontStep.js';

const U8 = (n = 3) => new Uint8Array(Array.from({ length: n }, (_, i) => i + 1));

// Легкий file-шим — детермінований readBytes без залежності від jsdom Blob.
function file({ name, type = null, bytes = U8() }) {
  return { name, size: bytes.length, type, _bytes: bytes, arrayBuffer: async () => bytes };
}
// Шим конструктора File (Node без global File не може робити `new File(...)`).
const makeFile = ({ name, data, type }) => ({
  name, size: data.length, type, _bytes: data, arrayBuffer: async () => data,
});

describe('unpackArchivesFrontStep — re-export предикатів (single source)', () => {
  it('isArchive / archiveKind / isSignatureFile проксіюються з unpack.js', () => {
    expect(isArchive('a.zip', null)).toBe(true);
    expect(isArchive('doc.pdf', 'application/pdf')).toBe(false);
    expect(archiveKind('a.rar')).toBe('rar');
    expect(isSignatureFile('doc.pdf.p7s')).toBe(true);
  });
});

describe('unpackArchivesFrontStep — не-архів passthrough', () => {
  it('PDF без архівів → проходить незмінним, unzip НЕ викликався', async () => {
    const unzipArchive = vi.fn();
    const pdf = file({ name: 'pozov.pdf', type: 'application/pdf' });
    const r = await unpackArchivesFrontStep([pdf], { unzipArchive });
    expect(r.files).toHaveLength(1);
    expect(r.files[0]).toBe(pdf);
    expect(unzipArchive).not.toHaveBeenCalled();
    expect(r.report).toEqual({ unpacked: [], signaturesDropped: 0, archivesKept: [] });
  });
});

describe('unpackArchivesFrontStep — ZIP розпаковка + .p7s відкинуто', () => {
  it('ZIP з {2 PDF, 1 HTML, 1 image, 1 .p7s} → 4 файли, підпис відкинуто, report коректний', async () => {
    const unzipArchive = vi.fn(async () => ([
      { name: 'pozov.pdf', data: U8(5) },
      { name: 'uhvala.pdf', data: U8(4) },
      { name: 'protokol.html', data: U8(3) },
      { name: 'foto.jpg', data: U8(7) },
      { name: 'pozov.pdf.p7s', data: U8(2) },
      { name: 'sub/', data: new Uint8Array() },                  // директорія — пропустити
    ]));
    const zip = file({ name: 'esits.zip', type: 'application/zip' });
    const r = await unpackArchivesFrontStep([zip], { unzipArchive, makeFile });

    expect(unzipArchive).toHaveBeenCalledTimes(1);
    expect(r.files.map(f => f.name)).toEqual(['pozov.pdf', 'uhvala.pdf', 'protokol.html', 'foto.jpg']);
    expect(r.report.unpacked).toEqual([{ archive: 'esits.zip', entryCount: 4 }]);
    expect(r.report.signaturesDropped).toBe(1);
    expect(r.report.archivesKept).toEqual([]);
  });

  it('також .sig відкидається (другий формат підпису)', async () => {
    const unzipArchive = vi.fn(async () => ([
      { name: 'doc.pdf', data: U8(3) },
      { name: 'doc.sig', data: U8(2) },
    ]));
    const zip = file({ name: 'a.zip', type: 'application/zip' });
    const r = await unpackArchivesFrontStep([zip], { unzipArchive, makeFile });
    expect(r.files.map(f => f.name)).toEqual(['doc.pdf']);
    expect(r.report.signaturesDropped).toBe(1);
  });

  it('кілька ZIP → усі розгорнуто і злито в один плоский список', async () => {
    const unzipArchive = vi.fn(async (bytes) => {
      // Розрізнимо архіви за першим байтом стаба.
      if (bytes[0] === 10) return [{ name: 'a1.pdf', data: U8() }, { name: 'a2.pdf', data: U8() }];
      return [{ name: 'b1.pdf', data: U8() }];
    });
    const r = await unpackArchivesFrontStep(
      [
        file({ name: 'first.zip', type: 'application/zip', bytes: new Uint8Array([10]) }),
        file({ name: 'second.zip', type: 'application/zip', bytes: new Uint8Array([20]) }),
      ],
      { unzipArchive, makeFile },
    );
    expect(r.files.map(f => f.name)).toEqual(['a1.pdf', 'a2.pdf', 'b1.pdf']);
    expect(r.report.unpacked).toEqual([
      { archive: 'first.zip', entryCount: 2 },
      { archive: 'second.zip', entryCount: 1 },
    ]);
    expect(unzipArchive).toHaveBeenCalledTimes(2);
  });

  it('мікс ZIP + окремий PDF → розгорнуте + окремий разом, в одному порядку', async () => {
    const unzipArchive = vi.fn(async () => ([
      { name: 'inside1.pdf', data: U8() },
      { name: 'inside2.pdf', data: U8() },
    ]));
    const standalone = file({ name: 'standalone.pdf', type: 'application/pdf' });
    const r = await unpackArchivesFrontStep(
      [
        file({ name: 'arc.zip', type: 'application/zip' }),
        standalone,
      ],
      { unzipArchive, makeFile },
    );
    expect(r.files.map(f => f.name)).toEqual(['inside1.pdf', 'inside2.pdf', 'standalone.pdf']);
    expect(r.files[2]).toBe(standalone);
  });
});

describe('unpackArchivesFrontStep — RAR/7z НЕ розпаковуються', () => {
  it('RAR → лишається у наборі як один файл + archivesKept у report', async () => {
    const unzipArchive = vi.fn();
    const rar = file({ name: 'arc.rar', type: 'application/vnd.rar' });
    const r = await unpackArchivesFrontStep([rar], { unzipArchive });
    expect(unzipArchive).not.toHaveBeenCalled();
    expect(r.files).toHaveLength(1);
    expect(r.files[0]).toBe(rar);
    expect(r.report.archivesKept).toEqual([{ name: 'arc.rar', kind: 'rar' }]);
    expect(r.report.unpacked).toEqual([]);
    expect(r.report.signaturesDropped).toBe(0);
  });

  it('7z → теж лишається як є', async () => {
    const unzipArchive = vi.fn();
    const sevenZ = file({ name: 'arc.7z', type: 'application/x-7z-compressed' });
    const r = await unpackArchivesFrontStep([sevenZ], { unzipArchive });
    expect(unzipArchive).not.toHaveBeenCalled();
    expect(r.files[0]).toBe(sevenZ);
    expect(r.report.archivesKept).toEqual([{ name: 'arc.7z', kind: '7z' }]);
  });
});

describe('unpackArchivesFrontStep — best-effort при збоях розпакування', () => {
  it('corrupt ZIP (unzip кинув) → архів лишається як є + reason у report', async () => {
    const unzipArchive = vi.fn(async () => { throw new Error('corrupt central directory'); });
    const zip = file({ name: 'bad.zip', type: 'application/zip' });
    const r = await unpackArchivesFrontStep([zip], { unzipArchive });
    expect(r.files).toHaveLength(1);
    expect(r.files[0]).toBe(zip);
    expect(r.report.archivesKept).toHaveLength(1);
    expect(r.report.archivesKept[0]).toMatchObject({ name: 'bad.zip', kind: 'zip' });
    expect(r.report.archivesKept[0].reason).toMatch(/unpack_failed/);
    expect(r.report.unpacked).toEqual([]);
  });

  it('файл без arrayBuffer → лишається як є + read_failed', async () => {
    const unzipArchive = vi.fn();
    const bad = { name: 'noread.zip', type: 'application/zip' };          // без arrayBuffer/_bytes
    const r = await unpackArchivesFrontStep([bad], { unzipArchive });
    expect(unzipArchive).not.toHaveBeenCalled();
    expect(r.files[0]).toBe(bad);
    expect(r.report.archivesKept[0]).toMatchObject({ name: 'noread.zip', kind: 'zip', reason: 'read_failed' });
  });
});

describe('unpackArchivesFrontStep — гачок onArchiveEntry (HTML-метадані, no-op у MVP)', () => {
  it('кликається ОДИН РАЗ на кожен entry-документ, НЕ на підпис, НЕ на директорію', async () => {
    const unzipArchive = vi.fn(async () => ([
      { name: 'pozov.pdf', data: U8(5) },
      { name: 'protokol.html', data: U8(3) },
      { name: 'pozov.pdf.p7s', data: U8(2) },                 // НЕ має тригернути гачок
      { name: 'sub/', data: new Uint8Array() },                // директорія — теж НЕ
    ]));
    const onArchiveEntry = vi.fn();
    const zip = file({ name: 'a.zip', type: 'application/zip' });
    await unpackArchivesFrontStep([zip], { unzipArchive, makeFile, onArchiveEntry });
    expect(onArchiveEntry).toHaveBeenCalledTimes(2);
    expect(onArchiveEntry.mock.calls[0][0]).toMatchObject({
      name: 'pozov.pdf', mime: 'application/pdf', archive: 'a.zip',
    });
    expect(onArchiveEntry.mock.calls[1][0]).toMatchObject({
      name: 'protokol.html', mime: 'text/html', archive: 'a.zip',
    });
  });

  it('збій гачка не валить основний потік (best-effort)', async () => {
    const unzipArchive = vi.fn(async () => ([{ name: 'doc.pdf', data: U8() }]));
    const onArchiveEntry = vi.fn(() => { throw new Error('extractor blew up'); });
    const r = await unpackArchivesFrontStep(
      [file({ name: 'a.zip', type: 'application/zip' })],
      { unzipArchive, makeFile, onArchiveEntry },
    );
    expect(r.files.map(f => f.name)).toEqual(['doc.pdf']);
    expect(r.report.unpacked[0].entryCount).toBe(1);
  });
});

describe('unpackArchivesFrontStep — порожній/null вхід', () => {
  it('порожній масив → порожній файли і report', async () => {
    const r = await unpackArchivesFrontStep([], { unzipArchive: vi.fn() });
    expect(r.files).toEqual([]);
    expect(r.report).toEqual({ unpacked: [], signaturesDropped: 0, archivesKept: [] });
  });

  it('null-елементи відфільтровані (не падаємо)', async () => {
    const pdf = file({ name: 'a.pdf', type: 'application/pdf' });
    const r = await unpackArchivesFrontStep([null, pdf, undefined], { unzipArchive: vi.fn() });
    expect(r.files).toEqual([pdf]);
  });
});
