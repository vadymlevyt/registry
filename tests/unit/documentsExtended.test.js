// Юніт-тести для lazy-load extended-полів документа.
// driveAuth/driveService мокаємо через vi.mock — Vitest перехоплює імпорти.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Стан мок-Drive: ім'я → file. Імітуємо .metadata папку і documents_extended.json.
const driveState = {
  files: new Map(), // id → { id, name, parents, content }
  nextId: 1,
};

function makeFile(name, parents, content = '') {
  const id = `drv_${driveState.nextId++}`;
  const file = { id, name, parents, content };
  driveState.files.set(id, file);
  return file;
}

vi.mock('../../src/services/driveAuth.js', () => ({
  driveRequest: vi.fn(async (url, opts = {}) => {
    // GET /files?q=... — пошук
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?q=')) {
      const q = decodeURIComponent(url.split('q=')[1].split('&')[0]);
      const matches = [];
      for (const f of driveState.files.values()) {
        // Грубий парсер q: "name='X' and 'PARENT' in parents and trashed=false"
        const nameMatch = q.match(/name='([^']+)'/);
        const parentMatch = q.match(/'([^']+)' in parents/);
        if (nameMatch && f.name !== nameMatch[1]) continue;
        if (parentMatch && (!f.parents || !f.parents.includes(parentMatch[1]))) continue;
        matches.push({ id: f.id, name: f.name });
      }
      return new Response(JSON.stringify({ files: matches }), { status: 200 });
    }
    // GET /files/<id>?alt=media — читання
    const readMatch = url.match(/\/files\/([^?]+)\?alt=media/);
    if (readMatch) {
      const f = driveState.files.get(readMatch[1]);
      return f ? new Response(f.content, { status: 200 }) : new Response('', { status: 404 });
    }
    // POST /files — створення папки .metadata
    if (url === 'https://www.googleapis.com/drive/v3/files' && opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      const f = makeFile(body.name, body.parents, '');
      return new Response(JSON.stringify({ id: f.id, name: f.name }), { status: 200 });
    }
    return new Response('', { status: 404 });
  }),
}));

vi.mock('../../src/services/driveService.js', () => ({
  readDriveFile: vi.fn(async (fileId) => {
    const f = driveState.files.get(fileId);
    if (!f) throw new Error(`not found: ${fileId}`);
    return f.content;
  }),
  createDriveFile: vi.fn(async (parentId, name, content) => {
    const f = makeFile(name, [parentId], content);
    return { id: f.id, name: f.name };
  }),
  updateDriveFile: vi.fn(async (fileId, content) => {
    const f = driveState.files.get(fileId);
    if (!f) throw new Error(`not found: ${fileId}`);
    f.content = content;
    return { id: f.id };
  }),
}));

// Імпортуємо ПІСЛЯ vi.mock
const {
  loadExtendedForCase,
  saveExtendedForCase,
  getExtendedForDocument,
  setExtendedForDocument,
  deleteExtendedForDocument,
  deleteExtendedForDocuments,
  invalidateCache,
} = await import('../../src/services/documentsExtended.js');
const driveAuth = await import('../../src/services/driveAuth.js');
const driveService = await import('../../src/services/driveService.js');

// Кожен тест — свій caseFolderId і invalidate cache.
let caseId, caseFolderId, caseData;
let testCounter = 0;
beforeEach(() => {
  testCounter++;
  // Reset Drive state.
  driveState.files.clear();
  driveState.nextId = 1;
  driveAuth.driveRequest.mockClear();
  driveService.readDriveFile.mockClear();
  driveService.createDriveFile.mockClear();
  driveService.updateDriveFile.mockClear();
  // Кожен тест отримує унікальну справу — щоб module-level cache documentsExtended
  // не плутав з попереднім тестом.
  caseId = `case_${testCounter}_${Math.random().toString(36).slice(2, 6)}`;
  caseFolderId = makeFile(`case_folder_${testCounter}`, null).id;
  caseData = { id: caseId, storage: { driveFolderId: caseFolderId } };
});

