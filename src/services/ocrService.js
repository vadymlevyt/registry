// ── OCR SERVICE FACADE ──────────────────────────────────────────────────────
// Універсальний рейл "планки Пікатіні" для витягу тексту з документів.
// Споживач (CaseDossier) кличе extractText / extractTextBatch — фасад сам
// обирає ланцюжок провайдерів через providerMatrix, перевіряє кеш
// у 02_ОБРОБЛЕНІ і пише результат назад.
//
// Збереження артефактів у 02_ОБРОБЛЕНІ:
//   - <basename>_<driveId>.layout.json  — pageStructure, лише коли провайдер
//                                          фактично повернув непорожній масив.
//
// ПОВНА ВІДМОВА ВІД .txt (TASK 4 §7.1): фасад БІЛЬШЕ не пише і не читає .txt.
// Два типи документів — два джерела ВІРНОГО тексту:
//   - scanned    → layout (page._text) із .layout.json;
//   - searchable → текстовий шар самого PDF на вимогу (extractTextLayer,
//                  pdfjsLocal, БЕЗ OCR/Document AI). DOC/HTML конвертуються у
//                  searchable PDF (pdf-lib drawText) → текст живе в PDF.
// `.txt` — мертвий дубль (і запис, і читання прибрано, без legacy-милиць).
//
// Контракт результату назовні:
//   { text, pageCount, hasLayout, provider, fromCache, cacheWritten,
//     layoutWritten, durationMs, warnings }

import { driveRequest } from './driveAuth.js';
import documentAi from './ocr/documentAi.js';
import claudeVision from './ocr/claudeVision.js';
import pdfjsLocal from './ocr/pdfjsLocal.js';
import { selectProviderChain, hasAnyProvider } from './ocr/providerMatrix.js';
import { getResume, clearResume, processedPageCount, hasResume } from './ocr/resumeStore.js';

// ── Provider registry ───────────────────────────────────────────────────────

const providers = new Map();

function registerProvider(name, providerImpl) {
  providers.set(name, providerImpl);
}

registerProvider('documentAi', documentAi);
registerProvider('claudeVision', claudeVision);
registerProvider('pdfjsLocal', pdfjsLocal);

// ── Feature flag (forced provider override) ─────────────────────────────────

function getForceProvider() {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem('ocr_force_provider');
}

// ── Кеш у 02_ОБРОБЛЕНІ ──────────────────────────────────────────────────────

function sanitizeBasename(name) {
  return (name || '')
    .replace(/\.[^/.]+$/, '')
    .replace(/[/\\]/g, '_')
    .slice(0, 150);
}

function layoutCacheFileName(file) {
  return `${sanitizeBasename(file.name)}_${file.id}.layout.json`;
}

// .md — очищений читабельний Markdown (TASK 3.1 cleanTextService). Лежить
// поряд з .txt у 02_ОБРОБЛЕНІ. V2-A2: ім'я за суфіксом РЕЖИМУ —
// <base>_<id>.clean.md (Чистий) або <base>_<id>.digest.md (Конспект). Так у
// одному документі співіснують обидва варіанти, не затираючи один одного.
function markdownCacheFileName(file, mode = 'digest') {
  const m = mode === 'clean' ? 'clean' : 'digest';
  return `${sanitizeBasename(file.name)}_${file.id}.${m}.md`;
}

// Legacy-ім'я .md з 3.1 (<base>_<id>.md, без суфікса) — наявні дайджести до
// V2-A2. Читається як digest (parent §A2.6 backward-compat).
function legacyMarkdownCacheFileName(file) {
  return `${sanitizeBasename(file.name)}_${file.id}.md`;
}

