import { useEffect, useRef, useState } from 'react';
import { FileText, RefreshCw, AlertTriangle, Sparkles } from 'lucide-react';
import { Button } from '../UI';
import { ICON_SIZE } from '../UI/icons.js';
import { getCleanOrRawText, getVariantMarkdown, localizeOcrError } from '../../services/ocrService.js';
import { PdfRenderer } from './PdfRenderer.jsx';
import { DocxRenderer } from './DocxRenderer.jsx';
import { HtmlRenderer } from './HtmlRenderer.jsx';
import { MarkdownRenderer } from './MarkdownRenderer.jsx';
import { countMarks, stripMarks, scrollToMark } from './attentionMarks.js';

// Людський лейбл AI-режиму (для заглушки/повідомлень).
const VARIANT_LABELS = { clean: 'Чистий', digest: 'Конспект' };

// Груба оцінка часу генерації за обсягом (~8 стор./хв Haiku-пачка). Лише для
// підпису кнопки «~N хв» — не контракт, орієнтир для адвоката.
function estimateMinutes(document) {
  const pages = Number(document?.pageCount) || 0;
  if (pages <= 0) return null;
  return Math.max(1, Math.ceil(pages / 8));
}

/**
 * Контентна частина Viewer'а.
 *
 * Логіка вибору рендеру:
 *   - mode='scan' — обираємо власний рендер за типом файлу:
 *       PDF (searchable і scanned) → PdfRenderer (pdfjs viewer iframe). Один
 *         тулбар, одне виділення, однаковий UX для всіх PDF (мікро-TASK 5.2-fix5)
 *       зображення → <img> з Drive
 *       DOCX → DocxRenderer (mammoth → HTML)
 *       HTML → HtmlRenderer (charset detection + iframe srcdoc)
 *       інші (TXT, MD, RTF, XLSX, ODT) → Drive iframe як fallback (нативного
 *         рендеру для них поза скопом TASK 5.2)
 *   - mode='text' → плашка з extracted OCR-текстом (для scanned)
 *
 * Принцип: .txt у 02_ОБРОБЛЕНІ — ТІЛЬКИ для агента і пошуку. Власні рендери
 * НЕ використовують .txt як fallback при помилках. Помилка → empty state.
 *
 * useEffect для text-режиму залежить від `document.lastOcrAt` — після успішного
 * перерозпізнавання CaseDossier викликає update_document({ lastOcrAt: now }),
 * що ре-фетчить текст.
 */
export function DocumentViewerContent({
  document,
  mode,
  documentRenderMode = 'scan',
  caseData,
  onReprocess,
  exactMarkdown,
  exactStatus,
  generating,
  streamingText,
  onGenerate,
  canGenerate,
  onLoadAttentionNotes,
  onRemoveAllMarks,
}) {
  // Таб «Скан»/«Документ» — нативний рендер оригіналу (scanned/inline) або
  // текстова плашка (рідкісний non-inline searchable).
  if (mode === 'scan') {
    return documentRenderMode === 'text'
      ? <TextContent document={document} caseData={caseData} onReprocess={onReprocess} />
      : <ScanContent document={document} />;
  }
  if (mode === 'exact') {
    return <ExactContent markdown={exactMarkdown} status={exactStatus} />;
  }
  if (mode === 'clean' || mode === 'digest') {
    return (
      <VariantContent
        document={document}
        caseData={caseData}
        mode={mode}
        generating={generating}
        streamingText={streamingText}
        onGenerate={onGenerate}
        canGenerate={canGenerate}
        onLoadAttentionNotes={onLoadAttentionNotes}
        onRemoveAllMarks={onRemoveAllMarks}
      />
    );
  }
  return (
    <TextContent
      document={document}
      caseData={caseData}
      onReprocess={onReprocess}
    />
  );
}

/**
 * VariantContent — AI-режими Чистий (`.clean.md`) / Конспект (`.digest.md`).
 *
 * Три стани (V2-B.2/3):
 *   1. generating — спінер «Очищаю...» (AI триває; прогрес-стрімінг — V2-B2).
 *   2. не згенеровано (document.variants[mode] нема) — ЗАГЛУШКА з кнопкою
 *      «Згенерувати ✨ (~N хв)». 🔴 AI стартує ВИКЛЮЧНО по цій кнопці, НЕ по
 *      перемиканні таба (parent §V2-B.2).
 *   3. готово — миттєвий показ збереженого .md через MarkdownRenderer, БЕЗ
 *      повторного AI. Конспект несе badge «⚠ переказ, не дослівно».
 */
