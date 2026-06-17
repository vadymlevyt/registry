// Юніт-тести тонкого диригента нарізки documentPipeline (A1-D).
// Перевіряють КОНТРАКТ стадії і ЄДИНУ політику диригента — щоб через 3 місяці
// зміна code-path не пройшла повз: категорії результату, накопичення
// decisions/errors, точки розширення (OCP), DI. A1-D: CONVERT/CLASSIFY/
// PROPOSE_METADATA-заглушки і hook-слоти прибрано; persist — ОБОВ'ЯЗКОВИЙ
// override (дефолтного persistStage більше немає).
import { describe, it, expect, vi } from 'vitest';
import {
  createDocumentPipeline,
  STAGE,
  DEFAULT_STAGE_ORDER,
} from '../../src/services/documentPipeline.js';
import { makePersistStub } from '../_persistStub.js';

// Мінімальні стаб-deps: чисті спайки, нуль реальних сайд-ефектів. Стадії
// нарізки (DETECT_BOUNDARIES/EXTRACT/CONFIRM) у prod завжди інжектяться — тут
// тонкі passthrough-стаби; PERSIST — обов'язковий стаб (дефолт прибрано A1-D).
function makeDeps(over = {}) {
  const published = [];
  const { stageOverrides: overStages, ...rest } = over;
  return {
    deps: {
      uploadFile: vi.fn(async () => 'drive_X'),
      createDocument: vi.fn((m) => ({ id: 'doc_1', name: m.name || 'd', source: m.source || 'manual', ...m })),
      persistDocument: vi.fn(async () => ({ success: true })),
      eventBus: { publish: (t, p) => published.push({ t, p }) },
      topics: { DOCUMENT_INGESTED: 'document.ingested', DOCUMENT_BATCH_PROCESSED: 'document.batch_processed' },
      getActor: () => ({ userId: 'u1', tenantId: 't1' }),
      ...rest,
      stageOverrides: {
        [STAGE.DETECT_BOUNDARIES]: async () => ({ ok: true }),
        [STAGE.EXTRACT]: async () => ({ ok: true }),
        [STAGE.CONFIRM]: async () => ({ ok: true }),
        [STAGE.PERSIST]: makePersistStub(),
        ...(overStages || {}),
      },
    },
    published,
  };
}

function baseInput(fileOver = {}) {
  return {
    caseId: 'case_1',
    caseData: { id: 'case_1' },
    files: [{ fileId: 'doc', raw: { name: 'a.pdf', size: 5, type: 'application/pdf' }, ...fileOver }],
  };
}

describe('documentPipeline — точки розширення (OCP, sequence config)', () => {
  it('DEFAULT_STAGE_ORDER — 6 іменованих стадій нарізки у канонічному порядку', () => {
    expect(DEFAULT_STAGE_ORDER).toEqual([
      STAGE.INTAKE, STAGE.DETECT_BOUNDARIES, STAGE.EXTRACT,
      STAGE.CONFIRM, STAGE.PERSIST, STAGE.EMIT,
    ]);
    expect(Object.isFrozen(DEFAULT_STAGE_ORDER)).toBe(true);
  });

  it('stageOverrides замінює стадію БЕЗ зміни диригента', async () => {
    const spy = vi.fn(async (ctx) => ({
      ok: true,
      ctx: { ...ctx, files: ctx.files.map(f => ({ ...f, classifiedBy: 'DP2' })) },
    }));
    const { deps } = makeDeps({ stageOverrides: { [STAGE.DETECT_BOUNDARIES]: spy } });
    const pipe = createDocumentPipeline(deps);
    const res = await pipe.run(baseInput());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.files[0].classifiedBy).toBe('DP2');
    expect(res.ok).toBe(true);
  });

  it('stageFlags[name]=false вимикає стадію (sacrificial architecture)', async () => {
    const { deps, published } = makeDeps({ stageFlags: { [STAGE.EMIT]: false } });
    const res = await createDocumentPipeline(deps).run(baseInput());
    expect(res.ok).toBe(true);
    expect(published).toHaveLength(0);     // emit вимкнено — нуль публікацій
    expect(res.events).toHaveLength(0);
  });
});

