// ── TASK 4 (rework) · ADD FILES — окремий самодостатній сценарій «просто додати» ─
// «Просто додати документи» — ОКРЕМИЙ процес, ОКРЕМИЙ код, ОКРЕМА труба. НІЯК
// не зав'язаний на Document Processor (нарізку/склейку). Інша труба, інший кран.
//
// Минула сесія (TASK 4 етапи A-E) помилково протягнула «просто додати» через
// інфраструктуру нарізки (`ingest.js`-фасад + `runAddAsIs` усередині
// DocumentPipelineContext + вшите стиснення Stage E). Власник скасував той
// підхід. Цей модуль — чистий переспів РОБОЧОГО сценарію додавання як
// самостійного сервісу, яким користуються І модалка «+ Додати документ», І
// DP у режимі просто-додати (дефолт; тумблер «Нарізати / склеїти» OFF).
//
// ── ОДИН КОД — КОЖЕН ФАЙЛ СВОЇМ ШЛЯХОМ ──────────────────────────────────────
// Будь-яка кількість файлів (≥1), будь-яка комбінація (текстовий PDF +
// сканований PDF + HTML + DOCX + зображення) обробляються ОДНИМ циклом. Не
// окремий сценарій на тип. «Кожен файл своїм шляхом» виходить САМО — бо кроки
// труби РОЗУМНІ і самі маршрутизують за типом, керовані ДАНИМИ:
//   • convertToPdf — фасад converterService: PDF→як є, HTML/DOCX/зображення→PDF;
//   • стиснення — ОПЦІЙНИЙ ін'єктований крок (deps.compressFile + опція
//     compress). Застосовується до ФІНАЛЬНОГО PDF ПЕРЕД заливкою — після
//     convert, тож зображення (вже як PDF) теж стискаються; рушій сам пропускає
//     текстові/searchable PDF. Ядро addFiles НЕ імпортує компресор (DI);
//   • OCR — НЕ тут (пост-крок консюмера; `ocrMode:'none'` = «без OCR» —
//     розпізнавання взагалі не запускається, артефактів у 02 немає, лише
//     базові метадані + файл у 01_ОРИГІНАЛИ).
// Жодних доменних `if (зображення) … else if (скан)` гілок у цьому файлі —
// розгалуження живе ВСЕРЕДИНІ спільних кроків.
//
// ── ЧИСТА ФАБРИКА DI (як createActions / createDocumentPipeline) ─────────────
// Нуль глобальних сінглтонів, нуль прямих імпортів стану/Drive. Усі сайд-ефекти
// (convertToPdf / uploadFile / createDocument / persistDocument / eventBus /
// getActor) ін'єктуються через deps. Стан React, Drive, audit/billing/
// permissions лишаються у шарі, що ними володіє (App.jsx → executeAction).
//
// ── SAAS / MULTI-USER / BILLING ─────────────────────────────────────────────
// tenant-agnostic: tenantId/userId беруться з deps.getActor() і кладуться у
// payload подій (SaaS-готовність). Жодної модифікації даних повз executeAction —
// персистенція тільки через ін'єктований persistDocument (там висить audit +
// billing + permissions). Конвертація інструментується в converterService
// (одна точка), не дублюється тут.

import { inferNatureFromFile, defaultNatureForUI } from '../detectDocumentNature.js';

// Режими OCR на ДОДАВАННІ (один сенс на значення, правило #11):
//   'full' — ДЕФОЛТ: повне розпізнавання (Document AI для скан/зображень;
//            текстовий шар на вимогу для searchable/конвертованих). Пост-крок
//            консюмера; addFiles його НЕ робить, лише прокидає прапор у результат.
//   'none' — «без OCR»: опція швидкого додавання. Розпізнавання НЕ запускається
//            взагалі, артефактів у 02_ОБРОБЛЕНІ немає; файл лежить у
//            01_ОРИГІНАЛИ з базовими метаданими і видимий у в'ювері.
export const OCR_MODE = Object.freeze({ FULL: 'full', NONE: 'none' });
export const DEFAULT_OCR_MODE = OCR_MODE.FULL;

