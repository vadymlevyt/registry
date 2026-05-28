# DPv2 — Що за чим виконується (real call trace + хаос)

Дата: 2026-05-27
Метод: прямий читання поточного main коду, без вигадок.

---

## A. ПОСЛІДОВНІСТЬ ВИКЛИКУ (від кнопки «Розпочати» до записаного документа)

```
КРОК 0: Адвокат натиснув «Розпочати»
─────────────────────────────────────────────────────────────────────
  📄 src/components/DocumentProcessorV2/index.jsx

  Line 408: <button onClick={startProcessing}>
  Line 180: startProcessing() {
    Line 187:   setRunning(true)
    Line 188:   setResult(null)
    Line 191:   const input = await buildRunInput()
                  ↓ збирає selected[] + inboxSelected[]
                  ↓ для device-файлів — лишає raw:File у пам'яті
                  ↓ для drive-файлів — readDriveFileBytes() в RAM
                  ↓ повертає {caseId, caseData, agentId, source, addedBy, files[]}
    Line 193:   const options = {...settings, autoConfirm:true, collectDataset}
    Line 199:   const res = await pipeline.run(input, options)
                                            ↓
                                            ↓
КРОК 1: Context перетворює виклик
─────────────────────────────────────────────────────────────────────
  📄 src/contexts/DocumentPipelineContext.jsx

  Line 267: run(input, options) = useCallback(() => {
    Line 268:   runOptionsRef.current = options
    Line 269:   cancelledRef.current = false
    Line 270:   return executor.run(input)
              })
                                            ↓
                                            ↓
КРОК 2: Executor готує середовище
─────────────────────────────────────────────────────────────────────
  📄 src/services/documentPipeline/streamingExecutor.js

  Line 152: async function run(input, {resumeState=null}={}) {
    Line 153:   jobId = resumeState?.jobId || input.jobId || `dpjob_${ts}_${rand}`
    Line 157:   progressStore.startJob({jobId, caseId, title, total:0})
    Line 161:   const estBytes = files.reduce(...) * 3
    Line 163:   await drivePort.quota()
    Line 164:   const verdict = freeSpaceVerdict(quota, estBytes)
                  ↓ якщо verdict.ok===false → return {ok:false, blocked:true}
                                            ↓
КРОК 3: Цикл по файлам — OCR streaming
─────────────────────────────────────────────────────────────────────
  Line 179: for (let i = 0; i < input.files.length; i++) {
    Line 181:   const f = input.files[i]
    Line 185:   let ab = await f.raw.arrayBuffer() // або f.arrayBuffer
    Line 187:   const tempFolderId = await jobStore._jobFolderId(caseId, jobId)
    Line 190:   tempOriginal = await drivePort.uploadBytes(tempFolderId, `orig_${fileId}.pdf`, ...)
    Line 202:   const streamed = await streamFile(state, fe, ab)
                                            ↓
                                            ↓
КРОК 3.1: streamFile — поетапно по chunks
─────────────────────────────────────────────────────────────────────
  Line 95: async function streamFile(state, fileEntry, sourceAb) {
    Line 96:   const {pageCount, chunks} = await chunkMgr.planChunks(...)
                          ↓ 📄 src/services/documentPipeline/chunkManager.js:35
                          ↓ Worker: pdfInfo(buffer) → pageCount
                          ↓ adviseChunkPages(...) → chunkPages
                          ↓ 📄 src/services/documentPipeline/memoryMonitor.js:60

    Line 114:  for (const c of chunks) {
      Line 123:   const mat = await chunkMgr.materializeChunk({caseId, jobId, fileId, buffer, chunk:c})
                          ↓ chunkManager.js:56
                          ↓ Worker: splitPdf({buffer, ranges}) → parts[0]
                          ↓ drivePort.uploadBytes(folderId, `chunk_<N>.pdf`, ...)
                          ↓ повертає {driveId, name, sizeBytes}
      Line 124:   let chunkBytes = await chunkMgr.readChunkBytes(mat.driveId)
                          ↓ chunkManager.js:77
                          ↓ drivePort.readBytes(driveId) → ArrayBuffer
      Line 127:   res = await deps.processChunk({bytes:chunkBytes, startPage, endPage, fileId})
                          ↓ 📄 src/contexts/DocumentPipelineContext.jsx:121
                          ↓ ocrChunkBytes({bytes}) {
                          ↓   const blob = new Blob([bytes], {type:'application/pdf'})
                          ↓   const res = await ocrService.extractText(
                          ↓     {name:'chunk.pdf', mimeType:'application/pdf', localBlob:blob},
                          ↓     {skipCache:true, forceProvider:'documentAi'}
                          ↓   )
                          ↓ }
                          ↓
                          ↓ 📄 src/services/ocrService.js:238
                          ↓ extractText(file, options) {
                          ↓   chain = ['documentAi']  (forceProvider)
                          ↓   for (name of chain) {
                          ↓     const impl = providers.get(name)  // documentAi
                          ↓     const result = await impl.extract(file, providerOpts)
                          ↓
                          ↓ 📄 src/services/ocr/documentAi.js:249
                          ↓ extract(file, options) {
                          ↓   arrayBuffer = await file.localBlob.arrayBuffer()
                          ↓   GUARD 287: bytes > 40 МБ → throw UNSUPPORTED
                          ↓   pdfDoc = PDFDocument.load(arrayBuffer)
                          ↓   якщо pageCount <= 15 → 1 запит:
                          ↓     postToDocAiWithRetry(arrayBuffer, mime, opts)
                          ↓       documentAi.js:219 → executeWithRetry(postToDocAi, ...)
                          ↓       documentAi.js:153 → postToDocAi():
                          ↓         base64 = arrayBufferToBase64(bytes)
                          ↓         body = {rawDocument:{content:base64, mimeType}}
                          ↓         fetch DOC_AI_ENDPOINT POST body
                          ↓         response → {document:{text, pages:[]}}
                          ↓         pageStructure = pages.map(p => ({...p, _text: extractPageText(p, text)}))
                          ↓   якщо pageCount > 15 → inner loop sub-chunks 15 стор:
                          ↓     for each sub-chunk:
                          ↓       pdf-lib copyPages → sub-chunk PDF
                          ↓       GUARD 379: sub-chunk > 40 МБ → throw UNSUPPORTED
                          ↓       postToDocAiWithRetry(sub-chunk-bytes, ...)
                          ↓       state.pageStructureAll.push(...pages)
                          ↓       setResume(file.id, state)  (file.id===undefined для chunks!)
                          ↓   повертає {text, pageCount, pageStructure}
                          ↓ }
                          ↓
                          ↓ ocrService extractText:
                          ↓   writeArtifact(file, .txt, finalText, 'text/plain')
                          ↓     // не пишеться бо file.subFolders нема для chunk
                          ↓   повертає {text, pageStructure, ...}
                          ↓ }
                          ↓
                          ↓ ocrChunkBytes повертає {text: res.text, layout: res.pageStructure}

      Line 129:   chunkBytes = null  (RAM звільнено)
      Line 132:   slot.driveId = mat.driveId
      Line 134:   slot.text = res.text
      Line 136:   merged.push({startPage, text:res.text})
      Line 137:   layout = layout.concat(res.layout)  ← КУМУЛЯТИВНО
      Line 138:   state.chunkDurationsMs.push(Date.now() - t0)
      Line 139:   await jobStore.saveState(state)
                          ↓ 📄 jobState.js:115
                          ↓ drivePort.uploadText(folderId, 'job_state.json', JSON.stringify(state))
      Line 140:   reportProgress(state.jobId, state)
                          ↓ progressStore.updateJob({done, total, etaMs, stage:'ocr', stageLabel})
    }
    Line 143:   const {text} = await workerClient.runInWorker('mergeText', {chunks:merged})
    Line 144:   merged = null  (звільнити)
    Line 145:   return {text, layoutJson:{schemaVersion:1, pages:layout}, pageCount}
  }
                                            ↓
                                            ↓
  Line 203:   ab = null  (GC: оригінал з RAM геть)
  Line 208:   pipelineFiles.push({
                fileId, name, driveId, isDriveSource:true,
                originalMime, size, type:'application/pdf',
                metadataTemplate, extractedText, layoutJson, pageCount
              })
  } // кінець циклу по файлам
                                            ↓
                                            ↓
КРОК 4: pipeline.run — диригент стадій
─────────────────────────────────────────────────────────────────────
  Line 230:   const textMap = new Map(pipelineFiles.map(f => [f.fileId, f.extractedText]))
  Line 231:   const layoutMap = new Map(pipelineFiles.map(f => [f.fileId, f.layoutJson]))
  Line 232:   const accessors = {
                getStreamedText: (id) => textMap.get(id) || '',
                getStreamedLayout: (id) => layoutMap.get(id) || null,
              }
  Line 236:   const builtDeps = deps.buildPipelineDeps(accessors)
                          ↓ 📄 DocumentPipelineContext.jsx:178
                          ↓ buildPipelineDeps({getStreamedText, getStreamedLayout}) {
                          ↓   return {
                          ↓     stageOverrides: {
                          ↓       detectBoundaries: createTriageStage({triage:aiTriage, ...accessors}),
                          ↓       extract: createExtractV3({cleanForReading, cleanText:aiCleanText, ...}),
                          ↓       confirm: createConfirmBoundaries({}),
                          ↓       persist: createSplitDocumentsV3({...багато deps...}),
                          ↓     },
                          ↓     convertToPdf, uploadFile, createDocument,
                          ↓     eventBus, topics, getActor,
                          ↓   }
                          ↓ }
  Line 245:   const pipeDeps = {...builtDeps, onStage, onStageEnd, onSubProgress}
  Line 276:   const pipeline = deps.createPipeline(pipeDeps)
                          ↓ 📄 documentPipeline.js:444
                          ↓ createDocumentPipeline(deps) {
                          ↓   const stageImpl = {...DEFAULT_STAGE_IMPL, ...deps.stageOverrides}
                          ↓   повертає {run, STAGE, DEFAULT_STAGE_ORDER}
                          ↓ }
  Line 277:   const result = await pipeline.run({jobId, caseId, caseData, agentId, source, addedBy, files:pipelineFiles})
                                            ↓
                                            ↓
КРОК 4.1: Диригент проходить 9 стадій по черзі
─────────────────────────────────────────────────────────────────────
  📄 src/services/documentPipeline.js:440

  Line 441: async function run(input) {
    Line 442:   let ctx = makeContext(input)
                          ↓ {job, files[], documents[], decisions[], errors[], events[], stoppedAt, resumable}
    Line 443:   for (const name of DEFAULT_STAGE_ORDER) {
                  // STAGE = [intake, convert, detectBoundaries, classify, extract,
                  //         proposeMetadata, confirm, persist, emit]
      Line 444:   if (flags[name] === false) continue
      Line 445:   const impl = stageImpl[name]
      Line 451:   try { deps.onStage(name) }
      Line 458:   result = await impl(ctx, deps)
                            ↓ кожна стадія — окрема функція з контракту
                            ↓ (ctx) => StageResult {ok, ctx, decisions, error, halt}
      Line 471:   try { deps.onStageEnd(name, ms) }
      Line 475:   const disposition = classifyDisposition(result)
                            ↓ 'continue' | 'halt' | 'fatal' | 'skip'
      Line 480:   if (disposition === 'continue' && result.ctx) ctx = result.ctx
      Line 481:   if (decisions.length) ctx.decisions.push(...result.decisions)
      Line 485:   if (disposition === 'continue') continue
      Line 497:   if (disposition === 'halt') { stoppedAt=name; break }
      Line 504:   ctx.errors.push({...error, stage:name})
      Line 508:   if (disposition === 'fatal') break
      Line 513:   if (disposition === 'skip') break
    }
    Line 504:   return finalizeResult(ctx)
  }
                                            ↓
                                            ↓
КРОК 4.2: Кожна стадія детально
─────────────────────────────────────────────────────────────────────
  1) INTAKE (📄 documentPipeline.js:124)
       intakeStage(ctx) — інлайн у диригенті
       перевіряє caseId, files.length

  2) CONVERT (📄 documentPipeline.js:140)
       convertStage(ctx, deps) — інлайн у диригенті
       для kожного файла:
         якщо isDriveSource → passthrough
         якщо raw → deps.convertToPdf(raw, conversionContext)
                       ↓ 📄 src/services/converter/converterService.js
                       ↓ DOCX/HTML/IMG/HEIC → PDF
         якщо mergeArtifacts → беремо текст з готових artifacts

  3) DETECT_BOUNDARIES (📄 stages/triageStage.js:163)
       createTriageStage(stageDeps)
         triage = aiTriage (з Provider)
         getStreamedText, getStreamedLayout
       
       returns async (ctx) => {
         live = ctx.files.filter(!skipped)
         trivial = trivialImagePlan(live)?  → image_merge без AI
         artifacts = live.map(f => ({fileId, name, origin, pageCount, passport:passportOf(...)}))
         passport = resolveBoundaryText(layout, pageCount, plain)
                       ↓ 📄 stages/pageMarkers.js:355
                       ↓ buildCompactTriagePassport (compact для >70 стор)
                       ↓ buildPagedText (fallback)
         
         try {
           raw = await triage({artifacts, userHint, caseId})
                       ↓ 📄 DocumentPipelineContext.jsx:98
                       ↓ aiTriage → analyzeTriageViaToolUse
                       ↓ 📄 documentBoundary/analyzeTriageViaToolUse.js:50
                       ↓   model = resolveModel('qiParserDocument') // Haiku
                       ↓   prompt = buildTriagePrompt({artifacts, userHint})
                       ↓                ↓ 📄 documentBoundary/triagePrompt.js
                       ↓   data = await callAPIWithRetry({model, max_tokens:16000, messages})
                       ↓                ↓ 📄 toolUseRunner.js:333 (без tools!)
                       ↓   logAiUsageViaSink (ai_usage[])
                       ↓   activityTracker.report (time_entries[])
                       ↓   повертає {documents, unusedPages}
           plan = normalizePlan(raw)  // resolveOverlaps усередині
         } catch { passthrough }
         
         якщо plan.documents.length === 0 → passthrough
         якщо isDegeneratePlan(plan, live) → halt + decision triage_whole_volume
         
         повертає {ok:true, ctx:{...ctx, reconstructionPlan, unusedPages}, decisions:[{document_boundaries}]}
       }

  4) CLASSIFY (📄 documentPipeline.js:352)
       passthroughStage — заглушка, Φ2

  5) EXTRACT (📄 stages/extractV3.js)
       createExtractV3({cleanForReading, cleanText:aiCleanText, ...})
       — обробляє ctx.files[].extractedText
       — якщо cleanForReading → aiCleanText через Haiku
       — оновлює ctx.files[].extractedText

  6) PROPOSE_METADATA (📄 documentPipeline.js:355)
       passthroughStage — заглушка, Φ4

  7) CONFIRM (📄 stages/confirmBoundaries.js)
       createConfirmBoundaries({})
       — auto-confirm:true (UI ще нема)
       — passthrough поки

  8) PERSIST (📄 stages/splitDocumentsV3.js)
       createSplitDocumentsV3({drivePort, runInWorker, uploadFile, persistDocument,
                              createDocument, mergeImagesToPdf, writeText02, writeLayout02,
                              eventBus, topics, datasetCollector, fragmentsMode})
       
       returns async (ctx) => {
         для kожного doc у ctx.reconstructionPlan.documents:
           switch (doc.route) {
             case 'add_as_is':
               — uploadFile(оригінал, caseData)
               — createDocument({metadata})
               — persistDocument({caseId, document})
                       ↓ 📄 DocumentPipelineContext.jsx:162
                       ↓ persistDocuments → executeAction('add_documents', {caseId, documents:[document]})
                       ↓                ↓ 📄 services/actionsRegistry.js
                       ↓                ↓ ACTIONS.add_documents
                       ↓ cases[].documents.push(document)
               — writeText02 → ocrService.writeExtractedTextArtifact → 02_ОБРОБЛЕНІ/<name>_<id>.txt
               — writeLayout02 → ocrService.writeLayoutArtifact → 02_ОБРОБЛЕНІ/<name>_<id>.layout.json
             case 'slice':
               — pdf-lib copyPages → нарізаний PDF
               — той самий шлях upload + persist + write02
             case 'image_merge':
               — mergeImagesToPdf через Worker
               — той самий шлях
             case 'fragment_reconstruct':
               — multiFileReconstructor
               — той самий шлях
             case 'to_fragments':
               — upload до 03_ФРАГМЕНТИ (НЕ створює canonical doc)
             case 'discard':
               — пропускаємо
           }
       }

  9) EMIT (📄 documentPipeline.js:313)
       emitStage(ctx, deps) — інлайн у диригенті
       eventBus.publish(DOCUMENT_INGESTED, payload) per doc
       eventBus.publish(DOCUMENT_BATCH_PROCESSED, payload)
                                            ↓
                                            ↓
КРОК 5: Фіналізація у streamingExecutor
─────────────────────────────────────────────────────────────────────
  📄 streamingExecutor.js:288

  Line 288: if (result.ok && !result.stoppedAt) {
    Line 290:   state.status = DONE
    Line 292:   await jobStore.clearState(caseId, jobId)
                          ↓ видаляє _temp/<caseId>_<jobId>/ цілком
    Line 294:   progressStore.finishJob(jobId, {status:'done', graceMs:1500})
    Line 296:   return {ok:true, jobId, documents, decisions, events, cleanedUp:true}
  }
  Line 299: state.status = STOPPED  // pipeline fatal/skip
  Line 306: return {ok:false, jobId, resumable:true, stoppedAt, errors, decisions}
  Line 307: } catch (err) { // executor exception
    Line 314:   return {ok:false, jobId, resumable:true, stoppedAt,
                        errors:[{code:'EXECUTOR_THREW', message, stage}], decisions:[]}
  }
                                            ↓
                                            ↓
КРОК 6: DPv2 показує результат
─────────────────────────────────────────────────────────────────────
  📄 DocumentProcessorV2/index.jsx:200

  Line 200: if (res?.cancelled) → setCancelInfo
  Line 202: else if (res?.blocked) → toast 'Недостатньо місця'
  Line 204: else if (res?.ok) {
              setResult(res)
              setResultTab('tree')
              toast.success(`Оброблено: ${docs.length}`)
              loadInbox()
            }
  Line 211: else {  // ok:false
              setResult(res)
              setResultTab('attention')
              toast.error('Обробка завершилась з помилками', {description: res?.errors?.[0]?.message})
            }
  Зона 3 показує:
    Дерево — docs з cases[].documents
    Нарізка — docs з category/pageCount + unusedPages
    Питання + Помилки — decisions/errors
```