function VariantContent({ document, caseData, mode, generating, streamingText, onGenerate, canGenerate, onLoadAttentionNotes, onRemoveAllMarks }) {
  const label = VARIANT_LABELS[mode] || 'Варіант';
  const ready = !!(document?.variants && document.variants[mode]);
  // Підсвітки уваги — ВИКЛЮЧНО Чистий (parent рішення; НЕ Конспект/Точний/Скан).
  const isClean = mode === 'clean';

  const [text, setText] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // V2-C — стан панелі поміток (лише Чистий). showMarks керує CSS-класом
  // (миттєво, нічого не зберігаємо); notes — причини з extended (порядок =
  // порядок ==міток==); markdownRef — ціль scroll-навігації.
  const [panelOpen, setPanelOpen] = useState(false);
  const [showMarks, setShowMarks] = useState(true);
  const [notes, setNotes] = useState([]);
  const [removing, setRemoving] = useState(false);
  const markdownRef = useRef(null);

  const variantStamp = document?.variants ? document.variants[mode] : null;
  const markCount = isClean ? countMarks(text) : 0;

  useEffect(() => {
    // Поки генерується або ще не згенеровано — нічого не тягнемо.
    if (generating || !ready) {
      setText(null);
      setLoading(false);
      setError(null);
      return undefined;
    }
    const subFolders = caseData?.storage?.subFolders;
    if (!document.driveId || !subFolders?.['02_ОБРОБЛЕНІ']) {
      setLoading(false);
      setText(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setText(null);

    const rawName = document.originalName || document.name || '';
    const normalizedName = typeof rawName.normalize === 'function'
      ? rawName.normalize('NFC')
      : rawName;
    const file = {
      id: document.driveId,
      name: normalizedName,
      mimeType: document.mimeType || 'application/pdf',
      subFolders,
    };

    getVariantMarkdown(file, mode)
      .then(md => {
        if (cancelled) return;
        setText(md || null);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(localizeOcrError(err.code) || err.message || 'Не вдалось завантажити варіант');
        setLoading(false);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.id, document.driveId, mode, ready, variantStamp, generating, caseData?.storage?.subFolders]);

  // Скидаємо UI-стан панелі при зміні документа/режиму (панель не «прилипає»).
  useEffect(() => {
    setPanelOpen(false);
    setShowMarks(true);
    setNotes([]);
  }, [document.id, mode]);

  // Причини ==міток== з extended — лише коли Чистий готовий і має мітки.
  // Порядок записів = порядок міток (parent §V2-C.3). Помилка → порожньо
  // (count з .clean.md лишається, навігація працює без текстів причин).
  useEffect(() => {
    if (!isClean || !ready || markCount === 0 || typeof onLoadAttentionNotes !== 'function') {
      return undefined;
    }
    let cancelled = false;
    Promise.resolve(onLoadAttentionNotes(document))
      .then(loaded => { if (!cancelled) setNotes(Array.isArray(loaded) ? loaded : []); })
      .catch(() => { if (!cancelled) setNotes([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClean, ready, markCount, document.id, variantStamp, onLoadAttentionNotes]);

  // «Зняти всі назавжди»: стрип == з тексту → re-save .clean.md + очистити
  // extended (через батьків onRemoveAllMarks) → локально показуємо стрипнутий
  // текст (markCount→0 → чип зникає). Чистий-варіант лишається (variants.clean).
  const handleRemoveAll = async () => {
    if (removing || typeof onRemoveAllMarks !== 'function' || !text) return;
    const stripped = stripMarks(text);
    setRemoving(true);
    try {
      const ok = await onRemoveAllMarks(document, stripped);
      if (ok !== false) {
        setText(stripped);
        setNotes([]);
        setPanelOpen(false);
      }
    } finally {
      setRemoving(false);
    }
  };

  if (generating) {
    // V2-B2 — стрім: щойно з'явились перші токени, показуємо markdown що НАРОСТАЄ
    // (throttled рендер вище за течією). Доки токенів нема — спінер «Очищаю…».
    // Підсвітки/чип (V2-C) — лише на ФІНАЛЬНОМУ тексті (ready), не під час стріму.
    if (streamingText && streamingText.trim()) {
      return (
        <div className="document-viewer__content document-viewer__content--text">
          <div className="document-viewer__variant-badge document-viewer__variant-badge--streaming" role="status">
            {`${label} генерується…`}
          </div>
          <MarkdownRenderer text={streamingText} />
        </div>
      );
    }
    return (
      <div className="document-viewer__loading">
        <RefreshCw size={ICON_SIZE.md} />
        <span>Очищаю…</span>
      </div>
    );
  }

  if (!ready) {
    const minutes = estimateMinutes(document);
    const hint = minutes ? `~${minutes} хв` : 'кілька хв';
    return (
      <div className="document-viewer__empty-state">
        <Sparkles size={48} />
        <p>{label} ще не створено</p>
        <p className="document-viewer__empty-state-detail">
          {mode === 'digest'
            ? 'Стислий переказ для швидкого читання (AI). Не дослівно.'
            : 'Дослівний текст без OCR-сміття (AI).'}
        </p>
        {canGenerate && (
          <Button
            variant="primary"
            size="sm"
            icon={<Sparkles size={ICON_SIZE.sm} />}
            onClick={() => onGenerate && onGenerate(mode)}
          >
            {`Згенерувати ✨ (${hint})`}
          </Button>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="document-viewer__loading">
        <RefreshCw size={ICON_SIZE.md} />
        <span>Завантаження…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="document-viewer__empty-state">
        <AlertTriangle size={48} />
        <p>Не вдалось завантажити {label.toLowerCase()}</p>
        <p className="document-viewer__empty-state-detail">{error}</p>
      </div>
    );
  }

  if (!text) {
    return (
      <div className="document-viewer__empty-state">
        <FileText size={48} />
        <p>Варіант недоступний</p>
        <p className="document-viewer__empty-state-detail">
          Файл варіанту не знайдено — спробуйте згенерувати заново.
        </p>
        {canGenerate && (
          <Button
            variant="secondary"
            size="sm"
            icon={<Sparkles size={ICON_SIZE.sm} />}
            onClick={() => onGenerate && onGenerate(mode)}
          >
            Згенерувати заново
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="document-viewer__content document-viewer__content--text">
      {mode === 'digest' && (
        <div className="document-viewer__variant-badge" role="note">
          ⚠ переказ, не дослівно
        </div>
      )}
      {isClean && markCount > 0 && (
        <CleanHighlights
          markCount={markCount}
          notes={notes}
          panelOpen={panelOpen}
          showMarks={showMarks}
          removing={removing}
          onTogglePanel={() => setPanelOpen(o => !o)}
          onToggleShow={() => setShowMarks(s => !s)}
          onNavigate={n => scrollToMark(markdownRef.current, n)}
          onRemoveAll={typeof onRemoveAllMarks === 'function' ? handleRemoveAll : null}
        />
      )}
      <div
        ref={markdownRef}
        className={isClean && !showMarks ? 'document-viewer__markdown--marks-hidden' : undefined}
      >
        <MarkdownRenderer text={text} />
      </div>
    </div>
  );
}

/**
 * CleanHighlights — чип «N поміток» + панель (V2-C, ВИКЛЮЧНО режим Чистий).
 * Презентаційний: count/notes/стан приходять згори (VariantContent). Чип —
 * ЄДИНИЙ видимий елемент згорнуто; тап розгортає панель: перемикач показу
 * (CSS), список пунктів ↔ data-mark за порядком (клік = scroll+пульс),
 * «Зняти всі назавжди». Лише design-токени/спільні класи, без CSS-островів.
 */
function CleanHighlights({ markCount, notes, panelOpen, showMarks, removing, onTogglePanel, onToggleShow, onNavigate, onRemoveAll }) {
  return (
    <div className="document-viewer__attention">
      <button
        type="button"
        className="document-viewer__attention-chip"
        onClick={onTogglePanel}
        aria-expanded={panelOpen}
      >
        <AlertTriangle size={ICON_SIZE.sm} />
        {`${markCount} ${pluralizeMarks(markCount)}`}
      </button>

      {panelOpen && (
        <div className="document-viewer__attention-panel" role="region" aria-label="Помітки уваги">
          <label className="document-viewer__attention-toggle">
            <input type="checkbox" checked={showMarks} onChange={onToggleShow} />
            Підсвічувати в тексті
          </label>

          <ol className="document-viewer__attention-list">
            {Array.from({ length: markCount }).map((_, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="document-viewer__attention-item"
                  onClick={() => onNavigate(i + 1)}
                >
                  <span className="document-viewer__attention-num">{i + 1}.</span>
                  <span>{(notes[i] && notes[i].note) || 'Перейти до позначеного місця'}</span>
                </button>
              </li>
            ))}
          </ol>

          {onRemoveAll && (
            <button
              type="button"
              className="document-viewer__attention-clear"
              onClick={onRemoveAll}
              disabled={removing}
            >
              {removing ? 'Знімаю…' : 'Зняти всі назавжди'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Українська множина для «помітка» (1 помітка / 2 помітки / 5 поміток).
function pluralizeMarks(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'помітка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'помітки';
  return 'поміток';
}

/**
 * Режим «Точний» (V2-A1) — дослівний показ тексту скана з layout, зібраний
 * на льоту детермінованим конденсатором (markdown приходить готовим з
 * useExactLayout). БЕЗ AI, БЕЗ зберігання. Опція показується лише коли
 * status==='ready', тож loading/unavailable — захисні фолбеки (зміна
 * документа під час вибраного режиму, тощо), не валять в'ювер.
 */
function ExactContent({ markdown, status }) {
  if (status === 'loading') {
    return (
      <div className="document-viewer__loading">
        <RefreshCw size={ICON_SIZE.md} />
        <span>Збираємо точний текст...</span>
      </div>
    );
  }
  if (status !== 'ready' || !markdown) {
    return (
      <div className="document-viewer__empty-state">
        <AlertTriangle size={48} />
        <p>Точний текст недоступний</p>
        <p className="document-viewer__empty-state-detail">
          Для цього документа немає збереженого layout.
        </p>
      </div>
    );
  }
  return (
    <div className="document-viewer__content document-viewer__content--text">
      <MarkdownRenderer text={markdown} />
    </div>
  );
}

function getExtension(name) {
  if (!name) return '';
  const m = /\.([^.]+)$/.exec(String(name).toLowerCase());
  return m ? m[1] : '';
}

// wasConvertedToPdf — driveId вказує на конвертований PDF, а не на оригінальний
// файл за originalName. Після TASK A converterService приводить DOCX/HTML/image
// у PDF і вантажить на Drive, оригінальний MIME записує у doc.originalMime
// (passthrough PDF теж записує 'application/pdf' — тому виключаємо його явно).
//
// Один сенс: «файл за driveId — це конвертований PDF, рендеримо як PDF».
// Без цього прапора Viewer розпізнавав конвертовані DOCX як DOCX за originalName
// і кидав mammoth у render PDF-блоба — «Can't find end of central directory».
//
// 🔑 ТІЛЬКИ формати, які converterService РЕАЛЬНО конвертує в PDF (docx/html/
// image). Старий .doc, .xlsx, .zip тощо — PASSTHROUGH: driveId = оригінал, НЕ
// PDF. Раніше будь-який non-pdf originalMime хибно вважався «конвертованим» →
// .doc рендерився як PDF (PdfRenderer) і не показувався взагалі. Тепер
// passthrough-типи падають у каскад нижче → Drive-iframe прев'ю (Google
// показує .doc/.xlsx нативно).
//
// Legacy документи (до TASK A) мають originalMime === null → false → каскад
// isPdf/isDocx/isHtml працює як раніше.
const CONVERTED_SOURCE_MIMES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'text/html',
  'application/xhtml+xml',
];
function wasConvertedToPdf(doc) {
  const originalMime = (doc.originalMime || '').toLowerCase();
  if (!originalMime) return false;
  if (originalMime === 'application/pdf') return false; // passthrough — не конвертували
  if (originalMime.startsWith('image/')) return true;   // image → PDF (imageToPdf)
  return CONVERTED_SOURCE_MIMES.includes(originalMime); // лише docx/html, решта passthrough
}

function isPdf(doc) {
  if (wasConvertedToPdf(doc)) return true; // driveId — render PDF з DOCX/HTML/image
  const mime = (doc.mimeType || '').toLowerCase();
  const ext = getExtension(doc.originalName || doc.name);
  return mime === 'application/pdf' || ext === 'pdf';
}

function isDocx(doc) {
  if (wasConvertedToPdf(doc)) return false; // оригінал DOCX у originalDriveId — не render path
  const mime = (doc.mimeType || '').toLowerCase();
  const ext = getExtension(doc.originalName || doc.name);
  return (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  );
}

function isHtml(doc) {
  if (wasConvertedToPdf(doc)) return false; // HTML оригіналу немає, driveId — PDF
  const mime = (doc.mimeType || '').toLowerCase();
  const ext = getExtension(doc.originalName || doc.name);
  return (
    mime === 'text/html' ||
    mime === 'application/xhtml+xml' ||
    ext === 'html' ||
    ext === 'htm' ||
    ext === 'xhtml' ||
    ext === 'xht'
  );
}

function ScanContent({ document }) {
  if (!document.driveId) {
    return (
      <div className="document-viewer__empty-state">
        <AlertTriangle size={48} />
        <p>Файл не прикріплено до Drive</p>
        <p className="document-viewer__empty-state-detail">
          Прикріпіть файл щоб переглянути зміст.
        </p>
      </div>
    );
  }

  // isImage — нативне зображення (документ доданий без TASK A конвертації в PDF).
  // Після TASK A зображення конвертуються у PDF, тому wasConvertedToPdf
  // запобігає <img> гілці для тих документів — рендеримо їх як PDF.
  const isImage = !wasConvertedToPdf(document) && (document.mimeType || '').startsWith('image/');
  if (isImage) {
    return (
      <div className="document-viewer__content document-viewer__content--scan">
        <img
          className="document-viewer__image"
          src={`https://drive.google.com/uc?export=view&id=${document.driveId}`}
          alt={document.name}
        />
      </div>
    );
  }

  // Усі PDF (searchable і scanned) — pdfjs viewer iframe. Одноманітний UI:
  // той самий тулбар, та сама поведінка zoom/scroll. Виділення тексту в
  // scanned PDF буде порожнім (немає textLayer бо немає ембедденого тексту) —
  // це очікувано: для роботи з текстом сканованого документа адвокат
  // перемикається на режим Текст і працює з extracted OCR-плашкою.
  if (isPdf(document)) {
    return <PdfRenderer driveId={document.driveId} name={document.name} />;
  }
  if (isDocx(document)) {
    return <DocxRenderer driveId={document.driveId} />;
  }
  if (isHtml(document)) {
    return <HtmlRenderer driveId={document.driveId} />;
  }

  // Інші inline-renderable (TXT, MD, RTF, CSV, XLSX, PPTX, ODT) — Drive iframe.
  // Власні рендери для цих типів — поза скопом мікро-TASK 5.2.
  return (
    <div className="document-viewer__content document-viewer__content--scan">
      <iframe
        className="document-viewer__iframe"
        src={`https://drive.google.com/file/d/${document.driveId}/preview`}
        title={document.name}
        allow="autoplay"
      />
    </div>
  );
}

function TextContent({ document, caseData, onReprocess }) {
  const [text, setText] = useState(null);
  const [textFormat, setTextFormat] = useState('txt');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setText(null);

    const subFolders = caseData?.storage?.subFolders;

    if (!document.driveId || !subFolders?.['02_ОБРОБЛЕНІ']) {
      setLoading(false);
      return undefined;
    }

    // Імена файлів з Drive повертаються в NFC-нормалізованому Unicode.
    // ocrService нормалізує сам через name='...' порівняння, але для
    // надійності передаємо normalize'ed name (важливо для українських
    // символів які можуть бути у NFD з iOS).
    const rawName = document.originalName || document.name || '';
    const normalizedName = typeof rawName.normalize === 'function'
      ? rawName.normalize('NFC')
      : rawName;

    const file = {
      id: document.driveId,
      name: normalizedName,
      mimeType: document.mimeType || 'application/pdf',
      subFolders,
    };

    // TASK 3.1 — спочатку очищений .md, інакше сирий .txt (getCleanOrRawText).
    getCleanOrRawText(file)
      .then(result => {
        if (cancelled) return;
        setText(result?.text || null);
        setTextFormat(result?.format || 'txt');
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(localizeOcrError(err.code) || err.message || 'Не вдалось завантажити текст');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.id, document.driveId, document.lastOcrAt, document.cleanedAt, caseData?.storage?.subFolders]);

  if (loading) {
    return (
      <div className="document-viewer__loading">
        <RefreshCw size={ICON_SIZE.md} />
        <span>Завантаження тексту...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="document-viewer__empty-state">
        <AlertTriangle size={48} />
        <p>Не вдалось завантажити текст</p>
        <p className="document-viewer__empty-state-detail">{error}</p>
      </div>
    );
  }

  if (!text) {
    const canReprocess = !!document.driveId && !!onReprocess;
    return (
      <div className="document-viewer__empty-state">
        <FileText size={48} />
        <p>Текст для цього документа ще не розпізнано</p>
        {canReprocess && (
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={ICON_SIZE.sm} />}
            onClick={() => onReprocess(document)}
          >
            Розпізнати зараз
          </Button>
        )}
      </div>
    );
  }

  // .md — рендеримо як форматований Markdown (TASK 3.1). .txt — як було (pre).
  return (
    <div className="document-viewer__content document-viewer__content--text">
      {textFormat === 'md'
        ? <MarkdownRenderer text={text} />
        : <pre className="document-viewer__text">{text}</pre>}
    </div>
  );
}
