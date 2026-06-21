// ── MODEL AVAILABILITY SIGNAL ────────────────────────────────────────────────
// Спільний шов для всіх точок виклику Anthropic API: якщо відповідь означає
// «модель не знайдена» (404 retirement) — публікує ai.model_unavailable, щоб UI
// (App.jsx) відкрив ModelPicker під цього агента.
//
// Винесено в окремий модуль (а не в modelsService) бо тягне eventBus/tenant —
// modelsService лишається чистим фасадом над Models API (правило #11).
// Безпечний (try/catch): НІКОЛИ не валить виклик, що його покликав.

import { publish } from './eventBus.js';
import { AI_MODEL_UNAVAILABLE } from './eventBusTopics.js';
import { getCurrentTenantId } from './tenantService.js';
import { isModelNotFoundError } from './modelsService.js';

// signalIfModelUnavailable — один сенс: якщо (status, body) = «модель відхилена»,
// емітнути подію з {agentType, model, tenantId}. Повертає true якщо емітнув.
export function signalIfModelUnavailable(status, body, agentType, model) {
  try {
    if (isModelNotFoundError(status, body)) {
      publish(AI_MODEL_UNAVAILABLE, { agentType, model, tenantId: getCurrentTenantId() });
      return true;
    }
  } catch {
    // eventBus/tenant недоступні — сигнал не критичний, не валимо виклик.
  }
  return false;
}