// CLAUDE.md правило #8 — кирилиця в q= filter Drive API ненадійна.
// Запитуємо всі файли папки, фільтруємо по name у JavaScript.
async function listFolderFilesByName(folderId, name) {
  const q = `'${folderId}' in parents and trashed=false`;
  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1000`
  );
  if (!res.ok) return [];
  const data = await res.json();
  const all = data.files || [];
  return all.filter((f) => f.name === name);
}

async function readDriveFileText(fileId) {
  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  );
  if (!res.ok) throw new Error(`read cache ${res.status}`);
  return await res.text();
}

async function uploadTextFile(folderId, fileName, content, mimeType = 'text/plain') {
  const metadata = { name: fileName, parents: [folderId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([content], { type: mimeType }));
  const res = await driveRequest(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
    { method: 'POST', body: form }
  );
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`upload cache ${res.status}: ${t.slice(0, 200)}`);
  }
  return await res.json();
}

// Записує файл у 02_ОБРОБЛЕНІ, попередньо видаливши існуючий з такою назвою.
// Використовується для .layout.json і .md — пара тримається синхронізованою.
async function writeArtifact(file, fileName, content, mimeType) {
  const subFolderId = file.subFolders?.['02_ОБРОБЛЕНІ'];
  if (!subFolderId) return false;
  try {
    const existing = await listFolderFilesByName(subFolderId, fileName);
    for (const e of existing) {
      await driveRequest(`https://www.googleapis.com/drive/v3/files/${e.id}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
    await uploadTextFile(subFolderId, fileName, content, mimeType);
    return true;
  } catch (e) {
    // не падати — кеш не критичний
    console.warn('[ocrService] writeArtifact failed:', fileName, e.message);
    return false;
  }
}

// Поля сторінки Document AI які роздувають layout.json без користі для майбутніх
// операцій (AI Очищення тексту, semantic split тощо). Викидаємо ТІЛЬКИ при
// серіалізації — pageStructure у пам'яті залишається повним для caller'ів.
//
//   image  — base64 PNG-рендер сторінки. Дублює оригінал у 01_ОРИГІНАЛИ.
//            ~5-7 МБ на сторінку для типового скана судового документа.
//   tokens — координати кожної окремої літери. Майбутні модулі працюють
//            на рівні paragraphs/blocks, окремі літери не потрібні.
const STRIPPED_LAYOUT_FIELDS = ['image', 'tokens'];

function stripHeavyFields(pageStructure) {
  if (!Array.isArray(pageStructure)) return pageStructure;
  return pageStructure.map((page) => {
    if (!page || typeof page !== 'object') return page;
    const copy = { ...page };
    for (const f of STRIPPED_LAYOUT_FIELDS) {
      delete copy[f];
    }
    return copy;
  });
}

// Серіалізує pageStructure у layout.json формат. Обгортка дозволяє у майбутньому
// додати поля без зміни схеми (schemaVersion, provider, generatedAt).
// Викидає важкі поля (image, tokens) — економить ~7 МБ на сторінку Drive
// quota без втрати корисної інформації для AI Очищення.
function serializeLayout({ provider, pageStructure }) {
  return JSON.stringify({
    schemaVersion: 1,
    provider,
    generatedAt: new Date().toISOString(),
    pages: stripHeavyFields(pageStructure),
  });
}

// joinLayoutText — ВІРНИЙ текст з layout: з'єднати page._text усіх сторінок
// через подвійний перенос (≈ старий .txt). НЕ Markdown-чернетка
// (layoutToMarkdownDraft) — тут сирий вірний шар для агента/контексту/«Текст».
function joinLayoutText(layout) {
  const pages = Array.isArray(layout) ? layout : (Array.isArray(layout?.pages) ? layout.pages : []);
  const parts = pages
    .map((p) => (p && typeof p._text === 'string') ? p._text : '')
    .filter((t) => t && t.trim());
  return parts.join('\n\n');
}

// readDigestMarkdown — прочитати дайджест-варіант (.digest.md, інакше legacy
// .md з 3.1). Повертає string або null. Чистий (.clean.md) тут НЕ читаємо —
// «Текст»-таб показує Конспект; перемикач режимів — V2-B.
async function readDigestMarkdown(file) {
  const subFolderId = file?.subFolders?.['02_ОБРОБЛЕНІ'];
  if (!subFolderId) return null;
  for (const name of [markdownCacheFileName(file, 'digest'), legacyMarkdownCacheFileName(file)]) {
    try {
      const matches = await listFolderFilesByName(subFolderId, name);
      if (matches.length > 0) {
        const text = await readDriveFileText(matches[0].id);
        if (text != null) return text;
      }
    } catch { /* пробуємо наступне ім'я / нижче null */ }
  }
  return null;
}

