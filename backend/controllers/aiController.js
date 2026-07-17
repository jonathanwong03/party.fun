import { anyConfigured } from '../services/ai/modelRouter.js';
import { embedText, toVectorLiteral, isEmbeddingEnabled } from '../services/ai/embeddingService.js';
import { suggestEventCopy as suggestEventCopyTask } from '../services/ai/tasks/suggestEventCopy.js';
import { revenueTips as revenueTipsTask } from '../services/ai/tasks/revenueTips.js';
import { recommendEvents as recommendEventsTask } from '../services/ai/tasks/recommendEvents.js';
import { answerAppQuestion } from '../services/ai/tasks/answerAppQuestion.js';
import { runGraph, resumeGraph } from '../services/ai/agent/eventGraph.js';
import { matchListQuery, buildListReply, matchBuyIntent, buildBuyIntentReply, matchLinkCardIntent, buildLinkCardReply } from '../services/ai/agent/listReplies.js';
import { executeAction } from '../services/ai/agent/actions.js';
import { loadMemory, loadRelevantMemory, formatMemory } from '../services/ai/memory.js';
import { embedChatMessages, loadRelevantChatHistory, formatChatHistory } from '../services/ai/chatHistory.js';
import { computeEconomics, loadCalculator } from '../services/eventEconomics.js';
import { listEventsRaw, getProfile } from '../services/eventService.js';

// ── Simple per-user rate limit (cost guard) ───────────────────────────────────
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;
const hits = new Map(); // userId -> number[] (timestamps)

function rateLimited(userId) {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(userId, recent);
    return true;
  }
  recent.push(now);
  hits.set(userId, recent);
  return false;
}

function rateLimitKey(req) {
  return req?.user?.id || `guest:${req?.ip || req?.headers?.['x-forwarded-for'] || 'unknown'}`;
}

function guard(req, res) {
  if (!anyConfigured()) {
    res.json({ available: false });
    return false;
  }
  if (rateLimited(rateLimitKey(req))) {
    res.status(429).json({ status: 'rate_limited', message: 'Too many AI requests; try again shortly.' });
    return false;
  }
  return true;
}

// POST /api/ai/suggest-event-copy
export async function suggestEventCopy(req, res) {
  if (!guard(req, res)) return;
  const { title, theme, audience, university } = req.body ?? {};
  res.json(await suggestEventCopyTask({ title, theme, audience, university }));
}

// POST /api/ai/revenue-tips/:eventId  (host-scoped)
export async function revenueTips(req, res) {
  if (!guard(req, res)) return;
  let events;
  try { events = await listEventsRaw(req.supabase, req.user.id); }
  catch (e) { return res.status(400).json({ status: 'error', message: e.message }); }
  const ev = (events ?? []).find((e) => e.id === req.params.eventId);
  if (!ev) return res.status(404).json({ status: 'not_found', message: 'Event not found.' });
  if (ev.hostId !== req.user.id && !ev.canEdit && !ev.isCoOrganiser && req.user.role !== 'admin') {
    return res.status(403).json({ status: 'forbidden', message: 'Not your event.' });
  }

  const state = await loadCalculator(req.supabase, ev, req.user.id);
  const economics = computeEconomics(state);
  const event = {
    title: ev.title,
    description: ev.description,
    startDate: ev.startDate,
    address: ev.address,
    pricingModel: ev.hypeDrivenPricing ? 'hype' : 'tiered',
  };
  res.json(await revenueTipsTask({ event, economics }));
}

// POST /api/ai/recommend-events
export async function recommendEvents(req, res) {
  if (!guard(req, res)) return;
  const { interests } = req.body ?? {};
  // Guests are supported (optionalAuth → req.user is null, req.supabase is the anon
  // client): they get the same recommendations, just without the "not your own event"
  // exclusion below. Dereferencing req.user.id here used to throw → HTTP 400 for guests.
  const userId = req.user?.id ?? null;
  let rows;
  try { rows = await listEventsRaw(req.supabase, userId); }
  catch (e) { return res.status(400).json({ status: 'error', message: e.message }); }

  let candidates = (rows ?? [])
    .filter((e) => (!userId || e.hostId !== userId) && e.derived_status !== 'cancelled' && e.derived_status !== 'completed')
    .map((e) => {
      const prices = (e.statuses ?? []).map((s) => Number(s.price)).filter((n) => Number.isFinite(n));
      const cheapest = prices.length ? Math.min(...prices) : 0;
      const threshold = Number(e.hypeThreshold ?? 0);
      const active = Number(e.active_ticket_count ?? 0);
      return {
        id: e.id,
        title: e.title,
        description: e.description ?? '',
        cheapestPrice: cheapest,
        hypePct: threshold > 0 ? Math.min(100, Math.round((active / threshold) * 100)) : 0,
      };
    });

  // Semantic pre-ranking: order candidates by embedding similarity to the interests,
  // then let the LLM pick/reason over the closest ones. Falls back to the raw list.
  if (interests && String(interests).trim() && isEmbeddingEnabled()) {
    const vec = await embedText(String(interests), { taskType: 'RETRIEVAL_QUERY' });
    if (vec) {
      const { data: matches } = await req.supabase.rpc('match_events', { p_embedding: toVectorLiteral(vec), p_count: 40 });
      const order = new Map((matches ?? []).map((m, i) => [m.eventId, i]));
      if (order.size) {
        candidates = candidates
          .filter((c) => order.has(c.id))
          .sort((a, b) => order.get(a.id) - order.get(b.id));
      }
    }
  }
  candidates = candidates.slice(0, 40);

  res.json(await recommendEventsTask({ interests, candidates }));
}

