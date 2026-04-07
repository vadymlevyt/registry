import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import Dashboard from './components/Dashboard';
import CaseDossier from './components/CaseDossier';
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


// ── MOCK DATA ─────────────────────────────────────────────────────────────────
const today = new Date();
const d = (daysFromNow) => {
  const dt = new Date(today);
  dt.setDate(dt.getDate() + daysFromNow);
  return dt.toISOString().split('T')[0];
};

const INITIAL_CASES = [
  { id:1,  name:'Салун',            client:'Салун Ж./Салун І.',  category:'civil',    status:'active',  court:'Рівненський райсуд',        case_no:'363/2241/24', hearing_date:d(2),  deadline:d(1),  deadline_type:'Заява про витрати (ст.141)',  next_action:'Подати заяву про судові витрати', notes:'' },
  { id:2,  name:'Корева',           client:'Корева М.В.',        category:'military', status:'active',  court:'Костопільський райсуд',      case_no:'560/1891/25', hearing_date:d(5),  deadline:d(3),  deadline_type:'Адвокатський запит до в/ч',   next_action:'Надіслати запит до МОУ',          notes:'' },
  { id:3,  name:'Рубан',            client:'Рубан О.П.',         category:'civil',    status:'active',  court:'Печерський райсуд м.Київ',   case_no:'757/3312/23', hearing_date:d(8),  deadline:d(6),  deadline_type:'Відповідь на позов',          next_action:'Підготувати заперечення',         notes:'' },
  { id:4,  name:'Брановський',      client:'Брановський В.І.',   category:'civil',    status:'active',  court:'Господарський суд Київ',     case_no:'910/4521/24', hearing_date:d(12), deadline:d(10), deadline_type:'Апеляційна скарга',           next_action:'Подати апеляцію',                 notes:'',
    agentHistory: [],
    proceedings: [
      { id: "proc_main", type: "first", title: "Основне провадження", court: "Пустомитівський районний суд Львівської обл.", status: "paused", parentProcId: null, parentEventId: null },
      { id: "proc_appeal_1", type: "appeal", title: "Апеляція: ухвала 03.2024", court: "Київський апеляційний суд", status: "active", parentProcId: "proc_main", parentEventId: "event_4" }
    ],
    documents: [
      { id: 1, procId: "proc_main", name: "Позовна заява", icon: "📄", date: "березень 2023", category: "pleading", author: "ours", tags: ["key"], notes: "" },
      { id: 2, procId: "proc_main", name: "Ухвала про відкриття провадження", icon: "📋", date: "березень 2023", category: "court_act", author: "court", tags: [], notes: "" },
      { id: 3, procId: "proc_main", name: "Протокол підготовчого засідання", icon: "📋", date: "грудень 2023", category: "court_act", author: "court", tags: [], notes: "" },
      { id: 4, procId: "proc_main", name: "Зустрічна позовна заява", icon: "📄", date: "лютий 2024", category: "pleading", author: "opponent", tags: [], notes: "" },
      { id: 5, procId: "proc_main", name: "Клопотання про поновлення строку", icon: "📄", date: "лютий 2024", category: "motion", author: "opponent", tags: [], notes: "" },
      { id: 6, procId: "proc_main", name: "Ухвала про відмову у прийнятті зустрічного позову", icon: "📋", date: "березень 2024", category: "court_act", author: "court", tags: ["key"], notes: "" },
      { id: 7, procId: "proc_main", name: "Ухвала про зупинення провадження", icon: "📋", date: "квітень 2024", category: "court_act", author: "court", tags: [], notes: "" },
      { id: 8, procId: "proc_appeal_1", name: "Апеляційна скарга на ухвалу", icon: "📤", date: "квітень 2024", category: "pleading", author: "opponent", tags: ["key"], notes: "" },
      { id: 9, procId: "proc_appeal_1", name: "Квитанція про сплату судового збору", icon: "🧾", date: "квітень 2024", category: "other", author: "opponent", tags: [], notes: "" },
      { id: 10, procId: "proc_appeal_1", name: "Відзив на апеляційну скаргу", icon: "📩", date: "травень 2024", category: "pleading", author: "ours", tags: ["key"], notes: "" },
      { id: 11, procId: "proc_appeal_1", name: "Заперечення на відзив", icon: "↩️", date: "червень 2024", category: "pleading", author: "opponent", tags: [], notes: "⚠️ Лікарняний лист — перевірити автентичність" },
      { id: 12, procId: "proc_appeal_1", name: "Відповідь на заперечення", icon: "↪️", date: "липень 2024", category: "pleading", author: "ours", tags: [], notes: "" }
    ]
  },
  { id:5,  name:'Нестеренко',       client:'Нестеренко Г.С.',    category:'criminal', status:'active',  court:'Рівненський апеляційний суд',case_no:'190/887/24',  hearing_date:d(15), deadline:null,  deadline_type:null,                          next_action:'Підготувати клопотання',          notes:'' },
  { id:6,  name:'Голобля',          client:'Голобля Т.В.',       category:'civil',    status:'active',  court:'Костопільський райсуд',      case_no:'560/2109/25', hearing_date:d(18), deadline:d(16), deadline_type:'Процесуальна заява',          next_action:'Надіслати заяву',                 notes:'' },
  { id:7,  name:'Манолюк',          client:'Манолюк В.О.',       category:'admin',    status:'active',  court:'Рівненський окружний адмінсуд',case_no:'460/5543/24',hearing_date:d(20), deadline:null,  deadline_type:null,                          next_action:'Чекаємо на ухвалу суду',          notes:'' },
  { id:8,  name:'Голдбері',         client:'Голдбері О.Ю.',      category:'civil',    status:'active',  court:'Рівненський райсуд',        case_no:'363/4412/23', hearing_date:d(22), deadline:d(20), deadline_type:'Відповідь на апеляцію',       next_action:'Підготувати відзив',              notes:'' },
  { id:9,  name:'Кісельова',        client:'Кісельова Н.І.',     category:'civil',    status:'active',  court:'Київський апеляційний суд',  case_no:'22-ц/824/22', hearing_date:d(25), deadline:null,  deadline_type:null,                          next_action:'Очікуємо засідання',             notes:'' },
  { id:10, name:'Смолій Андрій',    client:'Смолій А.В.',        category:'criminal', status:'active',  court:'Рівненський суд присяжних',  case_no:'190/2345/24', hearing_date:d(28), deadline:null,  deadline_type:null,                          next_action:'Підготувати позицію захисту',    notes:'' },
  { id:11, name:'Варфоломєєв',      client:'Варфоломєєв С.М.',   category:'civil',    status:'active',  court:'Костопільський райсуд',      case_no:'560/3341/25', hearing_date:d(30), deadline:d(28), deadline_type:'Клопотання про докази',       next_action:'Подати клопотання',              notes:'' },
  { id:12, name:'Липовцев',         client:'Липовцев І.О.',      category:'civil',    status:'active',  court:'Рівненський райсуд',        case_no:'363/1122/24', hearing_date:null,  deadline:d(7),  deadline_type:'Позовна заява',               next_action:'Подати позов',                   notes:'' },
  { id:13, name:'Цзян',             client:'Цзян Хуей',          category:'admin',    status:'active',  court:'Київський окружний адмінсуд',case_no:'640/8821/25', hearing_date:d(35), deadline:null,  deadline_type:null,                          next_action:'Очікуємо відповідь',             notes:'' },
  { id:14, name:'Бабенко',          client:'Бабенко О.В.',       category:'civil',    status:'active',  court:'Печерський райсуд м.Київ',   case_no:'757/9012/24', hearing_date:d(40), deadline:null,  deadline_type:null,                          next_action:'Підготовка документів',          notes:'' },
  { id:15, name:'Конах',            client:'Конах В.П.',         category:'military', status:'active',  court:'Костопільський райсуд',      case_no:'560/4453/25', hearing_date:d(14), deadline:d(12), deadline_type:'Запит до ТЦК',               next_action:'Надіслати запит',                notes:'' },
  { id:16, name:'Сипко',            client:'Сипко Р.Д.',         category:'criminal', status:'paused',  court:'Рівненський суд',            case_no:'190/5544/23', hearing_date:null,  deadline:null,  deadline_type:null,                          next_action:'Очікуємо процесуального рішення',notes:'' },
  { id:17, name:'Квант',            client:'ТОВ «Квант»',        category:'admin',    status:'active',  court:'Господарський суд Рівне',    case_no:'918/2211/25', hearing_date:d(45), deadline:null,  deadline_type:null,                          next_action:'Підготовка позиції',             notes:'' },
  { id:18, name:'Янченко',          client:'Янченко Л.С.',       category:'civil',    status:'active',  court:'Рівненський райсуд',        case_no:'363/7734/24', hearing_date:d(50), deadline:null,  deadline_type:null,                          next_action:'Збираємо докази',                notes:'' },
  { id:19, name:'Махді',            client:'Махді Карім',        category:'admin',    status:'active',  court:'Київський окружний адмінсуд',case_no:'640/3312/25', hearing_date:d(55), deadline:null,  deadline_type:null,                          next_action:'Очікуємо ухвали',                notes:'' },
  { id:20, name:'Колесник',         client:'Колесник Н.О.',      category:'civil',    status:'active',  court:'Рівненський апеляційний суд',case_no:'22-ц/824/8821/24', hearing_date:d(60), deadline:null, deadline_type:null,                   next_action:'Підготовка апеляції',            notes:'' },
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

// ── COMPONENTS ────────────────────────────────────────────────────────────────

function CaseCard({ c, onClick }) {
  const hearingDays = daysUntil(c.hearing_date);
  const deadlineDays = daysUntil(c.deadline);
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
        {c.hearing_date && (
          <div className="case-row">
            <span className="case-row-icon">📅</span>
            <span className="case-row-label">Засідання:</span>
            <span className={`case-row-val ${urgencyClass(hearingDays) || ''}`}>
              {formatDate(c.hearing_date)}
              {hearingDays !== null && <span style={{marginLeft:5,fontSize:'10px',opacity:0.7}}>({daysLabel(hearingDays)})</span>}
            </span>
          </div>
        )}
        {c.deadline && (
          <div className="case-row">
            <span className="case-row-icon">⚡</span>
            <span className="case-row-label">Дедлайн:</span>
            <span className={`case-row-val ${urgencyClass(deadlineDays) || ''}`}>
              {formatDate(c.deadline)}
              {deadlineDays !== null && <span style={{marginLeft:5,fontSize:'10px',opacity:0.7}}>({daysLabel(deadlineDays)})</span>}
            </span>
          </div>
        )}
        {c.deadline_type && (
          <div className="case-row">
            <span className="case-row-icon" style={{opacity:0}}>·</span>
            <span className="case-row-label" style={{fontSize:'11px',color:'var(--text3)',fontStyle:'italic'}}>{c.deadline_type}</span>
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
  const hearingDays = daysUntil(c.hearing_date);
  const deadlineDays = daysUntil(c.deadline);
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
              {formatDate(c.hearing_date)}
              {c.hearing_time && <span style={{marginLeft:6}}>о {c.hearing_time}</span>}
              {hearingDays !== null && <span style={{marginLeft:6,fontSize:'11px',opacity:0.7}}>({daysLabel(hearingDays)})</span>}
            </span>
          </div>
          {c.deadline && (
            <div className="modal-field">
              <span className="modal-field-label">Дедлайн</span>
              <span className={`modal-field-val ${urgencyClass(deadlineDays) || ''}`}>
                {formatDate(c.deadline)}
                {deadlineDays !== null && <span style={{marginLeft:6,fontSize:'11px',opacity:0.7}}>({daysLabel(deadlineDays)})</span>}
              </span>
            </div>
          )}
          {c.deadline_type && (
            <div className="modal-field"><span className="modal-field-label">Тип дедлайну</span><span className="modal-field-val">{c.deadline_type}</span></div>
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
            <button className="btn-lg secondary" onClick={() => {
              if (window.confirm("Закрити справу? Вона перейде в архів. Видалити можна буде звідти.")) {
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
      if (c.hearing_date) {
        if (!map[c.hearing_date]) map[c.hearing_date] = [];
        map[c.hearing_date].push({ ...c, eventType:'hearing' });
      }
      if (c.deadline) {
        if (!map[c.deadline]) map[c.deadline] = [];
        map[c.deadline].push({ ...c, eventType:'deadline' });
      }
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
  "recommended_actions": ["update_case_date", "update_deadline", "update_case_field", "save_to_drive", "create_case", "save_note", "update_case_status"],
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
- recommended_actions must only contain values from the allowed list above: update_case_date, update_deadline, save_to_drive, create_case, save_note, update_case_status
- Use update_case_date when document contains a HEARING date (судове засідання)
- Use update_deadline when document contains a DEADLINE for filing/response (процесуальний строк, дедлайн подачі)
- extracted.deadline_date — дата дедлайну (YYYY-MM-DD)
- extracted.deadline_type — тип дедлайну (напр. "Відзив", "Апеляція", "Процесуальний строк")
- If input is clearly just a note or unrecognized = input_type: "note", recommended_actions: ["save_note"]
- Never output anything except the JSON object`;

// Для Sonnet — чат-команди, розмовна мова
const SONNET_CHAT_PROMPT = `You are an AI assistant for a Ukrainian law office (Advocate Bureau Levytskyi, Kyiv).
You help the lawyer manage cases through natural voice and text commands.
You have full context of all cases in the registry, provided in each message.
Use this context to answer questions about specific cases, deadlines, hearings.
You can answer: "when is the next hearing for Бабенко", "what is urgent today",
"what needs to be done for Рубан", "which cases have no deadline".

Current year: ${new Date().getFullYear()}. Today: ${new Date().toISOString().split('T')[0]}.

When the user gives you a command:
- Respond conversationally in Ukrainian (1-3 sentences)
- If a system action is needed, append on a NEW LINE: ACTION_JSON: {"recommended_actions": ["action_id"], "extracted": {"case_name": "...", "hearing_date": "YYYY-MM-DD", "hearing_time": "HH:MM"}}
- Available action_ids: update_case_date, update_deadline, save_note, create_case, update_case_status, update_case_field, delete_case
- update_case_date: for hearing dates (засідання)
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
- Execute intent immediately — do NOT ask for confirmation for adding/updating hearing dates
- Only ask confirmation for: changing status to closed, deleting cases
- If case not found in the list: ask which case the user means
- If date not specified: ask for the date
- After successful action: confirm with "✅ Додано засідання у справі [назва] на [дата] о [час]"
- Remember what was discussed in the conversation history
- If the case is NOT found in the registry AND the input describes a new court matter → use create_case action, NOT update_case_date
- Only use update_case_date if the case EXISTS in the registry
- If uncertain whether case exists — propose create_case
- When creating case from chat: use short name format "Прізвище І.Б."`;

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

// Helper: save note to localStorage
function saveNoteToStorage(text, resultPayload, caseId, caseName, source, category) {
  try {
    const notes = JSON.parse(localStorage.getItem('levytskyi_notes') || '[]');
    notes.unshift({
      id: Date.now(),
      text: text || '',
      result: resultPayload || null,
      category: category || 'general',
      caseId: caseId || null,
      caseName: caseName || null,
      source: source || 'manual',
      ts: new Date().toISOString(),
    });
    if (notes.length > 500) notes.splice(500);
    localStorage.setItem('levytskyi_notes', JSON.stringify(notes));
  } catch(e) {}
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
    const dd = daysFrom(c.deadline);
    const hd = daysFrom(c.hearing_date);
    return (dd !== null && dd >= 0 && dd <= 3) || (hd !== null && hd >= 0 && hd <= 3);
  });

  let ctx = `КОНТЕКСТ СИСТЕМИ — АБ Левицького (${today.toLocaleDateString('uk-UA')})\n`;
  ctx += `Всього справ: ${cases.length} | Активних: ${active.length} | Призупинених: ${paused.length} | Закритих: ${closed.length}\n`;

  if (hot.length > 0) {
    ctx += `\n⚡ ГАРЯЧІ (дедлайн або засідання ≤ 3 дні):\n`;
    hot.forEach(c => {
      const dd = daysFrom(c.deadline);
      const hd = daysFrom(c.hearing_date);
      ctx += `  • ${c.name}`;
      if (hd !== null && hd >= 0 && hd <= 3) ctx += ` | Засідання: ${formatDate(c.hearing_date, c.hearing_time)}`;
      if (dd !== null && dd >= 0 && dd <= 3) ctx += ` | Дедлайн: ${formatDate(c.deadline)}`;
      if (c.next_action) ctx += ` | Дія: ${c.next_action}`;
      ctx += '\n';
    });
  }

  ctx += `\nАКТИВНІ СПРАВИ:\n`;

  const totalActive = active.length;
  const detail = totalActive <= 15 ? 'full' : totalActive <= 30 ? 'medium' : 'compact';

  active.forEach(c => {
    if (detail === 'full') {
      ctx += `• ${c.name}`;
      if (c.case_no) ctx += ` [${c.case_no}]`;
      ctx += ` | ${catMap[c.category] || c.category || '—'}`;
      if (c.court) ctx += ` | ${c.court}`;
      if (c.client) ctx += ` | Клієнт: ${c.client}`;
      if (c.hearing_date) ctx += ` | Засідання: ${formatDate(c.hearing_date, c.hearing_time)}`;
      if (c.deadline) ctx += ` | Дедлайн: ${formatDate(c.deadline)}`;
      if (c.next_action) ctx += ` | Дія: ${c.next_action}`;
      ctx += '\n';
    } else if (detail === 'medium') {
      ctx += `• ${c.name}`;
      if (c.case_no) ctx += ` [${c.case_no}]`;
      if (c.hearing_date) ctx += ` | Зас: ${formatDate(c.hearing_date, c.hearing_time)}`;
      if (c.deadline) ctx += ` | Дед: ${formatDate(c.deadline)}`;
      if (c.next_action) ctx += ` | ${c.next_action}`;
      ctx += '\n';
    } else {
      ctx += `• ${c.name}`;
      const nearest = c.hearing_date || c.deadline;
      if (nearest) ctx += ` (${formatDate(nearest, c.hearing_date ? c.hearing_time : null)})`;
      ctx += '\n';
    }
  });

  if (detail !== 'full') {
    ctx += `\n[Показано стислий формат. Для деталей по конкретній справі — запитай окремо]\n`;
  }

  if (paused.length > 0) {
    ctx += `\nПРИЗУПИНЕНІ СПРАВИ:\n`;
    paused.forEach(c => {
      ctx += `• ${c.name}`;
      if (c.court) ctx += ` | ${c.court}`;
      if (c.next_action) ctx += ` | Дія: ${c.next_action}`;
      ctx += '\n';
    });
  }

  return ctx;
}

function QuickInput({ cases, setCases, onClose, driveConnected }) {
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
  useEffect(() => { console.log('QI driveConnected changed:', driveConnected); }, [driveConnected]);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [conversationHistory]);

  // ── File handling ──────────────────────────────────────────────────────────
  const handleFile = async (file) => {
    if (!file) return;
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
    let ext = (workingFile.name || '').split('.').pop().toLowerCase();
    if (!ext || ext === workingFile.name.toLowerCase()) {
      const mime = workingFile.type || '';
      if (mime.includes('pdf')) ext = 'pdf';
      else if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
      else if (mime.includes('png')) ext = 'png';
      else if (mime.includes('webp')) ext = 'webp';
      else if (mime.includes('heic') || mime.includes('heif')) ext = 'heic';
      else if (mime.includes('word') || mime.includes('docx')) ext = 'docx';
      else if (mime.includes('text')) ext = 'txt';
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
        if (fullText.trim().length > 20) {
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
    // DEBUG — видалити після діагностики
    console.log('readImageAsBase64 called:', file.name, file.type, file.size);
    const reader = new FileReader();
    reader.onload = (e) => {
      console.log('FileReader onload, result length:', e.target.result?.length);
      const base64 = e.target.result.split(',')[1];
      console.log('base64 length:', base64?.length);
      const mediaType = file.type || 'image/jpeg';
      analyzeImageWithVision(base64, mediaType, file.name);
    };
    reader.onerror = (e) => {
      console.error('FileReader error:', e);
      setErrorCategory('llm_failed');
      setErrorDetail('FileReader помилка: ' + (e.target?.error?.message || 'невідома'));
    };
    reader.readAsDataURL(file);
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
    // DEBUG — видалити після діагностики
    if (!base64Data || base64Data.length < 10) {
      setErrorCategory('extraction_failed');
      setErrorDetail('Файл порожній або не читається (base64 empty)');
      return;
    }
    if (!apiKey) { setErrorCategory('llm_failed'); setErrorDetail('API-ключ не налаштований'); return; }
    setLoading(true);
    setErrorCategory(null);
    setAnalysisResult(null);
    setExecutedActions([]);
    setConversationHistory([]);
    const caseNames = cases.map(c => c.case_no ? `${c.name} (${c.case_no})` : c.name).join(', ');
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
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
      const rawText = data?.content?.[0]?.text || '';
      const parsed = validateAndParseJSON(rawText);
      if (!parsed) {
        setErrorCategory('invalid_json');
        setLoading(false);
        return;
      }
      if (parsed.processing_status === 'failed') setErrorCategory('invalid_json');
      else if (typeof parsed.confidence === 'number' && parsed.confidence < 0.5) setErrorCategory('low_confidence');
      setAnalysisResult(parsed);
      setConversationHistory([
        { role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
          { type: 'text', text: `Existing cases in registry: ${caseNames}\nFile: ${fileName}` },
        ]},
        { role: 'assistant', content: rawText },
      ]);
    } catch(err) {
      setErrorCategory('llm_failed');
      setErrorDetail(err.message || 'Мережева помилка');
    }
    setLoading(false);
  };

  const onDragOver  = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const onDrop      = (e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); };

  // ── Direct note save (bypasses pipeline) ──────────────────────────────────
  const saveAsNote = () => {
    if (!text.trim()) return;
    saveNoteToStorage(text, null);
    alert('Нотатку збережено');
    onClose();
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
        return [...prev, { id: Date.now(), name: caseName, client: data.client||'', category: data.category||'civil', status:'active', court: data.court||'', case_no: data.case_no||'', hearing_date: data.hearing_date||'', hearing_time: data.hearing_time||'', deadline: data.deadline||'', deadline_type: data.deadline_type||'', next_action: data.next_action||'', notes: data.notes ? [{id:Date.now(), text:data.notes, category:'case', source:'form', ts:new Date().toISOString()}] : [] }];
      });
      alert(`Дані внесено: ${caseName}`);
      onClose();
      setLoading(false);
      return;
    }

    const caseNames = cases.map(c => c.case_no ? `${c.name} (${c.case_no})` : c.name).join(', ');
    const userContent = `Existing cases in registry: ${caseNames}\n\n---\n\n${text}`;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
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

  // ── Action execution ───────────────────────────────────────────────────────
  const executeAction = (action, overrideData) => {
    const markDone = () => setExecutedActions(prev => [...prev, action]);
    // Build effective result from analysisResult and/or overrideData (chat ACTION_JSON)
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
      saveNoteToStorage(
        text || '',
        null,
        matched?.id || null,
        matched?.name || caseName || null,
        'chat',
        matched ? 'case' : 'general'
      );
      markDone();
      return;
    }

    if (action === 'update_case_date') {
      const hearing_date = _analysisResult.extracted?.hearing_date;
      const hearing_time = _analysisResult.extracted?.hearing_time;
      const caseName = _analysisResult.case_match?.case_name;
      if (!hearing_date) { alert('Дату засідання не визначено'); return; }
      if (!caseName)     { alert('Справу не визначено — уточніть вручну'); return; }
      const matched = findCaseForAction(caseName, cases);
      if (!matched) { alert(`Справу "${caseName}" не знайдено в реєстрі`); return; }
      setCases(prev => prev.map(c =>
        c.id === matched.id ? { ...c, hearing_date, ...(hearing_time ? { hearing_time } : {}) } : c
      ));
      markDone();
      return;
    }

    if (action === 'update_deadline') {
      const deadline_date = _analysisResult.extracted?.deadline_date;
      const deadline_type = _analysisResult.extracted?.deadline_type;
      const caseName = _analysisResult.case_match?.case_name;
      if (!deadline_date) { alert('Дату дедлайну не визначено'); return; }
      if (!caseName) { alert('Справу не визначено — уточніть вручну'); return; }
      const matched = findCaseForAction(caseName, cases);
      if (!matched) { alert(`Справу "${caseName}" не знайдено в реєстрі`); return; }
      setCases(prev => prev.map(c =>
        c.id === matched.id
          ? { ...c, deadline: deadline_date, ...(deadline_type ? { deadline_type } : {}) }
          : c
      ));
      markDone();
      return;
    }

    if (action === 'update_case_status') {
      const caseName = _analysisResult.case_match?.case_name;
      if (!caseName) { alert('Справу не визначено'); return; }
      const matched = findCaseForAction(caseName, cases);
      if (!matched) { alert(`Справу "${caseName}" не знайдено`); return; }
      setPendingStatusChange({ caseId: matched.id, caseName: matched.name });
      return;
    }

    if (action === 'create_case') {
      const ext = _analysisResult.extracted || {};
      const caseMatch = _analysisResult.case_match || {};

      // Визначити назву справи
      const rawPerson = ext.person || caseMatch.case_name || '';

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

      const caseName = extractShortName(rawPerson) || 'Нова справа';

      // Визначити категорію
      // Кримінальна якщо є обвинувачений або КПК
      const isCriminal = (ext.person && /обвинувач|підозрюван|захисник/i.test(JSON.stringify(ext)))
        || /кпк|кримінал|122 кк|ст\.\s*\d+\s*кк/i.test(JSON.stringify(_analysisResult));
      const category = isCriminal ? 'criminal' : 'civil';

      // Побудувати новий об'єкт справи
      const newCase = {
        id: Date.now(),
        name: caseName,
        client: ext.person || '',
        category,
        status: 'active',
        court: ext.court || '',
        case_no: ext.case_number || '',
        hearing_date: ext.hearing_date || '',
        hearing_time: ext.hearing_time || '',
        deadline: '',
        deadline_type: '',
        next_action: '',
        notes: [],
      };

      // Показати підтвердження з даними
      const preview = [
        `Назва: ${newCase.name}`,
        newCase.client    && `Клієнт: ${newCase.client}`,
        newCase.court     && `Суд: ${newCase.court}`,
        newCase.case_no   && `Номер: ${newCase.case_no}`,
        newCase.hearing_date && `Засідання: ${newCase.hearing_date}${newCase.hearing_time ? ' о ' + newCase.hearing_time : ''}`,
        `Категорія: ${category === 'criminal' ? 'Кримінальна' : 'Цивільна'}`,
      ].filter(Boolean).join('\n');

      setCases(prev => [...prev, newCase]);
      markDone();
      setConversationHistory(prev => [...prev, {
        role: 'assistant',
        content: `✅ Справу "${newCase.name}" створено. Знайдіть її в реєстрі і доповніть деталі.`
      }]);
      return;
    }

    if (action === 'save_to_drive' || action === 'create_drive_folder') {
      if (!driveConnected) return; // button should be disabled, but guard anyway
      alert('Функція збереження в Drive ще не реалізована в Quick Input.');
      markDone();
      return;
    }

    alert(`Дія "${QI_ACTION_LABELS[action] || action}" ще не реалізована в цій версії`);
    markDone();
  };

  // ── Voice input (Web Speech API) — continuous mode ──────────────────────────
  function startVoiceInput(targetSetter, targetKey) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert('Мікрофон не підтримується в цьому браузері');
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
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          system: SONNET_CHAT_PROMPT,
          messages: newHistory,
          max_tokens: 1024,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setConversationHistory(prev => [...prev, { role: 'assistant', content: `Помилка: ${err?.error?.message || res.status}` }]);
      } else {
        const data = await res.json();
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
          if (action === 'create_case') {
            const ext = actionResult.extracted || {};
            const rawPerson = ext.person || actionResult.case_match?.case_name || '';

            function extractShortName(fullName) {
              if (!fullName) return '';
              const clean = fullName.replace(/\(.*?\)/g, '').replace(/,.*$/, '').trim();
              const withoutLev = clean.replace(/левицьк\S+\s+\S+\s+\S+\s*/gi, '').trim();
              const parts = withoutLev.split(/\s+/);
              if (parts.length >= 2) {
                return parts[0] + ' ' + parts.slice(1).map(p => p[0] ? p[0].toUpperCase() + '.' : '').join('');
              }
              return withoutLev || fullName;
            }

            const caseName = extractShortName(rawPerson) || 'Нова справа';
            const isCriminal = /кпк|кримінал|\d+\s*кк|обвинувач|підозрюван/i.test(JSON.stringify(actionResult));

            const newCase = {
              id: Date.now(),
              name: caseName,
              client: rawPerson.replace(/\(.*?\)/g, '').replace(/,.*$/, '').trim(),
              category: isCriminal ? 'criminal' : 'civil',
              status: 'active',
              court: ext.court || '',
              case_no: ext.case_number || '',
              hearing_date: ext.hearing_date || '',
              hearing_time: ext.hearing_time || '',
              deadline: '', deadline_type: '', next_action: '', notes: [],
            };

            setCases(prev => [...prev, newCase]);
            setConversationHistory(prev => [...prev, {
              role: 'assistant',
              content: `✅ Справу "${newCase.name}" створено${newCase.court ? ' (' + newCase.court + ')' : ''}. Знайдіть її в реєстрі і доповніть деталі.`
            }]);
            setChatLoading(false);
            return;
          }
          if (action === 'update_case_date') {
            const hearing_date = actionResult.extracted?.hearing_date;
            const hearing_time = actionResult.extracted?.hearing_time;
            const caseName = actionResult.case_match?.case_name;
            const matched = caseName ? findCaseForAction(caseName, cases) : null;
            if (matched && hearing_date) {
              setCases(prev => prev.map(c =>
                c.id === matched.id
                  ? { ...c, hearing_date, ...(hearing_time ? { hearing_time } : {}) }
                  : c
              ));
              const timeStr = hearing_time ? ` о ${hearing_time}` : '';
              setConversationHistory(prev => [...prev, {
                role: 'assistant',
                content: `✅ Додано засідання у справі "${matched.name}" на ${hearing_date}${timeStr}`
              }]);
              setChatLoading(false);
              return;
            }
          }
          if (action === 'update_deadline') {
            const deadline_date = actionResult.extracted?.deadline_date;
            const deadline_type = actionResult.extracted?.deadline_type;
            const caseName = actionResult.case_match?.case_name;
            const matched = caseName ? findCaseForAction(caseName, cases) : null;
            if (matched && deadline_date) {
              setCases(prev => prev.map(c =>
                c.id === matched.id
                  ? { ...c, deadline: deadline_date, ...(deadline_type ? { deadline_type } : {}) }
                  : c
              ));
              const typeStr = deadline_type ? ` (${deadline_type})` : '';
              setConversationHistory(prev => [...prev, {
                role: 'assistant',
                content: `✅ Дедлайн у справі "${matched.name}" встановлено: ${deadline_date}${typeStr}`
              }]);
              setChatLoading(false);
              return;
            }
          }
          if (action === 'update_case_field' || action === 'update_case_status') {
            const caseName = actionResult.case_match?.case_name
              || actionResult.extracted?.case_name;
            const matched = caseName ? findCaseForAction(caseName, cases) : null;

            // Для update_case_status — field завжди 'status'
            const field = action === 'update_case_status'
              ? 'status'
              : actionResult.extracted?.field;
            const value = actionResult.extracted?.value
              || actionResult.extracted?.status; // fallback для статусу

            // Дозволені поля (не чіпаємо hearing_date і deadline — у них свої обробники)
            const allowedFields = ['status', 'category', 'court', 'case_no',
              'next_action', 'notes', 'hearing_time'];

            if (matched && field && value && allowedFields.includes(field)) {
              setCases(prev => prev.map(c =>
                c.id === matched.id ? { ...c, [field]: value } : c
              ));

              const fieldLabels = {
                status: 'Статус',
                category: 'Категорія',
                court: 'Суд',
                case_no: 'Номер справи',
                next_action: 'Наступна дія',
                notes: 'Нотатки',
                hearing_time: 'Час засідання',
              };
              const statusLabels = {
                active: 'Активна', paused: 'Призупинена', closed: 'Закрита'
              };
              const displayValue = field === 'status'
                ? (statusLabels[value] || value)
                : value;

              setConversationHistory(prev => [...prev, {
                role: 'assistant',
                content: `✅ ${fieldLabels[field] || field} справи "${matched.name}" змінено на "${displayValue}"`
              }]);
              setChatLoading(false);
              return;
            }

            // Якщо не знайшли справу або поле — fallback на текстову відповідь
          }
          if (action === 'delete_case') {
            const caseName = actionResult.case_match?.case_name
              || actionResult.extracted?.case_name;
            const matched = caseName ? findCaseForAction(caseName, cases) : null;

            if (matched) {
              if (matched.status === 'closed') {
                // Вже закрита — пропонуємо видалити назавжди
                if (!window.confirm(`Справа "${matched.name}" вже закрита. Видалити назавжди? Цю дію не можна скасувати.`)) {
                  setConversationHistory(prev => [...prev, {
                    role: 'assistant',
                    content: `Видалення справи "${matched.name}" скасовано.`
                  }]);
                  setChatLoading(false);
                  return;
                }
                setCases(prev => prev.filter(c => c.id !== matched.id));
                setConversationHistory(prev => [...prev, {
                  role: 'assistant',
                  content: `✅ Справу "${matched.name}" видалено з реєстру назавжди.`
                }]);
              } else {
                // Спочатку закриваємо
                if (!window.confirm(`Закрити справу "${matched.name}"? Вона перейде в архів.`)) {
                  setConversationHistory(prev => [...prev, {
                    role: 'assistant',
                    content: `Закриття справи "${matched.name}" скасовано.`
                  }]);
                  setChatLoading(false);
                  return;
                }
                setCases(prev => prev.map(c =>
                  c.id === matched.id ? { ...c, status: 'closed' } : c
                ));
                setConversationHistory(prev => [...prev, {
                  role: 'assistant',
                  content: `✅ Справу "${matched.name}" закрито. Вона тепер у вкладці "Закриті". Звідти можна видалити назавжди.`
                }]);
              }
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
          <button
            className="btn-sm btn-ghost"
            onClick={saveAsNote}
            disabled={!text.trim()}
            title="Зберегти без AI-аналізу"
          >
            📝 Нотатка
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
                <button className="btn-sm btn-primary" onClick={saveAsNote} disabled={!text.trim()}>📝 Зберегти як нотатку</button>
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
                          : <button key={action} className="btn-sm btn-primary" onClick={() => executeAction(action)}>
                              {QI_ACTION_LABELS[action] || action}
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
                              setCases(prev => prev.map(c => c.id === pendingStatusChange.caseId ? { ...c, status: val } : c));
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
                  { maxWidth: '85%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', fontSize: 13, lineHeight: 1.5 },
                  msg.role === 'user'
                    ? { background: 'rgba(79,124,255,0.1)', border: '1px solid rgba(79,124,255,0.2)' }
                    : { background: 'var(--surface2)', border: '1px solid var(--border)' }
                )}>
                  {msg.content}
                  {msg.actionResult && (msg.actionResult.recommended_actions || []).length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {msg.actionResult.recommended_actions.map(action => (
                        <button key={action} className="btn-sm btn-primary" onClick={() => executeAction(action, msg.actionResult)} style={{ fontSize: 11 }}>
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

  const [form, setForm] = useState(initialData ? {
    name: initialData.name || '',
    client: initialData.client || '',
    category: initialData.category || 'civil',
    status: initialData.status || 'active',
    court: initialData.court || '',
    case_no: initialData.case_no || '',
    hearing_date: initialData.hearing_date || '',
    hearing_time: initialData.hearing_time || '',
    deadline: initialData.deadline || '',
    deadline_type: initialData.deadline_type || '',
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
          const payload = initialData
            ? { ...form, id: initialData.id, notes: mergedNotes }
            : { ...form, notes: mergedNotes };
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
const GOOGLE_CLIENT_ID = '73468500916-sn02gdk7qvp40q04hdjj44g5pir48btb.apps.googleusercontent.com'; // Replace with your Google Cloud Console Client ID
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
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
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='${DRIVE_FILE_NAME}'+and+trashed=false&fields=files(id)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if (data.files && data.files.length > 0) { this._fileId = data.files[0].id; }
    return this._fileId || null;
  },

  async readCases(token) {
    const id = await this._findFileId(token);
    if (!id) return null;
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    return await res.json();
  },

  async writeCases(token, cases) {
    const body = JSON.stringify(cases);
    const id = await this._findFileId(token);
    if (id) {
      await fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body
      });
    } else {
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify({ name: DRIVE_FILE_NAME, mimeType: 'application/json' })], { type: 'application/json' }));
      form.append('file', new Blob([body], { type: 'application/json' }));
      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      const created = await res.json();
      this._fileId = created.id;
    }
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
    if (!val) { alert('Введіть API ключ'); return; }
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
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (!Array.isArray(parsed)) { alert('Невірний формат файлу. Очікується масив справ.'); return; }
        if (!confirm(`Буде завантажено ${parsed.length} справ. Поточні дані будуть замінені. Продовжити?`)) return;
        const normalized = normalizeCases(parsed);
        setCases(normalized);
        localStorage.setItem('levytskyi_cases', JSON.stringify(normalized));
        alert(`Імпортовано ${parsed.length} справ.`);
      } catch(err) { alert('Помилка читання файлу: ' + err.message); }
    };
    reader.readAsText(file);
  };

  const connectDrive = async () => {
    try {
      const token = await driveService.authorize();
      setDriveConnected(true);
      alert('Google Drive підключено успішно!');
      // Try to load cases from Drive right away
      const driveCases = await driveService.readCases(token);
      if (driveCases && Array.isArray(driveCases)) {
        if (confirm(`На Google Drive знайдено ${driveCases.length} справ. Завантажити і замінити поточні?`)) {
          setCases(normalizeCases(driveCases));
        }
      }
    } catch(err) { alert('Помилка підключення: ' + err.message); }
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

// Нормалізує cases[].notes → завжди масив нотаток
// (підтримує стару версію де notes був рядком)
function normalizeCases(cases) {
  if (!Array.isArray(cases)) return [];
  return cases.map(c => {
    if (Array.isArray(c.notes)) return c;
    if (typeof c.notes === 'string' && c.notes.trim()) {
      return {
        ...c,
        notes: [{
          id: Date.now() + Math.random(),
          text: c.notes,
          category: 'case',
          source: 'form',
          ts: new Date().toISOString(),
        }],
      };
    }
    return { ...c, notes: [] };
  });
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
function App() {
  const [tab, setTab] = useState('dashboard');
  const [cases, setCases] = useState(() => {
    try {
      const saved = localStorage.getItem('levytskyi_cases');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return normalizeCases(parsed);
      }
    } catch(e) {}
    return normalizeCases(INITIAL_CASES);
  });
  const [calendarEvents, setCalendarEvents] = useState(() => {
    try {
      const saved = localStorage.getItem('levytskyi_calendar_events');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch(e) {}
    return [];
  });
  const [notes, setNotes] = useState(() => {
    try {
      const saved = localStorage.getItem('levytskyi_notes');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch(e) {}
    return [];
  });
  const [lastSaved, setLastSaved] = useState(null);
  const [driveConnected, setDriveConnected] = useState(() => driveService.isConnected());
  const [driveSyncStatus, setDriveSyncStatus] = useState('idle');
  const [selected, setSelected] = useState(null);
  const openCase = (c) => { usageLog.log('open_case', {name: c.name}); setSelected(c); };
  const [dossierCase, setDossierCase] = useState(null);
  const [ideas, setIdeas] = useState([]);
  const [showQI, setShowQI] = useState(false);
  const [qiBtnPos, setQiBtnPos] = useState({ x: null, y: null });
  const qiDragRef = useRef(false);
  const qiDragMoved = useRef(false);
  const qiStartRef = useRef({ x: 0, y: 0, btnX: 0, btnY: 0 });
  const [showAdd, setShowAdd] = useState(false);
  const [editingCase, setEditingCase] = useState(null);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [filterStatus, setFilterStatus] = useState('active');

  // ── Split panel ────────────────────────────────────────────────────────────
  const [isLandscape, setIsLandscape] = useState(() => window.matchMedia('(orientation: landscape)').matches);
  const [qiRatio, setQiRatio] = useState(null); // null = default
  const isDragging = useRef(false);
  const containerRef = useRef(null);
  const isLandscapeRef = useRef(isLandscape);
  const ratio = qiRatio !== null ? qiRatio : (isLandscape ? 0.33 : 0.60);

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

  // Load from Drive on mount if connected
  useEffect(() => {
    if (!driveConnected) return;
    const token = driveService.getToken();
    if (!token) return;
    driveService.readCases(token).then(driveCases => {
      if (driveCases && Array.isArray(driveCases) && driveCases.length > 0) {
        setCases(normalizeCases(driveCases));
      }
    }).catch(() => {});
  }, []); // eslint-disable-line

  // Auto-save to localStorage (always) and Drive (if connected)
  useEffect(() => {
    try {
      localStorage.setItem('levytskyi_cases', JSON.stringify(cases));
      setLastSaved(new Date().toLocaleTimeString('uk-UA', {hour:'2-digit', minute:'2-digit'}));
    } catch(e) {}
    if (driveConnected) {
      const token = driveService.getToken();
      if (token) {
        setDriveSyncStatus('syncing');
        driveService.writeCases(token, cases)
          .then(() => setDriveSyncStatus('synced'))
          .catch(() => setDriveSyncStatus('error'));
      }
    }
  }, [cases]);

  // ── Split panel effects ────────────────────────────────────────────────────
  useEffect(() => { isLandscapeRef.current = isLandscape; }, [isLandscape]);

  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const handler = (e) => { setIsLandscape(e.matches); setQiRatio(null); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const onMove = (clientX, clientY) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const r = isLandscapeRef.current
        ? (rect.right - clientX) / rect.width
        : (rect.bottom - clientY) / rect.height;
      setQiRatio(Math.min(0.75, Math.max(0.25, r)));
    };
    const onMouseMove = (e) => onMove(e.clientX, e.clientY);
    const onMouseUp   = () => { isDragging.current = false; };
    const onTouchMove = (e) => { if (!isDragging.current) return; e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); };
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
    .filter(c => c.status==='active' && (c.deadline || c.hearing_date))
    .map(c => ({
      ...c,
      minDays: Math.min(
        c.deadline ? (daysUntil(c.deadline) ?? 999) : 999,
        c.hearing_date ? (daysUntil(c.hearing_date) ?? 999) : 999
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
    hot: cases.filter(c=>c.deadline && daysUntil(c.deadline)!==null && daysUntil(c.deadline)<=3).length,
    thisWeek: cases.filter(c=>c.hearing_date && daysUntil(c.hearing_date)!==null && daysUntil(c.hearing_date)>=0 && daysUntil(c.hearing_date)<=7).length,
    noDeadline: cases.filter(c=>c.status==='active'&&!c.deadline&&!c.hearing_date).length,
  }), [cases]);

  const addCase = (form) => {
    usageLog.log('case_added', {name: form.name});
    const newCase = { ...form, id: Date.now() };
    setCases(prev => [...prev, newCase]);
    setShowAdd(false);
    setTab('cases');
  };

  const saveCaseEdit = (form) => {
    setCases(prev => prev.map(c => c.id === form.id ? { ...form } : c));
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

  // ── notes CRUD ─────────────────────────────────────────────────────────────
  const addNote = (note) => {
    const newNote = {
      id: Date.now().toString(),
      text: note.text || '',
      category: note.category || 'general',
      caseId: note.caseId || null,
      caseName: note.caseName || null,
      source: note.source || 'manual',
      pinned: note.pinned || false,
      result: note.result || null,
      ts: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    setNotes(prev => {
      const updated = [...prev, newNote];
      try { localStorage.setItem('levytskyi_notes', JSON.stringify(updated)); } catch(e) {}
      return updated;
    });
    return newNote;
  };

  const deleteNote = (noteId) => {
    setNotes(prev => {
      const updated = prev.filter(n => n.id !== noteId);
      try { localStorage.setItem('levytskyi_notes', JSON.stringify(updated)); } catch(e) {}
      return updated;
    });
  };

  const updateNote = (noteId, changes) => {
    setNotes(prev => {
      const updated = prev.map(n => n.id === noteId ? { ...n, ...changes } : n);
      try { localStorage.setItem('levytskyi_notes', JSON.stringify(updated)); } catch(e) {}
      return updated;
    });
  };

  const pinNote = (noteId) => {
    setNotes(prev => {
      const target = prev.find(n => String(n.id) === String(noteId));
      const updated = prev.map(n => {
        if (n.caseId === target?.caseId && n.caseName === target?.caseName) {
          return { ...n, pinned: String(n.id) === String(noteId) ? !n.pinned : false };
        }
        return n;
      });
      try { localStorage.setItem('levytskyi_notes', JSON.stringify(updated)); } catch(e) {}
      return updated;
    });
  };

  const handleEdit = (c) => {
    setSelected(null);
    setEditingCase(c);
    setTab('add');
  };

  const closeCase = (id) => {
    setCases(prev => prev.map(c =>
      c.id === id ? { ...c, status: 'closed' } : c
    ));
    setSelected(null);
  };

  const restoreCase = (id) => {
    setCases(prev => prev.map(c =>
      c.id === id ? { ...c, status: 'active' } : c
    ));
    setSelected(null);
  };

  const deleteDriveFolder = async (folderId) => {
    const token = localStorage.getItem("levytskyi_drive_token");
    if (!token || !folderId) return;
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${folderId}`,
      { method: "DELETE", headers: { "Authorization": `Bearer ${token}` } }
    );
    if (!response.ok && response.status !== 204) {
      throw new Error(`Drive API error: ${response.status}`);
    }
  };

  const deleteCasePermanently = async (caseItem) => {
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
      alert(`Справу "${caseItem.name}" видалено.`);
    } catch (err) {
      console.error("Помилка видалення:", err);
      alert("Помилка при видаленні. Спробуйте ще раз.");
    }
  };

  const handleDeleteCase = (caseItem) => {
    const first = window.confirm(
      `Видалити справу "${caseItem.name}"?\n\nСправа буде видалена з реєстру.`
    );
    if (!first) return;
    const second = window.confirm(
      "УВАГА! Незворотна операція!\n\n" +
      `Буде видалено справу "${caseItem.name}" з реєстру\n` +
      "та папку справи на Google Drive з усіма файлами.\n\n" +
      "Це неможливо скасувати. Продовжити?"
    );
    if (!second) return;
    deleteCasePermanently(caseItem);
  };

  return (
    <div className="app">
      {/* TOPBAR */}
      <div className="topbar">
        <div className="topbar-logo">АБ <span>Левицького</span></div>
        <div className="topbar-right" style={{display:'flex',gap:8,alignItems:'center'}}>
          {lastSaved && <span style={{fontSize:10,color:'var(--text3)',letterSpacing:'0.04em'}}>збережено {lastSaved}</span>}
          <button className="btn-sm btn-ghost" onClick={() => setShowQI(true)} style={{fontSize:12}}>
            ⚡ Quick Input
          </button>
          <button className="btn-sm btn-ghost" onClick={() => {
            if(confirm('Скинути всі дані і повернути тестові справи?')) {
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
          <button key={t.id} className={`nav-tab${tab===t.id?' active':''}`} onClick={() => { if (t.id !== 'add') setEditingCase(null); setTab(t.id); }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* MAIN — split or full depending on showQI */}
      {showQI ? (
        <div
          ref={containerRef}
          style={{ flex: 1, display: 'flex', flexDirection: isLandscape ? 'row' : 'column', overflow: 'hidden', minHeight: 0, position: 'relative', zIndex: 1000 }}
        >
          {/* Main content panel */}
          <div className="main" style={{ flex: 1 - ratio, overflow: 'auto', minWidth: 0, minHeight: 0 }}>
            {/* ── DASHBOARD ── */}
            {tab === 'dashboard' && (
              <Dashboard
                cases={cases}
                calendarEvents={calendarEvents}
                onUpdateCase={updateCase}
                onAddEvent={addCalendarEvent}
                onUpdateEvent={updateCalendarEvent}
                onDeleteEvent={deleteCalendarEvent}
                sonnetPrompt={SONNET_CHAT_PROMPT}
                buildSystemContext={buildSystemContext}
              />
            )}
            {tab === 'cases' && (
              <div>
                <div className="status-counter">
                  <span>Активні: <strong style={{color:'var(--green)'}}>{cases.filter(c=>c.status==='active').length}</strong></span>
                  <span className="status-counter-sep">|</span>
                  <span>Призупинені: <strong style={{color:'var(--text2)'}}>{cases.filter(c=>c.status==='paused').length}</strong></span>
                  <span className="status-counter-sep">|</span>
                  <span>Закриті: <strong style={{color:'var(--text3)'}}>{cases.filter(c=>c.status==='closed').length}</strong></span>
                </div>
                <div className="cases-toolbar">
                  <div className="search-box"><span style={{color:'var(--text3)'}}>🔍</span><input placeholder="Пошук..." value={search} onChange={e=>setSearch(e.target.value)} /></div>
                  {['all','civil','criminal','military','admin'].map(cat => (
                    <button key={cat} className={`filter-btn${filterCat===cat?' active':''}`} onClick={()=>setFilterCat(cat)}>{cat==='all'?'Всі':CAT_LABELS[cat]}</button>
                  ))}
                </div>
                <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>
                  {[{val:'active',label:`Активні (${cases.filter(c=>c.status==='active').length})`},{val:'paused',label:`Призупинені (${cases.filter(c=>c.status==='paused').length})`},{val:'closed',label:`Закриті (${cases.filter(c=>c.status==='closed').length})`},{val:'all',label:`Всі (${cases.length})`}].map(({val,label}) => (
                    <button key={val} className={`filter-btn${filterStatus===val?' active':''}`} onClick={()=>setFilterStatus(val)}>{label}</button>
                  ))}
                </div>
                <div style={{fontSize:12,color:'var(--text2)',marginBottom:12}}>{filteredCases.length} справ</div>
                {filteredCases.length === 0 && <div className="empty"><div className="empty-icon">🔍</div><div className="empty-text">Нічого не знайдено</div></div>}
                <div className="cases-grid">{filteredCases.map(c => (
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
                ))}</div>
              </div>
            )}
            {tab === 'add' && <AddCaseForm onSave={editingCase ? saveCaseEdit : addCase} onCancel={() => { setEditingCase(null); setTab('cases'); }} initialData={editingCase} />}
            {tab === 'notebook' && (
              <ModuleErrorBoundary>
                <React.Suspense fallback={<div style={{padding:20,color:'#9aa0b8'}}>Завантаження...</div>}>
                  <Notebook cases={cases} onUpdateCase={updateCase} notes={notes} onAddNote={addNote} onUpdateNote={updateNote} onDeleteNote={deleteNote} onPinNote={pinNote} />
                </React.Suspense>
              </ModuleErrorBoundary>
            )}
            {tab === 'analysis' && <AnalysisPanel cases={cases} setCases={setCases} driveConnected={driveConnected} setDriveConnected={setDriveConnected} driveSyncStatus={driveSyncStatus} />}
          </div>

          {/* Resizer */}
          <div
            className={`split-resizer ${isLandscape ? 'split-resizer-vertical' : 'split-resizer-horizontal'}`}
            style={{ width: isLandscape ? 7 : '100%', height: isLandscape ? '100%' : 7, cursor: isLandscape ? 'col-resize' : 'row-resize' }}
            onMouseDown={() => { isDragging.current = true; }}
            onTouchStart={() => { isDragging.current = true; }}
          />

          {/* Quick Input panel */}
          <div style={{ flex: ratio, overflow: 'hidden', alignSelf: 'stretch', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, animation: 'splitPanelIn 0.2s ease' }}>
            <QuickInput cases={cases} setCases={setCases} onClose={() => setShowQI(false)} driveConnected={driveConnected} />
          </div>
        </div>
      ) : (
        <div className="main">

          {/* ── DASHBOARD ── */}
          {tab === 'dashboard' && (
            <Dashboard
              cases={cases}
              calendarEvents={calendarEvents}
              onUpdateCase={updateCase}
              onAddEvent={addCalendarEvent}
              onUpdateEvent={updateCalendarEvent}
              onDeleteEvent={deleteCalendarEvent}
              sonnetPrompt={SONNET_CHAT_PROMPT}
              buildSystemContext={buildSystemContext}
            />
          )}

          {/* ── CASES ── */}
          {tab === 'cases' && (
            <div>
              <div className="status-counter">
                <span>Активні: <strong style={{color:'var(--green)'}}>{cases.filter(c=>c.status==='active').length}</strong></span>
                <span className="status-counter-sep">|</span>
                <span>Призупинені: <strong style={{color:'var(--text2)'}}>{cases.filter(c=>c.status==='paused').length}</strong></span>
                <span className="status-counter-sep">|</span>
                <span>Закриті: <strong style={{color:'var(--text3)'}}>{cases.filter(c=>c.status==='closed').length}</strong></span>
              </div>
              <div className="cases-toolbar">
                <div className="search-box">
                  <span style={{color:'var(--text3)'}}>🔍</span>
                  <input placeholder="Пошук за назвою, клієнтом, судом..." value={search} onChange={e=>setSearch(e.target.value)} />
                </div>
                {['all','civil','criminal','military','admin'].map(cat => (
                  <button key={cat} className={`filter-btn${filterCat===cat?' active':''}`} onClick={()=>setFilterCat(cat)}>
                    {cat==='all'?'Всі':CAT_LABELS[cat]}
                  </button>
                ))}
              </div>
              <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>
                {[
                  {val:'active', label:`Активні (${cases.filter(c=>c.status==='active').length})`},
                  {val:'paused', label:`Призупинені (${cases.filter(c=>c.status==='paused').length})`},
                  {val:'closed', label:`Закриті (${cases.filter(c=>c.status==='closed').length})`},
                  {val:'all',    label:`Всі (${cases.length})`},
                ].map(({val,label}) => (
                  <button key={val} className={`filter-btn${filterStatus===val?' active':''}`} onClick={()=>setFilterStatus(val)}>
                    {label}
                  </button>
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

          {/* ── ADD CASE ── */}
          {tab === 'add' && (
            <AddCaseForm
              onSave={editingCase ? saveCaseEdit : addCase}
              onCancel={() => { setEditingCase(null); setTab('cases'); }}
              initialData={editingCase}
            />
          )}

          {/* ── NOTEBOOK ── */}
          {tab === 'notebook' && (
            <ModuleErrorBoundary>
              <React.Suspense fallback={<div style={{padding:20,color:'#9aa0b8'}}>Завантаження...</div>}>
                <Notebook cases={cases} onUpdateCase={updateCase} notes={notes} onAddNote={addNote} onUpdateNote={updateNote} onDeleteNote={deleteNote} onPinNote={pinNote} />
              </React.Suspense>
            </ModuleErrorBoundary>
          )}

          {/* ── ANALYSIS ── */}
          {tab === 'analysis' && (
            <AnalysisPanel cases={cases} setCases={setCases} driveConnected={driveConnected} setDriveConnected={setDriveConnected} driveSyncStatus={driveSyncStatus} />
          )}

        </div>
      )}

      {/* MODALS */}
      {selected && <CaseModal c={selected} onClose={() => setSelected(null)} onEdit={handleEdit} onDelete={handleDeleteCase} onCloseCase={closeCase} onRestore={restoreCase} />}

      {/* DOSSIER */}
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
            notes={notes.filter(n => n.caseId === dossierCase.id || n.caseName === dossierCase.name)}
            onAddNote={addNote}
            onUpdateNote={updateNote}
            onDeleteNote={deleteNote}
            onPinNote={pinNote}
          />
        </ErrorBoundary>
      )}

      {/* FAB — hidden when QI panel is open, draggable */}
      {!showQI && <button
        className="fab"
        title="Quick Input"
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
          setShowQI(true);
        }}
      >⚡</button>}
    </div>
  );
}


export default App;
