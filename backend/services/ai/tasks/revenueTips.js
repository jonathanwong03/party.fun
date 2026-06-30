import { runTier } from '../modelRouter.js';
import { parseJson } from '../jsonUtil.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tips'],
  properties: {
    tips: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail', 'impact'],
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          impact: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
};

// Revenue-boost tips for organisers. The controller supplies the event summary
// and the already-computed forecast (from forecastService) so this task stays a
// pure prompt → JSON call.
export async function revenueTips({ event = {}, forecast = {} } = {}) {
  const costLines = (forecast.operationalCosts ?? [])
    .map((c) => `- ${c.category}: $${Number(c.cost).toFixed(2)}`)
    .join('\n');

  const system = [
    'You are a revenue strategist for party.fun event organisers.',
    'Given an event and its sales forecast, give concrete, prioritised actions to increase ticket revenue',
    '(pricing, timing, marketing, capacity). Be specific to THIS event; avoid generic filler.',
    'Respond ONLY with JSON: {"tips":[{"title":string,"detail":string,"impact":"high"|"medium"|"low"}]}.',
  ].join(' ');

  const user = [
    `Event: ${event.title ?? '(untitled)'}`,
    event.description ? `Description: ${event.description}` : '',
    event.startDate ? `Starts: ${event.startDate}` : '',
    event.address ? `Location: ${event.address}` : '',
    `Pricing model: ${event.pricingModel ?? 'static/tiered'}`,
    '',
    'Forecast:',
    `- Projected tickets: ${forecast.projectedTicketsSold ?? 0}`,
    `- Projected revenue: $${Number(forecast.projectedRevenue ?? 0).toFixed(2)}`,
    `- Avg ticket price: $${Number(forecast.avgTicketPrice ?? 0).toFixed(2)}`,
    `- Estimated operational costs: $${Number(forecast.totalOperationalCost ?? 0).toFixed(2)}`,
    `- Estimated net: $${Number(forecast.estimatedNet ?? 0).toFixed(2)}`,
    costLines ? `Cost breakdown:\n${costLines}` : '',
    '',
    'Give 4-6 prioritised tips (most impactful first).',
  ].filter(Boolean).join('\n');

  const res = await runTier('premium', {
    system,
    messages: [{ role: 'user', content: user }],
    jsonSchema: SCHEMA,
    maxTokens: 1200,
  });
  if (!res) return { available: false };

  const parsed = parseJson(res.text) ?? {};
  const tips = Array.isArray(parsed.tips) ? parsed.tips.filter((t) => t && t.title) : [];
  return { available: true, tips, provider: res.provider, model: res.model };
}