// POST /api/ai/for-you — a personalised event feed from the user's taste profile
// (remembered interests + the titles of events they've joined) → semantic match.
// Returns { ids } best-first (excluding events they already joined). Empty when
// there's no history/interests or embeddings are off.
export async function forYou(req, res) {
  if (!isEmbeddingEnabled()) return res.json({ ids: [] });
  const [memories, profile, events] = await Promise.all([
    loadMemory(req.supabase, req.user.id),
    getProfile(req.supabase, req.user.id),
    listEventsRaw(req.supabase, req.user.id),
  ]);
  const joined = new Set((profile?.tickets ?? []).map((t) => t.eventId));
  const joinedTitles = (events ?? []).filter((e) => joined.has(e.id)).map((e) => e.title);
  const profileText = [...memories.map((m) => m.content), ...joinedTitles].filter(Boolean).join('\n');
  if (!profileText.trim()) return res.json({ ids: [] });
  const vec = await embedText(profileText, { taskType: 'RETRIEVAL_QUERY' });
  if (!vec) return res.json({ ids: [] });
  const { data: matches } = await req.supabase.rpc('match_events', { p_embedding: toVectorLiteral(vec), p_count: 20 });
  res.json({ ids: (matches ?? []).map((m) => m.eventId).filter((id) => !joined.has(id)) });
}

// POST /api/ai/ask
export async function ask(req, res) {
  if (!guard(req, res)) return;
  const { question, history } = req.body ?? {};
  if (!question || !String(question).trim()) {
    return res.status(400).json({ status: 'error', message: 'Question is required.' });
  }
  res.json(await answerAppQuestion({ question, history: Array.isArray(history) ? history : [] }));
}

