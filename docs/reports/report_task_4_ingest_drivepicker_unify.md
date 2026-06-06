# Звіт — TASK 4: спільний інгест + DrivePicker + «просто додати» + без-OCR

**Спека:** `docs/tasks/TASK_4_ingest_drivepicker_unify.md`
**Гілка:** `claude/task-4-ingest-drivepicker-Nv5S3`
**Статус:** у роботі (по етапах, з 🔹-паузами на ревʼю власника)

---

## Чек-ліст етапів

- [x] **A — `ingest.js` (труба в одну).** Фасад `ingestFiles(input, options)` поверх Context-`run`; DP переведено на нього (behavior-preserving). 🔹
- [ ] **B — винос DrivePicker** з `AddDocumentModal.jsx` → `components/DrivePicker/`.
- [ ] **B2 — злиття пікерів** (`DocumentProcessorV2/DrivePicker.jsx` → спільний). 🔹
- [ ] **C — DP-сценарій «просто додати»** (комбо готових файлів без нарізки). 🔹
- [ ] **D — `ocrMode` + «без OCR»** (Vision 2 стор. → метадані). 🔹
- [ ] **E — тумблер «стиснути перед обробкою».** 🔹

---

## Етап A — `ingest.js` (труба в одну)

**Зроблено:**
- Новий `src/services/documentPipeline/ingest.js` — чиста фабрика `createIngest({ runPipeline }) → { ingestFiles }`. Тонкий оркестратор: нормалізує вхід, валідує (`NO_FILES` на порожньому), застосовує дефолти `ocrMode:'full'` / `compress:false` і делегує у `runPipeline(input, options)`. Жодної бізнес-логіки OCR/нарізки — лише дротування.
- `DocumentPipelineContext.jsx` — вмонтовано `ingest` поверх того самого `run` (Context-обгортка над `executor.run`, що вже прокидає options у `runOptionsRef → buildPipelineDeps`). `ingestFiles` доданий у value хука `useDocumentPipeline()`.
- `DocumentProcessorV2/index.jsx` — `pipeline.run(input, options)` → `pipeline.ingestFiles(input, options)`. Опції ідентичні; `ocrMode`/`compress` дефолтяться у ingest і **інертні** (споживачі — D/E) → поведінка байт-у-байт та сама.

**Чому так (behavior-preserving):** `ocrMode`/`compress` поки лише присутні в опціях прогону, але `streamingExecutor`/`buildPipelineDeps` їх не читають. DP image-merge під-флоу (обходить `pipeline.run`) — **не зачеплено**.

**НЕ робив на етапі A** (свідомо, поза вузьким скоупом «DP переведено»): міграція модалки `AddDocumentModal` на ingest і видалення `runOcrWithRetryUI`. Стрім-шлях зараз тільки Document AI; пост-OCR retry + Claude Vision діалог потребують окремого рішення власника (винесено на наступні етапи / окрему паузу).

**Білінг:** не зачеплено — інструментація лишається у незмінному `streamingExecutor`/`buildPipelineDeps`. (Перенесення `runOcrWithRetryUI` з його `activityTracker`/`logAiUsage` — коли мігруватимемо модалку.)

**Тести:**
- Новий `tests/unit/ingest.test.js` (5): кидок без `runPipeline`; `NO_FILES` без виклику конвеєра; делегування + дефолти `full`/`false`; прокидання pipeline-налаштувань + явних `ocrMode`/`compress`; результат повертається без обгортання.
- Оновлено: `tests/unit/DocumentPipelineContext.test.jsx` (API містить `ingestFiles`), `tests/unit/DocumentProcessorV2.test.jsx` (ctx-мок), `tests/integration/dp4-ui*.test.jsx` ×3 (DP кличе `ingestFiles`).
- `npm test` — **1942 passed**. `npm run build` — **success**.

**schemaVersion:** без змін (етап A не торкається структур даних).

---

## schemaVersion / міграція (рішення — на етапі D)

_Заповнюється на етапі D._

## ROADMAP — позначки

_Знімаються по завершенні (§Фаза 4 / §7.1 / §7.2 / вісь C)._
