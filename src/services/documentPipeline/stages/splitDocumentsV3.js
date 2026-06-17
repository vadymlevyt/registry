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

import { categoryFromBoundaryType } from './boundaryCategory.js';
import { isPagedLayout } from '../pageMarkers.js';

// G4 — маршрути що НЕ йдуть через buildDocumentPdf (обробляються окремими
// гілками диспетчу до нарізки): пре-нарізка джерела їх не включає.
const BUILD_PDF_ROUTES_SKIP = new Set([
  'discard', 'signature_sidecar', 'to_fragments', 'image_merge',
]);

// F2 — запобіжник проти агресивності різника. Великий суцільний блок, який AI
// позначив to_fragments, майже завжди реальний контент (додатки/приложення до
// акта чи протоколу, нерозпізнані сторінки), а не службовий аркуш. Поріг: блок
// з ≤ TO_FRAGMENTS_MAX_PAGES сторінок лишається фрагментом (обкладинка/порожня/
// роздільник); більший — зберігаємо окремим документом із позначкою уваги
// (рішення адвоката: краще зайвий документ, ніж втрачена юридично значуща
// сторінка). Один сенс (правило #11): «максимум сторінок, що ще може бути
// справді службовим аркушем».
const TO_FRAGMENTS_MAX_PAGES = 3;

function sumFragmentPages(doc) {
  return (doc?.fragments || []).reduce(
    (s, fr) => s + (fr.endPage != null && fr.startPage != null ? (fr.endPage - fr.startPage + 1) : 0),
    0,
  );
}

// Категорія документа з плану реконструкції. План несе `type` (груба рубрика
// нарізки від AI); `category` лишається null доки немає окремої класифікації.
// Раніше splitDocumentsV3 читав ЛИШЕ doc.category → усі нарізані документи
// зберігались з category=null (маркер ⚠). Виводимо канонічну category з type
// (мапа boundaryCategory.js) — класифікація реконструкції не губиться (#11).
function resolveCategory(doc) {
  if (doc?.category) return doc.category;
  if (doc?.type) return categoryFromBoundaryType(doc.type);
  return null;
}

// B2 (20.05.2026) — documentNature нарізаного документа з джерела.
// Один сенс (правило #11): "якщо джерело потребувало OCR (має непорожній
// layoutJson.pages) — це 'scanned'; інакше — let detectNature вирішує
// (повертаємо null, createDocument викличе detectNature)".
//
// Корінь bug: DocumentViewer показує перемикач Скан/Текст лише коли
// documentNature==='scanned' (DocumentViewerFooter:22). Раніше нарізані з
// 65-стор. скана отримували 'searchable' через detectNature(.pdf) →
// перемикач зникав, текст з OCR недоступний для копіювання.
//
// Пріоритети:
//   1. metadataTemplate.documentNature — явне (convert-стадія DOCX/HTML).
//   2. layoutJson.pages з реальним вмістом — OCR відбувся → 'scanned'.
//   3. null → fallback на detectNature у createDocument.
function inferDocumentNatureFromSource(srcItem) {
  const explicit = srcItem?.metadataTemplate?.documentNature;
  if (explicit === 'scanned' || explicit === 'searchable') return explicit;
  const layout = srcItem?.layoutJson;
  if (layout && Array.isArray(layout.pages) && layout.pages.length > 0) {
    return 'scanned';
  }
  return null;
}