describe('documentPipeline — категорії результату (наскрізний контракт)', () => {
  it('ok:true — стадії проходять, документ персиститься, події летять', async () => {
    const { deps, published } = makeDeps();
    const res = await createDocumentPipeline(deps).run(baseInput());
    expect(res.ok).toBe(true);
    expect(res.documents).toHaveLength(1);
    expect(deps.persistDocument).toHaveBeenCalledWith({ caseId: 'case_1', document: expect.objectContaining({ id: 'doc_1' }) });
    expect(published.map(e => e.t)).toEqual(['document.ingested', 'document.batch_processed']);
    expect(published[0].p).toMatchObject({ tenantId: 't1', userId: 'u1', caseId: 'case_1' });
    expect(res.stoppedAt).toBeNull();
  });

  it('ok:true + decisions — накопичуються, pipeline НЕ зупиняється', async () => {
    const dec = { id: 'q1', question: 'судовий акт?' };
    const stub = vi.fn(async () => ({ ok: true, decisions: [dec] }));
    const { deps } = makeDeps({ stageOverrides: { [STAGE.CONFIRM]: stub } });
    const res = await createDocumentPipeline(deps).run(baseInput());
    expect(res.ok).toBe(true);
    expect(res.decisions).toEqual([dec]);
    expect(res.documents).toHaveLength(1);   // дійшло до persist (не зупинилось)
  });

  it('ok:false + file_skipped — run завершено без документа, помилка зафіксована', async () => {
    const stub = vi.fn(async () => ({ ok: false, error: { code: 'X', message: 'skip me', file_skipped: true } }));
    const { deps } = makeDeps({ stageOverrides: { [STAGE.EXTRACT]: stub } });
    const res = await createDocumentPipeline(deps).run(baseInput());
    expect(res.ok).toBe(false);
    expect(res.documents).toHaveLength(0);
    expect(res.stoppedAt).toBe(STAGE.EXTRACT);
    expect(res.resumable).toBe(false);                 // skip ≠ resumable
    expect(res.errors[0]).toMatchObject({ code: 'X', stage: STAGE.EXTRACT });
    expect(deps.persistDocument).not.toHaveBeenCalled();
  });

  it('ok:false + fatal — pipeline зупиняється, стан resumable', async () => {
    const stub = vi.fn(async () => ({ ok: false, error: { code: 'F', message: 'boom', fatal: true } }));
    const { deps } = makeDeps({ stageOverrides: { [STAGE.DETECT_BOUNDARIES]: stub } });
    const res = await createDocumentPipeline(deps).run(baseInput());
    expect(res.ok).toBe(false);
    expect(res.stoppedAt).toBe(STAGE.DETECT_BOUNDARIES);
    expect(res.resumable).toBe(true);
    expect(res.errors[0]).toMatchObject({ code: 'F' });
  });

  it('ok:false БЕЗ fatal/file_skipped — інваріант: трактується як fatal', async () => {
    const stub = vi.fn(async () => ({ ok: false, error: { code: 'AMB', message: 'ambiguous' } }));
    const { deps } = makeDeps({ stageOverrides: { [STAGE.DETECT_BOUNDARIES]: stub } });
    const res = await createDocumentPipeline(deps).run(baseInput());
    expect(res.ok).toBe(false);
    expect(res.resumable).toBe(true);          // невідома форма → fatal
    expect(res.stoppedAt).toBe(STAGE.DETECT_BOUNDARIES);
  });

  it('стадія кинула виняток — STAGE_THREW fatal (не валить процес)', async () => {
    const stub = vi.fn(async () => { throw new Error('unexpected'); });
    const { deps } = makeDeps({ stageOverrides: { [STAGE.EXTRACT]: stub } });
    const res = await createDocumentPipeline(deps).run(baseInput());
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatchObject({ code: 'STAGE_THREW', stage: STAGE.EXTRACT, fatal: true });
  });

  it('intake — порожній files[] = fatal NO_FILES', async () => {
    const { deps } = makeDeps();
    const res = await createDocumentPipeline(deps).run({ caseId: 'c', caseData: {}, files: [] });
    expect(res.ok).toBe(false);
    expect(res.errors[0].code).toBe('NO_FILES');
    expect(res.stoppedAt).toBe(STAGE.INTAKE);
  });
});

