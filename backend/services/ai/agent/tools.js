import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { computeEconomics, loadCalculator } from '../../eventEconomics.js';
import { listDrafts, mapEventRow, getProfile, giveAwayTickets, getEventAttendees } from '../../eventService.js';
import { assessEvent } from '../../weatherService.js';
import { researchEventIdeas } from './research.js';
import { rememberFact } from '../memory.js';
import { embedText, toVectorLiteral, isEmbeddingEnabled } from '../embeddingService.js';
import { semanticDraftMatches } from '../draftEmbeddings.js';

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

// Today in Singapore, for the get_current_date tool and the past-event filter.
function sgNow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'long', hour12: false,
  }).formatToParts(now).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  return {
    now,
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: parts.weekday,
    timezone: 'Asia/Singapore (SGT, UTC+8)',
  };
}

// An event is "past" once its end (or, lacking that, its start) is before now — so
// ended-but-not-yet-swept events never show up as buyable.
function isPastEvent(ev, now = Date.now()) {
  const end = ev.endDate ?? ev.startDate ?? null;
  if (!end) return false;
  const t = new Date(end).getTime();
  return Number.isFinite(t) && t < now;
}

// True only while an event's START is strictly in the future — once it starts (or is
// ongoing/past) you can no longer attend it.
function isFutureStart(ev, now = Date.now()) {
  if (!ev.startDate) return false;
  const t = new Date(ev.startDate).getTime();
  return Number.isFinite(t) && t > now;
}

// Event ids the UI shows as "Tickets already purchased" — a booking in the
// 'upcoming' OR 'cancelled' tab (matches App.tsx purchasedEventIds: active AND
// buyer-cancelled / given-away purchases both block re-buying). NOTE: get_profile's
// `myEventIds` counts ACTIVE tickets only, so it MISSES events whose tickets were
// all given away (status given_away → tab 'cancelled') — we must use the tabs.
async function purchasedEventIds(ctx) {
  try {
    const profile = await getProfile(ctx.supabase);
    const tickets = profile?.tickets ?? [];
    return new Set(tickets.filter((t) => t.tab === 'upcoming' || t.tab === 'cancelled').map((t) => String(t.eventId)));
  } catch {
    return new Set();
  }
}

// The canonical set of events the caller can ATTEND / BUY right now (shared by
// list_available_events and propose_pledge). Hosted by someone else, still open
// (early_bird/greenlit), starting strictly in the FUTURE (not started/ongoing/past),
// and NOT already purchased. Mirrors the frontend All Events buyable set.
async function attendableEvents(ctx) {
  if (ctx.role === 'admin') return [];
  const now = Date.now();
  const purchased = await purchasedEventIds(ctx);
  return (await visibleEvents(ctx)).filter((e) =>
    e.hostId !== ctx.userId
    && (e.status === 'early_bird' || e.status === 'greenlit')
    && !purchased.has(String(e.id))
    && isFutureStart(e, now));
}

// Resolve an event reference that may be an id OR a name/slug (users say "late-night
// supper crawl", the model sometimes passes "late-night-supper-crawl") to the event.
const normName = (s) => String(s ?? '').toLowerCase().replace(/[\s_-]+/g, ' ').trim();
function findEvent(events, ref) {
  const r = String(ref ?? '').trim();
  if (!r) return null;
  let ev = (events ?? []).find((e) => e.id === r); // exact id (uuid)
  if (ev) return ev;
  const nr = normName(r);
  if (!nr) return null;
  ev = events.find((e) => normName(e.title) === nr); // exact name, hyphen/space/case-insensitive
  if (ev) return ev;
  const sub = events.filter((e) => normName(e.title).includes(nr) || nr.includes(normName(e.title)));
  return sub[0] ?? null; // best substring match
}

function ambiguousEvent(names = []) {
  return { error: `I found more than one matching event: ${names.join(', ')}. Which one do you mean?` };
}

async function resolveEvent(ctx, events, ref) {
  const exact = findEvent(events, ref);
  if (exact) return { event: exact };
  const ranked = await semanticMatch(ctx, ref, { count: 8 });
  if (!ranked.length) return { event: null };
  const byId = new Map((events ?? []).map((e) => [e.id, e]));
  const scoped = ranked.filter((r) => byId.has(r.eventId));
  if (!scoped.length) return { event: null };
  const [first, second] = scoped;
  const confident = Number(first.similarity ?? 0) >= 0.55;
  const clear = !second || (Number(first.similarity ?? 0) - Number(second.similarity ?? 0)) >= 0.06;
  if (confident && clear) return { event: byId.get(first.eventId), similarity: first.similarity };
  return { ambiguous: scoped.slice(0, 3).map((r) => byId.get(r.eventId)?.title).filter(Boolean) };
}

function draftRefText(d = {}) {
  return [d.id, d.title, d.description, d.location, d.venue, d.address]
    .map((s) => String(s ?? '').toLowerCase())
    .join(' ');
}

async function resolveDraft(ctx, drafts, ref) {
  const query = String(ref ?? '').trim();
  if (!query) return { draft: null };
  const exact = drafts.find((d) => d.id === query);
  if (exact) return { draft: exact };
  const nq = query.toLowerCase();
  const literal = drafts.filter((d) => draftRefText(d).includes(nq));
  if (literal.length === 1) return { draft: literal[0] };
  if (literal.length > 1) return { ambiguous: literal.map((d) => d.title || '(untitled draft)').slice(0, 3) };
  const matches = await semanticDraftMatches(ctx.supabase, query, drafts, 5);
  if (!matches.length) return { draft: null };
  const [first, second] = matches;
  const confident = Number(first.similarity ?? 0) >= 0.55;
  const clear = !second || (Number(first.similarity ?? 0) - Number(second.similarity ?? 0)) >= 0.06;
  if (confident && clear) return { draft: first.draft, similarity: first.similarity };
  return { ambiguous: matches.slice(0, 3).map((m) => m.draft?.title || '(untitled draft)') };
}

