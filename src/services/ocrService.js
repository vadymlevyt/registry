// ── OCR SERVICE FACADE ──────────────────────────────────────────────────────
// Універсальний рейл "планки Пікатіні" для витягу тексту з документів.
// Споживач (CaseDossier) кличе extractText / extractTextBatch — фасад сам
// обирає ланцюжок провайдерів через providerMatrix, перевіряє кеш
// у 02_ОБРОБЛЕНІ і пише результат назад.
//
// Збереження артефактів у 02_ОБРОБЛЕНІ:
//   - <basename>_<driveId>.txt          — текст, завжди коли є непорожній
//   - <basename>_<driveId>.layout.json  — pageStructure, лише коли провайдер
//                                          фактично повернув непорожній масив.
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

function textCacheFileName(file) {
  return `${sanitizeBasename(file.name)}_${file.id}.txt`;
}

function layoutCacheFileName(file) {
  return `${sanitizeBasename(file.name)}_${file.id}.layout.json`;
}

// .md — очищений читабельний Markdown (TASK 3.1 cleanTextService). Лежить
// поряд з .txt у 02_ОБРОБЛЕНІ. Той самий шаблон імені <basename>_<id>.
function markdownCacheFileName(file) {
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

async function checkCache(file) {
  const subFolderId = file.subFolders?.['02_ОБРОБЛЕНІ'];
  if (!subFolderId) return null;
  const name = textCacheFileName(file);
  const matches = await listFolderFilesByName(subFolderId, name);
  if (matches.length === 0) return null;
  try {
    const text = await readDriveFileText(matches[0].id);
    return text;
  } catch (e) {
    return null;
  }
}

// Записує файл у 02_ОБРОБЛЕНІ, попередньо видаливши існуючий з такою назвою.
// Використовується для .txt і .layout.json — пара тримається синхронізованою.
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

// ── Public cache lookup (DocumentViewer) ────────────────────────────────────

export async function getCachedText(file) {
  try {
    return await checkCache(file);
  } catch {
    return null;
  }
}

// getCleanOrRawText — текст документа для viewer/читача: спочатку очищений
// .md (TASK 3.1), інакше сирий .txt. ОКРЕМЕ ім'я (НЕ розширюємо getCachedText
// подвійним сенсом — правило #11): getCachedText = «сирий .txt-кеш OCR»;
// getCleanOrRawText = «найкращий читабельний текст: .md якщо є, інакше .txt».
//
// Повертає { text, format:'md'|'txt' } або null якщо нема жодного.
export async function getCleanOrRawText(file) {
  const subFolderId = file?.subFolders?.['02_ОБРОБЛЕНІ'];
  if (!subFolderId) return null;
  try {
    const mdName = markdownCacheFileName(file);
    const mdMatches = await listFolderFilesByName(subFolderId, mdName);
    if (mdMatches.length > 0) {
      const text = await readDriveFileText(mdMatches[0].id);
      if (text != null) return { text, format: 'md' };
    }
  } catch { /* падіння .md не критичне — пробуємо .txt */ }
  try {
    const txt = await checkCache(file);
    if (txt != null) return { text: txt, format: 'txt' };
  } catch { /* нижче null */ }
  return null;
}

// writeExtractedTextArtifact — публічний запис .txt у 02_ОБРОБЛЕНІ для caller'а
// який отримав текст БЕЗ OCR (DOCX через mammoth, HTML через innerText).
// Використовує той самий механізм що внутрішній writeArtifact: ту ж назву
// (<basename>_<driveId>.txt), той самий шлях. Це гарантує що ocrService.getCachedText
// знайде його при наступному відкритті документа.
//
// Один сенс: «записати plain-текст у 02_ОБРОБЛЕНІ так, ніби це результат OCR».
// .layout.json не пишеться — pageStructure у DOCX/HTML немає за визначенням.
//
// Параметри:
//   file — { id (driveId), name, subFolders: { '02_ОБРОБЛЕНІ': folderId } }
//   text — plain-текст
//
// Повертає: true якщо записано, false якщо немає subFolder або помилка запису.
// Помилка не кидається — кеш не критичний, документ уже на Drive.
export async function writeExtractedTextArtifact(file, text) {
  if (!text || !text.trim()) return false;
  return await writeArtifact(file, textCacheFileName(file), text, 'text/plain');
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

  // 1. Кеш .txt
  if (options.skipCache !== true) {
    const cached = await checkCache(file);
    if (cached !== null) {
      return {
        text: cached,
        pageCount: 0,
        hasLayout: false,
        provider: 'cache',
        fromCache: true,
        cacheWritten: false,
        layoutWritten: false,
        durationMs: Date.now() - t0,
        warnings: [],
      };
    }
  }

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

      // 4. Запис у кеш. options.skipCache керує лише ЧИТАННЯМ старого кеша —
      // запис свіжого результату відбувається завжди, бо при перерозпізнаванні
      // (skipCache: true) свіжий текст і layout замінюють старий.
      let cacheWritten = false;
      let layoutWritten = false;
      const hasPageStructure = Array.isArray(finalPageStructure) && finalPageStructure.length > 0;

      if (finalText && finalText.trim().length > 0) {
        cacheWritten = await writeArtifact(
          file,
          textCacheFileName(file),
          finalText,
          'text/plain'
        );
      }
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
