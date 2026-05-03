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

const isValidHearing = h =>
  h &&
  h.status === 'scheduled' &&
  h.date &&
  h.time &&
  String(h.time).trim() !== '';

function getEventStyle(type, isPaused) {
  if (isPaused) {
    const borderColors = {
      hearing:  'rgba(79,124,255,0.5)',
      deadline: 'rgba(243,156,18,0.5)',
      note:     'rgba(46,204,113,0.5)',
      travel:   'rgba(155,89,182,0.5)'
    };
    return {
      bg:     'rgba(90,96,128,0.12)',
      border: borderColors[type] || 'rgba(90,96,128,0.5)',
      text:   '#9aa0b8',
      label:  '#7f8fa6',
      dot:    '#5a6080'
    };
  }
  const colors = {
    hearing:  { bg:'rgba(79,124,255,0.15)', border:'#4f7cff', text:'var(--text,#e8eaf0)', label:'#4f7cff', dot:'#4f7cff' },
    deadline: { bg:'rgba(243,156,18,0.15)', border:'#f39c12', text:'var(--text,#e8eaf0)', label:'#f39c12', dot:'#f39c12' },
    note:     { bg:'rgba(46,204,113,0.15)', border:'#2ecc71', text:'var(--text,#e8eaf0)', label:'#2ecc71', dot:'#2ecc71' },
    travel:   { bg:'rgba(155,89,182,0.15)', border:'#9b59b6', text:'#9b59b6',             label:'#9b59b6', dot:'#9b59b6' }
  };
  return colors[type] || colors.note;
}

const EVENT_TYPE_LABEL = {
  hearing:  'Засідання',
  deadline: 'Дедлайн',
  note:     'Нотатка',
  travel:   'Дорога'
};

const EVENT_TYPE_ICON = {
  hearing:  '⚖️',
  deadline: '⏰',
  note:     '📝',
  travel:   '🚗'
};

