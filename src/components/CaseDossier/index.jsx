import { useState, useEffect, useRef } from "react";
import { createCaseStructure, listFolderFiles, findOrCreateFolder, uploadFileToDrive, getDriveFiles, readDriveFile, createDriveFile, updateDriveFile } from "../../services/driveService.js";
import { createDocument } from "../../services/documentFactory.js";
import { driveRequest, forceConsentRefresh } from "../../services/driveAuth.js";
import * as ocrService from "../../services/ocrService.js";
import { convertToPdf } from "../../services/converter/converterService.js";
import { createDocumentPipeline } from "../../services/documentPipeline.js";
import * as eventBus from "../../services/eventBus.js";
import { DOCUMENT_INGESTED, DOCUMENT_BATCH_PROCESSED } from "../../services/eventBusTopics.js";
import { getCurrentUser } from "../../services/tenantService.js";
import { inferNatureFromFile, defaultNatureForUI } from "../../services/detectDocumentNature.js";
import { systemAlert, systemConfirm, systemPrompt } from "../SystemModal";
import { toast } from "../../services/toast.js";
import { messages } from "../../services/messages.js";
import { logAiUsage } from "../../services/aiUsageService.js";
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
import { DatePicker, DateTimePicker, Input, Modal, Button } from "../UI";
import { DocumentViewer } from "../DocumentViewer";
import { AddDocumentModal } from "./AddDocumentModal.jsx";
import DocumentProcessorV2 from "../DocumentProcessorV2";
import { ECITSBanner } from "../ECITSBanner";
import { DeleteDocumentModal } from "./DeleteDocumentModal.jsx";
import { ArchiveView } from "./ArchiveView.jsx";
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

const CASE_TYPE_LABELS = {
  civil: "цивільна",
  criminal: "кримінальна",
  admin: "адміністративна",
  administrative: "адміністративна",
  commercial: "господарська",
  military: "військова"
};

const PROC_TYPE_LABELS = {
  first: "перша",
  appeal: "апеляція",
  cassation: "касація"
};

