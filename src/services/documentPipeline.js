// ── DOCUMENT PIPELINE · ТОНКИЙ ДИРИГЕНТ ──────────────────────────────────────
// Архітектурний фундамент Document Processor v2 (серія DP-1…DP-6).
//
// Патерни:
//   • Pipes-and-Filters — стадії як незалежні фільтри (ctx → ctx'), одна про
//     одну не знають.
//   • Mediator — диригент лише впорядковує виклики стадій, мапить результати і
//     публікує події. Жодного domain-if (немає гілок «якщо суд / якщо DOCX /
//     якщо ECITS») у самому диригенті — рішення живуть у стадіях/політиках.
//   • Dependency Injection — усі сайд-ефекти і залежності (executeAction,
//     конвертер, upload, eventBus, factory, актор) ін'єктуються через deps,
//     як createActions(deps) у TASK 5. Жодних прямих імпортів стану/Drive у
//     цьому файлі — диригент чистий.
//
// DP-1 закладає КАРКАС + КОНТРАКТ + ПРОВОДКУ AddDocumentModal. Доменна логіка
// стадій boundary/classify (DP-2), OCR/extract-семантики (DP-3), реальних
// propose-метаданих/UI підтвердження (DP-4) НЕ реалізована — це стабільні
// passthrough-заглушки з незмінним контрактом. Наступні TASK додають
// реалізацію стадії через deps.stageOverrides[ім'я] БЕЗ зміни диригента (OCP).
//
// ── КОНТРАКТ СТАДІЇ ─────────────────────────────────────────────────────────
// Стадія — async-функція  run(ctx, deps) → StageResult.
//
//   StageResult = {
//     ok: boolean,                       // true → стадія успішна
//     ctx?: PipelineContext,             // НОВИЙ контекст (стадія сама його
//                                        //   трансформує — диригент не знає
//                                        //   що саме змінилось; pipes-filters)
//     decisions?: Decision[],            // питання адвокату де робота зроблена
//                                        //   (накопичуються, НЕ зупиняють
//                                        //   pipeline) — вкладка Підтвердження DP-4
//     error?: {                          // присутнє лише коли ok:false
//       code: string,
//       message: string,
//       file_skipped?: boolean,          // конкретний файл провалився, решта
//                                        //   продовжує (batch) / run завершено
//                                        //   без документа (single-file DP-1)
//       fatal?: boolean,                 // pipeline зупиняється, job-стан
//                                        //   зберігається для resume (DP-5/6)
//       retriable?: boolean,
//       stage?: string, fileId?: string,
//     },
//   }
//
// Категорії результату (наскрізна архітектурна вимога, не окрема стадія):
//   1. ok:true                      → стадія успішна, продовжуємо
//   2. ok:true, decisions:[…]       → є питання адвокату (накопичуються)
//   3. ok:false, error.file_skipped → файл провалився, решта продовжує
//   4. ok:false, error.fatal        → pipeline зупиняється, стан для resume
//
// Інваріант диригента: ok:false МУСИТЬ нести fatal АБО file_skipped. Невідома
// форма ok:false трактується як fatal (юрсистема: краще зупинитись ніж тихо
// створити неповний документ). Це ЄДИНА політика — у classifyDisposition.
//
// ── ХУКИ ────────────────────────────────────────────────────────────────────
//   • metadataSidecar — точка запису розширених метаданих через
//     documentsExtended.js (.metadata/documents_extended.json). DP-1: named
//     no-op слот (AddDocumentModal сьогодні extended-полів не пише —
//     behavior-preserving). Активується коли стадія почне пропонувати
//     tags/annotations/processingHistory.
//   • metadataExtractor — точка входу каналу metadataExtractor/. DP-1:
//     DISABLED слот, диригент його НЕ викликає (канал лишається вимкненим;
//     metadata_extractor_agent має порожній allowlist). Лише інтерфейс.
//
// ── SAAS / MULTI-USER / BILLING ─────────────────────────────────────────────
// Диригент tenant-agnostic: tenantId/userId беруться з deps.getActor() і
// кладуться у payload подій (SaaS-готовність — підписники фільтрують без
// lookup'у). Жодної модифікації даних повз executeAction: персистенція —
// тільки через ін'єктований persistDocument (обгортка над executeAction →
// actionsRegistry, де висить audit+billing+permissions). Конвертація
// інструментується в converterService (одна точка), не дублюється тут.

