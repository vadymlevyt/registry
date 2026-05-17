// ── DP-2 STAGE · CLASSIFY (базова реалізація) ───────────────────────────────
// Підключається через deps.stageOverrides[STAGE.CLASSIFY]. Диригент НЕ
// змінюється. Визначає type/author/category документа через AI (Sonnet за
// замовчуванням через ін'єктований класифікатор поверх toolUseRunner).
//
// propose→confirm збережено: висока впевненість → пише метадані одразу
// (item.metadataTemplate, далі persist/createDocument їх підхопить); низька →
// додає decisions[] для адвоката, нічого не перезаписує.
//
// Gated: passthrough коли метадані вже задані людиною (модалка — адвокат сам
// обрав category/author) і не запитано переклас — поведінка DP-1 не регресує.
// Запускається коли category відсутня/невідома або stageDeps.shouldClassify
// це дозволяє (ЄСІТС-канал, де метадані ніхто руками не вводив).
//
// ecitsContext (ctx.metadataSidecar.source === 'court_sync') — підказка:
// менше токенів (контекст уже є) і вища впевненість.

// Канонічні enum документа — src/schemas/documentSchema.js.
const CATEGORY_ENUM = new Set([
  'pleading', 'motion', 'court_act', 'evidence', 'contract',
  'correspondence', 'identification', 'other',
]);
const AUTHOR_ENUM = new Set(['ours', 'opponent', 'court', 'third_party']);

// Словник type документа з documentBoundary/prompt.js → canonical category.
// Один сенс на ім'я: boundary 'type' — груба рубрика нарізки; document
// 'category' — канонічна класифікація. Мапа явна, не «і те й те».
const BOUNDARY_TYPE_TO_CATEGORY = {
  court_cover: 'other',
  pleading: 'pleading',
  court_act: 'court_act',
  evidence: 'evidence',
  certificate: 'identification',
  contract: 'contract',
  other: 'other',
};

export function categoryFromBoundaryType(type) {
  return BOUNDARY_TYPE_TO_CATEGORY[type] || 'other';
}

function normalizeCategory(v) {
  return CATEGORY_ENUM.has(v) ? v : null;
}
function normalizeAuthor(v) {
  return AUTHOR_ENUM.has(v) ? v : null;
}

// Чи метадані вже визначені людиною (модалка): обидва критичні поля задані.
function isHumanClassified(item) {
  const t = item.metadataTemplate || {};
  return CATEGORY_ENUM.has(t.category) && AUTHOR_ENUM.has(t.author);
}

function defaultShouldClassify(item, ctx) {
  if (ctx?.metadataSidecar?.source === 'court_sync') return true;  // ЄСІТС — класифікуємо
  return !isHumanClassified(item);                                 // інакше лише якщо людина не задала
}

const HIGH = 'high';
function isHighConfidence(c) {
  if (typeof c === 'number') return c >= 0.8;
  return c === HIGH;
}

// Текст для класифікатора: те що вже витягнуто конвертером (DOCX/HTML) або
// підказка з sidecar. Повний OCR — це стадія extract (DP-3), тут НЕ тягнемо.
function gatherText(item, ctx) {
  if (item.extractedText && item.extractedText.trim()) return item.extractedText;
  const sc = ctx.metadataSidecar;
  if (sc?.ecitsContext?.summary) return String(sc.ecitsContext.summary);
  return null;
}

// Фабрика стадії (DI). stageDeps:
//   classify({text,ecitsContext,fileName,model}) → {type?,category?,author?,
//     confidence,caseCategory?} — ін'єктований AI-класифікатор (поверх
//     toolUseRunner.callAPIWithRetry/resolveModel). Обов'язковий для активної гілки.
//   shouldClassify(item,ctx) — override gate.
//   model — назва моделі для класифікатора (default — на стороні classify dep).
export function createClassifyV2(stageDeps = {}) {
  const shouldClassify = stageDeps.shouldClassify || defaultShouldClassify;

  return async function classifyV2(ctx) {
    if (typeof stageDeps.classify !== 'function') {
      return { ok: true };                        // немає транспорту — не блокуємо
    }

    const targets = ctx.files.filter(f => !f.skipped && shouldClassify(f, ctx));
    if (targets.length === 0) {
      return { ok: true };                        // passthrough — поведінка DP-1
    }

    const ecitsContext = ctx.metadataSidecar?.source === 'court_sync'
      ? (ctx.metadataSidecar.ecitsContext || null)
      : null;
    const decisions = [];
    const targetIds = new Set(targets.map(f => f.fileId));
    const files = [];

    for (const item of ctx.files) {
      if (!targetIds.has(item.fileId)) { files.push(item); continue; }

      const text = gatherText(item, ctx);
      if (!text && !ecitsContext) {
        // Нема на чому класифікувати (OCR — DP-3). Не вгадуємо: лишаємо
        // critical-поля null (документ отримає маркер ⚠) + питання адвокату.
        decisions.push({
          type: 'classification_unavailable',
          fileId: item.fileId,
          fileName: item.name,
          message: `Не вдалось класифікувати "${item.name}": немає тексту (OCR — наступна стадія).`,
        });
        files.push(item);
        continue;
      }

      let res;
      try {
        res = await stageDeps.classify({
          text: text || '',
          ecitsContext,
          fileName: item.name,
          model: stageDeps.model,
        });
      } catch (err) {
        decisions.push({
          type: 'classification_failed',
          fileId: item.fileId,
          fileName: item.name,
          message: `Класифікація "${item.name}" не вдалась: ${err?.message || err}`,
        });
        files.push(item);
        continue;
      }

      const category = normalizeCategory(res?.category)
        || (res?.type ? categoryFromBoundaryType(res.type) : null);
      const author = normalizeAuthor(res?.author);
      const confidence = res?.confidence ?? null;
      const proposal = {
        category,
        author,
        caseCategory: res?.caseCategory ?? null,
        confidence,
      };

      if (isHighConfidence(confidence) && (category || author)) {
        // Висока впевненість — пишемо одразу у шаблон метаданих документа.
        // Людський ввід НЕ перезаписуємо (gate вже відсіяв такі файли).
        files.push({
          ...item,
          metadataTemplate: {
            ...(item.metadataTemplate || {}),
            ...(category ? { category } : {}),
            ...(author ? { author } : {}),
          },
          classification: { ...proposal, applied: true },
        });
      } else {
        // Низька — нічого не перезаписуємо, питаємо адвоката (DP-4 вкладка).
        files.push({ ...item, classification: { ...proposal, applied: false } });
        decisions.push({
          type: 'classification',
          fileId: item.fileId,
          fileName: item.name,
          proposal,
          message: `Класифікація "${item.name}" з низькою впевненістю — підтвердьте тип/автора.`,
        });
      }
    }

    return {
      ok: true,
      ctx: { ...ctx, files },
      ...(decisions.length > 0 ? { decisions } : {}),
    };
  };
}