describe('documentPipeline — DI (upload/factory/persist)', () => {
  it('raw-файл: uploadFile викликано, driveId у документі', async () => {
    const { deps } = makeDeps();
    const res = await createDocumentPipeline(deps).run(baseInput());
    expect(deps.uploadFile).toHaveBeenCalledTimes(1);
    expect(res.files[0].driveId).toBe('drive_X');
  });

  it('Drive-source: upload — passthrough (НЕ викликається)', async () => {
    const { deps } = makeDeps();
    const res = await createDocumentPipeline(deps).run(
      baseInput({ raw: null, isDriveSource: true, driveId: 'drive_picked', type: 'application/pdf' })
    );
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(res.files[0].driveId).toBe('drive_picked');
    expect(res.ok).toBe(true);
  });

  it('buildDocumentMetadata ін\'єктується — його вихід іде у createDocument', async () => {
    const build = vi.fn(() => ({ name: 'Custom', documentNature: 'searchable', source: 'manual' }));
    const { deps } = makeDeps({ buildDocumentMetadata: build });
    await createDocumentPipeline(deps).run(baseInput());
    expect(build).toHaveBeenCalledTimes(1);
    expect(deps.createDocument).toHaveBeenCalledWith(expect.objectContaining({ name: 'Custom' }));
  });

  it('persistDocument !success → PERSIST_FAILED fatal', async () => {
    const { deps } = makeDeps({ persistDocument: vi.fn(async () => ({ success: false, error: 'дублікат' })) });
    const res = await createDocumentPipeline(deps).run(baseInput());
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatchObject({ code: 'PERSIST_FAILED', fatal: true });
    expect(res.stoppedAt).toBe(STAGE.PERSIST);
  });
});

describe('documentPipeline — persist обов\'язковий (A1-D)', () => {
  it('без stageOverrides.persist → createDocumentPipeline кидає', () => {
    const { deps } = makeDeps();
    delete deps.stageOverrides[STAGE.PERSIST];
    expect(() => createDocumentPipeline(deps)).toThrow(/persist override обов/);
  });
});

describe('documentPipeline — диригент без domain-if', () => {
  it('різні тип/розширення файлу не міняють шлях диригента (стадії-заглушки = identity)', async () => {
    const { deps: d1 } = makeDeps();
    const { deps: d2 } = makeDeps();
    const r1 = await createDocumentPipeline(d1).run(baseInput({ raw: { name: 'court.pdf', size: 1, type: 'application/pdf' } }));
    const r2 = await createDocumentPipeline(d2).run(baseInput({ raw: { name: 'photo.heic', size: 1, type: 'image/heic' } }));
    // Однаковий набір пройдених стадій → однакова форма результату
    // (диригент не розгалужується за доменом; рішення — у стадіях).
    expect(r1.ok).toBe(r2.ok);
    expect(r1.documents).toHaveLength(r2.documents.length);
    expect(r1.stoppedAt).toBe(r2.stoppedAt);
  });
});

describe('documentPipeline — G0 onStage/onStageEnd телеметрія (OCP)', () => {
  it('onStage кличеться для кожної пройденої стадії у DEFAULT_STAGE_ORDER', async () => {
    const seen = [];
    const { deps } = makeDeps({ onStage: (n) => seen.push(n) });
    await createDocumentPipeline(deps).run(baseInput());
    // Усі заглушки/реалізації проходять (single-file успіх) — увесь порядок.
    expect(seen).toEqual([...DEFAULT_STAGE_ORDER]);
  });

  it('onStageEnd кличеться з числовою тривалістю після КОЖНОЇ стадії', async () => {
    const ended = [];
    const { deps } = makeDeps({ onStageEnd: (n, ms) => ended.push([n, ms]) });
    await createDocumentPipeline(deps).run(baseInput());
    expect(ended.map((e) => e[0])).toEqual([...DEFAULT_STAGE_ORDER]);
    for (const [, ms] of ended) {
      expect(typeof ms).toBe('number');
      expect(ms).toBeGreaterThanOrEqual(0);
    }
  });

  it('onStageEnd фіксується НАВІТЬ коли стадія fatal (вимір гарячого шляху)', async () => {
    const ended = [];
    const { deps } = makeDeps({
      onStageEnd: (n, ms) => ended.push(n),
      stageOverrides: { extract: async () => ({ ok: false, error: { code: 'X', fatal: true } }) },
    });
    const res = await createDocumentPipeline(deps).run(baseInput());
    expect(res.stoppedAt).toBe(STAGE.EXTRACT);
    // extract провалився, але його тривалість усе одно зміряна (до break).
    expect(ended).toContain(STAGE.EXTRACT);
    expect(ended).not.toContain(STAGE.PERSIST);   // зупинились — далі не йшли
  });

  it('збій onStage/onStageEnd ізольований — pipeline не падає (юрсистема)', async () => {
    const { deps } = makeDeps({
      onStage: () => { throw new Error('telemetry boom'); },
      onStageEnd: () => { throw new Error('timing boom'); },
    });
    const res = await createDocumentPipeline(deps).run(baseInput());
    expect(res.ok).toBe(true);
    expect(res.documents).toHaveLength(1);
  });

  it('відсутні onStage/onStageEnd — behavior-preserving (deps опційні)', async () => {
    const { deps } = makeDeps();
    delete deps.onStage; delete deps.onStageEnd;
    const res = await createDocumentPipeline(deps).run(baseInput());
    expect(res.ok).toBe(true);
  });
});