function ambiguousDraft(names = []) {
  return { error: `I found more than one matching draft: ${names.join(', ')}. Which draft do you mean?` };
}

// A detail-rich event row so the agent (a RAG assistant) can answer questions about
// date/time, venue, deadline and description without extra tool calls.
function richRow(ev, ctx) {
  return {
    id: ev.id,
    title: ev.title,
    description: String(ev.description ?? '').slice(0, 300),
    status: ev.status,
    currentPrice: currentPrice(ev),
    hypePct: hypePct(ev),
    startDate: ev.startDate ?? null,
    endDate: ev.endDate ?? null,
    deadline: ev.deadline ?? ev.deadlineAt ?? null,
    venue: ev.location ?? null,
    address: ev.address ?? null,
    mine: ctx ? ev.hostId === ctx.userId : undefined,
  };
}

async function visibleEvents(ctx) {
  const { data, error } = await ctx.supabase.rpc('get_events');
  if (error) throw new Error(error.message);
  // get_events exposes the live status as `derived_status`; surface it as `status`
  // so every executor's `.status` read (filters, details, proposals) works.
  return (data ?? []).map((e) => ({ ...e, status: e.derived_status ?? e.status ?? 'early_bird' }));
}

// Rank event ids by SEMANTIC similarity to a free-text query (embed → match_events
// RPC). Returns [{eventId, similarity}] best-first, or [] when embeddings are off /
// unavailable so callers can fall back to keyword/price logic.
async function semanticMatch(ctx, query, { count = 40, exclude = null } = {}) {
  if (!isEmbeddingEnabled() || !String(query ?? '').trim()) return [];
  const vec = await embedText(query, { taskType: 'RETRIEVAL_QUERY' });
  if (!vec) return [];
  const { data, error } = await ctx.supabase.rpc('match_events', { p_embedding: toVectorLiteral(vec), p_count: count, p_exclude: exclude });
  if (error) return [];
  return (data ?? []).map((r) => ({ eventId: r.eventId, similarity: r.similarity }));
}
const sim2 = (s) => Math.round(Number(s) * 100) / 100;

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

