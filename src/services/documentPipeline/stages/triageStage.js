// ── Ф2 STAGE · SMART TRIAGE (override DETECT_BOUNDARIES) ────────────────────
// Нове ЯДРО: один AI-диспетчер дивиться на ВЕСЬ змішаний вхід і будує ЄДИНИЙ
// план з .route на кожен документ. Підключається через
// deps.stageOverrides[STAGE.DETECT_BOUNDARIES] у Provider (заміна
// detectBoundariesV3 у цьому слоті). Диригент documentPipeline.js НЕ
// змінюється. detectBoundariesV3 / reconstructAcrossFiles /
// documentBoundary.detectBoundaries НЕ видаляються — стають виконавцями
// маршрутів у PERSIST (Ф3).
//
// КОНТРАКТ propose→confirm: лише ПРОПОНУЄ (ctx.reconstructionPlan + .route +
// ctx.unusedPages + decisions[]). Нічого не ріже/не пише. Реальний диспетч —
// splitDocumentsV3 ПІСЛЯ confirm (Ф3/Ф4).
//
// Маршрут вирішує AI (§2.3): жодних count-гейтів як логіки маршруту.
// Детермінована сітка — ЛИШЕ абсолютно однозначне дешеве (тривіальне 1 фото
// = 1 сторінка) як невидима пре-фільтрація, НЕ режим/кнопка. .p7s/.sig і
// ZIP уже оброблені stage unpack (INTAKE) — Triage їх не торкає.
//
// Чистий модуль: AI-транспорт (triage) ін'єктується. AI-помилка / нема
// ключа → НЕ фатально: passthrough (ingest не блокуємо, як detectBoundariesV3).

import { resolveBoundaryText } from '../pageMarkers.js';

// Текст артефакту для Triage: structural passport → posторінковий → plain.
function passportOf(item, getStreamedText, getStreamedLayout) {
  const streamed = typeof getStreamedText === 'function' ? getStreamedText(item.fileId) : '';
  const plain = (streamed || item.extractedText || item.ocrText || '').toString();
  const layout = typeof getStreamedLayout === 'function' ? getStreamedLayout(item.fileId) : null;
  return resolveBoundaryText(layout, item.pageCount || null, plain);
}

// Походження файла для контексту промпта (pdf / was-image / was-docx).
function originOf(item) {
  const m = (item.originalMime || '').toLowerCase();
  if (m.startsWith('image/')) return 'was-image';
  if (m.includes('word') || m.includes('officedocument') || m.includes('msword')) return 'was-docx';
  if (m.includes('html')) return 'was-html';
  return 'pdf';
}

// Контекст від court_sync (як detectBoundariesV3.buildUserHint — той самий
// сенс «підказка з ЄСІТС-метаданих»; локально щоб Triage не залежав від
// старої стадії).
function buildUserHint(ctx) {
  if (ctx.metadataSidecar?.source !== 'court_sync') return '';
  const ec = ctx.metadataSidecar?.ecitsContext || {};
  const bits = [];
  if (ec.caseType) bits.push(`тип справи: ${ec.caseType}`);
  if (ec.notificationType) bits.push(`тип повідомлення: ${ec.notificationType}`);
  if (ec.court) bits.push(`суд: ${ec.court}`);
  return bits.join('; ');
}

const ROUTES = new Set([
  'add_as_is', 'slice', 'image_merge', 'fragment_reconstruct',
  'signature_sidecar', 'to_fragments', 'discard',
]);

// ЛІНІЯ 2 страховки від зависання ToC-шляху. 120с — верхня межа ВСЬОГО
// preprocessor'а (детект+парс+валід), незалежно від внутрішнього retry/timeout
// callAPI. Якщо tocDetect не повернувся за цей час — приймаємо як isToc:false
// і йдемо у звичайний AI Triage. Поріг навмисно більший за TOC_API_OPTIONS у
// tocDetector (~95с×2≈3хв) — спрацьовує тільки при несподіваному зависанні
// поза callAPI (lazy import / зовнішня залежність).
const TOC_OUTER_TIMEOUT_MS = 120000;

// Тривіальний 1 файл-image 1 сторінка без сусідів → image_merge (без AI).
function trivialImagePlan(live) {
  if (live.length !== 1) return null;
  const f = live[0];
  const isImg = (f.originalMime || '').toLowerCase().startsWith('image/');
  const pc = f.pageCount == null ? 1 : f.pageCount;
  if (!isImg || pc > 1) return null;
  return {
    documents: [{
      documentId: 'd1',
      name: f.name || null,
      type: null,
      route: 'image_merge',
      fragments: [{ fileId: f.fileId, startPage: 1, endPage: 1 }],
      open: false,
    }],
    unusedPages: [],
  };
}

