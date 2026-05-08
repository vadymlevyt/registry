# Знахідки під час виконання TASK 1 — Канонічна схема документа

**Дата:** 2026-05-08
**Виконавець:** Claude Code (Opus 4.7, 1M context)

---

## 1. Drag-n-drop у CaseDossier завантажує файл, але не створює запис документа

**Файл:** `src/components/CaseDossier/index.jsx:1940-1958`

```javascript
for (let i = 0; i < dropQueue.length; i++) {
  if (dropQueue[i].status === "done") continue;
  setDropQueue(prev => prev.map((item, idx) => idx === i ? { ...item, status: "uploading" } : item));
  try {
    if (driveConnected) {
      const prepared = await prepareFile(dropQueue[i].file);
      await uploadFileLocal(prepared, caseData);   // ← driveId повертається, але не використовується
    }
    setDropQueue(prev => prev.map((item, idx) => idx === i ? { ...item, status: "done" } : item));
  } catch {
    setDropQueue(prev => prev.map((item, idx) => idx === i ? { ...item, status: "error" } : item));
  }
}
```

`uploadFileLocal` повертає `driveId`, але цей результат відкидається. Файл з'являється на Drive у `01_ОРИГІНАЛИ`, але запис у `cases[].documents[]` не створюється — адвокат не побачить файл у списку Матеріалів справи.

Документ TASK 1 згадував CaseDossier:828-845 як `uploadFile`. Реально на цьому рядку — інша логіка (OCR-обробка для контексту досьє). Drag-n-drop drop queue — на 1940-1958, і вона дійсно не пов'язана зі створенням документа.

**Рекомендація:** окремий TASK "CaseDossier drag-n-drop creates document". У ньому:
- Після успішного `uploadFileLocal` викликати `createDocument({ driveId, name: file.name, originalName: file.name, size: file.size, folder: '01_ОРИГІНАЛИ', addedBy: 'lawyer_manual', namingStatus: 'pending', category: null, author: null, procId: null })` — категорія/автор/провадження null → маркер ⚠ для подальшого ручного класифікації.
- Через `executeAction` (action `add_documents`), а не прямою мутацією state.
- Тривалість: 2-3 години.

Не вмикав цю поведінку зараз: вона змінює UX (додаються нові записи з ⚠) і вимагає окремого тестування + UI-индикації що документ потребує класифікації. TASK 1 такого не передбачав.

---

## 2. Невідповідність enum: `opp` (TASK) vs `opponent` (UI/seed)

**Файли:** `src/components/CaseDossier/index.jsx:18, 2045, 2431` + 5 seed-документів у `src/App.jsx:104-111`

TASK 1.1 задавав `enum: ['ours', 'opp', 'court', 'third_party', null]` для поля `author`.
Реальний код використовує:
- `AUTHOR_LABELS = { ours, opponent, court }` (немає `third_party`)
- Рядки `["all", "ours", "opponent", "court"]` у фільтрах
- `<option value="opponent">Опонент</option>` у формі

Усі seed-документи Брановського з `author: "opponent"` (а не `"opp"`).

**Що зроблено:** розширив enum у `documentSchema.js` на перехідний період:
```javascript
enum: ['ours', 'opp', 'opponent', 'court', 'third_party', null]
```
зі коментарем що це тимчасово.

**Рекомендація:** окремий TASK "Author enum unification". Або:
- (A) Прийняти `opponent` як канонічне значення (мінімум змін у UI). Тоді з enum викидаємо `opp`.
- (B) Прийняти `opp` (TASK 1.1). Потрібно: міграція документів `opponent → opp`, оновлення UI у CaseDossier (`AUTHOR_LABELS`, фільтри, `<option>`), оновлення HAIKU/SONNET промптів якщо вони повертають `opponent`.

Тривалість (B): 2-3 години + ризик регресій у фільтрах.

---

## 3. Категорія `motion` (клопотання) була відсутня в TASK enum

**Файли:** seed-документ `src/App.jsx:105` (`category: "motion"`), `src/components/CaseDossier/index.jsx:13` (`CATEGORY_LABELS = { ..., motion: "Клопотання", ... }`)

TASK 1.1 задавав `enum: ['pleading', 'court_act', 'evidence', 'contract', 'correspondence', 'identification', 'other', null]` — без `motion`. Реально `motion` уже використовується в seed і UI.

**Що зроблено:** додав `motion` в enum зі коментарем.

**Рекомендація:** уніфікувати разом з пунктом 2 в одному TASK.

---

## 4. `driveId` в TASK був required без nullable

TASK 1.1: `driveId: { type: 'string', required: true, description: 'Google Drive file ID' }`.

Реально:
- Seed-документи INITIAL_CASES не мають Drive файлу.
- DocumentProcessor:819 — `driveId: storageResults[i]?.driveId || null` (storage може зафейлитись).
- CaseDossier модаль "+ Додати документ" — driveId null якщо файл не передано.

