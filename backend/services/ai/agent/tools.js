import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { computeEconomics, loadCalculator } from '../../eventEconomics.js';
import { listDrafts, mapEventRow, getProfile, giveAwayTickets, getEventAttendees, getEventAttendeesPrivate, listEventsRaw, hostedRevenue, getUserUniversity } from '../../eventService.js';
import { cacheGetJson, cacheSetJson } from '../../cache.js';
import { createHash, randomUUID } from 'node:crypto';
import { assessEvent } from '../../weatherService.js';
import { researchEventIdeas } from './research.js';
import { rememberFact } from '../memory.js';
import { embedText, toVectorLiteral, isEmbeddingEnabled } from '../embeddingService.js';
import { semanticDraftMatches } from '../draftEmbeddings.js';
import { getAppKnowledge } from '../tasks/answerAppQuestion.js';
import { retrieveDocChunks } from '../docKnowledge.js';

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

// Spots remaining, and whether the event is FULL. One definition, shared by the buyable pool,
// the list rows and get_event_details — these used to disagree, so an event could be listed as
// "you can join this" while carrying soldOut:true and get_event_details saying isOpen:false.
// NB maxCapacity 0/absent means UNCAPPED, not full: `maxCapacity > 0` is load-bearing.
function spotsLeftFor(ev) {
  return Math.max(0, Number(ev.maxCapacity ?? 0) - Number(ev.active_ticket_count ?? 0));
}
function isSoldOut(ev) {
  return Number(ev.maxCapacity ?? 0) > 0 && spotsLeftFor(ev) === 0;
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
    && isFutureStart(e, now)
    // University-restricted events the viewer can't join are NOT attendable — get_events
    // returns them with viewer_can_attend=false rather than hiding them, so exclude them here
    // or the assistant would offer an SMU-only event to an NUS user (the pledge RPC blocks it,
    // but only after we'd promised they could join).
    && e.viewer_can_attend !== false
    // A FULL event is not buyable: capacity used to be enforced only by the create_pledge RPC,
    // so a sold-out event was still listed as joinable and a purchase only failed at execute
    // time ("Not enough tickets are available") after the agent had built a whole proposal.
    && !isSoldOut(e));
}

// Resolve an event reference that may be an id OR a name/slug (users say "late-night
// supper crawl", the model sometimes passes "late-night-supper-crawl") to the event.
const normName = (s) => String(s ?? '').toLowerCase().replace(/[\s_-]+/g, ' ').trim();
// EXACT resolution only — an event id or a full normalized-title match. A partial /
// substring reference is deliberately NOT resolved here; resolveEvent turns those into
// a "Did you mean …?" confirmation instead of silently picking one.
function findEvent(events, ref) {
  const r = String(ref ?? '').trim();
  if (!r) return null;
  const ev = (events ?? []).find((e) => e.id === r); // exact id (uuid)
  if (ev) return ev;
  const nr = normName(r);
  if (!nr) return null;
  return events.find((e) => normName(e.title) === nr) ?? null; // exact name, hyphen/space/case-insensitive
}

// Sørensen–Dice similarity over character bigrams of two normalized strings (0..1).
// Catches typos ("gymming for nes" ≈ "gymming for newbies") with no embeddings needed.
function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i += 1) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}
function diceSimilarity(a, b) {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return na === nb ? 1 : 0;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let overlap = 0;
  for (const [g, count] of ga) {
    const other = gb.get(g);
    if (other) overlap += Math.min(count, other);
  }
  const total = (na.length - 1) + (nb.length - 1);
  return total > 0 ? (2 * overlap) / total : 0;
}

// Suggestion floors for "Did you mean …?". Deliberately STRICT: offering nothing is better
// than offering a nonsense guess — at the old 0.3 semantic floor, "gymming for newbies"
// suggested "Grad Ball: Black-Tie Gala". Real typos are still caught by substring overlap and
// by Sørensen–Dice, which discriminates misspelt names far better than embeddings do.
const SEMANTIC_SUGGEST_MIN = 0.6;
const FUZZY_SUGGEST_MIN = 0.45;