// ── G3 (bug 1) · plan-level dedup перекритих діапазонів ─────────────────────
// Корінь bug 1: Triage над-сегментував — той самий фізичний діапазон сторінок
// віддавався кількома документами (квитанція з 3 назвами; «Позовна заява»
// двічі). PERSIST матеріалізував кожен → дублі у реєстрі. Детерміновано
// зводимо: документи з перекритими [fileId,startPage..endPage] — це одні й ті
// самі сторінки.
//
// Анти-«тиха втрата» (явна вимога адвоката): пріоритет route — реальний
// документ > службове(to_fragments/signature) > discard. Розглядаємо за
// пріоритетом (рівні — за порядком AI), лишаємо неконфліктний; тому реальний
// документ НІКОЛИ не програє обкладинці на перекритті. Порядок виходу —
// вихідний (стабільність плану). dropped рахуємо для видимого decision (не
// мовчки).
const ROUTE_PRIORITY = {
  add_as_is: 3, slice: 3, image_merge: 3, fragment_reconstruct: 3,
  signature_sidecar: 2, to_fragments: 2, discard: 1,
};

function fragsOverlap(a, b) {
  for (const fa of a.fragments) {
    for (const fb of b.fragments) {
      if (fa.fileId === fb.fileId
        && fa.startPage <= fb.endPage && fb.startPage <= fa.endPage) return true;
    }
  }
  return false;
}

function resolveOverlaps(documents) {
  const order = documents.map((d, i) => ({ d, i }));
  const ranked = [...order].sort((x, y) =>
    ((ROUTE_PRIORITY[y.d.route] ?? 3) - (ROUTE_PRIORITY[x.d.route] ?? 3)) || (x.i - y.i));
  const kept = [];
  const droppedIdx = new Set();
  for (const node of ranked) {
    if (node.d.fragments.length === 0) { kept.push(node); continue; } // discard без діапазону — не конфлікт
    const clash = kept.some((k) => k.d.fragments.length > 0 && fragsOverlap(k.d, node.d));
    if (clash) droppedIdx.add(node.i);
    else kept.push(node);
  }
  return {
    documents: order.filter(({ i }) => !droppedIdx.has(i)).map(({ d }) => d),
    droppedCount: droppedIdx.size,
  };
}

// Нормалізувати AI-план у канонічний транзитний формат плану.
function normalizePlan(raw) {
  const docs = Array.isArray(raw?.documents) ? raw.documents : [];
  const documents = docs.map((d, i) => {
    const route = ROUTES.has(d?.route) ? d.route : 'add_as_is';
    const fragments = Array.isArray(d?.fragments)
      ? d.fragments.map((fr) => ({
          fileId: fr.fileId,
          startPage: Number(fr.startPage) || 1,
          endPage: Number(fr.endPage) || Number(fr.startPage) || 1,
        }))
      : [];
    return {
      documentId: d?.documentId || `doc_${i + 1}`,
      name: d?.name || null,
      type: d?.type || null,
      route,
      fragments,
      open: d?.open === true,
    };
  }).filter((d) => d.fragments.length > 0 || d.route === 'discard');
  const { documents: deduped, droppedCount } = resolveOverlaps(documents);
  const unusedPages = Array.isArray(raw?.unusedPages)
    ? raw.unusedPages.map((u) => ({
        fileId: u.fileId || null,
        startPage: Number(u.startPage) || 1,
        endPage: Number(u.endPage) || Number(u.startPage) || 1,
        reason: u.reason || 'не визначено тип сторінки',
      }))
    : [];
  return { documents: deduped, unusedPages, dedupDropped: droppedCount };
}