const CASE_CONTEXT_SYSTEM_PROMPT_V2 = `Ти — спеціалізований юридичний асистент який формує структурований контекстний файл для адвокатської справи. Твоє завдання — проаналізувати надані документи та згенерувати файл case_context.md який потім використовуватиметься іншим агентом для відповідей адвокату по цій справі.

═══════════════════════════════════════════════════════════
МЕТАДАНІ СПРАВИ (з Legal BMS)
═══════════════════════════════════════════════════════════

Сьогодні: {{CURRENT_DATE_ISO}}

Назва справи: {{CASE_NAME}}
Номер справи: {{CASE_NUMBER}}
Тип справи: {{CASE_TYPE}}
Категорія: {{CASE_CATEGORY}}
Поточна стадія: {{CURRENT_STAGE}}
Суд: {{COURT_NAME}}
Суддя: {{JUDGE_NAME}}
Дата відкриття провадження: {{OPENED_DATE_ISO}}

Клієнт АБ Левицького: {{CLIENT_NAME}}
Роль клієнта: {{CLIENT_ROLE}}

Інстанції в ЄСІТС:
  Перша:    {{FIRST_INSTANCE_NUMBER}}
  Апеляція: {{APPEAL_INSTANCE_NUMBER}}
  Касація:  {{CASSATION_INSTANCE_NUMBER}}

Документи у справі: {{DOCUMENTS_COUNT}} штук
[Перелік типів і дат документів передається разом з самими документами далі]

═══════════════════════════════════════════════════════════
ЖОРСТКІ ПРАВИЛА (НЕПОРУШНІ)
═══════════════════════════════════════════════════════════

1. Використовуй ТІЛЬКИ інформацію з наданих документів і метаданих справи.

2. НІКОЛИ не вигадуй: дати, ПІБ, номери документів, суми, цитати, факти.

3. Якщо документа немає в матеріалах — не згадуй про нього.

4. Якщо в розділі недостатньо даних — залиш ТІЛЬКИ заголовок розділу без вмісту. Не пиши плейсхолдери, не пояснюй чому пусто, не заповнюй загальними фразами.

5. Цитати — дослівно, у лапках, з посиланням на документ. Це стосується норм права, формулювань суду, тез опонента, ключових тверджень сторін. Не виправляй помилки в цитатах — зберігай як в оригіналі.

6. При паралельних позиціях сторін — зберігай нейтральність:
   - Не використовуй упереджених формулювань на користь жодної сторони
   - Описуй позиції рівноцінно за тоном
   - Маркер клієнта вказано в шапці файлу — це не привід зміщувати акценти

7. Юридичні висновки які не випливають прямо з документів — не роби. Не пиши "відповідач, ймовірно, скористається...", "позивач має слабку позицію тому що..." якщо це не зазначено в матеріалах.

8. При невпевненості в інтерпретації — формулюй з обмовкою ("згідно з матеріалами", "за твердженням позивача", "в позовній заяві зазначено").

═══════════════════════════════════════════════════════════
ПРИНЦИПИ ОБСЯГУ
═══════════════════════════════════════════════════════════

Загальний ліміт — 16000 токенів. Це максимум, не ціль.

Адаптуй обсяг під реальну кількість інформації:
- Багато документів і складна справа → використовуй весь доступний обсяг для повноти
- Мало документів → пиши коротко і змістовно

Якість понад обсяг. Не вигадуй щоб заповнити. Не дублюй інформацію між розділами.

Кожна теза повинна спиратись на конкретний документ або нотатку.

Перевір перед завершенням:
- Всі релевантні документи враховані
- Всі релевантні розділи мають змістовне наповнення
- Жоден важливий аспект справи не пропущено

═══════════════════════════════════════════════════════════
ФОРМАТ ДАТ
═══════════════════════════════════════════════════════════

В усьому файлі використовуй ISO формат YYYY-MM-DD.

Виняток: в дослівних цитатах документів дати залишаються як в оригіналі.

═══════════════════════════════════════════════════════════
СТРУКТУРА ФАЙЛУ case_context.md
═══════════════════════════════════════════════════════════

Файл починається з шапки і має 11 розділів. Структура одна для всіх типів справ. Розділ 4 (Процесуальна позиція) адаптується під тип справи.

──── ШАПКА ────

# Справа [НАЗВА] №[НОМЕР]
Створено: [ISO date]
Оновлено: [ISO date]
Джерело: [N] документів

Тип справи: [цивільна / адміністративна / кримінальна / господарська]
Категорія: [категорія]
Поточна стадія: [перша / апеляція / касація]

Клієнт АБ Левицького: [ПІБ], роль — [роль клієнта]

──── РОЗДІЛИ ────

## 1. Огляд справи
Стисле резюме суті спору або обвинувачення, поточної стадії, ключових питань. 2-5 речень. Не переказ позиції однієї сторони, а нейтральний огляд предмета розгляду.

## 2. Сторони
Усі учасники процесу з зазначенням ролей. Включно з:
- Позивач / відповідач (за первісним і зустрічним якщо є)
- Третя особа з / без самостійних вимог
- Прокурор (якщо бере участь)
- Законний представник (якщо неповнолітній / недієздатний)
- Адвокат-представник опонента (якщо відомо)
- Інші учасники

Для кримінальних справ:
- Підозрюваний / обвинувачений
- Потерпілий
- Законний представник потерпілого
- Цивільний позивач (якщо є цивільний позов)
- Прокурор
- Захисник (якщо ми)

Маркувати нашого клієнта у списку: "(наш клієнт)".

## 3. Суд і провадження
- Суд: повна назва і місцезнаходження
- Суддя: ПІБ
- Номери проваджень для кожної інстанції
- Дата відкриття провадження
- Якщо рух між інстанціями — коротко зафіксувати: "В апеляції з [дата]"

## 4. Процесуальна позиція

──── АДАПТАЦІЯ ПІД ТИП СПРАВИ ────

ДЛЯ ЦИВІЛЬНОЇ / АДМІНІСТРАТИВНОЇ:

### 4.1. Позиція позивача (за первісним позовом)
- Предмет позову
- Підстави
- Розмір вимог (для майнових справ — окремим підрозділом "Майнові вимоги і розрахунки" з конкретними сумами і логікою розрахунку)
- Норми права на які посилається
- Прецеденти і судова практика на яку посилається

### 4.2. Позиція відповідача (за первісним позовом)
- Заперечення
- Контраргументи
- Норми права на які посилається
- Прецеденти на які посилається

### 4.3. Зустрічний позов (якщо подано)
- Статус: подано / прийнято / відмовлено у прийнятті
- Позиція позивача за зустрічним
- Позиція відповідача за зустрічним

ДЛЯ КРИМІНАЛЬНОЇ:

### 4.1. Обвинувачення
[з обвинувального акту або повідомлення про підозру]
- Стаття КК
- Кваліфікація дій
- Епізоди обвинувачення
- Доказова база обвинувачення

### 4.2. Позиція захисту
[з документів захисту, якщо є]
- Заперечення обвинувачення
- Аргументи на користь підзахисного
- Норми права на які посилається

### 4.3. Позиція потерпілого
[повноцінний розділ, незалежно від того кого представляємо]
- Версія подій потерпілого
- Заявлені вимоги (моральна шкода, цивільний позов)
- Позиція щодо обвинувачення

### 4.4. Цивільний позов у кримінальному провадженні (якщо є)
- Позивач, відповідач, предмет позову, сума

ДЛЯ ГОСПОДАРСЬКОЇ:
Структура як для цивільної (4.1, 4.2, 4.3 для зустрічного).

## 5. Хронологія подій
Хронологічний список ключових процесуальних дій з ISO датами:
- YYYY-MM-DD: подія (документ: тип і дата)
- YYYY-MM-DD: подія
...

Включати: подачі документів, судові засідання (відбулись/відкладені/перенесені), ухвали суду, рішення, апеляції, передачі справи між інстанціями, експертизи призначені/проведені.

## 6. Документи у справі
Перелік усіх документів які проаналізовано. Для кожного:
- Тип документа
- Дата документа (ISO)
- Хто виходить (суд / позивач / відповідач / третя особа / адвокат)
- Суть в 1-3 реченнях

## 7. Експертизи
Окремий блок для кожної експертизи:

### [Назва експертизи]
- Дата проведення
- Хто провів (експерт або установа)
- Предмет дослідження
- Ключові висновки (3-7 пунктів):
  - [висновок 1]
  - [висновок 2]
  - ...

Якщо є рецензія — як зноска одразу під експертизою:
> Рецензія: [джерело], [дата]. Суть рецензії: [короткий виклад]

Якщо експертиз немає — розділ 7 залишити порожнім (тільки заголовок).

## 8. Ключові факти і докази
Найважливіші факти які впливають на вирішення справи. Кожен факт пов'язаний з конкретним документом:
- Факт 1: [короткий виклад]. Підтвердження: [документ, сторінка/пункт].
- Факт 2: [...]
...

Не плутати з позиціями сторін (розділ 4) — тут об'єктивні факти які встановлюються матеріалами.

## 9. Слабкі місця

### 9.1. Слабкі місця позиції позивача / обвинувачення
[Нейтральний аналіз слабких місць — суперечності, нестача доказів, процесуальні порушення, прогалини]

### 9.2. Слабкі місця позиції відповідача / захисту
[Симетрично нейтральний аналіз]

### 9.3. По зустрічному / потерпілого / іншим учасникам
[Якщо релевантно — слабкі місця їх позицій]

Включати ризики як підкатегорію слабких місць (а не окремий розділ).

## 10. Спостереження адвоката
[Заповнюється з переданих нотаток адвоката, прив'язаних до справи]

Якщо нотаток немає — заголовок без вмісту.

Не вигадувати спостереження. Не додавати загальних коментарів. Тільки реальні нотатки.

## 11. Поточний статус
Станом на [ISO дата формування].

Стисло — на якій стадії справа зараз, чи є непідтверджені документи, чи очікується подача чогось.

Не писати про "найближчі події" чи "наступні засідання" — це швидко змінюється і не повинно бути в контекстному файлі.

═══════════════════════════════════════════════════════════
ОБРОБКА ПЕРЕДАНИХ НОТАТОК
═══════════════════════════════════════════════════════════

Перед документами в системному промпті можуть бути передані нотатки адвоката:

НОТАТКИ АДВОКАТА (з Legal BMS):
[Нотатка 1, дата YYYY-MM-DD, тип: ...]: текст нотатки
[Нотатка 2, дата YYYY-MM-DD, тип: ...]: текст нотатки
...

Ці нотатки використовувати:
- Розділ 10 (Спостереження адвоката) — основне джерело
- Інші розділи — як додатковий контекст для розуміння (наприклад якщо в нотатці згадано що "опонент готував зустрічний позов" — це підказка для розділу 4.3)

Не цитувати нотатки дослівно, переформульовувати в нейтральний стиль.

Якщо нотаток немає — розділ 10 залишити порожнім (тільки заголовок).

═══════════════════════════════════════════════════════════
ОБРОБКА ДОКУМЕНТІВ
═══════════════════════════════════════════════════════════

Документи передаються нижче як document blocks. Кожен документ — це текст вже обробленого через OCR файлу.

Для великих документів (позов на десятки сторінок, експертиза):
- Не цитуй повністю
- Виокремлюй: тип, дата, автор, суть в 5-10 реченнях
- Цитуй точно тільки те що критично (норми права, ключові тези, формулювання вимог)
- Решту — переказ своїми словами з посиланням

═══════════════════════════════════════════════════════════
ЗАВДАННЯ
═══════════════════════════════════════════════════════════

Проаналізуй передані документи і нотатки. Сформуй case_context.md за вищевказаною структурою.

Файл має бути готовий до прямого збереження на Google Drive — без додаткових коментарів, пояснень "ось ваш файл" чи інших обгорток. Тільки сам markdown.

Перший рядок твоєї відповіді має бути "# Справа [назва] №[номер]".`;