// Best fuzzy (string-similarity) matches for a ref among events — the fallback when
// embeddings are off or the event hasn't been indexed yet. Returns titles best-first
// for matches at/above the threshold.
function fuzzyEventMatches(events, ref, { threshold = FUZZY_SUGGEST_MIN, limit = 3 } = {}) {
  const scored = (events ?? [])
    .map((e) => ({ title: e.title, score: diceSimilarity(ref, e.title) }))
    .filter((r) => r.title && r.score >= threshold)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((r) => r.title);
}

// A list-tool result for a query that matched nothing but is a near-miss to an event
// title — surfaces "Did you mean …?" so the agent confirms instead of saying "none".
function didYouMeanResult(pool, query) {
  const names = fuzzyEventMatches(pool, query);
  if (!names.length) return { count: 0, events: [] };
  const didYouMean = names.length === 1
    ? `No exact match for "${query}". Did you mean "${names[0]}"?`
    : `No exact match for "${query}". Did you mean one of these: ${names.join(', ')}?`;
  return { count: 0, events: [], didYouMean, suggestions: names };
}

function ambiguousEvent(names = []) {
  if (names.length === 1) {
    return { error: `I couldn't find an exact match for that. Did you mean "${names[0]}"? Say yes (or give the exact name) and I'll continue.` };
  }
  return { error: `I couldn't find an exact match. Did you mean one of these: ${names.join(', ')}? Which one?` };
}

// Resolve an event reference to an event. ONLY an EXACT id/full-name match resolves
// straight through. Any non-exact reference — a partial ("game nig"), a substring, or a
// typo — is NEVER auto-picked; we surface the closest match(es) (substring, then semantic,
// then fuzzy) as a "Did you mean …?" suggestion so the agent confirms before acting.
async function resolveEvent(ctx, events, ref) {
  const exact = findEvent(events, ref);
  if (exact) return { event: exact };
  const list = events ?? [];
  const suggestions = [];
  const push = (title) => { if (title && !suggestions.includes(title)) suggestions.push(title); };
  // 1. Substring / partial-name overlap (e.g. "game nig" ⊂ "game night and escape rooms").
  const nr = normName(ref);
  if (nr) {
    for (const e of list) {
      const en = normName(e.title);
      if (en && (en.includes(nr) || nr.includes(en))) push(e.title);
    }
  }
  // 2. Semantic matches (embeddings), high floor — only genuinely close events, never a guess.
  const ranked = await semanticMatch(ctx, ref, { count: 8 });
  const byId = new Map(list.map((e) => [e.id, e]));
  for (const r of ranked) {
    if (byId.has(r.eventId) && Number(r.similarity ?? 0) >= SEMANTIC_SUGGEST_MIN) push(byId.get(r.eventId)?.title);
  }
  // 3. Deterministic string-similarity fallback (works with no embeddings / unindexed events).
  for (const t of fuzzyEventMatches(list, ref)) push(t);
  if (suggestions.length) return { ambiguous: suggestions.slice(0, 3) };
  return { event: null };
}

// Resolve a free-text event reference against the events the caller can actually BUY.
// Reads Redis-first (attendableEvents → visibleEvents → listEventsRaw), falling back to
// Supabase, then layers exact → substring → semantic (embeddings) → fuzzy matching.
// Returns { event } on an exact hit, { ambiguous: [titles] } for close matches, or
// { event: null } when nothing resembles it. Used by the deterministic buy-intent check
// so a typo is caught before the LLM can invent an event.
export async function resolveAttendableRef(ctx, ref) {
  return resolveEvent(ctx, await attendableEvents(ctx), ref);
}