// Bug 6 (DP-4 bugfix) — евристична перевірка дублікатів БЕЗ хеша/schema-bump
// (рішення адвоката: metadata-евристика, не контент-хеш). Реальний канал:
// «адвокат завантажив той самий PDF двічі → два однакові записи». Збіг назви
// в межах справи (+ підтвердження pageCount/розміром коли відомі) → точний
// дублікат, повторно НЕ додаємо (автозаміна = наявний лишається). Лише назва
// збіглась, решта різна → новий варіант: додаємо + decision у «Потребує
// уваги» (інтерактивне «замінити/новий варіант» — DP-6).
// G3 (bug 1) — приймає СПИСОК документів (не caseData-знімок). Корінь bug 1:
// читався лише ctx.job.caseData (заморожений на старті job) → документи,
// збережені РАНІШЕ в цьому ж job, були невидимі, дедуп їх не ловив. Caller
// передає об'єднання знімок-реєстру ∪ вже-збережені-в-цьому-job.
function findDuplicate(docs, name, pageCount, size) {
  if (!Array.isArray(docs) || docs.length === 0) return null;
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

  // ── G4 (bug 3) · нарізати джерело ОДИН раз з усіма діапазонами ───────────
  // Корінь 46 хв: buildDocumentPdf слав ПОВНИЙ буфер джерела у splitPdf
  // ОКРЕМО на кожен документ → pdf-lib re-parse 21МБ ~25-30 разів (домінантний
  // кост). splitPdf парсить буфер ОДИН раз для N діапазонів (splitPdf.js:26).
  // Тому ріжемо кожен файл-джерело ОДИН раз з діапазонами ВСІХ його
  // документів; результат по-діапазонно БІТ-У-БІТ той самий (та сама
  // load/copyPages/save) — поведінка збережена, лише без N-1 re-parse.
  // key = `${planIdx}#${fragIdx}` (planIdx 1-based, унікальний на ітерацію
  // циклу персисту — без колізій навіть при дублі documentId від AI).
  async function precutSources(planDocuments, byFile) {
    const rangesByFile = new Map();
    let di = 0;
    for (const doc of planDocuments) {
      di += 1;                                   // інкремент для КОЖНОГО (як planIdx)
      const route = doc.route || 'add_as_is';
      if (BUILD_PDF_ROUTES_SKIP.has(route)) continue;
      (doc.fragments || []).forEach((fr, fi) => {
        if (!byFile.has(fr.fileId)) return;
        if (!rangesByFile.has(fr.fileId)) rangesByFile.set(fr.fileId, []);
        rangesByFile.get(fr.fileId).push({
          name: `${di}#${fi}`,
          type: doc.type || 'document',
          startPage: fr.startPage,
          endPage: fr.endPage,
        });
      });
    }
    const cutByKey = new Map();
    for (const [fileId, ranges] of rangesByFile) {
      const { parts } = await runInWorker('splitPdf', { buffer: byFile.get(fileId), ranges });
      for (const p of parts || []) cutByKey.set(p.name, p.buffer);
    }
    return cutByKey;
  }

  // Зібрати PDF логічного документа з пре-нарізаних частин (G4). 1 частина —
  // як є; N (multi-fragment / fragment_reconstruct по файлах) — mergePdf.
  // Відсутній ключ (range out-of-bounds → splitPdf пропустив) → фрагмент
  // пропускається (та сама поведінка що стара gілка `if (!cut[0]) continue`).
  async function buildDocumentPdf(doc, planIdx, cutByKey) {
    const parts = [];
    (doc.fragments || []).forEach((fr, fi) => {
      const buf = cutByKey.get(`${planIdx}#${fi}`);
      if (buf) parts.push(buf);
    });
    if (parts.length === 0) return null;
    if (parts.length === 1) return new Uint8Array(parts[0]);
    const { buffer } = await runInWorker('mergePdf', { buffers: parts });
    return new Uint8Array(buffer);
  }

  return async function splitDocumentsV3(ctx, deps) {
    // bug 6: під-прогрес PERSIST (тиха 30+-хв зона після OCR). Ін'єктований
    // executor'ом через диригент (deps 2-й арг); відсутній → no-op (тести/
    // не-streaming behavior-preserving). Один сенс: «який документ зараз».
    const reportSub = (done, total) => {
      if (typeof deps?.onSubProgress === 'function') {
        try { deps.onSubProgress({ done, total, label: 'Документ' }); } catch { /* ізольовано */ }
      }
    };
    const live = ctx.files.filter((f) => !f.skipped && !f.document);
    const plan = ctx.reconstructionPlan;
    const decisions = [];
    const newDocuments = [];
    // G3 (bug 1): дедуп бачить знімок-реєстр ∪ вже-збережені-в-ЦЬОМУ-job
    // (newDocuments росте по ходу). Раніше — лише заморожений знімок →
    // повтори в межах одного job не ловились.
    const registryView = () => [
      ...(Array.isArray(ctx.job.caseData?.documents) ? ctx.job.caseData.documents : []),
      ...newDocuments,
    ];
    // route to_fragments → ці сторінки йдуть у 03_ФРАГМЕНТИ (saveFragments),
    // НЕ канонічні документи (об'єднуються з ctx.unusedPages нижче).
    const routedToFragments = [];
    // F1: байти джерел, прочитані гілкою A (із них різались документи), стають
    // доступні saveFragments — щоб той НЕ перечитував джерело з _temp удруге.
    // Корінь бага: повторний read у saveFragments падав (404 → catch →
    // "джерело недоступне") → фрагменти логувались, але PDF не зберігались.
    // Один read, два споживачі (нарізка документів + збереження фрагментів).
    const sourceByFile = new Map();

    // ── A. Plan-based split ───────────────────────────────────────────────
    if (plan && plan.confirmed && Array.isArray(plan.documents) && plan.documents.length > 0) {
      // Байти кожного джерела один раз (RAM: по одному, звільняємо після).
      for (const f of live) {
        const b = await sourceBytes(f);
        if (b) sourceByFile.set(f.fileId, b instanceof Uint8Array ? (b.buffer || b) : b);
      }
      // F2 guard: великі to_fragments-блоки переводимо в документи ДО нарізки
      // (інакше precutSources їх пропустить через BUILD_PDF_ROUTES_SKIP і
      // буде нічого різати). Дрібні службові (≤ порога) лишаються фрагментами.
      for (const doc of plan.documents) {
        if ((doc.route || 'add_as_is') !== 'to_fragments') continue;
        const pages = sumFragmentPages(doc);
        if (pages > TO_FRAGMENTS_MAX_PAGES) {
          doc._serviceBlockKept = pages;          // позначка для decision у циклі
          doc.route = 'add_as_is';                // далі будується як звичайний документ
          doc.type = doc.type || 'other';
          if (!doc.name || !String(doc.name).trim()) doc.name = `Службовий блок ${pages} стор. (перевірте)`;
        }
      }
      // G4: нарізати кожне джерело ОДИН раз (усі діапазони всіх документів),
      // замість повного re-parse 21МБ на кожен документ (корінь 46 хв).
      const cutByKey = await precutSources(plan.documents, sourceByFile);
      const planTotal = plan.documents.length;
      let planIdx = 0;
      for (const doc of plan.documents) {
        reportSub(++planIdx, planTotal);            // bug 6: «Документ i з N»
        // ── Ф3 диспетч за .route (один сенс на маршрут, правило #11) ───────
        const route = doc.route || 'add_as_is';
        const label = doc.name || doc.documentId;

        // F2: великий блок, який різник позначив службовим, врятовано у документ
        // (див. pre-pass вище) — додаємо картку «перевірте» у «Потребує уваги».
        if (doc._serviceBlockKept) {
          decisions.push({
            type: 'service_block_kept',
            documentName: doc.name,
            pages: doc._serviceBlockKept,
            message: `"${label}" — різник позначив службовим (${doc._serviceBlockKept} стор.), але блок завеликий для фрагмента: збережено окремим документом, перевірте вміст.`,
          });
        }

        if (route === 'discard') {
          decisions.push({ type: 'document_discarded', documentId: doc.documentId, documentName: label, message: `"${label}" відкинуто за маршрутом Triage (discard) — на Drive нічого.` });
          continue;
        }
        if (route === 'signature_sidecar') {
          decisions.push({ type: 'signature_sidecar_skipped', documentId: doc.documentId, message: `"${label}" — підпис/сертифікат, оброблено на розпакуванні (sidecar), окремий документ не створюється.` });
          continue;
        }
        if (route === 'to_fragments') {
          for (const fr of doc.fragments || []) {
            routedToFragments.push({ fileId: fr.fileId, startPage: fr.startPage, endPage: fr.endPage, reason: `службова сторінка (route to_fragments: ${label})` });
          }
          decisions.push({ type: 'routed_to_fragments', documentId: doc.documentId, count: (doc.fragments || []).length, message: `"${label}" → 03_ФРАГМЕНТИ (route to_fragments), не канонічний документ.` });
          continue;
        }

        let pdfBytes;
        if (route === 'image_merge') {
          if (typeof stageDeps.mergeImagesToPdf !== 'function') {
            decisions.push({ type: 'image_merge_unavailable', documentId: doc.documentId, message: `"${label}" — image_merge виконавець не підключено, документ пропущено.` });
            continue;
          }
          const images = [];
          for (const fr of doc.fragments || []) {
            const src = live.find((f) => f.fileId === fr.fileId);
            const raw = sourceByFile.get(fr.fileId);
            if (!src || !raw) continue;
            images.push({ bytes: raw, mime: src.originalMime || 'image/jpeg', name: src.name || fr.fileId });
          }
          try {
            pdfBytes = await stageDeps.mergeImagesToPdf({ images, docName: label });
          } catch (err) {
            // B3 (20.05.2026) — НЕ fatal. Кривий байт-документ (HEIC що
            // canvas не декодує, corrupted bytes, тощо) має бути ЛОКАЛЬНОЮ
            // помилкою конкретного документа, а не вбивати весь job.
            // Раніше {fatal:true} → жоден з N документів не зберігався.
            // Реальний кейс: «Копія паспорту громадянина» в наборі з 25
            // документів адвоката валив pipeline на 25-му за чергою.
            decisions.push({
              type: 'image_merge_failed',
              documentId: doc.documentId,
              documentName: label,
              message: `image_merge "${label}": ${err?.message || err}`,
            });
            continue;
          }
        } else {
          // add_as_is | slice | fragment_reconstruct | (невідомий → як є):
          // межі вже від Triage (рішення адвоката Ф3 — без 2-го AI-виклику).
          try {
            pdfBytes = await buildDocumentPdf(doc, planIdx, cutByKey);
          } catch (err) {
            return { ok: false, error: { code: 'SPLIT_FAILED', message: `Нарізка "${label}": ${err?.message || err}`, fatal: true } };
          }
        }
        if (!pdfBytes) {
          decisions.push({ type: 'document_split_skipped', documentId: doc.documentId, message: `Документ "${label}" — немає байтів фрагментів` });
          continue;
        }
        const docName = `${doc.name || doc.documentId}.pdf`;
        const slicePageCount = (doc.fragments || []).reduce(
          (s, fr) => s + (fr.endPage != null && fr.startPage != null ? (fr.endPage - fr.startPage + 1) : 0), 0,
        ) || null;
        const sliceSize = pdfBytes.byteLength || pdfBytes.length || 0;

        // Bug 6 — дублікат перед upload (не марнуємо Drive на повторний файл).
        const dup = findDuplicate(registryView(), docName, slicePageCount, sliceSize);
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
        // B2 — documentNature нарізаного документа з джерела (див.
        // inferDocumentNatureFromSource вище). Перемикач Скан/Текст у
        // DocumentViewer вмикається лише за 'scanned'; нарізані з 65-стор.
        // скана раніше падали у 'searchable' (дефолт detectNature .pdf).
        const planNature = inferDocumentNatureFromSource(srcItem);
        const planItem = {
          ...srcItem,
          name: docName,
          pageCount: slicePageCount,
          metadataTemplate: {
            ...(srcItem.metadataTemplate || {}),
            ...(planCategory ? { category: planCategory } : {}),
            ...(planNature ? { documentNature: planNature } : {}),
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
        await writeProcessedArtifacts(stageDeps, ctx, document, doc, live, decisions);
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
      let fbIdx = 0;
      for (const item of live) {
        reportSub(++fbIdx, live.length);            // bug 6: під-прогрес fallback
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
        const dup = findDuplicate(registryView(), docName, item.pageCount || null, bytes.byteLength);
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

    // ── DP більше НЕ чистить текст (V2-A2, parent §DP БІЛЬШЕ НЕ ЧИСТИТЬ) ──────
    // Пост-крок очистки (3.1 cleanFinalizedDocument) ПРИБРАНО повністю: Точний
    // рахується на льоту з layout (V2-A1), Чистий/Конспект на весь том = години
    // (недоречно як авто-крок), масовий AI — гейт на сервер. Очистка стала
    // справою в'ювера/ACTION clean_document_text (по одному документу, на вимогу).
    // DP лишає сирий .txt (де нема layout) і .layout — джерела для очистки потім.

    // ── saveFragments (sub-стадія): невикористані сторінки → 03_ФРАГМЕНТИ ──
    // route to_fragments додає свої сторінки до unusedPages плану (один потік
    // збереження фрагментів — не дублюємо логіку, правило #11).
    const ctxFrag = routedToFragments.length > 0
      ? { ...ctx, unusedPages: [...(Array.isArray(ctx.unusedPages) ? ctx.unusedPages : []), ...routedToFragments] }
      : ctx;
    const fragDecisions = await saveFragments(stageDeps, ctxFrag, fragmentsMode, sourceByFile);
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
async function saveFragments(stageDeps, ctx, fragmentsMode, providedBytes = null) {
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
    // F1: спершу беремо байти, вже прочитані гілкою A persist (із них різались
    // документи) — це усуває повторний read з _temp, який падав 404 →
    // "джерело недоступне". Re-read лишається лише як fallback (шлях без плану /
    // тести), коли байти не передані.
    const pre = providedBytes && providedBytes.get(f.fileId);
    if (pre) { byFile.set(f.fileId, pre); continue; }
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

// ── G1 (bug 2) · page-precise зріз тексту/layout документа ──────────────────
// Корінь bug 2: writeProcessedArtifacts писав src.processedText (текст УСЬОГО
// 65-стор. файла) у КОЖЕН зрізаний документ → адвокат бачив у TXT змішаний
// текст усіх документів. PDF ріжеться правильно (buildDocumentPdf за
// startPage/endPage), а текст не ріжеться взагалі.
//
// Виправлення детерміноване, без AI: documentAi виставляє per-page `_text`
// (chunk-safe — pageMarkers.js / documentAi.js), streamingExecutor конкатить
// per-chunk pageStructure у layoutJson.pages у порядку сторінок. Беремо
// pages[startPage-1 .. endPage-1]._text по КОЖНОМУ фрагменту документа
// (multi-fragment: slice з пропусками / fragment_reconstruct по файлах) і
// зрізаємо паралельний layout так само — артефакти 02_ОБРОБЛЕНІ тепер
// відповідають САМЕ цьому документу.
//
// Гейт isPagedLayout(layout, pageCount): якщо посторінкова розмітка неповна
// (resume / chunk-misalign) — НЕ ріжемо тихо хибно: пишемо цілий текст
// джерела + decision у «Потребує уваги» (юрсистема: краще видимий warning
// ніж мовчазно неправильний текст).
//
// Чистка для читання (cleanForReading → processedText = Haiku-MD без меж
// сторінок) свідомо НЕ застосовується до зрізаних: для slice беремо сирий
// per-page _text. Інтеграція чистки з нарізкою — окреме рішення адвоката
// (Варіант 1/2/3), відкладено доки сирий slicing не підтверджено на справі.
function sliceProcessedArtifacts(planDoc, live) {
  const textParts = [];
  const layoutPages = [];
  let usedFallback = false;
  let anyPaged = false;
  for (const fr of planDoc.fragments || []) {
    const src = live.find((f) => f.fileId === fr.fileId);
    if (!src) continue;
    const layout = src.layoutJson || null;
    const pc = src.pageCount
      ?? (Array.isArray(layout?.pages) ? layout.pages.length : null);
    if (isPagedLayout(layout, pc)) {
      anyPaged = true;
      const s = Math.max(1, Number(fr.startPage) || 1);
      const e = Math.min(layout.pages.length, Number(fr.endPage) || s);
      for (let p = s; p <= e; p++) {
        const page = layout.pages[p - 1];
        textParts.push((page && page._text) || '');
        if (page) layoutPages.push(page);
      }
    } else {
      // Неповний layout — цілий текст джерела (видимо позначаємо).
      const whole = src.processedText || src.extractedText || '';
      if (whole) { textParts.push(String(whole)); usedFallback = true; }
    }
  }
  const text = textParts.join('\n\n').trim() || null;
  const layoutJson = layoutPages.length > 0 ? { schemaVersion: 1, pages: layoutPages } : null;
  return { text, layoutJson, usedFallback, anyPaged };
}

// 1C.3 — `.txt` у 02_ОБРОБЛЕНІ потрібен ТІЛЬКИ для сканів (де нема тексту в
// файлі). text-layer PDF самодостатній — `.txt` ми НЕ пишемо. Але warning
// `text_slice_fallback` раніше спрацьовував для будь-якого `usedFallback`,
// а для whole-file add_as_is з text-layer PDF (1 фрагмент, ціла сторінкова
// покривка) це не «slice failed», просто нема per-page layout — і не повинно
// бути. Warning лишаємо тільки для реального slicing (multi-fragment або
// частковий діапазон), де відсутність per-page layout справді ризик.
function isWholeFileAddAsIs(planDoc, live) {
  if (!planDoc || planDoc.route !== 'add_as_is') return false;
  const frs = Array.isArray(planDoc.fragments) ? planDoc.fragments : [];
  if (frs.length !== 1) return false;
  const fr = frs[0];
  const src = live.find((f) => f.fileId === fr.fileId);
  if (!src) return false;
  const pc = src.pageCount == null ? 1 : src.pageCount;
  const s = Number(fr.startPage) || 1;
  const e = Number(fr.endPage) || s;
  return s === 1 && e >= pc;
}

async function writeProcessedArtifacts(stageDeps, ctx, document, planDoc, live, decisions) {
  const { text, layoutJson, usedFallback } = sliceProcessedArtifacts(planDoc, live);
  // V2-A2 (parent §ДОЛЯ .txt): `.txt` пишемо ⇔ layout ВІДСУТНІЙ. Коли layout є
  // (Document AI / фото-склейка), він містить page._text — `.txt` зайвий
  // (getDocumentText/getCleanOrRawText читають вірний текст із layout). Лишаємо
  // `.txt` лише там де layout нема (pdfjsLocal малі скани / fallback цілим файлом).
  const hasLayout = !!(layoutJson && Array.isArray(layoutJson.pages) && layoutJson.pages.length > 0);
  if (text && !hasLayout && typeof stageDeps.writeText02 === 'function') {
    try {
      await stageDeps.writeText02({
        caseData: ctx.job.caseData, driveId: document.driveId,
        name: document.name, text, format: 'txt',
      });
    } catch { /* кеш тексту не критичний */ }
  }
  if (layoutJson && typeof stageDeps.writeLayout02 === 'function') {
    try {
      await stageDeps.writeLayout02({ caseData: ctx.job.caseData, driveId: document.driveId, name: document.name, layoutJson });
    } catch { /* layout кеш не критичний */ }
  }
  // 1C.3 — для whole-file add_as_is warning не пишемо: це не slice fallback,
  // це text-layer / DOCX-конвертований PDF без per-page layout (нормально).
  if (usedFallback && !isWholeFileAddAsIs(planDoc, live) && Array.isArray(decisions)) {
    decisions.push({
      type: 'text_slice_fallback',
      documentName: document.name,
      message: `Текст "${document.name}" збережено цілим файлом — посторінкова розмітка неповна (можливо resume після збою). Перевірте 02_ОБРОБЛЕНІ.`,
    });
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