// defaultAddFilesMetadata — дефолтний білдер канонічних метаданих (DP-шлях, де
// немає форми на кожен файл). Назва = ім'я файлу без розширення; класифікація
// (category/author/procId/date) лишається null → маркер «потребує перегляду» у
// списку (адвокат інлайн-править назву в DP; повну форму дає модалка для одного
// файлу). Модалка передає власний buildDocumentMetadata (поля форми) і цей
// дефолт не вживає.
export function defaultAddFilesMetadata({ item, driveId, originalDriveId, uploadedFile, conversion, job }) {
  const converterType = conversion?.converter || item.converterType || null;
  const isTextExtractedConvert = converterType === 'docxToPdf' || converterType === 'htmlToPdf';
  const fileForInfer = uploadedFile
    || (item.raw ? { type: item.raw.type, name: item.raw.name } : { type: item.type, name: item.name });
  const nature = isTextExtractedConvert
    ? 'searchable'
    : (inferNatureFromFile({ mimeType: fileForInfer.type, originalName: fileForInfer.name })
        || defaultNatureForUI({ mimeType: fileForInfer.type, originalName: fileForInfer.name })
        || 'searchable');
  const base = (item.name || 'Документ').replace(/\.[^.]+$/, '');
  return {
    name: base,
    category: null,
    author: null,
    procId: null,
    date: null,
    isKey: false,
    driveId: driveId || null,
    driveUrl: driveId ? `https://drive.google.com/file/d/${driveId}/view` : null,
    size: uploadedFile?.size || item.size || 0,
    originalName: item.name || null,
    originalDriveId: originalDriveId || null,
    originalMime: conversion?.originalMime ?? item.originalMime ?? null,
    folder: '01_ОРИГІНАЛИ',
    addedBy: job?.addedBy || 'user',
    namingStatus: 'auto',
    documentNature: nature,
    // source — канал ПОХОДЖЕННЯ (правило addedBy↔source): успадковуємо з job.
    source: job?.source || 'manual',
  };
}

// normalizeFile — привести вхідний дескриптор файлу до однакової форми (дефолти).
function normalizeFile(f, i) {
  return {
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
    converterType: f.converterType || null,
    warnings: [],
  };
}

