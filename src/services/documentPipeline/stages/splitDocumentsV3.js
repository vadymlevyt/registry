// ── DP-3 STAGE · SPLIT DOCUMENTS V3 (+ saveFragments + dataset) ─────────────
// Підключається через deps.stageOverrides[STAGE.PERSIST] у streaming-шляху.
// Диригент НЕ змінюється. Це РЕАЛЬНИЙ split після confirm + персистенція +
// дві sub-стадії (saveFragments, datasetCollector) ВСЕРЕДИНІ persist —
// дозволено §8 (нові стадії як sub-стадії існуючих, бо диригент заморожений
// на 9). Один сенс persist у DP-3: «матеріалізувати підтверджений план у
// канонічні документи + зберегти все що не документ окремо».
//
// Контракт стадії DP-1 збережено дослівно: {ok, ctx, decisions?, error?};
// UPLOAD_FAILED → file_skipped, помилка фіксації → fatal (як persistStage).
// Персистенція ВИКЛЮЧНО через ін'єктований persistDocument → executeAction
// (audit/billing/permissions висять там; нічого повз шар).
//
// Гілки (один сенс на ім'я, правило #11):
//   A. є confirmed reconstructionPlan → нарізаємо фрагменти у Worker,
//      склеюємо мультифайлові документи, кожен → 01_ОРИГІНАЛИ + canonical
//      запис + 02_ОБРОБЛЕНІ текст/layout.
//   B. нема плану → fallback: персист як один документ (behavior-preserving
//      шлях для не-склейки; той самий контракт що дефолтний persistStage).
//   Потім завжди: saveFragments(unusedPages) + datasetCollector(gated).

import { categoryFromBoundaryType } from './classifyV2.js';

// Категорія документа з плану реконструкції. План несе `type` (груба рубрика
// нарізки від AI); `category` лишається null доки немає окремої класифікації.
// Раніше splitDocumentsV3 читав ЛИШЕ doc.category → усі нарізані документи
// зберігались з category=null (маркер ⚠). Виводимо канонічну category з type
// (та сама мапа що classifyV2) — класифікація реконструкції не губиться (#11).
function resolveCategory(doc) {
  if (doc?.category) return doc.category;
  if (doc?.type) return categoryFromBoundaryType(doc.type);
  return null;
}

// Bug 6 (DP-4 bugfix) — евристична перевірка дублікатів БЕЗ хеша/schema-bump
// (рішення адвоката: metadata-евристика, не контент-хеш). Реальний канал:
// «адвокат завантажив той самий PDF двічі → два однакові записи». Збіг назви
// в межах справи (+ підтвердження pageCount/розміром коли відомі) → точний
// дублікат, повторно НЕ додаємо (автозаміна = наявний лишається). Лише назва
// збіглась, решта різна → новий варіант: додаємо + decision у «Потребує
// уваги» (інтерактивне «замінити/новий варіант» — DP-6).
function findDuplicate(caseData, name, pageCount, size) {
  const docs = Array.isArray(caseData?.documents) ? caseData.documents : [];
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\.pdf$/i, '');
  const sameName = docs.filter((d) => norm(d.name) === norm(name));
  if (sameName.length === 0) return null;
  const exact = sameName.find((d) => {
    if (d.pageCount != null && pageCount != null) return d.pageCount === pageCount;
    const a = d.size || 0;
    const b = size || 0;
    if (a > 0 && b > 0) return Math.abs(a - b) / Math.max(a, b) <= 0.05;
    return true;                       // лише назва відома — той самий документ
  });
  return { kind: exact ? 'exact' : 'variant', existing: exact || sameName[0] };
}

function defaultBuildMetadata({ item, driveId, originalDriveId, job, name, pageCount }) {
  return {
    ...(item.metadataTemplate || {}),
    name: name || item.name,
    pageCount: pageCount ?? item.pageCount ?? null,
    driveId: driveId || null,
    driveUrl: driveId ? `https://drive.google.com/file/d/${driveId}/view` : null,
    originalDriveId: originalDriveId || null,
    originalMime: item.originalMime ?? item.metadataTemplate?.originalMime ?? null,
    size: item.size || 0,
    folder: '01_ОРИГІНАЛИ',
    addedBy: job.addedBy || 'system',
    source: job.source || 'manual',
  };
}