describe('documentsExtended', () => {
  describe('loadExtendedForCase', () => {
    it('повертає {} для нової справи без .metadata', async () => {
      const ext = await loadExtendedForCase(caseId, caseData);
      expect(ext).toEqual({});
    });

    it('повертає {} для caseId=null', async () => {
      const ext = await loadExtendedForCase(null, caseData);
      expect(ext).toEqual({});
    });

    it('повторний виклик бере з in-memory cache (без додаткових Drive-запитів)', async () => {
      await loadExtendedForCase(caseId, caseData);
      const callsBefore = driveAuth.driveRequest.mock.calls.length;
      await loadExtendedForCase(caseId, caseData);
      const callsAfter = driveAuth.driveRequest.mock.calls.length;
      expect(callsAfter).toBe(callsBefore); // кеш — без нових запитів
    });
  });

  describe('saveExtendedForCase і round-trip', () => {
    it('зберігає і потім читає ту ж саму мапу', async () => {
      const data = {
        doc_1: {
          documentId: 'doc_1', tags: ['urgent'], notes: 'note', annotations: [],
          processingHistory: [], extractedTextSummary: '', customFields: {},
        },
      };
      await saveExtendedForCase(caseId, caseData, data);
      // Інвалідуємо кеш, щоб реально читати з мок-Drive.
      invalidateCache(caseId);
      const loaded = await loadExtendedForCase(caseId, caseData);
      expect(loaded.doc_1.tags).toEqual(['urgent']);
      expect(loaded.doc_1.notes).toBe('note');
    });

    it('кидає помилку якщо немає storage.driveFolderId', async () => {
      const noStorage = { id: caseId };
      await expect(saveExtendedForCase(caseId, noStorage, {})).rejects.toThrow();
    });
  });

  describe('getExtendedForDocument', () => {
    it('новий документ → дефолтний шаблон extended', async () => {
      const ext = await getExtendedForDocument(caseId, caseData, 'doc_new');
      expect(ext.documentId).toBe('doc_new');
      expect(ext.tags).toEqual([]);
      expect(ext.notes).toBe('');
      expect(ext.processingHistory).toEqual([]);
      expect(ext.customFields).toEqual({});
    });
  });

  describe('setExtendedForDocument', () => {
    it('додає нові поля до документа', async () => {
      const ext = await setExtendedForDocument(caseId, caseData, 'doc_a', { tags: ['v1'] });
      expect(ext.tags).toEqual(['v1']);
      expect(ext.documentId).toBe('doc_a');
    });

    it('повторний виклик мерджить поля поверх існуючих', async () => {
      await setExtendedForDocument(caseId, caseData, 'doc_a', { tags: ['v1'] });
      const ext = await setExtendedForDocument(caseId, caseData, 'doc_a', { notes: 'нотатка' });
      expect(ext.tags).toEqual(['v1']); // зберігся
      expect(ext.notes).toBe('нотатка'); // додався
    });
  });

  describe('deleteExtendedForDocument', () => {
    it('видаляє запис документа і повертає true', async () => {
      await setExtendedForDocument(caseId, caseData, 'doc_a', { tags: ['x'] });
      const removed = await deleteExtendedForDocument(caseId, caseData, 'doc_a');
      expect(removed).toBe(true);
      // після видалення — getExtended повертає дефолтний шаблон
      const ext = await getExtendedForDocument(caseId, caseData, 'doc_a');
      expect(ext.tags).toEqual([]);
    });

    it('повертає false якщо документа і так не було', async () => {
      const removed = await deleteExtendedForDocument(caseId, caseData, 'doc_unknown');
      expect(removed).toBe(false);
    });
  });

  describe('deleteExtendedForDocuments — батч (TASK bulk_delete_unify)', () => {
    it('прибирає всі передані id за один прохід і повертає кількість', async () => {
      await setExtendedForDocument(caseId, caseData, 'doc_a', { tags: ['a'] });
      await setExtendedForDocument(caseId, caseData, 'doc_b', { tags: ['b'] });
      await setExtendedForDocument(caseId, caseData, 'doc_c', { tags: ['c'] });

      const removed = await deleteExtendedForDocuments(caseId, caseData, ['doc_a', 'doc_b']);
      expect(removed).toBe(2);

      // doc_a, doc_b — порожній шаблон; doc_c — лишився.
      invalidateCache(caseId);
      const all = await loadExtendedForCase(caseId, caseData);
      expect(all.doc_a).toBeUndefined();
      expect(all.doc_b).toBeUndefined();
      expect(all.doc_c.tags).toEqual(['c']);
    });

    it('ігнорує id яких немає, рахує лише реально прибрані', async () => {
      await setExtendedForDocument(caseId, caseData, 'doc_a', { tags: ['a'] });
      const removed = await deleteExtendedForDocuments(caseId, caseData, ['doc_a', 'doc_ghost']);
      expect(removed).toBe(1);
    });

    it('порожній список / нема збігів → 0, без save', async () => {
      const removed = await deleteExtendedForDocuments(caseId, caseData, []);
      expect(removed).toBe(0);
      const removed2 = await deleteExtendedForDocuments(caseId, caseData, ['nope']);
      expect(removed2).toBe(0);
    });
  });
});
