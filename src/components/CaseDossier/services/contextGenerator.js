// ── CaseDossier · CONTEXT GENERATOR (спільний сервіс) ───────────────────────
// TASK 2 (context_generator_unify): єдине місце генерації case_context.md —
// «нарису справи» який читають AI-агенти щоб ЗНАТИ справу. Раніше логіка жила
// inline у CaseDossier/index.jsx (~260 рядків) і працювала лише з вкладки
// «Огляд». Тепер винесено сюди; два споживачі тягнуть звідси:
//   1) вкладка «Огляд» (кнопка «Створити контекст») — тонка обгортка;
//   2) Document Processor v2 — після обробки документів через подію
//      DOCUMENT_BATCH_PROCESSED (payload.updateCaseContext === true).
//
// #11 — ЧИСТА ВІДПОВІДАЛЬНІСТЬ: сервіс ТІЛЬКИ «сформувати і зберегти нарис».
// НЕ тримає React-стан, НЕ показує toast/systemConfirm. UI-стан
// (contextMsg/contextLoading/setCaseContext) і діалоги (replace existing,
// OAuth consent) лишаються у компоненті-споживачі. Прогрес — через
// onProgress(msg) callback. Інтерактивні розвилки повертаються кодами помилок
// ({ saved:false, error:{ code } }), які компонент маппить у свій UX.
//
// C7 (білінг при народженні): генерація — AI-виклик адвоката. logAiUsage
// (agentType 'case_context_generator') + activityTracker.report('agent_call')
// живуть ТУТ — один шлях логування на обох споживачів, без дублювання.
//
// Джерело тексту (TASK 4 §7.1, повна відмова від .txt): спершу ВІРНИЙ текст
// через ocrService.getDocumentText (scanned → layout page._text; searchable →
// текстовий шар самого PDF через extractTextLayer, БЕЗ OCR). Нерозв'язані
// документи (ще не оброблені скани) ідуть у extractTextBatch (Document AI →
// layout). Жодного .txt — ні читання, ні запису.
//
// DI-шви: side-effect залежності (Drive/OCR/AI/білінг) мають дефолти —
// реальні імпорти для застосунку; тести підставляють стаби через параметри.

import { driveRequest as defaultDriveRequest } from "../../../services/driveAuth.js";
import * as defaultOcrService from "../../../services/ocrService.js";
import { listFolderFiles as defaultListFolderFiles, findOrCreateFolder as defaultFindOrCreateFolder, uploadFileToDrive as defaultUploadFileToDrive } from "../../../services/driveService.js";
import { resolveModel as defaultResolveModel } from "../../../services/modelResolver.js";
import { logAiUsage as defaultLogAiUsage } from "../../../services/aiUsageService.js";
import * as defaultActivityTracker from "../../../services/activityTracker.js";
import { MODULES, categoryForCase } from "../../../services/moduleNames.js";

export const CASE_TYPE_LABELS = {
  civil: "цивільна",
  criminal: "кримінальна",
  admin: "адміністративна",
  administrative: "адміністративна",
  commercial: "господарська",
  military: "військова"
};

export const PROC_TYPE_LABELS = {
  first: "перша",
  appeal: "апеляція",
  cassation: "касація"
};

