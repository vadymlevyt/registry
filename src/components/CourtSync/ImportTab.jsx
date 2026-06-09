// ── COURT SYNC — IMPORT TAB ──────────────────────────────────────────────────
// Вкладка "Імпорт" модуля «Електронний суд». Три кроки:
// 1. Кнопка "Скопіювати промпт" → clipboard
// 2. Інструкція "Відкрийте Claude for Chrome, вставте, отримайте JSON"
// 3. Textarea з синьою рамкою + кнопка "Обробити" → scenarioProcessor
//
// Один сенс компонента (правило #11): "адвокат вставляє envelope, ми
// показуємо прогрес і підсумок". НЕ генерація промпту (промпт — з
// promptBuilder), НЕ виконання сценарію (scenarioProcessor).
//
// TASK v12 — пікер «Можливо не ваші» (опт-ін, нічого не обрано за
// замовчуванням). Кейси що екстрактор позначив `likelyNotMine=true`
// сепаруються у `result.pendingReview` і показуються списком; адвокат
// обирає які додати — processDeferredCases ганяє той самий процесор.
// Захист рендеру (TASK v12 §11): warnings/skipped/errors завжди як рядки.
//
// Дизайн — тільки існуючі design-токени з styles/tokens.css. Inline
// styles тільки для layout. Без емодзі.

import React, { useState, useMemo } from 'react';
import { ICON_SIZE } from '../UI/icons.js';
import { Clipboard, Play, CheckCircle2, AlertTriangle } from 'lucide-react';
import { buildEcitsImportPrompt } from '../../services/ecits/promptBuilder.js';
import {
  submitScenarioResult,
  processDeferredCases,
} from '../../services/ecits/scenarioProcessor.js';

// Захист рендеру (TASK v12 §11): не дати об'єкту впасти у React #31.
// Прив'язує текстовий вигляд до можливих форм (рядок / { message, case_no }).
function coerceToString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (typeof value.message === 'string') {
      return value.case_no ? `${value.case_no}: ${value.message}` : value.message;
    }
    if (typeof value.reason === 'string') {
      return value.case_no ? `${value.case_no}: ${value.reason}` : value.reason;
    }
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