---

## B. ДЕ ХАОС — конкретно

### 🔴 1. Назви файлів брешуть про tool use
```
src/services/documentBoundary/analyzeViaToolUse.js          ← НЕ tool use, text-prompt
src/services/documentBoundary/analyzeTriageViaToolUse.js    ← НЕ tool use, text-prompt
src/services/documentBoundary/multiFileReconstructor.js     ← НЕ tool use, але без обманливої назви
```
Усі три використовують `callAPIWithRetry` без `tools:` параметра. Це text-prompt → JSON parse через `extractJson` (місце-локальна функція з depth-counter, як у App.jsx старих агентах).

Справжній tool use — лише `runMultiTurnConversation` у CaseDossier чату.

**Виправити:** або перейменувати ці файли (`analyzePromptDP.js`, `analyzeTriagePromptDP.js`), або перевести на справжній tool use (наступний TASK).

### 🔴 2. Інлайнові AI helpers у Provider
```
src/contexts/DocumentPipelineContext.jsx:
  Line 78:  aiReconstructFile  ← callAPIWithRetry inline + extractJson inline
  Line 98:  aiTriage           ← обгортка над analyzeTriageViaToolUse
  Line 105: aiCleanText        ← callAPIWithRetry inline + raw text
```

Три функції роблять майже одне: дзвонять Anthropic API через callAPIWithRetry, обробляють response. Кожна — у трохи різний спосіб:
- `aiReconstructFile` parsing JSON через локальний `extractJson` (рядок 60-72)
- `aiTriage` parsing JSON через `extractJson` всередині `analyzeTriageViaToolUse`
- `aiCleanText` парсинг просто `.text` без JSON