// stageDeps:
//   runInWorker(op,payload,transfer?) — workerClient (splitPdf/mergePdf)
//   drivePort — readBytes/uploadBytes/getOrCreateFolder/listFolder/readText/deleteFile
//   uploadFile(file, caseData) → driveId — фінальні документи у 01_ОРИГІНАЛИ
//                                          (той самий seam що DP-1 persist)
//   createDocument(meta) → doc          — documentFactory (canonical)
//   buildDocumentMetadata?(...) → meta  — DI-seam класифікації (як DP-1)
//   persistDocument({caseId,document}) → {success,error?} — executeAction
//   writeText02?({caseData,driveId,name,text,format}) — ocrService artifact
//   writeLayout02?({caseData,driveId,name,layoutJson})
//   eventBus?, topics? — DOCUMENT_FRAGMENT_SAVED publish
//   datasetCollector? — { collect({caseId,jobId,plan,files,thumbnailSources}) }
//   fragmentsMode?: 'separate' | 'combined' (дефолт 'separate')
export function createSplitDocumentsV3(stageDeps = {}) {
  const {
    runInWorker, drivePort, uploadFile, createDocument, persistDocument,
  } = stageDeps;
  const buildMeta = typeof stageDeps.buildDocumentMetadata === 'function'
    ? stageDeps.buildDocumentMetadata : null;
  const fragmentsMode = stageDeps.fragmentsMode === 'combined' ? 'combined' : 'separate';

  // Витягнути байти джерела файла (у streaming уже на Drive: item.driveId).
  async function sourceBytes(item) {
    if (item._bytesCache) return item._bytesCache;
    if (item.driveId && drivePort?.readBytes) {
      return drivePort.readBytes(item.driveId);
    }
    if (item.uploadedFile && typeof item.uploadedFile.arrayBuffer === 'function') {
      return item.uploadedFile.arrayBuffer();
    }
    if (item.raw?._bytes) return item.raw._bytes.buffer || item.raw._bytes;
    if (item.raw && typeof item.raw.arrayBuffer === 'function') return item.raw.arrayBuffer();
    return null;
  }

  // Зібрати PDF логічного документа з його фрагментів (1 файл — splitPdf;
  // N файлів — splitPdf кожен + mergePdf). Повертає Uint8Array або null.
  async function buildDocumentPdf(doc, byFile) {
    const parts = [];
    for (const frag of doc.fragments) {
      const buf = byFile.get(frag.fileId);
      if (!buf) continue;
      const { parts: cut } = await runInWorker('splitPdf', {
        buffer: buf,
        ranges: [{ name: doc.documentId, type: doc.type || 'document', startPage: frag.startPage, endPage: frag.endPage }],
      });
      if (cut && cut[0]) parts.push(cut[0].buffer);
    }
    if (parts.length === 0) return null;
    if (parts.length === 1) return new Uint8Array(parts[0]);
    const { buffer } = await runInWorker('mergePdf', { buffers: parts });
    return new Uint8Array(buffer);
  }

  return async function splitDocumentsV3(ctx) {
    const live = ctx.files.filter((f) => !f.skipped && !f.document);
    const plan = ctx.reconstructionPlan;
    const decisions = [];
    const newDocuments = [];

    // ── A. Plan-based split ───────────────────────────────────────────────
    if (plan && plan.confirmed && Array.isArray(plan.documents) && plan.documents.length > 0) {
      // Байти кожного джерела один раз (RAM: по одному, звільняємо після).
      const byFile = new Map();
      for (const f of live) {
        const b = await sourceBytes(f);
        if (b) byFile.set(f.fileId, b instanceof Uint8Array ? (b.buffer || b) : b);
      }
      for (const doc of plan.documents) {
        let pdfBytes;
        try {
          pdfBytes = await buildDocumentPdf(doc, byFile);
        } catch (err) {
          return { ok: false, error: { code: 'SPLIT_FAILED', message: `Нарізка "${doc.name || doc.documentId}": ${err?.message || err}`, fatal: true } };
        }
        if (!pdfBytes) {
          decisions.push({ type: 'document_split_skipped', documentId: doc.documentId, message: `Документ "${doc.name || doc.documentId}" — немає байтів фрагментів` });
          continue;
        }
        const docName = `${doc.name || doc.documentId}.pdf`;
        const slicePageCount = (doc.fragments || []).reduce(
          (s, fr) => s + (fr.endPage != null && fr.startPage != null ? (fr.endPage - fr.startPage + 1) : 0), 0,
        ) || null;
        const sliceSize = pdfBytes.byteLength || pdfBytes.length || 0;

        // Bug 6 — дублікат перед upload (не марнуємо Drive на повторний файл).
        const dup = findDuplicate(ctx.job.caseData, docName, slicePageCount, sliceSize);
        if (dup?.kind === 'exact') {
          decisions.push({ type: 'duplicate_skipped', documentName: docName, message: `Документ "${docName}" уже є у справі — повторне додавання пропущено (точний дублікат).` });
          continue;
        }
        if (dup?.kind === 'variant') {
          decisions.push({ type: 'duplicate_review', documentName: docName, message: `Документ "${docName}" схожий на наявний у справі — додано як новий варіант, перевірте.` });
        }

        let driveId;
        try {
          const file = makeFileLike(docName, pdfBytes);
          driveId = await uploadFile(file, ctx.job.caseData);
        } catch (err) {
          return { ok: false, error: { code: 'UPLOAD_FAILED', message: err?.message || 'upload документа', file_skipped: true } };
        }
        const srcItem = live.find((f) => f.fileId === doc.fragments[0]?.fileId) || live[0] || {};
        // План документа несе type/name — виводимо канонічну category з type
        // (resolveCategory) і вливаємо у metadataTemplate ОДНАКОВО для обох
        // шляхів (buildMeta DI-seam і дефолтний шаблон), інакше класифікація
        // реконструкції губиться (правило #11: один сенс).
        const planCategory = resolveCategory(doc);
        const planItem = {
          ...srcItem,
          name: docName,
          pageCount: slicePageCount,
          metadataTemplate: {
            ...(srcItem.metadataTemplate || {}),
            ...(planCategory ? { category: planCategory } : {}),
          },
        };
        const meta = buildMeta
          ? buildMeta({ item: planItem, driveId, originalDriveId: null, job: ctx.job })
          : defaultBuildMetadata({ item: planItem, driveId, originalDriveId: null, job: ctx.job, name: docName, pageCount: slicePageCount });
        const document = createDocument(meta);
        const res = await persistDocument({ caseId: ctx.job.caseId, document });
        if (!res?.success) {
          return { ok: false, error: { code: 'PERSIST_FAILED', message: res?.error || 'add_document failed', fatal: true } };
        }
        // 02_ОБРОБЛЕНІ — текст/layout (з фрагментних джерел; 80%-precise,
        // page-precise slicing — DP-4, зафіксовано у звіті).
        await writeProcessedArtifacts(stageDeps, ctx, document, doc, live);
        newDocuments.push(document);
      }
    } else {
      // ── B. Fallback persist (behavior-preserving, без плану) ─────────────
      // Bug 7 — у streaming-шляху item.driveId вказує на РОБОЧУ КОПІЮ у
      // _temp/<job>/, яку streamingExecutor видаляє у clearState після успіху
      // → v'юер отримував HTTP 404. Фінальний документ ЗАВЖДИ має лежати у
      // 01_ОРИГІНАЛИ (персистентно), як гілка A. Тому матеріалізуємо байти
      // джерела і завантажуємо через uploadFile (той самий seam що гілка A),
      // НЕ переюзовуємо тимчасовий driveId.
      for (const item of live) {
        let bytes = null;
        try {
          const b = await sourceBytes(item);
          if (b) bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
        } catch { /* джерело недоступне — нижче UPLOAD_FAILED */ }
        if (item.uploadedFile && !bytes) {
          try { bytes = new Uint8Array(await item.uploadedFile.arrayBuffer()); }
          catch { /* fallback нижче */ }
        }
        if (!bytes) {
          return { ok: false, error: { code: 'UPLOAD_FAILED', message: 'Немає байтів джерела для збереження у 01_ОРИГІНАЛИ', file_skipped: true, fileId: item.fileId } };
        }
        const docName = item.name || `${item.fileId}.pdf`;

        // Bug 6 — дублікат перед upload.
        const dup = findDuplicate(ctx.job.caseData, docName, item.pageCount || null, bytes.byteLength);
        if (dup?.kind === 'exact') {
          decisions.push({ type: 'duplicate_skipped', documentName: docName, message: `Документ "${docName}" уже є у справі — повторне додавання пропущено (точний дублікат).` });
          continue;
        }
        if (dup?.kind === 'variant') {
          decisions.push({ type: 'duplicate_review', documentName: docName, message: `Документ "${docName}" схожий на наявний у справі — додано як новий варіант, перевірте.` });
        }

        let driveId;
        try {
          driveId = await uploadFile(makeFileLike(docName, bytes), ctx.job.caseData);
        } catch (err) {
          return { ok: false, error: { code: 'UPLOAD_FAILED', message: err?.message || 'upload', file_skipped: true, fileId: item.fileId } };
        }
        const meta = buildMeta
          ? buildMeta({ item, driveId, originalDriveId: item.originalDriveId || null, job: ctx.job })
          : defaultBuildMetadata({ item, driveId, originalDriveId: item.originalDriveId || null, job: ctx.job });
        const document = createDocument(meta);
        const res = await persistDocument({ caseId: ctx.job.caseId, document });
        if (!res?.success) {
          return { ok: false, error: { code: 'PERSIST_FAILED', message: res?.error || 'add_document failed', fatal: true, fileId: item.fileId } };
        }
        newDocuments.push(document);
      }
    }

    // ── saveFragments (sub-стадія): невикористані сторінки → 03_ФРАГМЕНТИ ──
    const fragDecisions = await saveFragments(stageDeps, ctx, fragmentsMode);
    decisions.push(...fragDecisions);

    // ── datasetCollector (sub-стадія, gated toggle) ──────────────────────
    if (stageDeps.datasetCollector && plan) {
      try {
        const thumbnailSources = {};
        const r = await stageDeps.datasetCollector.collect({
          caseId: ctx.job.caseId, jobId: ctx.job.jobId, plan,
          files: live, thumbnailSources,
        });
        if (r?.written) decisions.push({ type: 'dataset_collected', exampleCount: r.exampleCount });
      } catch { /* датасет — побічна користь, не критичний */ }
    }

    const persistedFiles = ctx.files.map((f) => (f.skipped ? f : { ...f, document: f.document || newDocuments[0] }));
    return {
      ok: true,
      ctx: { ...ctx, files: persistedFiles, documents: [...ctx.documents, ...newDocuments] },
      ...(decisions.length > 0 ? { decisions } : {}),
    };
  };
}

