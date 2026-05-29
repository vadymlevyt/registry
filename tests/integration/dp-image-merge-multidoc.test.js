// @vitest-environment jsdom
//
// TASK 1B image_merge_unify — DP N-document image-merge flow (інтеграційний).
//
// Сценарій який лагодимо: адвокат закидає N фото = M документів у DP.
// imageDocumentGrouper (Haiku) пропонує M груп; адвокат править (drag фото між
// групами, перейменування, тип); «Виконати» → M окремих documents у справі
// через add_documents ACTION.
//
// Цей тест НЕ ганяє React UI (DpImageMergeEditor) — вимагав би heavy mock
// @dnd-kit + Drive + Document AI. Замість того перевіряємо КЛЮЧОВИЙ seam:
//   1. imageDocumentGrouper повертає M груп з власною білінговою точкою
//      (через aiUsageSink — закриває C7 у грі реальних callers'ах).
//   2. createDocument на кожну групу видає валідну канонічну схему.
//   3. add_documents ACTION атомарно додає M документів у case.documents[].
//
// Це і є behavior-критичний код-шлях handleImageMergeSubmit (DP/index.jsx).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHarness } from './_actionsTestSetup.js';

// Білінговий стаб — нам важливо що grouper тригерить activityTracker.report
const mockActivityReport = vi.fn();
vi.mock('../../src/services/activityTracker.js', () => ({
  report: (...args) => mockActivityReport(...args),
}));

import { groupImagesIntoDocuments } from '../../src/services/sortation/imageDocumentGrouper.js';
import { createDocument } from '../../src/services/documentFactory.js';

const CASE = {
  id: 'case_dp_im',
  name: 'Тестова справа',
  client: 'Тест',
  tenantId: 'ab_levytskyi',
  ownerId: 'vadym',
  category: 'civil',
  documents: [],
  storage: { driveFolderId: 'root_id', subFolders: { '01_ОРИГІНАЛИ': 'orig_id' } },
};

function mockApiResponse(json, opts = {}) {
  return vi.fn(async () => ({
    content: [{ text: typeof json === 'string' ? json : JSON.stringify(json) }],
    usage: { input_tokens: opts.input ?? 200, output_tokens: opts.output ?? 100 },
  }));
}

beforeEach(() => {
  mockActivityReport.mockClear();
});