// As resolveAttendableRef, but over the WIDER pool of every event the caller can SEE. Lets the
// buy-intent short-circuit tell "no such event" apart from "a real event you just can't buy".
export async function resolveVisibleRef(ctx, ref) {
  return resolveEvent(ctx, await visibleEvents(ctx), ref);
}

// Why a VISIBLE event is not in attendableEvents; null means it IS buyable. Mirrors that
// filter using the same predicates so the two can't drift. Role isn't checked here —
// attendableEvents returns [] for admins and callers handle that case themselves.
export async function whyNotAttendable(ev, ctx) {
  if (!ev) return null;
  // Cancelled/ended outrank already_purchased: for someone holding tickets, "it was
  // cancelled" is the more useful truth than "you already have tickets".
  if (ev.status === 'cancelled') return 'cancelled';
  if (ev.status === 'completed') return 'completed';
  if (isPastEvent(ev)) return 'ended';
  if (!isFutureStart(ev)) return 'started';
  if (ev.hostId === ctx.userId) return 'own_event';
  // University-restricted and the viewer isn't eligible — they simply can't join it.
  if (ev.viewer_can_attend === false) return 'restricted_university';
  // Costs a getProfile round-trip, so it goes after the cheap synchronous checks. It comes
  // BEFORE sold_out because "you already have tickets" is the more useful truth for someone
  // who holds them — a full event they're already in isn't news.
  if ((await purchasedEventIds(ctx)).has(String(ev.id))) return 'already_purchased';
  if (isSoldOut(ev)) return 'sold_out';
  if (ev.status !== 'early_bird' && ev.status !== 'greenlit') return 'not_open';
  return null;
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
  const spotsLeft = spotsLeftFor(ev);
  return {
    id: ev.id,
    title: ev.title,
    description: String(ev.description ?? '').slice(0, 300),
    status: ev.status,
    currentPrice: currentPrice(ev),
    hypePct: hypePct(ev),
    // Cheap eligibility facts so a list answer ("is anything sold out?") needs no extra call.
    spotsLeft,
    soldOut: isSoldOut(ev),
    startDate: ev.startDate ?? null,
    endDate: ev.endDate ?? null,
    deadline: ev.deadline ?? ev.deadlineAt ?? null,
    venue: ev.location ?? null,
    address: ev.address ?? null,
    // University eligibility so the model can tell an ineligible viewer they can't join,
    // instead of implying an SMU-only event is open to them.
    restrictedUniversity: ev.restricted_university || null,
    canAttendUniversity: ev.viewer_can_attend !== false,
    mine: ctx ? ev.hostId === ctx.userId : undefined,
  };
}

