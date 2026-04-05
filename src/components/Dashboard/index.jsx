import React, { useState, useEffect } from "react";

const MONTHS_UK = [
  "Січень","Лютий","Березень","Квітень","Травень","Червень",
  "Липень","Серпень","Вересень","Жовтень","Листопад","Грудень"
];
const WDAYS = ["Пн","Вт","Ср","Чт","Пт","Сб","Нд"];
const HOURS = [8,9,10,11,12,13,14,15,16,17,18,19];
const MONTHS_GEN = [
  "січня","лютого","березня","квітня","травня","червня",
  "липня","серпня","вересня","жовтня","листопада","грудня"
];

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

export default function Dashboard({ cases, setCases, sonnetPrompt, buildSystemContext }) {
  const [curMonth, setCurMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(todayStr());
  const [calView, setCalView] = useState("month");
  const [agentInput, setAgentInput] = useState("");
  const [agentResponse, setAgentResponse] = useState("");
  const [agentLoading, setAgentLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTime, setModalTime] = useState("10:00");
  const [modalTitle, setModalTitle] = useState("");
  const [modalType, setModalType] = useState("hearing");
  const [modalCourt, setModalCourt] = useState("");
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [expandedGroups, setExpandedGroups] = useState({});

  useEffect(() => {
    const saved = localStorage.getItem("levytskyi_calendar_events");
    if (saved) {
      try { setCalendarEvents(JSON.parse(saved)); } catch (e) {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("levytskyi_calendar_events", JSON.stringify(calendarEvents));
  }, [calendarEvents]);

  function getAllEvents() {
    const events = [];
    cases.forEach(c => {
      if (c.hearing_date) {
        events.push({
          id: "h_" + c.id,
          type: "hearing",
          title: c.name,
          date: c.hearing_date,
          time: c.hearing_time || null,
          court: c.court || null,
          duration: 120,
          caseId: c.id
        });
      }
      if (c.deadline) {
        events.push({
          id: "d_" + c.id,
          type: "deadline",
          title: c.name,
          date: c.deadline,
          time: null,
          label: c.deadline_type || "дедлайн",
          caseId: c.id
        });
      }
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

  function prevMonth() {
    setCurMonth(new Date(curMonth.getFullYear(), curMonth.getMonth() - 1, 1));
  }
  function nextMonth() {
    setCurMonth(new Date(curMonth.getFullYear(), curMonth.getMonth() + 1, 1));
  }

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

  async function handleAgentSend() {
    if (!agentInput.trim() || agentLoading) return;
    setAgentLoading(true);
    setAgentResponse("⏳ Аналізую...");

    try {
      const apiKey = localStorage.getItem("claude_api_key");
      if (!apiKey) {
        setAgentResponse("❌ API ключ не налаштований");
        setAgentLoading(false);
        return;
      }

      const ctxText = buildSystemContext ? buildSystemContext(cases) : "";
      const sysPrompt = sonnetPrompt || "";

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5-20251022",
          max_tokens: 500,
          system: `${sysPrompt}\n\nОбраний день: ${selectedDay} (${formatDayTitle(selectedDay)})\nПоточні події дня: ${JSON.stringify(dayEvents)}\nСправи системи: ${ctxText}`,
          messages: [{ role: "user", content: agentInput }]
        })
      });

      const data = await response.json();
      const text = data.content?.[0]?.text || "Не вдалося отримати відповідь";
      setAgentResponse(text);
    } catch (e) {
      setAgentResponse("❌ Помилка: " + e.message);
    }

    setAgentInput("");
    setAgentLoading(false);
  }

  function saveEvent() {
    if (!modalTitle.trim()) return;

    const existingHearings = getEventsForDay(selectedDay).filter(e => e.type === "hearing" && e.time);
    if (modalType === "hearing" && existingHearings.length > 0) {
      const ok = window.confirm("В цей день вже є засідання. Зберегти попри накладку?");
      if (!ok) return;
    }

    const newEvent = {
      id: Date.now(),
      title: modalTitle.trim(),
      date: selectedDay,
      time: modalTime,
      duration: 120,
      type: modalType,
      court: modalCourt.trim() || null,
      notes: ""
    };

    setCalendarEvents(prev => [...prev, newEvent]);
    setModalOpen(false);
    setModalTitle("");
    setModalCourt("");
    setModalType("hearing");
  }

  const weekDays = calView === "week" ? getWeekDays(selectedDay) : [];

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden", height: "100%" }}>

      {/* ── ACTIVITY FEED ── */}
      <div style={{ flex: 1, borderRight: "1px solid var(--border, #2e3148)", display: "flex", flexDirection: "column", minWidth: 0 }}>
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
      <div style={{ flex: 2, borderRight: "1px solid var(--border, #2e3148)", display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border, #2e3148)", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button onClick={prevMonth} style={navBtnStyle}>←</button>
          <h2 style={{ fontSize: 13, fontWeight: 600, flex: 1, textAlign: "center", margin: 0 }}>
            {MONTHS_UK[curMonth.getMonth()]} {curMonth.getFullYear()}
          </h2>
          <button onClick={nextMonth} style={navBtnStyle}>→</button>
          <div style={{ display: "flex", background: "var(--surface2, #222536)", borderRadius: 5, padding: 2 }}>
            <button onClick={() => setCalView("month")} style={{ ...vBtnStyle, ...(calView === "month" ? vBtnActive : {}) }}>Місяць</button>
            <button onClick={() => setCalView("week")} style={{ ...vBtnStyle, ...(calView === "week" ? vBtnActive : {}) }}>Тиждень</button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
          {calView === "month" ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
                {WDAYS.map(w => (
                  <div key={w} style={{ fontSize: 10, fontWeight: 600, color: "var(--text3, #5a6080)", textAlign: "center", textTransform: "uppercase", padding: "4px 0" }}>
                    {w}
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
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
                        minHeight: 46,
                        opacity: cell.other ? 0.3 : 1
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
            </>
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
                      <div style={{ fontSize: 13, fontWeight: isToday ? 700 : 500, color: isToday ? "var(--accent, #4f7cff)" : "inherit" }}>
                        {d.getDate()}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div>
                {HOURS.map(h => {
                  const timeStr = String(h).padStart(2,"0") + ":00";
                  return (
                    <div key={h} style={{ display: "grid", gridTemplateColumns: "40px repeat(7, 1fr)", gap: 2, marginBottom: 2 }}>
                      <div style={{ fontSize: 10, color: "var(--text3, #5a6080)", textAlign: "right", paddingRight: 4, paddingTop: 3 }}>
                        {timeStr}
                      </div>
                      {weekDays.map(ds => {
                        const evs = getEventsForDay(ds);
                        const ev = evs.find(e => e.time && e.time.startsWith(String(h).padStart(2,"0")));
                        return (
                          <div
                            key={ds+h}
                            onClick={() => setSelectedDay(ds)}
                            style={{
                              minHeight: 22,
                              borderRadius: 4,
                              border: "1px solid var(--border, #2e3148)",
                              background: ev ? (ev.type === "hearing" ? "rgba(79,124,255,.15)" : "rgba(243,156,18,.15)") : "var(--surface, #1a1d27)",
                              fontSize: 10,
                              padding: "2px 4px",
                              overflow: "hidden",
                              whiteSpace: "nowrap",
                              textOverflow: "ellipsis",
                              cursor: "pointer"
                            }}
                          >
                            {ev ? ev.title : ""}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── DAY PANEL ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
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
            <textarea
              value={agentInput}
              onChange={e => setAgentInput(e.target.value)}
              placeholder="Запитай про цей день..."
              style={{
                width: "100%",
                height: 50,
                background: "var(--surface, #1a1d27)",
                border: "1px solid var(--border, #2e3148)",
                borderRadius: 5,
                color: "var(--text, #e6e8f0)",
                padding: 6,
                fontSize: 11,
                fontFamily: "inherit",
                resize: "none",
                boxSizing: "border-box"
              }}
            />
            <button
              onClick={handleAgentSend}
              disabled={agentLoading || !agentInput.trim()}
              style={{
                marginTop: 4,
                width: "100%",
                background: "var(--accent, #4f7cff)",
                color: "#fff",
                border: "none",
                borderRadius: 5,
                padding: "6px",
                fontSize: 11,
                fontWeight: 600,
                cursor: agentLoading ? "default" : "pointer",
                opacity: agentLoading || !agentInput.trim() ? 0.5 : 1
              }}
            >
              {agentLoading ? "Обробка..." : "Надіслати"}
            </button>
            {agentResponse && (
              <div style={{
                marginTop: 6,
                padding: 6,
                background: "var(--surface2, #222536)",
                borderRadius: 5,
                fontSize: 11,
                whiteSpace: "pre-wrap",
                color: "var(--text2, #9aa0b8)",
                maxHeight: 150,
                overflow: "auto"
              }}>
                {agentResponse}
              </div>
            )}
          </div>

          {/* Слоти */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text3, #5a6080)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>
              Розклад
            </div>
            {HOURS.map(h => {
              const timeStr = String(h).padStart(2,"0") + ":00";
              const event = dayEvents.find(e => e.time && e.time.startsWith(String(h).padStart(2,"0")));
              const isConflict = event && conflicts.find(c => c.id === event.id);

              return (
                <div key={h} style={{ display: "flex", gap: 5, marginBottom: 2, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 10, color: "var(--text3, #5a6080)", width: 30, flexShrink: 0, paddingTop: 5 }}>
                    {timeStr}
                  </span>
                  {event ? (
                    <div style={{
                      flex: 1,
                      borderRadius: 5,
                      border: `1px solid ${isConflict ? "#e74c3c" : event.type === "hearing" ? "#4f7cff" : "#f39c12"}`,
                      background: isConflict ? "rgba(231,76,60,.1)" : event.type === "hearing" ? "rgba(79,124,255,.1)" : "rgba(243,156,18,.1)",
                      padding: "3px 7px",
                      fontSize: 11
                    }}>
                      <div style={{ fontWeight: 600 }}>{event.title}</div>
                      {(event.court || event.duration) && (
                        <div style={{ fontSize: 10, color: "var(--text3, #5a6080)" }}>
                          {[event.court, event.duration ? event.duration + " хв" : null].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      onClick={() => { setModalTime(timeStr); setModalOpen(true); }}
                      style={{
                        flex: 1,
                        minHeight: 26,
                        borderRadius: 5,
                        border: "1px dashed var(--border, #2e3148)",
                        padding: "3px 7px",
                        cursor: "pointer",
                        fontSize: 11,
                        color: "var(--text3, #5a6080)"
                      }}
                    >
                      + {timeStr}
                    </div>
                  )}
                </div>
              );
            })}
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
              Нова подія — {formatDayTitle(selectedDay)} о {modalTime}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => setModalType("hearing")}
                  style={{
                    flex: 1, padding: "6px", borderRadius: 5, fontSize: 11, cursor: "pointer",
                    background: modalType === "hearing" ? "var(--accent, #4f7cff)" : "var(--surface2, #222536)",
                    color: modalType === "hearing" ? "#fff" : "var(--text, #e6e8f0)",
                    border: "1px solid var(--border, #2e3148)"
                  }}
                >Засідання</button>
                <button
                  onClick={() => setModalType("meeting")}
                  style={{
                    flex: 1, padding: "6px", borderRadius: 5, fontSize: 11, cursor: "pointer",
                    background: modalType === "meeting" ? "var(--accent, #4f7cff)" : "var(--surface2, #222536)",
                    color: modalType === "meeting" ? "#fff" : "var(--text, #e6e8f0)",
                    border: "1px solid var(--border, #2e3148)"
                  }}
                >Зустріч</button>
              </div>
              <input
                type="text"
                value={modalTitle}
                onChange={e => setModalTitle(e.target.value)}
                placeholder="Назва"
                style={{
                  background: "var(--surface, #1a1d27)",
                  border: "1px solid var(--border, #2e3148)",
                  borderRadius: 5, color: "var(--text, #e6e8f0)",
                  padding: "6px 8px", fontSize: 12
                }}
              />
              <input
                type="time"
                value={modalTime}
                onChange={e => setModalTime(e.target.value)}
                style={{
                  background: "var(--surface, #1a1d27)",
                  border: "1px solid var(--border, #2e3148)",
                  borderRadius: 5, color: "var(--text, #e6e8f0)",
                  padding: "6px 8px", fontSize: 12
                }}
              />
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
