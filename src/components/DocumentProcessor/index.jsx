import { useState, useRef, useCallback } from "react";

const DOC_SYSTEM_PROMPT = `Ти — агент обробки документів для адвокатського бюро Левицького.
Твоя задача: прийняти сирі файли, обробити їх і організувати в чітку структуру.

Правила:
1. ЗАВЖДИ зберігай оригінали в 01_ОРИГІНАЛИ — ніколи не видаляй і не змінюй
2. Визначай чи файли належать поточній справі, іншій існуючій або новій
3. Якщо файли не по цій справі — ОБОВ'ЯЗКОВО повідом і запропонуй перейти
4. Показуй структуру деревом в чаті перед виконанням
5. Пояснюй кожне рішення коротко
6. Якщо не впевнений — клади в 03_ФРАГМЕНТИ і повідом
7. Після підтвердження — виконуй точно те що погоджено

Формат структури в чаті — ASCII дерево з іконками папок і файлів.
Мова: українська.`;

const ACCEPTED_TYPES = [
  ".pdf", ".jpeg", ".jpg", ".png", ".heic",
  ".docx", ".xlsx", ".pptx", ".zip",
  ".md", ".txt", ".p7s", ".asic"
];

const FORMAT_ICONS = {
  pdf: "\ud83d\udcc4", jpg: "\ud83d\uddbc\ufe0f", jpeg: "\ud83d\uddbc\ufe0f", png: "\ud83d\uddbc\ufe0f",
  heic: "\ud83d\uddbc\ufe0f", docx: "\ud83d\udcdd", xlsx: "\ud83d\udcca", pptx: "\ud83d\udcca",
  zip: "\ud83d\udce6", md: "\ud83d\udcc3", txt: "\ud83d\udcc3", p7s: "\ud83d\udd10", asic: "\ud83d\udd10"
};

