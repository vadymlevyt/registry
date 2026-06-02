// ── ACTIONS REGISTRY ─────────────────────────────────────────────────────────
// Єдиний реєстр дій системи (ACTIONS), матриця повноважень (PERMISSIONS) і
// диспетчер executeAction, винесені з App.jsx у factory з deps injection.
//
// Контракт незмінний: executeAction(agentId, action, params, [userId]) — async,
// той самий 10-кроковий pipeline. App.jsx створює інстанс через createActions(deps)
// у тілі компонента (кожен render — як і раніше) і прокидає executeAction пропом
// у Dashboard/CaseDossier. НЕ глобальний сінглтон — спільний стан лишається в
// App.jsx, сюди він приходить через deps (getCases/setCases/…), не імпортується.
//
// Чисті/детерміновані залежності (документна валідація, sourcePolicy, timeStandards,
// тощо) лишаються прямими import — поведінка та сама що в App.jsx. Залежності зі
// станом React, побічними ефектами (Drive, audit, billing, eventBus) або
// заглушки permission-перевірок ін'єктуються через deps, щоб App підставляв
// реальні, а тести — ізольовані. Винос behavior-preserving: тіла ACTIONS
// дослівні, єдина трансформація — bare `cases.find(` → `getCases().find(`.

import { ensureCaseSaasFields, ensureCaseSaasAndEcitsFields } from './migrationService';
import { DEFAULT_TENANT, getCurrentUser } from './tenantService';
import { shouldAudit } from './auditLogService';
import {
  ECITS_SYNC_COMPLETED, ECITS_CASE_STATE_UPDATED,
  CASE_PARTIES_UPDATED, CASE_TEAM_UPDATED, CASE_PROCESS_PARTICIPANTS_UPDATED,
  PROCEEDING_COMPOSITION_UPDATED, DOCUMENT_MOVEMENT_CARD_UPDATED,
  DOCUMENT_ALTERNATIVE_SOURCE_ADDED,
} from './eventBusTopics';
import { canOverwrite, buildAlternativeSourceRecord } from './sourcePolicy';
import { validateDocument } from './documentFactory';
import { getTimeStandard, getCategoryDefaults, getVariantDefault } from './timeStandards';
import { MODULES, categoryForCase } from './moduleNames';
// TASK 3.2 — ACTION clean_document_text тягне готове ядро очистки (3.1).
// Імпорт ядра/адаптера ЛІНИВИЙ (dynamic import у handler'і): cleanTextDriveAdapter
// тягне ocrService → pdfjs-dist (DOMMatrix недоступний у Node-тест-середовищі);
// top-level import зламав би всі тести що вантажать actionsRegistry. Тести
// ін'єктують стаби через deps; прод вантажить ліниво на першу очистку.

// UI-only ACTIONS — не доступні агентам через ACTION_JSON, лише через executeAction
// з прапором _fromUI у params (виставляє UI-обробник). destroy_case реалізовано
// окремим UI-only шляхом (deleteCasePermanently) і тут не фігурує.
export const UI_ONLY_ACTIONS = new Set([
  'delete_document',
  'delete_proceeding',
]);

// TASK 0.3.5 v7 — ACTIONS які НЕ нараховуються в time_entries через
// executeAction-hook activityTracker.report. Системні дії, не робота адвоката.
// Принцип: автосинхронізація з ЄСІТС не повинна потрапити у білінг як case_work.
export const SYSTEM_ACTIONS_NO_BILLING = new Set([
  // Внутрішні (Billing Foundation v2)
  'track_session_start', 'track_session_end', 'batch_update',
  // Sync ACTIONS (TASK 0.3.5)
  'mark_synced_from_ecits', 'update_case_ecits_state',
]);

// TASK 3.2 — ACTIONS які САМІ звітують у activityTracker (всередині свого
// handler'а), тому executeAction-hook НЕ має дублювати generic-звіт.
// Єдиний сенс (#11): «дія нараховує свій білінг сама — не нараховуй її вдруге».
// clean_document_text: ядро cleanTextService звітує 'agent_call' (agentType
// text_cleaner) при billAsUserAction:true — той самий сигнал, що й кнопки UI,
// які кличуть ту саму ACTION. Без цього виходило б два time_entries на одну
// очистку (agent_call + generic clean_document_text).
export const SELF_BILLING_ACTIONS = new Set([
  'clean_document_text',
]);

// TASK 0.3.5 v7 — edit-ACTIONS канонічної схеми (R1 AI-first дзеркало).
// Викликані з source 'manual' — нараховуються (адвокат через UI/агента редагує).
// Викликані з source 'court_sync' / 'metadata_extractor' — НЕ нараховуються
// (автосинхронізація). Розрізняє source у params.
//
// TASK 0.4 R5 fix: add_hearing/update_hearing додано — Court Sync синхронізує
// засідання з ЄСІТС, без R5 fix кожне витягнуте засідання потрапило б у
// time_entries[] як оплачуваний 'case_work' (хоча це автосинхронізація, не
// робота адвоката). Hearing-ACTIONS приймають params.source (TASK 0.3.5),
// тож існуюча source-aware гілка автоматично виключає виклики з 'court_sync'.
export const EDIT_ACTIONS_SOURCE_AWARE = new Set([
  'update_parties',
  'update_team',                          // не приймає source — завжди нараховується (internal)
  'update_process_participants',
  'update_proceeding_composition',
  'update_document_movement_card',
  'update_alternative_sources',
  'update_document_source',
  // TASK 0.4 R5
  'add_hearing',
  'update_hearing',
]);

// Чи candidateId є нащадком ancestorId у дереві проваджень.
// Використовується для перевірки циклів parentProcId у update_proceeding.
function isProceedingDescendant(proceedings, candidateId, ancestorId) {
  if (!Array.isArray(proceedings)) return false;
  let current = proceedings.find(p => p.id === candidateId);
  const visited = new Set();
  while (current && current.parentProcId) {
    if (visited.has(current.id)) return false; // safety guard від циклу в даних
    visited.add(current.id);
    if (current.parentProcId === ancestorId) return true;
    current = proceedings.find(p => p.id === current.parentProcId);
  }
  return false;
}

