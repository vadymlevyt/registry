// ── contextRelay.js — чисті вирішувачі естафети «DP → генератор контексту» ────
//
// TASK: Естафетний тригер генератора контексту після Document Processor.
//
// Тут живе ТІЛЬКИ чиста (без React, без Drive, без побічних ефектів) логіка
// прийняття рішень естафети. Імпуративні частини (React-стан, toast'и,
// generateCaseContext, Drive) лишаються в `CaseDossier/index.jsx`. Винесено
// окремо рівно для того, щоб §4 TASK покрив рішення юніт/інтеграційними
// тестами у node-середовищі без рендеру важкого компонента (index.jsx тягне
// React + CSS і в node-env не імпортується).
//
// Модель — естафета (не таймер): DP у кінці забігу передає паличку
// (pendingContextRegen), система чекає поки `expectedDocIds` приземляться у
// `caseData.documents`, тоді стартує генератор, який сам викидає паличку на
// фініші. Жодного таймауту.

/**
 * allExpectedDocsLanded — чи всі очікувані документи вже приземлились у метадані.
 *
 * Однозначність (#11): єдиний сенс — «кожен id зі списку expectedDocIds присутній
 * у поточному documents[]». НЕ перевіряє рівність множин (надлишкові документи у
 * справі не заважають) і НЕ дивиться на жодні поля окрім id.
 *
 * Порожній expectedDocIds → true (вакуумна істина: чекати нема на що).
 *
 * @param {Array<{id?: string}>} documents — поточний caseData.documents (SSOT).
 * @param {string[]} expectedDocIds — id доданих DP документів (payload.documentIds).
 * @returns {boolean}
 */
export function allExpectedDocsLanded(documents, expectedDocIds) {
  const expected = Array.isArray(expectedDocIds) ? expectedDocIds : [];
  if (expected.length === 0) return true;
  const have = new Set((Array.isArray(documents) ? documents : []).map((d) => d?.id));
  return expected.every((id) => have.has(id));
}

/**
 * derivePendingRegen — рішення слухача події: чи приймати естафетну паличку.
 *
 * Однозначність (#11): єдиний сенс — «перетворити payload події
 * DOCUMENT_BATCH_PROCESSED на паличку для ПОТОЧНОЇ справи, або відмовити (null)».
 * Звужує тригер рівно до «саме цей DP-запуск з увімкненим тумблером для цієї
 * справи» — щоб ручне додавання/перейменування/видалення нарис не чіпали.
 *
 * Повертає null (паличка не приймається) якщо:
 *  - payload відсутній;
 *  - тумблер вимкнено (updateCaseContext !== true);
 *  - подія для іншої справи (payload.caseId !== currentCaseId).
 *
 * @param {object|null} payload — payload події DOCUMENT_BATCH_PROCESSED.
 * @param {string|undefined} currentCaseId — id відкритого досьє.
 * @returns {{caseId: string, expectedDocIds: string[], scenarioRunId: string|null}|null}
 */
export function derivePendingRegen(payload, currentCaseId) {
  if (!payload || payload.updateCaseContext !== true) return null;
  if (payload.caseId !== currentCaseId) return null;
  return {
    caseId: payload.caseId,
    expectedDocIds: Array.isArray(payload.documentIds) ? payload.documentIds : [],
    scenarioRunId: payload.scenarioRunId || null,
  };
}

/**
 * shouldStartContextRegen — рішення ефекту-тригера: чи стартувати генератор зараз.
 *
 * Однозначність (#11): єдиний сенс — «паличка стоїть для цієї справи, генерація
 * ще не біжить, і всі очікувані документи вже у метаданих». Тільки коли ВСЕ це
 * істинне — true. Це і є «система кричить саме під цей прапорець».
 *
 * @param {object} args
 * @param {{caseId: string, expectedDocIds: string[]}|null} args.pendingContextRegen
 * @param {string|undefined} args.caseId — id відкритого досьє.
 * @param {Array<{id?: string}>} args.documents — поточний caseData.documents.
 * @param {boolean} args.isCreatingContext — генерація вже біжить.
 * @returns {boolean}
 */
export function shouldStartContextRegen({ pendingContextRegen, caseId, documents, isCreatingContext }) {
  if (!pendingContextRegen) return false;
  if (pendingContextRegen.caseId !== caseId) return false;
  if (isCreatingContext) return false;
  return allExpectedDocsLanded(documents, pendingContextRegen.expectedDocIds);
}