// readCleanMarkdown — прочитати Чистий-варіант (<base>_<id>.clean.md). Повертає
// string або null. На відміну від digest, legacy .md тут НЕ читаємо (Чистий —
// новий режим V2-A2; legacy .md трактується виключно як digest, parent §A2.6).
async function readCleanMarkdown(file) {
  const subFolderId = file?.subFolders?.['02_ОБРОБЛЕНІ'];
  if (!subFolderId) return null;
  try {
    const matches = await listFolderFilesByName(subFolderId, markdownCacheFileName(file, 'clean'));
    if (matches.length > 0) {
      const text = await readDriveFileText(matches[0].id);
      if (text != null) return text;
    }
  } catch { /* нижче null */ }
  return null;
}

// getVariantMarkdown — публічний читач AI-варіанта очистки за РЕЖИМОМ (V2-B).
// Один сенс (#11): «дай збережений .md саме цього режиму»:
//   'clean'  → <base>_<id>.clean.md (Чистий, дослівний);
//   'digest' → <base>_<id>.digest.md (Конспект; + legacy <base>_<id>.md).
// Повертає string або null (варіант ще не згенеровано). Споживач — VariantContent
// у в'ювері (вкладки Чистий/Конспект). НЕ змішувати з getCleanOrRawText
// («найкращий читабельний текст») чи getDocumentText («вірний текст для агента») —
// три різні питання, три імені.
export async function getVariantMarkdown(file, mode) {
  return mode === 'clean' ? readCleanMarkdown(file) : readDigestMarkdown(file);
}

// extractTextLayer — ВІРНИЙ текст searchable-документа з ТЕКСТОВОГО ШАРУ PDF
// (pdfjsLocal, БЕЗ OCR/Document AI, БЕЗ запису будь-яких артефактів). Після
// повної відмови від .txt (TASK 4 §7.1) — ЄДИНЕ джерело тексту searchable:
// текст живе в самому PDF (конвертер DOC/HTML дає searchable PDF через
// pdf-lib drawText; нативні searchable PDF теж мають текстовий шар), дістаємо
// на вимогу. Скани без текстового шару → pdfjsLocal кидає UNSUPPORTED (це не
// searchable; джерело сканів — layout). driveId завжди вказує на PDF у
// 01_ОРИГІНАЛИ → mimeType форсуємо 'application/pdf'.
//
// Один сенс (#11): «витягни текстовий шар PDF за driveId, нічого не пишучи».
async function extractTextLayer(file) {
  if (!file?.id) return '';
  const res = await pdfjsLocal.extract({
    id: file.id,
    name: file.name || '',
    mimeType: 'application/pdf',
  });
  return (res?.text || '').trim();
}

// getCleanOrRawText — текст документа для viewer/читача. Порядок:
// (1) Конспект (.digest.md / legacy .md) → format 'md'; (2) ВІРНИЙ текст —
// scanned: layout (page._text); searchable: текстовий шар PDF (extractTextLayer).
// ОКРЕМЕ ім'я (правило #11): getCleanOrRawText = «найкращий читабельний текст»
// (на відміну від getDocumentText = «вірний текст для агента», який .md не дає).
//
// TASK 4 §7.1: .txt прибрано як джерело повністю. НІКОЛИ не повертає
// Чистий/.clean.md. Повертає { text, format:'md'|'txt' } або null.
export async function getCleanOrRawText(file) {
  const subFolderId = file?.subFolders?.['02_ОБРОБЛЕНІ'];
  if (!subFolderId) return null;
  const md = await readDigestMarkdown(file);
  if (md != null) return { text: md, format: 'md' };
  try {
    const layout = await getCachedLayout(file);
    if (layout) {
      const t = joinLayoutText(layout);
      if (t && t.trim()) return { text: t, format: 'txt' };
    }
  } catch { /* layout збій → пробуємо текстовий шар */ }
  try {
    const t = await extractTextLayer(file);
    if (t && t.trim()) return { text: t, format: 'txt' };
  } catch { /* нема текстового шару → null */ }
  return null;
}

