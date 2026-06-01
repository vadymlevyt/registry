// ── MARKDOWN RENDERER (легкий, без зовнішніх залежностей) ────────────────────
// TASK 3.1: viewer показує очищений .md (cleanTextService) як форматований
// документ. Власний мінімальний MD→HTML — НЕ додаємо npm-залежність (як
// nanoid у проєкті). Покриває те, що генерує AI-поліш: заголовки, жирний/
// курсив, inline-код, списки (марковані/нумеровані), GFM-таблиці, горизонтальні
// роздільники, абзаци. ВЕСЬ текст екранується ПЕРЕД розміткою (захист від
// HTML-інʼєкції з тексту документа).

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Inline-розмітка на ВЖЕ екранованому тексті: **жирний**, *курсив*, `код`.
function inline(escaped) {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function renderTable(headerLine, bodyLines) {
  const headers = splitRow(headerLine);
  const head = `<thead><tr>${headers.map((h) => `<th>${inline(escapeHtml(h))}</th>`).join('')}</tr></thead>`;
  const rows = bodyLines.map((ln) => {
    const cells = splitRow(ln);
    return `<tr>${cells.map((c) => `<td>${inline(escapeHtml(c))}</td>`).join('')}</tr>`;
  }).join('');
  return `<table class="md-table">${head}<tbody>${rows}</tbody></table>`;
}

// MD → HTML. Блоковий парсинг по рядках.
export function markdownToHtml(md) {
  // Прибрати HTML-коментарі (підказки конденсатора, якщо AI лишив).
  const text = String(md || '').replace(/<!--[\s\S]*?-->/g, '');
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inline(escapeHtml(paragraph.join(' ')))}</p>`);
      paragraph = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { flushParagraph(); i++; continue; }

    // Горизонтальний роздільник.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph(); out.push('<hr />'); i++; continue;
    }

    // Заголовки.
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(escapeHtml(heading[2].trim()))}</h${level}>`);
      i++; continue;
    }

    // GFM-таблиця: рядок з | + наступний рядок-роздільник.
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushParagraph();
      const headerLine = trimmed;
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim()) {
        body.push(lines[i].trim()); i++;
      }
      out.push(renderTable(headerLine, body));
      continue;
    }

    // Марковані списки.
    if (/^[-*•]\s+/.test(trimmed)) {
      flushParagraph();
      const items = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, '')); i++;
      }
      out.push(`<ul>${items.map((it) => `<li>${inline(escapeHtml(it))}</li>`).join('')}</ul>`);
      continue;
    }

    // Нумеровані списки.
    if (/^\d+[.)]\s+/.test(trimmed)) {
      flushParagraph();
      const items = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, '')); i++;
      }
      out.push(`<ol>${items.map((it) => `<li>${inline(escapeHtml(it))}</li>`).join('')}</ol>`);
      continue;
    }

    // Звичайний рядок — накопичуємо в абзац.
    paragraph.push(trimmed);
    i++;
  }
  flushParagraph();
  return out.join('\n');
}

export function MarkdownRenderer({ text }) {
  return (
    <div
      className="document-viewer__markdown"
      // Контент екранується у markdownToHtml перед розміткою — безпечно.
      dangerouslySetInnerHTML={{ __html: markdownToHtml(text) }}
    />
  );
}