function buildCaseMetadata(caseData, documentsCount) {
  const proceedings = Array.isArray(caseData.proceedings) ? caseData.proceedings : [];
  const findInstance = (type) => {
    const proc = proceedings.find(p => p.type === type);
    return proc?.case_no || proc?.case_number || "";
  };
  const activeProc = proceedings.find(p => p.status === "active") || proceedings[0];
  const currentStage = activeProc ? (PROC_TYPE_LABELS[activeProc.type] || activeProc.type || "") : "";
  const firstInstance = findInstance("first") || (currentStage === "перша" ? (caseData.case_no || "") : "");

  return {
    CURRENT_DATE_ISO: new Date().toISOString().slice(0, 10),
    CASE_NAME: caseData.name || "",
    CASE_NUMBER: caseData.case_no || "",
    CASE_TYPE: CASE_TYPE_LABELS[caseData.category] || caseData.category || "",
    CASE_CATEGORY: caseData.subcategory || "",
    CURRENT_STAGE: currentStage,
    COURT_NAME: caseData.court || "",
    JUDGE_NAME: caseData.judge || "",
    OPENED_DATE_ISO: caseData.opened_date || "",
    CLIENT_NAME: caseData.client || "",
    CLIENT_ROLE: caseData.client_role || "",
    FIRST_INSTANCE_NUMBER: firstInstance,
    APPEAL_INSTANCE_NUMBER: findInstance("appeal"),
    CASSATION_INSTANCE_NUMBER: findInstance("cassation"),
    DOCUMENTS_COUNT: String(documentsCount || 0),
  };
}

