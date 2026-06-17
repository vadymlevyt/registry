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
// A1-D (2026-06): диригент СПЕЦІАЛІЗОВАНО під ЧИСТУ НАРІЗКУ сканованого PDF —
// єдину живу дорогу, що його використовує (DocumentPipelineContext → нарізка).
// Прибрано «універсальні» муляжі: стадії-заглушки CONVERT/CLASSIFY/
// PROPOSE_METADATA, дефолтний persistStage і hook-слоти metadataExtractor/
// metadataSidecar — на нарізці вони були no-op або мертвою тінню (audit_dp).
// Інші дороги (склейка фото / просто додати / розпак ZIP) — окремі сервіси,
// диригент їх НЕ обслуговує. Конкретні стадії нарізки (Smart Triage у
// DETECT_BOUNDARIES, extractV3 у EXTRACT, confirmBoundaries у CONFIRM,
// splitDocumentsV3 у PERSIST) ін'єктуються через deps.stageOverrides[ім'я]
// БЕЗ зміни диригента (OCP). PERSIST — ОБОВ'ЯЗКОВИЙ override (диригент без
// виконавця нарізки не існує).
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
//   5. halt:true, decisions:[…]     → свідомий стоп: стадія завершила свою
//                                     роботу і вважає продовження нерелевантним.
//                                     Сенс — у decisions (Зона 3 «Питання»),
//                                     не у errors. Окремо від fatal (правило #11):
//                                     fatal = дані неповні; halt = дані штатні,
//                                     стадія сама обрала зупинку.
//
// Інваріант диригента: ok:false МУСИТЬ нести fatal АБО file_skipped. Невідома
// форма ok:false трактується як fatal (юрсистема: краще зупинитись ніж тихо
// створити неповний документ). Це ЄДИНА політика — у classifyDisposition.
//
// ── SAAS / MULTI-USER / BILLING ─────────────────────────────────────────────
// Диригент tenant-agnostic: tenantId/userId беруться з deps.getActor() і
// кладуться у payload подій (SaaS-готовність — підписники фільтрують без
// lookup'у). Жодної модифікації даних повз executeAction: персистенція —
// тільки через ін'єктований persistDocument (обгортка над executeAction →
// actionsRegistry, де висить audit+billing+permissions). Конвертація
// інструментується в converterService (одна точка), не дублюється тут.

// ── Назви стадій КОНВЕЄРА НАРІЗКИ — іменовані точки розширення ───────────────
// Кожна — один сенс (правило #11). Зміна порядку/набору = зміна цього масиву,
// НЕ диригента. A1-D: лишились РІВНО стадії нарізки; універсальні муляжі
// CONVERT/CLASSIFY/PROPOSE_METADATA прибрано.
export const STAGE = Object.freeze({
  INTAKE: 'intake',                       // нормалізація вводу job+files
  DETECT_BOUNDARIES: 'detectBoundaries',  // Smart Triage: межі склеєного багатодок-скану (override)
  EXTRACT: 'extract',                     // OCR/семантичний витяг тексту нарізки (override extractV3)
  CONFIRM: 'confirm',                     // підтвердження плану нарізки (override confirmBoundaries)
  PERSIST: 'persist',                     // нарізка+upload+createDocument+add_document (override splitDocumentsV3 — ОБОВ'ЯЗКОВИЙ)
  EMIT: 'emit',                           // eventBus DOCUMENT_INGESTED / DOCUMENT_BATCH_PROCESSED
});

// Канонічний порядок конвеєра нарізки. Стадії нарізки підставляють реалізацію
// існуючого імені (override), не вставляють нові вузли в диригент.
export const DEFAULT_STAGE_ORDER = Object.freeze([
  STAGE.INTAKE,
  STAGE.DETECT_BOUNDARIES,
  STAGE.EXTRACT,
  STAGE.CONFIRM,
  STAGE.PERSIST,
  STAGE.EMIT,
]);