// stageDeps:
//   triage({artifacts,userHint,caseId}) → {documents,unusedPages} — AI-хід
//     Triage (Haiku, поверх toolUseRunner; ін'єкт). Обов'язковий для актив.
//   tocDetect({fileId,layoutJson,totalPages,caseId}) → {isToc,plan,reason?}
//     — ФД-T2: препроцесор реєстру/опису матеріалів (TASK ToC §3). Не нова
//     стадія (обмеження №4) — детермінований обхід AI Triage коли том має
//     готовий реєстр. Опційний; нема — пропускаємо одразу до AI Triage.
//   getStreamedText(fileId) / getStreamedLayout(fileId) — потоковий OCR
//     текст / per-page layout (executor-accessor; як detectBoundariesV3).
export function createTriageStage(stageDeps = {}) {
  const { triage, tocDetect, getStreamedText, getStreamedLayout } = stageDeps;

  return async function triageStage(ctx) {
    const live = ctx.files.filter((f) => !f.skipped);
    if (live.length === 0) return { ok: true };

    // ── Детермінована сітка (без AI, лише однозначне) ────────────────────
    const trivial = trivialImagePlan(live);
    if (trivial) {
      return {
        ok: true,
        ctx: { ...ctx, reconstructionPlan: trivial, unusedPages: trivial.unusedPages },
        decisions: [{
          type: 'document_boundaries',
          scope: 'triage',
          deterministic: true,
          documentCount: 1,
          proposals: trivial.documents,
          unusedPages: [],
          message: 'Одне зображення = один документ (детермінована сітка).',
        }],
      };
    }

    // ── ФД-T2 ToC препроцесор (тільки single-PDF великий том) ────────────
    // Реєстр/опис матеріалів — детермінований план з самого тома (адвокат/
    // канцелярія його склали). Якщо знайшли і розпарсили — обходимо AI
    // Triage. Інакше — fallback на AI Triage з збагаченим дайджестом
    // (Гілка B). Чітка умова входу: 1 файл, не image (mime не image/*),
    // pageCount ≥ 10 (нема сенсу шукати реєстр на коротких файлах — у
    // tocDetector власний пре-фільтр <10 теж, але тут економимо виклик).
    if (typeof tocDetect === 'function' && live.length === 1) {
      const f = live[0];
      const mime = (f.originalMime || '').toLowerCase();
      const isImage = mime.startsWith('image/');
      const layout = typeof getStreamedLayout === 'function' ? getStreamedLayout(f.fileId) : null;
      // pageCount беремо з layout (makeContext не пробрасує streamed.pageCount
      // у ctx.files — це інваріант диригента). Якщо layout є, його довжина і
      // є фактичним total pages для цього артефакту.
      const pageCount = (layout && Array.isArray(layout.pages)) ? layout.pages.length : (Number(f.pageCount) || 0);
      if (!isImage && pageCount >= 10 && layout) {
        let tocOut = null;
        // ЛІНІЯ 2 захисту: зовнішня страховка від зависання preprocessor'а
        // незалежно від того що відбулось всередині (callAPI / lazy import /
        // інше). Якщо tocDetect не повернувся за TOC_OUTER_TIMEOUT_MS — беремо
        // як isToc:false і йдемо у звичайний AI Triage. Верхній поріг ToC-
        // шляху гарантовано <2хв навіть при повному зависанні.
        try {
          tocOut = await Promise.race([
            tocDetect({
              fileId: f.fileId,
              layoutJson: layout,
              totalPages: pageCount,
              caseId: ctx.job.caseId,
            }),
            new Promise((resolve) => setTimeout(
              () => resolve({ isToc: false, reason: 'outer_timeout' }),
              TOC_OUTER_TIMEOUT_MS,
            )),
          ]);
        } catch (err) {
          tocOut = { isToc: false, reason: `transport:${err?.message || String(err)}` };
        }
        if (tocOut?.isToc && Array.isArray(tocOut.plan?.documents) && tocOut.plan.documents.length > 0) {
          const plan = normalizePlan(tocOut.plan);
          if (plan.documents.length > 0) {
            return {
              ok: true,
              ctx: { ...ctx, reconstructionPlan: { ...plan, source: 'toc_detector' }, unusedPages: plan.unusedPages },
              decisions: [{
                type: 'document_boundaries',
                scope: 'triage',
                deterministic: true,
                source: 'toc_detector',
                documentCount: plan.documents.length,
                proposals: plan.documents.map((d) => ({
                  documentId: d.documentId, name: d.name, type: d.type, route: d.route, fragments: d.fragments,
                })),
                unusedPages: plan.unusedPages,
                message: `Реєстр матеріалів у томі: ${plan.documents.length} документів за описом справи (AI Triage обійдено).`,
              }],
            };
          }
        }
        // tocOut.isToc:false — fallback на AI Triage нижче. reason у warnings
        // не пишемо тихо — нехай AI Triage просто продовжує своїм шляхом.
      }
    }

    // ── AI Triage ────────────────────────────────────────────────────────
    if (typeof triage !== 'function') return { ok: true };   // нема транспорту → passthrough
    const artifacts = live.map((f) => ({
      fileId: f.fileId,
      name: f.name,
      origin: originOf(f),
      pageCount: f.pageCount || null,
      passport: passportOf(f, getStreamedText, getStreamedLayout),
    }));
    let plan;
    try {
      const raw = await triage({ artifacts, userHint: buildUserHint(ctx), caseId: ctx.job.caseId });
      plan = normalizePlan(raw);
    } catch (err) {
      // НЕ фатально — пакет ingest-иться без плану (адвокат у DP-4 UI).
      return {
        ok: true,
        ctx: { ...ctx, files: ctx.files.map((f) => ({ ...f, warnings: [...(f.warnings || []), `triage: ${err?.message || err}`] })) },
      };
    }
    if (plan.documents.length === 0) return { ok: true };     // нічого не виділено → passthrough

    return {
      ok: true,
      ctx: { ...ctx, reconstructionPlan: plan, unusedPages: plan.unusedPages },
      decisions: [{
        type: 'document_boundaries',
        scope: 'triage',
        deterministic: false,
        documentCount: plan.documents.length,
        proposals: plan.documents.map((d) => ({
          documentId: d.documentId, name: d.name, type: d.type, route: d.route, fragments: d.fragments,
        })),
        unusedPages: plan.unusedPages,
        dedupDropped: plan.dedupDropped || 0,
        message: `Triage: ${live.length} файлів → ${plan.documents.length} логічних документів.`
          + (plan.dedupDropped > 0
            ? ` Зведено ${plan.dedupDropped} дублюючих пропозицій з тих самих сторінок (анти-дубль реєстру).`
            : '')
          + ' Підтвердьте план обробки перед нарізкою.',
      }],
    };
  };
}
