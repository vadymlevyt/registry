// ── SMART RETURN HANDLER ─────────────────────────────────────────────────────
// Логіка реакції системи коли адвокат повертається після offline-періоду.
//
// // experimental — review after 1 month
//
// Ізольований сервіс щоб логіку семантичної інтерпретації можна було
// замінити/спростити/видалити після збору реальних даних.
//
// API:
//   handleReturn(activeSubtimer, actualDuration) → { dialog, suggestion }
//
// Не дзвонить UI напряму. Повертає dialog config — викликач (App.jsx)
// вирішує як його показати: через systemConfirm, чат-агента або просто
// автоматично записати залежно від confidence.

import { getCurrentUser } from './tenantService.js';

const SCREEN_ACTIVE_CATEGORIES = new Set([
  'drafting',
  'case_research',
  'document_review',
  'agent_chat',
  'desktop_browsing',
]);

const SCREEN_PASSIVE_CATEGORIES = new Set([
  'client_meeting',
  'court_visit',
  'phone_call',
  'post_office',
  'travel',
  'offline_work',
]);

export function inferSemanticGroup(subCategory) {
  if (!subCategory) return null;
  if (SCREEN_ACTIVE_CATEGORIES.has(subCategory)) return 'screen_active';
  if (SCREEN_PASSIVE_CATEGORIES.has(subCategory)) return 'screen_passive';
  return null;
}

// activeSubtimer: { category, subCategory, semanticGroup, plannedDuration, startedAt, caseId }
// actualDuration: секунди (від startedAt до моменту повернення)
// exitReason: 'visibility_hidden' | 'idle_detected' | 'manual' | 'unexpected_screen_off' | 'expected_offscreen'
export function handleReturn(activeSubtimer, actualDuration, exitReason = 'visibility_hidden') {
  if (!activeSubtimer || typeof activeSubtimer !== 'object') {
    return { dialog: null, suggestion: null };
  }
  const semanticGroup = activeSubtimer.semanticGroup
    || inferSemanticGroup(activeSubtimer.subCategory);

  if (semanticGroup === 'screen_active') {
    // Очікувано адвокат за пристроєм → екран не мав гаснути → підозра.
    return {
      dialog: {
        type: 'detailed',
        title: 'Скільки реально працював?',
        message: `Категорія "${activeSubtimer.subCategory || activeSubtimer.category}" зазвичай йде з активним екраном.\n` +
                 `Запланований час: ${formatMin(activeSubtimer.plannedDuration)}.\n` +
                 `Зафіксовано: ${formatSec(actualDuration)}.\n\n` +
                 'Скоригуй фактичну тривалість.',
        defaultDuration: actualDuration,
        canSplit: true,
        confidence: 'low',
      },
      suggestion: {
        confidence: 'low',
        exitedVia: 'unexpected_screen_off',
        status: 'needs_review',
        semanticGroup,
        category: activeSubtimer.category,
        caseId: activeSubtimer.caseId,
      },
    };
  }

  if (semanticGroup === 'screen_passive') {
    // Очікувано адвокат поза пристроєм → авто-confirm з простим підтвердженням.
    return {
      dialog: {
        type: 'simple_confirm',
        title: subCategoryLabel(activeSubtimer.subCategory) || 'Активність завершена',
        message: `${formatSec(actualDuration)} — все вірно?`,
        defaultDuration: actualDuration,
        canSplit: false,
        confidence: 'high',
      },
      suggestion: {
        confidence: 'high',
        exitedVia: 'expected_offscreen',
        status: 'confirmed',
        semanticGroup,
        category: activeSubtimer.category,
        caseId: activeSubtimer.caseId,
      },
    };
  }

  // Невідома категорія — нейтральне питання.
  return {
    dialog: {
      type: 'detailed',
      title: 'Що ти робив поза системою?',
      message: `Зафіксовано ${formatSec(actualDuration)}. Куди записати?`,
      defaultDuration: actualDuration,
      canSplit: true,
      confidence: 'medium',
    },
    suggestion: {
      confidence: 'medium',
      exitedVia: exitReason || 'manual',
      status: 'needs_review',
      semanticGroup: null,
      category: activeSubtimer.category || 'manual_entry',
      caseId: activeSubtimer.caseId,
    },
  };
}

function formatMin(min) {
  if (!Number.isFinite(min) || min <= 0) return '—';
  if (min < 60) return `${min} хв`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h} год ${m} хв` : `${h} год`;
}

function formatSec(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '0 хв';
  return formatMin(Math.round(sec / 60));
}

function subCategoryLabel(sc) {
  const m = {
    client_meeting: 'Зустріч з клієнтом',
    court_visit: 'Поїздка в суд',
    phone_call: 'Телефонна розмова',
    post_office: 'Пошта',
    travel: 'Дорога',
    offline_work: 'Робота з паперами',
    drafting: 'Складання документа',
    case_research: 'Дослідження по справі',
    document_review: 'Перегляд документа',
    agent_chat: 'Чат з агентом',
    desktop_browsing: 'Робота на компʼютері',
  };
  return m[sc] || null;
}

export const _internals = { SCREEN_ACTIVE_CATEGORIES, SCREEN_PASSIVE_CATEGORIES };