// A rain warning to append to a create/edit proposal summary when the event's day
// is likely wet. Uses Singapore-level weather (events don't store coordinates);
// never throws and returns '' when the forecast is unavailable or fine.
async function weatherNote(startISO, endISO) {
  if (!startISO) return '';
  try {
    const w = await assessEvent({ startISO, endISO });
    return w.status === 'ok' && w.willRain ? ` Heads up: ${w.summary}` : '';
  } catch {
    return '';
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
  'Search events the user can see on party.fun. Returns matching events with full details — id, title, description, CURRENT price (the price on sale now), hype, status, start/end date-time, venue, address and pledging deadline. Use this to find events to recommend, to look one up by name (e.g. before editing it), or to answer detail questions. Excludes events that have already ended.',
  z.object({
    query: z.string().optional().describe('Keywords to match against title/description.'),
    maxPrice: z.number().optional().describe('Only events whose current price is at or below this price.'),
    hypeOnly: z.boolean().optional().describe('If true, only confirmed (greenlit) events.'),
  }),
);

export const getEventDetailsTool = makeTool(
  'get_event_details',
  "Get full details for one event the user can see, by its id: its current STATUS (early_bird/greenlit/completed/cancelled), the CURRENT PRICE a buyer pays now, tiers, tickets sold vs hype threshold, and — for the user's OWN event — the net revenue so far.",
  z.object({ eventId: z.string().describe('The event id OR its name (either works).') }),
);

export const getEventForecastTool = makeTool(
  'get_event_forecast',
  "Get the profit-calculator figures for one of the ORGANISER'S OWN events (host only): the ticket target the organiser set, total revenue at that target, average price, total operational cost, and PROFIT (revenue − cost). Use this to give revenue/profit advice. Operational costs are entered by the organiser and are NOT charged through party.fun.",
  z.object({ eventId: z.string().describe('The event id (must be hosted by the caller).') }),
);

export const getEventAttendeesTool = makeTool(
  'get_event_attendees',
  "List who is attending an event — the distinct people holding active tickets (their name/username) and the count. Use for questions like 'who is coming to my event?' or 'how many backers does X have?'.",
  z.object({ eventId: z.string().describe('The event id OR its name (either works).') }),
);

export const listAvailableEventsTool = makeTool(
  'list_available_events',
  "The ALL EVENTS / discovery list: events the user can BUY right now — NOT their own, not cancelled/completed, not already ended, and NOT already purchased by them. Each row has full details (current buyable price, status, hype, start/end date-time, venue, address, deadline, description). USE THIS for questions like 'cheapest/most expensive ticket I can buy' or 'what events can I attend'. Works the same for organisers — it returns other organisers' active events, never the caller's own.",
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
  "The user's saved event DRAFTS (unpublished). Optionally pass a natural-language query like 'the networking draft' to semantically find matching drafts before proposing to edit/delete.",
  z.object({
    query: z.string().optional().describe('Optional natural-language draft reference or topic.'),
  }),
);

// ── Date ────────────────────────────────────────────────────────────────────────
export const getCurrentDateTool = makeTool(
  'get_current_date',
  "Get TODAY'S date and current time in Singapore (SGT). Use this whenever you need to reason about dates — e.g. how far away an event is, whether a date is in the future, or to compute a start/end/deadline for a new event — and before checking the weather for a future event.",
  z.object({}),
);

// ── Weather ─────────────────────────────────────────────────────────────────────
export const getWeatherTool = makeTool(
  'get_weather',
  "Check the rain forecast for an event's date so you can warn about outdoor plans. Pass an eventId (uses that event's date) OR a start (and optional end) ISO 8601 datetime. Returns the precipitation probability and willRain (true when it is over 70%). Forecasts only reach ~10 days ahead. If willRain is true, warn the organiser it is not ideal for an outdoor event and suggest an indoor venue or another date.",
  z.object({
    eventId: z.string().optional().describe('An event id OR name to check (its date/time is used).'),
    start: z.string().optional().describe('ISO 8601 start datetime (if no eventId).'),
    end: z.string().optional().describe('ISO 8601 end datetime (optional).'),
  }),
);

// ── Web research ────────────────────────────────────────────────────────────────
export const researchEventIdeasTool = makeTool(
  'research_event_ideas',
  'Search the web for what university students are currently interested in, then recommend an event NAME, a DESCRIPTION, the rationale for why it suits them, and a suitable LOCATION (popular/convenient, ideally near the organiser\'s university). Use when an organiser asks what students want, for naming/description ideas, or where to host. Returns structured suggestions to present to the organiser.',
  z.object({
    theme: z.string().optional().describe('Optional angle or theme the organiser is considering (e.g. "music", "wellness", "networking").'),
    audience: z.string().optional().describe('Optional audience note (e.g. "first-year students", "postgrads").'),
  }),
);

// ── Semantic (vector) tools ───────────────────────────────────────────────────
export const recommendEventsTool = makeTool(
  'recommend_events',
  "Recommend events that best match the user's stated interests, ranked by MEANING (semantic similarity), not just keyword overlap. Use this for 'what event suits me', 'recommend something for me', 'best event for my interests'. Only returns events the user can actually attend (not their own, open, future, not already purchased).",
  z.object({
    interests: z.string().describe("The user's interests, e.g. 'gaming', 'live music and food', 'networking with founders'."),
    maxPrice: z.number().optional().describe('Only events at or below this price.'),
  }),
);

export const semanticSearchEventsTool = makeTool(
  'semantic_search_events',
  'Search the events the user can attend by MEANING (semantic similarity), not exact words — e.g. "chill outdoor night" finds a sunset picnic. Use for vague/thematic buyer searches. (Use search_events only to look up a specific event by its exact name.)',
  z.object({
    query: z.string().describe('A free-text description of what the user is looking for.'),
    maxPrice: z.number().optional(),
  }),
);

export const findSimilarEventsTool = makeTool(
  'find_similar_events',
  'Find events most similar in theme to a given event ("more like this"). Returns other visible events ranked by semantic similarity.',
  z.object({ eventId: z.string().describe('The reference event — its id OR name.') }),
);

// ── Memory ────────────────────────────────────────────────────────────────────
export const getSimilarPastEventsTool = makeTool(
  'get_similar_past_events',
  'Find similar completed/past events to ground organiser planning, pricing, capacity and revenue advice. Use this as examples only; do not present old results as current.',
  z.object({
    query: z.string().describe('The planned event theme or advice topic, e.g. "networking night for business students".'),
    count: z.number().optional().describe('Number of examples to retrieve.'),
  }),
);

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
    eventId: z.string().describe('The event id OR its name (must be hosted by the caller).'),
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
  "PROPOSE creating a NEW event for the organiser as a DRAFT (it is NOT published — the user reviews and publishes it from Drafts). Do NOT interrogate the organiser for the details: research current student interests (research_event_ideas) and INVENT sensible, COMPLETE values yourself, then propose immediately; offer alternatives only if they dislike it. Fill every field — title, description, venue, pricingModel + all prices/quantities. REQUIRED: title, plus startDate, endDate and deadline as ISO 8601 datetimes STRICTLY after today (get_current_date), e.g. 2026-08-15T19:00:00+08:00. Choose pricingModel: 'tiered' (set earlyPrice + greenlitPrice) or 'hype' (set basePrice + maxPrice, price rises as tickets sell).",
  z.object({
    title: z.string(),
    description: z.string().optional(),
    venue: z.string().optional(),
    address: z.string().optional(),
    startDate: z.string().optional().describe('ISO 8601 datetime.'),
    endDate: z.string().optional().describe('ISO 8601 datetime.'),
    deadline: z.string().optional().describe('ISO 8601 datetime pledging closes.'),
    pricingModel: z.enum(['tiered', 'hype']).optional().describe("'tiered' = fixed early-bird then greenlit price; 'hype' = price rises from base to max as tickets sell. Defaults to tiered."),
    earlyPrice: z.number().optional().describe('Tiered: early-bird price.'),
    greenlitPrice: z.number().optional().describe('Tiered: greenlit price (must be higher than early-bird).'),
    basePrice: z.number().optional().describe('Hype: starting price.'),
    maxPrice: z.number().optional().describe('Hype: maximum price (must be higher than base).'),
    capacity: z.number().optional(),
    hypeThreshold: z.number().optional().describe('Tickets needed to greenlight.'),
    university: z.string().optional().describe('University code to restrict to (optional).'),
  }),
);

export const proposeInviteCoorganiserTool = makeTool(
  'propose_invite_coorganiser',
  "PROPOSE inviting a co-organiser to one of the organiser's OWN events. Does NOT send the invite — returns a proposal the user must confirm.",
  z.object({
    eventId: z.string().describe('The event id OR its name (must be hosted by the caller).'),
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
    eventId: z.string().describe('The event to buy into — its id OR name (either works).'),
    qty: z.number().optional().describe('Number of tickets (>= 1). Defaults to 1.'),
  }),
);

