import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import Dashboard from './components/Dashboard';
import CaseDossier from './components/CaseDossier';
import { backupRegistryData, backupRegistryDataPreSaas, backupRegistryDataPreV3, backupActionLogPreCleanup, backupRegistryDataPreBilling, backupLegacyTimelogPreImport } from './services/driveService';
import { DEFAULT_TENANT, DEFAULT_USER, getCurrentUser, getCurrentUserId, getCurrentTenantId } from './services/tenantService';
import { checkTenantAccess, checkRolePermission, checkCaseAccess } from './services/permissionService';
import { writeAuditLog as writeAuditLogService, updateAuditLogStatus, shouldAudit } from './services/auditLogService';
import { migrateRegistry, ensureCaseSaasFields, CURRENT_SCHEMA_VERSION, MIGRATION_VERSION, importLegacyTimeLog } from './services/migrationService';
import { driveRequest, refreshDriveToken, GOOGLE_CLIENT_ID as DRIVE_CLIENT_ID, DRIVE_SCOPE as DRIVE_SCOPE_IMPORT } from './services/driveAuth';
import { logAiUsage } from './services/aiUsageService';
import { resolveModel } from './services/modelResolver';
import * as activityTracker from './services/activityTracker';
import * as masterTimer from './services/masterTimer';
import { getTimeStandard, getCategoryDefaults, getVariantDefault } from './services/timeStandards';
import { checkAndArchive as checkAndArchiveTimeEntries } from './services/timeEntriesArchiver';
import { handleReturn as smartHandleReturn } from './services/smartReturnHandler';
import { MODULES, categoryForCase } from './services/moduleNames';
import { SystemModalRoot, systemAlert, systemConfirm } from './components/SystemModal';
import './App.css';

const Notebook = React.lazy(() => import('./components/Notebook'));

class ModuleErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: '#9aa0b8' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <div>Модуль тимчасово недоступний</div>
          <div style={{ fontSize: 12, marginTop: 8 }}>Решта системи працює</div>
        </div>
      );
    }
    return this.props.children;
  }
}

class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) return (
      <div style={{padding:20,color:"#e74c3c",fontSize:13}}>
        ⚠️ Помилка: {this.state.error?.message}
        <pre style={{fontSize:10,marginTop:8}}>{this.state.error?.stack?.slice(0,300)}</pre>
        <button onClick={()=>this.setState({hasError:false,error:null})}>Спробувати знову</button>
      </div>
    );
    return this.props.children;
  }
}

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// Коротке ім'я справи з повного ПІБ: "Брановський І.В."
function extractShortName(fullName) {
  if (!fullName) return '';
  const clean = fullName.replace(/\(.*?\)/g, '').replace(/,.*$/, '').trim();
  const withoutLev = clean.replace(/левицьк\S+\s+\S+\s+\S+\s*/gi, '').trim();
  const parts = withoutLev.split(/\s+/);
  if (parts.length >= 2) {
    const lastName = parts[0];
    const initials = parts.slice(1)
      .map(p => p[0] ? p[0].toUpperCase() + '.' : '')
      .join('');
    return `${lastName} ${initials}`;
  }
  return withoutLev || fullName;
}


// ── MOCK DATA ─────────────────────────────────────────────────────────────────
const today = new Date();
const d = (daysFromNow) => {
  const dt = new Date(today);
  dt.setDate(dt.getDate() + daysFromNow);
  return dt.toISOString().split('T')[0];
};

// Хелпер для створення засідання в INITIAL_CASES
const mkHearing = (daysFromNow, court, status = 'scheduled') => daysFromNow != null ? [{
  id: `hrg_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
  date: d(daysFromNow), time: '10:00', court, notes: '', status
}] : [];

const INITIAL_CASES = [
  { id:'case_1',  name:'Салун',            client:'Салун Ж./Салун І.',  category:'civil',    status:'active',  court:'Рівненський райсуд',        case_no:'363/2241/24', hearings:mkHearing(2,'Рівненський райсуд'),  deadline:d(1),  deadline_type:'Заява про витрати (ст.141)',  next_action:'Подати заяву про судові витрати', notes:'', pinnedNoteIds:[] },
  { id:'case_2',  name:'Корева',           client:'Корева М.В.',        category:'military', status:'active',  court:'Костопільський райсуд',      case_no:'560/1891/25', hearings:mkHearing(5,'Костопільський райсуд'),  deadline:d(3),  deadline_type:'Адвокатський запит до в/ч',   next_action:'Надіслати запит до МОУ',          notes:'', pinnedNoteIds:[] },
  { id:'case_3',  name:'Рубан',            client:'Рубан О.П.',         category:'civil',    status:'active',  court:'Печерський райсуд м.Київ',   case_no:'757/3312/23', hearings:mkHearing(8,'Печерський райсуд м.Київ'),  deadline:d(6),  deadline_type:'Відповідь на позов',          next_action:'Підготувати заперечення',         notes:'', pinnedNoteIds:[] },
  { id:'case_4',  name:'Брановський',      client:'Брановський В.І.',   category:'civil',    status:'active',  court:'Господарський суд Київ',     case_no:'910/4521/24', hearings:mkHearing(12,'Господарський суд Київ'), deadline:d(10), deadline_type:'Апеляційна скарга',           next_action:'Подати апеляцію',                 notes:'', pinnedNoteIds:[],
    proceedings: [
      { id: "proc_main", type: "first", title: "Основне провадження", court: "Пустомитівський районний суд Львівської обл.", status: "paused", parentProcId: null, parentEventId: null },
      { id: "proc_appeal_1", type: "appeal", title: "Апеляція: ухвала 03.2024", court: "Київський апеляційний суд", status: "active", parentProcId: "proc_main", parentEventId: "event_4" }
    ],
    documents: [
      { id: "1",  procId: "proc_main", name: "Позовна заява", icon: "📄", date: "березень 2023", category: "pleading", author: "ours", tags: ["key"], notes: "" },
      { id: "2",  procId: "proc_main", name: "Ухвала про відкриття провадження", icon: "📋", date: "березень 2023", category: "court_act", author: "court", tags: [], notes: "" },
      { id: "3",  procId: "proc_main", name: "Протокол підготовчого засідання", icon: "📋", date: "грудень 2023", category: "court_act", author: "court", tags: [], notes: "" },
      { id: "4",  procId: "proc_main", name: "Зустрічна позовна заява", icon: "📄", date: "лютий 2024", category: "pleading", author: "opponent", tags: [], notes: "" },
      { id: "5",  procId: "proc_main", name: "Клопотання про поновлення строку", icon: "📄", date: "лютий 2024", category: "motion", author: "opponent", tags: [], notes: "" },
      { id: "6",  procId: "proc_main", name: "Ухвала про відмову у прийнятті зустрічного позову", icon: "📋", date: "березень 2024", category: "court_act", author: "court", tags: ["key"], notes: "" },
      { id: "7",  procId: "proc_main", name: "Ухвала про зупинення провадження", icon: "📋", date: "квітень 2024", category: "court_act", author: "court", tags: [], notes: "" },
      { id: "8",  procId: "proc_appeal_1", name: "Апеляційна скарга на ухвалу", icon: "📤", date: "квітень 2024", category: "pleading", author: "opponent", tags: ["key"], notes: "" },
      { id: "9",  procId: "proc_appeal_1", name: "Квитанція про сплату судового збору", icon: "🧾", date: "квітень 2024", category: "other", author: "opponent", tags: [], notes: "" },
      { id: "10", procId: "proc_appeal_1", name: "Відзив на апеляційну скаргу", icon: "📩", date: "травень 2024", category: "pleading", author: "ours", tags: ["key"], notes: "" },
      { id: "11", procId: "proc_appeal_1", name: "Заперечення на відзив", icon: "↩️", date: "червень 2024", category: "pleading", author: "opponent", tags: [], notes: "⚠️ Лікарняний лист — перевірити автентичність" },
      { id: "12", procId: "proc_appeal_1", name: "Відповідь на заперечення", icon: "↪️", date: "липень 2024", category: "pleading", author: "ours", tags: [], notes: "" }
    ]
  },
  { id:'case_5',  name:'Нестеренко',       client:'Нестеренко Г.С.',    category:'criminal', status:'active',  court:'Рівненський апеляційний суд',case_no:'190/887/24',  hearings:mkHearing(15,'Рівненський апеляційний суд'), deadline:null,  deadline_type:null,                          next_action:'Підготувати клопотання',          notes:'', pinnedNoteIds:[] },
  { id:'case_6',  name:'Голобля',          client:'Голобля Т.В.',       category:'civil',    status:'active',  court:'Костопільський райсуд',      case_no:'560/2109/25', hearings:mkHearing(18,'Костопільський райсуд'), deadline:d(16), deadline_type:'Процесуальна заява',          next_action:'Надіслати заяву',                 notes:'', pinnedNoteIds:[] },
  { id:'case_7',  name:'Манолюк',          client:'Манолюк В.О.',       category:'admin',    status:'active',  court:'Рівненський окружний адмінсуд',case_no:'460/5543/24',hearings:mkHearing(20,'Рівненський окружний адмінсуд'), deadline:null,  deadline_type:null,                          next_action:'Чекаємо на ухвалу суду',          notes:'', pinnedNoteIds:[] },
  { id:'case_8',  name:'Голдбері',         client:'Голдбері О.Ю.',      category:'civil',    status:'active',  court:'Рівненський райсуд',        case_no:'363/4412/23', hearings:mkHearing(22,'Рівненський райсуд'), deadline:d(20), deadline_type:'Відповідь на апеляцію',       next_action:'Підготувати відзив',              notes:'', pinnedNoteIds:[] },
  { id:'case_9',  name:'Кісельова',        client:'Кісельова Н.І.',     category:'civil',    status:'active',  court:'Київський апеляційний суд',  case_no:'22-ц/824/22', hearings:mkHearing(25,'Київський апеляційний суд'), deadline:null,  deadline_type:null,                          next_action:'Очікуємо засідання',             notes:'', pinnedNoteIds:[] },
  { id:'case_10', name:'Смолій Андрій',    client:'Смолій А.В.',        category:'criminal', status:'active',  court:'Рівненський суд присяжних',  case_no:'190/2345/24', hearings:mkHearing(28,'Рівненський суд присяжних'), deadline:null,  deadline_type:null,                          next_action:'Підготувати позицію захисту',    notes:'', pinnedNoteIds:[] },
  { id:'case_11', name:'Варфоломєєв',      client:'Варфоломєєв С.М.',   category:'civil',    status:'active',  court:'Костопільський райсуд',      case_no:'560/3341/25', hearings:mkHearing(30,'Костопільський райсуд'), deadline:d(28), deadline_type:'Клопотання про докази',       next_action:'Подати клопотання',              notes:'', pinnedNoteIds:[] },
  { id:'case_12', name:'Липовцев',         client:'Липовцев І.О.',      category:'civil',    status:'active',  court:'Рівненський райсуд',        case_no:'363/1122/24', hearings:[],  deadline:d(7),  deadline_type:'Позовна заява',               next_action:'Подати позов',                   notes:'', pinnedNoteIds:[] },
  { id:'case_13', name:'Цзян',             client:'Цзян Хуей',          category:'admin',    status:'active',  court:'Київський окружний адмінсуд',case_no:'640/8821/25', hearings:mkHearing(35,'Київський окружний адмінсуд'), deadline:null,  deadline_type:null,                          next_action:'Очікуємо відповідь',             notes:'', pinnedNoteIds:[] },
  { id:'case_14', name:'Бабенко',          client:'Бабенко О.В.',       category:'civil',    status:'active',  court:'Печерський райсуд м.Київ',   case_no:'757/9012/24', hearings:mkHearing(40,'Печерський райсуд м.Київ'), deadline:null,  deadline_type:null,                          next_action:'Підготовка документів',          notes:'', pinnedNoteIds:[] },
  { id:'case_15', name:'Конах',            client:'Конах В.П.',         category:'military', status:'active',  court:'Костопільський райсуд',      case_no:'560/4453/25', hearings:mkHearing(14,'Костопільський райсуд'), deadline:d(12), deadline_type:'Запит до ТЦК',               next_action:'Надіслати запит',                notes:'', pinnedNoteIds:[] },
  { id:'case_16', name:'Сипко',            client:'Сипко Р.Д.',         category:'criminal', status:'paused',  court:'Рівненський суд',            case_no:'190/5544/23', hearings:[],  deadline:null,  deadline_type:null,                          next_action:'Очікуємо процесуального рішення',notes:'', pinnedNoteIds:[] },
  { id:'case_17', name:'Квант',            client:'ТОВ «Квант»',        category:'admin',    status:'active',  court:'Господарський суд Рівне',    case_no:'918/2211/25', hearings:mkHearing(45,'Господарський суд Рівне'), deadline:null,  deadline_type:null,                          next_action:'Підготовка позиції',             notes:'', pinnedNoteIds:[] },
  { id:'case_18', name:'Янченко',          client:'Янченко Л.С.',       category:'civil',    status:'active',  court:'Рівненський райсуд',        case_no:'363/7734/24', hearings:mkHearing(50,'Рівненський райсуд'), deadline:null,  deadline_type:null,                          next_action:'Збираємо докази',                notes:'', pinnedNoteIds:[] },
  { id:'case_19', name:'Махді',            client:'Махді Карім',        category:'admin',    status:'active',  court:'Київський окружний адмінсуд',case_no:'640/3312/25', hearings:mkHearing(55,'Київський окружний адмінсуд'), deadline:null,  deadline_type:null,                          next_action:'Очікуємо ухвали',                notes:'', pinnedNoteIds:[] },
  { id:'case_20', name:'Колесник',         client:'Колесник Н.О.',      category:'civil',    status:'active',  court:'Рівненський апеляційний суд',case_no:'22-ц/824/8821/24', hearings:mkHearing(60,'Рівненський апеляційний суд'), deadline:null, deadline_type:null,                   next_action:'Підготовка апеляції',            notes:'', pinnedNoteIds:[] },
];

// ── HELPERS ───────────────────────────────────────────────────────────────────
const CAT_LABELS = { civil:'Цивільна', criminal:'Кримінальна', military:'Військова', admin:'Адміністративна' };
const STATUS_LABELS = { active:'Активна', paused:'Призупинена', closed:'Закрита' };

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = Math.ceil((new Date(dateStr) - today) / 86400000);
  return diff;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('uk-UA', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function urgencyClass(days) {
  if (days === null) return null;
  if (days < 0) return 'urgent';
  if (days <= 3) return 'urgent';
  if (days <= 7) return 'warn';
  return null;
}

function daysChipClass(days) {
  if (days === null) return 'days-ok';
  if (days < 0) return 'days-red';
  if (days <= 3) return 'days-red';
  if (days <= 7) return 'days-orange';
  if (days <= 14) return 'days-yellow';
  return 'days-ok';
}

function daysLabel(days) {
  if (days === null) return '';
  if (days < 0) return `${Math.abs(days)} дн тому`;
  if (days === 0) return 'сьогодні';
  if (days === 1) return 'завтра';
  return `${days} дн`;
}

// Знайти найближче заплановане засідання зі справи
function getNextHearing(c) {
  if (!Array.isArray(c.hearings) || c.hearings.length === 0) return null;
  const todayStr = new Date().toISOString().split('T')[0];
  const scheduled = c.hearings
    .filter(h => h.status === 'scheduled' && h.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date));
  return scheduled[0] || null;
}

// Сумісний доступ до дати/часу засідання (для поступової міграції)
function getHearingDate(c) {
  const next = getNextHearing(c);
  return next ? next.date : null;
}
function getHearingTime(c) {
  const next = getNextHearing(c);
  return next ? next.time : null;
}

// Найближчий дедлайн справи
function getNextDeadline(caseItem) {
  if (!Array.isArray(caseItem.deadlines) || caseItem.deadlines.length === 0) return null;
  const today = new Date().toISOString().split('T')[0];
  return caseItem.deadlines
    .filter(d => d.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}

// Сумісний доступ до дати дедлайну (для поступової міграції з c.deadline)
function getDeadlineDate(c) {
  const next = getNextDeadline(c);
  return next ? next.date : null;
}

// ── COMPONENTS ────────────────────────────────────────────────────────────────

function CaseCard({ c, onClick }) {
  const hDate = getHearingDate(c);
  const hearingDays = daysUntil(hDate);
  const deadlineDays = daysUntil(getDeadlineDate(c));
  const urg = urgencyClass(deadlineDays) || urgencyClass(hearingDays);

  return (
    <div className={`case-card cat-${c.category}`} onClick={() => onClick()}>
      <div className="case-card-top">
        <div className="case-card-name">{c.name}</div>
        <div className="case-card-badges">
          <span className={`badge badge-${c.category}`}>{CAT_LABELS[c.category]}</span>
          <span className={`badge badge-${c.status}`}>{STATUS_LABELS[c.status]}</span>
        </div>
      </div>
      <div className="case-card-rows">
        <div className="case-row">
          <span className="case-row-icon">👤</span>
          <span className="case-row-label">{c.client}</span>
        </div>
        <div className="case-row">
          <span className="case-row-icon">🏛</span>
          <span className="case-row-label" style={{fontSize:'11px', color:'var(--text2)'}}>{c.court}</span>
        </div>
        {hDate && (
          <div className="case-row">
            <span className="case-row-icon">📅</span>
            <span className="case-row-label">Засідання:</span>
            <span className={`case-row-val ${urgencyClass(hearingDays) || ''}`}>
              {formatDate(hDate)}
              {hearingDays !== null && <span style={{marginLeft:5,fontSize:'10px',opacity:0.7}}>({daysLabel(hearingDays)})</span>}
            </span>
          </div>
        )}
        {getDeadlineDate(c) && (
          <div className="case-row">
            <span className="case-row-icon">⚡</span>
            <span className="case-row-label">Дедлайн:</span>
            <span className={`case-row-val ${urgencyClass(deadlineDays) || ''}`}>
              {formatDate(getDeadlineDate(c))}
              {deadlineDays !== null && <span style={{marginLeft:5,fontSize:'10px',opacity:0.7}}>({daysLabel(deadlineDays)})</span>}
            </span>
          </div>
        )}
        {getNextDeadline(c)?.name && (
          <div className="case-row">
            <span className="case-row-icon" style={{opacity:0}}>·</span>
            <span className="case-row-label" style={{fontSize:'11px',color:'var(--text3)',fontStyle:'italic'}}>{getNextDeadline(c).name}</span>
          </div>
        )}
        <div className="case-row" style={{marginTop:2}}>
          <span className="case-row-icon">→</span>
          <span className="case-row-label" style={{fontSize:'11px',color:'var(--text2)'}}>{c.next_action}</span>
        </div>
      </div>
    </div>
  );
}

function CaseModal({ c, onClose, onEdit, onDelete, onCloseCase, onRestore }) {
  const hDate = getHearingDate(c);
  const hTime = getHearingTime(c);
  const hearingDays = daysUntil(hDate);
  const deadlineDays = daysUntil(getDeadlineDate(c));
  const nextDl = getNextDeadline(c);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap'}}>
          <span className={`badge badge-${c.category}`}>{CAT_LABELS[c.category]}</span>
          <span className={`badge badge-${c.status}`}>{STATUS_LABELS[c.status]}</span>
        </div>
        <div className="modal-title">{c.name}</div>
        <div className="modal-sub">{c.client} · {c.case_no}</div>

        <div className="modal-section">
          <div className="modal-section-title">Реквізити справи</div>
          <div className="modal-field"><span className="modal-field-label">Суд</span><span className="modal-field-val">{c.court}</span></div>
          <div className="modal-field"><span className="modal-field-label">Номер справи</span><span className="modal-field-val">{c.case_no}</span></div>
          <div className="modal-field"><span className="modal-field-label">Категорія</span><span className="modal-field-val">{CAT_LABELS[c.category]}</span></div>
        </div>

        <div className="modal-section">
          <div className="modal-section-title">Дати і строки</div>
          <div className="modal-field">
            <span className="modal-field-label">Наступне засідання</span>
            <span className={`modal-field-val ${urgencyClass(hearingDays) || ''}`}>
              {formatDate(hDate)}
              {hTime && <span style={{marginLeft:6}}>о {hTime}</span>}
              {hearingDays !== null && <span style={{marginLeft:6,fontSize:'11px',opacity:0.7}}>({daysLabel(hearingDays)})</span>}
            </span>
          </div>
          {nextDl && (
            <div className="modal-field">
              <span className="modal-field-label">Дедлайн</span>
              <span className={`modal-field-val ${urgencyClass(deadlineDays) || ''}`}>
                {formatDate(nextDl.date)}
                {deadlineDays !== null && <span style={{marginLeft:6,fontSize:'11px',opacity:0.7}}>({daysLabel(deadlineDays)})</span>}
                {nextDl.name && <span style={{marginLeft:6,fontSize:'11px',color:'var(--text3)',fontStyle:'italic'}}>({nextDl.name})</span>}
              </span>
            </div>
          )}
        </div>

        <div className="modal-section">
          <div className="modal-section-title">Поточний стан</div>
          <div className="modal-field"><span className="modal-field-label">Наступна дія</span><span className="modal-field-val">{c.next_action}</span></div>
          {(() => {
            const text = Array.isArray(c.notes)
              ? c.notes.map(n => n.text).filter(Boolean).join('\n')
              : (typeof c.notes === 'string' ? c.notes : '');
            return text ? <div className="modal-field"><span className="modal-field-label">Нотатки</span><span className="modal-field-val">{text}</span></div> : null;
          })()}
        </div>

        <div className="modal-actions">
          <button className="btn-lg primary" onClick={() => onEdit(c)}>✏️ Редагувати</button>
          <button className="btn-lg secondary">📁 Google Drive</button>
          <button className="btn-lg secondary">📄 Генерувати документ</button>
          <button className="btn-lg secondary">💡 Ідея для контенту</button>
          {c.status !== 'closed' && (
            <button className="btn-lg secondary" onClick={async () => {
              if (await systemConfirm("Закрити справу? Вона перейде в архів. Видалити можна буде звідти.", "Закриття справи")) {
                onCloseCase(c.id);
                onClose();
              }
            }}>📦 Закрити справу</button>
          )}
          {c.status === 'closed' && (
            <>
              <button className="btn-lg secondary" onClick={() => { onRestore(c.id); onClose(); }} style={{color:'#2ecc71',borderColor:'rgba(46,204,113,.3)'}}>↩ Відновити</button>
              <button className="btn-lg danger" onClick={() => onDelete(c)}>🗑 Видалити назавжди</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── CALENDAR ─────────────────────────────────────────────────────────────────
function Calendar({ cases, onSelectCase }) {
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(null);
  const openCase = (c) => { usageLog.log('open_case', {name: c.name}); setSelected(c); };

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;

  const eventsByDate = useMemo(() => {
    const map = {};
    cases.forEach(c => {
      const hDate = getHearingDate(c);
      if (hDate) {
        if (!map[hDate]) map[hDate] = [];
        map[hDate].push({ ...c, eventType:'hearing' });
      }
      (c.deadlines || []).forEach(dl => {
        if (dl.date) {
          if (!map[dl.date]) map[dl.date] = [];
          map[dl.date].push({ ...c, eventType:'deadline', deadlineName: dl.name });
        }
      });
    });
    return map;
  }, [cases]);

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const monthStr = viewDate.toLocaleDateString('uk-UA', { month:'long', year:'numeric' });

  const selectedDateStr = selected ? `${year}-${String(month+1).padStart(2,'0')}-${String(selected).padStart(2,'0')}` : null;
  const selectedEvents = selectedDateStr ? (eventsByDate[selectedDateStr] || []) : [];

  // upcoming events this month
  const upcomingEvents = useMemo(() => {
    return Object.entries(eventsByDate)
      .filter(([date]) => {
        const d = new Date(date);
        return d.getFullYear() === year && d.getMonth() === month;
      })
      .sort(([a],[b]) => a.localeCompare(b))
      .flatMap(([date, evts]) => evts.map(e => ({...e, date})))
      .slice(0, 8);
  }, [eventsByDate, year, month]);

  return (
    <div>
      <div className="cal-wrap">
        <div className="cal-header">
          <div className="cal-month" style={{textTransform:'capitalize'}}>{monthStr}</div>
          <div className="cal-nav">
            <button className="cal-nav-btn" onClick={() => setViewDate(new Date(year, month-1, 1))}>‹</button>
            <button className="cal-nav-btn" onClick={() => { setViewDate(new Date(today.getFullYear(), today.getMonth(), 1)); setSelected(null); }}>●</button>
            <button className="cal-nav-btn" onClick={() => setViewDate(new Date(year, month+1, 1))}>›</button>
          </div>
        </div>
        <div className="cal-grid">
          {['Пн','Вт','Ср','Чт','Пт','Сб','Нд'].map(d => <div key={d} className="cal-dow">{d}</div>)}
          {cells.map((day, i) => {
            if (!day) return <div key={`e${i}`} />;
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const evts = eventsByDate[dateStr] || [];
            const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
            const isUrgent = evts.some(e => daysUntil(dateStr) !== null && daysUntil(dateStr) <= 3);
            return (
              <div key={day}
                className={`cal-day${isToday?' today':''}${evts.length?' has-event':''}${isUrgent?' urgent':''}${selected===day?' selected':''}`}
                onClick={() => setSelected(selected===day ? null : day)}>
                {day}
              </div>
            );
          })}
        </div>

        {selected && selectedEvents.length > 0 && (
          <div className="cal-events" style={{marginTop:12}}>
            <div className="section-title" style={{marginBottom:8}}>
              {new Date(selectedDateStr).toLocaleDateString('uk-UA', {day:'2-digit',month:'long'})}
            </div>
            {selectedEvents.map((e,i) => (
              <div key={i} className={`cal-event${e.eventType==='deadline'?' deadline':''}`}
                onClick={() => onSelectCase(e)}>
                <div>
                  <div className="cal-event-name">{e.name}</div>
                  <div className="cal-event-sub">{e.eventType==='hearing'?'Засідання':'Дедлайн'} · {e.court}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>


    </div>
  );
}

// ── QUICK INPUT v2 ────────────────────────────────────────────────────────────

// Для Haiku — аналіз документів, тільки JSON
const HAIKU_SYSTEM_PROMPT = `You are a legal document intake parser for a Ukrainian law office (Advocate Bureau Levytskyi, Kyiv).

Current year: ${new Date().getFullYear()}. Today: ${new Date().toISOString().split('T')[0]}.

Your ONLY output must be a single valid JSON object. No text before. No text after. No markdown. No explanations.

Your task:
1. Classify the input (subpoena, court document, new case document, note, or unknown)
2. Extract all relevant legal/court data
3. Match to an existing case if possible (the user message will list existing case names)
4. Recommend system actions

Return this exact JSON structure:
{
  "input_type": "subpoena | document | new_case | note | unknown",
  "source_type": "text | pdf | image | screenshot | file",
  "processing_status": "success | partial | failed",
  "case_match": {
    "found": true or false,
    "case_name": "string or null",
    "confidence": 0.0 to 1.0
  },
  "extracted": {
    "case_number": "string or null",
    "court": "string or null",
    "judge": "string or null",
    "hearing_date": "YYYY-MM-DD or null",
    "hearing_time": "HH:MM or null",
    "deadline_date": "YYYY-MM-DD or null",
    "deadline_type": "string or null",
    "deadlines": [],
    "person": "string or null"
  },
  "recommended_actions": ["update_case_date", "update_deadline", "update_case_field", "create_case", "save_note", "update_case_status"],
  "human_message": "Short Ukrainian-language summary for the lawyer",
  "warnings": [],
  "confidence": 0.0 to 1.0,
  "needs_review": true or false
}

Rules:
- case_name must be SHORT: last name + initials of the CLIENT only (e.g. "Дордоль С.К.")
- The client is: the accused/suspect if Levytskyi is defender; the plaintiff if Levytskyi is plaintiff's representative; the defendant if Levytskyi is defendant's representative
- Extract client's last name and initials from the person field
- case_name format: "Прізвище І.Б." — never include Levytskyi's name in case_name
- If person field contains full name like "Дордоль Сергій Карлович" → case_name = "Дордоль С.К."
- Unknown field = null, never invent values
- If unsure about anything = needs_review: true
- hearing_date must be YYYY-MM-DD format
- human_message must be in Ukrainian
- recommended_actions must only contain values from the allowed list above: update_case_date, update_deadline, create_case, save_note, update_case_status
- Use update_case_date when document contains a HEARING date (судове засідання)
- Use update_deadline when document contains a DEADLINE for filing/response (процесуальний строк, дедлайн подачі)
- extracted.deadline_date — дата дедлайну (YYYY-MM-DD)
- extracted.deadline_type — тип дедлайну (напр. "Відзив", "Апеляція", "Процесуальний строк")
- If input is clearly just a note or unrecognized = input_type: "note", recommended_actions: ["save_note"]

ПРАВИЛО ДОСЛІВНОСТІ (КРИТИЧНЕ):
- Записуй ТІЛЬКИ те що є в тексті документа. Дослівно, як написано.
- НІКОЛИ не розшифровуй статті КК, ЦПК, КПК, ЦК, ГК, КУпАП та інших кодексів.
  Якщо в документі написано "ст. 122 КК" — пиши "ст. 122 КК", а не "крадіжка".
  Якщо написано "ч. 2 ст. 185 КК" — так і пиши, не додавай "(грабіж)".
- НЕ додавай інтерпретацій, пояснень, дефініцій, контексту або висновків
  яких немає в тексті документа.
- НЕ домислюй назви процесуальних дій якщо вони не написані явно.
- Якщо інформації нема в документі — поле = null, а не вгадане значення.
- deadline_type, next_action, court, judge, person — тільки дослівні цитати з тексту.

- Never output anything except the JSON object`;

// Для Sonnet — чат-команди, розмовна мова
const SONNET_CHAT_PROMPT = `You are an AI assistant for a Ukrainian law office (Advocate Bureau Levytskyi, Kyiv).

Перед будь-якою дією — звір те що збираєшся зробити з тим що є в реєстрі.
Якщо є суперечність між вхідними даними і реальністю — повідом адвоката одним чітким питанням і чекай відповіді.
Не вигадуй і не обирай мовчки. Незворотні дії (видалення) — завжди підтверджуй.

You help the lawyer manage cases through natural voice and text commands.
You have full context of all cases in the registry, provided in each message.
Use this context to answer questions about specific cases, deadlines, hearings.
You can answer: "when is the next hearing for Бабенко", "what is urgent today",
"what needs to be done for Рубан", "which cases have no deadline".

Current year: ${new Date().getFullYear()}. Today: ${new Date().toISOString().split('T')[0]}.

When the user gives you a command:
- Respond conversationally in Ukrainian (1-3 sentences)
- If a system action is needed, append on a NEW LINE: ACTION_JSON: {"recommended_actions": ["action_id"], "extracted": {"case_name": "...", "hearing_date": "YYYY-MM-DD", "hearing_time": "HH:MM"}}
- Available action_ids: update_hearing, add_hearing, delete_hearing, update_deadline, add_deadline, delete_deadline, save_note, create_case, close_case, restore_case, update_case_status, update_case_field, delete_case
- update_hearing: ПЕРЕНЕСТИ існуюче засідання (нова дата/час) — для команд "перенеси", "змінити дату засідання"
- add_hearing: ДОДАТИ нове засідання — для команд "додай засідання", "нове засідання"
- delete_hearing: ВИДАЛИТИ засідання — для команд "видали засідання", "скасуй засідання"
- update_case_date — ЛЕГАСІ alias до update_hearing; не використовуй якщо можеш обрати update_hearing або add_hearing
- update_deadline: for procedural deadlines (дедлайни подачі документів, строки)
- For update_deadline use: ACTION_JSON: {"recommended_actions": ["update_deadline"], "extracted": {"case_name": "...", "deadline_date": "YYYY-MM-DD", "deadline_type": "..."}}
- update_case_field: change any case field (status, category, court, case_no, next_action, notes, hearing_time)
  ACTION_JSON: {"recommended_actions": ["update_case_field"], "extracted": {"case_name": "...", "field": "field_name", "value": "new_value"}}

  Available fields and values:
  - status: "active" | "paused" | "closed"
  - category: "civil" | "criminal" | "military" | "administrative"
  - court: string
  - case_no: string
  - next_action: string
  - notes: string
  - hearing_time: "HH:MM"

- update_case_status is an alias for update_case_field with field=status
- delete_case: delete a case from registry (requires confirmation)
  ACTION_JSON: {"recommended_actions": ["delete_case"], "extracted": {"case_name": "..."}}
- IMPORTANT: Only propose delete_case if user explicitly asks to DELETE. Always warn: this cannot be undone.
- Execute intent immediately ONLY коли таблиця уточнень (нижче) не вимагає питання.
- Only ask confirmation for: changing status to closed, deleting cases
- If case not found in the list: ask which case the user means
- If date not specified: ask for the date
- After successful action: confirm with "✅ Додано засідання у справі [назва] на [дата] о [час]"
- Remember what was discussed in the conversation history
- If the case is NOT found in the registry AND the input describes a new court matter → use create_case action, NOT update_case_date
- Only use update_case_date if the case EXISTS in the registry
- If uncertain whether case exists — propose create_case
- When creating case from chat: use short name format "Прізвище І.Б."

## ОНТОЛОГІЯ ДАНИХ

- Засідання (hearing) існує ВИКЛЮЧНО як елемент масиву hearings[] конкретної справи.
- Дедлайн (deadline) існує ВИКЛЮЧНО як елемент масиву deadlines[] конкретної справи.
- Окремих "вільних" засідань або дедлайнів у системі НЕ ІСНУЄ.
- Будь-яка дія над засіданням ОБОВ'ЯЗКОВО потребує caseId справи-власника.
- Якщо в команді справу не названо явно — визнач її одним з трьох способів і ТІЛЬКИ потім дій:
  1) шукай по даті в hearings[] усіх справ;
  2) шукай по прізвищу клієнта, суду, номеру справи;
  3) якщо неоднозначно — задай ОДНЕ уточнення "у якій справі — X чи Y?"
