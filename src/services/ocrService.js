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

// Серіалізує pageStructure у layout.json формат. Обгортка дозволяє у майбутньому
// додати поля без зміни схеми (schemaVersion, provider, generatedAt).
function serializeLayout({ provider, pageStructure }) {
  return JSON.stringify({
    schemaVersion: 1,
    provider,
    generatedAt: new Date().toISOString(),
    pages: pageStructure,
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

  // 3. Виклик ланцюжка з фолбеком
  let lastErr = null;
  for (const name of chain) {
    const impl = providers.get(name);
    if (!impl) continue;
    if (impl.canHandle && !impl.canHandle(file)) continue;
    try {
      const result = await impl.extract(file, options);

      // 4. Запис у кеш. options.skipCache керує лише ЧИТАННЯМ старого кеша —
      // запис свіжого результату відбувається завжди, бо при перерозпізнаванні
      // (skipCache: true) свіжий текст і layout замінюють старий.
      let cacheWritten = false;
      let layoutWritten = false;
      const hasPageStructure = Array.isArray(result.pageStructure) && result.pageStructure.length > 0;

      if (result.text && result.text.trim().length > 0) {
        cacheWritten = await writeArtifact(
          file,
          textCacheFileName(file),
          result.text,
          'text/plain'
        );
      }
      if (hasPageStructure) {
        layoutWritten = await writeArtifact(
          file,
          layoutCacheFileName(file),
          serializeLayout({ provider: name, pageStructure: result.pageStructure }),
          'application/json'
        );
      }

      return {
        text: result.text || '',
        pageCount: result.pageCount || 0,
        hasLayout: hasPageStructure,
        provider: name,
        fromCache: false,
        cacheWritten,
        layoutWritten,
        durationMs: Date.now() - t0,
        warnings: [...warnings, ...(result.warnings || [])],
      };
    } catch (e) {
      lastErr = e;
      // AUTH / QUOTA — фолбек не допоможе
      if (e.code === 'AUTH' || e.code === 'QUOTA') break;
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
  UNKNOWN: 'Невідома помилка обробки. Спробуйте ще раз.',
};

export function localizeOcrError(code) {
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.UNKNOWN;
}