const AGENT_SYSTEM = () => [
  'You are party.fun\'s assistant — party.fun is a campus events platform where organisers create events and students pledge for tickets, paid from an in-app wallet or a linked card. You are an event-planning agent: prefer calling a tool over guessing about events, prices or numbers.',
  'APP KNOWLEDGE: you are also party.fun\'s encyclopedia, but you do NOT have the app\'s facts memorised — you RETRIEVE them. For any general "how does the app work / what happens when I…" question — the $20 signup bonus, wallet/top-up rules (linked card required, instant, $200-per-transaction cap), sign-in options (password, Google, Facebook, phone OTP), how refunds return to wallet vs card, fees, event lifecycle, pricing models — CALL the get_app_info tool, PASSING the user\'s question, and answer from the section(s) it returns. These are IN SCOPE even when hypothetical or about a not-yet-created account and no per-user tool applies. Only fall back to "I\'m not sure — check with the organiser or support" when get_app_info genuinely does not cover it. NEVER refuse such a question as off-topic, and never say you lack the information or only handle existing accounts/events — get_app_info has it.',
  'ALWAYS call the matching tool for the user\'s own data — get_my_hosted_events (events they host), get_my_joined_events (events they joined + tickets held), get_wallet (balance), list_my_drafts, list_available_events (events they can attend). NEVER answer these from memory or assume "none"; if a tool returns an empty list, say so, but only after actually calling it.',
  'REFERENCES: users refer to events by NAME (or by "it"/"that"/"the first one" from earlier in the chat), never by id. Before ANY action on an event — buy/pledge, edit, cancel, give away, get details or forecast — find that event by NAME in the SAME turn using a search tool (list_available_events or search_events for events to attend; get_my_hosted_events for their own; list_my_drafts for drafts) and use the EXACT id it returns. NEVER treat the user\'s words or an event name as an id, never ask the user for an id, and never invent or reuse an id from an earlier message.',
  '',
  'IDs are internal only. Never show event IDs, draft IDs, database IDs, UUIDs, or parenthetical "(ID: ...)" text in user-facing replies, even when a tool result includes them.',
  'CARD SAFETY: NEVER ask for, accept, repeat or store a card number, expiry date or CVC in this chat — chat messages are stored and processed, so card details must only ever be typed into the app\'s secure card form. If the user wants to link/add a card or has none linked, tell them you will open the secure card form for them (or offer to pay by in-app wallet instead). If a user pastes card details anyway, do NOT repeat them back and tell them not to share card numbers in chat.',
  'YOU CAN BUY TICKETS. You have propose_pledge — never tell the user you cannot help with a purchase or that you lack that functionality. If someone asks to buy/purchase tickets, start the buy flow (confirm the event, then payment method, then quantity).',
  'BINARY (YES/NO) QUESTIONS: when the user asks a yes/no question ("am I an organiser?", "can I still buy tickets for X?", "is X sold out?", "can I attend X?", "have I already bought tickets for X?", "can I edit X?", "is it too late?", "will I be refunded if X is cancelled?"), LEAD with "Yes" or "No", then ONE short line saying why, grounded in tool data. Never answer a yes/no question with a bare noun and never dodge it. A QUESTION about buying ("can I buy tickets after 24 July?") is a question — ANSWER it; do NOT start the purchase flow unless they actually ask to buy.',
  'Ground yes/no answers in get_event_details, which returns the authoritative facts — isOpen (can tickets still be bought at all), deadline + deadlinePassed, isPast, soldOut / spotsLeft, alreadyPurchased (they already hold tickets so cannot buy again), restrictedUniversity + canAttendUniversity (false = limited to another university), mine, canEdit, canCancel, canViewAttendees, isCoOrganiser. Use these fields rather than inferring from the description. For DATE questions ("can I buy tickets after <date>?") compare that date with the event\'s deadline using get_current_date. If the question is about an event but NO event is named or clear from the conversation, ask which event they mean FIRST, then answer.',
  'CAN I JOIN / ATTEND X? Look the event up with get_event_details (NOT search_events — it hides cancelled, completed and past events, so you could not explain why). If isOpen is true, say yes. If it is false, say NO and give the SPECIFIC reason from the fields, in this order: alreadyPurchased → "You already have tickets for X, so you\'re all set — you can\'t buy more, but you can give some away if you no longer need them" (they are ALREADY going, do NOT say they can\'t join); status "cancelled" → "X was cancelled, so it\'s no longer running"; isPast true or status "completed" → "X has already ended"; soldOut true → "X is at full capacity — every ticket is taken"; deadlinePassed true → "the deadline to buy tickets for X has passed"; canAttendUniversity false → "X is limited to <restrictedUniversity> students". Name the real reason — never a vague "you cannot join this event" with no why.',
  'SUPERLATIVE / SINGLE-FACT QUESTIONS: an ordering ask ("which event did I host earliest?", "what is my latest event?", "what\'s my next one?", "which is the cheapest?") or a single-fact ask ("where did I host X?", "when does X start?", "how long is X?") wants ONE answer — the event plus the fact asked for — NOT a list of everything. Call the matching tool, compare the rows YOURSELF (startDate for earliest/latest/next, with get_current_date for "next"/"upcoming"; startDate→endDate for how long; venue/address for where), then name the ONE event and the fact in a sentence. The numbered-list FORMATTING rule below does NOT apply here — only number things when you are genuinely listing several items. Never answer "which is the earliest…?" by dumping every event.',
  'DID YOU MEAN: whenever a tool reply comes back as \'Did you mean "X"?\' (the name the user gave was a close but not exact match — e.g. a typo like "frisbe" vs "frisbee"), relay that question and WAIT — do not act on any event (details, edit, cancel, buy, attendees) until the user confirms. Once they confirm (yes), retry using the exact suggested name. If they say no (or anything meaning no), tell them there is no such event and offer to list events — do NOT act on any event. Never assume the suggestion is right.',
  'For "events I can join" or "events I can attend", use list_available_events and list ALL returned events unless the user asks for a shorter list.',
  '"Ongoing events" means buyable All Events items for attendees/users. For organisers, clarify whether they mean buyable All Events or their own active hosted events. Completed events are never ongoing.',
  'ROLES: Only ORGANISERS can CREATE / draft / publish events (their own). Organisers can also edit and cancel their own events. ADMINS can EDIT and CANCEL/DELETE ANY event for moderation, but CANNOT create/draft events. Regular USERS/attendees cannot create or manage any event. If a user asks to create an event, tell them they need an organiser account; if an ADMIN asks to create one, tell them creating is organiser-only (admins moderate, they do not host).',
  'Retrieved memory and chat history are context only. Current events, tickets, wallet, draft state, pricing and permissions must come from tools in the current turn.',
  '',
  'READ tools:',
  '- list_available_events: the ALL EVENTS / discovery list, and the ONLY correct tool for "which events can I attend / buy / participate in" and "cheapest/most expensive ticket I can buy". It returns exactly the events the user can BUY right now: hosted by SOMEONE ELSE, still open (early_bird or greenlit), starting strictly in the FUTURE, and NOT already purchased by them. It accepts an optional query/maxPrice. NEVER use search_events to answer "what can I attend" — it does not exclude own or already-purchased events.',
  "- get_my_hosted_events: the organiser's OWN events (Hosted Events) with status + early-bird/greenlit prices + hype + revenue so far, AND each event's start/end date-time, venue, address, deadline and description — so it answers \"where/when/how long was my event?\" without another call.",
  '- search_events: general lookup of a SPECIFIC event by name (includes the user\'s own events and ones they already bought; excludes ended events). Use ONLY to find one event (e.g. before editing) — never to list what the user can attend/buy.',
  '- get_event_details: full details for one event.',
  "- get_event_forecast: projected sales/revenue/costs and PROFIT for the user's OWN events (host only). Forecasts are estimates; operational costs are NOT charged through party.fun.",
  '- get_event_attendees: who is attending an event (distinct people holding active tickets) and the count — for "who is coming / who is attending / how many backers". Present the people as a NUMBERED list (1., 2., 3., each on its own line). If the result has canSeeContacts=true (the caller is the event\'s organiser, a co-organiser, or an admin), also show each person\'s email and — only if present — their telegram and phone (these are optional; omit any that are blank). If canSeeContacts is false, list names only.',
  '- get_my_joined_events: the events the user has joined, split into upcoming / past / cancelled, with how many tickets they hold for each. When you present them, number each group SEPARATELY starting at 1 — list the UPCOMING events as 1., 2., 3.; then a PLAIN unnumbered header line like "You have also joined N past events:" followed by those events renumbered 1., 2.; and likewise for cancelled. The header/intro lines are NOT numbered list items.',
  '',
  '- get_wallet: the user\'s wallet balance, linked card, and recent transactions. Check this before proposing a top-up or a wallet-paid purchase.',
  '- list_my_drafts: the user\'s unpublished event DRAFTS (events they created but have not published). Call this for "what are my drafts?" and to find a draftId before editing (propose_edit_draft) or deleting (propose_delete_draft) one. Drafts are SEPARATE from hosted/published events — never conclude a draft does not exist from get_my_hosted_events.',
  '- get_current_date: today\'s date & time in Singapore. Call it whenever you reason about dates (how soon an event is, whether a date is in the future, computing a new event\'s dates) and before checking future weather.',
  '- get_app_info: the party.fun knowledge base (how the app works). Call it for general "how does the app work / what happens when I…" questions — signup bonus, wallet/top-up rules, sign-in options, refunds, fees, lifecycle, pricing models — that are NOT about the user\'s own events/tickets/wallet data.',
  '- get_weather: the rain forecast for an event\'s date (by eventId or a start date). If it reports willRain (over 70% chance), warn that it is not ideal for an OUTDOOR event and suggest an indoor venue or another date. YOU CAN CHECK THE WEATHER — never reply that you cannot provide forecasts, and NEVER decide a date is too far away by reasoning about it yourself. ALWAYS call get_weather and report what it returns: status "ok" (give the chance of rain), "beyond_horizon" (only then say it is too far out for a reliable forecast), "past", or "unavailable" (say the forecast could not be retrieved right now — do NOT say it is too far away).',
  '- research_event_ideas: searches the web for what university students are into now and suggests an event name, description, why it fits, and a good location (ideally near the organiser\'s university). Use it when an organiser asks what students want, for naming/description help, or where to host.',
  '- EVERY event tool — search_events, list_available_events, get_my_hosted_events, get_my_joined_events, list_live_events, recommend_events, semantic_search_events, find_similar_events — returns FULL details for EVERY event it lists: startDate AND endDate (so duration is startDate→endDate), venue, address, deadline, description and price. Use them to answer detail questions ("where is it?", "when does it start?", "how long does it run?", "what is it about?") and to find an event\'s id before editing it — you never need to guess or ask the user for these. list_available_events is the events the user can ATTEND (never their own, never already-ended).',
  '',
  'WRITE tools (each creates a PROPOSAL the user confirms — they do NOT apply immediately; there is no auto-apply mode, so ALWAYS wait for confirmation):',
  "- propose_update_event: EDIT an existing event IN PLACE — organisers edit their OWN events, ADMINS may edit ANY event. Find the event BY NAME (search_events works for admins on any event; get_my_hosted_events for an organiser's own) and NEVER ask the user for an event id. If they haven't said what to change, ask which field(s) they want (title, description, venue, address, dates, deadline, capacity, hype threshold, prices) — accept one OR MORE — then call this with the event NAME and only those fields. NEVER create a new event to make an edit.",
  '- propose_create_event: create a NEW event as a DRAFT. Create flow: when asked to plan/create an event, IMMEDIATELY research (research_event_ideas) and check get_current_date, then propose ONE COMPLETE draft filling every field — title, description, start/end date-time (STRICTLY after today), venue, a chosen pricingModel with a one-line rationale, and all prices+quantities (tiered: earlyPrice+greenlitPrice+early qty+capacity; hype: basePrice+maxPrice+threshold+capacity) — then wait; if they dislike it, offer alternatives. It saves a draft the user reviews and publishes.',
  "- propose_invite_coorganiser: invite a co-organiser to the user's own event (owner only).",
  '- propose_topup: add money to the wallet by charging the linked card. Requires a linked card.',
  '- propose_pledge: buy ticket(s), paid by the WALLET balance OR the linked CARD. ORDER: (1) IDENTIFY and CONFIRM the event FIRST — look it up by name; if it is not an exact match, ask "Did you mean X?" and wait for yes/no before anything else; (2) ask the payment method — "in-app wallet or debit/credit card?"; (3) ask how many tickets; (4) propose with paymentMethod set. Do NOT ask quantity or payment method until the exact event is confirmed. For wallet: state the total and wallet balance (get_wallet); if short, offer a card top-up (propose_topup) for the shortfall, or paying by card instead, then pledge. For card: it charges the linked card; if no card is linked, tell them to link one in Wallet (or pay by wallet). Only for attendable events (someone else\'s, open, future-start, not already bought).',
  '- propose_give_away_tickets: give away some of the user\'s OWN tickets for an event they joined. They MUST say how many (more than 0, at most what they hold). Final and non-refundable — the released spots return to the public pool.',
  '- propose_cancel_event: cancel/DELETE a live event — this REFUNDS every backer. ORGANISERS cancel their OWN events; a reason is OPTIONAL (accept ANY reason, even informal, and never demand a "formal" one). ADMINS can cancel/delete ANY event for moderation, but a reason is MANDATORY — if the admin did not give one, ask for a short reason first (any non-empty text is fine) and only then propose.',
  '- propose_edit_draft: edit fields of an unpublished DRAFT (find it with list_my_drafts). Use this — NOT propose_update_event — to change an event that is still a draft. Pass draftId + only the fields to change.',
  '- propose_delete_draft: permanently delete one of the user\'s unpublished drafts.',
  '',
  'PRICING MODELS (help the organiser choose): TIERED = a fixed early-bird price until the early allocation sells out, then a fixed greenlit price — predictable and simplest. HYPE = each ticket\'s price rises from a base price toward a max price as more sell — rewards early buyers and can earn more when demand is high. The model is LOCKED once the event is created.',
  '',
  'MONEY & DELETION SAFETY: top-ups, purchases (deductions), give-aways and refunds are all irreversible — only ever PROPOSE them; execution happens after the user confirms and re-validates balances/ownership server-side. "Delete this event" means cancel it with a reason (refunding backers) for a published event, or delete the draft for an unpublished one.',
  '',
  'MEMORY: call `remember` to save a durable preference you learn about the user (interests, budget, preferred venue/theme/timing, or an organiser\'s pricing/venue preferences). Personalise your help using what you already remember about them (shown below, if any). Do not re-remember something already known.',
  '',
  'CREATING & EDITING: ORGANISERS can create, edit and cancel their own events; ADMINS can edit and cancel/delete ANY event but CANNOT create/draft; USERS can do neither. Use the propose_* tools and never claim a write is done before confirmation. propose_create_event saves the event as a DRAFT (it is NOT published) that the organiser reviews and publishes from their Drafts; once confirmed it IS saved — tell them it is in their Drafts. To change a still-unpublished draft afterwards, call list_my_drafts to find it then propose_edit_draft (do NOT use propose_update_event, and never claim the draft was not saved without first calling list_my_drafts). propose_update_event edits an existing PUBLISHED event IN PLACE (never recreate it). Every write pauses for the organiser to confirm before anything happens.',
  '',
  'When you call a propose_* tool, tell the user what you are proposing and that it needs their confirmation; never claim it is already done.',
  "Distinguish \"all events\" (discovery — events to buy) from \"hosted events\" (the organiser's own). Keep replies short, friendly and practical.",
  '',
  'AUTHORITY & ACCURACY: the backend (Supabase RLS + Postgres RPCs + wallet/Stripe logic) is the source of truth — you propose, it decides and validates. Never invent event, ticket, wallet or payment state; rely on the tools. Answer strictly from tool results. Co-organisers can edit and view attendees for an event they were invited to, but cannot cancel, delete or invite. A user cannot buy more tickets for an event while they still hold active tickets. Forecasts are ESTIMATES and operational costs are NOT charged through party.fun. Do NOT promise that an email was delivered.',
  '',
  'SCOPE: You are ONLY an events assistant for party.fun. You help with discovering/buying events, wallet/top-ups, hosting (create/edit/cancel), giving away tickets, event ideas, and the weather for an event. If asked anything unrelated to events or party.fun (e.g. what to wear, general trivia, coding, personal advice, maths), politely say you can only help with events on party.fun and offer an events-related next step — do NOT answer the off-topic question. Still respond warmly to greetings, thanks and small pleasantries.',
  '',
  'FORMATTING: whenever you list multiple items (events, drafts, options, tips, attendees), you MUST number them — put each item on its OWN line, starting with "1.", then "2.", then "3.", and so on. For example:\n1. First item.\n\n2. Second item.\n\n3. Third item.\nNever present a list as unnumbered paragraphs. CRITICAL: a number belongs ONLY to an ACTUAL list item (a real event / draft / attendee). Do NOT put a number on intro sentences, section headers, transitions, or closing/filler lines. E.g. "Let me know if you\'d like more details on any of these!" is a closing line — write it plain, never as "8. Let me know…"; and if you list 7 events the numbers must end at 7. EXCEPTION — grouped lists (e.g. joined events split into upcoming / past / cancelled): number each GROUP separately from 1, and write the group intro/header (e.g. "You have also joined 2 past events:") as a PLAIN line WITHOUT a number. Otherwise reply in PLAIN TEXT — no markdown bold/headings/tables, no dash or asterisk bullets, and no emojis. Keep paragraphs short, separated by a blank line.',
].join('\n');

