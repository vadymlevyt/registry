import { useState, useEffect } from 'react';
import { FileText, Image, AlignLeft, Wand2, ScrollText } from 'lucide-react';
import { DocumentViewerHeader } from './DocumentViewerHeader.jsx';
import { DocumentViewerContent } from './DocumentViewerContent.jsx';
import { DocumentViewerFooter } from './DocumentViewerFooter.jsx';
import { useExactLayout } from './useExactLayout.js';
import { defaultNatureForUI, inferNatureFromFile } from '../../services/detectDocumentNature.js';
import { isInlineRenderable } from '../../utils/documentTypes.js';
import './DocumentViewer.css';

const MODE_KEY_PREFIX = 'viewer_mode_';
const MODE_KEYS_INDEX = 'viewer_mode_index';
const MODE_KEYS_LIMIT = 100;

/**
 * buildViewerTabs — набір вкладок перемикача за типом документа (V2-B).
 *
 *   scanned    → [ Скан ] [ Точний? ] [ Чистий ✨ ] [ Конспект ✨ ]
 *   searchable → [ Документ ] [ Конспект ✨ ]
 *
 * «Точний» додається лише коли layout зібрався (exactReady) — як V2-A1.
 * AI-вкладки (Чистий/Конспект) видимі ЗАВЖДИ; `ready` = чи вже згенеровано
 * (document.variants[mode]) → визначає миттєвий показ .md vs заглушка
 * «Згенерувати». badge «переказ» на Конспекті — позначка «не дослівно».
 *
 * Чистий — лише scanned (OCR-сміття). Конспект — універсальний (scanned +
 * searchable: гарний searchable теж варто стиснути, parent §ТРИ РЕЖИМИ).
 *
 * @returns {Array<{ value, label, icon, ai?, badge?, ready? }>}
 */
export function buildViewerTabs({ isScanned, exactReady, variants }) {
  const v = variants || {};
  if (isScanned) {
    const tabs = [{ value: 'scan', label: 'Скан', icon: Image }];
    if (exactReady) tabs.push({ value: 'exact', label: 'Точний', icon: AlignLeft });
    tabs.push({ value: 'clean', label: 'Чистий', icon: Wand2, ai: true, ready: !!v.clean });
    tabs.push({ value: 'digest', label: 'Конспект', icon: ScrollText, ai: true, ready: !!v.digest, badge: 'переказ' });
    return tabs;
  }
  return [
    { value: 'scan', label: 'Документ', icon: FileText },
    { value: 'digest', label: 'Конспект', icon: ScrollText, ai: true, ready: !!v.digest, badge: 'переказ' },
  ];
}

/**
 * DocumentViewer — переглядач документа справи.
 *
 * Перемикач режимів (V2-B) — явні режими замість перехідного Скан/Точний/Текст:
 *   - scanned: Скан (оригінал-зображення) / Точний (live layout, 0 токенів) /
 *     Чистий (AI, дослівний, на вимогу) / Конспект (AI, переказ, на вимогу).
 *   - searchable: Документ (нативний рендер: PDF/DOCX/...) / Конспект (AI).
 *
 * 🔴 Перемикання вкладок ЗАВЖДИ безпечне/безкоштовне. Клік по незгенерованому
 * AI-табі лише показує заглушку з кнопкою «Згенерувати» — AI стартує ВИКЛЮЧНО
 * по натисканню кнопки (захист від випадкових витрат). Згенерований таб —
 * миттєвий показ збереженого .md без повторного AI.
 *
 * Контрольований компонент: батько (CaseDossier) тримає selectedDoc у власному
 * state і передає сюди + обробники подій. Генерація — `onGenerateVariant(doc,
 * mode)` (батько кличе ACTION clean_document_text і оновлює document.variants).
 */