export const CASE_CONTEXT_SYSTEM_PROMPT_V2 = `Ти — спеціалізований юридичний асистент який формує структурований контекстний файл для адвокатської справи. Твоє завдання — проаналізувати надані документи та згенерувати файл case_context.md який потім використовуватиметься іншим агентом для відповідей адвокату по цій справі.

═══════════════════════════════════════════════════════════
МЕТАДАНІ СПРАВИ (з Legal BMS)
═══════════════════════════════════════════════════════════

Сьогодні: {{CURRENT_DATETIME_ISO}}

Назва справи: {{CASE_NAME}}
Номер справи: {{CASE_NUMBER}}
Тип справи: {{CASE_TYPE}}
Категорія: {{CASE_CATEGORY}}
Поточна стадія: {{CURRENT_STAGE}}
Суд: {{COURT_NAME}}
Суддя: {{JUDGE_NAME}}
Дата відкриття провадження: {{OPENED_DATE_ISO}}

Клієнт АБ Левицького: {{CLIENT_NAME}}
Роль клієнта: {{CLIENT_ROLE}}

Інстанції в ЄСІТС:
  Перша:    {{FIRST_INSTANCE_NUMBER}}
  Апеляція: {{APPEAL_INSTANCE_NUMBER}}
  Касація:  {{CASSATION_INSTANCE_NUMBER}}

Документи у справі: {{DOCUMENTS_COUNT}} штук
[Перелік типів і дат документів передається разом з самими документами далі]

═══════════════════════════════════════════════════════════
ЖОРСТКІ ПРАВИЛА (НЕПОРУШНІ)
═══════════════════════════════════════════════════════════

1. Використовуй ТІЛЬКИ інформацію з наданих документів і метаданих справи.

2. НІКОЛИ не вигадуй: дати, ПІБ, номери документів, суми, цитати, факти.

3. Якщо документа немає в матеріалах — не згадуй про нього.

4. Якщо в розділі недостатньо даних — залиш ТІЛЬКИ заголовок розділу без вмісту. Не пиши плейсхолдери, не пояснюй чому пусто, не заповнюй загальними фразами.

5. Цитати — дослівно, у лапках, з посиланням на документ. Це стосується норм права, формулювань суду, тез опонента, ключових тверджень сторін. Не виправляй помилки в цитатах — зберігай як в оригіналі.

6. При паралельних позиціях сторін — зберігай нейтральність:
   - Не використовуй упереджених формулювань на користь жодної сторони
   - Описуй позиції рівноцінно за тоном
   - Маркер клієнта вказано в шапці файлу — це не привід зміщувати акценти

7. Юридичні висновки які не випливають прямо з документів — не роби. Не пиши "відповідач, ймовірно, скористається...", "позивач має слабку позицію тому що..." якщо це не зазначено в матеріалах.

8. При невпевненості в інтерпретації — формулюй з обмовкою ("згідно з матеріалами", "за твердженням позивача", "в позовній заяві зазначено").

═══════════════════════════════════════════════════════════
ПРИНЦИПИ ОБСЯГУ
═══════════════════════════════════════════════════════════

Загальний ліміт — 16000 токенів. Це максимум, не ціль.

Адаптуй обсяг під реальну кількість інформації:
- Багато документів і складна справа → використовуй весь доступний обсяг для повноти
- Мало документів → пиши коротко і змістовно

Якість понад обсяг. Не вигадуй щоб заповнити. Не дублюй інформацію між розділами.

Кожна теза повинна спиратись на конкретний документ або нотатку.

Перевір перед завершенням:
- Всі релевантні документи враховані
- Всі релевантні розділи мають змістовне наповнення
- Жоден важливий аспект справи не пропущено

═══════════════════════════════════════════════════════════
ФОРМАТ ДАТ
═══════════════════════════════════════════════════════════

В усьому файлі використовуй ISO формат YYYY-MM-DD.

Виняток 1: у шапці поля «Створено» і «Оновлено» — дата І час (YYYY-MM-DD HH:MM), значення бери з поля «Сьогодні» вище.

Виняток 2: в дослівних цитатах документів дати залишаються як в оригіналі.

═══════════════════════════════════════════════════════════
СТРУКТУРА ФАЙЛУ case_context.md
═══════════════════════════════════════════════════════════

Файл починається з шапки і має 11 розділів. Структура одна для всіх типів справ. Розділ 4 (Процесуальна позиція) адаптується під тип справи.

──── ШАПКА ────

# Справа [НАЗВА] №[НОМЕР]
Створено: [ISO дата і час, YYYY-MM-DD HH:MM]
Оновлено: [ISO дата і час, YYYY-MM-DD HH:MM]
Джерело: [N] документів

Тип справи: [цивільна / адміністративна / кримінальна / господарська]
Категорія: [категорія]
Поточна стадія: [перша / апеляція / касація]

Клієнт АБ Левицького: [ПІБ], роль — [роль клієнта]

──── РОЗДІЛИ ────

## 1. Огляд справи
Стисле резюме суті спору або обвинувачення, поточної стадії, ключових питань. 2-5 речень. Не переказ позиції однієї сторони, а нейтральний огляд предмета розгляду.

## 2. Сторони
Усі учасники процесу з зазначенням ролей. Включно з:
- Позивач / відповідач (за первісним і зустрічним якщо є)
- Третя особа з / без самостійних вимог
- Прокурор (якщо бере участь)
- Законний представник (якщо неповнолітній / недієздатний)
- Адвокат-представник опонента (якщо відомо)
- Інші учасники

Для кримінальних справ:
- Підозрюваний / обвинувачений
- Потерпілий
- Законний представник потерпілого
- Цивільний позивач (якщо є цивільний позов)
- Прокурор
- Захисник (якщо ми)

Маркувати нашого клієнта у списку: "(наш клієнт)".

## 3. Суд і провадження
- Суд: повна назва і місцезнаходження
- Суддя: ПІБ
- Номери проваджень для кожної інстанції
- Дата відкриття провадження
- Якщо рух між інстанціями — коротко зафіксувати: "В апеляції з [дата]"

## 4. Процесуальна позиція

──── АДАПТАЦІЯ ПІД ТИП СПРАВИ ────

ДЛЯ ЦИВІЛЬНОЇ / АДМІНІСТРАТИВНОЇ:

### 4.1. Позиція позивача (за первісним позовом)
- Предмет позову
- Підстави
- Розмір вимог (для майнових справ — окремим підрозділом "Майнові вимоги і розрахунки" з конкретними сумами і логікою розрахунку)
- Норми права на які посилається
- Прецеденти і судова практика на яку посилається

### 4.2. Позиція відповідача (за первісним позовом)
- Заперечення
- Контраргументи
- Норми права на які посилається
- Прецеденти на які посилається

### 4.3. Зустрічний позов (якщо подано)
- Статус: подано / прийнято / відмовлено у прийнятті
- Позиція позивача за зустрічним
- Позиція відповідача за зустрічним

ДЛЯ КРИМІНАЛЬНОЇ:

### 4.1. Обвинувачення
[з обвинувального акту або повідомлення про підозру]
- Стаття КК
- Кваліфікація дій
- Епізоди обвинувачення
- Доказова база обвинувачення

### 4.2. Позиція захисту
[з документів захисту, якщо є]
- Заперечення обвинувачення
- Аргументи на користь підзахисного
- Норми права на які посилається

### 4.3. Позиція потерпілого
[повноцінний розділ, незалежно від того кого представляємо]
- Версія подій потерпілого
- Заявлені вимоги (моральна шкода, цивільний позов)
- Позиція щодо обвинувачення

### 4.4. Цивільний позов у кримінальному провадженні (якщо є)
- Позивач, відповідач, предмет позову, сума

ДЛЯ ГОСПОДАРСЬКОЇ:
Структура як для цивільної (4.1, 4.2, 4.3 для зустрічного).

## 5. Хронологія подій
Хронологічний список ключових процесуальних дій з ISO датами:
- YYYY-MM-DD: подія (документ: тип і дата)
- YYYY-MM-DD: подія
...

Включати: подачі документів, судові засідання (відбулись/відкладені/перенесені), ухвали суду, рішення, апеляції, передачі справи між інстанціями, експертизи призначені/проведені.

## 6. Документи у справі
Перелік усіх документів які проаналізовано. Для кожного:
- Тип документа
- Дата документа (ISO)
- Хто виходить (суд / позивач / відповідач / третя особа / адвокат)
- Суть в 1-3 реченнях

## 7. Експертизи
Окремий блок для кожної експертизи:

### [Назва експертизи]
- Дата проведення
- Хто провів (експерт або установа)
- Предмет дослідження
- Ключові висновки (3-7 пунктів):
  - [висновок 1]
  - [висновок 2]
  - ...

Якщо є рецензія — як зноска одразу під експертизою:
> Рецензія: [джерело], [дата]. Суть рецензії: [короткий виклад]

Якщо експертиз немає — розділ 7 залишити порожнім (тільки заголовок).

## 8. Ключові факти і докази
Найважливіші факти які впливають на вирішення справи. Кожен факт пов'язаний з конкретним документом:
- Факт 1: [короткий виклад]. Підтвердження: [документ, сторінка/пункт].
- Факт 2: [...]
...

Не плутати з позиціями сторін (розділ 4) — тут об'єктивні факти які встановлюються матеріалами.

## 9. Слабкі місця

### 9.1. Слабкі місця позиції позивача / обвинувачення
[Нейтральний аналіз слабких місць — суперечності, нестача доказів, процесуальні порушення, прогалини]

### 9.2. Слабкі місця позиції відповідача / захисту
[Симетрично нейтральний аналіз]

### 9.3. По зустрічному / потерпілого / іншим учасникам
[Якщо релевантно — слабкі місця їх позицій]

Включати ризики як підкатегорію слабких місць (а не окремий розділ).

## 10. Спостереження адвоката
[Заповнюється з переданих нотаток адвоката, прив'язаних до справи]

Якщо нотаток немає — заголовок без вмісту.

Не вигадувати спостереження. Не додавати загальних коментарів. Тільки реальні нотатки.

## 11. Поточний статус
Станом на [ISO дата формування].

Стисло — на якій стадії справа зараз, чи є непідтверджені документи, чи очікується подача чогось.

Не писати про "найближчі події" чи "наступні засідання" — це швидко змінюється і не повинно бути в контекстному файлі.

═══════════════════════════════════════════════════════════
ОБРОБКА ПЕРЕДАНИХ НОТАТОК
═══════════════════════════════════════════════════════════

Перед документами в системному промпті можуть бути передані нотатки адвоката:

НОТАТКИ АДВОКАТА (з Legal BMS):
[Нотатка 1, дата YYYY-MM-DD, тип: ...]: текст нотатки
[Нотатка 2, дата YYYY-MM-DD, тип: ...]: текст нотатки
...

Ці нотатки використовувати:
- Розділ 10 (Спостереження адвоката) — основне джерело
- Інші розділи — як додатковий контекст для розуміння (наприклад якщо в нотатці згадано що "опонент готував зустрічний позов" — це підказка для розділу 4.3)

Не цитувати нотатки дослівно, переформульовувати в нейтральний стиль.

Якщо нотаток немає — розділ 10 залишити порожнім (тільки заголовок).

═══════════════════════════════════════════════════════════
ОБРОБКА ДОКУМЕНТІВ
═══════════════════════════════════════════════════════════

Документи передаються нижче як document blocks. Кожен документ — це текст вже обробленого через OCR файлу.

Для великих документів (позов на десятки сторінок, експертиза):
- Не цитуй повністю
- Виокремлюй: тип, дата, автор, суть в 5-10 реченнях
- Цитуй точно тільки те що критично (норми права, ключові тези, формулювання вимог)
- Решту — переказ своїми словами з посиланням

═══════════════════════════════════════════════════════════
ЗАВДАННЯ
═══════════════════════════════════════════════════════════

Проаналізуй передані документи і нотатки. Сформуй case_context.md за вищевказаною структурою.

Файл має бути готовий до прямого збереження на Google Drive — без додаткових коментарів, пояснень "ось ваш файл" чи інших обгорток. Тільки сам markdown.

Перший рядок твоєї відповіді має бути "# Справа [назва] №[номер]".`;

