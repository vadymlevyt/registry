// ── TIME STANDARDS ───────────────────────────────────────────────────────────
// Стандарти часу для різних активностей: тривалість в хвилинах.
// Ієрархія резолюції: user → tenant → system.
//
// Експериментальні значення — переоцінка через 1-3 місяці на основі реальних даних.
// // experimental — review after 1 month
//
// Не блокує і не редагує дані. Просто повертає число хвилин, яке UI/agent
// потім використовує як стартову точку для часу події.

import { getCurrentTenant, getCurrentUser } from './tenantService.js';

// Системні дефолти. Змінюються лише через адмін-UI у майбутньому SaaS.
export const SYSTEM_TIME_STANDARDS = {
  by_court: {},
  by_city: {},
  by_activity: {
    hearing_simple: 60,
    hearing_complex: 120,
    advocate_request: 30,
    client_meeting: 60,
    phone_call: 15,
    document_drafting: 60,
    case_research: 90,
    document_review: 30,
    drafting: 60,
    agent_chat: 15,
  },
  default_travel: { to: 60, from: 60 },
};

// Дефолти tenant для DEFAULT_TENANT.settings.timeStandards
// (повертаються в tenantService для першого старту).
export const DEFAULT_TENANT_TIME_STANDARDS = {
  by_court: {
    'Дарницький районний суд м. Києва': { travel: { to: 60, from: 60 } },
    'Шевченківський районний суд м. Києва': { travel: { to: 30, from: 30 } },
    'Печерський районний суд м. Києва': { travel: { to: 45, from: 45 } },
  },
  by_city: {
    'Київ': { travel: { to: 60, from: 60 } },
    'Львів': { travel: { to: 90, from: 90 } },
  },
  by_activity: {
    hearing_simple: 60,
    hearing_complex: 120,
    advocate_request: 30,
    client_meeting: 60,
    phone_call: 15,
    document_drafting: 60,
    case_research: 90,
  },
  default_travel: { to: 60, from: 60 },
};

function lookup(layer, activity, context) {
  if (!layer || typeof layer !== 'object') return null;
  // travel за судом
  if ((activity === 'travel_to_court' || activity === 'travel_from_court' || activity === 'travel') && context?.court) {
    const byCourt = layer.by_court?.[context.court];
    if (byCourt?.travel) {
      const dir = activity === 'travel_from_court' ? 'from' : (context.direction || 'to');
      const v = byCourt.travel[dir];
      if (Number.isFinite(v)) return v;
    }
  }
  // travel за містом
  if ((activity === 'travel_to_court' || activity === 'travel_from_court' || activity === 'travel') && context?.city) {
    const byCity = layer.by_city?.[context.city];
    if (byCity?.travel) {
      const dir = activity === 'travel_from_court' ? 'from' : (context.direction || 'to');
      const v = byCity.travel[dir];
      if (Number.isFinite(v)) return v;
    }
  }
  if (activity === 'travel_to_court' || activity === 'travel_from_court' || activity === 'travel') {
    const dt = layer.default_travel;
    if (dt) {
      const dir = activity === 'travel_from_court' ? 'from' : (context.direction || 'to');
      const v = dt[dir];
      if (Number.isFinite(v)) return v;
    }
  }
  const ba = layer.by_activity?.[activity];
  if (Number.isFinite(ba)) return ba;
  return null;
}

// Повертає тривалість в хвилинах. Завжди повертає число.
export function getTimeStandard(activity, context = {}) {
  const user = getCurrentUser();
  const userStd = user?.preferences?.timeStandards;
  const v1 = lookup(userStd, activity, context);
  if (Number.isFinite(v1)) return v1;

  const tenant = getCurrentTenant();
  const tenantStd = tenant?.settings?.timeStandards;
  const v2 = lookup(tenantStd, activity, context);
  if (Number.isFinite(v2)) return v2;

  const v3 = lookup(SYSTEM_TIME_STANDARDS, activity, context);
  if (Number.isFinite(v3)) return v3;

  // Останній фолбек — 60 хв.
  return 60;
}

// Категорії активності (billable, visibleToClient, billFactor).
// // experimental — review after 1 month
export const ACTIVITY_CATEGORIES = {
  case_work:             { billable: true,  visibleToClient: true,  billFactor: 1.0 },
  hearing_attendance:    { billable: true,  visibleToClient: true,  billFactor: 1.0 },
  hearing_preparation:   { billable: true,  visibleToClient: true,  billFactor: 1.0 },
  travel:                { billable: true,  visibleToClient: true,  billFactor: 1.0 },
  client_communication:  { billable: true,  visibleToClient: false, billFactor: 0.5 },
  admin:                 { billable: false, visibleToClient: false, billFactor: 0.0 },
  system:                { billable: false, visibleToClient: false, billFactor: 0.0 },
  break:                 { billable: false, visibleToClient: false, billFactor: 0.0 },
  manual_entry:          { billable: true,  visibleToClient: true,  billFactor: 1.0 },
};

export function getCategoryDefaults(category) {
  return ACTIVITY_CATEGORIES[category] || ACTIVITY_CATEGORIES.case_work;
}

// Матриця варіантів для confirmEvent. Specific для типу події.
// // experimental — review after 1 month
export const EVENT_VARIANT_MATRIX = {
  hearing: {
    completed: {
      label: 'Відбулось нормально',
      defaultBillFactor: 1.0,
    },
    postponed_opponent: {
      label: 'Відкладено опонентом',
      defaultBillFactor: 1.0,
    },
    postponed_self: {
      label: 'Відкладено з моєї ініціативи (клопотання)',
      defaultBillFactor: 1.0,
    },
    court_fault: {
      label: 'Не відбулось з вини суду',
      defaultBillFactor: { traveled: 0.5, no_travel: 0.3 },
      detailsHint: 'суддя в нарадчій / хвороба судді / знято з розгляду / технічна причина',
    },
    custom: {
      label: '(вільний текст)',
      defaultBillFactor: null,
      requiresCustomLabel: true,
    },
  },
  // meeting / consultation в майбутньому додадуться сюди.
};

export function getVariantsFor(parentEventType) {
  return EVENT_VARIANT_MATRIX[parentEventType] || {};
}

export function getVariantDefault(parentEventType, variantKey, traveled = false) {
  const v = EVENT_VARIANT_MATRIX[parentEventType]?.[variantKey];
  if (!v) return { billFactor: 1.0 };
  let bf = v.defaultBillFactor;
  if (bf && typeof bf === 'object') {
    bf = traveled ? bf.traveled : bf.no_travel;
  }
  return { ...v, billFactor: Number.isFinite(bf) ? bf : 1.0 };
}
