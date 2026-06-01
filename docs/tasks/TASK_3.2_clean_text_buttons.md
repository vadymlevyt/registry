# TASK 3.2 — clean_text: кнопки ретроактивної очистки + ACTION агента

**Дата:** 2026-05-31 (розділено 2026-06-01: підсвітки уваги винесені в окрему TASK 3.4)
**Фаза:** Parent: `TASK_3_clean_text.md`. **Залежить від 3.1** (ядро готове, у main).
**Тип:** UI-точки виклику ядра + AI-first ACTION (БЕЗ торкання ядра 3.1).
**Гілка:** правило №1 CLAUDE.md (remote → `claude/*`, фолд у main після підтвердження)
**schemaVersion:** без bump (поля з 3.1 уже є)
**Mermaid (узгоджений алгоритм):** `docs/mermaid/flow_clean_text.md` — §«Архітектура: одне
ядро — чотири точки виклику» (точки 2 і 3), §«Точка 2: кнопка "Очистити тексти" в Огляді».

---

## МЕТА ФАЗИ

Дати адвокату очистити **наявні** скан-документи справи заднім числом — через UI
(кнопки в Огляді і Viewer) і через агента (голос/чат). Ядро вже є з 3.1 — тут лише
**тонкі точки виклику** (тягнуть `cleanDocument` + Drive-шви `cleanTextDriveAdapter`).

**Видимий результат:** кнопка «Очистити тексти» в Огляді (N документів, прогрес),
кнопка «Очистити документ» у Viewer (один), команда агенту «очисти цей документ».

> Підсвітки уваги в тексті (`==мітки==`, чип/панель/навігація) — **окрема TASK 3.4**
> (вона чіпає промпт ядра). 3.2 ядро НЕ чіпає, лише показує наявні `attentionNotes` як текст.

---

## PHILOSOPHY CHECK
- **AI-first / дублювання інтерфейсів** — очистка доступна і UI, і агентом (ACTION).
  Voice-aware через текст-команду агенту.
- **Rule of Three** — Огляд і Viewer тягнуть те саме ядро 3.1; нуль дублювання логіки.
- **Однозначність (#11)** — UI-стан (прогрес/лоадер) у компонентах; логіка — у ядрі.

---

## ПОТОЧНИЙ СТАН (звірено, доповнити перед стартом)
| Що | Файл:рядок | Стан |
|----|-----------|------|
| ядро | `src/services/cleanTextService.js` | готове з 3.1 (`cleanDocument`) |
| Drive-шви cleanDocument | `cleanTextDriveAdapter.js` (`buildCleanDocumentDriveDeps`) | **перевикористати**, не дублювати |
| Огляд-кнопка «Створити контекст» | `CaseDossier` Огляд (поряд додати «Очистити тексти») | зразок UX (прогрес/toast) |
| Viewer панель | `DocumentViewer` header/footer | додати кнопку |
| ACTIONS реєстр | `src/services/actionsRegistry.js` (`createActions`) | додати `clean_document_text` |
| PERMISSIONS | `actionsRegistry.js` (`dossier_agent` allowlist) | додати дію |
| промпт агента досьє | `CaseDossier/index.jsx:339+` (tools список) | додати згадку |

---

## СКЛАДОВІ

### 3.2.1 — Кнопка «Очистити тексти» в Огляді (retroactive, N док.)
- Поряд зі «Створити контекст».
- Сканує документи справи; **фільтр** (parent скоуп): тільки `scanned` з `textFormat!=='md'`.
  Пропускає `searchable` і вже-`.md`.
- **Підтвердження перед стартом** (дорого — N AI-викликів): «Запустити очистку N документів?».
- Цикл `cleanDocument` по черзі, прогрес «Чищу N з M».
- ResultCard: очищено N, пропущено M (searchable/вже-md), помилок K, деградованих (потребують
  повтору — `ok:false, degraded`) L; згруповані `attentionNotes` (текст, без номера сторінки).
- UI-стан у компоненті; логіка — ядро. `billAsUserAction:true` (дія адвоката).

### 3.2.2 — Кнопка «Очистити документ» у Viewer (один)
- На панелі DocumentViewer (header/footer), активна лише для `scanned` з `textFormat!=='md'`.
- Один `cleanDocument`. Після успіху — viewer перечитує і показує свіжий `.md`
  (`getCleanOrRawText`). Деградовано (`ok:false`) → toast «не завершено, джерела збережено», `.md` не міняється.
- `attentionNotes` показати поряд (плашка/toast) — як текст.

### 3.2.3 — ACTION `clean_document_text` (AI-first)
- `actionsRegistry.js`: `clean_document_text({caseId, documentId})` → handler кличе `cleanDocument`
  (через adapter-шви). `audit:false` (не критична дія). `billAsUserAction:true`, `module=case_dossier`.
- PERMISSIONS: `dossier_agent` отримує `clean_document_text`.
- Промпт агента досьє: додати в список tools «`clean_document_text` — очистити текст
  скан-документа у гарний Markdown (тільки scanned)».
- Так адвокат: «очисти цей документ» / «почисти всі тексти справи» (агент ітерує).

---

## СПІЛЬНІСТЬ ДИЗАЙНУ
Обов'язкове наскрізне правило — у **parent §«СПІЛЬНІСТЬ ДИЗАЙНУ»** (design-токени, спільні
компоненти `components/shared/`, нуль CSS-островів). Кнопки/плашки 3.2 — за ним.

