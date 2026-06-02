// ── TOOL DEFINITIONS ─────────────────────────────────────────────────────────
// Реєстр Anthropic Tool Use definitions для агентів. Один tool на ACTION
// з PERMISSIONS відповідного агента.
//
// Принципи:
//   • Description описує КОЛИ викликати tool, не лише ЩО він робить.
//     Модель читає description щоб вибрати правильний tool.
//   • input_schema — стандартний JSON Schema. Енами — точно як у
//     src/schemas/documentSchema.js і у відповідних ACTIONS App.jsx.
//   • Кожен tool — окрема константа щоб зручно тестувати, документувати
//     і повторно використовувати в DOCUMENT_PROCESSOR_AGENT_TOOLS пізніше.
//   • DELETE-дії (delete_document, delete_proceeding, destroy_case) свідомо
//     ВІДСУТНІ — це UI-only через _fromUI прапор.

import { CANONICAL_DOCUMENT_FIELDS } from '../schemas/documentSchema.js';

// Витягуємо canonical енами зі схеми — single source of truth.
// Anthropic Tool Use стабільніше працює з простими type=string + enum БЕЗ null
// (замість type:[string,null]). Optional поля просто опускаються — модель
// розуміє з description і не передає поле взагалі.
const dropNull = (arr) => arr.filter(v => v !== null);
const CATEGORY_ENUM = dropNull(CANONICAL_DOCUMENT_FIELDS.category.enum);
const AUTHOR_ENUM = dropNull(CANONICAL_DOCUMENT_FIELDS.author.enum);
const DOC_NATURE_ENUM = CANONICAL_DOCUMENT_FIELDS.documentNature.enum;
const NAMING_STATUS_ENUM = CANONICAL_DOCUMENT_FIELDS.namingStatus.enum;
const FOLDER_ENUM = CANONICAL_DOCUMENT_FIELDS.folder.enum;

// Енами провадження — поки не централізовані у schema; визначаємо тут.
// Узгодити з UI provider кольорів (PROC_COLORS у CaseDossier).
const PROCEEDING_TYPE_ENUM = [
  'first_instance', 'first', 'appeal', 'cassation',
  'enforcement', 'review_new_circumstances',
  'pre_trial_investigation', 'other'
];
const PROCEEDING_COLOR_ENUM = ['green', 'blue', 'yellow', 'gray'];

// Енами для update_case_field — синхронізовано з allowlist у App.jsx
// (TASK 2 прибрав 'documents' і 'proceedings' з цього allowlist).
const UPDATE_CASE_FIELD_ENUM = [
  'name', 'client', 'court', 'case_no', 'category',
  'next_action', 'notes', 'judge', 'status'
];

// ── Документи ────────────────────────────────────────────────────────────────