async function visibleEvents(ctx) {
  // Redis-first (via listEventsRaw): serve from cache within its 45s TTL, else hit
  // Supabase and refresh. Falls through to Supabase automatically when Redis is off.
  const data = await listEventsRaw(ctx.supabase, ctx.userId ?? null);
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
    // Shared, cached (data:hostrev:u:<id>) — same entry the organiser dashboard uses.
    const rev = await hostedRevenue(ctx.supabase, ctx.userId);
    return rev.byEvent;
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
  "Get full details for one event the user can see, by its id or name: its current STATUS (early_bird/greenlit/completed/cancelled), the CURRENT PRICE a buyer pays now, tiers, tickets sold vs hype threshold, and — for the user's OWN event — the net revenue so far. ALSO returns the authoritative ELIGIBILITY facts — use these to answer yes/no questions instead of guessing: isOpen (can tickets still be bought at all — open status, not started, deadline not passed, spots left), deadline + deadlinePassed, isPast, spotsLeft / soldOut / maxCapacity, alreadyPurchased (the user already holds tickets, so cannot buy again), restrictedUniversity + canAttendUniversity (false = the event is limited to another university), mine, canEdit, canCancel, canViewAttendees, isCoOrganiser.",
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

export const listLiveEventsTool = makeTool(
  'list_live_events',
  "Every LIVE event across ALL organisers on the platform — the events currently in the early_bird or greenlit stage (open and not yet ended), regardless of who hosts them or whether the caller can buy. Use for 'what live events are hosted by organisers' / 'what events are currently live'. Works for every role, including admins (who host nothing of their own).",
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

// ── App knowledge (how party.fun works) ──────────────────────────────────────────
export const getAppInfoTool = makeTool(
  'get_app_info',
  "Look up HOW party.fun works — the authoritative reference for GENERAL app questions that have no per-user data: the $20 signup bonus new accounts receive, wallet & top-up rules (a linked card is required, top-ups are instant and capped at $200 per transaction), the sign-in options, how refunds work (wallet vs card), the event lifecycle, pricing models and fees, the FAQ / help page (/faq), the 'What students say' testimonials section, and general 'where do I find X in the app' / site-map questions (which page a feature lives on). Call this whenever the user asks how the app works, 'what happens when I…', 'is there an FAQ / testimonials section', or 'where is X', PASSING their question so the most relevant section is retrieved, then answer from what it returns. NEVER refuse such a question or say you lack the information — this tool has it.",
  z.object({ question: z.string().optional().describe("The user's app-knowledge question — pass it so retrieval returns the most relevant section.") }),
);

// ── Weather ─────────────────────────────────────────────────────────────────────
export const getWeatherTool = makeTool(
  'get_weather',
  "Check the rain forecast for an event's date so you can warn about outdoor plans. Pass an eventId (uses that event's date) OR a start (and optional end) ISO 8601 datetime. ALWAYS call this for any weather question rather than reasoning about whether a date is in range — it decides that itself and returns a status: 'ok' (precipitationProbability + willRain, true when over 70%), 'beyond_horizon' (genuinely too far out), 'past', or 'unavailable' (the forecast could not be fetched — this does NOT mean the date is too far away). If willRain is true, warn the organiser it is not ideal for an outdoor event and suggest an indoor venue or another date.",
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
  "PROPOSE editing an event. Organisers edit their OWN events; ADMINS may edit ANY event for moderation. Pass the event by NAME (never ask the user for an id) plus ONLY the fields to change. Does NOT apply the change — returns a proposal to confirm. Editable: title, description, venue, address, startDate, endDate, deadline (ISO 8601 datetimes), maxCapacity, hypeThreshold, earlyPrice, greenlitPrice.",
  z.object({
    eventId: z.string().describe('The event id OR its NAME (name is fine — the tool resolves it).'),
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
  "PROPOSE buying ticket(s) to an event. FIRST ask the payment method (in-app wallet OR debit/credit card) and the quantity, then call this with paymentMethod set. 'wallet' deducts the wallet balance; 'card' charges the user's linked card. Does NOT charge — returns a proposal the user must confirm. Cannot be their own event.",
  z.object({
    eventId: z.string().describe('The event to buy into — its id OR name (either works).'),
    qty: z.number().optional().describe('Number of tickets (>= 1). Defaults to 1.'),
    paymentMethod: z.enum(['wallet', 'card']).optional().describe("How to pay: 'wallet' (in-app balance) or 'card' (linked debit/credit card). Ask the user first; defaults to wallet."),
  }),
);

export const proposeCancelEventTool = makeTool(
  'propose_cancel_event',
  "PROPOSE cancelling a live event. This is also how you DELETE a published event: it closes the event and REFUNDS every backer. ORGANISERS may cancel their OWN events (reason OPTIONAL). ADMINS may cancel ANY event for moderation, but a reason is MANDATORY — accept any non-empty reason (even one word); if the admin gave none, ask for one first and do NOT call this tool until you have it. Does NOT cancel — returns a proposal the user must confirm.",
  z.object({
    eventId: z.string().describe('The event id OR its name.'),
    reason: z.string().optional().describe('Reason shown to backers. Optional for the host organiser; REQUIRED (any non-empty text) when an admin deletes another organiser\'s event.'),
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
  getMyHostedEventsTool, getMyJoinedEventsTool, listLiveEventsTool, getWalletTool, listMyDraftsTool,
  getCurrentDateTool, getAppInfoTool, getWeatherTool, researchEventIdeasTool,
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
    const visible = (await visibleEvents(ctx))
      .filter((e) => e.status !== 'cancelled' && e.status !== 'completed')
      .filter((e) => !isPastEvent(e, now))
      .filter((e) => (hypeOnly ? e.status === 'greenlit' : true));
    const rows = visible
      .filter((e) => (q ? `${e.title ?? ''} ${e.description ?? ''}`.toLowerCase().includes(q) : true))
      .filter((e) => (maxPrice != null ? currentPrice(e) <= maxPrice : true))
      .slice(0, 15)
      .map((e) => richRow(e, ctx));
    // Typo help: a keyword query that matched nothing → suggest the closest event by name.
    if (!rows.length && q) return didYouMeanResult(visible, args.query);
    return { count: rows.length, events: rows };
  },

  async get_event_details(args, ctx) {
    const resolved = await resolveEvent(ctx, await visibleEvents(ctx), args.eventId);
    if (resolved.ambiguous) return ambiguousEvent(resolved.ambiguous);
    const ev = resolved.event;
    if (!ev) return { error: 'Event not found or not visible to you.' };
    const mine = ev.hostId === ctx.userId;
    const now = Date.now();
    const sold = Number(ev.active_ticket_count ?? 0);
    const maxCapacity = Number(ev.maxCapacity ?? 0);
    const deadline = ev.deadline ?? ev.deadlineAt ?? null;
    const deadlinePassed = deadline ? new Date(deadline).getTime() < now : false;
    const spotsLeft = spotsLeftFor(ev);
    const purchased = await purchasedEventIds(ctx);
    const details = {
      id: ev.id,
      title: ev.title,
      description: ev.description,
      status: ev.status, // early_bird | greenlit | completed | cancelled
      startDate: ev.startDate,
      endDate: ev.endDate ?? null,
      deadline,
      venue: ev.location ?? null,
      address: ev.address,
      currentPrice: currentPrice(ev), // the price a buyer pays right now, given the status/pricing model
      ticketsSold: sold,
      hypeThreshold: ev.hypeThreshold ?? 0,
      hypePct: hypePct(ev),
      tiers: (ev.statuses ?? []).map((s) => ({ name: s.statusName, price: s.price, capacity: s.ticketCapacity })),
      mine,
      // ── Eligibility facts: answer yes/no questions from THESE, never by inferring ──
      maxCapacity,
      spotsLeft,
      soldOut: isSoldOut(ev),
      isPast: isPastEvent(ev, now),
      deadlinePassed,
      // The single source of truth for "can I still buy tickets for this?": open status,
      // not started, deadline not passed, and spots remain.
      isOpen: (ev.status === 'early_bird' || ev.status === 'greenlit')
        && isFutureStart(ev, now) && !deadlinePassed && (maxCapacity === 0 || spotsLeft > 0),
      alreadyPurchased: purchased.has(String(ev.id)), // already holds tickets → cannot buy again
      restrictedUniversity: ev.restricted_university || null, // null = open to everyone
      canAttendUniversity: ev.viewer_can_attend !== false,    // false = restricted to another university
      canEdit: !!ev.canEdit,
      canCancel: !!ev.canCancel,
      canViewAttendees: !!ev.canViewAttendees,
      isCoOrganiser: !!ev.isCoOrganiser,
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
    const state = await loadCalculator(ctx.supabase, ref, ctx.userId); // shared cache: data:calculator:u:<id>:e:<id>
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
      attendees = await getEventAttendees(ctx.supabase, ev.id); // shared cache: data:attendees:e:<id>
    } catch (e) {
      return { error: e?.message ?? 'Unable to load attendees.' };
    }
    // Managers (host / co-organiser / admin) additionally get contact details. The
    // private RPC is host/co-org/admin-only via can_manage_event; non-managers get
    // { error: 'forbidden' } and we return names only.
    let contactsByUsername = null;
    try {
      const priv = await getEventAttendeesPrivate(ctx.supabase, ev.id);
      if (!priv?.error && Array.isArray(priv?.attendees)) {
        contactsByUsername = new Map(priv.attendees.map((p) => [p.username, p]));
      }
    } catch { /* non-managers: names only */ }
    const rows = attendees.map((a) => {
      const row = { name: a.name ?? a.username ?? null, username: a.username ?? null };
      const c = contactsByUsername?.get(a.username);
      if (c) {
        row.email = c.email ?? null;
        row.telegram = c.socialLink || null; // optional — may be null/blank
        row.phone = c.contact || null;       // optional — may be null/blank
      }
      return row;
    });
    return {
      eventId: ev.id,
      title: ev.title,
      attendeeCount: attendees.length, // distinct people holding active tickets (one buyer of many tickets = one attendee)
      canSeeContacts: !!contactsByUsername, // true for host/co-organiser/admin
      attendees: rows,
    };
  },

  // ── App-knowledge read tools ─────────────────────────────────────────────────
  async list_available_events(args, ctx) {
    const q = String(args.query ?? '').toLowerCase().trim();
    const maxPrice = args.maxPrice != null ? Number(args.maxPrice) : null;
    const attendable = await attendableEvents(ctx);
    const rows = attendable
      .filter((e) => (q ? `${e.title ?? ''} ${e.description ?? ''}`.toLowerCase().includes(q) : true))
      .filter((e) => (maxPrice != null ? currentPrice(e) <= maxPrice : true))
      .map((e) => richRow(e, ctx));
    // Typo help: a named search with no hit → suggest the closest attendable event.
    if (!rows.length && q && maxPrice == null) return didYouMeanResult(attendable, args.query);
    return { count: rows.length, events: rows };
  },

  // richRow carries the shared event facts (description, start/end, venue, address, deadline);
  // this used to hand-roll a leaner row that omitted them, so the agent couldn't answer
  // "where did I host X?" / "how long is it?" / "which did I host earliest?" about own events.
  async get_my_hosted_events(_args, ctx) {
    const rows = (await visibleEvents(ctx)).filter((e) => e.hostId === ctx.userId);
    const revenue = await hostedRevenueById(ctx);
    return {
      count: rows.length,
      events: rows.map((e) => ({
        ...richRow(e, ctx),
        // Host-only economics on top of the shared row.
        earlyPrice: tierPrice(e, 'early_bird'),
        greenlitPrice: tierPrice(e, 'greenlit'),
        revenueSoFar: revenue[e.id] ?? 0, // net revenue captured so far
        ticketsSold: e.active_ticket_count ?? 0,
        hypeThreshold: e.hypeThreshold ?? 0,
        maxCapacity: e.maxCapacity ?? 0,
      })),
    };
  },

  async get_my_joined_events(_args, ctx) {
    let profile;
    try {
      profile = await getProfile(ctx.supabase, ctx.userId); // shared cache: data:profile:u:<id>
    } catch (e) {
      return { error: e?.message ?? 'Unable to load your joined events.' };
    }
    const tickets = profile?.tickets ?? [];
    const eventsById = new Map((await visibleEvents(ctx)).map((e) => [e.id, e]));
    const toRow = (t) => {
      const e = eventsById.get(t.eventId);
      const held = Number(t.activeTicketCount ?? 0); // how many tickets the user still holds
      // The event may no longer be visible (deleted/hidden) — keep the lean fallback.
      if (!e) return { eventId: t.eventId, title: '(event)', status: null, startDate: null, venue: null, currentPrice: null, ticketsHeld: held };
      // richRow's `id` is renamed to `eventId` so this row keeps exactly one id, as before.
      const { id, ...rest } = richRow(e, ctx);
      return { ...rest, eventId: id, ticketsHeld: held };
    };
    // tab: 'upcoming' = currently joined, 'past' = attended, 'cancelled' = gave away all / event cancelled.
    const byTab = (tab) => tickets.filter((t) => t.tab === tab).map(toRow);
    const upcoming = byTab('upcoming');
    const past = byTab('past');
    const cancelled = byTab('cancelled');
    return { counts: { upcoming: upcoming.length, past: past.length, cancelled: cancelled.length }, upcoming, past, cancelled };
  },

  // Every LIVE event on the platform (early_bird/greenlit, not ended), across ALL
  // organisers — independent of ownership/purchase, so it works for admins too.
  async list_live_events(_args, ctx) {
    const now = Date.now();
    const rows = (await visibleEvents(ctx))
      .filter((e) => (e.status === 'early_bird' || e.status === 'greenlit') && !isPastEvent(e, now))
      .map((e) => ({ ...richRow(e, ctx), organiser: e.organiser_name ?? null }));
    return { count: rows.length, events: rows };
  },

  // ── Date ─────────────────────────────────────────────────────────────────────
  async get_current_date() {
    const d = sgNow();
    return { date: d.isoDate, time: d.time, weekday: d.weekday, timezone: d.timezone };
  },

  // ── App knowledge (RAG) ──────────────────────────────────────────────────────
  // Retrieves the most relevant section(s) of app-knowledge.md for the question (chunk → embed →
  // cosine top-K, all from the live file — see docKnowledge.js), falling back to the whole doc
  // when embeddings are unavailable. No per-user data, so ctx is ignored.
  async get_app_info({ question } = {}) {
    const hit = await retrieveDocChunks(question);
    return { reference: hit ?? getAppKnowledge() };
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
      university = await getUserUniversity(ctx.supabase, ctx.userId); // shared cache: data:umeta:u:<id>
    } catch {
      /* university is optional — proceed without it */
    }
    university = university || '';
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
    // Past events are historical/stable, so cache the match by query (Redis-first,
    // 10-min TTL). Only a non-empty result is cached so a transient miss isn't sticky.
    const cacheKey = `agent:similarpast:${createHash('sha1').update(`${query}|${count}`).digest('hex')}`;
    const cached = await cacheGetJson(cacheKey);
    if (cached != null) return cached;
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
    const result = { count: rows.length, semantic: true, events: rows };
    if (rows.length) await cacheSetJson(cacheKey, result, 600);
    return result;
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
    // Owners, accepted co-organisers AND admins can edit (mirrors the update_event RPC's
    // can_manage_event check — host OR co-organiser OR admin).
    const canEdit = ev.hostId === ctx.userId || ev.isCoOrganiser || String(ctx.role || '').toLowerCase() === 'admin';
    if (!canEdit) return { error: 'You can only edit events you host or co-organise.' };
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
    // Deliberately NOT cached: wallet balance/card is money-sensitive, so the agent
    // must always read it live (a stale balance could mislead a pledge suggestion).
    // The actual charge re-validates in create_pledge regardless.
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
      drafts = await listDrafts(ctx.supabase, ctx.userId); // shared cache: data:drafts:u:<id>
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
      // Before the catch-all: a full event used to fall through to "you already hold tickets",
      // which is simply untrue for someone who has never bought any.
      if (isSoldOut(seen)) return { error: `"${seen.title}" is at full capacity — every ticket has been taken, so none can be bought. Tell the user, and do NOT propose a purchase.` };
      return { error: 'You already hold tickets for this event — give them away before buying again.' };
    }
    const qty = Math.max(1, Math.floor(Number(args.qty ?? 1)) || 1);
    // Capacity was previously enforced ONLY by the create_pledge RPC, so the agent would build
    // a complete proposal ("8 tickets ... $88.00") and only fail on confirm with "Not enough
    // tickets are available". Refuse here instead; the RPC stays the atomic authority.
    const spotsLeft = spotsLeftFor(ev);
    if (Number(ev.maxCapacity ?? 0) > 0 && qty > spotsLeft) {
      return { error: `Only ${spotsLeft} ticket${spotsLeft === 1 ? '' : 's'} ${spotsLeft === 1 ? 'is' : 'are'} left for "${ev.title}", so ${qty} cannot be bought. Offer them ${spotsLeft} instead.` };
    }
    const price = currentPrice(ev);
    const total = price * qty;
    const method = args.paymentMethod === 'card' ? 'card' : 'wallet';
    // One idempotency key per proposal, reused on execute so a confirm-retry never double-charges.
    const attemptId = randomUUID();
    const base = {
      id: `pledge:${ev.id}:${Date.now()}`,
      action: 'pledge',
      eventId: ev.id,
      title: ev.title,
    };
    const { data: me } = await ctx.supabase
      .from('USER')
      .select('walletBalance, cardLast4, cardBrand, stripePaymentMethodId')
      .eq('id', ctx.userId)
      .single();

    if (method === 'card') {
      // Card charges the linked card off-session at execute time; require one now.
      if (!me?.stripePaymentMethodId || !me?.cardLast4) {
        return { error: 'No card is linked. Ask them to link a card in Wallet before paying by card, or offer to pay with their wallet instead.' };
      }
      return {
        proposal: {
          ...base,
          summary: `Buy ${qty} ticket${qty > 1 ? 's' : ''} to "${ev.title}" with your ${me.cardBrand || 'card'} ending ${me.cardLast4} — $${total.toFixed(2)} (${qty} × $${price.toFixed(2)}).`,
          payload: { qty, paymentMethod: 'card', attemptId },
        },
      };
    }

    // Wallet: pre-check the balance; if short, guide a card top-up (or paying by card) first.
    const balance = Number(me?.walletBalance ?? 0);
    if (total > balance) {
      const shortfall = (total - balance).toFixed(2);
      const cardNote = me?.cardLast4
        ? `Offer to top up $${shortfall} (or more) into the wallet by charging their card ending ${me.cardLast4} (propose_topup), or to pay for this purchase by card instead, then pledge.`
        : `No card is linked — ask them to link a card in Wallet before buying.`;
      return { error: `Wallet balance is $${balance.toFixed(2)}, which is $${shortfall} short of the $${total.toFixed(2)} for ${qty} ticket${qty > 1 ? 's' : ''}. ${cardNote}` };
    }
    return {
      proposal: {
        ...base,
        summary: `Buy ${qty} ticket${qty > 1 ? 's' : ''} to "${ev.title}" with your wallet — $${total.toFixed(2)} (${qty} × $${price.toFixed(2)}). Wallet $${balance.toFixed(2)} → $${(balance - total).toFixed(2)} after.`,
        payload: { qty, paymentMethod: 'wallet', attemptId },
      },
    };
  },

  async propose_cancel_event(args, ctx) {
    const resolved = await resolveEvent(ctx, await visibleEvents(ctx), args.eventId);
    if (resolved.ambiguous) return ambiguousEvent(resolved.ambiguous);
    const ev = resolved.event;
    if (!ev) return { error: 'Event not found or not visible to you.' };
    const isAdmin = String(ctx.role || '').toLowerCase() === 'admin';
    const isHost = ev.hostId === ctx.userId;
    if (!isHost && !isAdmin) return { error: 'You can only cancel events you host.' };
    if (ev.status === 'cancelled' || ev.status === 'completed') return { error: 'This event can no longer be cancelled.' };
    const reason = String(args.reason ?? '').trim();
    // Admins moderating another organiser's event MUST supply a reason.
    if (isAdmin && !isHost && reason.length < 1) {
      return { error: 'A reason is required to delete this event. Ask the admin for a short reason (any text is fine), then propose again.' };
    }
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
