// Юніт-тести signalIfModelUnavailable — емісія ai.model_unavailable лише на 404 retirement.
import { describe, it, expect, beforeEach } from 'vitest';
import * as eventBus from '../../src/services/eventBus.js';
import { AI_MODEL_UNAVAILABLE } from '../../src/services/eventBusTopics.js';
import { signalIfModelUnavailable } from '../../src/services/modelAvailabilitySignal.js';

describe('signalIfModelUnavailable', () => {
  beforeEach(() => eventBus.clear());

  it('публікує подію на 404 not_found з повним payload', () => {
    const seen = [];
    eventBus.subscribe(AI_MODEL_UNAVAILABLE, (p) => seen.push(p));
    const emitted = signalIfModelUnavailable(
      404,
      { error: { type: 'not_found_error', message: 'model: claude-sonnet-4-20250514' } },
      'qiAgent',
      'claude-sonnet-4-20250514',
    );
    expect(emitted).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].agentType).toBe('qiAgent');
    expect(seen[0].model).toBe('claude-sonnet-4-20250514');
    expect('tenantId' in seen[0]).toBe(true); // SaaS payload (хай навіть заглушка)
  });

  it('НЕ публікує на 401 / 429 / 400', () => {
    const seen = [];
    eventBus.subscribe(AI_MODEL_UNAVAILABLE, (p) => seen.push(p));
    expect(signalIfModelUnavailable(401, { error: { type: 'authentication_error' } }, 'qiAgent', 'm')).toBe(false);
    expect(signalIfModelUnavailable(429, { error: { type: 'rate_limit_error' } }, 'qiAgent', 'm')).toBe(false);
    expect(signalIfModelUnavailable(400, { error: {} }, 'qiAgent', 'm')).toBe(false);
    expect(seen).toHaveLength(0);
  });
});