- ЗАБОРОНЕНО формулювання "засідання не прив'язане до справи" — кожне засідання
  у системі належить рівно одній справі.

## ПРАВИЛО УТОЧНЕНЬ (питай ТІЛЬКИ ці випадки, в інших — виконуй негайно)

add_hearing:
- Немає справи → "У якій справі?"
- Немає дати → "На яку дату?"
- Немає часу → НЕ питай. Додай без часу, скажи "час не вказано — уточни пізніше".

update_hearing (перенос):
- Немає справи → "У якій справі?"
- Є дата але немає часу → НЕ питай перед виконанням.
  Виконай перенос зі збереженням старого часу.
  У відповіді після виконання додай: "час [старий час] збережено — потрібен інший?"
  Якщо старого часу немає — додай: "час не вказано — уточни якщо потрібно".
- У справі кілька scheduled засідань → "Яке саме — [дата1] чи [дата2]?"
- Одне scheduled засідання — виконуй без питань.

Після update_hearing завжди вказуй у відповіді:
- нову дату
- час (який встановлено)
- якщо час не змінювався — додай "час збережено — потрібен інший?"

delete_hearing:
- Немає справи → "У якій справі?"
- Кілька scheduled → "Яке саме — [дата1] чи [дата2]?" НЕ обирай мовчки.
- Одне scheduled → виконуй без питань.

add_deadline:
- Немає справи → "У якій справі?"
- Немає дати → "На яку дату?"

close_case / restore_case:
- Немає справи → "Яку саме справу?"

ФОРМАТ ПИТАННЯ — одне коротке речення українською. Поки чекаєш відповіді — НЕ додавай ACTION_JSON.
ЗАБОРОНЕНО: мовчазний вибір першого варіанту коли їх кілька; "не вистачає даних" як відмовка без питання.

## ПРАВИЛА РОБОТИ З ЗАСІДАННЯМИ (hearings[])

Кожна справа має масив засідань hearings[]. Засідання мають два статуси:
- scheduled — заплановане (майбутнє або сьогоднішнє)
- completed — відбулось або минула дата (не чіпати без явної вказівки)

Статусу "cancelled" не існує. Якщо засідання не відбулось — адвокат
просто додає нотатку тією ж датою до тієї ж справи. Засідання
автоматично стає "минулим" коли дата минула.

ПЕРЕНЕСТИ засідання = update_hearing на найближче scheduled засідання.
Дата старого засідання ЗНИКАЄ — з'являється нова. Це НЕ нове засідання.

Алгоритм при команді "перенеси засідання":
1. Якщо в справі одне scheduled засідання — переносимо його без питань
2. Якщо scheduled засідань кілька — запитати ОДНЕ уточнення: "Яке саме? [дата1] чи [дата2]?"
3. Якщо користувач вказав конкретну дату — шукати по ній без питань
4. Минулі засідання (completed або дата < сьогодні) — НЕ чіпати якщо не вказано явно

ДОДАТИ засідання = add_hearing. Існуючі засідання не чіпає.
ВИДАЛИТИ засідання = delete_hearing. Вказати яке або найближче scheduled.

НІКОЛИ не плутати:
- "перенеси засідання" ≠ close_case
- "видали засідання" ≠ close_case або delete_case
- "відновити справу" ≠ питати деталі про справу

## ПРАВИЛА РОБОТИ ЗІ СТАТУСАМИ СПРАВ

Справи мають статуси: active, paused, closed.

"Закрий справу X" → close_case → статус closed
"Відновити справу X" → restore_case → статус active
  - Шукати справу в УСІХ статусах включно з closed
  - НЕ питати категорію, суд, номер — просто знайти по імені і відновити
  - Якщо знайшов в закритих — відновити одразу

## ПРАВИЛА РОБОТИ З ДЕДЛАЙНАМИ (deadlines[])

Кожна справа має масив дедлайнів deadlines[]. Кожен дедлайн має id, name, date.

"Видали дедлайн X" → delete_deadline → знайти по назві або даті і видалити
"Встанови дедлайн" → add_deadline → додати новий запис в масив
"Зміни дедлайн" → update_deadline → оновити існуючий запис (name І date разом)

ВАЖЛИВО: після виконання дії — перевірити що вона справді виконалась.
Не повідомляти про успіх якщо дія не виконана.

## ПАКЕТНІ ДІЇ (batch_update)

Якщо потрібно виконати 2 або більше дій в одній відповіді —
згенеруй ОДИН ACTION_JSON з batch_update:

ACTION_JSON: {
  "recommended_actions": ["batch_update"],
  "operations": [
    {"action": "delete_deadline", "case_name": "Брановський", "deadline_date": "2026-03-31"},
    {"action": "delete_hearing",  "case_name": "Брановський", "hearing_date":  "2026-03-31"},
    {"action": "delete_deadline", "case_name": "Корева",      "deadline_date": "2026-03-31"}
  ]
}

Кожен елемент operations[] — окрема дія з полями action, case_name і її параметрами
(deadline_date, hearing_date, hearing_time, deadline_type, field, value тощо)
у тому ж форматі що і одинична ACTION_JSON.extracted.

НЕ генеруй кілька окремих ACTION_JSON в одній відповіді.
НЕ використовуй batch_update для однієї дії — тільки для 2+.

### КОЛИ КОРИСТУВАЧ ГОВОРИТЬ ПРО ДІАПАЗОН ДАТ

Інтерпретація фраз:
- "за березень", "у березні", "березневі" → префікс "YYYY-03-" (вибрати рік з today)
- "минулий місяць" → префікс попереднього календарного місяця від today
- "цей тиждень" → понеділок..неділя поточного тижня (порівнювати по даті)
- "за останні N днів" → діапазон [today - N днів .. today]
- "видали все" / "очисти" / "почисти" → і hearings І deadlines одночасно

ПРАВИЛО: при діапазоні — пройди ВЕСЬ контекст активних справ,
знайди КОЖНУ hearing і КОЖНИЙ deadline де date починається з префікса
місяця (наприклад "2026-03-") або потрапляє в діапазон.
Кожен такий запис — окрема операція в operations[].

ПРИКЛАД ("очисти березень" коли в реєстрі знайдено 4 засідання
і 5 дедлайнів з префіксом 2026-03-):

ACTION_JSON: {
  "recommended_actions": ["batch_update"],
  "operations": [
    {"action":"delete_hearing", "case_name":"Брановський", "hearing_date":"2026-03-12"},
    {"action":"delete_hearing", "case_name":"Брановський", "hearing_date":"2026-03-31"},
    {"action":"delete_hearing", "case_name":"Корева",      "hearing_date":"2026-03-18"},
    {"action":"delete_hearing", "case_name":"Янченко",     "hearing_date":"2026-03-25"},
    {"action":"delete_deadline","case_name":"Брановський", "deadline_date":"2026-03-31"},
    {"action":"delete_deadline","case_name":"Корева",      "deadline_date":"2026-03-31"},
    {"action":"delete_deadline","case_name":"Корева",      "deadline_date":"2026-03-15"},
    {"action":"delete_deadline","case_name":"Янченко",     "deadline_date":"2026-03-22"},
    {"action":"delete_deadline","case_name":"Манолюк",     "deadline_date":"2026-03-08"}
  ]
}

ВАЖЛИВО: НЕ обмежуй пакет 3-5 операціями. Якщо в контексті 20
співпадінь — у пакеті має бути 20 операцій.
ОДНА команда = ОДНА відповідь = ОДИН ACTION_JSON з усіма ops.
Перед формуванням пакета — пройди по всіх АКТИВНИХ справах і
зібрі усі hearings[] і deadlines[] чиї дати потрапляють у діапазон.

## ПРАВИЛА РОБОТИ З НОТАТКАМИ (save_note)

Для збереження нотатки:
ACTION_JSON: {
  "recommended_actions": ["save_note"],
  "action": "save_note",
  "case_name": "Конах",
  "text": "підготувати документи до засідання 12 травня",
  "date": "2026-05-12",
  "time": "11:00"
}