// addOneFile — повна послідовність ДЛЯ ОДНОГО файлу: convert → upload(01) →
// createDocument → persist. Повертає багатий per-file результат (driveId,
// conversion, extractedText, mergeLayoutJson, uploadedFile, document), щоб
// консюмер міг зробити пост-крок OCR (повний OCR при ocrMode='full') і показати
// помилки. Не кидає — усі провали повертаються як { ok:false, error }.
async function addOneFile(item, ctx, deps) {
  const { caseId, caseData, conversionContext, job, compress } = ctx;
  const warnings = [...(item.warnings || [])];

  let uploadedFile = null;
  let conversion = null;
  let extractedText = null;
  let mergeLayoutJson = null;
  let originalMime = item.originalMime || null;
  let driveId = item.driveId || null;
  let originalDriveId = item.originalDriveId || null;

  // 1. CONVERT — фасад converterService сам маршрутизує за типом. Passthrough
  //    коли файл уже на Drive (пікер: driveId відомий, конвертації не робимо).
  if (item.isDriveSource && item.driveId) {
    // passthrough — нічого не конвертуємо, driveId уже є.
  } else if (item.raw) {
    try {
      conversion = await deps.convertToPdf(item.raw, conversionContext || {});
    } catch (err) {
      return {
        fileId: item.fileId, ok: false, warnings,
        error: { code: 'CONVERT_FAILED', message: err?.message || 'Помилка конвертації' },
      };
    }
    // converterService повертає завжди PDF при успіху; passthrough може бути PDF
    // або невідомий тип — лишаємо як є (Drive iframe покаже preview).
    const isPdfBlob = conversion.converter !== 'passthrough'
      || conversion.originalMime === 'application/pdf';
    uploadedFile = isPdfBlob
      ? new File([conversion.pdfBlob], `${conversion.pdfName}.pdf`, { type: 'application/pdf' })
      : item.raw;
    originalMime = conversion.originalMime;
    extractedText = conversion.extractedText || null;
    if (Array.isArray(conversion.warnings)) warnings.push(...conversion.warnings);
  }
  // else: ні raw, ні driveId — метадані-only документ (нічого не конвертуємо).

  // Готові артефакти зі склейки зображень: OCR уже виконано на КОЖНОМУ
  // оригіналі — текст/layout беремо з merge, повторний OCR заборонено. Сам
  // merged-PDF проходить як звичайний PDF (passthrough+upload вище).
  if (item.mergeArtifacts) {
    extractedText = item.mergeArtifacts.extractedText || null;
    mergeLayoutJson = item.mergeArtifacts.layoutJson || null;
  }

  // 1b. СТИСНЕННЯ (опція) — на ФІНАЛЬНОМУ PDF ПЕРЕД заливкою. Рушій
  //     ін'єктований (deps.compressFile), сам має scanned-guard: сканований /
  //     зображення-PDF → downscale; текстовий / searchable PDF → pass-through.
  //     Зображення стискаються САМЕ тут (після convert image→PDF, тож HEIC уже
  //     JPEG). Drive-source (uploadedFile нема, лише driveId) не чіпаємо —
  //     віддалений файл не тягнемо. Best-effort: збій → нестиснений файл.
  if (compress && uploadedFile && typeof deps.compressFile === 'function') {
    try {
      uploadedFile = await deps.compressFile(uploadedFile);
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[addFiles] compress best-effort failed:', e?.message || e);
    }
  }

  // 2. UPLOAD у 01_ОРИГІНАЛИ (Drive-source уже має driveId — пропускаємо).
  if (!driveId && uploadedFile) {
    try {
      driveId = await deps.uploadFile(uploadedFile, caseData);
    } catch (err) {
      return {
        fileId: item.fileId, ok: false, warnings,
        error: { code: 'UPLOAD_FAILED', message: err?.message || 'Помилка завантаження на Drive' },
      };
    }
  }

  // Оригінал поряд (DOCX → PDF: зберігаємо .docx як originalDriveId). Не
  // критично: PDF уже на Drive, документ створиться без originalDriveId.
  if (!originalDriveId && conversion?.originalBlob) {
    try {
      const origName = item.name || conversion.originalName || 'original';
      const origFile = new File(
        [conversion.originalBlob],
        origName,
        { type: originalMime || item.type || 'application/octet-stream' },
      );
      originalDriveId = await deps.uploadFile(origFile, caseData);
    } catch {
      warnings.push('ORIGINAL_UPLOAD_FAILED');
    }
  }

  // 3. МЕТАДАНІ + createDocument. buildDocumentMetadata ін'єктується (модалка —
  //    форма; DP — defaultAddFilesMetadata). createDocument — єдина фабрика.
  const builder = typeof deps.buildDocumentMetadata === 'function'
    ? deps.buildDocumentMetadata
    : defaultAddFilesMetadata;
  const metadata = builder({ item, driveId, originalDriveId, uploadedFile, conversion, job });
  const document = deps.createDocument(metadata);

  // 4. PERSIST — тільки через ін'єктований persistDocument (executeAction →
  //    audit/billing/permissions). Провал — не валить інші файли в пачці.
  let persistRes;
  try {
    persistRes = await deps.persistDocument({ caseId, document });
  } catch (err) {
    return {
      fileId: item.fileId, ok: false, warnings,
      error: { code: 'PERSIST_FAILED', message: err?.message || 'add_document failed' },
    };
  }
  if (!persistRes?.success) {
    return {
      fileId: item.fileId, ok: false, warnings,
      error: { code: 'PERSIST_FAILED', message: persistRes?.error || 'add_document failed' },
    };
  }

  return {
    fileId: item.fileId,
    ok: true,
    document,
    driveId,
    originalDriveId,
    conversion,
    extractedText,
    mergeLayoutJson,
    uploadedFile,
    originalMime,
    warnings,
  };
}

