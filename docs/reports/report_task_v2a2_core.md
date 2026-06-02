# Звіт — TASK V2-A2: clean_text дані+ядро (3 режими, хелпер, .txt-політика, DP-пост-крок, schema variants)

**Дата:** 2026-06-02
**Гілка:** `claude/clean-text-v2-core-ugUbb` (базована на свіжому `origin/main`, ec77eaa)
**Статус:** код+тести зелені, build success. Чекає на підтвердження адвоката → фолд у `main` (код+схема+деплой+міграція).
**Parent:** `docs/tasks/TASK_clean_text_v2.md` · **Спека фази:** `docs/tasks/TASK_clean_text_v2A2_core.md`

---

## 1. Mode + два промти (A2.1)

`cleanTextService.cleanDocument({ mode })` і `polishToMarkdown({ mode })`, `mode ∈ {'digest','clean'}`, **default `'digest'`** (наявні виклики не ламаються):

- **`digest`** (Конспект) — поточний 3.1-промт (`buildDigestPrompt`), структурує/переказує для швидкого читання. Лишається як був.
- **`clean`** (Чистий) — **НОВИЙ строгий промт** (`buildVerbatimPrompt`), залізні заборони (урок Брановського): «прибери ТІЛЬКИ OCR-сміття; НЕ переставляй / НЕ групуй / НЕ скорочуй / НЕ переказуй; НЕ міняй жодного слова/цифри/дати; НЕ міняй особу/рід/відмінок (не «я»→«позивач»); поверни ТОЙ САМИЙ текст без сміття».

Обидва повертають той самий JSON `{markdown, attentionNotes}` (спільний depth-counter парсинг). `mode` пробрасується крізь `cleanBatch`→`polishOne`→`polishToMarkdown`.

## 2. Долі артефактів — `.layout`/`.txt` зберігаються (A2.2)

Success-шлях `cleanDocument` спрощено до **двох не-руйнівних кроків**: `saveMarkdown(document, caseData, markdown, mode)` → `updateDocumentMeta(…, { textFormat:'md', cleanedAt, attentionNotes, mode })`.

- **`deleteLayout` ПРИБРАНО** з success-шляху (раніше 3.1 видаляв) — layout тепер джерело «Точного» (V2-A1) і повторної генерації.
- **`moveRawTxtToArchive` ПРИБРАНО** — для no-layout сканів `.txt` є ЄДИНИМ вірним джерелом для хелпера; архівувати його = зламати `getDocumentText`.
- Adapter (`cleanTextDriveAdapter.buildCleanDocumentDriveDeps`) більше не повертає шви `moveRawTxtToArchive`/`deleteLayout`; `ocrService.deleteLayoutArtifact` лишено як примітив (більше не викликається при очистці).

## 3. `.txt` пишемо ⇔ layout відсутній (A2.3)

Канонічний фікс — у `ocrService.extractText`: коли провайдер повернув `pageStructure` (Document AI / фото-склейка), пишемо лише `.layout.json`, **`.txt` НЕ пишемо** (вірний текст читається з layout). Без layout (pdfjsLocal без pageStructure / провайдери лише з текстом) — `.txt` лишається.

Те саме застосовано у трьох явних write-точках:
- `splitDocumentsV3.writeProcessedArtifacts` — `.txt` лише коли `layoutJson.pages` порожній;
- `DocumentProcessorV2` image-merge finalize — `.txt` лише коли нема `rebuilt.layoutJson`;
- `CaseDossier` AddDocumentModal image-merge — `.txt` лише коли нема `mergeLayoutJson` (DOCX/HTML searchable без layout → `.txt` зберігається).

## 4. Хелпер `getDocumentText` (A2.4)

`ocrService.getDocumentText(doc, caseData)` — ЄДИНА точка ВІРНОГО тексту: scanned з layout → з'єднаний `page._text` (≈ старий `.txt`); інакше `.txt`-кеш. **НІКОЛИ не повертає Конспект/.md** (це переказ). Побудований на `getCachedLayout`/`getCachedText` + спільний `joinLayoutText`.

Споживачі:
- **`contextGenerator`** — перед `extractTextBatch` пробує хелпер по кожному документу (guarded `typeof ocrService.getDocumentText==='function'`); розв'язані беруть вірний текст без повторного OCR, нерозв'язані (ще не оброблені / searchable text-layer без кешу) йдуть у `extractTextBatch`. NO_FILES/AUTH перевірки враховують `helperDocs`.
- **Агент / 3.2 ACTION** — `clean_document_text` уже через ядро (вірне джерело).
- **В'ювер «Текст»** — `getCleanOrRawText` перероблено: digest (`.digest.md` / legacy `.md`) → інакше ВІРНИЙ текст (layout→`.txt`). Layout-fallback критичний: нові скани не мають `.txt`, без нього «Текст» був би порожній.

