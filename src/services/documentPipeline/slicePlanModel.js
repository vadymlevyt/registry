// ── A7.2 · SLICE PLAN EDIT MODEL ────────────────────────────────────────────
// Чисті функції редагування плану нарізки (двофазний DP). Один сенс: «перевести
// reconstructionPlan у редаговану модель груп-сторінок і назад, з примітивами
// правки межі». Без React/Drive/AI — щоб операції меж тестувались ізольовано
// (DEVELOPMENT_PHILOSOPHY: логіка первинна, UI — вікно до неї).
//
// МОДЕЛЬ. План = { documents:[{documentId,name,type,route,fragments[],open}],
// unusedPages[] }. Фрагмент = діапазон [startPage..endPage] одного файла.
// Редагувати МЕЖІ на діапазонах незручно (перетягнути сторінку = перерахунок
// діапазонів), тому розгортаємо у ГРУПИ-СТОРІНКИ: документ → впорядкований
// масив сторінок {fileId,pageNumber}. Адвокат бачить і рухає САМЕ сторінку
// (§2.2). На «Виконати» згортаємо назад у фрагменти (суцільні пробіги одного
// файла → один діапазон) — той самий канонічний формат, який далі нормалізує
// triageStage.normalizePlan (ідемпотентно).
//
// pageKey = `${fileId}::${pageNumber}` — стабільний ідентифікатор картки для
// DnD і React-ключів. Один сенс: «яка фізична сторінка джерела».

export function pageKey(fileId, pageNumber) {
  return `${fileId}::${pageNumber}`;
}

export function parsePageKey(key) {
  const idx = String(key || '').lastIndexOf('::');
  if (idx < 0) return null;
  const fileId = key.slice(0, idx);
  const pageNumber = Number(key.slice(idx + 2));
  if (!fileId || !Number.isFinite(pageNumber)) return null;
  return { fileId, pageNumber };
}

// Розгорнути фрагменти документа у впорядкований масив сторінок.
function fragmentsToPages(fragments) {
  const pages = [];
  for (const fr of Array.isArray(fragments) ? fragments : []) {
    const start = Number(fr.startPage) || 1;
    const end = Number(fr.endPage) || start;
    for (let p = start; p <= end; p++) pages.push({ fileId: fr.fileId, pageNumber: p });
  }
  return pages;
}

// Згорнути впорядкований масив сторінок у суцільні діапазони одного файла.
// Розрив (інший файл АБО пропуск номера) починає новий фрагмент. Reorder/
// дублікати лишаються кратними фрагментами — резолвиться у normalizePlan.
export function collapsePagesToFragments(pages) {
  const fragments = [];
  for (const p of Array.isArray(pages) ? pages : []) {
    const last = fragments[fragments.length - 1];
    if (last && last.fileId === p.fileId && p.pageNumber === last.endPage + 1) {
      last.endPage = p.pageNumber;
    } else {
      fragments.push({ fileId: p.fileId, startPage: p.pageNumber, endPage: p.pageNumber });
    }
  }
  return fragments;
}

// План → редаговані групи. docId = documentId плану (стабільний для React/DnD).
export function planToGroups(plan) {
  const documents = Array.isArray(plan?.documents) ? plan.documents : [];
  const groups = documents.map((d, i) => ({
    docId: d?.documentId || `doc_${i + 1}`,
    name: d?.name || '',
    type: d?.type || '',
    route: d?.route || 'add_as_is',
    open: d?.open === true,
    pages: fragmentsToPages(d?.fragments),
  }));
  return { groups, unusedPages: Array.isArray(plan?.unusedPages) ? plan.unusedPages : [] };
}

// Групи → план (для executeRun). Порожні групи відкидаються (немає сторінок —
// немає документа). normalizePlan нижче по конвеєру ще раз нормалізує/дедупить.
export function groupsToPlan(groups, unusedPages = []) {
  const documents = (Array.isArray(groups) ? groups : [])
    .map((g) => ({
      documentId: g.docId,
      name: (g.name && String(g.name).trim()) ? g.name : null,
      type: g.type || null,
      route: g.route || 'add_as_is',
      fragments: collapsePagesToFragments(g.pages),
      open: g.open === true,
    }))
    .filter((d) => d.fragments.length > 0);
  return { documents, unusedPages: Array.isArray(unusedPages) ? unusedPages : [] };
}

