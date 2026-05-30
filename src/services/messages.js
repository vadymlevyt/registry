// ── СЛОВНИК СТАНДАРТНИХ ПОВІДОМЛЕНЬ ──────────────────────────────────────────
//
// Принципи (з контекстного файлу 1.3 «Помилки людською мовою»):
//   • Жодного технічного жаргону: "system error", "code 422", "failed to fetch".
//   • Кожне повідомлення = title + (description) + (action).
//   • title — коротко суть (3-5 слів).
//   • description — причина і пропозиція дії (1-2 речення).
//   • action — опційна кнопка вирішення (label передається у toast.show
//     разом з onAction handler).
//   • Українською.
//   • Шаблонні фрази — функції з параметрами (filename, caseName тощо).
//
// Використання:
//   import { toast } from '@/services/toast.js';
//   import { messages } from '@/services/messages.js';
//
//   toast.show(messages.drive.saveFailed(filename), {
//     onAction: () => retry(filename),
//   });
//
// Технічні деталі (err.message, HTTP коди) — НЕ потрапляють у текст для
// адвоката. Вони йдуть у console.error для розробника.

export const messages = {
  // ── DRIVE ─────────────────────────────────────────────────────────────────
  drive: {
    notConnected: () => ({
      variant: 'warning',
      title: 'Drive не підключено',
      description: 'Підключіть Google Drive щоб зберігати документи і агентську історію.',
      action: { label: 'Підключити' },
    }),

    tokenExpired: () => ({
      variant: 'warning',
      title: 'Сесія Drive завершилась',
      description: 'Перепідключіть Google Drive — токен авторизації застарів.',
      action: { label: 'Перепідключити' },
    }),

    saveFailed: (filename) => ({
      variant: 'error',
      title: 'Не вдалось зберегти на Drive',
      description: filename
        ? `Файл «${filename}» не завантажено. Перевірте підключення і спробуйте знову.`
        : 'Перевірте підключення до Drive і спробуйте знову.',
      action: { label: 'Спробувати ще' },
    }),

    folderMissing: (caseName) => ({
      variant: 'warning',
      title: 'Папка справи не існує на Drive',
      description: caseName
        ? `Для справи «${caseName}» немає папки. Створити структуру папок зараз?`
        : 'Натисніть «Створити структуру на Drive» у вкладці Огляд.',
      action: { label: 'Створити' },
    }),

    structureCreated: (folderName) => ({
      variant: 'success',
      title: 'Структуру створено',
      description: folderName ? `Папка «${folderName}» з підпапками готова на Drive.` : null,
    }),

    folderError: () => ({
      variant: 'error',
      title: 'Не вдалося створити папку',
      description: 'Перевірте підключення до Drive і права доступу.',
    }),
  },

  // ── КОНТЕКСТ СПРАВИ (case_context.md) ─────────────────────────────────────
  context: {
    alreadyRunning: () => ({
      variant: 'warning',
      title: 'Операція вже виконується',
      description: 'Зачекайте поки попередня обробка завершиться.',
    }),

    noFiles: () => ({
      variant: 'warning',
      title: 'Файлів не знайдено',
      description: 'У папках 01_ОРИГІНАЛИ та 02_ОБРОБЛЕНІ немає документів для аналізу.',
    }),

    noSubfolders: () => ({
      variant: 'error',
      title: 'Папки документів не знайдено',
      description: 'Не виявлено 01_ОРИГІНАЛИ і 02_ОБРОБЛЕНІ. Створіть структуру або перевірте Drive.',
    }),

    apiKeyMissing: () => ({
      variant: 'warning',
      title: 'Потрібен API ключ Claude',
      description: 'Додайте ключ у налаштуваннях щоб згенерувати контекст.',
      action: { label: 'Налаштування' },
    }),

    cancelled: () => ({
      variant: 'info',
      title: 'Скасовано',
      description: 'Авторизацію не оновлено.',
    }),

    authRefreshed: () => ({
      variant: 'info',
      title: 'Авторизацію оновлено',
      description: 'Натисніть «Створити контекст» ще раз.',
    }),

    saveFailed: (errMsg) => ({
      variant: 'error',
      title: 'Не вдалось зберегти контекст',
      description: errMsg
        ? `Помилка Drive: ${String(errMsg).slice(0, 120)}`
        : 'Drive не підтвердив збереження. Спробуйте ще раз.',
    }),

    created: ({ count, fromCache, failed }) => ({
      variant: 'success',
      title: 'Контекст створено',
      description: [
        `${count} ${pluralUk(count, 'документ', 'документи', 'документів')} опрацьовано`,
        fromCache > 0 ? `${fromCache} з кешу` : null,
        failed > 0 ? `${failed} ${pluralUk(failed, 'помилка', 'помилки', 'помилок')}` : null,
      ].filter(Boolean).join(', ') + '.',
    }),

    // #3 — окремий сигнал фонового оновлення нарису (DP-тригер), щоб НЕ
    // плутати з тостом нарізки «Оброблено N документів». Свій заголовок.
    updated: ({ count, fromCache, failed } = {}) => ({
      variant: 'success',
      title: '✓ Нарис справи оновлено',
      description: [
        count != null ? `${count} ${pluralUk(count, 'документ', 'документи', 'документів')} у нарисі` : 'case_context.md освіжено',
        fromCache > 0 ? `${fromCache} з кешу` : null,
        failed > 0 ? `${failed} ${pluralUk(failed, 'помилка', 'помилки', 'помилок')}` : null,
      ].filter(Boolean).join(', ') + '.',
    }),

    emptyResult: () => ({
      variant: 'error',
      title: 'Claude не повернув результат',
      description: 'Перевірте API ключ і спробуйте ще раз.',
    }),
  },

  // ── API (Anthropic / агенти) ──────────────────────────────────────────────
  api: {
    networkError: () => ({
      variant: 'error',
      title: 'Не вдалось звʼязатись з агентом',
      description: 'Перевірте інтернет і спробуйте ще раз.',
    }),

    rateLimit: () => ({
      variant: 'warning',
      title: 'Забагато запитів',
      description: 'Зачекайте хвилину перед наступним повідомленням до агента.',
    }),

    apiKeyInvalid: () => ({
      variant: 'error',
      title: 'Перевірте API ключ',
      description: 'API ключ Claude недійсний або застарів. Оновіть у налаштуваннях.',
      action: { label: 'Налаштування' },
    }),

    serverError: () => ({
      variant: 'error',
      title: 'Сервіс тимчасово недоступний',
      description: 'Anthropic API не відповідає. Спробуйте за хвилину.',
    }),
  },

  // ── ДОКУМЕНТИ ─────────────────────────────────────────────────────────────
  documents: {
    saved: () => ({
      variant: 'success',
      title: 'Документ збережено',
    }),

    deleted: (mode) => {
      const desc = {
        full: 'Документ видалено з реєстру і з Drive.',
        registry_only: 'Документ видалено з реєстру. Файл залишився на Drive як архівна копія.',
        archive: 'Документ архівовано. Можна повернути через перемикач «Показати архівні».',
      };
      return {
        variant: 'success',
        title: 'Документ видалено',
        description: desc[mode] || desc.full,
      };
    },

    uploadFailed: (filename) => ({
      variant: 'error',
      title: filename ? `Не вдалось додати «${filename}»` : 'Не вдалось додати файл',
      description: 'Перевірте розмір і формат. Підтримуються PDF, DOCX, зображення.',
    }),

    fileTooLarge: (filename, maxMb) => ({
      variant: 'warning',
      title: 'Файл занадто великий',
      description: `«${filename}» перевищує ліміт ${maxMb} МБ. Стисніть або розділіть на частини.`,
    }),
  },

  // ── ПРОВАДЖЕННЯ ───────────────────────────────────────────────────────────
  proceedings: {
    deleted: (procName, affectedDocs) => ({
      variant: 'success',
      title: procName ? `Провадження «${procName}» видалено` : 'Провадження видалено',
      description: affectedDocs > 0
        ? `${affectedDocs} ${pluralUk(affectedDocs, 'документ', 'документи', 'документів')} стали «без провадження».`
        : null,
    }),
  },

  // ── СПРАВА ────────────────────────────────────────────────────────────────
  case: {
    saved: () => ({ variant: 'success', title: 'Справу збережено' }),
  },

  // ── СПІЛЬНІ ───────────────────────────────────────────────────────────────
  common: {
    voiceUnsupported: () => ({
      variant: 'warning',
      title: 'Мікрофон не підтримується',
      description: 'У вашому браузері відсутня підтримка диктування. Спробуйте Chrome або Safari.',
    }),
  },
};

// ── Утиліта плюралізації для української ────────────────────────────────────
function pluralUk(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
