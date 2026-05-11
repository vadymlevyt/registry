// ── RECONNAISSANCE ───────────────────────────────────────────────────────────
// TASK 0.3 — UI вкладки «Розвідник» модуля «Електронний суд».
// Видима тільки для засновника (isCurrentUserFounder()). Запускає read-only
// recon-сценарії через офіційне розширення Claude for Chrome.
//
// Цикл:
//   1. Адвокат відкриває setup (один раз) — підтверджує що встановив і увійшов
//      у Claude for Chrome.
//   2. Обирає сценарій → відкривається модал з трьома кроками:
//        Крок 1 — копіювання промпта і відкриття кабінету ЄСІТС
//        Крок 2 — очікування завершення (Claude for Chrome працює у фоні)
//        Крок 3 — резюме і посилання на папку артефактів на Drive
//   3. Запис історії в tenant.recon_history[] (через ecitsService).
//
// Дизайн: тільки існуючі design-токени і UI-компоненти.

import React, { useEffect, useState } from 'react';
import { Search, Play, FileText, FolderOpen, RefreshCw, X } from 'lucide-react';
import { ICON_SIZE } from '../../UI/icons.js';
import { Button } from '../../UI/Button.jsx';
import { Modal } from '../../UI/Modal.jsx';
import { toast } from '../../../services/toast.js';
import {
  getReconScenarios,
  getReconHistory,
  registerReconRun,
  markReconCompleted,
  exportReconForAnalysis,
  getReconScenarioById,
  getSettings,
} from '../../../services/ecitsService.js';
import ClaudeForChromeSetup from '../setup/ClaudeForChromeSetup.jsx';

const SETUP_DONE_KEY = 'levytskyi_claude_for_chrome_setup_done_v1';
const ACTIVE_RECON_KEY = 'levytskyi_active_recon_v1';

// Безпечне копіювання в буфер обміну з fallback'ом на старі браузери.
async function copyToClipboard(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}