export function DocumentViewer({
  document,
  caseData,
  onClose,
  onUpdate,
  onOpenDetails,
  onDiscussWithAgent,
  onReprocess,
  onGenerateVariant,
  onLoadAttentionNotes,
  onRemoveAllMarks,
  onDelete,
}) {
  // Обраний таб. null = «адвокат ще не вибирав» → застосовується дефолт
  // (Точний для scanned з layout, інакше Скан/Документ). Окремо від дефолту
  // щоб дефолт реактивно став Точним коли layout довантажиться.
  const [selectedMode, setSelectedMode] = useState(() => loadModePreference(document?.id));
  // Який AI-режим генерується зараз (null = жоден). Локальний UI-стан.
  const [generatingMode, setGeneratingMode] = useState(null);

  // documentNature може бути не визначений на legacy-документах (до v5).
  const inferred = inferNatureFromFile(document) || defaultNatureForUI(document);
  const effectiveNature = document?.documentNature || inferred;
  const isScanned = effectiveNature === 'scanned';

  // isInlineRenderable — Drive/власний рендер показує оригінал нативно
  // (searchable PDF, DOCX, HTML, ...). Для таких «Документ»-таб = цей рендер.
  const documentForInfer = document?.documentNature
    ? document
    : (document ? { ...document, documentNature: effectiveNature } : null);
  const inlineRenderable = isInlineRenderable(documentForInfer);

  // V2-A1 — режим «Точний»: живий показ тексту скана з layout (0 токенів).
  // Пробуємо layout ТІЛЬКИ для scanned не-inline документів.
  const exactEnabled = isScanned && !inlineRenderable;
  const exact = useExactLayout({ document, caseData, enabled: exactEnabled });
  const exactReady = exact.status === 'ready';

  const tabs = buildViewerTabs({ isScanned, exactReady, variants: document?.variants });
  const tabValues = tabs.map(t => t.value);

  // Перемикач показуємо для будь-якого документа (≥2 режими завжди).
  const showModeToggle = !!document;

  // Дефолт-таб: scanned → Точний (якщо layout готовий), інакше Скан; searchable →
  // Документ ('scan'). На AI-режим автоматично НЕ потрапляєш (parent §V2-B.2).
  const defaultMode = isScanned ? (exactReady ? 'exact' : 'scan') : 'scan';

  // Ефективний режим: збережений вибір якщо він валідний для поточного набору,
  // інакше дефолт. exact доступний лише коли layout готовий.
  let effectiveMode = (selectedMode && tabValues.includes(selectedMode))
    ? selectedMode
    : defaultMode;
  if (effectiveMode === 'exact' && !exactReady) effectiveMode = 'scan';

  // Контент для таба «Скан»/«Документ»: scanned і inline-renderable → нативний
  // рендер (ScanContent); рідкісний non-inline searchable → текстова плашка.
  const documentRenderMode = (isScanned || inlineRenderable) ? 'scan' : 'text';

  useEffect(() => {
    if (!document?.id) return;
    setSelectedMode(loadModePreference(document.id));
    setGeneratingMode(null);
  }, [document?.id]);

  useEffect(() => {
    if (document?.id && selectedMode) {
      saveModePreference(document.id, selectedMode);
    }
  }, [selectedMode, document?.id]);

  // Якщо documentNature відсутній (legacy <v5) але інференція впевнена —
  // фіксуємо через update_document (fire-and-forget).
  useEffect(() => {
    if (!document?.id || !onUpdate) return;
    if (document.documentNature === 'scanned' || document.documentNature === 'searchable') return;
    const sure = inferNatureFromFile(document);
    if (!sure) return;
    onUpdate(document.id, { documentNature: sure });
  }, [document?.id, document?.documentNature, onUpdate]);

  if (!document) {
    return (
      <div className="document-viewer document-viewer--empty">
        <div className="document-viewer__empty-content">
          <FileText size={64} />
          <p>Оберіть документ зі списку щоб переглянути</p>
        </div>
      </div>
    );
  }

  const handleToggleKey = nextValue => {
    onUpdate && onUpdate(document.id, { isKey: nextValue });
  };

  // Перемикання вкладок — лише зміна вигляду. НІКОЛИ не запускає AI (parent
  // §V2-B.2 — захист від випадкового кліку). Генерація — окремою кнопкою.
  const handleModeChange = nextMode => {
    setSelectedMode(nextMode);
  };

  // Генерація AI-варіанта на вимогу (свідомий клік кнопки «Згенерувати»).
  // Кличе батьків onGenerateVariant (ACTION clean_document_text + оновлення
  // document.variants). Поки генерується — спінер у тілі; на успіх батько
  // оновлює variants → таб показує .md; на помилку — батько toast'ить, таб
  // лишається у стані заглушки.
  const handleGenerate = async genMode => {
    if (generatingMode || typeof onGenerateVariant !== 'function') return;
    setGeneratingMode(genMode);
    try {
      await onGenerateVariant(document, genMode);
    } finally {
      setGeneratingMode(null);
    }
  };

  const effectiveDoc = document?.documentNature
    ? document
    : { ...document, documentNature: effectiveNature };

  return (
    <div className="document-viewer">
      <DocumentViewerHeader
        document={document}
        caseData={caseData}
        showModeToggle={showModeToggle}
        tabs={tabs}
        mode={effectiveMode}
        onModeChange={handleModeChange}
        onToggleKey={handleToggleKey}
        onOpenDetails={() => onOpenDetails && onOpenDetails(document.id)}
        onDelete={onDelete}
        onClose={onClose}
      />
      <DocumentViewerContent
        document={document}
        mode={effectiveMode}
        documentRenderMode={documentRenderMode}
        caseData={caseData}
        onReprocess={onReprocess}
        exactMarkdown={exact.markdown}
        exactStatus={exact.status}
        generating={generatingMode === effectiveMode}
        onGenerate={handleGenerate}
        canGenerate={typeof onGenerateVariant === 'function'}
        onLoadAttentionNotes={onLoadAttentionNotes}
        onRemoveAllMarks={onRemoveAllMarks}
      />
      <DocumentViewerFooter
        document={effectiveDoc}
        caseData={caseData}
        mode={effectiveMode}
        onDiscussWithAgent={onDiscussWithAgent}
        onReprocess={onReprocess}
      />
    </div>
  );
}

// Exported для прямих юніт-тестів LRU поведінки.
export function loadModePreference(documentId) {
  if (!documentId || typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(`${MODE_KEY_PREFIX}${documentId}`) || null;
  } catch {
    return null;
  }
}

export function saveModePreference(documentId, mode) {
  if (!documentId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(`${MODE_KEY_PREFIX}${documentId}`, mode);
    // Підтримуємо невеликий LRU index щоб localStorage не розбухав від тисяч ключів.
    const raw = localStorage.getItem(MODE_KEYS_INDEX);
    const index = raw ? JSON.parse(raw) : [];
    const next = [documentId, ...index.filter(id => id !== documentId)].slice(
      0,
      MODE_KEYS_LIMIT
    );
    localStorage.setItem(MODE_KEYS_INDEX, JSON.stringify(next));
    // Видалити витіснені
    for (const oldId of index) {
      if (!next.includes(oldId)) {
        localStorage.removeItem(`${MODE_KEY_PREFIX}${oldId}`);
      }
    }
  } catch {
    // localStorage переповнений — пропускаємо тихо
  }
}