export function buildCaseMetadata(caseData, documentsCount) {
  const proceedings = Array.isArray(caseData.proceedings) ? caseData.proceedings : [];
  const findInstance = (type) => {
    const proc = proceedings.find(p => p.type === type);
    return proc?.case_no || proc?.case_number || "";
  };
  const activeProc = proceedings.find(p => p.status === "active") || proceedings[0];
  const currentStage = activeProc ? (PROC_TYPE_LABELS[activeProc.type] || activeProc.type || "") : "";
  const firstInstance = findInstance("first") || (currentStage === "перша" ? (caseData.case_no || "") : "");

  // #6 — нарис має нести дату І час генерації (раніше лише дата), щоб
  // відрізняти «створено» від «оновлено». Локальний час (машина адвоката),
  // формат YYYY-MM-DD HH:MM.
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const currentDateTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  return {
    CURRENT_DATE_ISO: now.toISOString().slice(0, 10),
    CURRENT_DATETIME_ISO: currentDateTime,
    CASE_NAME: caseData.name || "",
    CASE_NUMBER: caseData.case_no || "",
    CASE_TYPE: CASE_TYPE_LABELS[caseData.category] || caseData.category || "",
    CASE_CATEGORY: caseData.subcategory || "",
    CURRENT_STAGE: currentStage,
    COURT_NAME: caseData.court || "",
    JUDGE_NAME: caseData.judge || "",
    OPENED_DATE_ISO: caseData.opened_date || "",
    CLIENT_NAME: caseData.client || "",
    CLIENT_ROLE: caseData.client_role || "",
    FIRST_INSTANCE_NUMBER: firstInstance,
    APPEAL_INSTANCE_NUMBER: findInstance("appeal"),
    CASSATION_INSTANCE_NUMBER: findInstance("cassation"),
    DOCUMENTS_COUNT: String(documentsCount || 0),
  };
}