// Зберегти невикористані сторінки у 03_ФРАГМЕНТИ/<date>_<jobId>/ +
// fragments_log.json + зведений лог + подія DOCUMENT_FRAGMENT_SAVED.
// Дефолт DP-3: зберігати ВСЕ автоматично (втратити юридично значущу
// сторінку гірше ніж зберегти зайве). UI вибору — DP-4.
async function saveFragments(stageDeps, ctx, fragmentsMode) {
  const unused = Array.isArray(ctx.unusedPages) ? ctx.unusedPages : [];
  if (unused.length === 0) return [];
  const drivePort = stageDeps.drivePort;
  const fragRootId = ctx.job.caseData?.storage?.subFolders?.['03_ФРАГМЕНТИ'];
  if (!drivePort || !fragRootId) {
    return [{ type: 'fragments_unsaved', count: unused.length, message: 'Немає папки 03_ФРАГМЕНТИ — фрагменти не збережено' }];
  }
  const live = ctx.files.filter((f) => !f.skipped);
  const byFile = new Map();
  for (const f of live) {
    try {
      const b = f.driveId && drivePort.readBytes ? await drivePort.readBytes(f.driveId)
        : (f.uploadedFile?.arrayBuffer ? await f.uploadedFile.arrayBuffer() : null);
      if (b) byFile.set(f.fileId, b);
    } catch { /* джерело недоступне — пропускаємо цей фрагмент */ }
  }
  const dateStr = new Date().toISOString().slice(0, 10);
  const jobFolder = await drivePort.getOrCreateFolder(`${dateStr}_${ctx.job.jobId}`, fragRootId);
  const log = [];
  const saved = [];
  let idx = 1;
  const combinedBuffers = [];
  for (const u of unused) {
    const src = byFile.get(u.fileId);
    if (!src) { log.push({ ...u, saved: false, reason: u.reason + ' (джерело недоступне)' }); continue; }
    let part;
    try {
      const { parts } = await stageDeps.runInWorker('splitPdf', {
        buffer: src instanceof Uint8Array ? (src.buffer || src) : src,
        ranges: [{ name: `fragment_${idx}`, type: 'fragment', startPage: u.startPage, endPage: u.endPage || u.startPage }],
      });
      part = parts && parts[0];
    } catch (e) {
      log.push({ ...u, saved: false, reason: `${u.reason} (нарізка не вдалась: ${e?.message || e})` });
      continue;
    }
    if (!part) { log.push({ ...u, saved: false }); continue; }
    if (fragmentsMode === 'combined') {
      combinedBuffers.push(part.buffer);
      log.push({ ...u, fragmentIndex: idx, saved: true });
    } else {
      const name = `fragment_${String(idx).padStart(3, '0')}.pdf`;
      try {
        const up = await drivePort.uploadBytes(jobFolder.id, name, new Uint8Array(part.buffer), 'application/pdf');
        saved.push({ name, driveId: up.id, ...u });
        log.push({ file: name, fileId: u.fileId, startPage: u.startPage, endPage: u.endPage, reason: u.reason, driveId: up.id, saved: true });
        publishFragment(stageDeps, ctx, { name, driveId: up.id, reason: u.reason });
      } catch (e) {
        log.push({ ...u, saved: false, reason: `${u.reason} (upload: ${e?.message || e})` });
      }
    }
    idx++;
  }
  if (fragmentsMode === 'combined' && combinedBuffers.length > 0) {
    try {
      const { buffer } = await stageDeps.runInWorker('mergePdf', { buffers: combinedBuffers });
      const up = await drivePort.uploadBytes(jobFolder.id, 'fragments_combined.pdf', new Uint8Array(buffer), 'application/pdf');
      saved.push({ name: 'fragments_combined.pdf', driveId: up.id });
      publishFragment(stageDeps, ctx, { name: 'fragments_combined.pdf', driveId: up.id, reason: 'combined' });
    } catch { /* combined не критичний */ }
  }
  try {
    await drivePort.uploadText(jobFolder.id, 'fragments_log.json', JSON.stringify({ jobId: ctx.job.jobId, caseId: ctx.job.caseId, generatedAt: new Date().toISOString(), fragments: log }), 'application/json');
    await updateAggregateFragmentsLog(drivePort, fragRootId, ctx, log);
  } catch { /* лог не критичний для ingest */ }
  return [{ type: 'fragments_saved', count: saved.length, total: unused.length, jobFolder: `${dateStr}_${ctx.job.jobId}` }];
}

