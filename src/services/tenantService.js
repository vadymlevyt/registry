// ── TENANT SERVICE ───────────────────────────────────────────────────────────
// Контекст організації і поточного користувача.
//
// Зараз — solo: один tenant (АБ Левицького) і один користувач (Вадим).
// В майбутньому SaaS — отримує дані з сесії авторизації.
// Інтерфейс зафіксований; у заглушках вшито ДНК повної архітектури.

function getCurrentMonthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0)).toISOString();
}

function getCurrentMonthEnd() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59)).toISOString();
}

export const DEFAULT_TENANT = {
  tenantId: 'ab_levytskyi',
  type: 'bureau',
  name: 'Адвокатське бюро «Вадима Левицького»',
  edrpou: '40434074',
  registrationDate: '2016-06-15',
  ownerUserId: 'vadym',
  addresses: {
    kyiv: 'вул. Володимирська, 4, 01025, Київ',
    kostopil: 'вул. Дорошенка, 33, 35001, Костопіль',
  },
  contacts: {
    email: 'info@levytskyi.com',
    phone: '+380674621428',
    website: null,
  },
  bankDetails: {
    iban: 'UA643052990000026001046211855',
    bank: 'ПриватБанк',
  },
  storage: {
    provider: 'drive_legacy',
    quotaGB: null,
    usedBytes: null,
  },
  modelPreferences: {
    dossierAgent: null,
    qiAgent: null,
    qiParserDocument: null,
    qiParserImage: null,
    dashboardAgent: null,
    documentProcessor: null,
    documentParserVision: null,
    caseContextGenerator: null,
    deepAnalysis: null,
  },
  subscription: {
    plan: 'self_hosted',
    status: 'active',
    validUntil: null,
    features: ['all'],
    limits: {
      aiTokensPerMonth: null,
      aiCostPerMonth: null,
      storageGB: null,
      teamMembers: null,
      casesActive: null,
    },
    current: {
      periodStart: getCurrentMonthStart(),
      periodEnd: getCurrentMonthEnd(),
      tokensUsed: 0,
      costUsedUSD: 0,
      storageUsedGB: 0,
      teamMembersCount: 1,
      casesActiveCount: 0,
    },
    alerts: {
      warnAt: 80,
      blockAt: 100,
    },
  },
  settings: {
    language: 'uk',
    documentStandard: {
      font: 'Times New Roman',
      fontSize: '12-14pt',
      margins: { left: 30, top: 20, right: 20, bottom: 20 },
      lineHeight: 1.5,
      pageSize: 'A4',
    },
    // v4 Billing Foundation — стандарти часу. Подальше редагування — через
    // окремий адмін-UI у майбутньому. Дефолти живуть в timeStandards.js.
    timeStandards: null,
    // TASK 0.2 — налаштування інтеграцій з зовнішніми системами.
    // Кожен модуль інтеграції тримає свою секцію тут. Зараз — лише ecits.
    moduleIntegration: {
      ecits: {
        autoSync: false,
        syncIntervalMinutes: null,
        casesToSync: 'all',
        autoProcessIncoming: false,
        detectDeadlinesOnReceive: false,
        executionProvider: 'claudeForChrome',
      },
    },
  },
  // TASK 0.3 — історія recon-запусків (read-only розвідка ЄСІТС). Додано без
  // schema bump (розширення без міграції): існуючі реєстри без поля читаються
  // як порожня історія. Реальне джерело правди — localStorage до моменту коли
  // App.jsx починає синхронізувати з registry_data.json.
  recon_history: [],
  createdAt: '2016-06-15T00:00:00Z',
  updatedAt: '2026-05-05T00:00:00Z',
};

export const DEFAULT_USER = {
  userId: 'vadym',
  tenantId: 'ab_levytskyi',
  globalRole: 'bureau_owner',
  name: 'Левицький Вадим Андрійович',
  rnokpp: '2958638797',
  advokatLicense: {
    number: '502',
    issuedDate: '2006-04-27',
    issuedBy: 'Київська обласна КДКА',
  },
  email: 'vadim.levytskyi@gmail.com',
  secondaryEmail: 'info@levytskyi.com',
  phone: '+380674621428',
  active: true,
  structuralUnit: null,
  supervisorId: null,
  billingRate: null,
  // isFounder — глобальна позначка власника продукту, не залежить від tenantId.
  // true тільки для одного користувача (засновника); точка розширення для
  // майбутніх founder-only модулів (Розвідник, Admin metrics, Dev tools).
  isFounder: true,
  createdAt: '2016-06-15T00:00:00Z',
  lastLoginAt: null,
};

export function getCurrentTenant() {
  // ЗАГЛУШКА: завжди АБ Левицького. У SaaS — з контексту авторизації.
  return DEFAULT_TENANT;
}

export function getCurrentUser() {
  // ЗАГЛУШКА: завжди Вадим. У SaaS — з сесії.
  return DEFAULT_USER;
}

export function getCurrentUserId() {
  return getCurrentUser().userId;
}

export function getCurrentTenantId() {
  return getCurrentTenant().tenantId;
}

// isFounder — глобальна позначка власника продукту. Точка розширення для
// founder-only модулів. У SaaS перевіряється на сесії; зараз — на DEFAULT_USER.
export function isCurrentUserFounder() {
  const user = getCurrentUser();
  return user?.isFounder === true;
}