**Виправити:** винести у окремий модуль `src/services/dp-ai/` з трьома клієнтами: `triageClient.js`, `cleanupClient.js`, `reconstructClient.js`. Або уніфікувати під справжнім tool use після міграції.

### 🔴 3. Стадії — частково інлайн у диригенті, частково винесені
```
src/services/documentPipeline.js:
  Line 124: intakeStage      ← INLINE у диригенті
  Line 140: convertStage     ← INLINE у диригенті
  Line 199: persistStage     ← INLINE (DP-1, але переписаний на splitDocumentsV3 через override)
  Line 313: emitStage        ← INLINE
  Line 352: passthroughStage ← заглушка для CLASSIFY, PROPOSE_METADATA

src/services/documentPipeline/stages/:
  triageStage.js          ← override DETECT_BOUNDARIES
  extractV3.js            ← override EXTRACT
  confirmBoundaries.js    ← override CONFIRM
  splitDocumentsV3.js     ← override PERSIST
```

Diригент **має** дефолтні impl деяких стадій (intake/convert/persist/emit), Provider **перекриває** через `stageOverrides`. Це сплутаність: реальна логіка persist у `splitDocumentsV3.js` (Φ3-винесена), а у диригенті лежить старий DP-1 `persistStage` що не виконується.

**Виправити:** усі стадії — окремі файли у `stages/`. Диригент тримає тільки **passthrough** заглушку. Old DP-1 `persistStage` видалити (мертвий код).

