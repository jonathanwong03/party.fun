import { runTier } from '../modelRouter.js';
import { parseJson } from '../jsonUtil.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['recommendations'],
  properties: {
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['eventId', 'reason'],
        properties: {
          eventId: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
};

// Buyer event recommendations. The controller supplies `candidates` (compact,
// already visibility-filtered events the caller may see) and the user's stated
// interests; this task ranks them, factoring in cheapest price.
export async function recommendEvents({ interests = '', candidates = [] } = {}) {
  if (!candidates.length) return { available: true, recommendations: [] };

  const system = [
    'You recommend campus events on party.fun to a student.',
    'Pick and rank the events that best match their interests; prefer cheaper options when matches are otherwise similar.',
    'Only use eventIds from the provided list. Respond ONLY with JSON:',
    '{"recommendations":[{"eventId":string,"reason":string}]} (best first, up to 5).',
  ].join(' ');

  const list = candidates
    .map((e) => `- id=${e.id} | ${e.title} | $${Number(e.cheapestPrice ?? 0).toFixed(2)} | hype ${e.hypePct ?? 0}% | ${(e.description ?? '').slice(0, 160)}`)
    .join('\n');

  const user = [
    `Student interests: ${interests || '(not specified — recommend broadly popular events)'}`,
    '',
    'Candidate events:',
    list,
  ].join('\n');

  const res = await runTier('premium', {
    system,
    messages: [{ role: 'user', content: user }],
    jsonSchema: SCHEMA,
    maxTokens: 1000,
  });
  if (!res) return { available: false };

  const parsed = parseJson(res.text) ?? {};
  const byId = new Map(candidates.map((e) => [e.id, e]));
  const recommendations = (Array.isArray(parsed.recommendations) ? parsed.recommendations : [])
    .filter((r) => r && byId.has(r.eventId))
    .slice(0, 5)
    .map((r) => {
      const e = byId.get(r.eventId);
      return { eventId: r.eventId, title: e.title, cheapestPrice: e.cheapestPrice ?? null, reason: r.reason };
    });
  return { available: true, recommendations, provider: res.provider, model: res.model };
}
