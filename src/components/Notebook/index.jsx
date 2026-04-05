import React, { useState, useEffect, useMemo, useRef } from 'react';

const CAT_META = {
  general: { label: '📝 Загальні',  icon: '📝' },
  case:    { label: '⚖️ По справах', icon: '⚖️' },
  content: { label: '💡 Ідеї',       icon: '💡' },
  system:  { label: '⚙️ Система',    icon: '⚙️' },
};

function formatTs(ts) {
  try {
    const d = new Date(ts);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return `сьогодні ${time}`;
    return `${d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })} ${time}`;
  } catch { return ''; }
}

export default function Notebook({ cases, notes, addNote, deleteNote }) {
  const [innerTab, setInnerTab] = useState('notes');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Inner tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #2e3148', padding: '8px 12px 0', flexShrink: 0 }}>
        {[
          { id: 'notes',   label: '📋 Нотатки' },
          { id: 'records', label: '✏️ Записи' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setInnerTab(t.id)}
            style={{
              background: innerTab === t.id ? '#222536' : 'transparent',
              color: innerTab === t.id ? '#e8eaf0' : '#9aa0b8',
              border: '1px solid #2e3148',
              borderBottom: innerTab === t.id ? '1px solid #222536' : '1px solid #2e3148',
              borderRadius: '6px 6px 0 0',
              padding: '8px 14px',
              fontSize: 13,
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {innerTab === 'notes' && (
        <NotesTab cases={cases} notes={notes} addNote={addNote} deleteNote={deleteNote} />
      )}
      {innerTab === 'records' && <RecordsTab />}
    </div>
  );
}

// ── NOTES TAB ───────────────────────────────────────────────────────────────
function NotesTab({ cases, notes, addNote, deleteNote }) {
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all'); // all | general | case | content | system
  const [filterCaseName, setFilterCaseName] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const byCaseNames = useMemo(() => {
    const set = new Set();
    (notes || []).forEach(n => { if (n.caseName) set.add(n.caseName); });
    return Array.from(set).sort();
  }, [notes]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (notes || []).filter(n => {
      if (filterCaseName) {
        if (n.caseName !== filterCaseName) return false;
      } else if (filterCat !== 'all') {
        if ((n.category || 'general') !== filterCat) return false;
      }
      if (s) {
        const hay = `${n.text || ''} ${n.caseName || ''}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [notes, search, filterCat, filterCaseName]);

  const titleLabel = filterCaseName
    ? `⚖️ ${filterCaseName}`
    : filterCat === 'all'
      ? 'Всі нотатки'
      : CAT_META[filterCat]?.label || 'Нотатки';

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{ width: 200, borderRight: '1px solid #2e3148', padding: '12px 10px', overflow: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          placeholder="Пошук..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            background: '#0f1117', color: '#e8eaf0',
            border: '1px solid #2e3148', borderRadius: 6,
            padding: '6px 10px', fontSize: 12, outline: 'none',
          }}
        />

        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#5a6080', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
            Категорії
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <SidebarItem label="Всі" active={!filterCaseName && filterCat === 'all'} onClick={() => { setFilterCat('all'); setFilterCaseName(null); }} />
            {Object.entries(CAT_META).map(([id, meta]) => (
              <SidebarItem key={id} label={meta.label} active={!filterCaseName && filterCat === id} onClick={() => { setFilterCat(id); setFilterCaseName(null); }} />
            ))}
          </div>
        </div>

        {byCaseNames.length > 0 && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#5a6080', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
              По справах
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {byCaseNames.map(name => (
                <SidebarItem
                  key={name}
                  label={name}
                  active={filterCaseName === name}
                  onClick={() => { setFilterCaseName(name); setFilterCat('all'); }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Notes list */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #2e3148', flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e8eaf0', flex: 1 }}>
            {titleLabel} <span style={{ color: '#5a6080', fontWeight: 400 }}>({filtered.length})</span>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            style={{
              background: '#4f7cff', color: '#fff', border: 'none',
              borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Нотатка
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', color: '#5a6080', fontSize: 12, padding: 30 }}>
              Немає нотаток
            </div>
          )}
          {filtered.map(n => (
            <NoteCard key={n.id || n.ts} note={n} onDelete={() => deleteNote(n.id)} />
          ))}
        </div>
      </div>

      {modalOpen && (
        <AddNoteModal
          cases={cases}
          onCancel={() => setModalOpen(false)}
          onSave={(payload) => { addNote(payload); setModalOpen(false); }}
        />
      )}
    </div>
  );
}

function SidebarItem({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? '#222536' : 'transparent',
        color: active ? '#e8eaf0' : '#9aa0b8',
        border: 'none',
        borderLeft: active ? '2px solid #4f7cff' : '2px solid transparent',
        textAlign: 'left',
        padding: '5px 8px',
        fontSize: 12,
        cursor: 'pointer',
        borderRadius: 4,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
      title={label}
    >
      {label}
    </button>
  );
}

function NoteCard({ note, onDelete }) {
  const cat = note.category || 'general';
  const meta = CAT_META[cat] || CAT_META.general;
  return (
    <div style={{
      background: '#1a1d27', border: '1px solid #2e3148', borderRadius: 8,
      padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
          background: '#222536', color: '#9aa0b8',
        }}>
          {meta.icon} {cat}
        </span>
        {note.caseName && (
          <span style={{ fontSize: 11, color: '#4f7cff', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {note.caseName}
          </span>
        )}
        <span style={{ fontSize: 10, color: '#5a6080', marginLeft: 'auto' }}>
          {note.source ? `${note.source} · ` : ''}{formatTs(note.ts)}
        </span>
        <button
          onClick={onDelete}
          title="Видалити"
          style={{
            background: 'transparent', border: 'none', color: '#5a6080',
            cursor: 'pointer', fontSize: 14, padding: '0 4px',
          }}
        >
          ✕
        </button>
      </div>
      <div style={{ fontSize: 13, color: '#e8eaf0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {note.text}
      </div>
    </div>
  );
}

function AddNoteModal({ cases, onCancel, onSave }) {
  const [text, setText] = useState('');
  const [category, setCategory] = useState('general');
  const [caseId, setCaseId] = useState('');

  const selectedCase = (cases || []).find(c => String(c.id) === String(caseId));

  function handleSave() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSave({
      id: Date.now(),
      text: trimmed,
      category,
      caseId: category === 'case' ? (selectedCase?.id || null) : null,
      caseName: category === 'case' ? (selectedCase?.name || null) : null,
      source: 'manual',
      ts: new Date().toISOString(),
    });
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#1a1d27', border: '1px solid #2e3148', borderRadius: 10,
          padding: 18, width: 'min(520px, 92vw)', display: 'flex', flexDirection: 'column', gap: 12,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: '#e8eaf0' }}>Нова нотатка</div>

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Текст нотатки..."
          style={{
            height: 120, resize: 'none',
            background: '#0f1117', color: '#e8eaf0',
            border: '1px solid #2e3148', borderRadius: 6,
            padding: '8px 10px', fontSize: 13, outline: 'none',
            fontFamily: 'inherit',
          }}
        />

        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: '#9aa0b8' }}>Категорія</span>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              style={{
                background: '#0f1117', color: '#e8eaf0',
                border: '1px solid #2e3148', borderRadius: 6,
                padding: '6px 8px', fontSize: 12, outline: 'none',
              }}
            >
              <option value="general">📝 Загальна</option>
              <option value="case">⚖️ По справі</option>
              <option value="content">💡 Ідея</option>
              <option value="system">⚙️ Система</option>
            </select>
          </label>

          {category === 'case' && (
            <label style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: '#9aa0b8' }}>Справа</span>
              <select
                value={caseId}
                onChange={e => setCaseId(e.target.value)}
                style={{
                  background: '#0f1117', color: '#e8eaf0',
                  border: '1px solid #2e3148', borderRadius: 6,
                  padding: '6px 8px', fontSize: 12, outline: 'none',
                }}
              >
                <option value="">— оберіть —</option>
                {(cases || []).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent', color: '#9aa0b8',
              border: '1px solid #2e3148', borderRadius: 6,
              padding: '7px 14px', fontSize: 12, cursor: 'pointer',
            }}
          >
            Скасувати
          </button>
          <button
            onClick={handleSave}
            disabled={!text.trim() || (category === 'case' && !selectedCase)}
            style={{
              background: '#4f7cff', color: '#fff', border: 'none',
              borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600,
              cursor: text.trim() ? 'pointer' : 'not-allowed',
              opacity: text.trim() && (category !== 'case' || selectedCase) ? 1 : 0.5,
            }}
          >
            Зберегти
          </button>
        </div>
      </div>
    </div>
  );
}

// ── RECORDS TAB ─────────────────────────────────────────────────────────────
const RECORDS_KEY = 'levytskyi_free_notes';

function loadRecords() {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveRecords(records) {
  try { localStorage.setItem(RECORDS_KEY, JSON.stringify(records)); } catch {}
}

function RecordsTab() {
  const [records, setRecords] = useState(() => loadRecords());
  const [activeId, setActiveId] = useState(() => {
    const r = loadRecords();
    return r.length ? r[0].id : null;
  });
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  const active = records.find(r => r.id === activeId) || null;

  useEffect(() => {
    if (active) {
      setTitle(active.title || '');
      setText(active.text || '');
    } else {
      setTitle('');
      setText('');
    }
  }, [activeId]); // eslint-disable-line

  function createRecord() {
    const now = new Date().toISOString();
    const rec = { id: Date.now(), title: 'Новий запис', text: '', createdAt: now, updatedAt: now };
    const updated = [rec, ...records];
    setRecords(updated);
    saveRecords(updated);
    setActiveId(rec.id);
  }

  function persist(newTitle, newText) {
    if (!active) return;
    const updated = records.map(r =>
      r.id === active.id
        ? { ...r, title: newTitle, text: newText, updatedAt: new Date().toISOString() }
        : r
    );
    setRecords(updated);
    saveRecords(updated);
  }

  function deleteActive() {
    if (!active) return;
    if (!window.confirm('Видалити цей запис?')) return;
    const updated = records.filter(r => r.id !== active.id);
    setRecords(updated);
    saveRecords(updated);
    setActiveId(updated.length ? updated[0].id : null);
  }

  function startDictation() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      window.alert('Голосовий ввід не підтримується в цьому браузері');
      return;
    }
    if (isListening && recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      setIsListening(false);
      return;
    }
    const recognition = new SR();
    recognition.lang = 'uk-UA';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      const next = text ? `${text} ${transcript}` : transcript;
      setText(next);
      persist(title, next);
    };
    recognition.onerror = () => { setIsListening(false); };
    recognition.onend = () => { setIsListening(false); };
    recognitionRef.current = recognition;
    try { recognition.start(); setIsListening(true); } catch { setIsListening(false); }
  }

  function sendToQuickInput() {
    if (!text.trim()) return;
    // Просто копіюємо в буфер обміну — QI-модуль можна буде інтегрувати пізніше.
    try {
      navigator.clipboard.writeText(text);
      window.alert('Текст скопійовано в буфер. Вставте в Quick Input.');
    } catch {
      window.alert('Не вдалося скопіювати в буфер.');
    }
  }

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* List */}
      <div style={{ width: 220, borderRight: '1px solid #2e3148', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: 10, borderBottom: '1px solid #2e3148', flexShrink: 0 }}>
          <button
            onClick={createRecord}
            style={{
              width: '100%', background: '#4f7cff', color: '#fff', border: 'none',
              borderRadius: 6, padding: '7px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            + Новий запис
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {records.length === 0 && (
            <div style={{ textAlign: 'center', color: '#5a6080', fontSize: 11, padding: 16 }}>
              Немає записів
            </div>
          )}
          {records.map(r => (
            <button
              key={r.id}
              onClick={() => setActiveId(r.id)}
              style={{
                background: r.id === activeId ? '#222536' : 'transparent',
                border: '1px solid ' + (r.id === activeId ? '#4f7cff' : '#2e3148'),
                borderRadius: 6, padding: '7px 9px', textAlign: 'left', cursor: 'pointer',
                color: '#e8eaf0', display: 'flex', flexDirection: 'column', gap: 3,
              }}
            >
              <span style={{
                fontSize: 12, fontWeight: 600, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {r.title || 'Без назви'}
              </span>
              <span style={{ fontSize: 10, color: '#5a6080' }}>{formatTs(r.updatedAt)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {!active ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a6080', fontSize: 12 }}>
            Створіть новий запис
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid #2e3148', flexShrink: 0 }}>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                onBlur={() => persist(title, text)}
                placeholder="Назва запису"
                style={{
                  flex: 1, background: 'transparent', color: '#e8eaf0',
                  border: 'none', outline: 'none', fontSize: 14, fontWeight: 600,
                }}
              />
              <button
                onClick={startDictation}
                title={isListening ? 'Стоп' : 'Надиктувати'}
                style={{
                  background: isListening ? '#e74c3c' : '#222536',
                  color: isListening ? '#fff' : '#9aa0b8',
                  border: '1px solid ' + (isListening ? '#e74c3c' : '#2e3148'),
                  borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                }}
              >
                {isListening ? '⏹ Стоп' : '🎤 Надиктувати'}
              </button>
              <button
                onClick={deleteActive}
                title="Видалити"
                style={{
                  background: 'transparent', color: '#5a6080',
                  border: '1px solid #2e3148', borderRadius: 6,
                  padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                }}
              >
                🗑
              </button>
            </div>

            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              onBlur={() => persist(title, text)}
              placeholder="Текст запису..."
              style={{
                flex: 1, resize: 'none',
                background: '#0f1117', color: '#e8eaf0',
                border: 'none', outline: 'none',
                padding: '12px 14px', fontSize: 13,
                fontFamily: 'inherit', lineHeight: 1.5,
              }}
            />

            <div style={{ display: 'flex', alignItems: 'center', padding: '8px 14px', borderTop: '1px solid #2e3148', flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: '#5a6080' }}>
                {text.length} символів
              </span>
              <button
                onClick={sendToQuickInput}
                disabled={!text.trim()}
                style={{
                  marginLeft: 'auto',
                  background: text.trim() ? '#222536' : 'transparent',
                  color: text.trim() ? '#e8eaf0' : '#5a6080',
                  border: '1px solid #2e3148',
                  borderRadius: 6, padding: '6px 12px', fontSize: 12,
                  cursor: text.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                📋 В Quick Input →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