### 🔴 4. AddDocumentModal — окремий шлях
```
src/components/CaseDossier/index.jsx:
  Line 3155-3163: AddDocumentModal → runOcrWithRetryUI(file, doc, caseId, onExecuteAction)
                  ↓ окремий ocrService.extractText виклик
                  ↓ окремий add_document (single) ACTION
                  ↓ НЕ через streamingExecutor / pipeline
```

DPv2 використовує `add_documents` (batch), AddModal — `add_document` (single). Два паралельних шляхи.

**Виправити:** уніфікувати — AddModal має використовувати DPv2 pipeline через `pipeline.run({files:[singleFile]})`. Або принаймні `add_documents` з масиву на 1 елемент.

### 🔴 5. Папка `_temp/<caseId>_<jobId>/` — плоска
Усе скидається у одну папку:
- `orig_<fileId>.pdf` — оригінали
- `chunk_<fileId>_<NNN>.pdf` — chunks для OCR
- `job_state.json` — стан resume
- (потенційно у TASK C — `_windows/<N>.json`, `_triages/<N>.json` для sliding window)

При багатьох файлах + chunks стає сотні файлів у одній папці на Drive. Drive listFolder ↑ повільний.

**Виправити:** структура `_temp/<caseId>_<jobId>/chunks/`, `_temp/<caseId>_<jobId>/originals/`, `_temp/<caseId>_<jobId>/state/`. Префіксація — це 5 хв коду.