function fillSystemPrompt(template, metadata) {
  let prompt = template;
  for (const [key, value] of Object.entries(metadata)) {
    prompt = prompt.replaceAll(`{{${key}}}`, value);
  }
  return prompt;
}

function getNotesForContext(caseData, caseNotes, options = {}) {
  const { maxRecent = 5, maxPinned = 10 } = options;
  const list = Array.isArray(caseNotes) ? caseNotes : [];
  const pinnedIds = new Set((caseData?.pinnedNoteIds || []).map(String));

  const pinned = list
    .filter(n => pinnedIds.has(String(n.id)))
    .slice(0, maxPinned)
    .map(n => ({ ...n, isPinned: true }));

  const recent = list
    .filter(n => !pinnedIds.has(String(n.id)))
    .sort((a, b) => new Date(b.ts || b.createdAt || 0) - new Date(a.ts || a.createdAt || 0))
    .slice(0, maxRecent)
    .map(n => ({ ...n, isPinned: false }));

  return [...pinned, ...recent];
}

function formatNotesForPrompt(notes) {
  if (!notes || notes.length === 0) return "";
  const lines = ["НОТАТКИ АДВОКАТА (з Legal BMS):"];
  for (const note of notes) {
    const raw = note.ts || note.createdAt;
    const date = raw ? new Date(raw).toISOString().slice(0, 10) : "";
    const type = note.type || note.category || "general";
    const pinTag = note.isPinned ? " [закріплена]" : "";
    const text = (note.text || note.content || "").trim();
    lines.push(`[${date}, ${type}${pinTag}]: ${text}`);
  }
  return lines.join("\n");
}

