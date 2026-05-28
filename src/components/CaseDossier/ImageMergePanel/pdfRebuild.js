// ── ImageMergePanel · pdfRebuild ─────────────────────────────────────────────
// Async helper для збірки фінального PDF з orderedIndices + userRotation +
// crops + processedBlobs. Без React. Використовується index.jsx у handleSubmit.
//
// Фінальний кут обертання = (autoOrientation + userRotation) mod 360 — сума
// автоматичного визначення системи і ручного докручування адвокатом.
// Обидва кути у CW напрямку (rotateImageBlob уніфікований).

export async function rebuildFromOcrResults({
  orderedIndices,
  realFiles,
  ocrResults,
  detectedOrientations,
  userRotation,
  cropOverrides,
  cropProposals,
  cropDisabled,
  cropAppliedSet,
  processedBlobs,
}) {
  const extractedText = orderedIndices
    .map((idx) => ocrResults[idx]?.text || '')
    .filter((t) => t && t.trim())
    .join('\n\n--- Page break ---\n\n');

  const mergedPages = [];
  let pageNum = 1;
  for (const idx of orderedIndices) {
    const ps = ocrResults[idx]?.pageStructure;
    if (Array.isArray(ps)) {
      for (const p of ps) {
        if (p && typeof p === 'object') {
          const copy = { ...p, pageNumber: pageNum };
          delete copy.image;
          delete copy.tokens;
          mergedPages.push(copy);
          pageNum++;
        }
      }
    }
  }
  const layoutJson = mergedPages.length > 0
    ? JSON.stringify({
        schemaVersion: 1,
        provider: ocrResults[orderedIndices[0]]?.provider || 'documentAi',
        generatedAt: new Date().toISOString(),
        pages: mergedPages,
      })
    : null;

  const { computeRenderedBlob } = await import('../../../services/sortation/imageRenderer.js');
  const jspdfMod = await import('jspdf');
  const JsPDF = jspdfMod.jsPDF || jspdfMod.default;

  const pdf = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const A4W = 210, A4H = 297, M = 10;
  const PX_TO_MM = 0.264583;

  // Один контекст на весь rebuild — computeRenderedBlob отримує idx і вирішує
  // який шлях (processedBlob fast-path vs raw → crop → rotate). includeProposalRect:
  // true для PDF — фінальний документ застосовує proposal навіть якщо адвокат
  // не підтвердив через ✓ Готово (зберегли існуючу поведінку preview-rebuild
  // де effectiveCrops збирав override||proposal).
  const renderCtx = {
    realFiles,
    detectedOrientations: detectedOrientations || [],
    userRotation: userRotation || new Map(),
    processedBlobs: processedBlobs || new Map(),
    cropOverrides: cropOverrides || new Map(),
    cropProposals: cropProposals || new Map(),
    cropDisabled: cropDisabled || new Set(),
    cropAppliedSet: cropAppliedSet || new Set(),
  };

  for (let i = 0; i < orderedIndices.length; i++) {
    const origIdx = orderedIndices[i];
    const blob = await computeRenderedBlob(
      { ...renderCtx, idx: origIdx },
      { applyUserRotation: true, applyCrop: true, includeProposalRect: true }
    );
    if (!blob) continue;

    const url = URL.createObjectURL(blob);
    let img;
    try {
      img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('image load'));
        im.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }

    const orient = img.width > img.height ? 'landscape' : 'portrait';
    if (i > 0) pdf.addPage('a4', orient);
    const pageW = orient === 'landscape' ? A4H : A4W;
    const pageH = orient === 'landscape' ? A4W : A4H;
    const usableW = pageW - 2 * M;
    const usableH = pageH - 2 * M;
    const imgWmm = img.width * PX_TO_MM;
    const imgHmm = img.height * PX_TO_MM;
    const r = Math.min(usableW / imgWmm, usableH / imgHmm);
    const drawW = imgWmm * r;
    const drawH = imgHmm * r;
    const offX = (pageW - drawW) / 2;
    const offY = (pageH - drawH) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    pdf.addImage(dataUrl, 'JPEG', offX, offY, drawW, drawH);
  }

  const pdfBlob = pdf.output('blob');
  return { pdfBlob, extractedText, layoutJson };
}
