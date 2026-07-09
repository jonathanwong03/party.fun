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

// Ticket-volume tips for organisers. The controller supplies the event summary and
// the profit-calculator economics (revenue/cost/profit) so this task stays a pure
// prompt → JSON call.
export async function revenueTips({ event = {}, economics = {} } = {}) {
  const system = [
    'You are a growth strategist for party.fun event organisers.',
    'Given an event and its profit-calculator figures, give concrete, prioritised actions to sell MORE',
    'tickets (marketing, timing, pricing, audience targeting, capacity). Be specific to THIS event; avoid generic filler.',
    'Respond ONLY with JSON: {"tips":[{"title":string,"detail":string,"impact":"high"|"medium"|"low"}]}.',
  ].join(' ');

  const user = [
    `Event: ${event.title ?? '(untitled)'}`,
    event.description ? `Description: ${event.description}` : '',
    event.startDate ? `Starts: ${event.startDate}` : '',
    event.address ? `Location: ${event.address}` : '',
    `Pricing model: ${event.pricingModel ?? 'tiered'}`,
    '',
    'Profit calculator (the organiser\'s current targets):',
    `- Tickets to sell: ${economics.ticketCount ?? 0}`,
    `- Total revenue: $${Number(economics.totalRevenue ?? 0).toFixed(2)}`,
    `- Avg ticket price: $${Number(economics.avgTicketPrice ?? 0).toFixed(2)}`,
    `- Total operational cost: $${Number(economics.totalCost ?? 0).toFixed(2)}`,
    `- Profit at this target: $${Number(economics.profit ?? 0).toFixed(2)}`,
    '',
    'Give 4-6 prioritised tips (most impactful first) for hitting or exceeding this ticket target.',
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
