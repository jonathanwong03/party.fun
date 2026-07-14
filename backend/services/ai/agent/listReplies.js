// Deterministic short-circuit replies for three high-frequency, fully-specified
// list questions. gemini-flash occasionally mis-routes these ("events I can join"
// vs "events I've joined") or mis-numbers grouped lists, so instead of relying on
// the model we detect them with strict regexes and render the answer in code from
// the same cached executors the agent would use. Anything qualified (a price cap,
// a specific event name) returns null and falls through to the LLM graph.

import { EXECUTORS } from './tools.js';

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

// Classify the LATEST user message into one of the three deterministic list intents,
// or null (no match / qualified → fall through to the LLM). Past-tense "joined" is
// checked before the modal "can join" so they never collide.
export function matchListQuery(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (HAS_QUALIFIER_RX.test(t) || HAS_QUOTE_RX.test(t)) return null;
  if (JOINED_RX.test(t) && !/\bcan\b|\bcould\b|\bable\b/i.test(t)) return 'joined';
  if (JOINABLE_RX.test(t)) return 'joinable';
  if (LIVE_RX.test(t)) return 'live';
  return null;
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