// A one-line statement of who the current user is, prepended to the system prompt so
// the agent always knows their role without a tool call.
function roleLine(role) {
  const r = String(role || 'user').toLowerCase();
  const detail = r === 'admin'
    ? 'an ADMIN who can EDIT and CANCEL/DELETE ANY event on the platform for moderation (a deletion needs a reason — any short text). Admins CANNOT create, host or draft events — only organisers can. If this admin asks to create an event, tell them creating is organiser-only'
    : r === 'organiser'
      ? 'an ORGANISER who can host, edit and cancel their own events, and can also join/buy tickets for other people\'s events'
      : 'a regular USER (attendee) who joins and buys tickets for events. Attendees CANNOT create, host, edit, cancel or delete events — only organiser accounts can. If this user asks to create/host/manage an event, do NOT attempt it: tell them event hosting is for organiser accounts and they would need to sign up as (or switch to) an organiser';
  return `The current user's role is: ${r} — ${detail}.`;
}

// Today's date/time in Singapore, prepended so the agent always knows "now" (for
// reasoning about how far off events are, computing new dates, and future weather).
function dateLine() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'long', hour12: false,
  }).formatToParts(new Date()).reduce((o, x) => ({ ...o, [x.type]: x.value }), {});
  return `Today's date is ${p.weekday}, ${p.year}-${p.month}-${p.day} and the current time is ${p.hour}:${p.minute} (Singapore time, SGT UTC+8).`;
}