export function fillSystemPrompt(template, metadata) {
  let prompt = template;
  for (const [key, value] of Object.entries(metadata)) {
    prompt = prompt.replaceAll(`{{${key}}}`, value);
  }
  return prompt;
}

export function getNotesForContext(caseData, caseNotes, options = {}) {
  const { maxRecent = 5, maxPinned = 10 } = options;
  const list = Array.isArray(caseNotes) ? caseNotes : [];
  const pinnedIds = new Set((caseData?.pinnedNoteIds || []).map(String));

  const pinned = list
    .filter(n => pinnedIds.has(String(n.id)))
    .slice(0, maxPinned)
    .map(n => ({ ...n, isPinned: true }));

  const recent = list
    .filter(n => !pinnedIds.has(String(n.id)))
    .sort((a, b) => new Date(b.ts || b.createdAt || 0) - new Date(a.ts || a.createdAt || 0))
    .slice(0, maxRecent)
    .map(n => ({ ...n, isPinned: false }));

  return [...pinned, ...recent];
}

export function formatNotesForPrompt(notes) {
  if (!notes || notes.length === 0) return "";
  const lines = ["НОТАТКИ АДВОКАТА (з Legal BMS):"];
  for (const note of notes) {
    const raw = note.ts || note.createdAt;
    const date = raw ? new Date(raw).toISOString().slice(0, 10) : "";
    const type = note.type || note.category || "general";
    const pinTag = note.isPinned ? " [закріплена]" : "";
    const text = (note.text || note.content || "").trim();
    lines.push(`[${date}, ${type}${pinTag}]: ${text}`);
  }
  return lines.join("\n");
}