// ── Назви стадій — іменовані точки розширення DP-2..6 ────────────────────────
// Кожна — один сенс (правило #11). Зміна порядку/набору = зміна цього масиву,
// НЕ диригента.
export const STAGE = Object.freeze({
  INTAKE: 'intake',                       // нормалізація вводу job+files
  CONVERT: 'convert',                     // файл → PDF (converterService); passthrough якщо вже на Drive
  DETECT_BOUNDARIES: 'detectBoundaries',  // DP-2: розріз склеєного багатодок-PDF (DP-1 заглушка)
  CLASSIFY: 'classify',                   // DP-2: класифікація category/author/nature (DP-1 заглушка)
  EXTRACT: 'extract',                     // DP-3: OCR/семантичний витяг тексту (DP-1 заглушка)
  PROPOSE_METADATA: 'proposeMetadata',    // propose→confirm: стадія пропонує метадані/decisions (DP-1 заглушка)
  CONFIRM: 'confirm',                     // propose→confirm-гейт: підтвердження адвокатом (DP-1 авто-pass)
  PERSIST: 'persist',                     // upload + createDocument + executeAction add_document
  EMIT: 'emit',                           // eventBus DOCUMENT_INGESTED / DOCUMENT_BATCH_PROCESSED
});

// Канонічний порядок. DP-2..6 додають реалізацію існуючого імені (override),
// не вставляють нові вузли в диригент.
export const DEFAULT_STAGE_ORDER = Object.freeze([
  STAGE.INTAKE,
  STAGE.CONVERT,
  STAGE.DETECT_BOUNDARIES,
  STAGE.CLASSIFY,
  STAGE.EXTRACT,
  STAGE.PROPOSE_METADATA,
  STAGE.CONFIRM,
  STAGE.PERSIST,
  STAGE.EMIT,
]);

// ── Іменовані хук-точки ─────────────────────────────────────────────────────
// metadataSidecar — активовний слот: запис extended-метаданих через
//   documentsExtended.js. DP-1: викликається лише якщо caller дав
//   deps.writeMetadataSidecar І стадія поклала item.extendedMetadata.
// metadataExtractor — DISABLED слот каналу metadataExtractor/. Диригент НЕ
//   викликає його в DP-1 (gate deps.enableMetadataExtractor !== true завжди;
//   metadata_extractor_agent має порожній allowlist). Лише точка входу.
export const HOOK = Object.freeze({
  METADATA_SIDECAR: 'metadataSidecar',
  METADATA_EXTRACTOR: 'metadataExtractor',
});

// ── Заглушка-стадія (passthrough) ───────────────────────────────────────────
// Стабільний контракт без доменної логіки: повертає ok без зміни ctx. DP-2..6
// замінюють реальною реалізацією через deps.stageOverrides[ім'я].
function passthroughStage() {
  return { ok: true };
}

// ── Стадії DP-1 ─────────────────────────────────────────────────────────────

// intake — перевірити job і нормалізувати files[]. Один сенс: вхід у конвеєр.
async function intakeStage(ctx) {
  if (!ctx.job?.caseId) {
    return { ok: false, error: { code: 'NO_CASE', message: "caseId обов'язковий", fatal: true } };
  }
  if (!Array.isArray(ctx.files) || ctx.files.length === 0) {
    return { ok: false, error: { code: 'NO_FILES', message: 'Немає файлів для обробки', fatal: true } };
  }
  return { ok: true };
}