function getExt(name) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export default function DocumentProcessor({ caseData, cases, onCreateCase, onNavigateToDossier, apiKey }) {
  const [files, setFiles] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [proposedStructure, setProposedStructure] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);
  const chatHistoryRef = useRef([]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  // ── FILE HANDLING ──────────────────────────────────────────────────────────

  function addFiles(fileList) {
    const newFiles = Array.from(fileList).map(f => ({
      id: Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      file: f,
      name: f.name,
      size: f.size,
      ext: getExt(f.name),
      status: "pending",
      progress: 0,
    }));
    setFiles(prev => [...prev, ...newFiles]);

    const names = newFiles.map(f => f.name).join(", ");
    const agentMsg = {
      role: "assistant",
      content: `Отримав ${newFiles.length} файл(ів): ${names}\n\nАналізую...`,
    };
    setChatMessages(prev => [...prev, agentMsg]);
    scrollToBottom();

    analyzeFiles(newFiles);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function removeFile(fileId) {
    setFiles(prev => prev.filter(f => f.id !== fileId));
  }

  // ── AI ANALYSIS ────────────────────────────────────────────────────────────

  async function analyzeFiles(newFiles) {
    if (!apiKey) {
      setChatMessages(prev => [...prev, {
        role: "assistant",
        content: "API ключ не налаштований. Додайте ключ в налаштуваннях для роботи з агентом.",
      }]);
      scrollToBottom();
      return;
    }

    setProcessing(true);

    const caseContext = caseData
      ? `Поточна справа: ${caseData.name} (${caseData.case_no || "без номера"}), категорія: ${caseData.category}, суд: ${caseData.court || "не вказано"}`
      : "Контекст справи не визначений (нова справа або загальна обробка)";

    const casesList = (cases || []).slice(0, 30).map(c =>
      `- ${c.name} (${c.case_no || ""}), ${c.category}, ${c.status}`
    ).join("\n");

    const filesList = newFiles.map(f =>
      `- ${f.name} (${f.ext.toUpperCase()}, ${formatSize(f.size)})`
    ).join("\n");

    const userPrompt = `${caseContext}

Всі справи системи:
${casesList || "Немає справ"}

Завантажені файли:
${filesList}

Проаналізуй ці файли:
1. Визнач до якої справи вони належать (поточна / інша існуюча / нова)
2. Запропонуй структуру зберігання (ASCII дерево)
3. Поясни логіку класифікації кожного файлу`;

    try {
      const messages = [
        ...chatHistoryRef.current.slice(-10),
        { role: "user", content: userPrompt }
      ];
      // Ensure first message is from user
      const firstUserIdx = messages.findIndex(m => m.role === "user");
      const cleanMessages = firstUserIdx >= 0 ? messages.slice(firstUserIdx) : messages;

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          system: DOC_SYSTEM_PROMPT,
          messages: cleanMessages,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`API ${resp.status}: ${errText.slice(0, 200)}`);
      }

      const data = await resp.json();
      const text = data.content?.[0]?.text || "Не вдалося отримати відповідь";

      chatHistoryRef.current.push(
        { role: "user", content: userPrompt },
        { role: "assistant", content: text }
      );

      setChatMessages(prev => [...prev, { role: "assistant", content: text }]);
      setProposedStructure(text);
      scrollToBottom();

      // Update file statuses
      setFiles(prev => prev.map(f =>
        newFiles.some(nf => nf.id === f.id) ? { ...f, status: "done" } : f
      ));
    } catch (err) {
      setChatMessages(prev => [...prev, {
        role: "assistant",
        content: `Помилка аналізу: ${err.message}`,
      }]);
      scrollToBottom();
      setFiles(prev => prev.map(f =>
        newFiles.some(nf => nf.id === f.id) ? { ...f, status: "error" } : f
      ));
    } finally {
      setProcessing(false);
    }
  }

  // ── CHAT ───────────────────────────────────────────────────────────────────

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || processing) return;

    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", content: text }]);
    scrollToBottom();

    if (!apiKey) {
      setChatMessages(prev => [...prev, {
        role: "assistant",
        content: "API ключ не налаштований.",
      }]);
      scrollToBottom();
      return;
    }

    setProcessing(true);

    try {
      const messages = [
        ...chatHistoryRef.current.slice(-10),
        { role: "user", content: text }
      ];
      const firstUserIdx = messages.findIndex(m => m.role === "user");
      const cleanMessages = firstUserIdx >= 0 ? messages.slice(firstUserIdx) : messages;

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          system: DOC_SYSTEM_PROMPT,
          messages: cleanMessages,
        }),
      });

      if (!resp.ok) throw new Error(`API ${resp.status}`);

      const data = await resp.json();
      const reply = data.content?.[0]?.text || "Немає відповіді";

      chatHistoryRef.current.push(
        { role: "user", content: text },
        { role: "assistant", content: reply }
      );

      setChatMessages(prev => [...prev, { role: "assistant", content: reply }]);
      scrollToBottom();
    } catch (err) {
      setChatMessages(prev => [...prev, {
        role: "assistant",
        content: `Помилка: ${err.message}`,
      }]);
      scrollToBottom();
    } finally {
      setProcessing(false);
    }
  }

  // ── ACTIONS ────────────────────────────────────────────────────────────────

  function handleConfirm() {
    setChatMessages(prev => [...prev, {
      role: "assistant",
      content: "Структуру підтверджено. Готово до виконання.\n\n(Функція збереження на Google Drive буде доступна в наступній версії)",
    }]);
    setProposedStructure(null);
    scrollToBottom();
  }

  function handleCancel() {
    setFiles([]);
    setProposedStructure(null);
    setChatMessages(prev => [...prev, {
      role: "assistant",
      content: "Обробку скасовано. Файли видалено з черги.",
    }]);
    scrollToBottom();
  }

  // ── RENDER ─────────────────────────────────────────────────────────────────

  const statusColors = {
    pending: "#5a6080",
    processing: "#4f7cff",
    done: "#2ecc71",
    error: "#e74c3c",
  };
  const statusLabels = {
    pending: "Очікує",
    processing: "Обробляється",
    done: "Готово",
    error: "Помилка",
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>

      {/* Зона 1 — Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragOver(false)}
        style={{
          flexShrink: 0,
          border: `2px dashed ${isDragOver ? "#4f7cff" : "#2e3148"}`,
          borderRadius: 10,
          padding: "16px 20px",
          margin: "10px 12px 6px",
          textAlign: "center",
          background: isDragOver ? "rgba(79,124,255,.06)" : "transparent",
          transition: "all .2s",
          cursor: "pointer",
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES.join(",")}
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files.length > 0) addFiles(e.target.files); e.target.value = ""; }}
        />
        <div style={{ fontSize: 22, marginBottom: 4, opacity: 0.4 }}>{"\u2b07\ufe0f"}</div>
        <div style={{ fontSize: 12, color: "#9aa0b8", marginBottom: 4 }}>
          {"Перетягніть файли або натисніть"}
        </div>
        <div style={{ fontSize: 10, color: "#5a6080" }}>
          {"PDF, JPEG, PNG, HEIC, DOCX, XLSX, PPTX, ZIP, MD, TXT"}
        </div>
      </div>

      {/* Зона 2 — Черга файлів */}
      {files.length > 0 && (
        <div style={{ flexShrink: 0, maxHeight: 160, overflowY: "auto", margin: "0 12px 6px", border: "1px solid #2e3148", borderRadius: 8, background: "#1a1d27" }}>
          {files.map(f => (
            <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: "1px solid #222536" }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>{FORMAT_ICONS[f.ext] || "\ud83d\udcc4"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</div>
                <div style={{ fontSize: 10, color: "#5a6080" }}>{formatSize(f.size)}</div>
              </div>
              <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: `${statusColors[f.status]}22`, color: statusColors[f.status], fontWeight: 600 }}>
                {statusLabels[f.status]}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); removeFile(f.id); }}
                style={{ background: "none", border: "none", color: "#5a6080", cursor: "pointer", fontSize: 14, padding: "0 4px" }}
              >{"\u00d7"}</button>
            </div>
          ))}
        </div>
      )}

      {/* Зона 3 — Чат з агентом */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, margin: "0 12px 10px", border: "1px solid #2e3148", borderRadius: 8, background: "#1a1d27", overflow: "hidden" }}>

        {/* Чат повідомлення */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
          {chatMessages.length === 0 && (
            <div style={{ textAlign: "center", color: "#3a3f58", fontSize: 12, padding: "30px 0" }}>
              {"\ud83e\udd16 Завантажте файли для початку обробки"}
            </div>
          )}
          {chatMessages.map((msg, i) => (
            <div key={i} style={{ marginBottom: 10, display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
              <div style={{
                maxWidth: "85%",
                padding: "8px 12px",
                borderRadius: 10,
                fontSize: 12,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                background: msg.role === "user" ? "rgba(79,124,255,.15)" : "#222536",
                color: msg.role === "user" ? "#a8b8ff" : "#c8cce0",
                borderBottomRightRadius: msg.role === "user" ? 2 : 10,
                borderBottomLeftRadius: msg.role === "user" ? 10 : 2,
              }}>
                {msg.content}
              </div>
            </div>
          ))}
          {processing && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 0", color: "#5a6080", fontSize: 11 }}>
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>{"\u23f3"}</span>
              {"Агент аналізує..."}
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Кнопки дій */}
        {proposedStructure && (
          <div style={{ display: "flex", gap: 6, padding: "6px 10px", borderTop: "1px solid #2e3148", flexShrink: 0 }}>
            <button
              onClick={handleConfirm}
              style={{ flex: 1, padding: "7px 0", background: "#2ecc71", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
            >{"\u2713 Підтвердити структуру"}</button>
            <button
              onClick={() => {
                setChatMessages(prev => [...prev, { role: "user", content: "Запропонуй іншу структуру" }]);
                sendChat();
              }}
              style={{ flex: 1, padding: "7px 0", background: "#222536", color: "#9aa0b8", border: "1px solid #2e3148", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
            >{"\u270e Редагувати"}</button>
            <button
              onClick={handleCancel}
              style={{ padding: "7px 12px", background: "none", color: "#e74c3c", border: "1px solid rgba(231,76,60,.3)", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
            >{"\u2715 Скасувати"}</button>
          </div>
        )}

        {/* Поле вводу */}
        <div style={{ display: "flex", gap: 6, padding: "8px 10px", borderTop: "1px solid #2e3148", flexShrink: 0 }}>
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
            placeholder="Команда агенту..."
            style={{
              flex: 1,
              background: "#222536",
              border: "1px solid #2e3148",
              borderRadius: 6,
              padding: "7px 10px",
              color: "#e8eaf0",
              fontSize: 12,
              outline: "none",
            }}
          />
          <button
            onClick={sendChat}
            disabled={processing || !chatInput.trim()}
            style={{
              background: processing ? "#2e3148" : "#4f7cff",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "7px 14px",
              cursor: processing ? "default" : "pointer",
              fontSize: 12,
              fontWeight: 600,
              opacity: processing || !chatInput.trim() ? 0.5 : 1,
            }}
          >{"\u27a4"}</button>
        </div>
      </div>
    </div>
  );
}
