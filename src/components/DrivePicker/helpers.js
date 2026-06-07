// ── DrivePicker · helpers (TASK 4 · етапи B/B2) ─────────────────────────────
// Спільні константи і чисті хелпери винесеного Drive-пікера (правило #8: лише
// id-фільтри у q=, нуль кирилиці — діє у самих компонентах, не тут).

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const PAGE_LIMIT = 100;

// Які джерела показувати у SourceSwitcher (за замовчуванням — усі три).
export const DEFAULT_SOURCES = ['myDrive', 'sharedWithMe', 'sharedDrives'];

// filterForPicker — що показувати у списку залежно від режиму вибору.
//   selectionMode 'single' → нічого не ховаємо (усі файли+папки клікабельні).
//   selectionMode 'multi'  → залежить від multiFilter:
//       'all'    → нічого не ховаємо (мультивибір будь-яких файлів — режим DP);
//       'images' → лишаємо лише папки + зображення (режим склейки фото).
// B2: раніше фільтр був хардкодом «лише зображення» під selectionMode
// 'multi-images'. Тепер це окремий проп multiFilter (правило #11 — один сенс
// на параметр: selectionMode=скільки обираємо, multiFilter=які файли).
export function filterForPicker(items, selectionMode, multiFilter) {
  if (!items || selectionMode !== 'multi' || multiFilter !== 'images') return items;
  return items.filter((item) => {
    if (item.mimeType === FOLDER_MIME) return true;
    if (typeof item.mimeType === 'string' && item.mimeType.startsWith('image/')) return true;
    // HEIC: Drive часом повертає image/heic як 'image/heic' (стандарт), або
    // 'image/heif' (iOS). Також /\.heic$/ по name як fallback.
    if (typeof item.name === 'string' && /\.(heic|heif)$/i.test(item.name)) return true;
    return false;
  });
}

// Українська плюральна форма: 1 → "ня", 2-4 → "ня", 5+ → "ь", 0 → "ь".
export function multiPlural(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 0) return 'ь';
  if (mod10 === 1 && mod100 !== 11) return 'ня';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'ня';
  return 'ь';
}