// convert — привести файл до PDF через converterService. Passthrough коли файл
// уже на Drive (Drive-picker: driveId відомий, конвертації не робимо) або
// прийшов готовим зі склейки зображень (mergeArtifacts — OCR вже виконано на
// кожному оригіналі, повторний на merged PDF заборонено). Помилка convert →
// file_skipped (документ не створюється; модаль лишається відкритою —
// контракт TASK A зберігається через мапінг коду в caller'а).
async function convertStage(ctx, deps) {
  const files = [];
  for (const item of ctx.files) {
    if (item.skipped) { files.push(item); continue; }

    let next = { ...item };

    // Файл уже на Drive (Drive-picker) — конвертації не робимо (passthrough).
    if (item.isDriveSource && item.driveId) {
      next.converterType = 'passthrough';
      next.extractedText = null;
    } else if (item.raw) {
      // Реальний файл з пристрою — converterService.convertToPdf.
      let conversion;
      try {
        conversion = await deps.convertToPdf(item.raw, ctx.job.conversionContext || {});
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'CONVERT_FAILED',
            message: err?.message || 'Помилка конвертації',
            file_skipped: true,
            fileId: item.fileId,
          },
        };
      }
      // converterService повертає завжди PDF при успіху; passthrough може бути
      // PDF або невідомий тип — лишаємо як є (Drive iframe покаже preview).
      const isPdfBlob = conversion.converter !== 'passthrough'
        || conversion.originalMime === 'application/pdf';
      next.conversion = conversion;
      next.uploadedFile = isPdfBlob
        ? new File([conversion.pdfBlob], `${conversion.pdfName}.pdf`, { type: 'application/pdf' })
        : item.raw;
      next.originalMime = conversion.originalMime;
      next.extractedText = conversion.extractedText || null;
      next.converterType = conversion.converter;
      next.warnings = [...(item.warnings || []), ...(conversion.warnings || [])];
    }
    // else: ні raw, ні driveId — метадані-only документ (нічого не конвертуємо).

    // Готові артефакти зі склейки зображень (TASK B): OCR уже виконано на
    // КОЖНОМУ оригіналі — текст/layout беремо з merge, повторний OCR на
    // склеєному PDF заборонено. Сам merged-PDF проходить як звичайний PDF
    // (passthrough+upload вище).
    if (item.mergeArtifacts) {
      next.extractedText = item.mergeArtifacts.extractedText || null;
      next.mergeLayoutJson = item.mergeArtifacts.layoutJson || null;
      next.converterType = 'multiImageToPdf';
    }

    files.push(next);
  }
  return { ok: true, ctx: { ...ctx, files } };
}

