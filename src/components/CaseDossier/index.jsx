import { useState, useEffect, useRef } from "react";
import { createCaseStructure, getDriveFiles, readDriveFile, createDriveFile, updateDriveFile } from "../../services/driveService.js";
import { createDocument } from "../../services/documentFactory.js";
import { driveRequest, forceConsentRefresh } from "../../services/driveAuth.js";
import * as ocrService from "../../services/ocrService.js";
import { useDocumentPipeline } from "../../contexts/documentPipelineContextCore.js";
import * as eventBus from "../../services/eventBus.js";
import { DOCUMENT_BATCH_PROCESSED } from "../../services/eventBusTopics.js";
import { inferNatureFromFile, defaultNatureForUI } from "../../services/detectDocumentNature.js";
import { systemAlert, systemConfirm, systemPrompt } from "../SystemModal";
import { toast } from "../../services/toast.js";
import { messages } from "../../services/messages.js";
import { resolveModel } from "../../services/modelResolver.js";
import * as activityTracker from "../../services/activityTracker.js";
import { MODULES, categoryForCase } from "../../services/moduleNames.js";
import { runMultiTurnConversation, callAPIWithRetry } from "../../services/toolUseRunner.js";
import { DOSSIER_AGENT_TOOLS } from "../../services/toolDefinitions.js";
import {
  Bot, FileText, FolderOpen, Folder, Cloud, Link2, Pin,
  Edit, Trash2, GitBranch, ClipboardList,
  Scale, Calendar, Archive, Lightbulb, Check, MessageSquare,
  ArrowLeft, AlertTriangle, ChevronLeft, ChevronRight, Maximize2, Minimize2, Wrench,
} from "lucide-react";
import { ICON_SIZE } from "../UI/icons.js";
import { DatePicker, DateTimePicker, Input, Modal, Button, Checkbox, BulkActionBar, useSelection } from "../UI";
import { DocumentViewer } from "../DocumentViewer";
import { AddDocumentModal } from "./AddDocumentModal.jsx";
import DocumentProcessorV2 from "../DocumentProcessorV2";
import { ECITSBanner } from "../ECITSBanner";
import { DeleteDocumentModal } from "./DeleteDocumentModal.jsx";
import { ArchiveView } from "./ArchiveView.jsx";
import { generateCaseContext } from "./services/contextGenerator.js";
import { derivePendingRegen, shouldStartContextRegen } from "./services/contextRelay.js";
import * as documentsExtended from "../../services/documentsExtended.js";
import { enrichDocumentWithVisionMetadata } from "../../services/documentMetadata.js";
import "./CaseDossier.css";

const CATEGORY_LABELS = {
  pleading: "Заява по суті", motion: "Клопотання",
  court_act: "Судовий акт", evidence: "Докази",
  correspondence: "Листування", other: "Інше"
};

const AUTHOR_LABELS = { ours: "Наш", opponent: "Опонент", court: "Суд" };

const TAG_COLORS = {
  key: { bg: "rgba(79,124,255,.2)", color: "var(--color-accent)" },
  ours: { bg: "rgba(46,204,113,.2)", color: "var(--color-success)" },
  opponent: { bg: "rgba(245,158,11,.2)", color: "var(--color-warning)" }
};

const PROC_COLORS = {
  first: "var(--color-success)",
  appeal: "var(--color-proceeding-appeal)",
  cassation: "var(--color-warning)"
};