describe('TASK 1B · DP N-document image-merge flow', () => {
  it('grouper повертає 3 групи → add_documents створює 3 документи у справі', async () => {
    const callApi = mockApiResponse({
      groups: [
        { pages: [0, 1, 2, 3], type: 'identification', suggestedName: 'Паспорт громадянина' },
        { pages: [4, 5, 6, 7, 8], type: 'contract', suggestedName: 'Договір купівлі-продажу' },
        { pages: [9], type: 'evidence', suggestedName: 'Квитанція про сплату судового збору' },
      ],
    });
    const items = Array.from({ length: 10 }, (_, i) => ({
      index: i, name: `IMG_${i}.jpg`, mime: 'image/jpeg',
      ocrText: `OCR for page ${i}`,
    }));

    const aiUsageSink = vi.fn();
    const grouperResult = await groupImagesIntoDocuments(items, {
      apiKey: 'test',
      callApi,
      caseId: CASE.id,
      aiUsageSink,
    });

    // Sanity — 3 групи з правильними indices і type
    expect(grouperResult.groups).toHaveLength(3);
    expect(grouperResult.groups[0].pages).toEqual([0, 1, 2, 3]);
    expect(grouperResult.groups[1].pages).toEqual([4, 5, 6, 7, 8]);
    expect(grouperResult.groups[2].pages).toEqual([9]);

    // C7 closed — білінг логується одразу
    expect(aiUsageSink).toHaveBeenCalledTimes(1);
    expect(aiUsageSink.mock.calls[0][0].agentType).toBe('image_document_grouper');
    expect(aiUsageSink.mock.calls[0][0].context.caseId).toBe(CASE.id);
    expect(mockActivityReport).toHaveBeenCalledTimes(1);
    expect(mockActivityReport.mock.calls[0][0]).toBe('agent_call');

    // Симуляція handleImageMergeSubmit: createDocument на кожну групу +
    // add_documents через РЕАЛЬНИЙ executeAction (тестовий setup).
    const h = createHarness({ initialCases: [structuredClone(CASE)] });
    const usedNames = new Set();
    const documents = grouperResult.groups.map((g, gi) => createDocument({
      name: g.suggestedName || `Документ ${gi + 1}`,
      category: g.type || null,
      author: null,
      procId: null,
      date: null,
      isKey: false,
      driveId: `drv_${gi}`,
      driveUrl: `https://drive.google.com/file/d/drv_${gi}/view`,
      size: 100000,
      pageCount: g.pages.length,
      originalName: `${g.suggestedName}.pdf`,
      originalDriveId: null,
      originalMime: 'application/pdf',
      folder: '01_ОРИГІНАЛИ',
      addedBy: 'user',
      namingStatus: 'manual',
      documentNature: 'scanned',
      source: 'manual',
    }));
    for (const d of documents) usedNames.add(d.name);

    const res = await h.executeAction(
      'document_processor_agent',
      'add_documents',
      { caseId: CASE.id, documents },
    );

    expect(res.success).toBe(true);
    expect(res.addedCount).toBe(3);
    const updated = h.getCases().find((c) => c.id === CASE.id);
    expect(updated.documents).toHaveLength(3);
    expect(updated.documents.map((d) => d.name)).toEqual([
      'Паспорт громадянина',
      'Договір купівлі-продажу',
      'Квитанція про сплату судового збору',
    ]);
    expect(updated.documents[0].category).toBe('identification');
    expect(updated.documents[1].category).toBe('contract');
    expect(updated.documents[2].category).toBe('evidence');
    expect(updated.documents.every((d) => d.addedBy === 'user')).toBe(true);
    expect(updated.documents.every((d) => d.source === 'manual')).toBe(true);
    expect(updated.documents.every((d) => d.folder === '01_ОРИГІНАЛИ')).toBe(true);
  });

  it('grouper fallback (AI fail) → один документ з усіх фото, add_documents все ще працює', async () => {
    const callApi = vi.fn(async () => { throw new Error('Network timeout'); });
    const items = Array.from({ length: 5 }, (_, i) => ({
      index: i, name: `IMG_${i}.jpg`, mime: 'image/jpeg', ocrText: 'text',
    }));
    const grouperResult = await groupImagesIntoDocuments(items, {
      apiKey: 'test', callApi, caseId: CASE.id,
    });
    expect(grouperResult.fallback).toBe(true);
    expect(grouperResult.groups).toHaveLength(1);
    expect(grouperResult.groups[0].pages).toEqual([0, 1, 2, 3, 4]);

    const h = createHarness({ initialCases: [structuredClone(CASE)] });
    const doc = createDocument({
      name: 'Обʼєднаний документ (потребує поділу)',
      category: null,
      author: null,
      procId: null,
      date: null,
      isKey: false,
      driveId: 'drv_x',
      driveUrl: 'https://drive.google.com/file/d/drv_x/view',
      size: 50000,
      pageCount: 5,
      originalName: 'merged.pdf',
      originalMime: 'application/pdf',
      folder: '01_ОРИГІНАЛИ',
      addedBy: 'user',
      namingStatus: 'auto',
      documentNature: 'scanned',
      source: 'manual',
    });
    const res = await h.executeAction(
      'document_processor_agent', 'add_documents',
      { caseId: CASE.id, documents: [doc] },
    );
    expect(res.success).toBe(true);
    expect(h.getCases()[0].documents).toHaveLength(1);
  });

  it('document_processor_agent дозволено add_documents (PERMISSIONS check)', async () => {
    const h = createHarness({ initialCases: [structuredClone(CASE)] });
    const doc = createDocument({
      name: 'Test doc',
      driveId: 'drv_y',
      driveUrl: 'https://drive.google.com/file/d/drv_y/view',
      size: 1000,
      pageCount: 1,
      folder: '01_ОРИГІНАЛИ',
      addedBy: 'user',
      source: 'manual',
      documentNature: 'scanned',
    });
    const res = await h.executeAction(
      'document_processor_agent', 'add_documents',
      { caseId: CASE.id, documents: [doc] },
    );
    expect(res.success).toBe(true);
  });

  it('dossier_agent — add_documents ЗАБОРОНЕНО (PERMISSIONS check, зона DP)', async () => {
    const h = createHarness({ initialCases: [structuredClone(CASE)] });
    const doc = createDocument({
      name: 'Should fail',
      driveId: 'drv_z',
      driveUrl: 'https://drive.google.com/file/d/drv_z/view',
      size: 1000,
      pageCount: 1,
      folder: '01_ОРИГІНАЛИ',
      addedBy: 'user',
      source: 'manual',
      documentNature: 'scanned',
    });
    const res = await h.executeAction(
      'dossier_agent', 'add_documents',
      { caseId: CASE.id, documents: [doc] },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/dossier_agent|add_documents/i);
  });
});