// persist — покласти байти на Drive (якщо ще не там), створити канонічний
// запис через factory і зафіксувати ЛИШЕ через executeAction (audit/billing/
// permissions висять там). Помилка upload → file_skipped; помилка фіксації →
// fatal (серйозніше: дані не збереглись). Після успіху — хук metadataSidecar
// (DP-1 no-op якщо deps.writeMetadataSidecar не передано).
async function persistStage(ctx, deps) {
  const files = [];
  const documents = [];
  for (const item of ctx.files) {
    if (item.skipped || item.document) { files.push(item); continue; }

    let driveId = item.driveId || null;
    let originalDriveId = item.originalDriveId || null;
    const warnings = [...(item.warnings || [])];

    // Upload основного файлу (конвертований PDF або passthrough). Drive-source
    // уже має driveId — пропускаємо.
    if (!driveId && item.uploadedFile) {
      try {
        driveId = await deps.uploadFile(item.uploadedFile, ctx.job.caseData);
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'UPLOAD_FAILED',
            message: err?.message || 'Помилка завантаження на Drive',
            file_skipped: true,
            fileId: item.fileId,
          },
        };
      }
    }

    // Оригінал поряд (DOCX → PDF: зберігаємо .docx як originalDriveId).
    // Не критично: PDF уже на Drive, документ створиться без originalDriveId.
    if (!originalDriveId && item.conversion?.originalBlob) {
      try {
        const origName = item.name || item.conversion.originalName || 'original';
        const origFile = new File(
          [item.conversion.originalBlob],
          origName,
          { type: item.originalMime || item.type || 'application/octet-stream' },
        );
        originalDriveId = await deps.uploadFile(origFile, ctx.job.caseData);
      } catch (origErr) {
        warnings.push('ORIGINAL_UPLOAD_FAILED');
      }
    }

    // Метадані документа будує ІН'ЄКТОВАНИЙ deps.buildDocumentMetadata
    // (доменна евристика nature/icon/source лишається у шарі що її володіє —
    // диригент і стадія domain-free; DP-2 classify-стадія візьме це на себе).
    // Fallback — прямий шаблон, коли builder не передано.
    const metadata = typeof deps.buildDocumentMetadata === 'function'
      ? deps.buildDocumentMetadata({ item, driveId, originalDriveId, job: ctx.job })
      : {
          ...(item.metadataTemplate || {}),
          driveId: driveId || null,
          driveUrl: driveId ? `https://drive.google.com/file/d/${driveId}/view` : null,
          originalDriveId,
          originalMime: item.originalMime ?? item.metadataTemplate?.originalMime ?? null,
          size: item.uploadedFile?.size || item.size || item.metadataTemplate?.size || 0,
        };
    const document = deps.createDocument(metadata);

    const res = await deps.persistDocument({ caseId: ctx.job.caseId, document });
    if (!res?.success) {
      return {
        ok: false,
        error: {
          code: 'PERSIST_FAILED',
          message: res?.error || 'add_document failed',
          fatal: true,
          fileId: item.fileId,
        },
      };
    }

    // Хук metadataSidecar — точка запису extended-метаданих. DP-1: викликаємо
    // тільки якщо caller дав і writeMetadataSidecar, і непорожні extended-поля.
    if (typeof deps.writeMetadataSidecar === 'function' && item.extendedMetadata) {
      try {
        await deps.writeMetadataSidecar({
          caseId: ctx.job.caseId,
          caseData: ctx.job.caseData,
          documentId: document.id,
          fields: item.extendedMetadata,
        });
      } catch (e) {
        warnings.push('METADATA_SIDECAR_FAILED');
      }
    }

    // Хук metadataExtractor — DISABLED слот каналу metadataExtractor/.
    // Gate завжди закритий у DP-1 (deps.enableMetadataExtractor !== true) —
    // канал лишається вимкненим (metadata_extractor_agent allowlist порожній).
    // Це лише іменована точка входу для майбутньої активації окремим TASK.
    if (deps.enableMetadataExtractor === true && typeof deps.metadataExtractorHook === 'function') {
      try {
        await deps.metadataExtractorHook({ caseId: ctx.job.caseId, documentId: document.id, item });
      } catch (e) {
        warnings.push('METADATA_EXTRACTOR_FAILED');
      }
    }

    const persisted = { ...item, driveId, originalDriveId, document, warnings };
    files.push(persisted);
    documents.push(document);
  }
  return { ok: true, ctx: { ...ctx, files, documents: [...ctx.documents, ...documents] } };
}