export const ADD_DOCUMENT_TOOL = {
  name: 'add_document',
  description:
    'Додати один документ у справу. Створює запис у реєстрі документів і ' +
    "повертає documentId. Використовуй коли адвокат просить додати конкретний " +
    "документ (наприклад: «додай ухвалу від 15 травня»). Якщо тип документа, " +
    "автор або провадження невідомі — передавай null, документ отримає маркер " +
    "⚠ для подальшої ручної класифікації. Для пакетного додавання багатьох " +
    "файлів одночасно (Document Processor) є інший інструмент add_documents — " +
    "він доступний DocumentProcessor агенту, не тобі.",
  input_schema: {
    type: 'object',
    properties: {
      caseId: { type: 'string', description: 'ID поточної справи (агент досьє завжди працює лише з нею)' },
      document: {
        type: 'object',
        description: 'Об\'єкт документа за канонічною схемою v5. Опціональні поля ' +
          '(originalName, category, author, procId, driveId, driveUrl, pageCount, date) ' +
          'просто пропускай якщо невідомі — буде маркер ⚠ для ручної класифікації.',
        properties: {
          id: { type: 'string', description: 'doc_<timestamp>_<random>; згенеруй якщо не задано' },
          name: { type: 'string', description: 'Людська назва документа' },
          originalName: { type: 'string', description: 'Опційне. Оригінальне ім\'я файлу' },
          category: { type: 'string', enum: CATEGORY_ENUM, description: 'Опційне. Тип документа; пропусти якщо невідомий (= маркер ⚠)' },
          author: { type: 'string', enum: AUTHOR_ENUM, description: 'Опційне. Автор; пропусти якщо невідомий (= маркер ⚠)' },
          documentNature: { type: 'string', enum: DOC_NATURE_ENUM },
          namingStatus: { type: 'string', enum: NAMING_STATUS_ENUM },
          isKey: { type: 'boolean', description: 'Чи ключовий документ ⭐' },
          procId: { type: 'string', description: 'Опційне. ID провадження; пропусти якщо невідомо (= маркер ⚠)' },
          driveId: { type: 'string', description: 'Опційне. Google Drive file ID' },
          driveUrl: { type: 'string', description: 'Опційне. URL до файлу на Drive' },
          folder: { type: 'string', enum: FOLDER_ENUM },
          pageCount: { type: 'number', description: 'Опційне. Кількість сторінок' },
          size: { type: 'number', description: 'Розмір у байтах' },
          icon: { type: 'string' },
          date: { type: 'string', description: 'Опційне. Дата документа YYYY-MM-DD (НЕ дата запису)' },
          addedAt: { type: 'string', description: 'ISO timestamp' },
          updatedAt: { type: 'string', description: 'ISO timestamp' },
          addedBy: { type: 'string', enum: ['user', 'agent', 'system'], description: 'ХТО/ЩО додало запис: user (адвокат вручну), agent (AI-агент), system (міграція/автосинхронізація). Не плутати з document.source (канал походження файлу).' },
          status: { type: 'string', enum: ['active', 'archived'] }
        },
        required: ['name', 'documentNature', 'namingStatus', 'isKey', 'folder', 'size', 'icon', 'addedAt', 'updatedAt', 'addedBy', 'status']
      }
    },
    required: ['caseId', 'document']
  }
};