Поле text ОБОВ'ЯЗКОВЕ — повний текст нотатки (не "ок", не порожнє).
Якщо нотатка без прив'язки до справи — НЕ вказуй case_name.
Поля date і time — опційні; додавай якщо адвокат назвав конкретну дату/час.
НЕ генеруй save_note без поля text. Якщо адвокат не вказав текст — спитай "що саме записати?".`;

// JSON validator — 3-pass: direct parse → regex extract → fallback
function validateAndParseJSON(rawText) {
  if (!rawText) return null;
  // Pass 1: direct
  try { return JSON.parse(rawText.trim()); } catch(e) {}
  // Pass 2: extract first {...} block
  const m = rawText.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch(e) {} }
  // Pass 3: structured fallback
  return {
    input_type: 'unknown',
    source_type: 'text',
    processing_status: 'failed',
    case_match: { found: false, case_name: null, confidence: 0 },
    extracted: { case_number: null, court: null, judge: null, hearing_date: null, hearing_time: null, deadlines: [], person: null },
    recommended_actions: ['save_note'],
    human_message: 'Не вдалося розібрати відповідь. Збережіть як нотатку.',
    warnings: [],
    confidence: 0,
    needs_review: true,
  };
}

// Error category messages
const QI_ERROR_MESSAGES = {
  unsupported_format: 'Формат файлу не підтримується. Спробуйте TXT, PDF або зображення.',
  extraction_failed:  'Не вдалося витягти текст з файлу.',
  llm_failed:         'API Claude не відповів. Перевірте підключення та API-ключ.',
  invalid_json:       'Модель повернула некоректну відповідь. Збережіть як нотатку.',
  low_confidence:     'Низька впевненість аналізу — перевірте і підтвердьте дані вручну.',
};

// Action button labels
const QI_ACTION_LABELS = {
  update_case_date:     '📅 Оновити дату засідання',
  update_deadline:      '⚡ Встановити дедлайн',
  update_case_field:    '✏️ Оновити дані справи',
  save_to_drive:        '☁️ Зберегти в Drive',
  update_case_status:   '🔄 Змінити статус',
  create_case:          '➕ Створити справу',
  create_drive_folder:  '📁 Створити папку',
  save_note:            '📝 Зберегти нотатку',
  delete_case:          '🗑 Видалити справу',
};

// Extracted field display labels
const QI_FIELD_LABELS = {
  case_number:  'Номер справи',
  court:        'Суд',
  judge:        'Суддя',
  hearing_date: 'Дата засідання',
  hearing_time: 'Час засідання',
  deadlines:    'Дедлайни',
  person:       'Особа',
};

// ── SCENARIO REGISTRY ─────────────────────────────────────────────────────────
// Each scenario is independent. Remove one — system still works. Add one — auto-activated.
const scenario_subpoena = {
  id: 'subpoena',
  label: 'Повістка / нова дата засідання',
  matches: (result) =>
    result.input_type === 'subpoena' || !!(result.extracted && result.extracted.hearing_date),
};

const scenario_existing_case = {
  id: 'existing_case',
  label: 'Документ по існуючій справі',
  matches: (result) => !!(result.case_match && result.case_match.found),
};

const scenario_new_case = {
  id: 'new_case',
  label: 'Нова справа',
  matches: (result) =>
    result.input_type === 'new_case' ||
    (result.case_match && !result.case_match.found &&
     result.input_type !== 'note' && result.input_type !== 'unknown'),
};

const scenario_multiple_files = {
  id: 'multiple_files',
  label: 'Кілька файлів',
  matches: (_result, _meta, fileCount) => fileCount >= 2,
};

const scenario_note = {
  id: 'note',
  label: 'Нотатка (fallback)',
  isFallback: true,
  matches: (result, activeCount) =>
    activeCount === 0 ||
    result.processing_status === 'failed' ||
    (typeof result.confidence === 'number' && result.confidence < 0.5),
};

const SCENARIO_REGISTRY = [
  scenario_subpoena,
  scenario_existing_case,
  scenario_new_case,
  scenario_multiple_files,
  scenario_note,
];

function getActiveScenarios(result, fileCount = 0) {
  const primary = SCENARIO_REGISTRY.filter(s =>
    !s.isFallback && s.matches(result, 0, fileCount)
  );
  const fallback = SCENARIO_REGISTRY.filter(s =>
    s.isFallback && s.matches(result, primary.length, fileCount)
  );
  return [...primary, ...fallback];
}

// Helper: find case for action — tolerant matching (exact → base name → case_no → partial)
function findCaseForAction(caseName, cases) {
  if (!caseName) return null;
  // 1. Exact match
  let found = cases.find(c => c.name.toLowerCase() === caseName.toLowerCase());
  if (found) return found;
  // 2. Match by base name (strip parenthesized number)
  const baseName = caseName.replace(/\s*\([^)]*\)\s*/g, '').trim();
  if (baseName) {
    found = cases.find(c => c.name.toLowerCase() === baseName.toLowerCase());
    if (found) return found;
  }
  // 3. Match by case_no extracted from parentheses
  const numberMatch = caseName.match(/\(([^)]+)\)/);
  if (numberMatch) {
    found = cases.find(c => c.case_no === numberMatch[1]);
    if (found) return found;
  }
  // 4. Partial match
  if (baseName) {
    found = cases.find(c =>
      c.name.toLowerCase().includes(baseName.toLowerCase()) ||
      baseName.toLowerCase().includes(c.name.toLowerCase())
    );
    if (found) return found;
  }
  // 5. Пошук по прізвищу в полі client
  if (baseName) {
    const lastName = baseName.split(/\s+/)[0].toLowerCase();
    if (lastName.length > 2) {
      found = cases.find(c =>
        (c.client || '').toLowerCase().includes(lastName) ||
        (c.name || '').toLowerCase().includes(lastName)
      );
      if (found) return found;
    }
  }
  return null;
}

function buildSystemContext(cases) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function daysFrom(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d)) return null;
    d.setHours(0, 0, 0, 0);
    return Math.round((d - today) / 86400000);
  }

  function formatDate(dateStr, timeStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const day = d.getDate();
    const months = ['січ','лют','бер','кві','тра','чер','лип','сер','вер','жов','лис','гру'];
    const m = months[d.getMonth()];
    const days = daysFrom(dateStr);
    const suffix = days === 0 ? ' (сьогодні)' : days === 1 ? ' (завтра)' :
                   days > 0 ? ` (через ${days} дн)` : ` (${Math.abs(days)} дн тому)`;
    return `${day} ${m}${timeStr ? ' о ' + timeStr : ''}${suffix}`;
  }

  const catMap = { civil: 'Цивільна', criminal: 'Кримінальна', military: 'Військова', administrative: 'Адміністративна' };

  const active = cases.filter(c => c.status === 'active' || !c.status);
  const paused = cases.filter(c => c.status === 'paused');
  const closed = cases.filter(c => c.status === 'closed');

  const hot = active.filter(c => {
    const dd = daysFrom(getDeadlineDate(c));
    const hd = daysFrom(getHearingDate(c));
    return (dd !== null && dd >= 0 && dd <= 3) || (hd !== null && hd >= 0 && hd <= 3);
  });

  let ctx = `КОНТЕКСТ СИСТЕМИ — АБ Левицького (${today.toLocaleDateString('uk-UA')})\n`;
  ctx += `Всього справ: ${cases.length} | Активних: ${active.length} | Призупинених: ${paused.length} | Закритих: ${closed.length}\n`;
  ctx += `\nВАЖЛИВО: для update_hearing/delete_hearing використовуй id засідання з переліку. `;
  ctx += `Для delete_deadline/update_deadline використовуй id дедлайну. `;
  ctx += `Закриті справи listed нижче — restore_case поверне їх в активні.\n`;

  if (hot.length > 0) {
    ctx += `\n⚡ ГАРЯЧІ (дедлайн або засідання ≤ 3 дні):\n`;
    hot.forEach(c => {
      const _dlDate = getDeadlineDate(c);
      const dd = daysFrom(_dlDate);
      const _hDate = getHearingDate(c);
      const hd = daysFrom(_hDate);
      ctx += `  • ${c.name}`;
      if (hd !== null && hd >= 0 && hd <= 3) ctx += ` | Засідання: ${formatDate(_hDate, getHearingTime(c))}`;
      if (dd !== null && dd >= 0 && dd <= 3) ctx += ` | Дедлайн: ${formatDate(_dlDate)}`;
      if (c.next_action) ctx += ` | Дія: ${c.next_action}`;
      ctx += '\n';
    });
  }

  ctx += `\nАКТИВНІ СПРАВИ:\n`;

  const totalActive = active.length;
  // hearings/deadlines з id МАЮТЬ бути видимі агенту завжди — інакше batch_update
  // не побачить частину записів. Compact-режим видалено.
  const detail = totalActive <= 15 ? 'full' : 'medium';

  const todayStr = new Date().toISOString().split('T')[0];
  const fmtHearings = (c) => (c.hearings || [])
    .map(h => {
      const status = h.status || (h.date >= todayStr ? 'scheduled' : 'completed');
      return `[id:${h.id}|${h.date}${h.time ? `|${h.time}` : ''}|${status}]`;
    })
    .join(', ');
  const fmtDeadlines = (c) => (c.deadlines || [])
    .map(d => `[id:${d.id}|${d.name}|${d.date}]`)
    .join(', ');

  active.forEach(c => {
    const _hDate = getHearingDate(c);
    const _hTime = getHearingTime(c);
    const _dlDate = getDeadlineDate(c);
    const hearingsStr = fmtHearings(c);
    const deadlinesStr = fmtDeadlines(c);
    if (detail === 'full') {
      ctx += `• ${c.name} [id:${c.id}]`;
      if (c.case_no) ctx += ` [${c.case_no}]`;
      ctx += ` | ${catMap[c.category] || c.category || '—'}`;
      if (c.court) ctx += ` | ${c.court}`;
      if (c.client) ctx += ` | Клієнт: ${c.client}`;
      if (hearingsStr) ctx += ` | Засідання: ${hearingsStr}`;
      if (deadlinesStr) ctx += ` | Дедлайни: ${deadlinesStr}`;
      if (c.next_action) ctx += ` | Дія: ${c.next_action}`;
      ctx += '\n';
    } else if (detail === 'medium') {
      ctx += `• ${c.name} [id:${c.id}]`;
      if (c.case_no) ctx += ` [${c.case_no}]`;
      if (hearingsStr) ctx += ` | Зас: ${hearingsStr}`;
      if (deadlinesStr) ctx += ` | Дед: ${deadlinesStr}`;
      if (c.next_action) ctx += ` | ${c.next_action}`;
      ctx += '\n';
    } else {
      ctx += `• ${c.name} [id:${c.id}]`;
      const nearest = _hDate || _dlDate;
      if (nearest) ctx += ` (${formatDate(nearest, _hDate ? _hTime : null)})`;
      ctx += '\n';
    }
  });

  if (detail !== 'full') {
    ctx += `\n[Показано стислий формат. Для деталей по конкретній справі — запитай окремо]\n`;
  }

  if (paused.length > 0) {
    ctx += `\nПРИЗУПИНЕНІ СПРАВИ:\n`;
    paused.forEach(c => {
      ctx += `• ${c.name} [id:${c.id}]`;
      if (c.court) ctx += ` | ${c.court}`;
      if (c.next_action) ctx += ` | Дія: ${c.next_action}`;
      ctx += '\n';
    });
  }

  if (closed.length > 0) {
    ctx += `\nЗАКРИТІ СПРАВИ (можна відновити через restore_case):\n`;
    closed.forEach(c => {
      ctx += `• ${c.name} [id:${c.id}]`;
      if (c.court) ctx += ` | ${c.court}`;
      ctx += '\n';
    });
  }

  return ctx;
}

function QuickInput({ cases, setCases, onClose, driveConnected, onExecuteAction, setAiUsage }) {
  const [text, setText]                   = useState('');
  const [loading, setLoading]             = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [errorCategory, setErrorCategory] = useState(null);  // see QI_ERROR_MESSAGES
  const [errorDetail, setErrorDetail]     = useState('');
  const [executedActions, setExecutedActions] = useState([]);
  const [dragOver, setDragOver]           = useState(false);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [chatInput, setChatInput]         = useState('');
  const [chatLoading, setChatLoading]     = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceInterim, setVoiceInterim] = useState('');
  const [activeVoiceTarget, setActiveVoiceTarget] = useState(null);
  const activeRecognition = useRef(null);
  const pendingTranscript = useRef('');
  const isRecordingRef = useRef(false);
  const fileInputRef = useRef(null);
  const chatEndRef   = useRef(null);
  const chatInputRef = useRef(null);
  const apiKey = localStorage.getItem('claude_api_key') || '';

  useEffect(() => {
    usageLog.log('quick_input');
    // Auto-focus chat input when QI opens (if no document loaded)
    if (!text.trim() && chatInputRef.current) {
      setTimeout(() => chatInputRef.current?.focus(), 150);
    }
  }, []);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [conversationHistory]);

  // ── File handling ──────────────────────────────────────────────────────────
  const handleFile = async (file) => {
    if (!file) return;
    // [BILLING] qi_document_uploaded
    try { activityTracker.report('qi_document_uploaded', { module: MODULES.QI, metadata: { fileType: file.type, fileSize: file.size, fileName: file.name } }); } catch {}
    try {
      let workingFile = file;
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 5000)
        );
        const blob = await Promise.race([file.arrayBuffer(), timeoutPromise]);
        workingFile = new File([blob], file.name, { type: file.type || 'application/octet-stream' });
      } catch(e) {
        workingFile = file;
      }
      const mime = (workingFile.type || '').toLowerCase();
      let ext = (workingFile.name || '').split('.').pop().toLowerCase();
      if (!ext || ext === workingFile.name.toLowerCase()) {
        if (mime.includes('pdf')) ext = 'pdf';
        else if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
        else if (mime.includes('png')) ext = 'png';
        else if (mime.includes('webp')) ext = 'webp';
        else if (mime.includes('heic') || mime.includes('heif')) ext = 'heic';
        else if (mime.includes('word') || mime.includes('docx')) ext = 'docx';
        else if (mime.includes('text')) ext = 'txt';
      }
      // Camera-share / clipboard: ім'я може бути "image.jpg" з MIME image/png,
      // або взагалі без розширення. Якщо MIME каже image/* — обробити як зображення.
      const knownImageExt = ['jpg','jpeg','png','webp','heic','heif'];
      if (mime.startsWith('image/') && !knownImageExt.includes(ext)) {
        if (mime.includes('heic') || mime.includes('heif')) ext = 'heic';
        else ext = 'jpg';
      }
      if (ext === 'txt' || ext === 'md') {
        const reader = new FileReader();
        reader.onload = (e) => setText(e.target.result);
        reader.onerror = () => { setErrorCategory('extraction_failed'); setErrorDetail('Не вдалось прочитати файл'); };
        reader.readAsText(workingFile);
      } else if (ext === 'pdf') {
        extractPdfText(workingFile);
      } else if (['jpg','jpeg','png','webp'].includes(ext)) {
        readImageAsBase64(workingFile);
      } else if (ext === 'heic' || ext === 'heif') {
        convertHeicToJpeg(workingFile);
      } else if (ext === 'docx') {
        extractDocxText(workingFile);
      } else {
        setErrorCategory('unsupported_format');
        setErrorDetail(`Файл: ${workingFile.name}`);
      }
    } catch (err) {
      console.error('handleFile error:', err);
      setErrorCategory('extraction_failed');
      setErrorDetail('Не вдалось обробити файл. Спробуйте ще раз.');
      setLoading(false);
    }
  };

  const extractPdfText = (file) => {
    if (typeof pdfjsLib === 'undefined') {
      readImageAsBase64(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const typedArr = new Uint8Array(e.target.result);
        const pdf = await pdfjsLib.getDocument({ data: typedArr }).promise;
        let fullText = '';
        const maxPages = Math.min(pdf.numPages, 5);
        for (let i = 1; i <= maxPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          fullText += content.items.map(item => item.str).join(' ') + '\n';
        }
        const pageWarning = pdf.numPages > 5 ? `\n[Оброблено перші 5 з ${pdf.numPages} сторінок]` : '';
        if (fullText.trim().length > 50) {
          setText(fullText.trim() + pageWarning);
        } else {
          renderPdfPageAsBase64(pdf, file.name);
        }
      } catch(err) {
        // Будь-яка помилка → vision fallback, не blank page
        console.warn('PDF parse failed, trying vision:', err.message);
        try { readImageAsBase64(file); }
        catch(e2) { setErrorCategory('extraction_failed'); setErrorDetail('Не вдалось обробити PDF'); setLoading(false); }
      }
    };
    reader.onerror = () => { setErrorCategory('extraction_failed'); setErrorDetail('Не вдалось прочитати файл'); };
    reader.readAsArrayBuffer(file);
  };

  const renderPdfPageAsBase64 = async (pdf, fileName) => {
    try {
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      analyzeImageWithVision(base64, 'image/jpeg', fileName);
    } catch(err) {
      setErrorCategory('extraction_failed');
      setErrorDetail(err.message);
    }
  };

  const readImageAsBase64 = (file) => {
    try {
      if (!file) {
        setErrorCategory('extraction_failed');
        setErrorDetail('Зображення не вибрано');
        return;
      }
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const dataUrl = e?.target?.result;
          if (typeof dataUrl !== 'string' || !dataUrl.includes(',')) {
            throw new Error('Не вдалось прочитати зображення (порожній base64)');
          }
          const base64 = dataUrl.split(',')[1];
          if (!base64 || base64.length < 10) {
            throw new Error('Зображення порожнє або пошкоджене');
          }
          const mediaType = file.type || 'image/jpeg';
          await analyzeImageWithVision(base64, mediaType, file.name || 'image');
        } catch (err) {
          console.error('Vision pipeline error:', err);
          setErrorCategory('extraction_failed');
          setErrorDetail('Зображення: ' + (err?.message || 'невідома помилка'));
          setLoading(false);
        }
      };
      reader.onerror = (e) => {
        console.error('FileReader error:', e);
        setErrorCategory('llm_failed');
        setErrorDetail('FileReader: ' + (e?.target?.error?.message || 'не вдалось прочитати файл'));
        setLoading(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('readImageAsBase64 outer error:', err);
      setErrorCategory('extraction_failed');
      setErrorDetail('Зображення (init): ' + (err?.message || 'невідома'));
      setLoading(false);
    }
  };

  const extractDocxText = (file) => {
    if (typeof mammoth === 'undefined') {
      setErrorCategory('unsupported_format');
      setErrorDetail('Word документи: бібліотека не завантажена');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const result = await mammoth.extractRawText({ arrayBuffer: e.target.result });
        if (result.value && result.value.trim().length > 10) {
          setText(result.value.trim());
        } else {
          setErrorCategory('extraction_failed');
          setErrorDetail('Word документ порожній або не читається');
        }
      } catch(err) {
        setErrorCategory('extraction_failed');
        setErrorDetail('Не вдалось прочитати Word документ: ' + err.message);
      }
    };
    reader.onerror = () => { setErrorCategory('extraction_failed'); };
    reader.readAsArrayBuffer(file);
  };

  const convertHeicToJpeg = async (file) => {
    try {
      // Спробувати через canvas — деякі браузери підтримують HEIC
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      analyzeImageWithVision(base64, 'image/jpeg', file.name);
    } catch(e) {
      // Якщо браузер не підтримує HEIC — показати зрозуміле повідомлення
      setErrorCategory('unsupported_format');
      setErrorDetail('HEIC формат: збережіть фото як JPEG і спробуйте знову');
    }
  };

  const analyzeImageWithVision = async (base64Data, mediaType, fileName) => {
    if (!base64Data || base64Data.length < 10) {
      setErrorCategory('extraction_failed');
      setErrorDetail('Файл порожній або не читається (base64 empty)');
      return;
    }
    if (!apiKey) {
      setErrorCategory('llm_failed');
      setErrorDetail('API-ключ Anthropic не налаштований');
      setLoading(false);
      systemAlert(
        'Щоб обробляти зображення і документи через Claude, потрібен API-ключ Anthropic. Відкрийте Quick Input (⚡), натисніть на іконку ключа і вставте ключ.',
        'API-ключ не налаштований'
      );
      return;
    }
    setLoading(true);
    setErrorCategory(null);
    setAnalysisResult(null);
    setExecutedActions([]);
    setConversationHistory([]);
    const caseNames = cases.map(c => c.case_no ? `${c.name} (${c.case_no})` : c.name).join(', ');
    try {
      const qiImageModel = resolveModel('qiParserImage');
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: qiImageModel,
          max_tokens: 1024,
          system: HAIKU_SYSTEM_PROMPT,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
              { type: 'text', text: `Existing cases in registry: ${caseNames}\nFile: ${fileName}` },
            ],
          }],
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(()=>({}));
        setErrorCategory('llm_failed');
        setErrorDetail(d?.error?.message || `HTTP ${res.status}`);
        setLoading(false);
        return;
      }
      const data = await res.json();
      try {
        logAiUsage({
          agentType: 'qi_agent',
          model: qiImageModel,
          inputTokens: data?.usage?.input_tokens,
          outputTokens: data?.usage?.output_tokens,
          context: { module: MODULES.QI, operation: 'parse_document' },
        }, setAiUsage);
        // [BILLING] agent_call паралельно — для зрізу часу адвоката.
        // QI парсер документа — без caseId (підбір справи відбувається пізніше).
        activityTracker.report('agent_call', {
          module: MODULES.QI, category: 'admin',
          metadata: { agentType: 'qi_agent', operation: 'parse_document', kind: 'image' }
        });
      } catch {}
      const rawText = data?.content?.[0]?.text || '';
      const parsed = validateAndParseJSON(rawText);
      if (!parsed) {
        setErrorCategory('invalid_json');
        setLoading(false);
        return;
      }
      if (parsed.processing_status === 'failed') setErrorCategory('invalid_json');
      else if (typeof parsed.confidence === 'number' && parsed.confidence < 0.5) setErrorCategory('low_confidence');
      try {
        setAnalysisResult(parsed);
        setConversationHistory([{
          role: 'assistant',
          content: parsed.human_message || `Аналіз зображення: ${fileName}`,
          analysisCard: parsed,
        }]);
      } catch (err) {
        console.error('Vision setState error:', err);
        setErrorCategory('llm_failed');
        setErrorDetail('Vision: помилка збереження результату — ' + (err?.message || 'невідома'));
      }
    } catch(err) {
      console.error('analyzeImageWithVision fetch error:', err);
      setErrorCategory('llm_failed');
      setErrorDetail(err?.message || 'Мережева помилка');
    }
    setLoading(false);
  };

  const onDragOver  = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const onDrop      = (e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); };

  // Збереження нотатки — ЄДИНИЙ шлях через executeAction (синхронізація з реєстром).
  const saveCurrentTextAsNote = async () => {
    if (!text.trim()) return;
    await onExecuteAction('qi_agent', 'add_note', {
      caseId: null,
      text: text.trim(),
      category: 'general',
    });
    setConversationHistory(prev => [...prev, { role: 'assistant', content: 'Нотатку збережено.' }]);
    setText('');
    setErrorCategory(null);
    setErrorDetail('');
  };

  // ── Command detection (smart routing) ──────────────────────────────────────
  const isCommand = (t) => {
    const patterns = [
      /додай|додати|внеси|встав|запиши|зміни|оновити|оновлю/i,
      /засідання|дедлайн|статус|нотатк/i,
      /по справі|справа\s|клієнт/i,
    ];
    return patterns.some(p => p.test(t));
  };

  // ── Main analysis pipeline ─────────────────────────────────────────────────
  const analyze = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setErrorCategory(null);
    setErrorDetail('');
    setAnalysisResult(null);
    setExecutedActions([]);
    setConversationHistory([]);

    // SYSTEM_IMPORT passthrough (legacy support)
    if (text.trim().startsWith('===SYSTEM_IMPORT===')) {
      const data = {};
      text.split('\n').forEach(line => {
        const m = line.match(/^(\w+):\s*(.+)$/);
        if (m) data[m[1].trim()] = m[2].trim();
      });
      const caseName = data.name || '';
      setCases(prev => {
        const existing = prev.find(c => c.name.toLowerCase() === caseName.toLowerCase());
        if (existing) return prev.map(c => c.id === existing.id ? { ...c, ...data, id: c.id } : c);
        const newHearings = data.hearing_date ? [{ id: `hrg_${Date.now()}`, date: data.hearing_date, time: data.hearing_time || '', court: data.court || '', notes: '', status: 'scheduled' }] : [];
        return [...prev, { id: `case_${Date.now()}`, name: caseName, client: data.client||'', category: data.category||'civil', status:'active', court: data.court||'', case_no: data.case_no||'', hearings: newHearings, deadline: data.deadline||'', deadline_type: data.deadline_type||'', next_action: data.next_action||'', notes: data.notes ? [{id:Date.now(), text:data.notes, category:'case', source:'form', ts:new Date().toISOString()}] : [], pinnedNoteIds:[] }];
      });
      systemAlert(`Дані внесено: ${caseName}`);
      onClose();
      setLoading(false);
      return;
    }

    const caseNames = cases.map(c => c.case_no ? `${c.name} (${c.case_no})` : c.name).join(', ');
    const userContent = `Existing cases in registry: ${caseNames}\n\n---\n\n${text}`;

    try {
      const qiTextModel = resolveModel('qiParserDocument');
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: qiTextModel,
          max_tokens: 1024,
          system: HAIKU_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userContent }],
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(()=>({}));
        setErrorCategory('llm_failed');
        setErrorDetail(d?.error?.message || `HTTP ${res.status}`);
        setLoading(false);
        return;
      }

      const data = await res.json();
      try {
        logAiUsage({
          agentType: 'qi_agent',
          model: qiTextModel,
          inputTokens: data?.usage?.input_tokens,
          outputTokens: data?.usage?.output_tokens,
          context: { module: MODULES.QI, operation: 'parse_document' },
        }, setAiUsage);
        // QI парсер тексту — без caseId.
        activityTracker.report('agent_call', {
          module: MODULES.QI, category: 'admin',
          metadata: { agentType: 'qi_agent', operation: 'parse_document', kind: 'text' }
        });
      } catch {}
      const rawText = data?.content?.[0]?.text || '';
      const parsed = validateAndParseJSON(rawText);

      if (parsed.processing_status === 'failed') {
        setErrorCategory('invalid_json');
      } else if (typeof parsed.confidence === 'number' && parsed.confidence < 0.5) {
        setErrorCategory('low_confidence');
      }

      setAnalysisResult(parsed);
      // Зберегти картку як перше повідомлення assistant в чаті
      setConversationHistory([{
        role: 'assistant',
        content: parsed.human_message || 'Аналіз завершено',
        analysisCard: parsed
      }]);
    } catch(err) {
      setErrorCategory('llm_failed');
      setErrorDetail(err.message || 'Мережева помилка');
    }
    setLoading(false);
  };

  // ── Action execution (QI) — використовує onExecuteAction (ACTIONS + PERMISSIONS) ──
  const executeQiAction = (action, overrideData) => {
    const markDone = () => setExecutedActions(prev => [...prev, action]);
    const baseResult = analysisResult || { extracted: {}, case_match: { found: false }, recommended_actions: [] };
    const effectiveResult = overrideData
      ? {
          extracted: { ...(baseResult.extracted || {}), ...(overrideData.extracted || {}) },
          case_match: overrideData.case_match
            || (overrideData.extracted?.case_name
                ? { found: true, case_name: overrideData.extracted.case_name, confidence: 1 }
                : null)
            || baseResult.case_match
            || { found: false },
        }
      : baseResult;
    const _analysisResult = effectiveResult;

    if (action === 'save_note') {
      const caseName = _analysisResult.case_match?.case_name;
      const matched = caseName ? findCaseForAction(caseName, cases) : null;
      onExecuteAction('qi_agent', 'add_note', {
        text: text || '',
        category: matched ? 'case' : 'general',
        caseId: matched?.id || null,
      });
      markDone();
      return;
    }

    if (action === 'update_case_date') {
      const hearing_date = _analysisResult.extracted?.hearing_date;
      const hearing_time = _analysisResult.extracted?.hearing_time;
      const caseName = _analysisResult.case_match?.case_name;
      if (!hearing_date) { systemAlert('Дату засідання не визначено'); return; }
      if (!caseName)     { systemAlert('Справу не визначено — уточніть вручну'); return; }
      const matched = findCaseForAction(caseName, cases);
      if (!matched) { systemAlert(`Справу "${caseName}" не знайдено в реєстрі`); return; }
      onExecuteAction('qi_agent', 'add_hearing', {
        caseId: matched.id,
        date: hearing_date,
        time: hearing_time || '',
      });
      markDone();
      return;
    }

    if (action === 'update_deadline') {
      const deadline_date = _analysisResult.extracted?.deadline_date;
      const deadline_type = _analysisResult.extracted?.deadline_type;
      const caseName = _analysisResult.case_match?.case_name;
      if (!deadline_date) { systemAlert('Дату дедлайну не визначено'); return; }
      if (!caseName) { systemAlert('Справу не визначено — уточніть вручну'); return; }
      const matched = findCaseForAction(caseName, cases);
      if (!matched) { systemAlert(`Справу "${caseName}" не знайдено в реєстрі`); return; }
      onExecuteAction('qi_agent', 'add_deadline', {
        caseId: matched.id,
        name: deadline_type || "Дедлайн",
        date: deadline_date,
      });
      markDone();
      return;
    }

    if (action === 'update_case_status') {
      const caseName = _analysisResult.case_match?.case_name;
      if (!caseName) { systemAlert('Справу не визначено'); return; }
      const matched = findCaseForAction(caseName, cases);
      if (!matched) { systemAlert(`Справу "${caseName}" не знайдено`); return; }
      setPendingStatusChange({ caseId: matched.id, caseName: matched.name });
      return;
    }

    if (action === 'create_case') {
      const ext = _analysisResult.extracted || {};
      const caseMatch = _analysisResult.case_match || {};
      const rawPerson = ext.person || caseMatch.case_name || '';
      const caseName = extractShortName(rawPerson) || 'Нова справа';
      const isCriminal = (ext.person && /обвинувач|підозрюван|захисник/i.test(JSON.stringify(ext)))
        || /кпк|кримінал|122 кк|ст\.\s*\d+\s*кк/i.test(JSON.stringify(_analysisResult));
      const category = isCriminal ? 'criminal' : 'civil';
      const _hd = ext.hearing_date || '';
      const _ht = ext.hearing_time || '';
      const newHearings = _hd ? [{ id: `hrg_${Date.now()}`, date: _hd, time: _ht, court: ext.court || '', notes: '', status: 'scheduled' }] : [];

      onExecuteAction('qi_agent', 'create_case', {
        fields: {
          name: caseName,
          client: ext.person || '',
          category,
          status: 'active',
          court: ext.court || '',
          case_no: ext.case_number || '',
          hearings: newHearings,
          notes: [],
          storage: { driveFolderId: null, driveFolderName: null, localFolderPath: null, lastSyncAt: null },
        }
      });
      markDone();
      setConversationHistory(prev => [...prev, {
        role: 'assistant',
        content: `✅ Справу "${caseName}" створено. Знайдіть її в реєстрі і доповніть деталі.`
      }]);
      return;
    }

    if (action === 'save_to_drive' || action === 'create_drive_folder') {
      if (!driveConnected) return;
      systemAlert('Функція збереження в Drive ще не реалізована в Quick Input.');
      markDone();
      return;
    }

    systemAlert(`Дія "${QI_ACTION_LABELS[action] || action}" ще не реалізована в цій версії`);
    markDone();
  };

  // ── Voice input (Web Speech API) — continuous mode ──────────────────────────
  function startVoiceInput(targetSetter, targetKey) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      systemAlert('Мікрофон не підтримується в цьому браузері');
      return;
    }
    // If already recording — stop current first
    if (activeRecognition.current) { stopVoice(); return; }

    const recognition = new SR();
    recognition.lang = 'uk-UA';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const t = event.results[0][0].transcript;
      setVoiceInterim(t);
      // Зберегти в ref щоб onend міг взяти
      pendingTranscript.current = (pendingTranscript.current || '') + t + ' ';
    };

    recognition.onend = () => {
      // Якщо запис ще активний (користувач не натиснув ✓ або ×) — перезапустити
      if (activeRecognition.current && isRecordingRef.current) {
        recognition.start(); // продовжуємо слухати
        return;
      }
      // Якщо зупинено — вставити текст
      const final = (pendingTranscript.current || '').trim();
      if (final) {
        targetSetter(prev => prev ? prev + ' ' + final : final);
      }
      setIsRecording(false);
      setVoiceInterim('');
      setActiveVoiceTarget(null);
      activeRecognition.current = null;
      pendingTranscript.current = '';
    };

    recognition.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        cancelVoice();
      }
    };

    recognition.start();
    // [BILLING] qi_voice_input — старт голосового вводу.
    try { activityTracker.report('qi_voice_input', { module: MODULES.QI, metadata: { target: targetKey } }); } catch {}
    setIsRecording(true);
    isRecordingRef.current = true;
    setActiveVoiceTarget(targetKey);
    activeRecognition.current = recognition;
  }

  const stopVoice = () => {
    isRecordingRef.current = false;
    activeRecognition.current?.stop(); // onend спрацює, вставить текст
  };

  const cancelVoice = () => {
    isRecordingRef.current = false;
    activeRecognition.current?.abort();
    activeRecognition.current = null;
    pendingTranscript.current = '';
    setIsRecording(false);
    setVoiceInterim('');
    setActiveVoiceTarget(null);
  };

  // ── Chat (follow-up commands) ───────────────────────────────────────────────
  // buildSystemContext is declared at module scope (below) so Dashboard can use it too.

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim();
    // [BILLING] qi_action_executed (chat — це по суті ініціація дій через агента).
    try { activityTracker.report('qi_action_executed', { module: MODULES.QI, metadata: { messageLen: userMsg.length, viaVoice: !!voiceInterim } }); } catch {}
    setChatInput('');
    setChatLoading(true);

    const cleanMsg = (msg) => ({
      role: msg.role,
      content: Array.isArray(msg.content)
        ? msg.content.map(block => {
            if (block.type === 'text') return { type: 'text', text: block.text };
            if (block.type === 'image') return { type: 'image', source: block.source };
            return block;
          })
        : (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)),
    });
    // Передавати повний контекст ЗАВЖДИ (не тільки для першого повідомлення)
    const systemContext = buildSystemContext(cases);
    const enrichedMsg = `${systemContext}\n\nКОМАНДА АДВОКАТА: ${userMsg}`;
    const newHistory = conversationHistory.slice(-9)
      .filter(msg => msg.role === 'user' || msg.role === 'assistant')
      .map(cleanMsg)
      .concat([{ role: 'user', content: enrichedMsg }]);
    setConversationHistory(prev => [...prev.slice(-9), { role: 'user', content: userMsg }]);

    try {
      const qiChatModel = resolveModel('qiAgent');
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: qiChatModel,
          system: SONNET_CHAT_PROMPT,
          messages: newHistory,
          max_tokens: 2048,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setConversationHistory(prev => [...prev, { role: 'assistant', content: `Помилка: ${err?.error?.message || res.status}` }]);
      } else {
        const data = await res.json();
        try {
          logAiUsage({
            agentType: 'qi_agent',
            model: qiChatModel,
            inputTokens: data?.usage?.input_tokens,
            outputTokens: data?.usage?.output_tokens,
            context: { module: MODULES.QI, operation: 'chat' },
          }, setAiUsage);
          // QI chat — без caseId на рівні самого виклику (caseId визначається
          // в подальших ACTIONS-маніпуляціях через executeAction).
          activityTracker.report('agent_call', {
            caseId: null,
            module: MODULES.QI,
            category: categoryForCase(null),
            metadata: { agentType: 'qi_agent', operation: 'chat' }
          });
        } catch {}
        const responseText = data?.content?.[0]?.text || '';
        const actionMatch = (() => {
          const idx = responseText.indexOf('ACTION_JSON:');
          if (idx === -1) return null;
          const start = responseText.indexOf('{', idx);
          if (start === -1) return null;
          let depth = 0;
          for (let i = start; i < responseText.length; i++) {
            if (responseText[i] === '{') depth++;
            else if (responseText[i] === '}') {
              depth--;
              if (depth === 0) {
                return [null, responseText.slice(start, i + 1)];
              }
            }
          }
          return null;
        })();
        const displayText = (() => {
          const idx = responseText.indexOf('ACTION_JSON:');
          if (idx === -1) return responseText.trim();
          const start = responseText.indexOf('{', idx);
          if (start === -1) return responseText.trim();
          let depth = 0;
          for (let i = start; i < responseText.length; i++) {
            if (responseText[i] === '{') depth++;
            else if (responseText[i] === '}') {
              depth--;
              if (depth === 0) {
                return (responseText.slice(0, idx) + responseText.slice(i + 1)).trim();
              }
            }
          }
          return responseText.trim();
        })();
        let actionResult = null;
        if (actionMatch) {
          try { actionResult = JSON.parse(actionMatch[1]); } catch (e) {
            actionResult = validateAndParseJSON(actionMatch[1]);
          }
        }
        // Додати case_match якщо є case_name але немає case_match
        if (actionResult && actionResult.extracted?.case_name && !actionResult.case_match) {
          actionResult.case_match = {
            found: true,
            case_name: actionResult.extracted.case_name,
            confidence: 0.9
          };
        }
        // Якщо є дії — виконати одразу з чату
        if (actionResult && (actionResult.recommended_actions || []).length > 0) {
          const action = actionResult.recommended_actions[0];

          // BATCH_UPDATE — обробляти до каскаду одиничних дій
          if (action === 'batch_update') {
            const operations = actionResult.operations || [];
            if (operations.length === 0) {
              setConversationHistory(prev => [...prev, {
                role: 'assistant',
                content: 'Пакет порожній — немає операцій для виконання.'
              }]);
              setChatLoading(false);
              return;
            }

            // Резолвити case_name -> caseId та дату -> id сутності для кожної op
            const norm = (d) => (d || '').toString().substring(0, 10);
            const resolvedOps = operations.map(op => {
              const { action: opAction, case_name, ...rest } = op;
              const params = { ...rest };

              // Резолв справи
              const matched = case_name ? findCaseForAction(case_name, cases) : null;
              if (case_name && !matched) {
                return { action: opAction, params, _resolveError: `Справу "${case_name}" не знайдено в реєстрі` };
              }
              if (matched) params.caseId = matched.id;

              // Мапінг полів дат/часу/назв на params очікуваних ACTIONS
              if (rest.deadline_date && !params.date) params.date = rest.deadline_date;
              if (rest.hearing_date && !params.date) params.date = rest.hearing_date;
              if (rest.hearing_time && !params.time) params.time = rest.hearing_time;
              if (rest.deadline_type && !params.name) params.name = rest.deadline_type;

              // Резолв id за датою для делітів/апдейтів — нормалізована дата (substring 0..10)
              if (matched && opAction === 'delete_deadline' && !params.deadlineId) {
                const target = norm(rest.deadline_date);
                const d = (matched.deadlines || []).find(d => norm(d.date) === target);
                if (d) params.deadlineId = d.id;
                else return { action: opAction, params, _resolveError: `Дедлайн на ${target} не знайдено в справі "${matched.name}"` };
              }
              if (matched && opAction === 'delete_hearing' && !params.hearingId) {
                const target = norm(rest.hearing_date);
                const h = (matched.hearings || []).find(h => norm(h.date) === target);
                if (h) params.hearingId = h.id;
                else return { action: opAction, params, _resolveError: `Засідання на ${target} не знайдено в справі "${matched.name}"` };
              }
              if (matched && opAction === 'update_deadline' && !params.deadlineId) {
                const target = norm(rest.deadline_date);
                const d = (matched.deadlines || []).find(d => norm(d.date) === target);
                if (d) params.deadlineId = d.id;
              }

              return { action: opAction, params };
            });

            const batchResult = await onExecuteAction('qi_agent', 'batch_update', {
              operations: resolvedOps,
              agentId: 'qi_agent'
            });

            const { successCount = 0, total = 0, results = [] } = batchResult || {};
            const summary = results.map(r =>
              r.ok ? `✅ ${r.action}` : `❌ ${r.action} — ${r.error}`
            ).join('\n');

            setConversationHistory(prev => [...prev, {
              role: 'assistant',
              content: `Виконано ${successCount} з ${total} операцій:\n${summary}`
            }]);
            setChatLoading(false);
            return;
          }

          // SAVE_NOTE — єдиний шлях збереження нотатки з чату
          if (action === 'save_note') {
            const ext = actionResult.extracted || {};
            const rawCaseName = actionResult.case_name || ext.case_name || actionResult.case_match?.case_name || '';
            const matched = rawCaseName ? findCaseForAction(rawCaseName, cases) : null;
            const noteText = (actionResult.text || ext.text || actionResult.content || ext.content || '').toString();

            if (!noteText.trim()) {
              setConversationHistory(prev => [...prev, {
                role: 'assistant',
                content: 'Текст нотатки порожній. Уточніть що записати.'
              }]);
              setChatLoading(false);
              return;
            }

            await onExecuteAction('qi_agent', 'add_note', {
              caseId: matched?.id || null,
              text: noteText,
              date: actionResult.date || ext.date || null,
              time: actionResult.time || ext.time || null,
              category: matched ? 'case' : 'general',
            });

            setConversationHistory(prev => [...prev, {
              role: 'assistant',
              content: '✅ Нотатку збережено'
                + (matched ? ` до справи "${matched.name}"` : '')
                + (actionResult.date || ext.date ? ` на ${actionResult.date || ext.date}` : '')
                + '.'
            }]);
            setChatLoading(false);
            return;
          }

          if (action === 'create_case') {
            const ext = actionResult.extracted || {};
            const rawPerson = ext.person || actionResult.case_match?.case_name || '';
            const caseName = extractShortName(rawPerson) || 'Нова справа';
            const isCriminal = /кпк|кримінал|\d+\s*кк|обвинувач|підозрюван/i.test(JSON.stringify(actionResult));
            const _chatHd = ext.hearing_date || '';
            const _chatHt = ext.hearing_time || '';
            const _chatHearings = _chatHd ? [{ id: `hrg_${Date.now()}`, date: _chatHd, time: _chatHt, court: ext.court || '', notes: '', status: 'scheduled' }] : [];

            onExecuteAction('qi_agent', 'create_case', {
              fields: {
                name: caseName,
                client: rawPerson.replace(/\(.*?\)/g, '').replace(/,.*$/, '').trim(),
                category: isCriminal ? 'criminal' : 'civil',
                status: 'active',
                court: ext.court || '',
                case_no: ext.case_number || '',
                hearings: _chatHearings,
                notes: [],
                storage: { driveFolderId: null, driveFolderName: null, localFolderPath: null, lastSyncAt: null },
              }
            });
            setConversationHistory(prev => [...prev, {
              role: 'assistant',
              content: `✅ Справу "${caseName}" створено${ext.court ? ' (' + ext.court + ')' : ''}. Знайдіть її в реєстрі і доповніть деталі.`
            }]);
            setChatLoading(false);
            return;
          }
          if (action === 'update_case_field' || action === 'update_case_status') {
            const caseName = actionResult.case_match?.case_name
              || actionResult.extracted?.case_name;
            const matched = caseName ? findCaseForAction(caseName, cases) : null;

            const field = action === 'update_case_status'
              ? 'status'
              : actionResult.extracted?.field;
            const value = actionResult.extracted?.value
              || actionResult.extracted?.status;

            if (matched && field && value) {
              const result = await onExecuteAction('qi_agent', 'update_case_field', {
                caseId: matched.id,
                field,
                value,
              });

              if (result?.error) {
                // Поле не дозволене — fallback на текстову відповідь
              } else {
                const fieldLabels = {
                  status: 'Статус', category: 'Категорія', court: 'Суд',
                  case_no: 'Номер справи', next_action: 'Наступна дія', notes: 'Нотатки',
                };
                const statusLabels = { active: 'Активна', paused: 'Призупинена', closed: 'Закрита' };
                const displayValue = field === 'status' ? (statusLabels[value] || value) : value;

                setConversationHistory(prev => [...prev, {
                  role: 'assistant',
                  content: `✅ ${fieldLabels[field] || field} справи "${matched.name}" змінено на "${displayValue}"`
                }]);
                setChatLoading(false);
                return;
              }
            }
          }
          if (action === 'delete_case') {
            const caseName = actionResult.case_match?.case_name
              || actionResult.extracted?.case_name;
            const matched = caseName ? findCaseForAction(caseName, cases) : null;

            if (matched) {
              if (matched.status === 'closed') {
                // Вже закрита — пропонуємо видалити назавжди
                if (!await systemConfirm(`Справа "${matched.name}" вже закрита. Видалити назавжди? Цю дію не можна скасувати.`, "Видалення справи", "Видалити")) {
                  setConversationHistory(prev => [...prev, {
                    role: 'assistant',
                    content: `Видалення справи "${matched.name}" скасовано.`
                  }]);
                  setChatLoading(false);
                  return;
                }
                // destroy_case — тільки через UI, не через агента
                setCases(prev => prev.filter(c => c.id !== matched.id));
                setConversationHistory(prev => [...prev, {
                  role: 'assistant',
                  content: `✅ Справу "${matched.name}" видалено з реєстру назавжди.`
                }]);
              } else {
                // Спочатку закриваємо через executeAction
                if (!await systemConfirm(`Закрити справу "${matched.name}"? Вона перейде в архів.`, "Закриття справи")) {
                  setConversationHistory(prev => [...prev, {
                    role: 'assistant',
                    content: `Закриття справи "${matched.name}" скасовано.`
                  }]);
                  setChatLoading(false);
                  return;
                }
                onExecuteAction('qi_agent', 'close_case', { caseId: matched.id });
                setConversationHistory(prev => [...prev, {
                  role: 'assistant',
                  content: `✅ Справу "${matched.name}" закрито. Вона тепер у вкладці "Закриті". Звідти можна видалити назавжди.`
                }]);
              }
              setChatLoading(false);
              return;
            }
          }

          // --- НОВІ ДІЇ через onExecuteAction ---

          if (action === 'close_case') {
            const caseName = actionResult.extracted?.case_name || actionResult.case_match?.case_name;
            const matched = caseName ? findCaseForAction(caseName, cases) : null;
            if (matched) {
              onExecuteAction('qi_agent', 'close_case', { caseId: matched.id });
              setConversationHistory(prev => [...prev, {
                role: 'assistant',
                content: `✅ Справу "${matched.name}" закрито`
              }]);
              setChatLoading(false);
              return;
            }
          }

          if (action === 'restore_case') {
            const caseName = actionResult.extracted?.case_name || actionResult.case_match?.case_name;
            const matched = caseName
              ? cases.find(c => c.name?.toLowerCase().includes(caseName.toLowerCase()))
              : null;
            if (matched) {
              onExecuteAction('qi_agent', 'restore_case', { caseId: matched.id });
              setConversationHistory(prev => [...prev, {
                role: 'assistant',
                content: `✅ Справу "${matched.name}" відновлено`
              }]);
              setChatLoading(false);
              return;
            }
          }

          if (action === 'add_hearing') {
            const caseName = actionResult.extracted?.case_name || actionResult.case_match?.case_name;
            const matched = caseName ? findCaseForAction(caseName, cases) : null;
            const date = actionResult.extracted?.hearing_date || actionResult.extracted?.date;
            const time = actionResult.extracted?.hearing_time || actionResult.extracted?.time || '';
            if (matched && date) {
              onExecuteAction('qi_agent', 'add_hearing', {
                caseId: matched.id, date, time, duration: 120
              });
              setConversationHistory(prev => [...prev, {
                role: 'assistant',
                content: `✅ Засідання у справі "${matched.name}" на ${date}${time ? ` о ${time}` : ''} додано`
              }]);
              setChatLoading(false);
              return;
            }
          }

          // update_hearing + update_case_date (legacy alias) — однакова логіка переносу.
          if (action === 'update_hearing' || action === 'update_case_date') {
            const caseName = actionResult.extracted?.case_name || actionResult.case_match?.case_name;
            const matched = caseName ? findCaseForAction(caseName, cases) : null;
            const date = actionResult.extracted?.hearing_date || actionResult.extracted?.date;
            const time = actionResult.extracted?.hearing_time || actionResult.extracted?.time;
            const hearingId = actionResult.extracted?.hearing_id || null;
            if (matched && date) {
              // Якщо немає жодного scheduled засідання — це не "перенос", а додавання нового.
              const hasScheduled = (matched.hearings || []).some(h => h.status === 'scheduled');
              if (hasScheduled) {
                onExecuteAction('qi_agent', 'update_hearing', {
                  caseId: matched.id,
                  hearingId,
                  date,
                  time: time || '',
                });
                setConversationHistory(prev => [...prev, {
                  role: 'assistant',
                  content: `✅ Засідання у справі "${matched.name}" перенесено на ${date}${time ? ` о ${time}` : ''}`
                }]);
              } else {
                onExecuteAction('qi_agent', 'add_hearing', {
                  caseId: matched.id,
                  date,
                  time: time || '',
                  duration: 120,
                });
                setConversationHistory(prev => [...prev, {
                  role: 'assistant',
                  content: `✅ Засідання у справі "${matched.name}" додано на ${date}${time ? ` о ${time}` : ''}`
                }]);
              }
              setChatLoading(false);
              return;
            }
          }

          if (action === 'delete_hearing') {
            const caseName = actionResult.extracted?.case_name || actionResult.case_match?.case_name;
            const matched = caseName ? findCaseForAction(caseName, cases) : null;
            const date = actionResult.extracted?.hearing_date || actionResult.extracted?.date;
            const hearingId = actionResult.extracted?.hearing_id || null;
            if (matched) {
              let targetHearingId = hearingId;
              if (!targetHearingId && date) {
                const h = (matched.hearings || []).find(h => h.date === date);
                if (h) targetHearingId = h.id;
              }
              if (!targetHearingId) {
                const today = new Date().toISOString().split('T')[0];
                const next = (matched.hearings || [])
                  .filter(h => h.date >= today)
                  .sort((a, b) => a.date.localeCompare(b.date))[0];
                if (next) targetHearingId = next.id;
              }
              if (targetHearingId) {
                onExecuteAction('qi_agent', 'delete_hearing', {
                  caseId: matched.id, hearingId: targetHearingId
                });
                setConversationHistory(prev => [...prev, {
                  role: 'assistant',
                  content: `✅ Засідання у справі "${matched.name}"${date ? ` на ${date}` : ''} видалено`
                }]);
                setChatLoading(false);
                return;
              }
            }
          }

          if (action === 'add_deadline') {
            const caseName = actionResult.extracted?.case_name || actionResult.case_match?.case_name;
            const matched = caseName ? findCaseForAction(caseName, cases) : null;
            const date = actionResult.extracted?.deadline_date || actionResult.extracted?.date;
            const name = actionResult.extracted?.deadline_type || actionResult.extracted?.name || 'Дедлайн';
            if (matched && date) {
              onExecuteAction('qi_agent', 'add_deadline', {
                caseId: matched.id, name, date
              });
              setConversationHistory(prev => [...prev, {
                role: 'assistant',
                content: `✅ Дедлайн "${name}" у справі "${matched.name}" на ${date} додано`
              }]);
              setChatLoading(false);
              return;
            }
          }

          if (action === 'delete_deadline') {
            const caseName = actionResult.extracted?.case_name || actionResult.case_match?.case_name;
            const matched = caseName ? findCaseForAction(caseName, cases) : null;
            const date = actionResult.extracted?.deadline_date || actionResult.extracted?.date;
            const deadlineId = actionResult.extracted?.deadline_id || null;
            if (matched) {
              let targetDeadlineId = deadlineId;
              if (!targetDeadlineId && date) {
                const d = (matched.deadlines || []).find(d => d.date === date);
                if (d) targetDeadlineId = d.id;
              }
              if (!targetDeadlineId && matched.deadlines?.length > 0) {
                targetDeadlineId = matched.deadlines[0].id;
              }
              if (targetDeadlineId) {
                onExecuteAction('qi_agent', 'delete_deadline', {
                  caseId: matched.id, deadlineId: targetDeadlineId
                });
                setConversationHistory(prev => [...prev, {
                  role: 'assistant',
                  content: `✅ Дедлайн у справі "${matched.name}"${date ? ` на ${date}` : ''} видалено`
                }]);
                setChatLoading(false);
                return;
              }
            }
          }

          if (action === 'update_deadline') {
            const caseName = actionResult.extracted?.case_name || actionResult.case_match?.case_name;
            const matched = caseName ? findCaseForAction(caseName, cases) : null;
            const date = actionResult.extracted?.deadline_date || actionResult.extracted?.date;
            const name = actionResult.extracted?.deadline_type || actionResult.extracted?.name;
            const deadlineId = actionResult.extracted?.deadline_id || null;
            if (matched && date) {
              let targetDeadlineId = deadlineId;
              if (!targetDeadlineId && matched.deadlines?.length > 0) {
                targetDeadlineId = matched.deadlines[0].id;
              }
              if (targetDeadlineId) {
                onExecuteAction('qi_agent', 'update_deadline', {
                  caseId: matched.id, deadlineId: targetDeadlineId,
                  name: name || matched.deadlines.find(d => d.id === targetDeadlineId)?.name || 'Дедлайн',
                  date
                });
                setConversationHistory(prev => [...prev, {
                  role: 'assistant',
                  content: `✅ Дедлайн у справі "${matched.name}" оновлено: ${date}`
                }]);
                setChatLoading(false);
                return;
              }
              // Дедлайнів немає — створюємо новий
              onExecuteAction('qi_agent', 'add_deadline', {
                caseId: matched.id, name: name || 'Дедлайн', date
              });
              setConversationHistory(prev => [...prev, {
                role: 'assistant',
                content: `✅ Дедлайн "${name || 'Дедлайн'}" у справі "${matched.name}" на ${date} додано`
              }]);
              setChatLoading(false);
              return;
            }
          }

          // Для інших дій або якщо не знайшли — показати кнопки як fallback
          setConversationHistory(prev => [...prev, { role: 'assistant', content: displayText, actionResult }]);
        } else {
          setConversationHistory(prev => [...prev, { role: 'assistant', content: displayText }]);
        }
      }
    } catch (err) {
      setConversationHistory(prev => [...prev, { role: 'assistant', content: `Помилка мережі: ${err.message}` }]);
    }
    setChatLoading(false);
  };

  // ── Derived UI state ───────────────────────────────────────────────────────
  const activeScenarios = analysisResult ? getActiveScenarios(analysisResult) : [];

  const extractedFields = analysisResult?.extracted
    ? Object.entries(analysisResult.extracted).filter(([k, v]) =>
        k === 'deadlines' ? Array.isArray(v) && v.length > 0 : v !== null && v !== undefined && v !== ''
      )
    : [];

  const inputTypeIcon = !analysisResult ? '⚡' :
    analysisResult.input_type === 'subpoena'  ? '📅' :
    analysisResult.input_type === 'new_case'  ? '📋' :
    analysisResult.input_type === 'note'      ? '📝' :
    analysisResult.input_type === 'document'  ? '📄' : '🤖';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      style={Object.assign(
        { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden', background: 'var(--surface)' },
        dragOver ? { outline: '2px solid var(--accent)' } : {}
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div className="qi-title" style={{ margin: 0 }}>
          <span>{inputTypeIcon}</span> Quick Input
          <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-body)', fontWeight: 400, marginLeft: 4 }}>
            — текст, файл або фото
          </span>
        </div>
        <button className="modal-close" onClick={onClose} style={{ float: 'none', flexShrink: 0, marginLeft: 8 }}>✕</button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.docx"
        style={{ display: 'none' }}
        onChange={e => { handleFile(e.target.files[0]); e.target.value = ''; }}
      />

      {/* ── Top block: Document / text input ── */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          📎 Документ / текст
        </div>
        {isRecording && activeVoiceTarget === 'text' ? (
          <div style={{
            background: '#1a1a2e', border: '1px solid #4a4a8a',
            borderRadius: '8px', padding: '12px 16px',
            minHeight: '80px', display: 'flex',
            flexDirection: 'column', gap: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', height: '30px' }}>
              {[...Array(20)].map((_, i) => (
                <div key={i} style={{
                  width: '3px', background: '#6c63ff', borderRadius: '2px',
                  animation: `voiceWave 0.8s ease-in-out ${i * 0.04}s infinite alternate`,
                  minHeight: '4px', height: `${8 + (i % 5) * 5}px`
                }} />
              ))}
            </div>
            {voiceInterim && (
              <div style={{ color: '#888', fontSize: '13px', fontStyle: 'italic' }}>
                {voiceInterim}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={cancelVoice} style={{
                flex: 1, padding: '6px', background: '#333',
                color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer'
              }}>× Скасувати</button>
              <button onClick={stopVoice} style={{
                flex: 1, padding: '6px', background: '#6c63ff',
                color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer'
              }}>✓ Готово</button>
            </div>
          </div>
        ) : (
          <textarea
            className="qi-textarea"
            style={{ height: 90, marginBottom: 0 }}
            placeholder="Вставте текст повістки з Viber, напишіть повідомлення від клієнта, або перетягніть файл..."
            value={text}
            onChange={e => setText(e.target.value)}
            autoFocus
          />
        )}
        <div className="qi-row" style={{ margin: 0, marginTop: 8 }}>
          <button
            className="btn-sm btn-ghost"
            onClick={() => startVoiceInput(setText, 'text')}
            title="Надиктувати голосом"
          >
            🎤
          </button>
          <button className="btn-sm btn-ghost" onClick={() => fileInputRef.current.click()}>
            📎 Файл
          </button>
          <div style={{ flex: 1 }} />
          {apiKey
            ? <button
                className="btn-sm btn-primary"
                onClick={analyze}
                disabled={loading || !text.trim()}
              >
                {loading ? '⏳ Аналіз...' : '→ Аналізувати'}
              </button>
            : <span style={{ fontSize: 11, color: 'var(--orange)' }}>
                ⚠️ Додайте API-ключ
              </span>
          }
        </div>
      </div>

      {/* ── Bottom block: Chat with agent ── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '10px 16px 0 16px' }}>
          💬 Чат з агентом
        </div>

        {/* Scrollable chat messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px', minHeight: 0, display: 'flex', flexDirection: 'column' }}>

          {/* Error card (no result yet) */}
          {errorCategory && !analysisResult && (
            <div className="qi-error-card">
              <div className="qi-error-title">
                {errorCategory === 'llm_failed' ? '⚠️ Помилка API' :
                 errorCategory === 'unsupported_format' ? '⚠️ Формат не підтримується' :
                 '⚠️ Помилка обробки'}
              </div>
              <div style={{ color: 'var(--text2)', marginBottom: 8 }}>
                {QI_ERROR_MESSAGES[errorCategory]}
                {errorDetail && <span style={{ color: 'var(--text3)', display: 'block', marginTop: 4, fontSize: 11 }}>{errorDetail}</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-sm btn-ghost" onClick={() => { setErrorCategory(null); setErrorDetail(''); }}>Спробувати ще</button>
                <button className="btn-sm btn-primary" onClick={saveCurrentTextAsNote} disabled={!text.trim()}>📝 Зберегти як нотатку</button>
              </div>
            </div>
          )}

          {/* Chat messages (including analysis card as first message) */}
          {conversationHistory.slice(0).map((msg, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
              {msg.analysisCard ? (
                <div className="qi-action-card" style={{ width: '100%' }}>
                  {/* Header */}
                  <div className="qi-action-card-header">
                    <span style={{ fontSize: 20, lineHeight: 1 }}>{inputTypeIcon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.4 }}>
                        {msg.analysisCard.human_message}
                      </div>
                      {msg.analysisCard.case_match?.found && (
                        <div className="qi-case-match">
                          ✅ Справа: <strong>{msg.analysisCard.case_match.case_name}</strong>
                          <span style={{ color: 'var(--text3)' }}>
                            ({Math.round((msg.analysisCard.case_match.confidence || 0) * 100)}%)
                          </span>
                        </div>
                      )}
                      {activeScenarios.length > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
                          {activeScenarios.map(s => s.label).join(' · ')}
                        </div>
                      )}
                    </div>
                    {msg.analysisCard.needs_review && (
                      <span className="qi-review-badge">⚠️ Перевірте</span>
                    )}
                  </div>

                  {/* Extracted fields */}
                  {extractedFields.length > 0 && (
                    <div className="qi-action-card-body">
                      {extractedFields.map(([k, v]) => (
                        <div key={k} className="qi-extracted-field">
                          <span className="qi-extracted-label">{QI_FIELD_LABELS[k] || k}</span>
                          <span className="qi-extracted-val">
                            {Array.isArray(v) ? v.map(item => typeof item === 'object' ? (item.date || JSON.stringify(item)) : String(item)).join(', ') : (typeof v === 'object' ? (v.date || JSON.stringify(v)) : String(v))}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Warnings */}
                  {msg.analysisCard.warnings && msg.analysisCard.warnings.length > 0 && (
                    <div style={{ padding: '4px 0' }}>
                      {msg.analysisCard.warnings.map((w, wi) => (
                        <div key={wi} className="qi-warning-row">⚠️ {w}</div>
                      ))}
                    </div>
                  )}
                  {errorCategory === 'low_confidence' && (
                    <div className="qi-warning-row">⚠️ {QI_ERROR_MESSAGES.low_confidence}</div>
                  )}

                  {/* Action buttons */}
                  <div className="qi-action-btns">
                    {(msg.analysisCard.recommended_actions || []).map(action =>
                      executedActions.includes(action)
                        ? <span key={action} className="qi-done-action">✓ {QI_ACTION_LABELS[action] || action}</span>
                        : (action === 'save_to_drive' || action === 'create_drive_folder') && !driveConnected
                          ? <button key={action} className="btn-sm btn-ghost" disabled title="Підключіть Google Drive в розділі «Аналіз системи»" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                              ☁️ Drive (не підключено)
                            </button>
                          : <button key={action} className="btn-sm btn-primary" onClick={() => executeQiAction(action)}>
                              {QI_ACTION_LABELS[action] || action}
                            </button>
                    )}
                    {/* Завжди доступно: зберегти результат аналізу як нотатку */}
                    {!executedActions.includes('save_note') && (
                      <button
                        className="btn-sm btn-ghost"
                        onClick={async () => {
                          const card = msg.analysisCard || {};
                          const ext = card.extracted || {};
                          const noteText = [
                            card.human_message || '',
                            ext.doc_type ? `Тип документа: ${ext.doc_type}` : '',
                            ext.hearing_date ? `Дата засідання: ${ext.hearing_date}` : '',
                            ext.hearing_time ? `Час: ${ext.hearing_time}` : '',
                            ext.court ? `Суд: ${ext.court}` : '',
                            ext.judge ? `Суддя: ${ext.judge}` : '',
                            ext.case_number ? `Номер справи: ${ext.case_number}` : '',
                            ext.deadline_date ? `Дедлайн: ${ext.deadline_date}` : '',
                            ext.deadline_type ? `Тип дедлайну: ${ext.deadline_type}` : '',
                          ].filter(Boolean).join('\n');
                          const matchedName = card.case_match?.case_name;
                          const matched = matchedName ? findCaseForAction(matchedName, cases) : null;
                          await onExecuteAction('qi_agent', 'add_note', {
                            caseId: matched?.id || null,
                            text: noteText || (card.human_message || 'Аналіз документа'),
                            date: ext.hearing_date || ext.deadline_date || null,
                            time: ext.hearing_time || null,
                            category: matched ? 'case' : 'general',
                          });
                          setExecutedActions(prev => [...prev, 'save_note']);
                          setConversationHistory(prev => [...prev, {
                            role: 'assistant',
                            content: 'Нотатку з результатами аналізу збережено'
                              + (matched ? ` до справи "${matched.name}"` : '')
                              + '.'
                          }]);
                        }}
                      >
                        📝 Додати нотатку
                      </button>
                    )}
                    <button
                      className="btn-sm btn-ghost"
                      style={{ marginLeft: 'auto' }}
                      onClick={() => { setAnalysisResult(null); setErrorCategory(null); setErrorDetail(''); setExecutedActions([]); setConversationHistory([]); setPendingStatusChange(null); }}
                    >
                      ← Змінити
                    </button>
                  </div>

                  {/* Inline status change UI */}
                  {pendingStatusChange && (
                    <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
                        Змінити статус справи <strong>"{pendingStatusChange.caseName}"</strong> на:
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {[['active','Активна','var(--green)'],['paused','Призупинена','var(--orange)'],['closed','Закрита','var(--text3)']].map(([val, label, color]) => (
                          <button key={val} className="btn-sm btn-ghost" style={{ borderColor: color, color }}
                            onClick={() => {
                              onExecuteAction('qi_agent', 'update_case_field', { caseId: pendingStatusChange.caseId, field: 'status', value: val });
                              setExecutedActions(prev => [...prev, 'update_case_status']);
                              setPendingStatusChange(null);
                            }}
                          >{label}</button>
                        ))}
                        <button className="btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setPendingStatusChange(null)}>Скасувати</button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={Object.assign(
                  { maxWidth: '90%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', fontSize: 13, lineHeight: 1.5,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'break-word' },
                  msg.role === 'user'
                    ? { background: 'rgba(79,124,255,0.1)', border: '1px solid rgba(79,124,255,0.2)' }
                    : { background: 'var(--surface2)', border: '1px solid var(--border)' }
                )}>
                  {/* content може бути рядком, масивом блоків (image+text для Vision) або обʼєктом — приводимо до рендеру */}
                  {typeof msg.content === 'string'
                    ? msg.content
                    : Array.isArray(msg.content)
                      ? msg.content.map((block, bi) => {
                          if (!block) return null;
                          if (block.type === 'image') return <span key={bi} style={{ opacity: 0.7 }}>🖼️ зображення</span>;
                          if (block.type === 'text') return <span key={bi}>{String(block.text || '')}</span>;
                          return <span key={bi}>{typeof block === 'string' ? block : JSON.stringify(block)}</span>;
                        })
                      : (msg.content == null ? '' : (() => { try { return JSON.stringify(msg.content); } catch { return ''; } })())
                  }
                  {msg.actionResult && (msg.actionResult.recommended_actions || []).length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {msg.actionResult.recommended_actions.map(action => (
                        <button key={action} className="btn-sm btn-primary" onClick={() => executeQiAction(action, msg.actionResult)} style={{ fontSize: 11 }}>
                          {QI_ACTION_LABELS[action] || action}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {chatLoading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 8 }}>
              <div style={{ padding: '8px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--text2)' }}>
                ⏳ Думаю...
              </div>
            </div>
          )}

          {!analysisResult && conversationHistory.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text3)', padding: '12px 0', textAlign: 'center' }}>
              Завантажте документ або напишіть повідомлення агенту
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Chat input row — always visible */}
        {apiKey && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            {isRecording && activeVoiceTarget === 'chat' ? (
              <div style={{
                background: '#1a1a2e', border: '1px solid #4a4a8a',
                borderRadius: '8px', padding: '12px 16px',
                minHeight: '80px', display: 'flex',
                flexDirection: 'column', gap: '8px', marginBottom: 6
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px', height: '30px' }}>
                  {[...Array(20)].map((_, i) => (
                    <div key={i} style={{
                      width: '3px', background: '#6c63ff', borderRadius: '2px',
                      animation: `voiceWave 0.8s ease-in-out ${i * 0.04}s infinite alternate`,
                      minHeight: '4px', height: `${8 + (i % 5) * 5}px`
                    }} />
                  ))}
                </div>
                {voiceInterim && (
                  <div style={{ color: '#888', fontSize: '13px', fontStyle: 'italic' }}>
                    {voiceInterim}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={cancelVoice} style={{
                    flex: 1, padding: '6px', background: '#333',
                    color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer'
                  }}>× Скасувати</button>
                  <button onClick={stopVoice} style={{
                    flex: 1, padding: '6px', background: '#6c63ff',
                    color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer'
                  }}>✓ Готово</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <textarea
                  ref={chatInputRef}
                  className="qi-chat-input"
                  rows={2}
                  style={{ resize: 'none' }}
                  placeholder="Команда для агента... (напр. «додай засідання»)"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                  disabled={chatLoading}
                />
                <button
                  className="btn-sm btn-ghost"
                  onClick={() => startVoiceInput(setChatInput, 'chat')}
                  style={{ flexShrink: 0, padding: '6px 8px' }}
                  title="Надиктувати голосом"
                >
                  🎤
                </button>
                <button className="btn-sm btn-primary" onClick={sendChat} disabled={chatLoading || !chatInput.trim()} style={{ flexShrink: 0 }}>→</button>
              </div>
            )}
          </div>
        )}

        {/* Bottom close */}
        <div className="qi-row" style={{ padding: '6px 16px', margin: 0, flexShrink: 0, borderTop: '1px solid var(--border)' }}>
          <button className="btn-sm btn-ghost" onClick={onClose}>
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
}

// ── INTAKE / ADD CASE FORM ────────────────────────────────────────────────────
function AddCaseForm({ onSave, onCancel, initialData }) {
  // Nотатки справи тримаємо як масив — форма редагує текст "form-source" нотатки,
  // решта (з Notebook тощо) зберігаються без змін.
  const extractFormNoteText = (notes) => {
    if (!Array.isArray(notes)) return typeof notes === 'string' ? notes : '';
    const formNote = notes.find(n => n.source === 'form');
    if (formNote) return formNote.text || '';
    return notes.map(n => n.text).filter(Boolean).join('\n');
  };
  const initialNotesArr = Array.isArray(initialData?.notes)
    ? initialData.notes
    : (typeof initialData?.notes === 'string' && initialData.notes
        ? [{ id: Date.now(), text: initialData.notes, category: 'case', source: 'form', ts: new Date().toISOString() }]
        : []);

  const nextH = initialData ? getNextHearing(initialData) : null;
  const [form, setForm] = useState(initialData ? {
    name: initialData.name || '',
    client: initialData.client || '',
    category: initialData.category || 'civil',
    status: initialData.status || 'active',
    court: initialData.court || '',
    case_no: initialData.case_no || '',
    hearing_date: nextH?.date || '',
    hearing_time: nextH?.time || '',
    deadline: getDeadlineDate(initialData) || '',
    deadline_type: getNextDeadline(initialData)?.name || '',
    next_action: initialData.next_action || '',
    notes: extractFormNoteText(initialData.notes),
  } : {
    name:'', client:'', category:'civil', status:'active',
    court:'', case_no:'', hearing_date:'', hearing_time:'', deadline:'',
    deadline_type:'', next_action:'', notes:''
  });
  const originalNotes = initialNotesArr;
  const set = (k,v) => setForm(f => ({...f,[k]:v}));
  const [msgs, setMsgs] = useState([
    {role:'ai', txt:'Доброго дня! Допоможу заповнити картку справи. Розкажіть про клієнта і ситуацію — або одразу заповніть поля. Можете сфотографувати документи і завантажити — розпізнаю текст автоматично.'}
  ]);
  const [aiIn, setAiIn] = useState('');

  const sendAi = () => {
    if (!aiIn.trim()) return;
    const userMsg = {role:'user', txt: aiIn};
    const t = aiIn.toLowerCase();
    let reply = '';
    if (t.includes('клієнт') || t.includes('справ') || t.includes('ситуаці')) {
      reply = 'Зрозумів. Заповніть поле «Назва» і суд — решту можна додати пізніше. Якщо є документи — завантажте фото, я витягну реквізити.';
    } else if (t.includes('документ') || t.includes('паспорт') || t.includes('договір')) {
      reply = 'Якщо є скан або фото цього документа — завантажте нижче. Я розпізнаю текст і внесу дані у форму.';
    } else {
      reply = 'Зафіксовано. Додаю до нотаток справи. Що ще важливо зафіксувати?';
      setForm(f => ({...f, notes: f.notes ? f.notes + '\n' + aiIn : aiIn}));
    }
    setMsgs(m => [...m, userMsg, {role:'ai', txt: reply}]);
    setAiIn('');
  };

  return (
    <div className="form-panel">
      <div className="form-title">{initialData ? 'Редагувати справу' : 'Нова справа — Intake'}</div>
      <div className="form-desc">Заповніть форму, використайте AI-чат для нотаток, або завантажте документи для автозаповнення</div>

      {/* AI chat */}
      <div className="ai-chat">
        <div className="ai-chat-label">🤖 AI-асистент · Швидкий ввід</div>
        <div className="ai-msgs">
          {msgs.map((m,i) => <div key={i} className={`ai-msg ${m.role}`}>{m.txt}</div>)}
        </div>
        <div className="ai-input-row">
          <input className="ai-input" placeholder="Напишіть про клієнта, ситуацію, або запитайте..." value={aiIn} onChange={e=>setAiIn(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendAi()}/>
          <button className="btn-sm btn-primary" onClick={sendAi}>→</button>
        </div>
      </div>

      {/* Upload zone */}
      <div className="upload-zone">
        <div className="upload-zone-icon">📎</div>
        <div className="upload-zone-text">Завантажте фото документів або сканів</div>
        <div className="upload-zone-hint">AI розпізнає текст і заповнить поля форми автоматично</div>
        <div className="upload-zone-btns">
          <button className="btn-sm btn-primary">📎 Завантажити файл (фото, скан, PDF)</button>
          <button className="btn-sm btn-ghost">☁️ Google Drive</button>
        </div>
      </div>

      <div className="form-divider"/>
      <div className="form-section-label">Дані справи</div>

      <div className="form-grid">
        <div className="form-group">
          <label className="form-label">Назва / Клієнт *</label>
          <input className="form-input" placeholder="Прізвище або назва" value={form.name} onChange={e=>set('name',e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">ПІБ клієнта *</label>
          <input className="form-input" placeholder="Повне ПІБ" value={form.client} onChange={e=>set('client',e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Категорія</label>
          <select className="form-select" value={form.category} onChange={e=>set('category',e.target.value)}>
            <option value="civil">Цивільна</option>
            <option value="criminal">Кримінальна</option>
            <option value="military">Військова</option>
            <option value="admin">Адміністративна</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Статус</label>
          <select className="form-select" value={form.status} onChange={e=>set('status',e.target.value)}>
            <option value="active">Активна</option>
            <option value="paused">Призупинена</option>
            <option value="closed">Закрита</option>
          </select>
        </div>
        <div className="form-group full">
          <label className="form-label">Суд *</label>
          <input className="form-input" placeholder="Назва суду" value={form.court} onChange={e=>set('court',e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Номер справи</label>
          <input className="form-input" placeholder="363/1234/24" value={form.case_no} onChange={e=>set('case_no',e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Дата засідання</label>
          <input className="form-input" type="date" value={form.hearing_date} onChange={e=>set('hearing_date',e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Час засідання</label>
          <input className="form-input" type="time" value={form.hearing_time} onChange={e=>set('hearing_time',e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Дедлайн подачі</label>
          <input className="form-input" type="date" value={form.deadline} onChange={e=>set('deadline',e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Тип дедлайну</label>
          <input className="form-input" placeholder="Напр.: Заява про витрати" value={form.deadline_type} onChange={e=>set('deadline_type',e.target.value)} />
        </div>
        <div className="form-group full">
          <label className="form-label">Наступна дія</label>
          <input className="form-input" placeholder="Що зробити далі" value={form.next_action} onChange={e=>set('next_action',e.target.value)} />
        </div>
        <div className="form-group full">
          <label className="form-label">Нотатки</label>
          <textarea className="form-textarea" placeholder="Обставини справи, важливі деталі, що сказав клієнт..." value={form.notes} onChange={e=>set('notes',e.target.value)} />
        </div>
      </div>
      <div className="form-actions">
        <button className="btn-lg primary" onClick={() => {
          if(!form.name) return;
          const nonFormNotes = originalNotes.filter(n => n.source !== 'form');
          const formText = (form.notes || '').trim();
          const existingFormNote = originalNotes.find(n => n.source === 'form');
          const formNoteArr = formText
            ? [{
                id: existingFormNote?.id || Date.now(),
                text: formText,
                category: 'case',
                source: 'form',
                ts: existingFormNote?.ts || new Date().toISOString(),
              }]
            : [];
          const mergedNotes = [...formNoteArr, ...nonFormNotes];
          // Конвертуємо hearing_date/time форми назад у hearings[]
          const { hearing_date: _fd, hearing_time: _ft, deadline: _fDl, deadline_type: _fDlType, ...formWithoutTempFields } = form;
          let newHearings = initialData?.hearings ? [...initialData.hearings] : [];
          if (_fd) {
            // Оновити існуюче scheduled засідання або додати нове
            const existingIdx = newHearings.findIndex(h => h.status === 'scheduled' && h.id === nextH?.id);
            if (existingIdx >= 0) {
              newHearings[existingIdx] = { ...newHearings[existingIdx], date: _fd, time: _ft || '' };
            } else {
              newHearings.push({ id: `hrg_${Date.now()}`, date: _fd, time: _ft || '', court: form.court || '', notes: '', status: 'scheduled' });
            }
          }
          // Конвертуємо deadline/deadline_type форми назад у deadlines[]
          let newDeadlines = initialData?.deadlines ? [...initialData.deadlines] : [];
          const nextDlForm = initialData ? getNextDeadline(initialData) : null;
          if (_fDl) {
            const existingDlIdx = newDeadlines.findIndex(d => d.id === nextDlForm?.id);
            if (existingDlIdx >= 0) {
              newDeadlines[existingDlIdx] = { ...newDeadlines[existingDlIdx], date: _fDl, name: _fDlType || newDeadlines[existingDlIdx].name };
            } else {
              newDeadlines.push({ id: `dl_${Date.now()}`, name: _fDlType || "Дедлайн", date: _fDl });
            }
          }
          const payload = initialData
            ? { ...formWithoutTempFields, id: initialData.id, hearings: newHearings, deadlines: newDeadlines, notes: mergedNotes, pinnedNoteIds: initialData.pinnedNoteIds || [] }
            : { ...formWithoutTempFields, hearings: newHearings, deadlines: newDeadlines, notes: mergedNotes, pinnedNoteIds: [] };
          onSave(payload);
        }}>{initialData ? 'Зберегти зміни' : 'Зберегти справу'}</button>
        <button className="btn-lg secondary" onClick={onCancel}>Скасувати</button>
        <button className="btn-sm btn-ghost" style={{marginLeft:'auto'}}>💡 Ідея для контенту</button>
      </div>
    </div>
  );
}

// ── USAGE LOGGER ─────────────────────────────────────────────────────────────
const usageLog = {
  log(action, meta = {}) {
    try {
      const logs = JSON.parse(localStorage.getItem('levytskyi_usage') || '[]');
      logs.push({ action, meta, ts: new Date().toISOString() });
      // Keep last 500 entries
      if (logs.length > 500) logs.splice(0, logs.length - 500);
      localStorage.setItem('levytskyi_usage', JSON.stringify(logs));
    } catch(e) {}
  },
  getStats() {
    try {
      const logs = JSON.parse(localStorage.getItem('levytskyi_usage') || '[]');
      const counts = {};
      logs.forEach(l => { counts[l.action] = (counts[l.action] || 0) + 1; });
      return { total: logs.length, counts, logs };
    } catch(e) { return { total: 0, counts: {}, logs: [] }; }
  },
  getIdeas() {
    try { return JSON.parse(localStorage.getItem('levytskyi_ideas') || '[]'); }
    catch(e) { return []; }
  },
  saveIdea(text) {
    try {
      const ideas = this.getIdeas();
      ideas.push({ text, ts: new Date().toISOString() });
      localStorage.setItem('levytskyi_ideas', JSON.stringify(ideas));
    } catch(e) {}
  }
};

// ── GOOGLE DRIVE SERVICE ──────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = DRIVE_CLIENT_ID;
const DRIVE_SCOPE = DRIVE_SCOPE_IMPORT;
const DRIVE_FILE_NAME = 'registry_data.json';

const driveService = {
  _fileId: null,

  isConnected() { return !!localStorage.getItem('levytskyi_drive_token'); },
  getToken()    { return localStorage.getItem('levytskyi_drive_token'); },
  saveToken(t)  { localStorage.setItem('levytskyi_drive_token', t); },
  clearToken()  { localStorage.removeItem('levytskyi_drive_token'); this._fileId = null; },

  authorize() {
    return new Promise((resolve, reject) => {
      if (!window.google) { reject(new Error('Google API не завантажено')); return; }
      const client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: (resp) => {
          if (resp.error) { reject(new Error(resp.error)); return; }
          this.saveToken(resp.access_token);
          resolve(resp.access_token);
        }
      });
      client.requestAccessToken();
    });
  },

  async _findFileId(token) {
    if (this._fileId) return this._fileId;
    const res = await driveRequest(
      `https://www.googleapis.com/drive/v3/files?q=name='${DRIVE_FILE_NAME}'+and+trashed=false&fields=files(id)`
    );
    const data = await res.json();
    if (data.files && data.files.length > 0) { this._fileId = data.files[0].id; }
    return this._fileId || null;
  },

  // Читає весь файл як є. Може повернути:
  //   • null — файлу нема
  //   • Array — старий формат (schemaVersion: 1)
  //   • Object — новий формат (schemaVersion: 2+)
  async readRegistry(token) {
    const id = await this._findFileId(token);
    if (!id) return null;
    const res = await driveRequest(
      `https://www.googleapis.com/drive/v3/files/${id}?alt=media`
    );
    if (!res.ok) return null;
    return await res.json();
  },

  // Пише весь registry-об'єкт як JSON.
  async writeRegistry(token, registry) {
    const body = JSON.stringify(registry);
    const id = await this._findFileId(token);
    if (id) {
      await driveRequest(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body
      });
    } else {
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify({ name: DRIVE_FILE_NAME, mimeType: 'application/json' })], { type: 'application/json' }));
      form.append('file', new Blob([body], { type: 'application/json' }));
      const res = await driveRequest('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        body: form
      });
      const created = await res.json();
      this._fileId = created.id;
    }
  },

  // ── LEGACY READER ──────────────────────────────────────────────────────────
  // readCases повертає лише масив cases[] зі старого або нового формату.
  // Використовується в AnalysisPanel.connectDrive для імпорту старих файлів.
  async readCases(token) {
    const raw = await this.readRegistry(token);
    if (!raw) return null;
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.cases)) return raw.cases;
    return null;
  }
};

