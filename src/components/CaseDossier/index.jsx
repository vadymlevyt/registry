import { useState, useEffect, useRef } from "react";
import * as pdfjsLib from 'pdfjs-dist';
import DocumentProcessor from "../DocumentProcessor/index.jsx";
import { createCaseStructure, listFolderFiles, findOrCreateFolder, uploadFileToDrive, getDriveFiles, readDriveFile, createDriveFile, updateDriveFile } from "../../services/driveService.js";
import { systemAlert, systemConfirm } from "../SystemModal";

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

export default function CaseDossier({ caseData, cases, updateCase, onClose, onSaveIdea, onCloseCase, onDeleteCase, notes: notesProp, onAddNote, onUpdateNote, onDeleteNote, onPinNote, driveConnected }) {
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
  const [creatingStructure, setCreatingStructure] = useState(false);
  const [storageState, setStorageState] = useState(caseData.storage || {});
  const [storageMsg, setStorageMsg] = useState('');
  const [contextLoading, setContextLoading] = useState(false);
  const [contextMsg, setContextMsg] = useState('');
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingNoteText, setEditingNoteText] = useState('');

  const [caseContext, setCaseContext] = useState(null);

  // Agent state — має бути ВИЩЕ useEffect щоб setAgentMessages був доступний при маунті
  const [agentMessages, setAgentMessages] = useState(() => caseData.agentHistory || []);

  useEffect(() => {
    setStorageState(caseData.storage || {});
  }, [caseData.storage]);

  // ── Завантаження контексту та історії при відкритті досьє ────────────────
  useEffect(() => {
    console.log('[CaseDossier] Mount effect fired, caseId:', caseData.id, 'folderId:', caseData.storage?.driveFolderId);
    let cancelled = false;
    (async () => {
      const ctx = await loadCaseContext();
      if (!cancelled && ctx) setCaseContext(ctx);

      let messages = await loadAgentHistory();
      if (!Array.isArray(messages) || messages.length === 0) {
        try {
          const local = localStorage.getItem(`agent_history_${caseData?.id}`);
          if (local) {
            const parsed = JSON.parse(local);
            if (Array.isArray(parsed) && parsed.length > 0) {
              messages = parsed;
              console.log('[AgentHistory] loaded from localStorage:', parsed.length);
            }
          }
        } catch (e) { console.log('[AgentHistory] localStorage error:', e); }
      }
      if (!cancelled && Array.isArray(messages) && messages.length > 0) {
        setAgentMessages(messages);
      }
    })();
    return () => { cancelled = true; };
  }, [caseData.id, caseData.storage?.driveFolderId]);

  const showMsg = (text) => {
    setStorageMsg(text);
    setTimeout(() => setStorageMsg(''), 3000);
  };

  // ── Завантаження case_context.md ──────────────────────────────────────────
  const loadCaseContext = async () => {
    console.log('[CaseContext] loading for case:', caseData?.id);
    console.log('[CaseContext] folderId:', caseData?.storage?.driveFolderId);
    if (!caseData?.storage?.driveFolderId) return null;
    const token = localStorage.getItem("levytskyi_drive_token");
    if (!token) { console.log('[CaseContext] no drive token'); return null; }
    try {
      const folderId = caseData.storage.driveFolderId;
      const files = await getDriveFiles(folderId, token);
      console.log('[CaseContext] found files:', files?.length);
      const contextFile = files.find(f => f.name === 'case_context.md');
      if (!contextFile) { console.log('[CaseContext] case_context.md not found'); return null; }
      const content = await readDriveFile(contextFile.id, token);
      console.log('[CaseContext] loaded length:', content?.length);
      return content;
    } catch (e) {
      console.log('[CaseContext] load error:', e);
      return null;
    }
  };

  // ── Завантаження agent_history.json з Drive ──────────────────────────────
  const loadAgentHistory = async () => {
    console.log('[AgentHistory] loading for case:', caseData?.id);
    console.log('[AgentHistory] folderId:', caseData?.storage?.driveFolderId);
    if (!caseData?.storage?.driveFolderId) return caseData.agentHistory || [];
    const token = localStorage.getItem("levytskyi_drive_token");
    if (!token) { console.log('[AgentHistory] no drive token'); return caseData.agentHistory || []; }
    try {
      const folderId = caseData.storage.driveFolderId;
      const files = await getDriveFiles(folderId, token);
      console.log('[AgentHistory] found files:', files?.length);
      const histFile = files.find(f => f.name === 'agent_history.json');
      if (!histFile) { console.log('[AgentHistory] agent_history.json not found'); return caseData.agentHistory || []; }
      const content = await readDriveFile(histFile.id, token);
      const parsed = JSON.parse(content);
      const messages = Array.isArray(parsed) ? parsed : (caseData.agentHistory || []);
      console.log('[AgentHistory] loaded messages:', messages?.length);
      return messages;
    } catch (e) {
      console.log('[AgentHistory] load error:', e);
      return caseData.agentHistory || [];
    }
  };

  // ── Збереження agent_history.json на Drive ───────────────────────────────
  const saveAgentHistory = async (history) => {
    try {
      localStorage.setItem(`agent_history_${caseData?.id}`, JSON.stringify((history || []).slice(-20)));
    } catch (e) { console.log('[AgentHistory] localStorage save error:', e); }
    if (!caseData?.storage?.driveFolderId) return;
    const token = localStorage.getItem("levytskyi_drive_token");
    if (!token) return;
    try {
      const folderId = caseData.storage.driveFolderId;
      const content = JSON.stringify(history.slice(-50), null, 2);
      const files = await getDriveFiles(folderId, token);
      const existing = files.find(f => f.name === 'agent_history.json');
      if (existing) {
        await updateDriveFile(existing.id, content, token);
      } else {
        await createDriveFile(folderId, 'agent_history.json', content, token);
      }
    } catch (e) {
      console.log('Помилка збереження agent_history.json:', e);
    }
  };

  // ── Побудова system prompt для агента ───────────────────────────────────
  const buildAgentSystemPrompt = () => {
    const hasHistory = agentMessages && agentMessages.length > 0;
    let prompt = hasHistory
      ? `ВАЖЛИВО: У тебе є збережена історія попередніх розмов по цій справі яка передана в контексті. Ти маєш доступ до цих розмов і пам'ятаєш що обговорювалось. Використовуй цю інформацію природно. НІКОЛИ не кажи що не пам'ятаєш попередніх розмов — це буде неправдою.\n\n`
      : `Це перша розмова по цій справі.\n\n`;
    prompt += `Ти агент справи "${caseData.name}".
Знаєш про справу:
- Суд: ${caseData.court || "не вказано"}
- Номер: ${caseData.case_no || "не вказано"}
- Категорія: ${caseData.category || "не вказано"}
- Статус: ${caseData.status || "не вказано"}
- Провадження: ${JSON.stringify(caseData.proceedings || [])}
- Документів: ${(caseData.documents || []).length}`;

    if (caseContext) {
      prompt += `\n\n## КОНТЕКСТ СПРАВИ\n${caseContext}`;
    } else {
      prompt += `\n\nКонтекстний файл справи відсутній.`;
    }

    prompt += `\n\nВідповідай українською. Допомагай з аналізом і тактикою по справі.`;

    return prompt;
  };

  // ── Створити case_context.md ──────────────────────────────────────────────
  // Хелпер для безпечної сериалізації без циклічних посилань
  const safeStringify = (obj) => {
    try {
      const cache = new Set();
      return JSON.stringify(obj, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (cache.has(value)) return '[Circular]';
          cache.add(value);
        }
        return value;
      });
    } catch (e) {
      return `[Error: ${e.message}]`;
    }
  };

  async function handleCreateContext() {
    if (typeof handleCreateContext.running !== 'undefined' && handleCreateContext.running) {
      setContextMsg("⏳ Операція вже виконується. Будь ласка, зачекайте.");
      return;
    }
    handleCreateContext.running = true;
    
    const token = localStorage.getItem("levytskyi_drive_token");
    const folderId = storageState?.driveFolderId;

    setContextMsg("Перевіряю Drive...");

    if (!token) { setContextMsg("❌ Немає токена Drive"); handleCreateContext.running = false; return; }
    if (!folderId) { setContextMsg("❌ Немає folderId в storage"); handleCreateContext.running = false; return; }

    setContextLoading(true);
    try {
      // Перевірити чи контекст вже існує
      setContextMsg("Перевіряю існуючий контекст...");
      const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
          `'${folderId}' in parents and name='case_context.md' and trashed=false`
        )}&fields=files(id,name,modifiedTime)`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (searchRes.status === 401) {
        setContextMsg("❌ Токен Drive протух. Натисніть \"Підключити Drive\" і спробуйте знову.");
        setContextLoading(false);
        handleCreateContext.running = false;
        return;
      }
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        const existing = searchData.files[0];
        const modDate = new Date(existing.modifiedTime).toLocaleDateString('uk-UA');
        const replace = await systemConfirm(
          `Контекст справи вже існує (оновлено ${modDate}).\n\nЗамінити на новий?`,
          "Контекст справи"
        );
        if (!replace) {
          setContextMsg("Скасовано");
          setContextLoading(false);
          handleCreateContext.running = false;
          return;
        }
      }

      setContextMsg("Перевіряю папку...");
      // Перевірити чи папка існує
      const checkRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,trashed`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (checkRes.status === 401) {
        setContextMsg("❌ Токен Drive протух. Натисніть \"Підключити Drive\" і спробуйте знову.");
        setContextLoading(false);
        return;
      }
      const checkData = await checkRes.json();
      setContextMsg(`Папка: ${safeStringify(checkData)}`);

      if (checkData.error) {
        setContextMsg(`❌ Помилка доступу: ${checkData.error.message}`);
        setContextLoading(false);
        return;
      }
      if (checkData.trashed) {
        setContextMsg("❌ Папка в кошику");
        setContextLoading(false);
        return;
      }

      // Отримати підпапки
      const subRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?` +
        `q=${encodeURIComponent(
          `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
        )}&fields=files(id,name)&pageSize=20`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const subData = await subRes.json();
      const folders = subData.files || [];
      setContextMsg(`Підпапки (${folders.length}): ${folders.map(f => f.name).join(", ") || "жодної"}`);

      // Перевірити scope токена
      const aboutRes = await fetch(
        "https://www.googleapis.com/drive/v3/about?fields=user",
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const aboutData = await aboutRes.json();
      setContextMsg(`Drive user: ${aboutData.user?.emailAddress || "невідомо"}`);

      // Нормалізація NFC для надійного порівняння кирилічних назв
      const processed = folders.find(f => f.name.normalize('NFC') === "02_ОБРОБЛЕНІ".normalize('NFC'))
        || folders.find(f => f.name.startsWith('02_'));
      const originals = folders.find(f => f.name.normalize('NFC') === "01_ОРИГІНАЛИ".normalize('NFC'))
        || folders.find(f => f.name.startsWith('01_'));

      if (!processed && !originals) {
        setContextMsg(`❌ Не знайдено 02_ОБРОБЛЕНІ і 01_ОРИГІНАЛИ серед: ${folders.map(f => f.name).join(", ") || "жодної"}`);
        setContextLoading(false);
        return;
      }

      // Отримати файли БЕЗ фільтра mimeType (крім папок)
      const getFiles = async (fid, name) => {
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files?` +
          `q=${encodeURIComponent(
            `'${fid}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'`
          )}&fields=files(id,name,size,mimeType)&pageSize=100`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        const allFiles = data.files || [];
        // Брати ВСІ файли крім: agent_history.json, case_context.md, папок
        const EXCLUDED_NAMES = new Set(['agent_history.json', 'case_context.md']);
        const files = allFiles.filter(f =>
          f.mimeType !== 'application/vnd.google-apps.folder' &&
          !EXCLUDED_NAMES.has(f.name)
        );
        console.log(`[CaseDossier] ${name}: знайдено ${allFiles.length}, до аналізу: ${files.length}`, allFiles.map(f => `${f.name} (${f.mimeType}, ${f.size}b)`));
        setContextMsg(`📄 В папці ${name}: ${files.length} документів з ${allFiles.length} файлів`);
        return files;
      };

      let sourceFiles = [];
      let sourceName = "";

      if (processed) {
        sourceFiles = await getFiles(processed.id, "02_ОБРОБЛЕНІ");
        sourceName = "02_ОБРОБЛЕНІ";
      }

      if (sourceFiles.length === 0 && originals) {
        sourceFiles = await getFiles(originals.id, "01_ОРИГІНАЛИ");
        sourceName = "01_ОРИГІНАЛИ";
      }

      if (sourceFiles.length === 0) {
        setContextMsg("❌ Файлів не знайдено. Нарізайте документи у вкладці \"Робота з документами\"");
        setContextLoading(false);
        return;
      }

      setContextMsg(`✅ Знайдено ${sourceFiles.length} файлів в ${sourceName}. Читаю вміст...`);

      // Читаємо КОЖЕН файл: три типи PDF + Google Docs + текстові формати
      // Тип 1 — текстовий PDF → text block
      // Тип 2 — PDF скан → PNG сторінки через canvas → image blocks (max 5)
      // Тип 3 — ZIP замаскований під PDF (ЄСІТС) → поки не підтримується, але помилка фіксується
      async function readFileContent(file, accessToken) {
        // Google Doc → export text/plain
        if (file.mimeType === 'application/vnd.google-apps.document') {
          const exportResp = await fetch(
            `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (!exportResp.ok) throw new Error(`export ${exportResp.status}`);
          return { type: 'text', content: (await exportResp.text()).trim() || '[Порожній документ]', name: file.name };
        }

        // Завантажити байти один раз
        const dlResp = await fetch(
          `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!dlResp.ok) throw new Error(`download ${dlResp.status}`);
        const arrayBuffer = await dlResp.arrayBuffer();

        const isPdf = file.mimeType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        if (isPdf) {
          // Тип 3 — перевірка ZIP (ЄСІТС): сигнатура PK\x03\x04
          const head = new Uint8Array(arrayBuffer.slice(0, 4));
          if (head[0] === 0x50 && head[1] === 0x4B && head[2] === 0x03 && head[3] === 0x04) {
            throw new Error('ZIP замаскований під PDF (ЄСІТС) — розпакування не підтримується');
          }

          const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
          // Тип 1 — текстовий шар
          let fullText = '';
          const textPages = Math.min(pdf.numPages, 10);
          for (let i = 1; i <= textPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            fullText += content.items.map(item => item.str).join(' ') + '\n';
          }
          if (fullText.trim().length > 50) {
            return { type: 'text', content: fullText.trim(), name: file.name };
          }

          // Тип 2 — скан → конвертувати в PNG через canvas (max 5 сторінок)
          const images = [];
          const scanPages = Math.min(pdf.numPages, 5);
          for (let i = 1; i <= scanPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            images.push(canvas.toDataURL('image/png').split(',')[1]);
          }
          return { type: 'images', content: images, name: file.name };
        }

        // Інші формати → UTF-8 декодування
        const text = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer);
        if (text && text.trim().length > 0) {
          return { type: 'text', content: text.slice(0, 100000), name: file.name };
        }
        return { type: 'text', content: `[Порожньо, mime=${file.mimeType}]`, name: file.name };
      }

      // textDocs — {name, text}; imageDocs — {name, images[]}; failed — {name, error}
      const textDocs = [];
      const imageDocs = [];
      const failed = [];

      for (let idx = 0; idx < sourceFiles.length; idx++) {
        const file = sourceFiles[idx];
        setContextMsg(`📖 Читаю ${idx + 1}/${sourceFiles.length}: ${file.name}`);
        try {
          const result = await readFileContent(file, token);
          if (result.type === 'text') {
            textDocs.push({ name: result.name, text: result.content });
            console.log(`[CaseDossier] ✅ TEXT ${file.name} (${result.content.length} симв)`);
          } else if (result.type === 'images') {
            imageDocs.push({ name: result.name, images: result.content });
            console.log(`[CaseDossier] 📷 SCAN ${file.name} (${result.content.length} стор. PNG)`);
          }
        } catch (e) {
          console.log(`[CaseDossier] ❌ ${file.name}:`, e.message);
          failed.push({ name: file.name, error: e.message });
          // Жоден файл не пропускається мовчки — додаємо в текст як запис про помилку
          textDocs.push({ name: file.name, text: `[Файл: ${file.name} — помилка читання: ${e.message}]` });
        }
      }

      const totalProcessed = textDocs.length + imageDocs.length;
      console.log(`[CaseDossier] Оброблено: ${textDocs.length} текст + ${imageDocs.length} сканів, помилок: ${failed.length}`);
      setContextMsg(`Аналізую ${totalProcessed} документів (${imageDocs.length} через vision, ${failed.length} помилок)...`);
      const apiKey = localStorage.getItem("claude_api_key");
      if (!apiKey) {
        setContextMsg("Потрібен API ключ Claude. Введіть у налаштуваннях.");
        setContextLoading(false);
        return;
      }

      const systemPrompt = `Ти — юридичний аналітик. Створи контекстний файл справи на основі наданих документів.

Структура файлу:
# Справа ${caseData.name} ${caseData.case_no || ''}
Створено: ${new Date().toISOString().split('T')[0]}

## Огляд справи
(Коротке резюме: хто позивач, хто відповідач, суть спору, стадія)

## Сторони і позиції
(Кожна сторона: хто, чого вимагає, на що посилається)

## Документи
(Для кожного документа: назва, дата, суть без шапок і реквізитів)

## Ключові факти і докази
(Все що може впливати на результат)

## Хронологія подій
(Послідовно від початку)

## Слабкі місця
(Вразливості позиції, ризики)

## Спостереження
(Тактичні рекомендації)

МОВА: українська. Формат: Markdown. Без зайвих вступів.`;

      // Зібрати текстовий блок з усіх розпарсених документів
      const textBlock = textDocs.length > 0
        ? textDocs.map((d, i) => `### ДОКУМЕНТ ${i + 1}: ${d.name}\n\n${d.text}`).join('\n\n---\n\n')
        : '';

      const userContent = [];
      // Скани — PNG сторінки як image blocks (один image block на сторінку)
      imageDocs.forEach(doc => {
        userContent.push({ type: "text", text: `Наступний документ — скан "${doc.name}" (${doc.images.length} стор.). Витягни з нього текст і врахуй у аналізі.` });
        doc.images.forEach(b64 => {
          userContent.push({
            type: "image",
            source: { type: "base64", media_type: "image/png", data: b64 }
          });
        });
      });
      // Текстовий корпус
      if (textBlock) {
        userContent.push({ type: "text", text: `Текстові документи справи:\n\n${textBlock}` });
      }
      userContent.push({
        type: "text",
        text: `Проаналізуй усі ${totalProcessed} документів (${textDocs.length} текстових + ${imageDocs.length} сканів) і створи контекстний файл справи "${caseData.name}" за заданою структурою. Жоден документ не ігноруй.`
      });

      const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8192,
          system: systemPrompt,
          messages: [{ role: "user", content: userContent }]
        })
      });

      if (!apiRes.ok) {
        const errText = await apiRes.text();
        throw new Error(`API ${apiRes.status}: ${errText.slice(0, 500)}`);
      }

      const data = await apiRes.json();
      const contextMd = data?.content?.[0]?.text || "";

      if (!contextMd) {
        setContextMsg("Claude не повернув результат");
        setContextLoading(false);
        return;
      }

      // 5. Зберегти case_context.md на Drive
      setContextMsg("Зберігаю case_context.md...");

      // Архівувати існуючий
      const existingFiles = await listFolderFiles(folderId, token);
      const existingCtx = existingFiles.find(f => f.name === "case_context.md");
      if (existingCtx) {
        const archiveFolder = await findOrCreateFolder("archive", folderId, token);
        const archiveName = `case_context_${new Date().toISOString().split('T')[0]}.md`;
        // Скопіювати в архів
        await fetch(`https://www.googleapis.com/drive/v3/files/${existingCtx.id}/copy`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: archiveName, parents: [archiveFolder.id] })
        });
        // Видалити старий
        await fetch(`https://www.googleapis.com/drive/v3/files/${existingCtx.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` }
        });
      }

      // Завантажити новий
      const uploadResult = await uploadFileToDrive(
        "case_context.md",
        new Blob([contextMd], { type: "text/markdown" }),
        folderId,
        token
      );

      if (uploadResult?.error) {
        setContextMsg(`❌ Не вдалося зберегти на Drive: ${uploadResult.error.message || JSON.stringify(uploadResult.error)}`);
        setContextLoading(false);
        handleCreateContext.running = false;
        return;
      }

      if (!uploadResult?.id) {
        setContextMsg("❌ Drive не повернув id файлу — збереження не підтверджено");
        setContextLoading(false);
        handleCreateContext.running = false;
        return;
      }

      setContextMsg(`✅ Контекст створено (${totalProcessed} документів: ${textDocs.length} текст + ${imageDocs.length} сканів${failed.length ? `, ${failed.length} помилок` : ''}, джерело: ${sourceName})`);

      // Оновити caseContext в стані — щоб агент побачив новий/оновлений файл одразу
      try {
        const fresh = await loadCaseContext();
        if (fresh) setCaseContext(fresh);
      } catch (e) { console.log('[CaseContext] refresh after save failed:', e); }
    } catch (err) {
      console.error("Context creation error:", err);
      setContextMsg(`Помилка: ${err.message}`);
    } finally {
      setContextLoading(false);
      handleCreateContext.running = false;
    }
  }

  // Agent panel state (agentMessages — вище, біля caseContext)
  const [agentOpen, setAgentOpen] = useState(true);
  const [agentWidth, setAgentWidth] = useState(() => Math.min(500, Math.max(280, Math.round(window.innerWidth * 0.35))));
  const [agentInput, setAgentInput] = useState('');
  const [agentLoading, setAgentLoading] = useState(false);
  const agentDragRef = useRef(false);


  // Materials resizer state
  const [matWidth, setMatWidth] = useState(280);
  const matDragRef = useRef(false);

  const handleCreateDriveStructure = async () => {
    const token = localStorage.getItem("levytskyi_drive_token");
    if (!token) { showMsg("❌ Підключіть Google Drive"); return; }

    setCreatingStructure(true);
    try {
      const caseName = `${caseData.name}_${caseData.case_no || caseData.id}`.replace(/[/\s\\:*?"<>|]+/g, "_");
      const { caseFolderId, caseFolderName } = await createCaseStructure(caseName, token);
      const newStorage = {
        driveFolderId: caseFolderId,
        driveFolderName: caseFolderName,
        localFolderPath: null,
        lastSyncAt: new Date().toISOString(),
      };
      updateCase(caseData.id, "storage", newStorage);
      setStorageState(newStorage);
      showMsg("✅ Структуру створено: " + caseFolderName);
    } catch (e) {
      showMsg("❌ Помилка: " + e.message);
    } finally {
      setCreatingStructure(false);
    }
  };

  const defaultProc = [{
    id: 'proc_main',
    type: 'first',
    title: 'Основне провадження',
    court: caseData.court || '',
    status: 'active',
    parentProcId: null,
    parentEventId: null
  }];
  const [proceedings, setProceedings] = useState(
    (caseData.proceedings && caseData.proceedings.length > 0) ? caseData.proceedings : defaultProc
  );

  // Sync proceedings with props when caseData changes externally
  useEffect(() => {
    if (caseData.proceedings && caseData.proceedings.length > 0) {
      setProceedings(caseData.proceedings);
    }
  }, [caseData.proceedings]);
  const documents = caseData.documents || [];

  const caseNotes = (notesProp || []).slice().sort((a, b) => new Date(b.ts || b.createdAt || 0) - new Date(a.ts || a.createdAt || 0));
  const pinnedIds = caseData.pinnedNoteIds || [];
  const isPinned = (noteId) => pinnedIds.includes(String(noteId));
  const pinnedNote = caseNotes.find(n => isPinned(n.id)) || caseNotes[0];

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

  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  // Voice input for agent
  const [agentRecording, setAgentRecording] = useState(false);
  const agentRecognitionRef = useRef(null);
  const agentPendingTranscript = useRef('');

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
      if (newWidth > 280 && newWidth < 500) setAgentWidth(newWidth);
    }
    function onMouseUp() { agentDragRef.current = false; }
    function onTouchMove(e) {
      if (!agentDragRef.current) return;
      const touch = e.touches[0];
      const newWidth = window.innerWidth - touch.clientX;
      if (newWidth > 280 && newWidth < 500) setAgentWidth(newWidth);
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
      if (newWidth > 200 && newWidth < 400) setMatWidth(newWidth);
    }
    function onTouchMove(e) {
      if (!matDragRef.current) return;
      const touch = e.touches[0];
      const newWidth = touch.clientX;
      if (newWidth > 200 && newWidth < 400) setMatWidth(newWidth);
    }
    function onUp() { matDragRef.current = false; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onTouchMove);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onUp);
    };
  }, []);


  async function uploadFileLocal(file, cData) {
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

  function startAgentVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { systemAlert("Мікрофон не ��ідтримується в цьому браузері"); return; }
    if (agentRecognitionRef.current) { stopAgentVoice(); return; }
    const recognition = new SR();
    recognition.lang = 'uk-UA';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const t = event.results[0][0].transcript;
      agentPendingTranscript.current = (agentPendingTranscript.current || '') + t + ' ';
    };
    recognition.onend = () => {
      if (agentRecognitionRef.current && agentRecording) {
        recognition.start();
        return;
      }
      const final = (agentPendingTranscript.current || '').trim();
      if (final) setAgentInput(prev => prev ? prev + ' ' + final : final);
      agentPendingTranscript.current = '';
      setAgentRecording(false);
      agentRecognitionRef.current = null;
    };
    recognition.onerror = () => {
      setAgentRecording(false);
      agentRecognitionRef.current = null;
      agentPendingTranscript.current = '';
    };
    recognition.start();
    setAgentRecording(true);
    agentRecognitionRef.current = recognition;
  }

  function stopAgentVoice() {
    setAgentRecording(false);
    agentRecognitionRef.current?.stop();
  }

  function cancelAgentVoice() {
    setAgentRecording(false);
    agentRecognitionRef.current?.abort();
    agentRecognitionRef.current = null;
    agentPendingTranscript.current = '';
  }

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
        const systemPrompt = buildAgentSystemPrompt();

        // Send last 10 messages as context for API (token economy)
        const historyForAPI = agentMessages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .slice(-10)
          .map(m => ({ role: m.role, content: m.content }));

        // API requires first message to be role:'user'
        const firstUserIdx = historyForAPI.findIndex(m => m.role === 'user');
        const cleanHistory = firstUserIdx >= 0 ? historyForAPI.slice(firstUserIdx) : [];

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
            messages: [...cleanHistory, { role: 'user', content: userMsg }]
          })
        });
        if (!response.ok) {
          const errText = await response.text();
          const errEntry = { role: 'assistant', content: `⚠️ Помилка ${response.status}: ${errText.slice(0, 300)}`, ts: new Date().toISOString() };
          setAgentMessages(prev => {
            const updated = [...prev, errEntry].slice(-50);
            updateCase && updateCase(caseData.id, 'agentHistory', updated);
            saveAgentHistory(updated);
            return updated;
          });
          setAgentLoading(false);
          return;
        }
        const data = await response.json();
        const reply = data.content?.[0]?.text || `⚠️ Порожня відповідь. Payload: ${JSON.stringify(data).slice(0, 300)}`;
        const assistantEntry = { role: 'assistant', content: reply, ts: new Date().toISOString() };
        setAgentMessages(prev => {
          const updated = [...prev, assistantEntry].slice(-50);
          updateCase && updateCase(caseData.id, 'agentHistory', updated);
          saveAgentHistory(updated); // Зберегти на Drive
          return updated;
        });
      } catch (err) {
        const errEntry = { role: 'assistant', content: `⚠️ Мережева помилка: ${err.message}`, ts: new Date().toISOString() };
        setAgentMessages(prev => {
          const updated = [...prev, errEntry].slice(-50);
          updateCase && updateCase(caseData.id, 'agentHistory', updated);
          saveAgentHistory(updated); // Зберегти на Drive
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
            <div style={{ fontSize: 10, color: '#5a6080' }}>
              {"Sonnet · знає справу"}
              {caseContext && <span style={{ marginLeft: 4, color: '#2ecc71' }}>📄</span>}
            </div>
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
        <div style={{ padding: 8, borderTop: '1px solid #2e3148', display: 'flex', gap: 6, flexShrink: 0, alignItems: 'flex-end' }}>
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
          {agentRecording ? (
            <>
              <button onClick={cancelAgentVoice} style={{ background: 'none', border: '1px solid rgba(231,76,60,.4)', color: '#e74c3c', padding: '0 10px', borderRadius: 6, cursor: 'pointer', fontSize: 14, height: 34 }}>{"\u00d7"}</button>
              <button onClick={stopAgentVoice} style={{ background: '#2ecc71', border: 'none', color: '#fff', padding: '0 10px', borderRadius: 6, cursor: 'pointer', fontSize: 14, height: 34 }}>{"\u2713"}</button>
            </>
          ) : (
            <button onClick={startAgentVoice} style={{ background: 'none', border: '1px solid #2e3148', color: '#9aa0b8', padding: '0 10px', borderRadius: 6, cursor: 'pointer', fontSize: 14, height: 34 }}>{"\ud83c\udfa4"}</button>
          )}
          <button
            onClick={sendAgentMessage}
            disabled={agentLoading || !agentInput.trim()}
            style={{
              background: '#4f7cff', border: 'none', color: '#fff',
              padding: '0 12px', borderRadius: 6, height: 34,
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
                    saveAgentHistory([]); // Очистити історію на Drive
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
            { label: "Дата засідання", field: "_hearing_date", value: (() => { const h = (caseData.hearings || []).filter(h => h.status === 'scheduled').sort((a,b) => a.date.localeCompare(b.date))[0]; return h ? `${h.date}${h.time ? ' о ' + h.time : ''}` : ''; })(), readOnly: true },
            { label: "Дедлайн", field: "deadline", value: caseData.deadline }
          ].map(row => (
            <div key={row.field} style={{ display: "flex", gap: 12, marginBottom: 10, alignItems: "flex-start" }}>
              <div style={{ width: 130, fontSize: 11, color: "#5a6080", flexShrink: 0, paddingTop: 2 }}>{row.label}</div>
              <div
                contentEditable={!row.readOnly}
                suppressContentEditableWarning
                onBlur={e => !row.readOnly && updateCase && updateCase(caseData.id, row.field, e.target.innerText.trim())}
                onFocus={e => { if (!row.readOnly) e.target.style.borderColor = "#4f7cff"; }}
                onBlurCapture={e => e.target.style.borderColor = "transparent"}
                style={{ flex: 1, fontSize: 12, color: row.value ? "#e8eaf0" : "#3a3f58", outline: "none", minHeight: 20, padding: "2px 6px", borderRadius: 4, border: "1px solid transparent", cursor: row.readOnly ? "default" : "text", transition: "border-color .15s" }}
              >{row.value || "\u2014"}</div>
            </div>
          ))}

          {/* Нотатки до справи */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#5a6080", marginBottom: 4 }}>{"Нотатки до справи"}</div>
            {(() => {
              const pinned = caseNotes.filter(n => isPinned(n.id));
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

        {/* Сховище Drive */}
        <div style={{ background: "#1a1d27", border: "1px solid #2e3148", borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: "#5a6080", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12 }}>{"Сховище"}</div>
          {!storageState?.driveFolderId ? (
            <button
              onClick={handleCreateDriveStructure}
              disabled={creatingStructure}
              style={{
                background: creatingStructure ? "#2a2d3e" : "#1a4a8a",
                color: "#fff", border: "none", borderRadius: 6,
                padding: "8px 16px", cursor: creatingStructure ? "wait" : "pointer", fontSize: 13,
              }}
            >
              {creatingStructure ? "⏳ Створюю..." : "📁 Створити структуру на Drive"}
            </button>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ color: "#4caf50", fontSize: 13 }}>
                {"☁️ "}{storageState.driveFolderName || "Drive папка"}
              </span>
              <button
                onClick={() => window.open(`https://drive.google.com/drive/folders/${storageState.driveFolderId}`, "_blank")}
                style={{
                  background: "none", border: "1px solid #333", borderRadius: 6,
                  padding: "4px 10px", color: "#aaa", cursor: "pointer", fontSize: 12,
                }}
              >{"🔗 Відкрити"}</button>
            </div>
          )}
          {storageMsg && (
            <div style={{
              marginTop: 6, fontSize: 12,
              color: storageMsg.startsWith("\u2705") ? "#4caf50" : "#f44336",
            }}>
              {storageMsg}
            </div>
          )}
        </div>

        {/* Контекст справи */}
        {storageState?.driveFolderId && (
          <div style={{ background: "#1a1d27", border: "1px solid #2e3148", borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "#5a6080", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12 }}>{"Контекст справи"}</div>
            <div style={{ fontSize: 12, color: "#9aa0b8", marginBottom: 10 }}>
              {"Автоматичний аналіз всіх документів справи — огляд, сторони, хронологія, слабкі місця."}
            </div>
            <button
              disabled={contextLoading}
              onClick={handleCreateContext}
              style={{
                background: contextLoading ? "#2e3148" : "rgba(79,124,255,.12)",
                color: contextLoading ? "#5a6080" : "#4f7cff",
                border: "none", borderRadius: 6, padding: "8px 16px",
                fontSize: 12, fontWeight: 600, cursor: contextLoading ? "wait" : "pointer"
              }}
            >
              {contextLoading ? "Створюю..." : "Створити контекст"}
            </button>
            {contextMsg && (
              <div style={{ marginTop: 8, fontSize: 11, color: contextMsg.startsWith("Помилка") ? "#e74c3c" : "#9aa0b8" }}>
                {contextMsg}
              </div>
            )}
          </div>
        )}

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
              background: isPinned(note.id) ? "rgba(79,124,255,0.08)" : "#222536",
              borderLeft: isPinned(note.id) ? "2px solid #4f7cff" : "2px solid transparent",
              transition: "all 0.2s"
            }}>
              {editingNoteId === note.id ? (
                <>
                  <textarea
                    value={editingNoteText}
                    onChange={e => setEditingNoteText(e.target.value)}
                    style={{ width: "100%", minHeight: 80, background: "#0d0f1a", color: "#e8eaf0", border: "1px solid #4f7cff", borderRadius: 6, padding: 8, fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <button onClick={() => { onUpdateNote && onUpdateNote(note.id, { text: editingNoteText }); setEditingNoteId(null); setEditingNoteText(""); }} style={{ background: "#1a4a8a", color: "#fff", border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 12 }}>
                      {"✓ Зберегти"}
                    </button>
                    <button onClick={() => setEditingNoteId(null)} style={{ background: "#333", color: "#aaa", border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 12 }}>
                      {"Скасувати"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                    <div style={{ flex: 1 }}>
                      {String(note.text || "")}
                    </div>
                    <button
                      onClick={() => { setEditingNoteId(note.id); setEditingNoteText(note.text || ""); }}
                      title="Редагувати"
                      style={{ background: "none", border: "none", color: "#5a6080", cursor: "pointer", fontSize: 12, padding: "2px 4px", flexShrink: 0 }}
                    >{"✏️"}</button>
                    <button
                      onClick={() => onDeleteNote && onDeleteNote(note.id)}
                      title="Видалити"
                      style={{ background: "none", border: "none", color: "#5a6080", cursor: "pointer", fontSize: 12, padding: "2px 4px", flexShrink: 0 }}
                    >{"🗑️"}</button>
                    {(() => {
                      const isNotePinned = (caseData.pinnedNoteIds || []).includes(String(note.id));
                      return (
                        <button
                          onClick={() => onPinNote && onPinNote(note.id, caseData.id)}
                          title={isNotePinned ? "Закріпити" : "Відкріпити"}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: 16, padding: '2px 4px', display: 'inline-block',
                            transform: isNotePinned ? 'rotate(-45deg)' : 'rotate(0deg)',
                            opacity: isNotePinned ? 0.4 : 1,
                            color: isNotePinned ? '#888' : '#e53935',
                            transition: 'transform 0.2s ease, opacity 0.2s ease, color 0.2s ease'
                          }}
                        >📌</button>
                      );
                    })()}
                  </div>
                  <div style={{ fontSize: 10, color: "#3a3f58", marginTop: 4 }}>{(note.ts || note.createdAt) ? new Date(note.ts || note.createdAt).toLocaleDateString("uk-UA") : ""}</div>
                </>
              )}
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
                        await uploadFileLocal(prepared, caseData);
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
          style={{
            width: 8,
            flexShrink: 0,
            cursor: 'col-resize',
            background: '#1a1d2e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            zIndex: 10,
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = matWidth;
            const container = e.currentTarget.parentElement;
            const maxW = container.offsetWidth * 0.5;
            const onMove = (ev) => {
              const delta = ev.clientX - startX;
              setMatWidth(Math.max(200, Math.min(maxW, startWidth + delta)));
            };
            const onUp = () => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          }}
          onTouchStart={(e) => {
            const startX = e.touches[0].clientX;
            const startWidth = matWidth;
            const container = e.currentTarget.parentElement;
            const maxW = container.offsetWidth * 0.5;
            const onMove = (ev) => {
              const delta = ev.touches[0].clientX - startX;
              setMatWidth(Math.max(200, Math.min(maxW, startWidth + delta)));
            };
            const onUp = () => {
              document.removeEventListener('touchmove', onMove);
              document.removeEventListener('touchend', onUp);
            };
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onUp);
          }}
        >
          <div style={{ width: 4, height: 40, borderRadius: 2, background: '#3a3d5a', pointerEvents: 'none' }} />
        </div>

        {/* Viewer */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
    { id: "docprocessor", label: "🔧 Робота з документами" },
    { id: "position", label: "⚖️ Позиція" },
    { id: "templates", label: "📄 Шаблони" }
  ];

  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "#0d0f1a", display: "flex", flexDirection: "column", overflow: "hidden", color: "#e8eaf0", fontFamily: "'Segoe UI',sans-serif", fontSize: 13 }}>

      {/* ШАПКА */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid #2e3148", display: "flex", alignItems: "center", gap: 12, flexShrink: 0, background: "#0d0f1a", position: "relative", zIndex: 200 }}>
        <button onClick={onClose} style={{ background: "#222536", border: "1px solid #2e3148", color: "#9aa0b8", padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>{"\u2190 Реєстр"}</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{caseData.name}</div>
          <div style={{ fontSize: 11, color: "#5a6080", marginTop: 2 }}>
            {categoryLabel}{caseData.court ? ` \u00b7 ${caseData.court}` : ""}{caseData.case_no ? ` \u00b7 \u2116${caseData.case_no}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 4, fontWeight: 600, background: `${statusColor}22`, color: statusColor }}>{statusLabel}</span>
          {(() => { const _nh = (caseData.hearings || []).filter(h => h.status === 'scheduled').sort((a,b) => a.date.localeCompare(b.date))[0]; return _nh ? <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 4, fontWeight: 600, background: "rgba(243,156,18,.15)", color: "#f39c12" }}>{"📅 "}{_nh.date}{_nh.time ? ` о ${_nh.time}` : ''}</span> : null; })()}
          {storageState?.driveFolderId ? (
            <button onClick={() => window.open(`https://drive.google.com/drive/folders/${storageState.driveFolderId}`, "_blank")} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 4, fontWeight: 600, background: "rgba(79,124,255,.12)", color: "#4f7cff", border: "none", cursor: "pointer" }} title={storageState.driveFolderName || "Drive папка"}>{"☁️ Drive 🔗"}</button>
          ) : (
            <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 4, fontWeight: 600, background: "rgba(231,76,60,.1)", color: "#e74c3c" }}>{"⚠️ Без папки"}</span>
          )}
          {caseData.status !== "closed" && onCloseCase && (
            <button onClick={async () => {
              if (await systemConfirm("Закрити справу? Вона перейде в архів. Видалити можна буде звідти.", "Закриття справи")) {
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
      <div style={{ display: "flex", borderBottom: "1px solid #2e3148", flexShrink: 0, padding: "0 16px", gap: 2, background: "#0d0f1a", position: "relative", zIndex: 200 }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ padding: "8px 14px", border: "none", background: "none", color: activeTab === tab.id ? "#e8eaf0" : "#9aa0b8", cursor: "pointer", fontSize: 12, borderBottom: `2px solid ${activeTab === tab.id ? "#9aa0b8" : "transparent"}`, fontWeight: activeTab === tab.id ? 500 : 400, whiteSpace: "nowrap", transition: "all .15s" }}>
            {tab.label}
            {tab.badge > 0 && <span style={{ fontSize: 9, background: "#222536", padding: "1px 5px", borderRadius: 8, marginLeft: 4, color: "#5a6080" }}>{tab.badge}</span>}
          </button>
        ))}
      </div>

      {/* BODY */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden", position: "relative", zIndex: 1 }}>
        {/* Основний вміст вкладки */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto', minWidth: 0 }}>
          {activeTab === "overview" && renderOverview()}
          {activeTab === "materials" && renderMaterials()}
          {activeTab === "docprocessor" && (
            <DocumentProcessor
              caseData={caseData}
              cases={cases}
              updateCase={updateCase}
              onCreateCase={null}
              onNavigateToDossier={null}
              apiKey={localStorage.getItem("claude_api_key")}
              driveFolderId={storageState?.driveFolderId}
              driveToken={localStorage.getItem("levytskyi_drive_token")}
            />
          )}
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
            style={{ width: 8, cursor: 'col-resize', flexShrink: 0, background: '#1a1d2e', display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none', transition: 'background .15s', zIndex: 10, position: 'relative' }}
            onMouseEnter={e => e.currentTarget.style.background = '#2a2d44'}
            onMouseLeave={e => e.currentTarget.style.background = '#1e2130'}
          >
            <div style={{ width: 4, height: 40, borderRadius: 2, background: '#3a3d5a' }} />
          </div>
        )}

        {/* Панель агента */}
        {agentOpen && (
          <div style={{
            width: agentWidth, flexShrink: 0, borderLeft: '1px solid #2e3148',
            display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#1a1d27',
            position: 'relative'
          }}>
            {renderAgentPanel()}
          </div>
        )}

      </div>

      {/* МОДАЛКА ІДЕЯ ДЛЯ КОНТЕНТУ */}
      {ideaOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300 }}>
          <div style={{ background: "#1a1d27", border: "1px solid #2e3148", borderRadius: 12, padding: 20, width: 360 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{"💡 Ідея для конт��нту"}</div>
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
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300 }}>
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
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
                setProceedings(updated);
                setProcModalOpen(false);
                setNewProc({ title: '', court: '', type: 'appeal' });
              }} style={{ background: '#4f7cff', color: '#fff', border: 'none', padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Додати</button>
            </div>
          </div>
        </div>
      )}

      {/* МОДАЛКА + ДОКУМЕНТ */}
      {docModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
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
                    driveId = await uploadFileLocal(prepared, caseData);
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