export const proposeCancelEventTool = makeTool(
  'propose_cancel_event',
  'PROPOSE cancelling one of the organiser\'s OWN live events. This is also how you DELETE a published event: it closes the event and REFUNDS every backer. A reason is OPTIONAL — if the organiser gives one, pass it as-is (any reason is fine, even informal); if they do not, proceed without it. Does NOT cancel — returns a proposal the user must confirm.',
  z.object({
    eventId: z.string().describe('The event id OR its name (must be hosted by the caller).'),
    reason: z.string().optional().describe('Optional reason shown to backers. Pass whatever the organiser gives; leave empty if none.'),
  }),
);

export const proposeDeleteDraftTool = makeTool(
  'propose_delete_draft',
  'PROPOSE permanently deleting one of the user\'s unpublished DRAFTS. Does NOT delete — returns a proposal the user must confirm. Use list_my_drafts first to get the draftId.',
  z.object({ draftId: z.string().describe('The draft id (from list_my_drafts).') }),
);

export const proposeEditDraftTool = makeTool(
  'propose_edit_draft',
  "PROPOSE editing an unpublished DRAFT (an event the organiser created via the agent but has NOT published yet — find it with list_my_drafts). This is for DRAFTS only; for a PUBLISHED event use propose_update_event. Pass the draftId and ONLY the fields to change. Does NOT apply — returns a proposal the user must confirm.",
  z.object({
    draftId: z.string().describe('The draft id (from list_my_drafts).'),
    title: z.string().optional(),
    description: z.string().optional(),
    venue: z.string().optional(),
    address: z.string().optional(),
    startDate: z.string().optional().describe('ISO 8601 datetime.'),
    endDate: z.string().optional().describe('ISO 8601 datetime.'),
    deadline: z.string().optional().describe('ISO 8601 datetime.'),
    pricingModel: z.enum(['tiered', 'hype']).optional(),
    earlyPrice: z.number().optional().describe('Tiered: early-bird price.'),
    greenlitPrice: z.number().optional().describe('Tiered: greenlit price.'),
    basePrice: z.number().optional().describe('Hype: starting price.'),
    maxPrice: z.number().optional().describe('Hype: maximum price.'),
    capacity: z.number().optional(),
    hypeThreshold: z.number().optional(),
  }),
);

export const proposeGiveAwayTicketsTool = makeTool(
  'propose_give_away_tickets',
  "PROPOSE giving away some of the user's OWN tickets for an event they've joined. Give-aways are FINAL and non-refundable — the released spots return to the public pool. The user MUST specify how many (qty must be greater than 0 and at most the number they currently hold). Identify the event by its id (use get_my_joined_events / search_events to find it). Does NOT give away — returns a proposal the user must confirm.",
  z.object({
    eventId: z.string().describe('The event the user holds tickets for — id OR name.'),
    qty: z.number().describe('How many tickets to give away (> 0 and <= tickets currently held).'),
  }),
);

// All tools + a by-name index for the graph to bind per-branch subsets.
export const AGENT_TOOLS = [
  searchEventsTool, getEventDetailsTool, getEventForecastTool, getEventAttendeesTool, listAvailableEventsTool,
  getMyHostedEventsTool, getMyJoinedEventsTool, getWalletTool, listMyDraftsTool,
  getCurrentDateTool, getWeatherTool, researchEventIdeasTool,
  recommendEventsTool, semanticSearchEventsTool, findSimilarEventsTool, getSimilarPastEventsTool, rememberTool,
  proposeUpdateEventTool, proposeCreateEventTool, proposeInviteCoorganiserTool,
  proposeTopupTool, proposePledgeTool, proposeCancelEventTool, proposeDeleteDraftTool,
  proposeEditDraftTool, proposeGiveAwayTicketsTool,
];
export const TOOLS_BY_NAME = Object.fromEntries(AGENT_TOOLS.map((t) => [t.name, t]));