async function updateAggregateFragmentsLog(drivePort, fragRootId, ctx, entries) {
  try {
    const files = (await drivePort.listFolder(fragRootId)) || [];
    const prev = files.find((f) => f.name === 'fragments_log.json');
    let agg = { schemaVersion: 1, jobs: [] };
    if (prev) { try { agg = JSON.parse(await drivePort.readText(prev.id)); } catch { /* битий */ } }
    if (!Array.isArray(agg.jobs)) agg.jobs = [];
    agg.jobs.push({ jobId: ctx.job.jobId, at: new Date().toISOString(), count: entries.filter((e) => e.saved).length });
    await drivePort.uploadText(fragRootId, 'fragments_log.json', JSON.stringify(agg), 'application/json');
    if (prev) { try { await drivePort.deleteFile?.(prev.id); } catch { /* noop */ } }
  } catch { /* зведений лог — побічна користь */ }
}

function publishFragment(stageDeps, ctx, frag) {
  if (!stageDeps.eventBus || !stageDeps.topics?.DOCUMENT_FRAGMENT_SAVED) return;
  try {
    stageDeps.eventBus.publish(stageDeps.topics.DOCUMENT_FRAGMENT_SAVED, {
      caseId: ctx.job.caseId, jobId: ctx.job.jobId,
      fragmentName: frag.name, driveId: frag.driveId, reason: frag.reason,
      tenantId: ctx.job.tenantId ?? null, timestamp: new Date().toISOString(),
    });
  } catch { /* publish ізольований */ }
}

async function writeProcessedArtifacts(stageDeps, ctx, document, planDoc, live) {
  const src = live.find((f) => f.fileId === planDoc.fragments?.[0]?.fileId);
  const text = src?.processedText || src?.extractedText || null;
  if (text && typeof stageDeps.writeText02 === 'function') {
    try {
      await stageDeps.writeText02({
        caseData: ctx.job.caseData, driveId: document.driveId,
        name: document.name, text, format: src?.textFormat || 'txt',
      });
    } catch { /* кеш тексту не критичний */ }
  }
  const layout = src?.layoutJson || null;
  if (layout && typeof stageDeps.writeLayout02 === 'function') {
    try {
      await stageDeps.writeLayout02({ caseData: ctx.job.caseData, driveId: document.driveId, name: document.name, layoutJson: layout });
    } catch { /* layout кеш не критичний */ }
  }
}

function makeFileLike(name, bytes) {
  if (typeof File !== 'undefined') {
    try { return new File([bytes], name, { type: 'application/pdf' }); } catch { /* fallthrough */ }
  }
  return {
    name, type: 'application/pdf', size: bytes.byteLength || bytes.length || 0,
    _bytes: bytes, arrayBuffer: async () => (bytes.buffer || bytes),
  };
}
