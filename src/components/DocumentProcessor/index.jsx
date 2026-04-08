import { useState, useRef, useCallback } from "react";
import { PDFDocument } from "pdf-lib";
import {
  createCaseStructure,
  uploadFileToDrive,
  getFolderForDocument,
  isDesktop,
  selectLocalFolder,
  saveFileLocally,
} from "../../services/driveService.js";

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

async function splitPDFByDocuments(file, documents) {
  const arrayBuffer = await file.arrayBuffer();
  const srcDoc = await PDFDocument.load(arrayBuffer);
  const totalPages = srcDoc.getPageCount();
  const results = [];

  for (const doc of documents) {
    const startIdx = doc.startPage - 1;
    const endIdx = Math.min(doc.endPage - 1, totalPages - 1);

    if (startIdx > totalPages - 1) continue;

    const newDoc = await PDFDocument.create();
    const pageIndices = [];
    for (let i = startIdx; i <= endIdx; i++) {
      pageIndices.push(i);
    }

    const pages = await newDoc.copyPages(srcDoc, pageIndices);
    pages.forEach(p => newDoc.addPage(p));

    const bytes = await newDoc.save({ useObjectStreams: true });

    results.push({
      name: doc.name,
      type: doc.type,
      pageCount: pageIndices.length,
      data: bytes,
      sizeMB: (bytes.byteLength / 1024 / 1024).toFixed(2),
    });
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

// ── PDF DOCUMENT BLOCK ANALYSIS ──────────────────────────────────────────────

async function analyzePDFWithDocumentBlock(file, apiKey, userHint) {
  const arrayBuffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  const base64 = btoa(binary);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64,
            }
          },
          {
            type: "text",
            text: `Це PDF файл судової справи. ${userHint ? `Контекст: ${userHint}` : ""}

Прочитай весь документ і визнач де починається кожен окремий документ.
Шукай: нові заголовки, печатки, підписи, нову нумерацію сторінок, зміну типу документа.

Поверни ТІЛЬКИ JSON без жодного тексту до або після:
{
  "totalPages": 65,
  "documents": [
    {
      "name": "Титульна сторінка судової справи",
      "startPage": 1,
      "endPage": 1,
      "type": "court_cover"
    },
    {
      "name": "Позовна заява Брановської Л.Б.",
      "startPage": 2,
      "endPage": 8,
      "type": "pleading"
    }
  ]
}

Типи документів (type):
- court_cover: титульна сторінка справи
- pleading: позовна заява, відзив, заперечення
- court_act: ухвала, рішення, постанова суду
- evidence: докази, додатки, довідки
- certificate: свідоцтво, витяг з реєстру
- contract: договір, угода
- other: інше

ВАЖЛИВО: визначай межі тільки на основі реального вмісту. Не вигадуй документи яких немає.`
          }
        ]
      }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.message);
  }

  const text = data.content[0].text;

  try {
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    throw new Error("Не вдалось розпізнати структуру документа: " + text.substring(0, 200));
  }
}

function getMimeType(ext) {
  const map = {
    pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    heic: "image/heic", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    zip: "application/zip", md: "text/markdown", txt: "text/plain",
    p7s: "application/pkcs7-signature", asic: "application/vnd.etsi.asic-e+zip",
  };
  return map[ext] || "application/octet-stream";
}