export default function CaseDossier({ caseData, cases, updateCase, onClose, onSaveIdea, onCloseCase, onDeleteCase, notes: notesProp, onAddNote, onUpdateNote, onDeleteNote, onPinNote, driveConnected, onExecuteAction, setAiUsage }) {
  // TASK 4 · етап C — спільна труба додавання. Модалка «+ Додати документ»
  // йде через docPipeline.ingestFiles({mode:'add_as_is'}) замість приватного
  // createDocumentPipeline (усунення дубль-шляху C4). Пост-OCR з Vision-
  // фолбеком лишається тут (deferOcr=true → runAddAsIs не OCR-ить сам).
  const docPipeline = useDocumentPipeline();
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
  const [creatingStructure, setCreatingStructure] = useState(false);
  const [storageState, setStorageState] = useState(caseData.storage || {});
  const [storageMsg, setStorageMsg] = useState('');
  // folderStatus — стан Drive папки справи на момент рендеру:
  //   'unknown'  — ще не перевірили (loading)
  //   'alive'    — папка існує на Drive і не у кошику
  //   'trashed'  — папка на Drive але у кошику (адвокат видалив вручну)
  //   'missing'  — папки немає взагалі (driveFolderId пустий АБО Drive 404)
  // Перевірка робиться один Drive GET при зміні driveFolderId. Окремий стан
  // потрібен щоб UI чесно показав одну з трьох кнопок: «Створити структуру»
  // (missing), «Перестворити» (trashed), «Відкрити» (alive).
  const [folderStatus, setFolderStatus] = useState('unknown');
  const [contextLoading, setContextLoading] = useState(false);
  const [contextMsg, setContextMsg] = useState('');
  const [isCreatingContext, setIsCreatingContext] = useState(false);
  // Естафетна паличка від Document Processor: { caseId, expectedDocIds: string[],
  // scenarioRunId? } | null. Однозначність (#11): «DP-запуск з увімкненим тумблером
  // передав естафету генератору контексту; чекаємо доки expectedDocIds приземляться
  // в caseData.documents». Ставиться у КІНЦІ DP-забігу (на DOCUMENT_BATCH_PROCESSED
  // з updateCaseContext===true), знімається коли генератор добіг свій фініш (успіх
  // АБО помилка). Третього стану немає: паличка або передана, або викинута.
  const [pendingContextRegen, setPendingContextRegen] = useState(null);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingNoteText, setEditingNoteText] = useState('');

  // ── Date/time picker modal state ──────────────────────────────────────
  // Нове засідання — одна модалка з DateTimePicker (дата і час обовʼязкові
  // одночасно). Раніше було ДВА послідовні systemPrompt'и для дати і часу,
  // причому час був «(можна не додавати)» — це порушувало вимогу що адвокат
  // має знати точний час щоб з'явитись у суді.
  const [addHearingOpen, setAddHearingOpen] = useState(false);
  // Новий дедлайн — одна модалка з полем назви + DatePicker (зараз — два
  // послідовні systemPrompt'и).
  const [addDeadlineOpen, setAddDeadlineOpen] = useState(false);
  const [newDeadline, setNewDeadline] = useState({ name: '', date: '' });

  const [caseContext, setCaseContext] = useState(null);

  // Agent state — має бути ВИЩЕ useEffect щоб setAgentMessages був доступний при маунті
  const [agentMessages, setAgentMessages] = useState(() => caseData.agentHistory || []);

  // [BILLING] Dossier session — case_work з прив'язкою до caseId.
  useEffect(() => {
    try {
      activityTracker.startSession(caseData.id, 'case_dossier', { category: 'case_work' });
      // Окремий маркер один раз — для статистики "скільки разів відкрито".
      activityTracker.report('case_opened', { caseId: caseData.id, module: MODULES.CASE_DOSSIER });
    } catch {}
    return () => { try { activityTracker.endSession({ reason: 'unmount' }); } catch {} };
  }, [caseData.id]);

  // [BILLING] tab_switched.
  useEffect(() => {
    try { activityTracker.report('dossier_tab_switched', { caseId: caseData.id, module: MODULES.CASE_DOSSIER, metadata: { tabTo: activeTab } }); } catch {}
  }, [activeTab]);

  // [BILLING] document_viewed.
  useEffect(() => {
    if (selectedDoc?.id) {
      try { activityTracker.report('document_viewed', { caseId: caseData.id, documentId: selectedDoc.id, module: MODULES.CASE_DOSSIER }); } catch {}
    }
  }, [selectedDoc?.id]);

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

  // Перевірка стану Drive папки справи. Один GET до Drive API при зміні
  // driveFolderId. Без цього UI не міг розрізнити «жива папка» vs «папка у
  // кошику» (адвокат бачив кнопку «Відкрити» що вела у trash).
  //
  // 404 → 'missing' (папка видалена назавжди або ID stale); res.trashed=true
  // → 'trashed'; інакше 'alive'. Network/інші помилки лишають 'unknown' —
  // не блокуємо UI повним fallback на «створити структуру» бо може бути
  // тимчасова проблема мережі.
  useEffect(() => {
    if (!storageState?.driveFolderId) {
      setFolderStatus('missing');
      return undefined;
    }
    let cancelled = false;
    setFolderStatus('unknown');
    (async () => {
      try {
        const res = await driveRequest(
          `https://www.googleapis.com/drive/v3/files/${storageState.driveFolderId}?fields=id,trashed`
        );
        if (cancelled) return;
        if (res.status === 404) {
          setFolderStatus('missing');
          return;
        }
        if (!res.ok) {
          setFolderStatus('unknown');
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setFolderStatus(data.trashed ? 'trashed' : 'alive');
      } catch (e) {
        if (cancelled) return;
        console.warn('[CaseDossier] folder status check failed:', e?.message || e);
        setFolderStatus('unknown');
      }
    })();
    return () => { cancelled = true; };
  }, [storageState?.driveFolderId]);

  // Автоматичне перезавантаження контексту і історії після silent-refresh токена.
  // Подія 'drive-token-refreshed' емітиться з driveAuth.js коли driveRequest
  // обробив 401 і оновив токен без участі користувача.
  useEffect(() => {
    const onRefresh = async () => {
      try {
        const ctx = await loadCaseContext();
        if (ctx) setCaseContext(ctx);
        const messages = await loadAgentHistory();
        if (Array.isArray(messages) && messages.length > 0) setAgentMessages(messages);
      } catch (e) { console.log('[CaseDossier] reload after token refresh failed:', e); }
    };
    window.addEventListener('drive-token-refreshed', onRefresh);
    return () => window.removeEventListener('drive-token-refreshed', onRefresh);
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
      localStorage.setItem(`agent_history_${caseData?.id}`, JSON.stringify((history || []).slice(-50)));
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
      ? `СИСТЕМНА ІНФОРМАЦІЯ: Ця система має персистентну пам'ять між сесіями через localStorage.\nПопередні розмови завантажені і передані тобі в контексті вище.\nТи МАЄШ доступ до цих розмов і МОЖЕШ на них посилатись.\nНЕ покладайся на загальні знання про обмеження Claude —\nв цій системі пам'ять між сесіями реалізована технічно.\nЯкщо бачиш попередні повідомлення в контексті — ти їх пам'ятаєш.\n\n`
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

    prompt += `

## ОБМЕЖЕННЯ
Ти працюєш ТІЛЬКИ з поточною справою — тією, в досьє якої адвокат зараз
знаходиться (caseId="${caseData.id}"). Не намагайся виконати дії з іншими
справами. Якщо випадково передаси інший caseId у tool — система перезапише
його на поточний і покаже тобі помітку, не намагайся обходити це.

Якщо адвокат просить:
- Дії з ІНШИМИ існуючими справами (засідання/нотатки/тощо в іншій справі) —
  скажи адвокату використати Дашборд або Quick Input (обидва вміють діяти
  поза контекстом конкретного досьє).
- СТВОРЕННЯ нової справи — скажи адвокату використати Quick Input (наприклад
  команда «створи справу для Іваненка з категорії спадщина») або кнопку
  «+ Додати справу» на головному реєстрі. Дашборд НЕ створює нові справи —
  він тільки редагує існуючі (засідання, нотатки в межах вже наявних справ).

## РЕЖИМ ВИКОНАННЯ (Tool Use)

Ти маєш набір інструментів (tools) для роботи з поточною справою. Викликай
їх НАПРЯМУ коли адвокат просить внести зміни — система виконає дію і
повернеться з результатом, після чого продовжиш розмову.

Доступні тобі tools (повний перелік для роботи з ПОТОЧНОЮ справою):

Засідання:
  • add_hearing — додати засідання
  • update_hearing — змінити дату/час/тривалість/тип
  • delete_hearing — видалити засідання (так, це доступно тобі)

Дедлайни:
  • add_deadline — додати дедлайн
  • update_deadline — змінити назву або дату
  • delete_deadline — видалити дедлайн

Нотатки:
  • add_note — створити нотатку у справі
  • update_note — змінити текст або метадані
  • delete_note — видалити нотатку
  • pin_note — закріпити у справі
  • unpin_note — зняти закріплення

Документи:
  • add_document — додати один документ у реєстр
  • update_document — змінити поля існуючого документа
  • clean_document_text — згенерувати AI-варіант тексту: mode='clean' (Чистий, дослівно, тільки scanned) або mode='digest' (Конспект, переказ, scanned+searchable)
  (видалення документа — ТІЛЬКИ через UI, тобі недоступно)

Провадження:
  • add_proceeding — додати провадження (основне/апеляція/касація…)
  • update_proceeding — змінити поля
  (видалення провадження — ТІЛЬКИ через UI)

Справа:
  • update_case_field — оновити одне поле (name/client/court/case_no/category/status/judge/next_action/notes)
  • close_case — закрити справу
  • restore_case — відновити закриту справу
  (створення НОВОЇ справи — НЕ твоя зона; для цього QI або Дашборд)

Принципи виклику tools:
- Виклик tool — це фактична дія, не симуляція. Не вигадуй ID — користуйся
  тими що є в контексті нижче (Hearings, Deadlines, proceedings).
- Дати у форматі YYYY-MM-DD, час у HH:MM (24-год). Якщо адвокат сказав
  «наступного понеділка» — обчисли реальну дату самостійно.
- Якщо в hearings[] кілька scheduled і незрозуміло яке змінювати/видаляти —
  спочатку перепитай «яке саме — [дата1] чи [дата2]?» замість виклику tool.
  Аналогічно для deadlines[] коли їх кілька.
- Якщо параметр опційний і невідомий (наприклад тип документа) — просто НЕ
  передавай це поле (а не null). Документ отримає маркер ⚠.
- Видалення документів і проваджень — поясни що це робиться в інтерфейсі
  (вкладка Матеріали для документів, вкладка Огляд для проваджень).

Статуси засідань: тільки scheduled і completed. Cancelled не існує.
Минулі засідання (дата менша за сьогодні) — не чіпати без явної вказівки.

Hearings: ${JSON.stringify(caseData.hearings || [])}
Deadlines: ${JSON.stringify(caseData.deadlines || [])}`;

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

  // Для legacy справ (створених до v2 без subFolders у storage):
  // знаходить підпапки в Drive за NFC-нормалізованими іменами і оновлює
  // caseData.storage.subFolders. Безпечно для повторного виклику.
  async function ensureSubFolders(cData) {
    if (cData.storage?.subFolders?.['01_ОРИГІНАЛИ'] &&
        cData.storage?.subFolders?.['02_ОБРОБЛЕНІ']) {
      return cData.storage.subFolders;
    }

    const folderId = cData.storage?.driveFolderId;
    if (!folderId) return null;

    const res = await driveRequest(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
      )}&fields=files(id,name)&pageSize=20`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const folders = data.files || [];

    const findFolder = (target) =>
      folders.find(f => f.name.normalize('NFC') === target.normalize('NFC')) ||
      folders.find(f => f.name.startsWith(target.split('_')[0] + '_'));

    const subFolders = {
      '01_ОРИГІНАЛИ': findFolder('01_ОРИГІНАЛИ')?.id,
      '02_ОБРОБЛЕНІ': findFolder('02_ОБРОБЛЕНІ')?.id,
      '03_ФРАГМЕНТИ': findFolder('03_ФРАГМЕНТИ')?.id,
      '04_ПОЗИЦІЯ': findFolder('04_ПОЗИЦІЯ')?.id,
      '05_ЗОВНІШНІ': findFolder('05_ЗОВНІШНІ')?.id,
    };

    const newStorage = { ...(cData.storage || {}), subFolders };
    updateCase(cData.id, 'storage', newStorage);
    setStorageState(newStorage);

    return subFolders;
  }

  // ── OCR з retry + опційний Claude Vision fallback за підтвердженням ──────
  //
  // Узагальнює два сценарії: Reprocess існуючого документа і AddDocumentModal
  // OCR pipeline. Обидва запускають той самий ланцюжок (pdfjsLocal → documentAi),
  // обидва мають однакову поведінку на NETWORK збоях:
  //
  //  • Retry: toast оновлюється «Зʼєднання нестабільне. Повторюю спробу (N/3)...»
  //  • Успіх після retry: toast «Готово»
  //  • UNSUPPORTED: «Цей формат не підтримується для OCR.», без fallback
  //  • AUTH/QUOTA: відповідний toast.error, без fallback
  //  • NETWORK exhausted (3 retry на кожному чанку — вичерпались): діалог
  //    «Хочете спробувати через Claude Vision?» з вибором «Так» / «Повернутись пізніше»
  //  • Так → ocrService повторно з forceProvider='claudeVision' (resume з місця збою)
  //  • Пізніше → resume стан залишається; наступне Перерозпізнати продовжить documentAi
  //
  // Параметри:
  //   file — OCR target { id, name, mimeType, subFolders }
  //   doc — реєстровий запис документа (для update_document по успіху)
  //   caseId — case.id (для update_document)
  //   onExecuteAction — функція виклику action (з пропсів)
  //   silentSuccess — якщо true, success toast не показується (для AddDoc pipeline)
  async function runOcrWithRetryUI({ file, doc, caseId, onExecuteAction, silentSuccess = false } = {}) {
    const initialMsg = 'Розпізнавання...';
    const tId = toast.info(initialMsg, { persistent: true });

    let lastShownRetry = 0;
    const opts = {
      skipCache: true,
      onRetry: ({ attempt, of }) => {
        // attempt — номер тієї спроби яка зараз буде запущена після backoff
        lastShownRetry = attempt;
        toast.dismiss(tId);
      },
      onChunkDone: ({ processedPages, totalPages }) => {
        // оновлюємо опис прогресу — обчислюємо у новому toast
        // (toast.js не має update API — dismiss + новий)
      },
    };

    const tryProvider = async (providerOpts) => {
      return await ocrService.extractText(file, { ...opts, ...providerOpts });
    };

    let ocrResult = null;
    let ocrErr = null;
    try {
      ocrResult = await tryProvider({});
    } catch (e) {
      ocrErr = e;
    }
    toast.dismiss(tId);

    if (lastShownRetry > 1 && !ocrErr) {
      // Був ретрай і успіх — повідомляємо
      toast.success('Розпізнавання продовжується... Готово');
    }

    // NETWORK exhausted — пропонуємо Claude Vision або «пізніше»
    if (ocrErr && ocrErr.code === 'NETWORK') {
      const totalPages = ocrErr.totalPages || 0;
      const processedPages = ocrErr.processedPages || 0;
      const partialNote = totalPages > 0
        ? `Опрацьовано ${processedPages} з ${totalPages} сторінок.`
        : '';
      const consent = await systemConfirm(
        `Не вдалось розпізнати документ через Document AI. Хочете спробувати через Claude Vision? Це повільніше і коштує більше, але може спрацювати при тривалих проблемах з Google API.\n\n${partialNote}`,
        'Документ AI недоступний'
      );
      if (!consent) {
        toast.info('Стан збережено. Натисніть «Перерозпізнати» коли мережа покращиться', {
          description: partialNote,
        });
        return;
      }
      // Адвокат явно обрав Claude Vision
      const tId2 = toast.info('Розпізнавання через Claude Vision...', { persistent: true });
      try {
        ocrResult = await tryProvider({ forceProvider: 'claudeVision' });
        toast.dismiss(tId2);
      } catch (e2) {
        toast.dismiss(tId2);
        const code2 = e2.code || 'UNKNOWN';
        toast.error('Claude Vision також не зміг розпізнати', {
          description: ocrService.localizeOcrError(code2),
        });
        return;
      }
    } else if (ocrErr) {
      // UNSUPPORTED / AUTH / QUOTA — без fallback, точкові повідомлення
      const code = ocrErr.code || 'UNKNOWN';
      if (code === 'UNSUPPORTED') {
        toast.error('Цей формат не підтримується для OCR', {
          description: 'Документ збережено у форматі оригіналу.',
        });
      } else if (code === 'AUTH') {
        toast.error('Помилка доступу до OCR сервісу', {
          description: 'Зверніться до адміністратора.',
        });
      } else if (code === 'QUOTA') {
        toast.error('Вичерпано ліміт Document AI', {
          description: 'Спробуйте за хвилину.',
        });
      } else {
        toast.error('Не вдалось розпізнати', {
          description: ocrService.localizeOcrError(code),
        });
      }
      return;
    }

    // Успіх — повідомляємо і оновлюємо документ.
    // TASK 4 §7.1 (повна відмова від .txt): scanned → layout записано
    // (layoutWritten=true, «Точний» читає layout). searchable (pdfjsLocal) →
    // текст у текстовому шарі самого PDF, окремий артефакт НЕ потрібен —
    // дістається на вимогу (getDocumentText/extractTextLayer). Обидва — успіх,
    // не збій кеша (хибний warning прибрано).
    if (!silentSuccess) {
      if (ocrResult?.layoutWritten) {
        toast.success('Текст розпізнано і збережено');
      } else {
        toast.success('Текст розпізнано');
      }
    }

    // lastOcrAt + documentNature (як було)
    if (onExecuteAction && ocrResult?.text && ocrResult.text.trim().length > 0 && doc) {
      const finalNature = ocrResult.provider === 'pdfjsLocal' ? 'searchable' : 'scanned';
      const fields = { lastOcrAt: new Date().toISOString() };
      if (finalNature !== doc.documentNature) fields.documentNature = finalNature;
      try {
        await onExecuteAction('dossier_agent', 'update_document', {
          caseId,
          documentId: doc.id,
          fields,
        });
      } catch (e) {
        console.warn('[runOcrWithRetryUI] update_document failed:', e?.message || e);
      }
    } else if (onExecuteAction && doc) {
      try {
        await onExecuteAction('dossier_agent', 'update_document', {
          caseId,
          documentId: doc.id,
          fields: { lastOcrAt: new Date().toISOString() },
        });
      } catch (e) {
        console.warn('[runOcrWithRetryUI] update_document lastOcrAt failed:', e?.message || e);
      }
    }
    return ocrResult;
  }

  // ── handleCreateContext — вкладка «Огляд», кнопка «Створити контекст» ──────
  // Тонка обгортка над спільним сервісом contextGenerator.generateCaseContext
  // (TASK 2). Тут лишаються ТІЛЬКИ UI-обовʼязки: React-стан
  // (contextMsg/contextLoading), інтерактивні розвилки (replace existing,
  // OAuth consent) і маппінг результату сервісу у toast'и. Сама генерація
  // (збір файлів, OCR, prompt, AI-виклик, білінг, save Drive) — у сервісі.
  async function handleCreateContext() {
    if (isCreatingContext) {
      toast.show(messages.context.alreadyRunning());
      return;
    }
    // [BILLING] context_regenerated — важлива дія, окремий звіт.
    try { activityTracker.report('context_regenerated', { caseId: caseData.id, module: MODULES.CASE_DOSSIER, category: 'case_work' }); } catch {}
    setIsCreatingContext(true);
    setContextLoading(true);

    try {
      const token = localStorage.getItem("levytskyi_drive_token");
      const folderId = storageState?.driveFolderId;

      if (!token) { toast.show(messages.drive.notConnected()); return; }
      if (!folderId) { toast.show(messages.drive.folderMissing(caseData.name)); return; }

      // 1. Перевірити існуючий case_context.md — UI-розвилка «Замінити?»
      //    (DP-шлях завжди перезаписує без запиту). Лишається у компоненті.
      setContextMsg("Перевіряю існуючий контекст...");
      const searchRes = await driveRequest(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
          `'${folderId}' in parents and name='case_context.md' and trashed=false`
        )}&fields=files(id,name,modifiedTime)`
      );
      if (searchRes.status === 401) {
        toast.show(messages.drive.tokenExpired());
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
          return;
        }
      }

      // 2. Гарантуємо що subFolders заповнені (legacy справи). ensureSubFolders
      //    пише React-стан (updateCase/setStorageState) → лишається тут.
      setContextMsg("Перевіряю структуру папок...");
      const subFolders = await ensureSubFolders(caseData);
      if (!subFolders?.['01_ОРИГІНАЛИ'] && !subFolders?.['02_ОБРОБЛЕНІ']) {
        toast.show(messages.context.noSubfolders());
        return;
      }

      // 3. Генерація через спільний сервіс. Прогрес → contextMsg.
      const apiKey = localStorage.getItem("claude_api_key");
      const result = await generateCaseContext({
        caseData,
        notes: notesProp,
        folderId,
        subFolders,
        token,
        apiKey,
        onProgress: setContextMsg,
        aiUsageSink: setAiUsage,
      });

      // 4. Маппінг результату сервісу у UX вкладки «Огляд» (поведінка ідентична).
      if (result?.saved) {
        toast.show(messages.context.created(result.stats));
        setContextMsg('');
        try {
          const fresh = await loadCaseContext();
          if (fresh) setCaseContext(fresh);
        } catch (e) { console.log('[CaseContext] refresh after save failed:', e); }
        return;
      }

      const code = result?.error?.code;
      if (code === 'AUTH') {
        // ВСІ OCR-результати AUTH — пропонуємо forceConsentRefresh.
        const goConsent = await systemConfirm(
          'Потрібна повторна авторизація Google для використання OCR. Перепідключити?',
          'OAuth scope'
        );
        if (goConsent) {
          await forceConsentRefresh();
          toast.show(messages.context.authRefreshed());
        } else {
          toast.show(messages.context.cancelled());
        }
        setContextMsg('');
      } else if (code === 'NO_FILES') {
        toast.show(messages.context.noFiles());
        setContextMsg('');
      } else if (code === 'NO_API_KEY') {
        toast.show(messages.context.apiKeyMissing());
        setContextMsg('');
      } else if (code === 'EMPTY') {
        toast.show(messages.context.emptyResult());
        setContextMsg('');
      } else if (code === 'SAVE_FAILED') {
        toast.show(messages.context.saveFailed(result?.error?.message));
        setContextMsg('');
      }

    } catch (err) {
      console.error("Context creation error:", err);
      console.error('[CaseDossier] context error:', err);
      // Раніше тут був захардкоджений текст «Перевірте API ключ» — він
      // показувався на БУДЬ-який виняток (напр. API 400/429/529) і маскував
      // справжню причину. Тепер показуємо реальне err.message (на планшеті
      // консолі немає — це єдиний спосіб для адвоката побачити статус).
      toast.error('Не вдалось створити контекст', {
        description: err?.message
          ? String(err.message).slice(0, 200)
          : 'Невідома помилка. Перевірте API ключ і підключення Drive.',
      });
      setContextMsg('');
    } finally {
      setContextLoading(false);
      setIsCreatingContext(false);
    }
  }

  // ── handleGenerateVariant — згенерувати AI-варіант (Чистий/Конспект) у в'ювері ─
  // V2-B: на вимогу з вкладки перемикача (кнопка «Згенерувати»). Тонка обгортка
  // над ACTION clean_document_text (executeAction → cleanTextService.cleanDocument
  // через adapter) — НУЛЬ дублювання. Кнопка «Згенерувати» сама є свідомим
  // кроком (підтвердження не потрібне, parent §V2-B.2). На успіх оновлюємо
  // selectedDoc.variants[mode] → таб показує свіжий .md. Toast-маппінг результату.
  async function handleGenerateVariant(doc, mode, onStreamDelta) {
    if (!doc?.id) return { success: false, error: 'Документ не вибрано' };
    const wantMode = mode === 'clean' ? 'clean' : 'digest';
    // V2-B2 — onStreamDelta (з в'ювера) прокидаємо у ACTION → ядро стрімить
    // markdown що наростає. Функцію передаємо у params (UI-only, не tool-схема).
    const result = await onExecuteAction('dossier_agent', 'clean_document_text', {
      caseId: caseData.id,
      documentId: doc.id,
      mode: wantMode,
      ...(typeof onStreamDelta === 'function' ? { onStreamDelta } : {}),
    });
    if (result?.success) {
      const cleanedAt = new Date().toISOString();
      setSelectedDoc(prev => {
        if (!prev || prev.id !== doc.id) return prev;
        const prevVariants = (prev.variants && typeof prev.variants === 'object')
          ? prev.variants : { clean: null, digest: null };
        return {
          ...prev,
          textFormat: 'md',
          cleanedAt,
          variants: { ...prevVariants, [wantMode]: cleanedAt },
        };
      });
      const noteCount = (result.attentionNotes || []).length;
      toast.success(wantMode === 'clean' ? 'Чистий згенеровано' : 'Конспект згенеровано', {
        description: noteCount > 0 ? `AI відмітив ${noteCount} місць уваги` : undefined,
      });
    } else if (result?.degraded) {
      toast.warning('Генерацію не завершено — джерела збережено', {
        description: result.warning || 'Спробуйте повторити пізніше',
      });
    } else if (!result?.skipped) {
      toast.error('Не вдалось згенерувати', { description: result?.error || 'Невідома помилка' });
    }
    return result;
  }

  // ── V2-C — підсвітки уваги Чистого (тільки в'ювер, по одному документу) ──────
  // file-контракт для ocrService-швів: id=driveId, NFC-нормалізоване ім'я,
  // subFolders справи (як cleanTextDriveAdapter/TextContent — щоб знайти
  // <base>_<id> за тим самим basename).
  function docFileRef(doc) {
    const rawName = doc?.originalName || doc?.name || '';
    const name = typeof rawName.normalize === 'function' ? rawName.normalize('NFC') : rawName;
    return { id: doc?.driveId, name, subFolders: caseData?.storage?.subFolders };
  }

  // Причини ==міток== уваги з extended (порядок = порядок міток у .clean.md).
  // Помилка/відсутність → []: чип і навігація працюють з самого .clean.md.
  async function handleLoadAttentionNotes(doc) {
    if (!doc?.id) return [];
    try {
      const ext = await documentsExtended.getExtendedForDocument(caseData.id, caseData, doc.id);
      return Array.isArray(ext?.attentionNotes) ? ext.attentionNotes : [];
    } catch {
      return [];
    }
  }

  // «Зняти всі назавжди»: re-save вже-стрипнутого (без ==) .clean.md +
  // очистити extended.attentionNotes. Локальна правка артефакту (без AI, без
  // зміни registry-полів) — Чистий-варіант лишається (variants.clean). Повертає
  // false → в'ювер не оновлює текст (помилка Drive).
  async function handleRemoveAllMarks(doc, strippedMarkdown) {
    const file = docFileRef(doc);
    if (!file.id || !file.subFolders?.['02_ОБРОБЛЕНІ']) {
      toast.warning('Зняття поміток потребує файлу на Drive');
      return false;
    }
    try {
      await ocrService.writeMarkdownArtifact(file, strippedMarkdown, 'clean');
      await documentsExtended.setExtendedForDocument(caseData.id, caseData, doc.id, { attentionNotes: [] });
      toast.success('Помітки знято');
      return true;
    } catch (e) {
      toast.error('Не вдалось зняти помітки', { description: e?.message || String(e) });
      return false;
    }
  }

  // ── DP-тригер: перегенерація case_context.md після обробки документів ──────
  // Естафетна модель (TASK «Естафетний тригер генератора контексту після DP»).
  // Замінила крихкий синхронний тригер, що ловив stale-стан: подія
  // DOCUMENT_BATCH_PROCESSED публікувалась синхронно після add_documents, але
  // слухач читав ще-не-перерендерений caseData → генерація бачила старий список.
  //
  // Тепер у три такти:
  //   3.2 СЛУХАЧ — лише СТАВИТЬ паличку (не генерує). Нова подія перезатирає
  //       попередню (self-heal стале). Ручне додавання/перейменування/видалення
  //       не публікують DOCUMENT_BATCH_PROCESSED → нарис не чіпають.
  //   3.3 ТРИГЕР — useEffect слухає caseData.documents; коли всі expectedDocIds
  //       приземлились → стартує генератор з повного (вже оновленого) SSOT.
  //   3.x ФІНІШ — runDpContextRegen на завершенні (успіх АБО помилка) сам знімає
  //       паличку. ЖОДНОГО таймауту: обробка може йти 10+ хв.
  //
  // Ref-патерн для слухача: підписка одна (mount), актуальний caseId беремо з ref
  // — щоб не перепідписуватись на кожен render і не ловити stale-замикань.
  const dpContextHandlerRef = useRef(null);
  dpContextHandlerRef.current = (payload) => {
    // 3.2 — чистий вирішувач (contextRelay.derivePendingRegen) каже, чи приймати
    // паличку для ПОТОЧНОЇ справи; тут лише фіксуємо її у стані.
    const pending = derivePendingRegen(payload, caseData?.id);
    if (!pending) return;
    setPendingContextRegen(pending);
  };

  useEffect(() => {
    const unsub = eventBus.subscribe(DOCUMENT_BATCH_PROCESSED, (payload) => {
      try { dpContextHandlerRef.current && dpContextHandlerRef.current(payload); }
      catch (e) { console.warn('[CaseDossier] DP context handler error:', e?.message || e); }
    });
    return () => { try { unsub && unsub(); } catch {} };
  }, []);

  // 3.x — генератор підхоплює паличку, біжить, на фініші викидає. Винесене тіло
  // старого синхронного хендлера, але з гарантовано ОНОВЛЕНИМ caseData.documents
  // (ефект нижче спрацював ПІСЛЯ ре-рендеру з новими документами).
  //
  // [BILLING] Свідомо НЕ репортимо context_regenerated (на відміну від кнопкового
  // handleCreateContext): DP-естафетна генерація — автоматичне продовження обробки,
  // а не окрема дія адвоката. Токени і так пишуться у ai_usage[] через aiUsageSink;
  // дублювати білінг не треба (рішення §6 TASK).
  async function runDpContextRegen(pending) {
    setIsCreatingContext(true);
    setContextLoading(true);
    try {
      const token = localStorage.getItem("levytskyi_drive_token");
      const folderId = storageState?.driveFolderId;
      if (!token || !folderId) {
        toast.show({ variant: 'warning', title: 'Нарис не оновлено', description: 'Drive не підключено або у справи немає папки.' });
        return;
      }
      const subFolders = await ensureSubFolders(caseData);
      if (!subFolders?.['01_ОРИГІНАЛИ'] && !subFolders?.['02_ОБРОБЛЕНІ']) {
        toast.show({ variant: 'warning', title: 'Нарис не оновлено', description: 'Не знайдено папок 01_ОРИГІНАЛИ / 02_ОБРОБЛЕНІ.' });
        return;
      }
      toast.show({ variant: 'info', title: 'Оновлюю нарис справи…', description: 'Document Processor освіжає case_context.md.' });
      const apiKey = localStorage.getItem("claude_api_key");
      const result = await generateCaseContext({
        caseData,
        notes: notesProp,
        folderId,
        subFolders,
        token,
        apiKey,
        onProgress: () => {},   // DP-шлях ненавʼязливий — без contextMsg-спаму
        aiUsageSink: setAiUsage,
      });
      if (result?.saved) {
        // #3 — окремий сигнал «нарис оновлено» (не плутати з DP-тостом
        // «Оброблено N документів» — це різні події: нарізка ≠ контекст).
        toast.show(messages.context.updated(result.stats));
        try {
          const fresh = await loadCaseContext();
          if (fresh) setCaseContext(fresh);
        } catch (e) { console.log('[CaseContext] DP refresh failed:', e); }
      } else {
        // Реальні помилки генерації — чесний тост (на планшеті консолі немає).
        // NO_FILES після приземлення документів теоретично неможливий (усі
        // expectedDocIds мають driveId), але лишаємо обробку про всяк випадок.
        const code = result?.error?.code;
        const reason = {
          NO_FILES: 'У справі немає документів з файлами на Drive.',
          NO_API_KEY: 'Не задано API ключ Claude.',
          AUTH: 'Потрібна повторна авторизація Google (OCR).',
          EMPTY: 'Claude не повернув результат.',
          SAVE_FAILED: 'Не вдалось зберегти case_context.md на Drive.',
        }[code] || (result?.error?.message ? String(result.error.message).slice(0, 200) : 'Невідома причина.');
        console.warn('[CaseDossier] DP context regen skipped:', code);
        toast.show({ variant: 'warning', title: 'Нарис справи не оновлено', description: reason });
      }
    } catch (err) {
      console.error('[CaseDossier] DP context regen error:', err);
      toast.error('Помилка оновлення нарису', { description: err?.message ? String(err.message).slice(0, 200) : 'Невідома помилка.' });
    } finally {
      // Генератор «викинув паличку на фініші» — успіх чи помилка, без хвостів.
      setPendingContextRegen(null);
      setContextLoading(false);
      setIsCreatingContext(false);
    }
  }

  // 3.3 — «місце, що кричить»: коли паличка стоїть і всі expectedDocIds реально
  // приземлились у caseData.documents — стартуємо генерацію. Не на будь-яку зміну
  // метаданих (перейменування/видалення/ручне додавання), а саме під естафету DP.
  useEffect(() => {
    if (!shouldStartContextRegen({
      pendingContextRegen,
      caseId: caseData?.id,
      documents: caseData?.documents,
      isCreatingContext,
    })) return;
    runDpContextRegen(pendingContextRegen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseData?.documents, pendingContextRegen, isCreatingContext]);

  // Agent panel state (agentMessages — вище, біля caseContext)
  const [agentOpen, setAgentOpen] = useState(true);
  const [agentWidth, setAgentWidth] = useState(() => Math.min(500, Math.max(280, Math.round(window.innerWidth * 0.35))));
  const [agentInput, setAgentInput] = useState('');
  const [agentLoading, setAgentLoading] = useState(false);
  const agentDragRef = useRef(false);


  // Materials resizer state
  const [matWidth, setMatWidth] = useState(280);
  const matDragRef = useRef(false);

  // Materials panel collapse state — окрема логіка для лівої панелі і агента.
  // Зберігається в localStorage щоб адвокат повертався до того ж стану.
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(() => {
    try { return localStorage.getItem('materials_left_panel_collapsed') === '1'; }
    catch { return false; }
  });
  const [agentPanelCollapsed, setAgentPanelCollapsed] = useState(() => {
    try { return localStorage.getItem('materials_agent_panel_collapsed') === '1'; }
    catch { return false; }
  });
  const [treeExpanded, setTreeExpanded] = useState(() => {
    try { return localStorage.getItem('materials_tree_expanded') === '1'; }
    catch { return false; }
  });
  // memoized попередній стан лівої — щоб повертати після закриття агента.
  const leftPanelPrevRef = useRef(false);

  useEffect(() => {
    try { localStorage.setItem('materials_left_panel_collapsed', leftPanelCollapsed ? '1' : '0'); } catch {}
  }, [leftPanelCollapsed]);
  useEffect(() => {
    try { localStorage.setItem('materials_agent_panel_collapsed', agentPanelCollapsed ? '1' : '0'); } catch {}
  }, [agentPanelCollapsed]);
  useEffect(() => {
    try { localStorage.setItem('materials_tree_expanded', treeExpanded ? '1' : '0'); } catch {}
  }, [treeExpanded]);

  // Архів матеріалів — режим перегляду архівних документів і batch-операцій.
  // Вибір архіву тепер живе всередині ArchiveView через спільний useSelection
  // (TASK bulk_delete_unify) — окремий state тут не потрібен.
  const [showArchived, setShowArchived] = useState(false);

  // Модалка видалення документа з Viewer'а.
  const [deleteDocOpen, setDeleteDocOpen] = useState(false);
  const [docPendingDelete, setDocPendingDelete] = useState(null);

  const handleCreateDriveStructure = async () => {
    const token = localStorage.getItem("levytskyi_drive_token");
    if (!token) { toast.show(messages.drive.notConnected()); return; }

    setCreatingStructure(true);
    try {
      const caseName = `${caseData.name}_${caseData.case_no || caseData.id}`.replace(/[/\s\\:*?"<>|]+/g, "_");
      const { caseFolderId, caseFolderName, subFolders } = await createCaseStructure(caseName, token);
      const newStorage = {
        driveFolderId: caseFolderId,
        driveFolderName: caseFolderName,
        subFolders,
        localFolderPath: null,
        lastSyncAt: new Date().toISOString(),
      };
      updateCase(caseData.id, "storage", newStorage);
      setStorageState(newStorage);
      toast.show(messages.drive.structureCreated(caseFolderName));
    } catch (e) {
      console.error('[CaseDossier] create structure error:', e);
      toast.show(messages.drive.folderError());
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
  const allDocuments = caseData.documents || [];
  // Активні документи (без архівних) — для дерева/реєстру і badge "Матеріали".
  const documents = allDocuments.filter(d => d.status !== 'archived');
  const archivedDocuments = allDocuments.filter(d => d.status === 'archived');

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

  // Мультивибір у вкладці Реєстр — спільний useSelection (TASK bulk_delete_unify).
  // allIds синхронізується з фільтрами: документ, що випав з filteredDocs,
  // автоматично виходить із вибору (логіка хука).
  const registrySel = useSelection(filteredDocs.map(d => d.id));

  const categoryLabel = {
    civil: "Цивільна", criminal: "Кримінальна",
    military: "Військова", administrative: "Адміністративна"
  }[caseData.category] || caseData.category;

  const statusLabel = { active: "Активна", paused: "Призупинена", closed: "Закрита" }[caseData.status] || caseData.status;
  const statusColor = { active: "var(--color-success)", paused: "var(--color-warning)", closed: "var(--color-text-3)" }[caseData.status] || "var(--color-text-3)";

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

  // Auto-collapse лівої при відкритті агента, відновлення при закритті.
  // Користувач явно натиснув "Агент" → ховаємо ліву щоб дати документу
  // більше місця. Коли закривається — повертаємо попередній стан лівої.
  useEffect(() => {
    if (agentOpen && !agentPanelCollapsed) {
      leftPanelPrevRef.current = leftPanelCollapsed;
      setLeftPanelCollapsed(true);
    } else if (!agentOpen) {
      // Повертаємо попередній стан лівої тільки якщо ми її автоматично згорнули.
      // Якщо адвокат сам розгорнув ліву поки агент був видимим — leftPanelCollapsed
      // вже false і setLeft(false) нічого не змінить.
      if (leftPanelPrevRef.current === false) {
        setLeftPanelCollapsed(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentOpen]);

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

    // Для legacy справ (створених до Phase 3): caseData.storage.subFolders
    // може бути порожній. ensureSubFolders дозаповнить його з Drive і
    // оновить state. Захищене try/catch — кеш/ensure не критичний для аплоаду.
    let subFolders = cData.storage?.subFolders;
    if (!subFolders?.['01_ОРИГІНАЛИ']) {
      try {
        const refreshed = await ensureSubFolders(cData);
        if (refreshed) subFolders = refreshed;
      } catch (e) {
        console.warn('[uploadFileLocal] ensureSubFolders failed:', e?.message || e);
      }
    }

    // Пріоритет: 01_ОРИГІНАЛИ → root папки справи → cData.driveFolderId (legacy).
    // Логування у консоль показує адвокату ДЕ опинився файл: якщо
    // subFolders.01_ОРИГІНАЛИ є — пишемо туди (стандарт), якщо ні — fallback на
    // root з warning у консолі. Раніше fallback відбувався тихо: адвокат
    // шукав PDF у 01_ОРИГІНАЛИ і не знаходив, бо файл лежав у root папки
    // справи (subFolders неповний після ensureSubFolders).
    let targetFolderId = subFolders?.['01_ОРИГІНАЛИ'];
    let targetFolderLabel = '01_ОРИГІНАЛИ';
    if (!targetFolderId) {
      targetFolderId = cData.storage?.driveFolderId || cData.driveFolderId;
      targetFolderLabel = '(root case folder, 01_ОРИГІНАЛИ subFolder ID missing)';
      console.warn(
        '[uploadFileLocal] subFolders.01_ОРИГІНАЛИ не знайдено — fallback на root папку справи. ' +
        'Файл буде НЕ у 01_ОРИГІНАЛИ. Перевір cData.storage.subFolders.'
      );
    }

    if (!targetFolderId) {
      throw new Error('Не знайдено цільову папку Drive для справи (немає subFolders і немає driveFolderId)');
    }
    console.log(`[uploadFileLocal] uploading "${file.name}" (${file.size} bytes) → ${targetFolderLabel} (${targetFolderId})`);

    const metadata = {
      name: file.name,
      ...(targetFolderId ? { parents: [targetFolderId] } : {})
    };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", file);
    const response = await driveRequest(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
      { method: "POST", body: form }
    );
    if (!response.ok) throw new Error(`Drive upload failed: ${response.status}`);
    const data = await response.json();
    console.log(`[uploadFileLocal] uploaded ✓ driveId=${data.id} (folder: ${targetFolderLabel})`);

    // Post-upload verification: read back file metadata (parents, name, size).
    // Раніше upload «успіх» означав тільки що POST повернув 200 + id, але
    // не що Drive дійсно зберіг файл у правильній папці з правильним MIME.
    // Якщо щось «зникало» між POST і реальним розміщенням — адвокат шукав
    // PDF у 01_ОРИГІНАЛИ і не знаходив, але звідки помилка — неясно.
    // Тепер ми верифікуємо явно і логуємо результат.
    try {
      const verify = await driveRequest(
        `https://www.googleapis.com/drive/v3/files/${data.id}?fields=id,name,parents,size,mimeType`
      );
      if (verify.ok) {
        const meta = await verify.json();
        const inExpectedFolder = Array.isArray(meta.parents) && meta.parents.includes(targetFolderId);
        console.log(
          `[uploadFileLocal] verify ✓ name="${meta.name}" parents=${JSON.stringify(meta.parents)} ` +
          `size=${meta.size} mime=${meta.mimeType} inExpectedFolder=${inExpectedFolder}`
        );
        if (!inExpectedFolder) {
          console.warn(
            `[uploadFileLocal] ⚠ файл збережено АЛЕ не у очікуваній папці ${targetFolderLabel} (${targetFolderId}). ` +
            `Реальні parents: ${JSON.stringify(meta.parents)}.`
          );
        }
      } else {
        console.warn(`[uploadFileLocal] verify GET повернув ${verify.status} для driveId=${data.id} — файл може бути недоступний`);
      }
    } catch (verifyErr) {
      console.warn('[uploadFileLocal] verify failed (non-fatal):', verifyErr?.message || verifyErr);
    }

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

  const iconBtn = { background: "none", border: "1px solid var(--color-border)", color: "var(--color-text-2)", padding: "5px 10px", borderRadius: 'var(--radius-sm)', cursor: "pointer", fontSize: 12 };
  const primaryBtn = { background: "var(--color-accent)", color: "#fff", border: "none", padding: "5px 12px", borderRadius: 'var(--radius-sm)', cursor: "pointer", fontSize: 12 };

  function startAgentVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast.show(messages.common.voiceUnsupported()); return; }
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

  // ── АГЕНТ ДОСЬЄ (Tool Use) ─────────────────────────────────────────────────
  function renderAgentPanel() {
    async function sendAgentMessage() {
      if (!agentInput.trim() || agentLoading) return;
      const userMsg = agentInput.trim();
      // [BILLING] dossier agent message.
      try { activityTracker.report('agent_message_dossier', { caseId: caseData.id, module: MODULES.CASE_DOSSIER, category: 'case_work', metadata: { messageLen: userMsg.length } }); } catch {}
      const userTs = new Date().toISOString();
      setAgentInput('');
      const userEntry = { role: 'user', content: userMsg, ts: userTs };
      setAgentMessages(prev => [...prev, userEntry]);
      setAgentLoading(true);

      const apiKey = localStorage.getItem('claude_api_key');
      const systemPrompt = buildAgentSystemPrompt();
      const dossierModel = resolveModel('dossierAgent');

      // Останні 10 повідомлень історії для API (token economy).
      // API вимагає щоб перше повідомлення було user.
      const historyForAPI = agentMessages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content }));
      const firstUserIdx = historyForAPI.findIndex(m => m.role === 'user');
      const cleanHistory = firstUserIdx >= 0 ? historyForAPI.slice(firstUserIdx) : [];
      const initialMessages = [...cleanHistory, { role: 'user', content: userMsg }];

      try {
        const result = await runMultiTurnConversation({
          callAnthropicAPI: async ({ messages, tools, systemPrompt: sp }) => {
            return await callAPIWithRetry({
              model: dossierModel,
              max_tokens: 4000,
              system: sp,
              messages,
              tools
            }, { apiKey });
          },
          initialMessages,
          tools: DOSSIER_AGENT_TOOLS,
          systemPrompt,
          context: {
            agentId: 'dossier_agent',
            executeAction: (agentId, action, params) => onExecuteAction(agentId, action, params),
            caseId: caseData.id,
            model: dossierModel,
            module: MODULES.CASE_DOSSIER,
            operation: 'chat',
            setAiUsage,
          },
          maxTurns: 10
        });

        // [BILLING] activityTracker — один звіт на завершену розмову, не на турн.
        try {
          activityTracker.report('agent_call', {
            caseId: caseData?.id || null,
            module: MODULES.CASE_DOSSIER,
            category: categoryForCase(caseData?.id),
            metadata: {
              agentType: 'dossier_agent',
              operation: 'chat',
              turns: result.turns,
              toolCalls: result.totalToolCalls,
              truncated: result.truncated
            }
          });
        } catch {}

        if (result.errors?.length > 0) {
          console.warn('[dossier_agent] Tool errors:', result.errors);
        }

        const replyText = result.finalText && result.finalText.trim()
          ? result.finalText
          : (result.totalToolCalls > 0
              ? `✓ Виконано ${result.totalToolCalls} ${result.totalToolCalls === 1 ? 'дію' : 'дій'}.`
              : '⚠ Порожня відповідь від агента.');

        const assistantEntry = {
          role: 'assistant',
          content: replyText,
          ts: new Date().toISOString(),
          ...(result.totalToolCalls > 0 ? { toolCalls: result.totalToolCalls } : {}),
          ...(result.truncated ? { truncated: true } : {})
        };
        setAgentMessages(prev => {
          const updated = [...prev, assistantEntry].slice(-50);
          updateCase && updateCase(caseData.id, 'agentHistory', updated);
          saveAgentHistory(updated);
          return updated;
        });
      } catch (err) {
        // callAPIWithRetry додає .userMessage для дружнього показу.
        const friendly = err?.userMessage || `Не вдалось зв'язатись з агентом: ${err?.message || err}`;
        console.error('[dossier_agent] API error:', err);
        const errEntry = {
          role: 'assistant',
          content: `⚠️ ${friendly}`,
          ts: new Date().toISOString()
        };
        setAgentMessages(prev => {
          const updated = [...prev, errEntry].slice(-50);
          updateCase && updateCase(caseData.id, 'agentHistory', updated);
          saveAgentHistory(updated);
          return updated;
        });
      }
      setAgentLoading(false);
    }

    return (
      <>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 14, display: "inline-flex", alignItems: "center" }}><Bot size={ICON_SIZE.md} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{"Агент досьє"}</div>
            <div style={{ fontSize: 10, color: 'var(--color-text-3)' }}>
              {"Sonnet · знає справу"}
              {caseContext && <span style={{ marginLeft: 4, color: 'var(--color-success)', display: 'inline-flex', alignItems: 'center' }} title="Контекст справи створено"><FileText size={ICON_SIZE.xs} /></span>}
            </div>
            <div style={{ fontSize: 10, color: agentMessages.length > 0 ? 'var(--color-success)' : 'var(--color-text-3)', marginTop: 2 }}>
              {agentMessages.length > 0
                ? `📂 Завантажено ${agentMessages.length} повідомлень з попередньої розмови`
                : "Нова розмова"}
            </div>
          </div>
          <button onClick={() => setConfirmClearOpen(true)} style={{ background: 'none', border: 'none', color: 'var(--color-text-3)', cursor: 'pointer', fontSize: 10 }}>{"\u002B Нова розмова"}</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {agentMessages.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--color-text-3)', textAlign: 'center', marginTop: 20 }}>
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
                  <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--color-text-3)', margin: '8px 0' }}>
                    {new Date(msg.ts).toLocaleDateString('uk-UA')}
                  </div>
                )}
                <div style={{
                  padding: '8px 10px', borderRadius: 'var(--radius-md)', fontSize: 12, lineHeight: 1.6, maxWidth: '90%',
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  background: msg.role === 'user' ? 'rgba(79,124,255,.2)' : 'var(--color-surface-2)',
                  color: 'var(--color-text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'break-word'
                }}>
                  {msg.content}
                </div>
              </div>
            );
          })}
          {agentLoading && (
            <div style={{ padding: '8px 10px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)', fontSize: 12, color: 'var(--color-text-3)' }}>{"⏳ Думаю..."}</div>
          )}
        </div>
        <div style={{ padding: 8, borderTop: '1px solid var(--color-border)', display: 'flex', gap: 6, flexShrink: 0, alignItems: 'flex-end' }}>
          <textarea
            value={agentInput}
            onChange={e => setAgentInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAgentMessage(); } }}
            placeholder="Запитати агента..."
            rows={2}
            style={{
              flex: 1, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)',
              padding: '6px 8px', borderRadius: 'var(--radius-sm)', fontSize: 12, resize: 'none', outline: 'none', lineHeight: 1.5,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'break-word', fontFamily: 'inherit'
            }}
          />
          {agentRecording ? (
            <>
              <button onClick={cancelAgentVoice} style={{ background: 'none', border: '1px solid rgba(231,76,60,.4)', color: 'var(--color-danger)', padding: '0 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 14, height: 34 }}>{"\u00d7"}</button>
              <button onClick={stopAgentVoice} style={{ background: 'var(--color-success)', border: 'none', color: '#fff', padding: '0 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 14, height: 34 }}>{"\u2713"}</button>
            </>
          ) : (
            <button onClick={startAgentVoice} style={{ background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-2)', padding: '0 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 14, height: 34 }}>{"\ud83c\udfa4"}</button>
          )}
          <button
            onClick={sendAgentMessage}
            disabled={agentLoading || !agentInput.trim()}
            style={{
              background: 'var(--color-accent)', border: 'none', color: '#fff',
              padding: '0 12px', borderRadius: 'var(--radius-sm)', height: 34,
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
            borderRadius: 'var(--radius-md)'
          }}>
            <div style={{
              background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: '20px 24px',
              maxWidth: 300, textAlign: 'center', border: '1px solid var(--color-border)'
            }}>
              <div style={{ fontSize: 14, color: 'var(--color-text)', marginBottom: 16 }}>
                {"Почати нову розмову? Поточна історія буде очищена."}
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button
                  onClick={() => setConfirmClearOpen(false)}
                  style={{
                    padding: '8px 20px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)',
                    background: 'transparent', color: 'var(--color-text-2)', cursor: 'pointer', fontSize: 13
                  }}
                >{"Скасувати"}</button>
                <button
                  onClick={() => {
                    setAgentMessages([]);
                    saveAgentHistory([]); // Очистити історію на Drive
                    setConfirmClearOpen(false);
                  }}
                  style={{
                    padding: '8px 20px', borderRadius: 'var(--radius-sm)', border: 'none',
                    background: 'var(--color-danger)', color: '#fff', cursor: 'pointer', fontSize: 13
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
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', marginBottom: 'var(--space-4)'}}>
          <div style={{ fontSize: 10, color: "var(--color-text-3)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12 }}>{"Інформація про справу"}</div>
          {[
            { label: "Суд", field: "court", value: caseData.court },
            { label: "Номер справи", field: "case_no", value: caseData.case_no },
            { label: "Категорія", field: "category", value: categoryLabel },
            { label: "Наступна дія", field: "next_action", value: caseData.next_action },
          ].map(row => (
            <div key={row.field} style={{ display: "flex", gap: 12, marginBottom: 10, alignItems: "flex-start" }}>
              <div style={{ width: 130, fontSize: 11, color: "var(--color-text-3)", flexShrink: 0, paddingTop: 2 }}>{row.label}</div>
              <div
                contentEditable
                suppressContentEditableWarning
                onBlur={e => {
                  if (!updateCase) return;
                  const raw = e.target.innerText.trim();
                  const CATEGORY_MAP = {
                    "Цивільна": "civil",
                    "Кримінальна": "criminal",
                    "Адміністративна": "administrative",
                    "Військова": "military",
                  };
                  const value = row.field === "category" ? (CATEGORY_MAP[raw] || raw) : raw;
                  updateCase(caseData.id, row.field, value);
                }}
                onFocus={e => { e.target.style.borderColor = "var(--color-accent)"; }}
                onBlurCapture={e => e.target.style.borderColor = "transparent"}
                style={{ flex: 1, fontSize: 12, color: row.value ? "var(--color-text)" : "var(--color-text-3)", outline: "none", minHeight: 20, padding: "2px 6px", borderRadius: 'var(--radius-xs)', border: "1px solid transparent", cursor: "text", transition: "border-color .15s" }}
              >{row.value || "\u2014"}</div>
            </div>
          ))}

          {/* СЕКЦІЯ ЗАСІДАННЯ */}
          <div style={{ marginTop: 16, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "var(--color-text-3)" }}>{"Засідання"}</div>
              <button
                onClick={() => setAddHearingOpen(true)}
                style={{ background: "transparent", border: "1px dashed var(--color-border)", color: "var(--color-text-2)", borderRadius: 'var(--radius-sm)', padding: "3px 9px", fontSize: 11, cursor: "pointer" }}
              >{"+ Додати"}</button>
            </div>
            {(caseData.hearings || [])
              .slice()
              .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
              .map(h => {
                const today = new Date().toISOString().split("T")[0];
                const isPast = (h.date || "") < today;
                return (
                  <div key={h.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", background: "var(--color-surface-2)", borderRadius: 'var(--radius-sm)', marginBottom: 4, opacity: isPast ? 0.55 : 1, borderLeft: `3px solid ${isPast ? "var(--color-text-3)" : "var(--color-accent)"}` }}>
                    <div style={{ display: "flex", gap: 6, flex: 1, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "var(--color-text)", fontVariantNumeric: "tabular-nums" }}>
                        {h.date || "—"}{h.time ? `  ${h.time}` : ""}
                      </span>
                      <button
                        onClick={() => {
                          setAddHearingOpen({ hearingId: h.id, date: h.date || "", time: h.time || "", duration: h.duration });
                        }}
                        style={{ background: "transparent", border: "none", color: "var(--color-text-2)", cursor: "pointer", fontSize: 11, padding: "0 4px" }}
                        title="Редагувати дату/час"
                      >{"✏️"}</button>
                    </div>
                    <span style={{ fontSize: 10, color: "var(--color-text-3)" }}>{isPast ? "минуле" : (h.status || "scheduled")}</span>
                    <button
                      onClick={() => {
                        if (!onExecuteAction) return;
                        onExecuteAction("dossier_agent", "delete_hearing", {
                          caseId: caseData.id, hearingId: h.id
                        });
                      }}
                      style={{ background: "transparent", border: "none", color: "var(--color-text-2)", cursor: "pointer", fontSize: 14, padding: "0 4px" }}
                      title="Видалити засідання"
                    >{"\u{1F5D1}"}</button>
                  </div>
                );
              })
            }
            {(!caseData.hearings || caseData.hearings.length === 0) && (
              <div style={{ fontSize: 12, color: "var(--color-text-3)", fontStyle: "italic", padding: "4px 0" }}>{"Засідань немає"}</div>
            )}
          </div>

          {/* СЕКЦІЯ ДЕДЛАЙНИ */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "var(--color-text-3)" }}>{"Дедлайни"}</div>
              <button
                onClick={() => {
                  setNewDeadline({ name: '', date: '' });
                  setAddDeadlineOpen(true);
                }}
                style={{ background: "transparent", border: "1px dashed var(--color-border)", color: "var(--color-text-2)", borderRadius: 'var(--radius-sm)', padding: "3px 9px", fontSize: 11, cursor: "pointer" }}
              >{"+ Додати"}</button>
            </div>
            {(caseData.deadlines || [])
              .slice()
              .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
              .map(d => {
                const today = new Date().toISOString().split("T")[0];
                const isPast = (d.date || "") < today;
                return (
                  <div key={d.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", background: "var(--color-surface-2)", borderRadius: 'var(--radius-sm)', marginBottom: 4, opacity: isPast ? 0.55 : 1, borderLeft: `3px solid ${isPast ? "var(--color-text-3)" : "var(--color-warning)"}` }}>
                    <input
                      type="text"
                      defaultValue={d.name || ""}
                      placeholder="Назва"
                      onBlur={e => {
                        const v = e.target.value.trim();
                        if (v === (d.name || "") || !onExecuteAction) return;
                        onExecuteAction("dossier_agent", "update_deadline", {
                          caseId: caseData.id, deadlineId: d.id,
                          name: v, date: d.date
                        });
                      }}
                      style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-text)", borderRadius: 'var(--radius-xs)', padding: "3px 6px", fontSize: 12, flex: 1, minWidth: 80 }}
                    />
                    <div style={{ minWidth: 140 }}>
                      <DatePicker
                        value={d.date || ""}
                        onChange={v => {
                          if (!v || v === d.date || !onExecuteAction) return;
                          onExecuteAction("dossier_agent", "update_deadline", {
                            caseId: caseData.id, deadlineId: d.id,
                            name: d.name, date: v
                          });
                        }}
                      />
                    </div>
                    <button
                      onClick={() => {
                        if (!onExecuteAction) return;
                        onExecuteAction("dossier_agent", "delete_deadline", {
                          caseId: caseData.id, deadlineId: d.id
                        });
                      }}
                      style={{ background: "transparent", border: "none", color: "var(--color-text-2)", cursor: "pointer", fontSize: 14, padding: "0 4px" }}
                      title="Видалити дедлайн"
                    >{"\u{1F5D1}"}</button>
                  </div>
                );
              })
            }
            {(!caseData.deadlines || caseData.deadlines.length === 0) && (
              <div style={{ fontSize: 12, color: "var(--color-text-3)", fontStyle: "italic", padding: "4px 0" }}>{"Дедлайнів немає"}</div>
            )}
          </div>

          {/* Нотатки до справи */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "var(--color-text-3)", marginBottom: 4 }}>{"Нотатки до справи"}</div>
            {(() => {
              const pinned = caseNotes.filter(n => isPinned(n.id));
              if (pinned.length > 0) {
                return (
                  <div style={{
                    background: "var(--color-surface)", borderRadius: 'var(--radius-sm)', padding: "8px 10px",
                    fontSize: 12, color: "var(--color-text)", lineHeight: 1.6,
                    borderLeft: "3px solid var(--color-accent)"
                  }}>
                    {pinned.map((note, i) => (
                      <div key={note.id || i} style={{
                        marginBottom: i < pinned.length - 1 ? 8 : 0,
                        paddingBottom: i < pinned.length - 1 ? 8 : 0,
                        borderBottom: i < pinned.length - 1 ? "1px solid var(--color-border)" : "none"
                      }}>
                        <div style={{ fontSize: 10, color: "var(--color-text-3)", marginBottom: 2 }}>
                          <Pin size={ICON_SIZE.xs} style={{ marginRight: 4, verticalAlign: 'middle' }} />{(note.ts || note.createdAt) ? new Date(note.ts || note.createdAt).toLocaleDateString("uk-UA") : ""}
                        </div>
                        <div>{String(note.text || "")}</div>
                      </div>
                    ))}
                  </div>
                );
              }
              return (
                <div style={{ fontSize: 12, color: "var(--color-text-3)", fontStyle: "italic", padding: "8px 10px" }}>
                  {"Закріпіть нотатку 📌 зі списку нижче"}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Сховище Drive */}
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', marginBottom: 'var(--space-4)'}}>
          <div style={{ fontSize: 10, color: "var(--color-text-3)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12 }}>{"Сховище"}</div>
          {/* Стан папки справи на Drive: 'missing'|'trashed'|'alive'|'unknown'.
              missing → одна кнопка «Створити структуру».
              trashed → одна кнопка «Перестворити» з warning-плашкою (стара у кошику).
              alive   → назва папки + «Відкрити».
              unknown → плашка перевірки (рідко, тимчасова мережа). */}
          {folderStatus === 'missing' || folderStatus === 'trashed' ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {folderStatus === 'trashed' && (
                <span style={{ color: "var(--color-danger)", fontSize: 12 }}>
                  Поточна папка у кошику Drive
                </span>
              )}
              <button
                onClick={handleCreateDriveStructure}
                disabled={creatingStructure}
                title={folderStatus === 'trashed'
                  ? "Створює нову папку справи на Drive (стара у кошику). Поточне посилання «Відкрити» веде в кошик — натисни Перестворити щоб отримати робочу структуру."
                  : "Створює нову папку справи на Drive з повною структурою (01_ОРИГІНАЛИ … 05_ЗОВНІШНІ)."}
                style={{
                  background: creatingStructure ? "var(--color-surface-2)" : "var(--color-accent-hover)",
                  color: "#fff", border: "none", borderRadius: 'var(--radius-sm)',
                  padding: "8px 16px", cursor: creatingStructure ? "wait" : "pointer", fontSize: 13,
                }}
              >
                {creatingStructure
                  ? (folderStatus === 'trashed' ? "⏳ Перестворюю..." : "⏳ Створюю...")
                  : (folderStatus === 'trashed'
                      ? <>↻ Перестворити структуру</>
                      : <><Folder size={ICON_SIZE.sm} style={{ verticalAlign: 'middle', marginRight: 6 }} />Створити структуру на Drive</>)}
              </button>
            </div>
          ) : folderStatus === 'alive' ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ color: "var(--color-success)", fontSize: 13 }}>
                <Cloud size={ICON_SIZE.xs} style={{ verticalAlign: 'middle', marginRight: 4 }} />{storageState.driveFolderName || "Drive папка"}
              </span>
              <button
                onClick={() => window.open(`https://drive.google.com/drive/folders/${storageState.driveFolderId}`, "_blank")}
                style={{
                  background: "none", border: "1px solid var(--color-border)", borderRadius: 'var(--radius-sm)',
                  padding: "4px 10px", color: "var(--color-text-2)", cursor: "pointer", fontSize: 12,
                }}
              ><Link2 size={ICON_SIZE.xs} style={{ verticalAlign: 'middle', marginRight: 4 }} />Відкрити</button>
            </div>
          ) : (
            // 'unknown' — Drive ще перевіряється або тимчасова помилка мережі.
            // Показуємо нейтральну плашку щоб адвокат знав що UI ще не визначив стан.
            <div style={{ color: "var(--color-text-3)", fontSize: 12, fontStyle: "italic" }}>
              Перевіряю стан папки на Drive…
            </div>
          )}
          {storageMsg && (
            <div style={{
              marginTop: 6, fontSize: 12,
              color: storageMsg.startsWith("\u2705") ? "var(--color-success)" : "var(--color-danger)",
            }}>
              {storageMsg}
            </div>
          )}
        </div>

        {/* Контекст справи */}
        {storageState?.driveFolderId && (
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', marginBottom: 'var(--space-4)'}}>
            <div style={{ fontSize: 10, color: "var(--color-text-3)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12 }}>{"Контекст справи"}</div>
            <div style={{ fontSize: 12, color: "var(--color-text-2)", marginBottom: 10 }}>
              {"Автоматичний аналіз всіх документів справи — огляд, сторони, хронологія, слабкі місця."}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                disabled={contextLoading}
                onClick={handleCreateContext}
                style={{
                  background: contextLoading ? "var(--color-border)" : "rgba(79,124,255,.12)",
                  color: contextLoading ? "var(--color-text-3)" : "var(--color-accent)",
                  border: "none", borderRadius: 'var(--radius-sm)', padding: "8px 16px",
                  fontSize: 12, fontWeight: 600, cursor: contextLoading ? "wait" : "pointer"
                }}
              >
                {contextLoading ? "Створюю..." : "Створити контекст"}
              </button>
              {/* V2-C — масову очистку текстів прибрано (Огляд = тільки Точний;
                  AI-режими — у в'ювері по одному документу на вимогу). */}
            </div>
            {contextMsg && (
              <div style={{ marginTop: 8, fontSize: 11, color: contextMsg.startsWith("Помилка") ? "var(--color-danger)" : "var(--color-text-2)" }}>
                {contextMsg}
              </div>
            )}
          </div>
        )}

        {/* Провадження */}
        {proceedings.length > 0 && (
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', marginBottom: 'var(--space-4)'}}>
            <div style={{ fontSize: 10, color: "var(--color-text-3)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>{"Провадження"}</div>
            {proceedings.map(proc => (
              <div key={proc.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--color-surface-2)", borderRadius: 'var(--radius-sm)', marginBottom: 6, borderLeft: `3px solid ${PROC_COLORS[proc.type] || "var(--color-border)"}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{proc.title}</div>
                  <div style={{ fontSize: 10, color: "var(--color-text-3)", marginTop: 2 }}>{proc.court}</div>
                  {proc.parentProcId && <div style={{ fontSize: 10, color: "var(--color-text-3)", marginTop: 2 }}>{"\u2190 з "}{proceedings.find(p => p.id === proc.parentProcId)?.title}</div>}
                </div>
                <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 3, fontWeight: 600, background: proc.status === "active" ? "rgba(46,204,113,.15)" : "rgba(243,156,18,.15)", color: proc.status === "active" ? "var(--color-success)" : "var(--color-warning)" }}>
                  {proc.status === "active" ? "Активне" : "На паузі"}
                </span>
              </div>
            ))}
            <button
              onClick={() => setProcModalOpen(true)}
              style={{ width: '100%', padding: '7px', background: 'none', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-3)', cursor: 'pointer', fontSize: 12, marginTop: 6 }}
            >+ Додати провадження</button>
          </div>
        )}

        {/* Нотатки */}
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', marginBottom: 'var(--space-4)'}}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "var(--color-text-3)", textTransform: "uppercase", letterSpacing: ".06em" }}>{"Нотатки по справі"}</div>
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
            <div style={{ fontSize: 12, color: "var(--color-text-3)" }}>{"Нотаток поки немає"}</div>
          ) : (notesExpanded ? caseNotes : [pinnedNote]).filter(Boolean).map(note => (
            <div key={note.id} style={{
              padding: "8px 10px", borderRadius: 'var(--radius-sm)', marginBottom: 6, fontSize: 12, color: "var(--color-text-2)", lineHeight: 1.6,
              background: isPinned(note.id) ? "rgba(79,124,255,0.08)" : "var(--color-surface-2)",
              borderLeft: isPinned(note.id) ? "2px solid var(--color-accent)" : "2px solid transparent",
              transition: "all 0.2s"
            }}>
              {editingNoteId === note.id ? (
                <>
                  <textarea
                    value={editingNoteText}
                    onChange={e => setEditingNoteText(e.target.value)}
                    style={{ width: "100%", minHeight: 80, background: "var(--color-bg)", color: "var(--color-text)", border: "1px solid var(--color-accent)", borderRadius: 'var(--radius-sm)', padding: 8, fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <button onClick={() => { onUpdateNote && onUpdateNote(note.id, { text: editingNoteText }); setEditingNoteId(null); setEditingNoteText(""); }} style={{ background: "var(--color-accent-hover)", color: "#fff", border: "none", borderRadius: 'var(--radius-sm)', padding: "4px 12px", cursor: "pointer", fontSize: 12 }}>
                      <Check size={ICON_SIZE.xs} style={{ verticalAlign: 'middle', marginRight: 4 }} />Зберегти
                    </button>
                    <button onClick={() => setEditingNoteId(null)} style={{ background: "var(--color-surface-2)", color: "var(--color-text-2)", border: "none", borderRadius: 'var(--radius-sm)', padding: "4px 12px", cursor: "pointer", fontSize: 12 }}>
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
                      style={{ background: "none", border: "none", color: "var(--color-text-3)", cursor: "pointer", fontSize: 12, padding: "2px 4px", flexShrink: 0 }}
                     aria-label="Редагувати"><Edit size={ICON_SIZE.sm} /></button>
                    <button
                      onClick={() => onDeleteNote && onDeleteNote(note.id)}
                      title="Видалити"
                      style={{ background: "none", border: "none", color: "var(--color-text-3)", cursor: "pointer", fontSize: 12, padding: "2px 4px", flexShrink: 0 }}
                     aria-label="Видалити"><Trash2 size={ICON_SIZE.sm} /></button>
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
                            opacity: isNotePinned ? 1 : 0.4,
                            color: isNotePinned ? 'var(--color-danger)' : 'var(--color-text-3)',
                            transition: 'transform 0.2s ease, opacity 0.2s ease, color 0.2s ease'
                          }}
                         aria-label="Закріпити"><Pin size={ICON_SIZE.sm} /></button>
                      );
                    })()}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--color-text-3)", marginTop: 4 }}>{(note.ts || note.createdAt) ? new Date(note.ts || note.createdAt).toLocaleDateString("uk-UA") : ""}</div>
                </>
              )}
            </div>
          ))}
        </div>

      </div>
    );
  }

  // ── МАТЕРІАЛИ ──────────────────────────────────────────────────────────────
  function renderMaterials() {
    const archivedCount = archivedDocuments.length;
    const leftClass = [
      'materials-left-panel',
      leftPanelCollapsed && 'materials-left-panel--collapsed',
      !leftPanelCollapsed && treeExpanded && matMode === 'tree' && 'materials-left-panel--tree-expanded',
    ].filter(Boolean).join(' ');
    const leftStyle = leftPanelCollapsed
      ? {}
      : (treeExpanded && matMode === 'tree' ? {} : { width: matWidth });

    return (
      <div className="materials-layout">

        {/* Ліва панель */}
        <div className={leftClass} style={leftStyle}>

          {/* Кнопка-стрілочка колапсу/розкриття */}
          <button
            type="button"
            className="materials-collapse-toggle"
            onClick={() => setLeftPanelCollapsed(c => !c)}
            aria-label={leftPanelCollapsed ? 'Розгорнути панель' : 'Згорнути панель'}
            title={leftPanelCollapsed ? 'Розгорнути панель' : 'Згорнути панель'}
          >
            {leftPanelCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>

          {/* Перемикач Дерево / Реєстр + бар з керуванням архівом / розширенням */}
          <div className="materials-mode-bar">
            {[["tree", GitBranch, "Дерево"], ["registry", ClipboardList, "Реєстр"]].map(([id, Ic, label]) => (
              <button key={id} onClick={() => setMatMode(id)} style={{ flex: 1, padding: 8, border: "none", background: "none", color: matMode === id ? "var(--color-text)" : "var(--color-text-2)", cursor: "pointer", fontSize: 12, borderBottom: `2px solid ${matMode === id ? "var(--color-accent)" : "transparent"}`, fontWeight: matMode === id ? 500 : 400, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Ic size={ICON_SIZE.sm} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="materials-mode-bar" style={{ borderBottom: '1px solid var(--color-border)' }}>
            {matMode === 'tree' && !showArchived && (
              <button
                type="button"
                className={`materials-tree-expand-toggle ${treeExpanded ? 'materials-tree-expand-toggle--active' : ''}`}
                onClick={() => setTreeExpanded(v => !v)}
                title={treeExpanded ? 'Стандартна ширина' : 'Розширити дерево'}
              >
                {treeExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                <span>{treeExpanded ? 'Звузити' : 'Розширити'}</span>
              </button>
            )}
            <span className="materials-mode-bar__filler" />
            <button
              type="button"
              className={`materials-archive-toggle ${showArchived ? 'materials-archive-toggle--active' : ''}`}
              onClick={() => setShowArchived(v => !v)}
              title="Архів матеріалів"
            >
              <Archive size={12} />
              <span>Архів</span>
              <span className="materials-archive-toggle__count">{archivedCount}</span>
            </button>
          </div>
          {!showArchived && (
          <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
            <button
              onClick={() => setDocModalOpen(true)}
              style={{ background: 'var(--color-accent)', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 12, width: '100%' }}
            >+ Додати документ</button>
          </div>
          )}

          {showArchived && (
            <ArchiveView
              archived={archivedDocuments}
              onExit={() => setShowArchived(false)}
              onRestoreOne={async (doc) => {
                if (!onExecuteAction) return;
                const r = await onExecuteAction('dossier_agent', 'restore_documents', {
                  caseId: caseData.id, documentIds: [doc.id],
                });
                if (r?.success) toast.success(`«${doc.name}» відновлено`);
                else toast.error('Не вдалось відновити', { description: r?.error });
              }}
              onRestoreSelected={async (ids) => {
                if (!onExecuteAction || ids.length === 0) return;
                const r = await onExecuteAction('dossier_agent', 'restore_documents', {
                  caseId: caseData.id, documentIds: ids,
                });
                if (r?.success) toast.success(`Відновлено документів: ${r.restored.length}`);
                else toast.error('Не вдалось відновити', { description: r?.error });
              }}
              onDeleteOne={async (doc) => {
                const ok = await systemConfirm(`Видалити «${doc.name}» назавжди? Файл зникне з Drive і реєстру.`);
                if (!ok || !onExecuteAction) return;
                const r = await onExecuteAction('dossier_agent', 'delete_documents', {
                  caseId: caseData.id, documentIds: [doc.id], mode: 'full', _fromUI: true,
                });
                if (r?.success) toast.success(`«${doc.name}» видалено повністю`);
                else toast.error('Не вдалось видалити', { description: r?.error });
              }}
              onDeleteSelected={async (ids) => {
                if (ids.length === 0) return;
                const ok = await systemConfirm(`Видалити назавжди ${ids.length} обраних документів? Файли зникнуть з Drive.`);
                if (!ok || !onExecuteAction) return;
                const r = await onExecuteAction('dossier_agent', 'delete_documents', {
                  caseId: caseData.id, documentIds: ids, mode: 'full', _fromUI: true,
                });
                if (r?.success) toast.success(`Видалено документів: ${r.deleted.length}`);
                else toast.error('Не вдалось видалити', { description: r?.error });
              }}
            />
          )}

          {/* ДЕРЕВО */}
          {!showArchived && matMode === "tree" && (
            <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
              {proceedings.map(proc => {
                const procDocs = documents.filter(d => d.procId === proc.id);
                const indent = proc.parentProcId ? 12 : 0;
                return (
                  <div key={proc.id} style={{ marginBottom: 12, marginLeft: indent }}>
                    {proc.parentProcId && <div style={{ fontSize: 10, color: "var(--color-text-3)", marginBottom: 4, paddingLeft: 4 }}>{"\u2514\u2500"}</div>}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 'var(--radius-sm)', background: "var(--color-surface-2)", borderLeft: `3px solid ${PROC_COLORS[proc.type] || "var(--color-border)"}`, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: PROC_COLORS[proc.type] || "var(--color-text-2)", flex: 1 }}>{proc.title}</span>
                      <span style={{ fontSize: 9, color: "var(--color-text-3)" }}>{procDocs.length}</span>
                    </div>
                    {procDocs.map(doc => (
                      <div key={doc.id} onClick={() => setSelectedDoc(doc)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px 6px 18px", borderRadius: 'var(--radius-sm)', cursor: "pointer", background: selectedDoc?.id === doc.id ? "var(--color-surface-2)" : "transparent", border: `1px solid ${selectedDoc?.id === doc.id ? "var(--color-accent)" : "transparent"}`, marginBottom: 2, transition: "background-color .15s, border-color .15s" }}>
                        <span style={{ fontSize: 13, flexShrink: 0 }}>{doc.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{doc.name}</div>
                          <div style={{ fontSize: 10, color: "var(--color-text-3)" }}>{doc.date}</div>
                        </div>
                        {doc.tags?.includes("key") && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: "rgba(79,124,255,.2)", color: "var(--color-accent)", flexShrink: 0 }}>{"ключовий"}</span>}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* РЕЄСТР з фільтрами */}
          {!showArchived && matMode === "registry" && (
            // transform: translateZ(0) — явна промоція підтреку реєстру (фільтри +
            // бар мультивибору + скрол-список) у власний композитний шар. Без неї
            // Chromium лишав підтрек у неявному/squashed-шарі, чия інвалідація при
            // ре-рендері (клік чекбокса) ламалась, коли внутрішній список був
            // прокручений (scrollTop>0): стале темне полотно (фон панелі,
            // --color-bg) не перемальовувалось і читалось як «чорна штора»
            // (бар+список темніли,
            // кнопки масових дій зникали). Вибір на самому верху (scrollTop 0)
            // інвалідацію не ламав. Remount вкладки лікував, бо створював шар
            // заново — явна промоція дає той самий чистий керований шар без remount.
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", transform: "translateZ(0)" }}>
              <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)", display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>

                {/* Фільтр провадження */}
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  <button onClick={() => setDocFilters(f => ({ ...f, proc: "all" }))} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 'var(--radius-md)', border: "1px solid", borderColor: docFilters.proc === "all" ? "var(--color-accent)" : "var(--color-border)", color: docFilters.proc === "all" ? "var(--color-accent)" : "var(--color-text-2)", background: docFilters.proc === "all" ? "rgba(79,124,255,.08)" : "none", cursor: "pointer" }}>{"Всі"}</button>
                  {proceedings.map(proc => (
                    <button key={proc.id} onClick={() => setDocFilters(f => ({ ...f, proc: f.proc === proc.id ? "all" : proc.id }))} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 'var(--radius-md)', border: "1px solid", borderColor: docFilters.proc === proc.id ? PROC_COLORS[proc.type] : "var(--color-border)", color: docFilters.proc === proc.id ? PROC_COLORS[proc.type] : "var(--color-text-2)", background: docFilters.proc === proc.id ? `${PROC_COLORS[proc.type]}22` : "none", cursor: "pointer" }}>
                      {proc.type === "first" ? "Перша" : proc.type === "appeal" ? "Апеляція" : "Касація"}
                    </button>
                  ))}
                </div>

                {/* Фільтр типу */}
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {["all", "pleading", "motion", "court_act", "evidence", "correspondence"].map(cat => (
                    <button key={cat} onClick={() => setDocFilters(f => ({ ...f, category: cat }))} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 'var(--radius-md)', border: "1px solid", borderColor: docFilters.category === cat ? "var(--color-text-2)" : "var(--color-border)", color: docFilters.category === cat ? "var(--color-text)" : "var(--color-text-3)", background: "none", cursor: "pointer" }}>
                      {cat === "all" ? "Всі типи" : CATEGORY_LABELS[cat]}
                    </button>
                  ))}
                </div>

                {/* Фільтр автора */}
                <div style={{ display: "flex", gap: 3 }}>
                  {["all", "ours", "opponent", "court"].map(auth => (
                    <button key={auth} onClick={() => setDocFilters(f => ({ ...f, author: auth }))} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 'var(--radius-md)', border: "1px solid", borderColor: docFilters.author === auth ? "var(--color-text-2)" : "var(--color-border)", color: docFilters.author === auth ? "var(--color-text)" : "var(--color-text-3)", background: "none", cursor: "pointer" }}>
                      {auth === "all" ? "Всі" : AUTHOR_LABELS[auth]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Мультивибір (TASK bulk_delete_unify) — спільні BulkActionBar +
                  useSelection. Дві дії: «Архівувати обрані» / «Видалити обрані
                  повністю». По одному systemConfirm на дію. */}
              {filteredDocs.length > 0 && (
                <div style={{ padding: "6px 8px", flexShrink: 0 }}>
                  <BulkActionBar
                    total={filteredDocs.length}
                    selectedCount={registrySel.count}
                    allSelected={registrySel.allSelected}
                    someSelected={registrySel.someSelected}
                    onToggleSelectAll={(checked) => (checked ? registrySel.selectAll() : registrySel.clear())}
                  >
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={async () => {
                        const ids = Array.from(registrySel.selectedIds);
                        if (ids.length === 0 || !onExecuteAction) return;
                        const ok = await systemConfirm(`Архівувати ${ids.length} обраних документів?`);
                        if (!ok) return;
                        const r = await onExecuteAction('dossier_agent', 'delete_documents', {
                          caseId: caseData.id, documentIds: ids, mode: 'archive', _fromUI: true,
                        });
                        if (r?.success) { toast.success(`Архівовано документів: ${r.deleted.length}`); registrySel.clear(); }
                        else toast.error('Не вдалось архівувати', { description: r?.error });
                      }}
                    >
                      Архівувати обрані ({registrySel.count})
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={async () => {
                        const ids = Array.from(registrySel.selectedIds);
                        if (ids.length === 0 || !onExecuteAction) return;
                        const ok = await systemConfirm(`Видалити ${ids.length} обраних документів повністю? Файли зникнуть з Drive.`);
                        if (!ok) return;
                        const r = await onExecuteAction('dossier_agent', 'delete_documents', {
                          caseId: caseData.id, documentIds: ids, mode: 'full', _fromUI: true,
                        });
                        if (r?.success) { toast.success(`Видалено документів: ${r.deleted.length}`); registrySel.clear(); }
                        else toast.error('Не вдалось видалити', { description: r?.error });
                      }}
                    >
                      Видалити обрані повністю ({registrySel.count})
                    </Button>
                  </BulkActionBar>
                </div>
              )}

              <div style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain", padding: 6 }}>
                {filteredDocs.length === 0 ? (
                  <div style={{ padding: 'var(--space-5)', textAlign: "center", color: "var(--color-text-3)", fontSize: 12 }}>{"Немає документів"}</div>
                ) : filteredDocs.map(doc => {
                  const proc = proceedings.find(p => p.id === doc.procId);
                  return (
                    <div key={doc.id} onClick={() => setSelectedDoc(doc)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 'var(--radius-sm)', cursor: "pointer", background: selectedDoc?.id === doc.id ? "var(--color-surface-2)" : "transparent", border: `1px solid ${selectedDoc?.id === doc.id ? "var(--color-accent)" : "transparent"}`, marginBottom: 2, borderLeft: proc?.type === "appeal" ? "3px solid rgba(59,130,246,.45)" : proc?.type === "cassation" ? "3px solid rgba(243,156,18,.45)" : "1px solid transparent", transition: "background-color .15s, border-color .15s" }}>
                      <span onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0, display: "flex" }}>
                        <Checkbox
                          checked={registrySel.isSelected(doc.id)}
                          onChange={(v) => registrySel.toggle(doc.id, v)}
                          size="sm"
                        />
                      </span>
                      <span style={{ fontSize: 13, flexShrink: 0 }}>{doc.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{doc.name}</div>
                        <div style={{ fontSize: 10, color: "var(--color-text-3)" }}>
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
            background: 'var(--color-surface)',
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
          <div style={{ width: 4, height: 40, borderRadius: 2, background: 'var(--color-text-3)', pointerEvents: 'none' }} />
        </div>

        {/* Viewer */}
        <DocumentViewer
          document={selectedDoc}
          caseData={caseData}
          onClose={() => setSelectedDoc(null)}
          onUpdate={(documentId, fields) => {
            const updated = (caseData.documents || []).map(d =>
              d.id === documentId ? { ...d, ...fields, updatedAt: new Date().toISOString() } : d
            );
            updateCase && updateCase(caseData.id, 'documents', updated);
            setSelectedDoc(prev => (prev && prev.id === documentId ? { ...prev, ...fields } : prev));
          }}
          onOpenDetails={() => {
            toast.info('Панель деталей у розробці');
          }}
          onDiscussWithAgent={() => {
            setAgentOpen(true);
            toast.info('Передача документа в чат агента — у розробці', {
              description: 'Поки що відкрита панель агента — задайте запитання вручну',
            });
          }}
          onGenerateVariant={handleGenerateVariant}
          onLoadAttentionNotes={handleLoadAttentionNotes}
          onRemoveAllMarks={handleRemoveAllMarks}
          onReprocess={async (doc) => {
            const subFolders = caseData?.storage?.subFolders;
            if (!doc?.driveId || !subFolders?.['02_ОБРОБЛЕНІ']) {
              toast.warning('Перерозпізнання потребує файлу на Drive');
              return;
            }
            const rawName = doc.originalName || doc.name || '';
            const normalizedName = typeof rawName.normalize === 'function'
              ? rawName.normalize('NFC')
              : rawName;
            const file = {
              id: doc.driveId,
              name: normalizedName,
              mimeType: doc.mimeType || 'application/pdf',
              subFolders,
            };
            await runOcrWithRetryUI({
              file,
              doc,
              caseId: caseData.id,
              onExecuteAction,
            });
          }}
          onDelete={() => {
            if (!selectedDoc) return;
            setDocPendingDelete(selectedDoc);
            setDeleteDocOpen(true);
          }}
        />
      </div>
    );
  }

  // ── RENDER ─────────────────────────────────────────────────────────────────

  const tabs = [
    { id: "overview",     icon: ClipboardList, label: "Огляд" },
    { id: "materials",    icon: Folder,        label: "Матеріали", badge: documents.length },
    { id: "docwork",      icon: Wrench,        label: "Робота з документами" },
    { id: "position",     icon: Scale,         label: "Позиція" },
    { id: "templates",    icon: FileText,      label: "Шаблони" }
  ];

  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "var(--color-bg)", display: "flex", flexDirection: "column", overflow: "hidden", color: "var(--color-text)", fontSize: 13}}>

      {/* ШАПКА */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0, background: "var(--color-bg)", position: "relative", zIndex: 200 }}>
        <button onClick={onClose} style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)", color: "var(--color-text-2)", padding: "5px 12px", borderRadius: 'var(--radius-sm)', cursor: "pointer", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <ArrowLeft size={ICON_SIZE.sm} />
          <span>Реєстр</span>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{caseData.name}</div>
          <div style={{ fontSize: 11, color: "var(--color-text-3)", marginTop: 2 }}>
            {categoryLabel}{caseData.court ? ` \u00b7 ${caseData.court}` : ""}{caseData.case_no ? ` \u00b7 \u2116${caseData.case_no}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 'var(--radius-xs)', fontWeight: 600, background: `${statusColor}22`, color: statusColor }}>{statusLabel}</span>
          {(() => { const _nh = (caseData.hearings || []).filter(h => h.status === 'scheduled').sort((a,b) => a.date.localeCompare(b.date))[0]; return _nh ? <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 'var(--radius-xs)', fontWeight: 600, background: "rgba(243,156,18,.15)", color: "var(--color-warning)", display: "inline-flex", alignItems: "center", gap: 4 }}><Calendar size={ICON_SIZE.xs} />{_nh.date}{_nh.time ? ` о ${_nh.time}` : ''}</span> : null; })()}
          {/* Drive-chip — 4 стани через folderStatus (узгоджено зі смартом у блоці Сховище). */}
          {folderStatus === 'alive' ? (
            <button
              onClick={() => window.open(`https://drive.google.com/drive/folders/${storageState.driveFolderId}`, "_blank")}
              title={storageState.driveFolderName || "Drive папка"}
              style={{ fontSize: 11, padding: "3px 9px", borderRadius: 'var(--radius-xs)', fontWeight: 600, background: "rgba(79,124,255,.12)", color: "var(--color-accent)", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
            ><Cloud size={ICON_SIZE.xs} /><span>Drive</span><Link2 size={ICON_SIZE.xs} /></button>
          ) : folderStatus === 'trashed' ? (
            <span
              title="Папка справи у кошику Drive. Натисни «↻ Перестворити» у блоці «Сховище» нижче."
              style={{ fontSize: 11, padding: "3px 9px", borderRadius: 'var(--radius-xs)', fontWeight: 600, background: "rgba(231,76,60,.1)", color: "var(--color-danger)", display: "inline-flex", alignItems: "center", gap: 4, cursor: "help" }}
            ><AlertTriangle size={ICON_SIZE.xs} /><span>Папка у кошику</span></span>
          ) : folderStatus === 'missing' ? (
            <span
              title="Папки справи на Drive немає. Натисни «Створити структуру на Drive» у блоці «Сховище» нижче."
              style={{ fontSize: 11, padding: "3px 9px", borderRadius: 'var(--radius-xs)', fontWeight: 600, background: "rgba(231,76,60,.1)", color: "var(--color-danger)", display: "inline-flex", alignItems: "center", gap: 4, cursor: "help" }}
            ><AlertTriangle size={ICON_SIZE.xs} /><span>Створіть папку</span></span>
          ) : (
            // unknown — стан ще перевіряється або тимчасова мережа.
            <span
              title="Стан папки на Drive ще перевіряється…"
              style={{ fontSize: 11, padding: "3px 9px", borderRadius: 'var(--radius-xs)', fontWeight: 600, background: "var(--color-surface-2)", color: "var(--color-text-3)", display: "inline-flex", alignItems: "center", gap: 4 }}
            ><Cloud size={ICON_SIZE.xs} /><span>Drive…</span></span>
          )}
          {caseData.status !== "closed" && onCloseCase && (
            <button onClick={async () => {
              if (await systemConfirm("Закрити справу? Вона перейде в архів. Видалити можна буде звідти.", "Закриття справи")) {
                onCloseCase(caseData.id);
                onClose();
              }
            }} style={{ background: "none", border: "1px solid rgba(231,76,60,.3)", color: "var(--color-danger)", padding: "5px 10px", borderRadius: 'var(--radius-sm)', cursor: "pointer", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6 }}><Archive size={ICON_SIZE.sm} /><span>Закрити</span></button>
          )}
          {caseData.status === "closed" && onDeleteCase && (
            <button onClick={() => onDeleteCase(caseData)} style={{ background: "rgba(231,76,60,.1)", border: "1px solid rgba(231,76,60,.3)", color: "var(--color-danger)", padding: "5px 10px", borderRadius: 'var(--radius-sm)', cursor: "pointer", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6 }}><Trash2 size={ICON_SIZE.sm} /><span>Видалити назавжди</span></button>
          )}
          <button onClick={() => setIdeaOpen(true)} title="Ідея для контенту" aria-label="Ідея для контенту" style={{ background: "none", border: "1px solid var(--color-border)", color: "var(--color-text-2)", padding: "5px 10px", borderRadius: 'var(--radius-sm)', cursor: "pointer", display: "inline-flex", alignItems: "center" }}><Lightbulb size={ICON_SIZE.md} /></button>
          <button onClick={() => setAgentOpen(prev => !prev)} style={{ background: agentOpen ? "var(--color-accent)" : "none", color: agentOpen ? "#fff" : "var(--color-text-2)", border: "1px solid", borderColor: agentOpen ? "var(--color-accent)" : "var(--color-border)", padding: "6px 14px", borderRadius: 'var(--radius-sm)', cursor: "pointer", fontSize: 12, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6 }}><Bot size={ICON_SIZE.sm} /><span>{agentOpen ? "Сховати агента" : "Агент"}</span></button>
        </div>
      </div>

      {/* ECITS Банер (Точка 1) — нові надходження з Court Sync */}
      <ECITSBanner
        caseId={caseData.id}
        onProcess={() => setActiveTab("docwork")}
        onViewList={() => setActiveTab("docwork")}
      />

      {/* ВКЛАДКИ */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)", flexShrink: 0, padding: "0 16px", gap: 2, background: "var(--color-bg)", position: "relative", zIndex: 200 }}>
        {tabs.map(tab => {
          const Ic = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ padding: "8px 14px", border: "none", background: "none", color: activeTab === tab.id ? "var(--color-text)" : "var(--color-text-2)", cursor: "pointer", fontSize: 12, borderBottom: `2px solid ${activeTab === tab.id ? "var(--color-text-2)" : "transparent"}`, fontWeight: activeTab === tab.id ? 500 : 400, whiteSpace: "nowrap", transition: "all .15s", display: "inline-flex", alignItems: "center", gap: 6 }}>
              {Ic && <Ic size={ICON_SIZE.sm} />}
              <span>{tab.label}</span>
              {tab.badge > 0 && <span style={{ fontSize: 9, background: "var(--color-surface-2)", padding: "1px 5px", borderRadius: 'var(--radius-md)', marginLeft: 4, color: "var(--color-text-3)" }}>{tab.badge}</span>}
            </button>
          );
        })}
      </div>

      {/* BODY */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden", position: "relative", zIndex: 1 }}>
        {/* Основний вміст вкладки.
            «Матеріали» має власні скрол-зони (ліва панель — список; права — в'юер),
            тож зовнішній скрол їй вимкнено: інакше швидкий (momentum) скрол списку
            чейнився на цю обгортку і прокручував усю панель разом із шапкою
            (фільтри/бар мультивибору/Дерево-Реєстр зникали). Решта вкладок —
            довгі форми, їм скрол потрібен. */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: activeTab === 'materials' ? 'hidden' : 'auto', minWidth: 0 }}>
          {activeTab === "overview" && renderOverview()}
          {activeTab === "materials" && renderMaterials()}
          {activeTab === "docwork" && (
            <DocumentProcessorV2
              caseData={caseData}
              onExecuteAction={onExecuteAction}
              driveConnected={driveConnected}
              aiUsageSink={setAiUsage}
            />
          )}
          {["position", "templates"].includes(activeTab) && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--color-text-3)", gap: 12 }}>
              <div style={{ opacity: .2, display: "flex", justifyContent: "center" }}>{activeTab === "position" ? <Scale size={48} /> : <FileText size={48} />}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-2)" }}>{activeTab === "position" ? "Позиція" : "Шаблони"}</div>
              <div style={{ fontSize: 12 }}>{"Буде реалізовано в наступній під-сесії"}</div>
            </div>
          )}
        </div>

        {/* Рухома межа агента */}
        {agentOpen && (
          <div
            onMouseDown={() => { agentDragRef.current = true; }}
            onTouchStart={() => { agentDragRef.current = true; }}
            style={{ width: 8, cursor: 'col-resize', flexShrink: 0, background: 'var(--color-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none', transition: 'background .15s', zIndex: 10, position: 'relative' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--color-surface)'}
          >
            <div style={{ width: 4, height: 40, borderRadius: 2, background: 'var(--color-text-3)' }} />
          </div>
        )}

        {/* Панель агента */}
        {agentOpen && (
          <div style={{
            width: agentWidth, flexShrink: 0, borderLeft: '1px solid var(--color-border)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--color-surface)',
            position: 'relative'
          }}>
            <button
              type="button"
              className="agent-panel-collapse-toggle"
              onClick={() => setAgentOpen(false)}
              aria-label="Сховати агента"
              title="Сховати агента"
            >
              <ChevronRight size={14} />
            </button>
            {renderAgentPanel()}
          </div>
        )}

      </div>

      {/* МОДАЛКА ІДЕЯ ДЛЯ КОНТЕНТУ */}
      {ideaOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300 }}>
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', width: 360}}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, display: "inline-flex", alignItems: "center", gap: 6 }}><Lightbulb size={ICON_SIZE.md} /><span>Ідея для контенту</span></div>
            <div style={{ fontSize: 11, color: "var(--color-text-3)", marginBottom: 12 }}>{"Справа: "}{caseData.name}</div>
            <textarea
              value={ideaText}
              onChange={e => setIdeaText(e.target.value)}
              placeholder="Опиши ідею..."
              style={{ width: "100%", height: 100, background: "var(--color-surface-2)", border: "1px solid var(--color-border)", color: "var(--color-text)", padding: 10, borderRadius: 'var(--radius-sm)', fontSize: 12, resize: "none", outline: "none", lineHeight: 1.6, boxSizing: "border-box" }}
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
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', width: 400}}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{"+ Нова нотатка"}</div>
            <div style={{ fontSize: 11, color: "var(--color-text-3)", marginBottom: 8 }}>{"Справа: "}{caseData.name}</div>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Текст нотатки..."
              rows={5}
              style={{ width: "100%", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", color: "var(--color-text)", padding: 10, borderRadius: 'var(--radius-sm)', fontSize: 12, resize: "vertical", outline: "none", lineHeight: 1.6, boxSizing: "border-box" }}
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
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', width: 360}}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>+ Нове провадження</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--color-text-3)', marginBottom: 4 }}>Тип</div>
                <select value={newProc.type} onChange={e => setNewProc(p => ({ ...p, type: e.target.value }))} style={{ width: '100%', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', padding: '7px 10px', borderRadius: 'var(--radius-sm)', fontSize: 12 }}>
                  <option value="appeal">{"Апеляційне провадження"}</option>
                  <option value="cassation">{"Касація"}</option>
                  <option value="first">{"Перша інстанція (додаткова)"}</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--color-text-3)', marginBottom: 4 }}>Назва</div>
                <input value={newProc.title} onChange={e => setNewProc(p => ({ ...p, title: e.target.value }))} placeholder="напр. Апеляція: ухвала 03.2024" style={{ width: '100%', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', padding: '7px 10px', borderRadius: 'var(--radius-sm)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--color-text-3)', marginBottom: 4 }}>Суд</div>
                <input value={newProc.court} onChange={e => setNewProc(p => ({ ...p, court: e.target.value }))} placeholder="напр. Київський апеляційний суд" style={{ width: '100%', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', padding: '7px 10px', borderRadius: 'var(--radius-sm)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button onClick={() => { setProcModalOpen(false); setNewProc({ title: '', court: '', type: 'appeal' }); }} style={{ background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-2)', padding: '5px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 12 }}>Скасувати</button>
              <button onClick={() => {
                if (!newProc.title.trim()) return;
                const proc = { id: 'proc_' + Date.now(), type: newProc.type, title: newProc.title.trim(), court: newProc.court.trim(), status: 'active', parentProcId: 'proc_main', parentEventId: null };
                const updated = [...proceedings, proc];
                updateCase && updateCase(caseData.id, 'proceedings', updated);
                setProceedings(updated);
                setProcModalOpen(false);
                setNewProc({ title: '', court: '', type: 'appeal' });
              }} style={{ background: 'var(--color-accent)', color: '#fff', border: 'none', padding: '5px 14px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 12 }}>Додати</button>
            </div>
          </div>
        </div>
      )}

      {/* Стара inline-модалка замінена на AddDocumentModal (нижче). Залишена
          в коді як no-op (false-guard) — буде видалена окремим cleanup TASK. */}
      {false && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', width: 400}}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>+ Новий документ</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--color-text-3)', marginBottom: 4 }}>{"Назва *"}</div>
                <input value={newDoc.name} onChange={e => setNewDoc(d => ({ ...d, name: e.target.value }))} placeholder="напр. Ухвала про відкриття провадження" style={{ width: '100%', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', padding: '7px 10px', borderRadius: 'var(--radius-sm)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} autoFocus />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-3)', marginBottom: 4 }}>Дата</div>
                  <input value={newDoc.date} onChange={e => setNewDoc(d => ({ ...d, date: e.target.value }))} placeholder="напр. березень 2023" style={{ width: '100%', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', padding: '7px 10px', borderRadius: 'var(--radius-sm)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-3)', marginBottom: 4 }}>Провадження</div>
                  <select value={newDoc.procId} onChange={e => setNewDoc(d => ({ ...d, procId: e.target.value }))} style={{ width: '100%', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', padding: '7px 10px', borderRadius: 'var(--radius-sm)', fontSize: 12 }}>
                    {proceedings.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-3)', marginBottom: 4 }}>Тип</div>
                  <select value={newDoc.category} onChange={e => setNewDoc(d => ({ ...d, category: e.target.value }))} style={{ width: '100%', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', padding: '7px 10px', borderRadius: 'var(--radius-sm)', fontSize: 12 }}>
                    <option value="court_act">{"Судовий акт"}</option>
                    <option value="pleading">{"Заява по суті"}</option>
                    <option value="motion">{"Клопотання"}</option>
                    <option value="evidence">{"Докази"}</option>
                    <option value="correspondence">{"Листування"}</option>
                    <option value="other">{"Інше"}</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-3)', marginBottom: 4 }}>{"Від кого"}</div>
                  <select value={newDoc.author} onChange={e => setNewDoc(d => ({ ...d, author: e.target.value }))} style={{ width: '100%', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', padding: '7px 10px', borderRadius: 'var(--radius-sm)', fontSize: 12 }}>
                    <option value="court">Суд</option>
                    <option value="ours">Наш</option>
                    <option value="opponent">Опонент</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={newDoc.tags.includes('key')} onChange={e => setNewDoc(d => ({ ...d, tags: e.target.checked ? [...d.tags, 'key'] : d.tags.filter(t => t !== 'key') }))} />
                  <span style={{ fontSize: 12, color: 'var(--color-text-2)' }}>{"Позначити як ключовий"}</span>
                </label>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--color-text-3)", marginBottom: 4 }}>{"Файл (необов\u02BCязково)"}</div>
                <input
                  type="file"
                  accept=".pdf,.jpeg,.jpg,.png,.heic,.docx,.xlsx,.pptx,.zip,.md,.txt,.html,.htm"
                  onChange={e => setNewDoc(d => ({ ...d, file: e.target.files[0] || null }))}
                  style={{ width: "100%", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", color: "var(--color-text-2)", padding: "6px 10px", borderRadius: 'var(--radius-sm)', fontSize: 11, boxSizing: "border-box" }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button onClick={() => { setDocModalOpen(false); setNewDoc({ name: '', date: '', category: 'court_act', author: 'court', procId: '', tags: [], file: null }); }} style={{ background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-2)', padding: '5px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 12 }}>Скасувати</button>
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
                // \u041a\u0430\u043d\u043e\u043d\u0456\u0447\u043d\u0430 \u0444\u0430\u0431\u0440\u0438\u043a\u0430. tags/notes \u2014 extended-\u043f\u043e\u043b\u044f,
                // \u0437\u0431\u0435\u0440\u0456\u0433\u0430\u044e\u0442\u044c\u0441\u044f \u043e\u043a\u0440\u0435\u043c\u043e \u0443 .metadata/documents_extended.json
                // \u0456 \u0434\u043e\u0434\u0430\u044e\u0442\u044c\u0441\u044f \u0432 \u043d\u0430\u0441\u0442\u0443\u043f\u043d\u043e\u043c\u0443 TASK Document Processor v2.
                const doc = createDocument({
                  procId: newDoc.procId || proceedings[0]?.id || "proc_main",
                  name: newDoc.name.trim(),
                  icon: ICONS[newDoc.category] || "\ud83d\udcc4",
                  date: newDoc.date.trim() || null,
                  category: newDoc.category,
                  author: newDoc.author,
                  driveId,
                  driveUrl: driveId ? `https://drive.google.com/file/d/${driveId}/view` : null,
                  size: newDoc.file?.size || 0,
                  originalName: newDoc.file?.name || null,
                  folder: '01_\u041e\u0420\u0418\u0413\u0406\u041d\u0410\u041b\u0418',
                  addedBy: 'user',
                  namingStatus: 'manual',
                });
                const updated = [...(caseData.documents || []), doc];
                updateCase && updateCase(caseData.id, "documents", updated);
                setDocModalOpen(false);
                setNewDoc({ name: '', date: '', category: 'court_act', author: 'court', procId: '', tags: [], file: null });
              }} style={{ background: 'var(--color-accent)', color: '#fff', border: 'none', padding: '5px 14px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 12 }}>{"Додати документ"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Фірмова модалка додавання документа (replace native Android picker) */}
      <AddDocumentModal
        isOpen={docModalOpen}
        onClose={() => setDocModalOpen(false)}
        caseData={{ ...caseData, proceedings }}
        driveConnected={driveConnected}
        onSubmit={async ({ name, category, author, procId, date, isKey, file, mergeArtifacts, ocrMode = 'full' }) => {
          // ── Інтеграція на documentPipeline (тонкий диригент DP-1) ──────────
          // Детермінований core (convert → upload → createDocument →
          // add_document → emit) проходить через диригент. Post-persist OCR-
          // збагачення (UI-coupled: toasts/systemConfirm/Claude Vision-діалог)
          // лишається тут — DP-3/DP-4 територія, живиться з виходу pipeline.
          // Поведінка для адвоката без регресій (TASK A контракт збережено).
          const ICONS = {
            court_act: "📋", pleading: "📄", motion: "📝",
            evidence: "📎", contract: "📄", correspondence: "✉️",
            identification: "🪪", other: "📁",
          };
          const isDriveSource = !!(file?._isDriveSource && file?._driveId);

          // buildDocumentMetadata — ІН'ЄКТОВАНА доменна евристика nature/icon/
          // source. Лишається у шарі що вже володіє detectDocumentNature —
          // диригент і persist-стадія domain-free. DP-2 classify-стадія
          // візьме цю відповідальність на себе без зміни диригента.
          const buildDocumentMetadata = ({ item, driveId, originalDriveId }) => {
            const fileForInfer = item.uploadedFile || file;
            const isTextExtractedConvert =
              item.converterType === 'docxToPdf' || item.converterType === 'htmlToPdf';
            const initialNature = isTextExtractedConvert
              ? 'searchable'
              : (fileForInfer
                  ? (inferNatureFromFile({ mimeType: fileForInfer.type, originalName: fileForInfer.name })
                      || defaultNatureForUI({ mimeType: fileForInfer.type, originalName: fileForInfer.name }))
                  : 'searchable');
            return {
              procId: procId || proceedings[0]?.id || 'proc_main',
              name,
              icon: ICONS[category] || "📄",
              date,
              category,
              author,
              isKey,
              driveId: driveId || null,
              driveUrl: driveId ? `https://drive.google.com/file/d/${driveId}/view` : null,
              size: item.uploadedFile?.size || file?.size || 0,
              originalName: file?.name || null,
              originalDriveId: originalDriveId || null,
              originalMime: item.originalMime ?? (isDriveSource ? (file?.type || null) : null),
              folder: '01_ОРИГІНАЛИ',
              addedBy: 'user',
              namingStatus: 'manual',
              documentNature: initialNature,
              // source — канал ПОХОДЖЕННЯ: ручне додавання адвокатом. Канонічне
              // 'manual' (не legacy 'manual_upload' — CLAUDE.md ЗАБОРОНЕНО legacy
              // у новому коді; factory нормалізує обидва однаково).
              source: 'manual',
            };
          };

          // TASK 4 · етап C — одна труба: модалка йде через спільний
          // docPipeline.ingestFiles({mode:'add_as_is'}) (усунення дубль-шляху
          // C4). Модаль-специфіку (uploadFileLocal з verify, dossier_agent/
          // add_document + updateCase-fallback, форма-метадані) ін'єктуємо як
          // deps → поведінка байт-у-байт та сама. deferOcr=true: пост-OCR з
          // Claude Vision-фолбеком лишається нижче в модалці.
          const result = await docPipeline.ingestFiles(
            {
              caseId: caseData.id,
              caseData,
              agentId: 'dossier_agent',
              source: 'manual',
              addedBy: 'user',
              module: MODULES.CASE_DOSSIER,
              operation: 'add_document',
              conversionContext: {
                caseId: caseData.id,
                module: MODULES.CASE_DOSSIER,
                operation: 'add_document',
              },
              files: [{
                fileId: 'doc',
                raw: (!isDriveSource && file && driveConnected) ? file : null,
                isDriveSource,
                driveId: isDriveSource ? file._driveId : null,
                name: file?.name || null,
                size: file?.size || 0,
                type: file?.type || null,
                originalMime: isDriveSource ? (file?.type || null) : null,
                mergeArtifacts: mergeArtifacts || null,
              }],
            },
            {
              mode: 'add_as_is',
              // «без OCR» (етап D) → ocrMode 'none'. deferOcr=true: пост-крок
              // (повний OCR АБО Vision-метадані) робить модалка нижче за ocrMode.
              ocrMode,
              deferOcr: true,
              buildDocumentMetadata,
              uploadFile: uploadFileLocal,
              persistDocument: async ({ caseId, document }) => {
                if (onExecuteAction) {
                  return await onExecuteAction('dossier_agent', 'add_document', { caseId, document });
                }
                const updated = [...(caseData.documents || []), document];
                updateCase && updateCase(caseData.id, 'documents', updated);
                return { success: true };
              },
            },
          );

          // Помилки → ТІ САМІ toast'и що були inline (модаль лишається
          // відкритою, документ не створюється, на Drive нічого — TASK A).
          if (!result.ok || result.stoppedAt) {
            const e = (result.errors && result.errors[0]) || {};
            if (e.code === 'CONVERT_FAILED') {
              console.error('Conversion error:', e.message);
              toast.error('Не вдалось обробити файл', { description: e.message });
            } else if (e.code === 'UPLOAD_FAILED') {
              console.error('Upload error:', e.message);
              toast.error('Не вдалось завантажити файл на Drive', { description: e.message });
            } else {
              toast.error('Не вдалось додати документ', { description: e.message });
            }
            throw new Error(e.message || 'documentPipeline failed');
          }

          const persistedItem = result.files[0] || {};
          const doc = result.documents[0];
          const driveId = persistedItem.driveId || null;
          const extractedText = persistedItem.extractedText || null;
          const mergeLayoutJson = persistedItem.mergeLayoutJson || null;
          const fileForInfer = persistedItem.uploadedFile || file;

          const warns = persistedItem.warnings || [];
          if (warns.length > 0) console.info('[documentPipeline] warnings:', warns);
          if (warns.includes('ORIGINAL_UPLOAD_FAILED')) {
            toast.show('PDF створено, але оригінал DOCX не зберігся на Drive');
          }
          const suspiciousWarning = warns.find(
            w => typeof w === 'string' && /unusually small|порожн/i.test(w)
          );
          if (suspiciousWarning) {
            toast.warning('PDF створено, але може бути неповним', { description: suspiciousWarning });
          }

          // TASK 4 етап D — «без OCR»: повного OCR НЕ робимо, артефактів у 02
          // НЕ створюємо. Vision читає 1-2 стор. → пропонує метадані
          // (date/category/author/name + gist у extended). Спільний оркестратор
          // (той самий код що DP). Best-effort: збій не валить додавання —
          // документ уже в 01, «Розпізнати» доступне у переглядачі пізніше.
          if (ocrMode === 'none') {
            toast.success('Документ додано');
            if (driveId && fileForInfer && ocrService.canVisionMetadata({ mimeType: fileForInfer.type, name: fileForInfer.name })) {
              const tId = toast.info('AI читає документ і пропонує дані...', { persistent: true });
              try {
                const res = await enrichDocumentWithVisionMetadata({
                  ocrFile: {
                    id: driveId,
                    name: fileForInfer.name,
                    mimeType: fileForInfer.type,
                    subFolders: caseData?.storage?.subFolders,
                  },
                  doc,
                  caseId: caseData.id,
                  caseData,
                  executeAction: onExecuteAction,
                  agentId: 'dossier_agent',
                  options: { apiKey: localStorage.getItem('claude_api_key'), aiUsageSink: setAiUsage },
                });
                toast.dismiss(tId);
                if (res?.ok) {
                  toast.info('AI запропонував дані документа — перевірте і за потреби поправте');
                }
              } catch (e) {
                toast.dismiss(tId);
                console.warn('[AddDoc · без OCR] метадані не вдались (non-fatal):', e?.message || e);
              }
            }
            return;
          }

          // Post-persist OCR pipeline — точно той самий ланцюг що був inline.
          const subFolders = caseData?.storage?.subFolders;
          const hasOcrTarget = !!fileForInfer && !!driveId && !!subFolders?.['02_ОБРОБЛЕНІ'];
          if (!hasOcrTarget) {
            toast.success('Документ додано');
            return;
          }

          const ocrFile = {
            id: driveId,
            name: fileForInfer.name,
            mimeType: fileForInfer.type,
            subFolders,
          };

          // Гілка А — текст уже витягнуто конвертером (DOCX mammoth / HTML
          // innerText), конвертер дав searchable PDF (pdf-lib drawText). Document
          // AI НЕ викликаємо. TASK 4 §7.1: `.txt` НЕ пишемо — текст живе в
          // текстовому шарі PDF, дістається на вимогу (getDocumentText/
          // extractTextLayer). Фото-склейка (mergeLayoutJson є) — пишемо layout.
          if (extractedText) {
            toast.success('Документ додано');
            if (mergeLayoutJson) {
              try {
                // B1 (20.05.2026): writeLayoutArtifact приймає лише object —
                // string проходить strip-перевірку повз. mergeLayoutJson —
                // string з multiImageToPdf (strip уже зроблено там),
                // парсимо у об'єкт перед записом. Подвійний strip
                // (multiImageToPdf + writeLayoutArtifact) ідемпотентний.
                const layoutObj = typeof mergeLayoutJson === 'string'
                  ? JSON.parse(mergeLayoutJson)
                  : mergeLayoutJson;
                await ocrService.writeLayoutArtifact?.(ocrFile, layoutObj);
              } catch (e) {
                console.warn('[writeLayoutArtifact merge] failed:', e?.message || e);
              }
            }
            if (onExecuteAction && doc) {
              try {
                await onExecuteAction('dossier_agent', 'update_document', {
                  caseId: caseData.id,
                  documentId: doc.id,
                  fields: { lastOcrAt: new Date().toISOString() },
                });
              } catch (e) {
                console.warn('[update_document lastOcrAt] failed:', e?.message || e);
              }
            }
            return;
          }

          // Гілка Б — немає OCR провайдера (XLSX/PPTX/passthrough). Viewer
          // покаже оригінал через iframe Drive.
          if (!ocrService.hasOcrSupport(ocrFile)) {
            toast.success('Документ додано');
            return;
          }

          // Гілка В — PDF/image. OCR pipeline з retry + Claude Vision-діалог.
          toast.success('Документ додано');
          await runOcrWithRetryUI({
            file: ocrFile,
            doc,
            caseId: caseData.id,
            onExecuteAction,
            silentSuccess: false,
          });
        }}
      />

      {/* Модалка видалення документа з Viewer'а */}
      <DeleteDocumentModal
        isOpen={deleteDocOpen}
        document={docPendingDelete}
        onClose={() => { setDeleteDocOpen(false); setDocPendingDelete(null); }}
        onConfirm={async (mode) => {
          if (!docPendingDelete || !onExecuteAction) return;
          const r = await onExecuteAction('dossier_agent', 'delete_document', {
            caseId: caseData.id,
            documentId: docPendingDelete.id,
            mode,
            _fromUI: true,
          });
          if (r?.success) {
            toast.success(mode === 'archive' ? 'Документ архівовано' : 'Документ видалено');
            setSelectedDoc(null);
          } else {
            toast.error('Не вдалось виконати', { description: r?.error });
          }
        }}
      />

      {/* Модалка нового / редагування засідання — DateTimePicker з обовʼязковими
          датою і часом. addHearingOpen=true для нового, або об'єкт
          { hearingId, date, time, duration } для редагування. */}
      <DateTimePicker
        isOpen={!!addHearingOpen}
        title={addHearingOpen?.hearingId ? "Редагувати засідання" : "Нове засідання"}
        initialDate={typeof addHearingOpen === 'object' ? addHearingOpen?.date : ''}
        initialTime={typeof addHearingOpen === 'object' ? addHearingOpen?.time : ''}
        saveLabel={addHearingOpen?.hearingId ? "Зберегти" : "Додати"}
        onClose={() => setAddHearingOpen(false)}
        onSave={({ date, time }) => {
          if (!onExecuteAction) { setAddHearingOpen(false); return; }
          if (addHearingOpen?.hearingId) {
            onExecuteAction("dossier_agent", "update_hearing", {
              caseId: caseData.id, hearingId: addHearingOpen.hearingId,
              date, time, duration: addHearingOpen.duration,
            });
          } else {
            onExecuteAction("dossier_agent", "add_hearing", {
              caseId: caseData.id, date, time, duration: 120,
            });
          }
          setAddHearingOpen(false);
        }}
      />

      {/* Модалка нового дедлайну — назва (обовʼязкова) + DatePicker. Замінює
          двоступеневий systemPrompt flow. */}
      <Modal
        isOpen={addDeadlineOpen}
        onClose={() => setAddDeadlineOpen(false)}
        title="Новий дедлайн"
        size="sm"
        actions={
          <>
            <Button variant="secondary" onClick={() => setAddDeadlineOpen(false)}>Скасувати</Button>
            <Button
              variant="primary"
              disabled={!newDeadline.name.trim() || !newDeadline.date}
              onClick={() => {
                if (!newDeadline.name.trim() || !newDeadline.date || !onExecuteAction) return;
                onExecuteAction("dossier_agent", "add_deadline", {
                  caseId: caseData.id,
                  name: newDeadline.name.trim(),
                  date: newDeadline.date,
                });
                setAddDeadlineOpen(false);
              }}
            >Додати</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Input
            label="Назва дедлайну"
            value={newDeadline.name}
            onChange={v => setNewDeadline(d => ({ ...d, name: v }))}
            placeholder="Наприклад: Заява про витрати"
            autoFocus
          />
          <DatePicker
            label="Дата дедлайну"
            value={newDeadline.date}
            onChange={v => setNewDeadline(d => ({ ...d, date: v }))}
            inline
          />
        </div>
      </Modal>

    </div>
  );
}