export const UPDATE_DOCUMENT_TOOL = {
  name: 'update_document',
  description:
    'Оновити одне або кілька полів існуючого документа. Поле id, addedAt, ' +
    'addedBy, driveId, originalName — НЕ редагуються (захист канонічної ' +
    'схеми). Використовуй коли адвокат каже «зміни тип цього документа на ' +
    'клопотання», «познач як ключовий», «прив\'яжи до провадження X». ' +
    'updatedAt оновлюється автоматично.',
  input_schema: {
    type: 'object',
    properties: {
      caseId: { type: 'string' },
      documentId: { type: 'string' },
      fields: {
        type: 'object',
        description: 'Поля для оновлення. Допустимі: name, category, author, ' +
          'documentNature, namingStatus, isKey, procId, driveUrl, folder, ' +
          'pageCount, date, icon, status.',
        properties: {
          name: { type: 'string' },
          category: { type: 'string', enum: CATEGORY_ENUM, description: 'Опційне. Пропусти щоб не змінювати' },
          author: { type: 'string', enum: AUTHOR_ENUM, description: 'Опційне. Пропусти щоб не змінювати' },
          documentNature: { type: 'string', enum: DOC_NATURE_ENUM },
          namingStatus: { type: 'string', enum: NAMING_STATUS_ENUM },
          isKey: { type: 'boolean' },
          procId: { type: 'string', description: 'Опційне. Прив\'язка до провадження' },
          driveUrl: { type: 'string' },
          folder: { type: 'string', enum: FOLDER_ENUM },
          pageCount: { type: 'number' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          icon: { type: 'string' },
          status: { type: 'string', enum: ['active', 'archived'] }
        }
      }
    },
    required: ['caseId', 'documentId', 'fields']
  }
};

// TASK 3.2 — очистка сирого OCR-тексту скан-документа у гарний Markdown.
export const CLEAN_DOCUMENT_TEXT_TOOL = {
  name: 'clean_document_text',
  description:
    'Очистити сирий OCR-текст СКАНОВАНОГО документа у гарний читабельний ' +
    'Markdown (абзаци, заголовки, таблиці) — НЕ змінюючи юридичний зміст. ' +
    'Використовуй коли адвокат каже «очисти цей документ», «зроби текст ' +
    'читабельним», «почисти всі тексти справи» (тоді виклич по кожному ' +
    'сканованому документу окремо). Працює ТІЛЬКИ для documentNature=scanned ' +
    '(скани/фото); для цифрових документів (DOCX/HTML/текстовий PDF) — повертає ' +
    'skipped. Уже очищені (.md) повторно не чіпай.',
  input_schema: {
    type: 'object',
    properties: {
      caseId: { type: 'string' },
      documentId: { type: 'string' }
    },
    required: ['caseId', 'documentId']
  }
};

// ── Провадження ──────────────────────────────────────────────────────────────

export const ADD_PROCEEDING_TOOL = {
  name: 'add_proceeding',
  description:
    'Додати провадження у справу (основне, апеляція, касація, виконання, ' +
    'перегляд за нововиявленими тощо). Якщо це похідне провадження від ' +
    'основного — вкажи parentProcId (так апеляції прив\'язуються до першої ' +
    'інстанції). Назву можна передавати як title або name (синоніми). ' +
    'type обов\'язковий — без нього система не знає у якій ієрархії розмістити.',
  input_schema: {
    type: 'object',
    properties: {
      caseId: { type: 'string' },
      proceeding: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'proc_<slug>; має бути унікальним у межах справи' },
          type: { type: 'string', enum: PROCEEDING_TYPE_ENUM },
          title: { type: 'string', description: 'Назва (alias: name)' },
          name: { type: 'string', description: 'Alias до title — використовуй один з двох' },
          parentProcId: { type: 'string', description: 'Опційне. ID батьківського провадження (для апеляції тощо)' },
          parentEventId: { type: 'string', description: 'Опційне. ID події яка породила це провадження' },
          court: { type: 'string', description: 'Опційне. Назва суду' },
          caseNumber: { type: 'string', description: 'Опційне. Номер справи у суді' },
          color: { type: 'string', enum: PROCEEDING_COLOR_ENUM },
          status: { type: 'string', enum: ['active', 'paused', 'closed'] },
          dateOpened: { type: 'string', description: 'Опційне. YYYY-MM-DD' },
          judges: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' }
        },
        required: ['id', 'type']
      }
    },
    required: ['caseId', 'proceeding']
  }
};

export const UPDATE_PROCEEDING_TOOL = {
  name: 'update_proceeding',
  description:
    'Оновити поля існуючого провадження. Поле type — НЕ редагується (структурне ' +
    'рішення; зміна типу = інше провадження). При зміні parentProcId система ' +
    'перевірить що нема циклічних залежностей.',
  input_schema: {
    type: 'object',
    properties: {
      caseId: { type: 'string' },
      proceedingId: { type: 'string' },
      fields: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          parentProcId: { type: 'string', description: 'Опційне. Перепривʼязка до іншого батька' },
          parentEventId: { type: 'string' },
          color: { type: 'string', enum: PROCEEDING_COLOR_ENUM },
          court: { type: 'string' },
          caseNumber: { type: 'string' },
          dateOpened: { type: 'string', description: 'YYYY-MM-DD' },
          judges: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
          status: { type: 'string', enum: ['active', 'paused', 'closed'] }
        }
      }
    },
    required: ['caseId', 'proceedingId', 'fields']
  }
};

// ── Засідання ────────────────────────────────────────────────────────────────

export const ADD_HEARING_TOOL = {
  name: 'add_hearing',
  description:
    'Додати засідання у справу. Адвокат каже «додай засідання на 15 травня о 10 ' +
    'ранку» — обчислюй реальну дату якщо сказано відносно («наступного ' +
    'понеділка»). date і time обов\'язкові, без них executeAction відмовляє.',
  input_schema: {
    type: 'object',
    properties: {
      caseId: { type: 'string' },
      date: { type: 'string', description: 'YYYY-MM-DD' },
      time: { type: 'string', description: 'HH:MM (24-год)' },
      duration: { type: 'number', description: 'У хвилинах; default 120' },
      type: { type: 'string', description: 'Опційне. Тип: підготовче/основне/інше' }
    },
    required: ['caseId', 'date', 'time']
  }
};

