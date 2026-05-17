// DP-3 — jobState: crash-safe resume infrastructure на Drive _temp.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createJobStateStore, makeInitialJobState, jobProgress, estimateRemainingMs, JOB_STATUS,
} from '../../src/services/documentPipeline/jobState.js';
import { createMemDrivePort } from '../_memDrivePort.js';

describe('jobState — pure helpers', () => {
  it('jobProgress / estimateRemainingMs', () => {
    const st = makeInitialJobState({ jobId: 'j', caseId: 'c', files: [] });
    st.chunks = [{ status: 'done' }, { status: 'done' }, { status: 'pending' }, { status: 'pending' }];
    expect(jobProgress(st)).toEqual({ done: 2, total: 4, ratio: 0.5 });
    expect(estimateRemainingMs({ ...st, chunkDurationsMs: [] })).toBeNull(); // нечесно з порожньої історії
    expect(estimateRemainingMs({ ...st, chunkDurationsMs: [1000, 1000] })).toBe(2000); // 2 lefт × 1000
  });
});

describe('jobState — store (Drive _temp, crash-safe)', () => {
  let port, store;
  beforeEach(() => { port = createMemDrivePort(); store = createJobStateStore(port); });

  it('save → load round-trip; саме _temp/<caseId>_<jobId>/job_state.json', async () => {
    const st = makeInitialJobState({ jobId: 'j1', caseId: 'c1', files: [{ fileId: 'f0', name: 'a.pdf' }] });
    await store.saveState(st);
    const loaded = await store.loadState('c1', 'j1');
    expect(loaded.jobId).toBe('j1');
    expect(loaded.files[0].fileId).toBe('f0');
    expect(port._countFilesNamed('job_state.json')).toBe(1);
  });

  it('повторний save прибирає попередні дублі (crash-safe: один свіжий)', async () => {
    const st = makeInitialJobState({ jobId: 'j1', caseId: 'c1', files: [] });
    await store.saveState(st);
    await store.saveState({ ...st, chunks: [{ status: 'done' }] });
    await store.saveState({ ...st, chunks: [{ status: 'done' }, { status: 'done' }] });
    expect(port._countFilesNamed('job_state.json')).toBe(1);
    const loaded = await store.loadState('c1', 'j1');
    expect(loaded.chunks).toHaveLength(2);
  });

  it('clearState чистить ВЕСЬ _temp job (chunks + state)', async () => {
    const st = makeInitialJobState({ jobId: 'j1', caseId: 'c1', files: [] });
    await store.saveState(st);
    const folderId = await store._jobFolderId('c1', 'j1');
    await port.uploadBytes(folderId, 'chunk_f0_000.pdf', new Uint8Array([1, 2]), 'application/pdf');
    await store.clearState('c1', 'j1');
    expect(await store.loadState('c1', 'j1')).toBeNull();
    expect(port._countFilesNamed('chunk_f0_000.pdf')).toBe(0);
  });

  it('hasResumableJob — true поки не done', async () => {
    const st = makeInitialJobState({ jobId: 'j1', caseId: 'c1', files: [] });
    await store.saveState(st);
    expect(await store.hasResumableJob('c1', 'j1')).toBe(true);
    await store.saveState({ ...st, status: JOB_STATUS.DONE });
    expect(await store.hasResumableJob('c1', 'j1')).toBe(false);
  });

  it('биткий job_state → loadState null (почати з нуля безпечніше)', async () => {
    const folderId = await store._jobFolderId('c1', 'j1');
    await port.uploadText(folderId, 'job_state.json', '{ broken json', 'application/json');
    expect(await store.loadState('c1', 'j1')).toBeNull();
  });
});
