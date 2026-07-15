// Deterministic short-circuit replies for three high-frequency, fully-specified
// list questions. gemini-flash occasionally mis-routes these ("events I can join"
// vs "events I've joined") or mis-numbers grouped lists, so instead of relying on
// the model we detect them with strict regexes and render the answer in code from
// the same cached executors the agent would use. Anything qualified (a price cap,
// a specific event name) returns null and falls through to the LLM graph.

import { EXECUTORS, resolveAttendableRef } from './tools.js';

// A qualifier/price cap or a quoted specific-event name means the ask is NOT a plain
// list request — let the LLM handle it (it can apply the filter / resolve the name).
const HAS_QUALIFIER_RX = /(\bunder\b|\bbelow\b|\bover\b|\babove\b|\bcheaper\b|\bless than\b|\bmore than\b|\bat most\b|\bat least\b|\$\s?\d|\d+\s?(dollars|bucks))/i;
const HAS_QUOTE_RX = /["“”'‘’]/;

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

export function matchBuyIntent(text) {
  const m = BUY_INTENT_RX.exec(String(text ?? '').trim());
  if (!m) return null;
  const name = m[1].trim().replace(/[?.!,]+$/, '').replace(/^["“”'‘’]|["“”'‘’]$/g, '').trim();
  return name || null;
}

// Deterministic reply for a named purchase. Returns null when the name resolves EXACTLY
// (the normal LLM flow then asks payment method → quantity), otherwise a "Did you mean …?"
// built from the closest attendable events (Redis-first, Supabase fallback).
export async function buildBuyIntentReply(name, ctx) {
  try {
    const resolved = await resolveAttendableRef(ctx, name);
    if (resolved?.event) return null; // exact → let the agent continue the purchase
    const suggestions = resolved?.ambiguous ?? [];
    if (suggestions.length === 1) {
      return `I'm sorry, I cannot find an event named "${name}". Did you mean "${suggestions[0]}"?`;
    }
    if (suggestions.length > 1) {
      const list = suggestions.map((s) => `"${s}"`).join(', ');
      return `I'm sorry, I cannot find an event named "${name}". Did you mean one of these: ${list}?`;
    }
    return `I'm sorry, I cannot find an event named "${name}". Ask me what events you can join and I'll list them.`;
  } catch {
    return null; // any snag → let the normal graph answer instead
  }
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
      const hostedLine = (e) => {
        const bits = [`"${e.title}"`];
        if (e.currentPrice != null) bits.push(money(e.currentPrice));
        bits.push(`${tickets(Number(e.ticketsSold ?? 0))} sold`);
        bits.push(`${money(e.revenueSoFar)} revenue`);
        return `${bits[0]} — ${bits.slice(1).join(', ')}.`;
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
