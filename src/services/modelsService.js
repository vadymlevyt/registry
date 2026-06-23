// ── MODELS SERVICE ───────────────────────────────────────────────────────────
// Фасад над Anthropic Models API (GET /v1/models): живий список доступних
// моделей для UI вибору (ModelPicker / Налаштування) + детектор помилки
// «модель не знайдена» (retirement).
//
// Planka Picatinny: єдиний фасад; у майбутньому під ним можуть стати провайдери
// інших постачальників (AI Provider Abstraction). Споживачі (ModelPicker,
// Settings) джерела не знають — лише викликають fetchAvailableModels /
// getCachedModels / isModelNotFoundError.
//
// TASK Model Picker (стійкий вибір моделі), Фаза 1.

const MODELS_ENDPOINT = 'https://api.anthropic.com/v1/models?limit=1000';
const CACHE_KEY = 'levytskyi_models_cache';
// CACHE_TTL_MS — час життя кешу СПИСКУ моделей. ЄДИНИЙ сенс кешу: не бити API на
// кожне відкриття пікера; primary-джерело завжди API при простроченні / force.
// Кеш списку — це НЕ збережений вибір моделі (вибір живе у tenant.modelPreferences,
// синкається через Drive; правило #11).
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 год

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.models) || typeof parsed.fetchedAt !== 'number') return null;
    return parsed;
  } catch {
    // localStorage недоступний / зіпсований JSON — кеш не критичний.
    return null;
  }
}

function writeCache(models) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), models }));
  } catch {
    // localStorage недоступний / повний — мовчки ігноруємо (кеш не критичний).
  }
}

// Синхронний доступ до кешованого списку — для миттєвого показу поки fetch
// оновлює. Повертає масив моделей або null (кешу немає).
export function getCachedModels() {
  const cache = readCache();
  return cache ? cache.models : null;
}

// Нормалізує сирий елемент відповіді /v1/models у плоский об'єкт для UI.
function normalizeModel(raw) {
  return {
    id: raw?.id || '',
    displayName: raw?.display_name || raw?.id || '',
    createdAt: raw?.created_at || null,
  };
}

// isModelNotFoundError — ЄДИНИЙ сенс: розпізнати, що API відхилив саме
// ІДЕНТИФІКАТОР моделі (модель виведена з обігу / недоступна ключу). Це 404
// not_found_error, або message формату «model: <id>». НЕ плутати з 401 (ключ),
// 429 (rate limit), 400 (інші помилки) — для них реакція інша (правило #11).
export function isModelNotFoundError(status, body) {
  if (status !== 404) return false;
  if (body?.error?.type === 'not_found_error') return true;
  const msg = body?.error?.message;
  if (typeof msg === 'string' && msg.trim().toLowerCase().startsWith('model:')) return true;
  return false;
}

// shortModelLabel — людська коротка назва моделі для тісних місць UI (бейдж
// агента). ЄДИНИЙ сенс: «Opus 4.8» / «Sonnet 4.6» / «Haiku 4.5» з канонічного
// id. Не для вибору і не для виклику API (там — повний id; правило #11).
// Невідомий формат → повертаємо сам id (чесно, без вгадування).
export function shortModelLabel(modelId) {
  if (!modelId || typeof modelId !== 'string') return '';
  const m = modelId.match(/claude-(opus|sonnet|haiku)-(\d+)-(\d+)/i);
  if (!m) return modelId;
  const tier = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  return `${tier} ${m[2]}.${m[3]}`;
}

// fetchAvailableModels — тягне живий список моделей. Повертає
// { models, stale, fetchedAt, error }:
//  • свіжий кеш (< TTL) і !force → кеш без мережі (stale:false, error:null);
//  • інакше GET; на успіху оновлює кеш (stale:false);
//  • на помилці (мережа/401/…) → stale-кеш якщо є + error; НІКОЛИ не кидає
//    (правило №4: async у try/catch, не валимо UI).
export async function fetchAvailableModels(apiKey, { force = false } = {}) {
  const cache = readCache();
  const fresh = cache && (Date.now() - cache.fetchedAt) < CACHE_TTL_MS;
  if (fresh && !force) {
    return { models: cache.models, stale: false, fetchedAt: cache.fetchedAt, error: null };
  }

  try {
    const res = await fetch(MODELS_ENDPOINT, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const error = body?.error?.message || `HTTP ${res.status}`;
      return { models: cache?.models || null, stale: !!cache, fetchedAt: cache?.fetchedAt || null, error };
    }
    const data = await res.json();
    const models = Array.isArray(data?.data) ? data.data.map(normalizeModel).filter((m) => m.id) : [];
    writeCache(models);
    return { models, stale: false, fetchedAt: Date.now(), error: null };
  } catch (err) {
    return { models: cache?.models || null, stale: !!cache, fetchedAt: cache?.fetchedAt || null, error: err?.message || 'network_error' };
  }
}
