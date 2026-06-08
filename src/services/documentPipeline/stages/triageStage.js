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

// 1C.2 — skipPdfSlicingPlan: тумблер «Просто додати файли» — per-file
// маршрутизація БЕЗ виклику AI Triage. Кожен живий файл = окремий
// документ; image/* → image_merge solo (одна сторінка = один документ),
// решта → add_as_is solo (без нарізки). Працює і у міксі PDF+фото — інакше
// AI Triage поріже PDF попри toggle, що суперечить наміру тумблера.
// НЕ вимикає OCR/.txt/метадані/класифікацію (це інші стадії extract/persist).
function skipPdfSlicingPlan(live) {
  if (!Array.isArray(live) || live.length === 0) return null;
  return {
    documents: live.map((f, i) => {
      const isImg = (f.originalMime || '').toLowerCase().startsWith('image/');
      return {
        documentId: `d${i + 1}`,
        name: f.name || null,
        type: null,
        route: isImg ? 'image_merge' : 'add_as_is',
        fragments: [{
          fileId: f.fileId,
          startPage: 1,
          endPage: f.pageCount == null ? 1 : f.pageCount,
        }],
        open: false,
      };
    }),
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

// DEGENERATE_MIN_PAGES — той самий поріг, що RICH_PASSPORT_MAX_PAGES_DEFAULT
// у pageMarkers.js (правило #11: одна цифра — один сенс «межа якості
// Haiku вікна»). Якщо буде змінено там — синхронно змінити тут (reminder
// у tests/unit/triageStage.test.js на симетрію порогів).
const DEGENERATE_MIN_PAGES = 70;

// DEGENERATE_ELIGIBLE_ROUTES — маршрути, де AI мав знайти/підтвердити
// межі. Для image_merge / fragment_reconstruct / signature_sidecar /
// to_fragments / discard «1 doc × 100%» — дизайн route, не провал.
const DEGENERATE_ELIGIBLE_ROUTES = new Set(['add_as_is', 'slice']);

// isDegeneratePlan — план виглядає як passthrough НА ВЕЛИКОМУ ТОМІ ДЕ
// AI МАВ ШУКАТИ МЕЖІ: рівно один документ маршруту add_as_is/slice,
// фрагменти якого покривають 100% сторінок усіх живих файлів, при
// сумарному обсязі ≥DEGENERATE_MIN_PAGES. Окрема від normalizePlan, бо
// normalize працює над raw AI-відповіддю (форма), а ця — над уже
// нормалізованим планом і живим набором файлів (семантика покриття +
// контекст обсягу + контекст маршруту).
export function isDegeneratePlan(plan, liveFiles) {
  if (!plan || !Array.isArray(plan.documents) || plan.documents.length !== 1) return false;
  const doc = plan.documents[0];
  if (!doc || !DEGENERATE_ELIGIBLE_ROUTES.has(doc.route)) return false;
  if (!Array.isArray(doc.fragments) || doc.fragments.length === 0) return false;
  if (!Array.isArray(liveFiles) || liveFiles.length === 0) return false;
  const totalPages = liveFiles.reduce((s, f) => s + (f.pageCount || 1), 0);
  if (totalPages < DEGENERATE_MIN_PAGES) return false;
  const byFile = new Map();
  for (const fr of doc.fragments) {
    const prev = byFile.get(fr.fileId) || [];
    prev.push([fr.startPage, fr.endPage]);
    byFile.set(fr.fileId, prev);
  }
  if (byFile.size !== liveFiles.length) return false;
  for (const f of liveFiles) {
    const ranges = byFile.get(f.fileId);
    if (!ranges) return false;
    const pc = f.pageCount || 1;
    const covered = new Set();
    for (const [s, e] of ranges) {
      for (let p = s; p <= e; p++) covered.add(p);
    }
    if (covered.size < pc) return false;
  }
  return true;
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
//   getStreamedText(fileId) / getStreamedLayout(fileId) — потоковий OCR
//     текст / per-page layout (executor-accessor; як detectBoundariesV3).
//   skipPdfSlicing? boolean — DP-4 тумблер «Просто додати файли»: ON →
//     детермінований план add_as_is per file для не-image наборів (1C.2).
export function createTriageStage(stageDeps = {}) {
  const { triage, getStreamedText, getStreamedLayout } = stageDeps;
  const skipPdfSlicing = stageDeps.skipPdfSlicing === true;

  return async function triageStage(ctx) {
    const live = ctx.files.filter((f) => !f.skipped);
    if (live.length === 0) return { ok: true };

    // ── Детермінована сітка (без AI, лише однозначне) ────────────────────
    // Порядок:
    //   1. skipPdfSlicing toggle (per-file, override) — найвищий пріоритет;
    //      адвокат явно сказав «не різати», AI Triage не викликаємо взагалі.
    //   2. trivialImagePlan (1 фото, legacy single-image passthrough) — 1
    //      image_merge документ без AI.
    //   3. AI Triage (мікс / pure-PDF з toggle OFF).
    // Cheap-before-Expensive (§4.1 візії DP): дороге AI-рішення про межі —
    // лише коли детермінований намір неоднозначний.
    //
    // 1B image_merge_unify — ВИДАЛЕНО allImagesRoute (мертвий код): DP тепер
    // перехоплює all-image вхід ДО pipeline.run у DocumentProcessorV2.start
    // Processing (детермінований вибір сценарію на ВХОДІ, повз PDF-OCR
    // streamingExecutor — це і був корінь падіння «No PDF header found» для
    // фото). N-документна склейка живе на рівні DP-компонента: prepareImages
    // ForMerge + imageDocumentGrouper + per-group rebuild. allImagesRoute
    // (1 image_merge документ з N фрагментами для 1B grouper) став
    // недосяжний — видалено. trivialImagePlan лишається як fallback на випадок
    // якщо хтось викличе pipeline з одним зображенням поза DP (наразі тільки
    // ecitsInboxWatcher → run потенційно може; behavior-preserve).
    if (skipPdfSlicing) {
      const skipPlan = skipPdfSlicingPlan(live);
      if (skipPlan) {
        return {
          ok: true,
          ctx: { ...ctx, reconstructionPlan: skipPlan, unusedPages: skipPlan.unusedPages },
          decisions: [{
            type: 'document_boundaries',
            scope: 'triage',
            deterministic: true,
            documentCount: skipPlan.documents.length,
            proposals: skipPlan.documents,
            unusedPages: [],
            message: `«Просто додати файли»: ${skipPlan.documents.length} файл(ів) → ${skipPlan.documents.length} окремих документів, AI-нарізку пропущено.`,
          }],
        };
      }
    }

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

    // ── AI Triage ────────────────────────────────────────────────────────
    if (typeof triage !== 'function') {
      // DIAG (empty-02 розслідування): нема транспорту → passthrough → fallback
      // persist (гілка B splitDocumentsV3) → артефакти 02 НЕ пишуться.
      return { ok: true, decisions: [{ type: 'triage_skipped', scope: 'triage', message: 'Triage-транспорт відсутній — пакет без плану (fallback persist, 02 не пишеться).' }] };
    }
    const artifacts = live.map((f) => ({
      fileId: f.fileId,
      name: f.name,
      origin: originOf(f),
      pageCount: f.pageCount || null,
      passport: passportOf(f, getStreamedText, getStreamedLayout),
    }));
    // DIAG: скільки артефактів прийшло у триаж з ПОРОЖНІМ паспортом (сигнал що
    // streamed-текст не доїхав по-файлово для мульти-файлу).
    const emptyPassports = artifacts.filter((a) => !((a.passport || '').toString().trim())).length;
    let plan;
    try {
      const raw = await triage({ artifacts, userHint: buildUserHint(ctx), caseId: ctx.job.caseId });
      plan = normalizePlan(raw);
    } catch (err) {
      // НЕ фатально — пакет ingest-иться без плану (адвокат у DP-4 UI).
      return {
        ok: true,
        ctx: { ...ctx, files: ctx.files.map((f) => ({ ...f, warnings: [...(f.warnings || []), `triage: ${err?.message || err}`] })) },
        // DIAG: триаж кинув → без плану → fallback persist → 02 не пишеться.
        decisions: [{ type: 'triage_error', scope: 'triage', message: `Triage не дав плану (помилка): ${err?.message || err}`, meta: { artifactsCount: artifacts.length, emptyPassports } }],
      };
    }
    if (plan.documents.length === 0) {
      // DIAG: триаж повернув 0 документів → без плану → fallback persist → 02 не пишеться.
      return { ok: true, decisions: [{ type: 'triage_empty', scope: 'triage', message: 'Triage повернув 0 документів — пакет без плану (fallback persist, 02 не пишеться).', meta: { artifactsCount: artifacts.length, totalPages: artifacts.reduce((s, a) => s + (a.pageCount || 0), 0), emptyPassports } }] };
    }

    if (isDegeneratePlan(plan, live)) {
      // Свідомий стоп пайплайна: AI не зміг розрізнити межі, повертає тома
      // одним шматком. Це не помилка стейджу і не виняток API (для нього є
      // catch вище) — це визнання, що автоматичної відповіді немає, потрібна
      // ручна дія. Тому НЕ ok:false+error, а halt+decision: сенс несе
      // decision у Зоні 3 «Питання» через ATTENTION_TYPES. Диригент бачить
      // halt:true → break без запису у ctx.errors.
      return {
        halt: true,
        decisions: [{
          type: 'triage_whole_volume',
          scope: 'triage',
          message: 'Не вдалось визначити межі документів — том пропонується '
                 + 'як один шматок. Потрібна ручна нарізка або повторний '
                 + 'прогін меншими частинами.',
          meta: {
            liveFileCount: live.length,
            totalPages: live.reduce((s, f) => s + (f.pageCount || 1), 0),
          },
        }],
      };
    }

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
