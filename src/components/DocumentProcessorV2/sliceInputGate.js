// ── ВОРОТА ВХОДУ ДОРОГИ НАРІЗКИ (TASK A1 · Частина A) ────────────────────────
// Єдиний сенс цього модуля: пропустити у нарізку РІВНО один вид входу —
// сканований/сфотографований PDF (растрові сторінки, БЕЗ текстового шару).
// Усе інше (не-PDF як Word; цифровий PDF із текстовим шаром) завертається з
// підказкою увімкнути «Просто додати файли». Це закриває дві діри входу:
//   (1) не-PDF проїжджав у стрім-мотор → тихий крах «No PDF header»;
//   (2) цифровий PDF марно ганяв Document AI.
// Скоуп — ВИКЛЮЧНО дорога нарізки. Склейка / просто-додати / розпак сюди не
// заходять і воріт не проходять (наскрізний інваріант A1 §2-bis).
//
// Дві перевірки, у порядку дешевизни:
//   1) СИНХРОННА за типом: будь-який не-PDF серед файлів → завернути (нуль I/O).
//   2) АСИНХРОННИЙ peek текстового шару: зазирнути в перші ~3 сторінки PDF; якщо
//      середня к-сть символів/стор. ≥ порога → цифровий (має текст) → завернути.
//
// FAIL-OPEN: якщо peek кинув (битий PDF / не вдалось визначити) — НЕ блокуємо,
// пускаємо у нарізку (краще пустити легітимний скан, ніж заблокувати том).
// ВИНЯТОК: 401/403 Drive під час підкачки — повертаємо drive_auth (правило #8),
// не падаємо мовчки.

// Скільки перших сторінок зазирати — дешево, не весь том (на 300-стор. томі
// повний прохід дорогий; нам вистачає голови документа).
const PEEK_PAGES = 3;

// Поріг евристики «має текстовий шар»: середня к-сть символів на зазирнуту
// сторінку. Дзеркало ocr/pdfjsLocal.js (avgChars < 200 → скан; інакше цифровий).
const TEXT_LAYER_AVG_CHARS = 200;

const MSG_NON_PDF =
  "Нарізка приймає лише сканований PDF. Для Word / інших форматів увімкніть „Просто додати файли”";
const MSG_DIGITAL_PDF =
  "Цей PDF має текстовий шар (цифровий) — він не для нарізки. Для додавання як є увімкніть „Просто додати файли”";
const MSG_DRIVE_AUTH = "Сесію Drive завершено — перепідключіться";

// isPdfLike — чи це PDF за mime або розширенням (дзеркало index.jsx:407).
function isPdfLike({ name, mime }) {
  return (typeof mime === 'string' && mime === 'application/pdf')
    || /\.pdf$/i.test(String(name || ''));
}

// defaultPeekPdf — реальний peek через pdf.js. Динамічний import, щоб модуль не
// тягнув pdfjs, поки peek справді не потрібен (і щоб тести з ін'єкцією peekPdf
// ніколи не торкались pdfjs). Повертає { avgChars, pageCount } по перших
// PEEK_PAGES сторінках. Кидає — викликач трактує як fail-open.
async function defaultPeekPdf(bytes) {
  const pdfjsLib = await import('pdfjs-dist');
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
  const pageCount = pdf.numPages;
  const peekCount = Math.min(PEEK_PAGES, pageCount);
  let chars = 0;
  for (let i = 1; i <= peekCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    chars += content.items.map((it) => it.str).join(' ').trim().length;
  }
  return { avgChars: peekCount > 0 ? chars / peekCount : 0, pageCount };
}

// loadPeekBytes — байти для peek. Device-файл: уже в пам'яті (raw File/Blob) →
// читаємо локально. Drive-source (лише driveId): підкачуємо через
// driveRequest(alt=media). 401/403 → кидаємо AUTH-помилку (правило #8).
async function loadPeekBytes(file, { driveRequest }) {
  if (file.raw && typeof file.raw.arrayBuffer === 'function') {
    return await file.raw.arrayBuffer();
  }
  if (file.driveId && typeof driveRequest === 'function') {
    const res = await driveRequest(
      `https://www.googleapis.com/drive/v3/files/${file.driveId}?alt=media`,
    );
    if (res.status === 401 || res.status === 403) {
      const err = new Error(`Drive auth ${res.status}`);
      err.code = 'AUTH';
      throw err;
    }
    if (!res.ok) throw new Error(`Drive HTTP ${res.status}`);
    return await res.arrayBuffer();
  }
  return null; // ні байтів, ні id — peek неможливий (fail-open вище)
}

/**
 * sliceInputGate — рішення «пускати чи завернути» для дороги нарізки.
 *
 * @param {Array<{name:string, mime?:string, raw?:Blob|File, driveId?:string}>} files
 * @param {{ driveRequest?:Function, peekPdf?:Function }} deps
 * @returns {Promise<{allow:boolean, reason:string, message?:string}>}
 *   reason: 'ok' | 'non_pdf' | 'digital_pdf' | 'drive_auth' | 'gate_error'
 */
export async function sliceInputGate(files, deps = {}) {
  const { driveRequest, peekPdf = defaultPeekPdf } = deps;
  const list = Array.isArray(files) ? files : [];

  // 1) СИНХРОННА перевірка за типом — найдешевша, нуль I/O.
  for (const f of list) {
    if (!isPdfLike({ name: f.name, mime: f.mime })) {
      return { allow: false, reason: 'non_pdf', message: MSG_NON_PDF };
    }
  }

  // 2) АСИНХРОННИЙ peek текстового шару по кожному PDF-кандидату.
  for (const f of list) {
    let bytes;
    try {
      bytes = await loadPeekBytes(f, { driveRequest });
    } catch (e) {
      if (e?.code === 'AUTH') {
        // Drive-сесія завершилась — не мовчазний крах, friendly підказка.
        return { allow: false, reason: 'drive_auth', message: MSG_DRIVE_AUTH };
      }
      // Інша помилка підкачки — fail-open для цього файлу (краще пустити).
      console.warn('[sliceInputGate] peek bytes failed (fail-open):', e?.message || e);
      continue;
    }
    if (!bytes) continue; // нічим зазирати — fail-open
    try {
      const { avgChars } = await peekPdf(bytes);
      if (avgChars >= TEXT_LAYER_AVG_CHARS) {
        return { allow: false, reason: 'digital_pdf', message: MSG_DIGITAL_PDF };
      }
    } catch (e) {
      // Битий/нерозбірливий PDF — НЕ блокуємо (краще пустити скан, ніж том).
      console.warn('[sliceInputGate] peek parse failed (fail-open):', e?.message || e);
    }
  }

  return { allow: true, reason: 'ok' };
}

export const __test = { isPdfLike, PEEK_PAGES, TEXT_LAYER_AVG_CHARS, MSG_NON_PDF, MSG_DIGITAL_PDF, MSG_DRIVE_AUTH };
