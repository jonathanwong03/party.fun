import { forecastForEvent } from '../../forecastService.js';

// Agent tools. Definitions are provider-agnostic JSON Schemas; executors run
// server-side scoped to the calling user via ctx = { supabase, userId, role }.

function cheapest(ev) {
  const prices = (ev.statuses ?? []).map((s) => Number(s.price)).filter((n) => Number.isFinite(n));
  return prices.length ? Math.min(...prices) : 0;
}
function hypePct(ev) {
  const threshold = Number(ev.hypeThreshold ?? 0);
  const active = Number(ev.active_ticket_count ?? 0);
  return threshold > 0 ? Math.min(100, Math.round((active / threshold) * 100)) : 0;
}

async function visibleEvents(ctx) {
  const { data, error } = await ctx.supabase.rpc('get_events');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export const TOOL_DEFS = [
  {
    name: 'search_events',
    description: 'Search events the user can see on party.fun. Returns matching events with id, title, price and hype. Use this to find events to recommend or to look one up by name.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Keywords to match against title/description (optional).' },
        maxPrice: { type: 'number', description: 'Only events whose cheapest ticket is at or below this price (optional).' },
        hypeOnly: { type: 'boolean', description: 'If true, only confirmed (greenlit) events (optional).' },
      },
      required: [],
    },
  },
  {
    name: 'get_event_details',
    description: 'Get full details for one event the user can see, by its id.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { eventId: { type: 'string', description: 'The event id.' } },
      required: ['eventId'],
    },
  },
  {
    name: 'get_event_forecast',
    description: "Get the projected ticket sales, revenue and estimated costs for one of the ORGANISER'S OWN events (host only). Use this to give revenue advice.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { eventId: { type: 'string', description: 'The event id (must be hosted by the caller).' } },
      required: ['eventId'],
    },
  },
];

export const EXECUTORS = {
  async search_events(args, ctx) {
    const q = String(args.query ?? '').toLowerCase().trim();
    const maxPrice = args.maxPrice != null ? Number(args.maxPrice) : null;
    const hypeOnly = !!args.hypeOnly;
    const rows = (await visibleEvents(ctx))
      .filter((e) => e.status !== 'cancelled' && e.status !== 'completed')
      .filter((e) => (hypeOnly ? e.status === 'greenlit' : true))
      .filter((e) => (q ? `${e.title ?? ''} ${e.description ?? ''}`.toLowerCase().includes(q) : true))
      .filter((e) => (maxPrice != null ? cheapest(e) <= maxPrice : true))
      .slice(0, 15)
      .map((e) => ({ id: e.id, title: e.title, cheapestPrice: cheapest(e), hypePct: hypePct(e), status: e.status, mine: e.hostId === ctx.userId }));
    return { count: rows.length, events: rows };
  },

  async get_event_details(args, ctx) {
    const ev = (await visibleEvents(ctx)).find((e) => e.id === args.eventId);
    if (!ev) return { error: 'Event not found or not visible to you.' };
    return {
      id: ev.id,
      title: ev.title,
      description: ev.description,
      status: ev.status,
      startDate: ev.startDate,
      address: ev.address,
      cheapestPrice: cheapest(ev),
      hypePct: hypePct(ev),
      tiers: (ev.statuses ?? []).map((s) => ({ name: s.statusName, price: s.price, capacity: s.ticketCapacity })),
      mine: ev.hostId === ctx.userId,
    };
  },

  async get_event_forecast(args, ctx) {
    let result;
    try {
      result = await forecastForEvent(args.eventId);
    } catch (e) {
      return { error: e.message };
    }
    if (!result) return { error: 'Event not found.' };
    if (result.event.hostId !== ctx.userId && ctx.role !== 'admin') {
      return { error: 'You can only forecast events you host.' };
    }
    const f = result.forecast;
    return {
      title: result.event.title,
      projectedTicketsSold: f.projectedTicketsSold,
      projectedRevenue: f.projectedRevenue,
      avgTicketPrice: f.avgTicketPrice,
      totalOperationalCost: f.totalOperationalCost,
      estimatedNet: f.estimatedNet,
      operationalCosts: f.operationalCosts,
    };
  },
};

// Execute a tool call by name; always returns a JSON-serialisable result (never throws).
export async function executeTool(name, args, ctx) {
  const fn = EXECUTORS[name];
  if (!fn) return { error: `Unknown tool: ${name}` };
  try {
    return await fn(args ?? {}, ctx);
  } catch (e) {
    return { error: e?.message ?? 'Tool execution failed.' };
  }
}