// createActions — factory. deps постачає App.jsx (реальні) або тести (ізольовані).
// Викликається в тілі App-компонента кожен render: getCases:()=>cases замикає
// поточний render-снапшот (ідентично попередньому inline `const ACTIONS`).
export function createActions(deps) {
  const {
    getCases,
    setCases,
    setNotes,
    setTimeEntries,
    saveNotesToLS,
    writeAudit,
    checkTenantAccess,
    checkRolePermission,
    checkCaseAccess,
    activityTracker,
    eventBus,
    deleteDriveFile,
    deleteOcrCacheForDocument,
    deleteExtendedForDocument,
    // TASK 3.2 — clean_document_text. getApiKey: () => claude_api_key (App.jsx
    // читає localStorage; null у тестах без AI). cleanDocument / build-deps —
    // DI-шви (тести стабують, бо торкаються Drive+AI); якщо не передані —
    // handler вантажить реальне ядро ліниво через dynamic import.
    getApiKey,
    cleanDocument: injectedCleanDocument,
    buildCleanDocumentDriveDeps: injectedBuildCleanDriveDeps,
  } = deps;

  // ── ACTIONS — єдиний реєстр дій системи ──────────────────────────────────
  const ACTIONS = {
    // ГРУПА 1 — Справи
    // TASK 0.4 розширення: підтримуються ДВА сумісні формати params:
    //   1) Legacy: { fields: {...} } — обгортка-об'єкт (всі попередні callers).
    //   2) Плоский (TASK 0.4): { name, case_no, ..., origin, ecitsState, parties,
    //      processParticipants } — Court Sync scenarioProcessor пише плоско.
    // Якщо передано обидва — плоскі ключі мають пріоритет над fields.
    //
    // Дедуплікація (R1 fix): якщо params.ecitsState.caseId передано і вже
    // існує справа з таким ecitsState.caseId — повертаємо
    // { success: false, error: 'duplicate_ecits_case', existingCaseId }.
    // Це дозволяє scenarioProcessor викликати update_case_ecits_state замість
    // дубліката.
    //
    // ensureCaseSaasAndEcitsFields (а не ensureCaseSaasFields) — додає v7
    // канонічний дефолт (ecitsState/parties/processParticipants) і v9 поле
    // origin: 'manual' за замовчуванням. Якщо caller передав origin —
    // зберігається його значення (з валідацією в ensureCase…).
    create_case: (params) => {
      const incoming = params || {};
      const base = (incoming.fields && typeof incoming.fields === 'object') ? incoming.fields : {};
      const { fields: _omit, ...flat } = incoming;
      const merged = { ...base, ...flat };

      const incomingEcitsCaseId = merged?.ecitsState?.caseId;
      if (incomingEcitsCaseId) {
        const existing = getCases().find(c => c?.ecitsState?.caseId === incomingEcitsCaseId);
        if (existing) {
          return {
            success: false,
            error: 'duplicate_ecits_case',
            existingCaseId: existing.id,
          };
        }
      }

      const newCase = ensureCaseSaasAndEcitsFields({
        id: `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        userId: 'vadym',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        hearings: [],
        deadlines: [],
        timeLog: [],
        pinnedNoteIds: [],
        agentHistory: [],
        ...merged,
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
      // 'documents' навмисно НЕ в allowlist: документи модифікуються через
      // окремі ACTIONS (add_document/add_documents/update_document/delete_document).
      // 'proceedings' — аналогічно (add_proceeding/update_proceeding/delete_proceeding).
      const allowedFields = [
        'name', 'client', 'court', 'case_no', 'category',
        'next_action', 'notes', 'judge', 'status',
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
      const targetCase = getCases().find(c => c.id === caseId);
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
    // TASK 0.3.5 v7: backward-compatible розширення новими опційними параметрами
    // (source, sourceConfidence, ecitsContext, assignedTo, attendedBy).
    // Якщо source не передано — fallback 'manual' з warning у консоль.
    add_hearing: ({
      caseId, date, time, duration = 120, type = null,
      source, sourceConfidence, ecitsContext, assignedTo, attendedBy,
    }) => {
      if (!date) {
        console.error("[VALIDATION] add_hearing відхилено: дата обов'язкова");
        return { success: false, error: "Дата засідання обов'язкова" };
      }
      if (!time || !String(time).trim()) {
        console.error("[VALIDATION] add_hearing відхилено: час обов'язковий");
        return { success: false, error: "Час засідання обов'язковий" };
      }
      const effectiveSource = source ?? 'manual';
      if (!source) {
        // eslint-disable-next-line no-console
        console.warn("[ACTION add_hearing] called without explicit source, falling back to 'manual'");
      }
      const isSystemSourced = effectiveSource === 'court_sync' || effectiveSource === 'metadata_extractor';
      const hearing = {
        id: `hrg_${Date.now()}`,
        date,
        time,
        duration,
        status: 'scheduled',
        type,
        // v7 поля (всі з безпечними дефолтами для backward-compat)
        source: effectiveSource,
        sourceConfidence: sourceConfidence ?? 'high',
        extractedAt: isSystemSourced ? new Date().toISOString() : null,
        ecitsContext: ecitsContext ?? null,
        assignedTo: assignedTo ?? null,
        attendedBy: Array.isArray(attendedBy) ? attendedBy : [],
      };
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, hearings: [...(c.hearings || []), hearing], updatedAt: new Date().toISOString() }
          : c
      ));
      return { success: true, hearingId: hearing.id };
    },

    update_hearing: ({
      caseId, hearingId, date, time, duration, type,
      source, sourceConfidence, ecitsContext, assignedTo, attendedBy,
    }) => {
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
          hearings: (c.hearings || []).map(h => {
            if (h.id !== targetId) return h;
            const isSystemUpdate = source === 'court_sync' || source === 'metadata_extractor';
            return {
              ...h,
              date: date ?? h.date,
              time: time ?? h.time,
              duration: duration ?? h.duration,
              type: type ?? h.type,
              // v7 поля — оновлюємо лише якщо передано (зберігаємо існуючі)
              ...(source !== undefined ? { source } : {}),
              ...(sourceConfidence !== undefined ? { sourceConfidence } : {}),
              ...(isSystemUpdate ? { extractedAt: new Date().toISOString() } : {}),
              ...(ecitsContext !== undefined ? { ecitsContext } : {}),
              ...(assignedTo !== undefined ? { assignedTo } : {}),
              ...(Array.isArray(attendedBy) ? { attendedBy } : {}),
            };
          }),
          updatedAt: new Date().toISOString()
        };
      }));
      return { success: true };
    },

    delete_hearing: ({ caseId, hearingId }) => {
      if (!caseId)    return { success: false, error: 'caseId не вказано' };
      if (!hearingId) return { success: false, error: 'hearingId не вказано' };
      const targetCase = getCases().find(c => c.id === caseId);
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
    add_time_entry: ({ caseId = null, date, duration, description, category, billable, type = 'manual_entry', captureMethod = 'manual' }) => {
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
        captureMethod: captureMethod || 'manual',
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

    // ГРУПА 5 — Документи і провадження (Phase 1.5)
    add_document: async ({ caseId, document }) => {
      if (!caseId)   return { success: false, error: "caseId обов'язковий" };
      if (!document) return { success: false, error: "document обов'язковий" };

      const { valid, errors } = validateDocument(document);
      if (!valid) {
        return { success: false, error: `Невалідний документ: ${errors.join(', ')}` };
      }

      const targetCase = getCases().find(c => c.id === caseId);
      if (!targetCase) {
        return { success: false, error: `Справу ${caseId} не знайдено` };
      }
      const existing = (targetCase.documents || []).find(d => d.id === document.id);
      if (existing) {
        return { success: false, error: `Документ ${document.id} вже існує у справі` };
      }

      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, documents: [...(c.documents || []), document], updatedAt: new Date().toISOString() }
          : c
      ));
      return {
        success: true,
        documentId: document.id,
        message: `Документ "${document.name}" додано у справу`
      };
    },

    add_documents: async ({ caseId, documents }) => {
      if (!caseId) return { success: false, error: "caseId обов'язковий" };
      if (!Array.isArray(documents) || documents.length === 0) {
        return { success: false, error: 'documents має бути непорожнім масивом' };
      }

      // Атомарна валідація — або всі додаються, або жоден.
      const validationErrors = [];
      for (let i = 0; i < documents.length; i++) {
        const { valid, errors } = validateDocument(documents[i]);
        if (!valid) {
          validationErrors.push(`Документ ${i} (${documents[i]?.name || documents[i]?.id || '?'}): ${errors.join(', ')}`);
        }
      }
      if (validationErrors.length > 0) {
        return {
          success: false,
          error: `Валідація не пройдена для ${validationErrors.length} документів`,
          errors: validationErrors,
        };
      }

      const targetCase = getCases().find(c => c.id === caseId);
      if (!targetCase) {
        return { success: false, error: `Справу ${caseId} не знайдено` };
      }
      const existingIds = new Set((targetCase.documents || []).map(d => d.id));
      const duplicates = documents.filter(d => existingIds.has(d.id));
      if (duplicates.length > 0) {
        return {
          success: false,
          error: `${duplicates.length} документів з такими id вже існують у справі`,
          duplicates: duplicates.map(d => d.id),
        };
      }

      setCases(prev => prev.map(c =>
        c.id === caseId
          ? {
              ...c,
              documents: [...(c.documents || []), ...documents],
              updatedAt: new Date().toISOString(),
            }
          : c
      ));
      return {
        success: true,
        addedCount: documents.length,
        documentIds: documents.map(d => d.id),
        message: `Додано ${documents.length} документів у справу`,
      };
    },

    update_document: async ({ caseId, documentId, fields }) => {
      if (!caseId || !documentId || !fields) {
        return { success: false, error: "caseId, documentId, fields обов'язкові" };
      }
      // Allowlist полів — захист від випадкового перезапису id/addedAt/addedBy/driveId.
      // lastOcrAt — мітка часу останнього успішного OCR (виставляється з UI
      // після reprocess, потрібна Viewer'у щоб триґернути перечитку 02_ОБРОБЛЕНІ).
      const ALLOWED_UPDATE_FIELDS = [
        'name', 'category', 'author', 'documentNature', 'namingStatus',
        'isKey', 'procId', 'driveUrl', 'folder', 'pageCount', 'date',
        'icon', 'status', 'lastOcrAt',
        // TASK 3.1 — формат витягнутого тексту після очистки (cleanTextService).
        'textFormat', 'cleanedAt'
      ];
      const invalidFields = Object.keys(fields).filter(f => !ALLOWED_UPDATE_FIELDS.includes(f));
      if (invalidFields.length > 0) {
        return {
          success: false,
          error: `Заборонено оновлювати поля: ${invalidFields.join(', ')}`,
        };
      }

      // CLAUDE.md правило #11 + рамка SoT: пайплайн AddDocumentModal спочатку
      // викликає add_document (setCases enqueue), далі await ocrService.extract
      // (секунди), потім update_document. До другого виклику React уже встиг
      // re-render — а замикання in-flight onSubmit досі тримає СТАРИЙ
      // executeAction зі СТАРИМ cases (без щойно доданого документа). Тому
      // читаємо актуальний стан через функціональний setCases(prev => …),
      // а outcome виносимо назовні. updater чистий: щось не знайдено —
      // повертаємо prev (без зайвого rerender), знайдено — повертаємо новий map.
      let outcome = null;
      setCases(prev => {
        const targetCase = prev.find(c => c.id === caseId);
        if (!targetCase) {
          outcome = { success: false, error: `Справу ${caseId} не знайдено` };
          return prev;
        }
        const docIdx = (targetCase.documents || []).findIndex(d => d.id === documentId);
        if (docIdx === -1) {
          outcome = { success: false, error: `Документ ${documentId} не знайдено у справі` };
          return prev;
        }
        const updatedDoc = {
          ...targetCase.documents[docIdx],
          ...fields,
          updatedAt: new Date().toISOString(),
        };
        const { valid, errors } = validateDocument(updatedDoc);
        if (!valid) {
          outcome = { success: false, error: `Невалідний документ після оновлення: ${errors.join(', ')}` };
          return prev;
        }
        outcome = {
          success: true,
          documentId,
          updatedFields: Object.keys(fields),
          message: `Документ "${updatedDoc.name}" оновлено`,
        };
        return prev.map(c =>
          c.id === caseId
            ? {
                ...c,
                documents: c.documents.map(d => d.id === documentId ? updatedDoc : d),
                updatedAt: new Date().toISOString(),
              }
            : c
        );
      });
      return outcome;
    },

    delete_document: async ({ caseId, documentId, mode = 'full' }) => {
      if (!caseId || !documentId) {
        return { success: false, error: "caseId і documentId обов'язкові" };
      }
      if (!['full', 'registry_only', 'archive'].includes(mode)) {
        return { success: false, error: `Невідомий режим: ${mode}` };
      }
      const targetCase = getCases().find(c => c.id === caseId);
      if (!targetCase) {
        return { success: false, error: `Справу ${caseId} не знайдено` };
      }
      const doc = (targetCase.documents || []).find(d => d.id === documentId);
      if (!doc) {
        return { success: false, error: `Документ ${documentId} не знайдено у справі` };
      }

      // Архівування — тільки status, файли і extended лишаються.
      if (mode === 'archive') {
        setCases(prev => prev.map(c =>
          c.id === caseId
            ? {
                ...c,
                documents: c.documents.map(d =>
                  d.id === documentId
                    ? { ...d, status: 'archived', updatedAt: new Date().toISOString() }
                    : d
                ),
                updatedAt: new Date().toISOString(),
              }
            : c
        ));
        return {
          success: true,
          mode: 'archive',
          documentId,
          message: `Документ "${doc.name}" архівовано`,
        };
      }

      // mode === 'full' або 'registry_only' — видаляємо з реєстру.
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? {
              ...c,
              documents: c.documents.filter(d => d.id !== documentId),
              updatedAt: new Date().toISOString(),
            }
          : c
      ));

      // Прибрати запис з documents_extended (graceful failure — не блокує реєстр).
      try {
        await deleteExtendedForDocument(caseId, targetCase, documentId);
      } catch (err) {
        console.warn('[delete_document] documents_extended cleanup failed:', err?.message || err);
      }

      if (mode === 'registry_only') {
        return {
          success: true,
          mode: 'registry_only',
          documentId,
          message: `Документ "${doc.name}" видалено з реєстру (файли лишились на Drive)`,
        };
      }

      // mode === 'full' — видалити ВСЕ що повʼязане з документом:
      //   • driveId (PDF з 01_ОРИГІНАЛИ — для конвертованих DOCX/HTML/image,
      //     або сам файл для PDF/інших)
      //   • originalDriveId (DOCX/HTML/інший оригінал поряд з PDF після TASK A
      //     конвертації — null для звичайних PDF/image)
      //   • OCR-кеш (.txt і .layout.json у 02_ОБРОБЛЕНІ)
      // Кожне видалення в окремий try/catch — падіння одного не блокує інші.
      // Реєстр уже почищено вище, навіть якщо Drive-операції впадуть, документ
      // у UI вже зник.
      if (doc.driveId) {
        try {
          await deleteDriveFile(doc.driveId);
        } catch (err) {
          console.warn(`[delete_document] Drive file delete failed: ${err?.message || err}`);
        }
      }
      if (doc.originalDriveId) {
        try {
          await deleteDriveFile(doc.originalDriveId);
        } catch (err) {
          console.warn(`[delete_document] Original file delete failed: ${err?.message || err}`);
        }
      }
      try {
        await deleteOcrCacheForDocument(targetCase, doc);
      } catch (err) {
        console.warn(`[delete_document] OCR cache cleanup failed: ${err?.message || err}`);
      }

      return {
        success: true,
        mode: 'full',
        documentId,
        message: `Документ "${doc.name}" видалено повністю (з реєстру і з Drive)`,
      };
    },

    add_proceeding: async ({ caseId, proceeding }) => {
      if (!caseId)     return { success: false, error: "caseId обов'язковий" };
      if (!proceeding) return { success: false, error: "proceeding обов'язковий" };
      // Поточна структура використовує title (див. seed proc_main). Приймаємо
      // також name як alias для дружнього API.
      const title = proceeding.title || proceeding.name;
      if (!proceeding.id || !title || !proceeding.type) {
        return { success: false, error: 'proceeding має мати id, title (або name), type' };
      }
      const targetCase = getCases().find(c => c.id === caseId);
      if (!targetCase) {
        return { success: false, error: `Справу ${caseId} не знайдено` };
      }
      const existingProcs = targetCase.proceedings || [];
      if (existingProcs.find(p => p.id === proceeding.id)) {
        return { success: false, error: `Провадження ${proceeding.id} вже існує` };
      }
      if (existingProcs.find(p => p.title === title)) {
        return { success: false, error: `Провадження з назвою "${title}" вже існує` };
      }
      if (proceeding.parentProcId) {
        if (!existingProcs.find(p => p.id === proceeding.parentProcId)) {
          return {
            success: false,
            error: `Батьківське провадження ${proceeding.parentProcId} не знайдено`,
          };
        }
      }
      const now = new Date().toISOString();
      const newProc = {
        ...proceeding,
        title,
        status: proceeding.status || 'active',
        parentProcId: proceeding.parentProcId || null,
        parentEventId: proceeding.parentEventId || null,
        addedAt: now,
        updatedAt: now,
      };
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, proceedings: [...existingProcs, newProc], updatedAt: now }
          : c
      ));
      return {
        success: true,
        proceedingId: newProc.id,
        message: `Провадження "${title}" додано у справу`,
      };
    },

    update_proceeding: async ({ caseId, proceedingId, fields }) => {
      if (!caseId || !proceedingId || !fields) {
        return { success: false, error: "caseId, proceedingId, fields обов'язкові" };
      }
      // Тип провадження не редагується (структурне рішення).
      const ALLOWED_UPDATE_FIELDS = [
        'title', 'parentProcId', 'parentEventId', 'color', 'court',
        'caseNumber', 'dateOpened', 'judges', 'description', 'status'
      ];
      const invalidFields = Object.keys(fields).filter(f => !ALLOWED_UPDATE_FIELDS.includes(f));
      if (invalidFields.length > 0) {
        return { success: false, error: `Заборонено оновлювати поля: ${invalidFields.join(', ')}` };
      }
      const targetCase = getCases().find(c => c.id === caseId);
      if (!targetCase) {
        return { success: false, error: `Справу ${caseId} не знайдено` };
      }
      const existingProcs = targetCase.proceedings || [];
      const proc = existingProcs.find(p => p.id === proceedingId);
      if (!proc) {
        return { success: false, error: `Провадження ${proceedingId} не знайдено` };
      }
      // Перевірка циклів parentProcId.
      if (fields.parentProcId !== undefined && fields.parentProcId !== null) {
        if (fields.parentProcId === proceedingId) {
          return { success: false, error: 'Провадження не може бути батьком самого себе' };
        }
        if (isProceedingDescendant(existingProcs, fields.parentProcId, proceedingId)) {
          return { success: false, error: 'Циклічна залежність — не можна зробити нащадка батьком' };
        }
        if (!existingProcs.find(p => p.id === fields.parentProcId)) {
          return { success: false, error: `Батьківське провадження ${fields.parentProcId} не знайдено` };
        }
      }
      const now = new Date().toISOString();
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? {
              ...c,
              proceedings: c.proceedings.map(p =>
                p.id === proceedingId ? { ...p, ...fields, updatedAt: now } : p
              ),
              updatedAt: now,
            }
          : c
      ));
      return {
        success: true,
        proceedingId,
        updatedFields: Object.keys(fields),
      };
    },

    delete_proceeding: async ({ caseId, proceedingId }) => {
      if (!caseId || !proceedingId) {
        return { success: false, error: "caseId і proceedingId обов'язкові" };
      }
      const targetCase = getCases().find(c => c.id === caseId);
      if (!targetCase) {
        return { success: false, error: `Справу ${caseId} не знайдено` };
      }
      const existingProcs = targetCase.proceedings || [];
      const proc = existingProcs.find(p => p.id === proceedingId);
      if (!proc) {
        return { success: false, error: `Провадження ${proceedingId} не знайдено` };
      }
      const children = existingProcs.filter(p => p.parentProcId === proceedingId);
      if (children.length > 0) {
        return {
          success: false,
          error: `Не можна видалити — є ${children.length} дочірніх проваджень. Спочатку видаліть або переприв'яжіть їх.`,
          childrenIds: children.map(c => c.id),
        };
      }
      const affectedDocs = (targetCase.documents || []).filter(d => d.procId === proceedingId);
      const now = new Date().toISOString();
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? {
              ...c,
              proceedings: c.proceedings.filter(p => p.id !== proceedingId),
              documents: (c.documents || []).map(d =>
                d.procId === proceedingId
                  ? { ...d, procId: null, updatedAt: now }
                  : d
              ),
              updatedAt: now,
            }
          : c
      ));
      return {
        success: true,
        proceedingId,
        affectedDocumentsCount: affectedDocs.length,
        message: `Провадження "${proc.title || proc.name}" видалено. ${affectedDocs.length} документів стали "без провадження".`,
      };
    },

    update_processing_context: async ({ caseId, context }) => {
      if (!caseId || !context) {
        return { success: false, error: "caseId і context обов'язкові" };
      }
      const requiredFields = ['processedAt', 'documentsCount', 'summary'];
      const missing = requiredFields.filter(f => context[f] === undefined || context[f] === null);
      if (missing.length > 0) {
        return { success: false, error: `У context відсутні поля: ${missing.join(', ')}` };
      }
      const targetCase = getCases().find(c => c.id === caseId);
      if (!targetCase) {
        return { success: false, error: `Справу ${caseId} не знайдено` };
      }
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, lastProcessingContext: context, updatedAt: new Date().toISOString() }
          : c
      ));
      return {
        success: true,
        message: 'Контекст обробки оновлено для справи',
      };
    },

    // ГРУПА 7 — ЄСІТС sync (TASK 0.3.5 v7)
    // mark_synced_from_ecits — позначає що справа була синхронізована з ЄСІТС.
    // Інкрементує syncMetrics counters і публікує eventBus подію.
    // Не пишеться в auditLog (це системна дія, не критична).
    // Виключена з activityTracker-hook (див. SYSTEM_ACTIONS_NO_BILLING).
    mark_synced_from_ecits: ({
      caseId,
      status = 'synced',
      failureReason = null,
      durationMs = null,
      documentsCount = 0,
      hearingsCount = 0,
    }) => {
      if (!caseId) return { success: false, error: "caseId обов'язковий" };
      const userId = getCurrentUser().userId;
      const tenantId = getCurrentUser().tenantId;
      const timestamp = new Date().toISOString();
      let found = false;
      setCases(prev => prev.map(c => {
        if (c.id !== caseId) return c;
        found = true;
        const currentMetrics = c.ecitsState?.syncMetrics || {
          totalSyncs: 0, successfulSyncs: 0, failedSyncs: 0,
          documentsExtracted: 0, hearingsExtracted: 0, lastDurationMs: null,
        };
        return {
          ...c,
          ecitsState: {
            ...(c.ecitsState || {}),
            lastSyncedAt: timestamp,
            lastSyncedBy: userId,
            syncStatus: status,
            failureReason,
            syncMetrics: {
              totalSyncs: currentMetrics.totalSyncs + 1,
              successfulSyncs: currentMetrics.successfulSyncs + (status === 'synced' ? 1 : 0),
              failedSyncs: currentMetrics.failedSyncs + (status === 'failed' ? 1 : 0),
              documentsExtracted: currentMetrics.documentsExtracted + (Number.isFinite(documentsCount) ? documentsCount : 0),
              hearingsExtracted: currentMetrics.hearingsExtracted + (Number.isFinite(hearingsCount) ? hearingsCount : 0),
              lastDurationMs: durationMs ?? null,
            },
          },
          updatedAt: timestamp,
        };
      }));
      if (!found) return { success: false, error: `Справу ${caseId} не знайдено` };
      try {
        eventBus.publish(ECITS_SYNC_COMPLETED, {
          caseId, tenantId, userId, timestamp, status, documentsCount, hearingsCount,
        });
      } catch (e) {
        console.warn('[mark_synced_from_ecits] eventBus publish failed:', e);
      }
      return { success: true, syncedAt: timestamp };
    },

    // update_case_ecits_state — мерджить patch у case.ecitsState з canOverwrite logic.
    // Source — обов'язковий параметр для аудиту і пріоритетизації.
    // Якщо новий source має нижчий пріоритет ніж існуючий _lastSource —
    // перезапис не відбувається (логуємо у консоль).
    update_case_ecits_state: ({ caseId, patch, source }) => {
      if (!caseId) return { success: false, error: "caseId обов'язковий" };
      if (!patch || typeof patch !== 'object') return { success: false, error: "patch обов'язковий (object)" };
      if (!source) return { success: false, error: "source обов'язковий" };
      const userId = getCurrentUser().userId;
      const tenantId = getCurrentUser().tenantId;
      const timestamp = new Date().toISOString();
      let found = false;
      let overwriteSkipped = false;
      setCases(prev => prev.map(c => {
        if (c.id !== caseId) return c;
        found = true;
        const existingState = c.ecitsState || {};
        const existingSource = existingState._lastSource;
        if (existingSource && !canOverwrite(existingSource, source)) {
          // eslint-disable-next-line no-console
          console.log(`[ACTION update_case_ecits_state] source '${source}' has lower priority than '${existingSource}', skipping overwrite for case ${caseId}`);
          overwriteSkipped = true;
          return c;
        }
        return {
          ...c,
          ecitsState: {
            ...existingState,
            ...patch,
            _lastSource: source,
          },
          updatedAt: timestamp,
        };
      }));
      if (!found) return { success: false, error: `Справу ${caseId} не знайдено` };
      try {
        eventBus.publish(ECITS_CASE_STATE_UPDATED, {
          caseId, tenantId, userId, fieldsChanged: Object.keys(patch),
          source, timestamp, overwriteSkipped,
        });
      } catch (e) {
        console.warn('[update_case_ecits_state] eventBus publish failed:', e);
      }
      return { success: true, overwriteSkipped };
    },

    // ГРУПА 8 — AI-first дзеркало (TASK 0.3.5 v7, R1)
    // 6 edit-ACTIONS щоб нові поля v7 не залишились мертвими — адвокат через
    // діалог з агентом може редагувати parties, processParticipants,
    // composition, movementCard, alternativeSources, team.
    //
    // Усі замінюють масиви/об'єкти цілковито (replace-all, не merge).
    // source — обов'язковий для всіх крім update_team (бо internal).

    // 1. update_parties — replace-all для процесуальних сторін.
    update_parties: ({ caseId, parties, source }) => {
      if (!caseId) return { success: false, error: "caseId обов'язковий" };
      if (!Array.isArray(parties)) return { success: false, error: "parties має бути масивом" };
      if (!source) return { success: false, error: "source обов'язковий" };
      const userId = getCurrentUser().userId;
      const tenantId = getCurrentUser().tenantId;
      const timestamp = new Date().toISOString();
      const isSystemSourced = source === 'court_sync' || source === 'metadata_extractor';
      const enriched = parties.map(p => ({
        ...p,
        source: p.source ?? source,
        sourceConfidence: p.sourceConfidence ?? (source === 'manual' ? 'high' : 'medium'),
        extractedAt: p.extractedAt ?? (isSystemSourced ? timestamp : null),
      }));
      let found = false;
      setCases(prev => prev.map(c => {
        if (c.id !== caseId) return c;
        found = true;
        return { ...c, parties: enriched, updatedAt: timestamp };
      }));
      if (!found) return { success: false, error: `Справу ${caseId} не знайдено` };
      try {
        eventBus.publish(CASE_PARTIES_UPDATED, { caseId, tenantId, userId, source, timestamp });
      } catch (e) { console.warn('[update_parties] eventBus failed:', e); }
      return { success: true, count: enriched.length };
    },

    // 2. update_team — replace-all для internal bureau team.
    // Зберігає SaaS Foundation v3 структуру з permissions per-member.
    // Не приймає source (це internal action, не пов'язана з ЄСІТС).
    update_team: ({ caseId, team }) => {
      if (!caseId) return { success: false, error: "caseId обов'язковий" };
      if (!Array.isArray(team)) return { success: false, error: "team має бути масивом" };
      const userId = getCurrentUser().userId;
      const tenantId = getCurrentUser().tenantId;
      const timestamp = new Date().toISOString();
      let found = false;
      setCases(prev => prev.map(c => {
        if (c.id !== caseId) return c;
        found = true;
        return { ...c, team, updatedAt: timestamp };
      }));
      if (!found) return { success: false, error: `Справу ${caseId} не знайдено` };
      try {
        eventBus.publish(CASE_TEAM_UPDATED, { caseId, tenantId, userId, timestamp });
      } catch (e) { console.warn('[update_team] eventBus failed:', e); }
      return { success: true, count: team.length };
    },

    // 3. update_process_participants — replace-all для процесуальних учасників.
    // НЕ переписує team[] (внутрішня бюро-команда — окрема структура).
    update_process_participants: ({ caseId, participants, source }) => {
      if (!caseId) return { success: false, error: "caseId обов'язковий" };
      if (!Array.isArray(participants)) return { success: false, error: "participants має бути масивом" };
      if (!source) return { success: false, error: "source обов'язковий" };
      const userId = getCurrentUser().userId;
      const tenantId = getCurrentUser().tenantId;
      const timestamp = new Date().toISOString();
      const isSystemSourced = source === 'court_sync' || source === 'metadata_extractor';
      const enriched = participants.map(p => ({
        ...p,
        source: p.source ?? source,
        sourceConfidence: p.sourceConfidence ?? (source === 'manual' ? 'high' : 'medium'),
        extractedAt: p.extractedAt ?? (isSystemSourced ? timestamp : null),
      }));
      let found = false;
      setCases(prev => prev.map(c => {
        if (c.id !== caseId) return c;
        found = true;
        return { ...c, processParticipants: enriched, updatedAt: timestamp };
      }));
      if (!found) return { success: false, error: `Справу ${caseId} не знайдено` };
      try {
        eventBus.publish(CASE_PROCESS_PARTICIPANTS_UPDATED, { caseId, tenantId, userId, source, timestamp });
      } catch (e) { console.warn('[update_process_participants] eventBus failed:', e); }
      return { success: true, count: enriched.length };
    },

    // 4. update_proceeding_composition — оновлює склад суду конкретного провадження.
    update_proceeding_composition: ({ caseId, proceedingId, composition, source }) => {
      if (!caseId || !proceedingId) return { success: false, error: "caseId і proceedingId обов'язкові" };
      if (!source) return { success: false, error: "source обов'язковий" };
      const userId = getCurrentUser().userId;
      const tenantId = getCurrentUser().tenantId;
      const timestamp = new Date().toISOString();
      let found = false;
      let procFound = false;
      setCases(prev => prev.map(c => {
        if (c.id !== caseId) return c;
        found = true;
        const updatedProcs = (c.proceedings || []).map(p => {
          if (p.id !== proceedingId) return p;
          procFound = true;
          return { ...p, composition: composition ?? null, updatedAt: timestamp };
        });
        return { ...c, proceedings: updatedProcs, updatedAt: timestamp };
      }));
      if (!found) return { success: false, error: `Справу ${caseId} не знайдено` };
      if (!procFound) return { success: false, error: `Провадження ${proceedingId} не знайдено` };
      try {
        eventBus.publish(PROCEEDING_COMPOSITION_UPDATED, { caseId, proceedingId, tenantId, userId, source, timestamp });
      } catch (e) { console.warn('[update_proceeding_composition] eventBus failed:', e); }
      return { success: true };
    },

    // 5. update_document_movement_card — записує картку руху документа.
    update_document_movement_card: ({ caseId, documentId, movementCard, source }) => {
      if (!caseId || !documentId) return { success: false, error: "caseId і documentId обов'язкові" };
      if (!source) return { success: false, error: "source обов'язковий" };
      const userId = getCurrentUser().userId;
      const tenantId = getCurrentUser().tenantId;
      const timestamp = new Date().toISOString();
      let found = false;
      let docFound = false;
      setCases(prev => prev.map(c => {
        if (c.id !== caseId) return c;
        found = true;
        const updatedDocs = (c.documents || []).map(d => {
          if (d.id !== documentId) return d;
          docFound = true;
          return { ...d, movementCard: movementCard ?? null, updatedAt: timestamp };
        });
        return { ...c, documents: updatedDocs, updatedAt: timestamp };
      }));
      if (!found) return { success: false, error: `Справу ${caseId} не знайдено` };
      if (!docFound) return { success: false, error: `Документ ${documentId} не знайдено` };
      try {
        eventBus.publish(DOCUMENT_MOVEMENT_CARD_UPDATED, { caseId, documentId, tenantId, userId, source, timestamp });
      } catch (e) { console.warn('[update_document_movement_card] eventBus failed:', e); }
      return { success: true };
    },

    // 6. update_alternative_sources — додає запис до document.alternativeSources[]
    // коли multi-source синхронізація знаходить той самий документ через інший канал.
    update_alternative_sources: ({ caseId, documentId, alternativeSource }) => {
      if (!caseId || !documentId) return { success: false, error: "caseId і documentId обов'язкові" };
      if (!alternativeSource || typeof alternativeSource !== 'object') {
        return { success: false, error: "alternativeSource обов'язковий (object)" };
      }
      // Якщо передано dataHash — використовуємо як є; інакше будуємо запис.
      const record = alternativeSource.dataHash
        ? alternativeSource
        : buildAlternativeSourceRecord(
            alternativeSource.source ?? 'unknown',
            alternativeSource.sourceConfidence ?? null,
            alternativeSource.data ?? alternativeSource,
          );
      const userId = getCurrentUser().userId;
      const tenantId = getCurrentUser().tenantId;
      const timestamp = new Date().toISOString();
      let found = false;
      let docFound = false;
      setCases(prev => prev.map(c => {
        if (c.id !== caseId) return c;
        found = true;
        const updatedDocs = (c.documents || []).map(d => {
          if (d.id !== documentId) return d;
          docFound = true;
          const existing = Array.isArray(d.alternativeSources) ? d.alternativeSources : [];
          return { ...d, alternativeSources: [...existing, record], updatedAt: timestamp };
        });
        return { ...c, documents: updatedDocs, updatedAt: timestamp };
      }));
      if (!found) return { success: false, error: `Справу ${caseId} не знайдено` };
      if (!docFound) return { success: false, error: `Документ ${documentId} не знайдено` };
      try {
        eventBus.publish(DOCUMENT_ALTERNATIVE_SOURCE_ADDED, {
          caseId, documentId, tenantId, userId,
          source: record.source, timestamp,
        });
      } catch (e) { console.warn('[update_alternative_sources] eventBus failed:', e); }
      return { success: true };
    },

    // 7. update_document_source — змінити канал походження документа
    // (source/sourceConfidence/extractedAt) з canOverwrite політикою.
    // КРОК 0 аудиту: жоден наявний ACTION не міняє document.source
    // (update_document свідомо виключає; movement_card/alternative_sources
    // чіпають інші поля). Сценарій «той самий документ другим каналом»
    // (alternativeSources append) уже покритий update_alternative_sources —
    // тут той самий механізм переюзується як fallback, не дублюється.
    // Жодного авто-downgrade: нижчий пріоритет не перезаписує (discussion
    // §Питання2 — provenance, не silent overwrite).
    update_document_source: ({ caseId, documentId, source, sourceConfidence, extractedAt, alternativeSource }) => {
      if (!caseId || !documentId) return { success: false, error: "caseId і documentId обов'язкові" };
      if (!source) return { success: false, error: "source обов'язковий" };
      const userId = getCurrentUser().userId;
      const tenantId = getCurrentUser().tenantId;
      const timestamp = new Date().toISOString();
      let found = false;
      let docFound = false;
      let overwriteSkipped = false;
      let altPublished = null;
      setCases(prev => prev.map(c => {
        if (c.id !== caseId) return c;
        found = true;
        const updatedDocs = (c.documents || []).map(d => {
          if (d.id !== documentId) return d;
          docFound = true;
          const existingSource = d.source ?? null;
          if (canOverwrite(existingSource, source)) {
            return {
              ...d,
              source,
              sourceConfidence: sourceConfidence ?? d.sourceConfidence ?? null,
              extractedAt: extractedAt ?? d.extractedAt ?? null,
              updatedAt: timestamp,
            };
          }
          // Перезапис заборонений політикою пріоритету — source НЕ міняємо.
          overwriteSkipped = true;
          if (alternativeSource) {
            const record = alternativeSource.dataHash
              ? alternativeSource
              : buildAlternativeSourceRecord(
                  alternativeSource.source ?? source,
                  alternativeSource.sourceConfidence ?? sourceConfidence ?? null,
                  alternativeSource.data ?? alternativeSource,
                );
            altPublished = record;
            const existing = Array.isArray(d.alternativeSources) ? d.alternativeSources : [];
            return { ...d, alternativeSources: [...existing, record], updatedAt: timestamp };
          }
          return d;
        });
        return { ...c, documents: updatedDocs, updatedAt: timestamp };
      }));
      if (!found) return { success: false, error: `Справу ${caseId} не знайдено` };
      if (!docFound) return { success: false, error: `Документ ${documentId} не знайдено` };
      if (altPublished) {
        try {
          eventBus.publish(DOCUMENT_ALTERNATIVE_SOURCE_ADDED, {
            caseId, documentId, tenantId, userId,
            source: altPublished.source, timestamp,
          });
        } catch (e) { console.warn('[update_document_source] eventBus failed:', e); }
      }
      return { success: true, overwriteSkipped };
    },

    // TASK 3.2 — clean_document_text: очистити сирий OCR-текст СКАНОВАНОГО
    // документа у гарний Markdown. Тонка точка виклику ядра 3.1
    // (cleanTextService.cleanDocument) через Drive-шви адаптера — НУЛЬ
    // дублювання логіки. Споживачі: агент досьє (голос/чат) і кнопки UI
    // (Огляд/Viewer) — усі через цю ОДНУ дію (Rule of Three / AI-first).
    //
    // module=case_dossier, billAsUserAction:true — оплачувана дія адвоката
    // (ядро звітує 'agent_call'; executeAction-hook не дублює — SELF_BILLING_ACTIONS).
    // Скоуп-гард (тільки scanned) перевіряється ТУТ (явний skipped-результат для
    // UI/агента) і ще раз у ядрі (захист на рівні ядра).
    clean_document_text: async ({ caseId, documentId }) => {
      if (!caseId || !documentId) {
        return { success: false, error: "caseId, documentId обов'язкові" };
      }
      const targetCase = getCases().find(c => c.id === caseId);
      if (!targetCase) return { success: false, error: `Справу ${caseId} не знайдено` };
      const doc = (targetCase.documents || []).find(d => d.id === documentId);
      if (!doc) return { success: false, error: `Документ ${documentId} не знайдено у справі` };

      // Скоуп-гард: очистка ВИКЛЮЧНО для scanned (parent §СКОУП). searchable
      // (DOCX/HTML/текстовий PDF) — поза функцією (уже чистий цифровий текст).
      if (doc.documentNature !== 'scanned') {
        return { success: false, skipped: true, reason: 'not_scanned', error: 'Очистка доступна лише для сканованих документів' };
      }

      const apiKey = typeof getApiKey === 'function' ? getApiKey() : null;
      // Ліниве завантаження ядра/адаптера (уникаємо pdfjs у тест-середовищі);
      // тести передають стаби через deps.
      const cleanDocumentCore = injectedCleanDocument
        || (await import('./cleanTextService')).cleanDocument;
      const buildCleanDriveDeps = injectedBuildCleanDriveDeps
        || (await import('./cleanTextDriveAdapter')).buildCleanDocumentDriveDeps;
      // Drive-шви ядра: update_document (textFormat/cleanedAt) через executeAction
      // від імені dossier_agent (має дозвіл update_document); attentionNotes у extended.
      const driveDeps = buildCleanDriveDeps({ executeAction, agentId: 'dossier_agent' });

      const r = await cleanDocumentCore({
        document: doc,
        caseData: targetCase,
        apiKey,
        module: MODULES.CASE_DOSSIER,
        billAsUserAction: true,
        ...driveDeps,
      });

      // Мапінг результату ядра у контракт ACTION (success-орієнтований).
      if (r?.ok) {
        return { success: true, documentId, attentionNotes: r.attentionNotes || [], warning: r.warning || null };
      }
      if (r?.skipped) {
        return { success: false, skipped: true, reason: r.reason || 'skipped' };
      }
      if (r?.degraded) {
        // Деградація (обрізало/AI недоступний): джерела збережено, .md не змінено.
        return { success: false, degraded: true, needsRecleaning: true, warning: r.warning || 'Очистка не завершена — джерела збережено для повтору' };
      }
      return { success: false, error: r?.error || 'Очистка не вдалась' };
    },

    // ГРУПА 6 — Композитна дія
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
      // Phase 1.5 — документи і провадження (одиночне додавання при QI-команді)
      'add_document', 'update_document',
      'add_proceeding', 'update_proceeding',
    ],

    dashboard_agent: [
      'add_hearing', 'update_hearing', 'delete_hearing',
      'add_note', 'update_note', 'delete_note',
      'confirm_event', 'add_travel',
      'batch_update',
      // Документи не зона дашборду — нових дозволів немає.
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
      // Phase 1.5 — документи і провадження
      'add_document', 'update_document',
      'add_proceeding', 'update_proceeding',
      'update_processing_context',
      // TASK 3.2 — ретроактивна очистка тексту скан-документа (голос/чат + кнопки UI).
      'clean_document_text',
      // delete_document, delete_proceeding — НЕ дозволено, лише UI (UI_ONLY_ACTIONS).
    ],

    // Phase 1.5 — субагент пакетної обробки документів. Вузька зона:
    // тільки batch-додавання документів і запис контексту обробки.
    // hearings/deadlines/create_case/destroy_case — заборонено.
    document_processor_agent: [
      'add_documents',
      'update_processing_context',
      'update_document_source',
      'batch_update',
      // TASK 3.1 — пост-крок очистки тексту оновлює textFormat/cleanedAt
      // на щойно створеному документі (через cleanTextDriveAdapter).
      'update_document',
    ],

    // TASK 0.3.5 v7 + TASK 0.4 Court Sync MVP — Court Sync agent для ЄСІТС.
    // Дозволено: hearing CRUD, sync ACTIONS, 6 edit-ACTIONS канонічної схеми
    // (parties, processParticipants, composition, movementCard,
    // alternativeSources, team). TASK 0.4: + create_case (для імпорту нових
    // справ з ЄСІТС що ще не існують в Legal BMS — з origin='ecits_import').
    // ЗАБОРОНЕНО (відсутні у списку): destroy_case, add_document,
    // update_document, delete_document — документи Court Sync не пише у MVP.
    court_sync_agent: [
      'create_case',                         // TASK 0.4: новий імпорт з ЄСІТС
      'add_hearing', 'update_hearing',
      'mark_synced_from_ecits', 'update_case_ecits_state',
      'update_parties', 'update_team', 'update_process_participants',
      'update_proceeding_composition',
      'update_document_movement_card', 'update_alternative_sources',
      'update_document_source',
    ],

    // TASK 0.3.5 v7 — Metadata Extractor agent.
    // ВАЖЛИВО: defined але DISABLED через порожній allowlist. Будь-який
    // executeAction виклик буде відхилено standard PERMISSIONS-перевіркою.
    // Активація — окремим TASK у майбутньому коли реальний парсер буде готовий.
    // Зарезервоване ім'я щоб не забути про роль і не плутати з court_sync_agent.
    metadata_extractor_agent: [],

    // destroy_case, delete_time_entry, delete_document, delete_proceeding —
    // жоден агент. Тільки UI з підтвердженням.
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

    // 0. UI-only ACTIONS — мусять мати _fromUI у params (виставляє UI-обробник).
    // Агенти ніколи не отримують доступу до цих дій, навіть якщо ACTION_JSON
    // спробує підкласти _fromUI: true — для безпеки можна (в майбутньому)
    // фільтрувати _* поля при парсингу ACTION_JSON.
    if (UI_ONLY_ACTIONS.has(action)) {
      if (!params?._fromUI) {
        console.warn(`executeAction UI-ONLY: ${agentId} → ${action}`);
        return { success: false, error: `Дія ${action} доступна лише через UI` };
      }
      // _fromUI bypass: пропускаємо PERMISSIONS allowlist (UI має повний доступ
      // у межах своєї сесії; tenant/case checks нижче залишаються активними).
    } else {
      // 1. Перевірка ролей агента (allowlist дій)
      const allowed = PERMISSIONS[agentId] || [];
      if (!allowed.includes(action)) {
        console.warn(`executeAction BLOCKED: ${agentId} → ${action}`);
        return { success: false, error: `Немає повноважень: ${action}` };
      }
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
      const caseObj = getCases().find(c => String(c.id) === String(params.caseId));
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
      // Виключаємо системні дії (SYSTEM_ACTIONS_NO_BILLING).
      // TASK 0.3.5: edit-ACTIONS викликані з source !== 'manual' теж не
      // нараховуються (це автосинхронізація, не робота адвоката).
      // TASK 0.4: create_case з origin='ecits_import' (Court Sync імпорт)
      // теж не нараховується — справа з'явилась автоматично, не як робота.
      // TASK 3.2: SELF_BILLING_ACTIONS (clean_document_text) звітують власний
      // 'agent_call' усередині handler'а — generic-hook не дублює.
      let shouldReport = result && (result.success || result.successCount) &&
                         !SYSTEM_ACTIONS_NO_BILLING.has(action) &&
                         !SELF_BILLING_ACTIONS.has(action);
      if (shouldReport && EDIT_ACTIONS_SOURCE_AWARE.has(action)) {
        const sourceParam = params?.source;
        if (sourceParam && sourceParam !== 'manual') {
          shouldReport = false; // автосинхронізація, не нараховується
        }
      }
      if (shouldReport && action === 'create_case') {
        // Плоский та legacy формат create_case: перевіряємо обидві локації.
        const originParam = params?.origin || params?.fields?.origin;
        if (originParam && originParam !== 'manual') {
          shouldReport = false; // автоімпорт з ЄСІТС/Telegram/Email
        }
      }
      if (shouldReport) {
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

  return { ACTIONS, PERMISSIONS, executeAction };
}