// emit — опублікувати lifecycle-події (TASK 3 топіки). DP-1 — перший
// publisher. Payload містить tenantId/userId (SaaS). eventBus опційний;
// publish без підписників — no-op (behavior-preserving: користувач нічого
// не помічає).
async function emitStage(ctx, deps) {
  if (!deps.eventBus || !deps.topics) return { ok: true };
  const actor = (typeof deps.getActor === 'function' && deps.getActor()) || {};
  const events = [...ctx.events];
  for (const item of ctx.files) {
    if (!item.document) continue;
    const payload = {
      caseId: ctx.job.caseId,
      documentId: item.document.id,
      source: item.document.source,
      tenantId: actor.tenantId ?? null,
      userId: actor.userId ?? null,
      jobId: ctx.job.jobId,
      timestamp: new Date().toISOString(),
    };
    try { deps.eventBus.publish(deps.topics.DOCUMENT_INGESTED, payload); } catch (e) { /* publish ізольований */ }
    events.push({ topic: deps.topics.DOCUMENT_INGESTED, payload });
  }
  if (ctx.documents.length > 0) {
    const batchPayload = {
      caseId: ctx.job.caseId,
      jobId: ctx.job.jobId,
      documentIds: ctx.documents.map(d => d.id),
      count: ctx.documents.length,
      tenantId: actor.tenantId ?? null,
      userId: actor.userId ?? null,
      timestamp: new Date().toISOString(),
    };
    try { deps.eventBus.publish(deps.topics.DOCUMENT_BATCH_PROCESSED, batchPayload); } catch (e) { /* ізольовано */ }
    events.push({ topic: deps.topics.DOCUMENT_BATCH_PROCESSED, payload: batchPayload });
  }
  return { ok: true, ctx: { ...ctx, events } };
}

// Реалізації стадій DP-1. Заглушки — стабільний passthrough-контракт; DP-2..6
// підставляють реальні через deps.stageOverrides[ім'я] (OCP, диригент незмінний).
const DEFAULT_STAGE_IMPL = Object.freeze({
  [STAGE.INTAKE]: intakeStage,
  [STAGE.CONVERT]: convertStage,
  [STAGE.DETECT_BOUNDARIES]: passthroughStage,  // DP-2
  [STAGE.CLASSIFY]: passthroughStage,           // DP-2
  [STAGE.EXTRACT]: passthroughStage,            // DP-3
  [STAGE.PROPOSE_METADATA]: passthroughStage,   // DP-4
  [STAGE.CONFIRM]: passthroughStage,            // DP-4 (auto-confirm поки UI немає)
  [STAGE.PERSIST]: persistStage,
  [STAGE.EMIT]: emitStage,
});

// ── ЄДИНА ПОЛІТИКА ДИРИГЕНТА ────────────────────────────────────────────────
// Класифікація диспозиції за StageResult. Жодного знання про домен (тип
// документа, суд, формат) — лише форма результату. Це і є «явна політика
// stop/continue/flag визначена ДО коду».
function classifyDisposition(result) {
  if (!result || result.ok === true) return 'continue';
  const err = result.error || {};
  if (err.fatal === true) return 'fatal';
  if (err.file_skipped === true) return 'skip';
  // Інваріант: ok:false без fatal/file_skipped — трактуємо як fatal
  // (не продовжуємо тихо з можливо-неповним документом).
  return 'fatal';
}