export const UPDATE_HEARING_TOOL = {
  name: 'update_hearing',
  description:
    'Оновити існуюче засідання — перенести дату, змінити час, тривалість, тип. ' +
    'Якщо hearingId не передано — система спробує знайти найближче scheduled ' +
    'засідання, але це fallback — краще завжди передавай hearingId.',
  input_schema: {
    type: 'object',
    properties: {
      caseId: { type: 'string' },
      hearingId: { type: 'string' },
      date: { type: 'string', description: 'YYYY-MM-DD' },
      time: { type: 'string', description: 'HH:MM' },
      duration: { type: 'number' },
      type: { type: 'string' }
    },
    required: ['caseId']
  }
};

export const DELETE_HEARING_TOOL = {
  name: 'delete_hearing',
  description:
    'Видалити засідання зі справи. Використовуй коли адвокат каже «видали ' +
    'засідання 15 травня». Якщо scheduled засідань у справі кілька — спочатку ' +
    'перепитай яке саме, не вгадуй за датою. hearingId обов\'язковий — без ' +
    'нього система не виконає видалення (захист від випадкового стирання).',
  input_schema: {
    type: 'object',
    properties: {
      caseId: { type: 'string' },
      hearingId: { type: 'string' }
    },
    required: ['caseId', 'hearingId']
  }
};

// ── Дедлайни ─────────────────────────────────────────────────────────────────

export const ADD_DEADLINE_TOOL = {
  name: 'add_deadline',
  description:
    'Додати дедлайн (процесуальний строк) у справу. Адвокат каже «треба подати ' +
    'апеляцію до 30 травня» — це дедлайн.',
  input_schema: {
    type: 'object',
    properties: {
      caseId: { type: 'string' },
      name: { type: 'string', description: 'Що треба зробити' },
      date: { type: 'string', description: 'YYYY-MM-DD' }
    },
    required: ['caseId', 'name', 'date']
  }
};

export const UPDATE_DEADLINE_TOOL = {
  name: 'update_deadline',
  description:
    'Оновити назву або дату існуючого дедлайна. Використовуй коли адвокат ' +
    'каже «перенеси дедлайн на тиждень» або «зміни назву дедлайна на ...». ' +
    'Якщо дедлайнів у справі кілька — спочатку перепитай який саме.',
  input_schema: {
    type: 'object',
    properties: {
      caseId: { type: 'string' },
      deadlineId: { type: 'string' },
      name: { type: 'string' },
      date: { type: 'string' }
    },
    required: ['caseId', 'deadlineId']
  }
};

export const DELETE_DEADLINE_TOOL = {
  name: 'delete_deadline',
  description:
    'Видалити дедлайн зі справи. Якщо дедлайн один — береш його без питань. ' +
    'Якщо кілька — спочатку перепитай який саме видалити, не вгадуй за назвою. ' +
    'deadlineId обов\'язковий — захист від випадкового стирання.',
  input_schema: {
    type: 'object',
    properties: {
      caseId: { type: 'string' },
      deadlineId: { type: 'string' }
    },
    required: ['caseId', 'deadlineId']
  }
};

// ── Нотатки ──────────────────────────────────────────────────────────────────

export const ADD_NOTE_TOOL = {
  name: 'add_note',
  description:
    'Додати нотатку до справи (caseId передано) або глобальну (без caseId). ' +
    'Категорія за замовчуванням "general". Нотатки можна закріпляти через pin_note.',
  input_schema: {
    type: 'object',
    properties: {
      caseId: { type: 'string', description: 'ID поточної справи (агент досьє завжди працює лише з нею)' },
      text: { type: 'string' },
      category: { type: 'string', description: 'general / strategy / records / тощо' },
      date: { type: 'string', description: 'Опційне. YYYY-MM-DD' },
      time: { type: 'string', description: 'Опційне. HH:MM' },
      duration: { type: 'number', description: 'Опційне. Хвилин' }
    },
    required: ['text']
  }
};