// fileRefForDocument — file-контракт {id,name,subFolders} з документа + caseData.
// NFC-нормалізація імені (як TextContent/useExactLayout/adapter — щоб
// getCachedLayout знайшов <base>_<id> за тим самим basename).
function fileRefForDocument(documentObj, caseData) {
  const rawName = documentObj?.originalName || documentObj?.name || '';
  const name = typeof rawName.normalize === 'function' ? rawName.normalize('NFC') : rawName;
  return { id: documentObj?.driveId, name, subFolders: caseData?.storage?.subFolders };
}

// getDocumentText — ЄДИНА точка «дай ВІРНИЙ текст документа» (#11).
// scanned з layout → з'єднаний page._text (вірний шар); searchable → текстовий
// шар PDF (extractTextLayer, pdfjsLocal, БЕЗ OCR). НІКОЛИ не Конспект/.md (це
// переказ — агент/contextGenerator цитувати з нього не можуть).
//
// TASK 4 §7.1 (повна відмова від .txt): .txt більше не джерело. Старі скани
// лише з .txt без layout тут отримають '' — для них нічого не лишаємо
// (адвокат перевидалить/додасть). Споживачі (агент досьє, contextGenerator,
// в'ювер-footer) ходять сюди. Повертає string ('' якщо джерела нема).
export async function getDocumentText(documentObj, caseData) {
  const file = fileRefForDocument(documentObj, caseData);
  if (!file.id) return '';
  const nature = documentObj?.documentNature;

  // scanned → ВІРНИЙ текст ВИКЛЮЧНО з layout (page._text). Скан без layout
  // (старий .txt-only) → '' — .txt прибрано як джерело (нічого не лишаємо).
  if (nature === 'scanned') {
    if (!file.subFolders?.['02_ОБРОБЛЕНІ']) return '';
    try {
      const layout = await getCachedLayout(file);
      if (layout) {
        const t = joinLayoutText(layout);
        if (t && t.trim()) return t;
      }
    } catch { /* layout збій → '' */ }
    return '';
  }

  // Невідома природа з layout — спершу layout (на випадок скана без позначки),
  // щоб не марнувати завантаження PDF. searchable layout не має — пропускаємо.
  if (nature !== 'searchable' && file.subFolders?.['02_ОБРОБЛЕНІ']) {
    try {
      const layout = await getCachedLayout(file);
      if (layout) {
        const t = joinLayoutText(layout);
        if (t && t.trim()) return t;
      }
    } catch { /* нижче текстовий шар */ }
  }

  // searchable (і невідома природа без layout) → текстовий шар самого PDF
  // (на вимогу, без OCR).
  try {
    const t = await extractTextLayer(file);
    if (t && t.trim()) return t;
  } catch { /* нема текстового шару → '' */ }
  return '';
}

// writeLayoutArtifact — публічний запис .layout.json для caller'а який зібрав
// pageStructure поза стандартним extractText (TASK B multiImageToPdf, DP-3
// split/persist по нарізаних документах). Приймає ОБ'ЄКТ і САМА робить
// strip важких полів (image, tokens) + serialize у JSON-рядок. Це єдиний
// шлях запису layout-артефакту через Drive — strip є частиною контракту
// функції, а не відповідальністю caller'а.
//
// Один сенс (правило #11): «записати об'єкт layout у Drive .layout.json,
// викинувши важкі поля image/tokens». Якщо caller передає string — ми НЕ
// приймаємо: це двозначність (caller міг забути strip — тоді на Drive
// потрапляють 14МБ замість 400КБ; саме корінь bug B1, 15.05.2026). Тести
// у tests/unit/ocrService.test.js фіксують контракт.
//
// Параметри:
//   file — { id (driveId), name, subFolders: { '02_ОБРОБЛЕНІ': folderId } }
//   layout — { pages:[], schemaVersion?, provider?, generatedAt? } або null
//
// Повертає: true якщо записано, false якщо немає subFolder / помилка / null.
export async function writeLayoutArtifact(file, layout) {
  if (!layout) return false;
  if (typeof layout === 'string') {
    // Зворотна сумісність — НЕ приймаємо: string обходить strip. Caller
    // повинен передати об'єкт (CLAUDE.md правило #11 — один сенс на ім'я).
    // eslint-disable-next-line no-console
    console.warn('[ocrService.writeLayoutArtifact] string input rejected — caller must pass object');
    return false;
  }
  const provider = layout.provider || 'unknown';
  const pages = Array.isArray(layout.pages) ? layout.pages : [];
  const serialized = serializeLayout({ provider, pageStructure: pages });
  return await writeArtifact(file, layoutCacheFileName(file), serialized, 'application/json');
}