### 🔴 6. Дублювання streamFile у DEFAULT_STAGE_IMPL і у streamingExecutor
```
documentPipeline.js:349  DEFAULT_STAGE_IMPL[STAGE.INTAKE] = intakeStage
documentPipeline.js:350  DEFAULT_STAGE_IMPL[STAGE.CONVERT] = convertStage
documentPipeline.js:357  DEFAULT_STAGE_IMPL[STAGE.PERSIST] = persistStage  ← OLD DP-1
documentPipeline.js:358  DEFAULT_STAGE_IMPL[STAGE.EMIT] = emitStage
```

При цьому **streamingExecutor** робить streaming OCR **ПОЗА** диригентом (рядки 178-221), потім кличе `pipeline.run` з уже-OCR-ним текстом. Тобто реально INTAKE+CONVERT у streamingExecutor виконуються двічі — раз тут (через `f.raw.arrayBuffer()`), раз як стадії диригента.

`intakeStage` лише перевіряє наявність caseId+files. `convertStage` для Drive-source — passthrough (бо `isDriveSource:true`). Тобто **рудиментарний** прохід без реальної роботи. Це **залишок DP-1 архітектури**, коли pipeline.run був самодостатнім, без streamingExecutor зверху.

**Виправити:** свідомо документувати: «streamingExecutor бере на себе INTAKE+CONVERT для streaming OCR; pipeline стадії INTAKE+CONVERT — passthrough». Або видалити ці стадії з диригента взагалі (TASK архітектурний cleanup).

