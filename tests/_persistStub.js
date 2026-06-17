// Тестовий persist-стейдж для диригента нарізки.
//
// A1-D прибрав дефолтний persistStage з documentPipeline.js: у prod нарізка
// завжди інжектить createSplitDocumentsV3, тож persist став ОБОВ'ЯЗКОВИМ
// override. Тести диригента, що раніше покладались на дефолт (контракт
// persist↔executeAction, accumulate documents, події emit), інжектять цей
// тонкий стаб. Він відтворює МІНІМАЛЬНИЙ контракт persist (upload →
// buildDocumentMetadata/шаблон → createDocument → persistDocument → накопичення
// documents) БЕЗ доменної логіки нарізки і БЕЗ знесених hook-слотів.
export function makePersistStub() {
  return async function persist(ctx, deps) {
    const files = [];
    const documents = [];
    for (const item of ctx.files) {
      if (item.skipped || item.document) { files.push(item); continue; }

      let driveId = item.driveId || null;
      const originalDriveId = item.originalDriveId || null;

      if (!driveId && typeof deps.uploadFile === 'function' && (item.uploadedFile || item.raw)) {
        try {
          driveId = await deps.uploadFile(item.uploadedFile || item.raw, ctx.job.caseData);
        } catch (err) {
          return {
            ok: false,
            error: {
              code: 'UPLOAD_FAILED',
              message: err?.message || 'Помилка завантаження на Drive',
              file_skipped: true,
              fileId: item.fileId,
            },
          };
        }
      }

      const metadata = typeof deps.buildDocumentMetadata === 'function'
        ? deps.buildDocumentMetadata({ item, driveId, originalDriveId, job: ctx.job })
        : {
            ...(item.metadataTemplate || {}),
            driveId: driveId || null,
            driveUrl: driveId ? `https://drive.google.com/file/d/${driveId}/view` : null,
            originalDriveId,
            originalMime: item.originalMime ?? item.metadataTemplate?.originalMime ?? null,
            size: item.size || item.metadataTemplate?.size || 0,
          };
      const document = deps.createDocument(metadata);

      const res = await deps.persistDocument({ caseId: ctx.job.caseId, document });
      if (!res?.success) {
        return {
          ok: false,
          error: {
            code: 'PERSIST_FAILED',
            message: res?.error || 'add_document failed',
            fatal: true,
            fileId: item.fileId,
          },
        };
      }

      files.push({ ...item, driveId, originalDriveId, document });
      documents.push(document);
    }
    return { ok: true, ctx: { ...ctx, files, documents: [...ctx.documents, ...documents] } };
  };
}
