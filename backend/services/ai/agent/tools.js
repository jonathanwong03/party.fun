import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { forecastForEvent } from '../../forecastService.js';
import { listDrafts, mapEventRow } from '../../eventService.js';
import { rememberFact } from '../memory.js';

// Agent tools. Definitions are provider-agnostic JSON Schemas; executors run
// server-side scoped to the calling user via ctx = { supabase, userId, role }.

// The price a buyer pays RIGHT NOW for one ticket — the app's canonical current price
// (the active tier once the early-bird allocation is sold out, or the live hype price).
// Delegates to mapEventRow so the agent always matches what the UI charges/shows.
function currentPrice(ev) {
  return Number(mapEventRow(ev)?.price ?? 0);
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

// Net revenue-so-far per event the caller HOSTS, keyed by eventId (host-only RPC).
// Returns an empty map on any error/unexpected shape so callers can degrade gracefully.
async function hostedRevenueById(ctx) {
  try {
    const { data, error } = await ctx.supabase.rpc('get_hosted_revenue');
    if (error) return {};
    const map = {};
    for (const r of data?.events ?? []) map[r.eventId] = Number(r.revenue);
    return map;
  } catch {
    return {};
  }
}

// Each agent tool is defined the idiomatic LangChain-JS way — the `tool()` factory
// (the JS equivalent of Python's @tool) with a zod schema. The tool function is a
// thin, never-throw adapter over the executor below; `ctx` (the user-scoped Supabase
// client + identity) flows in via config.configurable.ctx at call time.
const makeTool = (name, description, schema) =>
  tool(async (args, config) => JSON.stringify(await executeTool(name, args ?? {}, config?.configurable?.ctx)), { name, description, schema });

// ── Read tools ────────────────────────────────────────────────────────────────
export const searchEventsTool = makeTool(
  'search_events',
  'Search events the user can see on party.fun. Returns matching events with id, title, the CURRENT price (the price on sale now, given each event\'s status/pricing) and hype. Use this to find events to recommend or to look one up by name.',
  z.object({
    query: z.string().optional().describe('Keywords to match against title/description.'),
    maxPrice: z.number().optional().describe('Only events whose current price is at or below this price.'),
    hypeOnly: z.boolean().optional().describe('If true, only confirmed (greenlit) events.'),
  }),
);

export const getEventDetailsTool = makeTool(
  'get_event_details',
  "Get full details for one event the user can see, by its id: its current STATUS (early_bird/greenlit/completed/cancelled), the CURRENT PRICE a buyer pays now, tiers, tickets sold vs hype threshold, and — for the user's OWN event — the net revenue so far.",
  z.object({ eventId: z.string().describe('The event id.') }),
);

export const getEventForecastTool = makeTool(
  'get_event_forecast',
  "Get the projected ticket sales, revenue and estimated costs for one of the ORGANISER'S OWN events (host only). Use this to give revenue advice.",
  z.object({ eventId: z.string().describe('The event id (must be hosted by the caller).') }),
);

export const listAvailableEventsTool = makeTool(
  'list_available_events',
  "The ALL EVENTS / discovery list: events the user can BUY right now — NOT their own, not cancelled/completed, and NOT already purchased by them. Each has the current buyable price. USE THIS for questions like 'cheapest/most expensive ticket I can buy'.",
  z.object({
    query: z.string().optional().describe('Optional keywords to match against title/description.'),
    maxPrice: z.number().optional().describe('Optional: only events at or below this current price.'),
  }),
);

export const getMyHostedEventsTool = makeTool(
  'get_my_hosted_events',
  "The organiser's OWN events (their Hosted Events dashboard) with status (early_bird/greenlit/completed/cancelled), early-bird & greenlit prices, the CURRENT price, net REVENUE SO FAR, tickets sold, hype threshold and date/deadline.",
  z.object({}),
);

export const getMyJoinedEventsTool = makeTool(
  'get_my_joined_events',
  'Events the user has JOINED (pledged/bought tickets for), with their status.',
  z.object({}),
);

export const getWalletTool = makeTool(
  'get_wallet',
  "The user's wallet: current balance, linked card (brand + last 4), and recent wallet transactions (top-ups, ticket spends, refunds). Use this before proposing a top-up or a wallet-paid purchase.",
  z.object({}),
);

export const listMyDraftsTool = makeTool(
  'list_my_drafts',
  "The user's saved event DRAFTS (unpublished). Use this to find a draft's id before proposing to delete it.",
  z.object({}),
);

// ── Memory ────────────────────────────────────────────────────────────────────
export const rememberTool = makeTool(
  'remember',
  "Save a DURABLE preference or fact you've learned about this user so you can personalise future help — e.g. their interests, budget, preferred venue/theme/timing (attendees), or an organiser's pricing/venue preferences and which advice they act on. Use for LASTING facts only, not one-off details. Do not repeat something already known.",
  z.object({
    fact: z.string().describe('The durable preference/fact, phrased concisely (e.g. "Prefers live music events under $15").'),
    category: z.string().optional().describe('Optional tag: interest, budget, preference, or behavior.'),
  }),
);

// ── Write tools (each returns a PROPOSAL the user must confirm) ─────────────────
export const proposeUpdateEventTool = makeTool(
  'propose_update_event',
  "PROPOSE editing one of the organiser's OWN events. Provide ONLY the fields to change. Does NOT apply the change — returns a proposal to confirm. Editable: title, description, venue, address, startDate, endDate, deadline (ISO 8601 datetimes), maxCapacity, hypeThreshold, earlyPrice, greenlitPrice.",
  z.object({
    eventId: z.string().describe('The event id (must be hosted by the caller).'),
    title: z.string().optional(),
    description: z.string().optional(),
    venue: z.string().optional(),
    address: z.string().optional(),
    startDate: z.string().optional().describe('ISO 8601 datetime.'),
    endDate: z.string().optional().describe('ISO 8601 datetime.'),
    deadline: z.string().optional().describe('ISO 8601 datetime.'),
    maxCapacity: z.number().optional(),
    hypeThreshold: z.number().optional(),
    earlyPrice: z.number().optional(),
    greenlitPrice: z.number().optional(),
  }),
);

export const proposeCreateEventTool = makeTool(
  'propose_create_event',
  "PROPOSE creating a NEW event for the organiser as a DRAFT (it is NOT published — the user reviews and publishes it from Drafts). First ASK the user for the details. REQUIRED: title, plus startDate, endDate and deadline as ISO 8601 datetimes (e.g. 2026-08-15T19:00:00+08:00) — do not call this until you have the event's date, start & end time, and the pledging deadline. venue/prices/capacity are optional but recommended.",
  z.object({
    title: z.string(),
    description: z.string().optional(),
    venue: z.string().optional(),
    address: z.string().optional(),
    startDate: z.string().optional().describe('ISO 8601 datetime.'),
    endDate: z.string().optional().describe('ISO 8601 datetime.'),
    deadline: z.string().optional().describe('ISO 8601 datetime pledging closes.'),
    earlyPrice: z.number().optional(),
    greenlitPrice: z.number().optional(),
    capacity: z.number().optional(),
    hypeThreshold: z.number().optional().describe('Tickets needed to greenlight.'),
    university: z.string().optional().describe('University code to restrict to (optional).'),
  }),
);

export const proposeInviteCoorganiserTool = makeTool(
  'propose_invite_coorganiser',
  "PROPOSE inviting a co-organiser to one of the organiser's OWN events. Does NOT send the invite — returns a proposal the user must confirm.",
  z.object({
    eventId: z.string().describe('The event id (must be hosted by the caller).'),
    identifier: z.string().describe('Email or username of the organiser to invite.'),
  }),
);

export const proposeTopupTool = makeTool(
  'propose_topup',
  "PROPOSE adding money to the user's wallet by charging their linked card. Does NOT charge — returns a proposal the user must confirm. Requires a linked card.",
  z.object({ amount: z.number().describe('Amount in SGD to add to the wallet (must be > 0).') }),
);

export const proposePledgeTool = makeTool(
  'propose_pledge',
  "PROPOSE buying ticket(s) to an event using the user's WALLET balance (a deduction). Does NOT charge — returns a proposal the user must confirm. Cannot be their own event.",
  z.object({
    eventId: z.string().describe('The event to buy into.'),
    qty: z.number().optional().describe('Number of tickets (>= 1). Defaults to 1.'),
  }),
);

export const proposeCancelEventTool = makeTool(
  'propose_cancel_event',
  'PROPOSE cancelling one of the organiser\'s OWN live events. This is also how you DELETE a published event: it closes the event and REFUNDS every backer. Does NOT cancel — returns a proposal the user must confirm.',
  z.object({
    eventId: z.string().describe('The event id (must be hosted by the caller).'),
    reason: z.string().optional().describe('Optional reason shown to backers.'),
  }),
);

export const proposeDeleteDraftTool = makeTool(
  'propose_delete_draft',
  'PROPOSE permanently deleting one of the user\'s unpublished DRAFTS. Does NOT delete — returns a proposal the user must confirm. Use list_my_drafts first to get the draftId.',
  z.object({ draftId: z.string().describe('The draft id (from list_my_drafts).') }),
);

// All tools + a by-name index for the graph to bind per-branch subsets.
export const AGENT_TOOLS = [
  searchEventsTool, getEventDetailsTool, getEventForecastTool, listAvailableEventsTool,
  getMyHostedEventsTool, getMyJoinedEventsTool, getWalletTool, listMyDraftsTool, rememberTool,
  proposeUpdateEventTool, proposeCreateEventTool, proposeInviteCoorganiserTool,
  proposeTopupTool, proposePledgeTool, proposeCancelEventTool, proposeDeleteDraftTool,
];
export const TOOLS_BY_NAME = Object.fromEntries(AGENT_TOOLS.map((t) => [t.name, t]));

export const EXECUTORS = {
  async search_events(args, ctx) {
    const q = String(args.query ?? '').toLowerCase().trim();
    const maxPrice = args.maxPrice != null ? Number(args.maxPrice) : null;
    const hypeOnly = !!args.hypeOnly;
    const rows = (await visibleEvents(ctx))
      .filter((e) => e.status !== 'cancelled' && e.status !== 'completed')
      .filter((e) => (hypeOnly ? e.status === 'greenlit' : true))
      .filter((e) => (q ? `${e.title ?? ''} ${e.description ?? ''}`.toLowerCase().includes(q) : true))
      .filter((e) => (maxPrice != null ? currentPrice(e) <= maxPrice : true))
      .slice(0, 15)
      .map((e) => ({ id: e.id, title: e.title, currentPrice: currentPrice(e), hypePct: hypePct(e), status: e.status, mine: e.hostId === ctx.userId }));
    return { count: rows.length, events: rows };
  },

  async get_event_details(args, ctx) {
    const ev = (await visibleEvents(ctx)).find((e) => e.id === args.eventId);
    if (!ev) return { error: 'Event not found or not visible to you.' };
    const mine = ev.hostId === ctx.userId;
    const details = {
      id: ev.id,
      title: ev.title,
      description: ev.description,
      status: ev.status, // early_bird | greenlit | completed | cancelled
      startDate: ev.startDate,
      deadline: ev.deadline ?? ev.deadlineAt ?? null,
      address: ev.address,
      currentPrice: currentPrice(ev), // the price a buyer pays right now, given the status/pricing model
      ticketsSold: ev.active_ticket_count ?? 0,
      hypeThreshold: ev.hypeThreshold ?? 0,
      hypePct: hypePct(ev),
      tiers: (ev.statuses ?? []).map((s) => ({ name: s.statusName, price: s.price, capacity: s.ticketCapacity })),
      mine,
    };
    // Revenue so far is host-only; only include it for the caller's own event.
    if (mine) {
      const rev = await hostedRevenueById(ctx);
      if (ev.id in rev) details.revenueSoFar = rev[ev.id];
    }
    return details;
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
    const revenue = await hostedRevenueById(ctx);
    return {
      count: rows.length,
      events: rows.map((e) => ({
        id: e.id,
        title: e.title,
        status: e.status, // early_bird | greenlit | completed | cancelled
        startDate: e.startDate,
        deadline: e.deadline ?? e.deadlineAt ?? null,
        earlyPrice: tierPrice(e, 'early_bird'),
        greenlitPrice: tierPrice(e, 'greenlit'),
        currentPrice: currentPrice(e), // price a buyer pays now given the status/pricing model
        revenueSoFar: revenue[e.id] ?? 0, // net revenue captured so far
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

  // ── Wallet / transactions ────────────────────────────────────────────────────
  async get_wallet(_args, ctx) {
    const { data: me } = await ctx.supabase.from('USER').select('walletBalance, cardBrand, cardLast4').eq('id', ctx.userId).single();
    const { data: txns } = await ctx.supabase
      .from('WALLET_TRANSACTIONS')
      .select('type, source, amount, balanceAfter, createdAt')
      .order('createdAt', { ascending: false })
      .limit(10);
    return {
      balance: Number(me?.walletBalance ?? 0),
      card: me?.cardLast4 ? { brand: me.cardBrand, last4: me.cardLast4 } : null,
      recentTransactions: (txns ?? []).map((t) => ({ type: t.type, source: t.source, amount: Number(t.amount), balanceAfter: Number(t.balanceAfter), at: t.createdAt })),
    };
  },

  async list_my_drafts(_args, ctx) {
    let drafts;
    try {
      drafts = await listDrafts(ctx.supabase);
    } catch (e) {
      return { error: e?.message ?? 'Unable to load drafts.' };
    }
    return {
      count: drafts.length,
      drafts: drafts.map((d) => ({ id: d.id, title: d.title || '(untitled draft)', startDate: d.startsAt || d.startDate || null, venue: d.location || d.venue || null })),
    };
  },

  async propose_topup(args, ctx) {
    const amount = Number(args.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter a valid top-up amount greater than $0.' };
    const { data: me } = await ctx.supabase.from('USER').select('cardLast4').eq('id', ctx.userId).single();
    if (!me?.cardLast4) return { error: 'No card is linked — the user must link a card in Wallet before topping up.' };
    return {
      proposal: {
        id: `topup:${Date.now()}`,
        action: 'topup',
        eventId: null,
        title: 'Wallet top-up',
        summary: `Top up $${amount.toFixed(2)} to your wallet (charged to your card ending ${me.cardLast4}).`,
        payload: { amount },
      },
    };
  },

  async propose_pledge(args, ctx) {
    const ev = (await visibleEvents(ctx)).find((e) => e.id === args.eventId);
    if (!ev) return { error: 'Event not found or not visible to you.' };
    if (ev.hostId === ctx.userId) return { error: 'You cannot buy tickets for your own event.' };
    if (ev.status === 'cancelled' || ev.status === 'completed') return { error: 'This event is no longer open for tickets.' };
    const qty = Math.max(1, Math.floor(Number(args.qty ?? 1)) || 1);
    const price = currentPrice(ev);
    const total = price * qty;
    return {
      proposal: {
        id: `pledge:${ev.id}:${Date.now()}`,
        action: 'pledge',
        eventId: ev.id,
        title: ev.title,
        summary: `Buy ${qty} ticket${qty > 1 ? 's' : ''} to "${ev.title}" with your wallet — $${total.toFixed(2)} (${qty} × $${price.toFixed(2)}) deducted from your balance.`,
        payload: { qty },
      },
    };
  },

  async propose_cancel_event(args, ctx) {
    const ev = (await visibleEvents(ctx)).find((e) => e.id === args.eventId);
    if (!ev) return { error: 'Event not found or not visible to you.' };
    if (ev.hostId !== ctx.userId) return { error: 'You can only cancel events you host.' };
    if (ev.status === 'cancelled' || ev.status === 'completed') return { error: 'This event can no longer be cancelled.' };
    const reason = String(args.reason ?? '').trim();
    return {
      proposal: {
        id: `cancel_event:${ev.id}:${Date.now()}`,
        action: 'cancel_event',
        eventId: ev.id,
        title: ev.title,
        summary: `Cancel "${ev.title}" — the event closes and every backer is refunded${reason ? ` (reason: ${reason})` : ''}. This cannot be undone.`,
        payload: { reason },
      },
    };
  },

  async propose_delete_draft(args, ctx) {
    const draftId = String(args.draftId ?? '').trim();
    if (!draftId) return { error: 'Provide the draftId (use list_my_drafts to find it).' };
    let drafts;
    try {
      drafts = await listDrafts(ctx.supabase);
    } catch (e) {
      return { error: e?.message ?? 'Unable to load drafts.' };
    }
    const draft = drafts.find((d) => d.id === draftId);
    if (!draft) return { error: 'Draft not found (it may already be deleted or belong to someone else).' };
    return {
      proposal: {
        id: `delete_draft:${draftId}:${Date.now()}`,
        action: 'delete_draft',
        eventId: null,
        title: draft.title || '(untitled draft)',
        summary: `Delete the draft "${draft.title || '(untitled draft)'}". This cannot be undone.`,
        payload: { draftId },
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
