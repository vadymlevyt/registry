// ── DOCUMENT BOUNDARY · MULTI-FILE RECONSTRUCTOR (DP-3) ─────────────────────
// Семантична реконструкція логічних документів з ПАКЕТА файлів. Розширення
// salvage TASK 1 (documentBoundary/) з одного склеєного PDF на будь-яку
// комбінацію файлів пакета.
//
// УНІВЕРСАЛЬНІСТЬ (встановлене рішення §4.4): жодних сценаріїв «PDF+JPEG»,
// «DOCX+ZIP» у коді. Стадія convert (DP-1) + extract (DP-3) уже привели ВСЕ
// до однорідного {text, layout}. Реконструктор бачить лише нормалізований
// набір текстів — реальний формат входу для нього не існує. Одна логіка на
// будь-який мікс.
//
// Tool Use multi-turn як НАКОПИЧЕННЯ (не серверний stateful-діалог): AI
// бачить файли ПОСЛІДОВНО; після кожного — список «відкритих хвостів»
// (документ почався, але міг продовжитись далі) і накопичений план. Стан
// між викликами тримаємо МИ і передаємо назад у наступний виклик. Це
// функціонально multi-turn (кілька ходів AI, контекст накопичується), але
// детерміновано і тестопридатно (філософія: нуль speculative generality,
// DI-транспорт, no auto-resolution — лише propose).
//
// КОНТРАКТ propose→confirm збережено: повертає ПЛАН, нічого не ріже/не пише.
// Реальний split — splitDocumentsV3 ПІСЛЯ confirm.
//
// Чистий модуль: AI-транспорт ін'єктується (analyzeFile). Тести підставляють
// стаб без мережі; стадія detectBoundariesV3 — реальний поверх toolUseRunner.

// Зібрати короткий промпт-опис для одного файла пакета. Винесено окремо щоб
// detectBoundariesV3 міг переюзати, а тест — заасертити форму.
export function buildReconstructionPrompt({ fileName, text, openTails = [], userHint = '' }) {
  const tailLines = openTails.length
    ? openTails.map((t, i) => `  ${i + 1}. "${t.name}" (тип ${t.type || '?'}) — почався у файлі ${t.fileId}, можливо продовжується`).join('\n')
    : '  (немає)';
  return `Це частина пакета файлів судової справи. ${userHint ? `Контекст: ${userHint}` : ''}

Файл: "${fileName}"
Незакриті документи з попередніх файлів (відкриті хвости):
${tailLines}

Текст файла розмічений маркерами "=== СТОРІНКА N ===" перед кожною сторінкою.
startPage/endPage визначай ВИКЛЮЧНО за цими маркерами — не вигадуй номери.

Прочитай текст цього файла і визнач:
1. Які логічні документи присутні (або продовжуються з відкритого хвоста).
2. Межі сторінок кожного у МЕЖАХ цього файла.
3. Які документи лишаються "відкритими" (можуть продовжитись у наступному файлі).
4. Сторінки що не належать жодному документу (порожні, обривки) — у unusedPages з причиною.

Поверни ТІЛЬКИ JSON:
{
  "documents": [
    {"documentId":"d1","name":"Позовна заява","type":"pleading","startPage":1,"endPage":8,"continuesFromTail":null,"open":false}
  ],
  "unusedPages": [{"startPage":9,"endPage":9,"reason":"порожня сторінка між документами"}]
}

ВАЖЛИВО: межі тільки за реальним вмістом. Не вигадуй документи. continuesFromTail = id відкритого хвоста який цей фрагмент продовжує (або null).

Текст файла:
${text || ''}`;
}

// Злити результат одного файла у накопичений план. Чиста функція (один
// сенс: «додати внесок файла N до плану»), щоб тест перевіряв accumulation
// без AI. Повертає { plan, openTails }.
export function mergeFileResult({ plan, openTails, fileId, fileResult }) {
  const docs = Array.isArray(fileResult?.documents) ? fileResult.documents : [];
  const unused = Array.isArray(fileResult?.unusedPages) ? fileResult.unusedPages : [];
  const nextPlan = plan.map((d) => ({ ...d, fragments: [...d.fragments] }));
  let nextTails = [...openTails];

  for (const d of docs) {
    const frag = {
      fileId,
      startPage: d.startPage,
      endPage: d.endPage,
    };
    if (d.continuesFromTail) {
      // Продовження відкритого хвоста — дописуємо фрагмент у наявний документ.
      const target = nextPlan.find((p) => p.documentId === d.continuesFromTail);
      if (target) {
        target.fragments.push(frag);
        target.name = target.name || d.name;
        if (!d.open) {
          target.open = false;
          nextTails = nextTails.filter((t) => t.documentId !== d.continuesFromTail);
        }
        continue;
      }
      // Хвіст не знайдено — трактуємо як новий документ (не губимо фрагмент).
    }
    const documentId = d.documentId || `doc_${nextPlan.length + 1}`;
    nextPlan.push({
      documentId,
      name: d.name || null,
      type: d.type || null,
      category: null,
      open: d.open === true,
      fragments: [frag],
    });
    if (d.open === true) {
      nextTails.push({ documentId, name: d.name || null, type: d.type || null, fileId });
    }
  }

  const unusedPages = unused.map((u) => ({
    fileId,
    startPage: u.startPage,
    endPage: u.endPage,
    reason: u.reason || 'не визначено тип сторінки',
  }));
  return { plan: nextPlan, openTails: nextTails, unusedPages };
}

/**
 * Реконструювати логічні документи з пакета нормалізованих файлів.
 * @param {object} args
 * @param {Array<{fileId,name,text,pageCount?}>} args.files — після convert+OCR
 * @param {Function} args.analyzeFile — ін'єктований AI-хід:
 *        ({ fileId, fileName, text, openTails, userHint }) →
 *          { documents:[{documentId,name,type,startPage,endPage,
 *            continuesFromTail,open}], unusedPages:[{startPage,endPage,reason}] }
 * @param {string} [args.userHint]
 * @returns {Promise<{documents:Array<{documentId,name,type,category,
 *          fragments:[{fileId,startPage,endPage}]}>, unusedPages:Array,
 *          openTails:Array, fileCount:number}>}
 */
export async function reconstructAcrossFiles({ files = [], analyzeFile, userHint = '' } = {}) {
  if (typeof analyzeFile !== 'function') {
    throw new Error('reconstructAcrossFiles: analyzeFile транспорт обовʼязковий');
  }
  let plan = [];
  let openTails = [];
  const unusedPages = [];

  for (const f of files) {
    let fileResult;
    try {
      fileResult = await analyzeFile({
        fileId: f.fileId,
        fileName: f.name,
        text: f.text || '',
        openTails,
        userHint,
      });
    } catch (err) {
      // НЕ фатально (як detectBoundariesV2): файл не реконструювали — його
      // сторінки підуть як один фрагмент-кандидат, адвокат вирішить (DP-4).
      unusedPages.push({
        fileId: f.fileId,
        startPage: 1,
        endPage: f.pageCount || null,
        reason: `реконструкція не вдалась: ${err?.message || err}`,
      });
      continue;
    }
    const merged = mergeFileResult({ plan, openTails, fileId: f.fileId, fileResult });
    plan = merged.plan;
    openTails = merged.openTails;
    unusedPages.push(...merged.unusedPages);
  }

  return {
    documents: plan.map((d) => ({
      documentId: d.documentId,
      name: d.name,
      type: d.type,
      category: d.category,
      fragments: d.fragments,
    })),
    unusedPages,
    openTails,                          // ще відкриті після останнього файла
    fileCount: files.length,
  };
}