export const EXECUTORS = {
  async search_events(args, ctx) {
    const q = String(args.query ?? '').toLowerCase().trim();
    const maxPrice = args.maxPrice != null ? Number(args.maxPrice) : null;
    const hypeOnly = !!args.hypeOnly;
    const now = Date.now();
    const rows = (await visibleEvents(ctx))
      .filter((e) => e.status !== 'cancelled' && e.status !== 'completed')
      .filter((e) => !isPastEvent(e, now))
      .filter((e) => (hypeOnly ? e.status === 'greenlit' : true))
      .filter((e) => (q ? `${e.title ?? ''} ${e.description ?? ''}`.toLowerCase().includes(q) : true))
      .filter((e) => (maxPrice != null ? currentPrice(e) <= maxPrice : true))
      .slice(0, 15)
      .map((e) => richRow(e, ctx));
    return { count: rows.length, events: rows };
  },

  async get_event_details(args, ctx) {
    const resolved = await resolveEvent(ctx, await visibleEvents(ctx), args.eventId);
    if (resolved.ambiguous) return ambiguousEvent(resolved.ambiguous);
    const ev = resolved.event;
    if (!ev) return { error: 'Event not found or not visible to you.' };
    const mine = ev.hostId === ctx.userId;
    const details = {
      id: ev.id,
      title: ev.title,
      description: ev.description,
      status: ev.status, // early_bird | greenlit | completed | cancelled
      startDate: ev.startDate,
      endDate: ev.endDate ?? null,
      deadline: ev.deadline ?? ev.deadlineAt ?? null,
      venue: ev.location ?? null,
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
    // Resolve id-or-name to the real event, then read its profit-calculator economics.
    const resolved = await resolveEvent(ctx, await visibleEvents(ctx), args.eventId);
    if (resolved.ambiguous) return ambiguousEvent(resolved.ambiguous);
    const ref = resolved.event;
    if (!ref) return { error: 'Event not found or not visible to you.' };
    if (ref.hostId !== ctx.userId && !ref.canEdit && !ref.isCoOrganiser && ctx.role !== 'admin') {
      return { error: 'You can only see the profit calculator for events you host.' };
    }
    const state = await loadCalculator(ctx.supabase, ref);
    const e = computeEconomics(state);
    return {
      title: ref.title,
      pricingModel: ref.hypeDrivenPricing ? 'hype' : 'tiered',
      ticketTarget: e.ticketCount, // tickets the organiser is aiming to sell in the calculator
      totalRevenue: e.totalRevenue,
      avgTicketPrice: e.avgTicketPrice,
      totalOperationalCost: e.totalCost, // costs are entered by the organiser; NOT charged by the app
      profit: e.profit, // profit = total revenue − total cost
    };
  },

  async get_event_attendees(args, ctx) {
    const resolved = await resolveEvent(ctx, await visibleEvents(ctx), args.eventId);
    if (resolved.ambiguous) return ambiguousEvent(resolved.ambiguous);
    const ev = resolved.event;
    if (!ev) return { error: 'Event not found or not visible to you.' };
    let attendees;
    try {
      attendees = await getEventAttendees(ctx.supabase, ev.id);
    } catch (e) {
      return { error: e?.message ?? 'Unable to load attendees.' };
    }
    return {
      eventId: ev.id,
      title: ev.title,
      attendeeCount: attendees.length, // distinct people holding active tickets (one buyer of many tickets = one attendee)
      attendees: attendees.map((a) => ({ name: a.name ?? a.username ?? null, username: a.username ?? null })),
    };
  },

  // ── App-knowledge read tools ─────────────────────────────────────────────────
  async list_available_events(args, ctx) {
    const q = String(args.query ?? '').toLowerCase().trim();
    const maxPrice = args.maxPrice != null ? Number(args.maxPrice) : null;
    const rows = (await attendableEvents(ctx))
      .filter((e) => (q ? `${e.title ?? ''} ${e.description ?? ''}`.toLowerCase().includes(q) : true))
      .filter((e) => (maxPrice != null ? currentPrice(e) <= maxPrice : true))
      .map((e) => richRow(e, ctx));
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
    let profile;
    try {
      profile = await getProfile(ctx.supabase);
    } catch (e) {
      return { error: e?.message ?? 'Unable to load your joined events.' };
    }
    const tickets = profile?.tickets ?? [];
    const eventsById = new Map((await visibleEvents(ctx)).map((e) => [e.id, e]));
    const toRow = (t) => {
      const e = eventsById.get(t.eventId);
      return {
        eventId: t.eventId,
        title: e?.title ?? '(event)',
        status: e?.status ?? null,
        startDate: e?.startDate ?? null,
        venue: e?.location ?? null,
        currentPrice: e ? currentPrice(e) : null,
        ticketsHeld: Number(t.activeTicketCount ?? 0), // how many tickets the user still holds
      };
    };
    // tab: 'upcoming' = currently joined, 'past' = attended, 'cancelled' = gave away all / event cancelled.
    const byTab = (tab) => tickets.filter((t) => t.tab === tab).map(toRow);
    const upcoming = byTab('upcoming');
    const past = byTab('past');
    const cancelled = byTab('cancelled');
    return { counts: { upcoming: upcoming.length, past: past.length, cancelled: cancelled.length }, upcoming, past, cancelled };
  },

  // ── Date ─────────────────────────────────────────────────────────────────────
  async get_current_date() {
    const d = sgNow();
    return { date: d.isoDate, time: d.time, weekday: d.weekday, timezone: d.timezone };
  },

  // ── Weather ──────────────────────────────────────────────────────────────────
  async get_weather(args, ctx) {
    let startISO = args.start;
    let endISO = args.end;
    let lat;
    let lon;
    if (args.eventId) {
      const resolved = await resolveEvent(ctx, await visibleEvents(ctx), args.eventId);
      if (resolved.ambiguous) return ambiguousEvent(resolved.ambiguous);
      const ev = resolved.event;
      if (!ev) return { error: 'Event not found or not visible to you.' };
      startISO = startISO || ev.startDate;
      endISO = endISO || ev.endDate;
      lat = ev.latitude;
      lon = ev.longitude;
    }
    if (!startISO) return { error: 'Provide an eventId or a start date/time to check the weather.' };
    // Uses the event's stored venue coordinates when known; Singapore fallback otherwise.
    return await assessEvent({ lat, lon, startISO, endISO });
  },

  // ── Web research ─────────────────────────────────────────────────────────────
  async research_event_ideas(args, ctx) {
    let university = '';
    try {
      const { data } = await ctx.supabase.from('USER').select('university').eq('id', ctx.userId).single();
      university = data?.university || '';
    } catch {
      /* university is optional — proceed without it */
    }
    return await researchEventIdeas({ theme: args.theme, audience: args.audience, university });
  },

  // ── Semantic (vector) tools ──────────────────────────────────────────────────
  async recommend_events(args, ctx) {
    const interests = String(args.interests ?? '').trim();
    const maxPrice = args.maxPrice != null ? Number(args.maxPrice) : null;
    const attendable = (await attendableEvents(ctx)).filter((e) => (maxPrice == null || currentPrice(e) <= maxPrice));
    const byId = new Map(attendable.map((e) => [e.id, e]));
    const ranked = (await semanticMatch(ctx, interests, { count: 40 })).filter((r) => byId.has(r.eventId));
    if (ranked.length) {
      const rows = ranked.map((r) => ({ ...richRow(byId.get(r.eventId), ctx), similarity: sim2(r.similarity) })).slice(0, 5);
      return { count: rows.length, interests, semantic: true, events: rows };
    }
    // Fallback (no embeddings): cheapest attendable events first.
    const rows = [...attendable].sort((a, b) => currentPrice(a) - currentPrice(b)).slice(0, 5).map((e) => richRow(e, ctx));
    return { count: rows.length, interests, semantic: false, events: rows };
  },

  async semantic_search_events(args, ctx) {
    const query = String(args.query ?? '').trim();
    if (!query) return { count: 0, events: [] };
    const maxPrice = args.maxPrice != null ? Number(args.maxPrice) : null;
    const attendable = (await attendableEvents(ctx)).filter((e) => (maxPrice == null || currentPrice(e) <= maxPrice));
    const byId = new Map(attendable.map((e) => [e.id, e]));
    const ranked = (await semanticMatch(ctx, query, { count: 40 })).filter((r) => byId.has(r.eventId));
    if (ranked.length) {
      const rows = ranked.map((r) => ({ ...richRow(byId.get(r.eventId), ctx), similarity: sim2(r.similarity) })).slice(0, 10);
      return { count: rows.length, semantic: true, events: rows };
    }
    // Fallback: substring match within attendable events.
    const q = query.toLowerCase();
    const rows = attendable.filter((e) => `${e.title ?? ''} ${e.description ?? ''}`.toLowerCase().includes(q)).slice(0, 10).map((e) => richRow(e, ctx));
    return { count: rows.length, semantic: false, events: rows };
  },

  async find_similar_events(args, ctx) {
    const visible = await visibleEvents(ctx);
    const resolved = await resolveEvent(ctx, visible, args.eventId);
    if (resolved.ambiguous) return ambiguousEvent(resolved.ambiguous);
    const ev = resolved.event;
    if (!ev) return { error: 'Event not found or not visible to you.' };
    const text = [ev.title, ev.description, ev.location].filter(Boolean).join('\n');
    const ranked = await semanticMatch(ctx, text, { count: 10, exclude: ev.id });
    if (!ranked.length) return { reference: ev.title, semantic: false, events: [] };
    const byId = new Map(visible.map((e) => [e.id, e]));
    const rows = ranked.filter((r) => byId.has(r.eventId)).map((r) => ({ ...richRow(byId.get(r.eventId), ctx), similarity: sim2(r.similarity) })).slice(0, 5);
    return { reference: ev.title, semantic: true, events: rows };
  },

  async get_similar_past_events(args, ctx) {
    const query = String(args.query ?? '').trim();
    if (!query) return { count: 0, semantic: false, events: [] };
    if (!isEmbeddingEnabled()) return { count: 0, semantic: false, events: [] };
    const vec = await embedText(query, { taskType: 'RETRIEVAL_QUERY' });
    if (!vec) return { count: 0, semantic: false, events: [] };
    const count = Math.max(1, Math.min(10, Number(args.count ?? 5) || 5));
    const { data, error } = await ctx.supabase.rpc('match_similar_past_events', {
      p_embedding: toVectorLiteral(vec),
      p_count: count,
      p_exclude: null,
    });
    if (error) return { count: 0, semantic: false, events: [] };
    const rows = (data ?? []).map((r) => ({
      title: r.title,
      sold: Number(r.sold ?? 0),
      capacity: Number(r.capacity ?? 0),
      sellThroughPct: Number(r.capacity ?? 0) > 0 ? Math.round((Number(r.sold ?? 0) / Number(r.capacity)) * 100) : null,
      similarity: sim2(r.similarity),
    }));
    return { count: rows.length, semantic: true, events: rows };
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
    const resolved = await resolveEvent(ctx, await visibleEvents(ctx), args.eventId);
    if (resolved.ambiguous) return ambiguousEvent(resolved.ambiguous);
    const ev = resolved.event;
    if (!ev) return { error: 'Event not found or not visible to you.' };
    // Owners AND accepted co-organisers can edit (mirrors the update_event RPC's can_manage_event check).
    if (ev.hostId !== ctx.userId && !ev.isCoOrganiser) return { error: 'You can only edit events you host or co-organise.' };
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
    // Only check weather when the edit changes the date (otherwise the note would be noise).
    const rain = payload.startDate ? await weatherNote(payload.startDate, payload.endDate) : '';
    return {
      proposal: {
        id: `update_event:${ev.id}:${Date.now()}`,
        action: 'update_event',
        eventId: ev.id,
        title: ev.title,
        summary: `Update "${ev.title}": ${parts.join(', ')}.${rain}`,
        payload,
      },
    };
  },

  async propose_create_event(args, ctx) {
    if (ctx.role !== 'organiser' && ctx.role !== 'admin') {
      return { error: 'Only organisers can create events.' };
    }
    const title = String(args.title ?? '').trim();
    if (!title) return { error: 'An event title is required to draft an event.' };
    // Dates are required so the draft carries real start/end/deadline the form can show.
    const isValidDate = (v) => v && !Number.isNaN(new Date(v).getTime());
    if (!isValidDate(args.startDate) || !isValidDate(args.endDate) || !isValidDate(args.deadline)) {
      return { error: 'Ask the user for the event date, start & end time, and the pledging deadline, then pass them as ISO 8601 (e.g. 2026-08-15T19:00:00+08:00) — startDate, endDate and deadline are all required to draft the event.' };
    }
    // Dates must be sensible and in the FUTURE (use get_current_date to reason about "today").
    const now = Date.now();
    const startMs = new Date(args.startDate).getTime();
    const endMs = new Date(args.endDate).getTime();
    const deadlineMs = new Date(args.deadline).getTime();
    if (startMs <= now) return { error: 'The event start must be in the future — check get_current_date and pick a date and time strictly after today.' };
    if (endMs <= startMs) return { error: 'The event end must be after its start.' };
    if (deadlineMs >= startMs) return { error: 'The pledging deadline must be before the event start.' };
    const pricingModel = args.pricingModel === 'hype' ? 'hype' : 'tiered';
    if (pricingModel === 'hype') {
      const base = Number(args.basePrice);
      const max = Number(args.maxPrice);
      if (!Number.isFinite(base) || !Number.isFinite(max)) return { error: 'Hype pricing needs a basePrice and a maxPrice.' };
      if (max <= base) return { error: 'For hype pricing, maxPrice must be higher than basePrice.' };
    } else if (args.earlyPrice != null && args.greenlitPrice != null && Number(args.greenlitPrice) < Number(args.earlyPrice)) {
      return { error: 'For tiered pricing, the greenlit price must be at least the early-bird price.' };
    }
    const payload = {
      title,
      description: args.description ?? '',
      venue: args.venue ?? '',
      address: args.address ?? '',
      startDate: args.startDate ?? '',
      endDate: args.endDate ?? '',
      deadline: args.deadline ?? '',
      pricingModel,
      earlyPrice: args.earlyPrice ?? null,
      greenlitPrice: args.greenlitPrice ?? null,
      basePrice: args.basePrice ?? null,
      maxPrice: args.maxPrice ?? null,
      capacity: args.capacity ?? null,
      hypeThreshold: args.hypeThreshold ?? null,
      university: args.university ?? '',
    };
    const bits = [];
    if (payload.venue) bits.push(`at ${payload.venue}`);
    if (payload.startDate) bits.push(`starting ${payload.startDate}`);
    if (pricingModel === 'hype') bits.push(`hype pricing $${Number(payload.basePrice).toFixed(2)}→$${Number(payload.maxPrice).toFixed(2)}`);
    else if (payload.earlyPrice != null) bits.push(`early-bird $${Number(payload.earlyPrice).toFixed(2)}`);
    const rain = await weatherNote(payload.startDate, payload.endDate);
    return {
      proposal: {
        id: `create_event_draft:${Date.now()}`,
        action: 'create_event_draft',
        eventId: null,
        title,
        summary: `Create a draft event "${title}"${bits.length ? ` (${bits.join(', ')})` : ''}. Review and publish it from your Drafts.${rain}`,
        payload,
      },
    };
  },

  async propose_invite_coorganiser(args, ctx) {
    const resolved = await resolveEvent(ctx, await visibleEvents(ctx), args.eventId);
    if (resolved.ambiguous) return ambiguousEvent(resolved.ambiguous);
    const ev = resolved.event;
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

  async list_my_drafts(args, ctx) {
    let drafts;
    try {
      drafts = await listDrafts(ctx.supabase);
    } catch (e) {
      return { error: e?.message ?? 'Unable to load drafts.' };
    }
    const query = String(args.query ?? '').trim();
    if (query) {
      const nq = query.toLowerCase();
      const literal = drafts.filter((d) => draftRefText(d).includes(nq));
      const matches = literal.length
        ? literal.map((d) => ({ draft: d, similarity: null }))
        : await semanticDraftMatches(ctx.supabase, query, drafts, 5);
      return {
        count: matches.length,
        semantic: literal.length === 0 && matches.length > 0,
        drafts: matches.map((m) => ({
          id: m.draft.id,
          title: m.draft.title || '(untitled draft)',
          startDate: m.draft.startsAt || m.draft.startDate || null,
          venue: m.draft.location || m.draft.venue || null,
          similarity: m.similarity == null ? undefined : sim2(m.similarity),
        })),
      };
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
    if (ctx.role === 'admin') return { error: 'Admin accounts cannot attend events or buy tickets.' };
    // Only events the caller can actually attend/buy (not own/started/past/cancelled/owned).
    // Accepts an event id OR name (findEvent resolves both).
    const resolved = await resolveEvent(ctx, await attendableEvents(ctx), args.eventId);
    if (resolved.ambiguous) return ambiguousEvent(resolved.ambiguous);
    const ev = resolved.event;
    if (!ev) {
      const seenResolved = await resolveEvent(ctx, await visibleEvents(ctx), args.eventId);
      if (seenResolved.ambiguous) return ambiguousEvent(seenResolved.ambiguous);
      const seen = seenResolved.event;
      if (!seen) return { error: 'Event not found or not visible to you.' };
      if (seen.hostId === ctx.userId) return { error: 'You cannot buy tickets for your own event.' };
      if (seen.status === 'cancelled' || seen.status === 'completed') return { error: 'This event is no longer open for tickets.' };
      if (!isFutureStart(seen)) return { error: 'This event has already started, so tickets can no longer be bought.' };
      return { error: 'You already hold tickets for this event — give them away before buying again.' };
    }
    const qty = Math.max(1, Math.floor(Number(args.qty ?? 1)) || 1);
    const price = currentPrice(ev);
    const total = price * qty;
    // Wallet pre-check: the agent pays from the wallet; if short, guide a card top-up first.
    const { data: me } = await ctx.supabase.from('USER').select('walletBalance, cardLast4').eq('id', ctx.userId).single();
    const balance = Number(me?.walletBalance ?? 0);
    if (total > balance) {
      const shortfall = (total - balance).toFixed(2);
      const cardNote = me?.cardLast4
        ? `Offer to top up $${shortfall} (or more) into the wallet by charging their card ending ${me.cardLast4} (propose_topup), then pledge.`
        : `No card is linked — ask them to link a card in Wallet before buying.`;
      return { error: `Wallet balance is $${balance.toFixed(2)}, which is $${shortfall} short of the $${total.toFixed(2)} for ${qty} ticket${qty > 1 ? 's' : ''}. ${cardNote}` };
    }
    return {
      proposal: {
        id: `pledge:${ev.id}:${Date.now()}`,
        action: 'pledge',
        eventId: ev.id,
        title: ev.title,
        summary: `Buy ${qty} ticket${qty > 1 ? 's' : ''} to "${ev.title}" with your wallet — $${total.toFixed(2)} (${qty} × $${price.toFixed(2)}). Wallet $${balance.toFixed(2)} → $${(balance - total).toFixed(2)} after.`,
        payload: { qty },
      },
    };
  },

  async propose_cancel_event(args, ctx) {
    const resolved = await resolveEvent(ctx, await visibleEvents(ctx), args.eventId);
    if (resolved.ambiguous) return ambiguousEvent(resolved.ambiguous);
    const ev = resolved.event;
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
        summary: `Cancel "${ev.title}" — the event closes and every backer is refunded ${reason ? `(reason: ${reason})` : '(no reason given)'}. This cannot be undone.`,
        payload: { reason },
      },
    };
  },

  async propose_give_away_tickets(args, ctx) {
    const qty = Math.floor(Number(args.qty));
    if (!Number.isFinite(qty) || qty <= 0) return { error: 'Specify how many tickets to give away (a whole number greater than 0).' };
    let profile;
    try {
      profile = await getProfile(ctx.supabase);
    } catch (e) {
      return { error: e?.message ?? 'Unable to load your tickets.' };
    }
    // Resolve the event (id OR name) so we can match holdings by its real id.
    const resolved = await resolveEvent(ctx, await visibleEvents(ctx), args.eventId);
    if (resolved.ambiguous) return ambiguousEvent(resolved.ambiguous);
    const ev = resolved.event;
    if (!ev) return { error: 'Event not found or not visible to you.' };
    // Find the caller's active, still-upcoming booking for this event (get_profile
    // tickets carry bookingId/eventId/activeTicketCount/tab, but not the title).
    const holdings = (profile?.tickets ?? []).filter((t) => t.eventId === ev.id && Number(t.activeTicketCount ?? 0) > 0 && t.tab === 'upcoming');
    if (holdings.length === 0) return { error: 'You do not hold any active tickets for that event (or it has already passed).' };
    const booking = holdings[0];
    const held = Number(booking.activeTicketCount ?? 0);
    if (qty > held) return { error: `You only hold ${held} ticket${held === 1 ? '' : 's'} for that event — give away at most ${held}.` };
    const eventTitle = ev.title ?? 'the event';
    return {
      proposal: {
        id: `give_away:${booking.bookingId}:${Date.now()}`,
        action: 'give_away',
        eventId: ev.id,
        title: eventTitle,
        summary: `Give away ${qty} of your ${held} ticket${held === 1 ? '' : 's'} for "${eventTitle}". This is final and non-refundable — the released spots return to the public pool.`,
        payload: { bookingId: booking.bookingId, qty },
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
    const resolved = await resolveDraft(ctx, drafts, draftId);
    if (resolved.ambiguous) return ambiguousDraft(resolved.ambiguous);
    const draft = resolved.draft;
    if (!draft) return { error: 'Draft not found (it may already be deleted or belong to someone else).' };
    return {
      proposal: {
        id: `delete_draft:${draft.id}:${Date.now()}`,
        action: 'delete_draft',
        eventId: null,
        title: draft.title || '(untitled draft)',
        summary: `Delete the draft "${draft.title || '(untitled draft)'}". This cannot be undone.`,
        payload: { draftId: draft.id },
      },
    };
  },

  async propose_edit_draft(args, ctx) {
    const draftId = String(args.draftId ?? '').trim();
    if (!draftId) return { error: 'Provide the draftId (use list_my_drafts to find it).' };
    let drafts;
    try {
      drafts = await listDrafts(ctx.supabase);
    } catch (e) {
      return { error: e?.message ?? 'Unable to load drafts.' };
    }
    const resolved = await resolveDraft(ctx, drafts, draftId);
    if (resolved.ambiguous) return ambiguousDraft(resolved.ambiguous);
    const draft = resolved.draft;
    if (!draft) return { error: 'Draft not found (use list_my_drafts to find the right draftId).' };

    // Collect only the fields the organiser wants to change.
    const FIELDS = ['title', 'description', 'venue', 'address', 'startDate', 'endDate', 'deadline', 'pricingModel', 'earlyPrice', 'greenlitPrice', 'basePrice', 'maxPrice', 'capacity', 'hypeThreshold'];
    const updates = {};
    for (const f of FIELDS) if (args[f] !== undefined && args[f] !== null && args[f] !== '') updates[f] = args[f];
    if (Object.keys(updates).length === 0) return { error: 'Specify at least one field to change on the draft.' };

    const label = { title: 'Title', description: 'Description', venue: 'Venue', address: 'Address', startDate: 'Start', endDate: 'End', deadline: 'Deadline', pricingModel: 'Pricing model', earlyPrice: 'Early-bird price', greenlitPrice: 'Greenlit price', basePrice: 'Base price', maxPrice: 'Max price', capacity: 'Capacity', hypeThreshold: 'Hype threshold' };
    const parts = Object.keys(updates).map((f) => (f === 'description' ? 'Description (updated)' : `${label[f]} → ${updates[f]}`));
    return {
      proposal: {
        id: `edit_draft:${draft.id}:${Date.now()}`,
        action: 'edit_draft',
        eventId: null,
        title: draft.title || '(untitled draft)',
        summary: `Edit the draft "${draft.title || '(untitled draft)'}": ${parts.join(', ')}.`,
        payload: { draftId: draft.id, updates },
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