function readActiveRecon() {
  try {
    const raw = localStorage.getItem(ACTIVE_RECON_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeActiveRecon(record) {
  try {
    if (record) {
      localStorage.setItem(ACTIVE_RECON_KEY, JSON.stringify(record));
    } else {
      localStorage.removeItem(ACTIVE_RECON_KEY);
    }
  } catch {}
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function statusLabel(status) {
  switch (status) {
    case 'in_progress': return 'У процесі';
    case 'completed': return 'Завершено';
    case 'failed': return 'Помилка';
    case 'abandoned': return 'Скасовано';
    default: return status || '—';
  }
}

// ── Картка сценарію ──────────────────────────────────────────────────────────

function ScenarioCard({ scenario, onRun, onShowPrompt }) {
  return (
    <div style={{
      border: '1px solid var(--color-border)',
      borderRadius: 8,
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      background: 'var(--color-bg)',
    }}>
      <div style={{
        fontFamily: 'var(--font-heading)',
        fontSize: 'var(--text-sm)',
        fontWeight: 'var(--weight-bold)',
      }}>
        {scenario.name}
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-2)' }}>
        {scenario.description}
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-3)' }}>
        Орієнтовно: {scenario.estimatedDuration}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          variant="primary"
          size="sm"
          icon={<Play size={ICON_SIZE.sm} />}
          onClick={() => onRun(scenario)}
        >
          Запустити
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<FileText size={ICON_SIZE.sm} />}
          onClick={() => onShowPrompt(scenario)}
        >
          Переглянути промпт
        </Button>
      </div>
    </div>
  );
}

// ── Модал перегляду промпта (read-only) ──────────────────────────────────────

function PromptViewerModal({ isOpen, onClose, scenario }) {
  if (!scenario) return null;
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Промпт: ${scenario.name}`}
      size="lg"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>Закрити</Button>
          <Button
            variant="primary"
            onClick={async () => {
              const ok = await copyToClipboard(scenario.prompt);
              if (ok) toast.success('Скопійовано в буфер');
              else toast.error('Не вдалось скопіювати');
            }}
          >
            Скопіювати
          </Button>
        </>
      }
    >
      <pre style={{
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: 'var(--text-xs)',
        background: 'var(--color-bg-2)',
        padding: 12,
        borderRadius: 6,
        margin: 0,
        maxHeight: '60vh',
        overflow: 'auto',
      }}>
        {scenario.prompt}
      </pre>
    </Modal>
  );
}

// ── Модал запуску recon (3 кроки) ────────────────────────────────────────────

function RunReconModal({ isOpen, onClose, scenario, activeRecord, onActiveRecordChange }) {
  // Стани кроків: 'instructions' | 'awaiting' | 'completion'
  const [step, setStep] = useState('instructions');
  const [summary, setSummary] = useState('');

  // Якщо модал відкритий при існуючому activeRecord — починаємо з awaiting.
  useEffect(() => {
    if (!isOpen) return;
    if (activeRecord) {
      setStep('awaiting');
    } else {
      setStep('instructions');
    }
    setSummary('');
  }, [isOpen, activeRecord]);

  if (!scenario) return null;

  async function handleCopyAndStart() {
    const ok = await copyToClipboard(scenario.prompt);
    if (!ok) {
      toast.error('Не вдалось скопіювати промпт', {
        description: 'Спробуйте відкрити перегляд промпта і скопіювати вручну.',
      });
      return;
    }
    let record;
    try {
      record = registerReconRun(scenario.id);
    } catch (err) {
      toast.error('Не вдалось зареєструвати запуск', {
        description: err?.message || 'Невідома помилка',
      });
      return;
    }
    writeActiveRecon(record);
    onActiveRecordChange(record);
    toast.success('Промпт скопійовано', {
      description: 'Відкрийте кабінет ЄСІТС і Claude for Chrome.',
    });
    setStep('awaiting');
  }

  function handleMarkCompleted(status) {
    if (!activeRecord) return;
    const updated = markReconCompleted(activeRecord.reconId, {
      status,
      summary: summary.trim() || null,
    });
    if (updated) {
      onActiveRecordChange(null);
      writeActiveRecon(null);
      if (status === 'completed') {
        setStep('completion');
      } else {
        onClose();
        toast.info('Recon позначений як скасований');
      }
    }
  }

  function handleOpenFolder() {
    // Drive-папка _research/ecits/<...> відкривається через пошук у Drive UI.
    // Прямого посилання без folderId ми не маємо до моменту реальної інтеграції
    // з createCaseStructure-аналогом — показуємо адвокату шлях.
    const targetFolder = activeRecord?.targetFolder;
    if (targetFolder) {
      toast.info('Папка артефактів', {
        description: `Знайдіть на Drive: ${targetFolder}`,
      });
    }
    window.open('https://drive.google.com/drive/my-drive', '_blank', 'noopener,noreferrer');
  }

  function handleExport() {
    if (!activeRecord) return;
    const exp = exportReconForAnalysis(activeRecord.reconId);
    if (exp.exportPath) {
      toast.info('Експорт підготовлено', {
        description: `Шукайте на Drive: ${exp.exportPath}`,
      });
    } else {
      toast.error('Експорт недоступний', {
        description: 'Папка артефактів не знайдена.',
      });
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Запуск: ${scenario.name}`}
      size="md"
      closeOnBackdrop={false}
      actions={
        step === 'instructions' ? (
          <>
            <Button variant="ghost" onClick={onClose}>Скасувати</Button>
            <Button variant="primary" onClick={handleCopyAndStart}>
              Скопіювати промпт і відкрити кабінет
            </Button>
          </>
        ) : step === 'awaiting' ? (
          <>
            <Button
              variant="ghost"
              icon={<X size={ICON_SIZE.sm} />}
              onClick={() => handleMarkCompleted('abandoned')}
            >
              Скасувати recon
            </Button>
            <Button
              variant="secondary"
              icon={<RefreshCw size={ICON_SIZE.sm} />}
              onClick={() => toast.info('Перевірте Drive', {
                description: 'Папка має містити manifest.json коли Claude завершив.',
              })}
            >
              Перевірити чи завершився
            </Button>
            <Button
              variant="primary"
              onClick={() => handleMarkCompleted('completed')}
            >
              Позначити як завершений
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Закрити</Button>
            <Button
              variant="secondary"
              icon={<FolderOpen size={ICON_SIZE.sm} />}
              onClick={handleOpenFolder}
            >
              Відкрити папку
            </Button>
            <Button variant="primary" onClick={handleExport}>
              Експортувати для аналізу
            </Button>
          </>
        )
      }
    >
      {step === 'instructions' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 'var(--text-sm)' }}>
          <div>1. Зараз промпт скопіюється в буфер обміну.</div>
          <div>
            2. Відкрийте у новій вкладці Chrome кабінет ЄСІТС
            (<span style={{ fontFamily: 'monospace' }}>cabinet.court.gov.ua</span>),
            увійдіть через КЕП.
          </div>
          <div>
            3. Натисніть на іконку Claude for Chrome у правому верхньому куті
            браузера, вставте промпт у вікно, надішліть.
          </div>
          <div>
            4. Claude буде працювати ~10-15 хв. Поверніться сюди коли він
            повідомить про завершення.
          </div>
        </div>
      )}

      {step === 'awaiting' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 'var(--text-sm)' }}>
          <div style={{ color: 'var(--color-text-2)' }}>
            Recon виконується у фоні. Не закривайте Chrome.
          </div>
          {activeRecord && (
            <div style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-3)',
              padding: 10,
              background: 'var(--color-bg-2)',
              borderRadius: 6,
            }}>
              <div>Recon ID: <span style={{ fontFamily: 'monospace' }}>{activeRecord.reconId}</span></div>
              <div>Папка: <span style={{ fontFamily: 'monospace' }}>{activeRecord.targetFolder}</span></div>
              <div>Розпочато: {formatDateTime(activeRecord.startedAt)}</div>
            </div>
          )}
          <div>
            <label style={{
              display: 'block',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-2)',
              marginBottom: 4,
            }}>
              Резюме (опційно)
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Що помічено під час recon'у, скільки сторінок зафіксовано..."
              rows={3}
              style={{
                width: '100%',
                padding: 8,
                border: '1px solid var(--color-border)',
                borderRadius: 6,
                fontSize: 'var(--text-xs)',
                fontFamily: 'inherit',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>
      )}

      {step === 'completion' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 'var(--text-sm)' }}>
          <div>Recon завершено. Артефакти збережені на Drive.</div>
          <div style={{ color: 'var(--color-text-2)', fontSize: 'var(--text-xs)' }}>
            Щоб передати їх в окремий чат аналізу — натисніть «Експортувати для
            аналізу». Файл export_for_analysis.zip з'явиться у тій самій папці.
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Історія запусків ─────────────────────────────────────────────────────────