// ── Артефакти очистки тексту (TASK 3.1 cleanTextService Drive-шви) ───────────
// Ці функції — реалізація Drive-швів cleanDocument: читач layout, запис .md.
// Їх же перевикористовує adapter для кнопок 3.2 (cleanTextDriveAdapter.js).
// Усі — best-effort. TASK 4 §7.1: жодних .txt-швів (move/archive прибрано).

// getCachedLayout — прочитати <basename>_<id>.layout.json з 02_ОБРОБЛЕНІ і
// розпарсити (fetchLayout-шов). Повертає об'єкт { pages:[...] } або null.
export async function getCachedLayout(file) {
  const subFolderId = file?.subFolders?.['02_ОБРОБЛЕНІ'];
  if (!subFolderId) return null;
  try {
    const matches = await listFolderFilesByName(subFolderId, layoutCacheFileName(file));
    if (matches.length === 0) return null;
    const raw = await readDriveFileText(matches[0].id);
    const obj = JSON.parse(raw);
    return obj && Array.isArray(obj.pages) ? obj : null;
  } catch {
    return null;
  }
}

// writeMarkdownArtifact — записати <basename>_<id>.<mode>.md у 02_ОБРОБЛЕНІ
// (saveMarkdown-шов). mode ∈ {'digest','clean'} (default 'digest', V2-A2):
// співіснують обидва варіанти без затирання.
export async function writeMarkdownArtifact(file, markdown, mode = 'digest') {
  if (!markdown || !String(markdown).trim()) return false;
  return await writeArtifact(file, markdownCacheFileName(file, mode), String(markdown), 'text/markdown');
}

// deleteLayoutArtifact — видалити <basename>_<id>.layout.json з 02_ОБРОБЛЕНІ.
// V2-A2: БІЛЬШЕ НЕ ВИКЛИКАЄТЬСЯ під час очистки — layout зберігається як
// джерело режиму «Точний» і повторної генерації (parent §A2.2). Функцію
// лишено як примітив Drive для майбутніх потреб (не видаляємо існуючий код).
export async function deleteLayoutArtifact(file) {
  const subFolderId = file?.subFolders?.['02_ОБРОБЛЕНІ'];
  if (!subFolderId) return false;
  try {
    const matches = await listFolderFilesByName(subFolderId, layoutCacheFileName(file));
    for (const m of matches) {
      await driveRequest(`https://www.googleapis.com/drive/v3/files/${m.id}`, { method: 'DELETE' }).catch(() => {});
    }
    return matches.length > 0;
  } catch {
    return false;
  }
}

// hasOcrSupport — чи існує хоч один OCR-провайдер для цього типу файла.
// Викликається у CaseDossier:onSubmit перед запуском OCR pipeline щоб
// для непідтримуваних форматів одразу пропустити OCR крок без warning-тоста.
export function hasOcrSupport(file) {
  return hasAnyProvider(file);
}

// ── extractText ─────────────────────────────────────────────────────────────