// createAddFiles — фабрика сервісу.
//   addFiles(input, options) → Promise<result>
//     input   — { caseId, caseData, files:[…], agentId?, source?, addedBy?,
//                 module?, operation?, conversionContext?, jobId? }
//     options — { ocrMode?, buildDocumentMetadata?, updateCaseContext?, onProgress? }
//   result    — { ok, documents:[…], files:[per-file…], errors:[…], jobId, ocrMode }
//     ok      — true якщо створено ХОЧА Б ОДИН документ (batch-стійкість:
//               один файл провалився — решта додається; для одного файлу
//               ok:false = той файл не додано).
export function createAddFiles(deps = {}) {
  if (typeof deps.convertToPdf !== 'function') throw new Error('createAddFiles: convertToPdf обовʼязковий');
  if (typeof deps.uploadFile !== 'function') throw new Error('createAddFiles: uploadFile обовʼязковий');
  if (typeof deps.createDocument !== 'function') throw new Error('createAddFiles: createDocument обовʼязковий');
  if (typeof deps.persistDocument !== 'function') throw new Error('createAddFiles: persistDocument обовʼязковий');

  function emitIngested(job, fileResult) {
    if (!deps.eventBus || !deps.topics?.DOCUMENT_INGESTED) return;
    const actor = (typeof deps.getActor === 'function' && deps.getActor()) || {};
    const payload = {
      caseId: job.caseId,
      documentId: fileResult.document.id,
      source: fileResult.document.source,
      tenantId: actor.tenantId ?? null,
      userId: actor.userId ?? null,
      jobId: job.jobId,
      timestamp: new Date().toISOString(),
    };
    try { deps.eventBus.publish(deps.topics.DOCUMENT_INGESTED, payload); } catch { /* publish ізольований */ }
  }

  function emitBatch(job, documents, updateCaseContext) {
    if (!deps.eventBus || !deps.topics?.DOCUMENT_BATCH_PROCESSED || documents.length === 0) return;
    const actor = (typeof deps.getActor === 'function' && deps.getActor()) || {};
    const payload = {
      caseId: job.caseId,
      jobId: job.jobId,
      documentIds: documents.map((d) => d.id),
      count: documents.length,
      tenantId: actor.tenantId ?? null,
      userId: actor.userId ?? null,
      // Рішення адвоката (DP-тумблер «Оновити case_context.md»). CaseDossier
      // слухає і регенерує нарис лише коли true. Дефолт false (manual add не чіпає).
      updateCaseContext: updateCaseContext === true,
      timestamp: new Date().toISOString(),
    };
    try { deps.eventBus.publish(deps.topics.DOCUMENT_BATCH_PROCESSED, payload); } catch { /* ізольовано */ }
  }

  async function addFiles(input = {}, options = {}) {
    const files = Array.isArray(input.files) ? input.files : [];
    const ocrMode = options.ocrMode || DEFAULT_OCR_MODE;

    if (!input.caseId) {
      return { ok: false, documents: [], files: [], errors: [{ code: 'NO_CASE', message: "caseId обовʼязковий" }], jobId: null, ocrMode };
    }
    if (files.length === 0) {
      return { ok: false, documents: [], files: [], errors: [{ code: 'NO_FILES', message: 'Немає файлів для обробки' }], jobId: null, ocrMode };
    }

    const job = {
      jobId: input.jobId || `addjob_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      caseId: input.caseId,
      caseData: input.caseData || null,
      agentId: input.agentId || 'dossier_agent',
      source: input.source || 'manual',
      addedBy: input.addedBy || 'user',
      module: input.module || null,
      operation: input.operation || 'add_document',
      conversionContext: input.conversionContext || null,
      startedAt: new Date().toISOString(),
    };

    const ctx = {
      caseId: job.caseId,
      caseData: job.caseData,
      conversionContext: job.conversionContext,
      job,
      compress: options.compress === true,
    };

    const results = [];
    const documents = [];
    const errors = [];
    const total = files.length;

    // pass-down доменної евристики метаданих (модалка): через deps для addOneFile.
    const fileDeps = { ...deps, buildDocumentMetadata: options.buildDocumentMetadata || deps.buildDocumentMetadata };

    for (let i = 0; i < files.length; i++) {
      const item = normalizeFile(files[i], i);
      if (typeof options.onProgress === 'function') {
        try { options.onProgress({ stage: 'add', fileId: item.fileId, index: i, total }); } catch { /* прогрес ізольований */ }
      }
      const r = await addOneFile(item, ctx, fileDeps);
      results.push(r);
      if (r.ok && r.document) {
        documents.push(r.document);
        emitIngested(job, r);
      } else if (r.error) {
        errors.push({ ...r.error, fileId: r.fileId });
      }
    }

    emitBatch(job, documents, options.updateCaseContext);

    return {
      ok: documents.length > 0,
      documents,
      files: results,
      errors,
      jobId: job.jobId,
      ocrMode,
    };
  }

  return { addFiles };
}
