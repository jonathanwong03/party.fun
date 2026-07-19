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

// Inline "suggest titles / descriptions" helper for the Create Event page.
// mode: 'titles' → 3 name ideas only; 'descriptions' → 3 descriptions only;
// undefined → both (5 names + 3 descriptions), for backward-compatibility.
export async function suggestEventCopy(input = {}) {
  const { title = '', theme = '', audience = '', university = '', mode } = input;
  const wantTitles = mode !== 'descriptions';
  const wantDescriptions = mode !== 'titles';
  const ask = mode === 'titles'
    ? 'Give exactly 3 punchy name ideas (no descriptions).'
    : mode === 'descriptions'
      ? 'Give exactly 3 descriptions (each 2-3 sentences, energetic but not spammy; no names).'
      : 'Give exactly 5 punchy name ideas and 3 descriptions (each 2-3 sentences, energetic but not spammy).';
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
    ask,
  ].join('\n');

  const res = await runTier('cheap', {
    system,
    messages: [{ role: 'user', content: user }],
    jsonSchema: SCHEMA,
    maxTokens: 800,
  });
  if (!res) return { available: false };

  const parsed = parseJson(res.text) ?? {};
  const nameLimit = mode === 'titles' ? 3 : 5;
  return {
    available: true,
    names: wantTitles && Array.isArray(parsed.names) ? parsed.names.slice(0, nameLimit) : [],
    descriptions: wantDescriptions && Array.isArray(parsed.descriptions) ? parsed.descriptions.slice(0, 3) : [],
    provider: res.provider,
    model: res.model,
  };
}
