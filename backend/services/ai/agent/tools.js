import { forecastForEvent } from '../../forecastService.js';
import { rememberFact } from '../memory.js';

// Agent tools. Definitions are provider-agnostic JSON Schemas; executors run
// server-side scoped to the calling user via ctx = { supabase, userId, role }.

function cheapest(ev) {
  const prices = (ev.statuses ?? []).map((s) => Number(s.price)).filter((n) => Number.isFinite(n));
  return prices.length ? Math.min(...prices) : 0;
}
// The price a buyer pays right now: hype events use the live dynamic price; tiered use the lowest tier.
function currentPrice(ev) {
  const hype = Boolean(ev.hypeDrivenPricing ?? ev.hype_driven_pricing);
  const dyn = ev.current_dynamic_price ?? ev.currentDynamicPrice;
  if (hype && dyn != null) return Number(dyn);
  return cheapest(ev);
}
function hypePct(ev) {
  const threshold = Number(ev.hypeThreshold ?? 0);
  const active = Number(ev.active_ticket_count ?? 0);
  return threshold > 0 ? Math.min(100, Math.round((active / threshold) * 100)) : 0;
}
const tierPrice = (ev, name) => (ev.statuses ?? []).find((s) => s.statusName === name)?.price ?? null;

async function visibleEvents(ctx) {
  const { data, error } = await ctx.supabase.rpc('get_events');
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Event ids the caller has already pledged for (a live booking), so "tickets I can
// buy" can exclude them. Filtered by userId so it's correct even under a service client.
async function bookedEventIds(ctx) {
  const { data, error } = await ctx.supabase.from('BOOKINGS').select('eventId').eq('userId', ctx.userId).is('deletedAt', null);
  if (error) return new Set();
  return new Set((data ?? []).map((b) => b.eventId));
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
    name: 'list_available_events',
    description: "The ALL EVENTS / discovery list: events the user can BUY right now — NOT their own, not cancelled/completed, and NOT already purchased by them. Each has the current buyable price. USE THIS for questions like 'cheapest/most expensive ticket I can buy'.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Optional keywords to match against title/description.' },
        maxPrice: { type: 'number', description: 'Optional: only events at or below this current price.' },
      },
      required: [],
    },
  },
  {
    name: 'get_my_hosted_events',
    description: "The organiser's OWN events (their Hosted Events dashboard) with status (early_bird/greenlit/completed/cancelled), early-bird & greenlit prices, tickets sold and hype threshold.",
    parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: 'get_my_joined_events',
    description: 'Events the user has JOINED (pledged/bought tickets for), with their status.',
    parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: 'remember',
    description: "Save a DURABLE preference or fact you've learned about this user so you can personalise future help — e.g. their interests, budget, preferred venue/theme/timing (attendees), or an organiser's pricing/venue preferences and which advice they act on. Use for LASTING facts only, not one-off details. Do not repeat something already known.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        fact: { type: 'string', description: 'The durable preference/fact, phrased concisely (e.g. "Prefers live music events under $15").' },
        category: { type: 'string', description: 'Optional tag: interest, budget, preference, or behavior.' },
      },
      required: ['fact'],
    },
  },
  {
    name: 'propose_update_event',
    description: "PROPOSE editing one of the organiser's OWN events. Provide ONLY the fields to change. Does NOT apply the change — returns a proposal to confirm. Editable: title, description, venue, address, startDate, endDate, deadline (ISO 8601 datetimes), maxCapacity, hypeThreshold, earlyPrice, greenlitPrice.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        eventId: { type: 'string', description: 'The event id (must be hosted by the caller).' },
        title: { type: 'string' },
        description: { type: 'string' },
        venue: { type: 'string' },
        address: { type: 'string' },
        startDate: { type: 'string', description: 'ISO 8601 datetime.' },
        endDate: { type: 'string', description: 'ISO 8601 datetime.' },
        deadline: { type: 'string', description: 'ISO 8601 datetime.' },
        maxCapacity: { type: 'number' },
        hypeThreshold: { type: 'number' },
        earlyPrice: { type: 'number' },
        greenlitPrice: { type: 'number' },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'propose_create_event',
    description: "PROPOSE creating a NEW event for the organiser as a DRAFT (it is NOT published — the user reviews and publishes it from Drafts). First ASK the user for the details. REQUIRED: title, plus startDate, endDate and deadline as ISO 8601 datetimes (e.g. 2026-08-15T19:00:00+08:00) — do not call this until you have the event's date, start & end time, and the pledging deadline. venue/prices/capacity are optional but recommended.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        venue: { type: 'string' },
        address: { type: 'string' },
        startDate: { type: 'string', description: 'ISO 8601 datetime.' },
        endDate: { type: 'string', description: 'ISO 8601 datetime.' },
        deadline: { type: 'string', description: 'ISO 8601 datetime pledging closes.' },
        earlyPrice: { type: 'number' },
        greenlitPrice: { type: 'number' },
        capacity: { type: 'number' },
        hypeThreshold: { type: 'number', description: 'Tickets needed to greenlight.' },
        university: { type: 'string', description: 'University code to restrict to (optional).' },
      },
      required: ['title'],
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

  // ── App-knowledge read tools ─────────────────────────────────────────────────
  async list_available_events(args, ctx) {
    const q = String(args.query ?? '').toLowerCase().trim();
    const maxPrice = args.maxPrice != null ? Number(args.maxPrice) : null;
    const booked = await bookedEventIds(ctx);
    const rows = (await visibleEvents(ctx))
      .filter((e) => e.hostId !== ctx.userId && e.status !== 'cancelled' && e.status !== 'completed')
      .filter((e) => !booked.has(e.id))
      .filter((e) => (q ? `${e.title ?? ''} ${e.description ?? ''}`.toLowerCase().includes(q) : true))
      .map((e) => ({ id: e.id, title: e.title, currentPrice: currentPrice(e), status: e.status, hypePct: hypePct(e) }))
      .filter((e) => (maxPrice != null ? e.currentPrice <= maxPrice : true));
    return { count: rows.length, events: rows };
  },

  async get_my_hosted_events(_args, ctx) {
    const rows = (await visibleEvents(ctx)).filter((e) => e.hostId === ctx.userId);
    return {
      count: rows.length,
      events: rows.map((e) => ({
        id: e.id,
        title: e.title,
        status: e.status,
        earlyPrice: tierPrice(e, 'early_bird'),
        greenlitPrice: tierPrice(e, 'greenlit'),
        ticketsSold: e.active_ticket_count ?? 0,
        hypeThreshold: e.hypeThreshold ?? 0,
        hypePct: hypePct(e),
        maxCapacity: e.maxCapacity ?? 0,
      })),
    };
  },

  async get_my_joined_events(_args, ctx) {
    const booked = await bookedEventIds(ctx);
    if (booked.size === 0) return { count: 0, events: [] };
    const rows = (await visibleEvents(ctx)).filter((e) => booked.has(e.id));
    return {
      count: rows.length,
      events: rows.map((e) => ({ id: e.id, title: e.title, status: e.status, currentPrice: currentPrice(e), mine: e.hostId === ctx.userId })),
    };
  },

  // Learning: persist a durable preference about the user (executes immediately —
  // internal memory, not a user-facing write, so it never needs confirmation).
  async remember(args, ctx) {
    const res = await rememberFact(ctx.supabase, ctx.userId, { content: args.fact, category: args.category });
    if (res.error) return { error: res.error };
    if (res.duplicate) return { status: 'ok', note: 'already remembered' };
    if (res.skipped) return { error: 'Nothing to remember.' };
    return { status: 'ok', remembered: String(args.fact).slice(0, 300) };
  },

  // ── Proposal tools (write actions; validate only, never mutate) ──────────────
  async propose_update_event(args, ctx) {
    const ev = (await visibleEvents(ctx)).find((e) => e.id === args.eventId);
    if (!ev) return { error: 'Event not found or not visible to you.' };
    if (ev.hostId !== ctx.userId) return { error: 'You can only edit events you host.' };
    if (ev.status === 'cancelled' || ev.status === 'completed') return { error: 'This event can no longer be edited.' };

    const FIELDS = ['title', 'description', 'venue', 'address', 'startDate', 'endDate', 'deadline', 'maxCapacity', 'hypeThreshold', 'earlyPrice', 'greenlitPrice'];
    const payload = {};
    for (const f of FIELDS) if (args[f] !== undefined && args[f] !== null && args[f] !== '') payload[f] = args[f];
    if (Object.keys(payload).length === 0) return { error: 'Specify at least one field to change.' };
    for (const n of ['maxCapacity', 'hypeThreshold', 'earlyPrice', 'greenlitPrice']) {
      if (payload[n] !== undefined && (!Number.isFinite(Number(payload[n])) || Number(payload[n]) < 0)) return { error: `${n} must be a non-negative number.` };
    }

    const label = { title: 'Title', description: 'Description', venue: 'Venue', address: 'Address', startDate: 'Start', endDate: 'End', deadline: 'Deadline', maxCapacity: 'Capacity', hypeThreshold: 'Hype threshold', earlyPrice: 'Early-bird price', greenlitPrice: 'Greenlit price' };
    const parts = Object.keys(payload).map((f) => {
      if (f === 'earlyPrice') return `Early-bird $${Number(tierPrice(ev, 'early_bird') ?? 0).toFixed(2)} → $${Number(payload[f]).toFixed(2)}`;
      if (f === 'greenlitPrice') return `Greenlit $${Number(tierPrice(ev, 'greenlit') ?? 0).toFixed(2)} → $${Number(payload[f]).toFixed(2)}`;
      if (f === 'description') return 'Description (updated)';
      return `${label[f]} → ${payload[f]}`;
    });
    return {
      proposal: {
        id: `update_event:${ev.id}:${Date.now()}`,
        action: 'update_event',
        eventId: ev.id,
        title: ev.title,
        summary: `Update "${ev.title}": ${parts.join(', ')}.`,
        payload,
      },
    };
  },

  async propose_create_event(args, ctx) {
    const title = String(args.title ?? '').trim();
    if (!title) return { error: 'An event title is required to draft an event.' };
    // Dates are required so the draft carries real start/end/deadline the form can show.
    const isValidDate = (v) => v && !Number.isNaN(new Date(v).getTime());
    if (!isValidDate(args.startDate) || !isValidDate(args.endDate) || !isValidDate(args.deadline)) {
      return { error: 'Ask the user for the event date, start & end time, and the pledging deadline, then pass them as ISO 8601 (e.g. 2026-08-15T19:00:00+08:00) — startDate, endDate and deadline are all required to draft the event.' };
    }
    const payload = {
      title,
      description: args.description ?? '',
      venue: args.venue ?? '',
      address: args.address ?? '',
      startDate: args.startDate ?? '',
      endDate: args.endDate ?? '',
      deadline: args.deadline ?? '',
      earlyPrice: args.earlyPrice ?? null,
      greenlitPrice: args.greenlitPrice ?? null,
      capacity: args.capacity ?? null,
      hypeThreshold: args.hypeThreshold ?? null,
      university: args.university ?? '',
    };
    const bits = [];
    if (payload.venue) bits.push(`at ${payload.venue}`);
    if (payload.startDate) bits.push(`starting ${payload.startDate}`);
    if (payload.earlyPrice != null) bits.push(`early-bird $${Number(payload.earlyPrice).toFixed(2)}`);
    return {
      proposal: {
        id: `create_event_draft:${Date.now()}`,
        action: 'create_event_draft',
        eventId: null,
        title,
        summary: `Create a draft event "${title}"${bits.length ? ` (${bits.join(', ')})` : ''}. Review and publish it from your Drafts.`,
        payload,
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