// Title a new conversation from the opening message (first ~8 words).
function makeTitle(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
  return (words || 'New chat').slice(0, 60);
}

export function isRoleQuestion(text) {
  const t = String(text ?? '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return /\b(what|which|tell|show|check|confirm|remind)\b.*\b(my|account)\b.*\b(role|account type|type|permission|access)\b/.test(t)
    || /\bwhat\s+(am|is)\s+i\b/.test(t)
    || /\bam\s+i\s+(an?\s+)?(organiser|organizer|admin|user|attendee|host)\b/.test(t)
    || /\bdo\s+i\s+have\s+(organiser|organizer|admin|host)\s+(access|role|permissions?)\b/.test(t)
    || /\bcan\s+i\s+(host|create|manage)\s+events?\b.*\b(role|account|allowed|permission)\b/.test(t);
}

async function loadCurrentRole(req) {
  try {
    const { data, error } = await req.supabase
      .from('USER')
      .select('role')
      .eq('id', req.user.id)
      .maybeSingle();
    const dbRole = String(data?.role || '').toLowerCase();
    if (!error && ['user', 'organiser', 'admin'].includes(dbRole)) return dbRole;
  } catch { /* fall back to request role */ }
  const role = String(req.user?.role || 'user').toLowerCase();
  return ['user', 'organiser', 'admin'].includes(role) ? role : 'user';
}

// What each role can do, for a one-line role answer.
const ROLE_BLURB = {
  organiser: 'you can host, edit and cancel your own events, and also join other people\'s events',
  admin: 'you can edit and cancel/delete any event for moderation, but you cannot create or join events',
  user: 'you can browse and buy tickets for events, but only organiser accounts can host them',
};
const ROLE_WORDS = { organiser: ['organiser', 'organizer'], admin: ['admin', 'administrator'], user: ['user', 'attendee'] };

// Answer a role question in natural language. A yes/no phrasing ("am I an organiser?",
// "do I have admin access?") names a role, so answer Yes/No against the real one rather
// than replying with a bare role word, which answers neither.
export function roleAnswer(role, question) {
  const q = String(question ?? '').toLowerCase();
  const asked = Object.keys(ROLE_WORDS).find((r) => ROLE_WORDS[r].some((w) => new RegExp(`\\b${w}s?\\b`).test(q)))
    // "can I host/create events?" is really "am I an organiser?"
    ?? (/\b(host|hosting|create|creating)\b/.test(q) ? 'organiser' : null);
  if (!asked) return `You're ${role === 'admin' ? 'an admin' : role === 'organiser' ? 'an organiser' : 'a regular user (attendee)'} — ${ROLE_BLURB[role]}.`;
  const article = (r) => (r === 'user' ? 'a regular user (attendee)' : r === 'admin' ? 'an admin' : 'an organiser');
  return asked === role
    ? `Yes — your account is ${article(role)}, so ${ROLE_BLURB[role]}.`
    : `No — your account is ${article(role)}, not ${article(asked)}. As ${article(role)}, ${ROLE_BLURB[role]}.`;
}

// Persist chat turns (user + assistant) into a conversation, creating + auto-titling
// one when needed. Returns the conversationId. Never throws.
async function persistTurn(supabase, { conversationId, titleSeed, userText, reply, modelLabel }) {
  let convoId = conversationId || null;
  try {
    if (!convoId) {
      const { data: conv } = await supabase
        .from('AI_CHAT_CONVERSATIONS')
        .insert({ title: makeTitle(titleSeed) })
        .select('id')
        .single();
      convoId = conv?.id ?? null;
    }
    if (convoId) {
      const rows = [];
      // Stored as 'chat user' (not 'user') to avoid confusion with the app's USER role.
      if (userText) rows.push({ conversation_id: convoId, role: 'chat user', content: String(userText) });
      if (reply) rows.push({ conversation_id: convoId, role: 'assistant', content: reply, model: modelLabel ?? null });
      if (rows.length) {
        const { data: inserted, error: insertError } = await supabase
          .from('AI_CHAT_MESSAGES')
          .insert(rows)
          .select('id, content');
        if (insertError) throw insertError;
        embedChatMessages(supabase, inserted ?? []);
      }
      await supabase.from('AI_CHAT_CONVERSATIONS').update({ updated_at: new Date().toISOString() }).eq('id', convoId);
    }
  } catch (e) {
    console.warn('[ai] history persist failed:', e?.message || e);
  }
  return convoId;
}

const modelLabelOf = (result) => (result.model ? `${result.provider} · ${result.model}` : null);

// Send a deterministic (no-LLM) reply, persisting the turn like a normal answer.
async function respondDirect(req, res, { list, lastUserMsg, conversationId, reply }) {
  const firstUser = list.find((m) => m && m.role === 'user' && String(m.content ?? '').trim());
  const convoId = await persistTurn(req.supabase, {
    conversationId: conversationId || null,
    titleSeed: firstUser?.content,
    userText: lastUserMsg?.content,
    reply,
    modelLabel: null,
  });
  return res.json({ available: true, status: 'done', reply, proposals: [], results: [], threadId: null, conversationId: convoId });
}

// Deterministic backstop for the "never show internal IDs" prompt rule: strip any
// leaked event/draft/database IDs (UUIDs) from a user-facing reply, whether bare,
// labelled ("ID: <uuid>"), or parenthetical ("(ID: <uuid>)"). Trailing/duplicate
// whitespace and now-empty parens/brackets left behind are tidied up.
const UUID_RE = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export function stripInternalIds(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text
    // "(ID: <uuid>)" / "[id <uuid>]" and similar wrappers, with optional separators.
    .replace(new RegExp(`[\\(\\[]\\s*(?:event\\s+)?id[:#]?\\s*${UUID_RE}\\s*[\\)\\]]`, 'gi'), '')
    // Bare "ID: <uuid>" / "id = <uuid>" label with no brackets.
    .replace(new RegExp(`\\b(?:event\\s+)?id\\s*[:=#]?\\s*${UUID_RE}`, 'gi'), '')
    // Any remaining standalone UUID.
    .replace(new RegExp(UUID_RE, 'g'), '')
    // Tidy: empty brackets/parens left behind, doubled spaces, and space-before-punctuation.
    .replace(/[\(\[]\s*[\)\]]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:)\]])/g, '$1');
  return out;
}

