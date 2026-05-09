// Людські назви категорій/авторів і утиліти форматування для DocumentViewer.
// Дзеркалить enum'и з canonical document schema (TASK 1.5 / schemaVersion 5).

export const CATEGORY_LABELS = {
  pleading: 'Заява по суті',
  motion: 'Клопотання',
  court_act: 'Судовий акт',
  evidence: 'Доказ',
  contract: 'Договір',
  correspondence: 'Кореспонденція',
  identification: 'Документ особи',
  other: 'Інше',
};

export const AUTHOR_LABELS = {
  ours: 'Наш',
  opponent: 'Опонент',
  court: 'Суд',
  third_party: 'Третя сторона',
};

const PROC_TYPE_TO_TOKEN = {
  first: 'first',
  first_instance: 'first',
  appeal: 'appeal',
  cassation: 'cassation',
};

export function proceedingColor(type) {
  const key = PROC_TYPE_TO_TOKEN[type] || 'other';
  return `var(--color-proceeding-${key})`;
}

export function formatDate(value) {
  if (!value) return '';
  // ISO 'YYYY-MM-DD' → 'DD.MM.YYYY'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  // Інакше — повертаємо як є (адвокат міг ввести "березень 2023")
  return String(value);
}

export function formatFileSize(bytes) {
  // 0 у канонічній схемі — це маркер "розмір невідомий" для legacy-документів,
  // тож показуємо порожній рядок (метарядок Viewer'а пропустить пункт).
  if (typeof bytes !== 'number' || !bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