export const UPDATE_NOTE_TOOL = {
  name: 'update_note',
  description:
    'Оновити текст або метадані (дата, час, тривалість) існуючої нотатки. ' +
    'Можна перепривʼязати нотатку до іншої справи передачею нового caseId або ' +
    'до глобальних — caseId=null. Працює і з нотатками всередині справ, і з ' +
    'глобальними.',
  input_schema: {
    type: 'object',
    properties: {
      noteId: { type: 'string' },
      text: { type: 'string' },
      date: { type: 'string' },
      time: { type: 'string' },
      duration: { type: 'number' },
      caseId: { type: 'string' }
    },
    required: ['noteId']
  }
};

export const DELETE_NOTE_TOOL = {
  name: 'delete_note',
  description:
    'Видалити нотатку — як зі справи (з case.notes[]), так і з глобальних ' +
    '(notes[]). Шукає у всіх місцях за noteId. Якщо нотатка була закріплена ' +
    '(pinnedNoteIds) — закріплення також знімається.',
  input_schema: {
    type: 'object',
    properties: { noteId: { type: 'string' } },
    required: ['noteId']
  }
};

export const PIN_NOTE_TOOL = {
  name: 'pin_note',
  description:
    'Закріпити нотатку у справі — її ID додається у case.pinnedNoteIds. ' +
    'Закріплені нотатки потрапляють у системний промпт агента і у блок ' +
    '«закріплено» в UI досьє. Використовуй для нотаток що мають бути завжди ' +
    'під рукою (тактика, ключові факти).',
  input_schema: {
    type: 'object',
    properties: {
      noteId: { type: 'string' },
      caseId: { type: 'string' }
    },
    required: ['noteId', 'caseId']
  }
};

export const UNPIN_NOTE_TOOL = {
  name: 'unpin_note',
  description:
    'Зняти закріплення нотатки у справі — ID видаляється з case.pinnedNoteIds. ' +
    'Сама нотатка лишається у справі, просто перестає підсвічуватись як ' +
    'закріплена і не йде у системний промпт агента.',
  input_schema: {
    type: 'object',
    properties: {
      noteId: { type: 'string' },
      caseId: { type: 'string' }
    },
    required: ['noteId', 'caseId']
  }
};

// ── Справа ──────────────────────────────────────────────────────────────────

export const UPDATE_CASE_FIELD_TOOL = {
  name: 'update_case_field',
  description:
    'Оновити одне поле справи (назва, клієнт, суд, номер справи, категорія, ' +
    'наступна дія, нотатки, суддя, статус). НЕ для documents і proceedings — ' +
    'для них окремі add_/update_ інструменти.',
  input_schema: {
    type: 'object',
    properties: {
      caseId: { type: 'string' },
      field: { type: 'string', enum: UPDATE_CASE_FIELD_ENUM },
      value: { description: 'Нове значення (зазвичай рядок)' }
    },
    required: ['caseId', 'field', 'value']
  }
};

export const CLOSE_CASE_TOOL = {
  name: 'close_case',
  description:
    'Закрити справу (status="closed"). Використовуй коли адвокат каже «закрий ' +
    'справу» або «справу завершено». Не плутати з destroy_case (видалення — ' +
    'тільки UI).',
  input_schema: {
    type: 'object',
    properties: { caseId: { type: 'string' } },
    required: ['caseId']
  }
};

export const RESTORE_CASE_TOOL = {
  name: 'restore_case',
  description:
    'Відновити закриту справу (повернути status="active"). Використовуй коли ' +
    'адвокат каже «відкрий справу знову» або «розморозь». Парна дія до ' +
    'close_case. Не плутай з create_case (нова справа) — тут йдеться про ' +
    'reactivate існуючої.',
  input_schema: {
    type: 'object',
    properties: { caseId: { type: 'string' } },
    required: ['caseId']
  }
};