export default function ImportTab({ executeAction, cases, getCases, tenant, onScenarioHistoryAppend }) {
  // TASK ecits_identity_by_caseno (Зміна C): живий read-канал. Якщо App
  // прокинув getCases (живий ref) — використовуємо його; інакше fallback
  // на immutable cases prop (тести з memory-snapshot, legacy callers).
  const readCases = typeof getCases === 'function' ? getCases : (() => cases || []);
  const prompt = useMemo(() => buildEcitsImportPrompt(), []);
  const [copyState, setCopyState] = useState('idle'); // idle | copied | error
  const [jsonText, setJsonText] = useState('');
  const [processing, setProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // TASK v12 — пікер «Можливо не ваші». Опт-ін: жодна галочка не стоїть.
  const [pendingSelected, setPendingSelected] = useState(() => new Set());
  const [deferredProcessing, setDeferredProcessing] = useState(false);

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch (e) {
      console.warn('[ImportTab] clipboard write failed:', e);
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 3000);
    }
  };

  const handleProcess = async () => {
    setError(null);
    setResult(null);
    setProgressMsg('');
    setPendingSelected(new Set());
    if (!jsonText.trim()) {
      setError('Вставте JSON-результат з Claude for Chrome.');
      return;
    }
    // Дістати JSON з можливого код-блоку ```json ... ```
    let raw = jsonText.trim();
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) raw = fenceMatch[1].trim();

    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch (e) {
      setError(`Не вдалось розпарсити JSON: ${e.message}`);
      return;
    }

    setProcessing(true);
    try {
      const res = await submitScenarioResult(envelope, {
        executeAction,
        agentId: 'court_sync_agent',
        transport: 'manual_paste',
        getCases: readCases,
        getTenant: () => tenant,
        appendScenarioHistoryEntry: onScenarioHistoryAppend,
        onProgress: (msg) => setProgressMsg(msg),
      });
      setResult(res);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setProcessing(false);
      setProgressMsg('');
    }
  };

  const togglePending = (ecitsCaseId) => {
    setPendingSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ecitsCaseId)) next.delete(ecitsCaseId);
      else next.add(ecitsCaseId);
      return next;
    });
  };

  const handleAddSelectedDeferred = async () => {
    if (!result || !Array.isArray(result.pendingReview) || pendingSelected.size === 0) return;
    const chosen = result.pendingReview.filter((c) => pendingSelected.has(c.ecitsCaseId));
    if (chosen.length === 0) return;

    setDeferredProcessing(true);
    setProgressMsg('');
    try {
      const inc = await processDeferredCases(chosen, {
        executeAction,
        agentId: 'court_sync_agent',
        getCases: readCases,
        onProgress: (msg) => setProgressMsg(msg),
      });

      // Мердж: додаємо обрані до загального підсумку, прибираємо їх з pendingReview.
      setResult((prev) => {
        if (!prev) return prev;
        const remaining = prev.pendingReview.filter((c) => !pendingSelected.has(c.ecitsCaseId));
        return {
          ...prev,
          casesCreated: prev.casesCreated + inc.casesCreated,
          casesUpdated: prev.casesUpdated + inc.casesUpdated,
          hearingsAdded: prev.hearingsAdded + inc.hearingsAdded,
          skipped: prev.skipped + inc.skipped,
          errors: [...prev.errors, ...inc.errors],
          warnings: [...prev.warnings, ...inc.warnings],
          pendingReview: remaining,
        };
      });
      setPendingSelected(new Set());
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setDeferredProcessing(false);
      setProgressMsg('');
    }
  };

  const handleDismissDeferred = () => {
    setResult((prev) => (prev ? { ...prev, pendingReview: [] } : prev));
    setPendingSelected(new Set());
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Step number={1} title="Скопіюйте промпт">
        <button
          onClick={handleCopyPrompt}
          disabled={processing}
          style={btnStyle}
        >
          <Clipboard size={ICON_SIZE.sm} />
          {copyState === 'copied' ? 'Скопійовано!' :
           copyState === 'error'  ? 'Помилка копіювання' :
           'Скопіювати промпт'}
        </button>
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--color-text-2)', fontSize: 12 }}>
            Показати текст промпту
          </summary>
          <pre style={{
            marginTop: 8,
            padding: 12,
            background: 'var(--color-bg-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            fontSize: 11,
            maxHeight: 240,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
          }}>{prompt}</pre>
        </details>
      </Step>

      <Step number={2} title="Виконайте у Claude for Chrome">
        <div style={{ fontSize: 13, color: 'var(--color-text-2)', lineHeight: 1.5 }}>
          Відкрийте sidebar Claude for Chrome у браузері. Перейдіть на
          сторінку кабінету ЄСІТС (cabinet.court.gov.ua) і ввійдіть.
          Вставте промпт, натисніть Send. Зачекайте, поки агент пройде
          по справах. Скопіюйте отриманий JSON.
        </div>
      </Step>

      <Step number={3} title="Вставте JSON і обробіть">
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          disabled={processing}
          placeholder='Вставте сюди JSON-envelope (з ```json ... ``` блоку або без)'
          style={{
            width: '100%',
            minHeight: 300,
            padding: 12,
            border: '2px solid var(--color-accent, #3b82f6)',
            borderRadius: 4,
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 12,
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
        <button
          onClick={handleProcess}
          disabled={processing || !jsonText.trim()}
          style={{ ...btnStyle, marginTop: 12, opacity: (processing || !jsonText.trim()) ? 0.5 : 1 }}
        >
          <Play size={ICON_SIZE.sm} />
          {processing ? 'Обробка...' : 'Обробити'}
        </button>
        {(processing || deferredProcessing) && progressMsg && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-2)' }}>
            {progressMsg}
          </div>
        )}
      </Step>

      {error && (
        <div style={{
          padding: 12,
          background: 'var(--color-bg-error, rgba(231,76,60,0.08))',
          border: '1px solid var(--color-border-error, #e74c3c)',
          borderRadius: 4,
          color: 'var(--color-text-error, #e74c3c)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
        }}>
          <AlertTriangle size={ICON_SIZE.sm} />
          <div style={{ fontSize: 13 }}>{coerceToString(error)}</div>
        </div>
      )}

      {result && <ResultCard result={result} />}

      {result && Array.isArray(result.pendingReview) && result.pendingReview.length > 0 && (
        <PendingReviewPicker
          pendingReview={result.pendingReview}
          selected={pendingSelected}
          onToggle={togglePending}
          onAddSelected={handleAddSelectedDeferred}
          onDismiss={handleDismissDeferred}
          processing={deferredProcessing}
        />
      )}
    </div>
  );
}