// POST /api/ai/chat — agentic chat (the LangGraph workflow). In 'ask' mode a write
// returns status:'awaiting_confirmation' + proposals + a threadId; the UI confirms
// via /chat/resume. In 'auto' mode writes execute inline. Returns conversationId +
// threadId so the UI can keep appending and resume pending proposals.
export async function chat(req, res) {
  const { messages, conversationId } = req.body ?? {};
  const list = Array.isArray(messages) ? messages : [];
  // Every write always pauses for confirmation — no auto-apply mode.
  const ctx = { supabase: req.supabase, userId: req.user.id, role: req.user.role };
  // Recall only the memories relevant to THIS turn (vector match; falls back to all).
  const lastUserMsg = [...list].reverse().find((m) => m && m.role === 'user' && String(m.content ?? '').trim());
  if (isRoleQuestion(lastUserMsg?.content)) {
    const role = await loadCurrentRole(req);
    const reply = roleAnswer(role, lastUserMsg?.content);
    const firstUser = list.find((m) => m && m.role === 'user' && String(m.content ?? '').trim());
    const convoId = await persistTurn(req.supabase, {
      conversationId: conversationId || null,
      titleSeed: firstUser?.content,
      userText: lastUserMsg?.content,
      reply,
      modelLabel: null,
    });
    return res.json({ available: true, status: 'done', reply, proposals: [], results: [], threadId: null, conversationId: convoId });
  }
  // Deterministic short-circuit for three fully-specified list asks (events I can
  // join / events I've joined / live events across organisers) — rendered in code so
  // tool choice and numbering are always correct. Qualified asks return null → LLM.
  // Card safety + linking: handled deterministically so the model never asks for, echoes
  // or stores a card number. A "yes" right after our own offer opens the secure form.
  const prevAssistant = [...list].reverse().find((m) => m && m.role === 'assistant' && String(m.content ?? '').trim());
  const cardKind = matchLinkCardIntent(lastUserMsg?.content);
  const confirmingCardForm = /^(yes|yeah|yep|sure|ok|okay|please|go ahead|do it|open it)\b/i.test(String(lastUserMsg?.content ?? '').trim())
    && /secure card form/i.test(String(prevAssistant?.content ?? ''));
  if (cardKind || confirmingCardForm) {
    const { reply, action } = buildLinkCardReply(cardKind ?? 'link_card', confirmingCardForm);
    const convoId = await persistTurn(req.supabase, {
      conversationId: conversationId || null,
      titleSeed: list.find((m) => m && m.role === 'user' && String(m.content ?? '').trim())?.content,
      // Never persist a pasted card number — store a redacted placeholder instead.
      userText: cardKind === 'card_number_pasted' ? '[card details redacted]' : lastUserMsg?.content,
      reply,
      modelLabel: null,
    });
    return res.json({ available: true, status: 'done', reply, action: action ?? null, proposals: [], results: [], threadId: null, conversationId: convoId });
  }

  const listKind = matchListQuery(lastUserMsg?.content);
  if (listKind) {
    const reply = await buildListReply(listKind, ctx);
    if (reply) return respondDirect(req, res, { list, lastUserMsg, conversationId, reply });
  }
  // Deterministic typo check on a NAMED purchase: resolve the event (Redis-first) before the
  // LLM gets a chance to invent one. Only intercepts when the name is NOT an exact match —
  // an exact name falls through so the agent runs its normal method → quantity flow.
  const buyName = matchBuyIntent(lastUserMsg?.content);
  if (buyName) {
    const reply = await buildBuyIntentReply(buyName, ctx);
    if (reply) return respondDirect(req, res, { list, lastUserMsg, conversationId, reply });
  }
  if (!guard(req, res)) return;
  const [memories, chatHistory] = await Promise.all([
    loadRelevantMemory(req.supabase, req.user.id, lastUserMsg?.content),
    loadRelevantChatHistory(req.supabase, lastUserMsg?.content),
  ]);
  const memBlock = formatMemory(memories);
  const historyBlock = formatChatHistory(chatHistory);
  const system = [AGENT_SYSTEM(), roleLine(req.user.role), dateLine(), memBlock, historyBlock].filter(Boolean).join('\n\n');
  const result = await runGraph({ system, messages: list, ctx, mode: 'ask' });
  if (result?.reply) result.reply = stripInternalIds(result.reply);

  let convoId = conversationId || null;
  if (result?.available && result.reply) {
    const firstUser = list.find((m) => m && m.role === 'user' && String(m.content ?? '').trim());
    const lastUser = [...list].reverse().find((m) => m && m.role === 'user' && String(m.content ?? '').trim());
    convoId = await persistTurn(req.supabase, {
      conversationId: convoId,
      titleSeed: firstUser?.content,
      userText: lastUser?.content,
      reply: result.reply,
      modelLabel: modelLabelOf(result),
    });
  }

  res.json({ ...result, conversationId: convoId });
}