// ── ANALYSIS MODULE ───────────────────────────────────────────────────────────
function AnalysisPanel({ cases, setCases, driveConnected, setDriveConnected, driveSyncStatus }) {
  const stats = usageLog.getStats();
  const ideas = usageLog.getIdeas();

  const WEEKLY_INSIGHTS = [
    { ts: '09:14', text: 'За останні 7 днів Quick Input використовувався 12 разів — найпопулярніша функція. Всі запити стосувались повісток. Можливо варто додати окрему кнопку «Додати повістку» прямо на дашборді?', type: 'insight' },
    { ts: '09:14', text: 'Помічено: розділ «Нова справа» відкривався 4 рази, але форма заповнювалась лише двічі. Можливо форма потребує спрощення або є поля які блокують заповнення?', type: 'insight' },
    { ts: '09:14', text: 'Content Spark використовується рідко (2 рази за тиждень). Можливо розмістити кнопку помітніше або додати підказку при відкритті картки справи?', type: 'insight' },
  ];

  const [msgs, setMsgs] = useState([
    { role: 'ai', text: '👋 Доброго дня. Я аналізую як використовується система і пропоную покращення.', ts: 'зараз' },
    ...WEEKLY_INSIGHTS.map(i => ({ role: 'ai', text: i.text, ts: 'тиждень тому', type: 'insight' })),
    { role: 'ai', text: 'Якщо у вас є ідеї або спостереження — напишіть їх нижче. Я їх запамятаю і врахую при наступному аналізі.', ts: 'зараз' },
  ]);
  const [input, setInput] = useState('');
  const msgsEndRef = useRef(null);

  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  const RESPONSES = [
    text => text.includes('кнопк') || text.includes('незручн')
      ? 'Зафіксував. Це важливе спостереження — UX-проблеми варто вирішувати в першу чергу. Збережу як пріоритетну ідею.'
      : null,
    text => text.includes('доди') || text.includes('нов') || text.includes('функці')
      ? 'Цікава ідея. Збережу до банку пропозицій. Коли накопичиться кілька повязаних ідей — запропоную як один блок змін.'
      : null,
    text => text.includes('повільн') || text.includes('швидш')
      ? 'Зрозумів. Продуктивність — критичний параметр для щоденного інструменту. Зафіксую і врахую при наступній оптимізації.'
      : null,
    () => 'Прийнято, зберігаю до банку ідей. Дякую за спостереження — саме такий зворотний зв’язок робить систему кращою.'
  ];

  const send = () => {
    if (!input.trim()) return;
    const userMsg = { role: 'user', text: input, ts: 'зараз' };
    usageLog.saveIdea(input);
    usageLog.log('analysis_idea_saved', { text: input.slice(0, 50) });
    const t = input.toLowerCase();
    const replyText = RESPONSES.find(fn => fn(t) !== null)?.(t) || RESPONSES[RESPONSES.length-1]();
    const aiMsg = { role: 'ai', text: replyText, ts: 'зараз' };
    const savedMsg = { role: 'saved', text: '✓ Ідею збережено до банку пропозицій', ts: '' };
    setMsgs(m => [...m, userMsg, aiMsg, savedMsg]);
    setInput('');
  };

  const ACTION_LABELS = {
    open_case: 'Відкрито карток справ',
    quick_input: 'Quick Input запитів',
    content_spark: 'Content Spark сесій',
    doc_generated: 'Документів згенеровано',
    case_added: 'Справ додано',
    analysis_idea_saved: 'Ідей збережено',
  };

  const importRef = useRef(null);
  const [apiKeyInput, setApiKeyInput] = useState(() => localStorage.getItem('claude_api_key') || '');
  const [apiKeySaved, setApiKeySaved] = useState(() => !!localStorage.getItem('claude_api_key'));

  const saveApiKey = () => {
    const val = apiKeyInput.trim();
    if (!val) { systemAlert('Введіть API ключ'); return; }
    localStorage.setItem('claude_api_key', val);
    setApiKeySaved(true);
  };

  const exportData = () => {
    const date = new Date().toISOString().slice(0,10);
    const blob = new Blob([JSON.stringify(cases, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `registry_export_${date}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (!Array.isArray(parsed)) { systemAlert('Невірний формат файлу. Очікується масив справ.'); return; }
        if (!await systemConfirm(`Буде завантажено ${parsed.length} справ. Поточні дані будуть замінені. Продовжити?`, 'Імпорт')) return;
        const normalized = normalizeCases(parsed);
        setCases(normalized);
        localStorage.setItem('levytskyi_cases', JSON.stringify(normalized));
        systemAlert(`Імпортовано ${parsed.length} справ.`);
      } catch(err) { systemAlert('Помилка читання файлу: ' + err.message); }
    };
    reader.readAsText(file);
  };

  const connectDrive = async () => {
    try {
      const token = await driveService.authorize();
      setDriveConnected(true);
      await systemAlert('Google Drive підключено успішно!');
      const driveCases = await driveService.readCases(token);
      if (driveCases && Array.isArray(driveCases)) {
        if (await systemConfirm(`На Google Drive знайдено ${driveCases.length} справ. Завантажити і замінити поточні?`, 'Google Drive')) {
          setCases(normalizeCases(driveCases));
        }
      }
    } catch(err) { await systemAlert('Помилка підключення: ' + err.message); }
  };

  const disconnectDrive = () => {
    driveService.clearToken();
    setDriveConnected(false);
  };

  return (
    <div className="analysis-panel">
      <div className="form-title" style={{marginBottom:4}}>🔍 Аналіз системи</div>
      <div className="form-desc">Спостереження за використанням · Ідеї для покращення</div>

      {/* API Settings */}
      <div className="section-title" style={{fontSize:10,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--text3)',marginBottom:10}}>API налаштування</div>
      <div style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:'var(--radius-sm)',padding:14,marginBottom:20}}>
        <label className="form-label" style={{display:'block',marginBottom:8}}>Claude API Key</label>
        <div style={{display:'flex',gap:8,marginBottom:8}}>
          <input
            type="password"
            className="form-input"
            style={{flex:1}}
            placeholder="sk-ant-..."
            value={apiKeyInput}
            onChange={e => { setApiKeyInput(e.target.value); setApiKeySaved(false); }}
          />
          <button className="btn-sm btn-primary" onClick={saveApiKey}>Зберегти ключ</button>
        </div>
        <div style={{fontSize:11}}>
          {apiKeySaved
            ? <span style={{color:'var(--green)'}}>✅ API ключ збережено</span>
            : <span style={{color:'var(--orange)'}}>⚠️ Ключ не додано</span>
          }
        </div>
      </div>

      {/* Export / Import */}
      <div className="section-title" style={{fontSize:10,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--text3)',marginBottom:10}}>Резервне копіювання</div>
      <div style={{display:'flex',gap:8,marginBottom:20,flexWrap:'wrap'}}>
        <button className="btn-sm btn-ghost" onClick={exportData}>⬇ Експорт даних</button>
        <button className="btn-sm btn-ghost" onClick={() => importRef.current.click()}>⬆ Імпорт даних</button>
        <input ref={importRef} type="file" accept=".json" style={{display:'none'}} onChange={e => { importData(e.target.files[0]); e.target.value=''; }} />
      </div>

      {/* Google Drive */}
      <div className="section-title" style={{fontSize:10,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--text3)',marginBottom:10}}>Google Drive синхронізація</div>
      <div style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:'var(--radius-sm)',padding:14,marginBottom:20}}>
        {driveConnected ? (
          <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
            <span style={{color:'var(--green)',fontSize:13}}>✅ Google Drive підключено</span>
            {driveSyncStatus === 'syncing' && <span style={{fontSize:11,color:'var(--text3)'}}>⏳ Збереження...</span>}
            {driveSyncStatus === 'synced'  && <span style={{fontSize:11,color:'var(--text3)'}}>✓ Синхронізовано</span>}
            {driveSyncStatus === 'error'   && <span style={{fontSize:11,color:'var(--red)'}}>⚠ Помилка синхронізації</span>}
            <button className="btn-sm btn-ghost" onClick={async () => { driveService.clearToken(); setDriveConnected(false); await connectDrive(); }} title="Очистити токен і запросити нові дозволи">{"🔄 Оновити дозволи"}</button>
            <button className="btn-sm btn-ghost" style={{marginLeft:'auto'}} onClick={disconnectDrive}>Відключити</button>
          </div>
        ) : (
          <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
            <div style={{flex:1}}>
              <div style={{fontSize:13,marginBottom:4}}>Автоматична синхронізація справ через Google Drive</div>
              <div style={{fontSize:11,color:'var(--text3)'}}>Дані зберігаються у файл registry_data.json у вашому Drive</div>
            </div>
            <button className="btn-sm btn-primary" onClick={connectDrive}>🔗 Підключити Google Drive</button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="section-title" style={{fontSize:10,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--text3)',marginBottom:10}}>Статистика використання</div>
      <div className="analysis-stats">
        <div className="analysis-stat">
          <div className="analysis-stat-val">{cases.filter(c=>c.status==='active').length}</div>
          <div className="analysis-stat-lbl">Активних справ</div>
        </div>
        <div className="analysis-stat">
          <div className="analysis-stat-val">{stats.total || 0}</div>
          <div className="analysis-stat-lbl">Дій в системі</div>
        </div>
        {Object.entries(ACTION_LABELS).map(([key, label]) => (
          stats.counts[key] ? (
            <div key={key} className="analysis-stat">
              <div className="analysis-stat-val">{stats.counts[key]}</div>
              <div className="analysis-stat-lbl">{label}</div>
            </div>
          ) : null
        ))}
      </div>

      {/* AI Chat */}
      <div className="section-title" style={{fontSize:10,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--text3)',marginBottom:10}}>AI-аналіз і пропозиції</div>
      <div style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:'var(--radius-sm)',padding:14}}>
        <div className="analysis-msgs">
          {msgs.map((m, i) => (
            <div key={i} className={`analysis-msg ${m.role}${m.type==='insight'?' insight':''}`}>
              {m.text}
              {m.ts && <div style={{fontSize:10,color:'var(--text3)',marginTop:4}}>{m.ts}</div>}
            </div>
          ))}
          <div ref={msgsEndRef}/>
        </div>
        <div style={{display:'flex',gap:8}}>
          <input
            className="ai-input"
            placeholder="Напишіть ідею або спостереження щодо системи..."
            value={input}
            onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&send()}
          />
          <button className="btn-sm btn-primary" onClick={send}>→</button>
        </div>
      </div>

      {/* Saved ideas */}
      {ideas.length > 0 && (
        <div className="ideas-list">
          <div style={{fontSize:10,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--text3)',marginBottom:10}}>Банк ідей ({ideas.length})</div>
          {ideas.slice().reverse().slice(0,8).map((idea, i) => (
            <div key={i} className="idea-item">
              <div className="idea-dot"/>
              <div>
                <div>{idea.text}</div>
                <div style={{fontSize:10,color:'var(--text3)',marginTop:2}}>
                  {new Date(idea.ts).toLocaleDateString('uk-UA',{day:'2-digit',month:'2-digit',year:'numeric'})}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Нормалізує cases[] — міграція старих форматів
// Coerce будь-що до рядка для безпечного рендеру.
// Якщо поле колись зберіглося як обʼєкт (агент повернув JSON замість тексту) —
// React #31 валить весь додаток. Чистимо на завантаженні.
function toSafeStr(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return ''; }
}

function normalizeCases(cases) {
  if (!Array.isArray(cases)) return [];
  return cases.map(c => {
    try {
    let updated = (c && typeof c === 'object' && !Array.isArray(c)) ? { ...c } : {};

    // userId — додати якщо немає
    if (!updated.userId) updated.userId = 'vadym';
    if (updated.id == null) updated.id = `case_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;

    // createdAt / updatedAt — додати якщо немає
    if (!updated.createdAt) updated.createdAt = new Date().toISOString();
    if (!updated.updatedAt) updated.updatedAt = new Date().toISOString();

    // Поля верхнього рівня що рендеряться — захист від обʼєктів.
    ['name','client','court','case_no','next_action','category','status'].forEach(k => {
      if (updated[k] != null && typeof updated[k] !== 'string') {
        updated[k] = toSafeStr(updated[k]);
      }
    });

    // notes: рядок → масив
    if (typeof updated.notes === 'string' && updated.notes.trim()) {
      updated.notes = [{
        id: Date.now() + Math.random(),
        text: updated.notes,
        category: 'case',
        source: 'form',
        ts: new Date().toISOString(),
      }];
    } else if (!Array.isArray(updated.notes)) {
      updated.notes = [];
    }
    updated.notes = updated.notes
      .filter(n => n && typeof n === 'object')
      .map(n => ({
        ...n,
        text: toSafeStr(n.text),
        title: n.title != null ? toSafeStr(n.title) : n.title,
        caseName: n.caseName != null ? toSafeStr(n.caseName) : n.caseName,
      }));

    // hearing_date/hearing_time → hearings[] (міграція v2 → v3)
    if (updated.hearing_date && !Array.isArray(updated.hearings)) {
      updated.hearings = [{
        id: `hrg_migrated_${updated.id}`,
        date: updated.hearing_date,
        time: updated.hearing_time || '',
        court: updated.court || '',
        notes: '',
        status: 'scheduled',
      }];
      delete updated.hearing_date;
      delete updated.hearing_time;
    }
    if (!Array.isArray(updated.hearings)) {
      updated.hearings = [];
    }
    // Очистити старі поля якщо hearings[] вже є
    if (updated.hearing_date !== undefined) delete updated.hearing_date;
    if (updated.hearing_time !== undefined) delete updated.hearing_time;
    updated.hearings = updated.hearings
      .filter(h => h && typeof h === 'object')
      .map(h => ({
        ...h,
        court: toSafeStr(h.court),
        notes: toSafeStr(h.notes),
        type:  h.type != null ? toSafeStr(h.type) : h.type,
      }));

    // deadline/deadline_type → deadlines[] (міграція v3 → v4)
    if (updated.deadline && !Array.isArray(updated.deadlines)) {
      updated.deadlines = [{
        id: `dl_migrated_${updated.id}`,
        name: toSafeStr(updated.deadline_type) || "Дедлайн",
        date: updated.deadline,
      }];
      delete updated.deadline;
      delete updated.deadline_type;
    }
    if (!Array.isArray(updated.deadlines)) {
      updated.deadlines = [];
    }
    // Очистити старі поля якщо deadlines[] вже є
    if (updated.deadline !== undefined) delete updated.deadline;
    if (updated.deadline_type !== undefined) delete updated.deadline_type;
    updated.deadlines = updated.deadlines
      .filter(d => d && typeof d === 'object')
      .map(d => ({
        ...d,
        name: toSafeStr(d.name),
      }));

    // case.timeLog[] — DEPRECATED у v4. Зворотна сумісність: лишаємо порожній []
    // для legacy документів. Видалення поля — окремий TASK через CLAUDE.md Audit.
    if (!Array.isArray(updated.timeLog)) {
      updated.timeLog = [];
    }

    // pinnedNoteIds[] — додати якщо немає
    if (!Array.isArray(updated.pinnedNoteIds)) {
      updated.pinnedNoteIds = [];
    }

    if (!Array.isArray(updated.agentHistory)) {
      updated.agentHistory = [];
    }

    // ── SaaS Foundation v2 — гарантовані поля ────────────────────────────
    // Додаємо тут щоб legacy дані з localStorage (без проходження через
    // migrateRegistry) теж отримали SaaS-поля.
    updated = ensureCaseSaasFields(updated);

    return updated;
    } catch (e) {
      console.warn('normalizeCases: пропускаю битий запис', c, e);
      return null;
    }
  }).filter(Boolean);
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
function App() {
  const [tab, setTab] = useState('dashboard');
  const [cases, setCases] = useState(() => {
    try {
      const saved = localStorage.getItem('levytskyi_cases');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const out = normalizeCases(parsed);
          if (out.length > 0) return out;
        }
      }
    } catch(e) {
      console.warn('cases init: фолбек на INITIAL_CASES', e);
    }
    try { return normalizeCases(INITIAL_CASES); }
    catch(e) { console.error('normalizeCases(INITIAL) fail', e); return []; }
  });
  const sanitizeNote = (n) => n && typeof n === 'object' ? ({
    ...n,
    text: toSafeStr(n.text),
    title: n.title != null ? toSafeStr(n.title) : n.title,
    caseName: n.caseName != null ? toSafeStr(n.caseName) : n.caseName,
  }) : null;
  const sanitizeCalendarEvent = (e) => e && typeof e === 'object' ? ({
    ...e,
    title: toSafeStr(e.title),
    label: e.label != null ? toSafeStr(e.label) : e.label,
    text:  e.text  != null ? toSafeStr(e.text)  : e.text,
    court: e.court != null ? toSafeStr(e.court) : e.court,
    caseName: e.caseName != null ? toSafeStr(e.caseName) : e.caseName,
  }) : null;
  const [calendarEvents, setCalendarEvents] = useState(() => {
    try {
      const saved = localStorage.getItem('levytskyi_calendar_events');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const out = [];
          for (const e of parsed) {
            try { const s = sanitizeCalendarEvent(e); if (s) out.push(s); } catch {}
          }
          return out;
        }
      }
    } catch(e) {
      console.warn('calendarEvents init фолбек на []', e);
    }
    return [];
  });
  const EMPTY_NOTES = { cases: [], general: [], content: [], system: [], records: [] };
  const [notes, setNotes] = useState(() => {
    const safeMap = (arr) => {
      const out = [];
      for (const n of (arr || [])) {
        try { const s = sanitizeNote(n); if (s) out.push(s); } catch {}
      }
      return out;
    };
    const sanitizeBucket = (obj) => {
      const out = { ...EMPTY_NOTES };
      for (const k of Object.keys(out)) {
        out[k] = safeMap(Array.isArray(obj?.[k]) ? obj[k] : []);
      }
      return out;
    };
    try {
      const saved = localStorage.getItem('levytskyi_notes');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const migrated = { ...EMPTY_NOTES };
          for (const n of parsed) {
            try {
              const cat = n?.category === 'case' ? 'cases' : (n?.category || 'general');
              const safe = sanitizeNote(n);
              if (!safe) continue;
              if (migrated[cat]) migrated[cat].push(safe);
              else migrated.general.push(safe);
            } catch {}
          }
          try { const sys = JSON.parse(localStorage.getItem('levytskyi_system_notes') || '[]'); migrated.system.push(...safeMap(sys)); } catch {}
          try { const cnt = JSON.parse(localStorage.getItem('levytskyi_content_ideas') || '[]'); migrated.content.push(...safeMap(cnt)); } catch {}
          return migrated;
        }
        if (parsed && typeof parsed === 'object') {
          return sanitizeBucket(parsed);
        }
      }
    } catch(e) {
      console.warn('notes init фолбек на EMPTY_NOTES', e);
    }
    return { ...EMPTY_NOTES };
  });
  // ── timeLog (legacy) — DEPRECATED у v4 на користь time_entries[].
  // Лишаємо порожній stub щоб старий imports/референси не валились.
  // case.timeLog[] (вкладений) — теж DEPRECATED, normalize-функція додає [] для сумісності.
  const timeLog = [];
  const setTimeLog = () => {};

  // ── SaaS Foundation v2 — tenants/users/auditLog/structuralUnits ───────────
  // Ембріон з повним ДНК. Зараз — один tenant, один користувач.
  // Усе персистится в registry_data.json як єдиний об'єкт schemaVersion 2.
  const [tenants, setTenants] = useState(() => {
    try {
      const saved = localStorage.getItem('levytskyi_tenants');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [DEFAULT_TENANT];
  });
  const [users, setUsers] = useState(() => {
    try {
      const saved = localStorage.getItem('levytskyi_users');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [DEFAULT_USER];
  });
  const [auditLog, setAuditLog] = useState(() => {
    try {
      const saved = localStorage.getItem('levytskyi_audit_log');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });
  const [structuralUnits, setStructuralUnits] = useState(() => {
    try {
      const saved = localStorage.getItem('levytskyi_structural_units');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });
  const [aiUsage, setAiUsage] = useState(() => {
    try {
      const saved = localStorage.getItem('levytskyi_ai_usage');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });
  const [caseAccess, setCaseAccess] = useState(() => {
    try {
      const saved = localStorage.getItem('levytskyi_case_access');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  // ── v4 Billing Foundation ───────────────────────────────────────────────────
  // time_entries[] — поточний місяць, in-state. Місячна ротація виносить
  // попередній місяць в _archives/time_entries_YYYY-MM.json на Drive.
  const [timeEntries, setTimeEntries] = useState(() => {
    try {
      const saved = localStorage.getItem('levytskyi_time_entries');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });
  const [masterTimerState, setMasterTimerState] = useState(() => {
    try {
      const saved = localStorage.getItem('levytskyi_master_timer_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {}
    return {
      isActive: false, isPaused: false, state: 'stopped',
      startedAt: null, pausedAt: null, totalSecondsToday: 0,
      lastActivityAt: null, activeCaseId: null, activeCategory: null,
      lastIdleCheck: null,
    };
  });
  const [billingMeta, setBillingMeta] = useState(() => {
    try {
      const saved = localStorage.getItem('levytskyi_billing_meta');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {}
    return {
      currentMonthStart: new Date(Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        1, 0, 0, 0
      )).toISOString(),
      lastArchiveCreated: null,
      totalEntriesAllTime: 0,
      currentMonthEntries: 0,
      archiveFiles: [],
    };
  });

  // [BILLING] app_launched — один раз при старті.
  useEffect(() => {
    try { activityTracker.report('app_launched', { module: MODULES.APP, category: 'system' }); } catch {}
  }, []);

  // ── activityTracker / masterTimer init ─────────────────────────────────────
  // Біндимо sink, recover state, реєструємо хук subtimerEnd → smartReturnHandler.
  useEffect(() => {
    activityTracker.configure({
      sink: (entry) => {
        try {
          setTimeEntries(prev => {
            const next = Array.isArray(prev) ? [...prev, entry] : [entry];
            return next.length > 100000 ? next.slice(next.length - 100000) : next;
          });
          setBillingMeta(prev => ({
            ...prev,
            totalEntriesAllTime: (prev?.totalEntriesAllTime || 0) + 1,
            currentMonthEntries: (prev?.currentMonthEntries || 0) + 1,
          }));
        } catch (e) { console.warn('activityTracker sink error:', e); }
      },
      patchSink: (id, fields) => {
        try {
          setTimeEntries(prev => Array.isArray(prev)
            ? prev.map(e => e?.id === id ? { ...e, ...fields, updatedAt: new Date().toISOString() } : e)
            : prev
          );
        } catch (e) { console.warn('activityTracker patchSink error:', e); }
      },
    });
    masterTimer.configure({
      stateSink: (s) => setMasterTimerState(s),
    });
    masterTimer.bindToActivityTracker();
    masterTimer.recover(masterTimerState);
    // autoStart за user.preferences (по замовчуванню — false).
    try {
      const u = getCurrentUser();
      if (u?.preferences?.autoStartMasterTimer?.enabled) {
        masterTimer.start({ autoStart: true });
      }
    } catch {}
    return () => masterTimer._detach();
    // eslint-disable-next-line
  }, []);

  // Хелпер: запис в audit log зі state-сеттером, прив'язка до tenant'у/користувача.
  // Не пишемо в auditLog якщо action не входить в AUDIT_ACTIONS — фільтр виконується
  // на стороні викликача, але писати все одно безпечно.
  const writeAudit = (params) => writeAuditLogService(setAuditLog, params);
  const updateAudit = (entryId, status, extra) => updateAuditLogStatus(setAuditLog, entryId, status, extra);

  const [lastSaved, setLastSaved] = useState(null);
  const [driveConnected, setDriveConnected] = useState(() => driveService.isConnected());
  const [driveSyncStatus, setDriveSyncStatus] = useState('idle');
  const [selected, setSelected] = useState(null);
  const openCase = (c) => { usageLog.log('open_case', {name: c.name}); setSelected(c); };
  const [dossierCase, setDossierCase] = useState(null);
  const [ideas, setIdeas] = useState([]);
  const [showUniversalPanel, setShowUniversalPanel] = useState(false);

  // Sync dossierCase when cases changes (fixes pin button reactivity)
  useEffect(() => {
    if (dossierCase) {
      const updated = cases.find(c => c.id === dossierCase.id);
      if (updated && JSON.stringify(updated) !== JSON.stringify(dossierCase)) {
        setDossierCase(updated);
      }
    }
  }, [cases]);

  // [HEARING AUDIT] dev-only: засідання з датою але без часу
  useEffect(() => {
    if (!import.meta.env || !import.meta.env.DEV) return;
    cases.forEach(c => {
      (c.hearings || []).forEach(h => {
        if (h.date && (!h.time || String(h.time).trim() === '')) {
          console.warn(`[HEARING AUDIT] Справа "${c.name}" (${c.id}): засідання ${h.id} має дату ${h.date} але НЕ МАЄ ЧАСУ`);
        }
      });
    });
  }, [cases]);
  const [universalTab, setUniversalTab] = useState('qi');
  const [qiBtnPos, setQiBtnPos] = useState({ x: null, y: null });
  const qiDragRef = useRef(false);
  const qiDragMoved = useRef(false);
  const qiStartRef = useRef({ x: 0, y: 0, btnX: 0, btnY: 0 });
  const [showAdd, setShowAdd] = useState(false);
  const [editingCase, setEditingCase] = useState(null);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [filterStatus, setFilterStatus] = useState('active');

  // ── Universal Panel ────────────────────────────────────────────────────────
  const [panelWidth, setPanelWidth] = useState(380);
  const isDragging = useRef(false);
  const containerRef = useRef(null);

  // ── QI FAB drag ──────────────────────────────────────────────────────────
  useEffect(() => {
    function onMove(e) {
      if (!qiDragRef.current) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = clientX - qiStartRef.current.x;
      const dy = clientY - qiStartRef.current.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) qiDragMoved.current = true;
      const newX = Math.max(0, Math.min(window.innerWidth - 52, qiStartRef.current.btnX + dx));
      const newY = Math.max(0, Math.min(window.innerHeight - 52, qiStartRef.current.btnY + dy));
      setQiBtnPos({ x: newX, y: newY });
    }
    function onUp() {
      setTimeout(() => { qiDragRef.current = false; }, 50);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, []); // eslint-disable-line

  // Load from Drive on mount if connected — з міграцією v1 → v2
  useEffect(() => {
    if (!driveConnected) return;
    const token = driveService.getToken();
    if (!token) return;

    (async () => {
      try {
        const raw = await driveService.readRegistry(token);
        const { registry, didMigrate, fromVersion, toVersion } = migrateRegistry(raw);

        // Якщо реально мігруємо — спочатку фіксований бекап pre_saas, поза ротацією.
        if (didMigrate && raw != null) {
          const flag = localStorage.getItem('levytskyi_pre_saas_backup_done');
          if (!flag) {
            const res = await backupRegistryDataPreSaas(token, raw);
            if (res.success) {
              localStorage.setItem('levytskyi_pre_saas_backup_done', '1');
              console.log(`[SaaS Foundation] Pre-migration backup: ${res.fileName}`);
            } else {
              console.warn('[SaaS Foundation] Pre-migration backup failed, продовжую без нього:', res.error);
            }
          }
        }

        // SaaS Foundation v1.1 — pre-v3 бекап, поза ротацією.
        if (raw != null && (raw.schemaVersion || 1) < 3) {
          const flagV3 = localStorage.getItem('levytskyi_pre_v3_backup_done');
          if (!flagV3) {
            const res = await backupRegistryDataPreV3(token, raw);
            if (res.success) {
              localStorage.setItem('levytskyi_pre_v3_backup_done', '1');
              console.log(`[SaaS Foundation v1.1] Pre-v3 backup: ${res.fileName}`);
            } else {
              console.warn('[SaaS Foundation v1.1] Pre-v3 backup failed, продовжую без нього:', res.error);
            }
          }
        }

        // Billing Foundation v2 — pre-v4 бекап, поза ротацією.
        if (raw != null && (raw.schemaVersion || 1) < 4) {
          const flagV4 = localStorage.getItem('levytskyi_billing_backup_done_v4');
          if (!flagV4) {
            const res = await backupRegistryDataPreBilling(token, raw);
            if (res.success) {
              localStorage.setItem('levytskyi_billing_backup_done_v4', '1');
              console.log(`[Billing Foundation v2] Pre-billing backup: ${res.fileName}`);
            } else {
              console.warn('[Billing Foundation v2] Pre-billing backup failed, продовжую без нього:', res.error);
            }
          }
        }

        // SaaS Foundation v1.1 — одноразовий бекап і чистка levytskyi_action_log.
        if (!localStorage.getItem('levytskyi_action_log_cleaned_v1_1')) {
          try {
            const oldLog = localStorage.getItem('levytskyi_action_log');
            if (oldLog && oldLog !== '[]' && oldLog !== 'null') {
              const parsed = JSON.parse(oldLog);
              if (Array.isArray(parsed) && parsed.length > 0) {
                const res = await backupActionLogPreCleanup(token, parsed);
                if (res.success) {
                  localStorage.removeItem('levytskyi_action_log');
                  localStorage.setItem('levytskyi_action_log_cleaned_v1_1', '1');
                  console.log(`[SaaS Foundation v1.1] Action log backed up and removed: ${res.fileName}`);
                } else {
                  console.warn('[SaaS Foundation v1.1] Action log backup failed, ключ збережено:', res.error);
                }
              } else {
                localStorage.removeItem('levytskyi_action_log');
                localStorage.setItem('levytskyi_action_log_cleaned_v1_1', '1');
              }
            } else {
              localStorage.removeItem('levytskyi_action_log');
              localStorage.setItem('levytskyi_action_log_cleaned_v1_1', '1');
            }
          } catch (e) {
            console.warn('[SaaS Foundation v1.1] Action log cleanup error:', e);
          }
        }

        // Розпакувати у локальні стани
        if (Array.isArray(registry.cases) && registry.cases.length > 0) {
          setCases(normalizeCases(registry.cases));
        }
        if (Array.isArray(registry.tenants) && registry.tenants.length > 0) {
          setTenants(registry.tenants);
        }
        if (Array.isArray(registry.users) && registry.users.length > 0) {
          setUsers(registry.users);
        }
        if (Array.isArray(registry.auditLog)) {
          setAuditLog(registry.auditLog);
        }
        if (Array.isArray(registry.structuralUnits)) {
          setStructuralUnits(registry.structuralUnits);
        }
        if (Array.isArray(registry.ai_usage)) {
          setAiUsage(registry.ai_usage);
        }
        if (Array.isArray(registry.caseAccess)) {
          setCaseAccess(registry.caseAccess);
        }
        // v4 Billing Foundation
        if (Array.isArray(registry.time_entries)) {
          setTimeEntries(registry.time_entries);
        }
        if (registry.master_timer_state && typeof registry.master_timer_state === 'object') {
          setMasterTimerState(registry.master_timer_state);
          masterTimer.recover(registry.master_timer_state);
        }
        if (registry.billing_meta && typeof registry.billing_meta === 'object') {
          setBillingMeta(registry.billing_meta);
        }

        // Billing Foundation v2 — імпорт legacy levytskyi_timelog (одноразово).
        if (!localStorage.getItem('levytskyi_timelog_imported_v4')) {
          try {
            const oldLog = localStorage.getItem('levytskyi_timelog');
            if (oldLog && oldLog !== '[]' && oldLog !== 'null') {
              const parsed = JSON.parse(oldLog);
              if (Array.isArray(parsed) && parsed.length > 0) {
                const backupRes = await backupLegacyTimelogPreImport(token, parsed);
                if (backupRes.success) {
                  console.log(`[Billing Foundation v2] Legacy timelog backed up: ${backupRes.fileName}`);
                }
                const imported = importLegacyTimeLog(parsed);
                if (imported.length > 0) {
                  setTimeEntries(prev => {
                    const ids = new Set((prev || []).map(e => e.id));
                    const fresh = imported.filter(e => !ids.has(e.id));
                    return [...(prev || []), ...fresh];
                  });
                  console.log(`[Billing Foundation v2] Imported ${imported.length} legacy entries`);
                }
                localStorage.removeItem('levytskyi_timelog');
                localStorage.setItem('levytskyi_timelog_imported_v4', '1');
              } else {
                localStorage.removeItem('levytskyi_timelog');
                localStorage.setItem('levytskyi_timelog_imported_v4', '1');
              }
            } else {
              localStorage.setItem('levytskyi_timelog_imported_v4', '1');
            }
          } catch (e) {
            console.warn('[Billing Foundation v2] Legacy timelog import error:', e);
          }
        }

        // Billing Foundation v2 — місячна ротація на старті (якщо період настав).
        try {
          const archiveResult = await checkAndArchiveTimeEntries(
            token,
            Array.isArray(registry.time_entries) ? registry.time_entries : timeEntries,
            registry.billing_meta || billingMeta
          );
          if (archiveResult?.archived && archiveResult.keep && archiveResult.archivedCount > 0) {
            setTimeEntries(archiveResult.keep);
            setBillingMeta(prev => ({ ...prev, ...(archiveResult.billingMetaUpdate || {}) }));
            writeAudit({
              action: 'time_entries_archived',
              targetType: 'time_entries',
              targetId: archiveResult.yyyymm,
              status: 'done',
              details: {
                yyyymm: archiveResult.yyyymm,
                entriesCount: archiveResult.archivedCount,
                archivePath: archiveResult.archivePath,
              },
              context: { module: MODULES.STARTUP, agent: null },
            });
            console.log(`[Billing Foundation v2] Archived ${archiveResult.archivedCount} entries to ${archiveResult.archivePath}`);
          }
        } catch (e) {
          console.warn('[Billing Foundation v2] Archive check error:', e);
        }

        if (didMigrate) {
          console.log(`[SaaS Foundation] Migration v${fromVersion} → v${toVersion} done. cases=${registry.cases.length}`);
          // Запис в auditLog: первинна міграція. Поза AUDIT_ACTIONS — пишемо напряму.
          writeAudit({
            action: 'migrate_registry',
            targetType: 'registry',
            targetId: 'registry_data.json',
            details: { fromVersion, toVersion, casesCount: registry.cases.length },
            context: { module: MODULES.STARTUP, agent: null },
          });
        }
      } catch (e) {
        console.error('[SaaS Foundation] Drive load/migration error:', e);
      }
    })();
  }, []); // eslint-disable-line

  // Auto-save to localStorage (always) and Drive (if connected)
  // Тригер: будь-яка зміна cases/tenants/users/auditLog/structuralUnits/ai_usage/caseAccess.
  useEffect(() => {
    try {
      localStorage.setItem('levytskyi_cases', JSON.stringify(cases));
      localStorage.setItem('levytskyi_tenants', JSON.stringify(tenants));
      localStorage.setItem('levytskyi_users', JSON.stringify(users));
      localStorage.setItem('levytskyi_audit_log', JSON.stringify(auditLog));
      localStorage.setItem('levytskyi_structural_units', JSON.stringify(structuralUnits));
      localStorage.setItem('levytskyi_ai_usage', JSON.stringify(aiUsage));
      localStorage.setItem('levytskyi_case_access', JSON.stringify(caseAccess));
      // v4 Billing Foundation
      localStorage.setItem('levytskyi_time_entries', JSON.stringify(timeEntries));
      localStorage.setItem('levytskyi_master_timer_state', JSON.stringify(masterTimerState));
      localStorage.setItem('levytskyi_billing_meta', JSON.stringify(billingMeta));
      setLastSaved(new Date().toLocaleTimeString('uk-UA', {hour:'2-digit', minute:'2-digit'}));
    } catch(e) {}
    if (driveConnected) {
      const token = driveService.getToken();
      if (token) {
        setDriveSyncStatus('syncing');
        const registry = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          settingsVersion: MIGRATION_VERSION,
          tenants,
          users,
          auditLog,
          structuralUnits,
          ai_usage: aiUsage,
          caseAccess,
          cases,
          // v4 Billing Foundation
          time_entries: timeEntries,
          master_timer_state: masterTimerState,
          billing_meta: billingMeta,
        };
        // Бекап раз на добу перед sync (зберігаємо повний registry-об'єкт)
        const lastBackup = localStorage.getItem('levytskyi_last_backup') || '';
        const todayStr = new Date().toISOString().split('T')[0];
        if (lastBackup !== todayStr) {
          backupRegistryData(token, registry).then(res => {
            if (res.success) localStorage.setItem('levytskyi_last_backup', todayStr);
          }).catch(() => {});
        }
        driveService.writeRegistry(token, registry)
          .then(() => setDriveSyncStatus('synced'))
          .catch(() => setDriveSyncStatus('error'));
      }
    }
  }, [cases, tenants, users, auditLog, structuralUnits, aiUsage, caseAccess, timeEntries, masterTimerState, billingMeta]);

  // ── timeLog persistence — DEPRECATED у v4. Старий ключ видаляється під час
  // одноразового імпорту в time_entries[] (див. flag levytskyi_timelog_imported_v4).

  // ── rebuildCalendarView — збирає лише нотатки з датою для календаря ─────────
  // Засідання і дедлайни Dashboard читає напряму з cases.hearings[] / cases.deadlines[].
  // Дублювати їх у calendarEvents не можна — отримаємо подвійні слоти.
  const rebuildCalendarView = () => {
    const events = [];
    const seen = new Set();
    const pushNote = (n, caseId, caseName) => {
      if (!n || !n.id || seen.has(n.id)) return;
      seen.add(n.id);
      if (!n.date) return;
      const isTravel = n.category === 'travel';
      events.push({
        id: `note_${n.id}`,
        type: isTravel ? 'travel' : 'note',
        category: n.category || 'general',
        noteId: n.id, caseId: caseId || null,
        caseName: caseName || null,
        date: n.date, time: n.time || null,
        duration: n.duration || 60,
        title: (n.text || '').slice(0, 60),
        text: n.text || '',
        color: 'yellow'
      });
    };
    for (const cat of Object.keys(notes)) {
      (notes[cat] || []).forEach(n => {
        const c = n.caseId ? cases.find(cs => String(cs.id) === String(n.caseId)) : null;
        pushNote(n, n.caseId || null, c ? c.name : (n.caseName || null));
      });
    }
    cases.forEach(c => {
      (Array.isArray(c.notes) ? c.notes : []).forEach(n => {
        if (n && typeof n === 'object') pushNote(n, c.id, c.name);
      });
    });
    events.sort((a, b) => new Date(a.date) - new Date(b.date));
    setCalendarEvents(events);
  };

  // Перебудова автоматично при кожній зміні notes або cases.
  useEffect(() => { rebuildCalendarView(); }, [notes, cases]);

  // ── Universal Panel resize ──────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (clientX) => {
      if (!isDragging.current) return;
      const newWidth = window.innerWidth - clientX;
      setPanelWidth(Math.max(280, Math.min(480, newWidth)));
    };
    const onMouseMove = (e) => onMove(e.clientX);
    const onMouseUp   = () => { isDragging.current = false; };
    const onTouchMove = (e) => { if (!isDragging.current) return; e.preventDefault(); onMove(e.touches[0].clientX); };
    const onTouchEnd  = () => { isDragging.current = false; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend',  onTouchEnd);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend',  onTouchEnd);
    };
  }, []);

  const hotCases = useMemo(() => cases
    .filter(c => c.status==='active' && (getDeadlineDate(c) || getHearingDate(c)))
    .map(c => ({
      ...c,
      minDays: Math.min(
        getDeadlineDate(c) ? (daysUntil(getDeadlineDate(c)) ?? 999) : 999,
        getHearingDate(c) ? (daysUntil(getHearingDate(c)) ?? 999) : 999
      )
    }))
    .filter(c => c.minDays <= 14)
    .sort((a,b) => a.minDays - b.minDays)
    .slice(0, 8),
  [cases]);

  const filteredCases = useMemo(() => cases.filter(c => {
    const s = search.toLowerCase();
    const matchSearch = !s || c.name.toLowerCase().includes(s) || c.client.toLowerCase().includes(s) || c.court.toLowerCase().includes(s);
    const matchCat = filterCat==='all' || c.category===filterCat;
    const matchStatus = filterStatus==='all' || c.status===filterStatus;
    return matchSearch && matchCat && matchStatus;
  }), [cases, search, filterCat, filterStatus]);

  const stats = useMemo(() => ({
    total: cases.filter(c=>c.status==='active').length,
    hot: cases.filter(c=>{ const dd = getDeadlineDate(c); return dd && daysUntil(dd)!==null && daysUntil(dd)<=3; }).length,
    thisWeek: cases.filter(c=>{ const hd = getHearingDate(c); return hd && daysUntil(hd)!==null && daysUntil(hd)>=0 && daysUntil(hd)<=7; }).length,
    noDeadline: cases.filter(c=>c.status==='active'&&!getDeadlineDate(c)&&!getHearingDate(c)).length,
  }), [cases]);

  const addCase = (form) => {
    usageLog.log('case_added', {name: form.name});
    // Гарантуємо SaaS-поля для нової справи (tenantId, ownerId, team, shareType, externalAccess).
    const newCase = ensureCaseSaasFields({ ...form, id: `case_${Date.now()}` });
    setCases(prev => [...prev, newCase]);
    setShowAdd(false);
    setTab('cases');
    // Audit (variant B — UI обходить executeAction, пишемо напряму).
    writeAudit({
      action: 'create_case',
      targetType: 'case',
      targetId: newCase.id,
      details: { caseName: newCase.name, source: 'ui_form' },
      context: { module: MODULES.ADD_FORM, agent: null },
    });
    try { activityTracker.report('case_created', { caseId: newCase.id, module: MODULES.ADD_FORM, category: 'case_work' }); } catch {}
  };

  const saveCaseEdit = (form) => {
    setCases(prev => prev.map(c => c.id === form.id ? ensureCaseSaasFields({ ...form }) : c));
    setEditingCase(null);
    setSelected({ ...form });
    setTab('cases');
  };

  // Field-level updater — єдина точка входу для зміни окремого поля справи.
  const updateCase = (caseId, field, value) => {
    setCases(prev => prev.map(c =>
      c.id === caseId ? { ...c, [field]: value } : c
    ));
    // Drive sync виконається автоматично через useEffect на [cases].
  };

  // ── calendarEvents CRUD ────────────────────────────────────────────────────
  const addCalendarEvent = (event) => {
    setCalendarEvents(prev => {
      const updated = [...prev, { ...event, id: event.id != null ? event.id : Date.now().toString() }];
      try { localStorage.setItem('levytskyi_calendar_events', JSON.stringify(updated)); } catch(e) {}
      return updated;
    });
  };

  const updateCalendarEvent = (eventId, updates) => {
    setCalendarEvents(prev => {
      const updated = prev.map(e => e.id === eventId ? { ...e, ...updates } : e);
      try { localStorage.setItem('levytskyi_calendar_events', JSON.stringify(updated)); } catch(e) {}
      return updated;
    });
  };

  const deleteCalendarEvent = (eventId) => {
    setCalendarEvents(prev => {
      const updated = prev.filter(e => e.id !== eventId);
      try { localStorage.setItem('levytskyi_calendar_events', JSON.stringify(updated)); } catch(e) {}
      return updated;
    });
  };

  // ── notes CRUD (категоризовані) ─────────────────────────────────────────
  const saveNotesToLS = (notesObj) => {
    try { localStorage.setItem('levytskyi_notes', JSON.stringify(notesObj)); } catch(e) {}
  };

  const addNote = (note) => {
    const u = getCurrentUser();
    const newNote = {
      id: Date.now().toString(),
      text: note.text || '',
      category: note.category || 'general',
      caseId: note.caseId || null,
      caseName: note.caseName || null,
      source: note.source || 'manual',
      result: note.result || null,
      createdBy: u.userId,
      // tenantId — лише для standalone (без caseId); для in-case успадкується
      ...(note.caseId ? {} : { tenantId: u.tenantId }),
      ts: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    if (newNote.caseId) {
      setCases(prev => prev.map(c =>
        String(c.id) === String(newNote.caseId)
          ? { ...c, notes: [...(Array.isArray(c.notes) ? c.notes : []), newNote], updatedAt: new Date().toISOString() }
          : c
      ));
    } else {
      const cat = newNote.category === 'case' ? 'general' : (newNote.category || 'general');
      setNotes(prev => {
        const updated = { ...prev, [cat]: [...(prev[cat] || []), newNote] };
        saveNotesToLS(updated);
        return updated;
      });
    }
    return newNote;
  };

  const deleteNote = (noteId) => {
    setCases(prev => prev.map(c => {
      const arr = Array.isArray(c.notes) ? c.notes : [];
      const filtered = arr.filter(n => !n || n.id !== noteId);
      const pinned = (c.pinnedNoteIds || []).filter(id => id !== String(noteId));
      if (filtered.length === arr.length && pinned.length === (c.pinnedNoteIds || []).length) return c;
      return { ...c, notes: filtered, pinnedNoteIds: pinned };
    }));
    setNotes(prev => {
      const updated = {};
      for (const cat of Object.keys(prev)) {
        updated[cat] = prev[cat].filter(n => n.id !== noteId);
      }
      saveNotesToLS(updated);
      return updated;
    });
  };

  const updateNote = (noteId, changes) => {
    let found = false;
    setCases(prev => prev.map(c => {
      const arr = Array.isArray(c.notes) ? c.notes : [];
      const idx = arr.findIndex(n => n && n.id === noteId);
      if (idx === -1) return c;
      found = true;
      const updated = [...arr];
      updated[idx] = { ...updated[idx], ...changes, updatedAt: new Date().toISOString() };
      return { ...c, notes: updated, updatedAt: new Date().toISOString() };
    }));
    if (!found) {
      setNotes(prev => {
        const updated = {};
        for (const cat of Object.keys(prev)) {
          updated[cat] = prev[cat].map(n => n.id === noteId ? { ...n, ...changes } : n);
        }
        saveNotesToLS(updated);
        return updated;
      });
    }
  };

  // pinNote(noteId, caseId) — прикріпити/відкріпити нотатку до справи
  const pinNote = (noteId, caseId) => {
    if (!caseId) return;
    setCases(prev => prev.map(c => {
      if (c.id !== caseId) return c;
      const ids = c.pinnedNoteIds || [];
      const strId = String(noteId);
      const already = ids.includes(strId);
      return { ...c, pinnedNoteIds: already ? ids.filter(id => id !== strId) : [...ids, strId] };
    }));
  };

  // Хелпер: плоский масив всіх нотаток (для компонентів що очікують масив)
  const allNotesFlat = useMemo(() => {
    const all = [];
    for (const cat of Object.keys(notes)) {
      (notes[cat] || []).forEach(n => all.push(n));
    }
    return all.sort((a, b) => new Date(b.ts || b.createdAt || 0) - new Date(a.ts || a.createdAt || 0));
  }, [notes]);

  const handleEdit = (c) => {
    setSelected(null);
    setEditingCase(c);
    setTab('add');
  };

  const closeCase = (id) => {
    const target = cases.find(c => c.id === id);
    setCases(prev => prev.map(c =>
      c.id === id ? { ...c, status: 'closed' } : c
    ));
    setSelected(null);
    if (target) {
      writeAudit({
        action: 'close_case',
        targetType: 'case',
        targetId: id,
        details: { caseName: target.name, previousStatus: target.status },
        context: { module: MODULES.UI, agent: null },
      });
      try { activityTracker.report('case_closed', { caseId: id, module: MODULES.UI, category: 'case_work' }); } catch {}
    }
  };

  const restoreCase = (id) => {
    const target = cases.find(c => c.id === id);
    setCases(prev => prev.map(c =>
      c.id === id ? { ...c, status: 'active' } : c
    ));
    setSelected(null);
    if (target) {
      writeAudit({
        action: 'restore_case',
        targetType: 'case',
        targetId: id,
        details: { caseName: target.name, previousStatus: target.status },
        context: { module: MODULES.UI, agent: null },
      });
      try { activityTracker.report('case_restored', { caseId: id, module: MODULES.UI, category: 'case_work' }); } catch {}
    }
  };

  const deleteDriveFolder = async (folderId) => {
    const token = localStorage.getItem("levytskyi_drive_token");
    if (!token || !folderId) return;
    const response = await driveRequest(
      `https://www.googleapis.com/drive/v3/files/${folderId}`,
      { method: "DELETE" }
    );
    if (!response.ok && response.status !== 204) {
      throw new Error(`Drive API error: ${response.status}`);
    }
  };

  const deleteCasePermanently = async (caseItem) => {
    // Audit ДО видалення (status: pending). Після успіху → done.
    // Якщо мережа впала і запис лишився pending — буде видно в auditLog.
    const auditEntry = writeAudit({
      action: 'destroy_case',
      targetType: 'case',
      targetId: caseItem.id,
      status: 'pending',
      details: {
        caseName: caseItem.name,
        driveFolderId: caseItem.driveFolderId || null,
        reason: 'user_initiated',
      },
      context: { module: MODULES.UI, agent: null },
    });
    try {
      if (caseItem.driveFolderId && driveConnected) {
        await deleteDriveFolder(caseItem.driveFolderId);
      } else if (!caseItem.driveFolderId) {
        console.log("driveFolderId not found, skipping Drive deletion");
      }
      setCases(prev => prev.filter(c => c.id !== caseItem.id));
      if (dossierCase?.id === caseItem.id) {
        setDossierCase(null);
      }
      setSelected(null);
      if (auditEntry) updateAudit(auditEntry.id, 'done');
      systemAlert(`Справу "${caseItem.name}" видалено.`);
    } catch (err) {
      console.error("Помилка видалення:", err);
      if (auditEntry) updateAudit(auditEntry.id, 'failed', { errorMessage: err.message });
      systemAlert("Помилка при видаленні. Спробуйте ще раз.");
    }
  };

  const handleDeleteCase = async (caseItem) => {
    const first = await systemConfirm(
      `Видалити справу "${caseItem.name}"?\n\nСправа буде видалена з реєстру.`,
      "Видалення справи"
    );
    if (!first) return;
    const second = await systemConfirm(
      `Буде видалено справу "${caseItem.name}" з реєстру та папку справи на Google Drive з усіма файлами.\n\nЦе неможливо скасувати. Продовжити?`,
      "УВАГА! Незворотна операція!", "Видалити", "Скасувати"
    );
    if (!second) return;
    deleteCasePermanently(caseItem);
  };

  // ── ACTIONS — єдиний реєстр дій системи ──────────────────────────────────
  const ACTIONS = {
    // ГРУПА 1 — Справи
    create_case: ({ fields }) => {
      const newCase = ensureCaseSaasFields({
        id: `case_${Date.now()}`,
        userId: 'vadym',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        hearings: [],
        deadlines: [],
        timeLog: [],
        pinnedNoteIds: [],
        agentHistory: [],
        ...fields
      });
      setCases(prev => [...prev, newCase]);
      return { success: true, caseId: newCase.id };
    },

    close_case: ({ caseId }) => {
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, status: 'closed', updatedAt: new Date().toISOString() }
          : c
      ));
      return { success: true };
    },

    restore_case: ({ caseId }) => {
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, status: 'active', updatedAt: new Date().toISOString() }
          : c
      ));
      return { success: true };
    },

    update_case_field: ({ caseId, field, value }) => {
      const allowedFields = [
        'name', 'client', 'court', 'case_no', 'category',
        'next_action', 'notes', 'judge', 'status'
      ];
      if (!allowedFields.includes(field)) {
        return { error: `Поле "${field}" не дозволено змінювати через агента` };
      }
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, [field]: value, updatedAt: new Date().toISOString() }
          : c
      ));
      return { success: true };
    },

    add_deadline: ({ caseId, name, date }) => {
      const deadline = { id: `dl_${Date.now()}`, name, date };
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, deadlines: [...(c.deadlines || []), deadline], updatedAt: new Date().toISOString() }
          : c
      ));
      return { success: true, deadlineId: deadline.id };
    },

    update_deadline: ({ caseId, deadlineId, name, date }) => {
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? {
              ...c,
              deadlines: (c.deadlines || []).map(d =>
                d.id === deadlineId ? { ...d, name, date } : d
              ),
              updatedAt: new Date().toISOString()
            }
          : c
      ));
      return { success: true };
    },

    delete_deadline: ({ caseId, deadlineId }) => {
      if (!caseId)     return { error: 'caseId не вказано' };
      if (!deadlineId) return { error: 'deadlineId не вказано' };
      const targetCase = cases.find(c => c.id === caseId);
      if (!targetCase) return { error: `Справу ${caseId} не знайдено` };
      const exists = (targetCase.deadlines || []).some(d => d.id === deadlineId);
      if (!exists) return { error: `Дедлайн ${deadlineId} не знайдено в справі "${targetCase.name}"` };
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, deadlines: (c.deadlines || []).filter(d => d.id !== deadlineId), updatedAt: new Date().toISOString() }
          : c
      ));
      return { success: true };
    },

    // ГРУПА 2 — Засідання
    add_hearing: ({ caseId, date, time, duration = 120, type = null }) => {
      if (!date) {
        console.error("[VALIDATION] add_hearing відхилено: дата обов'язкова");
        return { success: false, error: "Дата засідання обов'язкова" };
      }
      if (!time || !String(time).trim()) {
        console.error("[VALIDATION] add_hearing відхилено: час обов'язковий");
        return { success: false, error: "Час засідання обов'язковий" };
      }
      const hearing = { id: `hrg_${Date.now()}`, date, time, duration, status: 'scheduled', type };
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, hearings: [...(c.hearings || []), hearing], updatedAt: new Date().toISOString() }
          : c
      ));
      return { success: true, hearingId: hearing.id };
    },

    update_hearing: ({ caseId, hearingId, date, time, duration, type }) => {
      if (time !== undefined && (time === null || !String(time).trim())) {
        console.error("[VALIDATION] update_hearing відхилено: час не може бути порожнім");
        return { success: false, error: "Час засідання не може бути порожнім" };
      }
      setCases(prev => prev.map(c => {
        if (c.id !== caseId) return c;

        let targetId = hearingId;

        if (!targetId) {
          const today = new Date().toISOString().split('T')[0];
          const next = (c.hearings || [])
            .filter(h => h.status === 'scheduled' && h.date >= today)
            .sort((a, b) => a.date.localeCompare(b.date))[0];
          if (next) targetId = next.id;
        }

        if (!targetId) return c;

        return {
          ...c,
          hearings: (c.hearings || []).map(h =>
            h.id === targetId
              ? { ...h, date: date ?? h.date, time: time ?? h.time,
                  duration: duration ?? h.duration, type: type ?? h.type }
              : h
          ),
          updatedAt: new Date().toISOString()
        };
      }));
      return { success: true };
    },

    delete_hearing: ({ caseId, hearingId }) => {
      if (!caseId)    return { success: false, error: 'caseId не вказано' };
      if (!hearingId) return { success: false, error: 'hearingId не вказано' };
      const targetCase = cases.find(c => c.id === caseId);
      if (!targetCase) return { success: false, error: `Справу ${caseId} не знайдено` };
      const exists = (targetCase.hearings || []).some(h => h.id === hearingId);
      if (!exists) return { success: false, error: `Засідання ${hearingId} не знайдено в справі "${targetCase.name}"` };
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, hearings: (c.hearings || []).filter(h => h.id !== hearingId), updatedAt: new Date().toISOString() }
          : c
      ));
      return { success: true };
    },

    // ГРУПА 3 — Нотатки
    add_note: ({ text, category = 'general', date = null, time = null, duration = null, caseId = null }) => {
      const nowIso = new Date().toISOString();
      const u = getCurrentUser();
      const note = {
        id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId: u.userId,
        createdBy: u.userId,
        // tenantId — лише для standalone (без caseId); для in-case успадкується
        ...(caseId ? {} : { tenantId: u.tenantId }),
        text: text || '',
        date: date || null,
        time: time || null,
        duration: duration || null,
        caseId: caseId || null,
        category: category || 'general',
        ts: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso
      };
      if (caseId) {
        setCases(prev => prev.map(c =>
          String(c.id) === String(caseId)
            ? { ...c, notes: [...(Array.isArray(c.notes) ? c.notes : []), note], updatedAt: new Date().toISOString() }
            : c
        ));
      } else {
        setNotes(prev => {
          const updated = { ...prev, general: [note, ...(prev.general || [])] };
          saveNotesToLS(updated);
          return updated;
        });
      }
      return { success: true, noteId: note.id };
    },

    update_note: ({ noteId, text, date, time, duration, caseId }) => {
      let found = false;
      setCases(prev => prev.map(c => {
        const arr = Array.isArray(c.notes) ? c.notes : [];
        const idx = arr.findIndex(n => n && n.id === noteId);
        if (idx === -1) return c;
        found = true;
        const updated = [...arr];
        updated[idx] = {
          ...updated[idx],
          ...(text !== undefined ? { text } : {}),
          ...(date !== undefined ? { date } : {}),
          ...(time !== undefined ? { time } : {}),
          ...(duration !== undefined ? { duration } : {}),
          ...(caseId !== undefined ? { caseId } : {}),
          updatedAt: new Date().toISOString()
        };
        return { ...c, notes: updated, updatedAt: new Date().toISOString() };
      }));
      if (!found) {
        setNotes(prev => {
          const updated = {};
          for (const cat of Object.keys(prev)) {
            updated[cat] = (prev[cat] || []).map(n =>
              n.id === noteId
                ? { ...n,
                    ...(text !== undefined ? { text } : {}),
                    ...(date !== undefined ? { date } : {}),
                    ...(time !== undefined ? { time } : {}),
                    ...(duration !== undefined ? { duration } : {}),
                    ...(caseId !== undefined ? { caseId } : {}),
                    updatedAt: new Date().toISOString() }
                : n
            );
          }
          saveNotesToLS(updated);
          return updated;
        });
      }
      return { success: true };
    },

    delete_note: ({ noteId }) => {
      setCases(prev => prev.map(c => {
        const arr = Array.isArray(c.notes) ? c.notes : [];
        const filtered = arr.filter(n => !n || n.id !== noteId);
        const pinned = (c.pinnedNoteIds || []).filter(id => id !== String(noteId));
        if (filtered.length === arr.length && pinned.length === (c.pinnedNoteIds || []).length) return c;
        return { ...c, notes: filtered, pinnedNoteIds: pinned };
      }));
      setNotes(prev => {
        const updated = {};
        for (const cat of Object.keys(prev)) {
          updated[cat] = prev[cat].filter(n => n.id !== noteId);
        }
        saveNotesToLS(updated);
        return updated;
      });
      return { success: true };
    },

    pin_note: ({ noteId, caseId }) => {
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, pinnedNoteIds: [...new Set([...(c.pinnedNoteIds || []), String(noteId)])] }
          : c
      ));
      return { success: true };
    },

    unpin_note: ({ noteId, caseId }) => {
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, pinnedNoteIds: (c.pinnedNoteIds || []).filter(id => id !== String(noteId)) }
          : c
      ));
      return { success: true };
    },

    // ГРУПА 4 — Час / Сесія
    // add_time_entry: backwards-compatible — пише в новий time_entries[] через activityTracker.
    add_time_entry: ({ caseId = null, date, duration, description, category, billable, type = 'manual_entry', source = 'manual' }) => {
      const u = getCurrentUser();
      const tenant = getCurrentTenant ? null : null;
      const tenantId = u?.tenantId || DEFAULT_TENANT.tenantId;
      const dateStr = date || new Date().toISOString().slice(0, 10);
      const startIso = `${dateStr}T09:00:00.000Z`;
      const durMin = Number.isFinite(duration) ? duration : 60;
      const endIso = new Date(new Date(startIso).getTime() + durMin * 60 * 1000).toISOString();
      const cat = category || (caseId ? 'case_work' : 'admin');
      const catDef = getCategoryDefaults(cat);
      const entry = {
        id: `te_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        tenantId,
        userId: u.userId,
        createdAt: new Date().toISOString(),
        type: 'manual_entry',
        module: MODULES.MANUAL,
        action: 'add_time_entry',
        caseId,
        hearingId: null,
        documentId: null,
        duration: durMin * 60,
        startTime: startIso,
        endTime: endIso,
        category: cat,
        subCategory: type || null,
        billable: billable !== undefined ? !!billable : catDef.billable,
        visibleToClient: catDef.visibleToClient,
        billFactor: catDef.billFactor,
        status: 'confirmed',
        semanticGroup: null,
        parentEventId: null, parentEventType: null,
        parentTimerId: null, subtimerSessionId: null, direction: null,
        confidence: 'high',
        source: source || 'manual',
        originalDuration: null, actualDuration: null, confirmedDuration: durMin,
        exitedVia: null, resumedAt: null,
        metadata: { description: description || '' },
      };
      setTimeEntries(prev => [...(prev || []), entry]);
      return { success: true, entryId: entry.id };
    },

    update_time_entry: ({ id, fields }) => {
      if (!id || !fields || typeof fields !== 'object') {
        return { success: false, error: 'id і fields обов\'язкові' };
      }
      let found = false;
      setTimeEntries(prev => Array.isArray(prev)
        ? prev.map(e => {
            if (e?.id !== id) return e;
            found = true;
            return { ...e, ...fields, status: fields.status || 'user_corrected', updatedAt: new Date().toISOString() };
          })
        : prev);
      if (found) {
        writeAudit({
          action: 'time_entry_edited',
          targetType: 'time_entry',
          targetId: id,
          details: { fields },
          context: { module: MODULES.AGENT_ACTION, agent: null },
        });
      }
      return { success: found, found };
    },

    cancel_time_entry: ({ id, reason = null }) => {
      if (!id) return { success: false, error: 'id обов\'язковий' };
      let found = false;
      setTimeEntries(prev => Array.isArray(prev)
        ? prev.map(e => {
            if (e?.id !== id) return e;
            found = true;
            return { ...e, status: 'cancelled', metadata: { ...(e.metadata || {}), cancelReason: reason }, updatedAt: new Date().toISOString() };
          })
        : prev);
      return { success: found };
    },

    delete_time_entry: ({ id }) => {
      if (!id) return { success: false, error: 'id обов\'язковий' };
      let removed = false;
      setTimeEntries(prev => {
        if (!Array.isArray(prev)) return prev;
        const next = prev.filter(e => {
          if (e?.id === id) { removed = true; return false; }
          return true;
        });
        return next;
      });
      if (removed) {
        writeAudit({
          action: 'time_entry_deleted',
          targetType: 'time_entry',
          targetId: id,
          status: 'done',
          details: {},
          context: { module: MODULES.AGENT_ACTION, agent: null },
        });
      }
      return { success: removed };
    },

    split_time_entry: ({ id, durations = [] }) => {
      if (!id || !Array.isArray(durations) || durations.length < 2) {
        return { success: false, error: 'id і масив тривалостей (>=2) обов\'язкові' };
      }
      let madeChildren = [];
      setTimeEntries(prev => {
        if (!Array.isArray(prev)) return prev;
        const idx = prev.findIndex(e => e?.id === id);
        if (idx === -1) return prev;
        const orig = prev[idx];
        const startMs = new Date(orig.startTime).getTime();
        let cursor = startMs;
        const children = durations.map((minutes, i) => {
          const dSec = Math.max(0, Math.round(minutes * 60));
          const start = new Date(cursor).toISOString();
          cursor += dSec * 1000;
          const end = new Date(cursor).toISOString();
          return { ...orig,
            id: `te_${Date.now()}_${i}_${Math.random().toString(36).slice(2,5)}`,
            duration: dSec, startTime: start, endTime: end,
            metadata: { ...(orig.metadata || {}), splitFrom: id },
          };
        });
        madeChildren = children;
        return [...prev.slice(0, idx), ...children, ...prev.slice(idx + 1)];
      });
      return { success: madeChildren.length > 0, count: madeChildren.length };
    },

    assign_offline_period: ({ from, to, category = 'case_work', caseId = null, subCategory = null, semanticGroup = null }) => {
      if (!from || !to) return { success: false, error: 'from і to обов\'язкові' };
      const entry = activityTracker.assignOfflinePeriod(
        { from, to },
        category, caseId, { subCategory, semanticGroup }
      );
      return { success: !!entry, entryId: entry?.id || null };
    },

    // Двофазна модель події з резервуванням (Phase 4).
    // confirmEvent — узагальнений API, не специфічний для hearing.
    confirm_event: ({ eventId, eventType = 'hearing', decision = {} }) => {
      if (!eventId) return { success: false, error: 'eventId обов\'язковий' };
      const variant = decision.variant || 'completed';
      const traveled = decision.traveled !== false;
      const variantDefault = getVariantDefault(eventType, variant, traveled);
      const billFactor = Number.isFinite(decision.billFactor) ? decision.billFactor : variantDefault.billFactor;
      const newStatus = variant === 'completed' ? 'confirmed' : 'user_corrected';
      let updatedCount = 0;
      // Оновлюємо всі time_entries з parentEventId === eventId.
      setTimeEntries(prev => Array.isArray(prev)
        ? prev.map(e => {
            if (e?.parentEventId !== eventId) return e;
            updatedCount++;
            // travel: керуємо через decision.traveled.
            if (e.type === 'travel') {
              if (!traveled) {
                return { ...e, status: 'cancelled', billFactor: 0, metadata: { ...(e.metadata || {}), variant }, updatedAt: new Date().toISOString() };
              }
              const dir = e.direction;
              const customDur = dir && decision.travelDuration && Number.isFinite(decision.travelDuration[dir])
                ? decision.travelDuration[dir]
                : null;
              return {
                ...e,
                status: newStatus,
                billFactor,
                duration: customDur != null ? customDur * 60 : e.duration,
                confirmedDuration: customDur != null ? customDur : (e.confirmedDuration ?? Math.round(e.duration / 60)),
                metadata: { ...(e.metadata || {}), variant, customLabel: decision.customLabel || null, notes: decision.notes || null },
                updatedAt: new Date().toISOString(),
              };
            }
            // Основна подія (hearing_attendance і т.п.) — duration з decision.
            const fixedDuration = Number.isFinite(decision.duration) ? decision.duration : null;
            return {
              ...e,
              status: newStatus,
              billFactor,
              duration: fixedDuration != null ? fixedDuration * 60 : e.duration,
              confirmedDuration: fixedDuration != null ? fixedDuration : (e.confirmedDuration ?? Math.round(e.duration / 60)),
              metadata: { ...(e.metadata || {}), variant, customLabel: decision.customLabel || null, notes: decision.notes || null, details: decision.details || null },
              updatedAt: new Date().toISOString(),
            };
          })
        : prev
      );
      return { success: updatedCount > 0, updatedCount, variant, billFactor };
    },

    add_travel: ({ parentEventId, parentEventType = 'hearing', direction = 'to', duration, caseId = null, court = null, city = null }) => {
      if (!parentEventId) return { success: false, error: 'parentEventId обов\'язковий' };
      const u = getCurrentUser();
      const stdMin = Number.isFinite(duration)
        ? duration
        : getTimeStandard('travel', { direction, court, city });
      const startIso = new Date().toISOString();
      const endIso = new Date(new Date(startIso).getTime() + stdMin * 60 * 1000).toISOString();
      const catDef = getCategoryDefaults('travel');
      const entry = {
        id: `te_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        tenantId: u.tenantId,
        userId: u.userId,
        createdAt: new Date().toISOString(),
        type: 'travel',
        module: MODULES.EVENT_RESERVATION,
        action: 'add_travel',
        caseId,
        hearingId: parentEventType === 'hearing' ? parentEventId : null,
        documentId: null,
        duration: stdMin * 60,
        startTime: startIso,
        endTime: endIso,
        category: 'travel',
        subCategory: null,
        billable: catDef.billable,
        visibleToClient: catDef.visibleToClient,
        billFactor: catDef.billFactor,
        status: 'planned',
        semanticGroup: 'screen_passive',
        parentEventId,
        parentEventType,
        parentTimerId: null,
        subtimerSessionId: null,
        direction,
        confidence: 'medium',
        source: 'event_reservation',
        originalDuration: stdMin,
        actualDuration: null,
        confirmedDuration: null,
        exitedVia: null,
        resumedAt: null,
        metadata: { court, city },
      };
      setTimeEntries(prev => [...(prev || []), entry]);
      return { success: true, entryId: entry.id };
    },

    cancel_travel: ({ travelEntryId, reason = null }) => {
      if (!travelEntryId) return { success: false, error: 'travelEntryId обов\'язковий' };
      let found = false;
      setTimeEntries(prev => Array.isArray(prev)
        ? prev.map(e => {
            if (e?.id !== travelEntryId) return e;
            found = true;
            return { ...e, status: 'cancelled', metadata: { ...(e.metadata || {}), cancelReason: reason }, updatedAt: new Date().toISOString() };
          })
        : prev);
      return { success: found };
    },

    track_session_start: ({ caseId = null, sessionId, module = 'system', category = null }) => {
      try {
        const sid = activityTracker.startSession(caseId, module, { category });
        return { success: true, sessionId: sid || sessionId };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },

    track_session_end: ({ sessionId }) => {
      try {
        const sid = activityTracker.endSession({ reason: 'agent' });
        return { success: true, sessionId: sid || sessionId };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },

    start_external_work: ({ category = 'case_work', caseId = null, subCategory = null, plannedDuration = null, semanticGroup = null }) => {
      try {
        const id = activityTracker.startSubtimer(category, caseId, subCategory, { plannedDuration, semanticGroup });
        return { success: !!id, subtimerId: id };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },

    end_external_work: () => {
      try {
        const entry = activityTracker.endSubtimer();
        return { success: !!entry, entryId: entry?.id || null };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },

    update_external_work: ({ updates = {} }) => {
      try {
        const ok = activityTracker.updateSubtimer(updates);
        return { success: ok };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },

    // ГРУПА 5 — Композитна дія
    batch_update: async ({ operations, agentId }) => {
      const results = [];
      for (const op of operations) {
        try {
          if (op._resolveError) {
            results.push({ action: op.action, ok: false, error: op._resolveError });
            continue;
          }
          if (!op.action || !ACTIONS[op.action]) {
            results.push({ action: op.action, ok: false, error: 'Невідома дія' });
            continue;
          }
          if (agentId && PERMISSIONS[agentId] && !PERMISSIONS[agentId].includes(op.action)) {
            results.push({ action: op.action, ok: false, error: 'Немає повноважень' });
            continue;
          }
          const result = await ACTIONS[op.action](op.params);
          if (result && result.error) {
            results.push({ action: op.action, ok: false, error: result.error });
          } else {
            results.push({ action: op.action, ok: true, result });
          }
        } catch (err) {
          results.push({ action: op.action, ok: false, error: err.message });
        }
      }
      const successCount = results.filter(r => r.ok).length;
      return { success: successCount > 0, successCount, total: results.length, results };
    },
  };

  // ── PERMISSIONS — матриця повноважень агентів ──────────────────────────────
  const PERMISSIONS = {
    qi_agent: [
      'create_case', 'close_case', 'restore_case',
      'update_case_field',
      'add_deadline', 'update_deadline', 'delete_deadline',
      'add_hearing', 'update_hearing', 'delete_hearing',
      'add_note', 'update_note', 'delete_note',
      'pin_note', 'unpin_note',
      'add_time_entry',
      // v4 Billing Foundation
      'update_time_entry', 'cancel_time_entry', 'split_time_entry',
      'assign_offline_period',
      'confirm_event', 'add_travel', 'cancel_travel',
      'start_external_work', 'end_external_work', 'update_external_work',
      'batch_update',
    ],

    dashboard_agent: [
      'add_hearing', 'update_hearing', 'delete_hearing',
      'add_note', 'update_note', 'delete_note',
      'confirm_event', 'add_travel',
      'batch_update',
    ],

    dossier_agent: [
      'create_case', 'close_case', 'restore_case',
      'update_case_field',
      'add_deadline', 'update_deadline', 'delete_deadline',
      'add_hearing', 'update_hearing', 'delete_hearing',
      'add_note', 'update_note', 'delete_note',
      'pin_note', 'unpin_note',
      'add_time_entry',
      // v4 Billing Foundation
      'update_time_entry', 'cancel_time_entry', 'split_time_entry',
      'assign_offline_period',
      'confirm_event', 'add_travel', 'cancel_travel',
      'start_external_work', 'end_external_work', 'update_external_work',
      'track_session_start', 'track_session_end',
    ],

    // destroy_case, delete_time_entry — жоден агент. Тільки UI.
  };

  // ── executeAction — єдина точка входу для всіх дій агентів ─────────────────
  // ── executeAction — async з перевірками і audit log ───────────────────────
  // Інтерфейс зберігається: agentId, action, params, [userId].
  // Заглушки checkTenantAccess/RolePermission/CaseAccess зараз true для Вадима;
  // у SaaS — заміняться на повноцінні перевірки без зміни сигнатури.
  const executeAction = async (agentId, action, params, userId) => {
    const currentUser = getCurrentUser();
    const effectiveUserId = userId || currentUser.userId;
    const tenantId = currentUser.tenantId;

    // 1. Перевірка ролей агента (allowlist дій)
    const allowed = PERMISSIONS[agentId] || [];
    if (!allowed.includes(action)) {
      console.warn(`executeAction BLOCKED: ${agentId} → ${action}`);
      return { success: false, error: `Немає повноважень: ${action}` };
    }

    if (!ACTIONS[action]) {
      console.warn(`executeAction UNKNOWN: ${action}`);
      return { success: false, error: `Невідома дія: ${action}` };
    }

    // 2. Перевірка tenant (заглушка → true)
    if (!checkTenantAccess(effectiveUserId, tenantId)) {
      console.warn(`executeAction TENANT DENIED: ${effectiveUserId} → ${tenantId}`);
      return { success: false, error: 'Tenant access denied' };
    }

    // 3. Перевірка ролі для дії (заглушка → true для bureau_owner)
    if (!checkRolePermission(currentUser.globalRole, action)) {
      console.warn(`executeAction ROLE DENIED: ${currentUser.globalRole} → ${action}`);
      return { success: false, error: `Action ${action} not allowed for role ${currentUser.globalRole}` };
    }

    // 4. Перевірка доступу до конкретної справи (якщо action прив'язаний)
    if (params && params.caseId) {
      const caseObj = cases.find(c => String(c.id) === String(params.caseId));
      if (caseObj && !checkCaseAccess(effectiveUserId, caseObj)) {
        console.warn(`executeAction CASE DENIED: ${effectiveUserId} → ${params.caseId}`);
        return { success: false, error: `No access to case ${params.caseId}` };
      }
    }

    try {
      const result = await ACTIONS[action](params);
      console.log(`executeAction OK: ${action}`, params, result);

      // 5. Запис в auditLog для критичних дій (Q4: лише з AUDIT_ACTIONS)
      if (shouldAudit(action) && result && (result.success || result.successCount)) {
        const targetId = params?.caseId || result?.caseId || params?.targetId || null;
        const targetType = params?.caseId || result?.caseId
          ? 'case'
          : (action.includes('hearing') ? 'hearing' : action.includes('deadline') ? 'deadline' : null);
        writeAudit({
          tenantId,
          userId: effectiveUserId,
          userRoleAtTime: currentUser.globalRole,
          action,
          targetType,
          targetId,
          status: 'done',
          details: { params },
          context: { module: MODULES.EXECUTE_ACTION, agent: agentId },
        });
      }

      // 6. v4 Billing Foundation — звіт у activityTracker для значущих дій.
      // Не репортимо track_session_*, batch_update і самі _query дії.
      if (result && (result.success || result.successCount) &&
          !['track_session_start', 'track_session_end', 'batch_update'].includes(action)) {
        try {
          // Категорія за наявністю caseId — case_work або admin.
          const hookCaseId = params?.caseId || result?.caseId || null;
          activityTracker.report(action, {
            type: 'action',
            module: MODULES.EXECUTE_ACTION,
            caseId: hookCaseId,
            hearingId: params?.hearingId || result?.hearingId || null,
            duration: 0,
            category: categoryForCase(hookCaseId),
            metadata: { agentId, viaAgent: true },
          });
        } catch (te) {
          // Білінг не повинен блокувати юридичну роботу.
          console.warn('activityTracker.report (executeAction hook) error:', te);
        }
      }

      return result;
    } catch (e) {
      console.error(`executeAction ERROR [${action}]:`, e);
      return { success: false, error: e.message };
    }
  };

  return (
    <div className="app">
      {/* TOPBAR */}
      <div className="topbar">
        <div className="topbar-logo">АБ <span>Левицького</span></div>
        <div className="topbar-right" style={{display:'flex',gap:8,alignItems:'center'}}>
          {lastSaved && <span style={{fontSize:10,color:'var(--text3)',letterSpacing:'0.04em'}}>збережено {lastSaved}</span>}
          <button className="btn-sm btn-ghost" onClick={async () => {
            if(await systemConfirm('Скинути всі дані і повернути тестові справи?', 'Скидання даних')) {
              localStorage.removeItem('levytskyi_cases');
              setCases(normalizeCases(INITIAL_CASES));
            }
          }} style={{fontSize:11,opacity:0.5}} title="Скинути дані">↺</button>
        </div>
      </div>

      {/* NAV */}
      <div className="nav">
        {[
          {id:'dashboard', label:'📊 Дашборд'},
          {id:'cases',     label:`📁 Справи (${cases.filter(c=>c.status==='active').length})`},
          {id:'notebook',  label:'📓 Книжка'},
          {id:'add',       label:'➕ Нова справа'},
          {id:'analysis',  label:'🔍 Аналіз системи'},
        ].map(t => (
          <button key={t.id} className={`nav-tab${tab===t.id?' active':''}`} onClick={() => {
            // [BILLING] module_navigation
            try { activityTracker.report('module_navigation', { module: MODULES.APP, category: 'system', metadata: { from: tab, to: t.id } }); } catch {}
            setDossierCase(null); if (t.id !== 'add') setEditingCase(null); setTab(t.id);
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* MAIN + UNIVERSAL PANEL */}
      <div
        ref={containerRef}
        style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden', minHeight: 0 }}
      >
        {/* Main content — поточний вид */}
        <div className="main" style={{ flex: 1, overflow: 'auto', minWidth: 0, minHeight: 0, position: 'relative' }}>
          {!dossierCase && tab === 'dashboard' && (
            <Dashboard
              cases={cases}
              calendarEvents={calendarEvents}
              onExecuteAction={executeAction}
              setAiUsage={setAiUsage}
            />
          )}
          {!dossierCase && tab === 'cases' && (
            <div>
              <div className="status-counter">
                <span>Активні: <strong style={{color:'var(--green)'}}>{cases.filter(c=>c.status==='active').length}</strong></span>
                <span className="status-counter-sep">|</span>
                <span>Призупинені: <strong style={{color:'var(--text2)'}}>{cases.filter(c=>c.status==='paused').length}</strong></span>
                <span className="status-counter-sep">|</span>
                <span>Закриті: <strong style={{color:'var(--text3)'}}>{cases.filter(c=>c.status==='closed').length}</strong></span>
              </div>
              <div className="cases-toolbar">
                <div className="search-box"><span style={{color:'var(--text3)'}}>🔍</span><input placeholder="Пошук за назвою, клієнтом, судом..." value={search} onChange={e=>setSearch(e.target.value)} /></div>
                {['all','civil','criminal','military','admin'].map(cat => (
                  <button key={cat} className={`filter-btn${filterCat===cat?' active':''}`} onClick={()=>setFilterCat(cat)}>{cat==='all'?'Всі':CAT_LABELS[cat]}</button>
                ))}
              </div>
              <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>
                {[
                  {val:'active', label:`Активні (${cases.filter(c=>c.status==='active').length})`},
                  {val:'paused', label:`Призупинені (${cases.filter(c=>c.status==='paused').length})`},
                  {val:'closed', label:`Закриті (${cases.filter(c=>c.status==='closed').length})`},
                  {val:'all',    label:`Всі (${cases.length})`},
                ].map(({val,label}) => (
                  <button key={val} className={`filter-btn${filterStatus===val?' active':''}`} onClick={()=>setFilterStatus(val)}>{label}</button>
                ))}
              </div>
              <div style={{fontSize:12,color:'var(--text2)',marginBottom:12}}>{filteredCases.length} справ</div>
              {filteredCases.length === 0 && <div className="empty"><div className="empty-icon">🔍</div><div className="empty-text">Нічого не знайдено</div></div>}
              <div className="cases-grid">
                {filteredCases.map(c => (
                  <div key={c.id} style={{position:'relative'}}>
                    <CaseCard c={c} onClick={() => setDossierCase(c)} />
                    {c.status === 'closed' && (
                      <div style={{position:'absolute', bottom:8, right:8, display:'flex', gap:4}}>
                        <button onClick={(e) => { e.stopPropagation(); restoreCase(c.id); }} style={{
                          color:'#2ecc71', background:'rgba(46,204,113,.1)', border:'1px solid rgba(46,204,113,.3)',
                          padding:'4px 10px', borderRadius:6, cursor:'pointer', fontSize:11
                        }}>Відновити</button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteCase(c); }} style={{
                          color:'#e74c3c', background:'rgba(231,76,60,.1)', border:'1px solid rgba(231,76,60,.3)',
                          padding:'4px 10px', borderRadius:6, cursor:'pointer', fontSize:11
                        }}>Видалити назавжди</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {!dossierCase && tab === 'add' && <AddCaseForm onSave={editingCase ? saveCaseEdit : addCase} onCancel={() => { setEditingCase(null); setTab('cases'); }} initialData={editingCase} />}
          {!dossierCase && tab === 'notebook' && (
            <ModuleErrorBoundary>
              <React.Suspense fallback={<div style={{padding:20,color:'#9aa0b8'}}>Завантаження...</div>}>
                <Notebook cases={cases} onUpdateCase={updateCase} notes={notes} onAddNote={addNote} onUpdateNote={updateNote} onDeleteNote={deleteNote} onPinNote={pinNote} />
              </React.Suspense>
            </ModuleErrorBoundary>
          )}
          {!dossierCase && tab === 'analysis' && <AnalysisPanel cases={cases} setCases={setCases} driveConnected={driveConnected} setDriveConnected={setDriveConnected} driveSyncStatus={driveSyncStatus} />}

          {/* DOSSIER — inside main, position absolute to fill parent */}
          {dossierCase && (
            <ErrorBoundary>
              <CaseDossier
                caseData={dossierCase}
                cases={cases}
                updateCase={updateCase}
                onClose={() => setDossierCase(null)}
                onSaveIdea={idea => setIdeas(prev => [...prev, idea])}
                onCloseCase={closeCase}
                onDeleteCase={handleDeleteCase}
                notes={(() => {
                  const fromBucket = (notes.cases || []).filter(n => String(n.caseId) === String(dossierCase.id) || n.caseName === dossierCase.name);
                  const fromCase = (Array.isArray(dossierCase.notes) ? dossierCase.notes : []).filter(n => n && typeof n === 'object');
                  const seen = new Set();
                  return [...fromBucket, ...fromCase].filter(n => {
                    if (!n.id) return true;
                    if (seen.has(n.id)) return false;
                    seen.add(n.id); return true;
                  });
                })()}
                onAddNote={addNote}
                onUpdateNote={updateNote}
                onDeleteNote={deleteNote}
                onPinNote={pinNote}
                driveConnected={driveConnected}
                onExecuteAction={executeAction}
                setAiUsage={setAiUsage}
              />
            </ErrorBoundary>
          )}
        </div>

        {/* Universal Panel — розділювач */}
        {showUniversalPanel && (
          <div
            onMouseDown={() => { isDragging.current = true; }}
            onTouchStart={() => { isDragging.current = true; }}
            style={{ width: 8, cursor: 'col-resize', flexShrink: 0, background: '#1e2130', display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none', transition: 'background .15s' }}
            onMouseEnter={e => e.currentTarget.style.background = '#2a2d44'}
            onMouseLeave={e => e.currentTarget.style.background = '#1e2130'}
          >
            <div style={{ width: 4, height: 40, borderRadius: 2, background: '#3a3d5a' }} />
          </div>
        )}

        {/* Universal Panel */}
        {showUniversalPanel && (
          <div style={{
            width: panelWidth, minWidth: 280, maxWidth: 480, flexShrink: 0,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            borderLeft: '1px solid #2e3148', background: '#141625',
            animation: 'splitPanelIn 0.2s ease'
          }}>
            {/* Вкладки */}
            <div style={{ flexShrink: 0, display: 'flex', borderBottom: '1px solid #2a2d3e' }}>
              <button onClick={() => setUniversalTab('qi')} style={{
                flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: universalTab === 'qi' ? '#1a1d27' : 'transparent',
                color: universalTab === 'qi' ? '#f39c12' : '#5a6080',
                borderBottom: universalTab === 'qi' ? '2px solid #f39c12' : '2px solid transparent'
              }}>{"⚡ QI"}</button>
              <button onClick={() => setUniversalTab('agent')} style={{
                flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: universalTab === 'agent' ? '#1a1d27' : 'transparent',
                color: universalTab === 'agent' ? '#4f7cff' : '#5a6080',
                borderBottom: universalTab === 'agent' ? '2px solid #4f7cff' : '2px solid transparent'
              }}>{"🤖 Агент"}</button>
            </div>

            {/* Вміст вкладки */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {universalTab === 'qi' && (
                <QuickInput cases={cases} setCases={setCases} onClose={() => setShowUniversalPanel(false)} driveConnected={driveConnected} onExecuteAction={executeAction} setAiUsage={setAiUsage} />
              )}
              {universalTab === 'agent' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#5a6080', gap: 12, padding: 20 }}>
                  <div style={{ fontSize: 48, opacity: 0.2 }}>{"🤖"}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#9aa0b8' }}>{"Головний агент"}</div>
                  <div style={{ fontSize: 12, textAlign: 'center' }}>{"Буде реалізовано в наступній сесії"}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* MODALS */}
      {selected && <CaseModal c={selected} onClose={() => setSelected(null)} onEdit={handleEdit} onDelete={handleDeleteCase} onCloseCase={closeCase} onRestore={restoreCase} />}

      {/* FAB — toggle Universal Panel, draggable */}
      {!showUniversalPanel && <button
        className="fab"
        title="Universal Panel"
        style={qiBtnPos.x !== null ? { position: 'fixed', left: qiBtnPos.x, top: qiBtnPos.y, right: 'auto', bottom: 'auto', touchAction: 'none' } : { touchAction: 'none' }}
        onMouseDown={e => {
          qiDragRef.current = true;
          qiDragMoved.current = false;
          const rect = e.currentTarget.getBoundingClientRect();
          qiStartRef.current = { x: e.clientX, y: e.clientY, btnX: rect.left, btnY: rect.top };
          e.preventDefault();
        }}
        onTouchStart={e => {
          qiDragRef.current = true;
          qiDragMoved.current = false;
          const touch = e.touches[0];
          const rect = e.currentTarget.getBoundingClientRect();
          qiStartRef.current = { x: touch.clientX, y: touch.clientY, btnX: rect.left, btnY: rect.top };
        }}
        onClick={e => {
          if (qiDragMoved.current) { e.preventDefault(); return; }
          setShowUniversalPanel(true);
        }}
      >⚡</button>}
      <SystemModalRoot />
    </div>
  );
}


export default App;