function Step({ number, title, children }) {
  return (
    <section style={{
      padding: 16,
      background: 'var(--color-bg-1)',
      border: '1px solid var(--color-border)',
      borderRadius: 4,
    }}>
      <div style={{
        fontSize: 12,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: 'var(--color-text-2)',
        marginBottom: 4,
      }}>
        Крок {number}
      </div>
      <div style={{
        fontFamily: 'var(--font-heading)',
        fontSize: 'var(--text-sm)',
        fontWeight: 'var(--weight-bold)',
        marginBottom: 10,
      }}>{title}</div>
      {children}
    </section>
  );
}

function ResultCard({ result }) {
  const errors = Array.isArray(result.errors) ? result.errors : [];
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const hasErrors = errors.length > 0;
  return (
    <section style={{
      padding: 16,
      background: hasErrors
        ? 'var(--color-bg-warning, rgba(241,196,15,0.08))'
        : 'var(--color-bg-success, rgba(46,204,113,0.08))',
      border: `1px solid ${hasErrors ? 'var(--color-border-warning, #f1c40f)' : 'var(--color-border-success, #2ecc71)'}`,
      borderRadius: 4,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
        fontWeight: 'var(--weight-bold)',
      }}>
        {hasErrors
          ? <AlertTriangle size={ICON_SIZE.md} />
          : <CheckCircle2 size={ICON_SIZE.md} />}
        Готово
      </div>
      <Metric label="Створено справ" value={result.casesCreated} />
      <Metric label="Оновлено справ" value={result.casesUpdated} />
      <Metric label="Додано засідань" value={result.hearingsAdded} />
      <Metric label="Пропущено" value={result.skipped} />
      {Array.isArray(result.pendingReview) && result.pendingReview.length > 0 && (
        <Metric label="Можливо не ваші" value={result.pendingReview.length} />
      )}
      {hasErrors && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--color-text-2)' }}>
            Помилки ({errors.length})
          </summary>
          <ul style={{ marginTop: 8, paddingLeft: 20, fontSize: 12 }}>
            {errors.slice(0, 20).map((e, i) => (
              <li key={i}>{coerceToString(e)}</li>
            ))}
          </ul>
        </details>
      )}
      {warnings.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--color-text-2)' }}>
            Попередження ({warnings.length})
          </summary>
          <ul style={{ marginTop: 8, paddingLeft: 20, fontSize: 12 }}>
            {warnings.map((w, i) => (<li key={i}>{coerceToString(w)}</li>))}
          </ul>
        </details>
      )}
    </section>
  );
}

function PendingReviewPicker({ pendingReview, selected, onToggle, onAddSelected, onDismiss, processing }) {
  return (
    <section
      data-testid="pending-review-picker"
      style={{
        padding: 16,
        background: 'var(--color-bg-1)',
        border: '1px dashed var(--color-border)',
        borderRadius: 4,
      }}
    >
      <div style={{ fontWeight: 'var(--weight-bold)', marginBottom: 4 }}>
        Можливо не ваші — оберіть, які додати
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-2)', marginBottom: 10 }}>
        Екстрактор відмітив ці справи як неоднозначні (роль «Представник» без
        уточнення кого саме). За замовчуванням жодну не додаємо. Поставте
        галочку проти тих, які насправді ваші, і натисніть «Додати обрані».
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 300, overflow: 'auto' }}>
        {pendingReview.map((ec) => {
          const id = ec.ecitsCaseId || ec.case_no;
          const isChecked = selected.has(ec.ecitsCaseId);
          return (
            <li key={id} style={{ padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={processing}
                  onChange={() => onToggle(ec.ecitsCaseId)}
                />
                <span style={{ fontSize: 13 }}>
                  <strong>{ec.case_no || '(no case_no)'}</strong>
                  {ec.court ? ` · ${ec.court}` : ''}
                  {ec.primaryParty ? ` · ${ec.primaryParty}` : ''}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={onAddSelected}
          disabled={processing || selected.size === 0}
          style={{
            ...btnStyle,
            opacity: (processing || selected.size === 0) ? 0.5 : 1,
          }}
        >
          <Play size={ICON_SIZE.sm} />
          {processing ? 'Обробка...' : `Додати обрані (${selected.size})`}
        </button>
        <button
          onClick={onDismiss}
          disabled={processing}
          style={{
            ...btnStyle,
            background: 'transparent',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
          }}
        >
          Відхилити всі
        </button>
      </div>
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
      <span style={{ color: 'var(--color-text-2)' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

const btnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 16px',
  background: 'var(--color-accent, #3b82f6)',
  color: 'var(--color-text-inverse, white)',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
};