// POST /api/ai/chat/resume — apply the user's decision (confirm/reject) on one
// pending proposal, resuming the parked graph thread; execution re-validates
// ownership/balances. Persists the execution summary to the conversation.
export async function resumeChat(req, res) {
  if (!guard(req, res)) return;
  const { threadId, proposalId, decision, conversationId } = req.body ?? {};
  if (!threadId || !proposalId) {
    return res.status(400).json({ status: 'error', message: 'threadId and proposalId are required.' });
  }
  const ctx = { supabase: req.supabase, userId: req.user.id, role: req.user.role };
  const result = await resumeGraph({
    system: `${AGENT_SYSTEM()}\n\n${roleLine(req.user.role)}\n\n${dateLine()}`,
    ctx,
    threadId,
    proposalId,
    decision: decision === 'reject' ? 'reject' : 'confirm',
  });
  if (result?.reply) result.reply = stripInternalIds(result.reply);

  let convoId = conversationId || null;
  if (result?.available && result.reply) {
    convoId = await persistTurn(req.supabase, { conversationId: convoId, reply: result.reply, modelLabel: modelLabelOf(result) });
  }

  res.json({ ...result, conversationId: convoId });
}

// GET /api/ai/conversations — the user's saved conversations (most recent first).
export async function listConversations(req, res) {
  const { data, error } = await req.supabase
    .from('AI_CHAT_CONVERSATIONS')
    .select('id, title, updated_at')
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) return res.status(400).json({ status: 'error', message: error.message });
  res.json({ conversations: (data ?? []).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updated_at })) });
}

