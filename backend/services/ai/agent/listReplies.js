// Deterministic short-circuit replies for four high-frequency, fully-specified
// list questions (events I can join / I've joined / I've hosted / live across organisers).
// gemini-flash occasionally mis-routes these ("events I can join" vs "events I've joined")
// or mis-numbers grouped lists, so instead of relying on the model we detect them with
// strict regexes and render the answer in code from the same cached executors the agent
// would use. Anything qualified — a price cap, a specific event name, a superlative or a
// request for one fact — returns null and falls through to the LLM graph.

import { EXECUTORS, resolveAttendableRef, resolveVisibleRef, whyNotAttendable } from './tools.js';
import { isBuyQuestion } from './buyIntent.js';

// A qualifier/price cap or a quoted specific-event name means the ask is NOT a plain
// list request — let the LLM handle it (it can apply the filter / resolve the name).
const HAS_QUALIFIER_RX = /(\bunder\b|\bbelow\b|\bover\b|\babove\b|\bcheaper\b|\bless than\b|\bmore than\b|\bat most\b|\bat least\b|\$\s?\d|\d+\s?(dollars|bucks))/i;
const HAS_QUOTE_RX = /["“”'‘’]/;
// A superlative ("which is the earliest event I hosted") or an ask for a specific fact
// ("…and when?", "where did I host it?") is NOT a plain list request. The renderers below can
// only dump every row in creation order — they can't sort, pick one, or say where/how long —
// so short-circuiting these answers a different question than the one asked. Fall through to
// the LLM, which gets dates/venues/descriptions from the same executors and can pick ONE.
const HAS_SUPERLATIVE_RX = /\b(earliest|latest|soonest|newest|oldest|most\s+recent|first|last|next|nearest|furthest|longest|shortest|biggest|largest|smallest)\b/i;
const WANTS_DETAIL_RX = /\b(when|where|what\s+time|how\s+long|duration|how\s+far)\b/i;

// "events I've joined" / "joined events" / "which events have I joined" — PAST tense.
// Guarded against the modal "can join" case (handled by JOINABLE_RX).
const JOINED_RX = /\b(?:my\s+)?joined\s+events?\b|\bevents?\s+(?:that\s+)?i(?:'ve|\s+have)?\s+joined\b|\b(?:which|what)\s+events?\s+(?:have|did)\s+i\s+joined?\b|\bevents?\s+i\s+joined\b/i;
// "events I can join/attend/buy" / "what/which can I join" — MODAL (future) list ask.
// End-anchored on the verb (allowing a trailing "events"): a specific-event ask like
// "can I join Neon Rave?" has a trailing object, so it does NOT match and falls to the LLM.
const JOINABLE_RX = /\b(?:(?:what|which)\s+)?(?:are\s+the\s+)?(?:events?\s+)?(?:that\s+)?(?:i\s+can|can\s+i)\s+(?:join|attend|buy)(?:\s+(?:an?\s+|to\s+)?events?)?\s*[?.!]*$/i;
// "live events (hosted by all organisers)" / "what events are currently live".
const LIVE_RX = /\blive\s+events?\b|\bevents?\b[^?.!]*\blive\b|\bevents?\s+hosted\s+by\s+(?:all|every|the)\b|\ball\s+(?:the\s+)?(?:current\s+|live\s+)?events?\s+hosted\b/i;
// The caller's OWN events — synonyms of "hosted"/"created". Requires an "I/my" tied to the
// verb so it never collides with the `live` "hosted by all organisers" case.
// Past-tense forms first so alternation prefers them (harmless either way).
const HOST_VERB_ANY = '(?:hosted|host|created|create|made|make|organi[sz]ed|organi[sz]e|launched|launch|ran|run|put\\s+on|thrown|threw|throw|held|hold)';
const HOSTED_RX = new RegExp(
  `\\bmy\\s+(?:hosted|created|own)\\s+events?\\b`
  // "events (which/that) i (have) hosted" — also covers "what are the events which i have hosted?"
  + `|\\bevents?\\s+(?:which|that\\s+)?\\s*i(?:'ve|\\s+have)?\\s+${HOST_VERB_ANY}\\b`
  + `|\\b(?:what|which)\\s+events?\\s+(?:have|did|do)\\s+i\\s+${HOST_VERB_ANY}`
  + `|\\bwhat\\s+have\\s+i\\s+${HOST_VERB_ANY}\\b`,
  'i',
);

// Classify the LATEST user message into one of the deterministic list intents, or null
// (no match / qualified → fall through to the LLM). Past-tense "joined" is checked before
// the modal "can join"; "hosted/created" (own events) before "live" (all organisers').
export function matchListQuery(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (HAS_QUALIFIER_RX.test(t) || HAS_QUOTE_RX.test(t)) return null;
  if (HAS_SUPERLATIVE_RX.test(t) || WANTS_DETAIL_RX.test(t)) return null;
  if (JOINED_RX.test(t) && !/\bcan\b|\bcould\b|\bable\b/i.test(t)) return 'joined';
  if (HOSTED_RX.test(t)) return 'hosted';
  if (JOINABLE_RX.test(t)) return 'joinable';
  if (LIVE_RX.test(t)) return 'live';
  return null;
}

// ── Buy intent: catch a typo'd event name BEFORE the LLM can invent one ────────
// "i want to purchase tickets for game nigjt and esakn rooms" → "game nigjt and esakn rooms".
// Tolerates a quantity ("buy 2 tickets for X"). Returns the named event, or null when the
// user named no event (then the LLM asks which one, as before).
const BUY_INTENT_RX = /\b(?:buy|purchase|get|book|grab)\b[^.?!]*?\btickets?\b\s+(?:for|to)\s+(.+)$/i;
// A quoted span anywhere in the capture is an explicit name: `buy tickets for "gymming for
// newbies" after 1 august`. cleanName alone can't help there — it only strips quotes at the
// very START/END of the whole capture, so a quoted name followed by any trailing clause kept
// its quotes embedded. Double/curly-double only: a bare apostrophe is far more often a
// possessive ("Alice's party") than a delimiter.
const QUOTED_NAME_RX = /["“”]\s*([^"“”]{2,}?)\s*["“”]/;
const cleanName = (s) => String(s).trim().replace(/[?.!,]+$/, '').replace(/^["“”'‘’]|["“”'‘’]$/g, '').trim();

export function matchBuyIntent(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  // A QUESTION about buying ("can i buy tickets for gymming for newbies after 1 august?") asks
  // whether the window is still open — it is NOT a purchase, and the greedy (.+) below would
  // read the whole trailing clause as the event name. Fall through to runGraph instead, where
  // get_event_details answers it from isOpen/deadline/deadlinePassed. Known limitation, shared
  // with eventGraph's looksLikePurchase: a question with a non-interrogative lead ("so can i
  // buy tickets for X?") still intercepts here.
  if (isBuyQuestion(t)) return null;
  const m = BUY_INTENT_RX.exec(t);
  if (!m) return null;
  const quoted = QUOTED_NAME_RX.exec(m[1]);
  return cleanName(quoted ? quoted[1] : m[1]) || null;
}

// The event name in a purchase-phrased QUESTION ("can i buy tickets for X?") — the mirror of
// matchBuyIntent, which skips questions. Used only by buildOwnedOrClosedReply, which returns a
// reply ONLY when the event is an exact not-buyable match, so a question about a BUYABLE event
// still falls through to the graph (temporal asks like "…after 1 august?" keep working there).
export function matchBuyQuestionName(text) {
  const t = String(text ?? '').trim();
  if (!t || !isBuyQuestion(t)) return null;
  const m = BUY_INTENT_RX.exec(t);
  if (!m) return null;
  const quoted = QUOTED_NAME_RX.exec(m[1]);
  return cleanName(quoted ? quoted[1] : m[1]) || null;
}

// A trailing time qualifier on an imperative buy ("buy tickets for Neon Rave after 1 august")
// belongs to the ASK, not to the event name. Stripping it at parse time would maul an event
// legitimately titled "Party on Friday", so the stripped form is only ever a FALLBACK
// candidate: a real title resolves on candidate #1 and the strip is never reached, which makes
// a wrong strip harmless by construction.
const TEMPORAL_CONNECTIVE = '(?:after|before|by|on|in|until|till|from|around|starting|beginning)';
// The clause only counts as a DATE when a date-ish token follows the connective — so "Before
// Sunrise", and the "for" inside "Gymming for newbies", are left alone.
const DATE_TAIL = '(?:\\d{1,2}(?:st|nd|rd|th)?|\\d{4}'
  + '|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
  + '|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?'
  + '|today|tomorrow|tonight|the\\s+deadline|next\\s+\\w+|this\\s+\\w+)';
const TRAILING_TEMPORAL_RX = new RegExp(`\\s+${TEMPORAL_CONNECTIVE}\\s+${DATE_TAIL}\\b.*$`, 'i');
const TRAILING_RELATIVE_RX = /\s+(?:today|tomorrow|tonight|this\s+(?:week|weekend|month)|next\s+(?:week|weekend|month))\s*$/i;

// Names to try, best-first: the name as given, then (only if it differs) the same name with a
// trailing date clause removed.
function nameCandidates(name) {
  const raw = String(name ?? '').trim();
  if (!raw) return [];
  const stripped = raw.replace(TRAILING_TEMPORAL_RX, '').replace(TRAILING_RELATIVE_RX, '').trim();
  return stripped && stripped !== raw && stripped.length >= 2 ? [raw, stripped] : [raw];
}

// Why a real, visible event can't be bought — in the user's words. null = no honest canned
// answer, so fall through to the LLM (which has get_event_details).
function notBuyableReply(ev, reason) {
  const t = ev.title;
  if (reason === 'sold_out') return `"${t}" is at full capacity — every ticket has been taken, so you can't buy any. If someone gives theirs away the spots return to the pool, so it's worth checking back.`;
  if (reason === 'already_purchased') return `You already have tickets for "${t}", so you can't buy more for that event. If you no longer need them you can give some away.`;
  if (reason === 'own_event') return `"${t}" is your own event — you can't buy tickets for an event you're hosting.`;
  if (reason === 'restricted_university') return `"${t}" is limited to students of a particular university, and your account isn't eligible — so you can't join this one.`;
  if (reason === 'cancelled') return `"${t}" has been cancelled, so tickets are no longer on sale.`;
  if (reason === 'completed' || reason === 'ended') return `"${t}" has already ended, so tickets are no longer on sale.`;
  if (reason === 'started') return `"${t}" has already started, so tickets are no longer on sale.`;
  return null;
}

// Deterministic reply for a named purchase. Returns null when the name resolves EXACTLY to a
// buyable event (the normal LLM flow then asks payment method → quantity), the reason it can't
// be bought when the event is real but not attendable, otherwise a "Did you mean …?" built from
// the closest events (Redis-first, Supabase fallback).
export async function buildBuyIntentReply(name, ctx) {
  try {
    // Admins have NO attendable pool at all (attendableEvents returns [] for them), so every
    // admin buy ask would otherwise get the flatly false "I cannot find an event named X".
    // Let the graph answer with the real role rules instead.
    if (String(ctx?.role ?? 'user').toLowerCase() === 'admin') return null;
    let buyableNear = [];
    let visibleNear = [];
    for (const candidate of nameCandidates(name)) {
      const buyable = await resolveAttendableRef(ctx, candidate);
      if (buyable?.event) return null; // exact + buyable → let the agent continue the purchase
      // An EXACT hit in the wider visible pool beats any near-miss in the narrow one: the
      // attendable pool excludes events the user already bought, their own, and past/closed
      // ones, so "cannot find" was being said about events that plainly exist. Exact-only
      // (findEvent) means this can never hijack a typo away from the "Did you mean …?" path.
      const visible = await resolveVisibleRef(ctx, candidate);
      if (visible?.event) {
        const reason = await whyNotAttendable(visible.event, ctx);
        return reason ? notBuyableReply(visible.event, reason) : null;
      }
      if (!buyableNear.length) buyableNear = buyable?.ambiguous ?? [];
      if (!visibleNear.length) visibleNear = visible?.ambiguous ?? [];
    }
    const shown = String(name ?? '').trim();
    const suggestions = buyableNear.length ? buyableNear : visibleNear;
    if (suggestions.length === 1) {
      return `I'm sorry, I cannot find an event named "${shown}". Did you mean "${suggestions[0]}"?`;
    }
    if (suggestions.length > 1) {
      const list = suggestions.map((s) => `"${s}"`).join(', ');
      return `I'm sorry, I cannot find an event named "${shown}". Did you mean one of these: ${list}?`;
    }
    return `I'm sorry, I cannot find an event named "${shown}". Ask me what events you can join and I'll list them.`;
  } catch {
    return null; // any snag → let the normal graph answer instead
  }
}

// For a purchase-phrased QUESTION ("can i buy tickets for X?"): if X is an EXACT visible event
// the user CAN'T buy (already owns / cancelled / ended / own event / restricted), answer
// deterministically with the reason — worded from the event's REAL title (notBuyableReply uses
// ev.title), so the casing/punctuation is always correct. A BUYABLE event, an unknown name, or an
// ambiguous near-miss all return null so the graph answers: a question must never be turned into a
// canned "cannot find …?" (that regression is exactly why questions skip matchBuyIntent).
export async function buildOwnedOrClosedReply(name, ctx) {
  try {
    if (String(ctx?.role ?? 'user').toLowerCase() === 'admin') return null;
    for (const candidate of nameCandidates(name)) {
      const visible = await resolveVisibleRef(ctx, candidate);
      if (visible?.event) {
        const reason = await whyNotAttendable(visible.event, ctx);
        return reason ? notBuyableReply(visible.event, reason) : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Link-a-card intent ────────────────────────────────────────────────────────
// Card details must NEVER be typed into chat (messages are stored, sent to the model and
// embedded), so the agent never asks for a number — it confirms, then the UI opens the
// app's secure Stripe card form. Handled deterministically so the model can't improvise.
const LINK_CARD_RX = /\b(?:link|add|save|register|connect|set\s*up|setup)\b[^.?!]{0,20}\b(?:card|credit\s*card|debit\s*card|payment\s*method)\b|\b(?:card|payment\s*method)\b[^.?!]{0,20}\b(?:link|add|save|register|connect)\b/i;
// A user typing something that looks like a card number — never echo it back.
const PAN_RX = /(?:\d[ -]*?){13,19}/;

export function matchLinkCardIntent(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (PAN_RX.test(t.replace(/[^\d -]/g, ''))) return 'card_number_pasted';
  return LINK_CARD_RX.test(t) ? 'link_card' : null;
}

// Reply for the link-card intents. Returns { reply, action? } — `action: 'open_card_form'`
// tells the UI to open the secure Stripe card form.
export function buildLinkCardReply(kind, confirmed) {
  if (kind === 'card_number_pasted') {
    return {
      reply: "Please don't share card numbers in this chat — messages here are stored, so card details must only be entered in the secure card form. I can open that form for you: just say \"link a card\".",
    };
  }
  if (confirmed) {
    return {
      reply: "Opening the secure card form now — enter your card there and it'll be linked to your wallet. Come back and tell me when you're done and we can carry on.",
      action: 'open_card_form',
    };
  }
  return {
    reply: 'I can open the secure card form so you can link a card — your details go straight to our payment provider and are never entered in this chat. Would you like me to open it?',
  };
}

const isoDate = (v) => (v ? String(v).slice(0, 10) : null);
const money = (n) => `$${Number(n ?? 0).toFixed(2)}`;
const tickets = (n) => `${n} ticket${Number(n) === 1 ? '' : 's'}`;

// One buyable event line, e.g. `"Neon Rave" on 2026-08-01 at Campus Green — $17.50.`
function joinableLine(e) {
  const bits = [`"${e.title}"`];
  const d = isoDate(e.startDate);
  if (d) bits.push(`on ${d}`);
  if (e.venue) bits.push(`at ${e.venue}`);
  let line = bits.join(' ');
  if (e.currentPrice != null) line += ` — ${money(e.currentPrice)}`;
  return `${line}.`;
}

// One joined-event line; `held` verb is "have"/"had" for upcoming/past.
function joinedLine(e, verb) {
  const bits = [`"${e.title}"`];
  const d = isoDate(e.startDate);
  if (d) bits.push(`on ${d}`);
  if (e.venue) bits.push(`at ${e.venue}`);
  let line = `${bits.join(' ')}.`;
  const held = Number(e.ticketsHeld ?? 0);
  if (held > 0) line += ` You ${verb} ${tickets(held)} for this event.`;
  return line;
}

function numberedGroup(rows, render) {
  return rows.map((e, i) => `${i + 1}. ${render(e)}`).join('\n\n');
}

// Build the deterministic reply for the matched kind, or null to fall through to the
// LLM (e.g. an unexpected executor error). ctx = { supabase, userId, role }.
export async function buildListReply(kind, ctx) {
  try {
    if (kind === 'joinable') {
      const { events = [] } = await EXECUTORS.list_available_events({}, ctx);
      if (!events.length) return 'There are no events available for you to join right now.';
      const intro = `You can join the following ${events.length} event${events.length === 1 ? '' : 's'}:`;
      return `${intro}\n\n${numberedGroup(events, joinableLine)}`;
    }

    if (kind === 'joined') {
      const { upcoming = [], past = [], cancelled = [] } = await EXECUTORS.get_my_joined_events({}, ctx);
      if (!upcoming.length && !past.length && !cancelled.length) return "You haven't joined any events yet.";
      const sections = [];
      if (upcoming.length) sections.push(`Upcoming events:\n${numberedGroup(upcoming, (e) => joinedLine(e, 'have'))}`);
      if (past.length) sections.push(`Past events:\n${numberedGroup(past, (e) => joinedLine(e, 'had'))}`);
      if (cancelled.length) sections.push(`Cancelled events:\n${numberedGroup(cancelled, (e) => joinedLine(e, 'had'))}`);
      return sections.join('\n\n');
    }

    if (kind === 'hosted') {
      const { events = [] } = await EXECUTORS.get_my_hosted_events({}, ctx);
      if (!events.length) return "You haven't created any events yet.";
      // Date/venue are conditional, mirroring joinableLine: this was the only renderer that
      // dropped the date it was already handed, so a hosted list could never say WHEN.
      const hostedLine = (e) => {
        const head = [`"${e.title}"`];
        const d = isoDate(e.startDate);
        if (d) head.push(`on ${d}`);
        if (e.venue) head.push(`at ${e.venue}`);
        const tail = [];
        if (e.currentPrice != null) tail.push(money(e.currentPrice));
        tail.push(`${tickets(Number(e.ticketsSold ?? 0))} sold`);
        tail.push(`${money(e.revenueSoFar)} revenue`);
        return `${head.join(' ')} — ${tail.join(', ')}.`;
      };
      const groups = [
        ['Live events', events.filter((e) => e.status === 'early_bird' || e.status === 'greenlit')],
        ['Completed events', events.filter((e) => e.status === 'completed')],
        ['Cancelled events', events.filter((e) => e.status === 'cancelled')],
      ];
      const sections = groups
        .filter(([, rows]) => rows.length)
        .map(([header, rows]) => `${header}:\n${numberedGroup(rows, hostedLine)}`);
      return sections.join('\n\n');
    }

    if (kind === 'live') {
      const { events = [] } = await EXECUTORS.list_live_events({}, ctx);
      if (!events.length) return 'There are no live events right now.';
      const intro = `There ${events.length === 1 ? 'is' : 'are'} ${events.length} live event${events.length === 1 ? '' : 's'} hosted across all organisers:`;
      const render = (e) => {
        const bits = [`"${e.title}"`];
        if (e.organiser) bits.push(`by ${e.organiser}`);
        const d = isoDate(e.startDate);
        if (d) bits.push(`on ${d}`);
        if (e.venue) bits.push(`at ${e.venue}`);
        let line = bits.join(' ');
        const tail = [e.status === 'greenlit' ? 'greenlit' : 'early bird'];
        if (e.currentPrice != null) tail.push(money(e.currentPrice));
        return `${line} — ${tail.join(', ')}.`;
      };
      return `${intro}\n\n${numberedGroup(events, render)}`;
    }
  } catch {
    return null; // any snag → let the normal graph answer instead
  }
  return null;
}
