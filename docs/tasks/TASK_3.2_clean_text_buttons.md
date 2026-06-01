# TASK 3.2 — clean_text: кнопки ретроактивної очистки + ACTION агента

**Дата:** 2026-05-31
**Фаза:** 2/3. Parent: `TASK_3_clean_text.md`. **Залежить від 3.1** (ядро готове).
**Тип:** UI-точки виклику ядра + AI-first ACTION
**Гілка:** правило №1 CLAUDE.md (remote → `claude/*`, фолд у main після підтвердження)
**schemaVersion:** без bump (поля з 3.1 уже є)

---

## МЕТА ФАЗИ

Дати адвокату очистити **наявні** скан-документи справи заднім числом — через UI
(кнопки в Огляді і Viewer) і через агента (голос/чат). Ядро вже є з 3.1 — тут лише
точки виклику.

**Видимий результат:** кнопка «Очистити тексти» в Огляді (N документів, прогрес),
кнопка «Очистити документ» у Viewer (один), команда агенту «очисти цей документ».

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
- Цикл `cleanDocument` по черзі, прогрес «Чищу N з M» (дорого — N AI-викликів).
- ResultCard: очищено N, пропущено M (searchable/вже-md), помилок K, згруповані `attentionNotes`.
- UI-стан у компоненті; логіка — ядро. `billAsUserAction:true` (дія адвоката).

### 3.2.2 — Кнопка «Очистити документ» у Viewer (один)
- На панелі DocumentViewer (header/footer), активна лише для `scanned`.
- Один `cleanDocument`. Після — viewer перечитує і показує свіжий `.md` (3.1 дав `getCleanOrRawText`).
- `attentionNotes` показати поряд (плашка/toast).

### 3.2.3 — ACTION `clean_document_text` (AI-first)
- `actionsRegistry.js`: `clean_document_text({caseId, documentId})` → handler кличе `cleanDocument`.
  `audit:false` (не критична дія). `billAsUserAction:true`.
- PERMISSIONS: `dossier_agent` отримує `clean_document_text`.
- Промпт агента досьє: додати в список tools «`clean_document_text` — очистити текст
  скан-документа у гарний Markdown (тільки scanned)».
- Так адвокат: «очисти цей документ» / «почисти всі тексти справи» (агент ітерує).

---

## SAAS / BILLING / AI USAGE (3.2)
- **BILLING:** кнопки/ACTION — `billAsUserAction:true`, `case_work` billable (parent §C7).
- **Permissions:** новий ACTION через `executeAction` (повна перевірка). tenant через справу.
- **AI USAGE:** той самий agentType `textCleaner`/operation `clean_text` (ядро 3.1).

---

## ACCEPTANCE (3.2)
- [ ] Огляд: кнопка «Очистити тексти»; фільтр scanned+сирий; прогрес N/M; ResultCard з attentionNotes.
- [ ] Viewer: кнопка «Очистити документ» (лише scanned); після — показує `.md`; attentionNotes видно.
- [ ] ACTION `clean_document_text` + PERMISSIONS `dossier_agent`; промпт агента згадує.
- [ ] обидві кнопки і ACTION тягнуть ЯДРО 3.1 (нуль дублювання логіки).
- [ ] UI-стан у компонентах; помилка очистки не валить UI (toast).
- [ ] Інтеграція: ACTION `clean_document_text` (PERMISSIONS, виклик ядра, scanned-гард).
- [ ] Unit/інтеграція на Огляд-цикл (фільтр scanned, пропуск .md, прогрес).
- [ ] `npm test` зелений, `npm run build` success.

## ЩО НЕ РОБИТИ (3.2)
- Наскрізні заборони parent. Плюс:
- ❌ Міняти ядро 3.1 (лише викликати). Якщо ядро потребує правок — у звіт+узгодити.
- ❌ UI-вибір/мультивибір/видалення — 3.3.

## ТЕСТИ (3.2)
- Integration: ACTION `clean_document_text` (виклик ядра, scanned-гард, PERMISSIONS).
- Unit/інтеграція: Огляд-цикл (фільтр, пропуск searchable+md, прогрес-стан).
- Існуючі — зелені.

## ЗВІТ
`docs/reports/report_task3.2_clean_text_buttons.md`: 3 точки виклику; як тягнуть ядро;
ACTION+агент; тести; знахідки; перевірка; git confirm. Оновити parent мапу.

## ПЕРЕВІРКА АДВОКАТОМ
1. Огляд → «Очистити тексти» → прогрес N/M, чистить лише сирі скани, `.md`/searchable пропускає.
2. Viewer scanned → «Очистити документ» → гарний `.md`, attentionNotes видно.
3. Агент: «очисти цей документ» → виконує `clean_document_text`.
4. DOCX/HTML — кнопка неактивна (скоуп).

**Кінець TASK 3.2.**