---

## SAAS / BILLING / AI USAGE (3.2)
- **BILLING:** кнопки/ACTION — `billAsUserAction:true`, `case_work` billable (parent §C7).
  `module=case_dossier` (а НЕ document_processor) — ядро приймає `module` параметром (3.1).
- **Permissions:** новий ACTION через `executeAction` (повна перевірка). tenant через справу.
- **AI USAGE:** той самий agentType `textCleaner`/operation `clean_text` (ядро 3.1).

---

## ACCEPTANCE (3.2)
- [ ] Огляд: кнопка «Очистити тексти»; підтвердження; фільтр scanned+сирий; прогрес N/M;
      ResultCard (очищено/пропущено/помилки/деградовані + attentionNotes текстом).
- [ ] Viewer: кнопка «Очистити документ» (лише scanned+сирий); успіх → показує `.md`;
      деградовано → toast, `.md` не змінено; attentionNotes видно.
- [ ] ACTION `clean_document_text` + PERMISSIONS `dossier_agent`; промпт агента згадує;
      `module=case_dossier` передається.
- [ ] обидві кнопки і ACTION тягнуть ЯДРО 3.1 через adapter (нуль дублювання логіки, ядро НЕ чіпаємо).
- [ ] UI-стан у компонентах; помилка/деградація очистки не валить UI (toast).
- [ ] СПІЛЬНІСТЬ ДИЗАЙНУ (parent): стилі через токени, спільні компоненти, без CSS-островів.
- [ ] Інтеграція: ACTION `clean_document_text` (PERMISSIONS, виклик ядра, scanned-гард, module).
- [ ] Unit/інтеграція на Огляд-цикл (фільтр scanned, пропуск .md/searchable, прогрес, деградація).
- [ ] `npm test` зелений, `npm run build` success.

## ЩО НЕ РОБИТИ (3.2)
- Наскрізні заборони parent. Плюс:
- ❌ **Міняти ядро 3.1** (лише викликати через adapter). Промпт-мітки / drop page — це **TASK 3.4**.
- ❌ Підсвітки уваги (`==мітки==`, рендер `<mark>`, чип/панель/навігація) — **TASK 3.4**.
- ❌ UI-вибір/мультивибір/видалення — 3.3.
- ❌ Хардкодити кольори/розміри; локальні CSS-копії (parent §СПІЛЬНІСТЬ ДИЗАЙНУ).

## ТЕСТИ (3.2)
- Integration: ACTION `clean_document_text` (виклик ядра, scanned-гард, PERMISSIONS, module).
- Unit/інтеграція: Огляд-цикл (фільтр, пропуск searchable+md, прогрес, деградований документ).
- Існуючі — зелені.

## ЗВІТ
`docs/reports/report_task3.2_clean_text_buttons.md`: 3 точки виклику; як тягнуть adapter+ядро;
ACTION+агент; обробка деградації; тести; знахідки; перевірка; git confirm. Оновити parent мапу.

## ПЕРЕВІРКА АДВОКАТОМ
1. Огляд → «Очистити тексти» → підтвердження → прогрес N/M, чистить лише сирі скани, `.md`/searchable пропускає.
2. Viewer scanned → «Очистити документ» → гарний `.md`; attentionNotes видно.
3. Агент: «очисти цей документ» → виконує `clean_document_text`.
4. DOCX/HTML / вже-`.md` — кнопка неактивна (скоуп/фільтр).

**Кінець TASK 3.2.**
