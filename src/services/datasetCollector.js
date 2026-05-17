// ── DP-3 · CUSTOM SPLITTER DATASET COLLECTOR ────────────────────────────────
// Збирає корисні дані для МАЙБУТНЬОГО тренування власного спліттера —
// тільки коли tenant.settings.splitterDatasetEnabled === true (дефолт false).
//
// Встановлене рішення §9: ОДИН toggle, БЕЗ технічної анонімізації. Замість
// неї — чесний дисклеймер у UI (DP-4) про відповідальність адвоката за
// адвокатську таємницю. DP-3 закладає інфраструктуру і поле; UI+дисклеймер —
// DP-4.
//
// Що зберігається (§9) у _datasets/splitter_training_data.json (append):
//   • межі документів і типи (з підтвердженого плану реконструкції)
//   • layout.json метадані Document AI (координати блоків, орієнтація)
//   • OCR-розпізнаний текст документів
//   • thumbnails першої/останньої сторінки кожного нарізаного документа
//     (2 JPEG ~50-100КБ) — ЛИШЕ якщо ін'єктовано renderThumbnail (canvas —
//     браузер; тести/Node без нього просто не пишуть thumbnails, решта є).
//
// Чистий сервіс-фабрика: getEnabled() і drivePort ін'єктуються (тест —
// in-memory; App — tenantService.getSplitterDatasetEnabled + реальний порт).
// НЕ кидає назовні: збір датасету — побічна користь, не критичний шлях.

export const DATASET_ROOT = '_datasets';
export const DATASET_FILE = 'splitter_training_data.json';

// deps:
//   getEnabled() → boolean                — tenantService.getSplitterDatasetEnabled
//   drivePort {getOrCreateFolder,listFolder,readText,uploadText,uploadBytes}
//   renderThumbnail(pdfBytes, pageNo) → Uint8Array(JPEG) | null  (опц., canvas)
export function createDatasetCollector(deps = {}) {
  const getEnabled = typeof deps.getEnabled === 'function' ? deps.getEnabled : () => false;
  const drivePort = deps.drivePort;
  const renderThumbnail = typeof deps.renderThumbnail === 'function' ? deps.renderThumbnail : null;

  // collect — після confirm. Один сенс: «дописати запис тренувального
  // прикладу для цього job». No-op коли toggle false або немає порту.
  async function collect({ caseId, jobId, plan, files = [], thumbnailSources = {} }) {
    if (getEnabled() !== true || !drivePort) {
      return { written: false, reason: 'disabled' };
    }
    try {
      const root = await drivePort.getOrCreateFolder(DATASET_ROOT, null);
      const existing = (await drivePort.listFolder(root.id)) || [];
      const prev = existing.find((f) => f.name === DATASET_FILE);

      let dataset = { schemaVersion: 1, examples: [] };
      if (prev) {
        try { dataset = JSON.parse(await drivePort.readText(prev.id)); } catch { /* битий — починаємо новий */ }
        if (!Array.isArray(dataset.examples)) dataset.examples = [];
      }

      const thumbnails = [];
      if (renderThumbnail) {
        for (const d of plan?.documents || []) {
          const frag = d.fragments?.[0];
          const srcBytes = frag ? thumbnailSources[frag.fileId] : null;
          if (!srcBytes) continue;
          for (const [kind, page] of [['first', frag.startPage], ['last', d.fragments[d.fragments.length - 1].endPage]]) {
            try {
              const jpeg = await renderThumbnail(srcBytes, page);
              if (jpeg) {
                const name = `thumb_${jobId}_${d.documentId}_${kind}.jpg`;
                const up = await drivePort.uploadBytes(root.id, name, jpeg, 'image/jpeg');
                thumbnails.push({ documentId: d.documentId, kind, page, driveId: up.id });
              }
            } catch { /* thumbnail не критичний */ }
          }
        }
      }

      dataset.examples.push({
        jobId,
        caseId,
        collectedAt: new Date().toISOString(),
        documents: (plan?.documents || []).map((d) => ({
          documentId: d.documentId, name: d.name, type: d.type,
          category: d.category, fragments: d.fragments,
        })),
        unusedPages: plan?.unusedPages || [],
        files: files.map((f) => ({
          fileId: f.fileId,
          name: f.name,
          text: f.processedText || f.extractedText || null,
          layout: f.layoutJson || null,
        })),
        thumbnails,
      });

      await drivePort.uploadText(root.id, DATASET_FILE, JSON.stringify(dataset), 'application/json');
      // Прибрати попередню версію (append через rewrite, як jobState).
      if (prev) { try { await drivePort.deleteFile?.(prev.id); } catch { /* noop */ } }
      return { written: true, exampleCount: dataset.examples.length, thumbnails: thumbnails.length };
    } catch (err) {
      return { written: false, reason: err?.message || String(err) };
    }
  }

  return { collect, isEnabled: () => getEnabled() === true };
}
