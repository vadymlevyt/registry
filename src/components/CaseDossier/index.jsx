import { useState, useEffect, useRef } from "react";

const CATEGORY_LABELS = {
  pleading: "Заява по суті", motion: "Клопотання",
  court_act: "Судовий акт", evidence: "Докази",
  correspondence: "Листування", other: "Інше"
};

const AUTHOR_LABELS = { ours: "Наш", opponent: "Опонент", court: "Суд" };

const TAG_COLORS = {
  key: { bg: "rgba(79,124,255,.2)", color: "#4f7cff" },
  ours: { bg: "rgba(46,204,113,.2)", color: "#2ecc71" },
  opponent: { bg: "rgba(168,85,247,.2)", color: "#a855f7" }
};

const PROC_COLORS = {
  first: "#2ecc71",
  appeal: "#a855f7",
  cassation: "#f39c12"
};

export default function CaseDossier({ caseData, cases, updateCase, onClose, onSaveIdea, onCloseCase, onDeleteCase, notes: notesProp, onAddNote, onUpdateNote, onDeleteNote, onPinNote }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [matMode, setMatMode] = useState("tree");
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [docFilters, setDocFilters] = useState({ proc: "all", category: "all", author: "all" });
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [ideaOpen, setIdeaOpen] = useState(false);
  const [ideaText, setIdeaText] = useState("");
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteText, setNoteText] = useState("");

  const [procModalOpen, setProcModalOpen] = useState(false);
  const [newProc, setNewProc] = useState({ title: '', court: '', type: 'appeal' });
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [newDoc, setNewDoc] = useState({ name: '', date: '', category: 'court_act', author: 'court', procId: '', tags: [], file: null });
  const [dropQueue, setDropQueue] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);

  // Agent panel state
  const [agentOpen, setAgentOpen] = useState(true);
  const [agentWidth, setAgentWidth] = useState(320);
  const [agentMessages, setAgentMessages] = useState(() => {
    const history = caseData.agentHistory || [];
    return history.slice(-20);
  });
  const [agentInput, setAgentInput] = useState('');
  const [agentLoading, setAgentLoading] = useState(false);
  const agentDragRef = useRef(false);

  // Materials resizer state
  const [matWidth, setMatWidth] = useState(300);
  const matDragRef = useRef(false);

  const proceedings = (caseData.proceedings && caseData.proceedings.length > 0)
    ? caseData.proceedings
    : [{
        id: 'proc_main',
        type: 'first',
        title: 'Основне провадження',
        court: caseData.court || '',
        status: 'active',
        parentProcId: null,
        parentEventId: null
      }];
  const documents = caseData.documents || [];

  const caseNotes = (notesProp || []).slice().sort((a, b) => new Date(b.ts || b.createdAt || 0) - new Date(a.ts || a.createdAt || 0));
  const pinnedNote = caseNotes.find(n => n.pinned) || caseNotes[0];

  const filteredDocs = documents.filter(d => {
    if (docFilters.proc !== "all" && d.procId !== docFilters.proc) return false;
    if (docFilters.category !== "all" && d.category !== docFilters.category) return false;
    if (docFilters.author !== "all" && d.author !== docFilters.author) return false;
    return true;
  });

  const categoryLabel = {
    civil: "Цивільна", criminal: "Кримінальна",
    military: "Військова", administrative: "Адміністративна"
  }[caseData.category] || caseData.category;

  const statusLabel = { active: "Активна", paused: "Призупинена", closed: "Закрита" }[caseData.status] || caseData.status;
  const statusColor = { active: "#2ecc71", paused: "#f39c12", closed: "#5a6080" }[caseData.status] || "#5a6080";

  function saveIdea() {
    if (!ideaText.trim()) return;
    if (onSaveIdea) onSaveIdea({
      id: Date.now(),
      text: ideaText,
      caseId: caseData.id,
      caseName: caseData.name,
      type: "post",
      status: "new",
      createdAt: new Date().toISOString()
    });
    setIdeaText("");
    setIdeaOpen(false);
  }

  function handleAddNote(text) {
    if (!text.trim()) return;
    onAddNote && onAddNote({
      text: text.trim(),
      caseId: caseData.id,
      caseName: caseData.name,
      category: "case",
      source: "manual"
    });
  }

  const driveConnected = !!localStorage.getItem("levytskyi_drive_token");

  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  // Agent default: open on overview, closed on other tabs
  useEffect(() => {
    setAgentOpen(activeTab === 'overview');
  }, [activeTab]);

  // Migrate caseData.notes string to a proper note in notes[]
  useEffect(() => {
    if (caseData.notes && typeof caseData.notes === 'string' && caseData.notes.trim()) {
      const alreadyExists = (notesProp || []).some(n =>
        n.caseId === caseData.id && n.text === caseData.notes
      );
      if (!alreadyExists && onAddNote) {
        onAddNote({
          text: caseData.notes,
          caseId: caseData.id,
          caseName: caseData.name,
          category: 'case',
          pinned: true,
          ts: new Date().toISOString()
        });
        updateCase && updateCase(caseData.id, 'notes', '');
      }
    }
  }, [caseData.id]); // eslint-disable-line

  // Agent panel drag resize
  useEffect(() => {
    function onMouseMove(e) {
      if (!agentDragRef.current) return;
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth > 200 && newWidth < window.innerWidth * 0.6) setAgentWidth(newWidth);
    }
    function onMouseUp() { agentDragRef.current = false; }
    function onTouchMove(e) {
      if (!agentDragRef.current) return;
      const touch = e.touches[0];
      const newWidth = window.innerWidth - touch.clientX;
      if (newWidth > 200 && newWidth < window.innerWidth * 0.6) setAgentWidth(newWidth);
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove);
    window.addEventListener('touchend', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onMouseUp);
    };
  }, []);

  // Materials panel drag resize
  useEffect(() => {
    function onMove(e) {
      if (!matDragRef.current) return;
      const newWidth = e.clientX;
      if (newWidth > 150 && newWidth < window.innerWidth * 0.5) setMatWidth(newWidth);
    }
    function onUp() { matDragRef.current = false; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  async function uploadFileToDrive(file, cData) {
    const token = localStorage.getItem("levytskyi_drive_token");
    if (!token) throw new Error("No Drive token");
    const metadata = {
      name: file.name,
      ...(cData.driveFolderId ? { parents: [cData.driveFolderId] } : {})
    };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", file);
    const response = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
      { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }
    );
    if (!response.ok) throw new Error(`Drive upload failed: ${response.status}`);
    const data = await response.json();
    return data.id;
  }

  async function prepareFile(file) {
    if (file.name.match(/\.heic$/i) || file.type === "image/heic") {
      try {
        if (typeof window.heic2any === "function") {
          const blob = await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
          return new File([blob], file.name.replace(/\.heic$/i, ".jpg"), { type: "image/jpeg" });
        }
      } catch (err) {
        console.error("HEIC conversion failed:", err);
      }
    }
    return file;
  }

  const iconBtn = { background: "none", border: "1px solid #2e3148", color: "#9aa0b8", padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12 };
  const primaryBtn = { background: "#4f7cff", color: "#fff", border: "none", padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 };

  // ── АГЕНТ ДОСЬЄ ────────────────────────────────────────────────────────────
  function renderAgentPanel() {
    async function sendAgentMessage() {
      if (!agentInput.trim() || agentLoading) return;
      const userMsg = agentInput.trim();
      const userTs = new Date().toISOString();
      setAgentInput('');
      const userEntry = { role: 'user', content: userMsg, ts: userTs };
      setAgentMessages(prev => [...prev, userEntry]);
      setAgentLoading(true);
      try {
        const apiKey = localStorage.getItem('claude_api_key');
        const systemPrompt = `Ти агент справи "${caseData.name}".
Знаєш про справу:
- Суд: ${caseData.court || "не вказано"}
- Номер: ${caseData.case_no || "не вказано"}
- Категорія: ${caseData.category || "не вказано"}
- Статус: ${caseData.status || "не вказано"}
- Провадження: ${JSON.stringify(caseData.proceedings || [])}
- Документів: ${(caseData.documents || []).length}
Відповідай українською. Допомагай з аналізом і тактикою по справі.`;

        // Send last 10 messages as context for API (token economy)
        const historyForAPI = agentMessages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .slice(-10)
          .map(m => ({ role: m.role, content: m.content }));

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            system: systemPrompt,
            messages: [...historyForAPI, { role: 'user', content: userMsg }]
          })
        });
        const data = await response.json();
        const reply = data.content?.[0]?.text || "Помилка відповіді";
        const assistantEntry = { role: 'assistant', content: reply, ts: new Date().toISOString() };
        setAgentMessages(prev => {
          const updated = [...prev, assistantEntry];
          const trimmed = updated.slice(-50);
          updateCase && updateCase(caseData.id, 'agentHistory', trimmed);
          return updated;
        });
      } catch (err) {
        const errEntry = { role: 'assistant', content: "Помилка з'єднання з агентом.", ts: new Date().toISOString() };
        setAgentMessages(prev => {
          const updated = [...prev, errEntry];
          const trimmed = updated.slice(-50);
          updateCase && updateCase(caseData.id, 'agentHistory', trimmed);
          return updated;
        });
      }
      setAgentLoading(false);
    }

    return (
      <>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #2e3148', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 14 }}>{"🤖"}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{"Агент досьє"}</div>
            <div style={{ fontSize: 10, color: '#5a6080' }}>{"Sonnet · знає справу"}</div>
          </div>
          <button onClick={() => setConfirmClearOpen(true)} style={{ background: 'none', border: 'none', color: '#5a6080', cursor: 'pointer', fontSize: 10 }}>{"\u002B Нова розмова"}</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {agentMessages.length === 0 && (
            <div style={{ fontSize: 11, color: '#3a3f58', textAlign: 'center', marginTop: 20 }}>
              {"Запитайте про справу, тактику або документи"}
            </div>
          )}
          {agentMessages.map((msg, i) => {
            const showDate = msg.ts && (i === 0 ||
              new Date(msg.ts).toDateString() !== new Date(agentMessages[i - 1]?.ts).toDateString()
            );
            return (
              <div key={i}>
                {showDate && (
                  <div style={{ textAlign: 'center', fontSize: 10, color: '#3a3f58', margin: '8px 0' }}>
                    {new Date(msg.ts).toLocaleDateString('uk-UA')}
                  </div>
                )}
                <div style={{
                  padding: '8px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1.6, maxWidth: '90%',
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  background: msg.role === 'user' ? 'rgba(79,124,255,.2)' : '#222536',
                  color: '#e8eaf0', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
                }}>
                  {msg.content}
                </div>
              </div>
            );
          })}
          {agentLoading && (
            <div style={{ padding: '8px 10px', borderRadius: 8, background: '#222536', fontSize: 12, color: '#5a6080' }}>{"⏳ Думаю..."}</div>
          )}
        </div>
        <div style={{ padding: 8, borderTop: '1px solid #2e3148', display: 'flex', gap: 6, flexShrink: 0 }}>
          <textarea
            value={agentInput}
            onChange={e => setAgentInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAgentMessage(); } }}
            placeholder="Запитати агента..."
            rows={2}
            style={{
              flex: 1, background: '#222536', border: '1px solid #2e3148', color: '#e8eaf0',
              padding: '6px 8px', borderRadius: 6, fontSize: 12, resize: 'none', outline: 'none', lineHeight: 1.5
            }}
          />
          <button
            onClick={sendAgentMessage}
            disabled={agentLoading || !agentInput.trim()}
            style={{
              background: '#4f7cff', border: 'none', color: '#fff',
              padding: '0 12px', borderRadius: 6,
              cursor: agentLoading ? 'default' : 'pointer',
              fontSize: 16, opacity: agentLoading ? 0.5 : 1
            }}
          >{"\u2192"}</button>
        </div>
        {confirmClearOpen && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,.6)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 10,
            borderRadius: 8
          }}>
            <div style={{
              background: '#1e2138', borderRadius: 12, padding: '20px 24px',
              maxWidth: 300, textAlign: 'center', border: '1px solid #2e3148'
            }}>
              <div style={{ fontSize: 14, color: '#e8eaf0', marginBottom: 16 }}>
                {"Почати нову розмову? Поточна історія буде очищена."}
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button
                  onClick={() => setConfirmClearOpen(false)}
                  style={{
                    padding: '8px 20px', borderRadius: 6, border: '1px solid #2e3148',
                    background: 'transparent', color: '#9aa0b8', cursor: 'pointer', fontSize: 13
                  }}
                >{"Скасувати"}</button>
                <button
                  onClick={() => {
                    setAgentMessages([]);
                    updateCase && updateCase(caseData.id, 'agentHistory', []);
                    setConfirmClearOpen(false);
                  }}
                  style={{
                    padding: '8px 20px', borderRadius: 6, border: 'none',
                    background: '#e74c3c', color: '#fff', cursor: 'pointer', fontSize: 13
                  }}
                >{"Очистити"}</button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // ── ОГЛЯД ──────────────────────────────────────────────────────────────────
  function renderOverview() {
    return (
      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>

        {/* Поля справи — inline редагування */}
        <div style={{ background: "#1a1d27", border: "1px solid #2e3148", borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: "#5a6080", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12 }}>{"Інформація про справу"}</div>
          {[
            { label: "Суд", field: "court", value: caseData.court },
            { label: "Номер справи", field: "case_no", value: caseData.case_no },
            { label: "Категорія", field: "category", value: categoryLabel },
            { label: "Наступна дія", field: "next_action", value: caseData.next_action },
            { label: "Дата засідання", field: "hearing_date", value: caseData.hearing_date },
            { label: "Дедлайн", field: "deadline", value: caseData.deadline }
          ].map(row => (
            <div key={row.field} style={{ display: "flex", gap: 12, marginBottom: 10, alignItems: "flex-start" }}>
              <div style={{ width: 130, fontSize: 11, color: "#5a6080", flexShrink: 0, paddingTop: 2 }}>{row.label}</div>
              <div
                contentEditable
                suppressContentEditableWarning
                onBlur={e => updateCase && updateCase(caseData.id, row.field, e.target.innerText.trim())}
                onFocus={e => e.target.style.borderColor = "#4f7cff"}
                onBlurCapture={e => e.target.style.borderColor = "transparent"}
                style={{ flex: 1, fontSize: 12, color: row.value ? "#e8eaf0" : "#3a3f58", outline: "none", minHeight: 20, padding: "2px 6px", borderRadius: 4, border: "1px solid transparent", cursor: "text", transition: "border-color .15s" }}
              >{row.value || "\u2014"}</div>
            </div>
          ))}

          {/* Нотатки до справи */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#5a6080", marginBottom: 4 }}>{"Нотатки до справи"}</div>
            {(() => {
              const pinned = caseNotes.filter(n => n.pinned);
              if (pinned.length > 0) {
                return (
                  <div style={{
                    background: "#1a1d2e", borderRadius: 6, padding: "8px 10px",
                    fontSize: 12, color: "#c8cce0", lineHeight: 1.6,
                    borderLeft: "3px solid #4f7cff"
                  }}>
                    {pinned.map((note, i) => (
                      <div key={note.id || i} style={{
                        marginBottom: i < pinned.length - 1 ? 8 : 0,
                        paddingBottom: i < pinned.length - 1 ? 8 : 0,
                        borderBottom: i < pinned.length - 1 ? "1px solid #2e3148" : "none"
                      }}>
                        <div style={{ fontSize: 10, color: "#5a6080", marginBottom: 2 }}>
                          {"📌 "}{(note.ts || note.createdAt) ? new Date(note.ts || note.createdAt).toLocaleDateString("uk-UA") : ""}
                        </div>
                        <div>{String(note.text || "")}</div>
                      </div>
                    ))}
                  </div>
                );
              }
              return (
                <div style={{ fontSize: 12, color: "#5a6080", fontStyle: "italic", padding: "8px 10px" }}>
                  {"Закріпіть нотатку 📌 зі списку нижче"}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Провадження */}
        {proceedings.length > 0 && (
          <div style={{ background: "#1a1d27", border: "1px solid #2e3148", borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "#5a6080", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>{"Провадження"}</div>
            {proceedings.map(proc => (
              <div key={proc.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#222536", borderRadius: 7, marginBottom: 6, borderLeft: `3px solid ${PROC_COLORS[proc.type] || "#2e3148"}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{proc.title}</div>
                  <div style={{ fontSize: 10, color: "#5a6080", marginTop: 2 }}>{proc.court}</div>
                  {proc.parentProcId && <div style={{ fontSize: 10, color: "#3a3f58", marginTop: 2 }}>{"\u2190 з "}{proceedings.find(p => p.id === proc.parentProcId)?.title}</div>}
                </div>
                <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 3, fontWeight: 600, background: proc.status === "active" ? "rgba(46,204,113,.15)" : "rgba(243,156,18,.15)", color: proc.status === "active" ? "#2ecc71" : "#f39c12" }}>
                  {proc.status === "active" ? "Активне" : "На паузі"}
                </span>
              </div>
            ))}
            <button
              onClick={() => setProcModalOpen(true)}
              style={{ width: '100%', padding: '7px', background: 'none', border: '1px dashed #2e3148', borderRadius: 7, color: '#5a6080', cursor: 'pointer', fontSize: 12, marginTop: 6 }}
            >+ Додати провадження</button>
          </div>
        )}

        {/* Нотатки */}
        <div style={{ background: "#1a1d27", border: "1px solid #2e3148", borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "#5a6080", textTransform: "uppercase", letterSpacing: ".06em" }}>{"Нотатки по справі"}</div>
            <div style={{ display: "flex", gap: 6 }}>
              {caseNotes.length > 1 && (
                <button onClick={() => setNotesExpanded(!notesExpanded)} style={iconBtn}>
                  {notesExpanded ? "\u2227 Згорнути" : `\u2228 ще ${caseNotes.length - 1}`}
                </button>
              )}
              <button onClick={() => setNoteModalOpen(true)} style={iconBtn}>+ Додати</button>
            </div>
          </div>
          {caseNotes.length === 0 ? (
            <div style={{ fontSize: 12, color: "#3a3f58" }}>{"Нотаток поки немає"}</div>
          ) : (notesExpanded ? caseNotes : [pinnedNote]).filter(Boolean).map(note => (
            <div key={note.id} style={{
              padding: "8px 10px", borderRadius: 7, marginBottom: 6, fontSize: 12, color: "#9aa0b8", lineHeight: 1.6,
              background: note.pinned ? "rgba(79,124,255,0.08)" : "#222536",
              borderLeft: note.pinned ? "2px solid #4f7cff" : "2px solid transparent",
              transition: "all 0.2s"
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                <div style={{ flex: 1 }}>
                  {String(note.text || "")}
                </div>
                <button
                  onClick={() => onPinNote && onPinNote(note.id)}
                  title={note.pinned ? "Відкріпити" : "Закріпити"}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: 16, padding: "2px 4px", flexShrink: 0,
                    filter: note.pinned ? "none" : "grayscale(1) opacity(0.3)",
                    transform: note.pinned ? "rotate(-45deg)" : "none",
                    transition: "all 0.2s"
                  }}
                >{"📌"}</button>
              </div>
              <div style={{ fontSize: 10, color: "#3a3f58", marginTop: 4 }}>{(note.ts || note.createdAt) ? new Date(note.ts || note.createdAt).toLocaleDateString("uk-UA") : ""}</div>
            </div>
          ))}
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={e => {
            e.preventDefault();
            setIsDragOver(false);
            const files = Array.from(e.dataTransfer.files);
            setDropQueue(prev => [...prev, ...files.map(f => ({ file: f, status: "pending" }))]);
          }}
          onClick={() => document.getElementById("dossierDropInput").click()}
          style={{
            background: isDragOver ? "rgba(79,124,255,.05)" : "#1a1d27",
            border: `2px dashed ${isDragOver ? "#4f7cff" : "#2e3148"}`,
            borderRadius: 10, padding: 20, textAlign: "center",
            cursor: "pointer", transition: "all .2s", marginBottom: 12
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 8, opacity: .4 }}>{"📎"}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#9aa0b8", marginBottom: 4 }}>
            {isDragOver ? "Відпустіть файли" : "Перетягніть або натисніть"}
          </div>
          <div style={{ fontSize: 11, color: "#5a6080" }}>{"PDF, JPEG, PNG, HEIC, Word — будь-яка кількість"}</div>
          <input
            id="dossierDropInput"
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx"
            style={{ display: "none" }}
            onChange={e => {
              const files = Array.from(e.target.files);
              setDropQueue(prev => [...prev, ...files.map(f => ({ file: f, status: "pending" }))]);
            }}
          />
        </div>

        {/* Черга файлів */}
        {dropQueue.length > 0 && (
          <div style={{ background: "#1a1d27", border: "1px solid #2e3148", borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
            {dropQueue.map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid #2e3148" }}>
                <span style={{ fontSize: 13 }}>{item.file.name.match(/\.(jpg|jpeg|png|heic)$/i) ? "🖼" : "📄"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.file.name}</div>
                  <div style={{ fontSize: 10, color: "#5a6080" }}>{(item.file.size / 1024 / 1024).toFixed(1)} {"МБ"}</div>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 600,
                  color: item.status === "done" ? "#2ecc71" : item.status === "error" ? "#e74c3c" : "#9aa0b8"
                }}>
                  {item.status === "done" ? "\u2713" : item.status === "error" ? "\u2717" : "\u23f3"}
                </span>
              </div>
            ))}
            <div style={{ padding: 8, display: "flex", gap: 6 }}>
              <button
                onClick={() => setDropQueue([])}
                style={{ flex: 1, background: "none", border: "1px solid #2e3148", color: "#9aa0b8", padding: "5px", borderRadius: 5, cursor: "pointer", fontSize: 11 }}
              >{"Очистити"}</button>
              <button
                onClick={async () => {
                  for (let i = 0; i < dropQueue.length; i++) {
                    if (dropQueue[i].status === "done") continue;
                    setDropQueue(prev => prev.map((item, idx) => idx === i ? { ...item, status: "uploading" } : item));
                    try {
                      if (driveConnected) {
                        const prepared = await prepareFile(dropQueue[i].file);
                        await uploadFileToDrive(prepared, caseData);
                      }
                      setDropQueue(prev => prev.map((item, idx) => idx === i ? { ...item, status: "done" } : item));
                    } catch {
                      setDropQueue(prev => prev.map((item, idx) => idx === i ? { ...item, status: "error" } : item));
                    }
                  }
                }}
                style={{ flex: 2, background: "#4f7cff", border: "none", color: "#fff", padding: "5px", borderRadius: 5, cursor: "pointer", fontSize: 11, fontWeight: 600 }}
              >{"\u25b6 Завантажити на Drive"}</button>
            </div>
          </div>
        )}

      </div>
    );
  }

  // ── МАТЕРІАЛИ ──────────────────────────────────────────────────────────────
  function renderMaterials() {
    return (
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

        {/* Ліва панель */}
        <div style={{ width: matWidth, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Перемикач Дерево / Реєстр */}
          <div style={{ display: "flex", borderBottom: "1px solid #2e3148", flexShrink: 0 }}>
            {[["tree", "🌳 Дерево"], ["registry", "📋 Реєстр"]].map(([id, label]) => (
              <button key={id} onClick={() => setMatMode(id)} style={{ flex: 1, padding: 8, border: "none", background: "none", color: matMode === id ? "#e8eaf0" : "#9aa0b8", cursor: "pointer", fontSize: 12, borderBottom: `2px solid ${matMode === id ? "#4f7cff" : "transparent"}`, fontWeight: matMode === id ? 500 : 400 }}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ padding: "6px 8px", borderBottom: "1px solid #2e3148", flexShrink: 0 }}>
            <button
              onClick={() => { setNewDoc(d => ({ ...d, procId: proceedings[0]?.id || 'proc_main' })); setDocModalOpen(true); }}
              style={{ background: '#4f7cff', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12, width: '100%' }}
            >+ Додати документ</button>
          </div>

          {/* ДЕРЕВО */}
          {matMode === "tree" && (
            <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
              {proceedings.map(proc => {
                const procDocs = documents.filter(d => d.procId === proc.id);
                const indent = proc.parentProcId ? 12 : 0;
                return (
                  <div key={proc.id} style={{ marginBottom: 12, marginLeft: indent }}>
                    {proc.parentProcId && <div style={{ fontSize: 10, color: "#5a6080", marginBottom: 4, paddingLeft: 4 }}>{"\u2514\u2500"}</div>}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 6, background: "#222536", borderLeft: `3px solid ${PROC_COLORS[proc.type] || "#2e3148"}`, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: PROC_COLORS[proc.type] || "#9aa0b8", flex: 1 }}>{proc.title}</span>
                      <span style={{ fontSize: 9, color: "#5a6080" }}>{procDocs.length}</span>
                    </div>
                    {procDocs.map(doc => (
                      <div key={doc.id} onClick={() => setSelectedDoc(doc)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px 6px 18px", borderRadius: 6, cursor: "pointer", background: selectedDoc?.id === doc.id ? "#222536" : "transparent", border: `1px solid ${selectedDoc?.id === doc.id ? "#4f7cff" : "transparent"}`, marginBottom: 2, transition: "all .15s" }}>
                        <span style={{ fontSize: 13, flexShrink: 0 }}>{doc.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{doc.name}</div>
                          <div style={{ fontSize: 10, color: "#5a6080" }}>{doc.date}</div>
                        </div>
                        {doc.tags?.includes("key") && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: "rgba(79,124,255,.2)", color: "#4f7cff", flexShrink: 0 }}>{"ключовий"}</span>}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* РЕЄСТР з фільтрами */}
          {matMode === "registry" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ padding: "6px 8px", borderBottom: "1px solid #2e3148", display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>

                {/* Фільтр провадження */}
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  <button onClick={() => setDocFilters(f => ({ ...f, proc: "all" }))} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, border: "1px solid", borderColor: docFilters.proc === "all" ? "#4f7cff" : "#2e3148", color: docFilters.proc === "all" ? "#4f7cff" : "#9aa0b8", background: docFilters.proc === "all" ? "rgba(79,124,255,.08)" : "none", cursor: "pointer" }}>{"Всі"}</button>
                  {proceedings.map(proc => (
                    <button key={proc.id} onClick={() => setDocFilters(f => ({ ...f, proc: f.proc === proc.id ? "all" : proc.id }))} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, border: "1px solid", borderColor: docFilters.proc === proc.id ? PROC_COLORS[proc.type] : "#2e3148", color: docFilters.proc === proc.id ? PROC_COLORS[proc.type] : "#9aa0b8", background: docFilters.proc === proc.id ? `${PROC_COLORS[proc.type]}22` : "none", cursor: "pointer" }}>
                      {proc.type === "first" ? "Перша" : proc.type === "appeal" ? "Апеляція" : "Касація"}
                    </button>
                  ))}
                </div>

                {/* Фільтр типу */}
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {["all", "pleading", "motion", "court_act", "evidence", "correspondence"].map(cat => (
                    <button key={cat} onClick={() => setDocFilters(f => ({ ...f, category: cat }))} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, border: "1px solid", borderColor: docFilters.category === cat ? "#9aa0b8" : "#2e3148", color: docFilters.category === cat ? "#e8eaf0" : "#5a6080", background: "none", cursor: "pointer" }}>
                      {cat === "all" ? "Всі типи" : CATEGORY_LABELS[cat]}
                    </button>
                  ))}
                </div>

                {/* Фільтр автора */}
                <div style={{ display: "flex", gap: 3 }}>
                  {["all", "ours", "opponent", "court"].map(auth => (
                    <button key={auth} onClick={() => setDocFilters(f => ({ ...f, author: auth }))} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, border: "1px solid", borderColor: docFilters.author === auth ? "#9aa0b8" : "#2e3148", color: docFilters.author === auth ? "#e8eaf0" : "#5a6080", background: "none", cursor: "pointer" }}>
                      {auth === "all" ? "Всі" : AUTHOR_LABELS[auth]}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: 6 }}>
                {filteredDocs.length === 0 ? (
                  <div style={{ padding: 20, textAlign: "center", color: "#3a3f58", fontSize: 12 }}>{"Немає документів"}</div>
                ) : filteredDocs.map(doc => {
                  const proc = proceedings.find(p => p.id === doc.procId);
                  return (
                    <div key={doc.id} onClick={() => setSelectedDoc(doc)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 6, cursor: "pointer", background: selectedDoc?.id === doc.id ? "#222536" : "transparent", border: `1px solid ${selectedDoc?.id === doc.id ? "#4f7cff" : "transparent"}`, marginBottom: 2, borderLeft: proc?.type === "appeal" ? "3px solid rgba(168,85,247,.45)" : proc?.type === "cassation" ? "3px solid rgba(243,156,18,.45)" : "1px solid transparent", transition: "all .15s" }}>
                      <span style={{ fontSize: 13, flexShrink: 0 }}>{doc.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{doc.name}</div>
                        <div style={{ fontSize: 10, color: "#5a6080" }}>
                          {doc.date}{" \u00b7 "}{proc?.type === "first" ? "[П]" : proc?.type === "appeal" ? "[А]" : "[К]"}
                        </div>
                        {doc.tags?.length > 0 && (
                          <div style={{ display: "flex", gap: 3, marginTop: 2, flexWrap: "wrap" }}>
                            {doc.tags.map(tag => (
                              <span key={tag} style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, fontWeight: 600, background: TAG_COLORS[tag]?.bg, color: TAG_COLORS[tag]?.color }}>{tag === "key" ? "ключовий" : tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Рухома межа */}
        <div
          onMouseDown={() => { matDragRef.current = true; }}
          onTouchStart={() => { matDragRef.current = true; }}
          style={{ width: 6, cursor: 'col-resize', flexShrink: 0, background: '#2e3148', transition: 'background .15s' }}
          onMouseEnter={e => e.currentTarget.style.background = '#4f7cff'}
          onMouseLeave={e => e.currentTarget.style.background = '#2e3148'}
        />

        {/* Viewer */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {!selectedDoc ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#5a6080", gap: 8 }}>
              <div style={{ fontSize: 36, opacity: .2 }}>{"📄"}</div>
              <div style={{ fontSize: 12 }}>{"Оберіть документ зі списку"}</div>
            </div>
          ) : (
            <>
              <div style={{ padding: "9px 14px", borderBottom: "1px solid #2e3148", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selectedDoc.name}</div>
                  <div style={{ fontSize: 11, color: "#5a6080" }}>{selectedDoc.date}</div>
                </div>
                <div style={{ display: "flex", gap: 5 }}>
                  {["Копіювати", "Завантажити", "🤖 Аналіз"].map(btn => (
                    <button key={btn} style={iconBtn}>{btn}</button>
                  ))}
                </div>
              </div>
              {selectedDoc.driveId ? (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: 20 }}>
                  <div style={{ background: "#1a1d27", border: "1px solid #2e3148", borderRadius: 10, padding: 24, maxWidth: 680, margin: "0 auto", flex: 1, display: "flex", flexDirection: "column" }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, textAlign: "center", marginBottom: 16 }}>{selectedDoc.name}</h3>
                    <iframe
                      src={`https://drive.google.com/file/d/${selectedDoc.driveId}/preview`}
                      style={{ width: "100%", flex: 1, minHeight: 400, border: "none", borderRadius: 8 }}
                      allow="autoplay"
                      title={selectedDoc.name}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "center" }}>
                      <a
                        href={`https://drive.google.com/file/d/${selectedDoc.driveId}/view`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ background: "#4f7cff", color: "#fff", padding: "6px 14px", borderRadius: 6, fontSize: 12, textDecoration: "none" }}
                      >{"Відкрити в Drive"}</a>
                      <a
                        href={`https://drive.google.com/uc?export=download&id=${selectedDoc.driveId}`}
                        style={{ background: "#222536", color: "#9aa0b8", border: "1px solid #2e3148", padding: "6px 14px", borderRadius: 6, fontSize: 12, textDecoration: "none" }}
                      >{"Завантажити"}</a>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
                  <div style={{ background: "#1a1d27", border: "1px solid #2e3148", borderRadius: 10, padding: 24, maxWidth: 680, margin: "0 auto", lineHeight: 1.8 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, textAlign: "center", marginBottom: 4 }}>{selectedDoc.name}</h3>
                    <div style={{ fontSize: 11, color: "#5a6080", textAlign: "center", marginBottom: 16 }}>{selectedDoc.date}</div>
                    {selectedDoc.notes && <div style={{ background: "rgba(231,76,60,.08)", border: "1px solid rgba(231,76,60,.3)", padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 11, color: "#e74c3c" }}>{selectedDoc.notes}</div>}
                    <p style={{ fontSize: 13, color: "#9aa0b8" }}>{"Для перегляду повного тексту прикріпіть файл з Google Drive."}</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ── RENDER ─────────────────────────────────────────────────────────────────

  const tabs = [
    { id: "overview", label: "📋 Огляд" },
    { id: "materials", label: "📁 Матеріали", badge: documents.length },
    { id: "position", label: "⚖️ Позиція" },
    { id: "templates", label: "📄 Шаблони" }
  ];

  return (
    <div style={{ position: "absolute", inset: 0, background: "#0f1117", display: "flex", flexDirection: "column", zIndex: 50, color: "#e8eaf0", fontFamily: "'Segoe UI',sans-serif", fontSize: 13 }}>

      {/* ШАПКА */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid #2e3148", display: "flex", alignItems: "center", gap: 12, flexShrink: 0, background: "#1a1d27" }}>
        <button onClick={onClose} style={{ background: "#222536", border: "1px solid #2e3148", color: "#9aa0b8", padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>{"\u2190 Реєстр"}</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{caseData.name}</div>
          <div style={{ fontSize: 11, color: "#5a6080", marginTop: 2 }}>
            {categoryLabel}{caseData.court ? ` \u00b7 ${caseData.court}` : ""}{caseData.case_no ? ` \u00b7 \u2116${caseData.case_no}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 4, fontWeight: 600, background: `${statusColor}22`, color: statusColor }}>{statusLabel}</span>
          {caseData.hearing_date && <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 4, fontWeight: 600, background: "rgba(243,156,18,.15)", color: "#f39c12" }}>{"📅 "}{caseData.hearing_date}</span>}
          {caseData.status !== "closed" && onCloseCase && (
            <button onClick={() => {
              if (window.confirm("Закрити справу? Вона перейде в архів. Видалити можна буде звідти.")) {
                onCloseCase(caseData.id);
                onClose();
              }
            }} style={{ background: "none", border: "1px solid rgba(231,76,60,.3)", color: "#e74c3c", padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>{"📦 Закрити"}</button>
          )}
          {caseData.status === "closed" && onDeleteCase && (
            <button onClick={() => onDeleteCase(caseData)} style={{ background: "rgba(231,76,60,.1)", border: "1px solid rgba(231,76,60,.3)", color: "#e74c3c", padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>{"🗑 Видалити назавжди"}</button>
          )}
          <button onClick={() => setIdeaOpen(true)} title="Ідея для контенту" style={{ background: "none", border: "1px solid #2e3148", color: "#9aa0b8", padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 14 }}>{"💡"}</button>
          <button onClick={() => setAgentOpen(prev => !prev)} style={{ background: agentOpen ? "#4f7cff" : "none", color: agentOpen ? "#fff" : "#9aa0b8", border: "1px solid", borderColor: agentOpen ? "#4f7cff" : "#2e3148", padding: "6px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 500 }}>{agentOpen ? "🤖 Сховати агента" : "🤖 Агент"}</button>
        </div>
      </div>

      {/* ВКЛАДКИ */}
      <div style={{ display: "flex", borderBottom: "1px solid #2e3148", flexShrink: 0, padding: "0 16px", gap: 2 }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ padding: "8px 14px", border: "none", background: "none", color: activeTab === tab.id ? "#e8eaf0" : "#9aa0b8", cursor: "pointer", fontSize: 12, borderBottom: `2px solid ${activeTab === tab.id ? "#9aa0b8" : "transparent"}`, fontWeight: activeTab === tab.id ? 500 : 400, whiteSpace: "nowrap", transition: "all .15s" }}>
            {tab.label}
            {tab.badge > 0 && <span style={{ fontSize: 9, background: "#222536", padding: "1px 5px", borderRadius: 8, marginLeft: 4, color: "#5a6080" }}>{tab.badge}</span>}
          </button>
        ))}
      </div>

      {/* BODY */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        {/* Основний вміст вкладки */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', minWidth: 0 }}>
          {activeTab === "overview" && renderOverview()}
          {activeTab === "materials" && renderMaterials()}
          {["position", "templates"].includes(activeTab) && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#5a6080", gap: 12 }}>
              <div style={{ fontSize: 48, opacity: .2 }}>{activeTab === "position" ? "⚖️" : "📄"}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#9aa0b8" }}>{activeTab === "position" ? "Позиція" : "Шаблони"}</div>
              <div style={{ fontSize: 12 }}>{"Буде реалізовано в наступній під-сесії"}</div>
            </div>
          )}
        </div>

        {/* Рухома межа агента */}
        {agentOpen && (
          <div
            onMouseDown={() => { agentDragRef.current = true; }}
            onTouchStart={() => { agentDragRef.current = true; }}
            style={{ width: 6, cursor: 'col-resize', flexShrink: 0, background: '#2e3148', transition: 'background .15s' }}
            onMouseEnter={e => e.currentTarget.style.background = '#4f7cff'}
            onMouseLeave={e => e.currentTarget.style.background = '#2e3148'}
          />
        )}

        {/* Панель агента */}
        {agentOpen && (
          <div style={{
            width: agentWidth, flexShrink: 0, borderLeft: '1px solid #2e3148',
            display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#1a1d27'
          }}>
            {renderAgentPanel()}
          </div>
        )}
      </div>

      {/* МОДАЛКА ІДЕЯ ДЛЯ КОНТЕНТУ */}
      {ideaOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
          <div style={{ background: "#1a1d27", border: "1px solid #2e3148", borderRadius: 12, padding: 20, width: 360 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{"💡 Ідея для контенту"}</div>
            <div style={{ fontSize: 11, color: "#5a6080", marginBottom: 12 }}>{"Справа: "}{caseData.name}</div>
            <textarea
              value={ideaText}
              onChange={e => setIdeaText(e.target.value)}
              placeholder="Опиши ідею..."
              style={{ width: "100%", height: 100, background: "#222536", border: "1px solid #2e3148", color: "#e8eaf0", padding: 10, borderRadius: 7, fontSize: 12, resize: "none", outline: "none", lineHeight: 1.6, boxSizing: "border-box" }}
              autoFocus
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
              <button onClick={() => { setIdeaOpen(false); setIdeaText(""); }} style={iconBtn}>{"Скасувати"}</button>
              <button onClick={saveIdea} style={primaryBtn}>{"Зберегти ідею"}</button>
            </div>
          </div>
        </div>
      )}

      {/* МОДАЛКА НОТАТКИ */}
      {noteModalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
          <div style={{ background: "#1a1d27", border: "1px solid #2e3148", borderRadius: 12, padding: 20, width: 400 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{"+ Нова нотатка"}</div>
            <div style={{ fontSize: 11, color: "#5a6080", marginBottom: 8 }}>{"Справа: "}{caseData.name}</div>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Текст нотатки..."
              rows={5}
              style={{ width: "100%", background: "#222536", border: "1px solid #2e3148", color: "#e8eaf0", padding: 10, borderRadius: 7, fontSize: 12, resize: "vertical", outline: "none", lineHeight: 1.6, boxSizing: "border-box" }}
              autoFocus
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              <button onClick={() => { setNoteModalOpen(false); setNoteText(""); }} style={iconBtn}>{"Скасувати"}</button>
              <button onClick={() => {
                if (!noteText.trim()) return;
                handleAddNote(noteText.trim());
                setNoteModalOpen(false);
                setNoteText("");
              }} style={primaryBtn}>{"Зберегти"}</button>
            </div>
          </div>
        </div>
      )}

      {/* МОДАЛКА + ПРОВАДЖЕННЯ */}
      {procModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}>
          <div style={{ background: '#1a1d27', border: '1px solid #2e3148', borderRadius: 12, padding: 20, width: 360 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>+ Нове провадження</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 4 }}>Тип</div>
                <select value={newProc.type} onChange={e => setNewProc(p => ({ ...p, type: e.target.value }))} style={{ width: '100%', background: '#222536', border: '1px solid #2e3148', color: '#e8eaf0', padding: '7px 10px', borderRadius: 6, fontSize: 12 }}>
                  <option value="appeal">{"Апеляційне провадження"}</option>
                  <option value="cassation">{"Касація"}</option>
                  <option value="first">{"Перша інстанція (додаткова)"}</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 4 }}>Назва</div>
                <input value={newProc.title} onChange={e => setNewProc(p => ({ ...p, title: e.target.value }))} placeholder="напр. Апеляція: ухвала 03.2024" style={{ width: '100%', background: '#222536', border: '1px solid #2e3148', color: '#e8eaf0', padding: '7px 10px', borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 4 }}>Суд</div>
                <input value={newProc.court} onChange={e => setNewProc(p => ({ ...p, court: e.target.value }))} placeholder="напр. Київський апеляційний суд" style={{ width: '100%', background: '#222536', border: '1px solid #2e3148', color: '#e8eaf0', padding: '7px 10px', borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button onClick={() => { setProcModalOpen(false); setNewProc({ title: '', court: '', type: 'appeal' }); }} style={{ background: 'none', border: '1px solid #2e3148', color: '#9aa0b8', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Скасувати</button>
              <button onClick={() => {
                if (!newProc.title.trim()) return;
                const proc = { id: 'proc_' + Date.now(), type: newProc.type, title: newProc.title.trim(), court: newProc.court.trim(), status: 'active', parentProcId: 'proc_main', parentEventId: null };
                const updated = [...proceedings, proc];
                updateCase && updateCase(caseData.id, 'proceedings', updated);
                setProcModalOpen(false);
                setNewProc({ title: '', court: '', type: 'appeal' });
              }} style={{ background: '#4f7cff', color: '#fff', border: 'none', padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Додати</button>
            </div>
          </div>
        </div>
      )}

      {/* МОДАЛКА + ДОКУМЕНТ */}
      {docModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}>
          <div style={{ background: '#1a1d27', border: '1px solid #2e3148', borderRadius: 12, padding: 20, width: 400 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>+ Новий документ</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 4 }}>{"Назва *"}</div>
                <input value={newDoc.name} onChange={e => setNewDoc(d => ({ ...d, name: e.target.value }))} placeholder="напр. Ухвала про відкриття провадження" style={{ width: '100%', background: '#222536', border: '1px solid #2e3148', color: '#e8eaf0', padding: '7px 10px', borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box' }} autoFocus />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 4 }}>Дата</div>
                  <input value={newDoc.date} onChange={e => setNewDoc(d => ({ ...d, date: e.target.value }))} placeholder="напр. березень 2023" style={{ width: '100%', background: '#222536', border: '1px solid #2e3148', color: '#e8eaf0', padding: '7px 10px', borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 4 }}>Провадження</div>
                  <select value={newDoc.procId} onChange={e => setNewDoc(d => ({ ...d, procId: e.target.value }))} style={{ width: '100%', background: '#222536', border: '1px solid #2e3148', color: '#e8eaf0', padding: '7px 10px', borderRadius: 6, fontSize: 12 }}>
                    {proceedings.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 4 }}>Тип</div>
                  <select value={newDoc.category} onChange={e => setNewDoc(d => ({ ...d, category: e.target.value }))} style={{ width: '100%', background: '#222536', border: '1px solid #2e3148', color: '#e8eaf0', padding: '7px 10px', borderRadius: 6, fontSize: 12 }}>
                    <option value="court_act">{"Судовий акт"}</option>
                    <option value="pleading">{"Заява по суті"}</option>
                    <option value="motion">{"Клопотання"}</option>
                    <option value="evidence">{"Докази"}</option>
                    <option value="correspondence">{"Листування"}</option>
                    <option value="other">{"Інше"}</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 4 }}>{"Від кого"}</div>
                  <select value={newDoc.author} onChange={e => setNewDoc(d => ({ ...d, author: e.target.value }))} style={{ width: '100%', background: '#222536', border: '1px solid #2e3148', color: '#e8eaf0', padding: '7px 10px', borderRadius: 6, fontSize: 12 }}>
                    <option value="court">Суд</option>
                    <option value="ours">Наш</option>
                    <option value="opponent">Опонент</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={newDoc.tags.includes('key')} onChange={e => setNewDoc(d => ({ ...d, tags: e.target.checked ? [...d.tags, 'key'] : d.tags.filter(t => t !== 'key') }))} />
                  <span style={{ fontSize: 12, color: '#9aa0b8' }}>{"Позначити як ключовий"}</span>
                </label>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#5a6080", marginBottom: 4 }}>{"Файл (необов\u02BCязково)"}</div>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx"
                  onChange={e => setNewDoc(d => ({ ...d, file: e.target.files[0] || null }))}
                  style={{ width: "100%", background: "#222536", border: "1px solid #2e3148", color: "#9aa0b8", padding: "6px 10px", borderRadius: 6, fontSize: 11, boxSizing: "border-box" }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button onClick={() => { setDocModalOpen(false); setNewDoc({ name: '', date: '', category: 'court_act', author: 'court', procId: '', tags: [], file: null }); }} style={{ background: 'none', border: '1px solid #2e3148', color: '#9aa0b8', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Скасувати</button>
              <button onClick={async () => {
                if (!newDoc.name.trim()) return;
                let driveId = null;
                if (newDoc.file && driveConnected) {
                  try {
                    const prepared = await prepareFile(newDoc.file);
                    driveId = await uploadFileToDrive(prepared, caseData);
                  } catch (err) {
                    console.error("Drive upload error:", err);
                  }
                }
                const ICONS = { court_act: "\ud83d\udccb", pleading: "\ud83d\udcc4", motion: "\ud83d\udcdd", evidence: "\ud83d\udcce", correspondence: "\u2709\ufe0f", other: "\ud83d\udcc1" };
                const doc = {
                  id: Date.now(),
                  procId: newDoc.procId || proceedings[0]?.id || "proc_main",
                  name: newDoc.name.trim(),
                  icon: ICONS[newDoc.category] || "\ud83d\udcc4",
                  date: newDoc.date.trim() || new Date().toLocaleDateString("uk-UA"),
                  category: newDoc.category,
                  author: newDoc.author,
                  tags: newDoc.tags,
                  driveId,
                  driveUrl: driveId ? `https://drive.google.com/file/d/${driveId}/view` : null,
                  notes: ""
                };
                const updated = [...(caseData.documents || []), doc];
                updateCase && updateCase(caseData.id, "documents", updated);
                setDocModalOpen(false);
                setNewDoc({ name: '', date: '', category: 'court_act', author: 'court', procId: '', tags: [], file: null });
              }} style={{ background: '#4f7cff', color: '#fff', border: 'none', padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>{"Додати документ"}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
