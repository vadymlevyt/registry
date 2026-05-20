// ── DRIVE AUTH + REQUEST WRAPPER ────────────────────────────────────────────
// Автономне оновлення Drive токена і єдиний fetch-wrapper для всіх запитів.
// На 401 — silent re-auth через Google Identity Services (без участі користувача),
// потім одноразовий retry того ж запиту зі свіжим токеном.
// Після успішного оновлення — подія 'drive-token-refreshed' для модулів
// які мають перечитати контекст (CaseDossier → case_context.md, agent_history).

export const GOOGLE_CLIENT_ID =
  '73468500916-sn02gdk7qvp40q04hdjj44g5pir48btb.apps.googleusercontent.com';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/cloud-platform';
const TOKEN_KEY = 'levytskyi_drive_token';
const REFRESH_TOKEN_KEY = 'google_refresh_token';

let refreshInFlight = null;

export function getDriveToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function saveDriveToken(t) {
  localStorage.setItem(TOKEN_KEY, t);
}

// Silent refresh через GIS initTokenClient (браузерний OAuth не видає
// refresh_token, але повторний requestAccessToken без prompt дає новий
// access_token без взаємодії користувача, якщо consent вже наданий).
function silentGisRefresh() {
  return new Promise((resolve) => {
    try {
      if (!window.google?.accounts?.oauth2) { resolve(null); return; }
      const client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        prompt: '',
        callback: (resp) => {
          if (resp && resp.access_token) {
            saveDriveToken(resp.access_token);
            resolve(resp.access_token);
          } else {
            resolve(null);
          }
        },
        error_callback: () => resolve(null),
      });
      client.requestAccessToken({ prompt: '' });
    } catch (e) {
      resolve(null);
    }
  });
}

// Fallback: якщо в localStorage колись опинився refresh_token —
// спробувати класичний OAuth refresh_token grant. У поточному потоці
// авторизації він не зʼявляється, але код залишено для майбутнього
// переходу на auth-code flow.
async function refreshTokenGrant() {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return null;
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: GOOGLE_CLIENT_ID,
      }),
    });
    const data = await response.json();
    if (data && data.access_token) {
      saveDriveToken(data.access_token);
      return data.access_token;
    }
  } catch (e) {}
  return null;
}

export async function refreshDriveToken() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    let token = await refreshTokenGrant();
    if (!token) token = await silentGisRefresh();
    if (token) {
      try {
        window.dispatchEvent(new CustomEvent('drive-token-refreshed', { detail: { token } }));
      } catch (e) {}
    }
    return token;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

// Видимий consent для отримання нового scope. Викликається коли silent refresh
// не може отримати токен з новими scope (наприклад, після зміни DRIVE_SCOPE).
// Показує користувачу Google consent screen.
export function forceConsentRefresh() {
  return new Promise((resolve) => {
    try {
      if (!window.google?.accounts?.oauth2) { resolve(null); return; }
      const client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        prompt: 'consent',
        callback: (resp) => {
          if (resp && resp.access_token) {
            saveDriveToken(resp.access_token);
            try {
              window.dispatchEvent(new CustomEvent('drive-token-refreshed', { detail: { token: resp.access_token } }));
            } catch (e) {}
            resolve(resp.access_token);
          } else {
            resolve(null);
          }
        },
        error_callback: () => resolve(null),
      });
      client.requestAccessToken({ prompt: 'consent' });
    } catch (e) {
      resolve(null);
    }
  });
}

// P3 (Фаза B, 20.05.2026) — explicit timeout усіх Drive-запитів.
// Один сенс (правило #11): "fetch до Drive НЕ висить довше DRIVE_TIMEOUT_MS;
// якщо мережа втратила пакет — AbortError, видима помилка нагору".
//
// Корінь: жоден з ~50 driveRequest викликів у системі (uploadBytes/readBytes/
// writeRegistry/...) не мав explicit timeout. На повільній або нестабільній
// мережі це означало невидимі багатогодинні зависання (наприклад, при втраті
// з'єднання на планшеті браузер тримає сокет до десятків хвилин).
//
// 60с — стандарт для Drive multipart upload (одне фінальне завантаження
// ~MB). Caller може override через options.timeoutMs (наприклад, для дуже
// великих файлів) або options.signal (зовнішній контроль скасування —
// signal має пріоритет, timeoutMs ігнорується).
export const DRIVE_TIMEOUT_MS = 60_000;

function buildTimeoutSignal(timeoutMs) {
  if (typeof AbortController !== 'function') return { signal: null, clear: () => {} };
  const ctrl = new AbortController();
  const id = setTimeout(() => {
    try {
      ctrl.abort(new DOMException('Drive request timeout', 'AbortError'));
    } catch {
      ctrl.abort();                                 // fallback для старих браузерів
    }
  }, timeoutMs);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
}

// Єдиний wrapper для всіх запитів до Google Drive API.
// На 401 — автоматично оновлює токен і повторює запит один раз.
export async function driveRequest(url, options = {}) {
  let token = getDriveToken();
  const timeoutMs = options.timeoutMs ?? DRIVE_TIMEOUT_MS;

  // makeRequest повертає {response, clear} — clear скасовує внутрішній
  // timeout-таймер після завершення (успіх чи помилка fetch). Якщо caller
  // дав свій signal — clear = no-op (caller сам відповідає за life-cycle).
  const makeRequest = async (t) => {
    const headers = { ...(options.headers || {}) };
    if (t) headers.Authorization = `Bearer ${t}`;
    let signal = options.signal;
    let clear = () => {};
    if (!signal) {
      const built = buildTimeoutSignal(timeoutMs);
      signal = built.signal;
      clear = built.clear;
    }
    const opts = { ...options, headers };
    if (signal) opts.signal = signal;
    delete opts.timeoutMs;                          // не передавати у fetch
    try {
      const response = await fetch(url, opts);
      return { response, clear };
    } catch (err) {
      clear();                                      // cleanup на throw
      throw err;
    }
  };

  let r = await makeRequest(token);
  let response = r.response;
  r.clear();                                        // успіх — таймер геть

  if (response.status === 401) {
    const fresh = await refreshDriveToken();
    if (!fresh) return response;
    r = await makeRequest(fresh);
    response = r.response;
    r.clear();
  }

  return response;
}