// ── generateCaseContext ─────────────────────────────────────────────────────
// ЄДИНЕ рішення: сформувати case_context.md з ПОТОЧНОГО набору документів справи
// і зберегти на Drive (архівуючи попередній). ПОВНА регенерація — не інкремент.
//
// Очікує вже розвʼязані ресурси (компонент-споживач їх готує):
//   caseData    — обʼєкт справи (метадані + storage)
//   notes       — нотатки справи (для розділу 10 нарису)
//   folderId    — storage.driveFolderId справи
//   subFolders  — { '01_ОРИГІНАЛИ': id, '02_ОБРОБЛЕНІ': id, ... } (через ensureSubFolders)
//   token       — Drive OAuth токен
//   apiKey      — ключ Claude
//   onProgress(msg)   — callback прогресу (компонент мапить у contextMsg / toast)
//   aiUsageSink       — sink для ai_usage[] (телеметрія OCR + генерації)
//
// Повертає:
//   успіх  → { saved:true,  contextText, stats:{ count, fromCache, failed } }
//   розвилка/помилка → { saved:false, error:{ code, message? } }
//     code: 'NO_FILES' | 'AUTH' | 'NO_API_KEY' | 'EMPTY' | 'SAVE_FAILED'
//   API-помилка генерації — кидає (компонент ловить у свій catch, як раніше).
export async function generateCaseContext(params) {
  const {
    caseData,
    notes,
    folderId,
    subFolders,
    token,
    apiKey,
    onProgress = () => {},
    aiUsageSink = null,
    // DI-шви (дефолти — реальні; тести підставляють стаби):
    driveRequest = defaultDriveRequest,
    ocrService = defaultOcrService,
    resolveModel = defaultResolveModel,
    listFolderFiles = defaultListFolderFiles,
    findOrCreateFolder = defaultFindOrCreateFolder,
    uploadFileToDrive = defaultUploadFileToDrive,
    logAiUsage = defaultLogAiUsage,
    activityTracker = defaultActivityTracker,
    fetchImpl = (typeof fetch !== "undefined" ? fetch : undefined),
  } = params;

  // 3. Джерело документів = реєстр cases[].documents (канонічний SSOT), НЕ
  //    folder-scan 01_ОРИГІНАЛИ+02_ОБРОБЛЕНІ. Folder-scan тягнув .layout.json,
  //    chunks, копії, дублі 01/02 → завищений лік (89/91 замість 43) і ~45
  //    layout-помилок (.layout.json — JSON, валив OCR). Реєстр = рівно реальні
  //    документи справи (#7).
  //    TASK 4 §7.1: ВІРНИЙ текст спершу через ocrService.getDocumentText
  //    (хелпер #11: scanned→layout page._text; searchable→текстовий шар PDF
  //    через extractTextLayer — БЕЗ OCR і НІКОЛИ не Конспект). Документи, які
  //    хелпер не розв'язав (ще не оброблені скани без layout), ідуть у
  //    extractTextBatch (Document AI → layout). Жодного .txt. Хелпер інжектується
  //    через ocrService — тести без нього падають на extractTextBatch.
  onProgress("Збираю документи...");
  const registryDocs = Array.isArray(caseData?.documents) ? caseData.documents : [];
  const skipped = [];   // документи без driveId — нічого читати, пропускаємо з warning
  const filesForOcr = [];
  const helperDocs = [];   // { name, text } — вірний текст з хелпера (layout/.txt)
  let helperCacheHits = 0;
  const useHelper = typeof ocrService.getDocumentText === 'function';
  for (const d of registryDocs) {
    if (!d?.driveId) { skipped.push(d?.name || d?.id || 'unknown'); continue; }
    const docName = d.name || d.originalName || d.driveId;
    if (useHelper) {
      let verbatim = '';
      try { verbatim = await ocrService.getDocumentText(d, caseData); } catch { verbatim = ''; }
      if (verbatim && String(verbatim).trim()) {
        helperDocs.push({ name: docName, text: String(verbatim) });
        helperCacheHits++;
        continue;
      }
    }
    filesForOcr.push({
      id: d.driveId,                                  // driveId → download провайдером (Document AI → layout)
      name: docName,
      mimeType: 'application/pdf',                     // канонічний формат зберігання (TASK A)
      driveFolderId: folderId,
      subFolders,
    });
  }

  if (skipped.length) {
    console.warn(`[contextGenerator] ${skipped.length} документів без driveId — пропущено:`, skipped);
  }

  // NO_FILES лише коли жодного документа з driveId (ні хелпер, ні OCR).
  if (filesForOcr.length === 0 && helperDocs.length === 0) {
    return { saved: false, error: { code: 'NO_FILES' } };
  }

  console.log(`[contextGenerator] джерело (реєстр SSOT): ${filesForOcr.length + helperDocs.length} документів (${helperDocs.length} з хелпера, ${filesForOcr.length} через OCR)${skipped.length ? `, ${skipped.length} без driveId пропущено` : ''}`);
  onProgress(`Знайдено ${filesForOcr.length + helperDocs.length} документів. Запускаю обробку...`);

  // 4. OCR через сервіс — паралельно через Document AI з кешем (лише для
  //    документів, які хелпер не розв'язав).
  const results = filesForOcr.length > 0 ? await ocrService.extractTextBatch(filesForOcr, {
    concurrency: 3,
    onProgress: (done, total, current) => {
      onProgress(`Обробка ${done}/${total}: ${current?.name || '...'}`);
    },
    caseId: caseData?.id,
    aiUsageSink: aiUsageSink ? (entry) => aiUsageSink(prev => {
      const next = Array.isArray(prev) ? [...prev, entry] : [entry];
      return next.length > 50000 ? next.slice(next.length - 50000) : next;
    }) : null,
  }) : [];

  // 5. Якщо ВСІ помилки AUTH (і хелпер нічого не дав) — компонент пропонує
  //    forceConsentRefresh. Коли хелпер уже розв'язав частину — не блокуємо.
  const allAuth = results.length > 0 && results.every(r => r.error?.code === 'AUTH') && helperDocs.length === 0;
  if (allAuth) {
    return { saved: false, error: { code: 'AUTH' } };
  }

  // 6. Зібрати тексти і помилки (вірний текст з хелпера + результати OCR).
  const textDocs = [...helperDocs];
  const failed = [];
  let cacheHits = helperCacheHits;
  for (const r of results) {
    if (r.result?.text) {
      textDocs.push({ name: r.file.name, text: r.result.text });
      if (r.result.fromCache) cacheHits++;
      console.log(`[contextGenerator] OK ${r.file.name} via ${r.result.provider} (${r.result.fromCache ? 'cache' : 'fresh'}, ${r.result.text.length} симв)`);
    } else if (r.error) {
      failed.push({ name: r.file.name, error: r.error.message });
      const localized = ocrService.localizeOcrError ? ocrService.localizeOcrError(r.error.code) : r.error.message;
      textDocs.push({ name: r.file.name, text: `[Файл: ${r.file.name} — помилка: ${localized}]` });
      console.log(`[contextGenerator] FAIL ${r.file.name}: ${r.error.code} ${r.error.message}`);
    }
  }

  onProgress(`Аналізую ${textDocs.length} документів${cacheHits ? `, ${cacheHits} з кешу` : ''}${failed.length ? `, ${failed.length} помилок` : ''}...`);

  // 7. API ключ Claude
  if (!apiKey) {
    return { saved: false, error: { code: 'NO_API_KEY' } };
  }

  // 8. System prompt v2 — шаблон з метаданими справи
  const metadata = buildCaseMetadata(caseData, textDocs.length);
  const systemPrompt = fillSystemPrompt(CASE_CONTEXT_SYSTEM_PROMPT_V2, metadata);

  // 9. Нотатки адвоката (закріплені + останні) — окремий блок перед документами
  const notesForPrompt = getNotesForContext(caseData, notes);
  const notesBlock = formatNotesForPrompt(notesForPrompt);

  // 10. Тіло — тільки текст. OCR вже відпрацював, image-блоки не потрібні.
  const textBlock = textDocs
    .map((d, i) => `### ДОКУМЕНТ ${i + 1}: ${d.name}\n\n${d.text}`)
    .join("\n\n---\n\n");

  const userContent = [];
  if (notesBlock) {
    userContent.push({ type: "text", text: notesBlock });
  }
  userContent.push({ type: "text", text: `Текстові документи справи:\n\n${textBlock}` });
  userContent.push({
    type: "text",
    text: `Проаналізуй усі ${textDocs.length} документів${notesBlock ? " і нотатки адвоката вище" : ""} і сформуй case_context.md за структурою з системного промпту. Жоден документ не ігноруй.`
  });

  // 11. Виклик Anthropic
  const ctxModel = resolveModel('caseContextGenerator');
  const apiRes = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: ctxModel,
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }]
    })
  });

  if (!apiRes.ok) {
    const errText = await apiRes.text();
    throw new Error(`API ${apiRes.status}: ${errText.slice(0, 500)}`);
  }

  const data = await apiRes.json();
  // C7 — білінг при народженні: один шлях логування на обох споживачів.
  try {
    logAiUsage({
      agentType: 'case_context_generator',
      model: ctxModel,
      inputTokens: data?.usage?.input_tokens,
      outputTokens: data?.usage?.output_tokens,
      context: { caseId: caseData?.id || null, module: MODULES.CASE_DOSSIER, operation: 'generate_context' },
    }, aiUsageSink);
    // Досьє завжди має caseId — категорія детермінована.
    activityTracker.report('agent_call', {
      caseId: caseData?.id || null,
      module: MODULES.CASE_DOSSIER,
      category: categoryForCase(caseData?.id),
      metadata: { agentType: 'case_context_generator', operation: 'generate_context' }
    });
  } catch {}
  const contextMd = data?.content?.[0]?.text || "";

  if (!contextMd) {
    return { saved: false, error: { code: 'EMPTY' } };
  }

  // 12. Архівація попереднього + upload нового
  onProgress("Зберігаю case_context.md...");

  const existingFiles = await listFolderFiles(folderId, token);
  const existingCtx = existingFiles.find(f => f.name === "case_context.md");
  if (existingCtx) {
    const archiveFolder = await findOrCreateFolder("archive", folderId, token);
    // Timestamp до секунд: 2026-04-26T14-30-15
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const archiveName = `case_context_${ts}.md`;
    await driveRequest(`https://www.googleapis.com/drive/v3/files/${existingCtx.id}/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: archiveName, parents: [archiveFolder.id] })
    });
    await driveRequest(`https://www.googleapis.com/drive/v3/files/${existingCtx.id}`, {
      method: "DELETE",
    });
  }

  const uploadResult = await uploadFileToDrive(
    "case_context.md",
    new Blob([contextMd], { type: "text/markdown" }),
    folderId,
    token
  );

  if (uploadResult?.error) {
    console.error('[contextGenerator] context save failed:', uploadResult.error);
    return { saved: false, contextText: contextMd, error: { code: 'SAVE_FAILED', message: uploadResult.error.message } };
  }
  if (!uploadResult?.id) {
    return { saved: false, contextText: contextMd, error: { code: 'SAVE_FAILED' } };
  }

  return {
    saved: true,
    contextText: contextMd,
    stats: { count: textDocs.length, fromCache: cacheHits, failed: failed.length, skipped: skipped.length },
  };
}