// ── Стадії з дефолтною реалізацією ──────────────────────────────────────────
// Диригент постачає лише INTAKE (вхідний guard) і EMIT (lifecycle-події).
// DETECT_BOUNDARIES/EXTRACT/CONFIRM/PERSIST — стадії нарізки, ін'єктуються
// через deps.stageOverrides[ім'я] (prod завжди їх дає). Без override стадія
// без дефолту просто пропускається (PERSIST — виняток: ОБОВ'ЯЗКОВИЙ, інакше
// createDocumentPipeline кидає).

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
      // TASK 2: чи перегенерувати case_context.md після цієї партії — рішення
      // адвоката з DP-тумблера «Оновити case_context.md». Слухач (CaseDossier)
      // регенерує нарис ТІЛЬКИ якщо true. Дефолт false (manual add не чіпає).
      updateCaseContext: deps.updateCaseContext === true,
      timestamp: new Date().toISOString(),
    };
    try { deps.eventBus.publish(deps.topics.DOCUMENT_BATCH_PROCESSED, batchPayload); } catch (e) { /* ізольовано */ }
    events.push({ topic: deps.topics.DOCUMENT_BATCH_PROCESSED, payload: batchPayload });
  }
  return { ok: true, ctx: { ...ctx, events } };
}

// Дефолтні реалізації стадій диригента. Лише INTAKE (вхідний guard) і EMIT
// (lifecycle-події) мають дефолт. Стадії нарізки DETECT_BOUNDARIES/EXTRACT/
// CONFIRM/PERSIST приходять через deps.stageOverrides[ім'я] (OCP, диригент
// незмінний). Стадія без дефолту й без override просто пропускається; PERSIST
// — виняток (createDocumentPipeline вимагає override).
const DEFAULT_STAGE_IMPL = Object.freeze({
  [STAGE.INTAKE]: intakeStage,
  [STAGE.EMIT]: emitStage,
});

// ── ЄДИНА ПОЛІТИКА ДИРИГЕНТА ────────────────────────────────────────────────
// Класифікація диспозиції за StageResult. Жодного знання про домен (тип
// документа, суд, формат) — лише форма результату. Це і є «явна політика
// stop/continue/flag визначена ДО коду».
// classifyDisposition — ЄДИНА політика диригента: за формою StageResult →
// одна з чотирьох диспозицій ('continue' | 'halt' | 'skip' | 'fatal').
// Експортується для unit-тестів (інваріанти + regression на наявні три
// диспозиції після додавання нової 'halt').
export function classifyDisposition(result) {
  if (!result) return 'fatal';
  if (result.halt === true) return 'halt';   // свідомий стоп пайплайна стадією
  if (result.ok === true) return 'continue';
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

// ── ФАБРИКА ДИРИГЕНТА НАРІЗКИ (DI, як createActions(deps)) ───────────────────
// Не глобальний сінглтон — інстанс на виклик з ін'єктованими deps. Стан/Drive
// не імпортуються; приходять через deps. Стадії нарізки передаються через
// deps.stageOverrides[ім'я] (реальна реалізація стадії) і/або
// deps.stageFlags[ім'я]=false (вимкнути стадію — sacrificial architecture).
//
// PERSIST — ОБОВ'ЯЗКОВИЙ override: дефолтного persistStage більше немає (єдиний
// prod-шлях інжектить splitDocumentsV3). Контракт чесний: диригент нарізки без
// виконавця нарізки не існує — без persist кидаємо одразу при створенні.
export function createDocumentPipeline(deps = {}) {
  const stageOverrides = deps.stageOverrides || {};
  if (typeof stageOverrides[STAGE.PERSIST] !== 'function') {
    throw new Error(
      "persist override обов'язковий для конвеєра нарізки "
      + "(deps.stageOverrides.persist; зазвичай createSplitDocumentsV3)",
    );
  }
  const stageImpl = { ...DEFAULT_STAGE_IMPL, ...stageOverrides };
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

      if (disposition === 'halt') {
        // halt — свідомий стоп пайплайна стадією, не аварія. Сенс несе
        // decisions (Зона 3 «Питання»), не error. ctx.errors не чіпаємо,
        // ctx.documents лишається яким є (можливо порожнім). Стоп — щоб
        // наступні стадії (PERSIST/INDEX) не плодили фіктивних документів.
        ctx.stoppedAt = name;
        break;
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
  };
}