export default function DocumentProcessor({ caseData, cases, updateCase, onCreateCase, onNavigateToDossier, apiKey, driveFolderId, driveToken }) {
  const [files, setFiles] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [proposedStructure, setProposedStructure] = useState(null);
  const [parsedAction, setParsedAction] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [localDirHandle, setLocalDirHandle] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [totalPages, setTotalPages] = useState(0);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [splitPoints, setSplitPoints] = useState([]);
  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);
  const chatHistoryRef = useRef([]);
  const uploadedFileRef = useRef(null);
  const splitPointsRef = useRef([]);

  const token = driveToken || localStorage.getItem("levytskyi_drive_token");
  const hasDrive = !!token;
  const hasDesktop = isDesktop();

  const scrollToBottom = useCallback(() => {
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  function addAgentMessage(content) {
    setChatMessages(prev => [...prev, { role: "assistant", content }]);
    scrollToBottom();
  }

  // ── FILE HANDLING ──────────────────────────────────────────────────────────

  async function addFiles(fileList) {
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

    // Detect PDF and store file for document block analysis
    const pdfFile = newFiles.find(f => f.ext === "pdf");
    if (pdfFile) {
      try {
        const buffer = await pdfFile.file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(buffer);
        const numPages = pdfDoc.getPageCount();
        setUploadedFile(pdfFile.file);
        uploadedFileRef.current = pdfFile.file;
        setTotalPages(numPages);
        setUploadedFileName(pdfFile.name);

        const names = newFiles.map(f => f.name).join(", ");
        addAgentMessage(`Отримав ${newFiles.length} файл(ів): ${names}\n\n\u{1F4C4} ${pdfFile.name} (${numPages} сторінок, ${(pdfFile.file.size / 1024 / 1024).toFixed(1)} МБ)\n\nЩо зробити?\n\u2022 Написати "нарізати" \u2014 я визначу межі документів автоматично\n\u2022 Або опишіть що є в файлі і як нарізати`);

        setFiles(prev => prev.map(f =>
          newFiles.some(nf => nf.id === f.id) ? { ...f, status: "done" } : f
        ));
      } catch (err) {
        addAgentMessage(`Помилка читання PDF: ${err.message}`);
        analyzeFiles(newFiles);
      }
    } else {
      const names = newFiles.map(f => f.name).join(", ");
      addAgentMessage(`Отримав ${newFiles.length} файл(ів): ${names}\n\nАналізую...`);
      analyzeFiles(newFiles);
    }
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

      const action = parseActionJSON(text);
      if (action) {
        setParsedAction(action);
      }

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

  // ── VISION BOUNDARY ANALYSIS ────────────────────────────────────────────────

  async function handleAnalyzeBoundaries(userHint) {
    if (!uploadedFile) {
      addAgentMessage("\u274C Спочатку завантажте PDF файл");
      return;
    }

    setProcessing(true);
    addAgentMessage("\u{1F50D} Читаю весь PDF... (може зайняти 30-60 секунд)");

    try {
      const result = await analyzePDFWithDocumentBlock(uploadedFile, apiKey, userHint);

      setSplitPoints(result.documents);
      splitPointsRef.current = result.documents;
      setParsedAction({
        action: "split",
        split_points: result.documents,
      });
      setProposedStructure("document_block_analysis");
      setTotalPages(result.totalPages || totalPages);

      const tree = result.documents.map((d, i) =>
        `${i + 1}. \u{1F4C4} ${d.name}\n   Сторінки: ${d.startPage}-${d.endPage} (${d.endPage - d.startPage + 1} стор.)`
      ).join("\n\n");

      addAgentMessage(
        `Знайдено ${result.documents.length} документів у ${result.totalPages || totalPages} сторінках:\n\n${tree}\n\n` +
        "Підтвердити нарізку? Або скажіть що змінити:\n" +
        "\u2022 \"з'єднай 2 і 3\"\n" +
        "\u2022 \"сторінка 12 це продовження позовної\"\n" +
        "\u2022 \"підтвердити\""
      );
    } catch (e) {
      addAgentMessage(`\u274C Помилка: ${e.message}`);
    } finally {
      setProcessing(false);
    }
  }

  // ── CHAT ───────────────────────────────────────────────────────────────────

  async function sendChat(overrideText) {
    const text = (typeof overrideText === "string" ? overrideText : chatInput).trim();
    if (!text || processing) return;

    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", content: text }]);
    scrollToBottom();

    if (!apiKey) {
      addAgentMessage("API \u043A\u043B\u044E\u0447 \u043D\u0435 \u043D\u0430\u043B\u0430\u0448\u0442\u043E\u0432\u0430\u043D\u0438\u0439.");
      return;
    }

    // Intercept "нарізати" command — trigger Vision boundary analysis
    const lower = text.toLowerCase();
    if (lower.includes("\u043D\u0430\u0440\u0456\u0437\u0430\u0442\u0438") || lower.includes("\u0440\u043E\u0437\u0440\u0456\u0436") || lower.includes("\u0440\u043E\u0437\u0434\u0456\u043B\u0438")) {
      await handleAnalyzeBoundaries(text);
      return;
    }

    // Intercept "підтвердити" command — trigger split
    if ((lower.includes("\u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0438") || lower === "\u0442\u0430\u043A") && splitPoints.length > 0) {
      await handleConfirm();
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

      const docProcessorContext = uploadedFile
        ? `\n\n\u0417\u0430\u0432\u0430\u043D\u0442\u0430\u0436\u0435\u043D\u0438\u0439 \u0444\u0430\u0439\u043B: ${uploadedFileName} (${totalPages} \u0441\u0442\u043E\u0440\u0456\u043D\u043E\u043A)${
            splitPoints.length > 0
              ? `\n\u0412\u0438\u0437\u043D\u0430\u0447\u0435\u043D\u0430 \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0430:\n${splitPoints.map((p, i) => `${i + 1}. ${p.name} (\u0441\u0442\u043E\u0440. ${p.startPage}-${p.endPage})`).join("\n")}`
              : "\n\u0421\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0430 \u0449\u0435 \u043D\u0435 \u0432\u0438\u0437\u043D\u0430\u0447\u0435\u043D\u0430."
          }`
        : "\n\n\u0424\u0430\u0439\u043B\u0456\u0432 \u043D\u0435 \u0437\u0430\u0432\u0430\u043D\u0442\u0430\u0436\u0435\u043D\u043E.";

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
          system: DOC_SYSTEM_PROMPT + docProcessorContext,
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

  // ── STORAGE: DRIVE + LOCAL ─────────────────────────────────────────────────

  async function saveFilesToStorage(processedFiles) {
    const caseName = `${caseData.name}${caseData.case_no ? "_" + caseData.case_no : ""}`;
    const results = [];
    let driveStructure = null;

    // Create Drive folder structure if connected
    if (hasDrive) {
      try {
        driveStructure = await createCaseStructure(caseName, token);
      } catch (err) {
        addAgentMessage(`\u26a0\ufe0f Drive: ${err.message}. Зберігаю локально.`);
      }
    }

    // Ask for local folder on desktop (if not already selected)
    let dirHandle = localDirHandle;
    if (hasDesktop && !dirHandle && !hasDrive) {
      dirHandle = await selectLocalFolder();
      if (dirHandle) setLocalDirHandle(dirHandle);
    }

    for (const pf of processedFiles) {
      const folder = getFolderForDocument(pf.category);
      const fileBlob = new Blob([pf.data], { type: getMimeType(pf.ext || "pdf") });
      const result = { name: pf.name, folder, driveId: null, driveUrl: null, savedLocally: false };

      // Upload to Drive
      if (driveStructure) {
        try {
          const folderId = driveStructure.subFolders[folder] || driveStructure.subFolders["02_ОБРОБЛЕНІ"];
          const driveFile = await uploadFileToDrive(pf.name, fileBlob, folderId, token);
          result.driveId = driveFile.id;
          result.driveUrl = driveFile.webViewLink;
        } catch (err) {
          addAgentMessage(`\u26a0\ufe0f Drive помилка для ${pf.name}: ${err.message}`);
        }
      }

      // Save locally
      if (dirHandle) {
        try {
          await saveFileLocally(dirHandle, `${folder}/${pf.name}`, fileBlob);
          result.savedLocally = true;
        } catch (err) {
          addAgentMessage(`\u26a0\ufe0f Локально помилка для ${pf.name}: ${err.message}`);
        }
      }

      results.push(result);
    }

    return results;
  }

  // ── ACTIONS ────────────────────────────────────────────────────────────────

  async function handleConfirm() {
    console.log("handleConfirm called");
    console.log("uploadedFile:", (uploadedFileRef.current || uploadedFile)?.name);
    console.log("splitPoints:", (splitPointsRef.current.length > 0 ? splitPointsRef.current : splitPoints)?.length);
    console.log("parsedAction:", parsedAction?.action);

    if (!updateCase || !caseData) {
      addAgentMessage("Помилка: немає зв'язку зі справою для збереження.");
      return;
    }

    setProcessing(true);

    try {
      if (parsedAction?.action === "split" && parsedAction.split_points?.length > 0) {
        await handleSplit();
        return;
      }

      addAgentMessage("\u2699\ufe0f Зберігаю документи...");

      const classifiedDocs = parsedAction?.action === "classify" ? parsedAction.documents : null;
      const processedFiles = [];

      if (classifiedDocs && classifiedDocs.length > 0) {
        for (const item of classifiedDocs) {
          const matchedFile = files.find(f => f.name === item.originalName);
          let fileData = null;
          if (matchedFile?.file) {
            const ab = await matchedFile.file.arrayBuffer();
            // Compress PDF files
            if (matchedFile.ext === "pdf") {
              const compressed = await compressPDF(ab);
              fileData = compressed;
            } else {
              fileData = ab;
            }
          }

          processedFiles.push({
            name: item.processedName || item.originalName,
            originalName: item.originalName,
            category: item.category || "evidence",
            author: item.author || "ours",
            folder: item.folder || "01_ОРИГІНАЛИ",
            date: item.date || new Date().toISOString().slice(0, 10),
            pageCount: item.pageCount || null,
            originalSize: matchedFile?.size || 0,
            data: fileData,
            ext: matchedFile?.ext || "pdf",
          });
        }
      } else {
        for (const f of files) {
          const ab = await f.file.arrayBuffer();
          const data = f.ext === "pdf" ? await compressPDF(ab) : ab;
          processedFiles.push({
            name: f.name,
            originalName: f.name,
            category: "evidence",
            author: "ours",
            folder: "01_ОРИГІНАЛИ",
            date: new Date().toISOString().slice(0, 10),
            pageCount: null,
            originalSize: f.size,
            data,
            ext: f.ext,
          });
        }
      }

      // Save to Drive / local
      const storageResults = await saveFilesToStorage(processedFiles);

      // Build document entries for case
      const newDocuments = processedFiles.map((pf, i) => ({
        id: `doc_${Date.now()}_${i}`,
        name: pf.name,
        originalName: pf.originalName,
        category: pf.category,
        author: pf.author,
        folder: pf.folder,
        date: pf.date,
        pageCount: pf.pageCount,
        size: pf.data ? pf.data.byteLength : pf.originalSize,
        originalSize: pf.originalSize,
        icon: CATEGORY_ICONS[pf.category] || FORMAT_ICONS[pf.ext] || "\ud83d\udcc4",
        procId: caseData.proceedings?.[0]?.id || "proc_main",
        tags: [],
        status: "ready",
        driveId: storageResults[i]?.driveId || null,
        driveUrl: storageResults[i]?.driveUrl || null,
        savedLocally: storageResults[i]?.savedLocally || false,
        addedAt: new Date().toISOString(),
      }));

      const existingDocs = caseData.documents || [];
      updateCase(caseData.id, "documents", [...existingDocs, ...newDocuments]);

      // Build summary
      const summary = storageResults.map(r =>
        `\u2705 ${r.name}\n   \ud83d\udcc1 ${r.folder}${r.driveUrl ? "\n   \u2601\ufe0f Drive" : ""}${r.savedLocally ? "\n   \ud83d\udcbe Локально" : ""}`
      ).join("\n\n");

      // Compression info for PDFs
      const pdfFiles = processedFiles.filter(f => f.ext === "pdf" && f.data);
      let compressionLine = "";
      if (pdfFiles.length > 0) {
        const totalOrig = pdfFiles.reduce((s, f) => s + f.originalSize, 0);
        const totalComp = pdfFiles.reduce((s, f) => s + (f.data?.byteLength || f.originalSize), 0);
        if (totalOrig > totalComp) {
          compressionLine = `\n\nСтиснення: ${formatSize(totalOrig)} \u2192 ${formatSize(totalComp)} (-${Math.round((1 - totalComp / totalOrig) * 100)}%)`;
        }
      }

      addAgentMessage(`Готово! ${storageResults.length} документ(ів) збережено:\n\n${summary}${compressionLine}\n\nВкладка Матеріали оновлена.`);

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
    // Діагностика — показати що є
    const file = uploadedFileRef.current || uploadedFile;
    const points = splitPointsRef.current.length > 0 ? splitPointsRef.current : splitPoints;

    console.log("handleSplit called");
    console.log("uploadedFile:", file?.name);
    console.log("splitPoints:", points?.length);

    if (!file) {
      addAgentMessage("❌ Файл не завантажено. Перезавантажте файл і спробуйте знову.");
      setProcessing(false);
      return;
    }

    if (!points || points.length === 0) {
      addAgentMessage("❌ Структуру не визначено. Напишіть \"нарізати\" в полі команди.");
      setProcessing(false);
      return;
    }

    addAgentMessage(`✂️ Нарізаю ${points.length} документів...`);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const srcDoc = await PDFDocument.load(arrayBuffer);
      const pageCount = srcDoc.getPageCount();

      addAgentMessage(`📄 Всього сторінок: ${pageCount}`);

      const results = [];

      for (const doc of points) {
        const startIdx = Math.max(0, doc.startPage - 1);
        const endIdx = Math.min(doc.endPage - 1, pageCount - 1);

        if (startIdx > pageCount - 1) {
          addAgentMessage(`⚠️ Пропускаю "${doc.name}" — сторінка ${doc.startPage} не існує`);
          continue;
        }

        const newDoc = await PDFDocument.create();
        const indices = [];
        for (let i = startIdx; i <= endIdx; i++) indices.push(i);

        const pages = await newDoc.copyPages(srcDoc, indices);
        pages.forEach(p => newDoc.addPage(p));

        const bytes = await newDoc.save({ useObjectStreams: true });
        results.push({
          name: doc.name,
          type: doc.type || "other",
          startPage: doc.startPage,
          endPage: doc.endPage,
          pageCount: indices.length,
          data: bytes,
          sizeMB: (bytes.byteLength / 1024 / 1024).toFixed(2),
        });
      }

      addAgentMessage(`✅ Нарізано ${results.length} документів`);

      // Записати на Drive
      const drToken = driveToken || localStorage.getItem("levytskyi_drive_token");
      const folderId = driveFolderId || caseData?.storage?.driveFolderId;

      if (drToken && folderId) {
        addAgentMessage("☁️ Записую на Drive...");

        // Знайти 02_ОБРОБЛЕНІ
        const subRes = await fetch(
          `https://www.googleapis.com/drive/v3/files?` +
          `q=${encodeURIComponent(`'${folderId}' in parents and name='02_ОБРОБЛЕНІ' and mimeType='application/vnd.google-apps.folder' and trashed=false`)}` +
          `&fields=files(id)`,
          { headers: { Authorization: `Bearer ${drToken}` } }
        );
        const subData = await subRes.json();
        const targetFolderId = subData.files?.[0]?.id || folderId;

        for (const result of results) {
          const safeName = result.name.replace(/[/\\:*?"<>|]/g, "_");
          const blob = new Blob([result.data], { type: "application/pdf" });
          const form = new FormData();
          form.append("metadata", new Blob([JSON.stringify({
            name: `${safeName}.pdf`,
            parents: [targetFolderId],
          })], { type: "application/json" }));
          form.append("file", blob);

          await fetch(
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name",
            { method: "POST", headers: { Authorization: `Bearer ${drToken}` }, body: form }
          );
        }

        // Оновити Матеріали
        const newDocs = results.map((r, i) => ({
          id: `doc_${Date.now()}_${i}`,
          name: r.name,
          type: r.type,
          pageCount: r.pageCount,
          folder: "02_ОБРОБЛЕНІ",
          status: "ready",
          addedAt: new Date().toISOString(),
        }));

        updateCase(caseData.id, "documents", [
          ...(caseData.documents || []),
          ...newDocs,
        ]);

        const summary = results.map(r =>
          `✅ ${r.name} (${r.pageCount} стор., ${r.sizeMB} МБ)`
        ).join("\n");

        addAgentMessage(`Готово!\n\n${summary}\n\n📁 Збережено в 02_ОБРОБЛЕНІ\n📋 Матеріали оновлено`);

      } else {
        const summary = results.map(r => `✅ ${r.name} (${r.pageCount} стор.)`).join("\n");
        addAgentMessage(`Нарізано:\n\n${summary}\n\n⚠️ Drive не підключено. Підключіть в блоці Сховище.`);
      }

      setProposedStructure(null);
      setParsedAction(null);
      setSplitPoints([]);
      splitPointsRef.current = [];
      setUploadedFile(null);
      uploadedFileRef.current = null;
      setTotalPages(0);
      setUploadedFileName("");
      setFiles([]);

    } catch (e) {
      addAgentMessage(`❌ Помилка нарізки: ${e.message}\n\nStack: ${e.stack?.substring(0, 200)}`);
    } finally {
      setProcessing(false);
    }
  }

  function handleCancel() {
    setFiles([]);
    setProposedStructure(null);
    setParsedAction(null);
    setSplitPoints([]);
    splitPointsRef.current = [];
    setUploadedFile(null);
    uploadedFileRef.current = null;
    setTotalPages(0);
    setUploadedFileName("");
    addAgentMessage("\u041E\u0431\u0440\u043E\u0431\u043A\u0443 \u0441\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E. \u0424\u0430\u0439\u043B\u0438 \u0432\u0438\u0434\u0430\u043B\u0435\u043D\u043E \u0437 \u0447\u0435\u0440\u0433\u0438.");
  }

  async function handleSelectLocalFolder() {
    const handle = await selectLocalFolder();
    if (handle) {
      setLocalDirHandle(handle);
      addAgentMessage(`\ud83d\udcbe Обрано локальну папку: ${handle.name}`);
    }
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

      {/* Зона 0 — Індикатор платформи */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", fontSize: 11, color: "#5a6080", flexShrink: 0 }}>
        <span>{"Збереження:"}</span>
        {hasDrive && <span style={{ color: "#2ecc71" }}>{"\u2601\ufe0f Google Drive"}</span>}
        {hasDesktop && (
          <button
            onClick={handleSelectLocalFolder}
            style={{ background: "none", border: "1px solid #2e3148", color: localDirHandle ? "#2ecc71" : "#9aa0b8", padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}
          >
            {localDirHandle ? `\ud83d\udcbe ${localDirHandle.name}` : "\ud83d\udcbe Обрати папку"}
          </button>
        )}
        {!hasDrive && !hasDesktop && <span style={{ color: "#f39c12" }}>{"\u26a0\ufe0f Підключіть Google Drive в налаштуваннях"}</span>}
      </div>

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
          margin: "4px 12px 6px",
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
              {"Агент працює..."}
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
              onClick={() => sendChat("Запропонуй іншу структуру")}
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
            onClick={() => sendChat()}
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
