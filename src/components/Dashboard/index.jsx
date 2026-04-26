import React, { useState, useEffect, useRef } from "react";
import { systemConfirm } from "../SystemModal";

const MONTHS_UK = [
  "Січень","Лютий","Березень","Квітень","Травень","Червень",
  "Липень","Серпень","Вересень","Жовтень","Листопад","Грудень"
];
const WDAYS = ["Пн","Вт","Ср","Чт","Пт","Сб","Нд"];
const SLOTS = [
  '08:00','08:30','09:00','09:30','10:00','10:30',
  '11:00','11:30','12:00','12:30','13:00','13:30',
  '14:00','14:30','15:00','15:30','16:00','16:30',
  '17:00','17:30','18:00','18:30','19:00'
];
const SLOT_H = 28;
const SLOT_MIN = 30;

function parseTimeMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
const SLOTS_START_MIN = parseTimeMin(SLOTS[0]);
const SLOTS_END_MIN = parseTimeMin(SLOTS[SLOTS.length - 1]) + SLOT_MIN;

function addMinutesToTime(t, min) {
  const total = parseTimeMin(t) + min;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function SlotsColumn({ day, events, slotDrag, conflicts, style, onEmptyClick }) {
  const evsInRange = events.filter(e => {
    if (!e.time) return false;
    const t = parseTimeMin(e.time);
    return t >= SLOTS_START_MIN && t < SLOTS_END_MIN;
  });

  const conflictIds = new Set((conflicts || []).map(c => c.id));

  const [pressedSlot, setPressedSlot] = useState(null);
  const pressTimerRef = useRef(null);
  const halfPressTimerRef = useRef(null);

  function colorsFor(type, isConflict) {
    if (isConflict) return { border: "#e74c3c", bg: "rgba(231,76,60,.2)" };
    if (type === "hearing") return { border: "#4f7cff", bg: "rgba(79,124,255,.2)" };
    if (type === "deadline") return { border: "#f39c12", bg: "rgba(243,156,18,.2)" };
    if (type === "travel") return { border: "#5a6080", bg: "rgba(90,96,128,.25)" };
    return { border: "#4f7cff", bg: "rgba(79,124,255,.15)" };
  }

  const isDraggingHere = slotDrag.isDragging && slotDrag.dragContext === day;

  function clearTimers() {
    if (halfPressTimerRef.current) { clearTimeout(halfPressTimerRef.current); halfPressTimerRef.current = null; }
    if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
    setPressedSlot(null);
  }

  function handleTouchStart(slotIdx) {
    halfPressTimerRef.current = setTimeout(() => setPressedSlot(slotIdx), 200);
    pressTimerRef.current = setTimeout(() => {
      slotDrag.startDrag(slotIdx, day);
      setPressedSlot(null);
      if (navigator.vibrate) { try { navigator.vibrate(50); } catch {} }
    }, 400);
  }

  function handleTouchMove(e) {
    if (!slotDrag.isDragging) {
      clearTimers();
      return;
    }
    e.preventDefault();
    slotDrag.handleTouchMove(e);
  }

  function handleTouchEnd() {
    clearTimers();
    if (slotDrag.isDragging) slotDrag.endDrag();
  }

  function handleMouseDown(e, slotIdx) {
    const startY = e.clientY;
    let active = false;
    slotDrag.startDrag(slotIdx, day);
    active = true;
    function onMove(ev) {
      if (!active) return;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const slotEl = el?.closest('[data-slot-idx]');
      if (slotEl) {
        const idx = parseInt(slotEl.dataset.slotIdx, 10);
        const ctx = slotEl.dataset.ctx || null;
        slotDrag.updateDrag(idx, ctx);
      }
      void startY;
    }
    function onUp() {
      active = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (slotDrag.isDraggingNow()) slotDrag.endDrag();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", ...style }}>
      {SLOTS.map((slotTime, idx) => {
        const inDrag = isDraggingHere && idx >= slotDrag.rangeMin && idx <= slotDrag.rangeMax;
        const isPressed = pressedSlot === idx && !inDrag;
        const isHalfHour = slotTime.endsWith(':30');
        return (
          <div
            key={slotTime}
            data-slot-idx={idx}
            data-slot={slotTime}
            data-ctx={day}
            onMouseDown={(e) => handleMouseDown(e, idx)}
            onTouchStart={() => handleTouchStart(idx)}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
            onClick={onEmptyClick}
            style={{
              height: SLOT_H,
              borderTop: isHalfHour ? "1px dotted rgba(46,49,72,.5)" : "1px dashed var(--border, #2e3148)",
              borderLeft: "1px dashed var(--border, #2e3148)",
              borderRight: "1px dashed var(--border, #2e3148)",
              borderBottom: idx === SLOTS.length - 1 ? "1px dashed var(--border, #2e3148)" : "none",
              background: inDrag ? "rgba(79,124,255,0.25)" : (isPressed ? "rgba(79,124,255,0.1)" : "transparent"),
              cursor: "pointer",
              boxSizing: "border-box"
            }}
          />
        );
      })}
      {evsInRange.map(ev => {
        const t = parseTimeMin(ev.time);
        const dur = ev.duration || 60;
        const top = ((t - SLOTS_START_MIN) / SLOT_MIN) * SLOT_H;
        const height = Math.max(SLOT_H - 2, (dur / SLOT_MIN) * SLOT_H - 1);
        const c = colorsFor(ev.type, conflictIds.has(ev.id));
        const endTime = ev.endTime || addMinutesToTime(ev.time, dur);
        return (
          <div
            key={ev.id}
            style={{
              position: "absolute",
              left: 2, right: 2,
              top, height,
              borderRadius: 5,
              border: `1px solid ${c.border}`,
              background: c.bg,
              padding: "2px 5px",
              fontSize: 10,
              overflow: "hidden",
              pointerEvents: "none",
              color: "var(--text, #e6e8f0)",
              zIndex: 1
            }}
          >
            <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {ev.title}
            </div>
            <div style={{ fontSize: 9, color: "var(--text3, #5a6080)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {ev.time}—{endTime}
              {ev.court ? " · " + ev.court : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function useSlotDrag(onSelect) {
  const [dragStart, setDragStart] = useState(null);
  const [dragEnd, setDragEnd] = useState(null);
  const [dragContext, setDragContext] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const stateRef = useRef({ start: null, end: null, ctx: null });

  function startDrag(hour, ctx) {
    setDragStart(hour); setDragEnd(hour); setDragContext(ctx ?? null);
    setIsDragging(true);
    isDraggingRef.current = true;
    stateRef.current = { start: hour, end: hour, ctx: ctx ?? null };
  }
  function updateDrag(hour, ctx) {
    if (!isDraggingRef.current) return;
    // if ctx provided and different from start ctx, ignore (don't drag across days)
    if (ctx !== undefined && stateRef.current.ctx !== null && ctx !== stateRef.current.ctx) return;
    setDragEnd(hour);
    stateRef.current.end = hour;
  }
  function handleTouchMove(e) {
    const touch = e.touches[0];
    if (!touch) return;
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const slotEl = el?.closest("[data-slot-idx]");
    if (!slotEl) return;
    const idx = parseInt(slotEl.dataset.slotIdx, 10);
    const c = slotEl.dataset.ctx || null;
    updateDrag(idx, c);
  }
  function isDraggingNow() { return isDraggingRef.current; }
  function endDrag() {
    const { start, end, ctx } = stateRef.current;
    if (isDraggingRef.current && start !== null && end !== null) {
      const s = Math.min(start, end);
      const e = Math.max(start, end) + 1;
      onSelect(s, e, ctx);
    }
    isDraggingRef.current = false;
    setIsDragging(false); setDragStart(null); setDragEnd(null); setDragContext(null);
    stateRef.current = { start: null, end: null, ctx: null };
  }

  useEffect(() => {
    if (!isDragging) return;
    const up = () => endDrag();
    window.addEventListener("mouseup", up);
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, [isDragging]);

  const rangeMin = dragStart !== null && dragEnd !== null ? Math.min(dragStart, dragEnd) : null;
  const rangeMax = dragStart !== null && dragEnd !== null ? Math.max(dragStart, dragEnd) : null;

  return {
    dragStart, dragEnd, dragContext, isDragging,
    rangeMin, rangeMax,
    startDrag, updateDrag, handleTouchMove, endDrag, isDraggingNow
  };
}
const MONTHS_GEN = [
  "січня","лютого","березня","квітня","травня","червня",
  "липня","серпня","вересня","жовтня","листопада","грудня"
];

function _getNextHearing(c) {
  if (!Array.isArray(c.hearings) || c.hearings.length === 0) return null;
  const todayStr = new Date().toISOString().split('T')[0];
  return c.hearings.filter(h => h.status === 'scheduled' && h.date >= todayStr).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}

function findConflicts(cases, calendarEvents) {
  const byDate = {};
  cases.forEach(c => {
    const nh = _getNextHearing(c);
    if (nh && nh.time) {
      if (!byDate[nh.date]) byDate[nh.date] = [];
      byDate[nh.date].push({ name: c.name, time: nh.time, id: c.id });
    }
  });
  (calendarEvents || []).forEach(e => {
    if (e.date && e.time && e.type === "hearing") {
      if (!byDate[e.date]) byDate[e.date] = [];
      byDate[e.date].push({ name: e.title, time: e.time });
    }
  });
  return Object.entries(byDate)
    .filter(([, items]) => items.length > 1)
    .map(([date, items]) => ({ date, items: items.map(i => `${i.name} ${i.time}`) }));
}

function buildDashboardContext(cases, calendarEvents) {
  const today = new Date().toISOString().slice(0, 10);
  const casesText = cases.map(c => {
    const parts = [`[id:${c.id}] ${c.name}`];
    if (c.court) parts.push(c.court);
    const _nh = _getNextHearing(c);
    if (_nh) parts.push(`засідання ${_nh.date}${_nh.time ? " " + _nh.time : ""}`);
    const _nd = (c.deadlines || []).filter(d => d.date >= today).sort((a,b) => a.date.localeCompare(b.date))[0];
    if (_nd) parts.push(`дедлайн ${_nd.date}${_nd.name ? " (" + _nd.name + ")" : ""}`);
    if (c.status) parts.push(c.status);
    if (c.next_action) parts.push(`→ ${c.next_action}`);
    return parts.join(" | ");
  }).join("\n");

  const eventsText = (calendarEvents && calendarEvents.length)
    ? calendarEvents.map(e => `${e.date} ${e.time || ""} ${e.title} (${e.type})`).join("\n")
    : "немає";

  const conflicts = findConflicts(cases, calendarEvents);
  const conflictsText = conflicts.length
    ? conflicts.map(c => `⚠️ ${c.date}: ${c.items.join(" і ")}`).join("\n")
    : "немає";

  return `Ти — календарний асистент АБ Левицького.
Сьогодні: ${today}.
Твоя роль: відповідати на питання про розклад, справи, дедлайни. Керувати календарем (навігація, пошук подій). Змінювати дати засідань і дедлайнів якщо адвокат просить.

ОНТОЛОГІЯ:
Засідання існує ВИКЛЮЧНО всередині справи (hearings[]). Окремих засідань немає.
Дедлайн існує ВИКЛЮЧНО всередині справи (deadlines[]). Окремих дедлайнів немає.
Будь-яка дія над засіданням потребує case_name справи-власника.
ЗАБОРОНЕНО: "засідання не прив'язане до справи".

Якщо користувач просить змінити дату засідання, час, дедлайн або інше поле справи — відповідай текстом І додавай в кінці ACTION_JSON блок.

Формат ACTION_JSON:
ACTION_JSON: {"action": "update_hearing", "case_name": "назва справи", "hearing_date": "YYYY-MM-DD", "hearing_time": "HH:MM"}
// Перенос засідання — замінює існуюче (не додає нове). Якщо є кілька засідань — додай "hearing_id" з переліку.

ACTION_JSON: {"action": "delete_hearing", "case_name": "назва справи", "hearing_date": "YYYY-MM-DD"}
// Видалити засідання по даті або найближче scheduled. Можна додати "hearing_id" замість дати.

ACTION_JSON: {"action": "add_hearing", "case_name": "назва справи", "hearing_date": "YYYY-MM-DD", "hearing_time": "HH:MM"}
// Додати НОВЕ засідання (не чіпає існуючі).

ACTION_JSON: {"action": "add_note", "case_name": "назва справи", "text": "...", "date": "YYYY-MM-DD"}
// Нотатка з датою — відображається в календарі.

ACTION_JSON: {"action": "navigate_calendar", "direction": "prev" | "next"}
ACTION_JSON: {"action": "navigate_week", "direction": "prev" | "next"}

Правила:
- case_name має точно співпадати з назвою справи зі списку
- hearing_date завжди у форматі YYYY-MM-DD
- hearing_time у форматі HH:MM (24-годинний)
- Для update_hearing/delete_hearing — якщо у справи кілька засідань, краще передавати hearing_id з контексту
- Якщо не можеш визначити справу або дату — запитай уточнення ОДИН РАЗ, не більше
- Не ухиляйся від виконання — або виконуй або став ОДНЕ конкретне питання.
- ЗАБОРОНЕНО: "не вистачає даних" без питання, "я не маю доступу".

ПРАВИЛО УТОЧНЕНЬ (питай ТІЛЬКИ ці випадки, в інших — виконуй негайно):

add_hearing:
- Немає справи → "У якій справі?"
- Немає дати → "На яку дату?"
- Немає часу → НЕ питай. Додай без часу, скажи "час не вказано — уточни пізніше".

update_hearing (перенос):
- Немає справи → "У якій справі?"
- Є дата але немає часу → НЕ питай. Збережи попередній час.
  Скажи: "Перенесено на [дата], час [старий час] збережено. Інший час?"
- У справі кілька scheduled засідань → "Яке саме — [дата1] чи [дата2]?"
- Одне scheduled → виконуй без питань.

delete_hearing:
- Немає справи → "У якій справі?"
- Кілька scheduled → "Яке саме — [дата1] чи [дата2]?" НЕ обирай мовчки.
- Одне scheduled → виконуй без питань.

add_note / update_note / delete_note:
- Немає справи (для нотаток до справи) — справу можна не питати, нотатка зберігається в general.
- Немає тексту нотатки → "Що саме записати?"

ФОРМАТ ПИТАННЯ — одне коротке речення. Поки чекаєш відповіді — НЕ додавай ACTION_JSON.
ЗАБОРОНЕНО: мовчазний вибір першого варіанту коли їх кілька.

Інакше — відповідай текстом українською, коротко і по суті.

// ШАР 1 — Поточні дані системи:
СПРАВИ (${cases.length}):
${casesText}

ДОДАТКОВІ ПОДІЇ:
${eventsText}

НАКЛАДКИ:
${conflictsText}

// ШАР 2 — Досьє (не реалізовано, підключити коли буде модуль Досьє)
// ШАР 3 — Google Drive документи (не реалізовано, підключити через Drive API)`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysUntil(dateStr) {
  const diff = Math.ceil(
    (new Date(dateStr) - new Date().setHours(0, 0, 0, 0)) / 86400000
  );
  return diff;
}

function formatDayTitle(dateStr) {
  const d = new Date(dateStr);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}

function buildMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1).getDay();
  const start = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = 0; i < 42; i++) {
    let day, m = month, y = year, other = false;
    const cd = i - start + 1;
    if (cd <= 0) { day = daysInPrev + cd; m = month - 1; other = true; }
    else if (cd > daysInMonth) { day = cd - daysInMonth; m = month + 1; other = true; }
    else { day = cd; }
    if (m < 0) { m = 11; y = year - 1; }
    if (m > 11) { m = 0; y = year + 1; }
    const dateStr = `${y}-${String(m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    cells.push({ day, dateStr, other });
  }
  return cells;
}

function getWeekDays(selectedDay) {
  const d = new Date(selectedDay);
  const dow = d.getDay() === 0 ? 6 : d.getDay() - 1;
  const start = new Date(d);
  start.setDate(d.getDate() - dow);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return day.toISOString().slice(0, 10);
  });
}

const navBtnStyle = {
  background: "var(--surface2, #222536)",
  border: "1px solid var(--border, #2e3148)",
  borderRadius: 5,
  color: "var(--text, #e6e8f0)",
  width: 26,
  height: 26,
  cursor: "pointer",
  fontSize: 13
};

const vBtnStyle = {
  background: "transparent",
  border: "none",
  color: "var(--text2, #9aa0b8)",
  padding: "3px 8px",
  fontSize: 11,
  cursor: "pointer",
  borderRadius: 4
};

const vBtnActive = {
  background: "var(--accent, #4f7cff)",
  color: "#fff"
};

export default function Dashboard({ cases, calendarEvents, onUpdateCase, onAddEvent, onUpdateEvent, onDeleteEvent, sonnetPrompt, buildSystemContext, onExecuteAction }) {
  const [curMonth, setCurMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(todayStr());
  const [calView, setCalView] = useState("month");
  const [agentInput, setAgentInput] = useState("");
  const [chatHistory, setChatHistory] = useState([]); // [{role:'user'|'assistant', content:string}]
  const [agentLoading, setAgentLoading] = useState(false);
  const chatScrollRef = useRef(null);
  const [isListening, setIsListening] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDate, setModalDate] = useState(null);
  const [modalStart, setModalStart] = useState("10:00");
  const [modalEnd, setModalEnd] = useState("11:00");
  const [modalTitle, setModalTitle] = useState("");
  const [modalType, setModalType] = useState("hearing");
  const [modalCourt, setModalCourt] = useState("");
  const [modalShowTravel, setModalShowTravel] = useState(false);
  const [modalTravelMin, setModalTravelMin] = useState(60);
  const [expandedGroups, setExpandedGroups] = useState({});

  function getAllEvents() {
    const events = [];
    cases.forEach(c => {
      (c.hearings || []).filter(h => h.status === 'scheduled').forEach(h => {
        events.push({
          id: "h_" + c.id + "_" + h.id,
          type: "hearing",
          title: c.name,
          date: h.date,
          time: h.time || null,
          court: h.court || c.court || null,
          duration: 120,
          caseId: c.id,
          hearingId: h.id
        });
      });
      (c.deadlines || []).forEach(dl => {
        events.push({
          id: "d_" + c.id + "_" + dl.id,
          type: "deadline",
          title: c.name,
          date: dl.date,
          time: null,
          label: dl.name || "дедлайн",
          caseId: c.id,
          deadlineId: dl.id
        });
      });
    });
    return [...events, ...calendarEvents];
  }

  function getEventsForDay(dateStr) {
    return getAllEvents().filter(e => e.date === dateStr);
  }

  function checkConflicts(dateStr) {
    const hearings = getEventsForDay(dateStr).filter(e => e.type === "hearing" && e.time);
    if (hearings.length < 2) return [];
    return hearings;
  }

  function shiftWeek(deltaDays) {
    const d = new Date(selectedDay);
    d.setDate(d.getDate() + deltaDays);
    const dow = d.getDay() === 0 ? 6 : d.getDay() - 1;
    const firstOfWeek = new Date(d);
    firstOfWeek.setDate(d.getDate() - dow);
    const iso = firstOfWeek.toISOString().slice(0, 10);
    setSelectedDay(iso);
    setCurMonth(new Date(firstOfWeek.getFullYear(), firstOfWeek.getMonth(), 1));
  }

  function goPrev() {
    if (calView === "week") shiftWeek(-7);
    else setCurMonth(new Date(curMonth.getFullYear(), curMonth.getMonth() - 1, 1));
  }
  function goNext() {
    if (calView === "week") shiftWeek(7);
    else setCurMonth(new Date(curMonth.getFullYear(), curMonth.getMonth() + 1, 1));
  }

  function formatWeekRange(days) {
    const first = new Date(days[0]);
    const last = new Date(days[6]);
    const short = ["січ","лют","бер","кві","тра","чер","лип","сер","вер","жов","лис","гру"];
    return `${first.getDate()} ${short[first.getMonth()]} — ${last.getDate()} ${short[last.getMonth()]}`;
  }

  const allConflicts = findConflicts(cases, calendarEvents);

  const stats = {
    active: cases.filter(c => c.status === "active" || !c.status).length,
    paused: cases.filter(c => c.status === "paused").length,
    closed: cases.filter(c => c.status === "closed").length,
    civil: cases.filter(c => c.category === "civil").length,
    criminal: cases.filter(c => c.category === "criminal").length,
    military: cases.filter(c => c.category === "military").length,
    admin: cases.filter(c => c.category === "admin" || c.category === "administrative").length,
  };

  const allEvents = getAllEvents().filter(e => e.date).sort((a,b) => a.date.localeCompare(b.date));
  const hotCount = allEvents.filter(e => daysUntil(e.date) <= 1 && daysUntil(e.date) >= 0).length;

  const group1 = allEvents.filter(e => { const d = daysUntil(e.date); return d >= 0 && d <= 1; });
  const group2 = allEvents.filter(e => { const d = daysUntil(e.date); return d > 1 && d <= 7; });
  const group3 = allEvents.filter(e => { const d = daysUntil(e.date); return d > 7 && d <= 30; });

  function FeedItem({ event, urgency }) {
    const d = daysUntil(event.date);
    const icon = event.type === "hearing" ? "⚖️" : event.type === "deadline" ? "⏰" : "📅";

    const borderColor = urgency === "urgent" ? "#e74c3c"
      : urgency === "warn" ? "#f39c12"
      : "#5a6080";

    const badgeText = d === 0 ? "сьогодні" : d === 1 ? "завтра" : `${d} днів`;
    const badgeBg = d <= 0 ? "rgba(231,76,60,.2)" : d <= 1 ? "rgba(243,156,18,.2)" : "rgba(79,124,255,.2)";
    const badgeColor = d <= 0 ? "#e74c3c" : d <= 1 ? "#f39c12" : "#4f7cff";

    return (
      <div
        onClick={() => setSelectedDay(event.date)}
        style={{
          background: "var(--surface, #1a1d27)",
          border: "1px solid var(--border, #2e3148)",
          borderLeft: `3px solid ${borderColor}`,
          borderRadius: 8,
          padding: "8px 10px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8
        }}
      >
        <span style={{ fontSize: 15 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {event.title}
            </span>
            <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 600, background: badgeBg, color: badgeColor, whiteSpace: "nowrap" }}>
              {badgeText}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "var(--text2, #9aa0b8)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {event.court || event.label || ""}
          </div>
        </div>
      </div>
    );
  }

  function FeedGroup({ title, events, urgency, groupKey }) {
    if (!events.length) return null;
    const expanded = expandedGroups[groupKey];
    const visible = expanded ? events : events.slice(0, 5);
    const rest = events.length - 5;

    return (
      <div>
        <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text3, #5a6080)", textTransform: "uppercase", letterSpacing: ".06em", padding: "6px 2px 3px" }}>
          {title}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {visible.map(e => <FeedItem key={e.id} event={e} urgency={urgency} />)}
        </div>
        {!expanded && rest > 0 && (
          <div
            onClick={() => setExpandedGroups(prev => ({ ...prev, [groupKey]: true }))}
            style={{ textAlign: "center", fontSize: 11, color: "var(--accent, #4f7cff)", padding: 5, cursor: "pointer" }}
          >
            ще {rest} →
          </div>
        )}
      </div>
    );
  }

  // Calendar month grid
  const cells = buildMonthGrid(curMonth.getFullYear(), curMonth.getMonth());
  const today = todayStr();

  // Day panel
  const dayEvents = getEventsForDay(selectedDay);
  const conflicts = checkConflicts(selectedDay);
  const hearingCount = dayEvents.filter(e => e.type === "hearing").length;
  const deadlineCount = dayEvents.filter(e => e.type === "deadline").length;

  const parts = [];
  if (hearingCount) parts.push(`${hearingCount} засідань`);
  if (deadlineCount) parts.push(`${deadlineCount} дедлайн${deadlineCount > 1 ? "и" : ""}`);
  const subtitle = parts.length
    ? (conflicts.length ? parts.join(" · ") + " · накладка!" : parts.join(" · "))
    : "Вільний день";

  function handleDashboardAction(action) {
    const findCase = (name) => {
      if (!name) return null;
      const n = name.toLowerCase();
      return cases.find(c =>
        c.name === name ||
        c.name.toLowerCase().includes(n) ||
        (c.client && c.client.toLowerCase().includes(n))
      );
    };

    switch (action.action) {
      case "update_hearing": {
        const c = findCase(action.case_name);
        if (!c) return null;
        if (action.hearing_date && onExecuteAction) {
          onExecuteAction('dashboard_agent', 'update_hearing', {
            caseId: c.id,
            hearingId: action.hearing_id || null,
            date: action.hearing_date,
            time: action.hearing_time || '',
          });
        }
        return `✅ Засідання у справі "${c.name}" перенесено на ${action.hearing_date}${action.hearing_time ? " о " + action.hearing_time : ""}`;
      }
      case "add_hearing": {
        const c = findCase(action.case_name);
        if (!c || !onExecuteAction) return null;
        if (action.hearing_date) {
          onExecuteAction('dashboard_agent', 'add_hearing', {
            caseId: c.id,
            date: action.hearing_date,
            time: action.hearing_time || '',
            duration: 120,
          });
          return `✅ Нове засідання у справі "${c.name}" на ${action.hearing_date}${action.hearing_time ? " о " + action.hearing_time : ""}`;
        }
        return null;
      }
      case "delete_hearing": {
        const c = findCase(action.case_name);
        if (!c || !onExecuteAction) return null;
        let hearingId = action.hearing_id || null;
        if (!hearingId && action.hearing_date) {
          const h = (c.hearings || []).find(h => h.date === action.hearing_date);
          if (h) hearingId = h.id;
        }
        if (!hearingId) {
          const today = new Date().toISOString().split('T')[0];
          const next = (c.hearings || [])
            .filter(h => h.date >= today)
            .sort((a, b) => a.date.localeCompare(b.date))[0];
          if (next) hearingId = next.id;
        }
        if (hearingId) {
          onExecuteAction('dashboard_agent', 'delete_hearing', { caseId: c.id, hearingId });
          return `✅ Засідання у справі "${c.name}" видалено`;
        }
        return null;
      }
      case "update_deadline": {
        const c = findCase(action.case_name);
        if (!c) return null;
        if (action.deadline) {
          // dashboard_agent не має дозволу на deadline — fallback на onUpdateCase
          const newDl = { id: `dl_${Date.now()}`, name: action.deadline_type || "Дедлайн", date: action.deadline };
          onUpdateCase(c.id, "deadlines", [...(c.deadlines || []), newDl]);
        }
        return `✅ Дедлайн "${c.name}": ${action.deadline}`;
      }
      case "navigate_calendar": {
        setCalView("month");
        if (action.direction === "prev") {
          setCurMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
          return "📅 Попередній місяць";
        }
        if (action.direction === "next") {
          setCurMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
          return "📅 Наступний місяць";
        }
        return null;
      }
      case "navigate_week": {
        setCalView("week");
        if (action.direction === "prev") { shiftWeek(-7); return "📅 Попередній тиждень"; }
        if (action.direction === "next") { shiftWeek(7); return "📅 Наступний тиждень"; }
        return null;
      }
      default:
        return null;
    }
  }

  function handleAgentResponse(text) {
    const idx = text.indexOf("ACTION_JSON:");
    if (idx === -1) return text;
    const start = text.indexOf("{", idx);
    if (start === -1) return text;
    let depth = 0, end = -1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) return text;
    try {
      const action = JSON.parse(text.slice(start, end + 1));
      const actionMsg = handleDashboardAction(action);
      const preface = text.slice(0, idx).trim();
      if (actionMsg) return preface ? `${preface}\n\n${actionMsg}` : actionMsg;
      return preface || text;
    } catch (e) {
      return text;
    }
  }

  async function handleAgentSend(inputOverride) {
    const input = (typeof inputOverride === "string" ? inputOverride : agentInput).trim();
    if (!input || agentLoading) return;

    const userMsg = { role: "user", content: input };
    // максимум 10 повідомлень у вікні контексту (5 пар user/assistant)
    const trimmed = chatHistory.slice(-10);
    const newHistory = [...trimmed, userMsg];
    setChatHistory(newHistory);
    setAgentInput("");
    setAgentLoading(true);

    try {
      const apiKey = localStorage.getItem("claude_api_key");
      if (!apiKey) {
        setChatHistory(h => [...h, { role: "assistant", content: "⚙️ Налаштуйте API ключ в Quick Input" }]);
        setAgentLoading(false);
        return;
      }

      const systemPrompt = buildDashboardContext(cases, calendarEvents);

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 500,
          system: systemPrompt,
          messages: newHistory
        })
      });

      if (!response.ok) {
        const err = await response.text();
        setChatHistory(h => [...h, { role: "assistant", content: `❌ API помилка ${response.status}: ${err.slice(0, 200)}` }]);
        setAgentLoading(false);
        return;
      }

      const data = await response.json();
      const rawText = data.content?.[0]?.text || "Не вдалося отримати відповідь";
      const cleanText = handleAgentResponse(rawText);
      setChatHistory(h => [...h, { role: "assistant", content: cleanText }]);
    } catch (e) {
      setChatHistory(h => [...h, { role: "assistant", content: "❌ Помилка: " + e.message }]);
    }

    setAgentLoading(false);
  }

  // Автоскрол чату донизу
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatHistory, agentLoading]);

  function startVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setChatHistory(h => [...h, { role: "assistant", content: "❌ Голосовий ввід не підтримується в цьому браузері" }]);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "uk-UA";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (e) => {
      const text = e.results[0][0].transcript;
      setAgentInput(text);
      setIsListening(false);
      handleAgentSend(text);
    };
    recognition.onerror = () => { setChatHistory(h => [...h, { role: "assistant", content: "❌ Помилка розпізнавання голосу" }]); setIsListening(false); };
    recognition.onend = () => setIsListening(false);
    recognition.start();
    setIsListening(true);
  }

  function openModalWithRange(startSlotIdx, endSlotIdx, dateStr) {
    const day = dateStr || selectedDay;
    setModalDate(day);
    if (day !== selectedDay) setSelectedDay(day);
    const startTime = SLOTS[startSlotIdx] || SLOTS[0];
    const endTime = SLOTS[endSlotIdx] || addMinutesToTime(SLOTS[SLOTS.length - 1], SLOT_MIN);
    setModalStart(startTime);
    setModalEnd(endTime);
    setModalTitle("");
    setModalCourt("");
    setModalType("hearing");
    setModalShowTravel(false);
    setModalTravelMin(60);
    setModalOpen(true);
  }

  function parseHM(s) {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  }
  function toHM(totalMin) {
    const m = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return String(h).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
  }

  async function saveEvent() {
    if (!modalTitle.trim()) return;
    const day = modalDate || selectedDay;

    const startMin = parseHM(modalStart);
    const endMin = parseHM(modalEnd);
    if (endMin <= startMin) return;
    const duration = endMin - startMin;

    const existingHearings = getEventsForDay(day).filter(e => e.type === "hearing" && e.time);
    if (modalType === "hearing" && existingHearings.length > 0) {
      const ok = await systemConfirm("В цей день вже є засідання. Зберегти попри накладку?", "Накладка засідань");
      if (!ok) return;
    }

    const baseId = Date.now();
    const newEvents = [{
      id: baseId,
      title: modalTitle.trim(),
      date: day,
      time: modalStart,
      endTime: modalEnd,
      duration,
      type: modalType,
      court: modalCourt.trim() || null,
      notes: ""
    }];

    if (modalShowTravel && modalTravelMin > 0) {
      const travelStart = toHM(startMin - modalTravelMin);
      newEvents.push({
        id: baseId + 1,
        title: "🚗 Дорога",
        date: day,
        time: travelStart,
        endTime: modalStart,
        duration: modalTravelMin,
        type: "travel",
        court: null,
        notes: ""
      });
    }

    newEvents.forEach(e => onAddEvent(e));
    setModalOpen(false);
    setModalTitle("");
    setModalCourt("");
    setModalType("hearing");
    setModalShowTravel(false);
  }

  const slotDrag = useSlotDrag((s, e, ctx) => {
    openModalWithRange(s, e, ctx || undefined);
  });

  const weekDays = calView === "week" ? getWeekDays(selectedDay) : [];

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden", height: "100%" }}>

      {/* ── ACTIVITY FEED ── */}
      <div style={{ flex: 1, borderRight: "1px solid var(--border, #2e3148)", display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border, #2e3148)", display: "flex", alignItems: "center", flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text3, #5a6080)", textTransform: "uppercase", letterSpacing: ".06em" }}>
            Стрічка подій
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--text3, #5a6080)" }}>
              Горять: <b style={{ color: "var(--red, #e74c3c)" }}>{hotCount}</b>
            </span>
            <span style={{ fontSize: 11, color: "var(--text3, #5a6080)" }}>
              Справ: <b style={{ color: "var(--text, #e6e8f0)" }}>{cases.length}</b>
            </span>
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
          <FeedGroup title="Зараз (0-1 день)" events={group1} urgency="urgent" groupKey="g1" />
          <FeedGroup title="Цього тижня (2-7 днів)" events={group2} urgency="warn" groupKey="g2" />
          <FeedGroup title="Цього місяця (8-30 днів)" events={group3} urgency="normal" groupKey="g3" />
          {allEvents.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--text3, #5a6080)", fontSize: 12, padding: 20 }}>
              Немає подій
            </div>
          )}
        </div>
      </div>

      {/* ── CALENDAR ── */}
      <div style={{ flex: 2, borderRight: "1px solid var(--border, #2e3148)", display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, height: "100%", overflow: "hidden" }}>
        <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border, #2e3148)", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button onClick={goPrev} style={navBtnStyle}>←</button>
          <h2 style={{ fontSize: 13, fontWeight: 600, flex: 1, textAlign: "center", margin: 0 }}>
            {calView === "week"
              ? formatWeekRange(weekDays)
              : `${MONTHS_UK[curMonth.getMonth()]} ${curMonth.getFullYear()}`}
          </h2>
          <button onClick={goNext} style={navBtnStyle}>→</button>
          <div style={{ display: "flex", background: "var(--surface2, #222536)", borderRadius: 5, padding: 2 }}>
            <button onClick={() => setCalView("month")} style={{ ...vBtnStyle, ...(calView === "month" ? vBtnActive : {}) }}>Місяць</button>
            <button onClick={() => setCalView("week")} style={{ ...vBtnStyle, ...(calView === "week" ? vBtnActive : {}) }}>Тиждень</button>
          </div>
        </div>

        {calView === "month" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, padding: "4px 8px 0", flexShrink: 0 }}>
            {WDAYS.map(w => (
              <div key={w} style={{ fontSize: 10, fontWeight: 600, color: "var(--text3, #5a6080)", textAlign: "center", textTransform: "uppercase", padding: "4px 0" }}>
                {w}
              </div>
            ))}
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: calView === "month" ? "4px 8px 8px" : 8 }}>
          {calView === "month" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, height: "100%", gridAutoRows: "1fr" }}>
                {cells.map(cell => {
                  const events = getEventsForDay(cell.dateStr);
                  const hearings = events.filter(e => e.type === "hearing");
                  const deadlines = events.filter(e => e.type === "deadline");
                  const conflict = hearings.length > 1;
                  const isToday = cell.dateStr === today;
                  const isSelected = cell.dateStr === selectedDay;

                  let borderColor = "var(--border, #2e3148)";
                  if (conflict) borderColor = "#e74c3c";
                  else if (isSelected) borderColor = "var(--accent, #4f7cff)";
                  else if (isToday) borderColor = "var(--accent, #4f7cff)";

                  let bg = "var(--surface, #1a1d27)";
                  if (isSelected) bg = "rgba(79,124,255,.15)";
                  else if (isToday) bg = "rgba(79,124,255,.08)";

                  return (
                    <div
                      key={cell.dateStr + "_" + cell.day}
                      onClick={() => !cell.other && setSelectedDay(cell.dateStr)}
                      style={{
                        background: bg,
                        border: `1px solid ${borderColor}`,
                        borderRadius: 6,
                        padding: "3px 2px",
                        cursor: cell.other ? "default" : "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 1,
                        minHeight: 0,
                        opacity: cell.other ? 0.3 : 1,
                        overflow: "hidden"
                      }}
                    >
                      <span style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? "var(--accent, #4f7cff)" : "inherit" }}>
                        {cell.day}
                      </span>
                      <div style={{ display: "flex", gap: 1, flexWrap: "wrap", justifyContent: "center" }}>
                        {hearings.slice(0,3).map((_, i) => (
                          <div key={"h"+i} style={{ width: 4, height: 4, borderRadius: "50%", background: "#4f7cff" }} />
                        ))}
                        {deadlines.slice(0,2).map((_, i) => (
                          <div key={"d"+i} style={{ width: 4, height: 4, borderRadius: "50%", background: "#f39c12" }} />
                        ))}
                      </div>
                      {conflict && <span style={{ fontSize: 8 }}>⚠️</span>}
                    </div>
                  );
                })}
              </div>
          ) : (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "40px repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
                <div />
                {weekDays.map((ds, i) => {
                  const d = new Date(ds);
                  const isToday = ds === today;
                  const isSelected = ds === selectedDay;
                  return (
                    <div
                      key={ds}
                      onClick={() => setSelectedDay(ds)}
                      style={{
                        textAlign: "center",
                        padding: "4px 2px",
                        borderRadius: 4,
                        cursor: "pointer",
                        background: isSelected ? "rgba(79,124,255,.15)" : "transparent",
                        border: `1px solid ${isSelected || isToday ? "var(--accent, #4f7cff)" : "transparent"}`
                      }}
                    >
                      <div style={{ fontSize: 10, color: "var(--text3, #5a6080)", fontWeight: 600 }}>{WDAYS[i]}</div>
                      <div style={{
                        fontSize: 13,
                        fontWeight: isToday || isSelected ? 700 : 500,
                        color: isSelected || isToday ? "var(--accent, #4f7cff)" : "inherit",
                        textDecoration: isSelected ? "underline" : "none"
                      }}>
                        {d.getDate()}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 2, touchAction: slotDrag.isDragging ? "none" : "pan-y", userSelect: "none" }}>
                <div style={{ width: 36, display: "flex", flexDirection: "column" }}>
                  {SLOTS.map(slotTime => {
                    const isHalf = slotTime.endsWith(':30');
                    return (
                      <div key={slotTime} style={{
                        height: SLOT_H,
                        fontSize: isHalf ? 9 : 10,
                        color: isHalf ? "var(--text3, #5a6080)" : "var(--text2, #9aa0b8)",
                        opacity: isHalf ? 0.5 : 1,
                        textAlign: "right",
                        paddingRight: 4,
                        paddingTop: 2,
                        boxSizing: "border-box"
                      }}>
                        {slotTime}
                      </div>
                    );
                  })}
                </div>
                {weekDays.map(ds => (
                  <SlotsColumn
                    key={ds}
                    day={ds}
                    events={getEventsForDay(ds)}
                    slotDrag={slotDrag}
                    onEmptyClick={() => setSelectedDay(ds)}
                    style={{ flex: 1 }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── STATS PANEL ── */}
        <div style={{
          borderTop: "1px solid var(--border, #2e3148)",
          padding: "6px 10px",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: 4
        }}>
          <div style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--text3, #5a6080)" }}>
            <span>Активних: <b style={{ color: "var(--text, #e6e8f0)" }}>{stats.active}</b></span>
            <span>·</span>
            <span>Призупинених: <b style={{ color: "var(--text, #e6e8f0)" }}>{stats.paused}</b></span>
            <span>·</span>
            <span>Закритих: <b style={{ color: "var(--text, #e6e8f0)" }}>{stats.closed}</b></span>
          </div>
          {allConflicts.length > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 8px",
              background: "rgba(231,76,60,0.1)",
              border: "1px solid rgba(231,76,60,0.3)",
              borderRadius: 6,
              fontSize: 11, color: "#e74c3c"
            }}>
              ⚠️ Накладки: {allConflicts.length} — {allConflicts.map(c => c.date).join(", ")}
            </div>
          )}
          {(() => {
            const catSegs = [
              { label: "Цивільні", val: stats.civil, color: "#4f7cff" },
              { label: "Кримінальні", val: stats.criminal, color: "#e74c3c" },
              { label: "Військові", val: stats.military, color: "#f39c12" },
              { label: "Адміністративні", val: stats.admin, color: "#2ecc71" },
            ];
            const total = catSegs.reduce((a, s) => a + s.val, 0) || 1;
            return (
              <>
                <div style={{
                  display: "flex", width: "100%", height: 8, borderRadius: 4, overflow: "hidden",
                  background: "var(--surface, #1a1d27)",
                  border: "1px solid var(--border, #2e3148)"
                }}>
                  {catSegs.filter(s => s.val > 0).map(s => (
                    <div key={s.label} style={{ flex: s.val, background: s.color }} />
                  ))}
                </div>
                <div style={{ display: "flex", width: "100%" }}>
                  {catSegs.filter(s => s.val > 0).map(s => (
                    <div key={s.label} style={{ flex: s.val, textAlign: "center", fontSize: 10, color: s.color, fontWeight: 600 }}>
                      {s.label} {s.val}
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text3, #5a6080)", opacity: 0.6, fontStyle: "italic" }}>
            <span>💳 Білінг</span>
            <span>·</span>
            <span>Незабаром</span>
          </div>
        </div>
      </div>

      {/* ── DAY PANEL ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border, #2e3148)", flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{formatDayTitle(selectedDay)}</div>
          <div style={{ fontSize: 11, color: conflicts.length ? "#e74c3c" : "var(--text3, #5a6080)", marginTop: 2 }}>
            {subtitle}
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "8px 10px" }}>
          {/* Агент */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text3, #5a6080)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>
              Агент
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input
                type="text"
                value={agentInput}
                onChange={e => setAgentInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAgentSend(); } }}
                placeholder="Запитай про розклад, справи..."
                style={{
                  flex: 1, minWidth: 0,
                  background: "var(--surface, #1a1d27)",
                  border: "1px solid var(--border, #2e3148)",
                  borderRadius: 5,
                  color: "var(--text, #e6e8f0)",
                  padding: "6px 8px",
                  fontSize: 11,
                  fontFamily: "inherit",
                  boxSizing: "border-box"
                }}
              />
              <button
                onClick={startVoiceInput}
                disabled={isListening || agentLoading}
                title="Голосовий ввід"
                style={{
                  background: isListening ? "rgba(231,76,60,.2)" : "var(--surface2, #222536)",
                  border: "1px solid var(--border, #2e3148)",
                  borderRadius: 5,
                  color: "var(--text, #e6e8f0)",
                  padding: "6px 8px",
                  fontSize: 13,
                  cursor: isListening || agentLoading ? "default" : "pointer",
                  flexShrink: 0
                }}
              >
                {isListening ? "🔴" : "🎤"}
              </button>
              <button
                onClick={() => handleAgentSend()}
                disabled={agentLoading || !agentInput.trim()}
                title="Надіслати"
                style={{
                  background: "var(--accent, #4f7cff)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 5,
                  padding: "6px 10px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: agentLoading ? "default" : "pointer",
                  opacity: agentLoading || !agentInput.trim() ? 0.5 : 1,
                  flexShrink: 0
                }}
              >
                →
              </button>
            </div>
            {(chatHistory.length > 0 || agentLoading) && (
              <div
                ref={chatScrollRef}
                style={{
                  marginTop: 6,
                  height: 170,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  padding: 6,
                  background: "rgba(79,124,255,0.04)",
                  border: "1px solid var(--border, #2e3148)",
                  borderRadius: 5,
                }}
              >
                {chatHistory.map((m, i) => (
                  <div
                    key={i}
                    style={{
                      alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                      maxWidth: "85%",
                      background: m.role === "user" ? "rgba(79,124,255,0.15)" : "var(--surface2, #222536)",
                      borderRadius: 6,
                      padding: "5px 8px",
                      fontSize: 11,
                      lineHeight: 1.4,
                      color: "var(--text, #e6e8f0)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {m.content}
                  </div>
                ))}
                {agentLoading && (
                  <div style={{
                    alignSelf: "flex-start",
                    background: "var(--surface2, #222536)",
                    borderRadius: 6,
                    padding: "5px 8px",
                    fontSize: 11,
                    color: "var(--text3, #5a6080)",
                    fontStyle: "italic",
                  }}>⏳ Аналізую...</div>
                )}
              </div>
            )}
          </div>

          {/* Слоти */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text3, #5a6080)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>
              Розклад
            </div>
            <div style={{ display: "flex", gap: 4, touchAction: slotDrag.isDragging ? "none" : "pan-y", userSelect: "none" }}>
              <div style={{ width: 36, display: "flex", flexDirection: "column" }}>
                {SLOTS.map(slotTime => {
                  const isHalf = slotTime.endsWith(':30');
                  return (
                    <div key={slotTime} style={{
                      height: SLOT_H,
                      fontSize: isHalf ? 9 : 10,
                      color: isHalf ? "var(--text3, #5a6080)" : "var(--text2, #9aa0b8)",
                      opacity: isHalf ? 0.5 : 1,
                      textAlign: "right",
                      paddingRight: 4,
                      paddingTop: 2,
                      boxSizing: "border-box"
                    }}>
                      {slotTime}
                    </div>
                  );
                })}
              </div>
              <SlotsColumn
                day={selectedDay}
                events={dayEvents.filter(e => e.time)}
                slotDrag={slotDrag}
                conflicts={conflicts}
                style={{ flex: 1 }}
              />
            </div>
          </div>

          {/* Дедлайни без часу */}
          {dayEvents.filter(e => !e.time).length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text3, #5a6080)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>
                Без часу
              </div>
              {dayEvents.filter(e => !e.time).map(e => (
                <div key={e.id} style={{
                  borderRadius: 5,
                  border: `1px solid ${e.type === "deadline" ? "#f39c12" : "#5a6080"}`,
                  background: e.type === "deadline" ? "rgba(243,156,18,.1)" : "var(--surface, #1a1d27)",
                  padding: "4px 7px",
                  fontSize: 11,
                  marginBottom: 3
                }}>
                  <div style={{ fontWeight: 600 }}>{e.title}</div>
                  {e.label && <div style={{ fontSize: 10, color: "var(--text3, #5a6080)" }}>{e.label}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── MODAL ── */}
      {modalOpen && (
        <div
          onClick={() => setModalOpen(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,.5)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "var(--bg, #121420)",
              border: "1px solid var(--border, #2e3148)",
              borderRadius: 10,
              padding: 16,
              width: 320,
              maxWidth: "90vw"
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>
              Нова подія — {formatDayTitle(modalDate || selectedDay)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {[
                  { val: "hearing", label: "Засідання" },
                  { val: "deadline", label: "Дедлайн" },
                  { val: "event", label: "Подія" },
                ].map(t => (
                  <button
                    key={t.val}
                    onClick={() => setModalType(t.val)}
                    style={{
                      flex: 1, padding: "6px", borderRadius: 5, fontSize: 11, cursor: "pointer",
                      background: modalType === t.val ? "var(--accent, #4f7cff)" : "var(--surface2, #222536)",
                      color: modalType === t.val ? "#fff" : "var(--text, #e6e8f0)",
                      border: "1px solid var(--border, #2e3148)"
                    }}
                  >{t.label}</button>
                ))}
              </div>
              <input
                type="text"
                value={modalTitle}
                onChange={e => setModalTitle(e.target.value)}
                placeholder="Назва події"
                style={{
                  background: "var(--surface, #1a1d27)",
                  border: "1px solid var(--border, #2e3148)",
                  borderRadius: 5, color: "var(--text, #e6e8f0)",
                  padding: "6px 8px", fontSize: 12
                }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "var(--text3, #5a6080)", marginBottom: 2 }}>Початок</div>
                  <input
                    type="time"
                    step="1800"
                    value={modalStart}
                    onChange={e => setModalStart(e.target.value)}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: "var(--surface, #1a1d27)",
                      border: "1px solid var(--border, #2e3148)",
                      borderRadius: 5, color: "var(--text, #e6e8f0)",
                      padding: "6px 8px", fontSize: 12
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "var(--text3, #5a6080)", marginBottom: 2 }}>Кінець</div>
                  <input
                    type="time"
                    step="1800"
                    value={modalEnd}
                    onChange={e => setModalEnd(e.target.value)}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: "var(--surface, #1a1d27)",
                      border: "1px solid var(--border, #2e3148)",
                      borderRadius: 5, color: "var(--text, #e6e8f0)",
                      padding: "6px 8px", fontSize: 12
                    }}
                  />
                </div>
              </div>
              <input
                type="text"
                value={modalCourt}
                onChange={e => setModalCourt(e.target.value)}
                placeholder="Суд / місце (опціонально)"
                style={{
                  background: "var(--surface, #1a1d27)",
                  border: "1px solid var(--border, #2e3148)",
                  borderRadius: 5, color: "var(--text, #e6e8f0)",
                  padding: "6px 8px", fontSize: 12
                }}
              />
              <div>
                <button
                  type="button"
                  onClick={() => setModalShowTravel(v => !v)}
                  style={{
                    width: "100%",
                    padding: "6px 8px", borderRadius: 5, fontSize: 11, cursor: "pointer",
                    background: modalShowTravel ? "var(--surface2, #222536)" : "transparent",
                    color: "var(--text2, #9aa0b8)",
                    border: "1px dashed var(--border, #2e3148)",
                    textAlign: "left"
                  }}
                >🚗 {modalShowTravel ? "Прибрати час на дорогу" : "Додати час на дорогу"}</button>
                {modalShowTravel && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 10, color: "var(--text3, #5a6080)", marginBottom: 2 }}>Хвилин на дорогу</div>
                    <input
                      type="number"
                      step="30"
                      min="0"
                      value={modalTravelMin}
                      onChange={e => setModalTravelMin(parseInt(e.target.value, 10) || 0)}
                      style={{
                        width: "100%", boxSizing: "border-box",
                        background: "var(--surface, #1a1d27)",
                        border: "1px solid var(--border, #2e3148)",
                        borderRadius: 5, color: "var(--text, #e6e8f0)",
                        padding: "6px 8px", fontSize: 12
                      }}
                    />
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button
                  onClick={() => setModalOpen(false)}
                  style={{
                    flex: 1, padding: "8px", borderRadius: 5, fontSize: 12, cursor: "pointer",
                    background: "var(--surface2, #222536)", color: "var(--text, #e6e8f0)",
                    border: "1px solid var(--border, #2e3148)"
                  }}
                >Скасувати</button>
                <button
                  onClick={saveEvent}
                  style={{
                    flex: 1, padding: "8px", borderRadius: 5, fontSize: 12, cursor: "pointer",
                    background: "var(--accent, #4f7cff)", color: "#fff",
                    border: "none", fontWeight: 600
                  }}
                >Зберегти</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