## 5. DP-пост-крок прибрано повністю (A2.5)

- `splitDocumentsV3` — гілку `cleanForReading`+`cleanFinalizedDocument` видалено (DP більше не запускає AI-очистку).
- `DocumentPipelineContext` — `cleanDriveDeps`/`cleanFinalizedDocument` + імпорти `cleanTextService`/`cleanTextDriveAdapter` видалено; persist-props `cleanForReading`/`cleanFinalizedDocument` прибрано.
- `DocumentProcessorV2` — тумблер «Очистити для читання» видалено з UI і `DEFAULT_SETTINGS` (8→7 перемикачів).
- Ядро `cleanDocument` + adapter **лишаються** — їх кличе в'ювер / 3.2 ACTION.

## 6. Schema bump 10→11 (`variants`) (A2.6)

- `documentSchema.CANONICAL_DOCUMENT_FIELDS.variants` — required, `{ clean: <cleanedAt>|null, digest: <cleanedAt>|null }`, default `{clean:null,digest:null}`. Один сенс (#11): час генерації кожного AI-варіанту; НЕ плутати з `textFormat`/`cleanedAt`. Додано у `createDocument`.
- `migrateToVersion11` — ідемпотентна; backward-compat: `textFormat==='md'` → `variants.digest=cleanedAt`, інакше обидва null; документ з валідним `variants` не чіпається.
- `CURRENT_SCHEMA_VERSION=11`, `MIGRATION_VERSION='11.0_text_variants'`.
- `backupRegistryDataPreV11` + крок у `App.jsx` EFFECT-A (і у відновленні з бекапу), прапор `levytskyi_pre_v11_backup_done`.
- `updateDocumentMeta` (adapter) пише `variants` (зливаючи наявні з `{[mode]:cleanedAt}`); allowlist `update_document` отримав `variants`.

## 7. 3.2 ACTION узгоджено (A2.7)

`clean_document_text({ caseId, documentId, mode='digest' })` — `mode` default `'digest'` (наявні виклики/кнопки/`runCleanCycle` не зламані); пробрасується у ядро.

---

## Що НЕ зачеплено у DP-фіксах (координація з DP-регресія-сесією)

Чіпали у `splitDocumentsV3` **виключно**: (1) видалення clean-post-кроку; (2) `.txt`-write гард у `writeProcessedArtifacts`. Фікси F1 (повторне читання байтів фрагментів) / F2 (triage) і вся логіка `sliceProcessedArtifacts`/`saveFragments`/routes — **недоторкані**. `git fetch origin main` зроблено перед стартом (база ec77eaa, V2-A1 уже в main).

## Тести

- **Unit нові:** clean-промт строгість (заборони особа/рід/слово через стаб) + digest-контраст; `mode` пробрасується у saveMarkdown-суфікс і meta.mode; `getDocumentText` (layout→вірний, .txt, порожньо, без subFolders); `getCleanOrRawText` (digest .md / legacy .md / layout-fallback / .txt); suffix-storage `.clean.md`/`.digest.md` співіснують; `migrateToVersion11` (дефолт, md→digest backfill, ідемпотентність, не-затирання).
- **Unit оновлені:** `extractText` (.txt НЕ пишемо коли pageStructure); `splitDocumentsV3` (layout → лише .layout, .txt-зріз тепер у per-document .layout); schema field count 31 + variants; версії 11 (canonicalSchemaV7/founderFlag/migrations); DP toggle 7.
- **Integration оновлені/нові:** `clean-text-dp` — DP БЕЗ пост-кроку (cleanFinalizedDocument не викликається навіть з прапором) + adapter/ядро персист за суфіксом, .layout/.txt цілі, variants; `dp-text-slice`/`splitDocumentsV3-routes` — зріз через .layout (без .txt); `dp4-ui` 7 перемикачів; `contextGenerator` helper-first (вірний текст, лише нерозв'язані → OCR).

`npm test` — **146 файлів / 1861 тест зелені**. `npm run build` — **success**.

## SAAS / BILLING / AI USAGE
- AI-вхід не змінився (layout-чернетка) → токени digest такі ж; новий `clean` — той самий agentType `text_cleaner`.
- DP більше не нараховує AI (пост-крок прибрано) → менше автоматичних `ai_usage`.
- schemaVersion 11 tenant-scoped через справу.

## Git
- Усі зміни на `claude/clean-text-v2-core-ugUbb`. `git fetch origin main` зроблено перед стартом; перед фолдом — повторити.
- **Код+схема+деплой+міграція** → фолд у `main` ЛИШЕ після підтвердження адвоката (правило №1 CLAUDE.md).