function HistoryList({ history, onOpenFolder }) {
  if (history.length === 0) {
    return (
      <div className="empty">
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-3)' }}>
          Поки що жодного recon-запуску. Запустіть перший сценарій вище.
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {history.map((rec) => (
        <div
          key={rec.reconId}
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            padding: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 'var(--text-xs)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 'var(--weight-bold)', fontFamily: 'monospace' }}>
              {rec.reconId}
            </div>
            <div style={{ color: 'var(--color-text-2)', marginTop: 2 }}>
              {formatDateTime(rec.startedAt)} → {formatDateTime(rec.completedAt)}
            </div>
            {rec.summary && (
              <div style={{ color: 'var(--color-text-2)', marginTop: 4 }}>{rec.summary}</div>
            )}
          </div>
          <div style={{ color: 'var(--color-text-2)' }}>{statusLabel(rec.status)}</div>
          <Button
            variant="ghost"
            size="sm"
            icon={<FolderOpen size={ICON_SIZE.sm} />}
            onClick={() => onOpenFolder(rec)}
          >
            Папка
          </Button>
        </div>
      ))}
    </div>
  );
}

// ── Головний компонент ───────────────────────────────────────────────────────

export default function Reconnaissance() {
  const settings = getSettings();
  const provider = settings.executionProvider;

  const [setupDone, setSetupDone] = useState(() => {
    try { return localStorage.getItem(SETUP_DONE_KEY) === '1'; } catch { return false; }
  });
  const [activeRecord, setActiveRecord] = useState(() => readActiveRecon());
  const [history, setHistory] = useState(() => getReconHistory());
  const [runScenario, setRunScenario] = useState(null);
  const [promptScenario, setPromptScenario] = useState(null);

  const scenarios = getReconScenarios();

  function refreshHistory() {
    setHistory(getReconHistory());
  }

  function handleSetupDone() {
    try { localStorage.setItem(SETUP_DONE_KEY, '1'); } catch {}
    setSetupDone(true);
  }

  function handleRun(scenario) {
    setRunScenario(scenario);
  }

  function handleCloseRun() {
    setRunScenario(null);
    refreshHistory();
  }

  function handleActiveRecordChange(record) {
    setActiveRecord(record);
    refreshHistory();
  }

  function handleOpenHistoryFolder(rec) {
    toast.info('Папка артефактів', {
      description: `Знайдіть на Drive: ${rec.targetFolder}`,
    });
    window.open('https://drive.google.com/drive/my-drive', '_blank', 'noopener,noreferrer');
  }

  // Якщо є активний recon і модал не відкритий — кнопка повернутись.
  const resumeScenario = activeRecord
    ? getReconScenarioById(activeRecord.scenarioId)
    : null;

  if (provider !== 'claudeForChrome') {
    return (
      <div className="empty">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Провайдер виконання</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-3)' }}>
          Recon доступний коли провайдер виконання = «Claude for Chrome».
          Поточний провайдер: {provider || '—'}.
        </div>
      </div>
    );
  }

  if (!setupDone) {
    return <ClaudeForChromeSetup onDone={handleSetupDone} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Search size={ICON_SIZE.lg} />
        <div>
          <div style={{
            fontFamily: 'var(--font-heading)',
            fontSize: 'var(--text-md)',
            fontWeight: 'var(--weight-bold)',
          }}>
            Розвідник
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-2)' }}>
            Read-only обхід кабінету ЄСІТС через Claude for Chrome
          </div>
        </div>
      </div>

      {resumeScenario && (
        <div style={{
          padding: 10,
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          background: 'var(--color-bg-2)',
          fontSize: 'var(--text-xs)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            Є активний recon: <span style={{ fontFamily: 'monospace' }}>{activeRecord.reconId}</span>
          </div>
          <Button variant="primary" size="sm" onClick={() => setRunScenario(resumeScenario)}>
            Повернутись до recon
          </Button>
        </div>
      )}

      <div>
        <div style={{
          fontFamily: 'var(--font-heading)',
          fontSize: 'var(--text-sm)',
          fontWeight: 'var(--weight-bold)',
          marginBottom: 10,
        }}>
          Доступні сценарії
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 12,
        }}>
          {scenarios.map((sc) => (
            <ScenarioCard
              key={sc.id}
              scenario={sc}
              onRun={handleRun}
              onShowPrompt={setPromptScenario}
            />
          ))}
        </div>
      </div>

      <div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}>
          <div style={{
            fontFamily: 'var(--font-heading)',
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-bold)',
          }}>
            Історія запусків
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={ICON_SIZE.sm} />}
            onClick={refreshHistory}
          >
            Оновити
          </Button>
        </div>
        <HistoryList history={history} onOpenFolder={handleOpenHistoryFolder} />
      </div>

      <PromptViewerModal
        isOpen={!!promptScenario}
        onClose={() => setPromptScenario(null)}
        scenario={promptScenario}
      />

      <RunReconModal
        isOpen={!!runScenario}
        onClose={handleCloseRun}
        scenario={runScenario}
        activeRecord={activeRecord}
        onActiveRecordChange={handleActiveRecordChange}
      />
    </div>
  );
}
