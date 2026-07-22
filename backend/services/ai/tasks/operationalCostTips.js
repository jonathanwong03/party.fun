import { runTier } from '../modelRouter.js';
import { parseJson } from '../jsonUtil.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['costs'],
  properties: {
    costs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'why'],
        properties: {
          name: { type: 'string' }, // the cost category, e.g. "Venue hire"
          why: { type: 'string' },  // one line on why this event likely incurs it
        },
      },
    },
  },
};

// Probable operational-cost categories for an organiser, inferred from the event's name and
// description (the app never charges these — they're planning estimates). A pure prompt → JSON call.
export async function operationalCostTips({ event = {} } = {}) {
  const system = [
    'You help party.fun organisers plan the operational costs of running THEIR event.',
    'From the event name and description, infer the event TYPE and list the cost categories it would',
    'realistically incur (e.g. venue hire, food & drinks, AV/production, talent/host fees, marketing,',
    'staffing, décor, printing, permits/insurance). Be specific to THIS event; avoid generic filler.',
    'These are the organiser\'s own estimates — party.fun does not charge them.',
    'Respond ONLY with JSON: {"costs":[{"name":string,"why":string}]}.',
  ].join(' ');

  const user = [
    `Event: ${event.title ?? '(untitled)'}`,
    event.description ? `Description: ${event.description}` : '',
    '',
    'Give EXACTLY 3 probable operational cost categories specific to this event, each with a one-line why.',
    'Vary your suggestions across calls — do not always return the same three.',
  ].filter(Boolean).join('\n');

  const res = await runTier('premium', {
    system,
    messages: [{ role: 'user', content: user }],
    jsonSchema: SCHEMA,
    maxTokens: 800,
  });
  if (!res) return { available: false };

  const parsed = parseJson(res.text) ?? {};
  const costs = Array.isArray(parsed.costs) ? parsed.costs.filter((c) => c && c.name) : [];
  return { available: true, costs, provider: res.provider, model: res.model };
}