**Що зроблено:** змінив на `required: true, nullable: true` (як `category`/`author`/`procId`).

**Перевірити:** документ без `driveId` не може бути відкритий у Viewer. У UI треба показувати індикатор "файл відсутній на Drive". Поточний UI робить це наявним способом? — окремий аудит.

---

## 5. legacy дати у вільному форматі ("березень 2023")

Seed-документи Брановського мали `date: "березень 2023"` тощо — людська форма. Канонічна схема очікує `format: 'date'`, тобто YYYY-MM-DD.

**Що зроблено в міграції v4→v5:**
- Якщо `oldDoc.date` виглядає як ISO дата (`/^\d{4}-\d{2}-\d{2}/`) — лишається як canonical `date`.
- Якщо ні — `canonical.date = null` + `extended.customFields.legacyDateText = oldDoc.date` (зберігаємо для UI).

Seed-документи в новій INITIAL_CASES взагалі не передають `date` — тобто всі canonical date = null. Це регресія у відображенні Брановського: дати були видимі як "березень 2023", тепер їх не буде поки UI не почне читати з extended customFields.

**Рекомендація:** не виправляти у TASK 1, бо seed-дані демонстраційні. У TASK Document Processor v2 (Фаза 2) реальні документи отримають справжні YYYY-MM-DD з OCR/метаданих. Тоді `date` буде структурованим.

---

## 6. `migrationService.js` має свою константу `CURRENT_SCHEMA_VERSION = 4`

`documentSchema.js` експортує `CURRENT_SCHEMA_VERSION = 5`. Імена однакові, файли різні.

**Що зроблено:**
- В `App.jsx` імпортується перейменовано: `CURRENT_SCHEMA_VERSION` (з migrationService) і `DOCUMENT_SCHEMA_VERSION` (з documentSchema).
- `migrateRegistry` лишається у v4. Окремо `migrateRegistryV4toV5` піднімає до v5.
- Це SRP: базова міграція даних окремо, схема документа окремо.

**Альтернатива:** колапсувати все в один файл `migrationService.js` і інкрементувати CURRENT до 5. Тоді треба переробляти патерн `case 'v4 → v5'` всередині `migrateRegistry`. Зараз і так працює — не чіпаю.

---

## 7. У `migrateRegistry` (Випадок 2) registry зі schemaVersion=5 пройде як ідемпотентний

Перевірив: `if ((raw.schemaVersion || 0) >= CURRENT_SCHEMA_VERSION)` (де CURRENT=4 у migrationService) — 5 >= 4 → true. Registry v5 пройде через шлях "Випадок 2" і повернеться без змін. Це правильна поведінка.

Але в цьому шляху `migrateRegistry` не знає про v5-специфічні поля документа і не зробить нічого деструктивного. ОК.

---

## 9. Немає окремого ACTION `add_document`/`add_documents` (виявлено в патчі TASK 1)

**Контекст:** виправлення drag-n-drop у CaseDossier (пункт 1) виконано через `executeAction('dossier_agent', 'update_case_field', { caseId, field: 'documents', value: mergedArray })`.

**Проблеми тимчасового шляху:**
- Допуск `field: 'documents'` означає що `update_case_field` приймає довільний масив документів — агент може помилково перезаписати/стерти всі документи справи передавши коротший масив. Зараз ризик низький (єдиний caller — drop queue зі справжнім merge), але це шурх архітектури.
- Audit log пише запис як зміну поля, а не "додано N документів" — гірше для CRM-зрізу.
- Білінгова інструментація через `activityTracker.report` буде під назвою `update_case_field`, не `add_document` — погана аналітика.

**Рекомендований TASK:** "ACTION add_document".
- Додати в `ACTIONS`: `add_document: ({ caseId, document })` і `add_documents: ({ caseId, documents })` (масовий).
- Додати в `PERMISSIONS` для `qi_agent`, `dashboard_agent`, `dossier_agent`, `document_processor_agent`.
- Перевести drop queue (CaseDossier:1940-2000), модаль "+ Додати документ" (CaseDossier:2452-2486), DocumentProcessor processedFiles (804-822) і split (955-963) на новий ACTION.
- Прибрати `'documents'` з allowlist `update_case_field` (App.jsx:4657).
- Додати запис в audit_log для `add_document` (категорія `case_work`, `agent_call`).

Тривалість: 2-3 години.

---

## 8. Імпортовані але невикористані символи

При інтеграції додано імпорти:
- `migrateRegistryV4toV5` ✅ використовується
- `saveExtendedForCase` ✅ використовується
- `createDocument` ✅ використовується (в INITIAL_CASES)
- `DOCUMENT_SCHEMA_VERSION` ✅ використовується в порівнянні версії

Жодного dead-import.

---