### 🔴 7. `file.id === undefined` для chunk OCR
```
src/services/ocr/documentAi.js:326
  const prevState = getResume(file.id)  // file.id is undefined для ocrChunkBytes!
```
Adviceless catch — `getResume(undefined)` повертає null, `setResume(undefined, ...)` — no-op. Тобто resume mechanism в Document AI **повністю не працює для streaming chunks**. Це не баг — резюмування відбувається на рівні `streamingExecutor.jobStore` (інший шар). Але **код у documentAi.js виглядає як robust resume**, а насправді no-op.

**Виправити:** документувати або винести resume у окремий шлях (тільки для CaseDossier AddModal де file.id є).

### 🔴 8. `STRIPPED_LAYOUT_FIELDS` тільки на write, не в RAM
```
src/services/ocrService.js:139
  STRIPPED_LAYOUT_FIELDS = ['image', 'tokens']
  
src/services/ocrService.js:157
  serializeLayout({provider, pageStructure}) → JSON.stringify({pages:stripHeavyFields(pageStructure)})
  
src/services/documentPipeline/streamingExecutor.js:137
  layout = layout.concat(res.layout)  // ← image+tokens у RAM кумулятивно
```
В RAM image base64 і tokens **залишаються** кумулятивно у `layout` масиві streamFile до кінця файлу. Стрипляться ТІЛЬКИ при write на Drive (через writeLayoutArtifact → serializeLayout → stripHeavyFields). Для типового тома 200 стор. — це 1-1.4 ГБ image base64 в RAM до завершення.

