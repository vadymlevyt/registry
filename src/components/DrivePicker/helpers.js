// ── DrivePicker · helpers (TASK 4 · етап B) ─────────────────────────────────
// Спільні константи і чисті хелпери винесеного Drive-пікера. Винос із
// AddDocumentModal.jsx без зміни поведінки (правило #8: лише id-фільтри у q=,
// нуль кирилиці — діє у самих компонентах, не тут).

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const PAGE_LIMIT = 100;

// У multi-images: фільтр items щоб залишити папки + image/* файли.
// Інші файли (PDF/DOCX) приховуються — у multi-merge режимі вони не релевантні.
export function filterForSelectionMode(items, selectionMode) {
  if (!items || selectionMode !== 'multi-images') return items;
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