export async function extractText(file, options = {}) {
  const t0 = Date.now();
  const warnings = [];

  // 1. TASK 4 §7.1: жодного .txt-кеша. scanned кешується у .layout.json (нижче);
  //    searchable не кешується — текст дістається з текстового шару PDF на вимогу
  //    (getDocumentText/getCleanOrRawText → extractTextLayer). options.skipCache
  //    лишається параметром провайдерів (resume/перерозпізнавання layout).

  // 2. Ланцюжок провайдерів (forced override або з матриці)
  const forced = options.forceProvider || getForceProvider();
  let chain;
  if (forced) {
    if (!providers.has(forced)) {
      throw new Error(`Невідомий OCR провайдер: ${forced}`);
    }
    chain = [forced];
  } else {
    chain = selectProviderChain(file).filter((n) => providers.has(n));
    if (chain.length === 0) {
      const err = new Error(`Немає провайдера для ${file.mimeType || file.name}`);
      err.code = 'UNSUPPORTED';
      throw err;
    }
  }

  // 3. Виклик ланцюжка з фолбеком.
  //
  // ВАЖЛИВО (мікро-TASK fix error handling):
  //   • NETWORK помилка з partial=true (документ AI вичерпав retry) — НЕ
  //     каскадує на наступний провайдер. Замість silent fallback кидаємо
  //     наверх — UI покаже діалог з вибором claudeVision або «пізніше».
  //   • AUTH / QUOTA — як було, break з циклу.
  //   • UNSUPPORTED — провайдер заявляє «це не моя справа», пробуємо
  //     наступного (pdfjsLocal → documentAi на сканах це нормально).
  //   • NETWORK без partial (атомарний провайдер не зміг навіть стартувати)
  //     — кидаємо наверх. Користувач отримає шанс через діалог.
  //
  // Для forceProvider='claudeVision' з попередньою resume-state від
  // documentAi: підставляємо startPage = lastFailedRange.startPage і
  // склеюємо результат з уже обробленими чанками.
  let lastErr = null;
  for (const name of chain) {
    const impl = providers.get(name);
    if (!impl) continue;
    if (impl.canHandle && !impl.canHandle(file)) continue;
    try {
      // Підготовка опцій провайдера (зокрема startPage для claudeVision)
      const providerOpts = { ...options };
      let mergedTextPrefix = '';
      let mergedPageStructure = [];
      let mergedWarnings = [];

      if (name === 'claudeVision' && forced) {
        const prev = file.id ? getResume(file.id) : null;
        if (prev && prev.provider === 'documentAi' && prev.lastFailedRange) {
          providerOpts.startPage = prev.lastFailedRange.startPage;
          // Готуємо префікс тексту з уже оброблених documentAi чанків.
          const sortedChunks = [...(prev.textChunks || [])].sort(
            (a, b) => a.startPage - b.startPage
          );
          mergedTextPrefix = sortedChunks.map((c) => c.text).join('\n\n--- Page break ---\n\n');
          if (mergedTextPrefix) mergedTextPrefix += '\n\n--- Page break ---\n\n';
          mergedPageStructure = [...(prev.pageStructureAll || [])];
          mergedWarnings.push(
            `Продовження після Document AI: сторінки 1-${prev.lastFailedRange.startPage - 1} оброблені раніше`
          );
        }
      }

      const result = await impl.extract(file, providerOpts);

      // Склейка з resume префіксом (тільки для claudeVision-after-documentAi)
      const finalText = mergedTextPrefix
        ? mergedTextPrefix + (result.text || '')
        : (result.text || '');
      const finalPageStructure = (mergedPageStructure.length > 0 || result.pageStructure)
        ? [...mergedPageStructure, ...(result.pageStructure || [])]
        : undefined;
      const finalPageCount = (mergedPageStructure.length || 0) + (result.pageCount || 0);

      // 4. Запис у кеш — ЛИШЕ .layout.json (scanned). TASK 4 §7.1: `.txt`
      // більше не пишемо нікому. Коли провайдер повернув pageStructure
      // (Document AI / фото-склейка) — layout містить page._text (вірне
      // джерело для getDocumentText/getCleanOrRawText). Searchable (pdfjsLocal
      // без pageStructure) не кешуємо — текст у самому PDF (extractTextLayer на
      // вимогу). cacheWritten лишається в контракті результату завжди false.
      const cacheWritten = false;
      let layoutWritten = false;
      const hasPageStructure = Array.isArray(finalPageStructure) && finalPageStructure.length > 0;

      if (hasPageStructure) {
        layoutWritten = await writeArtifact(
          file,
          layoutCacheFileName(file),
          serializeLayout({ provider: name, pageStructure: finalPageStructure }),
          'application/json'
        );
      }

      // Успіх — очищуємо resume стан (якщо був)
      if (file.id) clearResume(file.id);

      return {
        text: finalText,
        pageCount: finalPageCount || result.pageCount || 0,
        hasLayout: hasPageStructure,
        // pageStructure — необхідне для caller'ів які перепаковують layout у
        // merge сценарії (multiImageToPdf.mergeLayouts). До TASK B fix round 2
        // це поле не повертали — і у merge сценарії layout.json не створювався
        // бо ocrResults[idx].pageStructure був undefined. Додано для
        // single-source-of-truth: дані вже в пам'яті, додаткова робота нуль.
        pageStructure: hasPageStructure ? finalPageStructure : null,
        provider: name,
        fromCache: false,
        cacheWritten,
        layoutWritten,
        durationMs: Date.now() - t0,
        warnings: [...warnings, ...mergedWarnings, ...(result.warnings || [])],
      };
    } catch (e) {
      lastErr = e;
      // AUTH / QUOTA — фолбек не допоможе
      if (e.code === 'AUTH' || e.code === 'QUOTA') break;
      // NETWORK з partial=true — Document AI вичерпав retry. Не каскадуємо
      // на наступний провайдер default-ланцюжка — UI покаже діалог підтвердження.
      if (e.code === 'NETWORK' && e.partial) break;
      // NETWORK без partial — атомарний провайдер не зміг навіть стартувати.
      // Caскадування на наступного непотрібне (у нас все одно немає
      // claudeVision у default-chain). Виходимо.
      if (e.code === 'NETWORK') break;
    }
  }

  // 5. Усе впало
  if (!lastErr) {
    lastErr = new Error('Жоден провайдер не зміг обробити файл');
    lastErr.code = 'UNKNOWN';
  }
  if (!lastErr.code) lastErr.code = 'UNKNOWN';
  lastErr.provider = chain[chain.length - 1];
  throw lastErr;
}