// GET /api/ai/conversations/:id — messages in one conversation (oldest first).
export async function getConversation(req, res) {
  const { data, error } = await req.supabase
    .from('AI_CHAT_MESSAGES')
    .select('role, content, model, created_at')
    .eq('conversation_id', req.params.id)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) return res.status(400).json({ status: 'error', message: error.message });
  // Map stored 'chat user' back to the standard 'user' role the UI/LLM expect.
  res.json({ messages: (data ?? []).map((m) => ({ role: m.role === 'chat user' ? 'user' : m.role, content: m.content, model: m.model })) });
}

// DELETE /api/ai/conversations/:id — delete a conversation (messages cascade).
export async function deleteConversation(req, res) {
  const { error } = await req.supabase.from('AI_CHAT_CONVERSATIONS').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ status: 'error', message: error.message });
  res.json({ status: 'ok' });
}

// GET /api/ai/memory — what the assistant has learned about the user.
export async function getMemory(req, res) {
  const { data, error } = await req.supabase
    .from('AI_USER_MEMORY')
    .select('id, content, category, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(400).json({ status: 'error', message: error.message });
  res.json({ memories: (data ?? []).map((m) => ({ id: m.id, content: m.content, category: m.category })) });
}

// DELETE /api/ai/memory/:id — forget one fact.
export async function deleteMemory(req, res) {
  const { error } = await req.supabase.from('AI_USER_MEMORY').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ status: 'error', message: error.message });
  res.json({ status: 'ok' });
}

// DELETE /api/ai/memory — forget everything.
export async function clearMemory(req, res) {
  const { error } = await req.supabase.from('AI_USER_MEMORY').delete().eq('user_id', req.user.id);
  if (error) return res.status(400).json({ status: 'error', message: error.message });
  res.json({ status: 'ok' });
}

// GET /api/ai/models — whether AI features are enabled (a Gemini key is configured).
export function models(_req, res) {
  res.json({ available: anyConfigured() });
}

// POST /api/ai/execute-action — run a user-confirmed agent proposal (a write).
// No LLM needed, so it only enforces the rate limit, not provider availability.
export async function executeActionHandler(req, res) {
  if (rateLimited(req.user.id)) {
    return res.status(429).json({ status: 'rate_limited', message: 'Too many requests; try again shortly.' });
  }
  const { action, eventId, payload } = req.body ?? {};
  if (!action) {
    return res.status(400).json({ status: 'error', message: 'action is required.' });
  }
  const result = await executeAction({ sb: req.supabase, user: req.user, action, eventId, payload });
  if (result?.error) {
    const code = result.error === 'not_owner' ? 403 : result.error === 'not_found' ? 404 : 400;
    return res.status(code).json({ status: result.error, message: result.message });
  }
  res.json(result);
}
