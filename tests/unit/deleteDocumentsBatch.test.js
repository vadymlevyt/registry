// Юніт-тести Drive-батча видалення (TASK bulk_delete_unify).
// Мокаємо лише driveAuth.driveRequest — deleteDriveFile/batch/matcher
// лишаються справжніми (driveService).
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Стан мок-Drive.
const driveState = {
  listFiles: [], // files повертані на LIST 02_ОБРОБЛЕНІ
  deleted: [],   // id, які пройшли DELETE
  failOnIds: new Set(), // ці id кидають на DELETE
};

vi.mock('../../src/services/driveAuth.js', () => ({
  driveRequest: vi.fn(async (url, opts = {}) => {
    // LIST: GET ...files?q=...
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?q=')) {
      return new Response(JSON.stringify({ files: driveState.listFiles }), { status: 200 });
    }
    // DELETE: /files/<id>
    const m = url.match(/\/drive\/v3\/files\/([^?]+)$/);
    if (m && opts.method === 'DELETE') {
      const id = m[1];
      if (driveState.failOnIds.has(id)) {
        return new Response('boom', { status: 500 });
      }
      driveState.deleted.push(id);
      // 204 — null-body статус: body мусить бути null (інакше undici кидає).
      return new Response(null, { status: 204 });
    }
    return new Response('', { status: 404 });
  }),
}));

const {
  matchArtifactFileIds,
  runWithConcurrency,
  deleteDocumentsArtifactsBatch,
} = await import('../../src/services/driveService.js');
const driveAuth = await import('../../src/services/driveAuth.js');

beforeEach(() => {
  driveState.listFiles = [];
  driveState.deleted = [];
  driveState.failOnIds = new Set();
  driveAuth.driveRequest.mockClear();
});

describe('matchArtifactFileIds — суфікс-матч `_<driveId>.`', () => {
  it('ловить .txt/.layout.json/.clean.md/.digest.md і вигаданий новий суфікс', () => {
    const driveId = 'DRV123';
    const files = [
      { id: 'f_txt', name: `Позов_${driveId}.txt` },
      { id: 'f_layout', name: `Позов_${driveId}.layout.json` },
      { id: 'f_clean', name: `Позов_${driveId}.clean.md` },
      { id: 'f_digest', name: `Позов_${driveId}.digest.md` },
      { id: 'f_future', name: `Позов_${driveId}.foo` }, // майбутній тип
      { id: 'f_other', name: 'Позов_OTHERID.txt' },      // інший документ
    ];
    const ids = matchArtifactFileIds(files, driveId);
    expect(ids.sort()).toEqual(['f_clean', 'f_digest', 'f_future', 'f_layout', 'f_txt']);
    expect(ids).not.toContain('f_other');
  });

  it('порожній driveId / не-масив → []', () => {
    expect(matchArtifactFileIds([], '')).toEqual([]);
    expect(matchArtifactFileIds(null, 'X')).toEqual([]);
  });
});

describe('runWithConcurrency', () => {
  it('виконує всі items і не перевищує ліміт одночасності', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    const results = await runWithConcurrency(items, 6, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 1));
      inFlight--;
      return n * 2;
    });
    expect(results).toHaveLength(20);
    expect(results[10]).toBe(20);
    expect(maxInFlight).toBeLessThanOrEqual(6);
  });
});

describe('deleteDocumentsArtifactsBatch', () => {
  const caseData = { storage: { subFolders: { '02_ОБРОБЛЕНІ': 'folder02' } } };

  it('ОДИН LIST + driveId + originalDriveId + усі `_<driveId>.*`, з дедупом', async () => {
    const docs = [
      { id: 'doc1', driveId: 'D1', originalDriveId: 'O1' },
      { id: 'doc2', driveId: 'D2' },
    ];
    driveState.listFiles = [
      { id: 'a_D1.txt', name: `Файл_D1.txt` },
      { id: 'a_D1.layout.json', name: `Файл_D1.layout.json` },
      { id: 'a_D1.clean.md', name: `Файл_D1.clean.md` },
      { id: 'a_D2.digest.md', name: `Інший_D2.digest.md` },
      { id: 'D1', name: 'дублікат-як-артефакт_D1.txt' }, // дедуп з прямим D1
      { id: 'noise', name: 'не-наш.txt' },
    ];
    const res = await deleteDocumentsArtifactsBatch(caseData, docs);

    // Рівно ОДИН LIST-запит (URL з ?q=).
    const listCalls = driveAuth.driveRequest.mock.calls.filter(c => c[0].includes('files?q='));
    expect(listCalls).toHaveLength(1);

    // Видалено: прямі D1, O1, D2 + артефакти a_D1.* (3) + a_D2.digest.md (1).
    // 'D1' як ім'я файлу теж матчиться суфіксом '_D1.' → але id 'D1' уже у set
    // (прямий) → дедуп. Перевіряємо набір унікальних.
    const expected = new Set(['D1', 'O1', 'D2', 'a_D1.txt', 'a_D1.layout.json', 'a_D1.clean.md', 'a_D2.digest.md']);
    expect(new Set(driveState.deleted)).toEqual(expected);
    expect(res.deletedCount).toBe(expected.size);
    expect(res.failedCount).toBe(0);
    // 'noise' не чіпали.
    expect(driveState.deleted).not.toContain('noise');
  });

  it('падіння одного DELETE не блокує інші (failedCount)', async () => {
    const docs = [{ id: 'doc1', driveId: 'D1' }];
    driveState.listFiles = [
      { id: 'a_D1.txt', name: 'X_D1.txt' },
      { id: 'a_D1.clean.md', name: 'X_D1.clean.md' },
    ];
    driveState.failOnIds = new Set(['a_D1.txt']);
    const res = await deleteDocumentsArtifactsBatch(caseData, docs);
    expect(res.failedCount).toBe(1);
    // Решта видалена попри один збій.
    expect(driveState.deleted).toContain('D1');
    expect(driveState.deleted).toContain('a_D1.clean.md');
  });

  it('без папки 02_ОБРОБЛЕНІ — видаляє лише прямі id (без LIST)', async () => {
    const docs = [{ id: 'doc1', driveId: 'D1', originalDriveId: 'O1' }];
    const res = await deleteDocumentsArtifactsBatch({ storage: { subFolders: {} } }, docs);
    const listCalls = driveAuth.driveRequest.mock.calls.filter(c => c[0].includes('files?q='));
    expect(listCalls).toHaveLength(0);
    expect(new Set(driveState.deleted)).toEqual(new Set(['D1', 'O1']));
    expect(res.deletedCount).toBe(2);
  });
});