// ── extractTextBatch ────────────────────────────────────────────────────────

export async function extractTextBatch(files, options = {}) {
  const concurrency = Math.max(1, options.concurrency || 3);
  const onProgress = options.onProgress;
  const signal = options.signal;

  const results = new Array(files.length);
  let completed = 0;
  let cursor = 0;

  async function worker() {
    while (true) {
      if (signal?.aborted) return;
      const i = cursor++;
      if (i >= files.length) return;
      const file = files[i];
      try {
        const result = await extractText(file, {
          ...options,
          onProgress: undefined, // batch має свій прогрес, не пер-файловий
        });
        results[i] = { file, result };
      } catch (e) {
        results[i] = {
          file,
          error: {
            message: e.message || String(e),
            code: e.code || 'UNKNOWN',
            provider: e.provider || 'unknown',
          },
        };
      }
      completed++;
      try {
        onProgress && onProgress(completed, files.length, file);
      } catch (e) {}
    }
  }

  const workers = [];
  for (let k = 0; k < Math.min(concurrency, files.length); k++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return results;
}

// ── Локалізація помилок ─────────────────────────────────────────────────────

const ERROR_MESSAGES = {
  AUTH: 'Помилка авторизації Google. Натисніть "Перепідключити Drive" у налаштуваннях.',
  QUOTA: 'Вичерпано ліміт Document AI. Спробуйте за хвилину.',
  TIMEOUT: 'Документ занадто великий або складний. Файл пропущено.',
  UNSUPPORTED: 'Формат файлу не підтримується (можливо, ZIP-PDF з ЄСІТС).',
  NETWORK: 'Зʼєднання нестабільне. Спробуйте ще раз коли мережа покращиться.',
  UNKNOWN: 'Невідома помилка обробки. Спробуйте ще раз.',
};

export function localizeOcrError(code) {
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.UNKNOWN;
}

// Експорт для UI — щоб модуль Reprocess міг показати "Опрацьовано N з M".
// Не публікуємо весь resumeStore — тільки read-only хелпери.
export function getResumeInfo(driveId) {
  const state = getResume(driveId);
  if (!state) return null;
  return {
    totalPages: state.totalPages || 0,
    processedPages: processedPageCount(state),
    lastFailedStartPage: state.lastFailedRange?.startPage || null,
    provider: state.provider,
  };
}

export function hasResumeState(driveId) {
  return hasResume(driveId);
}