let splitSeq = 0;
function freshDocId(prefix = 'doc') {
  splitSeq += 1;
  return `${prefix}_split_${splitSeq}`;
}

// ── Примітиви правки межі ────────────────────────────────────────────────────
// Усі повертають НОВИЙ масив груп (immutable) — придатне для setState.

// Перейменувати документ.
export function renameGroup(groups, docId, name) {
  return groups.map((g) => (g.docId === docId ? { ...g, name } : g));
}

// Тип документа (enum category | '').
export function setGroupType(groups, docId, type) {
  return groups.map((g) => (g.docId === docId ? { ...g, type } : g));
}

// Розділити групу НА сторінці (pageKey стає першою сторінкою НОВОГО документа).
// Межа зсувається: усе до pageKey лишається у поточному документі, від pageKey
// (включно) — новий документ ОДРАЗУ ПІСЛЯ поточного. Розділ на першій сторінці
// групи — no-op (немає що відділяти). Новий документ успадковує route, але без
// назви/типу (це інший документ — адвокат назве).
export function splitGroupAt(groups, docId, splitPageKey) {
  const gi = groups.findIndex((g) => g.docId === docId);
  if (gi < 0) return groups;
  const g = groups[gi];
  const at = g.pages.findIndex((p) => pageKey(p.fileId, p.pageNumber) === splitPageKey);
  if (at <= 0) return groups;                     // не знайдено / перша сторінка
  const head = { ...g, pages: g.pages.slice(0, at) };
  const tail = {
    docId: freshDocId(g.docId),
    name: '',
    type: '',
    route: g.route,
    open: false,
    pages: g.pages.slice(at),
  };
  const next = groups.slice();
  next.splice(gi, 1, head, tail);
  return next;
}

// Обʼєднати документ із НАСТУПНИМ (конкат сторінок). Межа між ними зникає.
// Назва/тип беруться з першого (поточного). Останній документ — no-op.
export function mergeWithNext(groups, docId) {
  const gi = groups.findIndex((g) => g.docId === docId);
  if (gi < 0 || gi >= groups.length - 1) return groups;
  const a = groups[gi];
  const b = groups[gi + 1];
  const merged = {
    ...a,
    pages: [...a.pages, ...b.pages],
  };
  const next = groups.slice();
  next.splice(gi, 2, merged);
  return next;
}

// Перемістити одну сторінку у цільовий документ. beforeKey — вставити ПЕРЕД цією
// сторінкою цілі (null → у кінець). Порожні групи-джерела прибираються. Сенс
// один: «зсунути сторінку через межу» (§2.2 — правка межі перетягуванням).
export function movePage(groups, pageKeyStr, targetDocId, beforeKey = null) {
  const moved = parsePageKey(pageKeyStr);
  if (!moved) return groups;
  let pageObj = null;
  // 1. Вийняти сторінку з її поточної групи.
  const stripped = groups.map((g) => {
    const idx = g.pages.findIndex((p) => pageKey(p.fileId, p.pageNumber) === pageKeyStr);
    if (idx < 0) return g;
    pageObj = g.pages[idx];
    return { ...g, pages: g.pages.filter((_, i) => i !== idx) };
  });
  if (!pageObj) return groups;                    // сторінки немає — no-op
  // 2. Вставити у цільову групу.
  const placed = stripped.map((g) => {
    if (g.docId !== targetDocId) return g;
    const pages = g.pages.slice();
    const at = beforeKey
      ? pages.findIndex((p) => pageKey(p.fileId, p.pageNumber) === beforeKey)
      : -1;
    if (at < 0) pages.push(pageObj);
    else pages.splice(at, 0, pageObj);
    return { ...g, pages };
  });
  // 3. Прибрати спорожнілі групи (окрім цілі — щоб не зникала при само-перенесенні).
  return placed.filter((g) => g.pages.length > 0 || g.docId === targetDocId);
}

// Видалити документ (його сторінки виходять зі склейки — стають невикористаними).
export function removeGroup(groups, docId) {
  return groups.filter((g) => g.docId !== docId);
}