function makeContext(input) {
  return {
    job: {
      jobId: input.jobId || `dpjob_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      caseId: input.caseId,
      caseData: input.caseData || null,
      agentId: input.agentId || 'dossier_agent',
      source: input.source || 'manual',
      addedBy: input.addedBy || 'user',
      module: input.module || null,
      operation: input.operation || 'add_document',
      conversionContext: input.conversionContext || null,
      startedAt: new Date().toISOString(),
    },
    files: (input.files || []).map((f, i) => ({
      fileId: f.fileId || `f${i}`,
      raw: f.raw || null,
      isDriveSource: !!f.isDriveSource,
      driveId: f.driveId || null,
      originalDriveId: f.originalDriveId || null,
      originalMime: f.originalMime || null,
      name: f.name || f.raw?.name || null,
      size: f.size ?? f.raw?.size ?? 0,
      type: f.type || f.raw?.type || null,
      metadataTemplate: f.metadataTemplate || {},
      mergeArtifacts: f.mergeArtifacts || null,
      extendedMetadata: f.extendedMetadata || null,
      warnings: [],
      skipped: false,
      skipReason: null,
    })),
    documents: [],
    decisions: [],
    errors: [],
    events: [],
    stoppedAt: null,
    resumable: false,
  };
}

function finalizeResult(ctx) {
  return {
    ok: ctx.documents.length > 0 && !ctx.stoppedAt,
    jobId: ctx.job.jobId,
    documents: ctx.documents,
    decisions: ctx.decisions,
    errors: ctx.errors,
    events: ctx.events,
    files: ctx.files,
    stoppedAt: ctx.stoppedAt,
    resumable: ctx.resumable,
    job: ctx.job,
  };
}

// ── ФАБРИКА ДИРИГЕНТА (DI, як createActions(deps)) ──────────────────────────
// Не глобальний сінглтон — інстанс на виклик з ін'єктованими deps. Стан/Drive
// не імпортуються; приходять через deps. DP-2..6: передати
// deps.stageOverrides[ім'я] (реальна реалізація стадії) і/або
// deps.stageFlags[ім'я]=false (вимкнути стадію — sacrificial architecture,
// дешевий обріз як CONVERT_DOCX_TO_PDF).
export function createDocumentPipeline(deps = {}) {
  const stageImpl = { ...DEFAULT_STAGE_IMPL, ...(deps.stageOverrides || {}) };
  const flags = deps.stageFlags || {};

  async function run(input) {
    let ctx = makeContext(input);
    for (const name of DEFAULT_STAGE_ORDER) {
      if (flags[name] === false) continue;        // стадія вимкнена прапором
      const impl = stageImpl[name];
      if (typeof impl !== 'function') continue;

      // G0 — діагностика/UX (OCP: deps-хук, НЕ зміна STAGE/порядку/freeze).
      // onStage — «зараз почалась стадія N» (bug 7: людський підпис у UI).
      // onStageEnd — тривалість стадії (bug 3: вимір 46-хв гарячого шляху).
      // Ізольовані: збій телеметрії НЕ валить pipeline (юрсистема).
      if (typeof deps.onStage === 'function') {
        try { deps.onStage(name); } catch { /* телеметрія ізольована */ }
      }
      const stageT0 = Date.now();

      let result;
      try {
        result = await impl(ctx, deps);
      } catch (err) {
        result = {
          ok: false,
          error: {
            code: 'STAGE_THREW',
            message: err?.message || String(err),
            fatal: true,
            stage: name,
          },
        };
      }

      if (typeof deps.onStageEnd === 'function') {
        try { deps.onStageEnd(name, Date.now() - stageT0); } catch { /* ізольовано */ }
      }

      const disposition = classifyDisposition(result);

      // Спершу перемикаємо ctx (стадія сама його трансформувала, зберігши
      // накопичувачі через ...ctx), ПОТІМ доливаємо decisions у вже-новий ctx —
      // інакше щойно долиті decisions загубляться при свопі.
      if (disposition === 'continue' && result.ctx) { ctx = result.ctx; }
      if (Array.isArray(result?.decisions) && result.decisions.length > 0) {
        ctx.decisions = [...ctx.decisions, ...result.decisions];
      }

      if (disposition === 'continue') {
        continue;
      }

      // ok:false — фіксуємо помилку у накопичувач (вкладка Помилки DP-4).
      ctx.errors = [...ctx.errors, { ...(result.error || {}), stage: result.error?.stage || name }];
      if (disposition === 'fatal') {
        ctx.stoppedAt = name;
        ctx.resumable = true;        // job-стан збережено для resume (DP-5/6)
        break;
      }
      if (disposition === 'skip') {
        // DP-1: single-file — file_skipped завершує run без документа.
        // Batch-продовження решти файлів — розширення DP-4 (контракт готовий:
        // помилка вже у ctx.errors; диригент незмінний).
        ctx.stoppedAt = name;
        break;
      }
    }
    return finalizeResult(ctx);
  }

  return {
    run,
    STAGE,
    DEFAULT_STAGE_ORDER,
    // Статус хук-точок (для діагностики/тестів і майбутніх TASK).
    hooks: {
      [HOOK.METADATA_SIDECAR]: { enabled: typeof deps.writeMetadataSidecar === 'function' },
      [HOOK.METADATA_EXTRACTOR]: { enabled: deps.enableMetadataExtractor === true },
    },
  };
}
