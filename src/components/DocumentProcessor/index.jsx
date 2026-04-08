import { useState, useRef, useCallback } from "react";
import { PDFDocument } from "pdf-lib";

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
Мова: українська.

Коли отримуєш PDF більше 5 сторінок:
1. Визнач чи це один документ чи кілька склеєних
2. Якщо кілька — знайди межі за заголовками і змістом
3. Поверни JSON в кінці відповіді: ACTION_JSON:{"action":"split","split_points":[{"start":0,"end":1,"name":"Назва_документа","type":"pleading"},{"start":2,"end":8,"name":"Додаток_1","type":"evidence"}]}
4. Покажи нарізку деревом в чаті
5. Запитай підтвердження ПЕРЕД нарізкою

Для кожного файлу визнач категорію:
- pleading (процесуальні: позов, відзив, заперечення)
- evidence (докази: договори, акти, листи)
- court_act (судові акти: рішення, ухвали, постанови)
- motion (клопотання)
- correspondence (листування)

І автора:
- ours (наші документи)
- opponent (від протилежної сторони)
- court (від суду)

Поверни в кінці відповіді JSON:
ACTION_JSON:{"action":"classify","documents":[{"originalName":"file.pdf","processedName":"Позовна_заява_2024-01","category":"pleading","author":"ours","folder":"01_ПРОЦЕСУАЛЬНІ","date":"2024-01-15","pageCount":null}]}`;

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

const CATEGORY_ICONS = {
  pleading: "\ud83d\udcc4",
  evidence: "\ud83d\udccb",
  court_act: "\u2696\ufe0f",
  motion: "\ud83d\udcdd",
  correspondence: "\ud83d\udce8",
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

function parseActionJSON(text) {
  const idx = text.indexOf("ACTION_JSON:");
  if (idx === -1) return null;
  const start = text.indexOf("{", idx);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function splitPDF(fileArrayBuffer, splitPoints) {
  const srcDoc = await PDFDocument.load(fileArrayBuffer);
  const results = [];
  for (const part of splitPoints) {
    const newDoc = await PDFDocument.create();
    const pageIndices = Array.from(
      { length: part.end - part.start + 1 },
      (_, i) => part.start + i
    );
    const pages = await newDoc.copyPages(srcDoc, pageIndices);
    pages.forEach(p => newDoc.addPage(p));
    const bytes = await newDoc.save({ useObjectStreams: true });
    results.push({ name: part.name, type: part.type, data: bytes, pageCount: pages.length });
  }
  return results;
}

async function compressPDF(arrayBuffer) {
  try {
    const doc = await PDFDocument.load(arrayBuffer, { updateMetadata: false });
    const compressed = await doc.save({ useObjectStreams: true });
    return compressed;
  } catch {
    return arrayBuffer;
  }
}

export default function DocumentProcessor({ caseData, cases, updateCase, onCreateCase, onNavigateToDossier, apiKey }) {
  const [files, setFiles] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [proposedStructure, setProposedStructure] = useState(null);
  const [parsedAction, setParsedAction] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);
  const chatHistoryRef = useRef([]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  function addAgentMessage(content) {
    setChatMessages(prev => [...prev, { role: "assistant", content }]);
    scrollToBottom();
  }

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
    addAgentMessage(`Отримав ${newFiles.length} файл(ів): ${names}\n\nАналізую...`);

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
      addAgentMessage("API ключ не налаштований. Додайте ключ в налаштуваннях для роботи з агентом.");
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
3. Класифікуй кожен файл (category, author, folder, date)
4. Поверни ACTION_JSON з класифікацією`;

    try {
      const messages = [
        ...chatHistoryRef.current.slice(-10),
        { role: "user", content: userPrompt }
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

      // Parse ACTION_JSON from response
      const action = parseActionJSON(text);
      if (action) {
        setParsedAction(action);
      }

      // Show response without ACTION_JSON part
      const displayText = text.replace(/ACTION_JSON:\{[\s\S]*$/, "").trim();
      setChatMessages(prev => [...prev, { role: "assistant", content: displayText }]);
      setProposedStructure(text);
      scrollToBottom();

      setFiles(prev => prev.map(f =>
        newFiles.some(nf => nf.id === f.id) ? { ...f, status: "done" } : f
      ));
    } catch (err) {
      addAgentMessage(`Помилка аналізу: ${err.message}`);
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
      addAgentMessage("API ключ не налаштований.");
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

      const action = parseActionJSON(reply);
      if (action) {
        setParsedAction(action);
        setProposedStructure(reply);
      }

      const displayReply = reply.replace(/ACTION_JSON:\{[\s\S]*$/, "").trim();
      setChatMessages(prev => [...prev, { role: "assistant", content: displayReply }]);
      scrollToBottom();
    } catch (err) {
      addAgentMessage(`Помилка: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  }

  // ── ACTIONS ────────────────────────────────────────────────────────────────

  async function handleConfirm() {
    if (!updateCase || !caseData) {
      addAgentMessage("Помилка: немає зв'язку зі справою для збереження.");
      return;
    }

    setProcessing(true);

    try {
      // If agent returned split points, handle PDF splitting
      if (parsedAction?.action === "split" && parsedAction.split_points?.length > 0) {
        await handleSplit();
        return;
      }

      // Save documents from classification or from files directly
      const classifiedDocs = parsedAction?.action === "classify" ? parsedAction.documents : null;
      const newDocuments = [];

      if (classifiedDocs && classifiedDocs.length > 0) {
        for (const item of classifiedDocs) {
          const matchedFile = files.find(f => f.name === item.originalName);
          newDocuments.push({
            id: Date.now() + "_" + Math.random().toString(36).slice(2, 8),
            name: item.processedName || item.originalName,
            originalName: item.originalName,
            category: item.category || "evidence",
            author: item.author || "ours",
            folder: item.folder || "01_ОРИГІНАЛИ",
            date: item.date || new Date().toISOString().slice(0, 10),
            pageCount: item.pageCount || null,
            size: matchedFile?.size || 0,
            icon: CATEGORY_ICONS[item.category] || "\ud83d\udcc4",
            procId: caseData.proceedings?.[0]?.id || "proc_main",
            tags: [],
            status: "ready",
            addedAt: new Date().toISOString(),
          });
        }
      } else {
        // Fallback: create documents from uploaded files
        for (const f of files) {
          newDocuments.push({
            id: Date.now() + "_" + Math.random().toString(36).slice(2, 8),
            name: f.name,
            originalName: f.name,
            category: "evidence",
            author: "ours",
            folder: "01_ОРИГІНАЛИ",
            date: new Date().toISOString().slice(0, 10),
            pageCount: null,
            size: f.size,
            icon: FORMAT_ICONS[f.ext] || "\ud83d\udcc4",
            procId: caseData.proceedings?.[0]?.id || "proc_main",
            tags: [],
            status: "ready",
            addedAt: new Date().toISOString(),
          });
        }
      }

      const existingDocs = caseData.documents || [];
      updateCase(caseData.id, "documents", [...existingDocs, ...newDocuments]);

      addAgentMessage(`\u2705 Збережено ${newDocuments.length} документ(ів) у справу "${caseData.name}".\nВкладка Матеріали оновлена.`);

      setProposedStructure(null);
      setParsedAction(null);
      setFiles([]);
    } catch (err) {
      addAgentMessage(`Помилка збереження: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  }

  async function handleSplit() {
    try {
      const splitPoints = parsedAction.split_points;
      const pdfFile = files.find(f => f.ext === "pdf");

      if (!pdfFile?.file) {
        addAgentMessage("Не знайдено PDF файл для нарізки.");
        setProcessing(false);
        return;
      }

      addAgentMessage("\u2702\ufe0f Нарізаю PDF...");

      const arrayBuffer = await pdfFile.file.arrayBuffer();
      const originalSize = arrayBuffer.byteLength;
      const parts = await splitPDF(arrayBuffer, splitPoints);

      const newDocuments = [];
      let totalCompressedSize = 0;

      for (const part of parts) {
        const compressed = await compressPDF(part.data);
        totalCompressedSize += compressed.byteLength;

        newDocuments.push({
          id: Date.now() + "_" + Math.random().toString(36).slice(2, 8),
          name: part.name,
          originalName: pdfFile.name,
          category: part.type || "evidence",
          author: "ours",
          folder: "01_ПРОЦЕСУАЛЬНІ",
          date: new Date().toISOString().slice(0, 10),
          pageCount: part.pageCount,
          size: compressed.byteLength,
          icon: CATEGORY_ICONS[part.type] || "\ud83d\udcc4",
          procId: caseData.proceedings?.[0]?.id || "proc_main",
          tags: [],
          status: "ready",
          addedAt: new Date().toISOString(),
        });
      }

      const existingDocs = caseData.documents || [];
      updateCase(caseData.id, "documents", [...existingDocs, ...newDocuments]);

      const compressionInfo = `${formatSize(originalSize)} \u2192 ${formatSize(totalCompressedSize)} (-${Math.round((1 - totalCompressedSize / originalSize) * 100)}%)`;

      addAgentMessage(
        `\u2705 PDF нарізано на ${parts.length} документ(ів):\n` +
        parts.map(p => `  \u2022 ${p.name} (${p.pageCount} стор.)`).join("\n") +
        `\n\nСтиснення: ${compressionInfo}\nВкладка Матеріали оновлена.`
      );

      setProposedStructure(null);
      setParsedAction(null);
      setFiles([]);
    } catch (err) {
      addAgentMessage(`Помилка нарізки PDF: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  }

  function handleCancel() {
    setFiles([]);
    setProposedStructure(null);
    setParsedAction(null);
    addAgentMessage("Обробку скасовано. Файли видалено з черги.");
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
              disabled={processing}
              style={{ flex: 1, padding: "7px 0", background: processing ? "#2e3148" : "#2ecc71", color: "#fff", border: "none", borderRadius: 6, cursor: processing ? "default" : "pointer", fontSize: 12, fontWeight: 600, opacity: processing ? 0.5 : 1 }}
            >{parsedAction?.action === "split" ? "\u2702\ufe0f Підтвердити нарізку" : "\u2713 Підтвердити структуру"}</button>
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