(Це нас рятувало 26.05 коли імажlessMode прибирав image взагалі — але потім ламав Triage. Після відкату image знову в RAM.)

**Виправити:** strip у `ocrChunkBytes` перед поверненням layout. 5 рядків коду. Це варіант A який я давно пропонував — а зараз ВЖЕ важливо, не теоретично.

### 🔴 9. AI usage логування на трьох шарах
```
src/services/documentBoundary/analyzeTriageViaToolUse.js:67
  logAiUsageViaSink({...}, aiUsageSink)
  activityTracker.report('agent_call', {...})

src/services/toolUseRunner.js:213, etc.
  logAiUsage({...})  ← окремий шлях для tool use

src/contexts/DocumentPipelineContext.jsx (aiCleanText, aiReconstructFile)
  ← НЕ логує AI usage взагалі!
```

`aiCleanText` і `aiReconstructFile` (Provider inline) **не логують** AI usage. Це **діра у білінговій інструментації**. Адвокат використовує cleanForReading → Haiku тики спалюються, але `ai_usage[]` нічого не записує.

**Виправити:** додати `logAiUsageViaSink` + `activityTracker.report` у aiCleanText, aiReconstructFile. Або винести усі AI клієнти у уніфікований модуль (як §B.2).

### 🔴 10. Імпорт `analyzeTriageViaToolUse` через dynamic `await import`
```
DocumentPipelineContext.jsx:101
  const { analyzeTriageViaToolUse } = await import('../services/documentBoundary/analyzeTriageViaToolUse.js')
```
Це **lazy import** в hot path Triage. Перший виклик повільніший. Не критично, але дивно для модуля що використовується завжди при обробці.

**Виправити:** статичний `import` нагорі файлу. Інші DP-модулі імпортуються статично.

---

## C. ОЧИЩЕННЯ — ОРІЄНТОВНІ TASK'и

| # | Що | Складність | Користь |
|---|----|------------|---------|
| C1 | DP tool use migration (analyzeTriageViaToolUse → runMultiTurnConversation) | 2-3 дні | Структуровані output, fundament для C2-C5 |
| C2 | Винести AI helpers з Provider у `src/services/dp-ai/` | 1 день | Чистота, тестованість |
| C3 | Strip image/tokens у `ocrChunkBytes` перед layout.concat | 30 хв | RAM peak зменшується 10× |
| C4 | Уніфікувати AddDocumentModal з DPv2 pipeline | 2-3 дні | Один шлях додавання |
| C5 | Видалити мертвий DP-1 `persistStage` з диригента, INTAKE/CONVERT як passthrough | 1 день | Виявлення архітектури |
| C6 | Структуровані теки `_temp/<job>/chunks/`, `originals/`, `state/` | 30 хв | Швидкість listFolder |
| C7 | Логування AI usage у aiCleanText, aiReconstructFile | 30 хв | Закриває діру у білінгу |
| C8 | Статичний імпорт analyzeTriageViaToolUse | 5 хв | Дрібниця |

Раджу робити **C1 → C2 → C3** першими (фундамент + швидкий виграш по RAM). Решта — потроху коли стане боляче.

---

**Кінець.**

Якщо хочете щоб я детальніше розгорнув одну з зон хаосу (C1-C8) у TASK-специфікацію — скажіть яку.
