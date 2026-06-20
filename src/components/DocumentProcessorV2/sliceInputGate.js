// ── ВОРОТА ВХОДУ ДОРОГИ НАРІЗКИ (TASK A1 · Частина A) ────────────────────────
// Єдиний сенс цього модуля: пропустити у нарізку РІВНО один вид входу —
// сканований/сфотографований PDF (растрові сторінки, об'ємний файл). Усе інше
// (не-PDF як Word; малий PDF, схожий на текстовий/одиночний документ) завертається
// з підказкою вимкнути «Нарізати / склеїти» (= просто-додати). Це закриває дві діри входу:
//   (1) не-PDF проїжджав у стрім-мотор → тихий крах «No PDF header»;
//   (2) малий цифровий PDF марно ганяв Document AI.
// Скоуп — ВИКЛЮЧНО дорога нарізки. Склейка / просто-додати / розпак сюди не
// заходять і воріт не проходять (наскрізний інваріант A1 §2-bis).
//
// Детекція — за РОЗМІРОМ файлу (метадані {name, mime, size}), БЕЗ pdf.js /
// без завантажень / без async-peek. Чиста СИНХРОННА функція: peek текстового
// шару виявився крихким (ламав тести нарізки), тож евристика спростилась до
// дешевого і детермінованого порога розміру.
//
// FAIL-OPEN: якщо розмір невідомий (0/undefined — напр. Drive без метаданих) —
// НЕ блокуємо, пускаємо у нарізку (краще пустити, ніж блокувати наосліп).

// MIN_SLICE_BYTES — нижній поріг розміру PDF, нижче якого це майже напевно
// текстовий або одиночний документ, не вартий нарізки.
// experimental — review after 1 month
const MIN_SLICE_BYTES = 1024 * 1024;

const MSG_NON_PDF =
  "Нарізка приймає лише сканований PDF. Для Word / інших форматів вимкніть „Нарізати / склеїти”";
const MSG_TOO_SMALL =
  "Малий PDF — схоже текстовий або одиночний документ. Для додавання як є вимкніть „Нарізати / склеїти”";

// isPdfLike — чи це PDF за mime або розширенням (дзеркало index.jsx:407).
function isPdfLike({ name, mime }) {
  return (typeof mime === 'string' && mime === 'application/pdf')
    || /\.pdf$/i.test(String(name || ''));
}

/**
 * sliceInputGate — рішення «пускати чи завернути» для дороги нарізки.
 * СИНХРОННА чиста функція від метаданих файлів.
 *
 * @param {Array<{name:string, mime?:string, size?:number}>} files
 * @returns {{allow:boolean, reason:string, message?:string}}
 *   reason: 'ok' | 'non_pdf' | 'too_small'
 */
export function sliceInputGate(files) {
  const list = Array.isArray(files) ? files : [];

  // Перевіряємо КОЖЕН файл; перший, що не проходить — повертає verdict.
  for (const f of list) {
    // 1) не-PDF (за типом) → завернути.
    if (!isPdfLike({ name: f.name, mime: f.mime })) {
      return { allow: false, reason: 'non_pdf', message: MSG_NON_PDF };
    }
    // 3) розмір невідомий (0/undefined) → fail-open (пускаємо, не блокуємо наосліп).
    const size = Number(f.size);
    if (!size) continue;
    // 2) PDF, але замалий → завернути.
    if (size < MIN_SLICE_BYTES) {
      return { allow: false, reason: 'too_small', message: MSG_TOO_SMALL };
    }
  }

  // 4) інакше — усе пройшло.
  return { allow: true, reason: 'ok' };
}

export const __test = { isPdfLike, MIN_SLICE_BYTES, MSG_NON_PDF, MSG_TOO_SMALL };