export const CREATE_CASE_TOOL = {
  name: 'create_case',
  description:
    'Створити нову справу. Використовуй коли адвокат каже «створи справу для ' +
    'клієнта Кісельова з категорії спадщина» або подібно. Передавай поля у ' +
    'fields-обʼєкті: name (як буде відображатись), client, category, court, ' +
    'case_no, judge, status (active/paused/closed). Усі поля окрім name — ' +
    'опційні. Папка на Drive автоматично НЕ створюється — для цього є окрема ' +
    'кнопка в інтерфейсі або окремий процес.',
  input_schema: {
    type: 'object',
    properties: {
      fields: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Назва справи' },
          client: { type: 'string' },
          category: { type: 'string' },
          court: { type: 'string' },
          case_no: { type: 'string' },
          judge: { type: 'string' },
          status: { type: 'string', enum: ['active', 'paused', 'closed'] },
          next_action: { type: 'string' }
        },
        required: ['name']
      }
    },
    required: ['fields']
  }
};

// ── Document Processor handover ──────────────────────────────────────────────

export const UPDATE_PROCESSING_CONTEXT_TOOL = {
  name: 'update_processing_context',
  description:
    'Зберегти підсумок останньої пакетної обробки документів (від Document ' +
    'Processor). Це службова дія між агентами — НЕ для прямого виклику з ' +
    'розмови з адвокатом. Використовується коли DP передає тобі підсумок ' +
    'обробки, а ти зберігаєш його у справу для подальших запитів.',
  input_schema: {
    type: 'object',
    properties: {
      caseId: { type: 'string' },
      context: {
        type: 'object',
        properties: {
          processedAt: { type: 'string' },
          documentsCount: { type: 'number' },
          summary: { type: 'string' }
        },
        required: ['processedAt', 'documentsCount', 'summary']
      }
    },
    required: ['caseId', 'context']
  }
};

// ── Реєстри по агентах ───────────────────────────────────────────────────────
// Синхронізовано з PERMISSIONS у App.jsx (TASK 2). DELETE-дії свідомо
// відсутні — UI-only.

export const DOSSIER_AGENT_TOOLS = [
  // Документи
  ADD_DOCUMENT_TOOL,
  UPDATE_DOCUMENT_TOOL,
  CLEAN_DOCUMENT_TEXT_TOOL,
  // Провадження
  ADD_PROCEEDING_TOOL,
  UPDATE_PROCEEDING_TOOL,
  // Засідання
  ADD_HEARING_TOOL,
  UPDATE_HEARING_TOOL,
  DELETE_HEARING_TOOL,
  // Дедлайни
  ADD_DEADLINE_TOOL,
  UPDATE_DEADLINE_TOOL,
  DELETE_DEADLINE_TOOL,
  // Нотатки
  ADD_NOTE_TOOL,
  UPDATE_NOTE_TOOL,
  DELETE_NOTE_TOOL,
  PIN_NOTE_TOOL,
  UNPIN_NOTE_TOOL,
  // Справа (без CREATE_CASE_TOOL — агент досьє не створює нові справи; це
  // для QI/Dashboard, які діють поза контекстом конкретної справи)
  UPDATE_CASE_FIELD_TOOL,
  CLOSE_CASE_TOOL,
  RESTORE_CASE_TOOL,
  // DP handover
  UPDATE_PROCESSING_CONTEXT_TOOL,
];

// Заглушка для майбутнього DP v2 (TASK Document Processor v2). Заповниться
// add_documents + update_processing_context коли DP мігруватиме на Tool Use.
export const DOCUMENT_PROCESSOR_AGENT_TOOLS = [];

export function getToolsForAgent(agentId) {
  switch (agentId) {
    case 'dossier_agent':            return DOSSIER_AGENT_TOOLS;
    case 'document_processor_agent': return DOCUMENT_PROCESSOR_AGENT_TOOLS;
    default:                         return [];
  }
}
