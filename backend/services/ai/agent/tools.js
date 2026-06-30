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
  {
    name: 'propose_adjust_pricing',
    description: "PROPOSE a ticket price change for one of the organiser's OWN events. This does NOT apply the change — it returns a proposal the user must confirm. Provide earlyPrice and/or greenlitPrice.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        eventId: { type: 'string', description: 'The event id (must be hosted by the caller).' },
        earlyPrice: { type: 'number', description: 'New early-bird price (optional).' },
        greenlitPrice: { type: 'number', description: 'New greenlit price (optional).' },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'propose_invite_coorganiser',
    description: "PROPOSE inviting a co-organiser to one of the organiser's OWN events. Does NOT send the invite — returns a proposal the user must confirm.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        eventId: { type: 'string', description: 'The event id (must be hosted by the caller).' },
        identifier: { type: 'string', description: 'Email or username of the organiser to invite.' },
      },
      required: ['eventId', 'identifier'],
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

  // ── Proposal tools (write actions; validate only, never mutate) ──────────────
  async propose_adjust_pricing(args, ctx) {
    const ev = (await visibleEvents(ctx)).find((e) => e.id === args.eventId);
    if (!ev) return { error: 'Event not found or not visible to you.' };
    if (ev.hostId !== ctx.userId) return { error: 'You can only change pricing for events you host.' };
    if (ev.status === 'cancelled' || ev.status === 'completed') return { error: 'This event can no longer be edited.' };

    const curPrice = (name) => (ev.statuses ?? []).find((s) => s.statusName === name)?.price;
    const early = args.earlyPrice != null ? Number(args.earlyPrice) : null;
    const greenlit = args.greenlitPrice != null ? Number(args.greenlitPrice) : null;
    if (early == null && greenlit == null) return { error: 'Specify earlyPrice and/or greenlitPrice.' };
    if (early != null && (!Number.isFinite(early) || early < 0)) return { error: 'earlyPrice must be a non-negative number.' };
    if (greenlit != null && (!Number.isFinite(greenlit) || greenlit < 0)) return { error: 'greenlitPrice must be a non-negative number.' };

    const parts = [];
    if (early != null) parts.push(`Early-bird $${Number(curPrice('early_bird') ?? 0).toFixed(2)} → $${early.toFixed(2)}`);
    if (greenlit != null) parts.push(`Greenlit $${Number(curPrice('greenlit') ?? 0).toFixed(2)} → $${greenlit.toFixed(2)}`);
    return {
      proposal: {
        id: `adjust_pricing:${ev.id}:${Date.now()}`,
        action: 'adjust_pricing',
        eventId: ev.id,
        title: ev.title,
        summary: `Update pricing for "${ev.title}": ${parts.join(', ')}.`,
        payload: { earlyPrice: early, greenlitPrice: greenlit },
      },
    };
  },

  async propose_invite_coorganiser(args, ctx) {
    const ev = (await visibleEvents(ctx)).find((e) => e.id === args.eventId);
    if (!ev) return { error: 'Event not found or not visible to you.' };
    if (ev.hostId !== ctx.userId) return { error: 'Only the event owner can invite co-organisers.' };
    const identifier = String(args.identifier ?? '').trim();
    if (!identifier) return { error: 'Provide the co-organiser email or username.' };
    return {
      proposal: {
        id: `invite_coorganiser:${ev.id}:${Date.now()}`,
        action: 'invite_coorganiser',
        eventId: ev.id,
        title: ev.title,
        summary: `Invite "${identifier}" as a co-organiser of "${ev.title}".`,
        payload: { identifier },
      },
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