function CaseDropdown({ value, onChange, cases, placeholder, error }) {
  const [open, setOpen] = useState(false);
  const selected = cases.find(c => String(c.id) === String(value));
  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '6px 8px', borderRadius: 5, cursor: 'pointer',
          background: 'var(--surface2,#222536)', color: 'var(--text,#e8eaf0)',
          border: error ? '1px solid #e74c3c' : '1px solid var(--border,#2e3148)',
          fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.name : <span style={{ color: 'var(--text3,#5a6080)' }}>{placeholder}</span>}
        </span>
        <span style={{ opacity: 0.5, marginLeft: 6 }}>▾</span>
      </div>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1100 }} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1101,
            background: 'var(--surface,#1a1d27)',
            border: '1px solid var(--border,#2e3148)',
            borderRadius: 5, maxHeight: 200, overflowY: 'auto', marginTop: 2,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)'
          }}>
            <div
              onClick={() => { onChange(''); setOpen(false); }}
              style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--text3,#5a6080)' }}
            >
              {placeholder}
            </div>
            {cases.map(c => (
              <div
                key={c.id}
                onClick={() => { onChange(c.id); setOpen(false); }}
                style={{
                  padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                  background: String(value) === String(c.id) ? 'rgba(79,124,255,0.15)' : 'transparent',
                  color: 'var(--text,#e8eaf0)'
                }}
              >
                {c.name}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
const SLOTS_START_MIN = parseTimeMin(SLOTS[0]);
const SLOTS_END_MIN = parseTimeMin(SLOTS[SLOTS.length - 1]) + SLOT_MIN;

function TimePicker({ value, onChange, label, required, error, onClear }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ position: 'relative' }}>
      {label && (
        <div style={{ fontSize: 10, color: 'var(--text3, #5a6080)', marginBottom: 2 }}>
          {label}{required ? ' *' : ''}
        </div>
      )}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '6px 10px', borderRadius: 5, cursor: 'pointer',
          background: 'var(--surface, #1a1d27)',
          color: 'var(--text, #e8eaf0)',
          border: error ? '1px solid #e74c3c' : '1px solid var(--border, #2e3148)',
          fontSize: 12,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}
      >
        <span>{value || '—'}</span>
        <span style={{ opacity: 0.4, fontSize: 10 }}>▾</span>
      </div>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 1098 }}
          />
          <div style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 1099,
            background: 'var(--surface, #1a1d27)',
            border: '1px solid var(--border, #2e3148)',
            borderRadius: 8, padding: 8, marginTop: 4,
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 4, width: 220,
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
          }}>
            {SLOTS.map(slot => (
              <button
                key={slot}
                type="button"
                onClick={() => { onChange(slot); setOpen(false); }}
                style={{
                  padding: '6px 2px', borderRadius: 5, border: 'none',
                  background: value === slot ? 'var(--accent, #4f7cff)' : 'var(--surface2, #222536)',
                  color: value === slot ? '#fff' : 'var(--text, #e8eaf0)',
                  fontSize: 11, cursor: 'pointer', textAlign: 'center'
                }}
              >
                {slot}
              </button>
            ))}
            {onClear && (
              <button
                type="button"
                onClick={() => { onClear(); setOpen(false); }}
                style={{
                  gridColumn: '1 / -1',
                  padding: '6px', borderRadius: 5, border: 'none',
                  background: 'transparent',
                  color: 'var(--text3,#5a6080)',
                  fontSize: 11, cursor: 'pointer', textAlign: 'center',
                  marginTop: 2
                }}
              >
                Прибрати час
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function mergeNoteGroups(notes) {
  const used = new Set();
  const groups = [];
  notes.forEach(n => {
    if (used.has(n.id)) return;
    let start = parseTimeMin(n.time);
    let end = start + (n.duration || 60);
    const grp = [n];
    used.add(n.id);
    let changed = true;
    while (changed) {
      changed = false;
      notes.forEach(other => {
        if (used.has(other.id)) return;
        const oStart = parseTimeMin(other.time);
        const oEnd = oStart + (other.duration || 60);
        if (start < oEnd && end > oStart) {
          grp.push(other);
          used.add(other.id);
          start = Math.min(start, oStart);
          end = Math.max(end, oEnd);
          changed = true;
        }
      });
    }
    groups.push(grp);
  });
  return groups;
}

function addMinutesToTime(t, min) {
  const total = parseTimeMin(t) + min;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function SlotsColumn({ day, events, slotDrag, conflicts, style, onEmptyClick, onNoteClick, onHearingClick, expandedSlot, setExpandedSlot }) {
  const evsInRange = events.filter(e => {
    if (!e.time) return false;
    const t = parseTimeMin(e.time);
    return t >= SLOTS_START_MIN && t < SLOTS_END_MIN;
  });

  const conflictIds = new Set((conflicts || []).map(c => c.id));

  const [pressedSlot, setPressedSlot] = useState(null);
  const pressTimerRef = useRef(null);
  const halfPressTimerRef = useRef(null);

  function colorsFor(ev, isConflict) {
    if (isConflict) return { border: "#e74c3c", bg: "rgba(231,76,60,.2)", text: "#e74c3c", label: "#e74c3c" };
    return getEventStyle(ev.type, ev.isPaused);
  }

  const isDraggingHere = slotDrag.isDragging && slotDrag.dragContext === day;

  function clearTimers() {
    if (halfPressTimerRef.current) { clearTimeout(halfPressTimerRef.current); halfPressTimerRef.current = null; }
    if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
    setPressedSlot(null);
  }

  function handleTouchStart(slotIdx) {
    halfPressTimerRef.current = setTimeout(() => setPressedSlot(slotIdx), 300);
    pressTimerRef.current = setTimeout(() => {
      slotDrag.startDrag(slotIdx, day);
      setPressedSlot(null);
      if (navigator.vibrate) { try { navigator.vibrate(50); } catch {} }
    }, 600);
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
    let dragStarted = false;
    function onMove(ev) {
      if (!dragStarted && Math.abs(ev.clientY - startY) >= 5) {
        dragStarted = true;
        slotDrag.startDrag(slotIdx, day);
      }
      if (!dragStarted) return;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const slotEl = el?.closest('[data-slot-idx]');
      if (slotEl) {
        const idx = parseInt(slotEl.dataset.slotIdx, 10);
        const ctx = slotEl.dataset.ctx || null;
        slotDrag.updateDrag(idx, ctx);
      }
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (dragStarted && slotDrag.isDraggingNow()) slotDrag.endDrag();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  return (
    <div
      onContextMenu={e => e.preventDefault()}
      style={{ position: "relative", display: "flex", flexDirection: "column", ...style }}
    >
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
      {(() => {
        const noteEvs = evsInRange.filter(e => e.type === 'note');
        const otherEvs = evsInRange.filter(e => e.type !== 'note');

        const mainEvs = otherEvs.filter(e => e.type === 'hearing' || e.type === 'travel');
        const otherNonMain = otherEvs.filter(e => e.type !== 'hearing' && e.type !== 'travel');
        const overlap = (a, b) => {
          const aS = parseTimeMin(a.time);
          const aE = aS + (a.duration || 60);
          const bS = parseTimeMin(b.time);
          const bE = bS + (b.duration || 60);
          return aS < bE && aE > bS;
        };
        const sideNotesByMain = {};
        const standaloneNotes = [];
        noteEvs.forEach(n => {
          const m = mainEvs.find(mn => overlap(n, mn));
          if (m) {
            sideNotesByMain[m.id] = sideNotesByMain[m.id] || [];
            sideNotesByMain[m.id].push(n);
          } else {
            standaloneNotes.push(n);
          }
        });

        const renderEvBlock = (ev, extra = {}, availableHeight = null) => {
          const dur = ev.duration || 60;
          const c = colorsFor(ev, conflictIds.has(ev.id));
          const endTime = ev.endTime || addMinutesToTime(ev.time, dur);
          const interactive = ev.type === 'hearing' || ev.type === 'note' || ev.type === 'travel';
          const icon = EVENT_TYPE_ICON[ev.type] || '📝';
          const typeLabel = EVENT_TYPE_LABEL[ev.type] || '';
          const caseName = ev.caseName || (ev.type === 'note' ? 'Загальна' : null);
          const text = ev.type === 'note'
            ? (ev.title || ev.text || '')
            : (ev.label || ev.court || '');
          const showLabel = ev.type !== 'note' || availableHeight == null || availableHeight >= 24;
          return (
            <div
              key={ev.id}
              onClick={interactive ? (e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                if ((ev.type === 'note' || ev.type === 'travel') && onNoteClick) onNoteClick(ev, rect);
                else if (ev.type === 'hearing' && onHearingClick) onHearingClick(ev, rect);
              } : undefined}
              style={{
                borderRadius: 5,
                border: `1px solid ${c.border}`,
                background: c.bg,
                padding: "2px 5px",
                fontSize: 10,
                overflow: "hidden",
                pointerEvents: interactive ? "auto" : "none",
                cursor: interactive ? "pointer" : "default",
                color: c.text || "var(--text, #e6e8f0)",
                ...extra
              }}
            >
              {showLabel && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, color: c.label || c.text, marginBottom: 1, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  <span style={{ opacity: ev.isPaused ? 0.4 : 1 }}>{icon}</span>
                  <span style={{ fontWeight: 600 }}>{typeLabel}</span>
                  {caseName && (
                    <>
                      <span style={{ opacity: 0.5 }}>·</span>
                      <span style={{ opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {caseName}
                      </span>
                    </>
                  )}
                </div>
              )}
              {text && (
                <div style={{ fontSize: 10, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {text}
                </div>
              )}
              {ev.time && (
                <div style={{ fontSize: 9, color: "var(--text3, #5a6080)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {ev.time}—{endTime}
                </div>
              )}
            </div>
          );
        };

        const otherBlocks = [];
        otherNonMain.forEach(ev => {
          const t = parseTimeMin(ev.time);
          const dur = ev.duration || 60;
          const top = ((t - SLOTS_START_MIN) / SLOT_MIN) * SLOT_H;
          const height = Math.max(SLOT_H - 2, (dur / SLOT_MIN) * SLOT_H - 1);
          otherBlocks.push(renderEvBlock(ev, { position: 'absolute', left: 2, right: 2, top, height, zIndex: 1 }));
        });
        mainEvs.forEach(ev => {
          const t = parseTimeMin(ev.time);
          const dur = ev.duration || 60;
          const top = ((t - SLOTS_START_MIN) / SLOT_MIN) * SLOT_H;
          const height = Math.max(SLOT_H - 2, (dur / SLOT_MIN) * SLOT_H - 1);
          const sideNotes = sideNotesByMain[ev.id] || [];
          const hasSide = sideNotes.length > 0;
          otherBlocks.push(renderEvBlock(ev, {
            position: 'absolute',
            left: 2,
            right: hasSide ? '22%' : 2,
            top, height, zIndex: 1
          }));
          if (hasSide) {
            const visible = sideNotes.slice(0, 3);
            const overflow = sideNotes.length - visible.length;
            otherBlocks.push(
              <div
                key={`side_${ev.id}`}
                style={{
                  position: 'absolute',
                  right: 2,
                  width: 'calc(20% - 2px)',
                  top, height,
                  zIndex: 2,
                  display: 'flex', flexDirection: 'column', gap: 1
                }}
              >
                {visible.map(n => {
                  const ns = getEventStyle('note', n.isPaused);
                  return (
                    <div
                      key={n.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        if (onNoteClick) onNoteClick(n, rect);
                      }}
                      title={n.title || ''}
                      style={{
                        flex: 1,
                        background: ns.bg,
                        border: `1px solid ${ns.border}`,
                        borderRadius: 3,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 9,
                        overflow: 'hidden',
                        color: ns.text
                      }}
                    >📝</div>
                  );
                })}
                {overflow > 0 && (
                  <div style={{ fontSize: 8, color: '#2ecc71', textAlign: 'center', lineHeight: 1 }}>
                    +{overflow}
                  </div>
                )}
              </div>
            );
          }
        });

        const groups = mergeNoteGroups(standaloneNotes);

        const noteBlocks = groups.map(grp => {
          const minStart = Math.min(...grp.map(n => parseTimeMin(n.time)));
          const maxEnd = Math.max(...grp.map(n => parseTimeMin(n.time) + (n.duration || 60)));
          const top = ((minStart - SLOTS_START_MIN) / SLOT_MIN) * SLOT_H;
          const height = Math.max(SLOT_H - 2, ((maxEnd - minStart) / SLOT_MIN) * SLOT_H - 1);
          const key = `${day}_${grp[0].time}_${grp[0].id}`;
          if (grp.length === 1) {
            return (
              <div key={key} style={{ position: 'absolute', left: 2, right: 2, top, height, zIndex: 2 }}>
                {renderEvBlock(grp[0], { height: '100%' }, height)}
              </div>
            );
          }
          // Merged block — single green container, all notes listed inside, click per-note
          const sorted = [...grp].sort((a, b) => parseTimeMin(a.time) - parseTimeMin(b.time));
          const allPaused = grp.every(n => n.isPaused);
          const groupStyle = getEventStyle('note', allPaused);
          const innerBg = allPaused ? 'rgba(90,96,128,0.18)' : 'rgba(46,204,113,0.08)';
          const heightPerNote = (height - 4 - (sorted.length - 1)) / sorted.length;
          const showItemLabel = heightPerNote >= 24;
          return (
            <div
              key={key}
              style={{
                position: 'absolute', left: 2, right: 2, top, height,
                zIndex: 2,
                borderRadius: 5,
                border: `1px solid ${groupStyle.border}`,
                background: groupStyle.bg,
                padding: 2,
                display: 'flex', flexDirection: 'column', gap: 1,
                overflow: 'hidden',
                boxSizing: 'border-box'
              }}
            >
              {sorted.map(n => {
                const nEnd = n.endTime || addMinutesToTime(n.time, n.duration || 60);
                const itemPaused = n.isPaused;
                return (
                  <div
                    key={n.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      if (onNoteClick) onNoteClick(n, rect);
                    }}
                    style={{
                      flex: '1 1 auto',
                      minHeight: 14,
                      padding: '1px 4px',
                      borderRadius: 3,
                      background: itemPaused ? 'rgba(90,96,128,0.18)' : innerBg,
                      cursor: 'pointer',
                      fontSize: 10,
                      lineHeight: 1.2,
                      overflow: 'hidden',
                      color: itemPaused ? '#9aa0b8' : 'var(--text, #e6e8f0)'
                    }}
                    title={`${n.time}—${nEnd} ${n.title || ''}`}
                  >
                    {showItemLabel && (
                      <div style={{
                        fontSize: 9,
                        color: itemPaused ? '#5a6080' : '#2ecc71',
                        opacity: itemPaused ? 0.6 : 1,
                        display: 'flex', alignItems: 'center', gap: 2,
                        marginBottom: 1,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                      }}>
                        <span style={{ opacity: itemPaused ? 0.4 : 1 }}>📝</span>
                        <span style={{ fontWeight: 600 }}>Нотатка</span>
                        {n.caseName && (
                          <>
                            <span style={{ opacity: 0.5 }}>·</span>
                            <span style={{ opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.caseName}</span>
                          </>
                        )}
                      </div>
                    )}
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <span style={{ fontSize: 9, color: 'var(--text3,#5a6080)', marginRight: 4 }}>
                        {n.time}
                      </span>
                      <span style={{ fontWeight: 600 }}>{n.title}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        });

        return [...otherBlocks, ...noteBlocks];
      })()}
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
  return c.hearings.filter(h => isValidHearing(h) && h.date >= todayStr).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}

function classifyDayHearings(hearings) {
  const withTime = (hearings || []).filter(h => h && h.time);
  const total = (hearings || []).length;

  if (total === 0) return 'none';
  if (total === 1) return 'none';
  if (total >= 3) return 'red';

  if (withTime.length < 2) return 'yellow';

  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const a = withTime[0], b = withTime[1];
  const aStart = toMin(a.time), aEnd = aStart + (a.duration || 120);
  const bStart = toMin(b.time), bEnd = bStart + (b.duration || 120);

  const overlaps = aStart < bEnd && aEnd > bStart;
  if (overlaps) return 'red';

  const gap = aStart >= bEnd ? (aStart - bEnd) : (bStart - aEnd);
  if (gap <= 120) return 'red';

  return 'yellow';
}

function findConflicts(cases) {
  const byDate = {};
  cases.forEach(c => {
    if (c.status !== 'active' && c.status) return; // призупинені/закриті — не накладки
    (c.hearings || []).filter(isValidHearing).forEach(h => {
      if (!byDate[h.date]) byDate[h.date] = [];
      byDate[h.date].push({
        hearingId: h.id,
        caseId: c.id,
        caseName: c.name,
        time: h.time || null,
        duration: h.duration || 120
      });
    });
  });

  return Object.entries(byDate)
    .map(([date, items]) => {
      const level = classifyDayHearings(items);
      if (level === 'none') return null;
      return { date, items, level };
    })
    .filter(Boolean);
}

function buildDashboardContext(cases, calendarEvents, selectedDay) {
  const today = new Date().toISOString().slice(0, 10);
  const visibleCases = cases.filter(c => c.status !== 'closed');
  const casesText = visibleCases.map(c => {
    const parts = [`[id:${c.id}] ${c.name}`];
    if (c.court) parts.push(c.court);
    const _nh = _getNextHearing(c);
    if (_nh) parts.push(`засідання ${_nh.id}: ${_nh.date}${_nh.time ? " " + _nh.time : ""}`);
    const _nd = (c.deadlines || []).filter(d => d.date >= today).sort((a,b) => a.date.localeCompare(b.date))[0];
    if (_nd) parts.push(`дедлайн ${_nd.date}${_nd.name ? " (" + _nd.name + ")" : ""}`);
    if (c.status === 'paused') parts.push('ПРИЗУПИНЕНА');
    else if (c.status) parts.push(c.status);
    if (c.next_action) parts.push(`→ ${c.next_action}`);
    return parts.join(" | ");
  }).join("\n");

  const eventsText = (calendarEvents && calendarEvents.length)
    ? calendarEvents.map(e => {
        const idPart = e.type === 'note' && e.noteId ? ` [noteId:${e.noteId}]` : '';
        const casePart = e.caseName ? ` {${e.caseName}}` : '';
        return `${e.date} ${e.time || ""} ${e.title} (${e.type})${idPart}${casePart}`;
      }).join("\n")
    : "немає";

  const conflicts = findConflicts(visibleCases);
  const conflictsText = conflicts.length
    ? conflicts.map(c => `${c.level === 'red' ? '⚠️' : '⚡'} ${c.date}: ${c.items.map(i => `${i.caseName}${i.time ? ' ' + i.time : ''}`).join(' і ')}`).join("\n")
    : "немає";

  return `Ти — календарний асистент АБ Левицького.
Сьогодні: ${today}.
ПОТОЧНИЙ ВИБРАНИЙ ДЕНЬ (selectedDay) у Day Panel: ${selectedDay}.
Твоя роль: відповідати на питання про розклад, справи, дедлайни. Керувати календарем (навігація, пошук подій). Змінювати дати засідань якщо адвокат просить. Створювати/редагувати/видаляти нотатки в календарі.

ОНТОЛОГІЯ:
Засідання існує ВИКЛЮЧНО всередині справи (hearings[]). Окремих засідань немає.
Дедлайн існує ВИКЛЮЧНО всередині справи (deadlines[]). Окремих дедлайнів немає.
Будь-яка дія над засіданням потребує case_name справи-власника.
ЗАБОРОНЕНО: "засідання не прив'язане до справи".

ЗАГАЛЬНИЙ ПРИНЦИП РОБОТИ:
Якщо команда неповна — виконай те що можеш з наявних даних,
потім в одному повідомленні запитай що бракує.
Не блокуй виконання через відсутність опційних параметрів.
Обов'язкові параметри (без яких дія неможлива) — питай одразу.
Опційні параметри (час, справа для нотатки) — виконай без них, потім запитай.
НІКОЛИ не відповідай просто текстом для команди навігації — завжди генеруй ACTION_JSON.

ЗАБОРОНЕНО — відповідай що не можеш:
- Змінювати дедлайни: "Дедлайни змінюються через Досьє або Quick Input"
- Додавати дедлайни: "Дедлайни додаються через Досьє або Quick Input"
- Змінювати статус справи (active/paused/closed): "Статус справи змінюється через головний агент або картку справи"
- Видаляти справу: "Видалення справи можливе тільки через реєстр справ"
- Створювати справу: "Створення справи — через Quick Input"
Не генеруй ACTION_JSON для жодної із заборонених дій.

Якщо користувач просить змінити дату засідання, час, або керувати нотатками — відповідай текстом І додавай в кінці ACTION_JSON блок.

═══════════ ФОРМАТ ACTION_JSON ═══════════

НАВІГАЦІЯ КАЛЕНДАРЯ:
ACTION_JSON: {"action":"navigate_calendar","year":2026,"month":10}
// Перейти на конкретний місяць (month: 1..12). Перемикає на view "month".

ACTION_JSON: {"action":"navigate_week","date":"2026-05-07"}
// Перейти на тиждень що містить цю дату. Перемикає на view "week" і встановлює selectedDay=date.

Якщо просять перейти на конкретний день — виконай ОБИДВІ команди разом:
ACTION_JSON: {"action":"navigate_calendar","year":2026,"month":5}
ACTION_JSON: {"action":"navigate_week","date":"2026-05-07"}

Підтримується і відносна навігація (на крок):
ACTION_JSON: {"action":"navigate_calendar","direction":"prev"}
ACTION_JSON: {"action":"navigate_calendar","direction":"next"}
ACTION_JSON: {"action":"navigate_week","direction":"prev"}
ACTION_JSON: {"action":"navigate_week","direction":"next"}

Якщо просять найбільш насичений день по справі — проаналізуй ДОДАТКОВІ ПОДІЇ і СПРАВИ нижче, обери дату з найбільшою кількістю подій по цій справі і виконай navigate_calendar + navigate_week на цю дату.

ЗАСІДАННЯ (тільки в межах справи):
ACTION_JSON: {"action":"update_hearing","case_name":"...","hearing_date":"YYYY-MM-DD","hearing_time":"HH:MM"}
// Перенос — замінює існуюче. Якщо кілька — додай "hearing_id".

ACTION_JSON: {"action":"add_hearing","case_name":"...","hearing_date":"YYYY-MM-DD","hearing_time":"HH:MM"}
// Додати НОВЕ.

ACTION_JSON: {"action":"delete_hearing","case_name":"...","hearing_date":"YYYY-MM-DD"}
// Або з "hearing_id".

НОТАТКИ В КАЛЕНДАРІ:
ACTION_JSON: {"action":"add_note","date":"YYYY-MM-DD","time":"HH:MM","case_name":"...","text":"..."}
// date — обов'язково. time, case_name — опційно.

ACTION_JSON: {"action":"update_note","noteId":"...","text":"...","date":"YYYY-MM-DD","time":"HH:MM","case_name":"..."}

ACTION_JSON: {"action":"delete_note","noteId":"...","case_name":"..."}
// noteId беремо з контексту (поле [noteId:...]).

ГРУПОВІ ДІЇ:
Якщо треба виконати кілька дій — окремий ACTION_JSON блок на кожну, в одній відповіді.
Приклад видалення кількох нотаток:
ACTION_JSON: {"action":"delete_note","noteId":"id1","case_name":"..."}
ACTION_JSON: {"action":"delete_note","noteId":"id2","case_name":"..."}

═══════════ ПРАВИЛА ДЛЯ НОТАТОК ═══════════

1. Нотатка в дашборді ЗАВЖДИ має дату.
2. Якщо користувач не назвав дату — використовуй selectedDay (${selectedDay}) автоматично. Не питай дату.
3. Після створення нотатки — перепитуй ТІЛЬКИ те чого не вистачає:
   - Якщо не було часу → запитай: "Додати час?"
   - Якщо не було справи → запитай: "Прив'язати до справи?"
   - Якщо обидва відсутні → запитай обидва в одному повідомленні
   - Якщо все є → просто підтвердь, не перепитуй
4. Якщо користувач вказав справу — знайди її в списку справ за назвою і використай case_name.
5. Тексту немає → "Що саме записати?"

Приклад повної команди:
"Нотатка по Брановському з 13:00 до 14:00: уточнити секретаря суду"
→ ACTION_JSON: {"action":"add_note","date":"${selectedDay}","time":"13:00","case_name":"Брановський","text":"уточнити секретаря суду"}
→ Відповідь: "✅ Нотатку додано на ${selectedDay} о 13:00 по справі Брановський"

Приклад неповної команди:
"Зроби нотатку: подзвонити клієнту"
→ ACTION_JSON: {"action":"add_note","date":"${selectedDay}","text":"подзвонити клієнту"}
→ Відповідь: "✅ Нотатку додано на ${selectedDay}. Додати час або прив'язати до справи?"

═══════════ ПРАВИЛО УТОЧНЕНЬ ДЛЯ ЗАСІДАНЬ ═══════════

add_hearing:
- Немає справи → "У якій справі?"
- Немає дати → "На яку дату?"
- Немає часу → НЕ питай. Додай без часу, скажи "час не вказано — уточни пізніше".

update_hearing (перенос):
- Немає справи → "У якій справі?"
- Є дата але немає часу → НЕ питай перед виконанням.
  Виконай перенос зі збереженням старого часу.
  У відповіді додай: "час [старий час] збережено — потрібен інший?"
  Якщо старого часу немає — додай: "час не вказано — уточни якщо потрібно".
- У справі кілька scheduled засідань → "Яке саме — [дата1] чи [дата2]?"
- Одне scheduled → виконуй без питань.

Після update_hearing вказуй: нову дату, час, якщо час не змінювався — "час збережено — потрібен інший?"

delete_hearing:
- Немає справи → "У якій справі?"
- Кілька scheduled → "Яке саме — [дата1] чи [дата2]?" НЕ обирай мовчки.
- Одне scheduled → виконуй без питань.

═══════════ ЗАГАЛЬНІ ПРАВИЛА ═══════════

- case_name має точно співпадати з назвою справи зі списку
- hearing_date і date завжди YYYY-MM-DD
- hearing_time і time у форматі HH:MM (24-годинний)
- ФОРМАТ ПИТАННЯ — одне коротке речення.
- Поки чекаєш відповіді на ОБОВ'ЯЗКОВЕ питання — НЕ додавай ACTION_JSON.
- ЗАБОРОНЕНО: мовчазний вибір першого варіанту коли їх кілька.
- ЗАБОРОНЕНО: "не вистачає даних" без питання, "я не маю доступу".

Інакше — відповідай текстом українською, коротко і по суті.

// ШАР 1 — Поточні дані системи:
СПРАВИ (${visibleCases.length}):
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

function calcTravelBlocks(startTime, endTime, travelMinutes) {
  if (!travelMinutes || travelMinutes <= 0 || !startTime) return null;
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const fromMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const half = Math.round(travelMinutes / 2);
  const startMin = toMin(startTime);
  const endMin = endTime ? toMin(endTime) : startMin + 120;
  return {
    before: {
      time: fromMin(Math.max(0, startMin - half)),
      duration: half,
      label: '🚗 Дорога туди'
    },
    after: {
      time: fromMin(endMin),
      duration: half,
      label: '🚗 Дорога назад'
    }
  };
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

export default function Dashboard({ cases, calendarEvents, onExecuteAction }) {
  const [curMonth, setCurMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(todayStr());
  const [calView, setCalView] = useState("month");
  const [agentInput, setAgentInput] = useState("");
  const [chatHistory, setChatHistory] = useState([]); // [{role:'user'|'assistant', content:string}]
  const [pendingSystemNote, setPendingSystemNote] = useState(""); // прихована нотатка для агента про невдалу дію
  const [agentLoading, setAgentLoading] = useState(false);
  const chatScrollRef = useRef(null);
  const [isListening, setIsListening] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDate, setModalDate] = useState(null);
  const [modalStart, setModalStart] = useState("10:00");
  const [modalEnd, setModalEnd] = useState("11:00");
  const [modalTitle, setModalTitle] = useState("");
  const [modalType, setModalType] = useState("hearing");
  const [modalCaseId, setModalCaseId] = useState('');
  const [modalShowTravel, setModalShowTravel] = useState(false);
  const [modalTravelMin, setModalTravelMin] = useState(60);
  const [caseIdError, setCaseIdError] = useState(false);
  const [timeError, setTimeError] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null); // { type, hearingId?, noteId?, caseId? }
  const [modalHasTime, setModalHasTime] = useState(true); // для нотатки — час опційний
  const [notePopup, setNotePopup] = useState(null);
  const [deadlinePopup, setDeadlinePopup] = useState(null);
  const [expandedSlot, setExpandedSlot] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState({});

  function getAllEvents() {
    const events = [];
    const pausedCaseIds = new Set(
      cases.filter(c => c.status === 'paused').map(c => String(c.id))
    );
    cases.forEach(c => {
      if (c.status === 'closed') return;
      const isPaused = c.status === 'paused';
      const color = isPaused ? '#7f8fa6' : null;
      (c.hearings || []).filter(isValidHearing).forEach(h => {
        events.push({
          id: "h_" + c.id + "_" + h.id,
          type: "hearing",
          title: c.name,
          caseName: c.name,
          date: h.date,
          time: h.time || null,
          court: h.court || c.court || null,
          duration: h.duration || 120,
          caseId: c.id,
          hearingId: h.id,
          color,
          isPaused
        });
      });
      (c.deadlines || []).forEach(dl => {
        events.push({
          id: "d_" + c.id + "_" + dl.id,
          type: "deadline",
          title: c.name,
          caseName: c.name,
          date: dl.date,
          time: null,
          label: dl.name || "дедлайн",
          caseId: c.id,
          deadlineId: dl.id,
          color,
          isPaused
        });
      });
    });
    const enrichedCalendar = (calendarEvents || []).map(e => ({
      ...e,
      isPaused: e.caseId != null && pausedCaseIds.has(String(e.caseId))
    }));
    return [...events, ...enrichedCalendar];
  }

  function getEventsForDay(dateStr) {
    return getAllEvents().filter(e => e.date === dateStr);
  }

  function checkConflicts(dateStr) {
    const hearings = getAllEvents()
      .filter(e => e.date === dateStr && e.type === 'hearing' && !e.isPaused);
    const level = classifyDayHearings(hearings);
    return { level, hearings: level !== 'none' ? hearings : [] };
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

  const allConflicts = findConflicts(cases);

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
    const isPaused = event.isPaused;

    const baseBorderColor = urgency === "urgent" ? "#e74c3c"
      : urgency === "warn" ? "#f39c12"
      : "#5a6080";
    const borderColor = isPaused ? "rgba(127,143,166,0.4)" : baseBorderColor;

    const badgeText = d === 0 ? "сьогодні" : d === 1 ? "завтра" : `${d} днів`;
    const badgeBg = isPaused
      ? "rgba(90,96,128,0.2)"
      : d <= 0 ? "rgba(231,76,60,.2)" : d <= 1 ? "rgba(243,156,18,.2)" : "rgba(79,124,255,.2)";
    const badgeColor = isPaused
      ? "#9aa0b8"
      : d <= 0 ? "#e74c3c" : d <= 1 ? "#f39c12" : "#4f7cff";

    const titleColor = isPaused ? "#9aa0b8" : "var(--text, #e6e8f0)";
    const subColor = isPaused ? "#7f8fa6" : "var(--text2, #9aa0b8)";

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
        <span style={{ fontSize: 15, opacity: isPaused ? 0.4 : 1 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: titleColor, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {event.title}
            </span>
            <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 600, background: badgeBg, color: badgeColor, whiteSpace: "nowrap" }}>
              {badgeText}
            </span>
          </div>
          <div style={{ fontSize: 11, color: subColor, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
  const dayConflict = checkConflicts(selectedDay);
  const hearingCount = dayEvents.filter(e => e.type === "hearing").length;
  const deadlineCount = dayEvents.filter(e => e.type === "deadline").length;

  const parts = [];
  if (hearingCount) parts.push(`${hearingCount} засідань`);
  if (deadlineCount) parts.push(`${deadlineCount} дедлайн${deadlineCount > 1 ? "и" : ""}`);
  const conflictText = dayConflict.level === 'red'
    ? ' · ⚠️ накладка!'
    : dayConflict.level === 'yellow'
    ? ' · ⚡ два засідання'
    : '';
  const subtitle = parts.length
    ? parts.join(" · ") + conflictText
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
    const exec = (act, params) => onExecuteAction
      ? onExecuteAction('dashboard_agent', act, params)
      : { success: false, error: 'onExecuteAction відсутня' };
    const fail = (error) => ({ ok: false, action: action.action, error });
    const okMsg = (message) => ({ ok: true, action: action.action, message });

    switch (action.action) {
      case "update_hearing": {
        const c = findCase(action.case_name);
        if (!c) return fail(`справу "${action.case_name || ''}" не знайдено`);
        if (!action.hearing_date) return fail("дата для переносу не вказана");
        const r = exec('update_hearing', {
          caseId: c.id,
          hearingId: action.hearing_id || null,
          date: action.hearing_date,
          time: action.hearing_time ? action.hearing_time : undefined,
        });
        if (r && r.success === false) return fail(r.error || 'не вдалося');
        return okMsg(`✅ Засідання у справі "${c.name}" перенесено на ${action.hearing_date}${action.hearing_time ? " о " + action.hearing_time : ""}`);
      }
      case "add_hearing": {
        const c = findCase(action.case_name);
        if (!c) return fail(`справу "${action.case_name || ''}" не знайдено`);
        if (!action.hearing_date) return fail("дата засідання не вказана");
        const r = exec('add_hearing', {
          caseId: c.id,
          date: action.hearing_date,
          time: action.hearing_time || '',
          duration: 120,
        });
        if (r && r.success === false) return fail(r.error || 'не вдалося');
        return okMsg(`✅ Нове засідання у справі "${c.name}" на ${action.hearing_date}${action.hearing_time ? " о " + action.hearing_time : ""}`);
      }
      case "delete_hearing": {
        const c = findCase(action.case_name);
        if (!c) return fail(`справу "${action.case_name || ''}" не знайдено`);
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
        if (!hearingId) return fail(`у справі "${c.name}" немає засідання для видалення`);
        const r = exec('delete_hearing', { caseId: c.id, hearingId });
        if (r && r.success === false) return fail(r.error || 'не вдалося');
        return okMsg(`✅ Засідання у справі "${c.name}" видалено`);
      }
      case 'add_note': {
        const c = action.case_name ? findCase(action.case_name) : null;
        const dateStr = action.date || selectedDay;
        const r = exec('add_note', {
          caseId: c ? c.id : (action.caseId || null),
          text: action.text || action.note || '',
          date: dateStr,
          time: action.time || null,
          category: 'general'
        });
        if (r && r.success === false) return fail(r.error || 'не вдалося');
        return okMsg(c
          ? `✅ Нотатка у справі "${c.name}" збережена на ${dateStr}${action.time ? " о " + action.time : ""}`
          : `✅ Нотатка збережена на ${dateStr}${action.time ? " о " + action.time : ""}`);
      }
      case 'update_note': {
        if (!action.noteId) return fail("noteId не вказано");
        const c = action.case_name ? findCase(action.case_name) : null;
        const r = exec('update_note', {
          noteId: action.noteId,
          text: action.text,
          date: action.date,
          time: action.time,
          caseId: c ? c.id : (action.caseId !== undefined ? action.caseId : undefined)
        });
        if (r && r.success === false) return fail(r.error || 'не вдалося');
        return okMsg(`✅ Нотатку оновлено`);
      }
      case 'delete_note': {
        if (!action.noteId) return fail("noteId не вказано");
        const c = action.case_name ? findCase(action.case_name) : null;
        const r = exec('delete_note', {
          noteId: action.noteId,
          caseId: c ? c.id : (action.caseId || null)
        });
        if (r && r.success === false) return fail(r.error || 'не вдалося');
        return okMsg(`✅ Нотатку видалено`);
      }
      case "navigate_calendar": {
        setCalView("month");
        if (typeof action.year === "number" && typeof action.month === "number") {
          const y = action.year;
          const m = Math.min(12, Math.max(1, action.month)) - 1;
          setCurMonth(new Date(y, m, 1));
          const monthName = MONTHS_GEN ? MONTHS_GEN[m] : (m + 1);
          return okMsg(`📅 ${monthName} ${y}`);
        }
        if (action.direction === "prev") {
          setCurMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
          return okMsg("📅 Попередній місяць");
        }
        if (action.direction === "next") {
          setCurMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
          return okMsg("📅 Наступний місяць");
        }
        return fail("навігація без параметрів");
      }
      case "navigate_week": {
        setCalView("week");
        if (action.date && /^\d{4}-\d{2}-\d{2}$/.test(action.date)) {
          setSelectedDay(action.date);
          const d = new Date(action.date);
          setCurMonth(new Date(d.getFullYear(), d.getMonth(), 1));
          return okMsg(`📅 Тиждень з ${action.date}`);
        }
        if (action.direction === "prev") { shiftWeek(-7); return okMsg("📅 Попередній тиждень"); }
        if (action.direction === "next") { shiftWeek(7); return okMsg("📅 Наступний тиждень"); }
        return fail("навігація без параметрів");
      }
      default:
        return fail(`невідома дія "${action.action}"`);
    }
  }

  function parseAllActionJSON(text) {
    const actions = [];
    const ranges = [];
    let searchFrom = 0;
    while (true) {
      const idx = text.indexOf("ACTION_JSON:", searchFrom);
      if (idx === -1) break;
      const start = text.indexOf("{", idx);
      if (start === -1) break;
      let depth = 0, end = -1;
      for (let i = start; i < text.length; i++) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") {
          depth--;
          if (depth === 0) { end = i; break; }
        }
      }
      if (end === -1) break;
      try {
        actions.push(JSON.parse(text.slice(start, end + 1)));
        ranges.push([idx, end + 1]);
      } catch (e) {}
      searchFrom = end + 1;
    }
    return { actions, ranges };
  }

  function handleAgentResponse(text) {
    const { actions, ranges } = parseAllActionJSON(text);
    if (!actions.length) return { text, failures: [] };
    const successMsgs = [];
    const errorMsgs = [];
    const failures = [];
    for (const action of actions) {
      const r = handleDashboardAction(action);
      if (!r) continue;
      if (r.ok) {
        if (r.message) successMsgs.push(r.message);
      } else {
        errorMsgs.push(`❌ ${r.error}`);
        failures.push(r);
      }
    }
    let preface = text;
    if (ranges.length) {
      preface = text.slice(0, ranges[0][0]) + text.slice(ranges[ranges.length - 1][1]);
    }
    preface = preface.trim();

    // Одне фінальне повідомлення замість дублів:
    // - тільки помилки → показуємо тільки ❌ (без фейкового тексту агента)
    // - частково → ✅ + ❌
    // - все ОК → текст агента (preface) — він уже містить підтвердження.
    //   Якщо preface порожній — fallback на наші ✅ повідомлення.
    let finalText;
    if (errorMsgs.length && !successMsgs.length) {
      finalText = errorMsgs.join("\n");
    } else if (errorMsgs.length && successMsgs.length) {
      finalText = [...successMsgs, ...errorMsgs].join("\n");
    } else {
      finalText = preface || successMsgs.join("\n") || text;
    }
    return { text: finalText, failures };
  }

  async function handleAgentSend(inputOverride) {
    const input = (typeof inputOverride === "string" ? inputOverride : agentInput).trim();
    if (!input || agentLoading) return;

    const userMsg = { role: "user", content: input };
    // максимум 10 повідомлень у вікні контексту (5 пар user/assistant)
    const trimmed = chatHistory.slice(-10);
    const visibleHistory = [...trimmed, userMsg];
    setChatHistory(visibleHistory);
    setAgentInput("");
    setAgentLoading(true);

    // Якщо була невдала дія — невидимо вшиваємо її в user-payload щоб агент бачив контекст.
    const augmentedUser = pendingSystemNote
      ? { role: "user", content: `${pendingSystemNote}\n\n${input}` }
      : userMsg;
    const newHistory = [...trimmed, augmentedUser];
    if (pendingSystemNote) setPendingSystemNote("");

    try {
      const apiKey = localStorage.getItem("claude_api_key");
      if (!apiKey) {
        setChatHistory(h => [...h, { role: "assistant", content: "⚙️ Налаштуйте API ключ в Quick Input" }]);
        setAgentLoading(false);
        return;
      }

      const systemPrompt = buildDashboardContext(cases, calendarEvents, selectedDay);

      // Anthropic API вимагає щоб перше повідомлення було від user.
      const safeHistory = newHistory[0]?.role === 'user'
        ? newHistory
        : newHistory.slice(newHistory.findIndex(m => m.role === 'user'));

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 500,
          system: systemPrompt,
          messages: safeHistory
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
      const { text: cleanText, failures } = handleAgentResponse(rawText);
      setChatHistory(h => [...h, { role: "assistant", content: cleanText }]);
      if (failures.length) {
        // Зберігаємо нотатку для системи — буде префіксом до наступного user-message,
        // щоб агент знав реальний результат і не повторював помилку.
        const sysMsg = failures.map(f =>
          `[SYSTEM] Дія "${f.action}" не виконана. Причина: ${f.error}.`
        ).join('\n');
        setPendingSystemNote(sysMsg);
      } else if (pendingSystemNote) {
        setPendingSystemNote("");
      }
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
    setModalType("hearing");
    setModalCaseId('');
    setModalShowTravel(false);
    setModalTravelMin(60);
    setCaseIdError(false);
    setTimeError(false);
    setEditingEvent(null);
    setModalHasTime(true);
    setModalOpen(true);
  }

  function openModalEditHearing(event) {
    const c = cases.find(cs => cs.id === event.caseId);
    const h = c && (c.hearings || []).find(hh => hh.id === event.hearingId);
    if (!h) return;
    const day = h.date;
    setModalDate(day);
    setSelectedDay(day);
    setModalStart(h.time || '10:00');
    setModalEnd(h.time ? addMinutesToTime(h.time, h.duration || 120) : '12:00');
    setModalTitle('');
    setModalType('hearing');
    setModalCaseId(c.id);
    setModalShowTravel(false);
    setCaseIdError(false);
    setTimeError(false);
    setEditingEvent({ type: 'hearing', hearingId: h.id, caseId: c.id });
    setModalHasTime(true);
    setModalOpen(true);
  }

  function openModalEditNote(popup) {
    const day = popup.date || selectedDay;
    setModalDate(day);
    setSelectedDay(day);
    setModalType('note');
    setModalTitle(popup.text || '');
    setModalCaseId(popup.caseId || '');
    setModalHasTime(!!popup.time);
    if (popup.time) {
      setModalStart(popup.time);
      setModalEnd(addMinutesToTime(popup.time, popup.duration || 60));
    } else {
      setModalStart('10:00');
      setModalEnd('11:00');
    }
    setCaseIdError(false);
    setTimeError(false);
    setEditingEvent({ type: 'note', noteId: popup.noteId, caseId: popup.caseId });
    setModalOpen(true);
  }

  function handleNoteClick(ev, rect) {
    const c = cases.find(cs => String(cs.id) === String(ev.caseId));
    const isTravel = ev.type === 'travel' || ev.category === 'travel';
    setNotePopup({
      noteId: ev.noteId || ev.id,
      text: ev.title || '',
      caseId: ev.caseId || null,
      caseName: c ? c.name : (ev.caseName || null),
      time: ev.time || null,
      duration: ev.duration || 60,
      date: ev.date,
      anchorRect: rect,
      readonly: isTravel,
      isTravel
    });
  }

  function handleDeadlineClick(ev, rect) {
    const c = cases.find(cs => String(cs.id) === String(ev.caseId));
    setDeadlinePopup({
      title: ev.label || ev.title || 'Дедлайн',
      caseName: c ? c.name : (ev.title || null),
      date: ev.date,
      anchorRect: rect || { top: 100, left: 100, right: 100 }
    });
  }

  async function saveEvent() {
    const title = modalTitle.trim();
    const day = modalDate || selectedDay;
    const time = modalStart;
    const endTime = modalEnd;
    const travelMinutes = modalShowTravel ? modalTravelMin : 0;
    const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

    if (modalType === 'hearing') {
      let hasError = false;
      if (!modalCaseId) { setCaseIdError(true); hasError = true; }
      if (!time || !String(time).trim()) { setTimeError(true); hasError = true; }
      if (hasError) return;

      if (time && !editingEvent) {
        const startMin = toMin(time);
        const dur = (time && endTime) ? toMin(endTime) - startMin : 120;
        const dayHearings = getAllEvents().filter(e =>
          e.date === day && e.type === 'hearing' && e.time
        );
        const hasOverlap = dayHearings.some(e => {
          const eStart = toMin(e.time);
          const eEnd = eStart + (e.duration || 120);
          return startMin < eEnd && (startMin + dur) > eStart;
        });
        if (hasOverlap) {
          const ok = await systemConfirm('Є накладка за часом. Зберегти попри все?', 'Накладка засідань');
          if (!ok) return;
        }
      }

      const duration = (time && endTime)
        ? toMin(endTime) - toMin(time)
        : 120;

      if (editingEvent?.hearingId) {
        onExecuteAction('dashboard_agent', 'update_hearing', {
          caseId: modalCaseId,
          hearingId: editingEvent.hearingId,
          date: day,
          time,
          duration
        });
      } else {
        onExecuteAction('dashboard_agent', 'add_hearing', {
          caseId: modalCaseId,
          date: day,
          time: time || null,
          duration
        });
      }

      if (!editingEvent && travelMinutes && travelMinutes > 0 && time) {
        const travel = calcTravelBlocks(time, endTime, travelMinutes);
        if (travel) {
          onExecuteAction('dashboard_agent', 'add_note', {
            text: travel.before.label,
            date: day,
            time: travel.before.time,
            duration: travel.before.duration,
            caseId: modalCaseId,
            category: 'travel'
          });
          onExecuteAction('dashboard_agent', 'add_note', {
            text: travel.after.label,
            date: day,
            time: travel.after.time,
            duration: travel.after.duration,
            caseId: modalCaseId,
            category: 'travel'
          });
        }
      }

    } else if (modalType === 'note') {
      if (!title) return;
      const noteTime = modalHasTime ? (time || null) : null;
      const noteDuration = (modalHasTime && time && endTime) ? Math.max(30, toMin(endTime) - toMin(time)) : null;

      if (modalHasTime && noteTime && !editingEvent) {
        const newStart = toMin(noteTime);
        const newEnd = newStart + (noteDuration || 60);
        const overlapping = getAllEvents().filter(e =>
          e.date === day && e.type === 'note' && e.time && (() => {
            const eStart = toMin(e.time);
            const eEnd = eStart + (e.duration || 60);
            return newStart < eEnd && newEnd > eStart;
          })()
        );
        if (overlapping.length > 0) {
          const ok = await systemConfirm('На цей час вже є нотатка. Додати ще одну?', 'Накладка нотаток');
          if (!ok) return;
        }
      }

      if (editingEvent?.noteId) {
        onExecuteAction('dashboard_agent', 'update_note', {
          noteId: editingEvent.noteId,
          text: title,
          date: day,
          time: noteTime,
          duration: noteDuration,
          caseId: modalCaseId || null
        });
      } else {
        onExecuteAction('dashboard_agent', 'add_note', {
          text: title,
          date: day,
          time: noteTime,
          duration: noteDuration,
          caseId: modalCaseId || null,
          category: 'general'
        });
      }
    }

    setModalOpen(false);
    setModalCaseId('');
    setModalTitle("");
    setModalType("hearing");
    setEditingEvent(null);
    setModalHasTime(true);
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
                  const events = cell.other ? [] : getEventsForDay(cell.dateStr);
                  const hearings = events.filter(e => e.type === "hearing");
                  const deadlines = events.filter(e => e.type === "deadline");
                  const notesOnDay = events.filter(e => e.type === "note");
                  const conflictLevel = classifyDayHearings(hearings.filter(h => !h.isPaused));
                  const isToday = cell.dateStr === today;
                  const isSelected = cell.dateStr === selectedDay;

                  let borderColor = "var(--border, #2e3148)";
                  if (conflictLevel === 'red') borderColor = "#e74c3c";
                  else if (conflictLevel === 'yellow') borderColor = "#f39c12";
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
                      <div style={{ display: "flex", gap: 2, flexWrap: "wrap", justifyContent: "center" }}>
                        {hearings.slice(0,3).map((h, i) => (
                          <div key={"h"+i} style={{ width: 6, height: 6, borderRadius: "50%", background: h.isPaused ? "#5a6080" : "#4f7cff" }} />
                        ))}
                        {deadlines.slice(0,2).map((d, i) => (
                          <div key={"d"+i} style={{ width: 6, height: 6, borderRadius: "50%", background: d.isPaused ? "#5a6080" : "#f39c12" }} />
                        ))}
                        {notesOnDay.slice(0,2).map((n, i) => (
                          <div key={"n"+i} style={{ width: 6, height: 6, borderRadius: "50%", background: n.isPaused ? "#5a6080" : "#2ecc71" }} />
                        ))}
                      </div>
                      {conflictLevel === 'red' && <span style={{ fontSize: 8 }}>⚠️</span>}
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
                    onNoteClick={handleNoteClick}
                    onHearingClick={(ev, rect) => openModalEditHearing(ev)}
                    expandedSlot={expandedSlot}
                    setExpandedSlot={setExpandedSlot}
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
          {(() => {
            const redConflicts = allConflicts.filter(c => c.level === 'red');
            const yellowConflicts = allConflicts.filter(c => c.level === 'yellow');
            return (
              <>
                {redConflicts.length > 0 && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "3px 8px",
                    background: "rgba(231,76,60,0.1)",
                    border: "1px solid rgba(231,76,60,0.3)",
                    borderRadius: 6,
                    fontSize: 10, color: "#e74c3c"
                  }}>
                    ⚠️ Накладки: {redConflicts.map(c => c.date).join(", ")}
                  </div>
                )}
                {yellowConflicts.length > 0 && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "3px 8px",
                    background: "rgba(243,156,18,0.1)",
                    border: "1px solid rgba(243,156,18,0.3)",
                    borderRadius: 6,
                    fontSize: 10, color: "#f39c12"
                  }}>
                    ⚡ Подвійні засідання: {yellowConflicts.map(c => c.date).join(", ")}
                  </div>
                )}
              </>
            );
          })()}
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
          <div style={{
            fontSize: 11,
            color: dayConflict.level === 'red' ? '#e74c3c'
              : dayConflict.level === 'yellow' ? '#f39c12'
              : 'var(--text3, #5a6080)',
            marginTop: 2
          }}>
            {subtitle}
          </div>
          {dayConflict.level === 'red' && (
            <div style={{ marginTop: 6, background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)',
              borderRadius: 6, padding: '4px 8px', fontSize: 11, color: '#e74c3c' }}>
              ⚠️ Накладка або забагато засідань на один день
            </div>
          )}
          {dayConflict.level === 'yellow' && (
            <div style={{ marginTop: 6, background: 'rgba(243,156,18,0.1)', border: '1px solid rgba(243,156,18,0.3)',
              borderRadius: 6, padding: '4px 8px', fontSize: 11, color: '#f39c12' }}>
              ⚡ Два засідання — перевір чи встигнеш
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "8px 10px" }}>
          {/* Агент */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text3, #5a6080)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>
              Агент
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "flex-end" }}>
              <textarea
                value={agentInput}
                onChange={e => setAgentInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAgentSend(); } }}
                placeholder="Команда для агента... (напр. «додай засідання»)"
                rows={2}
                style={{
                  flex: 1, minWidth: 0,
                  background: "var(--surface, #1a1d27)",
                  border: "1px solid var(--border, #2e3148)",
                  borderRadius: 5,
                  color: "var(--text, #e6e8f0)",
                  padding: "6px 8px",
                  fontSize: 11,
                  fontFamily: "inherit",
                  boxSizing: "border-box",
                  resize: "none",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  overflowWrap: "break-word"
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
                  height: 240,
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
                      maxWidth: "90%",
                      background: m.role === "user" ? "rgba(79,124,255,0.15)" : "var(--surface2, #222536)",
                      borderRadius: 6,
                      padding: "5px 8px",
                      fontSize: 11,
                      lineHeight: 1.4,
                      color: "var(--text, #e6e8f0)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      overflowWrap: "break-word",
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

          {/* Без часу — нотатки і дедлайни (вгорі, до часових слотів) */}
          {(() => {
            const eventsWithoutTime = dayEvents.filter(e => !e.time);
            if (!eventsWithoutTime.length) return null;
            const hasNotes = eventsWithoutTime.some(e => e.type === 'note');
            const hasDeadlines = eventsWithoutTime.some(e => e.type === 'deadline');
            const sectionTitle = [
              hasNotes && 'Нотатки',
              hasDeadlines && 'Дедлайни'
            ].filter(Boolean).join(' · ') || 'Без часу';
            return (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text3, #5a6080)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>
                  {sectionTitle}
                </div>
                {eventsWithoutTime.map(e => {
                  const palette = getEventStyle(e.type, e.isPaused);
                  const icon = EVENT_TYPE_ICON[e.type] || '📝';
                  const typeLabel = EVENT_TYPE_LABEL[e.type] || '';
                  const caseName = e.caseName || (e.type === 'note' ? 'Загальна' : null);
                  const text = e.type === 'note' ? (e.title || e.text || '') : (e.label || '');
                  return (
                    <div
                      key={e.id}
                      onClick={(ev) => {
                        const rect = ev.currentTarget.getBoundingClientRect();
                        if (e.type === 'deadline') handleDeadlineClick(e, rect);
                        else if (e.type === 'note') handleNoteClick(e, rect);
                      }}
                      style={{
                        borderRadius: 5,
                        border: `1px solid ${palette.border}`,
                        background: palette.bg,
                        padding: "4px 7px",
                        marginBottom: 3,
                        cursor: (e.type === 'deadline' || e.type === 'note') ? 'pointer' : 'default'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: palette.label || palette.text, marginBottom: 1 }}>
                        <span style={{ opacity: e.isPaused ? 0.4 : 1 }}>{icon}</span>
                        <span style={{ fontWeight: 600 }}>{typeLabel}</span>
                        {caseName && (
                          <>
                            <span style={{ opacity: 0.5 }}>·</span>
                            <span style={{ opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {caseName}
                            </span>
                          </>
                        )}
                      </div>
                      {text && (
                        <div style={{ fontSize: 11, fontWeight: 600, color: palette.text || 'var(--text, #e8eaf0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {text}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

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
                conflicts={dayConflict.level === 'red' ? dayConflict.hearings : []}
                onNoteClick={handleNoteClick}
                onHearingClick={(ev, rect) => openModalEditHearing(ev)}
                expandedSlot={expandedSlot}
                setExpandedSlot={setExpandedSlot}
                style={{ flex: 1 }}
              />
            </div>
          </div>

        </div>
      </div>

      {/* ── NOTE POPUP ── */}
      {notePopup && (
        <>
          <div
            onClick={() => setNotePopup(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 299 }}
          />
          <div style={{
            position: 'fixed',
            top: Math.min(notePopup.anchorRect.top, window.innerHeight - 280),
            left: (notePopup.anchorRect.right + 8 + 280 > window.innerWidth)
              ? Math.max(8, notePopup.anchorRect.left - 288)
              : notePopup.anchorRect.right + 8,
            width: 280,
            zIndex: 300,
            background: 'var(--surface,#1a1d27)',
            border: notePopup.isTravel
              ? '1px solid rgba(155,89,182,0.4)'
              : '1px solid var(--border,#2e3148)',
            borderRadius: 8,
            padding: 12,
            boxShadow: '0 4px 24px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 13 }}>{notePopup.isTravel ? '🚗' : '📝'}</span>
              {notePopup.caseName && (
                <span style={{ fontSize: 11, color: notePopup.isTravel ? '#9b59b6' : 'var(--accent,#4f7cff)', fontWeight: 600 }}>
                  {notePopup.caseName}
                </span>
              )}
              {notePopup.time && (
                <span style={{ fontSize: 10, color: 'var(--text3,#5a6080)', marginLeft: 'auto' }}>
                  {notePopup.time}{notePopup.duration ? ` · ${notePopup.duration} хв` : ''}
                </span>
              )}
            </div>
            <div style={{
              fontSize: 12,
              color: 'var(--text,#e8eaf0)',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 180,
              overflowY: 'auto',
              marginBottom: 10,
              padding: '6px 8px',
              background: 'var(--surface2,#222536)',
              borderRadius: 5
            }}>
              {notePopup.text}
            </div>
            {!notePopup.readonly && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => {
                    const popup = notePopup;
                    setNotePopup(null);
                    openModalEditNote(popup);
                  }}
                  style={{
                    flex: 1, padding: '6px', borderRadius: 5, border: 'none',
                    background: 'var(--surface2,#222536)', color: 'var(--text,#e8eaf0)',
                    fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', gap: 4
                  }}
                >
                  ✏️ Редагувати
                </button>
                <button
                  onClick={async () => {
                    const ok = await systemConfirm('Видалити цю нотатку?', 'Видалення нотатки', 'Видалити');
                    if (!ok) return;
                    onExecuteAction('dashboard_agent', 'delete_note', {
                      noteId: notePopup.noteId,
                      caseId: notePopup.caseId
                    });
                    setNotePopup(null);
                  }}
                  style={{
                    flex: 1, padding: '6px', borderRadius: 5, border: 'none',
                    background: 'rgba(231,76,60,0.1)', color: '#e74c3c',
                    fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', gap: 4
                  }}
                >
                  🗑️ Видалити
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── DEADLINE POPUP (read-only) ── */}
      {deadlinePopup && (
        <>
          <div
            onClick={() => setDeadlinePopup(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 299 }}
          />
          <div style={{
            position: 'fixed',
            top: Math.min(deadlinePopup.anchorRect.top, window.innerHeight - 220),
            left: (deadlinePopup.anchorRect.right + 8 + 280 > window.innerWidth)
              ? Math.max(8, deadlinePopup.anchorRect.left - 288)
              : deadlinePopup.anchorRect.right + 8,
            width: 280,
            zIndex: 300,
            background: 'var(--surface,#1a1d27)',
            border: '1px solid rgba(243,156,18,0.4)',
            borderRadius: 8,
            padding: 12,
            boxShadow: '0 4px 24px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 13 }}>⏰</span>
              <span style={{ fontSize: 11, color: '#f39c12', fontWeight: 600 }}>
                Дедлайн
              </span>
              <span style={{ fontSize: 10, color: 'var(--text3,#5a6080)', marginLeft: 'auto' }}>
                {deadlinePopup.date}
              </span>
            </div>
            <div style={{
              fontSize: 13,
              color: 'var(--text,#e8eaf0)',
              fontWeight: 600,
              marginBottom: 6
            }}>
              {deadlinePopup.title}
            </div>
            {deadlinePopup.caseName && (
              <div style={{
                fontSize: 11,
                color: 'var(--accent,#4f7cff)',
                marginBottom: 10
              }}>
                {deadlinePopup.caseName}
              </div>
            )}
            <div style={{
              fontSize: 10,
              color: 'var(--text3,#5a6080)',
              fontStyle: 'italic',
              padding: '6px 8px',
              background: 'var(--surface2,#222536)',
              borderRadius: 5
            }}>
              Дедлайни змінюються через Досьє або Quick Input
            </div>
          </div>
        </>
      )}

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
              {editingEvent ? 'Редагувати' : 'Нова подія'} — {formatDayTitle(modalDate || selectedDay)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
                <button onClick={() => setModalType('hearing')}
                  style={{ flex: 1, padding: '6px', borderRadius: 5, border: 'none', cursor: 'pointer',
                    background: modalType === 'hearing' ? 'var(--accent, #4f7cff)' : 'var(--surface2, #222536)',
                    color: 'var(--text, #e8eaf0)', fontSize: 12 }}>
                  ⚖️ Засідання
                </button>
                <button onClick={() => setModalType('note')}
                  style={{ flex: 1, padding: '6px', borderRadius: 5, border: 'none', cursor: 'pointer',
                    background: modalType === 'note' ? '#f1c40f' : 'var(--surface2, #222536)',
                    color: modalType === 'note' ? '#000' : 'var(--text, #e8eaf0)', fontSize: 12 }}>
                  📝 Нотатка
                </button>
              </div>
              {modalType === 'hearing' && (
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text3, #5a6080)', marginBottom: 3 }}>СПРАВА *</div>
                  <CaseDropdown
                    value={modalCaseId}
                    onChange={(v) => { setModalCaseId(v); if (caseIdError) setCaseIdError(false); }}
                    cases={cases.filter(c => c.status === 'active' || !c.status)}
                    placeholder="— Оберіть справу —"
                    error={caseIdError}
                  />
                  {caseIdError && (
                    <div style={{ fontSize: 10, color: '#e74c3c', marginTop: 3 }}>Оберіть справу</div>
                  )}
                </div>
              )}
              {modalType === 'note' && (
                <>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2, #9aa0b8)" }}>{editingEvent ? 'Редагувати нотатку' : 'Нова нотатка'}</div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text3, #5a6080)', marginBottom: 3 }}>
                      СПРАВА (необов'язково)
                    </div>
                    <CaseDropdown
                      value={modalCaseId}
                      onChange={setModalCaseId}
                      cases={cases.filter(c => c.status === 'active')}
                      placeholder="— Без прив'язки до справи —"
                    />
                  </div>
                  <textarea
                    placeholder="Текст нотатки..."
                    value={modalTitle}
                    onChange={e => setModalTitle(e.target.value)}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      minHeight: 80, padding: '8px',
                      borderRadius: 5, border: '1px solid var(--border, #2e3148)',
                      background: 'var(--surface2, #222536)', color: 'var(--text, #e8eaf0)',
                      fontSize: 12, resize: 'vertical', fontFamily: 'inherit',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word'
                    }}
                  />
                  <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, cursor:'pointer', color: 'var(--text2, #9aa0b8)' }}>
                    <input type="checkbox" checked={modalHasTime} onChange={e => setModalHasTime(e.target.checked)} />
                    Прив'язати до часу
                  </label>
                </>
              )}
              {modalType === 'hearing' && (
                <input
                  type="text"
                  value={modalTitle}
                  onChange={e => setModalTitle(e.target.value)}
                  placeholder="Назва події (опціонально)"
                  style={{
                    background: "var(--surface, #1a1d27)",
                    border: "1px solid var(--border, #2e3148)",
                    borderRadius: 5, color: "var(--text, #e6e8f0)",
                    padding: "6px 8px", fontSize: 12
                  }}
                />
              )}
              {(modalType === 'hearing' || modalHasTime) && (
                <div style={{ display: "flex", gap: 6 }}>
                  <div style={{ flex: 1 }}>
                    <TimePicker
                      value={modalStart}
                      onChange={v => { setModalStart(v); if (timeError) setTimeError(false); }}
                      label="Початок"
                      required={modalType === 'hearing'}
                      error={timeError}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TimePicker
                      value={modalEnd}
                      onChange={setModalEnd}
                      label="Кінець"
                    />
                  </div>
                </div>
              )}
              {timeError && (
                <div style={{ fontSize: 10, color: '#e74c3c', marginTop: -4 }}>Вкажіть час початку</div>
              )}
              {modalType === 'hearing' && (
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
                  >🚗 {modalShowTravel ? "Прибрати час на дорогу" : "Додати час на дорогу (ділиться порівну до і після)"}</button>
                  {modalShowTravel && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontSize: 10, color: "var(--text3, #5a6080)", marginBottom: 2 }}>Час на дорогу (всього)</div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {[60, 120, 180, 240, 300, 360].map(min => (
                          <button
                            key={min}
                            type="button"
                            onClick={() => setModalTravelMin(modalTravelMin === min ? 0 : min)}
                            style={{
                              padding: '4px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
                              fontSize: 11,
                              background: modalTravelMin === min
                                ? 'rgba(155,89,182,0.3)'
                                : 'var(--surface2, #222536)',
                              color: modalTravelMin === min ? '#9b59b6' : 'var(--text2, #9aa0b8)',
                              fontWeight: modalTravelMin === min ? 600 : 400
                            }}>
                            {min / 60} год
                          </button>
                        ))}
                      </div>
                      {(() => {
                        const tv = calcTravelBlocks(modalStart, modalEnd, modalTravelMin);
                        if (!tv) return null;
                        const beforeEnd = modalStart;
                        const afterEnd = (() => {
                          const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
                          const fromMin = m => `${String(Math.floor(Math.min(1439, m) / 60)).padStart(2, '0')}:${String(Math.min(1439, m) % 60).padStart(2, '0')}`;
                          const startMin = toMin(tv.after.time);
                          return fromMin(startMin + tv.after.duration);
                        })();
                        return (
                          <div style={{ fontSize: 10, color: '#9b59b6', marginTop: 4, lineHeight: 1.5 }}>
                            🚗 Туди: {tv.before.time}–{beforeEnd} ({tv.before.duration} хв)
                            <br/>
                            🚗 Назад: {tv.after.time}–{afterEnd} ({tv.after.duration} хв)
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
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
              {editingEvent?.hearingId && (
                <button
                  onClick={async () => {
                    const ok = await systemConfirm('Видалити це засідання?', 'Видалення засідання', 'Видалити');
                    if (!ok) return;
                    onExecuteAction('dashboard_agent', 'delete_hearing', {
                      caseId: editingEvent.caseId,
                      hearingId: editingEvent.hearingId
                    });
                    setModalOpen(false);
                    setEditingEvent(null);
                  }}
                  style={{
                    width: '100%', padding: '6px', borderRadius: 5, border: 'none',
                    background: 'rgba(231,76,60,0.1)', color: '#e74c3c',
                    fontSize: 12, cursor: 'pointer', marginTop: 6
                  }}
                >
                  🗑️ Видалити засідання
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
