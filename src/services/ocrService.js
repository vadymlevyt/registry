// ── OCR SERVICE FACADE ──────────────────────────────────────────────────────
// Універсальний рейл "планки Пікатіні" для витягу тексту з документів.
// Споживач (CaseDossier) кличе extractText / extractTextBatch — фасад сам
// обирає провайдера, перевіряє кеш у 02_ОБРОБЛЕНІ і пише результат назад.
//
// Контракт — див. TASK.md розділ 2.2.

import { driveRequest } from './driveAuth.js';
import documentAi from './ocr/documentAi.js';
import claudeVision from './ocr/claudeVision.js';
import pdfjsLocal from './ocr/pdfjsLocal.js';

// ── Provider registry ───────────────────────────────────────────────────────

const providers = new Map();

function registerProvider(name, providerImpl) {
  providers.set(name, providerImpl);
}

registerProvider('documentAi', documentAi);
registerProvider('claudeVision', claudeVision);
registerProvider('pdfjsLocal', pdfjsLocal);

// ── Feature flag (TASK.md розділ 10) ────────────────────────────────────────

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

function cacheFileName(file) {
  return `${sanitizeBasename(file.name)}_${file.id}.txt`;
}

async function listFolderFilesByName(folderId, name) {
  const q = `'${folderId}' in parents and name='${name.replace(/'/g, "\\'")}' and trashed=false`;
  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.files || [];
}

async function readDriveFileText(fileId) {
  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  );
  if (!res.ok) throw new Error(`read cache ${res.status}`);
  return await res.text();
}

async function uploadTextFile(folderId, fileName, content) {
  const metadata = { name: fileName, parents: [folderId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([content], { type: 'text/plain' }));
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
  const name = cacheFileName(file);
  const matches = await listFolderFilesByName(subFolderId, name);
  if (matches.length === 0) return null;
  try {
    const text = await readDriveFileText(matches[0].id);
    return text;
  } catch (e) {
    return null;
  }
}

async function writeCache(file, text) {
  const subFolderId = file.subFolders?.['02_ОБРОБЛЕНІ'];
  if (!subFolderId) return;
  const name = cacheFileName(file);
  try {
    const existing = await listFolderFilesByName(subFolderId, name);
    for (const e of existing) {
      await driveRequest(`https://www.googleapis.com/drive/v3/files/${e.id}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
    await uploadTextFile(subFolderId, name, text);
  } catch (e) {
    // не падати — кеш не критичний
    console.warn('[ocrService] writeCache failed:', e.message);
  }
}

// ── Вибір провайдера ────────────────────────────────────────────────────────

function pickProviderName(file) {
  if (file.mimeType === 'application/pdf') return 'pdfjsLocal';
  if (file.mimeType?.startsWith('image/')) return 'documentAi';
  const lname = file.name?.toLowerCase() || '';
  if (
    file.mimeType === 'application/vnd.google-apps.document' ||
    file.mimeType === 'text/plain' ||
    file.mimeType === 'text/markdown' ||
    file.mimeType === 'text/html' ||
    file.mimeType === 'application/xhtml+xml' ||
    lname.endsWith('.txt') ||
    lname.endsWith('.md') ||
    lname.endsWith('.html') ||
    lname.endsWith('.htm')
  ) {
    return 'pdfjsLocal';
  }
  return null;
}

// Послідовність провайдерів у разі помилки UNSUPPORTED або UNKNOWN
function fallbackChain(initial, file) {
  const chain = [initial];
  if (initial === 'pdfjsLocal' && file.mimeType === 'application/pdf') {
    chain.push('documentAi');
    chain.push('claudeVision');
  } else if (initial === 'documentAi') {
    chain.push('claudeVision');
  }
  // dedupe + only existing
  const seen = new Set();
  return chain.filter((n) => {
    if (seen.has(n)) return false;
    seen.add(n);
    return providers.has(n);
  });
}

// ── extractText ─────────────────────────────────────────────────────────────

export async function extractText(file, options = {}) {
  const t0 = Date.now();
  const warnings = [];

  // 1. Кеш
  if (options.skipCache !== true) {
    const cached = await checkCache(file);
    if (cached !== null) {
      return {
        text: cached,
        pages: 0,
        provider: 'cache',
        fromCache: true,
        durationMs: Date.now() - t0,
        warnings: [],
      };
    }
  }

  // 2. Вибір провайдера (forced або auto)
  const forced = options.forceProvider || getForceProvider();
  let chain;
  if (forced) {
    if (!providers.has(forced)) {
      throw new Error(`Невідомий OCR провайдер: ${forced}`);
    }
    chain = [forced];
  } else {
    const initial = pickProviderName(file);
    if (!initial) {
      const err = new Error(`Немає провайдера для ${file.mimeType || file.name}`);
      err.code = 'UNSUPPORTED';
      throw err;
    }
    chain = fallbackChain(initial, file);
  }

  // 3. Виклик ланцюжка з фолбеком
  let lastErr = null;
  for (const name of chain) {
    const impl = providers.get(name);
    if (!impl) continue;
    if (impl.canHandle && !impl.canHandle(file)) continue;
    try {
      const result = await impl.extract(file, options);
      // 4. Записати в кеш (якщо не з кешу і провайдер вернув непорожній текст)
      if (result.text && result.text.trim().length > 0 && !options.skipCache) {
        await writeCache(file, result.text);
      }
      return {
        text: result.text || '',
        pages: result.pages || 0,
        provider: name,
        fromCache: false,
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

// ── Локалізація помилок (TASK.md розділ 8.2) ────────────────────────────────

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
