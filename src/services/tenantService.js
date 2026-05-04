// ── TENANT SERVICE ───────────────────────────────────────────────────────────
// Контекст організації і поточного користувача.
//
// Зараз — solo: один tenant (АБ Левицького) і один користувач (Вадим).
// В майбутньому SaaS — отримує дані з сесії авторизації.
// Інтерфейс зафіксований; у заглушках вшито ДНК повної архітектури.

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
  subscription: {
    plan: 'self_hosted',
    validUntil: null,
    features: ['all'],
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
  },
  createdAt: '2016-06-15T00:00:00Z',
  updatedAt: '2026-05-04T00:00:00Z',
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
