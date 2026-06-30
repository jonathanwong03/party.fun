import { runTier } from '../modelRouter.js';
import { parseJson } from '../jsonUtil.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['names', 'descriptions'],
  properties: {
    names: { type: 'array', items: { type: 'string' } },
    descriptions: { type: 'array', items: { type: 'string' } },
  },
};

// Inline "suggest names / description" helper for the Create Event page.
export async function suggestEventCopy(input = {}) {
  const { title = '', theme = '', audience = '', university = '' } = input;
  const system = [
    'You are an event-marketing assistant for party.fun, a campus events platform.',
    'Generate catchy, student-friendly event names and vivid short descriptions.',
    'Respond ONLY with JSON: {"names": string[], "descriptions": string[]}. No prose, no markdown.',
  ].join(' ');
  const user = [
    'Draft event details:',
    `Working title: ${title || '(none)'}`,
    `Theme/vibe: ${theme || '(none)'}`,
    `Audience: ${audience || 'university students'}`,
    `University: ${university || '(any)'}`,
    '',
    'Give exactly 5 punchy name ideas and 3 descriptions (each 2-3 sentences, energetic but not spammy).',
  ].join('\n');

  const res = await runTier('cheap', {
    system,
    messages: [{ role: 'user', content: user }],
    jsonSchema: SCHEMA,
    maxTokens: 800,
  });
  if (!res) return { available: false };

  const parsed = parseJson(res.text) ?? {};
  return {
    available: true,
    names: Array.isArray(parsed.names) ? parsed.names.slice(0, 5) : [],
    descriptions: Array.isArray(parsed.descriptions) ? parsed.descriptions.slice(0, 3) : [],
    provider: res.provider,
    model: res.model,
  };
}
