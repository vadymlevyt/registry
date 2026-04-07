import { useState } from "react";

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

export default function CaseDossier({ caseData, cases, updateCase, onClose, onSaveIdea }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [matMode, setMatMode] = useState("tree");
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [docFilters, setDocFilters] = useState({ proc: "all", category: "all", author: "all" });
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [ideaOpen, setIdeaOpen] = useState(false);
  const [ideaText, setIdeaText] = useState("");

  const proceedings = caseData.proceedings || [];
  const documents = caseData.documents || [];

  const notes = JSON.parse(localStorage.getItem("levytskyi_notes") || "[]")
    .filter(n => n.caseId === caseData.id || n.caseName === caseData.name)
    .sort((a, b) => new Date(b.ts) - new Date(a.ts));
  const pinnedNote = notes.find(n => n.pinned) || notes[0];

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

  function addNote() {
    const text = prompt("Нова нотатка:");
    if (!text) return;
    const all = JSON.parse(localStorage.getItem("levytskyi_notes") || "[]");
    all.push({ id: Date.now(), text, category: "case", caseId: caseData.id, caseName: caseData.name, source: "manual", ts: new Date().toISOString() });
    localStorage.setItem("levytskyi_notes", JSON.stringify(all));
  }

  const iconBtn = { background: "none", border: "1px solid #2e3148", color: "#9aa0b8", padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12 };
  const primaryBtn = { background: "#4f7cff", color: "#fff", border: "none", padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 };

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
            { label: "Дедлайн", field: "deadline", value: caseData.deadline },
            { label: "Нотатки до справи", field: "notes", value: Array.isArray(caseData.notes) ? caseData.notes.map(n => n.text).filter(Boolean).join('\n') : (typeof caseData.notes === 'string' ? caseData.notes : '') }
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
          </div>
        )}

        {/* Нотатки */}
        <div style={{ background: "#1a1d27", border: "1px solid #2e3148", borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "#5a6080", textTransform: "uppercase", letterSpacing: ".06em" }}>{"Нотатки по справі"}</div>
            <div style={{ display: "flex", gap: 6 }}>
              {notes.length > 1 && (
                <button onClick={() => setNotesExpanded(!notesExpanded)} style={iconBtn}>
                  {notesExpanded ? "\u2227 Згорнути" : `\u2228 ще ${notes.length - 1}`}
                </button>
              )}
              <button onClick={addNote} style={iconBtn}>+ Додати</button>
            </div>
          </div>
          {notes.length === 0 ? (
            <div style={{ fontSize: 12, color: "#3a3f58" }}>{"Нотаток поки немає"}</div>
          ) : (notesExpanded ? notes : [pinnedNote]).filter(Boolean).map(note => (
            <div key={note.id} style={{ padding: "8px 10px", background: "#222536", borderRadius: 7, marginBottom: 6, fontSize: 12, color: "#9aa0b8", lineHeight: 1.6 }}>
              {note.pinned && <span style={{ fontSize: 9, color: "#4f7cff", marginRight: 6 }}>{"📌"}</span>}
              {String(note.text || "")}
              <div style={{ fontSize: 10, color: "#3a3f58", marginTop: 4 }}>{note.ts ? new Date(note.ts).toLocaleDateString("uk-UA") : ""}</div>
            </div>
          ))}
        </div>

        {/* Завантаження файлів */}
        <div
          onClick={() => document.getElementById("dossierFileInput").click()}
          style={{ background: "#1a1d27", border: "2px dashed #2e3148", borderRadius: 10, padding: 20, textAlign: "center", cursor: "pointer", transition: "border-color .2s" }}
          onMouseEnter={e => e.currentTarget.style.borderColor = "#4f7cff"}
          onMouseLeave={e => e.currentTarget.style.borderColor = "#2e3148"}
        >
          <div style={{ fontSize: 28, marginBottom: 8, opacity: .4 }}>{"📎"}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#9aa0b8", marginBottom: 4 }}>{"Завантажити документи"}</div>
          <div style={{ fontSize: 11, color: "#5a6080" }}>{"PDF, JPEG, PNG, HEIC, Word — будь-яка кількість"}</div>
          <input id="dossierFileInput" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx" style={{ display: "none" }} />
        </div>

      </div>
    );
  }

  // ── МАТЕРІАЛИ ──────────────────────────────────────────────────────────────
  function renderMaterials() {
    return (
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

        {/* Ліва панель */}
        <div style={{ width: 300, flexShrink: 0, borderRight: "1px solid #2e3148", display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Перемикач Дерево / Реєстр */}
          <div style={{ display: "flex", borderBottom: "1px solid #2e3148", flexShrink: 0 }}>
            {[["tree", "🌳 Дерево"], ["registry", "📋 Реєстр"]].map(([id, label]) => (
              <button key={id} onClick={() => setMatMode(id)} style={{ flex: 1, padding: 8, border: "none", background: "none", color: matMode === id ? "#e8eaf0" : "#9aa0b8", cursor: "pointer", fontSize: 12, borderBottom: `2px solid ${matMode === id ? "#4f7cff" : "transparent"}`, fontWeight: matMode === id ? 500 : 400 }}>
                {label}
              </button>
            ))}
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
              <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
                <div style={{ background: "#1a1d27", border: "1px solid #2e3148", borderRadius: 10, padding: 24, maxWidth: 680, margin: "0 auto", lineHeight: 1.8 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, textAlign: "center", marginBottom: 4 }}>{selectedDoc.name}</h3>
                  <div style={{ fontSize: 11, color: "#5a6080", textAlign: "center", marginBottom: 16 }}>{selectedDoc.date}</div>
                  {selectedDoc.notes && <div style={{ background: "rgba(231,76,60,.08)", border: "1px solid rgba(231,76,60,.3)", padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 11, color: "#e74c3c" }}>{selectedDoc.notes}</div>}
                  <p style={{ fontSize: 13, color: "#9aa0b8" }}>{"Для перегляду повного тексту прикріпіть файл з Google Drive."}</p>
                </div>
              </div>
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
    <div style={{ position: "fixed", inset: 0, background: "#0f1117", display: "flex", flexDirection: "column", zIndex: 100, color: "#e8eaf0", fontFamily: "'Segoe UI',sans-serif", fontSize: 13 }}>

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
          <button onClick={() => setIdeaOpen(true)} title="Ідея для контенту" style={{ background: "none", border: "1px solid #2e3148", color: "#9aa0b8", padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 14 }}>{"💡"}</button>
          <button style={{ background: "#4f7cff", color: "#fff", border: "none", padding: "6px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 500 }}>{"🤖 Агент"}</button>
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

      {/* МОДАЛКА ІДЕЯ ДЛЯ КОНТЕНТУ */}
      {ideaOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
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

    </div>
  );
}
