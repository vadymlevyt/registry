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
        let driveId;
        try {
          const file = makeFileLike(docName, pdfBytes);
          driveId = await uploadFile(file, ctx.job.caseData);
        } catch (err) {
          return { ok: false, error: { code: 'UPLOAD_FAILED', message: err?.message || 'upload документа', file_skipped: true } };
        }
        const srcItem = live.find((f) => f.fileId === doc.fragments[0]?.fileId) || live[0] || {};
        // План документа несе category/name — вливаємо у metadataTemplate
        // ОДНАКОВО для обох шляхів (buildMeta DI-seam і дефолтний шаблон),
        // інакше класифікація реконструкції губиться (правило #11: один сенс).
        const planItem = {
          ...srcItem,
          name: docName,
          metadataTemplate: {
            ...(srcItem.metadataTemplate || {}),
            ...(doc.category ? { category: doc.category } : {}),
          },
        };
        const meta = buildMeta
          ? buildMeta({ item: planItem, driveId, originalDriveId: null, job: ctx.job })
          : defaultBuildMetadata({ item: planItem, driveId, originalDriveId: null, job: ctx.job, name: docName });
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
      for (const item of live) {
        let driveId = item.driveId || null;
        if (!driveId && item.uploadedFile) {
          try { driveId = await uploadFile(item.uploadedFile, ctx.job.caseData); }
          catch (err) { return { ok: false, error: { code: 'UPLOAD_FAILED', message: err?.message || 'upload', file_skipped: true, fileId: item.fileId } }; }
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