export default function CaseDossier({ caseData, cases, updateCase, onClose, onSaveIdea, onCloseCase, onDeleteCase, notes: notesProp, onAddNote, onUpdateNote, onDeleteNote, onPinNote, driveConnected, onExecuteAction, setAiUsage }) {
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
  const [contextLoading, setContextLoading] = useState(false);
  const [contextMsg, setContextMsg] = useState('');
  const [isCreatingContext, setIsCreatingContext] = useState(false);
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

    // Успіх — повідомляємо і оновлюємо документ
    if (!silentSuccess) {
      if (ocrResult?.cacheWritten) {
        toast.success('Текст розпізнано і збережено');
      } else {
        toast.warning('Текст розпізнано, але не вдалось зберегти кеш на Drive', {
          description: 'При повторному відкритті може знадобитись повторне розпізнавання',
        });
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

      // 1. Перевірити існуючий case_context.md
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

      // 2. Гарантуємо що subFolders заповнені (legacy справи)
      setContextMsg("Перевіряю структуру папок...");
      const subFolders = await ensureSubFolders(caseData);
      if (!subFolders?.['01_ОРИГІНАЛИ'] && !subFolders?.['02_ОБРОБЛЕНІ']) {
        toast.show(messages.context.noSubfolders());
        return;
      }

      // 3. Зібрати джерельні файли. Виключаємо .txt (наш OCR-кеш),
      //    agent_history.json, case_context.md.
      setContextMsg("Збираю файли...");
      const collectFromFolder = async (subFolderId, label) => {
        if (!subFolderId) return [];
        const res = await driveRequest(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
            `'${subFolderId}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'`
          )}&fields=files(id,name,size,mimeType)&pageSize=100`
        );
        const data = await res.json();
        return (data.files || []).filter(f =>
          f.name !== 'agent_history.json' &&
          f.name !== 'case_context.md' &&
          !f.name.toLowerCase().endsWith('.txt')
        ).map(f => ({ ...f, sourceLabel: label }));
      };

      const allFiles = [];
      if (subFolders?.['01_ОРИГІНАЛИ']) {
        allFiles.push(...(await collectFromFolder(subFolders['01_ОРИГІНАЛИ'], '01_ОРИГІНАЛИ')));
      }
      if (subFolders?.['02_ОБРОБЛЕНІ']) {
        allFiles.push(...(await collectFromFolder(subFolders['02_ОБРОБЛЕНІ'], '02_ОБРОБЛЕНІ')));
      }

      if (allFiles.length === 0) {
        toast.show(messages.context.noFiles());
        return;
      }

      console.log(`[CaseDossier] OCR джерело: ${allFiles.length} файлів`, allFiles.map(f => `${f.name} (${f.sourceLabel})`));
      setContextMsg(`Знайдено ${allFiles.length} файлів. Запускаю обробку...`);

      // 4. OCR через сервіс — параллельно через Document AI з кешем
      const filesForOcr = allFiles.map(f => ({
        ...f,
        driveFolderId: folderId,
        subFolders,
      }));

      const results = await ocrService.extractTextBatch(filesForOcr, {
        concurrency: 3,
        onProgress: (done, total, current) => {
          setContextMsg(`Обробка ${done}/${total}: ${current?.name || '...'}`);
        },
        caseId: caseData?.id,
        aiUsageSink: setAiUsage ? (entry) => setAiUsage(prev => {
          const next = Array.isArray(prev) ? [...prev, entry] : [entry];
          return next.length > 50000 ? next.slice(next.length - 50000) : next;
        }) : null,
      });

      // 5. Якщо ВСІ помилки AUTH — пропонуємо forceConsentRefresh.
      const allAuth = results.length > 0 && results.every(r => r.error?.code === 'AUTH');
      if (allAuth) {
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
        return;
      }

      // 6. Зібрати тексти і помилки
      const textDocs = [];
      const failed = [];
      let cacheHits = 0;
      for (const r of results) {
        if (r.result?.text) {
          textDocs.push({ name: r.file.name, text: r.result.text });
          if (r.result.fromCache) cacheHits++;
          console.log(`[CaseDossier] ✅ ${r.file.name} via ${r.result.provider} (${r.result.fromCache ? 'cache' : 'fresh'}, ${r.result.text.length} симв)`);
        } else if (r.error) {
          failed.push({ name: r.file.name, error: r.error.message });
          const localized = ocrService.localizeOcrError ? ocrService.localizeOcrError(r.error.code) : r.error.message;
          textDocs.push({ name: r.file.name, text: `[Файл: ${r.file.name} — помилка: ${localized}]` });
          console.log(`[CaseDossier] ❌ ${r.file.name}: ${r.error.code} ${r.error.message}`);
        }
      }

      setContextMsg(`Аналізую ${textDocs.length} документів${cacheHits ? `, ${cacheHits} з кешу` : ''}${failed.length ? `, ${failed.length} помилок` : ''}...`);

      // 7. API ключ Claude
      const apiKey = localStorage.getItem("claude_api_key");
      if (!apiKey) {
        toast.show(messages.context.apiKeyMissing());
        return;
      }

      // 8. System prompt v2 — шаблон з метаданими справи
      const metadata = buildCaseMetadata(caseData, textDocs.length);
      const systemPrompt = fillSystemPrompt(CASE_CONTEXT_SYSTEM_PROMPT_V2, metadata);

      // 9. Нотатки адвоката (закріплені + останні) — окремий блок перед документами
      const notesForPrompt = getNotesForContext(caseData, notesProp);
      const notesBlock = formatNotesForPrompt(notesForPrompt);

      // 10. Тіло — тільки текст. OCR вже відпрацював, image-блоки не потрібні.
      const textBlock = textDocs
        .map((d, i) => `### ДОКУМЕНТ ${i + 1}: ${d.name}\n\n${d.text}`)
        .join("\n\n---\n\n");

      const userContent = [];
      if (notesBlock) {
        userContent.push({ type: "text", text: notesBlock });
      }
      userContent.push({ type: "text", text: `Текстові документи справи:\n\n${textBlock}` });
      userContent.push({
        type: "text",
        text: `Проаналізуй усі ${textDocs.length} документів${notesBlock ? " і нотатки адвоката вище" : ""} і сформуй case_context.md за структурою з системного промпту. Жоден документ не ігноруй.`
      });

      // 11. Виклик Anthropic
      const ctxModel = resolveModel('caseContextGenerator');
      const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: ctxModel,
          max_tokens: 16000,
          system: systemPrompt,
          messages: [{ role: "user", content: userContent }]
        })
      });

      if (!apiRes.ok) {
        const errText = await apiRes.text();
        throw new Error(`API ${apiRes.status}: ${errText.slice(0, 500)}`);
      }

      const data = await apiRes.json();
      try {
        logAiUsage({
          agentType: 'case_context_generator',
          model: ctxModel,
          inputTokens: data?.usage?.input_tokens,
          outputTokens: data?.usage?.output_tokens,
          context: { caseId: caseData?.id || null, module: MODULES.CASE_DOSSIER, operation: 'generate_context' },
        }, setAiUsage);
        // Досьє завжди має caseId — категорія детермінована.
        activityTracker.report('agent_call', {
          caseId: caseData?.id || null,
          module: MODULES.CASE_DOSSIER,
          category: categoryForCase(caseData?.id),
          metadata: { agentType: 'case_context_generator', operation: 'generate_context' }
        });
      } catch {}
      const contextMd = data?.content?.[0]?.text || "";

      if (!contextMd) {
        toast.show(messages.context.emptyResult());
        return;
      }

      // 11. Архівація попереднього + upload нового
      setContextMsg("Зберігаю case_context.md...");

      const existingFiles = await listFolderFiles(folderId, token);
      const existingCtx = existingFiles.find(f => f.name === "case_context.md");
      if (existingCtx) {
        const archiveFolder = await findOrCreateFolder("archive", folderId, token);
        // Timestamp до секунд: 2026-04-26T14-30-15
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const archiveName = `case_context_${ts}.md`;
        await driveRequest(`https://www.googleapis.com/drive/v3/files/${existingCtx.id}/copy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: archiveName, parents: [archiveFolder.id] })
        });
        await driveRequest(`https://www.googleapis.com/drive/v3/files/${existingCtx.id}`, {
          method: "DELETE",
        });
      }

      const uploadResult = await uploadFileToDrive(
        "case_context.md",
        new Blob([contextMd], { type: "text/markdown" }),
        folderId,
        token
      );

      if (uploadResult?.error) {
        console.error('[CaseDossier] context save failed:', uploadResult.error);
        toast.show(messages.context.saveFailed(uploadResult.error.message));
        return;
      }
      if (!uploadResult?.id) {
        toast.show(messages.context.saveFailed());
        return;
      }

      toast.show(messages.context.created({ count: textDocs.length, fromCache: cacheHits, failed: failed.length }));
      setContextMsg('');

      try {
        const fresh = await loadCaseContext();
        if (fresh) setCaseContext(fresh);
      } catch (e) { console.log('[CaseContext] refresh after save failed:', e); }

    } catch (err) {
      console.error("Context creation error:", err);
      console.error('[CaseDossier] context error:', err);
      toast.error('Не вдалось створити контекст', { description: 'Перевірте API ключ і підключення Drive.' });
      setContextMsg('');
    } finally {
      setContextLoading(false);
      setIsCreatingContext(false);
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
  const [showArchived, setShowArchived] = useState(false);
  const [selectedArchivedIds, setSelectedArchivedIds] = useState(() => new Set());

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
          {!storageState?.driveFolderId ? (
            <button
              onClick={handleCreateDriveStructure}
              disabled={creatingStructure}
              style={{
                background: creatingStructure ? "var(--color-surface-2)" : "var(--color-accent-hover)",
                color: "#fff", border: "none", borderRadius: 'var(--radius-sm)',
                padding: "8px 16px", cursor: creatingStructure ? "wait" : "pointer", fontSize: 13,
              }}
            >
              {creatingStructure ? "⏳ Створюю..." : <><Folder size={ICON_SIZE.sm} style={{ verticalAlign: 'middle', marginRight: 6 }} />Створити структуру на Drive</>}
            </button>
          ) : (
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
              onClick={() => {
                setShowArchived(v => !v);
                setSelectedArchivedIds(new Set());
              }}
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
              selectedIds={selectedArchivedIds}
              onExit={() => { setShowArchived(false); setSelectedArchivedIds(new Set()); }}
              onSelectAll={(all) => {
                if (all) setSelectedArchivedIds(new Set(archivedDocuments.map(d => d.id)));
                else setSelectedArchivedIds(new Set());
              }}
              onToggleSelected={(id, value) => {
                setSelectedArchivedIds(prev => {
                  const next = new Set(prev);
                  if (value) next.add(id); else next.delete(id);
                  return next;
                });
              }}
              onRestoreOne={async (doc) => {
                if (!onExecuteAction) return;
                const r = await onExecuteAction('dossier_agent', 'update_document', {
                  caseId: caseData.id, documentId: doc.id, fields: { status: 'active' },
                });
                if (r?.success) toast.success(`«${doc.name}» відновлено`);
                else toast.error('Не вдалось відновити', { description: r?.error });
              }}
              onRestoreAll={async () => {
                const ok = await systemConfirm(`Відновити всі ${archivedDocuments.length} документів з архіву?`);
                if (!ok || !onExecuteAction) return;
                for (const doc of archivedDocuments) {
                  await onExecuteAction('dossier_agent', 'update_document', {
                    caseId: caseData.id, documentId: doc.id, fields: { status: 'active' },
                  });
                }
                toast.success(`Відновлено документів: ${archivedDocuments.length}`);
                setShowArchived(false);
                setSelectedArchivedIds(new Set());
              }}
              onRestoreSelected={async () => {
                if (!onExecuteAction) return;
                const ids = Array.from(selectedArchivedIds);
                for (const id of ids) {
                  await onExecuteAction('dossier_agent', 'update_document', {
                    caseId: caseData.id, documentId: id, fields: { status: 'active' },
                  });
                }
                toast.success(`Відновлено документів: ${ids.length}`);
                setSelectedArchivedIds(new Set());
              }}
              onDeleteOne={async (doc) => {
                const ok = await systemConfirm(`Видалити «${doc.name}» назавжди? Файл зникне з Drive і реєстру.`);
                if (!ok || !onExecuteAction) return;
                const r = await onExecuteAction('dossier_agent', 'delete_document', {
                  caseId: caseData.id, documentId: doc.id, mode: 'full', _fromUI: true,
                });
                if (r?.success) toast.success(`«${doc.name}» видалено повністю`);
                else toast.error('Не вдалось видалити', { description: r?.error });
              }}
              onDeleteAll={async () => {
                const ok = await systemConfirm(`Видалити назавжди всі ${archivedDocuments.length} архівних документів? Файли зникнуть з Drive.`);
                if (!ok || !onExecuteAction) return;
                for (const doc of archivedDocuments) {
                  await onExecuteAction('dossier_agent', 'delete_document', {
                    caseId: caseData.id, documentId: doc.id, mode: 'full', _fromUI: true,
                  });
                }
                toast.success(`Видалено документів: ${archivedDocuments.length}`);
                setShowArchived(false);
                setSelectedArchivedIds(new Set());
              }}
              onDeleteSelected={async () => {
                const ids = Array.from(selectedArchivedIds);
                const ok = await systemConfirm(`Видалити назавжди ${ids.length} обраних документів? Файли зникнуть з Drive.`);
                if (!ok || !onExecuteAction) return;
                for (const id of ids) {
                  await onExecuteAction('dossier_agent', 'delete_document', {
                    caseId: caseData.id, documentId: id, mode: 'full', _fromUI: true,
                  });
                }
                toast.success(`Видалено документів: ${ids.length}`);
                setSelectedArchivedIds(new Set());
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
                      <div key={doc.id} onClick={() => setSelectedDoc(doc)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px 6px 18px", borderRadius: 'var(--radius-sm)', cursor: "pointer", background: selectedDoc?.id === doc.id ? "var(--color-surface-2)" : "transparent", border: `1px solid ${selectedDoc?.id === doc.id ? "var(--color-accent)" : "transparent"}`, marginBottom: 2, transition: "all .15s" }}>
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
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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

              <div style={{ flex: 1, overflowY: "auto", padding: 6 }}>
                {filteredDocs.length === 0 ? (
                  <div style={{ padding: 'var(--space-5)', textAlign: "center", color: "var(--color-text-3)", fontSize: 12 }}>{"Немає документів"}</div>
                ) : filteredDocs.map(doc => {
                  const proc = proceedings.find(p => p.id === doc.procId);
                  return (
                    <div key={doc.id} onClick={() => setSelectedDoc(doc)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 'var(--radius-sm)', cursor: "pointer", background: selectedDoc?.id === doc.id ? "var(--color-surface-2)" : "transparent", border: `1px solid ${selectedDoc?.id === doc.id ? "var(--color-accent)" : "transparent"}`, marginBottom: 2, borderLeft: proc?.type === "appeal" ? "3px solid rgba(59,130,246,.45)" : proc?.type === "cassation" ? "3px solid rgba(243,156,18,.45)" : "1px solid transparent", transition: "all .15s" }}>
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
          {storageState?.driveFolderId ? (
            <button onClick={() => window.open(`https://drive.google.com/drive/folders/${storageState.driveFolderId}`, "_blank")} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 'var(--radius-xs)', fontWeight: 600, background: "rgba(79,124,255,.12)", color: "var(--color-accent)", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }} title={storageState.driveFolderName || "Drive папка"}><Cloud size={ICON_SIZE.xs} /><span>Drive</span><Link2 size={ICON_SIZE.xs} /></button>
          ) : (
            <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 'var(--radius-xs)', fontWeight: 600, background: "rgba(231,76,60,.1)", color: "var(--color-danger)", display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={ICON_SIZE.xs} /><span>Без папки</span></span>
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
        {/* Основний вміст вкладки */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto', minWidth: 0 }}>
          {activeTab === "overview" && renderOverview()}
          {activeTab === "materials" && renderMaterials()}
          {activeTab === "docwork" && (
            <DocumentProcessorV2
              caseData={caseData}
              onExecuteAction={onExecuteAction}
              driveConnected={driveConnected}
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
        onSubmit={async ({ name, category, author, procId, date, isKey, file, mergeArtifacts }) => {
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

          const pipeline = createDocumentPipeline({
            convertToPdf,
            uploadFile: uploadFileLocal,
            createDocument,
            buildDocumentMetadata,
            persistDocument: async ({ caseId, document }) => {
              if (onExecuteAction) {
                return await onExecuteAction('dossier_agent', 'add_document', { caseId, document });
              }
              const updated = [...(caseData.documents || []), document];
              updateCase && updateCase(caseData.id, 'documents', updated);
              return { success: true };
            },
            eventBus,
            topics: { DOCUMENT_INGESTED, DOCUMENT_BATCH_PROCESSED },
            getActor: () => {
              const u = (typeof getCurrentUser === 'function' && getCurrentUser()) || {};
              return { userId: u.userId ?? null, tenantId: u.tenantId ?? null };
            },
          });

          const result = await pipeline.run({
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
          });

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
          // innerText). Document AI НЕ викликаємо: пишемо .txt у 02_ОБРОБЛЕНІ
          // напряму (та сама назва — getCachedText знайде при відкритті).
          if (extractedText) {
            toast.success('Документ додано');
            try {
              const written = await ocrService.writeExtractedTextArtifact(ocrFile, extractedText);
              if (!written) {
                toast.warning('Текст витягнуто, але не вдалось зберегти кеш на Drive', {
                  description: 'При відкритті документа текст можна витягти повторно',
                });
              }
            } catch (e) {
              console.warn('[writeExtractedTextArtifact] failed:', e?.message || e);
            }
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
